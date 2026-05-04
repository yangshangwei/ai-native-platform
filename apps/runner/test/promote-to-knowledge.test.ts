import { describe, expect, test, vi } from 'vitest';
import {
  promoteAcceptedDraftToKnowledge,
  type PromoteDeps,
  type PromoteDraftInput,
} from '../src/orchestrator';
import type { PromoteRequest, PromoteResponse } from '@ainp/shared';

// ---------------------------------------------------------------------------
// Fixtures
//
// V2 P0-2 / PR5: runner-side `promoteAcceptedDraftToKnowledge` is now a thin
// HTTP wrapper around `api.promoteDraft` — the algorithm (entity_id
// resolution / max+1 fallback / version bump / supersede / INSERT / UPSERT
// entity head) lives server-side in a single DB transaction (PR3). These
// tests verify the wrapper contract: shape mapping, log formatting, and
// R12/R28 fault tolerance (HTTP errors must NOT break acceptance gate).
// ---------------------------------------------------------------------------

const PROJECT_ID = 'proj-promote-test';

function makeDraft(
  kind: 'requirement_draft' | 'design_doc',
  text: string,
): PromoteDraftInput {
  return {
    artifactId: `art-${kind}-${Math.random().toString(36).slice(2, 6)}`,
    kind,
    uri: `file:///tmp/${kind}.md`,
    size: text.length,
    contentType: 'text/markdown',
    text,
  };
}

function makeDeps(
  partial: Partial<PromoteDeps> = {},
): PromoteDeps & {
  promoteDraft: ReturnType<typeof vi.fn>;
  log: ReturnType<typeof vi.fn>;
  errorLog: ReturnType<typeof vi.fn>;
} {
  return {
    promoteDraft: vi.fn<(req: PromoteRequest) => Promise<PromoteResponse>>(
      async (req) => ({
        knowledgeArtifactId: `ka-new-${Math.random().toString(36).slice(2, 6)}`,
        entityId: req.kind === 'requirement_draft' ? 'REQ-001' : 'DSN-001',
        entityKind: req.kind === 'requirement_draft' ? 'requirement' : 'design',
        version: 1,
      }),
    ),
    log: vi.fn(),
    errorLog: vi.fn(),
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// Shape mapping: PromoteDraftInput → PromoteRequest
// ---------------------------------------------------------------------------

describe('promoteAcceptedDraftToKnowledge (PR5 thin wrapper)', () => {
  test('forwards a requirement_draft as a single PromoteRequest with all fields mapped', async () => {
    const deps = makeDeps();
    const draft = makeDraft(
      'requirement_draft',
      '---\nentity_id: REQ-042\n---\n# A requirement',
    );

    await promoteAcceptedDraftToKnowledge(PROJECT_ID, draft, deps);

    expect(deps.promoteDraft).toHaveBeenCalledTimes(1);
    const sent = deps.promoteDraft.mock.calls[0]![0] as PromoteRequest;
    expect(sent).toEqual({
      projectId: PROJECT_ID,
      kind: 'requirement_draft',
      draftArtifactId: draft.artifactId,
      draftText: draft.text,
      uri: draft.uri,
      size: draft.size,
      contentType: draft.contentType,
    });
    expect(deps.errorLog).not.toHaveBeenCalled();
  });

  test('forwards a design_doc identically (only kind differs)', async () => {
    const deps = makeDeps();
    const draft = makeDraft(
      'design_doc',
      '---\nentity_id: DSN-007\nref_req: REQ-042\n---\n# A design',
    );

    await promoteAcceptedDraftToKnowledge(PROJECT_ID, draft, deps);

    const sent = deps.promoteDraft.mock.calls[0]![0] as PromoteRequest;
    expect(sent.kind).toBe('design_doc');
    expect(sent.draftText).toBe(draft.text);
  });
});

// ---------------------------------------------------------------------------
// Log formatting (preserved verbatim from PR3 per R30)
// ---------------------------------------------------------------------------

describe('promote log line', () => {
  test('on success logs "[runner] promoted <kind> <id> -> <entityKind> <entityId> v<version> (id=<artId>)"', async () => {
    const deps = makeDeps({
      promoteDraft: vi.fn(async () => ({
        knowledgeArtifactId: 'kart-xyz',
        entityId: 'REQ-042',
        entityKind: 'requirement' as const,
        version: 2,
      })),
    });
    const draft = makeDraft('requirement_draft', 'See REQ-042');

    await promoteAcceptedDraftToKnowledge(PROJECT_ID, draft, deps);

    expect(deps.log).toHaveBeenCalledOnce();
    const msg = deps.log.mock.calls[0]![0];
    expect(msg).toBe(
      `[runner] promoted requirement_draft ${draft.artifactId} -> requirement REQ-042 v2 (id=kart-xyz)`,
    );
  });

  test('on success for a design_doc the log uses entityKind=design', async () => {
    const deps = makeDeps({
      promoteDraft: vi.fn(async () => ({
        knowledgeArtifactId: 'kart-d-1',
        entityId: 'DSN-007',
        entityKind: 'design' as const,
        version: 1,
      })),
    });
    const draft = makeDraft('design_doc', 'See DSN-007 → REQ-042');

    await promoteAcceptedDraftToKnowledge(PROJECT_ID, draft, deps);

    expect(deps.log.mock.calls[0]![0]).toContain('-> design DSN-007 v1');
  });
});

// ---------------------------------------------------------------------------
// R12 / R28 fault tolerance — HTTP failures MUST be downgraded
// ---------------------------------------------------------------------------

describe('R12 / R28 fault tolerance', () => {
  test('promoteDraft rejection is caught and logged, not thrown (acceptance gate must NOT break)', async () => {
    const deps = makeDeps({
      promoteDraft: vi.fn(async () => {
        throw new Error('HTTP 500 / API down');
      }),
    });
    const draft = makeDraft('requirement_draft', 'See REQ-042');

    await expect(
      promoteAcceptedDraftToKnowledge(PROJECT_ID, draft, deps),
    ).resolves.toBeUndefined();

    expect(deps.errorLog).toHaveBeenCalledOnce();
    const msg = deps.errorLog.mock.calls[0]![0];
    expect(msg).toContain('promoteAcceptedDraftToKnowledge failed');
    expect(msg).toContain('HTTP 500 / API down');
    expect(deps.log).not.toHaveBeenCalled();
  });

  test('FK CONSTRAINT_VIOLATION (409) bubbles back as an Error and is downgraded the same way', async () => {
    const deps = makeDeps({
      promoteDraft: vi.fn(async () => {
        throw new Error('FOREIGN KEY constraint failed');
      }),
    });
    const draft = makeDraft('design_doc', 'See DSN-999 → REQ-9999');

    await expect(
      promoteAcceptedDraftToKnowledge(PROJECT_ID, draft, deps),
    ).resolves.toBeUndefined();

    const msg = deps.errorLog.mock.calls[0]![0];
    expect(msg).toContain('FOREIGN KEY');
  });

  test('non-Error thrown values (e.g. strings) are stringified safely', async () => {
    const deps = makeDeps({
      promoteDraft: vi.fn(async () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'boom';
      }),
    });
    const draft = makeDraft('requirement_draft', 'See REQ-001');

    await expect(
      promoteAcceptedDraftToKnowledge(PROJECT_ID, draft, deps),
    ).resolves.toBeUndefined();

    expect(deps.errorLog.mock.calls[0]![0]).toContain('boom');
  });
});
