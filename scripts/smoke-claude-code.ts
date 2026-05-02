#!/usr/bin/env bun
/**
 * Minimal claude_code streaming smoke. One stage only (context_pack — read-only,
 * cheap). Validates: spawn → stream-json parse → POST /runner/events/agent-stream
 * → SSE broadcast. Run alongside `bun run dev:web` to see the live tail in the
 * browser, or follow `/agent-stream` with curl.
 *
 * Usage:
 *   bun run apps/api/src/server.ts &           # API on :8787
 *   bun run scripts/smoke-claude-code.ts       # this script
 *
 * Cost guard: a single context_pack call against the local sample is well
 * under $1. The script aborts if no API at AINP_API_BASE.
 */
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import {
  ClaudeCodeBackend,
  claudeCliAvailable,
} from '../apps/runner/src/agents/claude-code';
import { TrustedLocalWorktreeEnvironment } from '../apps/runner/src/worktree';
import { findSkillForStage } from '../apps/runner/src/skills';
import { generateProjectProfile } from '../apps/runner/src/profile';
import { collectAcceptedKnowledge } from '../apps/runner/src/knowledge';
import { api } from '../apps/runner/src/api-client';

const API_BASE = process.env.AINP_API_BASE ?? 'http://127.0.0.1:8787';
const SAMPLE_PATH = resolve(import.meta.dir, '..', 'examples', 'java-maven-sample');
const ARTIFACTS_BASE =
  process.env.AINP_ARTIFACTS_DIR ?? join(homedir(), '.ai-native', 'artifacts');

async function fail(msg: string): Promise<never> {
  console.error(`[smoke] FAIL: ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  console.log(`[smoke] API base: ${API_BASE}`);

  if (!(await claudeCliAvailable())) {
    await fail('claude CLI not found on PATH (set AINP_CLAUDE_BIN or install Claude Code)');
  }
  console.log('[smoke] claude CLI available');

  if (!existsSync(SAMPLE_PATH)) await fail(`sample missing: ${SAMPLE_PATH}`);
  if (!existsSync(`${SAMPLE_PATH}/.git`)) await fail(`sample has no .git — run \`git init\` first`);

  // Register / fetch project (idempotent)
  const project = await fetch(`${API_BASE}/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'claude-code-smoke', localPath: SAMPLE_PATH }),
  })
    .then((r) => r.json())
    .catch(() => null);
  if (!project || !project.id) await fail(`failed to register project`);
  console.log(`[smoke] project ${project.id} (${project.name})`);

  // Create a workflow run
  const run = await api.createWorkflowRun({
    projectName: project.name,
    title: `claude-code smoke ${new Date().toISOString()}`,
    type: 'smoke',
  });
  console.log(`[smoke] workflow run ${run.id}`);
  console.log('');
  console.log(`>> Open the live SSE tail in another terminal:`);
  console.log(`     curl -N ${API_BASE}/workflow-runs/${run.id}/agent-stream`);
  console.log(`>> Or open the Web UI and pick this run:`);
  console.log(`     http://127.0.0.1:5173/`);
  console.log('');

  // Prepare worktree
  const env = new TrustedLocalWorktreeEnvironment({
    id: project.id,
    localPath: project.localPath,
  });
  const workspace = await env.prepare(run);
  await api.workspacePrepared({ workflowRunId: run.id, workspacePath: workspace.path });
  console.log(`[smoke] workspace ${workspace.path}`);

  // Build context_pack skill inputs
  const profile = await generateProjectProfile({
    projectId: project.id,
    name: project.name,
    localPath: project.localPath,
    reuseIfPresent: true,
  });
  const accepted = await collectAcceptedKnowledge(project.id);

  const skill = findSkillForStage('context_pack');
  if (!skill) await fail('no context_pack skill found');

  const { step } = await api.stepStarted({
    workflowRunId: run.id,
    stage: 'context_pack',
    name: 'claude_code-smoke',
  });
  const stageDir = join(ARTIFACTS_BASE, run.id, 'context_pack');
  await mkdir(stageDir, { recursive: true });

  const backend = new ClaudeCodeBackend({ timeoutMs: 5 * 60 * 1000 });
  console.log(`[smoke] invoking claude_code backend on stage=context_pack…`);
  let ok = true;
  try {
    const result = await backend.run(skill!, {
      workflowRunId: run.id,
      stepRunId: step.id,
      workspacePath: workspace.path,
      branch: workspace.branch,
      title: run.title,
      artifactsDir: stageDir,
      inputs: {
        user_request: run.title,
        'project_profile.md': profile.markdown,
        'accepted_knowledge.md': accepted,
      },
    });
    console.log(`[smoke] backend produced ${result.outputs.length} output(s)`);
    for (const o of result.outputs) console.log(`   - ${o.name} (${o.size} bytes) -> ${o.path}`);
  } catch (err) {
    ok = false;
    console.error(`[smoke] backend failed: ${(err as Error).message}`);
  } finally {
    await api.stepFinished({ stepRunId: step.id, status: ok ? 'passed' : 'failed' });
    await api.workflowCompleted({ workflowRunId: run.id, ok });
    await env.cleanup(workspace);
  }

  if (!ok) process.exitCode = 1;
  console.log(`[smoke] DONE (run=${run.id})`);
}

await main();
