import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import type { KnowledgeArtifact, RouterInput } from '@ainp/shared';

process.env.AINP_DB_PATH = join(mkdtempSync(join(tmpdir(), 'ainp-router-test-')), 'ainp.sqlite');

let router: typeof import('../src/router');
let storeMod: typeof import('../src/store/store');

beforeAll(async () => {
  router = await import('../src/router');
  storeMod = await import('../src/store/store');
});

// ---------------------------------------------------------------------------
// V2 W2-4 / PR1 — Smart Router unit tests.
// PRD AC-7 (R29 a-h) + AC-8 / AC-11.
// ---------------------------------------------------------------------------

function fakeKnowledgeArtifact(args: {
  projectId: string;
  kind: KnowledgeArtifact['kind'];
  entityId: string;
  status?: KnowledgeArtifact['status'];
  metadata?: Record<string, unknown>;
}): KnowledgeArtifact {
  return {
    id: `kart_${args.entityId}_${Math.random().toString(16).slice(2, 8)}`,
    kind: args.kind,
    uri: `mem://${args.entityId}.md`,
    projectId: args.projectId,
    size: 1,
    contentType: 'text/markdown',
    status: args.status ?? 'accepted',
    version: 1,
    entityId: args.entityId,
    derivedFromArtifactId: null,
    subtype: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: args.metadata ?? {},
  };
}

function makeInput(partial: Partial<RouterInput> & { projectId: string; runType: RouterInput['runType'] }): RouterInput {
  return {
    title: partial.title ?? 'sample request',
    ...partial,
  };
}

describe('router.recommend()', () => {
  test('AC-7a: bugfix runType → flowId=issue.standard', () => {
    const rec = router.recommend(
      makeInput({ projectId: 'proj_bugfix_a', runType: 'bugfix', title: 'NullPointer in payment service' }),
    );
    expect(rec.flowId).toBe('issue.standard');
    expect(rec.startStage).toBeNull();
    expect(rec.rulesFired).toContain('flow.bugfix_to_issue_standard');
    expect(rec.rulesFired).toContain('startStage.short_flow_no_skip');
    expect(rec.confidence).toBe(1.0);
  });

  test('AC-7b: refactor runType → flowId=refactor.standard', () => {
    const rec = router.recommend(
      makeInput({ projectId: 'proj_refactor_b', runType: 'refactor', title: 'extract helpers from monolith' }),
    );
    expect(rec.flowId).toBe('refactor.standard');
    expect(rec.startStage).toBeNull();
    expect(rec.rulesFired).toContain('flow.refactor_to_refactor_standard');
  });

  test('AC-7c: feature short title → flowId=feature.fastforward', () => {
    const rec = router.recommend(
      makeInput({ projectId: 'proj_short_c', runType: 'feature', title: 'fix typo in README' }),
    );
    expect(rec.flowId).toBe('feature.fastforward');
    expect(rec.startStage).toBeNull();
    expect(
      rec.rulesFired.includes('flow.feature_short_to_fastforward') ||
        rec.rulesFired.includes('flow.feature_small_keyword_to_fastforward'),
    ).toBe(true);
  });

  test('AC-7c (extra): feature small-change keyword (long title) → flowId=feature.fastforward', () => {
    const rec = router.recommend(
      makeInput({
        projectId: 'proj_short_kw',
        runType: 'feature',
        title:
          'rename internal helper across many tests and assertions and configs and migration logs to better fit our naming scheme',
      }),
    );
    expect(rec.flowId).toBe('feature.fastforward');
    expect(rec.rulesFired).toContain('flow.feature_small_keyword_to_fastforward');
  });

  test('AC-7d: feature long title (no small keyword) → flowId=feature.standard', () => {
    const rec = router.recommend(
      makeInput({
        projectId: 'proj_long_d',
        runType: 'feature',
        title:
          'add a brand new dashboard widget that displays real-time payment events with charts and historical filtering controls',
      }),
    );
    expect(rec.flowId).toBe('feature.standard');
    expect(rec.rulesFired).toContain('flow.feature_default_standard');
  });

  test('AC-7e: project has accepted DSN → startStage=implementation', () => {
    const projectId = 'proj_dsn_e';
    storeMod.store.knowledgeArtifacts.insert(
      fakeKnowledgeArtifact({
        projectId,
        kind: 'design',
        entityId: 'DSN-payment-export',
        metadata: { title: 'payment export design' },
      }),
    );
    // Also insert a requirement to verify design wins precedence
    storeMod.store.knowledgeArtifacts.insert(
      fakeKnowledgeArtifact({
        projectId,
        kind: 'requirement',
        entityId: 'REQ-payment-export',
      }),
    );
    const rec = router.recommend(
      makeInput({
        projectId,
        runType: 'feature',
        title:
          'implement the payment export feature according to the previously approved design and requirements',
      }),
    );
    expect(rec.flowId).toBe('feature.standard');
    expect(rec.startStage).toBe('implementation');
    expect(rec.rulesFired).toContain('startStage.has_accepted_design');
  });

  test('AC-7f: project has accepted REQ but no DSN → startStage=design', () => {
    const projectId = 'proj_req_only_f';
    storeMod.store.knowledgeArtifacts.insert(
      fakeKnowledgeArtifact({
        projectId,
        kind: 'requirement',
        entityId: 'REQ-export',
        metadata: { title: 'export feature' },
      }),
    );
    const rec = router.recommend(
      makeInput({
        projectId,
        runType: 'feature',
        title: 'work on the export feature now that the requirement was approved',
      }),
    );
    expect(rec.flowId).toBe('feature.standard');
    expect(rec.startStage).toBe('design');
    expect(rec.rulesFired).toContain('startStage.has_accepted_requirement');
  });

  test('calibration: stale or conflict-marked accepted knowledge is not used for skip or relevantKnowledge', () => {
    const projectId = 'proj_router_stale_knowledge';
    storeMod.store.knowledgeArtifacts.insert(
      fakeKnowledgeArtifact({
        projectId,
        kind: 'design',
        entityId: 'DSN-stale-export',
        metadata: {
          title: 'stale export design',
          freshness: 'historical',
        },
      }),
    );
    storeMod.store.knowledgeArtifacts.insert(
      fakeKnowledgeArtifact({
        projectId,
        kind: 'requirement',
        entityId: 'REQ-conflict-export',
        metadata: {
          title: 'conflict export requirement',
          reviewStatus: 'Conflict',
        },
      }),
    );

    const rec = router.recommend(
      makeInput({
        projectId,
        runType: 'feature',
        title:
          'implement the stale export design and conflict export requirement with enough detail for standard flow',
      }),
    );

    expect(rec.flowId).toBe('feature.standard');
    expect(rec.startStage).toBeNull();
    expect(rec.rulesFired).toContain('startStage.no_skip');
    expect(rec.relevantKnowledge).toEqual([]);
  });

  test('AC-7g: project has no matching knowledge → startStage=null', () => {
    const projectId = 'proj_empty_g';
    const rec = router.recommend(
      makeInput({
        projectId,
        runType: 'feature',
        title: 'a brand new long-form feature that has nothing to do with anything previously stored',
      }),
    );
    expect(rec.flowId).toBe('feature.standard');
    expect(rec.startStage).toBeNull();
    expect(rec.rulesFired).toContain('startStage.no_skip');
  });

  test('AC-7h / AC-11: estimates accumulate per stage kind (full feature.standard)', () => {
    const projectId = 'proj_est_full';
    const rec = router.recommend(
      makeInput({
        projectId,
        runType: 'feature',
        title:
          'a brand new long-form feature exposing a fresh dashboard for unrelated metrics never modeled before',
      }),
    );
    expect(rec.flowId).toBe('feature.standard');
    expect(rec.startStage).toBeNull();
    // feature.standard has 5 agent + 3 engine stages.
    // 5 * 90 + 3 * 30 = 540
    // 5 * 8000 + 3 * 0 = 40000
    expect(rec.estimates.timeSec).toBe(5 * 90 + 3 * 30);
    expect(rec.estimates.tokens).toBe(5 * 8000);
  });

  test('AC-11 (extra): estimates respect startStage skip prefix', () => {
    const projectId = 'proj_est_skip';
    storeMod.store.knowledgeArtifacts.insert(
      fakeKnowledgeArtifact({
        projectId,
        kind: 'design',
        entityId: 'DSN-skipper',
        metadata: { title: 'skipper design' },
      }),
    );
    const rec = router.recommend(
      makeInput({
        projectId,
        runType: 'feature',
        title: 'implement the skipper module per existing design and the captured requirement',
      }),
    );
    expect(rec.startStage).toBe('implementation');
    // Stages from 'implementation' onwards in feature.standard:
    //   implementation (agent) + build_test (engine) + review (agent)
    //   + completion (engine) + knowledge (engine)
    // = 2 agent + 3 engine = 2*90+3*30 = 270 sec; 2*8000 = 16000 tokens
    expect(rec.estimates.timeSec).toBe(2 * 90 + 3 * 30);
    expect(rec.estimates.tokens).toBe(2 * 8000);
  });

  test('relevantKnowledge returns top-N accepted artifacts ranked by keyword overlap', () => {
    const projectId = 'proj_rk';
    // Insert 7 accepted knowledge artifacts; only some match.
    storeMod.store.knowledgeArtifacts.insert(
      fakeKnowledgeArtifact({ projectId, kind: 'lesson', entityId: 'LSN-export-bug', metadata: { title: 'export bug lesson' } }),
    );
    storeMod.store.knowledgeArtifacts.insert(
      fakeKnowledgeArtifact({ projectId, kind: 'pattern', entityId: 'PAT-export-flow', metadata: { title: 'export pipeline pattern' } }),
    );
    storeMod.store.knowledgeArtifacts.insert(
      fakeKnowledgeArtifact({ projectId, kind: 'pattern', entityId: 'PAT-import-only', metadata: { title: 'import' } }),
    );
    storeMod.store.knowledgeArtifacts.insert(
      fakeKnowledgeArtifact({ projectId, kind: 'lesson', entityId: 'LSN-unrelated', metadata: { title: 'totally unrelated' } }),
    );
    storeMod.store.knowledgeArtifacts.insert(
      fakeKnowledgeArtifact({
        projectId,
        kind: 'pattern',
        entityId: 'PAT-export-skipped',
        metadata: { title: 'export skipped' },
        status: 'draft', // should be ignored — only accepted considered
      }),
    );
    storeMod.store.knowledgeArtifacts.insert(
      fakeKnowledgeArtifact({ projectId, kind: 'lesson', entityId: 'LSN-export-perf', metadata: { title: 'export performance' } }),
    );
    storeMod.store.knowledgeArtifacts.insert(
      fakeKnowledgeArtifact({ projectId, kind: 'pattern', entityId: 'PAT-export-resume', metadata: { title: 'export resume' } }),
    );

    const rec = router.recommend(
      makeInput({
        projectId,
        runType: 'feature',
        title:
          'add export-aware retry logic and a longer description to make the title beyond sixty characters',
      }),
    );
    // 5 of the 7 accepted ones should match 'export'; draft-status one excluded.
    expect(rec.relevantKnowledge.length).toBe(5);
    expect(rec.relevantKnowledge.length).toBeLessThanOrEqual(5);
  });

  test('explicit user-supplied flow override path is the caller responsibility (recommend never receives explicit flowId)', () => {
    // recommend() doesn't take a "user-supplied flowId"; that override
    // happens at createWorkflowRun, which simply skips calling
    // recommend(). This is a smoke-test of the surface contract.
    const rec = router.recommend(
      makeInput({ projectId: 'proj_smoke', runType: 'smoke', title: 'mvn -B test smoke' }),
    );
    expect(rec.flowId).toBe('feature.standard');
    expect(rec.rulesFired).toContain('flow.smoke_to_feature_standard');
  });
});
