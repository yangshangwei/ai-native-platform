import { expect, test } from 'vitest';
import {
  CONTEXT_FRESHNESS_VALUES,
  CONTEXT_PACK_MODES,
  CONTEXT_REQUEST_STATUSES,
  CONTEXT_TRUST_LEVELS,
  KNOWLEDGE_REVIEW_SEVERITIES,
  KNOWLEDGE_REVIEW_SIGNAL_KINDS,
  MEMORY_DECAY_POLICIES,
  MEMORY_KINDS,
  MEMORY_REVIEW_STATUSES,
  MEMORY_SCOPES,
  MEMORY_STATUSES,
  isKnowledgeArtifactStatus,
  isContextFreshness,
  isContextPackMode,
  isContextRequestStatus,
  isContextTrustLevel,
  isKnowledgeClass,
  isMemoryDecayPolicy,
  isMemoryKind,
  isMemoryReviewStatus,
  isMemoryScope,
  isMemoryStatus,
  isKnowledgeReviewSeverity,
  isKnowledgeReviewSignalKind,
  isSensitiveContextPath,
  KNOWLEDGE_ARTIFACT_STATUSES,
  KNOWLEDGE_CLASSES,
  knowledgeContextMetadataValidationErrors,
  normalizeMemoryLifecycleMetadata,
  normalizeKnowledgeContextMetadata,
  sanitizeSensitiveContextText,
  type ContextManifestItem,
  type ContextPack,
  type ContextRequest,
  type ContextSection,
  type ProjectMaturityProfile,
} from '../src';

test('context protocol literal catalogs expose canonical MVP values', () => {
  expect(KNOWLEDGE_CLASSES).toEqual(['seed', 'recovered', 'confirmed']);
  expect(KNOWLEDGE_ARTIFACT_STATUSES).toEqual(['draft', 'accepted', 'superseded']);
  expect(CONTEXT_TRUST_LEVELS).toEqual(['source', 'accepted_knowledge', 'summary', 'inference']);
  expect(CONTEXT_FRESHNESS_VALUES).toEqual(['current', 'possibly_stale', 'historical']);
  expect(CONTEXT_PACK_MODES).toEqual(['bootstrap', 'calibration', 'recovery', 'task_execution']);
  expect(CONTEXT_REQUEST_STATUSES).toEqual(['open', 'fulfilled', 'dismissed']);
  expect(KNOWLEDGE_REVIEW_SIGNAL_KINDS).toEqual([
    'conflict',
    'stale',
    'superseded',
    'upgrade_candidate',
    'downgrade_candidate',
  ]);
  expect(KNOWLEDGE_REVIEW_SEVERITIES).toEqual(['info', 'warning', 'review_required']);
  expect(MEMORY_KINDS).toEqual(['semantic', 'episodic', 'procedural']);
  expect(MEMORY_SCOPES).toEqual(['run', 'task', 'project', 'workspace', 'global']);
  expect(MEMORY_STATUSES).toEqual(['candidate', 'current', 'stale', 'superseded', 'rejected']);
  expect(MEMORY_DECAY_POLICIES).toEqual([
    'none',
    'time',
    'code_churn',
    'evidence_conflict',
    'manual_review',
  ]);
  expect(MEMORY_REVIEW_STATUSES).toEqual([
    'none',
    'needs_review',
    'conflict',
    'stale',
    'superseded',
    'upgrade_candidate',
    'downgrade_candidate',
  ]);

  expect(isKnowledgeClass('confirmed')).toBe(true);
  expect(isKnowledgeClass('accepted')).toBe(false);
  expect(isMemoryKind('semantic')).toBe(true);
  expect(isMemoryKind('historical')).toBe(false);
  expect(isMemoryScope('project')).toBe(true);
  expect(isMemoryScope('organization')).toBe(false);
  expect(isMemoryStatus('current')).toBe(true);
  expect(isMemoryStatus('active')).toBe(false);
  expect(isMemoryDecayPolicy('code_churn')).toBe(true);
  expect(isMemoryDecayPolicy('calendar')).toBe(false);
  expect(isMemoryReviewStatus('conflict')).toBe(true);
  expect(isMemoryReviewStatus('overwrite')).toBe(false);
  expect(isKnowledgeArtifactStatus('accepted')).toBe(true);
  expect(isKnowledgeArtifactStatus('archived')).toBe(false);
  expect(isContextTrustLevel('accepted_knowledge')).toBe(true);
  expect(isContextTrustLevel('trusted')).toBe(false);
  expect(isContextFreshness('current')).toBe(true);
  expect(isContextFreshness('fresh')).toBe(false);
  expect(isContextPackMode('task_execution')).toBe(true);
  expect(isContextPackMode('scoring')).toBe(false);
  expect(isContextRequestStatus('open')).toBe(true);
  expect(isContextRequestStatus('pending')).toBe(false);
  expect(isKnowledgeReviewSignalKind('conflict')).toBe(true);
  expect(isKnowledgeReviewSignalKind('overwrite')).toBe(false);
  expect(isKnowledgeReviewSeverity('review_required')).toBe(true);
  expect(isKnowledgeReviewSeverity('critical')).toBe(false);
});

test('ContextPack shape carries maturity, manifest, source refs, trust and freshness', () => {
  const maturityProfile: ProjectMaturityProfile = {
    stage: 'growing',
    codebaseAge: 'early',
    knowledgeCoverage: 'confirmed',
    evidenceDensity: 'medium',
    volatility: 'medium',
    primaryNeed: 'calibrate',
  };
  const section: ContextSection = {
    id: 'accepted_knowledge',
    title: 'Accepted Knowledge',
    content: 'Use the real configured agent backend.',
    sourceRefs: ['knowledge:accepted'],
    reason: 'Previously accepted project decision applies.',
    priority: 1,
    knowledgeClass: 'confirmed',
    trustLevel: 'accepted_knowledge',
    freshness: 'possibly_stale',
    confidence: 0.9,
    mode: 'full',
  };
  const manifest: ContextManifestItem = {
    type: 'domain',
    ref: section.id,
    reason: section.reason,
    priority: section.priority,
    mode: section.mode,
    knowledgeClass: section.knowledgeClass,
    trustRequired: 'accepted_knowledge',
    sourceRefs: section.sourceRefs,
    trustLevel: section.trustLevel,
    freshness: section.freshness,
    confidence: section.confidence,
  };
  const pack: ContextPack = {
    id: 'ctxpack_test',
    workflowRunId: 'run_1',
    stepRunId: 'step_1',
    taskBrief: 'Add shared context injection.',
    stage: 'implementation',
    maturityProfile,
    budget: { maxTokens: 12_000, reservedForReasoning: 2_000, reservedForOutput: 2_000 },
    mode: 'task_execution',
    projectSnapshot: '# Project Profile',
    manifest: [manifest],
    sections: [section],
    retrievalHints: [],
    calibrationSignals: [
      {
        id: 'sig_conflict_backend',
        kind: 'conflict',
        severity: 'review_required',
        message: 'Confirmed backend knowledge conflicts with current source.',
        subjectRefs: ['knowledge_artifact:kart_1'],
        evidenceRefs: ['artifact:diff_1'],
        recommendedAction: 'open_knowledge_review',
        createdAt: '2026-05-09T00:00:00.000Z',
      },
    ],
    run: {
      projectId: 'proj_1',
      projectName: 'sample',
      workflowRunId: 'run_1',
      stepRunId: 'step_1',
      flowId: 'feature.standard',
      runType: 'feature',
      sourceBranch: 'main',
      executionBranch: 'ai/run',
      workspacePath: '/tmp/workspace',
    },
    supplement: {
      contextRequestId: 'ctxreq_1',
      baseContextPackId: 'ctxpack_base',
      retryIndex: 1,
      createdAt: '2026-05-09T00:00:00.000Z',
    },
    createdAt: '2026-05-09T00:00:00.000Z',
  };

  expect(pack.manifest[0]?.sourceRefs).toEqual(['knowledge:accepted']);
  expect(pack.sections[0]?.knowledgeClass).toBe('confirmed');
  expect(pack.sections[0]?.trustLevel).toBe('accepted_knowledge');
  expect(pack.sections[0]?.freshness).toBe('possibly_stale');
  expect(pack.sections[0]?.confidence).toBe(0.9);
  expect(pack.calibrationSignals?.[0]?.kind).toBe('conflict');
  expect(pack.calibrationSignals?.[0]?.recommendedAction).toBe('open_knowledge_review');
  expect(pack.supplement?.contextRequestId).toBe('ctxreq_1');
  expect(pack.supplement?.retryIndex).toBe(1);
});

test('knowledge metadata helper defaults accepted artifacts to confirmed and validates overrides', () => {
  const accepted = normalizeKnowledgeContextMetadata(
    {},
    { status: 'accepted', fallbackSourceRefs: ['knowledge_artifact:kart_1'] },
  );
  expect(accepted).toEqual({
    knowledgeClass: 'confirmed',
    trustLevel: 'accepted_knowledge',
    freshness: 'possibly_stale',
    sourceRefs: ['knowledge_artifact:kart_1'],
    confidence: 0.9,
  });

  const seed = normalizeKnowledgeContextMetadata(
    {
      knowledgeClass: 'seed',
      trustLevel: 'summary',
      freshness: 'current',
      sourceRefs: ['seed:api', 'seed:api'],
      confidence: 0.6,
    },
    { status: 'accepted', fallbackSourceRefs: ['knowledge_artifact:kart_2'] },
  );
  expect(seed).toEqual({
    knowledgeClass: 'seed',
    trustLevel: 'summary',
    freshness: 'current',
    sourceRefs: ['seed:api'],
    confidence: 0.6,
  });

  expect(knowledgeContextMetadataValidationErrors({
    knowledgeClass: 'trusted',
    trustLevel: 'seed',
    freshness: 'fresh',
    memoryKind: 'historical',
    reviewStatus: 'overwrite',
    memoryScope: 'organization',
    memoryStatus: 'active',
    decayPolicy: 'calendar',
    lastValidatedAt: 'not a date',
    expiresAt: 123,
    decayReason: '',
    supersededBy: ['ok', ''],
    sourceRefs: ['ok', ''],
    supersedes: ['ok', ''],
    hitCount: -1,
    lastUsedAt: 'not a date',
    confidence: 2,
  })).toEqual([
    'metadata.knowledgeClass must be one of: seed, recovered, confirmed',
    'metadata.trustLevel must be one of: source, accepted_knowledge, summary, inference',
    'metadata.freshness must be one of: current, possibly_stale, historical',
    'metadata.memoryKind must be one of: semantic, episodic, procedural',
    'metadata.reviewStatus must be one of: none, needs_review, conflict, stale, superseded, upgrade_candidate, downgrade_candidate',
    'metadata.memoryScope must be one of: run, task, project, workspace, global',
    'metadata.memoryStatus must be one of: candidate, current, stale, superseded, rejected',
    'metadata.decayPolicy must be one of: none, time, code_churn, evidence_conflict, manual_review',
    'metadata.lastValidatedAt must be an ISO-8601 string or null',
    'metadata.expiresAt must be an ISO-8601 string or null',
    'metadata.decayReason must be a non-empty string or null',
    'metadata.supersededBy must be an array of non-empty strings',
    'metadata.sourceRefs must be an array of non-empty strings',
    'metadata.supersedes must be an array of non-empty strings',
    'metadata.hitCount must be a non-negative integer',
    'metadata.lastUsedAt must be an ISO-8601 string or null',
    'metadata.confidence must be a number between 0 and 1',
  ]);
});

test('memory lifecycle metadata normalizer is additive and safe for legacy rows', () => {
  expect(normalizeMemoryLifecycleMetadata(undefined, { knowledgeKind: 'decision', status: 'accepted' })).toEqual({
    memoryKind: 'semantic',
    reviewStatus: 'none',
    memoryScope: 'project',
    memoryStatus: 'current',
    decayPolicy: 'none',
    lastValidatedAt: null,
    expiresAt: null,
    decayReason: null,
    supersededBy: [],
    supersedes: [],
    hitCount: 0,
    lastUsedAt: null,
  });

  expect(normalizeMemoryLifecycleMetadata({
    memoryKind: 'procedural',
    reviewStatus: 'conflict',
    memoryScope: 'workspace',
    memoryStatus: 'stale',
    decayPolicy: 'code_churn',
    lastValidatedAt: '2026-06-26T00:00:00.000Z',
    expiresAt: '2026-07-26T00:00:00.000Z',
    decayReason: 'source changed',
    supersededBy: ['kart_new', '', 'kart_new'],
    supersedes: ['kart_old', '', 'kart_old'],
    hitCount: 2,
    lastUsedAt: '2026-06-27T00:00:00.000Z',
  }, { knowledgeKind: 'lesson' })).toEqual({
    memoryKind: 'procedural',
    reviewStatus: 'conflict',
    memoryScope: 'workspace',
    memoryStatus: 'stale',
    decayPolicy: 'code_churn',
    lastValidatedAt: '2026-06-26T00:00:00.000Z',
    expiresAt: '2026-07-26T00:00:00.000Z',
    decayReason: 'source changed',
    supersededBy: ['kart_new'],
    supersedes: ['kart_old'],
    hitCount: 2,
    lastUsedAt: '2026-06-27T00:00:00.000Z',
  });

  expect(normalizeMemoryLifecycleMetadata({
    reviewStatus: 'Needs Review',
  }, { knowledgeKind: 'lesson' }).reviewStatus).toBe('needs_review');
  expect(normalizeMemoryLifecycleMetadata({
    reviewStatus: 'Conflict',
  }, { knowledgeKind: 'lesson' }).reviewStatus).toBe('conflict');

  expect(normalizeMemoryLifecycleMetadata({
    memoryScope: 'organization',
    memoryStatus: 'active',
    decayPolicy: 'calendar',
  }, { knowledgeKind: 'decision', status: 'accepted' })).toMatchObject({
    memoryScope: 'run',
    memoryStatus: 'candidate',
    decayPolicy: 'manual_review',
  });

  expect(normalizeMemoryLifecycleMetadata({}, { status: 'draft' }).memoryStatus).toBe('candidate');
  expect(normalizeMemoryLifecycleMetadata({}, { status: 'accepted' }).memoryStatus).toBe('current');
  expect(normalizeMemoryLifecycleMetadata({}, { status: 'superseded' }).memoryStatus).toBe('superseded');
});

test('ContextRequest carries the structured supplement protocol fields', () => {
  const req: ContextRequest = {
    id: 'ctxreq_1',
    workflowRunId: 'run_1',
    stepRunId: 'step_1',
    stage: 'implementation',
    reason: 'Need a specific source file to verify behavior.',
    requestedRefs: ['code:src/main/java/sample/Calculator.java'],
    questions: ['Which implementation owns calculator rounding?'],
    priority: 2,
    status: 'open',
    createdAt: '2026-05-09T00:00:00.000Z',
  };
  expect(req.status).toBe('open');
});

test('context policy utilities detect and redact sensitive paths', () => {
  expect(isSensitiveContextPath('.env.local')).toBe(true);
  expect(isSensitiveContextPath('src/config.ts')).toBe(false);
  expect(isSensitiveContextPath('repo/.ssh/id_rsa')).toBe(true);
  expect(sanitizeSensitiveContextText([
    'Safe design evidence.',
    'Secret path: .env.local',
    'Another safe line.',
  ].join('\n'))).toBe('Safe design evidence.\nAnother safe line.');
});
