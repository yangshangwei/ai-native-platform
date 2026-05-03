import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import type { CoordinatorDecision, WorkflowRequest } from '@ainp/shared';
import { newId, nowIso } from '@ainp/shared';

process.env.AINP_DB_PATH = join(mkdtempSync(join(tmpdir(), 'ainp-chat-route-')), 'ainp.sqlite');

let app: typeof import('../src/app').app;
let store: typeof import('../src/store/store').store;

async function seedRequest(): Promise<WorkflowRequest> {
  const projectId = newId('proj');
  // Direct insert rather than going through the create endpoint to avoid
  // depending on workflow-engine wiring for these unit tests.
  store.projects.set(projectId, {
    id: projectId,
    name: `proj-${projectId}`,
    localPath: '/tmp/anywhere',
    sourceKind: 'local',
    language: 'java',
    buildTool: 'maven',
    defaultBranch: 'main',
    registeredAt: nowIso(),
  } as never);
  const request: WorkflowRequest = {
    id: newId('wfreq'),
    projectId,
    type: 'feature',
    title: 'sample request',
    branch: 'main',
    status: 'pending',
    claimedBy: null,
    workflowRunId: null,
    error: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  store.workflowRequests.set(request.id, request);
  return request;
}

beforeAll(async () => {
  app = (await import('../src/app')).app;
  store = (await import('../src/store/store')).store;
});

describe('POST /workflow-requests/:id/messages', () => {
  test('inserts a user message and returns it', async () => {
    const req = await seedRequest();
    const res = await app.request(`/workflow-requests/${req.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'user', content: 'add export button' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { role: string; content: string; workflowRequestId: string };
    expect(body.role).toBe('user');
    expect(body.content).toBe('add export button');
    expect(body.workflowRequestId).toBe(req.id);
  });

  test('rejects unknown role', async () => {
    const req = await seedRequest();
    const res = await app.request(`/workflow-requests/${req.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'system', content: 'hi' }),
    });
    expect(res.status).toBe(400);
  });

  test('rejects empty content', async () => {
    const req = await seedRequest();
    const res = await app.request(`/workflow-requests/${req.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'user', content: '   ' }),
    });
    expect(res.status).toBe(400);
  });

  test('returns 404 when request does not exist', async () => {
    const res = await app.request('/workflow-requests/wfreq_unknown/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'user', content: 'hi' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /workflow-requests/:id/messages', () => {
  test('returns messages in created_at order plus latest decision and request status', async () => {
    const req = await seedRequest();
    await app.request(`/workflow-requests/${req.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'user', content: 'first' }),
    });
    await app.request(`/workflow-requests/${req.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'coordinator', content: 'second' }),
    });

    const res = await app.request(`/workflow-requests/${req.id}/messages`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      messages: { role: string; content: string }[];
      decision: CoordinatorDecision | null;
      status: string;
    };
    expect(body.messages.map((m) => m.content)).toEqual(['first', 'second']);
    expect(body.decision).toBeNull();
    expect(body.status).toBe('pending');
  });
});

describe('PATCH /workflow-requests/:id/status', () => {
  test('flips status to awaiting_clarification', async () => {
    const req = await seedRequest();
    const res = await app.request(`/workflow-requests/${req.id}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'awaiting_clarification' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('awaiting_clarification');
  });

  test('rejects unknown status', async () => {
    const req = await seedRequest();
    const res = await app.request(`/workflow-requests/${req.id}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'rebooted' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /coordinator-decisions', () => {
  test('persists a decision and returns it', async () => {
    const req = await seedRequest();
    const res = await app.request('/coordinator-decisions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflowRequestId: req.id,
        source: 'rules',
        decision: { action: 'proceed', routeCase: 'feature_clear', runType: 'feature', reason: 'test' },
        confidence: 0.9,
        rulesFired: ['rule.feature_keywords_dominant'],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as CoordinatorDecision;
    expect(body.workflowRequestId).toBe(req.id);
    expect(body.confidence).toBe(0.9);

    // Followed by GET messages → decision now visible
    const get = await app.request(`/workflow-requests/${req.id}/messages`);
    const getBody = (await get.json()) as { decision: CoordinatorDecision | null };
    expect(getBody.decision?.id).toBe(body.id);
  });

  test('rejects payload missing required fields', async () => {
    const res = await app.request('/coordinator-decisions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'rules' }),
    });
    expect(res.status).toBe(400);
  });
});
