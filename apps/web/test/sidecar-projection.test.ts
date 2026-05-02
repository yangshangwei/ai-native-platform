import { describe, expect, it } from 'vitest';
import {
  parseCompletionReportArtifact,
  parseDesignArtifact,
  parseKnowledgeArtifact,
  parseRequirementArtifact,
} from '../src/projection';

describe('structured JSON sidecar projection', () => {
  it('prefers requirement JSON sidecar over markdown parsing', () => {
    const requirement = parseRequirementArtifact('# fallback only', JSON.stringify({
      schemaVersion: 'ainp.requirement.v1',
      title: 'Requirement JSON',
      goals: ['JSON goal'],
      userScenarios: ['JSON scenario'],
      acceptanceCriteria: [{ id: 'AC-009', text: 'JSON AC' }],
      nonGoals: ['JSON non-goal'],
      openQuestions: ['JSON question'],
    }));

    expect(requirement.title).toBe('Requirement JSON');
    expect(requirement.goals).toEqual(['JSON goal']);
    expect(requirement.acceptanceCriteria).toEqual([{ id: 'AC-009', text: 'JSON AC' }]);
  });

  it('prefers design JSON sidecar with coverage rows', () => {
    const design = parseDesignArtifact('# fallback only', JSON.stringify({
      schemaVersion: 'ainp.design.v1',
      title: 'Design JSON',
      summary: ['JSON summary'],
      affectedModules: ['module-a'],
      filesTouched: ['src/a.ts'],
      testStrategy: ['unit'],
      risks: ['risk'],
      coverage: [{ requirement: 'REQ-001', design: 'D-001', acceptanceCriteria: ['AC-001'], verification: 'unit', status: 'covered' }],
    }));

    expect(design.title).toBe('Design JSON');
    expect(design.coverage[0]?.acceptanceCriteria).toEqual(['AC-001']);
  });

  it('prefers knowledge candidate JSON sidecar items', () => {
    const suggestions = parseKnowledgeArtifact('', JSON.stringify({
      schemaVersion: 'ainp.knowledge_candidate.v1',
      suggestions: [{ kind: 'Decision', text: 'Use async jobs.', evidence: 'Design D-001' }],
    }));

    expect(suggestions).toEqual([{ kind: 'Decision', text: 'Use async jobs.', evidence: 'Design D-001' }]);
  });

  it('prefers completion report JSON sidecar sections', () => {
    const report = parseCompletionReportArtifact('# fallback only', JSON.stringify({
      schemaVersion: 'ainp.completion_report.v1',
      title: 'Completion JSON',
      summary: ['All gates passed'],
      sections: [{ title: 'Gates', body: 'requirement_gate=pass' }],
    }));

    expect(report.title).toBe('Completion JSON');
    expect(report.summary).toEqual(['All gates passed']);
    expect(report.sections).toEqual([{ title: 'Gates', body: 'requirement_gate=pass' }]);
  });
});
