#!/usr/bin/env bun
/**
 * Phase A verification: drive ONLY the requirement stage with claude_code
 * backend and run runRequirementGate against the real Claude output.
 *
 * Bypasses context_pack (which has its own issues unrelated to Phase A) by
 * passing a synthetic project_profile + empty accepted_knowledge — the latter
 * is important because prior NativeBackend runs accumulated knowledge that
 * confuses Claude about its current role.
 *
 * Prints per-rule pass/fail so we know exactly which cs-req gate rules need
 * regex tweaks vs. which prompt instructions need strengthening.
 */
import { resolve, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import {
  ClaudeCodeBackend,
  claudeCliAvailable,
} from '../apps/runner/src/agents/claude-code';
import { TrustedLocalWorktreeEnvironment } from '../apps/runner/src/worktree';
import { findSkillForStage } from '../apps/runner/src/skills';
import { api } from '../apps/runner/src/api-client';

const API_BASE = process.env.AINP_API_BASE ?? 'http://127.0.0.1:8787';
const SAMPLE_PATH = resolve(import.meta.dir, '..', 'examples', 'java-maven-sample');
const ARTIFACTS_BASE =
  process.env.AINP_ARTIFACTS_DIR ?? join(homedir(), '.ai-native', 'artifacts');

const REAL_TITLE = 'Add a divide(int,int) method to Calculator that throws on division by zero';

const SYNTHETIC_PROJECT_PROFILE = `# Project Profile (java-maven-sample)

- **Name**: java-maven-sample
- **Stack**: Java 1.8 + Maven 3.9 (single module)
- **Source**: \`src/main/java/sample/Calculator.java\`
  - Existing methods: \`add(int,int)\`, \`multiply(int,int)\`
  - No exception handling so far; methods are pure.
- **Tests**: \`src/test/java/sample/CalculatorTest.java\` — 3 JUnit 4 tests covering add and multiply.
- **Build**: \`mvn -B -DskipTests compile\` then \`mvn -B test\`.
`;

const SYNTHETIC_CONTEXT_PACK = `# Context Pack

User asked to add a \`divide(int,int)\` method to \`Calculator\`.

Relevant code references:
- \`src/main/java/sample/Calculator.java\` — the class to extend; follow the existing \`add\`/\`multiply\` shape.
- \`src/test/java/sample/CalculatorTest.java\` — where new tests for divide should live.

Constraints from prior knowledge:
- All existing methods take two \`int\` and return one \`int\`.
- No exceptions thrown by current code; division by zero must throw \`ArithmeticException\` per Java integer-division convention.
- No new dependencies; keep within the existing Maven setup.
`;

async function fail(msg: string): Promise<never> {
  console.error(`[smoke-req] FAIL: ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  console.log(`[smoke-req] API base: ${API_BASE}`);
  if (!(await claudeCliAvailable())) await fail('claude CLI not on PATH');
  if (!existsSync(SAMPLE_PATH)) await fail(`sample missing: ${SAMPLE_PATH}`);
  if (!existsSync(`${SAMPLE_PATH}/.git`)) await fail('sample has no .git');

  // 1. Register project (idempotent)
  const projectRes = await fetch(`${API_BASE}/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'claude-req-smoke', localPath: SAMPLE_PATH }),
  });
  const project = (await projectRes.json()) as { id: string; name: string };
  if (!project?.id) await fail('failed to register project');
  console.log(`[smoke-req] project ${project.id}`);

  // 2. Create workflow run with a REAL meaningful title
  const run = await api.createWorkflowRun({
    projectName: project.name,
    title: REAL_TITLE,
    type: 'feature',
  });
  console.log(`[smoke-req] run ${run.id} title="${REAL_TITLE}"`);

  // 3. Prepare worktree
  const env = new TrustedLocalWorktreeEnvironment(project);
  const workspace = await env.prepare(run);
  await api.workspacePrepared({ workflowRunId: run.id, workspacePath: workspace.path });

  // 4. Mark step started
  const skill = findSkillForStage('requirement');
  if (!skill) await fail('no requirement skill');
  const { step } = await api.stepStarted({
    workflowRunId: run.id,
    stage: 'requirement',
    name: 'claude-req-smoke',
  });
  const stageDir = join(ARTIFACTS_BASE, run.id, 'requirement');
  await mkdir(stageDir, { recursive: true });

  // 5. Invoke claude_code on requirement skill with synthetic inputs
  console.log(`[smoke-req] invoking claude_code on requirement stage…`);
  const backend = new ClaudeCodeBackend({ timeoutMs: 5 * 60 * 1000 });
  let claudeOk = true;
  let outputPath = '';
  try {
    const result = await backend.run(skill!, {
      workflowRunId: run.id,
      stepRunId: step.id,
      workspacePath: workspace.path,
      branch: workspace.branch,
      title: REAL_TITLE,
      artifactsDir: stageDir,
      inputs: {
        user_request: REAL_TITLE,
        'project_profile.md': SYNTHETIC_PROJECT_PROFILE,
        'context_pack.md': SYNTHETIC_CONTEXT_PACK,
        // Crucially: empty accepted_knowledge to avoid prior-run poisoning
        'accepted_knowledge.md': '',
      },
    });
    const reqOut = result.outputs.find((o) => o.name === 'requirement.md');
    if (!reqOut) await fail('claude did not produce requirement.md');
    outputPath = reqOut!.path;
    console.log(`[smoke-req] claude wrote ${reqOut!.size} bytes -> ${outputPath}`);
  } catch (err) {
    claudeOk = false;
    await fail(`claude backend failed: ${(err as Error).message}`);
  }

  // 6. Register the artifact so the gate can find it
  const artifact = await api.postArtifact({
    workflowRunId: run.id,
    stepRunId: step.id,
    kind: 'requirement_draft',
    uri: `file://${outputPath}`,
    size: readFileSync(outputPath).byteLength,
    contentType: 'text/markdown',
    metadata: { stage: 'requirement', source: 'claude-req-smoke' },
  });
  console.log(`[smoke-req] registered artifact ${artifact.id}`);

  // 7. Run requirement_gate — ALL 9 rules at once
  const gateRes = await api.runGate({
    workflowRunId: run.id,
    stepRunId: step.id,
    gateId: 'requirement_gate',
  });

  // 8. Print per-rule result + show what Claude actually wrote
  console.log('');
  console.log('===== REQUIREMENT GATE RESULTS =====');
  console.log(`Overall: ${gateRes.gate.status}`);
  for (const r of gateRes.gate.ruleResults) {
    const icon = r.status === 'pass' ? '✅' : r.status === 'warn' ? '⚠️' : '❌';
    console.log(`  ${icon} ${r.status.padEnd(5)} ${r.ruleId.padEnd(45)} | ${r.message}`);
  }
  console.log('');
  console.log('===== CLAUDE OUTPUT (first 80 lines) =====');
  const txt = readFileSync(outputPath, 'utf8');
  txt.split('\n').slice(0, 80).forEach((l, i) => console.log(`  ${String(i + 1).padStart(3)}| ${l}`));
  if (txt.split('\n').length > 80) console.log('  ... (truncated)');

  await api.stepFinished({ stepRunId: step.id, status: gateRes.gate.status === 'fail' ? 'failed' : 'passed' });
  await api.workflowCompleted({ workflowRunId: run.id, ok: gateRes.gate.status !== 'fail' });
  await env.cleanup(workspace);

  if (gateRes.gate.status === 'fail') {
    console.log('');
    console.log('[smoke-req] FAIL — see rule failures above; tweak prompt or regex.');
    process.exitCode = 1;
  } else {
    console.log('');
    console.log('[smoke-req] PASS — Phase A cs-req contract holds against real Claude.');
  }
}

await main();
