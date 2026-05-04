import { describe, expect, test, vi } from 'vitest';
import {
  promoteAcceptedDraftToKnowledge,
  type PromoteDeps,
  type PromoteDraftInput,
} from '../src/orchestrator';
import type { KnowledgeArtifact } from '@ainp/shared';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT_ID = 'proj-promote-test';

const REQUIREMENT_DRAFT_TEXT_WITH_ID = `---
doc_type: requirement
pitch: a thing
status: draft
REQ-042: ${PROJECT_ID}
---

# A requirement

## 用户故事
- ...
`;

const REQUIREMENT_DRAFT_TEXT_NO_ID = `---
doc_type: requirement
pitch: anonymous
status: draft
---

# A nameless requirement
`;

const DESIGN_DOC_TEXT = `---
doc_type: design
design_id: DSN-007
related_req: REQ-042
status: draft
---

# DSN-007: pretty design
`;

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

function makeKnowledgeArtifact(overrides: Partial<KnowledgeArtifact>): KnowledgeArtifact {
  return {
    id: 'ka-existing',
    kind: 'requirement',
    uri: 'mem://prior',
    projectId: PROJECT_ID,
    size: 100,
    contentType: 'text/markdown',
    status: 'accepted',
    version: 1,
    entityId: 'REQ-042',
    derivedFromArtifactId: null,
    subtype: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: {},
    ...overrides,
  };
}

function makeDeps(
  partial: Partial<PromoteDeps> = {},
): PromoteDeps & {
  postKnowledgeArtifact: ReturnType<typeof vi.fn>;
  listKnowledgeArtifactsByKind: ReturnType<typeof vi.fn>;
  listKnowledgeArtifactsByEntity: ReturnType<typeof vi.fn>;
  setKnowledgeArtifactStatus: ReturnType<typeof vi.fn>;
  log: ReturnType<typeof vi.fn>;
  errorLog: ReturnType<typeof vi.fn>;
} {
  return {
    postKnowledgeArtifact: vi.fn(async (input) =>
      makeKnowledgeArtifact({
        id: `ka-new-${Math.random().toString(36).slice(2, 6)}`,
        kind: input.kind,
        version: input.version ?? 1,
        entityId: input.entityId ?? null,
        derivedFromArtifactId: input.derivedFromArtifactId ?? null,
        status: input.status ?? 'accepted',
      }),
    ),
    listKnowledgeArtifactsByKind: vi.fn(async () => []),
    listKnowledgeArtifactsByEntity: vi.fn(async () => []),
    setKnowledgeArtifactStatus: vi.fn(async () => makeKnowledgeArtifact({})),
    log: vi.fn(),
    errorLog: vi.fn(),
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('promoteAcceptedDraftToKnowledge', () => {
  test('lifts requirement_draft into a requirement entity using REQ-### from frontmatter', async () => {
    const deps = makeDeps();
    const draft = makeDraft('requirement_draft', REQUIREMENT_DRAFT_TEXT_WITH_ID);

    await promoteAcceptedDraftToKnowledge(PROJECT_ID, draft, deps);

    expect(deps.postKnowledgeArtifact).toHaveBeenCalledTimes(1);
    const call = deps.postKnowledgeArtifact.mock.calls[0]![0];
    expect(call.projectId).toBe(PROJECT_ID);
    expect(call.kind).toBe('requirement');
    expect(call.entityId).toBe('REQ-042');
    expect(call.version).toBe(1);
    expect(call.status).toBe('accepted');
    expect(call.derivedFromArtifactId).toBe(draft.artifactId);
    expect(deps.errorLog).not.toHaveBeenCalled();
  });

  test('lifts design_doc into a design entity using DSN-###', async () => {
    const deps = makeDeps();
    const draft = makeDraft('design_doc', DESIGN_DOC_TEXT);

    await promoteAcceptedDraftToKnowledge(PROJECT_ID, draft, deps);

    const call = deps.postKnowledgeArtifact.mock.calls[0]![0];
    expect(call.kind).toBe('design');
    expect(call.entityId).toBe('DSN-007');
  });

  test('falls back to sequential entity_id when frontmatter has none', async () => {
    const deps = makeDeps({
      listKnowledgeArtifactsByKind: vi.fn(async () => [
        makeKnowledgeArtifact({ entityId: 'REQ-001' }),
        makeKnowledgeArtifact({ entityId: 'REQ-005' }),
        makeKnowledgeArtifact({ entityId: null }), // ignored (no id)
      ]),
    });
    const draft = makeDraft('requirement_draft', REQUIREMENT_DRAFT_TEXT_NO_ID);

    await promoteAcceptedDraftToKnowledge(PROJECT_ID, draft, deps);

    const call = deps.postKnowledgeArtifact.mock.calls[0]![0];
    expect(call.entityId).toBe('REQ-006'); // max(1,5) + 1 padded to 3 digits
  });

  test('starts at REQ-001 when no prior entities exist and no frontmatter id', async () => {
    const deps = makeDeps({
      listKnowledgeArtifactsByKind: vi.fn(async () => []),
    });
    const draft = makeDraft('requirement_draft', REQUIREMENT_DRAFT_TEXT_NO_ID);

    await promoteAcceptedDraftToKnowledge(PROJECT_ID, draft, deps);
    expect(deps.postKnowledgeArtifact.mock.calls[0]![0].entityId).toBe('REQ-001');
  });
});

// ---------------------------------------------------------------------------
// Versioning + supersession
// ---------------------------------------------------------------------------

describe('promote versioning', () => {
  test('bumps version and supersedes prior accepted row when entity_id already exists', async () => {
    const priorAccepted = makeKnowledgeArtifact({
      id: 'ka-prior-v1',
      version: 1,
      entityId: 'REQ-042',
      status: 'accepted',
    });
    const deps = makeDeps({
      listKnowledgeArtifactsByEntity: vi.fn(async () => [priorAccepted]),
    });
    const draft = makeDraft('requirement_draft', REQUIREMENT_DRAFT_TEXT_WITH_ID);

    await promoteAcceptedDraftToKnowledge(PROJECT_ID, draft, deps);

    expect(deps.setKnowledgeArtifactStatus).toHaveBeenCalledWith({
      id: 'ka-prior-v1',
      status: 'superseded',
    });
    const post = deps.postKnowledgeArtifact.mock.calls[0]![0];
    expect(post.version).toBe(2);
    expect(post.entityId).toBe('REQ-042');
  });

  test('bumps from highest version when multiple historical versions exist', async () => {
    const deps = makeDeps({
      listKnowledgeArtifactsByEntity: vi.fn(async () => [
        makeKnowledgeArtifact({ id: 'v1', version: 1, status: 'superseded' }),
        makeKnowledgeArtifact({ id: 'v2', version: 2, status: 'superseded' }),
        makeKnowledgeArtifact({ id: 'v3', version: 3, status: 'accepted' }),
      ]),
    });
    const draft = makeDraft('requirement_draft', REQUIREMENT_DRAFT_TEXT_WITH_ID);

    await promoteAcceptedDraftToKnowledge(PROJECT_ID, draft, deps);

    expect(deps.postKnowledgeArtifact.mock.calls[0]![0].version).toBe(4);
    // Only the currently accepted row should be superseded.
    expect(deps.setKnowledgeArtifactStatus).toHaveBeenCalledTimes(1);
    expect(deps.setKnowledgeArtifactStatus).toHaveBeenCalledWith({
      id: 'v3',
      status: 'superseded',
    });
  });
});

// ---------------------------------------------------------------------------
// R18 fault tolerance — must NOT throw on any failure path
// ---------------------------------------------------------------------------

describe('R18 fault tolerance', () => {
  test('postKnowledgeArtifact rejection is caught and logged, not thrown', async () => {
    const deps = makeDeps({
      postKnowledgeArtifact: vi.fn(async () => {
        throw new Error('API down');
      }),
    });
    const draft = makeDraft('requirement_draft', REQUIREMENT_DRAFT_TEXT_WITH_ID);

    await expect(
      promoteAcceptedDraftToKnowledge(PROJECT_ID, draft, deps),
    ).resolves.toBeUndefined();

    expect(deps.errorLog).toHaveBeenCalledOnce();
    const errMsg = deps.errorLog.mock.calls[0]![0];
    expect(errMsg).toContain('promoteAcceptedDraftToKnowledge failed');
    expect(errMsg).toContain('API down');
  });

  test('listKnowledgeArtifactsByKind failure is caught and logged when needed for sequential fallback', async () => {
    const deps = makeDeps({
      listKnowledgeArtifactsByKind: vi.fn(async () => {
        throw new Error('list crashed');
      }),
    });
    const draft = makeDraft('requirement_draft', REQUIREMENT_DRAFT_TEXT_NO_ID);

    await expect(
      promoteAcceptedDraftToKnowledge(PROJECT_ID, draft, deps),
    ).resolves.toBeUndefined();

    expect(deps.errorLog).toHaveBeenCalledOnce();
    expect(deps.postKnowledgeArtifact).not.toHaveBeenCalled();
  });

  test('setKnowledgeArtifactStatus failure during supersession is caught', async () => {
    const deps = makeDeps({
      listKnowledgeArtifactsByEntity: vi.fn(async () => [
        makeKnowledgeArtifact({ id: 'v1', status: 'accepted', version: 1 }),
      ]),
      setKnowledgeArtifactStatus: vi.fn(async () => {
        throw new Error('patch failed');
      }),
    });
    const draft = makeDraft('requirement_draft', REQUIREMENT_DRAFT_TEXT_WITH_ID);

    await expect(
      promoteAcceptedDraftToKnowledge(PROJECT_ID, draft, deps),
    ).resolves.toBeUndefined();

    expect(deps.errorLog).toHaveBeenCalledOnce();
  });
});
