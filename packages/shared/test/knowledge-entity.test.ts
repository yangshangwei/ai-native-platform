import { expect, test } from 'vitest';
import type {
  DesignEntity,
  PromotableDraftKind,
  PromotedEntityKind,
  PromoteRequest,
  PromoteResponse,
  RequirementEntity,
  RequirementEntityStatus,
} from '../src';

// ---------------------------------------------------------------------------
// V2 P0-2 / PR1: knowledge-entity types compile-time smoke
// ---------------------------------------------------------------------------
// These tests exist primarily to keep `tsc --noEmit` honest: removing or
// renaming any required field on the shipped cross-layer contracts would
// fail to type-check here. Runtime assertions only touch the constructed
// values to make sure they're usable from a normal call-site.
// ---------------------------------------------------------------------------

const NOW = '2026-05-04T13:00:00Z';

test('RequirementEntityStatus enumerates the three lifecycle states', () => {
  const states: RequirementEntityStatus[] = ['draft', 'accepted', 'archived'];
  expect(states).toHaveLength(3);
});

test('RequirementEntity shape holds a head pointer to a knowledge_artifacts row', () => {
  const req: RequirementEntity = {
    id: 'REQ-001',
    projectId: 'proj-abc',
    status: 'accepted',
    currentVersion: 2,
    currentArtifactId: 'kn-art-xyz',
    createdAt: NOW,
    updatedAt: NOW,
  };
  expect(req.id).toBe('REQ-001');
  expect(req.currentVersion).toBe(2);
  expect(req.currentArtifactId).toBe('kn-art-xyz');
});

test('DesignEntity carries everything RequirementEntity does plus refReq', () => {
  const dsn: DesignEntity = {
    id: 'DSN-001',
    projectId: 'proj-abc',
    status: 'accepted',
    currentVersion: 1,
    currentArtifactId: 'kn-art-design-1',
    refReq: 'REQ-001',
    createdAt: NOW,
    updatedAt: NOW,
  };
  expect(dsn.id).toBe('DSN-001');
  expect(dsn.refReq).toBe('REQ-001');
});

// ---------------------------------------------------------------------------
// Promote API contract (Q5=5-A)
// ---------------------------------------------------------------------------

test('PromotableDraftKind covers exactly the two per-run draft kinds eligible for promotion', () => {
  const kinds: PromotableDraftKind[] = ['requirement_draft', 'design_doc'];
  expect(kinds).toHaveLength(2);
});

test('PromotedEntityKind covers exactly the two knowledge entity kinds produced by promotion', () => {
  const kinds: PromotedEntityKind[] = ['requirement', 'design'];
  expect(kinds).toHaveLength(2);
});

test('PromoteRequest carries the draft body so the API can extract entity_id from frontmatter', () => {
  const req: PromoteRequest = {
    projectId: 'proj-abc',
    kind: 'requirement_draft',
    draftArtifactId: 'art-draft-001',
    draftText: '---\nentity_id: REQ-042\n---\n# Calculator basics\n',
    uri: 'file:///tmp/requirement_draft.md',
    size: 128,
    contentType: 'text/markdown',
  };
  expect(req.kind).toBe('requirement_draft');
  expect(req.draftText).toContain('REQ-042');
});

test('PromoteResponse returns the resolved entity head fields runner needs to log', () => {
  const res: PromoteResponse = {
    knowledgeArtifactId: 'kn-art-new',
    entityId: 'REQ-042',
    entityKind: 'requirement',
    version: 1,
  };
  expect(res.entityKind).toBe('requirement');
  expect(res.version).toBe(1);
});

test('PromoteRequest.kind ↔ PromoteResponse.entityKind map is requirement_draft→requirement and design_doc→design', () => {
  // This is a structural assertion only. The actual mapping logic lives in
  // the API server (PR3); this test just confirms the type pair is wired
  // such that any code switching on `kind` can produce the matching
  // `entityKind`.
  const cases: Array<{ kind: PromotableDraftKind; entityKind: PromotedEntityKind }> = [
    { kind: 'requirement_draft', entityKind: 'requirement' },
    { kind: 'design_doc', entityKind: 'design' },
  ];
  expect(cases).toHaveLength(2);
});
