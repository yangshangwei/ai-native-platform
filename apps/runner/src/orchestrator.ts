import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import type {
  AgentTaskKind,
  ArtifactKind,
  FlowId,
  GateRun,
  Project,
  SkillSpec,
  StageStep,
  WorkflowRun,
  WorkflowRunType,
  WorkspaceRef,
} from '@ainp/shared';
import { api } from './api-client';
import { runWhitelistedCommand } from './command-runner';
import { TrustedLocalWorktreeEnvironment } from './worktree';
import { DEFAULT_MAX_LOG_BYTES, DEFAULT_TIMEOUT_MS, WORKTREES_DIR } from './config';
import { sendHeartbeat } from './heartbeat';
import { findSkillForStage } from './skills';
import type { AgentBackend } from './agents/native';
import { selectAgentBackend } from './backend-selection';
import { generateProjectProfile } from './profile';
import { FLOW_REGISTRY } from './flows/registry';
import {
  collectAcceptedKnowledge,
  persistKnowledgeCandidate,
  type KnowledgePromotionAction,
} from './knowledge';

export interface OrchestrateOpts {
  project: string;
  title: string;
  sourceBranch?: string;
  workflowRequestId?: string;
  /** Coordinator-decided run type. Defaults to 'feature' if omitted. */
  runType?: WorkflowRunType;
  /** Default true — auto-clean worktree at the end. */
  cleanup?: boolean;
  /** Default true for CLI mode; watch mode keeps the daemon alive on failed jobs. */
  setExitCode?: boolean;
}

export interface OrchestrateResult {
  workflowRunId: string;
  ok: boolean;
}

const ARTIFACTS_BASE = process.env.AINP_ARTIFACTS_DIR ?? join(homedir(), '.ai-native', 'artifacts');

const STAGE_TO_ARTIFACT_KIND = {
  requirement: 'requirement_draft',
  design: 'design_doc',
  review: 'other',
} as const;

// ---------------------------------------------------------------------------
// V2 W2-1 / PR3 — runWorkflow context shared across the extracted
// `executeXxx(ctx)` step implementations. File-private (PRD R14: not
// exported); ADR Q1=α (thin) means `kind` / `skillId` on each StageStep
// are populated but not read at runtime in this PR.
// ---------------------------------------------------------------------------

interface OkRef {
  /** Mutate to `false` to mark the run failed without throwing. Used by
   * `executeKnowledgePromotion` to honor V1 knowledge-gate rejection
   * behavior (reject sets ok but does NOT throw). */
  value: boolean;
}

interface RunCtx {
  project: Project;
  run: WorkflowRun;
  workspace: WorkspaceRef;
  backend: AgentBackend;
  /** Heartbeat tool versions; both fields are nullable when the runner
   * couldn't detect the tool on the host. */
  tools: { jdk: string | null; maven: string | null };
  opts: OrchestrateOpts;
  runArtifactsDir: string;
  inputs: Record<string, string>;
  inputArtifactIds: Record<string, string>;
  draftsToPromote: PromoteDraftInput[];
  ok: OkRef;
}

/**
 * Drive the full 8-stage lifecycle end-to-end with the project's real Agent
 * Backend. The Workflow Engine on the API is the only state writer; the
 * runner emits events. Human gates pause the flow until /approvals records
 * a decision.
 *
 * V2 W2-1 / PR3: stage iteration is now driven by
 * `FLOW_REGISTRY[run.flowId].stages` (see `./flows/registry.ts`). The five
 * V1 inline blocks (implementation, build_test, acceptance, completion,
 * knowledge) were extracted into `executeXxx(ctx)` named functions; the
 * existing `runContextPack` and `runStage` helpers are preserved unchanged.
 * Logic is byte-for-byte equivalent to V1 (PRD ADR Q1=α — thin refactor).
 */
export async function cmdOrchestrate(opts: OrchestrateOpts): Promise<OrchestrateResult> {
  const { tools, runnerId } = await sendHeartbeat();
  console.log(`[runner] heartbeat from ${runnerId} (jdk=${tools.jdk}, mvn=${tools.maven})`);

  const project = await api.getProject(opts.project);
  const backend = await selectAgentBackend(project);
  const run = await api.createWorkflowRun({
    projectName: project.name,
    title: opts.title,
    type: opts.runType ?? 'feature',
    sourceBranch: opts.sourceBranch ?? project.defaultBranch,
  });
  console.log(`[runner] workflow-run ${run.id} created (flow=${run.flowId})`);
  if (opts.workflowRequestId) {
    await api.workflowRequestRunStarted({
      requestId: opts.workflowRequestId,
      workflowRunId: run.id,
    });
  }

  const env = new TrustedLocalWorktreeEnvironment(project);
  const workspace = await env.prepare(run);
  await api.workspacePrepared({ workflowRunId: run.id, workspacePath: workspace.path });
  console.log(`[runner] workspace at ${workspace.path}`);

  const runArtifactsDir = join(ARTIFACTS_BASE, run.id);
  await mkdir(runArtifactsDir, { recursive: true });

  const inputs: Record<string, string> = { user_request: opts.title };
  const inputArtifactIds: Record<string, string> = {};
  /**
   * V2 P0-1 / PR3: drafts captured for promoteToKnowledge after acceptance.
   * Each entry is the markdown draft of a `requirement_draft` / `design_doc`
   * stage output. Promotion lifts the draft into a knowledge entity row
   * (REQ-### / DSN-###) on acceptance approval. ADR Q2 (2-beta).
   */
  const draftsToPromote: PromoteDraftInput[] = [];
  const ok: OkRef = { value: true };

  const ctx: RunCtx = {
    project,
    run,
    workspace,
    backend,
    tools,
    opts,
    runArtifactsDir,
    inputs,
    inputArtifactIds,
    draftsToPromote,
    ok,
  };

  const flow = FLOW_REGISTRY[run.flowId];
  if (!flow) {
    throw new Error(
      `unknown flowId in registry: ${String(run.flowId)} (run=${run.id})`,
    );
  }

  try {
    for (const step of flow.stages) {
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

  // ---- dispatcher --------------------------------------------------------
  // V2 W2-1 / PR3: single-point router from FLOW_REGISTRY stage to the
  // matching helper. The switch is exhaustive over `WorkflowStage`; the
  // `'init'` case is rejected explicitly because it is a status placeholder,
  // not a dispatched step (FLOW_REGISTRY for feature.standard does not
  // include it — see `./flows/registry.ts`). PRD R12.
  async function dispatchStep(step: StageStep, _ctx: RunCtx): Promise<void> {
    switch (step.stage) {
      case 'context_pack':
        await runContextPack();
        return;
      case 'requirement':
        await runStage('requirement', 'requirement_draft', 'requirement_gate');
        return;
      case 'design':
        await runStage('design', 'design_doc', 'design_gate');
        return;
      case 'implementation':
        await executeImplementation(_ctx);
        return;
      case 'build_test':
        await executeBuildTest(_ctx);
        return;
      case 'review':
        // V1 collapses human acceptance into the review step: the review
        // agent runs first, then `acceptance_gate` + `awaitHuman` +
        // approval poll + draft promotion run inline. WorkflowStage has no
        // `'acceptance'` value; that's why review owns both halves here.
        await runStage('review', 'other', null, { skipKindOverride: 'other' });
        await executeAcceptance(_ctx);
        return;
      case 'completion':
        await executeCompletion(_ctx);
        return;
      case 'knowledge':
        await executeKnowledgePromotion(_ctx);
        return;
      case 'init':
        throw new Error(`'init' is not a dispatchable stage (status placeholder only)`);
      default: {
        const _exhaustive: never = step.stage;
        throw new Error(`unknown stage: ${String(_exhaustive)}`);
      }
    }
  }

  // ---- step implementations (PRD R12: extracted from V1 inline blocks) ---
  // Each `executeXxx(c)` is a 1:1 lift of the matching V1 inline block.
  // `kind` / `skillId` from StageStep are NOT read here in W2-1=α; W2-3
  // begins consuming them through a generic dispatcher.

  async function executeImplementation(c: RunCtx): Promise<void> {
    const skill = await mustSkill('implementation');
    const { step } = await api.stepStarted({
      workflowRunId: c.run.id,
      stage: 'implementation',
      name: skill.id,
    });
    const stepId = step.id;
    const stepArtifactsDir = join(c.runArtifactsDir, 'implementation');
    const agent = await invokeSkill(skill, {
      workflowRunId: c.run.id,
      stepRunId: stepId,
      workspacePath: c.workspace.path,
      branch: c.workspace.branch,
      title: c.opts.title,
      artifactsDir: stepArtifactsDir,
      inputs: c.inputs,
    });
    const out = { outputs: agent.outputs };
    const diffOut = out.outputs.find((o) => o.name === 'diff');
    const namesOut = out.outputs.find((o) => o.name === 'changed-files');
    if (!diffOut || !namesOut) throw new Error('implementation: missing diff outputs');
    const diffArtifact = await api.postArtifact({
      workflowRunId: c.run.id,
      stepRunId: stepId,
      kind: 'diff',
      uri: `file://${diffOut.path}`,
      size: diffOut.size,
      contentType: diffOut.contentType,
      metadata: { changedFilesPath: namesOut.path },
    });
    c.inputArtifactIds[diffOut.name] = diffArtifact.id;
    const changedFiles = (await Bun.file(namesOut.path).text())
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    c.inputs['diff'] = await Bun.file(diffOut.path).text();
    await finishAgentSuccess(
      agent.taskId,
      [diffArtifact.id],
      `implementation produced ${changedFiles.length} changed file(s)`,
    );
    console.log(
      `[runner] implementation diff artifact ${diffArtifact.id} (files=${changedFiles.length})`,
    );

    const diffGate = await api.runGate({
      workflowRunId: c.run.id,
      stepRunId: stepId,
      gateId: 'diff_scope_gate',
      params: { changedFiles, allowedPrefixes: ['src/'] },
    });
    console.log(`[runner]   diff_scope_gate -> ${diffGate.gate.status}`);
    const sensGate = await api.runGate({
      workflowRunId: c.run.id,
      stepRunId: stepId,
      gateId: 'sensitive_change_gate',
      params: { changedFiles },
    });
    console.log(`[runner]   sensitive_change_gate -> ${sensGate.gate.status}`);
    if (diffGate.gate.status === 'fail') {
      c.ok.value = false;
      await api.stepFinished({ stepRunId: stepId, status: 'failed' });
      throw new Error('diff_scope_gate failed; aborting');
    }
    await enforceSensitiveChangeCheckpoint({
      workflowRunId: c.run.id,
      stepRunId: stepId,
      gate: sensGate.gate,
      deps: {
        awaitHuman: api.awaitHuman,
        stepFinished: api.stepFinished,
        awaitApproval,
      },
    });
    await api.stepFinished({ stepRunId: stepId, status: 'passed' });
  }

  async function executeBuildTest(c: RunCtx): Promise<void> {
    const mvn = existsSync(join(c.workspace.path, 'mvnw')) ? './mvnw' : 'mvn';
    const compileCommand = `${mvn} -B -DskipTests compile`;
    const testCommand = `${mvn} -B test`;
    const { step } = await api.stepStarted({
      workflowRunId: c.run.id,
      stage: 'build_test',
      name: testCommand,
    });
    const stepId = step.id;
    const logDir = join(WORKTREES_DIR, c.project.id, c.run.id, 'logs');
    const compileCr = await runWhitelistedCommand({
      workflowRunId: c.run.id,
      stepRunId: stepId,
      cwd: c.workspace.path,
      command: compileCommand,
      stage: 'compile',
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxLogBytes: DEFAULT_MAX_LOG_BYTES,
      logDir,
    });
    await api.commandRun(compileCr);
    console.log(`[runner] compile command ${compileCr.status} (exit=${compileCr.exitCode})`);
    if (compileCr.status !== 'passed') {
      c.ok.value = false;
      await api.stepFinished({ stepRunId: stepId, status: 'failed' });
      throw new Error('compile command failed');
    }

    const cr = await runWhitelistedCommand({
      workflowRunId: c.run.id,
      stepRunId: stepId,
      cwd: c.workspace.path,
      command: testCommand,
      stage: 'test',
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxLogBytes: DEFAULT_MAX_LOG_BYTES,
      logDir,
    });
    await api.commandRun(cr);
    console.log(`[runner] build_test command ${cr.status} (exit=${cr.exitCode})`);

    const reports = await collectReports(c.workspace.path);
    const result = await api.mavenBuild({
      workflowRunId: c.run.id,
      stepRunId: stepId,
      jdkVersion: c.tools.jdk,
      mavenCommand: `${compileCommand} && ${testCommand}`,
      compileCommandRunId: compileCr.id,
      testCommandRunId: cr.id,
      reports,
    });
    console.log(
      `[runner]   build=${result.buildRun.status} compile_gate=${result.compileGate?.status ?? 'n/a'} test_gate=${result.testGate?.status ?? 'n/a'}`,
    );
    const testOk = result.compileGate?.status === 'pass' && result.testGate?.status === 'pass';
    await api.stepFinished({ stepRunId: stepId, status: testOk ? 'passed' : 'failed' });
    if (!testOk) {
      c.ok.value = false;
      throw new Error('test_gate failed');
    }
  }

  async function executeAcceptance(c: RunCtx): Promise<void> {
    const acceptanceTraceGate = await api.runGate({
      workflowRunId: c.run.id,
      stepRunId: null,
      gateId: 'acceptance_gate',
    });
    console.log(`[runner]   acceptance_traceability_gate -> ${acceptanceTraceGate.gate.status}`);
    if (acceptanceTraceGate.gate.status === 'fail') {
      c.ok.value = false;
      throw new Error('acceptance traceability failed');
    }
    await api.awaitHuman({ workflowRunId: c.run.id, stage: 'review' });
    console.log(`[runner] awaiting acceptance_gate approval…`);
    const accepted = await awaitApproval(c.run.id, 'acceptance_gate');
    console.log(`[runner]   acceptance_gate -> ${accepted ? 'approved' : 'rejected'}`);
    if (!accepted) {
      c.ok.value = false;
      throw new Error('acceptance_gate rejected');
    }

    // V2 P0-1 / PR3: promote accepted requirement / design drafts to knowledge
    // entities. Failure inside the helper is logged but never thrown — R18.
    for (const draft of c.draftsToPromote) {
      await promoteAcceptedDraftToKnowledge(c.project.id, draft);
    }
  }

  async function executeCompletion(c: RunCtx): Promise<void> {
    await api.stageTransition({ workflowRunId: c.run.id, stage: 'completion' });
    const reportRes = await fetch(
      `${process.env.AINP_API_BASE ?? 'http://127.0.0.1:8787'}/workflow-runs/${c.run.id}/completion-report`,
      { method: 'POST' },
    );
    if (!reportRes.ok) throw new Error(`completion-report POST -> ${reportRes.status}`);
    const reportJson = (await reportRes.json()) as { artifact: { id: string; uri: string } };
    console.log(`[runner] completion_report -> ${reportJson.artifact.uri}`);
  }

  async function executeKnowledgePromotion(c: RunCtx): Promise<void> {
    await api.stageTransition({ workflowRunId: c.run.id, stage: 'knowledge' });
    const knowRes = await fetch(
      `${process.env.AINP_API_BASE ?? 'http://127.0.0.1:8787'}/workflow-runs/${c.run.id}/knowledge-candidate`,
      { method: 'POST' },
    );
    if (!knowRes.ok) throw new Error(`knowledge-candidate POST -> ${knowRes.status}`);
    const knowJson = (await knowRes.json()) as { artifact: { id: string; uri: string } };
    console.log(`[runner] knowledge_candidate -> ${knowJson.artifact.uri}`);

    await api.awaitHuman({ workflowRunId: c.run.id, stage: 'knowledge' });
    console.log(`[runner] awaiting knowledge_gate approval…`);
    const promoted = await awaitApproval(c.run.id, 'knowledge_gate');
    console.log(`[runner]   knowledge_gate -> ${promoted ? 'approved' : 'rejected'}`);
    if (!promoted) {
      // V1 quirk: knowledge gate rejection sets ok but does NOT throw —
      // the run cleanly proceeds through `finally` and reports failure.
      c.ok.value = false;
    } else {
      const detail = await api.getWorkflowRun(c.run.id);
      const actions: KnowledgePromotionAction[] = detail.actions
        .filter((action) => action.kind === 'knowledge_suggestion_action')
        .map((action) => ({
          targetId: action.targetId,
          action: action.action,
          payload: action.payload,
        }));
      const stored = await persistKnowledgeCandidate({
        projectId: c.project.id,
        runId: c.run.id,
        candidateUri: knowJson.artifact.uri,
        actions,
      });
      if (stored) {
        console.log(`[runner] knowledge persisted -> ${stored}`);
      }
    }
  }

  // ---- existing helpers (PRD ADR Q1=α: kept unchanged) -------------------

  async function runContextPack(): Promise<void> {
    // a. project profile (lazy: scan once and reuse on subsequent runs).
    const profileResult = await generateProjectProfile({
      projectId: project.id,
      name: project.name,
      localPath: project.localPath,
      reuseIfPresent: true,
    });

    const { step } = await api.stepStarted({
      workflowRunId: run.id,
      stage: 'context_pack',
      name: 'context_pack',
    });
    const stepId = step.id;
    const stageArtifactsDir = join(runArtifactsDir, 'context_pack');
    await mkdir(stageArtifactsDir, { recursive: true });

    const profileArtifact = await api.postArtifact({
      workflowRunId: run.id,
      stepRunId: stepId,
      kind: 'project_profile',
      uri: `file://${profileResult.profileMdPath}`,
      size: Buffer.byteLength(profileResult.markdown, 'utf8'),
      contentType: 'text/markdown',
      metadata: {
        projectId: project.id,
        projectName: project.name,
        generatedAt: profileResult.profile.generatedAt,
      },
    });
    inputs['project_profile.md'] = profileResult.markdown;
    inputArtifactIds['project_profile.md'] = profileArtifact.id;
    console.log(`[runner] project_profile artifact ${profileArtifact.id}`);

    // b. accepted knowledge from prior runs (knowledge → context loop).
    const acceptedKnowledge = await collectAcceptedKnowledge(project.id);
    inputs['accepted_knowledge.md'] = acceptedKnowledge;
    if (acceptedKnowledge) {
      console.log(`[runner] accepted_knowledge: ${acceptedKnowledge.length} bytes`);
    }

    // c. run the Context Pack skill.
    const skill = await findSkillForStage('context_pack');
    if (!skill) throw new Error('no skill for stage context_pack');
    const agent = await invokeSkill(skill, {
      workflowRunId: run.id,
      stepRunId: stepId,
      workspacePath: workspace.path,
      branch: workspace.branch,
      title: opts.title,
      artifactsDir: stageArtifactsDir,
      inputs,
    });
    const artifactIds: string[] = [];
    for (const out of agent.outputs) {
      const a = await api.postArtifact({
        workflowRunId: run.id,
        stepRunId: stepId,
        kind: 'context_pack',
        uri: `file://${out.path}`,
        size: out.size,
        contentType: out.contentType,
        metadata: { skill: skill.id, output: out.name, stage: 'context_pack' },
      });
      inputs[out.name] = await Bun.file(out.path).text();
      inputArtifactIds[out.name] = a.id;
      artifactIds.push(a.id);
      console.log(`[runner] context_pack artifact ${a.id} (${out.name})`);
    }
    await finishAgentSuccess(
      agent.taskId,
      artifactIds,
      `context_pack produced ${artifactIds.length} artifact(s)`,
    );
    await api.stepFinished({ stepRunId: stepId, status: 'passed' });
  }

  async function runStage(
    stage: 'requirement' | 'design' | 'review',
    artifactKind: 'requirement_draft' | 'design_doc' | 'other',
    rulebasedGateId: GateRun['gateId'] | null,
    extra: { skipKindOverride?: 'other' } = {},
  ): Promise<void> {
    void extra;
    const skill = await mustSkill(stage);
    const { step } = await api.stepStarted({
      workflowRunId: run.id,
      stage,
      name: skill.id,
    });
    const stepArtifactsDir = join(runArtifactsDir, stage);
    const agent = await invokeSkill(skill, {
      workflowRunId: run.id,
      stepRunId: step.id,
      workspacePath: workspace.path,
      branch: workspace.branch,
      title: opts.title,
      artifactsDir: stepArtifactsDir,
      inputs,
    });
    const artifactIds: string[] = [];
    for (const out of agent.outputs) {
      const text = await Bun.file(out.path).text();
      const kind = artifactKindForStageOutput(stage, artifactKind, out.name);
      const metadata = metadataForStageOutput(skill.id, stage, out.name, out.contentType, text);
      const a = await api.postArtifact({
        workflowRunId: run.id,
        stepRunId: step.id,
        kind,
        uri: `file://${out.path}`,
        size: out.size,
        contentType: out.contentType,
        metadata,
      });
      inputs[out.name] = text;
      inputArtifactIds[out.name] = a.id;
      // V2 P0-1 / PR3: track requirement / design drafts for post-acceptance promotion.
      if (kind === 'requirement_draft' || kind === 'design_doc') {
        draftsToPromote.push({
          artifactId: a.id,
          kind,
          uri: `file://${out.path}`,
          size: out.size,
          contentType: out.contentType,
          text,
        });
      }
      artifactIds.push(a.id);
      console.log(`[runner] ${stage} artifact ${a.kind} -> ${a.uri}`);
    }
    await finishAgentSuccess(
      agent.taskId,
      artifactIds,
      `${stage} produced ${artifactIds.length} artifact(s)`,
    );
    await api.stepFinished({ stepRunId: step.id, status: 'passed' });

    if (rulebasedGateId) {
      const gateRes = await api.runGate({
        workflowRunId: run.id,
        stepRunId: step.id,
        gateId: rulebasedGateId,
      });
      console.log(`[runner]   ${rulebasedGateId} -> ${gateRes.gate.status}`);
      if (gateRes.gate.status === 'fail') {
        ok.value = false;
        throw new Error(`${rulebasedGateId} failed`);
      }
      // Pause for human approval after the rule-based gate passes.
      await api.awaitHuman({ workflowRunId: run.id, stage });
      console.log(`[runner] awaiting ${stage} approval…`);
      const approverGateId =
        stage === 'requirement'
          ? 'requirement_gate'
          : stage === 'design'
            ? 'design_gate'
            : 'acceptance_gate';
      const approved = await awaitApproval(run.id, approverGateId);
      console.log(`[runner]   ${approverGateId} -> ${approved ? 'approved' : 'rejected'}`);
      if (!approved) {
        ok.value = false;
        throw new Error(`${approverGateId} rejected`);
      }
    }
  }

  async function invokeSkill(
    skill: SkillSpec,
    skillCtx: Parameters<AgentBackend['run']>[1],
  ): Promise<{ taskId: string; outputs: Awaited<ReturnType<AgentBackend['run']>>['outputs'] }> {
    const task = await api.agentTaskStarted({
      workflowRunId: skillCtx.workflowRunId,
      stepRunId: skillCtx.stepRunId ?? null,
      kind: taskKindForSkill(skill),
      backend: backend.kind,
      prompt: renderAgentPromptAudit(skill, skillCtx.inputs),
      inputArtifactIds: skill.inputs
        .map((i) => inputArtifactIds[i.name])
        .filter((id): id is string => Boolean(id)),
    });
    try {
      const result = await backend.run(skill, skillCtx);
      return { taskId: task.task.id, outputs: result.outputs };
    } catch (err) {
      await api.agentTaskFinished({
        taskId: task.task.id,
        status: 'failed',
        summary: err instanceof Error ? err.message : String(err),
        outputArtifactIds: [],
      });
      throw err;
    }
  }

  async function finishAgentSuccess(
    taskId: string,
    outputArtifactIds: string[],
    summary: string,
  ): Promise<void> {
    await api.agentTaskFinished({
      taskId,
      status: 'success',
      summary,
      outputArtifactIds,
    });
  }
}

async function mustSkill(stage: 'requirement' | 'design' | 'implementation' | 'review') {
  const s = await findSkillForStage(stage);
  if (!s) throw new Error(`no skill for stage ${stage}`);
  return s;
}

function artifactKindForStageOutput(
  stage: 'requirement' | 'design' | 'review',
  fallback: ArtifactKind,
  outputName: string,
): ArtifactKind {
  if (outputName === 'traceability.json') return 'traceability';
  if (stage === 'requirement') return 'requirement_draft';
  if (stage === 'design') return 'design_doc';
  return fallback;
}

function metadataForStageOutput(
  skillId: string,
  stage: 'requirement' | 'design' | 'review',
  outputName: string,
  contentType: string,
  text: string,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = { skill: skillId, output: outputName, stage };
  const isJson = contentType === 'application/json' || outputName.endsWith('.json');
  if (!isJson) return metadata;

  metadata.structured = true;
  const schemaVersion = safeJsonSchemaVersion(text);
  if (schemaVersion) metadata.schemaVersion = schemaVersion;
  return metadata;
}

function safeJsonSchemaVersion(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as { schemaVersion?: unknown };
    return typeof parsed.schemaVersion === 'string' ? parsed.schemaVersion : null;
  } catch {
    return null;
  }
}

async function collectReports(
  workspacePath: string,
): Promise<Parameters<typeof api.mavenBuild>[0]['reports']> {
  const { collectMavenReports } = await import('./reports');
  const reports = await collectMavenReports(workspacePath);
  const out: Parameters<typeof api.mavenBuild>[0]['reports'] = [];
  if (reports.surefire) {
    out.push({
      framework: 'maven-surefire',
      reportFiles: reports.surefire.reportPaths.map((p) => `file://${p}`),
      aggregate: {
        total: reports.surefire.total,
        passed: reports.surefire.passed,
        failed: reports.surefire.failed,
        skipped: reports.surefire.skipped,
        errors: reports.surefire.errors,
      },
    });
  }
  if (reports.failsafe) {
    out.push({
      framework: 'maven-failsafe',
      reportFiles: reports.failsafe.reportPaths.map((p) => `file://${p}`),
      aggregate: {
        total: reports.failsafe.total,
        passed: reports.failsafe.passed,
        failed: reports.failsafe.failed,
        skipped: reports.failsafe.skipped,
        errors: reports.failsafe.errors,
      },
    });
  }
  return out;
}

async function awaitApproval(
  workflowRunId: string,
  gateId: GateRun['gateId'],
): Promise<boolean> {
  return waitForApprovalDecision({
    workflowRunId,
    gateId,
    findApproval: api.findApproval,
    sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
    timeoutMs: approvalTimeoutMsFromEnv(),
  });
}

export async function waitForApprovalDecision(params: {
  workflowRunId: string;
  gateId: GateRun['gateId'];
  findApproval(workflowRunId: string, gateId: GateRun['gateId']): Promise<'approved' | 'rejected' | null>;
  sleep(ms: number): Promise<void>;
  timeoutMs?: number | null;
  pollMs?: number;
}): Promise<boolean> {
  const startedAt = Date.now();
  const pollMs = params.pollMs ?? 500;
  while (params.timeoutMs == null || Date.now() - startedAt < params.timeoutMs) {
    const decision = await params.findApproval(params.workflowRunId, params.gateId);
    if (decision) return decision === 'approved';
    await params.sleep(pollMs);
  }
  throw new Error(`approval timeout for ${params.gateId} on ${params.workflowRunId}`);
}

function approvalTimeoutMsFromEnv(): number | null {
  const raw = process.env.AINP_APPROVAL_TIMEOUT_MS;
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export interface SensitiveChangeCheckpointDeps {
  awaitHuman(params: { workflowRunId: string; stage: 'implementation' }): Promise<unknown>;
  stepFinished(params: {
    stepRunId: string;
    status: 'passed' | 'failed' | 'cancelled' | 'skipped';
  }): Promise<unknown>;
  awaitApproval(workflowRunId: string, gateId: 'sensitive_change_gate'): Promise<boolean>;
}

export async function enforceSensitiveChangeCheckpoint(params: {
  workflowRunId: string;
  stepRunId: string;
  gate: Pick<GateRun, 'status'>;
  deps: SensitiveChangeCheckpointDeps;
}): Promise<void> {
  if (params.gate.status !== 'warn') return;

  await params.deps.awaitHuman({
    workflowRunId: params.workflowRunId,
    stage: 'implementation',
  });
  console.log('[runner] awaiting sensitive_change_gate approval…');
  const approved = await params.deps.awaitApproval(params.workflowRunId, 'sensitive_change_gate');
  console.log(`[runner]   sensitive_change_gate -> ${approved ? 'approved' : 'rejected'}`);
  if (!approved) {
    await params.deps.stepFinished({ stepRunId: params.stepRunId, status: 'failed' });
    throw new Error('sensitive_change_gate rejected');
  }
}

function taskKindForSkill(skill: SkillSpec): AgentTaskKind {
  switch (skill.stage) {
    case 'context_pack':
      return 'context_pack';
    case 'requirement':
      return 'requirement_draft';
    case 'design':
      return 'design_draft';
    case 'implementation':
      return 'implementation';
    case 'review':
      return 'review';
    default:
      return 'noop';
  }
}

function renderAgentPromptAudit(skill: SkillSpec, inputs: Record<string, string>): string {
  const inputNames = Object.keys(inputs).sort();
  return [
    `Skill: ${skill.id}@${skill.version}`,
    `Stage: ${skill.stage}`,
    '',
    skill.instructions,
    '',
    `Inputs: ${inputNames.join(', ') || '(none)'}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// V2 P0-2 / PR5: promoteAcceptedDraftToKnowledge (thin HTTP wrapper)
//
// After acceptance_gate passes, lift each requirement_draft / design_doc into
// a knowledge entity (REQ-### / DSN-###). The entire algorithm (entity_id
// resolution, version bump, supersede prior accepted, INSERT
// knowledge_artifacts, UPSERT entity head) lives server-side in a single
// `db.transaction(...)` per Q5=5-A — see `apps/api/src/promote.ts`.
//
// This wrapper just maps `PromoteDraftInput` → `PromoteRequest`, calls
// `api.promoteDraft`, and downgrades failures to a log line so the
// acceptance gate is never broken (R12 / R28).
// ---------------------------------------------------------------------------

export interface PromoteDraftInput {
  artifactId: string;
  kind: 'requirement_draft' | 'design_doc';
  uri: string;
  size: number;
  contentType: string;
  /** Full markdown body of the draft (forwarded as-is to the API). */
  text: string;
}

export interface PromoteDeps {
  promoteDraft: typeof api.promoteDraft;
  log?: (msg: string) => void;
  errorLog?: (msg: string) => void;
}

export async function promoteAcceptedDraftToKnowledge(
  projectId: string,
  draft: PromoteDraftInput,
  deps: PromoteDeps = { promoteDraft: api.promoteDraft },
): Promise<void> {
  const log = deps.log ?? ((m) => console.log(m));
  const errorLog = deps.errorLog ?? ((m) => console.error(m));
  try {
    const result = await deps.promoteDraft({
      projectId,
      kind: draft.kind,
      draftArtifactId: draft.artifactId,
      draftText: draft.text,
      uri: draft.uri,
      size: draft.size,
      contentType: draft.contentType,
    });
    log(
      `[runner] promoted ${draft.kind} ${draft.artifactId} -> ${result.entityKind} ${result.entityId} v${result.version} (id=${result.knowledgeArtifactId})`,
    );
  } catch (err) {
    // R12 / R28: failure MUST be downgraded — never break acceptance gate.
    errorLog(
      `[runner] promoteAcceptedDraftToKnowledge failed for ${draft.kind} ${draft.artifactId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
