import { describe, expect, test } from 'vitest';
import { STAGE_HANDOFF_SCHEMA_VERSION } from '@ainp/shared';
import {
  buildRequirementDesignStageHandoff,
  renderStageHandoffMarkdown,
} from '../src/orchestrator/stage-handoff';

describe('stage handoff extraction', () => {
  test('builds requirement -> design metadata from explicit English sections', () => {
    const handoff = buildRequirementDesignStageHandoff({
      workflowRunId: 'run_stage',
      requirementArtifactId: 'art_req',
      requirementArtifactKind: 'requirement_draft',
      createdAt: '2026-06-27T00:00:00.000Z',
      requirementMarkdown: [
        '---',
        'pitch: Use stage handoff summaries before design.',
        '---',
        '# REQ-001',
        '',
        '## Decisions',
        '- Persist stage handoff in existing handoff metadata.',
        '',
        '## Risks',
        '- Handoff must not own gate status.',
        '',
        '## Open Questions',
        '- Should later UI draw this as an edge?',
        '',
      ].join('\n'),
    });

    expect(handoff).toMatchObject({
      schemaVersion: STAGE_HANDOFF_SCHEMA_VERSION,
      workflowRunId: 'run_stage',
      fromStage: 'requirement',
      toStage: 'design',
      summary: 'Use stage handoff summaries before design.',
      decisions: ['Persist stage handoff in existing handoff metadata.'],
      risks: ['Handoff must not own gate status.'],
      openQuestions: ['Should later UI draw this as an edge?'],
      producedArtifacts: [{
        key: 'requirement.md',
        artifactId: 'art_req',
        kind: 'requirement_draft',
        injectionPreference: 'summary',
      }],
    });
  });

  test('extracts Chinese decision/risk headings and leaves missing lists empty', () => {
    const handoff = buildRequirementDesignStageHandoff({
      workflowRunId: 'run_stage',
      requirementArtifactId: 'art_req',
      requirementArtifactKind: 'requirement_draft',
      createdAt: '2026-06-27T00:00:00.000Z',
      requirementMarkdown: [
        '# REQ-001',
        '',
        '第一段需求摘要，用于下游设计阶段。',
        '',
        '## 边界',
        '- 不新增数据库 migration。',
        '',
        '## 风险',
        '- 不能把 handoff 当成 gate 状态。',
        '',
      ].join('\n'),
    });

    expect(handoff.summary).toBe('第一段需求摘要，用于下游设计阶段。');
    expect(handoff.decisions).toEqual(['不新增数据库 migration。']);
    expect(handoff.risks).toEqual(['不能把 handoff 当成 gate 状态。']);
    expect(handoff.openQuestions).toEqual([]);

    const rendered = renderStageHandoffMarkdown(handoff);
    expect(rendered).toContain('# Stage Handoff: requirement -> design');
    expect(rendered).toContain('artifact://requirement.md/art_req (summary; kind=requirement_draft)');
    expect(rendered).toContain('## Open Questions\n- (none detected)');
  });
});
