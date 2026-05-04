import { expect, test } from 'vitest';
import {
  isKnowledgeArtifactKind,
  isPerRunArtifactKind,
  isValidKnowledgeSubtype,
  KNOWLEDGE_SUBTYPES,
  type ArtifactKind,
  type KnowledgeArtifactKind,
  type KnowledgeArtifactMetadata,
  type KnowledgeMetadataCore,
  type PerRunArtifactKind,
  type PerRunArtifactMetadata,
} from '../src';

// ---------------------------------------------------------------------------
// Backward-compatibility (V1 12 kinds still members of ArtifactKind)
// ---------------------------------------------------------------------------

test('ArtifactKind union still accepts every V1 per-run kind', () => {
  const v1Kinds: ArtifactKind[] = [
    'project_profile',
    'context_pack',
    'requirement_draft',
    'design_doc',
    'traceability',
    'diff',
    'command_log',
    'surefire_report',
    'failsafe_report',
    'completion_report',
    'knowledge_candidate',
    'other',
  ];
  expect(v1Kinds).toHaveLength(12);
  for (const k of v1Kinds) {
    expect(isPerRunArtifactKind(k)).toBe(true);
    expect(isKnowledgeArtifactKind(k)).toBe(false);
  }
});

test('ArtifactKind union accepts the V2 knowledge kinds', () => {
  const v2Kinds: ArtifactKind[] = [
    'requirement',
    'design',
    'architecture',
    'roadmap',
    'decision',
    'lesson',
    'pattern',
    'explore',
    'dev_guide',
    'api_doc',
  ];
  expect(v2Kinds).toHaveLength(10);
  for (const k of v2Kinds) {
    expect(isKnowledgeArtifactKind(k)).toBe(true);
    expect(isPerRunArtifactKind(k)).toBe(false);
  }
});

test('per-run and knowledge sets are disjoint', () => {
  const perRun: PerRunArtifactKind[] = [
    'project_profile',
    'context_pack',
    'requirement_draft',
    'design_doc',
    'traceability',
    'diff',
    'command_log',
    'surefire_report',
    'failsafe_report',
    'completion_report',
    'knowledge_candidate',
    'other',
  ];
  const knowledge: KnowledgeArtifactKind[] = [
    'requirement',
    'design',
    'architecture',
    'roadmap',
    'decision',
    'lesson',
    'pattern',
    'explore',
    'dev_guide',
    'api_doc',
  ];
  for (const k of perRun) {
    expect(knowledge as string[]).not.toContain(k);
  }
});

test('type guards reject non-string and unknown strings', () => {
  expect(isPerRunArtifactKind(undefined)).toBe(false);
  expect(isPerRunArtifactKind(null)).toBe(false);
  expect(isPerRunArtifactKind(42)).toBe(false);
  expect(isPerRunArtifactKind('not_a_kind')).toBe(false);
  expect(isKnowledgeArtifactKind(undefined)).toBe(false);
  expect(isKnowledgeArtifactKind('REQUIREMENT')).toBe(false); // case-sensitive
});

// ---------------------------------------------------------------------------
// KNOWLEDGE_SUBTYPES catalog
// ---------------------------------------------------------------------------

test('KNOWLEDGE_SUBTYPES has an entry for every KnowledgeArtifactKind', () => {
  const expectedKinds: KnowledgeArtifactKind[] = [
    'requirement',
    'design',
    'architecture',
    'roadmap',
    'decision',
    'lesson',
    'pattern',
    'explore',
    'dev_guide',
    'api_doc',
  ];
  for (const k of expectedKinds) {
    expect(KNOWLEDGE_SUBTYPES[k]).toBeDefined();
    expect(Array.isArray(KNOWLEDGE_SUBTYPES[k])).toBe(true);
  }
  // No accidental extra keys.
  expect(Object.keys(KNOWLEDGE_SUBTYPES).sort()).toEqual([...expectedKinds].sort());
});

test('lesson / pattern / decision / roadmap / explore each enumerate canonical subtypes', () => {
  expect(KNOWLEDGE_SUBTYPES.lesson).toEqual(['pitfall', 'knowledge']);
  expect(KNOWLEDGE_SUBTYPES.pattern).toEqual(['pattern', 'library', 'technique']);
  expect(KNOWLEDGE_SUBTYPES.decision).toEqual([
    'tech_stack',
    'architecture',
    'constraint',
    'convention',
  ]);
  expect(KNOWLEDGE_SUBTYPES.roadmap).toEqual(['feature', 'milestone', 'vision']);
  expect(KNOWLEDGE_SUBTYPES.explore).toEqual(['question', 'module_overview', 'spike']);
});

test('kinds without subtypes have empty arrays', () => {
  expect(KNOWLEDGE_SUBTYPES.requirement).toEqual([]);
  expect(KNOWLEDGE_SUBTYPES.design).toEqual([]);
  expect(KNOWLEDGE_SUBTYPES.architecture).toEqual([]);
  expect(KNOWLEDGE_SUBTYPES.dev_guide).toEqual([]);
  expect(KNOWLEDGE_SUBTYPES.api_doc).toEqual([]);
});

// ---------------------------------------------------------------------------
// isValidKnowledgeSubtype
// ---------------------------------------------------------------------------

test('isValidKnowledgeSubtype: legal subtype on a kind that enumerates them', () => {
  expect(isValidKnowledgeSubtype('lesson', 'pitfall')).toBe(true);
  expect(isValidKnowledgeSubtype('lesson', 'knowledge')).toBe(true);
  expect(isValidKnowledgeSubtype('decision', 'tech_stack')).toBe(true);
  expect(isValidKnowledgeSubtype('pattern', 'library')).toBe(true);
});

test('isValidKnowledgeSubtype: illegal subtype rejected', () => {
  expect(isValidKnowledgeSubtype('lesson', 'invalid')).toBe(false);
  expect(isValidKnowledgeSubtype('lesson', '')).toBe(false);
  expect(isValidKnowledgeSubtype('lesson', 'PITFALL')).toBe(false); // case-sensitive
});

test('isValidKnowledgeSubtype: undefined is valid (subtype is optional)', () => {
  expect(isValidKnowledgeSubtype('requirement', undefined)).toBe(true);
  expect(isValidKnowledgeSubtype('lesson', undefined)).toBe(true);
});

test('isValidKnowledgeSubtype: kinds without subtypes reject any concrete value', () => {
  expect(isValidKnowledgeSubtype('requirement', 'anything')).toBe(false);
  expect(isValidKnowledgeSubtype('design', 'foo')).toBe(false);
  expect(isValidKnowledgeSubtype('architecture', 'bar')).toBe(false);
  expect(isValidKnowledgeSubtype('dev_guide', 'baz')).toBe(false);
  expect(isValidKnowledgeSubtype('api_doc', 'qux')).toBe(false);
});

// ---------------------------------------------------------------------------
// Type-shape sanity (compile-time only — runtime checks here just touch the
// constructed value to make sure the types exist and are usable).
// ---------------------------------------------------------------------------

test('KnowledgeMetadataCore + extension freeform compose into a usable metadata value', () => {
  const m: KnowledgeArtifactMetadata = {
    status: 'draft',
    version: 1,
    entityId: 'REQ-001',
    derivedFromArtifactId: 'art-abc',
    subtype: undefined,
    // Extension freeform fields:
    severity: 'high',
    relatedFiles: ['src/foo.ts', 'src/bar.ts'],
  };
  expect(m.status).toBe('draft');
  expect(m.version).toBe(1);
  expect(m.entityId).toBe('REQ-001');
  expect(m.severity).toBe('high'); // freeform read still works
});

test('PerRunArtifactMetadata is structurally Record<string, unknown> (V1 behavior preserved)', () => {
  const m: PerRunArtifactMetadata = {
    testTotal: 3,
    arbitrary: { nested: true },
  };
  expect(m.testTotal).toBe(3);
});

test('KnowledgeMetadataCore enforces required fields at the type level', () => {
  // The cast below would fail at compile time if `status` or `version`
  // were missing or wrong-typed. This test exists to keep the compiler
  // honest: removing required fields from KnowledgeMetadataCore should
  // make this fail to type-check (caught by `tsc --noEmit`).
  const core: KnowledgeMetadataCore = { status: 'accepted', version: 2 };
  expect(core.status).toBe('accepted');
});
