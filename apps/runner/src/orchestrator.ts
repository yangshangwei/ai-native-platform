import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import type { GateRun } from '@ainp/shared';
import { api } from './api-client';
import { runWhitelistedCommand } from './command-runner';
import { TrustedLocalWorktreeEnvironment } from './worktree';
import { DEFAULT_MAX_LOG_BYTES, DEFAULT_TIMEOUT_MS, WORKTREES_DIR } from './config';
import { sendHeartbeat } from './heartbeat';
import { findSkillForStage } from './skills';
import { NativeBackend } from './agents/native';

export interface OrchestrateOpts {
  project: string;
  title: string;
  /** Default true — auto-clean worktree at the end. */
  cleanup?: boolean;
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
export async function cmdOrchestrate(opts: OrchestrateOpts): Promise<void> {
  const { tools, runnerId } = await sendHeartbeat();
  console.log(`[runner] heartbeat from ${runnerId} (jdk=${tools.jdk}, mvn=${tools.maven})`);

  const project = await api.getProject(opts.project);
  const run = await api.createWorkflowRun({
    projectName: project.name,
    title: opts.title,
    type: 'feature',
  });
  console.log(`[runner] workflow-run ${run.id} created`);

  const env = new TrustedLocalWorktreeEnvironment({ id: project.id, localPath: project.localPath });
  const workspace = await env.prepare(run);
  await api.workspacePrepared({ workflowRunId: run.id, workspacePath: workspace.path });
  console.log(`[runner] workspace at ${workspace.path}`);

  const runArtifactsDir = join(ARTIFACTS_BASE, run.id);
  await mkdir(runArtifactsDir, { recursive: true });

  const backend = new NativeBackend();
  const inputs: Record<string, string> = { user_request: opts.title };
  let ok = true;

  try {
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
      const out = await backend.run(skill, {
        workflowRunId: run.id,
        workspacePath: workspace.path,
        branch: workspace.branch,
        title: opts.title,
        artifactsDir: stepArtifactsDir,
        inputs,
      });
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
      const changedFiles = (await Bun.file(namesOut.path).text())
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      inputs['diff'] = await Bun.file(diffOut.path).text();
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
      await api.stepFinished({ stepRunId: stepId, status: 'passed' });
      if (diffGate.gate.status === 'fail') {
        ok = false;
        throw new Error('diff_scope_gate failed; aborting');
      }
    }

    // 4. build_test — real mvn test inside the worktree
    {
      const command = 'mvn -B test';
      const { step } = await api.stepStarted({
        workflowRunId: run.id,
        stage: 'build_test',
        name: command,
      });
      const stepId = step.id;
      const logDir = join(WORKTREES_DIR, project.id, run.id, 'logs');
      const cr = await runWhitelistedCommand({
        workflowRunId: run.id,
        stepRunId: stepId,
        cwd: workspace.path,
        command,
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
        mavenCommand: command,
        compileCommandRunId: null,
        testCommandRunId: cr.id,
        reports,
      });
      console.log(`[runner]   build=${result.buildRun.status} test_gate=${result.testGate?.status ?? 'n/a'}`);
      const testOk = result.testGate?.status === 'pass';
      await api.stepFinished({ stepRunId: stepId, status: testOk ? 'passed' : 'failed' });
      if (!testOk) {
        ok = false;
        throw new Error('test_gate failed');
      }
    }

    // 5. review (artifact only; human acceptance follows)
    await runStage('review', 'other', null, { skipKindOverride: 'other' });

    // 6. acceptance — human approval
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
    if (!promoted) ok = false;
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

  if (!ok) process.exitCode = 1;

  // ---- helpers ----
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
    const result = await backend.run(skill, {
      workflowRunId: run.id,
      workspacePath: workspace.path,
      branch: workspace.branch,
      title: opts.title,
      artifactsDir: stepArtifactsDir,
      inputs,
    });
    for (const out of result.outputs) {
      const a = await api.postArtifact({
        workflowRunId: run.id,
        stepRunId: step.id,
        kind: artifactKind,
        uri: `file://${out.path}`,
        size: out.size,
        contentType: out.contentType,
        metadata: { skill: skill.id, output: out.name, stage },
      });
      inputs[out.name] = await Bun.file(out.path).text();
      console.log(`[runner] ${stage} artifact ${a.kind} -> ${a.uri}`);
    }
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
}

function mustSkill(stage: 'requirement' | 'design' | 'implementation' | 'review') {
  const s = findSkillForStage(stage);
  if (!s) throw new Error(`no skill for stage ${stage}`);
  return s;
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
