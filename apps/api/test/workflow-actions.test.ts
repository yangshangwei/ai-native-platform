import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, expect, test } from 'vitest';
import { newId, nowIso, type Project } from '@ainp/shared';

process.env.AINP_DB_PATH = join(mkdtempSync(join(tmpdir(), 'ainp-actions-test-')), 'ainp.sqlite');

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
    name: `actions-project-${Date.now()}`,
    localPath: '/tmp/actions-project',
    language: 'java',
    buildTool: 'maven',
    defaultBranch: 'main',
    registeredAt: nowIso(),
  };
  storeMod.store.projects.set(project.id, project);
  return workflow.createWorkflowRun({ projectId: project.id, type: 'feature', title: 'action test' });
}

test('records requirement item actions as persisted workflow actions', async () => {
  const run = seedRun();
  const res = await app.request(`/workflow-runs/${run.id}/requirement-actions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ targetId: 'AC-001', action: 'confirm', actor: 'web', payload: { note: 'ok' } }),
  });

  expect(res.status).toBe(201);
  const body = await res.json() as { action: { id: string; kind: string; targetId: string } };
  expect(body.action).toMatchObject({ kind: 'requirement_item_action', targetId: 'AC-001' });

  const detail = await app.request(`/workflow-runs/${run.id}`);
  expect((await detail.json()) as { actions: Array<{ targetId: string; action: string }> }).toMatchObject({
    actions: [{ targetId: 'AC-001', action: 'confirm' }],
  });
});

test('acceptance decision persists risk decision and records manual approval when accepted', async () => {
  const run = seedRun();
  const res = await app.request(`/workflow-runs/${run.id}/acceptance-decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decision: 'accept_risk', actor: 'web', comment: 'risk accepted', payload: { risks: ['perf not load tested'] } }),
  });

  expect(res.status).toBe(201);
  const body = await res.json() as { action: { action: string }; approval: { gateId: string; decision: string } };
  expect(body.action.action).toBe('accept_risk');
  expect(body.approval).toMatchObject({ gateId: 'acceptance_gate', decision: 'approved' });
});

test('records knowledge suggestion accept/edit/ignore decisions as persisted workflow actions', async () => {
  const run = seedRun();
  const res = await app.request(`/workflow-runs/${run.id}/knowledge-actions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      targetId: 'KS-001',
      action: 'edited',
      actor: 'web',
      payload: { text: 'Use local worktree with gate evidence.', originalText: 'Use worktree.' },
    }),
  });

  expect(res.status).toBe(201);
  const body = await res.json() as { action: { kind: string; targetId: string; action: string; payload: { text: string } } };
  expect(body.action).toMatchObject({
    kind: 'knowledge_suggestion_action',
    targetId: 'KS-001',
    action: 'edited',
    payload: { text: 'Use local worktree with gate evidence.' },
  });

  const detail = await app.request(`/workflow-runs/${run.id}`);
  expect((await detail.json()) as { actions: Array<{ kind: string; targetId: string; action: string }> }).toMatchObject({
    actions: [{ kind: 'knowledge_suggestion_action', targetId: 'KS-001', action: 'edited' }],
  });
});
