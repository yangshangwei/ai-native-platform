// @vitest-environment happy-dom
//
// DOM/render coverage for the Context Flow panel (PRD req 8 + DoD). The pure
// view-model is already covered by `projection.test.ts`; this file protects the
// task-detail integration: stable disclosure key, stage/artifact/relation DOM,
// the context-governance loading vs. loaded branches, and the empty state.
import { Window } from 'happy-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { renderContextFlowPanel, renderContextGovernancePanel } from '../src/page-task-detail';
import { contextGovernanceByRun } from '../src/state';
import type { RunDetail } from '../src/projection';
import type { ContextGovernanceDto } from '../src/types';

const testWindow = new Window();
globalThis.window = testWindow as unknown as Window & typeof globalThis;
globalThis.document = testWindow.document as unknown as Document;
globalThis.HTMLElement = testWindow.HTMLElement;
globalThis.HTMLDetailsElement = testWindow.HTMLDetailsElement;

function stageFlowDetail(): RunDetail {
  return {
    run: {
      id: 'run_flow',
      title: 'Context flow',
      type: 'feature',
      status: 'running',
      currentStage: 'design',
      flowId: 'feature.standard',
      startStage: null,
      sourceBranch: 'main',
      branch: 'ai/run_flow-context',
      workspacePath: '/tmp/worktree',
      projectId: 'proj_1',
      createdAt: '2026-05-01T00:00:00.000Z',
    },
    steps: [
      { id: 'step_req', stage: 'requirement', name: 'requirement', status: 'passed' },
      { id: 'step_design', stage: 'design', name: 'design', status: 'running' },
    ],
    commands: [],
    toolInvocations: [],
    gates: [],
    artifacts: [
      { id: 'art_context', kind: 'context_pack', stepRunId: null, uri: 'file:///tmp/context-pack.json', createdAt: '2026-05-01T00:00:00.001Z', contentType: 'application/json', metadata: { output: 'context-pack.json' } },
      { id: 'art_req', kind: 'requirement_draft', stepRunId: 'step_req', uri: 'file:///tmp/requirement.md', createdAt: '2026-05-01T00:00:00.002Z', contentType: 'text/markdown', metadata: { output: 'requirement.md' } },
      { id: 'art_design', kind: 'design_doc', stepRunId: 'step_design', uri: 'file:///tmp/design.md', createdAt: '2026-05-01T00:00:00.003Z', contentType: 'text/markdown', metadata: { output: 'design.md' } },
    ],
    builds: [],
    tests: [],
    approvals: [],
    actions: [],
    agentTasks: [
      { id: 'task_req', stepRunId: 'step_req', kind: 'requirement_draft', backend: 'codex', inputArtifactIds: ['art_context'], createdAt: '2026-05-01T00:00:00.004Z' },
      { id: 'task_design', stepRunId: 'step_design', kind: 'design_draft', backend: 'codex', inputArtifactIds: ['art_req'], createdAt: '2026-05-01T00:00:00.005Z' },
    ],
    agentResults: [
      { id: 'result_req', taskId: 'task_req', status: 'success', summary: 'requirement', outputArtifactIds: ['art_req'], completedAt: '2026-05-01T00:00:00.006Z' },
      { id: 'result_design', taskId: 'task_design', status: 'success', summary: 'design', outputArtifactIds: ['art_design'], completedAt: '2026-05-01T00:00:00.007Z' },
    ],
    handoffs: [],
    stepCheckpoints: [],
    audit: [],
  };
}

function governanceDetail(): RunDetail {
  return {
    run: {
      id: 'run_governance',
      title: 'Governance flow',
      type: 'feature',
      status: 'running',
      currentStage: 'design',
      flowId: 'feature.standard',
      startStage: null,
      sourceBranch: 'main',
      branch: 'ai/run_governance-context',
      workspacePath: '/tmp/worktree',
      projectId: 'proj_1',
      createdAt: '2026-05-01T00:00:00.000Z',
    },
    steps: [
      { id: 'step_req', stage: 'requirement', name: 'requirement', status: 'passed' },
      { id: 'step_design', stage: 'design', name: 'design', status: 'running' },
    ],
    commands: [],
    toolInvocations: [],
    gates: [],
    artifacts: [
      { id: 'art_handoff', kind: 'other', stepRunId: 'step_req', uri: 'file:///tmp/stage_handoff.requirement.design.md', createdAt: '2026-05-01T00:00:00.001Z', contentType: 'text/markdown', metadata: { output: 'stage_handoff.requirement.design.md' } },
      { id: 'art_base', kind: 'context_pack', stepRunId: null, uri: 'file:///tmp/base-context.json', createdAt: '2026-05-01T00:00:00.002Z', contentType: 'application/json', metadata: { output: 'base-context.json' } },
      { id: 'art_request', kind: 'other', stepRunId: null, uri: 'file:///tmp/context-request.json', createdAt: '2026-05-01T00:00:00.003Z', contentType: 'application/json', metadata: { output: 'context-request.json' } },
      { id: 'art_supplement', kind: 'context_pack', stepRunId: null, uri: 'file:///tmp/supplement-context.json', createdAt: '2026-05-01T00:00:00.004Z', contentType: 'application/json', metadata: { output: 'supplement-context.json' } },
    ],
    builds: [],
    tests: [],
    approvals: [],
    actions: [],
    agentTasks: [
      { id: 'task_design', stepRunId: 'step_design', kind: 'design_draft', backend: 'codex', inputArtifactIds: ['art_base'], createdAt: '2026-05-01T00:00:00.005Z' },
    ],
    agentResults: [],
    handoffs: [
      {
        id: 'handoff_run_detail',
        fromRole: 'main',
        toRole: 'executor',
        reason: 'handoff requirement to design',
        inputArtifactIds: ['art_handoff'],
        status: 'completed',
        adoptionDecision: 'adopted',
        outputArtifactIds: ['art_handoff'],
        createdAt: '2026-05-01T00:00:00.006Z',
        metadata: {
          stageHandoff: {
            schemaVersion: 'ainp.stage_handoff.v1',
            workflowRunId: 'run_governance',
            fromStage: 'requirement',
            toStage: 'design',
            summary: 'Requirement evidence is ready for design.',
            decisions: [],
            risks: [],
            openQuestions: [],
            producedArtifacts: [{ key: 'handoff', artifactId: 'art_handoff', kind: 'other', injectionPreference: 'summary' }],
            createdAt: '2026-05-01T00:00:00.006Z',
          },
        },
      },
    ],
    stepCheckpoints: [
      {
        id: 'checkpoint_design',
        workflowRunId: 'run_governance',
        stepRunId: 'step_design',
        stage: 'design',
        status: 'started',
        retryIndex: 0,
        contextPackId: 'pack_design',
        agentSessionIds: [],
        toolInvocationIds: [],
        inputArtifactIds: ['art_base'],
        outputArtifactIds: [],
        gateRunIds: [],
        commandRunIds: [],
        startedAt: '2026-05-01T00:00:00.007Z',
        completedAt: null,
        failureReason: null,
      },
    ],
    audit: [],
  };
}

function governanceModel(): ContextGovernanceDto {
  return {
    schemaVersion: 'ainp.context_governance.v1',
    workflowRunId: 'run_governance',
    projectId: 'proj_1',
    contextPacks: [
      {
        contextPackId: 'pack_design',
        source: 'artifact.metadata',
        artifactId: 'art_base',
        taskId: 'task_design',
        stage: 'design',
        mode: 'full',
        role: 'base',
        invocationId: 'inv_1',
        retryIndex: 0,
        contextRequestId: 'ctx_req_1',
        baseContextPackId: null,
        baseContextPackArtifactId: null,
        supplement: null,
        manifest: [],
        retrievalHints: [],
        calibrationSignals: [],
        contextPack: null,
      },
    ],
    manifest: [],
    sourceRefs: [],
    trustLevels: {},
    budgetDecisions: [],
    contextRequests: [
      {
        id: 'ctx_req_1',
        actionId: 'act_1',
        status: 'completed',
        priority: 1,
        reason: 'Need design evidence',
        requestedRefs: ['docs/design.md'],
        questions: [],
        sourceName: 'design',
        taskId: 'task_design',
        baseContextPackId: 'pack_base',
        baseContextPackArtifactId: 'art_base',
        supplementContextPackId: 'pack_supplement',
        requestArtifactId: 'art_request',
        supplementArtifactId: 'art_supplement',
        createdAt: '2026-05-01T00:00:00.008Z',
      },
    ],
    stageHandoffs: [
      {
        id: 'handoff_governance',
        artifactId: 'art_handoff',
        fromStage: 'requirement',
        toStage: 'design',
        summary: 'Requirement evidence is ready for design.',
        decisions: [],
        risks: [],
        openQuestions: [],
        producedArtifacts: [{ key: 'handoff', artifactId: 'art_handoff', kind: 'other', injectionPreference: 'summary' }],
        createdAt: '2026-05-01T00:00:00.009Z',
      },
    ],
    metrics: {
      impactCoverage: { value: 1, numerator: 1, denominator: 1, explanation: '' },
      evidenceTraceability: { value: 1, numerator: 1, denominator: 1, explanation: '' },
      irrelevantContextRatio: { value: 0, numerator: 0, denominator: 1, explanation: '' },
      contextRequestCount: { value: 1, explanation: '' },
      downstreamReworkSignal: {
        value: 0,
        rejectedApprovals: 0,
        failedGates: 0,
        failedAgentResults: 0,
        explanation: '',
      },
    },
  };
}

function emptyDetail(): RunDetail {
  return {
    run: {
      id: 'run_empty',
      title: 'Empty flow',
      type: 'feature',
      status: 'running',
      currentStage: 'requirement',
      flowId: 'feature.standard',
      startStage: null,
      sourceBranch: 'main',
      branch: 'ai/run_empty',
      workspacePath: '/tmp/worktree',
      projectId: 'proj_1',
      createdAt: '2026-05-01T00:00:00.000Z',
    },
    steps: [],
    commands: [],
    toolInvocations: [],
    gates: [],
    artifacts: [],
    builds: [],
    tests: [],
    approvals: [],
    actions: [],
    agentTasks: [],
    agentResults: [],
    handoffs: [],
    stepCheckpoints: [],
    audit: [],
  };
}

describe('renderContextFlowPanel', () => {
  afterEach(() => {
    contextGovernanceByRun.clear();
  });

  it('renders a collapsed panel with a stable disclosure key', () => {
    const panel = renderContextFlowPanel(stageFlowDetail());

    expect(panel.classList.contains('context-flow-panel')).toBe(true);
    const shell = panel.querySelector('details[data-details-key="context-flow:run_flow"]');
    expect(shell).not.toBeNull();
    // Collapsed by default so a polling re-render preserves disclosure state.
    expect((shell as HTMLDetailsElement).open).toBe(false);
  });

  it('renders stage rows, artifact chips, and an artifact-reuse relation', () => {
    const panel = renderContextFlowPanel(stageFlowDetail());

    expect(panel.querySelectorAll('.context-flow-stage').length).toBeGreaterThanOrEqual(2);
    expect(panel.querySelectorAll('.context-flow-artifact-chip').length).toBeGreaterThan(0);

    const relations = panel.querySelectorAll('.context-flow-relation');
    expect(relations.length).toBeGreaterThan(0);
    expect(panel.textContent).toContain('产物复用');
  });

  it('shows the governance-loading hint when context governance is not yet loaded', () => {
    const panel = renderContextFlowPanel(stageFlowDetail());

    expect(panel.textContent).toContain('上下文治理资料仍在加载');
  });

  it('renders stage-handoff and context-request relations once governance is loaded', () => {
    contextGovernanceByRun.set('run_governance', governanceModel());
    const panel = renderContextFlowPanel(governanceDetail());

    expect(panel.textContent).toContain('阶段交接');
    expect(panel.textContent).toContain('补充上下文请求');
    expect(panel.textContent).toContain('Context Packs');
    // The loading hint must disappear once governance data is present.
    expect(panel.textContent).not.toContain('上下文治理资料仍在加载');
  });

  it('renders an explicit empty state for a run with no flow evidence', () => {
    const panel = renderContextFlowPanel(emptyDetail());

    expect(panel.querySelectorAll('.context-flow-relation').length).toBe(0);
    expect(panel.textContent).toContain('0 关系');
    expect(panel.textContent).toContain('等待上下文治理资料');
  });

  it('renders knowledge review calibration signal details in the governance panel', () => {
    const model = governanceModel();
    model.contextPacks[0]?.calibrationSignals.push({
      id: 'signal_capability_drift',
      kind: 'stale',
      severity: 'review_required',
      recommendedAction: 'mark_stale_or_supersede',
      message: 'Accepted correction points at a capability that the current project inventory no longer contains.',
      subjectRefs: [
        'knowledge_artifact:kart_eval_cap_orders_rename_drift',
        'capability:cap_api_orders',
      ],
      evidenceRefs: [
        'artifact:art_eval_current_inventory_without_orders',
        'artifact:art_eval_legacy_inventory',
        'file:apps/api/src/orders-route.ts#L12',
      ],
    });
    contextGovernanceByRun.set('run_governance', model);

    const panel = renderContextGovernancePanel(governanceDetail());

    expect(panel.textContent).toContain('校准信号');
    expect(panel.textContent).toContain('Knowledge Review Signals (1)');
    expect(panel.textContent).toContain('review_required');
    expect(panel.textContent).toContain('stale');
    expect(panel.textContent).toContain('mark_stale_or_supersede');
    expect(panel.textContent).toContain('knowledge_artifact:kart_eval_cap_orders_rename_drift');
    expect(panel.textContent).toContain('file:apps/api/src/orders-route.ts#L12');
  });
});
