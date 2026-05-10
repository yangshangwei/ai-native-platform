import { describe, expect, test } from 'vitest';
import {
  scoreContextCandidate,
  selectContextCandidates,
  type ContextCandidate,
} from '../src/context/retriever';

describe('ContextPack retriever scoring and budgeting', () => {
  test('scores deterministically by stage, source type, trust, recency, and keywords', () => {
    const designArtifact = candidateFixture({
      id: 'input_design_md',
      title: 'Input Artifact: design.md',
      sourceType: 'run_artifact',
      content: 'ContextPack retriever must keep Codex and Claude renderer provider neutral.',
      sourceRefs: ['artifact:art_design', 'input:design.md'],
      knowledgeClass: 'confirmed',
      trustLevel: 'source',
      freshness: 'current',
      confidence: 0.9,
      createdAt: '2026-05-08T00:00:00.000Z',
    });

    const score = scoreContextCandidate({
      candidate: designArtifact,
      stage: 'implementation',
      taskBrief: 'Implement ContextPack retriever for Codex renderer',
      referenceTime: '2026-05-09T00:00:00.000Z',
    });

    expect(score.components).toMatchObject({
      stage: 28,
      sourceType: 24,
      knowledgeClass: 18,
      trustLevel: 18,
      recency: 20,
      confidence: 9,
    });
    expect(score.keywordMatches).toEqual(['codex', 'contextpack', 'renderer', 'retriever']);
    expect(score.total).toBe(133);
  });

  test('dedupes deterministically and keeps the highest scoring duplicate', () => {
    const selected = selectContextCandidates({
      stage: 'implementation',
      taskBrief: 'Use backend contract',
      referenceTime: '2026-05-09T00:00:00.000Z',
      budget: { maxTokens: 200, reservedForReasoning: 10, reservedForOutput: 10 },
      candidates: [
        candidateFixture({
          id: 'knowledge_backend_contract',
          sourceType: 'knowledge_artifact',
          content: 'Use only configured Claude Code or Codex backends.',
          trustLevel: 'accepted_knowledge',
          confidence: 0.9,
        }),
        candidateFixture({
          id: 'input_backend_contract',
          sourceType: 'run_artifact',
          content: 'Use only configured Claude Code or Codex backends.',
          trustLevel: 'source',
          confidence: 0.95,
        }),
      ],
    });

    expect(selected.map((item) => item.section.id)).toEqual(['input_backend_contract']);
    expect(selected[0]?.section.selectionReasons).toContain('sourceType=run_artifact:24');
  });

  test('degrades full context to summary and then retrieval_hint when budget is tight', () => {
    const long = Array.from({ length: 80 }, (_, i) => `line ${i} with implementation evidence`).join('\n');
    const summarySelected = selectContextCandidates({
      stage: 'review',
      taskBrief: 'Review implementation evidence',
      referenceTime: '2026-05-09T00:00:00.000Z',
      budget: { maxTokens: 48, reservedForReasoning: 10, reservedForOutput: 10 },
      candidates: [
        candidateFixture({
          id: 'input_diff',
          title: 'Input Artifact: diff',
          sourceType: 'run_artifact',
          content: long,
          summary: 'Short implementation evidence summary.',
          retrievalQuery: 'Retrieve diff artifact if detailed review evidence is needed.',
          sourceRefs: ['artifact:diff'],
        }),
      ],
    });
    expect(summarySelected[0]?.section.mode).toBe('summary');
    expect(summarySelected[0]?.section.degradedFrom).toBe('full');
    expect(summarySelected[0]?.section.degradationReason).toContain('full estimate');

    const hintSelected = selectContextCandidates({
      stage: 'review',
      taskBrief: 'Review implementation evidence',
      referenceTime: '2026-05-09T00:00:00.000Z',
      budget: { maxTokens: 14, reservedForReasoning: 5, reservedForOutput: 5 },
      candidates: [
        candidateFixture({
          id: 'input_diff',
          title: 'Input Artifact: diff',
          sourceType: 'run_artifact',
          content: long,
          summary: 'This summary is still much too long for the tiny remaining budget.',
          retrievalQuery: 'Retrieve diff artifact if needed.',
          sourceRefs: ['artifact:diff'],
        }),
      ],
    });
    expect(hintSelected[0]?.section.mode).toBe('retrieval_hint');
    expect(hintSelected[0]?.section.content).toBe('Retrieve diff artifact if needed.');
    expect(hintSelected[0]?.section.degradationReason).toContain('summary estimate');
  });

  test('honors summary base mode without rendering full content under a summary manifest', () => {
    const selected = selectContextCandidates({
      stage: 'implementation',
      taskBrief: 'Implement with project profile context',
      referenceTime: '2026-05-09T00:00:00.000Z',
      budget: { maxTokens: 500, reservedForReasoning: 50, reservedForOutput: 50 },
      candidates: [
        candidateFixture({
          id: 'project_profile',
          title: 'Project Profile Snapshot',
          sourceType: 'project_profile',
          content: Array.from({ length: 40 }, (_, i) => `full profile line ${i}`).join('\n'),
          summary: 'Project profile summary only.',
          sourceRefs: ['artifact:project_profile'],
          baseMode: 'summary',
        }),
      ],
    });

    expect(selected[0]?.section).toMatchObject({
      id: 'project_profile',
      mode: 'summary',
      content: 'Project profile summary only.',
    });
    expect(selected[0]?.section.degradedFrom).toBeUndefined();
  });
});

function candidateFixture(overrides: Partial<ContextCandidate> = {}): ContextCandidate {
  return {
    id: 'candidate',
    title: 'Candidate',
    sourceType: 'knowledge_artifact',
    content: 'Use only configured Claude Code or Codex backends.',
    sourceRefs: ['knowledge_artifact:kart_1'],
    reason: 'Candidate fixture.',
    priority: 1,
    knowledgeClass: 'confirmed',
    trustLevel: 'accepted_knowledge',
    freshness: 'possibly_stale',
    confidence: 0.8,
    createdAt: '2026-05-09T00:00:00.000Z',
    ...overrides,
  };
}
