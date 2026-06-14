import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import type { FlowId, StageStep, WorkflowRun } from '@ainp/shared';
import { api } from './api-client';
import { TrustedLocalWorktreeEnvironment } from './worktree';
import { getConfig } from './config-client';
import { sendHeartbeat } from './heartbeat';
import { selectAgentBackend } from './backend-selection';
import { FLOW_REGISTRY } from './flows/registry';
import type {
  ContextPolicy,
  OkRef,
  OrchestrateOpts,
  OrchestrateResult,
  PromoteDraftInput,
  RunCtx,
} from './orchestrator/types';
import {
  executeAcceptance,
  executeAgentMarkdownStage,
  executeBuildTest,
  executeCompletion,
  executeImplementation,
  executeKnowledgePromotion,
  executeVerifier,
  runContextPack,
  runStage,
} from './orchestrator/steps';

// ---------------------------------------------------------------------------
// T3.1 de-closure (06-12): this file now holds only the run lifecycle
// skeleton (`cmdOrchestrate`) and the single-point stage router
// (`dispatchStep`). The step implementations live in `./orchestrator/steps`,
// the agent invocation + context-injection layer in
// `./orchestrator/invoke-skill`, approval polling in
// `./orchestrator/approval`, and the verifier media pure functions in
// `./orchestrator/verifier-media`. All previously public exports are
// re-exported below so the import surface is unchanged.
// ---------------------------------------------------------------------------

export type { OrchestrateOpts, OrchestrateResult, RunCtx } from './orchestrator/types';
export { agentTaskBriefForContext } from './orchestrator/invoke-skill';
export {
  enforceSensitiveChangeCheckpoint,
  waitForApprovalDecision,
  type SensitiveChangeCheckpointDeps,
} from './orchestrator/approval';
export {
  promoteAcceptedDraftToKnowledge,
  type PromoteDeps,
} from './orchestrator/steps';
export type { PromoteDraftInput } from './orchestrator/types';

// Storage base for stage artifacts. Honors AINP_ARTIFACTS_DIR, then AINP_HOME
// (so a single AINP_HOME relocates worktrees/projects/knowledge/artifacts
// together), then the ~/.ai-native default.
const ARTIFACTS_BASE =
  process.env.AINP_ARTIFACTS_DIR ??
  join(process.env.AINP_HOME ?? join(homedir(), '.ai-native'), 'artifacts');

async function loadContextPolicy(): Promise<ContextPolicy> {
  const [
    maxTokens,
    reservedForReasoning,
    reservedForOutput,
    sensitivePathPatterns,
  ] = await Promise.all([
    getConfig('context.policy.max_tokens'),
    getConfig('context.policy.reserved_for_reasoning'),
    getConfig('context.policy.reserved_for_output'),
    getConfig('context.policy.sensitive_path_patterns'),
  ]);
  return {
    budget: {
      maxTokens,
      reservedForReasoning,
      reservedForOutput,
    },
    sensitivePathPatterns,
  };
}

/**
 * Drive the full 8-stage lifecycle end-to-end with the project's real Agent
 * Backend. The Workflow Engine on the API is the only state writer; the
 * runner emits events. Human gates pause the flow until /approvals records
 * a decision.
 *
 * V2 W2-1 / PR3: stage iteration is driven by
 * `FLOW_REGISTRY[run.flowId].stages` (see `./flows/registry.ts`). Logic is
 * byte-for-byte equivalent to V1 (PRD ADR Q1=α — thin refactor); the T3.1
 * de-closure moved the step implementations to top-level functions without
 * changing behavior.
 */
export async function cmdOrchestrate(opts: OrchestrateOpts): Promise<OrchestrateResult> {
  const { tools, runnerId } = await sendHeartbeat();
  console.log(`[runner] heartbeat from ${runnerId} (jdk=${tools.jdk}, mvn=${tools.maven})`);

  const project = await api.getProject(opts.project);
  const backend = await selectAgentBackend(project);
  let run: WorkflowRun;
  if (opts.workflowRunId) {
    // Resume an existing run (retry-step flow).
    const detail = await api.getWorkflowRun(opts.workflowRunId);
    run = detail.run;
    console.log(`[runner] resuming workflow-run ${run.id} at stage ${opts.startStage ?? run.currentStage} (flow=${run.flowId})`);
  } else {
    run = await api.createWorkflowRun({
      projectName: project.name,
      title: opts.title,
      type: opts.runType ?? 'feature',
      sourceBranch: opts.sourceBranch ?? project.defaultBranch,
      flowId: opts.flowId,
      startStage: opts.startStage,
    });
    console.log(`[runner] workflow-run ${run.id} created (flow=${run.flowId})`);
  }
  if (opts.workflowRequestId) {
    await api.workflowRequestRunStarted({
      requestId: opts.workflowRequestId,
      workflowRunId: run.id,
    });
  }

  const env = new TrustedLocalWorktreeEnvironment(project);
  const workspace = await env.prepare(run);

  // R1.4: Variables declared outside try block for access in catch/finally
  const ok: OkRef = { value: true };
  let runArtifactsDir: string;
  let contextPolicy: ContextPolicy;
  let ctx: RunCtx;

  // R1.4: try block starts immediately after env.prepare to ensure cleanup
  // protects all subsequent operations (workspacePrepared, mkdir, loadContextPolicy,
  // flowId validation) that can throw and leave the worktree behind.
  try {
    await api.workspacePrepared({ workflowRunId: run.id, workspacePath: workspace.path });
    console.log(`[runner] workspace at ${workspace.path}`);

    runArtifactsDir = join(ARTIFACTS_BASE, run.id);
    await mkdir(runArtifactsDir, { recursive: true });

    contextPolicy = await loadContextPolicy();
    /**
     * V2 P0-1 / PR3: `draftsToPromote` captures requirement_draft / design_doc
     * stage outputs for promoteToKnowledge after acceptance. Promotion lifts
     * the draft into a knowledge entity row (REQ-### / DSN-###) on acceptance
     * approval. ADR Q2 (2-beta).
     */
    ctx = {
      project,
      run,
      workspace,
      backend,
      tools,
      opts,
      runArtifactsDir,
      inputs: {
        user_request: agentUserRequestForOrchestrate(opts),
      },
      inputArtifactIds: {},
      contextFoundation: {
        projectProfileResult: null,
        acceptedKnowledge: null,
        knowledgeArtifacts: null,
        runHistory: null,
      },
      contextPolicy,
      contextRequestChain: [],
      draftsToPromote: [] as PromoteDraftInput[],
      ok,
    };

    const flow = FLOW_REGISTRY[run.flowId];
    if (!flow) {
      throw new Error(
        `unknown flowId in registry: ${String(run.flowId)} (run=${run.id})`,
      );
    }

    const stagesToRun = sliceStagesFromStartStage({
      flowId: run.flowId,
      runId: run.id,
      stages: flow.stages,
      startStage: run.startStage,
      log: (m) => console.log(m),
    });

    for (const step of stagesToRun) {
      await dispatchStep(step, ctx);
    }
  } catch (err) {
    ok.value = false;
    console.error('[runner] orchestration failed:', err instanceof Error ? err.message : err);
  } finally {
    await api.workflowCompleted({ workflowRunId: run.id, ok: ok.value });
    if (opts.cleanup !== false) {
      await env.cleanup(workspace);
      console.log(`[runner] worktree removed: ${workspace.path}`);
    } else {
      console.log(`[runner] worktree kept at ${workspace.path}`);
    }
  }

  if (!ok.value && opts.setExitCode !== false) process.exitCode = 1;
  return { workflowRunId: run.id, ok: ok.value };
}

// ---- dispatcher ------------------------------------------------------------
// V2 W2-1 / PR3: single-point router from FLOW_REGISTRY stage to the
// matching step implementation. The switch is exhaustive over
// `WorkflowStage`; the `'init'` case is rejected explicitly because it is a
// status placeholder, not a dispatched step (FLOW_REGISTRY for
// feature.standard does not include it — see `./flows/registry.ts`). PRD R12.
//
// T3.1: `deps` lets unit tests spy on the per-stage routing without forking
// the dispatch surface — production always goes through the default deps,
// and every stage still flows through this one function.

export interface DispatchDeps {
  runContextPack: (c: RunCtx) => Promise<void>;
  runStage: (
    c: RunCtx,
    stage: 'requirement' | 'design' | 'review',
    artifactKind: 'requirement_draft' | 'design_doc' | 'other',
    rulebasedGateId: 'requirement_gate' | 'design_gate' | null,
  ) => Promise<void>;
  executeImplementation: (c: RunCtx) => Promise<void>;
  executeBuildTest: (c: RunCtx) => Promise<void>;
  executeVerifier: (c: RunCtx) => Promise<void>;
  executeAcceptance: (c: RunCtx) => Promise<void>;
  executeCompletion: (c: RunCtx) => Promise<void>;
  executeKnowledgePromotion: (c: RunCtx) => Promise<void>;
  executeAgentMarkdownStage: (
    stage: 'report' | 'analyze' | 'scan' | 'plan',
    c: RunCtx,
  ) => Promise<void>;
}

const DEFAULT_DISPATCH_DEPS: DispatchDeps = {
  runContextPack: (c) => runContextPack(c),
  runStage: (c, stage, artifactKind, rulebasedGateId) =>
    runStage(c, stage, artifactKind, rulebasedGateId),
  executeImplementation: (c) => executeImplementation(c),
  executeBuildTest: (c) => executeBuildTest(c),
  executeVerifier: (c) => executeVerifier(c),
  executeAcceptance: (c) => executeAcceptance(c),
  executeCompletion: (c) => executeCompletion(c),
  executeKnowledgePromotion: (c) => executeKnowledgePromotion(c),
  executeAgentMarkdownStage: (stage, c) => executeAgentMarkdownStage(stage, c),
};

export async function dispatchStep(
  step: StageStep,
  ctx: RunCtx,
  deps: DispatchDeps = DEFAULT_DISPATCH_DEPS,
): Promise<void> {
  switch (step.stage) {
    case 'context_pack':
      await deps.runContextPack(ctx);
      return;
    case 'requirement':
      await deps.runStage(ctx, 'requirement', 'requirement_draft', 'requirement_gate');
      return;
    case 'design':
      await deps.runStage(ctx, 'design', 'design_doc', 'design_gate');
      return;
    case 'implementation':
      await deps.executeImplementation(ctx);
      return;
    case 'build_test':
      await deps.executeBuildTest(ctx);
      return;
    case 'review':
      // V1 collapses human acceptance into the review step: the review
      // agent runs first, then `acceptance_gate` + `awaitHuman` +
      // approval poll + draft promotion run inline. WorkflowStage has no
      // `'acceptance'` value; that's why review owns both halves here.
      await deps.runStage(ctx, 'review', 'other', null);
      await deps.executeVerifier(ctx);
      await deps.executeAcceptance(ctx);
      return;
    case 'completion':
      await deps.executeCompletion(ctx);
      return;
    case 'knowledge':
      await deps.executeKnowledgePromotion(ctx);
      return;
    case 'report':
    case 'analyze':
    case 'scan':
    case 'plan':
      await deps.executeAgentMarkdownStage(step.stage, ctx);
      return;
    case 'init':
      throw new Error(`'init' is not a dispatchable stage (status placeholder only)`);
    default: {
      const _exhaustive: never = step.stage;
      throw new Error(`unknown stage: ${String(_exhaustive)}`);
    }
  }
}

export function agentUserRequestForOrchestrate(
  opts: Pick<OrchestrateOpts, 'title' | 'userRequest'>,
): string {
  const clarified = opts.userRequest?.trim();
  return clarified && clarified.length > 0 ? clarified : opts.title;
}

// ---------------------------------------------------------------------------
// V2 W2-4 / PR2: pure slice helper — given a flow's full stage list and an
// optional startStage, return the stages to actually dispatch.
//
// Contract:
//   - startStage null/undefined → return stages unchanged (V1 default).
//   - startStage present but not in flow → throw 'unknown startStage in flow'
//     (R-Risk-1: never silently skip a misconfigured run).
//   - startStage present and matches index N → return stages.slice(N) and
//     log how many earlier stages were skipped.
// ---------------------------------------------------------------------------
export function sliceStagesFromStartStage(params: {
  flowId: FlowId;
  runId: string;
  stages: readonly StageStep[];
  startStage: WorkflowRun['startStage'];
  log?: (msg: string) => void;
}): readonly StageStep[] {
  if (!params.startStage) return params.stages;
  const fromIdx = params.stages.findIndex((s) => s.stage === params.startStage);
  if (fromIdx === -1) {
    throw new Error(
      `unknown startStage in flow: ${String(params.startStage)} (flow=${params.flowId}, run=${params.runId})`,
    );
  }
  if (fromIdx === 0) return params.stages;
  params.log?.(
    `[runner] starting from stage ${params.startStage} (skipping ${fromIdx} earlier stage(s))`,
  );
  return params.stages.slice(fromIdx);
}
