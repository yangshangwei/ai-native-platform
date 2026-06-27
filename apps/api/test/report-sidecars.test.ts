import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, expect, test } from 'vitest';
import { newId, nowIso, type CommandRun, type GateRun, type Project } from '@ainp/shared';

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

test('completion report route blocks when Evidence Gate fails', async () => {
  const run = seedRun();
  const gate: GateRun = {
    id: 'gate_completion_unproven',
    gateId: 'requirement_gate',
    workflowRunId: run.id,
    stepRunId: null,
    status: 'pass',
    ruleResults: [
      {
        ruleId: 'requirement.unproven_pass',
        status: 'pass',
        message: 'claimed pass without persisted evidence',
        evidenceRefs: [],
      },
    ],
    evidenceRefs: [],
    commandRunIds: [],
    decidedAt: nowIso(),
    agentNote: null,
  };
  storeMod.store.gateRuns.insert(gate);

  const res = await app.request(`/workflow-runs/${run.id}/completion-report`, { method: 'POST' });

  expect(res.status).toBe(409);
  const body = (await res.json()) as {
    error: string;
    gate: GateRun;
  };
  expect(body.error).toBe('evidence_gate failed');
  expect(body.gate.gateId).toBe('evidence_gate');
  expect(body.gate.status).toBe('fail');
  expect(storeMod.store.artifacts.byKind(run.id, 'completion_report')).toHaveLength(0);
});

test('completion report route emits markdown plus structured JSON sidecar artifacts', async () => {
  const run = seedRun();
  const step = workflow.startStep({
    workflowRunId: run.id,
    stage: 'implementation',
    name: 'skill.implementation',
  });
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
  const handoffInput = workflow.createArtifact({
    workflowRunId: run.id,
    stepRunId: 'step_impl',
    kind: 'diff',
    uri: 'mem://handoff-diff',
    size: 10,
    contentType: 'text/markdown',
    metadata: {},
  });
  const handoffOutput = workflow.createArtifact({
    workflowRunId: run.id,
    stepRunId: step.id,
    kind: 'other',
    uri: 'mem://handoff-review',
    size: 10,
    contentType: 'text/markdown',
    metadata: {},
  });
  const checkpointTask = workflow.recordAgentTask({
    workflowRunId: run.id,
    stepRunId: step.id,
    kind: 'implementation',
    backend: 'codex',
    prompt: 'ContextPack: ctxpack_report_checkpoint',
    inputArtifactIds: [handoffInput.id],
  });
  const checkpointSession = workflow.recordAgentSessionStarted({
    agentTaskId: checkpointTask.id,
    stage: 'implementation',
    skillId: 'skill.implementation',
    skillVersion: '1.0.0',
    contextPackId: 'ctxpack_report_checkpoint',
  });
  const checkpointResult = workflow.recordAgentResult({
    taskId: checkpointTask.id,
    status: 'success',
    summary: 'implementation evidence recorded',
    outputArtifactIds: [handoffOutput.id],
  });
  workflow.recordAgentSessionFinished({
    sessionId: checkpointSession.id,
    status: 'success',
    agentResultId: checkpointResult.id,
  });
  workflow.finishStep(step.id, 'passed');
  workflow.recordHandoff({
    workflowRunId: run.id,
    stepRunId: null,
    fromRole: 'main',
    toRole: 'reviewer',
    reason: 'Independent implementation review.',
    inputArtifactIds: [handoffInput.id],
    expectedOutput: {
      schemaVersion: 'ainp.handoff.review.v1',
      artifactKind: 'other',
      description: 'Review findings artifact.',
    },
    stopCondition: 'Stop after producing one review artifact.',
    status: 'completed',
    adoptionDecision: 'needs_review',
    outputArtifactIds: [handoffOutput.id],
    metadata: { gateAuthority: 'gate_engine' },
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

  const markdown = await app.request(`/artifacts/${body.artifact.id}/content`);
  const markdownText = ((await markdown.json()) as { text: string }).text;
  expect(markdownText).toContain('**Status at report generation:**');
  expect(markdownText).not.toContain('**Status:** running');

  const json = await app.request(`/artifacts/${body.sidecar.id}/content`);
  const parsed = JSON.parse(((await json.json()) as { text: string }).text) as {
    schemaVersion: string;
    summary: string[];
    sections: Array<{ title: string; body: string }>;
    contextRequests: Array<{ id: string; supplementContextPackId: string }>;
    handoffs: Array<{ toRole: string; adoptionDecision: string; outputArtifactIds: string[] }>;
    stepCheckpoints: Array<{ stepRunId: string; contextPackId: string; agentSessionIds: string[] }>;
    knowledgeReviewSignals: Array<{ kind: string; recommendedAction: string }>;
  };
  expect(parsed.schemaVersion).toBe('ainp.completion_report.v1');
  expect(parsed.summary.some((item) => item.startsWith('Status at report generation: '))).toBe(true);
  expect(parsed.summary.some((item) => item.startsWith('Status: '))).toBe(false);
  expect(parsed.sections.length).toBeGreaterThan(0);
  expect(parsed.contextRequests).toMatchObject([
    { id: 'ctxreq_report', supplementContextPackId: 'ctxpack_supplement' },
  ]);
  expect(parsed.sections.find((section) => section.title.startsWith('Context Requests'))?.body)
    .toContain('ctxreq_report');
  expect(parsed.handoffs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        toRole: 'reviewer',
        adoptionDecision: 'needs_review',
        outputArtifactIds: [handoffOutput.id],
      }),
    ]),
  );
  expect(parsed.sections.find((section) => section.title.startsWith('Handoffs'))?.body)
    .toContain('Independent implementation review');
  expect(parsed.stepCheckpoints).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        stepRunId: step.id,
        contextPackId: 'ctxpack_report_checkpoint',
        agentSessionIds: [checkpointSession.id],
      }),
    ]),
  );
  expect(parsed.sections.find((section) => section.title.startsWith('Step Checkpoints'))?.body)
    .toContain(step.id);
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

test('retro route emits fact-first retro artifacts with knowledge/eval candidates', async () => {
  const run = seedRun();
  workflow.recordCommandRun(commandRunFixture(run.id, {
    id: 'cmd_retro_failed',
    command: 'bun test apps/api/test/retro.test.ts',
    status: 'failed',
    exitCode: 1,
  }));
  storeMod.store.gateRuns.insert({
    id: 'gate_retro_failed',
    gateId: 'test_gate',
    workflowRunId: run.id,
    stepRunId: null,
    status: 'fail',
    ruleResults: [
      {
        ruleId: 'test.all_passed',
        status: 'fail',
        message: 'tests failed',
        evidenceRefs: [{ artifactId: 'cmd_retro_failed', claim: 'failing test command' }],
      },
    ],
    evidenceRefs: [{ artifactId: 'cmd_retro_failed', claim: 'failing test command' }],
    commandRunIds: ['cmd_retro_failed'],
    decidedAt: nowIso(),
    agentNote: null,
  });
  workflow.recordKnowledgeAction({
    workflowRunId: run.id,
    targetId: 'KS-retro',
    action: 'mark_stale',
    actor: 'web',
    payload: {
      reason: 'Retro found stale knowledge while reviewing failed evidence.',
      targetKnowledgeId: 'kart_stale',
      evidenceRefs: ['gate:gate_retro_failed', 'command:cmd_retro_failed'],
    },
  });

  const res = await app.request(`/workflow-runs/${run.id}/retro`, { method: 'POST' });

  expect(res.status).toBe(201);
  const body = (await res.json()) as {
    artifact: { id: string; kind: string; contentType: string; sha256: string | null; metadata: Record<string, unknown> };
    sidecar: { id: string; kind: string; contentType: string; sha256: string | null; metadata: Record<string, unknown> };
  };
  expect(body.artifact).toMatchObject({
    kind: 'other',
    contentType: 'text/markdown',
    metadata: { reportKind: 'retro_report', schemaVersion: 'ainp.retro_report.v1' },
  });
  expect(body.sidecar).toMatchObject({
    kind: 'other',
    contentType: 'application/json',
    metadata: { reportKind: 'retro_report', structured: true, schemaVersion: 'ainp.retro_report.v1' },
  });
  expect(body.artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(body.sidecar.sha256).toMatch(/^[a-f0-9]{64}$/);

  const json = await app.request(`/artifacts/${body.sidecar.id}/content`);
  const parsed = JSON.parse(((await json.json()) as { text: string }).text) as {
    schemaVersion: string;
    summary: { findings: number; promotionCandidates: number };
    findings: Array<{ kind: string; recommendedAction: string }>;
    promotionCandidates: Array<{ target: string; findingKind: string }>;
    evidence: { commandRunIds: string[]; gateRunIds: string[]; knowledgeReviewSignalIds: string[] };
  };
  expect(parsed.schemaVersion).toBe('ainp.retro_report.v1');
  expect(parsed.summary.findings).toBeGreaterThanOrEqual(3);
  expect(parsed.summary.promotionCandidates).toBe(parsed.summary.findings);
  expect(parsed.findings.map((finding) => finding.kind)).toEqual(
    expect.arrayContaining(['gate_issue', 'command_issue', 'knowledge_review']),
  );
  expect(parsed.promotionCandidates.map((candidate) => candidate.target)).toEqual(
    expect.arrayContaining(['eval_candidate', 'knowledge_review']),
  );
  expect(parsed.evidence.commandRunIds).toContain('cmd_retro_failed');
  expect(parsed.evidence.gateRunIds).toContain('gate_retro_failed');
  expect(parsed.evidence.knowledgeReviewSignalIds.length).toBeGreaterThan(0);
});

test('retro action route confirms findings into knowledge actions or eval drafts', async () => {
  const run = seedRun();

  const knowledgeReview = await app.request(`/workflow-runs/${run.id}/retro-actions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      candidateId: 'retro-001',
      action: 'create_knowledge_review',
      actor: 'tester',
      payload: {
        reason: 'Retro finding needs human calibration before promotion.',
        targetKnowledgeId: 'kart_retro_candidate',
        evidenceRefs: ['gate:gate_retro_failed', 'command:cmd_retro_failed'],
      },
    }),
  });

  expect(knowledgeReview.status).toBe(201);
  const knowledgeBody = (await knowledgeReview.json()) as {
    action: { kind: string; targetId: string; action: string; actor: string; payload: Record<string, unknown> };
  };
  expect(knowledgeBody.action).toMatchObject({
    kind: 'knowledge_suggestion_action',
    targetId: 'retro-001',
    action: 'needs_review',
    actor: 'tester',
    payload: {
      retroCandidateId: 'retro-001',
      retroAction: 'create_knowledge_review',
      targetKnowledgeId: 'kart_retro_candidate',
    },
  });
  expect(storeMod.store.workflowActions.byWorkflow(run.id).at(-1)).toMatchObject({
    kind: 'knowledge_suggestion_action',
    targetId: 'retro-001',
    action: 'needs_review',
  });

  const evalDraft = await app.request(`/workflow-runs/${run.id}/retro-actions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      candidateId: 'retro-002',
      action: 'create_eval_candidate',
      actor: 'tester',
      payload: {
        title: 'Regression eval for failed retro gate',
        findingKind: 'gate_issue',
        recommendedAction: 'create_eval_case',
        summary: 'The test gate failed and should become a replayable workflow fixture.',
        evidenceRefs: ['gate:gate_retro_failed', 'command:cmd_retro_failed'],
      },
    }),
  });

  expect(evalDraft.status).toBe(201);
  const evalBody = (await evalDraft.json()) as {
    action: { kind: string; targetId: string; action: string; payload: Record<string, unknown> };
    artifact: { id: string; kind: string; contentType: string; sha256: string | null; metadata: Record<string, unknown> };
  };
  expect(evalBody.action).toMatchObject({
    kind: 'retro_candidate_action',
    targetId: 'retro-002',
    action: 'create_eval_scenario',
    payload: {
      retroAction: 'create_eval_candidate',
      draftArtifactId: evalBody.artifact.id,
    },
  });
  expect(evalBody.artifact).toMatchObject({
    kind: 'other',
    contentType: 'application/json',
    metadata: {
      reportKind: 'eval_candidate',
      structured: true,
      schemaVersion: 'ainp.eval.scenario_draft.v1',
      retroCandidateId: 'retro-002',
    },
  });
  expect(evalBody.artifact.sha256).toMatch(/^[a-f0-9]{64}$/);

  const content = await app.request(`/artifacts/${evalBody.artifact.id}/content`);
  const parsed = JSON.parse(((await content.json()) as { text: string }).text) as {
    schemaVersion: string;
    workflowRunId: string;
    targetId: string;
    status: string;
    source: { evidenceRefs: string[] };
    suggestedScenario: { kind: string; input: { workflowRunId: string; retroCandidateId: string } };
  };
  expect(parsed).toMatchObject({
    schemaVersion: 'ainp.eval.scenario_draft.v1',
    workflowRunId: run.id,
    targetId: 'retro-002',
    status: 'draft',
    suggestedScenario: {
      kind: 'workflow_fixture',
      input: {
        workflowRunId: run.id,
        retroCandidateId: 'retro-002',
      },
    },
  });
  expect(parsed.source.evidenceRefs).toEqual(['gate:gate_retro_failed', 'command:cmd_retro_failed']);
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
