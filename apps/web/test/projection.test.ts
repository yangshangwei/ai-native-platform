import { describe, expect, it } from 'vitest';
import {
  USER_VISIBLE_STAGES,
  artifactViewerScrollKey,
  buildContextFlowProjection,
  buildRunProjection,
  isReadableFileArtifact,
  latestArtifactOfKind,
  reportIsAcceptable,
  reportStats,
  reportStatusLabel,
  stagesForRun,
  visibleStagesForRun,
  type WorkflowRunDto,
} from '../src/projection';

describe('web workflow run projection', () => {
  it('marks the current awaiting-human stage as blocked with the matching approval gate', () => {
    const projection = buildRunProjection({
      run: {
        id: 'run_1',
        title: 'Add export flow',
        type: 'feature',
        status: 'awaiting_human',
        currentStage: 'design',
        flowId: 'feature.standard',
        startStage: null,
        sourceBranch: 'main',
        branch: 'ai/run_1-export',
        workspacePath: '/tmp/worktree',
        projectId: 'proj_1',
        createdAt: '2026-05-01T00:00:00.000Z',
      },
      steps: [{ id: 'step_req', stage: 'requirement', name: 'requirement', status: 'passed' }],
      commands: [],
      gates: [{ id: 'gate_design', gateId: 'design_gate', stepRunId: null, status: 'pass', decidedAt: '', ruleResults: [] }],
      artifacts: [],
      builds: [],
      tests: [],
      approvals: [],
      actions: [],
      agentTasks: [],
      agentResults: [],
      audit: [],
    });

    expect(projection.pendingGate).toBe('design_gate');
    expect(projection.stages.find((s) => s.id === 'requirement')?.state).toBe('done');
    expect(projection.stages.find((s) => s.id === 'design')?.state).toBe('blocked');
  });

  it('summarizes build/test and gate evidence for the operator header', () => {
    const projection = buildRunProjection({
      run: {
        id: 'run_2',
        title: 'Fix tests',
        type: 'feature',
        status: 'passed',
        currentStage: 'completion',
        flowId: 'feature.standard',
        startStage: null,
        sourceBranch: 'main',
        branch: 'ai/run_2-tests',
        workspacePath: '/tmp/worktree',
        projectId: 'proj_1',
        createdAt: '2026-05-01T00:00:00.000Z',
      },
      steps: [],
      commands: [{ id: 'cmd_1', stepRunId: null, cwd: '/tmp/worktree', command: 'mvn -B test', stage: 'test', status: 'passed', exitCode: 0, durationMs: 12, stdoutRef: '', stderrRef: '', startedAt: '', timedOut: false, truncated: false }],
      gates: [
        { id: 'gate_1', gateId: 'requirement_gate', stepRunId: null, status: 'pass', decidedAt: '', ruleResults: [] },
        { id: 'gate_2', gateId: 'sensitive_change_gate', stepRunId: null, status: 'warn', decidedAt: '', ruleResults: [] },
      ],
      artifacts: [],
      builds: [{ id: 'build_1', status: 'passed', jdkVersion: '21', mavenCommand: 'mvn -B test' }],
      tests: [{ framework: 'maven-surefire', total: 3, passed: 3, failed: 0, errors: 0, skipped: 0 }],
      approvals: [],
      actions: [],
      agentTasks: [],
      agentResults: [],
      audit: [],
    });

    expect(projection.summary).toMatchObject({
      commands: 1,
      gatesPassed: 1,
      gatesWarned: 1,
      gatesFailed: 0,
      testsTotal: 3,
      testsPassed: 3,
      buildStatus: 'passed',
    });
  });

  it('treats passed workflow runs as acceptable reports', () => {
    const passedRun: WorkflowRunDto = {
      id: 'run_passed',
      title: 'Shipped task',
      type: 'feature',
      status: 'passed',
      currentStage: 'completion',
      flowId: 'feature.standard',
      startStage: null,
      sourceBranch: 'main',
      branch: 'ai/run_passed-task',
      workspacePath: '/tmp/worktree',
      projectId: 'proj_1',
      createdAt: '2026-05-01T00:00:00.000Z',
    };
    const stats = reportStats([
      passedRun,
      { ...passedRun, id: 'run_failed', status: 'failed' },
      { ...passedRun, id: 'run_running', status: 'running' },
    ]);

    expect(reportIsAcceptable(passedRun)).toBe(true);
    expect(reportStatusLabel('passed')).toBe('可验收');
    expect(stats).toMatchObject({
      total: 3,
      acceptable: 1,
      completed: 1,
      attention: 1,
      running: 1,
      failed: 1,
    });
  });

  it('does not mark stages as done when completion is only a failed terminal override', () => {
    const projection = buildRunProjection({
      run: {
        id: 'run_failed_waiting_requirement',
        title: 'Captcha switch',
        type: 'feature',
        status: 'failed',
        currentStage: 'completion',
        flowId: 'feature.standard',
        startStage: null,
        sourceBranch: 'main',
        branch: 'ai/run_failed_waiting_requirement-task',
        workspacePath: '/tmp/worktree',
        projectId: 'proj_1',
        createdAt: '2026-05-01T00:00:00.000Z',
      },
      steps: [
        { id: 'step_context', stage: 'context_pack', name: 'context_pack', status: 'passed' },
        { id: 'step_req', stage: 'requirement', name: 'requirement', status: 'passed' },
      ],
      commands: [],
      gates: [{ id: 'gate_req', gateId: 'requirement_gate', stepRunId: 'step_req', status: 'pass', decidedAt: '', ruleResults: [] }],
      artifacts: [
        { id: 'art_context', kind: 'context_pack', stepRunId: null, uri: 'file:///context.md', createdAt: '2026-05-01T00:00:00.001Z', contentType: 'text/markdown' },
        { id: 'art_req', kind: 'requirement_draft', stepRunId: null, uri: 'file:///requirement.md', createdAt: '2026-05-01T00:00:00.002Z', contentType: 'text/markdown' },
      ],
      builds: [],
      tests: [],
      approvals: [],
      actions: [],
      agentTasks: [],
      agentResults: [],
      audit: [
        {
          id: 'aud_req_wait',
          kind: 'workflow_run.stage_transition',
          payload: { stage: 'requirement', status: 'awaiting_human' },
          at: '2026-05-01T00:00:00.003Z',
        },
        {
          id: 'aud_failed',
          kind: 'workflow_run.completed',
          payload: { ok: false },
          at: '2026-05-01T00:05:00.000Z',
        },
      ],
    });

    expect(projection.currentStage).toBe('requirement');
    expect(projection.stages.find((s) => s.id === 'context_pack')?.state).toBe('done');
    expect(projection.stages.find((s) => s.id === 'requirement')?.state).toBe('failed');
    expect(projection.stages.find((s) => s.id === 'design')?.state).toBe('waiting');
    expect(projection.stages.find((s) => s.id === 'implementation')?.state).toBe('waiting');
    expect(projection.stages.find((s) => s.id === 'completion')?.state).toBe('waiting');
  });

  it('keeps technical preparation stages out of the user-facing lifecycle', () => {
    expect(USER_VISIBLE_STAGES).toEqual([
      'requirement',
      'design',
      'implementation',
      'build_test',
      'review',
      'completion',
      'knowledge',
    ]);
  });

  it('allows local file artifacts to be opened inline while blocking non-file URIs', () => {
    expect(isReadableFileArtifact({ uri: 'file:///tmp/context_pack.md' })).toBe(true);
    expect(isReadableFileArtifact({ uri: 'https://example.com/context_pack.md' })).toBe(false);
  });

  it('uses a stable scroll key for artifact file previews', () => {
    expect(artifactViewerScrollKey({ id: 'art_123' }, 'stage:requirement')).toBe('artifact:stage:requirement:art_123');
  });

  it('selects the newest artifact of a kind for document panels', () => {
    expect(
      latestArtifactOfKind(
        [
          { id: 'old', kind: 'design_doc', uri: 'file:///old.md', createdAt: '2026-05-01T00:00:00.000Z' },
          { id: 'new', kind: 'design_doc', uri: 'file:///new.md', createdAt: '2026-05-01T00:00:01.000Z' },
          { id: 'req', kind: 'requirement_draft', uri: 'file:///req.md', createdAt: '2026-05-01T00:00:02.000Z' },
        ],
        'design_doc',
      )?.id,
    ).toBe('new');
  });

  it('builds context flow stages from agent task inputs and result outputs', () => {
    const detail = {
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

    const flow = buildContextFlowProjection(detail, null);
    const requirement = flow.stages.find((stage) => stage.id === 'requirement');
    const design = flow.stages.find((stage) => stage.id === 'design');

    expect(requirement?.inputs.map((artifact) => artifact.artifactId)).toEqual(['art_context']);
    expect(requirement?.outputs.map((artifact) => artifact.artifactId)).toEqual(['art_req']);
    expect(design?.inputs.map((artifact) => artifact.artifactId)).toEqual(['art_req']);
    expect(design?.outputs.map((artifact) => artifact.artifactId)).toEqual(['art_design']);
    expect(flow.relations).toContainEqual(expect.objectContaining({
      kind: 'artifact_reuse',
      artifactId: 'art_req',
      fromStage: 'requirement',
      toStage: 'design',
    }));
  });

  it('adds context requests, checkpoints, context packs, and stage handoff relations', () => {
    const detail = {
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
    const governance = {
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

    const flow = buildContextFlowProjection(detail, governance);
    const design = flow.stages.find((stage) => stage.id === 'design');

    expect(design?.contextPacks.map((pack) => pack.contextPackId)).toEqual(['pack_design']);
    expect(design?.checkpoints.map((checkpoint) => checkpoint.contextPackId)).toEqual(['pack_design']);
    expect(flow.relations).toContainEqual(expect.objectContaining({
      kind: 'stage_handoff',
      handoffId: 'handoff_governance',
      fromStage: 'requirement',
      toStage: 'design',
    }));
    expect(flow.relations).toContainEqual(expect.objectContaining({
      kind: 'stage_handoff',
      handoffId: 'handoff_run_detail',
      fromStage: 'requirement',
      toStage: 'design',
    }));
    const contextRequest = flow.relations.find((relation) => relation.kind === 'context_request');
    expect(contextRequest).toMatchObject({
      kind: 'context_request',
      requestId: 'ctx_req_1',
      status: 'completed',
    });
    expect(contextRequest?.kind === 'context_request' ? contextRequest.artifacts.map((item) => item.role) : []).toEqual([
      'base',
      'request',
      'supplement',
    ]);
  });
});

describe('flow-aware lifecycle stages', () => {
  it('shows the feature.fastforward subset (implementation → completion)', () => {
    expect(visibleStagesForRun('feature.fastforward', null)).toEqual([
      'implementation',
      'build_test',
      'review',
      'completion',
    ]);
  });

  it('shows the issue.standard track starting at report', () => {
    expect(visibleStagesForRun('issue.standard', null)).toEqual([
      'report',
      'analyze',
      'implementation',
      'build_test',
      'review',
      'completion',
    ]);
  });

  it('shows the refactor.standard track starting at scan', () => {
    expect(visibleStagesForRun('refactor.standard', null)).toEqual([
      'scan',
      'plan',
      'implementation',
      'build_test',
      'review',
      'completion',
    ]);
  });

  it('drops only context_pack for the standard feature flow', () => {
    expect(stagesForRun('feature.standard', null)).toContain('context_pack');
    expect(visibleStagesForRun('feature.standard', null)).not.toContain('context_pack');
    expect(visibleStagesForRun('feature.standard', null)).toEqual(USER_VISIBLE_STAGES);
  });

  it('slices the flow at startStage', () => {
    expect(visibleStagesForRun('feature.standard', 'implementation')).toEqual([
      'implementation',
      'build_test',
      'review',
      'completion',
      'knowledge',
    ]);
  });

  it('falls back to feature.standard for a missing/unknown flowId', () => {
    expect(stagesForRun(undefined, null)).toEqual(stagesForRun('feature.standard', null));
  });
});

describe('buildRunProjection for non-feature flows', () => {
  it('returns an empty lifecycle for leaked ask runs', () => {
    const projection = buildRunProjection({
      run: {
        id: 'run_ask',
        title: 'Where is routing configured?',
        type: 'ask',
        status: 'running',
        currentStage: 'init',
        flowId: 'feature.standard',
        startStage: null,
        sourceBranch: 'main',
        branch: 'ai/run_ask-question',
        workspacePath: '/tmp/worktree',
        projectId: 'proj_1',
        createdAt: '2026-05-01T00:00:00.000Z',
      },
      steps: [],
      commands: [],
      gates: [],
      artifacts: [],
      builds: [],
      tests: [],
      approvals: [],
      actions: [],
      agentTasks: [],
      agentResults: [],
      audit: [],
    });

    expect(projection.stages).toEqual([]);
    expect(projection.visibleStages).toEqual([]);
    expect(projection.pendingGate).toBeNull();
  });

  it('projects a refactor run against its own stages, not the feature pipeline', () => {
    const projection = buildRunProjection({
      run: {
        id: 'run_refactor',
        title: 'Extract service layer',
        type: 'refactor',
        status: 'running',
        currentStage: 'plan',
        flowId: 'refactor.standard',
        startStage: null,
        sourceBranch: 'main',
        branch: 'ai/run_refactor-extract',
        workspacePath: '/tmp/worktree',
        projectId: 'proj_1',
        createdAt: '2026-05-01T00:00:00.000Z',
      },
      steps: [
        { id: 'step_scan', stage: 'scan', name: 'scan', status: 'passed' },
        { id: 'step_plan', stage: 'plan', name: 'plan', status: 'running' },
      ],
      commands: [],
      gates: [],
      artifacts: [],
      builds: [],
      tests: [],
      approvals: [],
      actions: [],
      agentTasks: [],
      agentResults: [],
      audit: [],
    });

    expect(projection.flowId).toBe('refactor.standard');
    expect(projection.visibleStages.map((s) => s.id)).toEqual([
      'scan',
      'plan',
      'implementation',
      'build_test',
      'review',
      'completion',
    ]);
    expect(projection.stages.find((s) => s.id === 'scan')?.state).toBe('done');
    expect(projection.stages.find((s) => s.id === 'plan')?.state).toBe('active');
    // Feature-only stages must not appear for a refactor run.
    expect(projection.stages.find((s) => s.id === 'requirement')).toBeUndefined();
    expect(projection.stages.find((s) => s.id === 'design')).toBeUndefined();
  });

  it('marks an issue run blocked at its acceptance gate', () => {
    const projection = buildRunProjection({
      run: {
        id: 'run_issue',
        title: 'Fix null pointer',
        type: 'bugfix',
        status: 'awaiting_human',
        currentStage: 'review',
        flowId: 'issue.standard',
        startStage: null,
        sourceBranch: 'main',
        branch: 'ai/run_issue-npe',
        workspacePath: '/tmp/worktree',
        projectId: 'proj_1',
        createdAt: '2026-05-01T00:00:00.000Z',
      },
      steps: [
        { id: 'step_report', stage: 'report', name: 'report', status: 'passed' },
        { id: 'step_analyze', stage: 'analyze', name: 'analyze', status: 'passed' },
        { id: 'step_impl', stage: 'implementation', name: 'implementation', status: 'passed' },
        { id: 'step_review', stage: 'review', name: 'review', status: 'running' },
      ],
      commands: [],
      gates: [{ id: 'g_acc', gateId: 'acceptance_gate', stepRunId: null, status: 'pass', decidedAt: '', ruleResults: [] }],
      artifacts: [],
      builds: [],
      tests: [],
      approvals: [],
      actions: [],
      agentTasks: [],
      agentResults: [],
      audit: [],
    });

    expect(projection.pendingGate).toBe('acceptance_gate');
    expect(projection.stages.find((s) => s.id === 'report')?.state).toBe('done');
    expect(projection.stages.find((s) => s.id === 'review')?.state).toBe('blocked');
  });
});
