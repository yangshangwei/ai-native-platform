import { join } from 'node:path';
import { api } from '../api-client';
import { runWhitelistedCommand } from '../command-runner';
import { TrustedLocalWorktreeEnvironment } from '../worktree';
import { DEFAULT_MAX_LOG_BYTES, DEFAULT_TIMEOUT_MS, WORKTREES_DIR } from '../config';
import { isWhitelisted, type CommandStage } from '@ainp/shared';
import { collectMavenReports } from '../reports';
import { sendHeartbeat } from '../heartbeat';

export interface RunOpts {
  project: string;
  command: string;
  title?: string;
  stage?: CommandStage;
  keepWorktree?: boolean;
}

/**
 * MVP orchestration:
 *   1. Heartbeat (populate runner record + tool versions).
 *   2. Resolve project, create WorkflowRun via API.
 *   3. Prepare git worktree on the run's branch.
 *   4. Notify API the workspace is ready.
 *   5. Open a build_test step.
 *   6. Run the whitelisted command, emit CommandRun.
 *   7. If it's an `mvn test`, scan Surefire reports and post a maven-build
 *      event so the API can synthesize BuildRun, TestRun, Artifact, plus
 *      run Compile + Test gates.
 *   8. Close the step + complete the workflow.
 *   9. Optionally cleanup worktree (default: clean up).
 */
export async function cmdRun(opts: RunOpts): Promise<void> {
  if (!isWhitelisted(opts.command)) {
    throw new Error(
      `command not on whitelist (see packages/shared/src/utils/whitelist.ts): ${opts.command}`,
    );
  }

  const { tools } = await sendHeartbeat();

  const project = await api.getProject(opts.project);
  const title = opts.title ?? `smoke ${opts.command}`;
  const run = await api.createWorkflowRun({ projectName: project.name, title });
  console.log(`[runner] workflow-run ${run.id} for project ${project.name} created`);

  const env = new TrustedLocalWorktreeEnvironment({ id: project.id, localPath: project.localPath });
  const workspace = await env.prepare(run);
  console.log(`[runner] worktree ready at ${workspace.path} (branch ${workspace.branch})`);
  await api.workspacePrepared({ workflowRunId: run.id, workspacePath: workspace.path });

  const { step } = await api.stepStarted({
    workflowRunId: run.id,
    stage: 'build_test',
    name: opts.command,
  });

  const logDir = join(WORKTREES_DIR, project.id, run.id, 'logs');
  let ok = false;
  try {
    const stage = opts.stage ?? inferStage(opts.command);
    const cr = await runWhitelistedCommand({
      workflowRunId: run.id,
      stepRunId: step.id,
      cwd: workspace.path,
      command: opts.command,
      stage,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxLogBytes: DEFAULT_MAX_LOG_BYTES,
      logDir,
    });
    await api.commandRun(cr);
    ok = cr.status === 'passed';
    console.log(
      `[runner] command ${cr.status} (exit=${cr.exitCode}, ${cr.durationMs}ms): ${cr.command}`,
    );
    console.log(`[runner]   stdout -> ${cr.stdoutRef}`);
    console.log(`[runner]   stderr -> ${cr.stderrRef}`);

    // If this is a Maven test command, ingest reports so the API can run
    // BuildRun + TestRun + Compile/Test gates from real evidence.
    if (stage === 'test' && opts.command.includes('test')) {
      const reports = await collectMavenReports(workspace.path);
      const reportPayload: Parameters<typeof api.mavenBuild>[0]['reports'] = [];
      if (reports.surefire) {
        reportPayload.push({
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
        reportPayload.push({
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
      const result = await api.mavenBuild({
        workflowRunId: run.id,
        stepRunId: step.id,
        jdkVersion: tools.jdk,
        mavenCommand: opts.command,
        compileCommandRunId: null,
        testCommandRunId: cr.id,
        reports: reportPayload,
      });
      console.log(
        `[runner] maven-build recorded: build=${result.buildRun.id} status=${result.buildRun.status}`,
      );
      if (result.compileGate) {
        console.log(`[runner]   compile_gate -> ${result.compileGate.status}`);
      }
      if (result.testGate) {
        console.log(`[runner]   test_gate    -> ${result.testGate.status}`);
        ok = ok && result.testGate.status === 'pass';
      }
    }

    await api.stepFinished({ stepRunId: step.id, status: ok ? 'passed' : 'failed' });
  } catch (err) {
    await api.stepFinished({ stepRunId: step.id, status: 'failed' });
    throw err;
  } finally {
    await api.workflowCompleted({ workflowRunId: run.id, ok });
    if (!opts.keepWorktree) {
      await env.cleanup(workspace);
      console.log(`[runner] worktree removed: ${workspace.path}`);
    } else {
      console.log(`[runner] worktree kept at ${workspace.path}`);
    }
  }

  if (!ok) process.exitCode = 1;
}

function inferStage(command: string): CommandStage {
  if (command.includes('test')) return 'test';
  if (command.includes('compile')) return 'compile';
  if (command.startsWith('git ')) return 'git';
  return 'other';
}
