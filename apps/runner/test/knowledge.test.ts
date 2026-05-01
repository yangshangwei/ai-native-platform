import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = mkdtempSync(join(tmpdir(), 'ainp-knowledge-'));
process.env.AINP_PROJECTS_DIR = TMP;
process.env.AINP_HOME = TMP;

describe('knowledge feedback loop', () => {
  it('persistKnowledgeCandidate copies the candidate into the project knowledge dir', async () => {
    const { persistKnowledgeCandidate, collectAcceptedKnowledge } = await import('../src/knowledge');

    const candidatePath = join(TMP, 'candidate-A.md');
    writeFileSync(
      candidatePath,
      '# Knowledge\n\nUse pattern X when handling problem Y.\n',
      'utf8',
    );

    const dest = await persistKnowledgeCandidate({
      projectId: 'proj_k_1',
      runId: 'run_42',
      candidateUri: `file://${candidatePath}`,
    });
    expect(dest).toBeTruthy();
    expect(dest).toMatch(/proj_k_1\/knowledge\/run_42\.md$/);

    const acc = await collectAcceptedKnowledge('proj_k_1');
    expect(acc).toContain('Use pattern X when handling problem Y');
    expect(acc).toContain('From `run_42.md`');
  });

  it('returns null when the candidate URI is not a file://', async () => {
    const { persistKnowledgeCandidate } = await import('../src/knowledge');
    const dest = await persistKnowledgeCandidate({
      projectId: 'proj_k_x',
      runId: 'run_99',
      candidateUri: 'mem://abc',
    });
    expect(dest).toBeNull();
  });

  it('returns null when the candidate file does not exist', async () => {
    const { persistKnowledgeCandidate } = await import('../src/knowledge');
    const dest = await persistKnowledgeCandidate({
      projectId: 'proj_k_y',
      runId: 'run_100',
      candidateUri: `file://${join(TMP, 'does-not-exist.md')}`,
    });
    expect(dest).toBeNull();
  });

  it('collectAcceptedKnowledge returns empty string when no knowledge has been promoted', async () => {
    const { collectAcceptedKnowledge } = await import('../src/knowledge');
    const acc = await collectAcceptedKnowledge('proj_k_no_data');
    expect(acc).toBe('');
  });

  it('concatenates multiple promoted candidates in filename order', async () => {
    const { persistKnowledgeCandidate, collectAcceptedKnowledge } = await import('../src/knowledge');

    const a = join(TMP, 'cand-1.md');
    const b = join(TMP, 'cand-2.md');
    writeFileSync(a, '# A\n\nfirst lesson.', 'utf8');
    writeFileSync(b, '# B\n\nsecond lesson.', 'utf8');

    await persistKnowledgeCandidate({
      projectId: 'proj_k_2',
      runId: 'run_001',
      candidateUri: `file://${a}`,
    });
    await persistKnowledgeCandidate({
      projectId: 'proj_k_2',
      runId: 'run_002',
      candidateUri: `file://${b}`,
    });

    const acc = await collectAcceptedKnowledge('proj_k_2');
    const idxA = acc.indexOf('first lesson');
    const idxB = acc.indexOf('second lesson');
    expect(idxA).toBeGreaterThanOrEqual(0);
    expect(idxB).toBeGreaterThan(idxA);
  });
});
