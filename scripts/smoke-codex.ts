#!/usr/bin/env bun
/**
 * Minimal CodexBackend smoke. One read-only-ish context_pack stage validates:
 * codex CLI availability → `codex exec --json` streaming parse → artifact
 * production → API stream ingest.
 *
 * Usage:
 *   bun run apps/api/src/server.ts &
 *   bun run scripts/smoke-codex.ts
 */

import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { CodexBackend, codexCliAvailable } from '../apps/runner/src/agents/codex';
import { TrustedLocalWorktreeEnvironment } from '../apps/runner/src/worktree';
import { findSkillForStage } from '../apps/runner/src/skills';
import { generateProjectProfile } from '../apps/runner/src/profile';
import { collectAcceptedKnowledge } from '../apps/runner/src/knowledge';
import { api } from '../apps/runner/src/api-client';

const API_BASE = process.env.AINP_API_BASE ?? 'http://127.0.0.1:8787';
const SAMPLE_PATH = resolve(import.meta.dir, '..', 'examples', 'java-maven-sample');
const ARTIFACTS_BASE =
  process.env.AINP_ARTIFACTS_DIR ?? join(homedir(), '.ai-native', 'artifacts');

function fail(msg: string): never {
  console.error(`[smoke-codex] FAIL: ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  console.log(`[smoke-codex] API base: ${API_BASE}`);

  if (!(await codexCliAvailable())) {
    fail('codex CLI not found on PATH (set AINP_CODEX_BIN or install Codex CLI)');
  }
  if (!existsSync(SAMPLE_PATH)) fail(`sample missing: ${SAMPLE_PATH}`);
  if (!existsSync(`${SAMPLE_PATH}/.git`)) fail(`sample has no .git — run \`git init\` first`);

  const project = await fetch(`${API_BASE}/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'codex-smoke', localPath: SAMPLE_PATH }),
  })
    .then((r) => r.json())
    .catch(() => null);
  if (!project?.id) fail('failed to register project');

  const run = await api.createWorkflowRun({
    projectName: project.name,
    title: `codex smoke ${new Date().toISOString()}`,
    type: 'smoke',
  });
  console.log(`[smoke-codex] workflow run ${run.id}`);
  console.log(`curl -N ${API_BASE}/workflow-runs/${run.id}/agent-stream`);

  const env = new TrustedLocalWorktreeEnvironment({ id: project.id, localPath: project.localPath });
  const workspace = await env.prepare(run);
  await api.workspacePrepared({ workflowRunId: run.id, workspacePath: workspace.path });

  const profile = await generateProjectProfile({
    projectId: project.id,
    name: project.name,
    localPath: project.localPath,
    reuseIfPresent: true,
  });
  const accepted = await collectAcceptedKnowledge(project.id);
  const skill = findSkillForStage('context_pack');
  if (!skill) fail('no context_pack skill found');

  const { step } = await api.stepStarted({
    workflowRunId: run.id,
    stage: 'context_pack',
    name: 'codex-smoke',
  });
  const stageDir = join(ARTIFACTS_BASE, run.id, 'context_pack');
  await mkdir(stageDir, { recursive: true });

  const backend = new CodexBackend({ timeoutMs: 5 * 60 * 1000 });
  let ok = true;
  try {
    const result = await backend.run(skill, {
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
    console.log(`[smoke-codex] backend produced ${result.outputs.length} output(s)`);
    for (const o of result.outputs) console.log(`   - ${o.name} (${o.size} bytes) -> ${o.path}`);
  } catch (err) {
    ok = false;
    console.error(`[smoke-codex] backend failed: ${(err as Error).message}`);
  } finally {
    await api.stepFinished({ stepRunId: step.id, status: ok ? 'passed' : 'failed' });
    await api.workflowCompleted({ workflowRunId: run.id, ok });
    await env.cleanup(workspace);
  }

  if (!ok) process.exitCode = 1;
  console.log(`[smoke-codex] DONE (run=${run.id})`);
}

await main();
