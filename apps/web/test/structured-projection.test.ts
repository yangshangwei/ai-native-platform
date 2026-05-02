import { describe, expect, it } from 'vitest';
import {
  buildAcceptanceChecklist,
  buildWorkbenchOverview,
  parseDesignDocument,
  parseKnowledgeCandidate,
  parseRequirementDocument,
} from '../src/projection';

const baseRun = {
  id: 'run_1',
  projectId: 'proj_1',
  title: 'CSV export',
  status: 'awaiting_human',
  currentStage: 'review' as const,
  branch: 'ai/run_1-csv',
  workspacePath: '/tmp/worktree',
  createdAt: '2026-05-01T00:00:00.000Z',
};

describe('structured UI document parsing', () => {
  it('parses requirement markdown into business cards', () => {
    const req = parseRequirementDocument(`# Requirement Draft

## Goals
- Support CSV export.

## Non-goals
- No Excel support.

## Acceptance criteria
- AC-001: Export respects filters.
- AC-002: Export is async.

## Open Questions
- How long should files be retained?
`);

    expect(req.goals).toEqual(['Support CSV export.']);
    expect(req.nonGoals).toEqual(['No Excel support.']);
    expect(req.acceptanceCriteria).toEqual([
      { id: 'AC-001', text: 'Export respects filters.' },
      { id: 'AC-002', text: 'Export is async.' },
    ]);
    expect(req.openQuestions).toEqual(['How long should files be retained?']);
  });

  it('parses design coverage matrix rows', () => {
    const design = parseDesignDocument(`# Design

## Requirement Coverage Matrix
| Requirement | Design item | Acceptance criteria | Verification |
|---|---|---|---|
| REQ-001 | D-001: ExportService | AC-001, AC-002 | mvn test |

## Risks
- Large export may be slow.
`);

    expect(design.coverage).toEqual([
      {
        requirement: 'REQ-001',
        design: 'D-001: ExportService',
        acceptanceCriteria: ['AC-001', 'AC-002'],
        verification: 'mvn test',
        status: 'covered',
      },
    ]);
    expect(design.risks).toEqual(['Large export may be slow.']);
  });

  it('builds acceptance checklist from ACs, gates, tests, and approvals', () => {
    const req = parseRequirementDocument(`## Acceptance criteria
- AC-001: Compile passes.
- AC-002: Tests pass.
`);
    const design = parseDesignDocument(`| Requirement | Design item | Acceptance criteria | Verification |
|---|---|---|---|
| REQ-001 | D-001 | AC-001, AC-002 | compile/test gates |
`);
    const checklist = buildAcceptanceChecklist(req, design, {
      run: baseRun,
      steps: [],
      commands: [],
      gates: [
        { id: 'g1', gateId: 'compile_gate', status: 'pass', decidedAt: '', ruleResults: [] },
        { id: 'g2', gateId: 'test_gate', status: 'pass', decidedAt: '', ruleResults: [] },
        { id: 'g3', gateId: 'acceptance_gate', status: 'pass', decidedAt: '', ruleResults: [] },
      ],
      artifacts: [],
      builds: [],
      tests: [{ framework: 'maven-surefire', total: 3, passed: 3, failed: 0, errors: 0, skipped: 0 }],
      approvals: [{ id: 'a1', gateId: 'acceptance_gate', decision: 'approved', actor: 'web', decidedAt: '' }],
      agentTasks: [],
      agentResults: [],
      audit: [],
    });

    expect(checklist.map((item) => [item.id, item.status])).toEqual([
      ['AC-001', 'passed'],
      ['AC-002', 'passed'],
    ]);
  });

  it('summarizes workbench overview buckets', () => {
    const overview = buildWorkbenchOverview({
      runs: [
        { ...baseRun, id: 'run_waiting', status: 'awaiting_human', currentStage: 'design' },
        { ...baseRun, id: 'run_failed', status: 'failed', currentStage: 'build_test' },
        { ...baseRun, id: 'run_running', status: 'running', currentStage: 'implementation' },
        { ...baseRun, id: 'run_done', status: 'passed', currentStage: 'completion' },
      ],
      requests: [
        { id: 'wreq_1', projectId: 'proj_1', type: 'feature', title: 'queued', branch: 'main', status: 'pending', claimedBy: null, workflowRunId: null, error: null, createdAt: '', updatedAt: '' },
      ],
      detailsByRunId: {
        run_failed: {
          run: { ...baseRun, id: 'run_failed', status: 'failed', currentStage: 'build_test' },
          steps: [],
          commands: [],
          gates: [{ id: 'g_fail', gateId: 'test_gate', status: 'fail', decidedAt: '', ruleResults: [] }],
          artifacts: [],
          builds: [],
          tests: [],
          approvals: [],
          agentTasks: [],
          agentResults: [],
          audit: [],
        },
      },
    });

    expect(overview.toConfirm.map((r) => r.id)).toEqual(['run_waiting']);
    expect(overview.failedGates).toEqual([{ runId: 'run_failed', gateId: 'test_gate' }]);
    expect(overview.running.map((r) => r.id)).toEqual(['run_running']);
    expect(overview.pendingRequests).toHaveLength(1);
    expect(overview.recentReports.map((r) => r.id)).toEqual(['run_done']);
  });

  it('parses knowledge suggestions from candidate markdown', () => {
    const suggestions = parseKnowledgeCandidate(`# Knowledge Candidate

## Reusable lessons
- Decision: Use async export jobs. Evidence: Design D-003.
- Pitfall: Do not reuse list permission. Evidence: Test ExportPermissionTest.
`);

    expect(suggestions).toEqual([
      { kind: 'Decision', text: 'Use async export jobs.', evidence: 'Design D-003.' },
      { kind: 'Pitfall', text: 'Do not reuse list permission.', evidence: 'Test ExportPermissionTest.' },
    ]);
  });
});
