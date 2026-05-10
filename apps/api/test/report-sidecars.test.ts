import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, expect, test } from 'vitest';
import { newId, nowIso, type CommandRun, type Project } from '@ainp/shared';

process.env.AINP_DB_PATH = join(mkdtempSync(join(tmpdir(), 'ainp-report-sidecars-')), 'ainp.sqlite');
process.env.AINP_REPORTS_DIR = mkdtempSync(join(tmpdir(), 'ainp-reports-'));

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
    name: `report-sidecar-project-${Date.now()}`,
    localPath: '/tmp/report-sidecar-project',
    language: 'java',
    buildTool: 'maven',
    defaultBranch: 'main',
    registeredAt: nowIso(),
  };
  storeMod.store.projects.set(project.id, project);
  return workflow.createWorkflowRun({ projectId: project.id, type: 'feature', title: 'report sidecar test' });
}

test('completion report route emits markdown plus structured JSON sidecar artifacts', async () => {
  const run = seedRun();
  workflow.recordContextRequestAction({
    workflowRunId: run.id,
    request: {
      id: 'ctxreq_report',
      workflowRunId: run.id,
      stepRunId: 'step_impl',
      stage: 'implementation',
      reason: 'Need the runner event route before adding persistence.',
      requestedRefs: ['code:apps/api/src/routes/runner-events.ts'],
      questions: ['Where should context_request actions be recorded?'],
      priority: 2,
      status: 'open',
      createdAt: nowIso(),
    },
    sourceName: 'last_message',
    taskId: 'agt_report',
    baseContextPackId: 'ctxpack_base',
    supplementContextPackId: 'ctxpack_supplement',
    requestArtifactId: 'art_ctxreq',
    supplementArtifactId: 'art_ctxsupp',
  });
  workflow.recordKnowledgeAction({
    workflowRunId: run.id,
    targetId: 'KS-review',
    action: 'mark_stale',
    actor: 'web',
    payload: {
      reason: 'Accepted backend knowledge conflicts with the current diff evidence.',
      targetKnowledgeId: 'kart_backend',
      evidenceRefs: ['artifact:art_ctxsupp'],
    },
  });
  const res = await app.request(`/workflow-runs/${run.id}/completion-report`, { method: 'POST' });

  expect(res.status).toBe(201);
  const body = (await res.json()) as {
    artifact: { id: string; kind: string; contentType: string };
    sidecar: { id: string; kind: string; contentType: string; metadata: Record<string, unknown> };
  };
  expect(body.artifact).toMatchObject({ kind: 'completion_report', contentType: 'text/markdown' });
  expect(body.sidecar).toMatchObject({
    kind: 'completion_report',
    contentType: 'application/json',
    metadata: { structured: true, schemaVersion: 'ainp.completion_report.v1' },
  });

  const json = await app.request(`/artifacts/${body.sidecar.id}/content`);
  const parsed = JSON.parse(((await json.json()) as { text: string }).text) as {
    schemaVersion: string;
    sections: Array<{ title: string; body: string }>;
    contextRequests: Array<{ id: string; supplementContextPackId: string }>;
    knowledgeReviewSignals: Array<{ kind: string; recommendedAction: string }>;
  };
  expect(parsed.schemaVersion).toBe('ainp.completion_report.v1');
  expect(parsed.sections.length).toBeGreaterThan(0);
  expect(parsed.contextRequests).toMatchObject([
    { id: 'ctxreq_report', supplementContextPackId: 'ctxpack_supplement' },
  ]);
  expect(parsed.sections.find((section) => section.title.startsWith('Context Requests'))?.body)
    .toContain('ctxreq_report');
  expect(parsed.knowledgeReviewSignals).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'mark_stale', recommendedAction: 'mark_stale' }),
    ]),
  );
  expect(parsed.sections.find((section) => section.title.startsWith('Knowledge Review Signals'))?.body)
    .toContain('mark_stale');
});

test('runner context-request route records the supplement chain and rejects malformed requests', async () => {
  const run = seedRun();
  const task = workflow.recordAgentTask({
    workflowRunId: run.id,
    stepRunId: 'step_impl',
    kind: 'implementation',
    backend: 'codex',
    prompt: 'ContextPack: ctxpack_base',
    inputArtifactIds: [],
  });
  const requestArtifact = workflow.createArtifact({
    workflowRunId: run.id,
    stepRunId: 'step_impl',
    kind: 'other',
    uri: 'mem://context-request.json',
    size: 10,
    contentType: 'application/json',
    metadata: {},
  });
  const supplementArtifact = workflow.createArtifact({
    workflowRunId: run.id,
    stepRunId: 'step_impl',
    kind: 'context_pack',
    uri: 'mem://context-supplement.json',
    size: 10,
    contentType: 'application/json',
    metadata: {},
  });

  const good = await app.request('/runner/events/context-request', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowRunId: run.id,
      request: {
        id: 'ctxreq_route',
        workflowRunId: run.id,
        stepRunId: 'step_impl',
        stage: 'implementation',
        reason: 'Need runner event route details.',
        requestedRefs: ['code:apps/api/src/routes/runner-events.ts'],
        questions: [],
        priority: 1,
        status: 'open',
        createdAt: nowIso(),
      },
      sourceName: 'last_message',
      taskId: task.id,
      baseContextPackId: 'ctxpack_base',
      supplementContextPackId: 'ctxpack_supplement',
      requestArtifactId: requestArtifact.id,
      supplementArtifactId: supplementArtifact.id,
    }),
  });
  expect(good.status).toBe(201);

  const actions = storeMod.store.workflowActions.byWorkflow(run.id);
  expect(actions.at(-1)).toMatchObject({
    kind: 'context_request',
    targetId: 'ctxreq_route',
    payload: {
      baseContextPackId: 'ctxpack_base',
      supplementContextPackId: 'ctxpack_supplement',
      requestArtifactId: requestArtifact.id,
      supplementArtifactId: supplementArtifact.id,
    },
  });

  const bad = await app.request('/runner/events/context-request', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowRunId: run.id,
      request: {
        id: 'ctxreq_bad',
        workflowRunId: run.id,
        stepRunId: 'step_impl',
        stage: 'implementation',
        reason: 'Need runner event route details.',
        requestedRefs: ['code:ok', 42],
        questions: [],
        priority: 9,
        status: 'pending',
        createdAt: nowIso(),
      },
      taskId: task.id,
      baseContextPackId: 'ctxpack_base',
      supplementContextPackId: 'ctxpack_supplement',
      requestArtifactId: requestArtifact.id,
      supplementArtifactId: supplementArtifact.id,
    }),
  });
  expect(bad.status).toBe(400);

  const crossRun = seedRun();
  const crossRunIds = await app.request('/runner/events/context-request', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowRunId: crossRun.id,
      request: {
        id: 'ctxreq_cross',
        workflowRunId: crossRun.id,
        stepRunId: 'step_impl',
        stage: 'implementation',
        reason: 'Need runner event route details.',
        requestedRefs: ['code:apps/api/src/routes/runner-events.ts'],
        questions: [],
        priority: 1,
        status: 'open',
        createdAt: nowIso(),
      },
      sourceName: 'last_message',
      taskId: task.id,
      baseContextPackId: 'ctxpack_base',
      supplementContextPackId: 'ctxpack_supplement',
      requestArtifactId: requestArtifact.id,
      supplementArtifactId: supplementArtifact.id,
    }),
  });
  expect(crossRunIds.status).toBe(400);
});

test('knowledge candidate route emits markdown plus structured JSON sidecar artifacts', async () => {
  const run = seedRun();
  workflow.recordCommandRun(commandRunFixture(run.id, {
    id: 'cmd_typecheck',
    command: 'bun run typecheck',
    status: 'passed',
    exitCode: 0,
  }));
  workflow.createArtifact({
    workflowRunId: run.id,
    stepRunId: null,
    kind: 'diff',
    uri: 'file:///tmp/report-sidecar.diff',
    size: 120,
    contentType: 'text/plain',
    metadata: { changedFilesPath: '/tmp/changed-files.txt' },
  });
  workflow.recordContextRequestAction({
    workflowRunId: run.id,
    request: {
      id: 'ctxreq_candidate',
      workflowRunId: run.id,
      stepRunId: 'step_impl',
      stage: 'implementation',
      reason: 'Need current route evidence before changing candidate generation.',
      requestedRefs: ['code:apps/api/src/reports.ts'],
      questions: [],
      priority: 2,
      status: 'open',
      createdAt: nowIso(),
    },
    sourceName: 'last_message',
    taskId: 'agt_candidate',
    baseContextPackId: 'ctxpack_base',
    supplementContextPackId: 'ctxpack_supplement',
    requestArtifactId: 'art_ctxreq_candidate',
    supplementArtifactId: 'art_ctxsupp_candidate',
  });
  const res = await app.request(`/workflow-runs/${run.id}/knowledge-candidate`, { method: 'POST' });

  expect(res.status).toBe(201);
  const body = (await res.json()) as {
    artifact: { id: string; kind: string; contentType: string };
    sidecar: { id: string; kind: string; contentType: string; metadata: Record<string, unknown> };
  };
  expect(body.artifact).toMatchObject({ kind: 'knowledge_candidate', contentType: 'text/markdown' });
  expect(body.sidecar).toMatchObject({
    kind: 'knowledge_candidate',
    contentType: 'application/json',
    metadata: { structured: true, schemaVersion: 'ainp.knowledge_candidate.v1' },
  });

  const json = await app.request(`/artifacts/${body.sidecar.id}/content`);
  const parsed = JSON.parse(((await json.json()) as { text: string }).text) as {
    schemaVersion: string;
    suggestions: Array<{ text: string; evidence: string; sourceRefs: string[] }>;
    provenance: { commandRunIds: string[]; contextRequestActionIds: string[] };
  };
  expect(parsed.schemaVersion).toBe('ainp.knowledge_candidate.v1');
  expect(parsed.suggestions.length).toBeGreaterThan(0);
  expect(parsed.suggestions.some((item) => item.text.includes('bun run typecheck'))).toBe(true);
  expect(parsed.suggestions.some((item) => item.text.includes('structured context_request'))).toBe(true);
  expect(JSON.stringify(parsed.suggestions)).not.toContain('Trusted Local Worktree mode');
  expect(parsed.provenance.commandRunIds).toContain('cmd_typecheck');
  expect(parsed.provenance.contextRequestActionIds.length).toBeGreaterThan(0);
});

function commandRunFixture(
  workflowRunId: string,
  overrides: Partial<CommandRun> = {},
): CommandRun {
  const ts = nowIso();
  return {
    id: newId('cmd'),
    workflowRunId,
    stepRunId: null,
    cwd: '/tmp/report-sidecar-project',
    command: 'bun test',
    stage: 'test',
    status: 'passed',
    exitCode: 0,
    startedAt: ts,
    finishedAt: ts,
    durationMs: 123,
    stdoutRef: 'file:///tmp/stdout.log',
    stderrRef: 'file:///tmp/stderr.log',
    stdoutBytes: 12,
    stderrBytes: 0,
    timedOut: false,
    truncated: false,
    ...overrides,
  };
}
