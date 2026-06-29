import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { buildRunProjection, type RunDetail } from '../src/projection';
import { renderEvidencePanel, renderStageTimeline } from '../src/page-task-detail';

const testWindow = new Window();
globalThis.window = testWindow as unknown as Window & typeof globalThis;
globalThis.document = testWindow.document as unknown as Document;
globalThis.HTMLElement = testWindow.HTMLElement;
globalThis.HTMLDetailsElement = testWindow.HTMLDetailsElement;
globalThis.Node = testWindow.Node;

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

describe('task-detail reviewer rendering', () => {
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
});
