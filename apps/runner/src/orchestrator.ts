import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import type { FlowId, GraphDefinition, GraphNodeDefinition, GraphNodeRun, StageStep, WorkflowRun, WorkflowStage } from '@ainp/shared';
import { errorMessage, flowToGraphDefinition, isOperationalError } from '@ainp/shared';
import { api } from './api-client';
import { sh } from './sh';
import { TrustedLocalWorktreeEnvironment } from './worktree';
import { getConfig } from './config-client';
import { sendHeartbeat } from './heartbeat';
import { selectAgentBackend } from './backend-selection';
import { FLOW_REGISTRY } from './flows/registry';
import type { AgentBackend } from './agents/types';
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
  executeInventory,
  executeKnowledgePromotion,
  executeProfileBootstrap,
  executeVerifier,
  runContextPack,
  runStage,
} from './orchestrator/steps';
import {
  latestNodeRunsByNode,
  nextRunnableGraphNode,
} from './orchestrator/graph-scheduler';

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
  let backend: AgentBackend = placeholderBackend(project, opts.agentBackend);
  let run: WorkflowRun;
  let existingRunDetail: Awaited<ReturnType<typeof api.getWorkflowRun>> | null = null;
  // 07-26 operational pause (AC-002): backend selection/preflight runs INSIDE
  // the run lifecycle try-block below, so a failed preflight pauses the run
  // (worktree kept, resume via retry-run) instead of throwing before the run
  // exists. Here we only decide whether selection is needed.
  let needsBackendSelection: boolean;
  if (opts.workflowRunId) {
    // Resume an existing run (retry-step flow).
    existingRunDetail = await api.getWorkflowRun(opts.workflowRunId);
    run = existingRunDetail.run;
    needsBackendSelection = run.flowId !== 'profile.bootstrap';
    console.log(`[runner] resuming workflow-run ${run.id} at stage ${opts.startStage ?? run.currentStage} (flow=${run.flowId})`);
  } else {
    // 06-25 ask-flow: 'ask' requests never reach orchestrator (they have
    // status='awaiting_clarification', not 'pending'), but TypeScript doesn't
    // know that. Filter out 'ask' to satisfy createWorkflowRun's type constraint.
    const inferredRunType = opts.runType
      ?? (opts.flowId ? FLOW_REGISTRY[opts.flowId]?.kind : undefined)
      ?? 'feature';
    const executableRunType = inferredRunType === 'ask' ? 'feature' : inferredRunType;
    needsBackendSelection = opts.flowId !== 'profile.bootstrap' && executableRunType !== 'profile';
    run = await api.createWorkflowRun({
      projectName: project.name,
      title: opts.title,
      type: executableRunType,
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
  // 07-26 operational pause: the stage the run should resume from when an
  // operational error pauses it. Tracks the node being dispatched; before the
  // first dispatch it points at the first stage of the slice (preflight case).
  let pauseStage: WorkflowStage | null = null;
  let paused = false;
  let runArtifactsDir: string;
  let contextPolicy: ContextPolicy;
  let ctx: RunCtx;
  let finalizedResult: OrchestrateResult | null = null;

  // R1.4: try block starts immediately after env.prepare to ensure cleanup
  // protects all subsequent operations (workspacePrepared, mkdir, loadContextPolicy,
  // flowId validation) that can throw and leave the worktree behind.
  try {
    await api.workspacePrepared({ workflowRunId: run.id, workspacePath: workspace.path });
    console.log(`[runner] workspace at ${workspace.path}`);

    runArtifactsDir = join(ARTIFACTS_BASE, run.id);
    await mkdir(runArtifactsDir, { recursive: true });

    contextPolicy = await loadContextPolicy();

    const flow = FLOW_REGISTRY[run.flowId];
    if (!flow) {
      throw new Error(
        `unknown flowId in registry: ${String(run.flowId)} (run=${run.id})`,
      );
    }

    const dispatchStartStage = opts.workflowRunId
      ? (opts.startStage ?? run.startStage ?? (run.currentStage === 'init' ? null : run.currentStage))
      : run.startStage;

    const stagesToRun = sliceStagesFromStartStage({
      flowId: run.flowId,
      runId: run.id,
      stages: flow.stages,
      startStage: dispatchStartStage,
      log: (m) => console.log(m),
    });
    pauseStage = stagesToRun[0]?.stage ?? null;

    // 07-26 operational pause (AC-002): preflight failures throw
    // OperationalError('backend_unavailable') from here — inside the run
    // lifecycle — so the catch below pauses the run at the first stage of
    // the slice instead of failing before the run exists.
    if (needsBackendSelection) {
      backend = await selectAgentBackend(project, opts.agentBackend);
    }

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
        historicalInventoryArtifact: null,
        historicalInventoryArtifactChecked: false,
      },
      contextPolicy,
      contextRequestChain: [],
      draftsToPromote: [] as PromoteDraftInput[],
      handoffContext: {
        implementationSessionId: null,
        implementationArtifactIds: [],
      },
      ok,
    };

    const graph = flowToGraphDefinition(flow);
    const existingGraph = existingRunDetail?.graph;
    const graphRun = existingGraph?.graphRun
      && existingGraph.graphDefinition?.id === graph.id
      && existingGraph.graphRun.graphVersion === graph.version
      ? existingGraph.graphRun
      : await api.graphRunStarted({
          workflowRunId: run.id,
          graphDefinition: graph,
        });
    let graphNodeRuns: GraphNodeRun[] = graphRun === existingGraph?.graphRun
      ? [...(existingGraph?.nodeRuns ?? [])]
      : [];
    const allowedNodeIds = graphNodeIdsForStages(graph, stagesToRun);

    while (completedGraphNodesInSlice(graphNodeRuns, allowedNodeIds) < allowedNodeIds.length) {
      const node = nextRunnableGraphNode({
        graph,
        graphRun,
        nodeRuns: graphNodeRuns,
        allowedNodeIds,
        ignoreExternalIncoming: true,
      });
      if (!node) {
        throw new Error(`graph scheduler found no runnable node (run=${run.id}, flow=${run.flowId})`);
      }
      const step = stageStepForGraphNode(stagesToRun, node);
      pauseStage = node.stage;
      const latestNodeRun = latestNodeRunsByNode(graphNodeRuns).get(node.id);
      const attempt = latestNodeRun?.status === 'ready'
        ? latestNodeRun.attempt
        : (latestNodeRun?.attempt ?? 0) + 1;
      const startedNodeRun = await api.graphNodeStarted({
        workflowRunId: run.id,
        graphRunId: graphRun.id,
        nodeRunId: latestNodeRun?.status === 'ready' ? latestNodeRun.id : undefined,
        nodeId: node.id,
        dependencyState: dependencyStateForNode(graph, node.id, graphNodeRuns),
        idempotencyKey: latestNodeRun?.status === 'ready'
          ? latestNodeRun.idempotencyKey
          : `${graphRun.id}:${node.id}:${attempt}`,
        metadata: {
          stage: node.stage,
          sourceFlowId: graph.sourceFlowId,
        },
      });
      graphNodeRuns = upsertLocalGraphNodeRun(graphNodeRuns, startedNodeRun);
      try {
        await dispatchStep(step, ctx);
        const evidence = await latestStepEvidenceForStage(run.id, node.stage);
        const finishedNodeRun = await api.graphNodeFinished({
          nodeRunId: startedNodeRun.id,
          status: ctx.ok.value ? 'passed' : 'failed',
          stepRunId: evidence.stepRunId,
          stepCheckpointId: evidence.stepCheckpointId,
          resumeCursor: evidence.resumeCursor,
        });
        graphNodeRuns = upsertLocalGraphNodeRun(graphNodeRuns, finishedNodeRun);
        if (!ctx.ok.value) break;
      } catch (err) {
        const evidence = await latestStepEvidenceForStage(run.id, node.stage).catch(() => ({
          stepRunId: null,
          stepCheckpointId: null,
          resumeCursor: null,
        }));
        const finishedNodeRun = await recordGraphNodeFailure({
          err,
          nodeRunId: startedNodeRun.id,
          stepRunId: evidence.stepRunId,
          stepCheckpointId: evidence.stepCheckpointId,
          resumeCursor: evidence.resumeCursor,
          deps: {
            stepFinished: (params) => api.stepFinished(params),
            graphNodeFinished: (params) => api.graphNodeFinished(params),
          },
        });
        graphNodeRuns = upsertLocalGraphNodeRun(graphNodeRuns, finishedNodeRun);
        throw err;
      }
    }
  } catch (err) {
    // 07-26 operational pause (R3/R7): operational errors pause the run;
    // every other error keeps the historical failure path byte-for-byte.
    paused = await handleOrchestrationError({
      err,
      workflowRunId: run.id,
      stage: pauseStage ?? run.currentStage,
      workspacePath: workspace.path,
    });
    if (paused) {
      console.error(`[runner] orchestration paused (operational): ${err instanceof Error ? err.message : err}`);
    } else {
      ok.value = false;
      console.error('[runner] orchestration failed:', err instanceof Error ? err.message : err);
    }
  } finally {
    finalizedResult = await finalizeOrchestration({
      workflowRunId: run.id,
      workspacePath: workspace.path,
      ok: ok.value,
      paused,
      cleanupEnabled: opts.cleanup !== false,
      setFailureExitCode: opts.setExitCode !== false,
      deps: {
        workflowCompleted: (params) => api.workflowCompleted(params),
        cleanup: () => env.cleanup(workspace),
        setExitCode: (code) => {
          process.exitCode = code;
        },
        log: (message) => console.log(message),
      },
    });
  }

  return finalizedResult!;
}

// ---- operational pause (07-26 operational-unavailable-state) ---------------

export interface OrchestrationFinalizationDeps {
  workflowCompleted: typeof api.workflowCompleted;
  cleanup: () => Promise<void>;
  setExitCode: (code: number) => void;
  log: (message: string) => void;
}

/** Apply the mutually-exclusive paused vs completed lifecycle side effects. */
export async function finalizeOrchestration(params: {
  workflowRunId: string;
  workspacePath: string;
  ok: boolean;
  paused: boolean;
  cleanupEnabled: boolean;
  setFailureExitCode: boolean;
  deps: OrchestrationFinalizationDeps;
}): Promise<OrchestrateResult> {
  if (params.paused) {
    params.deps.log(
      `[runner] workflow-run ${params.workflowRunId} paused; worktree kept for resume at ${params.workspacePath}`,
    );
  } else {
    await params.deps.workflowCompleted({ workflowRunId: params.workflowRunId, ok: params.ok });
    if (params.cleanupEnabled) {
      await params.deps.cleanup();
      params.deps.log(`[runner] worktree removed: ${params.workspacePath}`);
    } else {
      params.deps.log(`[runner] worktree kept at ${params.workspacePath}`);
    }
  }

  // R4: a pause is not a process failure, even when it interrupted the work.
  if (!params.paused && !params.ok && params.setFailureExitCode) params.deps.setExitCode(1);
  return {
    workflowRunId: params.workflowRunId,
    ok: params.paused ? true : params.ok,
    paused: params.paused,
  };
}

export interface OrchestrationGraphFailureDeps {
  stepFinished: typeof api.stepFinished;
  graphNodeFinished: typeof api.graphNodeFinished;
}

/** Record R10 failure evidence without adding step or graph status values. */
export async function recordGraphNodeFailure(params: {
  err: unknown;
  nodeRunId: string;
  stepRunId: string | null;
  stepCheckpointId: string | null;
  resumeCursor: string | null;
  deps: OrchestrationGraphFailureDeps;
}): Promise<Awaited<ReturnType<typeof api.graphNodeFinished>>> {
  const operational = isOperationalError(params.err);
  if (operational && params.stepRunId) {
    await params.deps.stepFinished({
      stepRunId: params.stepRunId,
      status: 'failed',
      failureReason: `operational: ${errorMessage(params.err)}`,
    }).catch(() => {});
  }
  return params.deps.graphNodeFinished({
    nodeRunId: params.nodeRunId,
    status: 'failed',
    stepRunId: params.stepRunId,
    stepCheckpointId: params.stepCheckpointId,
    resumeCursor: params.resumeCursor,
    metadata: {
      error: params.err instanceof Error ? params.err.message : String(params.err),
      ...(operational ? { operational: true } : {}),
    },
  });
}

export interface OperationalPauseDeps {
  workflowPaused: typeof api.workflowPaused;
  isWorkflowPaused: (workflowRunId: string) => Promise<boolean>;
  resolveWorktreeHead: (workspacePath: string) => Promise<string | null>;
  log: (msg: string) => void;
}

const DEFAULT_OPERATIONAL_PAUSE_DEPS: OperationalPauseDeps = {
  workflowPaused: (params) => api.workflowPaused(params),
  isWorkflowPaused: async (workflowRunId) => {
    const detail = await api.getWorkflowRun(workflowRunId);
    return detail.run.status === 'paused';
  },
  resolveWorktreeHead: (workspacePath) => worktreeHeadCommit(workspacePath),
  log: (msg) => console.error(msg),
};

/**
 * Classify an orchestration error (R3). Operational errors report the
 * `workflow-paused` event (run/request → `paused`, worktree kept) and return
 * true; anything else — including a failed pause report itself — returns
 * false so the caller keeps the historical failure path (R7). No retry loop
 * is started here or anywhere else: resume is manual only (R5).
 */
export async function handleOrchestrationError(params: {
  err: unknown;
  workflowRunId: string;
  stage: WorkflowStage;
  workspacePath: string;
  deps?: OperationalPauseDeps;
}): Promise<boolean> {
  if (!isOperationalError(params.err)) return false;
  const deps = params.deps ?? DEFAULT_OPERATIONAL_PAUSE_DEPS;
  try {
    const worktreeHead = await deps.resolveWorktreeHead(params.workspacePath).catch(() => null);
    await deps.workflowPaused({
      workflowRunId: params.workflowRunId,
      stage: params.stage,
      reason: params.err.reason,
      detail: params.err.detail,
      worktreeHead,
    });
    return true;
  } catch (reportErr) {
    const pauseCommitted = await deps.isWorkflowPaused(params.workflowRunId).catch(() => false);
    if (pauseCommitted) {
      deps.log(
        `[runner] workflow-paused response failed (${errorMessage(reportErr)}), but run was confirmed paused after response failure`,
      );
      return true;
    }
    deps.log(
      `[runner] workflow-paused report failed (${errorMessage(reportErr)}); falling back to failure handling`,
    );
    return false;
  }
}

/** Best-effort HEAD commit of the run worktree, recorded in the pause audit. */
async function worktreeHeadCommit(workspacePath: string): Promise<string | null> {
  const result = await sh('git', ['rev-parse', 'HEAD'], { cwd: workspacePath, timeoutMs: 10_000 });
  if (result.exitCode !== 0) return null;
  const head = result.stdout.trim();
  return head.length > 0 ? head : null;
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
  executeInventory: (c: RunCtx) => Promise<void>;
  executeProfileBootstrap: (c: RunCtx) => Promise<void>;
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
  executeInventory: (c) => executeInventory(c),
  executeProfileBootstrap: (c) => executeProfileBootstrap(c),
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
    case 'inventory':
      await deps.executeInventory(ctx);
      return;
    case 'profile':
      await deps.executeProfileBootstrap(ctx);
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

function placeholderBackend(
  project: Awaited<ReturnType<typeof api.getProject>>,
  override?: Awaited<ReturnType<typeof api.getProject>>['agentBackend'],
): AgentBackend {
  const kind = override ?? project.agentBackend ?? 'codex';
  return {
    kind,
    run: async () => {
      throw new Error('Agent Backend is not ready for this stage.');
    },
  };
}

export function agentUserRequestForOrchestrate(
  opts: Pick<OrchestrateOpts, 'title' | 'userRequest'>,
): string {
  const clarified = opts.userRequest?.trim();
  return clarified && clarified.length > 0 ? clarified : opts.title;
}

function graphNodeIdsForStages(
  graph: GraphDefinition,
  stages: readonly StageStep[],
): string[] {
  const nodes = [...graph.nodes];
  return stages.map((step) => {
    const idx = nodes.findIndex((node) => node.stage === step.stage);
    if (idx === -1) {
      throw new Error(`graph has no node for stage ${step.stage}`);
    }
    const [node] = nodes.splice(idx, 1);
    return node!.id;
  });
}

function stageStepForGraphNode(
  stages: readonly StageStep[],
  node: GraphNodeDefinition,
): StageStep {
  const step = stages.find((candidate) => candidate.stage === node.stage);
  if (!step) throw new Error(`no dispatch step for graph node ${node.id}`);
  return step;
}

function dependencyStateForNode(
  graph: GraphDefinition,
  nodeId: string,
  nodeRuns: readonly GraphNodeRun[],
): GraphNodeRun['dependencyState'] {
  const latest = latestNodeRunsByNode(nodeRuns);
  const upstreamNodeIds = graph.edges
    .filter((edge) => edge.toNodeId === nodeId)
    .map((edge) => edge.fromNodeId);
  return {
    upstreamNodeIds,
    satisfiedNodeIds: upstreamNodeIds.filter((id) => latest.get(id)?.status === 'passed'),
    blockedNodeIds: upstreamNodeIds.filter((id) => {
      const status = latest.get(id)?.status;
      return status === 'failed'
        || status === 'blocked'
        || status === 'cancelled'
        || status === 'skipped';
    }),
  };
}

async function latestStepEvidenceForStage(
  workflowRunId: string,
  stage: WorkflowStage,
): Promise<{
  stepRunId: string | null;
  stepCheckpointId: string | null;
  resumeCursor: string | null;
}> {
  const detail = await api.getWorkflowRun(workflowRunId);
  const step = detail.steps.filter((candidate) => candidate.stage === stage).at(-1) ?? null;
  if (!step) {
    return { stepRunId: null, stepCheckpointId: null, resumeCursor: null };
  }
  const checkpoint = detail.stepCheckpoints.find((candidate) => candidate.stepRunId === step.id) ?? null;
  return {
    stepRunId: step.id,
    stepCheckpointId: checkpoint?.id ?? null,
    resumeCursor: checkpoint?.resumeCursor ?? null,
  };
}

function upsertLocalGraphNodeRun(
  nodeRuns: GraphNodeRun[],
  next: GraphNodeRun,
): GraphNodeRun[] {
  const without = nodeRuns.filter((run) => run.id !== next.id);
  return [...without, next];
}

function completedGraphNodesInSlice(
  nodeRuns: readonly GraphNodeRun[],
  allowedNodeIds: readonly string[],
): number {
  const latest = latestNodeRunsByNode(nodeRuns);
  return allowedNodeIds.filter((id) => latest.get(id)?.status === 'passed').length;
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
