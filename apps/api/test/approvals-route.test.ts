import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, expect, test } from 'vitest';
import { newId, nowIso, type Project } from '@ainp/shared';

process.env.AINP_DB_PATH = join(mkdtempSync(join(tmpdir(), 'ainp-approvals-route-test-')), 'ainp.sqlite');

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
    name: `approvals-route-project-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    localPath: '/tmp/approvals-route-project',
    language: 'java',
    buildTool: 'maven',
    defaultBranch: 'main',
    registeredAt: nowIso(),
  };
  storeMod.store.projects.set(project.id, project);
  return workflow.createWorkflowRun({ projectId: project.id, type: 'feature', title: 'approvals test' });
}

test('approve path: 201 without comment (existing behaviour preserved)', async () => {
  const run = seedRun();
  const res = await app.request('/approvals', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowRunId: run.id,
      gateId: 'requirement_gate',
      approved: true,
      actor: 'web',
    }),
  });
  expect(res.status).toBe(201);
});

test('reject path: 201 when comment is non-empty', async () => {
  const run = seedRun();
  const res = await app.request('/approvals', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowRunId: run.id,
      gateId: 'requirement_gate',
      approved: false,
      actor: 'web',
      comment: 'AC-3 lacks evidence — please re-attach surefire report',
    }),
  });
  expect(res.status).toBe(201);
});

test('reject path: 400 when comment is missing', async () => {
  const run = seedRun();
  const res = await app.request('/approvals', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowRunId: run.id,
      gateId: 'requirement_gate',
      approved: false,
      actor: 'web',
    }),
  });
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: string };
  expect(body.error).toMatch(/comment/i);
});

test('reject path: 400 when comment is whitespace only', async () => {
  const run = seedRun();
  const res = await app.request('/approvals', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowRunId: run.id,
      gateId: 'requirement_gate',
      approved: false,
      actor: 'web',
      comment: '   \n\t  ',
    }),
  });
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: string };
  expect(body.error).toMatch(/comment/i);
});
