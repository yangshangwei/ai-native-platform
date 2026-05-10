import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { newId, nowIso, type Project, type WorkflowRequest } from '@ainp/shared';

process.env.AINP_DB_PATH = join(
  mkdtempSync(join(tmpdir(), 'ainp-agent-events-channels-test-')),
  'ainp.sqlite',
);
process.env.AINP_HOME = join(
  mkdtempSync(join(tmpdir(), 'ainp-agent-events-channels-home-')),
  '.ai-native',
);

let app: Awaited<typeof import('../src/app')>['app'];
let storeMod: typeof import('../src/store/store');
let engineMod: typeof import('../src/workflow-engine');

beforeAll(async () => {
  ({ app } = await import('../src/app'));
  storeMod = await import('../src/store/store');
  engineMod = await import('../src/workflow-engine');
});

function registerProject(name: string): Project {
  const project: Project = {
    id: newId('proj'),
    name,
    localPath: '/tmp/agent-events-channels',
    sourceKind: 'local',
    sourceUrl: null,
    sourceAuthKind: 'none',
    sourceUsername: null,
    sourceCredential: null,
    status: 'active',
    archivedAt: null,
    agentBackend: 'claude_code',
    language: 'java',
    buildTool: 'maven',
    defaultBranch: 'main',
    sourceBranches: ['main'],
    registeredAt: nowIso(),
  };
  storeMod.store.projects.set(project.id, project);
  return project;
}

function createRequest(projectId: string, title: string): WorkflowRequest {
  return engineMod.createWorkflowRequest({
    projectId,
    type: 'feature',
    title,
    branch: 'main',
    flowId: null,
    startStage: null,
  });
}

interface SseFrame {
  id: string | null;
  event: string | null;
  data: string;
}

function parseSseFrame(raw: string): SseFrame {
  let id: string | null = null;
  let event: string | null = null;
  const data: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('id:')) id = line.slice(3).trimStart();
    else if (line.startsWith('event:')) event = line.slice(6).trimStart();
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  return { id, event, data: data.join('\n') };
}

function makeSseReader(body: ReadableStream<Uint8Array>): () => Promise<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  return async () => {
    for (;;) {
      const delimiter = buffer.indexOf('\n\n');
      if (delimiter >= 0) {
        const raw = buffer.slice(0, delimiter);
        buffer = buffer.slice(delimiter + 2);
        return parseSseFrame(raw);
      }
      const chunk = await reader.read();
      if (chunk.done) throw new Error('SSE stream ended before expected frame');
      buffer += decoder.decode(chunk.value, { stream: true });
    }
  };
}

describe('PR1 agent-events channels: recordAgentEvent + history endpoint', () => {
  test('rejects events with neither workflowRunId nor workflowRequestId', () => {
    expect(() =>
      engineMod.recordAgentEvent({
        workflowRunId: null,
        workflowRequestId: null,
        stepRunId: null,
        agentKind: 'claude_code',
        type: 'meta',
        payload: { event: 'started' },
        text: '[meta:started]',
      }),
    ).toThrow(/exactly one of workflowRunId or workflowRequestId/);
  });

  test('rejects events with both workflowRunId and workflowRequestId', () => {
    expect(() =>
      engineMod.recordAgentEvent({
        workflowRunId: 'wfr_both',
        workflowRequestId: 'wfreq_both',
        stepRunId: null,
        agentKind: 'claude_code',
        type: 'meta',
        payload: { event: 'started' },
        text: '[meta:started]',
      }),
    ).toThrow(/exactly one of workflowRunId or workflowRequestId/);
  });

  test('per-channel sequence is monotonic and run/request channels are independent', () => {
    const runId = 'wfr_seq_run';
    const reqId = 'wfr_seq_req';

    const r0 = engineMod.recordAgentEvent({
      workflowRunId: runId,
      workflowRequestId: null,
      stepRunId: null,
      agentKind: 'claude_code',
      type: 'meta',
      payload: { event: 'a' },
      text: 'a',
    });
    const r1 = engineMod.recordAgentEvent({
      workflowRunId: runId,
      workflowRequestId: null,
      stepRunId: null,
      agentKind: 'claude_code',
      type: 'assistant',
      payload: {},
      text: null,
    });

    const q0 = engineMod.recordAgentEvent({
      workflowRunId: null,
      workflowRequestId: reqId,
      stepRunId: null,
      agentKind: 'codex',
      type: 'meta',
      payload: { event: 'a' },
      text: 'a',
    });
    const q1 = engineMod.recordAgentEvent({
      workflowRunId: null,
      workflowRequestId: reqId,
      stepRunId: null,
      agentKind: 'codex',
      type: 'assistant',
      payload: {},
      text: null,
    });

    expect(r0.sequence).toBe(0);
    expect(r1.sequence).toBe(1);
    expect(q0.sequence).toBe(0); // request channel sequence is independent
    expect(q1.sequence).toBe(1);

    expect(storeMod.store.agentEvents.byWorkflow(runId).map((e) => e.sequence)).toEqual([0, 1]);
    expect(storeMod.store.agentEvents.byRequest(reqId).map((e) => e.sequence)).toEqual([0, 1]);

    // byWorkflow does not include request-channel events
    expect(storeMod.store.agentEvents.byWorkflow(runId).every((e) => e.workflowRunId === runId)).toBe(true);
    // byRequest does not include run-channel events
    expect(
      storeMod.store.agentEvents
        .byRequest(reqId)
        .every((e) => e.workflowRequestId === reqId),
    ).toBe(true);
  });

  test('GET /workflow-requests/:id/agent-events returns history for the request channel', async () => {
    const project = registerProject(`agent-events-history-${newId('p')}`);
    const request = createRequest(project.id, 'history-test');

    engineMod.recordAgentEvent({
      workflowRunId: null,
      workflowRequestId: request.id,
      stepRunId: null,
      agentKind: 'claude_code',
      type: 'meta',
      payload: { event: 'cli_started' },
      text: '[meta:cli_started]',
    });
    engineMod.recordAgentEvent({
      workflowRunId: null,
      workflowRequestId: request.id,
      stepRunId: null,
      agentKind: 'claude_code',
      type: 'assistant',
      payload: { content: [{ type: 'text', text: 'hi' }] },
      text: '[claude] hi',
    });

    const res = await app.request(`/workflow-requests/${request.id}/agent-events`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ sequence: number; workflowRequestId: string }> };
    expect(body.items.map((i) => i.sequence)).toEqual([0, 1]);
    expect(body.items.every((i) => i.workflowRequestId === request.id)).toBe(true);
  });

  test('GET /workflow-requests/:id/agent-events?sinceSeq= filters', async () => {
    const project = registerProject(`agent-events-since-${newId('p')}`);
    const request = createRequest(project.id, 'since-seq');

    for (let i = 0; i < 4; i++) {
      engineMod.recordAgentEvent({
        workflowRunId: null,
        workflowRequestId: request.id,
        stepRunId: null,
        agentKind: 'claude_code',
        type: 'meta',
        payload: { i },
        text: `m${i}`,
      });
    }

    const res = await app.request(`/workflow-requests/${request.id}/agent-events?sinceSeq=1`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ sequence: number }> };
    expect(body.items.map((i) => i.sequence)).toEqual([2, 3]);
  });

  test('GET /workflow-requests/:id/agent-events 404s for unknown request id', async () => {
    const res = await app.request('/workflow-requests/wfr_does_not_exist/agent-events');
    expect(res.status).toBe(404);
  });

  test('GET /workflow-requests/:id/agent-stream replays history then live tail without dropping the subscribe/history race', async () => {
    const project = registerProject(`agent-events-sse-${newId('p')}`);
    const request = createRequest(project.id, 'sse-request-channel');
    engineMod.recordAgentEvent({
      workflowRunId: null,
      workflowRequestId: request.id,
      stepRunId: null,
      agentKind: 'claude_code',
      type: 'meta',
      payload: { event: 'cli_started' },
      text: '[meta:cli_started]',
    });

    const ac = new AbortController();
    const res = await app.request(
      `/workflow-requests/${request.id}/agent-stream?sinceSeq=-1`,
      { signal: ac.signal },
    );
    expect(res.status).toBe(200);
    expect(res.body).not.toBeNull();
    const nextFrame = makeSseReader(res.body!);

    try {
      const ready = await nextFrame();
      expect(ready.event).toBe('ready');

      // Published after the route has subscribed but while the handler may
      // still be replaying history; it must appear exactly once after history.
      engineMod.recordAgentEvent({
        workflowRunId: null,
        workflowRequestId: request.id,
        stepRunId: null,
        agentKind: 'claude_code',
        type: 'assistant',
        payload: { delta: 'live' },
        text: 'live',
      });

      const history = await nextFrame();
      const live = await nextFrame();
      expect(history.event).toBe('meta');
      expect(history.id).toBe('0');
      expect(live.event).toBe('assistant');
      expect(live.id).toBe('1');
      expect([history, live].map((frame) => JSON.parse(frame.data).sequence)).toEqual([0, 1]);
      expect([history, live].map((frame) => JSON.parse(frame.data).workflowRequestId)).toEqual([
        request.id,
        request.id,
      ]);
    } finally {
      ac.abort();
    }
  });

  test('POST /runner/events/agent-stream rejects events without channel ids', async () => {
    const res = await app.request('/runner/events/agent-stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflowRunId: null,
        stepRunId: null,
        agentKind: 'claude_code',
        type: 'meta',
        payload: {},
        text: null,
      }),
    });
    expect(res.status).toBe(400);
  });

  test('POST /runner/events/agent-stream rejects events with both ids', async () => {
    const res = await app.request('/runner/events/agent-stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflowRunId: 'wfr_x',
        workflowRequestId: 'wfreq_x',
        stepRunId: null,
        agentKind: 'claude_code',
        type: 'meta',
        payload: {},
        text: null,
      }),
    });
    expect(res.status).toBe(400);
  });

  test('POST /runner/events/agent-stream accepts request-channel events', async () => {
    const project = registerProject(`agent-events-runner-${newId('p')}`);
    const request = createRequest(project.id, 'runner-channel');

    const res = await app.request('/runner/events/agent-stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        workflowRunId: null,
        workflowRequestId: request.id,
        stepRunId: null,
        agentKind: 'codex',
        type: 'meta',
        payload: { event: 'cli_started' },
        text: '[meta:cli_started]',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; count: number };
    expect(body).toEqual(expect.objectContaining({ ok: true, count: 1 }));
    expect(storeMod.store.agentEvents.byRequest(request.id)).toHaveLength(1);
  });
});
