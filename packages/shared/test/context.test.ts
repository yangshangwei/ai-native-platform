import { expect, test } from 'vitest';
import {
  CONTEXT_FRESHNESS_VALUES,
  CONTEXT_PACK_MODES,
  CONTEXT_REQUEST_STATUSES,
  CONTEXT_TRUST_LEVELS,
  KNOWLEDGE_REVIEW_SEVERITIES,
  KNOWLEDGE_REVIEW_SIGNAL_KINDS,
  isKnowledgeArtifactStatus,
  isContextFreshness,
  isContextPackMode,
  isContextRequestStatus,
  isContextTrustLevel,
  isKnowledgeClass,
  isKnowledgeReviewSeverity,
  isKnowledgeReviewSignalKind,
  isSensitiveContextPath,
  KNOWLEDGE_ARTIFACT_STATUSES,
  KNOWLEDGE_CLASSES,
  knowledgeContextMetadataValidationErrors,
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

  expect(isKnowledgeClass('confirmed')).toBe(true);
  expect(isKnowledgeClass('accepted')).toBe(false);
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
    sourceRefs: ['ok', ''],
    confidence: 2,
  })).toEqual([
    'metadata.knowledgeClass must be one of: seed, recovered, confirmed',
    'metadata.trustLevel must be one of: source, accepted_knowledge, summary, inference',
    'metadata.freshness must be one of: current, possibly_stale, historical',
    'metadata.sourceRefs must be an array of non-empty strings',
    'metadata.confidence must be a number between 0 and 1',
  ]);
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
