import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import type { AgentTaskKind, ArtifactKind, GateRun, SkillSpec } from '@ainp/shared';
import { api } from './api-client';
import { runWhitelistedCommand } from './command-runner';
import { TrustedLocalWorktreeEnvironment } from './worktree';
import { DEFAULT_MAX_LOG_BYTES, DEFAULT_TIMEOUT_MS, WORKTREES_DIR } from './config';
import { sendHeartbeat } from './heartbeat';
import { findSkillForStage } from './skills';
import { NativeBackend } from './agents/native';
import type { AgentBackend } from './agents/native';
import { ClaudeCodeBackend, claudeCliAvailable } from './agents/claude-code';
import { CodexBackend, codexCliAvailable } from './agents/codex';
import { generateProjectProfile } from './profile';
import {
  collectAcceptedKnowledge,
  persistKnowledgeCandidate,
  type KnowledgePromotionAction,
} from './knowledge';

export interface OrchestrateOpts {
  project: string;
  title: string;
  sourceBranch?: string;
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

/**
 * Drive the full 9-stage lifecycle end-to-end with the local NativeBackend.
 * The Workflow Engine on the API is the only state writer; the runner emits
 * events. Human gates pause the flow until /approvals records a decision.
 */
export async function cmdOrchestrate(opts: OrchestrateOpts): Promise<OrchestrateResult> {
  const { tools, runnerId } = await sendHeartbeat();
  console.log(`[runner] heartbeat from ${runnerId} (jdk=${tools.jdk}, mvn=${tools.maven})`);

  const project = await api.getProject(opts.project);
  const run = await api.createWorkflowRun({
    projectName: project.name,
    title: opts.title,
    type: 'feature',
    sourceBranch: opts.sourceBranch ?? project.defaultBranch,
  });
  console.log(`[runner] workflow-run ${run.id} created`);

  const env = new TrustedLocalWorktreeEnvironment(project);
  const workspace = await env.prepare(run);
  await api.workspacePrepared({ workflowRunId: run.id, workspacePath: workspace.path });
  console.log(`[runner] workspace at ${workspace.path}`);

  const runArtifactsDir = join(ARTIFACTS_BASE, run.id);
  await mkdir(runArtifactsDir, { recursive: true });

	  const backend = await pickBackend();
	  const inputs: Record<string, string> = { user_request: opts.title };
	  const inputArtifactIds: Record<string, string> = {};
	  let ok = true;

  try {
    // 0. context_pack — generate (or reuse) project profile + assemble Context Pack
    await runContextPack();

    // 1. requirement
    await runStage('requirement', 'requirement_draft', 'requirement_gate');

    // 2. design
    await runStage('design', 'design_doc', 'design_gate');

    // 3. implementation — writes files into the workspace, captures diff
    {
      const skill = mustSkill('implementation');
      const { step } = await api.stepStarted({
        workflowRunId: run.id,
        stage: 'implementation',
        name: skill.id,
      });
      const stepId = step.id;
      const stepArtifactsDir = join(runArtifactsDir, 'implementation');
	      const agent = await invokeSkill(skill, {
	        workflowRunId: run.id,
	        stepRunId: stepId,
	        workspacePath: workspace.path,
	        branch: workspace.branch,
	        title: opts.title,
	        artifactsDir: stepArtifactsDir,
	        inputs,
	      });
	      const out = { outputs: agent.outputs };
	      const diffOut = out.outputs.find((o) => o.name === 'diff');
	      const namesOut = out.outputs.find((o) => o.name === 'changed-files');
	      if (!diffOut || !namesOut) throw new Error('implementation: missing diff outputs');
	      const diffArtifact = await api.postArtifact({
        workflowRunId: run.id,
        stepRunId: stepId,
        kind: 'diff',
        uri: `file://${diffOut.path}`,
        size: diffOut.size,
        contentType: diffOut.contentType,
        metadata: { changedFilesPath: namesOut.path },
	      });
	      inputArtifactIds[diffOut.name] = diffArtifact.id;
	      const changedFiles = (await Bun.file(namesOut.path).text())
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
	      inputs['diff'] = await Bun.file(diffOut.path).text();
	      await finishAgentSuccess(agent.taskId, [diffArtifact.id], `implementation produced ${changedFiles.length} changed file(s)`);
	      console.log(`[runner] implementation diff artifact ${diffArtifact.id} (files=${changedFiles.length})`);

      const diffGate = await api.runGate({
        workflowRunId: run.id,
        stepRunId: stepId,
        gateId: 'diff_scope_gate',
        params: { changedFiles, allowedPrefixes: ['src/'] },
      });
      console.log(`[runner]   diff_scope_gate -> ${diffGate.gate.status}`);
      const sensGate = await api.runGate({
        workflowRunId: run.id,
        stepRunId: stepId,
        gateId: 'sensitive_change_gate',
        params: { changedFiles },
      });
      console.log(`[runner]   sensitive_change_gate -> ${sensGate.gate.status}`);
      if (diffGate.gate.status === 'fail') {
        ok = false;
        await api.stepFinished({ stepRunId: stepId, status: 'failed' });
        throw new Error('diff_scope_gate failed; aborting');
      }
      await enforceSensitiveChangeCheckpoint({
        workflowRunId: run.id,
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

    // 4. build_test — real mvn test inside the worktree
    {
	      const mvn = existsSync(join(workspace.path, 'mvnw')) ? './mvnw' : 'mvn';
	      const compileCommand = `${mvn} -B -DskipTests compile`;
	      const testCommand = `${mvn} -B test`;
	      const { step } = await api.stepStarted({
	        workflowRunId: run.id,
	        stage: 'build_test',
	        name: testCommand,
	      });
	      const stepId = step.id;
	      const logDir = join(WORKTREES_DIR, project.id, run.id, 'logs');
	      const compileCr = await runWhitelistedCommand({
	        workflowRunId: run.id,
	        stepRunId: stepId,
	        cwd: workspace.path,
	        command: compileCommand,
	        stage: 'compile',
	        timeoutMs: DEFAULT_TIMEOUT_MS,
	        maxLogBytes: DEFAULT_MAX_LOG_BYTES,
	        logDir,
	      });
	      await api.commandRun(compileCr);
	      console.log(`[runner] compile command ${compileCr.status} (exit=${compileCr.exitCode})`);
	      if (compileCr.status !== 'passed') {
	        ok = false;
	        await api.stepFinished({ stepRunId: stepId, status: 'failed' });
	        throw new Error('compile command failed');
	      }

	      const cr = await runWhitelistedCommand({
	        workflowRunId: run.id,
	        stepRunId: stepId,
	        cwd: workspace.path,
	        command: testCommand,
	        stage: 'test',
	        timeoutMs: DEFAULT_TIMEOUT_MS,
	        maxLogBytes: DEFAULT_MAX_LOG_BYTES,
        logDir,
      });
      await api.commandRun(cr);
      console.log(`[runner] build_test command ${cr.status} (exit=${cr.exitCode})`);

      const reports = await collectReports(workspace.path);
      const result = await api.mavenBuild({
	        workflowRunId: run.id,
	        stepRunId: stepId,
	        jdkVersion: tools.jdk,
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
        ok = false;
        throw new Error('test_gate failed');
      }
    }

	    // 5. review (artifact only; human acceptance follows)
	    await runStage('review', 'other', null, { skipKindOverride: 'other' });

	    // 6. acceptance — human approval
	    const acceptanceTraceGate = await api.runGate({
	      workflowRunId: run.id,
	      stepRunId: null,
	      gateId: 'acceptance_gate',
	    });
	    console.log(`[runner]   acceptance_traceability_gate -> ${acceptanceTraceGate.gate.status}`);
	    if (acceptanceTraceGate.gate.status === 'fail') {
	      ok = false;
	      throw new Error('acceptance traceability failed');
	    }
	    await api.awaitHuman({ workflowRunId: run.id, stage: 'review' });
    console.log(`[runner] awaiting acceptance_gate approval…`);
    const accepted = await awaitApproval(run.id, 'acceptance_gate');
    console.log(`[runner]   acceptance_gate -> ${accepted ? 'approved' : 'rejected'}`);
    if (!accepted) {
      ok = false;
      throw new Error('acceptance_gate rejected');
    }

    // 7. completion report
    await api.stageTransition({ workflowRunId: run.id, stage: 'completion' });
    const reportRes = await fetch(
      `${process.env.AINP_API_BASE ?? 'http://127.0.0.1:8787'}/workflow-runs/${run.id}/completion-report`,
      { method: 'POST' },
    );
    if (!reportRes.ok) throw new Error(`completion-report POST -> ${reportRes.status}`);
    const reportJson = (await reportRes.json()) as { artifact: { id: string; uri: string } };
    console.log(`[runner] completion_report -> ${reportJson.artifact.uri}`);

    // 8. knowledge candidate + manual gate
    await api.stageTransition({ workflowRunId: run.id, stage: 'knowledge' });
    const knowRes = await fetch(
      `${process.env.AINP_API_BASE ?? 'http://127.0.0.1:8787'}/workflow-runs/${run.id}/knowledge-candidate`,
      { method: 'POST' },
    );
    if (!knowRes.ok) throw new Error(`knowledge-candidate POST -> ${knowRes.status}`);
    const knowJson = (await knowRes.json()) as { artifact: { id: string; uri: string } };
    console.log(`[runner] knowledge_candidate -> ${knowJson.artifact.uri}`);

    await api.awaitHuman({ workflowRunId: run.id, stage: 'knowledge' });
    console.log(`[runner] awaiting knowledge_gate approval…`);
    const promoted = await awaitApproval(run.id, 'knowledge_gate');
    console.log(`[runner]   knowledge_gate -> ${promoted ? 'approved' : 'rejected'}`);
    if (!promoted) {
      ok = false;
    } else {
      const detail = await api.getWorkflowRun(run.id);
      const actions: KnowledgePromotionAction[] = detail.actions
        .filter((action) => action.kind === 'knowledge_suggestion_action')
        .map((action) => ({
          targetId: action.targetId,
          action: action.action,
          payload: action.payload,
        }));
      const stored = await persistKnowledgeCandidate({
        projectId: project.id,
        runId: run.id,
        candidateUri: knowJson.artifact.uri,
        actions,
      });
      if (stored) {
        console.log(`[runner] knowledge persisted -> ${stored}`);
      }
    }
  } catch (err) {
    ok = false;
    console.error('[runner] orchestration failed:', err instanceof Error ? err.message : err);
  } finally {
    await api.workflowCompleted({ workflowRunId: run.id, ok });
    if (opts.cleanup !== false) {
      await env.cleanup(workspace);
      console.log(`[runner] worktree removed: ${workspace.path}`);
    } else {
      console.log(`[runner] worktree kept at ${workspace.path}`);
    }
  }

  if (!ok && opts.setExitCode !== false) process.exitCode = 1;
  return { workflowRunId: run.id, ok };

  // ---- helpers ----
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
    const skill = findSkillForStage('context_pack');
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
	      await finishAgentSuccess(agent.taskId, artifactIds, `context_pack produced ${artifactIds.length} artifact(s)`);
	      await api.stepFinished({ stepRunId: stepId, status: 'passed' });
	    }

  async function runStage(
    stage: 'requirement' | 'design' | 'review',
    artifactKind: 'requirement_draft' | 'design_doc' | 'other',
    rulebasedGateId: GateRun['gateId'] | null,
    extra: { skipKindOverride?: 'other' } = {},
  ): Promise<void> {
    void extra;
    const skill = mustSkill(stage);
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
	      artifactIds.push(a.id);
	      console.log(`[runner] ${stage} artifact ${a.kind} -> ${a.uri}`);
	    }
	    await finishAgentSuccess(agent.taskId, artifactIds, `${stage} produced ${artifactIds.length} artifact(s)`);
	    await api.stepFinished({ stepRunId: step.id, status: 'passed' });

    if (rulebasedGateId) {
      const gateRes = await api.runGate({
        workflowRunId: run.id,
        stepRunId: step.id,
        gateId: rulebasedGateId,
      });
      console.log(`[runner]   ${rulebasedGateId} -> ${gateRes.gate.status}`);
      if (gateRes.gate.status === 'fail') {
        ok = false;
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
	        ok = false;
	        throw new Error(`${approverGateId} rejected`);
	      }
	    }
	  }

	  async function invokeSkill(
	    skill: SkillSpec,
	    ctx: Parameters<AgentBackend['run']>[1],
	  ): Promise<{ taskId: string; outputs: Awaited<ReturnType<AgentBackend['run']>>['outputs'] }> {
	    const task = await api.agentTaskStarted({
	      workflowRunId: ctx.workflowRunId,
	      stepRunId: ctx.stepRunId ?? null,
	      kind: taskKindForSkill(skill),
	      backend: backend.kind,
	      prompt: renderAgentPromptAudit(skill, ctx.inputs),
	      inputArtifactIds: skill.inputs
	        .map((i) => inputArtifactIds[i.name])
	        .filter((id): id is string => Boolean(id)),
	    });
	    try {
	      const result = await backend.run(skill, ctx);
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

function mustSkill(stage: 'requirement' | 'design' | 'implementation' | 'review') {
  const s = findSkillForStage(stage);
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
  timeoutMs = 5 * 60 * 1000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const decision = await api.findApproval(workflowRunId, gateId);
    if (decision) return decision === 'approved';
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error(`approval timeout for ${gateId} on ${workflowRunId}`);
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

/**
 * Choose an AgentBackend based on `AINP_AGENT_BACKEND`. Defaults to Native.
 *   - `native`      → deterministic stub (no LLM, e2e baseline)
 *   - `codex`       → spawn local `codex exec --json`; falls back to Native
 *                     when the binary is missing.
 *   - `claude_code` → spawn local `claude` CLI; falls back to Native with a
 *                     warning when the binary is missing or unauthenticated.
 */
async function pickBackend(): Promise<AgentBackend> {
  const choice = (process.env.AINP_AGENT_BACKEND ?? 'native').toLowerCase();
  if (choice === 'codex') {
    if (await codexCliAvailable()) {
      console.log(`[runner] backend = codex (bin=${process.env.AINP_CODEX_BIN ?? 'codex'})`);
      return new CodexBackend();
    }
    console.warn('[runner] AINP_AGENT_BACKEND=codex but `codex` CLI unavailable; falling back to native');
  }
  if (choice === 'claude_code') {
    if (await claudeCliAvailable()) {
      console.log(`[runner] backend = claude_code (bin=${process.env.AINP_CLAUDE_BIN ?? 'claude'})`);
      return new ClaudeCodeBackend();
    }
    console.warn('[runner] AINP_AGENT_BACKEND=claude_code but `claude` CLI unavailable; falling back to native');
  }
  if (choice !== 'native' && choice !== 'codex' && choice !== 'claude_code') {
    console.warn(`[runner] unknown AINP_AGENT_BACKEND=${choice}; falling back to native`);
  }
  console.log('[runner] backend = native');
  return new NativeBackend();
}
