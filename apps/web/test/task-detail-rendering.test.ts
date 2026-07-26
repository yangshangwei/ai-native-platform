import { Window } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildRunProjection, type RunDetail } from '../src/projection';
import { renderEvidencePanel, renderStageTimeline, renderTaskDetailPage } from '../src/page-task-detail';
import { artifactContent, contextGovernanceByRun, data, ui } from '../src/state';
import type { WorkflowRequestDto } from '../src/types';

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
});
