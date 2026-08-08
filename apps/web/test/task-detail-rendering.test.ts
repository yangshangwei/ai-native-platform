import { Window } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildRunProjection, type RunDetail } from '../src/projection';
import { renderEvidencePanel, renderStageTimeline, renderTaskDetailPage } from '../src/page-task-detail';
import { artifactContent, contextGovernanceByRun, data, ui } from '../src/state';
import type { WorkflowRequestDto } from '../src/types';
import type { ReviewerVerdict } from '@ainp/shared/browser';

const testWindow = new Window();
globalThis.window = testWindow as unknown as Window & typeof globalThis;
globalThis.document = testWindow.document as unknown as Document;
globalThis.HTMLElement = testWindow.HTMLElement;
globalThis.HTMLDetailsElement = testWindow.HTMLDetailsElement;
globalThis.Node = testWindow.Node;
const originalFetch = globalThis.fetch;

function reviewerDetail(): RunDetail {
  return {
    run: {
      id: 'run_review',
      title: 'Reviewer surface',
      type: 'feature',
      status: 'awaiting_human',
      currentStage: 'design',
      flowId: 'feature.standard',
      startStage: null,
      sourceBranch: 'main',
      branch: 'ai/run_review',
      workspacePath: '/tmp/worktree',
      projectId: 'proj_1',
      createdAt: '2026-06-29T00:00:00.000Z',
    },
    steps: [
      { id: 'step_req', stage: 'requirement', name: 'requirement', status: 'passed' },
      { id: 'step_design', stage: 'design', name: 'design', status: 'running' },
    ],
    commands: [
      {
        id: 'cmd_1',
        stepRunId: 'step_design',
        cwd: '/tmp/worktree',
        command: 'bun test apps/web/test',
        stage: 'test',
        status: 'failed',
        exitCode: 1,
        durationMs: 120,
        stdoutRef: 'stdout.log',
        stderrRef: 'stderr.log',
        stdoutSha256: null,
        stderrSha256: null,
        combinedSha256: null,
        startedAt: '2026-06-29T00:00:00.100Z',
        timedOut: false,
        truncated: false,
      },
    ],
    toolInvocations: [],
    gates: [
      {
        id: 'gate_req',
        gateId: 'requirement_gate',
        stepRunId: 'step_req',
        status: 'pass',
        decidedAt: '2026-06-29T00:00:00.200Z',
        ruleResults: [{ ruleId: 'requirement.doc_present', status: 'pass', message: '' }],
      },
      {
        id: 'gate_design',
        gateId: 'design_gate',
        stepRunId: 'step_design',
        status: 'warn',
        decidedAt: '2026-06-29T00:00:00.300Z',
        ruleResults: [{ ruleId: 'design.test_strategy_present', status: 'warn', message: 'Needs sharper test plan' }],
      },
    ],
    artifacts: [
      {
        id: 'art_design',
        kind: 'design_doc',
        stepRunId: 'step_design',
        uri: 'file:///tmp/design.md',
        createdAt: '2026-06-29T00:00:00.400Z',
        contentType: 'text/markdown',
        sha256: 'abc123',
        metadata: { output: 'design.md' },
      },
    ],
    builds: [],
    tests: [],
    approvals: [],
    actions: [],
    agentTasks: [
      {
        id: 'task_design',
        stepRunId: 'step_design',
        kind: 'design_draft',
        backend: 'codex',
        inputArtifactIds: ['art_req'],
        createdAt: '2026-06-29T00:00:00.500Z',
      },
    ],
    agentResults: [
      {
        id: 'result_design',
        taskId: 'task_design',
        status: 'failed',
        summary: 'Design needs revision',
        outputArtifactIds: ['art_design'],
        completedAt: '2026-06-29T00:00:00.600Z',
      },
    ],
    handoffs: [],
    stepCheckpoints: [
      {
        id: 'checkpoint_design',
        workflowRunId: 'run_review',
        stepRunId: 'step_design',
        stage: 'design',
        status: 'failed',
        retryIndex: 0,
        contextPackId: null,
        agentSessionIds: [],
        toolInvocationIds: [],
        inputArtifactIds: [],
        outputArtifactIds: [],
        gateRunIds: ['gate_design'],
        commandRunIds: ['cmd_1'],
        startedAt: '2026-06-29T00:00:00.700Z',
        completedAt: null,
        failureReason: 'Design gate needs revision.',
      },
    ],
    audit: [],
  };
}

function installPausedTaskDetail(): { detail: RunDetail; request: WorkflowRequestDto } {
  const detail = reviewerDetail();
  detail.run = {
    ...detail.run,
    status: 'paused',
    currentStage: 'implementation',
  };
  detail.audit = [{
    id: 'audit_pause',
    workflowRunId: detail.run.id,
    kind: 'workflow_run.paused',
    payload: { reason: 'backend_timeout', detail: 'claude timed out' },
    at: '2026-07-26T00:00:00.000Z',
  }];
  const request: WorkflowRequestDto = {
    id: 'wreq_paused',
    projectId: detail.run.projectId,
    type: 'feature',
    title: detail.run.title,
    branch: detail.run.sourceBranch,
    status: 'paused',
    claimedBy: 'runner@test',
    workflowRunId: detail.run.id,
    error: 'claude timed out',
    agentBackend: null,
    flowId: detail.run.flowId,
    startStage: null,
    kind: null,
    createdAt: detail.run.createdAt,
    updatedAt: detail.run.createdAt,
  };
  data.requests = [request];
  data.runs = [detail.run];
  data.activeDetail = detail;
  ui.activeTaskRequestId = request.id;
  ui.activeRunId = detail.run.id;
  return { detail, request };
}

/**
 * Puts a detail on the wire the way `renderTaskDetailPage` expects to find it:
 * an active request pointing at the run, plus the ui selection. Request status
 * is derived from the run so the hero and the side panel agree.
 */
function installTaskDetail(detail: RunDetail): WorkflowRequestDto {
  const request: WorkflowRequestDto = {
    id: `wreq_${detail.run.id}`,
    projectId: detail.run.projectId,
    type: 'feature',
    title: detail.run.title,
    branch: detail.run.sourceBranch,
    status: detail.run.status === 'failed' ? 'failed' : 'claimed',
    claimedBy: 'runner@test',
    workflowRunId: detail.run.id,
    error: null,
    agentBackend: null,
    flowId: detail.run.flowId,
    startStage: null,
    kind: null,
    createdAt: detail.run.createdAt,
    updatedAt: detail.run.createdAt,
  };
  data.requests = [request];
  data.runs = [detail.run];
  data.activeDetail = detail;
  ui.activeTaskRequestId = request.id;
  ui.activeRunId = detail.run.id;
  return request;
}

/**
 * A `skill.review` output pair, shaped the way the runner really posts it.
 *
 * Metadata keys are copied from the writer, not from the reader's wish list:
 * `metadataForStageOutput` (apps/runner/src/orchestrator/steps.ts:1736) always
 * writes `{ skill, output, stage }`, and for a `.json` output additionally
 * `structured: true` plus `schemaVersion` read out of the file body itself.
 * `skill.review` declares `review.md` before `review-verdict.json`
 * (apps/runner/src/skills/index.ts), so the verdict is the newer artifact.
 */
function reviewOutputs(verdict: ReviewerVerdict): {
  markdown: RunDetail['artifacts'][number];
  verdictArtifact: RunDetail['artifacts'][number];
  verdictText: string;
} {
  return {
    markdown: {
      id: 'art_review_md',
      kind: 'other',
      stepRunId: 'step_review',
      uri: 'file:///tmp/review.md',
      createdAt: '2026-06-29T00:00:03.000Z',
      contentType: 'text/markdown',
      sha256: 'review-md-sha',
      metadata: { skill: 'skill.review', output: 'review.md', stage: 'review' },
    },
    verdictArtifact: {
      id: 'art_review_verdict',
      kind: 'other',
      stepRunId: 'step_review',
      uri: 'file:///tmp/review-verdict.json',
      createdAt: '2026-06-29T00:00:04.000Z',
      contentType: 'application/json',
      sha256: 'review-verdict-sha',
      metadata: {
        skill: 'skill.review',
        output: 'review-verdict.json',
        stage: 'review',
        structured: true,
        schemaVersion: 'ainp.review_verdict.v1',
      },
    },
    verdictText: JSON.stringify(verdict, null, 2),
  };
}

/** Loads an artifact body into the SPA cache the way `loadArtifact` would. */
function cacheArtifactText(artifact: RunDetail['artifacts'][number], text: string): void {
  artifactContent.set(artifact.id, {
    artifact,
    text,
    contentType: artifact.contentType ?? 'application/json',
    filename: String(artifact.metadata?.output ?? 'artifact'),
    digest: {
      algorithm: 'sha256',
      expected: artifact.sha256,
      actual: artifact.sha256,
      verified: true,
    },
  });
}

/** A `status: 'fail'` verdict that the strict shared parser accepts. */
function failingVerdict(): ReviewerVerdict {
  return {
    schemaVersion: 'ainp.review_verdict.v1',
    role: 'reviewer',
    status: 'fail',
    summary: 'Gate wiring lands, but the new rule can be bypassed.',
    blocking: [
      {
        id: 'B2',
        severity: 'major',
        summary: 'Legacy review path is not flagged as degraded.',
        location: null,
        evidenceRefs: [],
      },
      {
        id: 'B1',
        severity: 'blocker',
        summary: 'Agent verdict status can still short-circuit the gate.',
        location: 'apps/api/src/gate-engine.ts:780',
        evidenceRefs: [{ artifactId: 'art_design', claim: 'gate rule table' }],
      },
    ],
    remediation: [
      {
        blockerId: 'B1',
        action: 'Derive the rule status from evidence instead of verdict.status.',
        rationale: 'ADR-2 keeps the Gate Engine the only state judge.',
      },
    ],
    advisory: ['Consider naming the legacy branch in the rule message.', 'Add a fixture for role=verifier.'],
    evidenceRefs: [{ artifactId: 'art_design', claim: 'reviewed design doc' }],
    provenance: {
      agentSessionId: null,
      backend: 'claude_code',
      skillId: 'skill.review',
      producedAt: '2026-06-29T00:00:04.000Z',
    },
    unavailableReason: null,
  };
}

/** Moves a detail into the review stage and attaches the review step. */
function atReviewStage(detail: RunDetail, status: RunDetail['run']['status']): RunDetail {
  detail.run = { ...detail.run, currentStage: 'review', status };
  detail.steps.push({ id: 'step_review', stage: 'review', name: 'review', status: 'passed' });
  return detail;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('task-detail reviewer rendering', () => {
  afterEach(() => {
    document.body.replaceChildren();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    data.projects = [];
    data.runners = [];
    data.requests = [];
    data.runs = [];
    data.activeDetail = null;
    data.runnerControl = null;
    artifactContent.clear();
    contextGovernanceByRun.clear();
    ui.activeTaskRequestId = null;
    ui.activeRunId = null;
    ui.lastError = null;
  });

  it('renders lifecycle stages as compact timeline nodes', () => {
    const detail = reviewerDetail();
    const panel = renderStageTimeline(detail, buildRunProjection(detail));

    expect(panel.querySelector('.stage-timeline')).not.toBeNull();
    expect(panel.querySelector('.stage-board')).toBeNull();
    expect(panel.querySelectorAll('.stage-node').length).toBeGreaterThan(1);
    expect(panel.querySelector('.stage-node.blocked')?.textContent).toContain('方案设计');
    expect(panel.textContent).toContain('阶段时间线');
  });

  it('puts evidence summary before collapsed raw diagnostics', () => {
    const panel = renderEvidencePanel(reviewerDetail());

    expect(panel.querySelector('.evidence-summary-grid')).not.toBeNull();
    expect(panel.textContent).toContain('证据摘要');
    expect(panel.textContent).toContain('质量门禁');
    expect(panel.textContent).toContain('1 项需关注');
    const diagnostics = panel.querySelector<HTMLDetailsElement>('details[data-details-key="evidence-panel:run_review"]');
    expect(diagnostics).not.toBeNull();
    expect(diagnostics?.open).toBe(false);
    expect(panel.querySelector('.evidence-summary-grid')?.compareDocumentPosition(diagnostics!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('renders the paused run status consistently in the task detail hero', () => {
    installPausedTaskDetail();

    const page = renderTaskDetailPage();
    const statusRow = [...page.querySelectorAll<HTMLElement>('.task-technical-summary .field-row')]
      .find((row) => row.querySelector('.field-label')?.textContent === '状态');
    const pauseEvidence = [...page.querySelectorAll<HTMLElement>('.checkpoint li')]
      .map((item) => item.textContent);

    expect(statusRow?.lastElementChild?.textContent).toBe('已暂停（运维）');
    expect(pauseEvidence).toContain('暂停原因：Agent 后端执行超时');
    expect(pauseEvidence).toContain('详情：claude timed out');
  });

  it('resumes a paused run through retry-step then retry-run at currentStage', async () => {
    const { detail, request } = installPausedTaskDetail();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/api/workflow-runs/${detail.run.id}/retry-step`)) {
        return jsonResponse({ ok: true });
      }
      if (url.endsWith('/api/runner/control/retry-run')) {
        return jsonResponse({ ok: true, pid: 123 });
      }
      if (url.endsWith(`/api/workflow-runs/${detail.run.id}`)) return jsonResponse(detail);
      if (url.endsWith(`/api/workflow-runs/${detail.run.id}/context`)) return jsonResponse({});
      if (url.endsWith('/api/health')) return jsonResponse({ ok: true, counts: {} });
      if (url.endsWith('/api/projects')) return jsonResponse({ items: [] });
      if (url.endsWith('/api/runners')) return jsonResponse({ items: [] });
      if (url.endsWith('/api/workflow-requests')) return jsonResponse({ items: [request] });
      if (url.endsWith('/api/workflow-runs')) return jsonResponse({ items: [detail.run] });
      if (url.endsWith('/api/runner/control/status')) return jsonResponse(null);
      return jsonResponse({ error: `unexpected ${url}` }, 404);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const page = renderTaskDetailPage();
    const resume = [...page.querySelectorAll<HTMLButtonElement>('button')]
      .find((candidate) => candidate.textContent === '恢复运行');
    expect(resume).toBeDefined();
    resume?.click();
    await flushAsync();
    await flushAsync();

    const mutationCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(mutationCalls.map(([input]) => String(input))).toEqual([
      `/api/workflow-runs/${detail.run.id}/retry-step`,
      '/api/runner/control/retry-run',
    ]);
    expect(JSON.parse(String(mutationCalls[0]?.[1]?.body))).toEqual({
      stage: detail.run.currentStage,
      actor: 'web',
    });
    expect(JSON.parse(String(mutationCalls[1]?.[1]?.body))).toEqual({
      workflowRunId: detail.run.id,
      stage: detail.run.currentStage,
    });
  });

  it('renders the same persisted acceptance matrix in the main panel and approval preview', () => {
    const detail = reviewerDetail();
    detail.run = { ...detail.run, currentStage: 'review', status: 'awaiting_human' };
    detail.steps.push({ id: 'step_review', stage: 'review', name: 'review', status: 'passed' });
    detail.gates.push({
      id: 'gate_acceptance',
      gateId: 'acceptance_gate',
      stepRunId: null,
      status: 'pass',
      decidedAt: '2026-06-29T00:00:01.000Z',
      ruleResults: [],
    });
    const matrixArtifact = {
      id: 'art_acceptance_matrix',
      kind: 'other' as const,
      stepRunId: 'step_review',
      uri: 'file:///tmp/verifier-ac-matrix.json',
      createdAt: '2026-06-29T00:00:02.000Z',
      contentType: 'application/json',
      sha256: 'matrix-sha',
      metadata: {
        schemaVersion: 'ainp.verifier_ac_matrix.v1',
        reportKind: 'verifier_ac_matrix',
        verifierArtifactType: 'ac_matrix',
      },
    };
    detail.artifacts.push(matrixArtifact);
    artifactContent.set(matrixArtifact.id, {
      artifact: matrixArtifact,
      text: JSON.stringify({
        schemaVersion: 'ainp.verifier_ac_matrix.v1',
        acceptanceCriteria: [{
          id: 'AC-007',
          text: 'Invalid configuration keeps captcha enabled.',
          scenarioType: 'exception',
          verificationMethod: 'Browser fixture submits an invalid configuration.',
          businessStatus: 'failed',
          status: 'pass',
          evidenceRefs: [{ artifactId: 'art_browser_fixture', claim: 'invalid config browser result' }],
          risk: 'Safe fallback was not observed.',
        }],
      }),
      contentType: 'application/json',
      filename: 'verifier-ac-matrix.json',
      digest: {
        algorithm: 'sha256',
        expected: 'matrix-sha',
        actual: 'matrix-sha',
        verified: true,
      },
    });
    const request: WorkflowRequestDto = {
      id: 'wreq_acceptance_matrix',
      projectId: detail.run.projectId,
      type: 'feature',
      title: detail.run.title,
      branch: detail.run.sourceBranch,
      status: 'awaiting_human',
      claimedBy: 'runner@test',
      workflowRunId: detail.run.id,
      error: null,
      agentBackend: null,
      flowId: detail.run.flowId,
      startStage: null,
      kind: null,
      createdAt: detail.run.createdAt,
      updatedAt: detail.run.createdAt,
    };
    data.requests = [request];
    data.runs = [detail.run];
    data.activeDetail = detail;
    ui.activeTaskRequestId = request.id;
    ui.activeRunId = detail.run.id;

    const page = renderTaskDetailPage();
    const mainRow = page.querySelector<HTMLElement>('.workspace-main .acceptance-card');
    const previewRow = page.querySelector<HTMLElement>('.desktop-next-action .acceptance-card');

    for (const row of [mainRow, previewRow]) {
      expect(row).not.toBeNull();
      expect(row?.classList.contains('failed')).toBe(true);
      expect(row?.textContent).toContain('失败');
      expect(row?.textContent).toContain('场景: exception');
      expect(row?.textContent).toContain('验证方法: Browser fixture submits an invalid configuration.');
      expect(row?.textContent).toContain('invalid config browser result (art_browser_fixture)');
      expect(row?.textContent).toContain('风险: Safe fallback was not observed.');
    }
  });

  it('renders the graph live view and hides it for runs without a graph', () => {
    const { detail } = installPausedTaskDetail();

    // No graph on the wire (legacy run): the whole block stays hidden.
    expect(renderTaskDetailPage().querySelector('.graph-live-panel')).toBeNull();
    expect(renderTaskDetailPage().querySelector('.graph-live-summary')).toBeNull();

    const nodeIds = ['node:0:implementation', 'node:1:build_test'];
    detail.graph = {
      graphDefinition: {
        id: 'gdef_render_v1',
        schemaVersion: 'ainp.graph_runtime.v1',
        version: '1',
        sourceFlowId: 'feature.fastforward',
        description: 'Two-node graph',
        nodes: nodeIds.map((id, index) => ({
          id,
          stage: index === 0 ? 'implementation' : 'build_test',
          kind: 'agent',
          skillId: null,
          label: index === 0 ? '代码实现' : '构建测试',
          inputSelectors: [],
          outputNames: [],
          retryPolicy: { maxAttempts: 2, backoff: 'none' },
          resumePolicy: 'new_attempt',
          failurePolicy: 'fail_fast',
          joinPolicy: 'none',
          metadata: {},
        })),
        edges: [{
          id: 'edge_0',
          fromNodeId: nodeIds[0]!,
          toNodeId: nodeIds[1]!,
          mode: 'all_success',
          condition: null,
          metadata: {},
        }],
        entryNodeIds: [nodeIds[0]!],
        createdAt: '2026-07-26T00:00:00.000Z',
        metadata: {},
      },
      graphRun: {
        id: 'grun_render',
        workflowRunId: detail.run.id,
        graphDefinitionId: 'gdef_render_v1',
        graphVersion: '1',
        status: 'running',
        activeNodeIds: [nodeIds[1]!],
        interruptedReason: null,
        createdAt: '2026-07-26T00:00:00.000Z',
        updatedAt: '2026-07-26T00:00:02.000Z',
        metadata: {},
      },
      nodeRuns: [
        {
          id: 'gnr_impl_1',
          graphRunId: 'grun_render',
          workflowRunId: detail.run.id,
          nodeId: nodeIds[0]!,
          attempt: 2,
          status: 'failed',
          stepRunId: 'step_design',
          stepCheckpointId: 'checkpoint_design',
          resumeCursor: 'graph://resume/implementation',
          idempotencyKey: 'grun_render:impl:2',
          dependencyState: { upstreamNodeIds: [], satisfiedNodeIds: [], blockedNodeIds: [] },
          startedAt: '2026-07-26T00:00:00.500Z',
          completedAt: '2026-07-26T00:00:01.000Z',
          metadata: { error: 'diff_scope_gate failed' },
        },
        {
          id: 'gnr_build_1',
          graphRunId: 'grun_render',
          workflowRunId: detail.run.id,
          nodeId: nodeIds[1]!,
          attempt: 1,
          status: 'running',
          stepRunId: null,
          stepCheckpointId: null,
          resumeCursor: null,
          idempotencyKey: 'grun_render:build:1',
          dependencyState: {
            upstreamNodeIds: [nodeIds[0]!],
            satisfiedNodeIds: [],
            blockedNodeIds: [],
          },
          startedAt: '2026-07-26T00:00:01.500Z',
          completedAt: null,
          metadata: {},
        },
      ],
      events: [{
        id: 'gevt_1',
        graphRunId: 'grun_render',
        workflowRunId: detail.run.id,
        nodeId: nodeIds[0]!,
        type: 'node_finished',
        createdAt: '2026-07-26T00:00:01.000Z',
        payload: { status: 'failed', graphRunStatus: 'failed' },
      }],
    };

    const page = renderTaskDetailPage();
    const summary = page.querySelector<HTMLElement>('.graph-live-summary');
    const panel = page.querySelector<HTMLElement>('.graph-live-panel');

    expect(summary?.textContent).toContain('节点 1/2');
    expect(summary?.textContent).toContain('进行中：构建测试');
    expect(summary?.textContent).toContain('首要阻塞：代码实现 — diff_scope_gate failed');
    expect(summary?.textContent).toContain('可从 代码实现 恢复');
    expect(panel?.textContent).toContain('执行图');
    expect(panel?.querySelectorAll('.graph-node-row').length).toBe(2);
    expect(panel?.textContent).toContain('attempt 2');
    expect(panel?.textContent).toContain('依赖 代码实现');
    // Node statuses use the same Chinese labels as the panel header.
    expect(panel?.textContent).toContain('已失败');
    expect(panel?.textContent).toContain('执行中');
    expect(panel?.textContent).not.toContain('"graphRunStatus"');
    // Event payloads render as a whitelisted field list, not a raw JSON dump.
    expect(panel?.textContent).toContain('status=failed');
    expect(panel?.querySelector('details[data-details-key="graph-events:run_review"]')).not.toBeNull();
    // Read-only: the live view must not add a graph mutation control.
    expect(panel?.querySelector('button')).toBeNull();
  });

  it('shows the gate rule message next to each rule, and nothing when there is none', () => {
    const detail = reviewerDetail();
    detail.run = { ...detail.run, status: 'running' };
    const designGate = detail.gates.find((gate) => gate.gateId === 'design_gate')!;
    designGate.status = 'fail';
    designGate.ruleResults = [
      { ruleId: 'design.test_strategy_present', status: 'warn', message: 'Needs sharper test plan' },
      { ruleId: 'design.risks_present', status: 'fail', message: 'Risks section lists no mitigation' },
      // A rule that decided nothing worth saying: no message element at all,
      // rather than an empty one taking up a row.
      { ruleId: 'design.doc_present', status: 'pass', message: '' },
    ];
    installTaskDetail(detail);

    const rows = [...renderTaskDetailPage().querySelectorAll<HTMLElement>('.current-stage-panel .rule-row')];
    expect(rows.length).toBe(3);

    const [warned, failed, silent] = rows;
    // Label + status pill are unchanged; the message is the new third slot.
    expect(warned?.querySelector('span')?.textContent).toBe('测试策略 (design.test_strategy_present)');
    expect(warned?.querySelector('.pill')?.textContent).toBe('warn');
    expect(warned?.querySelector('small')?.textContent).toBe('Needs sharper test plan');
    expect(warned?.querySelector('small')?.classList.contains('warn')).toBe(false);

    expect(failed?.querySelector('small')?.textContent).toBe('Risks section lists no mitigation');
    // Only a failing rule paints its message as a warning.
    expect(failed?.querySelector('small')?.classList.contains('warn')).toBe(true);

    expect(silent?.querySelector('small')).toBeNull();
    expect(silent?.textContent).toBe('设计文档存在 (design.doc_present)pass');
  });

  it('renders the reviewer verdict and hides it for runs without one', () => {
    const detail = atReviewStage(reviewerDetail(), 'awaiting_human');
    installTaskDetail(detail);

    // Pre-verdict run: no empty shell, no placeholder.
    expect(renderTaskDetailPage().querySelector('.review-verdict')).toBeNull();

    const verdict = failingVerdict();
    const outputs = reviewOutputs(verdict);
    detail.artifacts.push(outputs.markdown, outputs.verdictArtifact);
    cacheArtifactText(outputs.verdictArtifact, outputs.verdictText);

    const block = renderTaskDetailPage().querySelector<HTMLElement>('.review-verdict');
    expect(block).not.toBeNull();
    expect(block?.textContent).toContain('评审裁决');
    expect(block?.querySelector('.pill.bad')?.textContent).toBe('不通过');
    // The verdict is opinion, not gate state — the UI has to say so.
    expect(block?.textContent).toContain('仅为评审意见，门禁状态由 Gate Engine 判定');
    expect(block?.textContent).toContain('Gate wiring lands, but the new rule can be bypassed.');

    const cards = [...block!.querySelectorAll<HTMLElement>('.acceptance-card')];
    expect(cards.length).toBe(2);
    // Severity drives the card treatment: blocker reads as failed, major as at-risk.
    expect(cards[0]?.classList.contains('at_risk')).toBe(true);
    expect(cards[1]?.classList.contains('failed')).toBe(true);

    const [major, blocker] = cards;
    expect(blocker?.textContent).toContain('B1');
    expect(blocker?.textContent).toContain('blocker');
    expect(blocker?.textContent).toContain('Agent verdict status can still short-circuit the gate.');
    expect(blocker?.textContent).toContain('位置: apps/api/src/gate-engine.ts:780');
    expect(blocker?.textContent).toContain('修复建议: Derive the rule status from evidence instead of verdict.status.');
    expect(blocker?.textContent).toContain('理由: ADR-2 keeps the Gate Engine the only state judge.');
    expect(blocker?.textContent).toContain('证据: gate rule table (art_design)');

    // A blocker with neither remediation nor evidence says so out loud instead
    // of rendering a blank line.
    expect(major?.textContent).toContain('位置: 未标注');
    expect(major?.textContent).toContain('修复建议: 缺失');
    expect(major?.textContent).toContain('证据: 缺失');

    const advisory = block?.querySelector<HTMLDetailsElement>('details.evidence-group');
    // `renderDetails` counts the elements it was handed, and it is handed one
    // <ul> — so the header reads (1) for two advisories. Pinned as-is; see the
    // task report for the follow-up.
    expect(advisory?.querySelector('summary')?.textContent).toBe('建议（非阻塞） (1)');
    expect(advisory?.querySelectorAll('li').length).toBe(2);
    expect(advisory?.textContent).toContain('Consider naming the legacy branch in the rule message.');
    expect(advisory?.textContent).toContain('Add a fixture for role=verifier.');

    expect(block?.textContent).toContain('整体证据：reviewed design doc (art_design)');
  });

  it('keeps the verdict block hidden while the body is unloaded or unparseable', () => {
    const detail = atReviewStage(reviewerDetail(), 'awaiting_human');
    const outputs = reviewOutputs(failingVerdict());
    detail.artifacts.push(outputs.markdown, outputs.verdictArtifact);
    installTaskDetail(detail);

    // Artifact is on the wire but its body has not been fetched yet.
    expect(renderTaskDetailPage().querySelector('.review-verdict')).toBeNull();

    // Body arrives but does not satisfy the schema: the strict shared parser
    // rejects it, so the SPA shows nothing rather than a half-read verdict.
    cacheArtifactText(outputs.verdictArtifact, JSON.stringify({
      ...failingVerdict(),
      schemaVersion: 'ainp.review_verdict.v0',
    }));
    expect(renderTaskDetailPage().querySelector('.review-verdict')).toBeNull();

    cacheArtifactText(outputs.verdictArtifact, outputs.verdictText);
    expect(renderTaskDetailPage().querySelector('.review-verdict')).not.toBeNull();
  });

  it('names the failing rule and the top blocker in the failed-stage side panel', () => {
    const detail = atReviewStage(reviewerDetail(), 'failed');
    detail.gates.push({
      id: 'gate_acceptance',
      gateId: 'acceptance_gate',
      stepRunId: 'step_review',
      status: 'fail',
      decidedAt: '2026-06-29T00:00:05.000Z',
      ruleResults: [
        { ruleId: 'acceptance.review_present', status: 'pass', message: 'review verdict present (art_review_verdict)' },
        {
          ruleId: 'acceptance.review_verdict_actionable',
          status: 'fail',
          message: 'reviewer blocker(s) without remediation: B2',
        },
        { ruleId: 'acceptance.test_gate_passed', status: 'fail', message: '' },
      ],
    });
    const outputs = reviewOutputs(failingVerdict());
    detail.artifacts.push(outputs.markdown, outputs.verdictArtifact);
    cacheArtifactText(outputs.verdictArtifact, outputs.verdictText);
    installTaskDetail(detail);

    const panel = renderTaskDetailPage().querySelector<HTMLElement>('.desktop-next-action');
    const reasons = [...panel!.querySelectorAll<HTMLElement>('li')].map((item) => item.textContent);

    // One line per failing rule, each carrying the Gate Engine's own message.
    expect(reasons).toContain('质量门禁失败：评审裁决可执行 (acceptance.review_verdict_actionable) — reviewer blocker(s) without remediation: B2');
    // A failing rule with no message degrades to the bare label, not a dangling dash.
    expect(reasons).toContain('质量门禁失败：acceptance.test_gate_passed');
    // Passing rules stay out of the failure list.
    expect(reasons.some((line) => line?.includes('acceptance.review_present'))).toBe(false);
    // Pre-existing non-gate reasons still render alongside.
    expect(reasons).toContain('命令执行失败 (exit 1)：bun test apps/web/test');

    expect(panel?.textContent).toContain('首要阻塞项');
    // B2 comes first in the array, but severity wins: the blocker is promoted.
    expect(panel?.querySelector('.pill.bad')?.textContent).toBe('B1');
    expect(panel?.textContent).toContain('Agent verdict status can still short-circuit the gate.');
    expect(panel?.textContent).toContain('位置: apps/api/src/gate-engine.ts:780');
    expect(panel?.textContent).toContain('修复建议: Derive the rule status from evidence instead of verdict.status.');
    expect(panel?.textContent).toContain('证据: gate rule table (art_design)');
    expect(panel?.textContent).not.toContain('Legacy review path is not flagged as degraded.');
  });

  it('labels a reviewer_unavailable pause as a non-quality operational stop', () => {
    const { detail } = installPausedTaskDetail();
    detail.audit = [{
      id: 'audit_pause',
      workflowRunId: detail.run.id,
      kind: 'workflow_run.paused',
      payload: { reason: 'reviewer_unavailable', detail: 'diff artifact was unreadable' },
      at: '2026-07-26T00:00:00.000Z',
    }];

    const evidence = [...renderTaskDetailPage().querySelectorAll<HTMLElement>('.checkpoint li')]
      .map((item) => item.textContent);

    expect(evidence).toContain('暂停原因：评审无法给出裁决（不是质量问题）');
    expect(evidence).toContain('详情：diff artifact was unreadable');
  });

  it('shows the review markdown under 查看 Review 原文, never the verdict JSON', () => {
    const detail = atReviewStage(reviewerDetail(), 'awaiting_human');
    const outputs = reviewOutputs(failingVerdict());
    // Both are kind='other' and the verdict is the NEWER one (skill.review
    // declares review.md first), so selecting "latest of kind" would surface
    // the JSON here. Selection must key on metadata.output instead.
    detail.artifacts.push(outputs.markdown, outputs.verdictArtifact);
    cacheArtifactText(outputs.markdown, '# Review\n\n未通过：缺少超时重试的边界用例。');
    cacheArtifactText(outputs.verdictArtifact, outputs.verdictText);
    installTaskDetail(detail);

    const raw = [...renderTaskDetailPage().querySelectorAll<HTMLElement>('.raw-details')]
      .find((node) => node.querySelector('summary')?.textContent === '查看 Review 原文');
    const body = raw?.querySelector('pre')?.textContent ?? '';

    expect(body).toContain('未通过：缺少超时重试的边界用例。');
    expect(body).not.toContain('schemaVersion');
    expect(body).not.toContain('ainp.review_verdict.v1');
  });
});
