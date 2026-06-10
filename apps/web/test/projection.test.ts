import { describe, expect, it } from 'vitest';
import {
  USER_VISIBLE_STAGES,
  artifactViewerScrollKey,
  buildRunProjection,
  isReadableFileArtifact,
  latestArtifactOfKind,
  stagesForRun,
  visibleStagesForRun,
} from '../src/projection';

describe('web workflow run projection', () => {
  it('marks the current awaiting-human stage as blocked with the matching approval gate', () => {
    const projection = buildRunProjection({
      run: {
        id: 'run_1',
        title: 'Add export flow',
        status: 'awaiting_human',
        currentStage: 'design',
        branch: 'ai/run_1-export',
        workspacePath: '/tmp/worktree',
        projectId: 'proj_1',
        createdAt: '2026-05-01T00:00:00.000Z',
      },
      steps: [{ id: 'step_req', stage: 'requirement', name: 'requirement', status: 'passed' }],
      commands: [],
      gates: [{ id: 'gate_design', gateId: 'design_gate', status: 'pass', decidedAt: '', ruleResults: [] }],
      artifacts: [],
      builds: [],
      tests: [],
      approvals: [],
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
        status: 'passed',
        currentStage: 'completion',
        branch: 'ai/run_2-tests',
        workspacePath: '/tmp/worktree',
        projectId: 'proj_1',
        createdAt: '2026-05-01T00:00:00.000Z',
      },
      steps: [],
      commands: [{ id: 'cmd_1', command: 'mvn -B test', status: 'passed', exitCode: 0, durationMs: 12, stdoutRef: '', stderrRef: '', startedAt: '' }],
      gates: [
        { id: 'gate_1', gateId: 'requirement_gate', status: 'pass', decidedAt: '', ruleResults: [] },
        { id: 'gate_2', gateId: 'sensitive_change_gate', status: 'warn', decidedAt: '', ruleResults: [] },
      ],
      artifacts: [],
      builds: [{ id: 'build_1', status: 'passed', jdkVersion: '21', mavenCommand: 'mvn -B test' }],
      tests: [{ framework: 'maven-surefire', total: 3, passed: 3, failed: 0, errors: 0, skipped: 0 }],
      approvals: [],
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

  it('does not mark stages as done when completion is only a failed terminal override', () => {
    const projection = buildRunProjection({
      run: {
        id: 'run_failed_waiting_requirement',
        title: 'Captcha switch',
        status: 'failed',
        currentStage: 'completion',
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
        { id: 'art_context', kind: 'context_pack', uri: 'file:///context.md', createdAt: '2026-05-01T00:00:00.001Z', contentType: 'text/markdown' },
        { id: 'art_req', kind: 'requirement_draft', uri: 'file:///requirement.md', createdAt: '2026-05-01T00:00:00.002Z', contentType: 'text/markdown' },
      ],
      builds: [],
      tests: [],
      approvals: [],
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
  it('projects a refactor run against its own stages, not the feature pipeline', () => {
    const projection = buildRunProjection({
      run: {
        id: 'run_refactor',
        title: 'Extract service layer',
        status: 'running',
        currentStage: 'plan',
        flowId: 'refactor.standard',
        startStage: null,
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
        status: 'awaiting_human',
        currentStage: 'review',
        flowId: 'issue.standard',
        startStage: null,
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
      gates: [{ id: 'g_acc', gateId: 'acceptance_gate', status: 'pass', decidedAt: '', ruleResults: [] }],
      artifacts: [],
      builds: [],
      tests: [],
      approvals: [],
      agentTasks: [],
      agentResults: [],
      audit: [],
    });

    expect(projection.pendingGate).toBe('acceptance_gate');
    expect(projection.stages.find((s) => s.id === 'report')?.state).toBe('done');
    expect(projection.stages.find((s) => s.id === 'review')?.state).toBe('blocked');
  });
});
