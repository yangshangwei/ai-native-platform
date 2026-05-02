import { mkdtempSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, expect, test } from 'vitest';
import { newId, nowIso, type Project } from '@ainp/shared';

process.env.AINP_DB_PATH = join(mkdtempSync(join(tmpdir(), 'ainp-sensitive-route-')), 'ainp.sqlite');

let app: Awaited<typeof import('../src/app')>['app'];
let workflow: typeof import('../src/workflow-engine');
let storeMod: typeof import('../src/store/store');

beforeAll(async () => {
  ({ app } = await import('../src/app'));
  workflow = await import('../src/workflow-engine');
  storeMod = await import('../src/store/store');
});

function seedRun() {
  const project: Project = {
    id: newId('proj'),
    name: `sensitive-route-project-${Date.now()}`,
    localPath: '/tmp/sensitive-route-project',
    language: 'java',
    buildTool: 'maven',
    defaultBranch: 'main',
    registeredAt: nowIso(),
  };
  storeMod.store.projects.set(project.id, project);
  return workflow.createWorkflowRun({ projectId: project.id, type: 'feature', title: 'sensitive route test' });
}

test('runner run-gate API records sensitive_change_gate warn for sensitive paths', async () => {
  const run = seedRun();
  const diffPath = join(mkdtempSync(join(tmpdir(), 'ainp-sensitive-diff-')), 'changes.diff');
  await writeFile(diffPath, 'diff --git a/pom.xml b/pom.xml\n', 'utf8');
  workflow.createArtifact({
    workflowRunId: run.id,
    stepRunId: null,
    kind: 'diff',
    uri: `file://${diffPath}`,
    size: 32,
    contentType: 'text/x-diff',
  });

  const res = await app.request('/runner/events/run-gate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowRunId: run.id,
      stepRunId: null,
      gateId: 'sensitive_change_gate',
      params: { changedFiles: ['pom.xml'] },
    }),
  });

  expect(res.status).toBe(200);
  const body = (await res.json()) as { gate: { gateId: string; status: string; ruleResults: Array<{ message: string }> } };
  expect(body.gate).toMatchObject({ gateId: 'sensitive_change_gate', status: 'warn' });
  expect(body.gate.ruleResults[0]?.message).toContain('pom.xml');
});
