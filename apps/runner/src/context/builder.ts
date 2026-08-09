import {
  newId,
  nowIso,
  CONTEXT_POLICY_SENSITIVE_PATH_PATTERNS_DEFAULT,
  isSensitiveContextPath as sharedIsSensitiveContextPath,
  normalizeSensitivePathPatterns,
  normalizeKnowledgeContextMetadata,
  sanitizeSensitiveContextText,
  lineContainsSensitivePath,
  type ContextFreshness,
  type ContextInclusionMode,
  type ContextManifestItem,
  type ContextManifestItemType,
  type ContextPack,
  type ContextPackBudget,
  type ContextPackMode,
  type ContextRequest,
  type ContextSection,
  type ContextTrustLevel,
  type NormalizedKnowledgeContextMetadata,
  type KnowledgeArtifact,
  type KnowledgeClass,
  type KnowledgeReviewSignal,
  type KnowledgeReviewSignalKind,
  type Project,
  type ProjectMaturityProfile,
  type RetrievalHint,
  type WorkflowRun,
  type WorkflowStage,
} from '@ainp/shared';
import type { ProjectProfile } from '../profile';
import {
  selectContextCandidates,
  type ContextCandidate,
} from './retriever';

/**
 * Section id prefix for prior-attempt feedback. `manifestTypeForSection` keys
 * on it, so it must stay in sync with the ids `candidatesForPriorFeedback`
 * emits — one constant, not two string literals.
 */
const PRIOR_FEEDBACK_SECTION_PREFIX = 'prior_feedback_';

/**
 * Why a previous attempt was rejected, extracted from the run's own artifacts.
 * `source` distinguishes a human's gate comment from a reviewer's remediation:
 * both are judgements about a failure, but a human rejection outranks an
 * agent's when they disagree.
 */
export interface PriorFeedbackInput {
  source: 'human_rejection' | 'reviewer_remediation';
  /** Stage the rejection was aimed at, when known. */
  stage: string | null;
  /** The feedback text itself — a gate comment, or a remediation action. */
  text: string;
  /** `artifact:<id>` of the artifact this came from, for traceability. */
  sourceRef: string;
  createdAt: string | null;
}

export interface BuildContextPackInput {
  project: Project;
  run: WorkflowRun;
  stage: WorkflowStage;
  stepRunId?: string | null;
  workspacePath: string;
  branch: string;
  taskBrief: string;
  projectProfile?: ProjectProfile | null;
  projectProfileMarkdown?: string | null;
  acceptedKnowledgeMarkdown?: string | null;
  knowledgeArtifacts?: readonly KnowledgeArtifact[];
  runHistory?: readonly WorkflowRun[];
  artifactHistoryCount?: number;
  inputNames?: readonly string[];
  inputArtifacts?: readonly BuildContextPackInputArtifact[];
  /**
   * Why the previous attempt was rejected. Only populated when resuming a run
   * (08-09 P1-2) — on a first attempt there is no prior attempt to learn from,
   * so an empty list is the normal case and injects nothing.
   */
  priorFeedback?: readonly PriorFeedbackInput[];
  budget?: Partial<ContextPackBudget>;
  sensitivePathPatterns?: readonly string[];
  supplement?: ContextPack['supplement'];
  createdAt?: string;
}

export interface BuildContextPackInputArtifact {
  name: string;
  content: string;
  artifactId?: string | null;
  createdAt?: string | null;
  required?: boolean;
}

export interface BuildIncrementalContextPackInput extends BuildContextPackInput {
  contextRequest: ContextRequest;
  baseContextPack?: ContextPack | null;
  retryIndex?: number;
}

const DEFAULT_BUDGET = {
  maxTokens: 12_000,
  reservedForReasoning: 2_000,
  reservedForOutput: 2_000,
} as const satisfies ContextPackBudget;

const MAX_CALIBRATION_SIGNALS = 12;
const SOURCE_CHUNK_INDEX_MAX_LEXICAL_TOKENS = 120;
const SOURCE_CHUNK_INDEX_MAX_SEARCH_TEXT_CHARS = 1_200;
const SOURCE_CHUNK_INDEX_MAX_LINKED_RECORD_REFS = 120;

export const DEFAULT_SENSITIVE_CONTEXT_PATH_PATTERNS =
  CONTEXT_POLICY_SENSITIVE_PATH_PATTERNS_DEFAULT;
export const isSensitiveContextPath = sharedIsSensitiveContextPath;

export function buildContextPack(input: BuildContextPackInput): ContextPack {
  const createdAt = input.createdAt ?? nowIso();
  const budget = normalizeBudget(input.budget);
  const sensitivePathPatterns = normalizeSensitivePathPatterns(input.sensitivePathPatterns);
  const safeKnowledgeArtifacts = (input.knowledgeArtifacts ?? []).filter((artifact) => (
    artifact.projectId === input.project.id
    && !isSensitiveContextPath(artifact.uri, sensitivePathPatterns)
    && !normalizeKnowledgeContextMetadata(artifact.metadata, {
      status: artifact.status,
      fallbackSourceRefs: fallbackSourceRefsForKnowledgeArtifact(artifact),
    }).sourceRefs.some((ref) => isSensitiveContextPath(ref, sensitivePathPatterns))
  ));
  const safeInputArtifacts = (input.inputArtifacts ?? []).filter((artifact) => (
    !isSensitiveContextPath(artifact.name, sensitivePathPatterns)
    && !isSensitiveContextPath(artifact.artifactId ?? '', sensitivePathPatterns)
  ));
  const maturityProfile = buildProjectMaturityProfile({
    projectProfile: input.projectProfile ?? null,
    acceptedKnowledgeMarkdown: input.acceptedKnowledgeMarkdown ?? '',
    knowledgeArtifacts: safeKnowledgeArtifacts,
    runHistory: input.runHistory ?? [],
    artifactHistoryCount: input.artifactHistoryCount ?? 0,
  });
  const calibrationSignals = buildKnowledgeReviewSignals({
    knowledgeArtifacts: safeKnowledgeArtifacts,
    inputArtifacts: safeInputArtifacts,
    stage: input.stage,
    createdAt,
  });
  const mode = modeFor(maturityProfile, input.stage, calibrationSignals);
  const candidates: ContextCandidate[] = [
    candidate({
      id: 'task_brief',
      title: 'Task Brief',
      content: input.taskBrief,
      sourceType: 'task_brief',
      sourceRefs: [`workflow_run:${input.run.id}`, 'input:user_request'],
      reason: 'Primary user request for this agent invocation.',
      priority: 1,
      knowledgeClass: 'confirmed',
      trustLevel: 'source',
      freshness: 'current',
      confidence: 1,
      mode: 'full',
      required: true,
      createdAt,
    }),
    candidate({
      id: 'workflow_run',
      title: 'Workflow Run Metadata',
      content: renderRunMetadata(input),
      sourceType: 'workflow_metadata',
      sourceRefs: [`workflow_run:${input.run.id}`, `flow:${input.run.flowId}`],
      reason: 'Keeps the agent scoped to the current workflow stage, branch, and worktree.',
      priority: 1,
      knowledgeClass: 'confirmed',
      trustLevel: 'source',
      freshness: 'current',
      confidence: 1,
      mode: 'metadata_only',
      required: true,
      createdAt,
    }),
  ];

  const projectSnapshot = normalizeOptionalText(
    sanitizeSensitiveContextText(input.projectProfileMarkdown ?? '', sensitivePathPatterns),
  );
  if (projectSnapshot) {
    candidates.push(candidate({
      id: 'project_profile',
      title: 'Project Profile Snapshot',
      content: projectSnapshot,
      summary: projectProfileSummary(projectSnapshot),
      retrievalQuery: 'Retrieve the saved project profile before making project-wide structure, build, or test assumptions.',
      sourceType: 'project_profile',
      sourceRefs: [`project:${input.project.id}`, 'artifact:project_profile'],
      reason: 'Provides the project map, language/build tool, and thin repository outline.',
      priority: 1,
      knowledgeClass: 'recovered',
      trustLevel: 'summary',
      freshness: 'possibly_stale',
      confidence: 0.6,
      mode: 'summary',
    }));
  }

  candidates.push(...candidatesForKnowledgeArtifacts(
    safeKnowledgeArtifacts.filter((artifact) => (
      !isProjectInventoryKnowledgeArtifact(artifact)
      && !isSourceChunkIndexKnowledgeArtifact(artifact)
      && !isProjectCapabilityMapCorrectionArtifact(artifact)
    )),
    sensitivePathPatterns,
  ));

  const acceptedKnowledge = normalizeOptionalText(
    sanitizeSensitiveContextText(input.acceptedKnowledgeMarkdown ?? '', sensitivePathPatterns),
  );
  if (acceptedKnowledge) {
    const metadata = normalizeKnowledgeContextMetadata({}, {
      status: 'accepted',
      fallbackSourceRefs: [`project:${input.project.id}`, 'knowledge:accepted'],
    });
    candidates.push(candidate({
      id: 'accepted_knowledge',
      title: 'Accepted Knowledge',
      content: acceptedKnowledge,
      retrievalQuery: 'Retrieve accepted project knowledge before making historical project-decision claims.',
      sourceType: 'knowledge_artifact',
      sourceRefs: metadata.sourceRefs,
      reason: 'Previously accepted project knowledge should guide this invocation unless current evidence conflicts.',
      priority: 1,
      knowledgeClass: metadata.knowledgeClass,
      trustLevel: metadata.trustLevel,
      freshness: metadata.freshness,
      confidence: metadata.confidence,
      mode: 'full',
    }));
  }

  candidates.push(...candidatesForProjectInventorySources({
    sources: [
      ...projectInventorySourcesFromInputArtifacts(safeInputArtifacts, sensitivePathPatterns),
      ...projectInventorySourcesFromKnowledgeArtifacts(safeKnowledgeArtifacts, sensitivePathPatterns),
    ],
    capabilityCorrections: capabilityMapCorrectionsFromKnowledgeArtifacts(
      safeKnowledgeArtifacts,
      sensitivePathPatterns,
    ),
    taskBrief: input.taskBrief,
    sourceHintRoots: [input.workspacePath, input.project.localPath],
    sensitivePathPatterns,
  }));
  candidates.push(...candidatesForInputArtifacts(safeInputArtifacts, sensitivePathPatterns));
  // Empty on a first attempt — there is no prior attempt to learn from, so
  // nothing is injected and no placeholder section appears (R3).
  candidates.push(...candidatesForPriorFeedback(input.priorFeedback ?? [], sensitivePathPatterns));

  const selected = selectContextCandidates({
    candidates,
    stage: input.stage,
    taskBrief: input.taskBrief,
    budget,
    referenceTime: createdAt,
  });
  const sections = selected.map((item) => item.section);
  const retrievalHints: RetrievalHint[] = [];
  if (!projectSnapshot) {
    retrievalHints.push({
      id: 'hint_project_profile_missing',
      title: 'Project profile unavailable',
      query: 'Inspect README, build files, and main source/test entry points before making project-wide claims.',
      reason: 'The builder could not attach a project profile snapshot.',
      sourceRefs: [`project:${input.project.id}`],
      priority: 2,
    });
  }
  if (!acceptedKnowledge) {
    retrievalHints.push({
      id: 'hint_no_accepted_knowledge',
      title: 'No accepted knowledge selected',
      query: 'Rely on current source, run artifacts, and explicit user request; do not assume historical decisions.',
      reason: 'No accepted project knowledge has been promoted yet.',
      sourceRefs: [`project:${input.project.id}`],
      priority: 3,
    });
  }
  for (const item of selected) {
    if (item.section.mode !== 'retrieval_hint') continue;
    retrievalHints.push({
      id: `hint_${item.section.id}`,
      title: item.section.title,
      query: item.section.content,
      reason: item.section.degradationReason ?? 'Selected context was degraded to a retrieval hint.',
      sourceRefs: item.section.sourceRefs,
      priority: item.section.priority,
    });
  }
  const selectedProjectSnapshot = sections.find((section) => (
    section.id === 'project_profile' && section.mode !== 'retrieval_hint'
  ));

  return {
    id: newId('ctxpack'),
    workflowRunId: input.run.id,
    stepRunId: input.stepRunId ?? null,
    taskBrief: input.taskBrief,
    stage: input.stage,
    maturityProfile,
    budget,
    mode,
    projectSnapshot: selectedProjectSnapshot?.content ?? '',
    manifest: sections.map(contextManifestItemForSection),
    sections,
    retrievalHints,
    calibrationSignals: calibrationSignals.length > 0 ? calibrationSignals : undefined,
    run: {
      projectId: input.project.id,
      projectName: input.project.name,
      workflowRunId: input.run.id,
      stepRunId: input.stepRunId ?? null,
      flowId: input.run.flowId,
      runType: input.run.type,
      sourceBranch: input.run.sourceBranch,
      executionBranch: input.branch,
      workspacePath: input.workspacePath,
    },
    supplement: input.supplement,
    createdAt,
  };
}

export function buildIncrementalContextPack(
  input: BuildIncrementalContextPackInput,
): ContextPack {
  const sensitivePathPatterns = normalizeSensitivePathPatterns(input.sensitivePathPatterns);
  const request = sanitizeContextRequestForContextInjection(
    input.contextRequest,
    sensitivePathPatterns,
  );
  const requestArtifactName = `context_request.${request.id}.json`;
  const requestArtifactContent = JSON.stringify({
    schemaVersion: 'ainp.context_request.v1',
    request,
  }, null, 2);
  const requestedRefs = uniqueStrings(request.requestedRefs).slice(0, 8);
  const questions = uniqueStrings(request.questions).slice(0, 8);
  const requestBrief = [
    input.taskBrief,
    '',
    'Incremental context request:',
    `- id: ${request.id}`,
    `- reason: ${request.reason}`,
    requestedRefs.length > 0 ? `- requestedRefs: ${requestedRefs.join(', ')}` : null,
    questions.length > 0 ? `- questions: ${questions.join(' | ')}` : null,
  ].filter((line): line is string => line !== null).join('\n');

  const pack = buildContextPack({
    ...input,
    taskBrief: requestBrief,
    inputArtifacts: [
      {
        name: requestArtifactName,
        content: requestArtifactContent,
        createdAt: request.createdAt,
        required: true,
      },
      ...(input.inputArtifacts ?? []),
    ],
    budget: boundedSupplementBudget(input.budget),
    supplement: {
      contextRequestId: request.id,
      baseContextPackId: input.baseContextPack?.id ?? null,
      retryIndex: input.retryIndex ?? 1,
      createdAt: input.createdAt ?? request.createdAt,
    },
  });

  return {
    ...pack,
    retrievalHints: mergeRetrievalHints([
      ...retrievalHintsForContextRequest(request, sensitivePathPatterns),
      ...pack.retrievalHints,
    ]),
  };
}

export function sanitizeContextRequestForContextInjection(
  request: ContextRequest,
  patterns: readonly string[] = DEFAULT_SENSITIVE_CONTEXT_PATH_PATTERNS,
): ContextRequest {
  const sensitivePathPatterns = normalizeSensitivePathPatterns(patterns);
  const reason =
    sanitizeSensitiveContextText(request.reason, sensitivePathPatterns).trim()
    || 'Context request reason was redacted by context policy.';
  return {
    ...request,
    reason,
    requestedRefs: uniqueStrings(request.requestedRefs)
      .filter((ref) => !isSensitiveContextPath(ref, sensitivePathPatterns))
      .slice(0, 8),
    questions: uniqueStrings(request.questions)
      .filter((question) => !lineContainsSensitivePath(question, sensitivePathPatterns))
      .slice(0, 8),
  };
}

export function buildProjectMaturityProfile(input: {
  projectProfile: ProjectProfile | null;
  acceptedKnowledgeMarkdown: string;
  knowledgeArtifacts?: readonly KnowledgeArtifact[];
  runHistory?: readonly WorkflowRun[];
  artifactHistoryCount?: number;
}): ProjectMaturityProfile {
  const profile = input.projectProfile;
  const acceptedKnowledge = normalizeOptionalText(input.acceptedKnowledgeMarkdown);
  const treeCount = profile?.treeOutline.length ?? 0;
  const testCount = profile?.testFiles.length ?? 0;
  const knowledgeArtifacts = input.knowledgeArtifacts ?? [];
  const knowledgeMetadata = knowledgeArtifacts.map((artifact) => normalizeKnowledgeContextMetadata(
    artifact.metadata,
    { status: artifact.status, fallbackSourceRefs: [`knowledge_artifact:${artifact.id}`] },
  ));
  const hasSeedKnowledge = knowledgeMetadata.some((metadata) => metadata.knowledgeClass === 'seed');
  const hasRecoveredKnowledge = knowledgeMetadata.some((metadata) => (
    metadata.knowledgeClass === 'recovered'
  ));
  const hasConfirmedKnowledge =
    Boolean(acceptedKnowledge)
    || knowledgeArtifacts.some((artifact, index) => (
      artifact.status === 'accepted' && knowledgeMetadata[index]?.knowledgeClass === 'confirmed'
    ));
  const runHistoryCount = input.runHistory?.length ?? 0;
  const artifactHistoryCount = input.artifactHistoryCount ?? 0;
  const codebaseAge =
    !profile ? 'unknown'
      : treeCount === 0 ? 'empty'
        : treeCount > 20 || testCount > 8 ? 'established'
          : 'early';
  const knowledgeCoverage =
    hasConfirmedKnowledge ? 'confirmed'
      : hasRecoveredKnowledge ? 'recovered'
        : hasSeedKnowledge ? 'seeded'
          : 'partial';
  const hasAnyEvidence =
    treeCount > 0
    || testCount > 0
    || knowledgeArtifacts.length > 0
    || runHistoryCount > 0
    || artifactHistoryCount > 0;
  const evidenceDensity: ProjectMaturityProfile['evidenceDensity'] =
    (
      treeCount > 20
      || testCount > 8
      || artifactHistoryCount > 8
      || runHistoryCount > 3
      || knowledgeArtifacts.length > 5
    )
      ? 'high'
      : hasAnyEvidence ? 'medium' : 'low';
  const stage: ProjectMaturityProfile['stage'] =
    codebaseAge === 'established' && !hasConfirmedKnowledge && !hasSeedKnowledge
      ? 'legacy'
      : hasConfirmedKnowledge || hasRecoveredKnowledge || runHistoryCount > 1
        ? 'growing'
        : 'greenfield';
  const primaryNeed: ProjectMaturityProfile['primaryNeed'] =
    stage === 'legacy' ? 'recover'
      : hasConfirmedKnowledge || hasRecoveredKnowledge ? 'calibrate'
        : 'bootstrap';
  return {
    stage,
    codebaseAge,
    knowledgeCoverage,
    evidenceDensity,
    volatility: hasConfirmedKnowledge && evidenceDensity === 'high'
      ? 'low'
      : hasAnyEvidence ? 'medium' : 'high',
    primaryNeed,
  };
}

function modeFor(
  profile: ProjectMaturityProfile,
  stage: WorkflowStage,
  calibrationSignals: readonly KnowledgeReviewSignal[] = [],
): ContextPackMode {
  if (stage === 'context_pack') return 'bootstrap';
  if (calibrationSignals.length > 0 && isImportantChangeStage(stage)) return 'calibration';
  if (profile.primaryNeed === 'recover') return 'recovery';
  if (profile.primaryNeed === 'calibrate') return 'calibration';
  return 'task_execution';
}

function isImportantChangeStage(stage: WorkflowStage): boolean {
  return stage === 'design'
    || stage === 'implementation'
    || stage === 'review'
    || stage === 'plan'
    || stage === 'analyze';
}

function candidate(input: ContextCandidate & { mode?: ContextInclusionMode }): ContextCandidate {
  const { mode, ...rest } = input;
  return {
    ...rest,
    baseMode: mode,
  };
}

function contextManifestItemForSection(section: ContextSection): ContextManifestItem {
  return {
    type: manifestTypeForSection(section),
    ref: section.id,
    reason: section.reason,
    priority: section.priority,
    mode: section.mode,
    knowledgeClass: section.knowledgeClass,
    trustRequired: trustRequiredFor(section.trustLevel),
    sourceRefs: section.sourceRefs,
    trustLevel: section.trustLevel,
    freshness: section.freshness,
    confidence: section.confidence,
    sourceType: section.sourceType,
    score: section.score,
    selectionReasons: section.selectionReasons,
    degradedFrom: section.degradedFrom,
    degradationReason: section.degradationReason,
  };
}

function manifestTypeForSection(section: ContextSection): ContextManifestItemType {
  if (section.sourceType === 'code_probe') return 'code_probe';
  // 08-09 P1-2: prior-attempt feedback is a judgement about a failure, not a
  // fact this run produced, so it must not fall through to `task_artifact`.
  if (section.id.startsWith(PRIOR_FEEDBACK_SECTION_PREFIX)) return 'prior_feedback';
  if (section.id.startsWith('knowledge_')) {
    return section.knowledgeClass === 'seed' ? 'seed' : 'domain';
  }
  switch (section.id) {
    case 'project_profile':
      return 'project_profile';
    case 'accepted_knowledge':
      return 'domain';
    case 'task_brief':
    case 'workflow_run':
      return 'task_artifact';
    default:
      return 'task_artifact';
  }
}

function trustRequiredFor(trustLevel: ContextTrustLevel): ContextManifestItem['trustRequired'] {
  if (trustLevel === 'source') return 'source';
  if (trustLevel === 'accepted_knowledge') return 'accepted_knowledge';
  return 'inference_ok';
}

function candidatesForKnowledgeArtifacts(
  artifacts: readonly KnowledgeArtifact[],
  sensitivePathPatterns: readonly string[],
): ContextCandidate[] {
  return artifacts
    .map((artifact) => knowledgeCandidate(artifact, sensitivePathPatterns))
    .filter((item): item is ContextCandidate => item !== null);
}

function knowledgeCandidate(
  artifact: KnowledgeArtifact,
  sensitivePathPatterns: readonly string[],
): ContextCandidate | null {
  const metadata = contextMetadataForKnowledgeArtifact(artifact);
  const reviewStatus = reviewStatusForMetadata(artifact.metadata);
  const hasReviewRequiredSignal = isReviewRequiredStatus(reviewStatus);
  const title = knowledgeTitle(artifact, metadata.knowledgeClass);
  const content = sanitizeSensitiveContextText(
    knowledgeContent(artifact, title),
    sensitivePathPatterns,
  );
  const summary = sanitizeSensitiveContextText(
    knowledgeSummary(artifact) ?? '',
    sensitivePathPatterns,
  );
  if (!normalizeOptionalText(content)) return null;
  return candidate({
    id: `knowledge_${artifact.id}`,
    title,
    content,
    summary: normalizeOptionalText(summary),
    retrievalQuery: `Retrieve knowledge artifact ${artifact.id}${artifact.entityId ? ` (${artifact.entityId})` : ''} from ${artifact.uri} before relying on this project fact.`,
    sourceType: 'knowledge_artifact',
    sourceRefs: metadata.sourceRefs,
    reason: reasonForKnowledgeArtifact(artifact, metadata.knowledgeClass, reviewStatus),
    priority: metadata.knowledgeClass === 'confirmed' && !hasReviewRequiredSignal ? 1 : 2,
    knowledgeClass: metadata.knowledgeClass,
    trustLevel: hasReviewRequiredSignal ? 'summary' : metadata.trustLevel,
    freshness: hasReviewRequiredSignal ? 'historical' : metadata.freshness,
    confidence: hasReviewRequiredSignal ? Math.min(metadata.confidence, 0.45) : metadata.confidence,
    mode: knowledgeBaseMode(metadata.freshness, hasReviewRequiredSignal),
    createdAt: artifact.updatedAt ?? artifact.createdAt,
  });
}

function contextMetadataForKnowledgeArtifact(
  artifact: KnowledgeArtifact,
): NormalizedKnowledgeContextMetadata {
  const metadata = normalizeKnowledgeContextMetadata(artifact.metadata, {
    status: artifact.status,
    fallbackSourceRefs: fallbackSourceRefsForKnowledgeArtifact(artifact),
  });
  if (artifact.status === 'accepted') return metadata;

  if (artifact.status === 'superseded') {
    return {
      ...metadata,
      knowledgeClass: 'recovered',
      trustLevel: 'summary',
      freshness: 'historical',
      confidence: Math.min(metadata.confidence, 0.4),
    };
  }

  return {
    ...metadata,
    knowledgeClass: 'recovered',
    trustLevel: 'summary',
    freshness: metadata.freshness === 'historical' ? 'historical' : 'possibly_stale',
    confidence: Math.min(metadata.confidence, 0.5),
  };
}

function knowledgeBaseMode(
  freshness: ContextFreshness,
  hasNegativeReviewSignal: boolean,
): ContextInclusionMode {
  if (hasNegativeReviewSignal) return 'summary';
  return freshness === 'current' ? 'full' : 'summary';
}

function isReviewRequiredStatus(reviewStatus: string | null): boolean {
  return reviewStatus !== null;
}

function fallbackSourceRefsForKnowledgeArtifact(artifact: KnowledgeArtifact): string[] {
  return [
    `knowledge_artifact:${artifact.id}`,
    `knowledge:${artifact.status}`,
    `uri:${artifact.uri}`,
    artifact.entityId ? `entity:${artifact.entityId}` : '',
    artifact.derivedFromArtifactId ? `artifact:${artifact.derivedFromArtifactId}` : '',
  ].filter(Boolean);
}

function knowledgeTitle(artifact: KnowledgeArtifact, knowledgeClass: KnowledgeClass): string {
  const metadataTitle = metadataString(artifact.metadata, 'title');
  if (metadataTitle) return metadataTitle;
  const entity = artifact.entityId ? ` ${artifact.entityId}` : '';
  return `${capitalize(knowledgeClass)} ${artifact.kind}${entity}`;
}

function knowledgeContent(artifact: KnowledgeArtifact, title: string): string {
  const text =
    metadataString(artifact.metadata, 'text')
    ?? metadataString(artifact.metadata, 'content')
    ?? metadataString(artifact.metadata, 'summary');
  if (text) return text;
  return [
    title,
    '',
    `Kind: ${artifact.kind}`,
    `Status: ${artifact.status}`,
    artifact.entityId ? `Entity: ${artifact.entityId}` : null,
    `URI: ${artifact.uri}`,
  ].filter((line): line is string => line !== null).join('\n');
}

function knowledgeSummary(artifact: KnowledgeArtifact): string | null {
  return metadataString(artifact.metadata, 'summary')
    ?? metadataString(artifact.metadata, 'text')
    ?? metadataString(artifact.metadata, 'content');
}

function reasonForKnowledgeArtifact(
  artifact: KnowledgeArtifact,
  knowledgeClass: KnowledgeClass,
  reviewStatus: string | null = null,
): string {
  if (reviewStatus) {
    return `Project knowledge carries reviewStatus=${reviewStatus}; select it as evidence only and require human review before treating it as authoritative.`;
  }
  if (knowledgeClass === 'seed') return 'Seed project knowledge is selected as initial direction and constraints.';
  if (knowledgeClass === 'confirmed') return 'Accepted project knowledge is selected as confirmed guidance.';
  return `Recovered project knowledge is selected from ${artifact.kind} metadata for calibration.`;
}

function metadataString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isProjectInventoryKnowledgeArtifact(artifact: KnowledgeArtifact): boolean {
  return projectInventoryContentForKnowledgeArtifact(artifact) !== null;
}

function isSourceChunkIndexKnowledgeArtifact(artifact: KnowledgeArtifact): boolean {
  return sourceChunkIndexContentForKnowledgeArtifact(artifact) !== null;
}

function isProjectCapabilityMapCorrectionArtifact(artifact: KnowledgeArtifact): boolean {
  return metadataString(artifact.metadata, 'correctionKind') === 'project_capability_map';
}

function projectInventoryContentForKnowledgeArtifact(artifact: KnowledgeArtifact): string | null {
  const metadata = artifact.metadata;
  for (const key of ['projectInventory', 'inventory']) {
    const value = metadata[key];
    if (isRecord(value) && value.schemaVersion === 'ainp.project_inventory.v1') {
      return JSON.stringify(value);
    }
  }

  const inventoryName =
    metadataString(metadata, 'output')
    ?? metadataString(metadata, 'name')
    ?? metadataString(metadata, 'title')
    ?? artifact.uri;
  for (const key of ['projectInventoryJson', 'inventoryJson', 'content', 'text']) {
    const value = metadataString(metadata, key);
    if (value && isProjectInventoryJsonContent(value)) return value;
  }

  return null;
}

function sourceChunkIndexContentForKnowledgeArtifact(artifact: KnowledgeArtifact): string | null {
  const metadata = artifact.metadata;
  const value = metadata.sourceChunkIndex;
  if (isRecord(value) && value.schemaVersion === 'ainp.source_chunk_index.v1') {
    return JSON.stringify(value);
  }

  const indexName =
    metadataString(metadata, 'output')
    ?? metadataString(metadata, 'name')
    ?? metadataString(metadata, 'title')
    ?? artifact.uri;
  for (const key of ['sourceChunkIndexJson', 'content', 'text']) {
    const text = metadataString(metadata, key);
    if (text && isSourceChunkIndexInputArtifact(indexName, text)) return text;
  }

  return null;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Turn prior-attempt feedback into candidates (08-09 P1-2 R2).
 *
 * Both sources render into the same shape so the agent does not have to know
 * whether a human or a reviewer said it — only "last time this was wrong, and
 * here is the suggestion".
 *
 * `trustLevel: 'inference'` on purpose: this is somebody's judgement about a
 * failure, and that judgement can itself be wrong. It must never outrank the
 * code and artifacts, which are facts. Same reason it gets its own manifest
 * type rather than `task_artifact` (ADR-2).
 */
function candidatesForPriorFeedback(
  priorFeedback: readonly PriorFeedbackInput[],
  sensitivePathPatterns: readonly string[],
): ContextCandidate[] {
  return priorFeedback
    .map((feedback, index): ContextCandidate | null => {
      const content = sanitizeSensitiveContextText(feedback.text, sensitivePathPatterns);
      if (!normalizeOptionalText(content)) return null;
      const label = feedback.source === 'human_rejection'
        ? 'Human rejection'
        : 'Reviewer remediation';
      const scope = feedback.stage ? ` (${feedback.stage} stage)` : '';
      return candidate({
        id: `${PRIOR_FEEDBACK_SECTION_PREFIX}${index}_${slugify(feedback.source)}`,
        title: `Prior attempt feedback: ${label}${scope}`,
        content,
        summary: inputArtifactSummary(content),
        retrievalQuery: `Why the previous ${feedback.stage ?? 'attempt'} was rejected and what to change.`,
        sourceType: 'run_artifact',
        sourceRefs: filteredSourceRefs([feedback.sourceRef], sensitivePathPatterns),
        reason: `A previous attempt was rejected; ${label.toLowerCase()} explains what to fix.`,
        priority: 1,
        knowledgeClass: 'recovered',
        trustLevel: 'inference',
        freshness: 'current',
        confidence: feedback.source === 'human_rejection' ? 0.9 : 0.75,
        mode: 'full',
        createdAt: feedback.createdAt ?? null,
        required: false,
      });
    })
    .filter((item): item is ContextCandidate => item !== null);
}

function candidatesForInputArtifacts(
  inputArtifacts: readonly BuildContextPackInputArtifact[],
  sensitivePathPatterns: readonly string[],
): ContextCandidate[] {
  return inputArtifacts
    .filter((artifact) => !isFoundationInputArtifact(artifact.name))
    .map((artifact): ContextCandidate | null => {
      const content = sanitizeSensitiveContextText(artifact.content, sensitivePathPatterns);
      if (!normalizeOptionalText(content)) return null;
      const title = `Input Artifact: ${artifact.name}`;
      return candidate({
        id: `input_${slugify(artifact.name)}`,
        title,
        content,
        summary: inputArtifactSummary(content),
        retrievalQuery: `Retrieve current run artifact ${artifact.name}${artifact.artifactId ? ` (${artifact.artifactId})` : ''} before relying on prior-stage output.`,
        sourceType: artifact.artifactId ? 'run_artifact' : 'current_input',
        sourceRefs: [
          artifact.artifactId ? `artifact:${artifact.artifactId}` : '',
          `input:${artifact.name}`,
        ].filter(Boolean),
        reason: `Current workflow input artifact "${artifact.name}" is available from an earlier stage or invocation input.`,
        priority: inputArtifactPriority(artifact.name),
        knowledgeClass: 'recovered',
        trustLevel: 'source',
        freshness: 'current',
        confidence: artifact.artifactId ? 0.85 : 0.75,
        mode: 'full',
        createdAt: artifact.createdAt ?? null,
        required: artifact.required === true,
      });
    })
    .filter((item): item is ContextCandidate => item !== null);
}

interface ProjectInventorySource {
  name: string;
  content: string;
  createdAt?: string | null;
  sourceRefs: string[];
  sourceKind: 'current_run' | 'historical_knowledge';
}

interface ProjectInventoryCandidateInput {
  sources: readonly ProjectInventorySource[];
  capabilityCorrections: ReadonlyMap<string, readonly CapabilityMapCorrection[]>;
  taskBrief: string;
  sourceHintRoots: readonly string[];
  sensitivePathPatterns: readonly string[];
}

interface InventoryRecord {
  id: string;
  [key: string]: unknown;
}

interface InventoryRecordMatch {
  record: InventoryRecord;
  score: number;
  matchedTokens: string[];
  matchedSourceRefs: string[];
}

type CapabilityMapCorrectionAction = 'accepted' | 'renamed' | 'merged' | 'wrong';

interface CapabilityMapCorrection {
  artifactId: string;
  action: CapabilityMapCorrectionAction;
  capabilityId: string;
  originalLabel: string | null;
  correctedLabel: string | null;
  mergeTarget: string | null;
  sourceRefs: string[];
  createdAt: string | null;
}

function candidatesForProjectInventorySources(
  input: ProjectInventoryCandidateInput,
): ContextCandidate[] {
  const candidates: ContextCandidate[] = [];
  const tokens = taskTokens(input.taskBrief);
  const focusTokens = taskFocusTokens(input.taskBrief);
  const sourceHints = sourceHintsFromTaskBrief(input.taskBrief, input.sourceHintRoots);
  const contentSha256Hints = contentSha256HintsFromTaskBrief(input.taskBrief);
  const parsedSources = parsedProjectInventorySources(input.sources);
  const currentContentSha256Matches = currentInventoryContentSha256Matches(parsedSources, contentSha256Hints);
  const currentSourceRefChunkMatches = currentInventorySourceRefChunkMatches(parsedSources, sourceHints);
  const historicalSourceChunkFallbackPointers = currentInventoryHasSourceChunks(parsedSources)
    ? []
    : currentInventorySourceChunkFallbackPointers({
      sources: parsedSources,
      tokens,
      focusTokens,
      sourceHints,
      capabilityCorrections: input.capabilityCorrections,
    });
  for (const { source, inventory } of parsedSources) {
    const rankedCapabilityMatches = rankedInventoryRecords(
      inventory.capabilities,
      tokens,
      (record) => inventoryRecordSearchText(
        record,
        inventory,
        correctionsForCapability(record, input.capabilityCorrections),
      ),
      {
        sourceHints,
        sourceRefsFor: (record) => capabilitySearchSourceRefs(record, inventory),
      },
    );
    const sourceRefCapabilityMatches = rankedCapabilityMatches.filter((match) => (
      match.matchedSourceRefs.length > 0
    ));
    const rawCapabilityMatches = sourceRefCapabilityMatches.length > 0
      ? sourceRefCapabilityMatches
      : rankedCapabilityMatches;
    const focusedRawCapabilityMatches = dropCoveredWeakCapabilityMatches(rawCapabilityMatches);
    const suppressedCapabilityMatches = focusedRawCapabilityMatches
      .filter((match) => hasWrongCapabilityCorrection(correctionsForCapability(
        match.record,
        input.capabilityCorrections,
      )))
      .slice(0, 6);
    const capabilityMatches = focusedRawCapabilityMatches
      .filter((match) => !hasWrongCapabilityCorrection(correctionsForCapability(
        match.record,
        input.capabilityCorrections,
      )))
      .slice(0, 6);
    const matchedCapabilityIds = new Set(capabilityMatches.map((match) => match.record.id));
    const suppressedCorrectionIndex = suppressedCapabilityCorrectionIndex(
      inventory.capabilities,
      input.capabilityCorrections,
    );
    const sourceChunkPointers: InventoryRecord[] = [];

    for (const match of suppressedCapabilityMatches) {
      const capability = match.record;
      const corrections = correctionsForCapability(capability, input.capabilityCorrections);
      const wrongCorrections = corrections.filter((correction) => correction.action === 'wrong');
      candidates.push(inventoryCandidate({
        id: `inventory_correction_${slugify(capability.id)}`,
        title: `Capability Correction: ${stringField(capability, 'label') ?? capability.id}`,
        content: renderSuppressedCapabilityCorrectionProbe(capability, wrongCorrections),
        reason: `Accepted capability-map correction marks ${stringField(capability, 'label') ?? capability.id} as wrong; heuristic capability suppressed while source-level inventory evidence remains available.`,
        sourceRefs: filteredSourceRefs(
          [
            ...stringArrayField(capability, 'sourceRefs'),
            ...wrongCorrections.flatMap((correction) => correction.sourceRefs),
            ...source.sourceRefs,
          ],
          input.sensitivePathPatterns,
        ),
        priority: 1,
        confidence: 0.8,
        createdAt: latestCorrectionCreatedAt(wrongCorrections) ?? source.createdAt ?? null,
      }));
    }

    for (const match of capabilityMatches) {
      const capability = match.record;
      const corrections = correctionsForCapability(capability, input.capabilityCorrections);
      const correctionSourceRefs = corrections.flatMap((correction) => correction.sourceRefs);
      const capabilityLabel = capabilityDisplayLabel(capability, corrections);
      const capabilityToken = capabilityTokenFor(capability, corrections);
      const entrypoints = recordsByRefs(inventory.entrypoints, stringArrayField(capability, 'entrypointRefs'));
      const symbols = recordsByRefs(inventory.symbols, stringArrayField(capability, 'symbolRefs'));
      const domainEntities = recordsByRefs(inventory.domainEntities, stringArrayField(capability, 'domainEntityRefs'));
      const tests = recordsByRefs(inventory.testSurfaces, stringArrayField(capability, 'testRefs'));
      const hotspots = recordsByRefs(inventory.hotspots, stringArrayField(capability, 'hotspotRefs'));
      const focus = focusedCapabilityRecords({
        entrypoints,
        symbols,
        domainEntities,
        allDomainEntities: inventory.domainEntities,
        tests,
        hotspots,
        symbolGraphEdges: inventory.symbolGraphEdges,
        tokens: focusTokens,
        sourceHints,
      });
      sourceChunkPointers.push(
        ...focus.entrypoints,
        ...focus.symbols,
        ...focus.domainEntities,
        ...focus.tests,
        ...focus.hotspots,
        ...focus.graphEdges,
      );

      candidates.push(inventoryCandidate({
        id: `inventory_capability_${slugify(capability.id)}`,
        title: `Capability Map: ${capabilityLabel}`,
        content: renderCapabilityProbe(
          capability,
          focus.entrypoints,
          focus.symbols,
          focus.domainEntities,
          focus.tests,
          focus.hotspots,
          corrections,
        ),
        reason: [
          match.matchedTokens.length > 0
            ? `Project inventory capability matched the task brief (${match.matchedTokens.join(', ')}).`
            : '',
          match.matchedSourceRefs.length > 0
            ? `Project inventory capability matched explicit task source refs (${match.matchedSourceRefs.join(', ')}).`
            : '',
          corrections.length > 0
            ? 'Includes accepted capability-map correction context without replacing inventory/source evidence.'
            : '',
        ].filter(Boolean).join(' '),
        sourceRefs: filteredSourceRefs(
          [
            ...focus.entrypoints.flatMap((record) => stringArrayField(record, 'sourceRefs')),
            ...focus.symbols.flatMap((record) => stringArrayField(record, 'sourceRefs')),
            ...focus.domainEntities.flatMap(inventoryRecordSourceRefs),
            ...focus.tests.flatMap((record) => stringArrayField(record, 'sourceRefs')),
            ...focus.hotspots.flatMap((record) => stringArrayField(record, 'sourceRefs')),
            ...focus.graphEdges.flatMap((record) => stringArrayField(record, 'sourceRefs')),
            ...correctionSourceRefs,
            ...source.sourceRefs,
          ],
          input.sensitivePathPatterns,
        ),
        priority: 1,
        confidence: numberField(capability, 'confidence') ?? 0.7,
        createdAt: latestCorrectionCreatedAt(corrections) ?? source.createdAt ?? null,
      }));

      if (focus.symbols.length > 0) {
        candidates.push(inventoryCandidate({
          id: `inventory_symbols_${slugify(capabilityToken)}`,
          title: `Symbols: ${capabilityLabel}`,
          content: renderSymbolProbe(focus.symbols),
          reason: `Project inventory symbols attached to matched capability ${capabilityLabel}.`,
          sourceRefs: filteredSourceRefs(
            [
              ...focus.symbols.flatMap((record) => stringArrayField(record, 'sourceRefs')),
              ...focus.graphEdges.flatMap((record) => stringArrayField(record, 'sourceRefs')),
              ...correctionSourceRefs,
              ...source.sourceRefs,
            ],
            input.sensitivePathPatterns,
          ),
          priority: 1,
          confidence: Math.max(0.65, Math.min(0.9, numberField(capability, 'confidence') ?? 0.7)),
          createdAt: latestCorrectionCreatedAt(corrections) ?? source.createdAt ?? null,
        }));
      }

      if (focus.domainEntities.length > 0) {
        candidates.push(inventoryCandidate({
          id: `inventory_domain_entities_${slugify(capabilityToken)}`,
          title: `Domain Entities: ${capabilityLabel}`,
          content: renderDomainEntityProbe(focus.domainEntities),
          reason: `Project inventory domain/data entities attached to matched capability ${capabilityLabel}.`,
          sourceRefs: filteredSourceRefs(
            [
              ...focus.domainEntities.flatMap(inventoryRecordSourceRefs),
              ...correctionSourceRefs,
              ...source.sourceRefs,
            ],
            input.sensitivePathPatterns,
          ),
          priority: 1,
          confidence: Math.max(0.65, Math.min(0.88, numberField(capability, 'confidence') ?? 0.7)),
          createdAt: latestCorrectionCreatedAt(corrections) ?? source.createdAt ?? null,
        }));
      }

      if (focus.tests.length > 0) {
        candidates.push(inventoryCandidate({
          id: `inventory_tests_${slugify(capabilityToken)}`,
          title: `Test Surface: ${capabilityLabel}`,
          content: renderTestProbe(focus.tests),
          reason: `Project inventory test surfaces attached to matched capability ${capabilityLabel}.`,
          sourceRefs: filteredSourceRefs(
            [
              ...focus.tests.flatMap((record) => stringArrayField(record, 'sourceRefs')),
              ...correctionSourceRefs,
              ...source.sourceRefs,
            ],
            input.sensitivePathPatterns,
          ),
          priority: 1,
          confidence: 0.8,
          createdAt: latestCorrectionCreatedAt(corrections) ?? source.createdAt ?? null,
        }));
      }

      if (focus.hotspots.length > 0) {
        candidates.push(inventoryCandidate({
          id: `inventory_hotspots_${slugify(capabilityToken)}`,
          title: `Hotspots: ${capabilityLabel}`,
          content: renderHotspotProbe(focus.hotspots),
          reason: `Project inventory hotspots attached to matched capability ${capabilityLabel}.`,
          sourceRefs: filteredSourceRefs(
            [
              ...focus.hotspots.flatMap((record) => stringArrayField(record, 'sourceRefs')),
              ...correctionSourceRefs,
              ...source.sourceRefs,
            ],
            input.sensitivePathPatterns,
          ),
          priority: 2,
          confidence: 0.65,
          createdAt: latestCorrectionCreatedAt(corrections) ?? source.createdAt ?? null,
        }));
      }
    }

    const rankedHybridMatches = rankedHybridInventoryRecords(
      inventory,
      tokens,
      matchedCapabilityIds,
      sourceHints,
    );
    const hybridMatches = capabilityMatches.length === 0
      ? rankedHybridMatches.slice(0, 4)
      : rankedHybridMatches.filter((match) => match.matchedSourceRefs.length > 0).slice(0, 2);
    for (const match of hybridMatches) {
      const suppressedCorrections = suppressedCorrectionsForInventoryRefs(
        suppressedCorrectionIndex,
        [match.record.id],
      );
      candidates.push(inventoryCandidate({
        id: `inventory_hybrid_${slugify(match.record.id)}`,
        title: `Hybrid Retrieval: ${hybridRecordTitle(match)}`,
        content: renderHybridInventoryProbe(match, suppressedCorrections),
        reason: [
          match.matchedTokens.length > 0
            ? `Hybrid inventory retrieval matched the task brief (${match.matchedTokens.join(', ')}; bm25=${match.score.toFixed(2)}).`
            : '',
          match.matchedSourceRefs.length > 0
            ? `Hybrid inventory retrieval matched explicit task source refs (${match.matchedSourceRefs.join(', ')}).`
            : '',
          suppressedCorrections.length > 0
            ? 'Accepted wrong capability correction suppressed an attached capability, so this section is source-level fallback evidence only.'
            : '',
        ].filter(Boolean).join(' '),
        sourceRefs: filteredSourceRefs(
          [
            ...inventoryRecordSourceRefs(match.record),
            ...match.graphEdges.flatMap((edge) => stringArrayField(edge, 'sourceRefs')),
            ...suppressedCorrections.flatMap((correction) => correction.sourceRefs),
            ...source.sourceRefs,
          ],
          input.sensitivePathPatterns,
        ),
        priority: 2,
        confidence: Math.min(0.85, 0.45 + Math.min(match.score, 4) / 10),
        createdAt: latestCorrectionCreatedAt(suppressedCorrections) ?? source.createdAt ?? null,
      }));
    }

    const rankedSourceChunkMatches = rankedSourceChunkRecords(
      inventory.sourceChunks,
      tokens,
      [
        ...sourceChunkPointers,
        ...hybridMatches.flatMap((match) => [match.record, ...match.graphEdges]),
        ...(source.sourceKind === 'historical_knowledge' ? historicalSourceChunkFallbackPointers : []),
      ],
      sourceHints,
      contentSha256Hints,
    );
    const sourceChunkMatches = (
      capabilityMatches.length > 0
        ? rankedSourceChunkMatches.filter((match) => (
          match.matchedSourceRefs.length > 0
          || match.matchedContentSha256 !== null
          || match.pointedBy.length > 0
          || (
            match.matchedTokens.length > 0
            && stringArrayField(match.record, 'capabilityRefs').some((id) => matchedCapabilityIds.has(id))
          )
        ))
        : rankedSourceChunkMatches
    )
      .filter((match) => !shouldSuppressHistoricalContentSha256Match(
        source,
        match,
        currentContentSha256Matches,
      ))
      .filter((match) => !shouldSuppressHistoricalSourceRefMatch(
        source,
        match,
        currentSourceRefChunkMatches,
      ))
      .slice(0, 4);
    for (const match of sourceChunkMatches) {
      if (isSensitiveSourceChunk(match.record, input.sensitivePathPatterns)) continue;
      const suppressedCorrections = suppressedCorrectionsForSourceChunkMatch(
        match,
        suppressedCorrectionIndex,
      );
      const content = renderSourceChunkProbe(match, input.sensitivePathPatterns, suppressedCorrections);
      if (!normalizeOptionalText(content)) continue;
      candidates.push(inventoryCandidate({
        id: `inventory_source_chunk_${slugify(match.record.id)}`,
        title: `Source Chunk: ${sourceChunkTitle(match.record)}`,
        content,
        summary: sourceChunkProbeSummary(content),
        reason: sourceChunkReason(match, suppressedCorrections),
        sourceRefs: filteredSourceRefs(
          [
            ...source.sourceRefs,
            ...sourceRefsForSourceChunkMatch(match),
            ...stringArrayField(match.record, 'sourceRefs').filter((ref) => !ref.startsWith('file:')),
            ...match.pointedBy.flatMap(inventoryRecordSourceRefs),
            ...suppressedCorrections.flatMap((correction) => correction.sourceRefs),
          ],
          input.sensitivePathPatterns,
        ),
        priority: 2,
        confidence: Math.max(0.55, Math.min(0.8, numberField(match.record, 'confidence') ?? 0.65)),
        createdAt: latestCorrectionCreatedAt(suppressedCorrections) ?? source.createdAt ?? null,
      }));
    }
  }
  return candidates;
}

function currentInventoryHasSourceChunks(
  sources: readonly ParsedProjectInventorySource[],
): boolean {
  return sources.some(({ source, inventory }) => (
    source.sourceKind === 'current_run' && inventory.sourceChunks.length > 0
  ));
}

function currentInventorySourceChunkFallbackPointers(input: {
  sources: readonly ParsedProjectInventorySource[];
  tokens: readonly string[];
  focusTokens: readonly string[];
  sourceHints: readonly SourceHint[];
  capabilityCorrections: ReadonlyMap<string, readonly CapabilityMapCorrection[]>;
}): InventoryRecord[] {
  const pointers: InventoryRecord[] = [];
  for (const { source, inventory } of input.sources) {
    if (source.sourceKind !== 'current_run') continue;
    const capabilityMatches = dropCoveredWeakCapabilityMatches(rankedInventoryRecords(
      inventory.capabilities,
      input.tokens,
      (record) => inventoryRecordSearchText(
        record,
        inventory,
        correctionsForCapability(record, input.capabilityCorrections),
      ),
      {
        sourceHints: input.sourceHints,
        sourceRefsFor: (record) => capabilitySearchSourceRefs(record, inventory),
      },
    ))
      .filter((match) => !hasWrongCapabilityCorrection(correctionsForCapability(
        match.record,
        input.capabilityCorrections,
      )))
      .slice(0, 4);

    for (const match of capabilityMatches) {
      const capability = match.record;
      const entrypoints = recordsByRefs(inventory.entrypoints, stringArrayField(capability, 'entrypointRefs'));
      const symbols = recordsByRefs(inventory.symbols, stringArrayField(capability, 'symbolRefs'));
      const domainEntities = recordsByRefs(inventory.domainEntities, stringArrayField(capability, 'domainEntityRefs'));
      const tests = recordsByRefs(inventory.testSurfaces, stringArrayField(capability, 'testRefs'));
      const hotspots = recordsByRefs(inventory.hotspots, stringArrayField(capability, 'hotspotRefs'));
      const focus = focusedCapabilityRecords({
        entrypoints,
        symbols,
        domainEntities,
        allDomainEntities: inventory.domainEntities,
        tests,
        hotspots,
        symbolGraphEdges: inventory.symbolGraphEdges,
        tokens: input.focusTokens,
        sourceHints: input.sourceHints,
      });
      pointers.push(
        ...focus.entrypoints,
        ...focus.symbols,
        ...focus.domainEntities,
        ...focus.tests,
        ...focus.hotspots,
        ...focus.graphEdges,
      );
    }

    const matchedCapabilityIds = new Set(capabilityMatches.map((match) => match.record.id));
    const hybridMatches = rankedHybridInventoryRecords(
      inventory,
      input.tokens,
      matchedCapabilityIds,
      input.sourceHints,
    ).slice(0, 4);
    pointers.push(...hybridMatches.flatMap((match) => [match.record, ...match.graphEdges]));
  }

  const sourceBackedPointers = pointers.map((record) => ({
    ...record,
    sourceRefs: uniqueStrings([
      ...stringArrayField(record, 'sourceRefs'),
      ...sourceRefsForFallbackPointerSource(input.sources, record),
    ]),
  }))
    .filter((record) => inventoryRecordSourceRefs(record).length > 0);
  return uniqueRecordsById(sourceBackedPointers);
}

function sourceRefsForFallbackPointerSource(
  sources: readonly ParsedProjectInventorySource[],
  record: InventoryRecord,
): string[] {
  const recordSourceRefs = new Set(inventoryRecordSourceRefs(record));
  return sources
    .filter(({ source, inventory }) => (
      source.sourceKind === 'current_run'
      && currentInventoryContainsRecord(inventory, record)
      && recordSourceRefs.size > 0
    ))
    .flatMap(({ source }) => source.sourceRefs);
}

function currentInventoryContainsRecord(
  inventory: ParsedProjectInventorySource['inventory'],
  record: InventoryRecord,
): boolean {
  return [
    inventory.entrypoints,
    inventory.symbols,
    inventory.domainEntities,
    inventory.testSurfaces,
    inventory.hotspots,
    inventory.capabilities,
    inventory.symbolGraphEdges,
  ].some((records) => records.some((item) => item.id === record.id));
}

function projectInventorySourcesFromInputArtifacts(
  inputArtifacts: readonly BuildContextPackInputArtifact[],
  sensitivePathPatterns: readonly string[],
): ProjectInventorySource[] {
  return inputArtifacts.map((artifact) => ({
    name: artifact.name,
    content: artifact.content,
    createdAt: artifact.createdAt ?? null,
    sourceKind: 'current_run',
    sourceRefs: filteredSourceRefs([
      artifact.artifactId ? `artifact:${artifact.artifactId}` : `input:${artifact.name}`,
    ], sensitivePathPatterns),
  }));
}

function projectInventorySourcesFromKnowledgeArtifacts(
  artifacts: readonly KnowledgeArtifact[],
  sensitivePathPatterns: readonly string[],
): ProjectInventorySource[] {
  return artifacts
    .map((artifact): ProjectInventorySource | null => {
      if (artifact.status !== 'accepted') return null;
      const sourceChunkIndexContent = sourceChunkIndexContentForKnowledgeArtifact(artifact);
      const content = projectInventoryContentForKnowledgeArtifact(artifact) ?? sourceChunkIndexContent;
      if (!content) return null;
      const metadata = contextMetadataForKnowledgeArtifact(artifact);
      const outputName = metadataString(artifact.metadata, 'output')
        ?? metadataString(artifact.metadata, 'name')
        ?? (sourceChunkIndexContent ? 'source-chunk-index.json' : 'project-inventory.json');
      return {
        name: outputName,
        content,
        createdAt: artifact.updatedAt ?? artifact.createdAt,
        sourceKind: 'historical_knowledge',
        sourceRefs: filteredSourceRefs([
          `knowledge_artifact:${artifact.id}`,
          artifact.derivedFromArtifactId ? `artifact:${artifact.derivedFromArtifactId}` : '',
          ...metadata.sourceRefs,
        ], sensitivePathPatterns),
      };
    })
    .filter((source): source is ProjectInventorySource => source !== null);
}

function parsedProjectInventorySources(
  sources: readonly ProjectInventorySource[],
): ParsedProjectInventorySource[] {
  const parsedSources = sources
    .map((source): ParsedProjectInventorySource | null => {
      const inventory = parseProjectInventorySource(source);
      return inventory ? { source, inventory } : null;
    })
    .filter((source): source is ParsedProjectInventorySource => source !== null);
  return enrichCurrentInventorySourcesWithHistoricalSourceChunkIndex(parsedSources);
}

function enrichCurrentInventorySourcesWithHistoricalSourceChunkIndex(
  sources: readonly ParsedProjectInventorySource[],
): ParsedProjectInventorySource[] {
  const historicalIndexEntriesByKey = new Map<string, InventoryRecord[]>();
  for (const { source, inventory } of sources) {
    const isStandaloneIndexInput = inventory.sourceChunks.length === 0
      && inventory.sourceChunkIndexEntries.length > 0;
    if (source.sourceKind !== 'historical_knowledge' && !isStandaloneIndexInput) continue;
    for (const entry of inventory.sourceChunkIndexEntries) {
      for (const key of sourceChunkIndexMatchKeys(entry)) {
        const entries = historicalIndexEntriesByKey.get(key) ?? [];
        entries.push(entry);
        historicalIndexEntriesByKey.set(key, entries);
      }
    }
  }

  if (historicalIndexEntriesByKey.size === 0) return [...sources];

  return sources.map((parsed) => {
    if (parsed.source.sourceKind !== 'current_run') return parsed;
    let changed = false;
    const sourceChunks = parsed.inventory.sourceChunks.map((chunk) => {
      const historicalEntries = uniqueRecordsById(sourceChunkIndexMatchKeys(chunk)
        .flatMap((key) => historicalIndexEntriesByKey.get(key) ?? []));
      if (historicalEntries.length === 0) return chunk;
      changed = true;
      return historicalEntries.reduce(
        (merged, entry) => mergeSourceChunkIndexEntryIntoChunk(merged, entry),
        chunk,
      );
    });
    return changed
      ? { ...parsed, inventory: { ...parsed.inventory, sourceChunks } }
      : parsed;
  });
}

function currentInventoryContentSha256Matches(
  sources: readonly ParsedProjectInventorySource[],
  contentSha256Hints: readonly string[],
): Set<string> {
  const hintSet = new Set(contentSha256Hints.map((hint) => hint.toLowerCase()));
  const matches = new Set<string>();
  if (hintSet.size === 0) return matches;
  for (const { source, inventory } of sources) {
    if (source.sourceKind !== 'current_run') continue;
    for (const chunk of inventory.sourceChunks) {
      const contentSha256 = sourceChunkContentSha256(chunk)?.toLowerCase();
      if (contentSha256 && hintSet.has(contentSha256)) matches.add(contentSha256);
    }
  }
  return matches;
}

function currentInventorySourceRefChunkMatches(
  sources: readonly ParsedProjectInventorySource[],
  sourceHints: readonly SourceHint[],
): Set<string> {
  const matches = new Set<string>();
  if (sourceHints.length === 0) return matches;
  for (const { source, inventory } of sources) {
    if (source.sourceKind !== 'current_run') continue;
    for (const chunk of inventory.sourceChunks) {
      if (sourceRefsForSourceHints(chunk, sourceHints).length === 0) continue;
      for (const key of sourceChunkFingerprintKeys(chunk)) {
        matches.add(key);
      }
    }
  }
  return matches;
}

function shouldSuppressHistoricalContentSha256Match(
  source: ProjectInventorySource,
  match: SourceChunkMatch,
  currentContentSha256Matches: ReadonlySet<string>,
): boolean {
  return source.sourceKind === 'historical_knowledge'
    && match.matchedContentSha256 !== null
    && currentContentSha256Matches.has(match.matchedContentSha256.toLowerCase());
}

function shouldSuppressHistoricalSourceRefMatch(
  source: ProjectInventorySource,
  match: SourceChunkMatch,
  currentSourceRefChunkMatches: ReadonlySet<string>,
): boolean {
  return source.sourceKind === 'historical_knowledge'
    && match.matchedSourceRefs.length > 0
    && sourceChunkFingerprintKeys(match.record).some((key) => currentSourceRefChunkMatches.has(key));
}

function capabilityMapCorrectionsFromKnowledgeArtifacts(
  artifacts: readonly KnowledgeArtifact[],
  sensitivePathPatterns: readonly string[],
): Map<string, CapabilityMapCorrection[]> {
  const byCapability = new Map<string, CapabilityMapCorrection[]>();
  for (const artifact of artifacts) {
    const correction = capabilityMapCorrectionFromKnowledgeArtifact(artifact, sensitivePathPatterns);
    if (!correction) continue;
    const existing = byCapability.get(correction.capabilityId) ?? [];
    existing.push(correction);
    existing.sort(compareCapabilityCorrections);
    byCapability.set(correction.capabilityId, existing);
  }
  return byCapability;
}

function capabilityMapCorrectionFromKnowledgeArtifact(
  artifact: KnowledgeArtifact,
  sensitivePathPatterns: readonly string[],
): CapabilityMapCorrection | null {
  if (artifact.status !== 'accepted') return null;
  if (!isProjectCapabilityMapCorrectionArtifact(artifact)) return null;
  if (reviewStatusForMetadata(artifact.metadata) !== null) return null;

  const action = capabilityCorrectionAction(metadataString(artifact.metadata, 'correctionAction'));
  const capabilityId = metadataString(artifact.metadata, 'capabilityId');
  if (!action || !capabilityId) return null;

  const inventoryArtifactId = metadataString(artifact.metadata, 'inventoryArtifactId');
  return {
    artifactId: artifact.id,
    action,
    capabilityId,
    originalLabel: metadataString(artifact.metadata, 'originalLabel'),
    correctedLabel: metadataString(artifact.metadata, 'correctedLabel'),
    mergeTarget: metadataString(artifact.metadata, 'mergeTarget'),
    sourceRefs: filteredSourceRefs([
      `knowledge_artifact:${artifact.id}`,
      `knowledge:${artifact.status}`,
      artifact.derivedFromArtifactId ? `artifact:${artifact.derivedFromArtifactId}` : '',
      inventoryArtifactId ? `artifact:${inventoryArtifactId}` : '',
      `capability:${capabilityId}`,
      ...stringArrayField(artifact.metadata, 'sourceRefs'),
      ...stringArrayField(artifact.metadata, 'evidenceRefs'),
    ], sensitivePathPatterns),
    createdAt: artifact.updatedAt ?? artifact.createdAt ?? null,
  };
}

function correctionMetadataEvidenceRefs(metadata: Record<string, unknown>): string[] {
  return uniqueStrings([
    ...stringArrayField(metadata, 'sourceRefs'),
    ...stringArrayField(metadata, 'evidenceRefs'),
  ]);
}

function capabilityCorrectionAction(value: string | null): CapabilityMapCorrectionAction | null {
  switch (value) {
    case 'accepted':
    case 'renamed':
    case 'merged':
    case 'wrong':
      return value;
    default:
      return null;
  }
}

function compareCapabilityCorrections(
  a: CapabilityMapCorrection,
  b: CapabilityMapCorrection,
): number {
  return b.createdAt?.localeCompare(a.createdAt ?? '') || a.artifactId.localeCompare(b.artifactId);
}

function correctionsForCapability(
  capability: InventoryRecord,
  corrections: ReadonlyMap<string, readonly CapabilityMapCorrection[]>,
): readonly CapabilityMapCorrection[] {
  return corrections.get(capability.id) ?? [];
}

function hasWrongCapabilityCorrection(corrections: readonly CapabilityMapCorrection[]): boolean {
  return corrections.some((correction) => correction.action === 'wrong');
}

function latestCorrectionCreatedAt(corrections: readonly CapabilityMapCorrection[]): string | null {
  return corrections.find((correction) => Boolean(correction.createdAt))?.createdAt ?? null;
}

function suppressedCapabilityCorrectionIndex(
  capabilities: readonly InventoryRecord[],
  corrections: ReadonlyMap<string, readonly CapabilityMapCorrection[]>,
): Map<string, CapabilityMapCorrection[]> {
  const byInventoryRef = new Map<string, CapabilityMapCorrection[]>();
  for (const capability of capabilities) {
    const wrongCorrections = correctionsForCapability(capability, corrections)
      .filter((correction) => correction.action === 'wrong');
    if (wrongCorrections.length === 0) continue;

    for (const ref of attachedCapabilityInventoryRefs(capability)) {
      const existing = byInventoryRef.get(ref) ?? [];
      byInventoryRef.set(ref, uniqueCapabilityCorrections([...existing, ...wrongCorrections]));
    }
  }
  return byInventoryRef;
}

function attachedCapabilityInventoryRefs(capability: InventoryRecord): string[] {
  return uniqueStrings([
    capability.id,
    ...stringArrayField(capability, 'entrypointRefs'),
    ...stringArrayField(capability, 'symbolRefs'),
    ...stringArrayField(capability, 'domainEntityRefs'),
    ...stringArrayField(capability, 'testRefs'),
    ...stringArrayField(capability, 'hotspotRefs'),
  ]);
}

function suppressedCorrectionsForInventoryRefs(
  index: ReadonlyMap<string, readonly CapabilityMapCorrection[]>,
  refs: readonly string[],
): readonly CapabilityMapCorrection[] {
  return uniqueCapabilityCorrections(refs.flatMap((ref) => index.get(ref) ?? []));
}

function suppressedCorrectionsForSourceChunkMatch(
  match: SourceChunkMatch,
  index: ReadonlyMap<string, readonly CapabilityMapCorrection[]>,
): readonly CapabilityMapCorrection[] {
  return suppressedCorrectionsForInventoryRefs(index, [
    match.record.id,
    ...stringArrayField(match.record, 'capabilityRefs'),
    ...stringArrayField(match.record, 'entrypointRefs'),
    ...stringArrayField(match.record, 'symbolRefs'),
    ...stringArrayField(match.record, 'domainEntityRefs'),
    ...stringArrayField(match.record, 'testRefs'),
    ...stringArrayField(match.record, 'hotspotRefs'),
    ...match.pointedBy.map((record) => record.id),
  ]);
}

function uniqueCapabilityCorrections(
  corrections: readonly CapabilityMapCorrection[],
): CapabilityMapCorrection[] {
  const byArtifact = new Map<string, CapabilityMapCorrection>();
  for (const correction of corrections) {
    if (!byArtifact.has(correction.artifactId)) byArtifact.set(correction.artifactId, correction);
  }
  return [...byArtifact.values()].sort(compareCapabilityCorrections);
}

function parseProjectInventorySource(
  source: ProjectInventorySource,
): {
  entrypoints: InventoryRecord[];
  symbols: InventoryRecord[];
  domainEntities: InventoryRecord[];
  testSurfaces: InventoryRecord[];
  hotspots: InventoryRecord[];
  capabilities: InventoryRecord[];
  symbolGraphEdges: InventoryRecord[];
  sourceChunks: InventoryRecord[];
  sourceChunkIndexEntries: InventoryRecord[];
} | null {
  if (!isProjectInventoryInputArtifact(source.name, source.content)) return null;
  try {
    const parsed = JSON.parse(source.content) as Record<string, unknown>;
    if (parsed.schemaVersion === 'ainp.source_chunk_index.v1') {
      return {
        entrypoints: [],
        symbols: [],
        domainEntities: [],
        testSurfaces: [],
        hotspots: [],
        capabilities: [],
        symbolGraphEdges: [],
        sourceChunks: [],
        sourceChunkIndexEntries: inventorySourceChunkIndexEntries(parsed, source.sourceRefs),
      };
    }
    if (parsed.schemaVersion !== 'ainp.project_inventory.v1') return null;
    const sourceChunkIndexEntries = inventorySourceChunkIndexEntries(parsed.sourceChunkIndex);
    return {
      entrypoints: inventoryRecords(parsed.entrypoints),
      symbols: inventoryRecords(parsed.symbols),
      domainEntities: inventoryRecords(parsed.domainEntities),
      testSurfaces: inventoryRecords(parsed.testSurfaces),
      hotspots: inventoryRecords(parsed.hotspots),
      capabilities: inventoryRecords(parsed.capabilities),
      symbolGraphEdges: inventoryRecords(isRecord(parsed.symbolGraph) ? parsed.symbolGraph.edges : null),
      sourceChunks: mergeSourceChunkIndexEntries(
        inventoryRecords(parsed.sourceChunks),
        sourceChunkIndexEntries,
      ),
      sourceChunkIndexEntries,
    };
  } catch {
    return null;
  }
}

function inventoryRecords(value: unknown): InventoryRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({ ...item, id: stringField(item, 'id') ?? '' }))
    .filter((item) => item.id);
}

function inventorySourceChunkIndexEntries(
  value: unknown,
  sourceChunkIndexSourceRefs: readonly string[] = [],
): InventoryRecord[] {
  if (!isRecord(value)) return [];
  if (value.schemaVersion !== 'ainp.source_chunk_index.v1') return [];
  if (!Array.isArray(value.entries)) return [];
  return value.entries
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      ...item,
      id: stringField(item, 'id')
        ?? stringField(item, 'sourceChunkRef')
        ?? stringField(item, 'chunkRef')
        ?? '',
      sourceChunkIndexSourceRefs: uniqueStrings([
        ...stringArrayField(item, 'sourceChunkIndexSourceRefs'),
        ...sourceChunkIndexSourceRefs,
      ]),
    }))
    .filter((item) => item.id && sourceChunkContentSha256(item));
}

function mergeSourceChunkIndexEntries(
  chunks: readonly InventoryRecord[],
  indexEntries: readonly InventoryRecord[],
): InventoryRecord[] {
  if (chunks.length === 0 || indexEntries.length === 0) return [...chunks];
  const entriesByKey = new Map<string, InventoryRecord[]>();
  for (const entry of indexEntries) {
    for (const key of sourceChunkIndexMatchKeys(entry)) {
      const entries = entriesByKey.get(key) ?? [];
      entries.push(entry);
      entriesByKey.set(key, entries);
    }
  }
  return chunks.map((chunk) => {
    const entries = uniqueRecordsById(sourceChunkIndexMatchKeys(chunk)
      .flatMap((key) => entriesByKey.get(key) ?? []));
    return entries.reduce(
      (merged, entry) => mergeSourceChunkIndexEntryIntoChunk(merged, entry),
      chunk,
    );
  });
}

function mergeSourceChunkIndexEntryIntoChunk(
  chunk: InventoryRecord,
  entry: InventoryRecord,
): InventoryRecord {
  const merged: InventoryRecord = { ...chunk };
  const indexedContentSha256 = sourceChunkContentSha256(entry);
  if (!sourceChunkContentSha256(merged) && indexedContentSha256) {
    merged.contentSha256 = indexedContentSha256;
  }
  const indexedLanguage = stringField(entry, 'language');
  if (!stringField(merged, 'language') && indexedLanguage) {
    merged.language = indexedLanguage;
  }
  for (const field of [
    'sourceRefs',
    'entrypointRefs',
    'symbolRefs',
    'domainEntityRefs',
    'graphEdgeRefs',
    'testRefs',
    'hotspotRefs',
    'capabilityRefs',
  ]) {
    const refs = uniqueStrings([
      ...stringArrayField(merged, field),
      ...sourceChunkIndexEntryRefsForMerge(entry, field),
    ]);
    if (refs.length > 0) merged[field] = refs;
  }
  const lexicalTokens = uniqueStrings([
    ...stringArrayField(merged, 'lexicalTokens'),
    ...stringArrayField(entry, 'lexicalTokens'),
  ]).slice(0, SOURCE_CHUNK_INDEX_MAX_LEXICAL_TOKENS);
  if (lexicalTokens.length > 0) merged.lexicalTokens = lexicalTokens;

  const searchText = boundedSourceChunkIndexSearchText([
    stringField(merged, 'searchText'),
    stringField(entry, 'searchText'),
  ]);
  if (searchText) merged.searchText = searchText;

  const linkedRecordRefs = uniqueStrings([
    ...stringArrayField(merged, 'linkedRecordRefs'),
    ...stringArrayField(entry, 'linkedRecordRefs'),
  ]).slice(0, SOURCE_CHUNK_INDEX_MAX_LINKED_RECORD_REFS);
  if (linkedRecordRefs.length > 0) merged.linkedRecordRefs = linkedRecordRefs;

  return merged;
}

function sourceChunkIndexEntryRefsForMerge(
  entry: InventoryRecord,
  field: string,
): string[] {
  const refs = stringArrayField(entry, field);
  return field === 'sourceRefs'
    ? uniqueStrings([
      ...refs.filter((ref) => ref.startsWith('file:')),
      ...stringArrayField(entry, 'sourceChunkIndexSourceRefs'),
    ])
    : refs;
}

function boundedSourceChunkIndexSearchText(values: readonly (string | null)[]): string {
  const normalized = uniqueStrings(values
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => normalizeSearchText(value).split(' ')));
  const selected: string[] = [];
  let length = 0;
  for (const token of normalized) {
    const nextLength = length + (selected.length > 0 ? 1 : 0) + token.length;
    if (nextLength > SOURCE_CHUNK_INDEX_MAX_SEARCH_TEXT_CHARS) break;
    selected.push(token);
    length = nextLength;
  }
  return selected.join(' ');
}

function sourceChunkIndexMatchKeys(record: InventoryRecord): string[] {
  const contentSha256 = sourceChunkContentSha256(record);
  const path = stringField(record, 'path');
  const startLine = numberField(record, 'startLine');
  const endLine = numberField(record, 'endLine');
  const sourceChunkRef = stringField(record, 'sourceChunkRef') ?? stringField(record, 'chunkRef');
  return uniqueStrings([
    sourceChunkRef ? `id:${sourceChunkRef}` : '',
    record.id ? `id:${record.id}` : '',
    contentSha256 && path && startLine !== null && endLine !== null
      ? `hash_loc:${contentSha256}:${path}:${startLine}:${endLine}`
      : '',
    path && startLine !== null && endLine !== null ? `loc:${path}:${startLine}:${endLine}` : '',
    ...sourceChunkLinkedRecordKeys(record),
  ]);
}

function rankedInventoryRecords(
  records: readonly InventoryRecord[],
  tokens: readonly string[],
  textFor: (record: InventoryRecord) => string,
  options: {
    sourceHints?: readonly SourceHint[];
    sourceRefsFor?: (record: InventoryRecord) => string[];
  } = {},
): InventoryRecordMatch[] {
  return records
    .map((record) => {
      const text = normalizeSearchText(textFor(record));
      const matchedTokens = tokens.filter((token) => matchesSearchToken(text, token));
      const matchedSourceRefs = sourceRefsMatchingHints(
        options.sourceRefsFor?.(record) ?? [],
        options.sourceHints ?? [],
      );
      return {
        record,
        score: matchedTokens.length + matchedSourceRefs.length * 2 + (numberField(record, 'confidence') ?? 0),
        matchedTokens,
        matchedSourceRefs,
      };
    })
    .filter((item) => item.matchedTokens.length > 0 || item.matchedSourceRefs.length > 0)
    .sort((a, b) => b.score - a.score || a.record.id.localeCompare(b.record.id));
}

function dropCoveredWeakCapabilityMatches(matches: readonly InventoryRecordMatch[]): InventoryRecordMatch[] {
  const maxTokenCount = Math.max(0, ...matches.map((match) => match.matchedTokens.length));
  if (maxTokenCount <= 1) return [...matches];
  const strongestTokenCoverage = new Set(matches
    .filter((match) => match.matchedTokens.length === maxTokenCount)
    .flatMap((match) => match.matchedTokens));
  return matches.filter((match) => {
    if (match.matchedSourceRefs.length > 0) return true;
    if (match.matchedTokens.length === maxTokenCount) return true;
    return !match.matchedTokens.every((token) => strongestTokenCoverage.has(token));
  });
}

interface FocusedCapabilityRecordsInput {
  entrypoints: readonly InventoryRecord[];
  symbols: readonly InventoryRecord[];
  domainEntities: readonly InventoryRecord[];
  allDomainEntities: readonly InventoryRecord[];
  tests: readonly InventoryRecord[];
  hotspots: readonly InventoryRecord[];
  symbolGraphEdges: readonly InventoryRecord[];
  tokens: readonly string[];
  sourceHints: readonly SourceHint[];
}

interface FocusedCapabilityRecords {
  entrypoints: InventoryRecord[];
  symbols: InventoryRecord[];
  domainEntities: InventoryRecord[];
  tests: InventoryRecord[];
  hotspots: InventoryRecord[];
  graphEdges: InventoryRecord[];
}

function focusedCapabilityRecords(input: FocusedCapabilityRecordsInput): FocusedCapabilityRecords {
  const entrypoints = focusEntrypointsByTask(
    input.entrypoints,
    input.symbols,
    input.symbolGraphEdges,
    input.tokens,
    input.sourceHints,
  );
  const tests = focusRecordsByTask(input.tests, input.tokens, testFocusText, input.sourceHints);
  const hotspots = focusRecordsByTask(input.hotspots, input.tokens, hotspotFocusText, input.sourceHints);
  const shouldNarrowSymbols = input.entrypoints.length > 1;
  const graphEdges = graphEdgesReachableFromRecords(entrypoints, input.symbolGraphEdges);
  const graphSymbolIds = new Set(
    graphEdges.flatMap((edge) => [
      symbolIdFromGraphNodeRef(stringField(edge, 'from')),
      symbolIdFromGraphNodeRef(stringField(edge, 'to')),
    ]).filter((id): id is string => Boolean(id)),
  );
  const graphSymbols = input.symbols.filter((symbol) => graphSymbolIds.has(symbol.id));
  const graphSymbolPaths = new Set(
    graphSymbols
      .map((symbol) => stringField(symbol, 'path'))
      .filter((path): path is string => Boolean(path)),
  );
  const graphPathClassSymbols = input.symbols.filter((symbol) => (
    stringField(symbol, 'kind') === 'class'
    && graphSymbolPaths.has(stringField(symbol, 'path') ?? '')
  ));
  const graphFocusedSymbols = uniqueRecordsById([
    ...graphPathClassSymbols,
    ...graphSymbols,
  ]);
  const textFocusedSymbols = shouldNarrowSymbols && graphFocusedSymbols.length > 0
    ? []
    : shouldNarrowSymbols
      ? focusRecordsByTask(input.symbols, input.tokens, symbolFocusText, input.sourceHints)
      : [...input.symbols];
  const symbols = uniqueRecordsById([
    ...graphFocusedSymbols,
    ...textFocusedSymbols,
  ]);
  const matchedDomainEntities = focusRecordsByTask(
    input.domainEntities,
    input.tokens,
    domainEntityFocusText,
    input.sourceHints,
  );
  const relatedDomainEntities = recordsByRefs(
    input.allDomainEntities,
    matchedDomainEntities.flatMap((record) => domainEntityRelationships(record)
      .map((relationship) => relationship.domainEntityRef)),
  );
  const domainEntities = uniqueRecordsById([
    ...matchedDomainEntities,
    ...relatedDomainEntities,
  ]);
  return {
    entrypoints,
    symbols: symbols.length > 0 ? symbols : [...input.symbols],
    domainEntities,
    tests,
    hotspots,
    graphEdges,
  };
}

function focusEntrypointsByTask(
  entrypoints: readonly InventoryRecord[],
  symbols: readonly InventoryRecord[],
  symbolGraphEdges: readonly InventoryRecord[],
  tokens: readonly string[],
  sourceHints: readonly SourceHint[],
): InventoryRecord[] {
  if (entrypoints.length <= 1) return [...entrypoints];
  const symbolById = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  const directSourceHintMatches = focusRecordsBySourceHints(entrypoints, sourceHints);
  if (directSourceHintMatches.length > 0) return directSourceHintMatches;
  const ranked = entrypoints.map((entrypoint) => {
    const graphEdges = graphEdgesReachableFromRecords([entrypoint], symbolGraphEdges);
    const graphSymbolIds = uniqueStrings(graphEdges.flatMap((edge) => [
      symbolIdFromGraphNodeRef(stringField(edge, 'from')),
      symbolIdFromGraphNodeRef(stringField(edge, 'to')),
    ]).filter((id): id is string => Boolean(id)));
    const graphSymbols = graphSymbolIds
      .map((id) => symbolById.get(id))
      .filter((symbol): symbol is InventoryRecord => Boolean(symbol));
    const matchedSourceRefs = sourceRefsMatchingHints([
      ...stringArrayField(entrypoint, 'sourceRefs'),
      ...graphEdges.flatMap((edge) => stringArrayField(edge, 'sourceRefs')),
      ...graphSymbols.flatMap((symbol) => stringArrayField(symbol, 'sourceRefs')),
    ], sourceHints);
    const text = normalizeSearchText([
      entrypointFocusText(entrypoint),
      ...graphSymbols.map(symbolFocusText),
    ].join(' '));
    const matchedTokens = tokens.filter((token) => matchesSearchToken(text, token));
    return { record: entrypoint, matchedSourceRefs, matchedTokens };
  });
  const maxSourceRefMatches = Math.max(...ranked.map((item) => item.matchedSourceRefs.length));
  if (maxSourceRefMatches > 0) {
    return ranked
      .filter((item) => item.matchedSourceRefs.length === maxSourceRefMatches)
      .map((item) => item.record);
  }
  if (tokens.length === 0) return [...entrypoints];
  const maxMatches = Math.max(...ranked.map((item) => item.matchedTokens.length));
  if (maxMatches <= 0) return [...entrypoints];
  const focused = ranked
    .filter((item) => item.matchedTokens.length === maxMatches)
    .map((item) => item.record);
  return includeTaskRequestedServiceHostEntrypoints(focused, ranked, tokens);
}

function includeTaskRequestedServiceHostEntrypoints(
  focused: readonly InventoryRecord[],
  ranked: ReadonlyArray<{
    record: InventoryRecord;
    matchedSourceRefs: readonly string[];
    matchedTokens: readonly string[];
  }>,
  tokens: readonly string[],
): InventoryRecord[] {
  const hostTokens = tokens.filter(isServiceHostTaskToken);
  if (hostTokens.length === 0) return [...focused];
  const focusedIds = new Set(focused.map((record) => record.id));
  const hostEntrypoints = ranked
    .filter((item) => (
      !focusedIds.has(item.record.id)
      && isWcfServiceHostEntrypointRecord(item.record)
      && item.matchedTokens.some((token) => hostTokens.includes(token))
    ))
    .map((item) => item.record);
  return uniqueRecordsById([...focused, ...hostEntrypoints]);
}

function isServiceHostTaskToken(token: string): boolean {
  return token === 'svc' || token === 'host' || token === 'servicehost';
}

function isWcfServiceHostEntrypointRecord(record: InventoryRecord): boolean {
  const route = stringField(record, 'route')?.toLowerCase() ?? '';
  const path = stringField(record, 'path')?.toLowerCase() ?? '';
  const handler = stringField(record, 'handler') ?? '';
  return (route.endsWith('.svc') || path.endsWith('.svc'))
    && /^WCF:[A-Za-z_][\w]*$/.test(handler);
}

function focusRecordsByTask(
  records: readonly InventoryRecord[],
  tokens: readonly string[],
  textFor: (record: InventoryRecord) => string,
  sourceHints: readonly SourceHint[],
): InventoryRecord[] {
  if (records.length <= 1) return [...records];
  const sourceHintMatches = focusRecordsBySourceHints(records, sourceHints);
  if (sourceHintMatches.length > 0) return sourceHintMatches;
  if (tokens.length === 0) return [...records];
  const ranked = records.map((record) => {
    const text = normalizeSearchText(textFor(record));
    const matchedTokens = tokens.filter((token) => matchesSearchToken(text, token));
    return { record, matchedTokens };
  });
  const maxMatches = Math.max(...ranked.map((item) => item.matchedTokens.length));
  if (maxMatches <= 0) return [...records];
  return ranked
    .filter((item) => item.matchedTokens.length === maxMatches)
    .map((item) => item.record);
}

function focusRecordsBySourceHints(
  records: readonly InventoryRecord[],
  sourceHints: readonly SourceHint[],
): InventoryRecord[] {
  if (sourceHints.length === 0) return [];
  const ranked = records.map((record) => ({
    record,
    matchedSourceRefs: sourceRefsMatchingHints(inventoryRecordSourceRefs(record), sourceHints),
  }));
  const maxMatches = Math.max(0, ...ranked.map((item) => item.matchedSourceRefs.length));
  if (maxMatches <= 0) return [];
  return ranked
    .filter((item) => item.matchedSourceRefs.length === maxMatches)
    .map((item) => item.record);
}

function graphEdgesReachableFromRecords(
  records: readonly InventoryRecord[],
  edges: readonly InventoryRecord[],
): InventoryRecord[] {
  const visitedNodes = new Set(records.flatMap(graphNodeRefsForRecord));
  const selected: InventoryRecord[] = [];
  let changed = true;
  while (changed && selected.length < 64) {
    changed = false;
    for (const edge of edges) {
      if (selected.some((item) => item.id === edge.id)) continue;
      const from = stringField(edge, 'from');
      const to = stringField(edge, 'to');
      if (!from || !to || !visitedNodes.has(from)) continue;
      selected.push(edge);
      visitedNodes.add(to);
      changed = true;
    }
  }
  return selected;
}

function graphNodeRefsForRecord(record: InventoryRecord): string[] {
  return [
    record.id,
    `node_entrypoint_${record.id}`,
    `node_symbol_${record.id}`,
  ];
}

function symbolIdFromGraphNodeRef(ref: string | null): string | null {
  return ref?.startsWith('node_symbol_') ? ref.slice('node_symbol_'.length) : null;
}

function uniqueRecordsById(records: readonly InventoryRecord[]): InventoryRecord[] {
  const byId = new Map<string, InventoryRecord>();
  for (const record of records) {
    if (!byId.has(record.id)) byId.set(record.id, record);
  }
  return [...byId.values()];
}

function entrypointFocusText(record: InventoryRecord): string {
  return [
    stringField(record, 'label'),
    stringField(record, 'method'),
    stringField(record, 'route'),
    stringField(record, 'handler'),
  ].filter((item): item is string => Boolean(item)).join(' ');
}

function symbolFocusText(record: InventoryRecord): string {
  return [
    stringField(record, 'kind'),
    stringField(record, 'name'),
    stringField(record, 'signature'),
  ].filter((item): item is string => Boolean(item)).join(' ');
}

function domainEntityFocusText(record: InventoryRecord): string {
  return [
    stringField(record, 'kind'),
    stringField(record, 'name'),
    ...domainEntityRelationships(record).flatMap((relationship) => [
      relationship.direction,
      relationship.name,
    ]),
  ].filter((item): item is string => Boolean(item)).join(' ');
}

function testFocusText(record: InventoryRecord): string {
  return [
    stringField(record, 'path'),
    stringField(record, 'frameworkHint'),
    ...stringArrayField(record, 'targetHints'),
  ].filter((item): item is string => Boolean(item)).join(' ');
}

function hotspotFocusText(record: InventoryRecord): string {
  return [
    stringField(record, 'reason'),
    stringField(record, 'path'),
  ].filter((item): item is string => Boolean(item)).join(' ');
}

interface HybridInventoryMatch {
  record: InventoryRecord;
  recordType: 'entrypoint' | 'symbol' | 'domain_entity' | 'test_surface' | 'hotspot' | 'symbol_graph_edge';
  score: number;
  matchedTokens: string[];
  matchedSourceRefs: string[];
  graphEdges: InventoryRecord[];
}

function rankedHybridInventoryRecords(
  inventory: {
    entrypoints: InventoryRecord[];
    symbols: InventoryRecord[];
    domainEntities: InventoryRecord[];
    testSurfaces: InventoryRecord[];
    hotspots: InventoryRecord[];
    capabilities: InventoryRecord[];
    symbolGraphEdges: InventoryRecord[];
  },
  tokens: readonly string[],
  matchedCapabilityIds: ReadonlySet<string>,
  sourceHints: readonly SourceHint[] = [],
): HybridInventoryMatch[] {
  if (tokens.length === 0 && sourceHints.length === 0) return [];
  const attachedRefs = new Set<string>();
  for (const capability of inventory.capabilities) {
    if (!matchedCapabilityIds.has(capability.id)) continue;
    for (const ref of [
      ...stringArrayField(capability, 'entrypointRefs'),
      ...stringArrayField(capability, 'symbolRefs'),
      ...stringArrayField(capability, 'domainEntityRefs'),
      ...stringArrayField(capability, 'testRefs'),
      ...stringArrayField(capability, 'hotspotRefs'),
    ]) {
      attachedRefs.add(ref);
    }
  }

  const documents = [
    ...inventory.entrypoints.map((record) => hybridDocument(record, 'entrypoint' as const)),
    ...inventory.symbols.map((record) => hybridDocument(record, 'symbol' as const)),
    ...inventory.domainEntities.map((record) => hybridDocument(record, 'domain_entity' as const)),
    ...inventory.testSurfaces.map((record) => hybridDocument(record, 'test_surface' as const)),
    ...inventory.hotspots.map((record) => hybridDocument(record, 'hotspot' as const)),
    ...inventory.symbolGraphEdges.map((record) => hybridDocument(record, 'symbol_graph_edge' as const)),
  ].filter((document) => !attachedRefs.has(document.record.id));
  if (documents.length === 0) return [];

  const avgLength = documents.reduce((sum, document) => sum + document.terms.length, 0) / documents.length || 1;
  const documentFrequency = new Map<string, number>();
  for (const token of tokens) {
    documentFrequency.set(
      token,
      documents.filter((document) => hybridTermFrequency(document.terms, token) > 0).length,
    );
  }

  return documents
    .map((document) => {
      const graphEdges = document.recordType === 'symbol_graph_edge'
        ? [document.record]
        : graphEdgesForRecord(document.record, inventory.symbolGraphEdges);
      const matchedTokens = tokens.filter((token) => hybridTermFrequency(document.terms, token) > 0);
      const matchedSourceRefs = sourceRefsMatchingExactLineHints(
        [
          ...inventoryRecordSourceRefs(document.record),
          ...graphEdges.flatMap((edge) => stringArrayField(edge, 'sourceRefs')),
        ],
        sourceHints,
      );
      const score = matchedTokens.reduce((sum, token) => {
        const frequency = hybridTermFrequency(document.terms, token);
        const df = documentFrequency.get(token) ?? 0;
        return sum + bm25TermScore({
          termFrequency: frequency,
          documentFrequency: df,
          documentCount: documents.length,
          documentLength: document.terms.length,
          averageDocumentLength: avgLength,
        });
      }, 0);
      return {
        record: document.record,
        recordType: document.recordType,
        score: score + matchedSourceRefs.length * 2 + (numberField(document.record, 'confidence') ?? 0),
        matchedTokens,
        matchedSourceRefs,
        graphEdges,
      };
    })
    .filter((match) => (match.matchedTokens.length > 0 || match.matchedSourceRefs.length > 0) && match.score > 0)
    .sort((a, b) => b.score - a.score || a.record.id.localeCompare(b.record.id));
}

function hybridDocument(record: InventoryRecord, recordType: HybridInventoryMatch['recordType']): {
  record: InventoryRecord;
  recordType: HybridInventoryMatch['recordType'];
  terms: string[];
} {
  const text = [
    stringField(record, 'label'),
    stringField(record, 'kind'),
    stringField(record, 'name'),
    stringField(record, 'route'),
    stringField(record, 'handler'),
    stringField(record, 'signature'),
    stringField(record, 'frameworkHint'),
    stringField(record, 'reason'),
    ...stringArrayField(record, 'targetHints'),
    ...domainEntityRelationships(record).flatMap((relationship) => [
      relationship.direction,
      relationship.name,
    ]),
  ].filter((item): item is string => Boolean(item)).join(' ');
  return {
    record,
    recordType,
    terms: normalizeSearchText(text).split(' ').filter(Boolean),
  };
}

function hybridTermFrequency(terms: readonly string[], token: string): number {
  const tokenVariants = searchTokenVariants(token);
  return terms.filter((term) => (
    searchTokenVariants(term).some((termVariant) => (
      tokenVariants.some((tokenVariant) => (
        termVariant === tokenVariant
        || (tokenVariant.length >= 4 && termVariant.includes(tokenVariant))
      ))
    ))
  )).length;
}

function bm25TermScore(input: {
  termFrequency: number;
  documentFrequency: number;
  documentCount: number;
  documentLength: number;
  averageDocumentLength: number;
}): number {
  if (input.termFrequency <= 0 || input.documentFrequency <= 0) return 0;
  const k1 = 1.2;
  const b = 0.75;
  const idf = Math.log(1 + (input.documentCount - input.documentFrequency + 0.5) / (input.documentFrequency + 0.5));
  const denominator = input.termFrequency
    + k1 * (1 - b + b * (input.documentLength / input.averageDocumentLength));
  return idf * ((input.termFrequency * (k1 + 1)) / denominator);
}

function graphEdgesForRecord(record: InventoryRecord, edges: readonly InventoryRecord[]): InventoryRecord[] {
  const refs = new Set([
    record.id,
    `node_entrypoint_${record.id}`,
    `node_symbol_${record.id}`,
  ]);
  return edges.filter((edge) => (
    refs.has(stringField(edge, 'from') ?? '')
    || refs.has(stringField(edge, 'to') ?? '')
  ));
}

function hybridRecordTitle(match: HybridInventoryMatch): string {
  return [
    match.recordType,
    stringField(match.record, 'label')
      ?? stringField(match.record, 'name')
      ?? stringField(match.record, 'path')
      ?? match.record.id,
  ].join(' ');
}

function renderHybridInventoryProbe(
  match: HybridInventoryMatch,
  corrections: readonly CapabilityMapCorrection[] = [],
): string {
  return [
    `Hybrid match: ${hybridRecordTitle(match)}`,
    `Record ID: ${match.record.id}`,
    match.matchedTokens.length > 0 ? `Matched tokens: ${match.matchedTokens.join(', ')}` : null,
    match.matchedSourceRefs.length > 0 ? `Matched source refs: ${match.matchedSourceRefs.join(', ')}` : null,
    `BM25 score: ${match.score.toFixed(2)}`,
    corrections.length > 0
      ? 'Source-level fallback: an accepted wrong capability correction suppressed the attached capability grouping.'
      : null,
    renderCapabilityCorrectionReview(corrections),
    renderHybridRecord(match.recordType, match.record),
    renderRecordList('Graph Edges', match.graphEdges, (edge) => [
      stringField(edge, 'kind'),
      stringField(edge, 'from'),
      '->',
      stringField(edge, 'to'),
      stringField(edge, 'label'),
    ].filter(Boolean).join(' ')),
  ].filter((line): line is string => Boolean(line)).join('\n');
}

function renderHybridRecord(recordType: HybridInventoryMatch['recordType'], record: InventoryRecord): string {
  if (recordType === 'entrypoint') {
    return [
      'Entrypoint:',
      `- ${[
        stringField(record, 'label'),
        stringField(record, 'method'),
        stringField(record, 'route'),
        stringField(record, 'handler') ? `handler=${stringField(record, 'handler')}` : null,
        stringField(record, 'path'),
      ].filter(Boolean).join(' | ')}`,
    ].join('\n');
  }
  if (recordType === 'symbol') {
    return [
      'Symbol:',
      `- ${[
        stringField(record, 'kind'),
        stringField(record, 'name'),
        stringField(record, 'path'),
        stringField(record, 'signature'),
      ].filter(Boolean).join(' | ')}`,
    ].join('\n');
  }
  if (recordType === 'domain_entity') {
    return [
      'Domain Entity:',
      `- ${[
        stringField(record, 'kind'),
        stringField(record, 'name'),
        stringField(record, 'path'),
      ].filter(Boolean).join(' | ')}`,
      renderDomainEntityRelationships(record),
    ].join('\n');
  }
  if (recordType === 'test_surface') {
    return [
      'Test Surface:',
      `- ${[
        stringField(record, 'path'),
        stringField(record, 'frameworkHint'),
        stringArrayField(record, 'targetHints').join(', '),
      ].filter(Boolean).join(' | ')}`,
    ].join('\n');
  }
  if (recordType === 'symbol_graph_edge') {
    return [
      'Graph Edge:',
      `- ${[
        stringField(record, 'kind'),
        stringField(record, 'from'),
        '->',
        stringField(record, 'to'),
        stringField(record, 'label'),
      ].filter(Boolean).join(' ')}`,
    ].join('\n');
  }
  return [
    'Hotspot:',
    `- ${[
      stringField(record, 'reason'),
      stringField(record, 'path'),
      numberField(record, 'score') !== null ? `score=${numberField(record, 'score')}` : null,
    ].filter(Boolean).join(' | ')}`,
  ].join('\n');
}

interface SourceChunkMatch {
  record: InventoryRecord;
  score: number;
  lexicalScore: number;
  matchedTokens: string[];
  matchedSnippetTokens: string[];
  matchedSourceRefs: string[];
  matchedContentSha256: string | null;
  pointedBy: InventoryRecord[];
}

interface SourceHint {
  path: string;
  line: number | null;
}

function rankedSourceChunkRecords(
  chunks: readonly InventoryRecord[],
  tokens: readonly string[],
  pointingRecords: readonly InventoryRecord[],
  sourceHints: readonly SourceHint[],
  contentSha256Hints: readonly string[] = [],
): SourceChunkMatch[] {
  if (chunks.length === 0) return [];
  const uniquePointingRecords = uniqueRecordsById(pointingRecords);
  const hashHints = new Set(contentSha256Hints.map((hint) => hint.toLowerCase()));
  const documents = chunks.map((record) => ({
    record,
    terms: normalizeSearchText(sourceChunkSearchText(record)).split(' ').filter(Boolean),
    snippetTerms: normalizeSearchText(sourceChunkSnippetSearchText(record)).split(' ').filter(Boolean),
  }));
  const avgLength = documents.reduce((sum, document) => sum + document.terms.length, 0) / documents.length || 1;
  const documentFrequency = new Map<string, number>();
  for (const token of tokens) {
    documentFrequency.set(
      token,
      documents.filter((document) => hybridTermFrequency(document.terms, token) > 0).length,
    );
  }

  return documents
    .map((document) => {
      const { record } = document;
      const matchedTokens = tokens.filter((token) => hybridTermFrequency(document.terms, token) > 0);
      const matchedSnippetTokens = tokens.filter((token) => (
        hybridTermFrequency(document.snippetTerms, token) > 0
      ));
      const lexicalScore = matchedTokens.reduce((sum, token) => {
        const frequency = hybridTermFrequency(document.terms, token);
        const df = documentFrequency.get(token) ?? 0;
        return sum + bm25TermScore({
          termFrequency: frequency,
          documentFrequency: df,
          documentCount: documents.length,
          documentLength: document.terms.length,
          averageDocumentLength: avgLength,
        });
      }, 0);
      const matchedSourceRefs = sourceRefsForSourceHints(record, sourceHints);
      const contentSha256 = sourceChunkContentSha256(record);
      const matchedContentSha256 = contentSha256 && hashHints.has(contentSha256.toLowerCase())
        ? contentSha256
        : null;
      const pointedBy = uniquePointingRecords.filter((item) => inventoryRecordPointsToSourceChunk(item, record));
      return {
        record,
        matchedTokens,
        matchedSnippetTokens,
        matchedSourceRefs,
        matchedContentSha256,
        pointedBy,
        lexicalScore,
        score: lexicalScore
          + (matchedContentSha256 ? 3 : 0)
          + (matchedSourceRefs.length > 0 ? 2 : 0)
          + (pointedBy.length > 0 ? 1.5 : 0)
          + (numberField(record, 'confidence') ?? 0),
      };
    })
    .filter((match) => (
      match.matchedTokens.length > 0
      || match.matchedSourceRefs.length > 0
      || match.matchedContentSha256 !== null
      || match.pointedBy.length > 0
    ))
    .sort((a, b) => (
      Number(Boolean(b.matchedContentSha256)) - Number(Boolean(a.matchedContentSha256))
      || Number(b.matchedSourceRefs.length > 0) - Number(a.matchedSourceRefs.length > 0)
      || b.matchedSourceRefs.length - a.matchedSourceRefs.length
      || Number(b.pointedBy.length > 0) - Number(a.pointedBy.length > 0)
      || b.pointedBy.length - a.pointedBy.length
      || b.score - a.score
      || a.record.id.localeCompare(b.record.id)
    ));
}

function sourceRefsForSourceHints(
  chunk: InventoryRecord,
  sourceHints: readonly SourceHint[],
): string[] {
  if (sourceHints.length === 0) return [];
  const indexedSourceRefMatches = sourceRefsMatchingExactLineHints(
    stringArrayField(chunk, 'sourceRefs'),
    sourceHints,
  );
  const path = stringField(chunk, 'path');
  if (!path) return indexedSourceRefMatches;
  const startLine = numberField(chunk, 'startLine');
  const endLine = numberField(chunk, 'endLine');
  const refs: string[] = [...indexedSourceRefMatches];
  for (const hint of sourceHints) {
    if (hint.path !== path) continue;
    if (hint.line === null) continue;
    if ((startLine === null || hint.line >= startLine) && (endLine === null || hint.line <= endLine)) {
      refs.push(`file:${path}#L${hint.line}`);
    }
  }
  return uniqueStrings(refs);
}

function inventoryRecordPointsToSourceChunk(record: InventoryRecord, chunk: InventoryRecord): boolean {
  const chunkId = chunk.id;
  if (stringArrayField(record, 'sourceChunkRefs').includes(chunkId)) return true;
  const chunkInventoryRefs = new Set([
    ...stringArrayField(chunk, 'entrypointRefs'),
    ...stringArrayField(chunk, 'symbolRefs'),
    ...stringArrayField(chunk, 'domainEntityRefs'),
    ...stringArrayField(chunk, 'graphEdgeRefs'),
    ...stringArrayField(chunk, 'testRefs'),
    ...stringArrayField(chunk, 'hotspotRefs'),
    ...stringArrayField(chunk, 'capabilityRefs'),
  ]);
  if (chunkInventoryRefs.has(record.id)) return true;
  const chunkPath = stringField(chunk, 'path');
  if (!chunkPath) return false;
  const recordSourceRefs = new Set(stringArrayField(record, 'sourceRefs')
    .filter((ref) => fileSourceRef(ref)?.path === chunkPath));
  if (recordSourceRefs.size === 0) return false;
  return stringArrayField(chunk, 'sourceRefs').some((ref) => (
    fileSourceRef(ref)?.path === chunkPath && recordSourceRefs.has(ref)
  ));
}

function isSensitiveSourceChunk(
  chunk: InventoryRecord,
  sensitivePathPatterns: readonly string[],
): boolean {
  const path = stringField(chunk, 'path');
  return Boolean(path && isSensitiveContextPath(path, sensitivePathPatterns))
    || stringArrayField(chunk, 'sourceRefs').some((ref) => isSensitiveContextPath(ref, sensitivePathPatterns));
}

function renderSourceChunkProbe(
  match: SourceChunkMatch,
  sensitivePathPatterns: readonly string[],
  corrections: readonly CapabilityMapCorrection[] = [],
): string {
  const record = match.record;
  const snippet = sanitizeSensitiveContextText(
    excerptForContext(sourceChunkSnippetForMatch(match), 1800),
    sensitivePathPatterns,
  ).trim();
  if (!snippet) return '';
  const contentSha256 = sourceChunkContentSha256(record);
  const language = stringField(record, 'language');
  return [
    `Source chunk: ${sourceChunkTitle(record)}`,
    `Chunk ID: ${record.id}`,
    language ? `Language: ${language}` : null,
    contentSha256 ? `Content SHA-256: ${contentSha256}` : null,
    match.matchedContentSha256 ? `Matched Content SHA-256: ${match.matchedContentSha256}` : null,
    match.matchedTokens.length > 0 ? `Matched tokens: ${match.matchedTokens.join(', ')}` : null,
    match.matchedTokens.length > 0 ? `BM25 score: ${match.lexicalScore.toFixed(2)}` : null,
    match.matchedSourceRefs.length > 0 ? `Matched source refs: ${match.matchedSourceRefs.join(', ')}` : null,
    match.pointedBy.length > 0 ? `Pointed by inventory evidence: ${match.pointedBy.map((item) => item.id).join(', ')}` : null,
    corrections.length > 0
      ? 'Source-level fallback: an accepted wrong capability correction suppressed an attached capability grouping.'
      : null,
    renderCapabilityCorrectionReview(corrections),
    renderRecordList('Linked Evidence', linkedSourceChunkEvidenceForMatch(match), (item) => [
      stringField(item, 'kind'),
      stringField(item, 'id'),
      stringField(item, 'label') ?? stringField(item, 'name') ?? stringField(item, 'path'),
    ].filter(Boolean).join(' | ')),
    'Snippet:',
    snippet,
  ].filter((line): line is string => Boolean(line)).join('\n');
}

function sourceChunkReason(
  match: SourceChunkMatch,
  corrections: readonly CapabilityMapCorrection[] = [],
): string {
  const reasons = [
    match.matchedTokens.length > 0
      ? sourceChunkLexicalMatchReason(match)
      : null,
    match.matchedSourceRefs.length > 0
      ? `task source ref matched this chunk (${match.matchedSourceRefs.join(', ')})`
      : null,
    match.matchedContentSha256
      ? `task contentSha256 matched this chunk (${match.matchedContentSha256})`
      : null,
    match.pointedBy.length > 0
      ? `hybrid inventory evidence points to this chunk (${match.pointedBy.map((record) => record.id).join(', ')})`
      : null,
    corrections.length > 0
      ? 'accepted wrong capability correction suppressed an attached capability, leaving this as source-level evidence'
      : null,
  ].filter((reason): reason is string => Boolean(reason));
  return `Project inventory source chunk selected as bounded source evidence because ${reasons.join(' and ')}.`;
}

function sourceChunkProbeSummary(content: string): string | null {
  const normalized = normalizeOptionalText(content);
  if (!normalized) return null;
  const maxLength = 1800;
  if (normalized.length <= maxLength) return normalized;

  const selected: string[] = [];
  let length = 0;
  for (const line of normalized.split('\n')) {
    const nextLength = length + (selected.length > 0 ? 1 : 0) + line.length;
    if (nextLength > maxLength && selected.length > 0) break;
    selected.push(line);
    length = nextLength;
    if (length >= maxLength) break;
  }
  return `${selected.join('\n')}\n…(source chunk truncated; retrieve source refs for full context)`;
}

function sourceChunkLexicalMatchReason(match: SourceChunkMatch): string {
  if (match.matchedSnippetTokens.length === match.matchedTokens.length) {
    return `source snippet matched the task brief (${match.matchedTokens.join(', ')})`;
  }
  if (match.matchedSnippetTokens.length > 0) {
    const indexTokens = match.matchedTokens.filter((token) => !match.matchedSnippetTokens.includes(token));
    return [
      `source snippet matched the task brief (${match.matchedSnippetTokens.join(', ')})`,
      indexTokens.length > 0
        ? `source chunk index lexical metadata matched the task brief (${indexTokens.join(', ')})`
        : '',
    ].filter(Boolean).join(' and ');
  }
  return `source chunk index lexical metadata matched the task brief (${match.matchedTokens.join(', ')})`;
}

function sourceChunkTitle(record: InventoryRecord): string {
  const path = stringField(record, 'path') ?? record.id;
  const startLine = numberField(record, 'startLine');
  const endLine = numberField(record, 'endLine');
  if (startLine !== null && endLine !== null) return `${path}:${startLine}-${endLine}`;
  return path;
}

function sourceChunkSnippet(record: InventoryRecord): string {
  return stringField(record, 'snippet')
    ?? stringField(record, 'content')
    ?? stringField(record, 'text')
    ?? '';
}

function sourceChunkContentSha256(record: InventoryRecord): string | null {
  const value = stringField(record, 'contentSha256');
  return value && /^[a-f0-9]{64}$/i.test(value) ? value : null;
}

function sourceChunkSearchText(record: InventoryRecord): string {
  return [
    sourceChunkSnippetSearchText(record),
    sourceChunkIndexLexicalSearchText(record),
  ].filter(Boolean).join('\n');
}

function sourceChunkSnippetSearchText(record: InventoryRecord): string {
  return sourceChunkSnippet(record)
    .split('\n')
    .map((line) => /^L\d+:\s*(.*)$/.exec(line)?.[1] ?? line)
    .join('\n');
}

function sourceChunkIndexLexicalSearchText(record: InventoryRecord): string {
  return [
    ...stringArrayField(record, 'lexicalTokens'),
    stringField(record, 'searchText'),
  ].filter(Boolean).join(' ');
}

function sourceChunkSnippetForMatch(match: SourceChunkMatch): string {
  const snippet = sourceChunkSnippet(match.record);
  const hintLineNumbers = sourceChunkHintLineNumbers(match);
  if (hintLineNumbers.size > 0) {
    const hintLines = snippet.split('\n').filter((line) => {
      const parsed = /^L(\d+):/.exec(line);
      return Boolean(parsed?.[1] && hintLineNumbers.has(Number(parsed[1])));
    });
    if (hintLines.length > 0) return hintLines.join('\n');
  }
  const pointedLineNumbers = sourceChunkPointedLineNumbers(match);
  if (pointedLineNumbers.size > 0) {
    const pointedLines = snippet.split('\n').filter((line) => {
      const parsed = /^L(\d+):/.exec(line);
      return Boolean(parsed?.[1] && pointedLineNumbers.has(Number(parsed[1])));
    });
    if (pointedLines.length > 0) return pointedLines.join('\n');
  }
  if (match.matchedTokens.length === 0) return snippet;
  const matchedLines = snippet.split('\n').filter((line) => {
    const parsed = /^L\d+:\s*(.*)$/.exec(line);
    const text = normalizeSearchText(parsed?.[1] ?? line);
    return match.matchedTokens.some((token) => matchesSearchToken(text, token));
  });
  return matchedLines.length > 0 ? matchedLines.join('\n') : snippet;
}

function sourceRefsForSourceChunkMatch(match: SourceChunkMatch): string[] {
  const path = stringField(match.record, 'path');
  if (!path) return stringArrayField(match.record, 'sourceRefs');

  if (match.matchedSourceRefs.length > 0) return match.matchedSourceRefs;

  const pointedLineRefs = sourceChunkPointedLineRefs(match);
  if (pointedLineRefs.length > 0) return pointedLineRefs;

  const matchedLineRefs = sourceChunkMatchedLineRefs(path, sourceChunkSnippet(match.record), match.matchedTokens);
  if (matchedLineRefs.length > 0) return matchedLineRefs;

  const startLine = numberField(match.record, 'startLine');
  if (match.pointedBy.length > 0 && startLine !== null) return [`file:${path}#L${startLine}`];

  return stringArrayField(match.record, 'sourceRefs');
}

function sourceChunkHintLineNumbers(match: SourceChunkMatch): Set<number> {
  return new Set(match.matchedSourceRefs
    .map((ref) => /^file:.+#L(\d+)$/.exec(ref)?.[1])
    .filter((line): line is string => Boolean(line))
    .map(Number)
    .filter(Number.isFinite));
}

function sourceChunkPointedLineRefs(match: SourceChunkMatch): string[] {
  const path = stringField(match.record, 'path');
  if (!path || match.pointedBy.length === 0) return [];
  const startLine = numberField(match.record, 'startLine');
  const endLine = numberField(match.record, 'endLine');
  return uniqueStrings(match.pointedBy
    .flatMap(inventoryRecordSourceRefs)
    .filter((ref) => {
      const parsed = /^file:(.+)#L(\d+)$/.exec(ref);
      if (!parsed?.[1] || !parsed[2] || parsed[1] !== path) return false;
      const line = Number(parsed[2]);
      if (!Number.isFinite(line)) return false;
      return (startLine === null || line >= startLine) && (endLine === null || line <= endLine);
    }));
}

function sourceChunkPointedLineNumbers(match: SourceChunkMatch): Set<number> {
  return new Set(sourceChunkPointedLineRefs(match)
    .map((ref) => /^file:.+#L(\d+)$/.exec(ref)?.[1])
    .filter((line): line is string => Boolean(line))
    .map(Number)
    .filter(Number.isFinite));
}

function sourceChunkMatchedLineRefs(
  path: string,
  snippet: string,
  matchedTokens: readonly string[],
): string[] {
  if (matchedTokens.length === 0) return [];
  const refs: string[] = [];
  for (const line of snippet.split('\n')) {
    const match = /^L(\d+):\s*(.*)$/.exec(line);
    if (!match?.[1]) continue;
    const text = normalizeSearchText(match[2] ?? '');
    if (!matchedTokens.some((token) => matchesSearchToken(text, token))) continue;
    refs.push(`file:${path}#L${match[1]}`);
  }
  return uniqueStrings(refs);
}

function linkedSourceChunkEvidence(record: InventoryRecord): InventoryRecord[] {
  return [
    ...stringArrayField(record, 'capabilityRefs').map((id) => ({ id, kind: 'capability' })),
    ...stringArrayField(record, 'entrypointRefs').map((id) => ({ id, kind: 'entrypoint' })),
    ...stringArrayField(record, 'symbolRefs').map((id) => ({ id, kind: 'symbol' })),
    ...stringArrayField(record, 'domainEntityRefs').map((id) => ({ id, kind: 'domain_entity' })),
    ...stringArrayField(record, 'graphEdgeRefs').map((id) => ({ id, kind: 'symbol_graph_edge' })),
    ...stringArrayField(record, 'testRefs').map((id) => ({ id, kind: 'test_surface' })),
    ...stringArrayField(record, 'hotspotRefs').map((id) => ({ id, kind: 'hotspot' })),
  ];
}

function linkedSourceChunkEvidenceForMatch(match: SourceChunkMatch): InventoryRecord[] {
  return match.pointedBy.length > 0
    ? uniqueRecordsById([...match.pointedBy, ...linkedSourceChunkEvidence(match.record)])
    : [];
}

function inventoryRecordSearchText(record: InventoryRecord, inventory: {
  entrypoints: InventoryRecord[];
  symbols: InventoryRecord[];
  domainEntities: InventoryRecord[];
  testSurfaces: InventoryRecord[];
  hotspots: InventoryRecord[];
}, corrections: readonly CapabilityMapCorrection[] = []): string {
  const entrypoints = recordsByRefs(inventory.entrypoints, stringArrayField(record, 'entrypointRefs'));
  const symbols = recordsByRefs(inventory.symbols, stringArrayField(record, 'symbolRefs'));
  const domainEntities = recordsByRefs(inventory.domainEntities, stringArrayField(record, 'domainEntityRefs'));
  const tests = recordsByRefs(inventory.testSurfaces, stringArrayField(record, 'testRefs'));
  const hotspots = recordsByRefs(inventory.hotspots, stringArrayField(record, 'hotspotRefs'));
  const usableCorrections = corrections.filter((correction) => correction.action !== 'wrong');
  return [
    stringField(record, 'label'),
    stringField(record, 'kind'),
    ...stringArrayField(record, 'openQuestions'),
    ...usableCorrections.flatMap((correction) => [
      correction.originalLabel,
      correction.correctedLabel,
      correction.mergeTarget,
    ]),
    ...entrypoints.flatMap((item) => [
      stringField(item, 'label'),
      stringField(item, 'method'),
      stringField(item, 'route'),
      entrypointHandlerSearchText(item),
    ]),
    ...symbols.flatMap((item) => [
      stringField(item, 'name'),
      stringField(item, 'signature'),
    ]),
    ...domainEntities.flatMap((item) => [
      stringField(item, 'name'),
      stringField(item, 'kind'),
      ...domainEntityRelationships(item).flatMap((relationship) => [
        relationship.direction,
        relationship.name,
      ]),
    ]),
    ...tests.flatMap((item) => [
      stringField(item, 'frameworkHint'),
      ...stringArrayField(item, 'targetHints'),
    ]),
    ...hotspots.map((item) => stringField(item, 'reason')),
  ].filter((item): item is string => Boolean(item)).join(' ');
}

function entrypointHandlerSearchText(record: InventoryRecord): string | null {
  if (stringField(record, 'kind') === 'cli_script') return null;
  return stringField(record, 'handler');
}

function capabilitySearchSourceRefs(record: InventoryRecord, inventory: {
  entrypoints: InventoryRecord[];
  symbols: InventoryRecord[];
  domainEntities: InventoryRecord[];
  testSurfaces: InventoryRecord[];
  hotspots: InventoryRecord[];
}): string[] {
  const entrypoints = recordsByRefs(inventory.entrypoints, stringArrayField(record, 'entrypointRefs'));
  const symbols = recordsByRefs(inventory.symbols, stringArrayField(record, 'symbolRefs'));
  const domainEntities = recordsByRefs(inventory.domainEntities, stringArrayField(record, 'domainEntityRefs'));
  const tests = recordsByRefs(inventory.testSurfaces, stringArrayField(record, 'testRefs'));
  const hotspots = recordsByRefs(inventory.hotspots, stringArrayField(record, 'hotspotRefs'));
  return uniqueStrings([
    ...inventoryRecordSourceRefs(record),
    ...entrypoints.flatMap((item) => stringArrayField(item, 'sourceRefs')),
    ...symbols.flatMap((item) => stringArrayField(item, 'sourceRefs')),
    ...domainEntities.flatMap(inventoryRecordSourceRefs),
    ...tests.flatMap((item) => stringArrayField(item, 'sourceRefs')),
    ...hotspots.flatMap((item) => stringArrayField(item, 'sourceRefs')),
  ]);
}

function recordsByRefs(records: readonly InventoryRecord[], refs: readonly string[]): InventoryRecord[] {
  const byId = new Map(records.map((record) => [record.id, record]));
  return refs
    .map((ref) => byId.get(ref))
    .filter((record): record is InventoryRecord => Boolean(record));
}

function inventoryRecordSourceRefs(record: InventoryRecord): string[] {
  return uniqueStrings([
    ...stringArrayField(record, 'sourceRefs'),
    ...stringArrayField(record, 'referenceSourceRefs'),
    ...domainEntityRelationships(record).flatMap((relationship) => relationship.sourceRefs),
  ]);
}

function inventoryCandidate(input: {
  id: string;
  title: string;
  content: string;
  summary?: string | null;
  reason: string;
  sourceRefs: string[];
  priority: 1 | 2 | 3;
  confidence: number;
  createdAt?: string | null;
}): ContextCandidate {
  return candidate({
    id: input.id,
    title: input.title,
    content: input.content,
    summary: input.summary ?? inputArtifactSummary(input.content),
    retrievalQuery: `Retrieve project inventory evidence for ${input.title}.`,
    sourceType: 'code_probe',
    sourceRefs: input.sourceRefs,
    reason: input.reason,
    priority: input.priority,
    knowledgeClass: 'recovered',
    trustLevel: 'source',
    freshness: 'current',
    confidence: input.confidence,
    mode: 'summary',
    createdAt: input.createdAt ?? null,
  });
}

function renderCapabilityProbe(
  capability: InventoryRecord,
  entrypoints: readonly InventoryRecord[],
  symbols: readonly InventoryRecord[],
  domainEntities: readonly InventoryRecord[],
  tests: readonly InventoryRecord[],
  hotspots: readonly InventoryRecord[],
  corrections: readonly CapabilityMapCorrection[] = [],
): string {
  const displayLabel = capabilityDisplayLabel(capability, corrections);
  const inventoryLabel = stringField(capability, 'label') ?? capability.id;
  return [
    `Capability: ${displayLabel}`,
    displayLabel !== inventoryLabel ? `Inventory label: ${inventoryLabel}` : null,
    `Kind: ${stringField(capability, 'kind') ?? 'unknown'}`,
    `Confidence: ${numberField(capability, 'confidence') ?? 'unknown'}`,
    renderCapabilityCorrectionReview(corrections),
    renderRecordList('Entrypoints', entrypoints, (item) => [
      stringField(item, 'label'),
      stringField(item, 'method'),
      stringField(item, 'route'),
      stringField(item, 'handler') ? `handler=${stringField(item, 'handler')}` : null,
      stringField(item, 'path'),
    ].filter(Boolean).join(' | ')),
    renderRecordList('Symbols', symbols, (item) => [
      stringField(item, 'kind'),
      stringField(item, 'name'),
      stringField(item, 'path'),
      stringField(item, 'signature'),
    ].filter(Boolean).join(' | ')),
    renderRecordList('Domain Entities', domainEntities, (item) => [
      stringField(item, 'kind'),
      stringField(item, 'name'),
      stringField(item, 'path'),
      stringArrayField(item, 'referenceSourceRefs').length > 0
        ? `refs=${stringArrayField(item, 'referenceSourceRefs').join(', ')}`
        : null,
      domainEntityRelationships(item).length > 0
        ? `relationships=${domainEntityRelationships(item)
          .map((relationship) => `${relationship.direction}:${relationship.name}@${relationship.sourceRefs.join(',')}`)
          .join('; ')}`
        : null,
    ].filter(Boolean).join(' | ')),
    renderRecordList('Tests', tests, (item) => [
      stringField(item, 'path'),
      stringField(item, 'frameworkHint'),
      stringArrayField(item, 'targetHints').join(', '),
    ].filter(Boolean).join(' | ')),
    renderRecordList('Hotspots', hotspots, (item) => [
      stringField(item, 'reason'),
      stringField(item, 'path'),
      numberField(item, 'score') !== null ? `score=${numberField(item, 'score')}` : null,
    ].filter(Boolean).join(' | ')),
    renderRecordList('Open Questions', stringArrayField(capability, 'openQuestions').map((question, index) => ({ id: `q${index + 1}`, value: question })), (item) => stringField(item, 'value') ?? ''),
  ].filter(Boolean).join('\n');
}

function renderCapabilityCorrectionReview(
  corrections: readonly CapabilityMapCorrection[],
): string {
  if (corrections.length === 0) return '';
  return [
    'Correction Review:',
    ...corrections.map((correction) => [
      `- Accepted correction ${correction.artifactId}`,
      `Action: ${correction.action}`,
      correction.originalLabel ? `Original label: ${correction.originalLabel}` : null,
      correction.correctedLabel ? `Corrected label: ${correction.correctedLabel}` : null,
      correction.mergeTarget ? `Merge target: ${correction.mergeTarget}` : null,
    ].filter(Boolean).join(' | ')),
  ].join('\n');
}

function renderSuppressedCapabilityCorrectionProbe(
  capability: InventoryRecord,
  corrections: readonly CapabilityMapCorrection[],
): string {
  const label = stringField(capability, 'label') ?? capability.id;
  return [
    `Capability correction: ${label}`,
    `Capability ID: ${capability.id}`,
    'Heuristic capability suppressed; use underlying inventory source evidence instead of treating this capability grouping as correct.',
    renderCapabilityCorrectionReview(corrections),
  ].join('\n');
}

function renderSymbolProbe(symbols: readonly InventoryRecord[]): string {
  return renderRecordList('Matched Symbols', symbols, (item) => [
    stringField(item, 'kind'),
    stringField(item, 'name'),
    stringField(item, 'path'),
    stringField(item, 'exported') ? `exported=${stringField(item, 'exported')}` : null,
    stringField(item, 'signature'),
  ].filter(Boolean).join(' | '));
}

function renderDomainEntityProbe(domainEntities: readonly InventoryRecord[]): string {
  return renderRecordList('Matched Domain Entities', domainEntities, (item) => [
    stringField(item, 'kind'),
    stringField(item, 'name'),
    stringField(item, 'path'),
    stringArrayField(item, 'referenceSourceRefs').length > 0
      ? `refs=${stringArrayField(item, 'referenceSourceRefs').join(', ')}`
      : null,
    domainEntityRelationships(item).length > 0
      ? `relationships=${domainEntityRelationships(item)
        .map((relationship) => `${relationship.direction}:${relationship.name}@${relationship.sourceRefs.join(',')}`)
        .join('; ')}`
      : null,
  ].filter(Boolean).join(' | '));
}

interface DomainEntityRelationship {
  kind: string;
  direction: string;
  domainEntityRef: string;
  name: string;
  sourceRefs: string[];
}

function domainEntityRelationships(record: InventoryRecord): DomainEntityRelationship[] {
  const value = record.relationships;
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((relationship): DomainEntityRelationship | null => {
      const kind = stringField(relationship, 'kind') ?? '';
      const direction = stringField(relationship, 'direction') ?? '';
      const domainEntityRef = stringField(relationship, 'domainEntityRef') ?? '';
      const name = stringField(relationship, 'name') ?? '';
      const sourceRefs = stringArrayField(relationship, 'sourceRefs');
      if (!['foreign_key', 'join', 'view_dependency', 'routine_dependency'].includes(kind) || !direction || !domainEntityRef || !name || sourceRefs.length === 0) {
        return null;
      }
      return { kind, direction, domainEntityRef, name, sourceRefs };
    })
    .filter((relationship): relationship is DomainEntityRelationship => relationship !== null);
}

function renderDomainEntityRelationships(record: InventoryRecord): string {
  const relationships = domainEntityRelationships(record);
  if (relationships.length === 0) return '';
  return renderRecordList('Relationships', relationships.map((relationship, index) => ({
    id: `${record.id}_relationship_${index}`,
    ...relationship,
  })), (item) => [
    stringField(item, 'kind'),
    stringField(item, 'direction'),
    stringField(item, 'name'),
    stringField(item, 'domainEntityRef'),
    stringArrayField(item, 'sourceRefs').join(', '),
  ].filter(Boolean).join(' | '));
}

function renderTestProbe(tests: readonly InventoryRecord[]): string {
  return renderRecordList('Matched Test Surfaces', tests, (item) => [
    stringField(item, 'path'),
    stringField(item, 'frameworkHint'),
    stringArrayField(item, 'targetHints').join(', '),
  ].filter(Boolean).join(' | '));
}

function renderHotspotProbe(hotspots: readonly InventoryRecord[]): string {
  return renderRecordList('Matched Hotspots', hotspots, (item) => [
    stringField(item, 'reason'),
    stringField(item, 'path'),
    numberField(item, 'score') !== null ? `score=${numberField(item, 'score')}` : null,
  ].filter(Boolean).join(' | '));
}

function renderRecordList(
  title: string,
  records: readonly InventoryRecord[],
  lineFor: (record: InventoryRecord) => string,
): string {
  if (records.length === 0) return `${title}: (none)`;
  return [
    `${title}:`,
    ...records.slice(0, 12).map((record) => `- ${lineFor(record)}`),
  ].join('\n');
}

function capabilityDisplayLabel(
  capability: InventoryRecord,
  corrections: readonly CapabilityMapCorrection[] = [],
): string {
  return corrections.find((correction) => correction.action === 'renamed' && correction.correctedLabel)?.correctedLabel
    ?? corrections.find((correction) => correction.action === 'merged' && correction.mergeTarget)?.mergeTarget
    ?? stringField(capability, 'label')
    ?? capability.id;
}

function capabilityTokenFor(
  capability: InventoryRecord,
  corrections: readonly CapabilityMapCorrection[] = [],
): string {
  return capabilityDisplayLabel(capability, corrections)
    ?? capability.id.replace(/^cap_/, '')
    ?? capability.id;
}

function filteredSourceRefs(values: readonly string[], sensitivePathPatterns: readonly string[]): string[] {
  return uniqueStrings(values)
    .filter((ref) => !isSensitiveContextPath(ref, sensitivePathPatterns));
}

function taskTokens(text: string): string[] {
  return taskTokenVariants(text, { includeFocusTokens: false });
}

function taskFocusTokens(text: string): string[] {
  return taskTokenVariants(text, { includeFocusTokens: true });
}

function taskTokenVariants(
  text: string,
  options: { includeFocusTokens: boolean },
): string[] {
  const normalized = normalizeSearchText(text);
  return uniqueStrings(normalized.split(' ')
    .flatMap((token) => {
      if (token.length < 3) return [];
      const variants = searchTokenVariants(token).filter((variant) => variant.length >= 3);
      if (!options.includeFocusTokens && variants.some((variant) => FOCUS_TASK_TOKENS.has(variant))) {
        return [];
      }
      return variants.filter((variant) => (
        !COMMON_TASK_TOKENS.has(variant)
        || (options.includeFocusTokens && FOCUS_TASK_TOKENS.has(variant))
      ));
    }));
}

function sourceHintsFromTaskBrief(text: string, rootPaths: readonly string[] = []): SourceHint[] {
  const hints: SourceHint[] = [];
  const normalizedRoots = rootPaths
    .map(normalizeSourceHintPathRoot)
    .filter((root): root is string => Boolean(root));
  const pathRefPattern = /(?:file:)?((?:[A-Za-z]:)?(?:[\\/])?(?:\.\/)?[A-Za-z0-9._@-]+(?:[\\/][A-Za-z0-9._@-]+)+\.[A-Za-z0-9]+)(?:#L(\d+)|:(\d+))?/g;
  for (const match of text.matchAll(pathRefPattern)) {
    const rawPath = match[1];
    if (!rawPath) continue;
    const lineText = match[2] ?? match[3] ?? null;
    const line = lineText ? Number(lineText) : null;
    hints.push({
      path: normalizeSourceHintPath(rawPath, normalizedRoots),
      line: line !== null && Number.isFinite(line) ? line : null,
    });
  }
  return uniqueSourceHints(hints);
}

function contentSha256HintsFromTaskBrief(text: string): string[] {
  return uniqueStrings([...text.matchAll(/\b[a-f0-9]{64}\b/gi)]
    .map((match) => match[0]?.toLowerCase())
    .filter((value): value is string => Boolean(value)));
}

function sourceRefsMatchingHints(
  sourceRefs: readonly string[],
  sourceHints: readonly SourceHint[],
): string[] {
  if (sourceRefs.length === 0 || sourceHints.length === 0) return [];
  const matches: string[] = [];
  for (const sourceRef of sourceRefs) {
    const ref = fileSourceRef(sourceRef);
    if (!ref) continue;
    if (sourceHints.some((hint) => (
      hint.path === ref.path
      && (hint.line === null || ref.line === hint.line)
    ))) {
      matches.push(sourceRef);
    }
  }
  return uniqueStrings(matches);
}

function sourceRefsMatchingExactLineHints(
  sourceRefs: readonly string[],
  sourceHints: readonly SourceHint[],
): string[] {
  return sourceRefsMatchingHints(
    sourceRefs,
    sourceHints.filter((hint) => hint.line !== null),
  );
}

function fileSourceRef(sourceRef: string): SourceHint | null {
  const match = /^file:(.+?)(?:#L(\d+))?$/.exec(sourceRef);
  if (!match?.[1]) return null;
  const line = match[2] ? Number(match[2]) : null;
  return {
    path: match[1].replace(/\\/g, '/').replace(/^\.\//, ''),
    line: line !== null && Number.isFinite(line) ? line : null,
  };
}

function normalizeSourceHintPath(rawPath: string, normalizedRoots: readonly string[]): string {
  const path = rawPath.replace(/\\/g, '/').replace(/^\.\//, '');
  for (const root of normalizedRoots) {
    if (path === root) return path;
    if (path.startsWith(`${root}/`)) return path.slice(root.length + 1);
  }
  return path;
}

function normalizeSourceHintPathRoot(rawPath: string): string | null {
  const normalized = rawPath
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/, '');
  return normalized ? normalized : null;
}

function uniqueSourceHints(hints: readonly SourceHint[]): SourceHint[] {
  const byKey = new Map<string, SourceHint>();
  for (const hint of hints) {
    byKey.set(`${hint.path}#${hint.line ?? ''}`, hint);
  }
  return [...byKey.values()];
}

const FOCUS_TASK_TOKENS = new Set([
  'create',
  'delete',
  'destroy',
  'remove',
  'show',
  'update',
]);

const COMMON_TASK_TOKENS = new Set([
  'action',
  'actions',
  'add',
  'and',
  'app',
  'api',
  'asp',
  'aspnet',
  'asmx',
  'apirouter',
  'bean',
  'beans',
  'blueprint',
  'cakephp',
  'classic',
  'cfm',
  'cfml',
  'codeigniter',
  'coldfusion',
  'controller',
  'controllers',
  'contract',
  'contracts',
  'create',
  'database',
  'databases',
  'db',
  'delete',
  'destroy',
  'dto',
  'dtos',
  'endpoint',
  'endpoints',
  'entity',
  'entities',
  'fastapi',
  'fastify',
  'fix',
  'flask',
  'for',
  'form',
  'forms',
  'get',
  'golang',
  'gorilla',
  'handler',
  'handlers',
  'hapi',
  'hapijs',
  'hono',
  'http',
  'java',
  'iis',
  'jax',
  'jaxws',
  'jaxrs',
  'jsp',
  'koa',
  'laravel',
  'legacy',
  'load',
  'loaded',
  'loading',
  'loads',
  'method',
  'methods',
  'model',
  'models',
  'mapping',
  'mappings',
  'mvc',
  'net',
  'operation',
  'operations',
  'page',
  'pages',
  'php',
  'framework',
  'python',
  'play',
  'rails',
  'repository',
  'repositories',
  'remove',
  'render',
  'rendered',
  'rendering',
  'renders',
  'resource',
  'resources',
  'rest',
  'route',
  'routeconfig',
  'router',
  'routers',
  'routes',
  'ruby',
  'schema',
  'schemas',
  'servlet',
  'servlets',
  'service',
  'services',
  'show',
  'soap',
  'spring',
  'sql',
  'symfony',
  'table',
  'tables',
  'struts',
  'test',
  'tests',
  'the',
  'use',
  'vbscript',
  'web',
  'webforms',
  'webmethod',
  'webmethods',
  'webapiconfig',
  'webservice',
  'webservices',
  'wcf',
  'operationcontract',
  'operationcontracts',
  'servicecontract',
  'servicecontracts',
  'with',
  'xml',
  'yaml',
  'yml',
  'implement',
  'update',
  'change',
  'task',
]);

function normalizeSearchText(text: string): string {
  return text
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchesSearchToken(text: string, token: string): boolean {
  const tokenVariants = searchTokenVariants(token);
  return text.split(' ').some((part) => (
    searchTokenVariants(part).some((partVariant) => (
      tokenVariants.some((tokenVariant) => (
        partVariant === tokenVariant
        || (tokenVariant.length >= 4 && partVariant.includes(tokenVariant))
      ))
    ))
  ));
}

function searchTokenVariants(token: string): string[] {
  const normalized = token.trim();
  if (!normalized) return [];
  const variants = [normalized];
  if (normalized.endsWith('s') && normalized.length > 3) {
    variants.push(normalized.slice(0, -1));
  }
  if (normalized.endsWith('ing') && normalized.length > 5) {
    const stem = normalized.slice(0, -3);
    variants.push(stem);
    variants.push(`${stem}e`);
  }
  if (normalized.endsWith('ed') && normalized.length > 4) {
    const stem = normalized.slice(0, -2);
    variants.push(stem);
    variants.push(`${stem}e`);
  }
  if (normalized.endsWith('iation') && normalized.length > 8) {
    variants.push(`${normalized.slice(0, -6)}e`);
  }
  return uniqueStrings(variants);
}

function isProjectInventoryInputArtifact(name: string, content = ''): boolean {
  return name === 'project-inventory.json'
    || isSourceChunkIndexInputArtifact(name, content)
    || isProjectInventoryJsonContent(content);
}

function isProjectInventoryJsonContent(content: string): boolean {
  if (!content.includes('"schemaVersion"') || !content.includes('"ainp.project_inventory.v1"')) {
    return false;
  }
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    return parsed.schemaVersion === 'ainp.project_inventory.v1';
  } catch {
    return false;
  }
}

function isSourceChunkIndexInputArtifact(name: string, content = ''): boolean {
  if ([
    'source-chunk-index.json',
    'source_chunk_index.json',
    'sourceChunkIndex.json',
  ].includes(name)) {
    return true;
  }
  if (!content.includes('"schemaVersion"') || !content.includes('"ainp.source_chunk_index.v1"')) {
    return false;
  }
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    return parsed.schemaVersion === 'ainp.source_chunk_index.v1';
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  return null;
}

function numberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

interface KnowledgeReviewSignalInput {
  knowledgeArtifacts: readonly KnowledgeArtifact[];
  inputArtifacts: readonly BuildContextPackInputArtifact[];
  stage: WorkflowStage;
  createdAt: string;
}

interface KnowledgeEvidenceItem {
  ref: string;
  classRef: string;
  class: KnowledgeClass;
  freshness: ContextFreshness;
  title: string;
  content: string;
  key: string;
  fingerprint: string;
  facts: Map<string, string>;
  sourceRefs: string[];
  reviewStatus: string | null;
}

interface ParsedProjectInventorySource {
  source: ProjectInventorySource;
  inventory: NonNullable<ReturnType<typeof parseProjectInventorySource>>;
}

interface SourceChunkFingerprint {
  id: string;
  title: string;
  contentSha256: string;
  keys: string[];
  sourceRefs: string[];
}

interface CurrentCapabilityLabelMatch {
  sourceRef: string;
  capability: InventoryRecord;
}

function buildKnowledgeReviewSignals(input: KnowledgeReviewSignalInput): KnowledgeReviewSignal[] {
  if (!isImportantChangeStage(input.stage) && input.stage !== 'context_pack') return [];

  const signals: KnowledgeReviewSignal[] = [];
  const seen = new Set<string>();
  const knowledge = input.knowledgeArtifacts.map(knowledgeEvidenceItem);

  const push = (signal: Omit<KnowledgeReviewSignal, 'createdAt'>): void => {
    if (signals.length >= MAX_CALIBRATION_SIGNALS) return;
    if (seen.has(signal.id)) return;
    seen.add(signal.id);
    signals.push({
      ...signal,
      subjectRefs: uniqueStrings(signal.subjectRefs),
      evidenceRefs: uniqueStrings(signal.evidenceRefs),
      createdAt: input.createdAt,
    });
  };

  for (const item of knowledge) {
    if (
      item.class === 'confirmed'
      && item.freshness !== 'current'
      && !item.reviewStatus
    ) {
      push({
        id: `sig_${slugify(`stale_${item.ref}`)}`,
        kind: 'stale',
        severity: item.freshness === 'historical' ? 'review_required' : 'warning',
        message: `Confirmed knowledge ${item.ref} is marked freshness=${item.freshness}; verify it against current source before relying on it.`,
        subjectRefs: [item.ref],
        evidenceRefs: item.sourceRefs,
        recommendedAction: item.freshness === 'historical' ? 'mark_stale_or_supersede' : 'review_before_use',
      });
    }

    const reviewKind = signalKindForReviewStatus(item.reviewStatus);
    if (reviewKind) {
      push({
        id: `sig_${slugify(`${reviewKind}_${item.ref}`)}`,
        kind: reviewKind,
        severity: reviewKind === 'conflict' || reviewKind === 'stale' ? 'review_required' : 'warning',
        message: `Knowledge ${item.ref} carries reviewStatus=${item.reviewStatus}; keep it as evidence and avoid destructive overwrite until reviewed.`,
        subjectRefs: [item.ref],
        evidenceRefs: item.sourceRefs,
        recommendedAction: reviewKind === 'conflict'
          ? 'open_knowledge_review'
          : reviewKind === 'stale'
            ? 'mark_stale_or_downgrade'
            : 'review_status_transition',
      });
    }
  }

  const currentInventoryArtifactRefs: string[] = [];
  const currentCapabilityIds = new Set<string>();
  const currentCapabilityMatchesByLabel = new Map<string, CurrentCapabilityLabelMatch[]>();
  const currentInventories: ParsedProjectInventorySource[] = [];
  for (const artifact of input.inputArtifacts) {
    const currentInventoryRef = artifact.artifactId ? `artifact:${artifact.artifactId}` : `input:${artifact.name}`;
    const source = {
      name: artifact.name,
      content: artifact.content,
      createdAt: artifact.createdAt ?? null,
      sourceKind: 'current_run' as const,
      sourceRefs: [currentInventoryRef],
    };
    const inventory = parseProjectInventorySource(source);
    if (!inventory) continue;
    currentInventories.push({ source, inventory });
    currentInventoryArtifactRefs.push(currentInventoryRef);
    if (inventory.capabilities.length > 0) {
      for (const capability of inventory.capabilities) {
        if (capability.id) currentCapabilityIds.add(capability.id);
        const capabilityLabel = normalizedCapabilityLabel(stringField(capability, 'label'));
        if (!capabilityLabel) continue;
        const existing = currentCapabilityMatchesByLabel.get(capabilityLabel) ?? [];
        existing.push({ sourceRef: currentInventoryRef, capability });
        existing.sort(compareCurrentCapabilityLabelMatches);
        currentCapabilityMatchesByLabel.set(capabilityLabel, existing);
      }
    }
  }

  if (currentInventories.length > 0) {
    for (const artifact of input.knowledgeArtifacts) {
      if (artifact.status !== 'accepted') continue;
      if (!isProjectCapabilityMapCorrectionArtifact(artifact)) continue;
      if (reviewStatusForMetadata(artifact.metadata) !== null) continue;
      const capabilityId = metadataString(artifact.metadata, 'capabilityId');
      if (!capabilityId || currentCapabilityIds.has(capabilityId)) continue;
      const inventoryArtifactId = metadataString(artifact.metadata, 'inventoryArtifactId');
      const convergedCapabilityMatches = currentCapabilityMatchesForCorrection(
        artifact.metadata,
        currentCapabilityMatchesByLabel,
      );
      if (convergedCapabilityMatches.length === 1) {
        const convergedCapability = convergedCapabilityMatches[0];
        if (!convergedCapability) continue;
        const convergedCapabilityLabel =
          stringField(convergedCapability.capability, 'label') ?? convergedCapability.capability.id;
        push({
          id: `sig_${slugify(`superseded_capability_correction_${artifact.id}_${capabilityId}_${convergedCapability.capability.id}`)}`,
          kind: 'superseded',
          severity: 'review_required',
          message: `Accepted capability-map correction ${artifact.id} points to ${capabilityId}, but the current project inventory now contains ${convergedCapability.capability.id} labeled "${convergedCapabilityLabel}", matching the correction's governed label. The heuristic scan appears to have converged on the governed label; review whether the old correction is superseded instead of applying it to unrelated capabilities.`,
          subjectRefs: [
            `knowledge_artifact:${artifact.id}`,
            `capability:${capabilityId}`,
            `capability:${convergedCapability.capability.id}`,
          ],
          evidenceRefs: [
            convergedCapability.sourceRef,
            ...stringArrayField(convergedCapability.capability, 'sourceRefs'),
            inventoryArtifactId ? `artifact:${inventoryArtifactId}` : '',
            ...correctionMetadataEvidenceRefs(artifact.metadata),
          ],
          recommendedAction: 'mark_stale_or_supersede',
        });
        continue;
      }
      if (convergedCapabilityMatches.length > 1) {
        const governedLabel = capabilityCorrectionGovernedLabel(artifact.metadata) ?? 'the governed label';
        const matchingCapabilitySummaries = convergedCapabilityMatches
          .map((match) => {
            const label = stringField(match.capability, 'label') ?? match.capability.id;
            return `${match.capability.id} labeled "${label}"`;
          })
          .join(', ');
        push({
          id: `sig_${slugify(`conflict_capability_correction_${artifact.id}_${capabilityId}_${convergedCapabilityMatches.map((match) => match.capability.id).join('_')}`)}`,
          kind: 'conflict',
          severity: 'review_required',
          message: `Accepted capability-map correction ${artifact.id} points to ${capabilityId}, but the correction's governed label "${governedLabel}" matches multiple current project inventory capabilities: ${matchingCapabilitySummaries}. Review the ambiguous correction drift before marking the old correction superseded or applying it to a current capability.`,
          subjectRefs: [
            `knowledge_artifact:${artifact.id}`,
            `capability:${capabilityId}`,
            ...convergedCapabilityMatches.map((match) => `capability:${match.capability.id}`),
          ],
          evidenceRefs: [
            ...currentInventoryArtifactRefs,
            ...convergedCapabilityMatches.map((match) => match.sourceRef),
            ...convergedCapabilityMatches.flatMap((match) => stringArrayField(match.capability, 'sourceRefs')),
            inventoryArtifactId ? `artifact:${inventoryArtifactId}` : '',
            ...correctionMetadataEvidenceRefs(artifact.metadata),
          ],
          recommendedAction: 'open_knowledge_review',
        });
        continue;
      }
      push({
        id: `sig_${slugify(`stale_capability_correction_${artifact.id}_${capabilityId}`)}`,
        kind: 'stale',
        severity: 'review_required',
        message: `Accepted capability-map correction ${artifact.id} points to ${capabilityId}, but the current project inventory no longer contains that capability. Review whether the correction is stale or superseded before applying it to future scans.`,
        subjectRefs: [`knowledge_artifact:${artifact.id}`, `capability:${capabilityId}`],
        evidenceRefs: [
          ...currentInventoryArtifactRefs,
          inventoryArtifactId ? `artifact:${inventoryArtifactId}` : '',
          ...correctionMetadataEvidenceRefs(artifact.metadata),
        ],
        recommendedAction: 'mark_stale_or_supersede',
      });
    }
  }

  const currentSourceChunks = sourceChunkFingerprintIndex(currentInventories);
  if (currentSourceChunks.size > 0) {
    for (const artifact of input.knowledgeArtifacts) {
      if (artifact.status !== 'accepted') continue;
      const projectInventoryContent = projectInventoryContentForKnowledgeArtifact(artifact);
      const sourceChunkIndexContent = projectInventoryContent
        ? null
        : sourceChunkIndexContentForKnowledgeArtifact(artifact);
      const content = projectInventoryContent ?? sourceChunkIndexContent;
      if (!content) continue;
      const historicalSourceKind = projectInventoryContent ? 'project inventory' : 'source chunk index';
      const inventoryName =
        metadataString(artifact.metadata, 'output')
        ?? metadataString(artifact.metadata, 'name')
        ?? metadataString(artifact.metadata, 'title')
        ?? artifact.uri;
      const metadata = contextMetadataForKnowledgeArtifact(artifact);
      const source = {
        name: inventoryName,
        content,
        createdAt: artifact.updatedAt ?? artifact.createdAt,
        sourceKind: 'historical_knowledge' as const,
        sourceRefs: [
          `knowledge_artifact:${artifact.id}`,
          artifact.derivedFromArtifactId ? `artifact:${artifact.derivedFromArtifactId}` : '',
          ...metadata.sourceRefs,
        ].filter(Boolean),
      };
      const inventory = parseProjectInventorySource(source);
      if (!inventory) continue;
      const historicalSourceChunks = projectInventoryContent
        ? inventory.sourceChunks
        : inventory.sourceChunkIndexEntries;
      for (const historicalChunk of historicalSourceChunks) {
        const historicalFingerprint = sourceChunkFingerprint(historicalChunk, source.sourceRefs);
        if (!historicalFingerprint) continue;
        const currentFingerprint = firstMatchingSourceChunkFingerprint(
          currentSourceChunks,
          historicalFingerprint.keys,
        );
        if (!currentFingerprint) continue;
        if (currentFingerprint.contentSha256 === historicalFingerprint.contentSha256) continue;
        push({
          id: `sig_${slugify(`source_chunk_hash_drift_${artifact.id}_${historicalFingerprint.id}`)}`,
          kind: 'stale',
          severity: 'review_required',
          message: `Accepted ${historicalSourceKind} ${artifact.id} has source chunk ${historicalFingerprint.id} (${historicalFingerprint.title}) with a contentSha256 that differs from the current project inventory. Treat historical source evidence as stale until reviewed.`,
          subjectRefs: [
            `knowledge_artifact:${artifact.id}`,
            `source_chunk:${historicalFingerprint.id}`,
          ],
          evidenceRefs: [
            ...currentFingerprint.sourceRefs,
            ...historicalFingerprint.sourceRefs,
          ],
          recommendedAction: 'mark_stale_or_supersede',
        });
      }
    }
  }

  const byKey = new Map<string, KnowledgeEvidenceItem[]>();
  for (const item of knowledge) {
    if (!item.key || !item.fingerprint) continue;
    const items = byKey.get(item.key) ?? [];
    items.push(item);
    byKey.set(item.key, items);
  }

  for (const [key, items] of byKey) {
    const classes = new Set(items.map((item) => item.class));
    if (classes.size < 2) continue;
    const fingerprints = new Set(items.map((item) => item.fingerprint));
    if (fingerprints.size < 2) continue;
    const classRefs = [...items]
      .sort((a, b) => a.class.localeCompare(b.class) || a.ref.localeCompare(b.ref))
      .map((item) => item.classRef);
    push({
      id: `sig_${slugify(`conflict_${key}`)}`,
      kind: 'conflict',
      severity: 'review_required',
      message: `Seed / Recovered / Confirmed knowledge disagree for "${key}". Treat confirmed knowledge as review-needed evidence, not an overwrite target.`,
      subjectRefs: classRefs,
      evidenceRefs: items.flatMap((item) => item.sourceRefs),
      recommendedAction: 'open_knowledge_review',
    });
  }

  const confirmedFacts = new Map<string, KnowledgeEvidenceItem>();
  for (const item of knowledge) {
    if (item.class !== 'confirmed') continue;
    for (const [key] of item.facts) {
      if (!confirmedFacts.has(key)) confirmedFacts.set(key, item);
    }
  }

  for (const artifact of input.inputArtifacts) {
    const facts = extractFacts(artifact.content);
    if (facts.size === 0) continue;
    const evidenceRef = artifact.artifactId
      ? `artifact:${artifact.artifactId}`
      : `input:${artifact.name}`;
    for (const [key, value] of facts) {
      const confirmed = confirmedFacts.get(key);
      if (!confirmed) continue;
      const confirmedValue = confirmed.facts.get(key);
      if (!confirmedValue || normalizeFactValue(confirmedValue) === normalizeFactValue(value)) continue;
      push({
        id: `sig_${slugify(`code_fact_conflict_${key}_${artifact.name}`)}`,
        kind: 'conflict',
        severity: 'review_required',
        message: `Current run evidence "${artifact.name}" conflicts with confirmed knowledge fact "${key}". Prefer live/source evidence for this run and record a Knowledge Review signal instead of overwriting confirmed knowledge.`,
        subjectRefs: [confirmed.ref],
        evidenceRefs: [evidenceRef, ...confirmed.sourceRefs],
        recommendedAction: 'open_knowledge_review',
      });
    }
  }

  return signals;
}

function currentCapabilityMatchesForCorrection(
  metadata: Record<string, unknown>,
  currentCapabilityMatchesByLabel: ReadonlyMap<string, readonly CurrentCapabilityLabelMatch[]>,
): CurrentCapabilityLabelMatch[] {
  const targetLabel = capabilityCorrectionGovernedLabel(metadata);
  const normalizedTargetLabel = normalizedCapabilityLabel(targetLabel);
  if (!normalizedTargetLabel) return [];
  return [...(currentCapabilityMatchesByLabel.get(normalizedTargetLabel) ?? [])];
}

function capabilityCorrectionGovernedLabel(metadata: Record<string, unknown>): string | null {
  const action = capabilityCorrectionAction(metadataString(metadata, 'correctionAction'));
  return action === 'renamed'
    ? metadataString(metadata, 'correctedLabel')
    : action === 'merged'
      ? metadataString(metadata, 'mergeTarget')
      : null;
}

function normalizedCapabilityLabel(value: string | null): string | null {
  const normalized = normalizeSearchText(value ?? '');
  return normalized.length > 0 ? normalized : null;
}

function compareCurrentCapabilityLabelMatches(
  a: CurrentCapabilityLabelMatch,
  b: CurrentCapabilityLabelMatch,
): number {
  return a.capability.id.localeCompare(b.capability.id)
    || a.sourceRef.localeCompare(b.sourceRef);
}

function sourceChunkFingerprintIndex(
  sources: readonly ParsedProjectInventorySource[],
): Map<string, SourceChunkFingerprint> {
  const byKey = new Map<string, SourceChunkFingerprint>();
  for (const { source, inventory } of sources) {
    for (const chunk of inventory.sourceChunks) {
      const fingerprint = sourceChunkFingerprint(chunk, source.sourceRefs);
      if (!fingerprint) continue;
      for (const key of fingerprint.keys) {
        if (!byKey.has(key)) byKey.set(key, fingerprint);
      }
    }
  }
  return byKey;
}

function sourceChunkFingerprint(
  chunk: InventoryRecord,
  inventorySourceRefs: readonly string[],
): SourceChunkFingerprint | null {
  const contentSha256 = sourceChunkContentSha256(chunk);
  if (!contentSha256) return null;
  const keys = sourceChunkFingerprintKeys(chunk);
  if (keys.length === 0) return null;
  const id = stringField(chunk, 'sourceChunkRef') ?? stringField(chunk, 'chunkRef') ?? chunk.id;
  return {
    id,
    title: sourceChunkTitle(chunk),
    contentSha256,
    keys,
    sourceRefs: uniqueStrings([
      ...inventorySourceRefs,
      ...stringArrayField(chunk, 'sourceRefs'),
    ]),
  };
}

function sourceChunkFingerprintKeys(chunk: InventoryRecord): string[] {
  const path = stringField(chunk, 'path');
  const startLine = numberField(chunk, 'startLine');
  const endLine = numberField(chunk, 'endLine');
  const sourceChunkRef = stringField(chunk, 'sourceChunkRef') ?? stringField(chunk, 'chunkRef');
  return uniqueStrings([
    sourceChunkRef ? `id:${sourceChunkRef}` : '',
    chunk.id ? `id:${chunk.id}` : '',
    path && startLine !== null && endLine !== null ? `loc:${path}:${startLine}:${endLine}` : '',
    ...sourceChunkLinkedRecordKeys(chunk),
  ].filter(Boolean));
}

function sourceChunkLinkedRecordKeys(chunk: InventoryRecord): string[] {
  const path = stringField(chunk, 'path');
  if (!path) return [];
  return [
    ...sourceChunkRecordKeysForField(chunk, path, 'entrypointRefs'),
    ...sourceChunkRecordKeysForField(chunk, path, 'symbolRefs'),
    ...sourceChunkRecordKeysForField(chunk, path, 'domainEntityRefs'),
    ...sourceChunkRecordKeysForField(chunk, path, 'graphEdgeRefs'),
    ...sourceChunkRecordKeysForField(chunk, path, 'testRefs'),
    ...sourceChunkRecordKeysForField(chunk, path, 'hotspotRefs'),
    ...sourceChunkRecordKeysForField(chunk, path, 'capabilityRefs'),
    ...sourceChunkRecordKeysForField(chunk, path, 'linkedRecordRefs'),
  ];
}

function sourceChunkRecordKeysForField(
  chunk: InventoryRecord,
  path: string,
  field: string,
): string[] {
  return stringArrayField(chunk, field).flatMap((ref) => (
    sourceChunkRecordIdentityRefs(ref).flatMap((identityRef) => [
      `record:${path}:${field}:${identityRef}`,
      `record_any:${path}:${identityRef}`,
    ])
  ));
}

function sourceChunkRecordIdentityRefs(ref: string): string[] {
  const trimmed = ref.trim();
  if (!trimmed) return [];
  const untyped = untypedSourceChunkLinkedRecordRef(trimmed);
  return uniqueStrings([
    trimmed,
    untyped,
  ].filter((item): item is string => Boolean(item)));
}

function untypedSourceChunkLinkedRecordRef(ref: string): string | null {
  const match =
    /^(entrypoint|symbol|domain_entity|domainentity|graph_edge|graphedge|test|test_surface|testsurface|hotspot|capability):(.+)$/i
      .exec(ref);
  return match?.[2]?.trim() || null;
}

function firstMatchingSourceChunkFingerprint(
  index: ReadonlyMap<string, SourceChunkFingerprint>,
  keys: readonly string[],
): SourceChunkFingerprint | null {
  for (const key of keys) {
    const fingerprint = index.get(key);
    if (fingerprint) return fingerprint;
  }
  return null;
}

function knowledgeEvidenceItem(artifact: KnowledgeArtifact): KnowledgeEvidenceItem {
  const metadata = contextMetadataForKnowledgeArtifact(artifact);
  const title = knowledgeTitle(artifact, metadata.knowledgeClass);
  const content = knowledgeContent(artifact, title);
  const key = normalizeKnowledgeKey(
    artifact.entityId
      ?? metadataString(artifact.metadata, 'title')
      ?? `${artifact.kind}:${title}`,
  );
  return {
    ref: `knowledge_artifact:${artifact.id}`,
    classRef: `${metadata.knowledgeClass}:knowledge_artifact:${artifact.id}`,
    class: metadata.knowledgeClass,
    freshness: metadata.freshness,
    title,
    content,
    key,
    fingerprint: normalizeContentFingerprint(content),
    facts: extractFacts(content),
    sourceRefs: metadata.sourceRefs,
    reviewStatus: reviewStatusForMetadata(artifact.metadata),
  };
}

function signalKindForReviewStatus(status: string | null): KnowledgeReviewSignalKind | null {
  switch (status) {
    case 'conflict':
    case 'needs_review':
    case 'review_required':
      return 'conflict';
    case 'stale':
    case 'mark_stale':
      return 'stale';
    case 'superseded':
    case 'supersede':
      return 'superseded';
    case 'upgrade':
    case 'upgrade_candidate':
      return 'upgrade_candidate';
    case 'downgrade':
    case 'downgrade_candidate':
      return 'downgrade_candidate';
    default:
      return null;
  }
}

function reviewStatusForMetadata(metadata: Record<string, unknown>): string | null {
  return normalizeReviewStatus(
    metadataString(metadata, 'reviewStatus')
      ?? metadataString(metadata, 'knowledgeReviewStatus')
      ?? metadataString(metadata, 'calibrationStatus'),
  );
}

function normalizeReviewStatus(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase().replace(/[\s-]+/g, '_') || null;
  return normalized === 'none' ? null : normalized;
}

function extractFacts(text: string): Map<string, string> {
  const facts = new Map<string, string>();
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*(?:[-*]\s*)?(?:code\s+fact|project\s+fact|fact)\s*:\s*([^:=]+?)\s*[:=]\s*(.+?)\s*$/i);
    if (!match) continue;
    const key = normalizeKnowledgeKey(match[1] ?? '');
    const value = (match[2] ?? '').trim();
    if (key && value) facts.set(key, value);
  }
  return facts;
}

function normalizeKnowledgeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[`"'*_[\]().,;:!?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeContentFingerprint(value: string): string {
  const text = normalizeOptionalText(value);
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeFactValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function isFoundationInputArtifact(name: string): boolean {
  return name === 'user_request'
    || name === 'project_profile.md'
    || name === 'accepted_knowledge.md'
    || name === 'project-inventory.json'
    || isSourceChunkIndexInputArtifact(name);
}

function inputArtifactPriority(name: string): 1 | 2 | 3 {
  if (/(design|analysis|analyze|report|plan|refactor_plan|diff|test|build)/i.test(name)) return 1;
  if (/context_pack/i.test(name)) return 2;
  return 3;
}

function inputArtifactSummary(content: string): string | null {
  const normalized = normalizeOptionalText(content);
  if (!normalized) return null;
  return normalized.length <= 900
    ? normalized
    : `${normalized.slice(0, 880)}\n…(input artifact summary truncated; retrieve full artifact if needed)`;
}

function excerptForContext(content: string, maxLength: number): string {
  const normalized = normalizeOptionalText(content) ?? '';
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, Math.max(0, maxLength - 80))}\n…(source chunk truncated; retrieve source refs for full context)`;
}

function projectProfileSummary(content: string): string {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 24);
  return lines.join('\n');
}

function renderRunMetadata(input: BuildContextPackInput): string {
  const inputNames = [...(input.inputNames ?? [])].sort();
  return [
    `Project: ${input.project.name} (${input.project.id})`,
    `Run: ${input.run.id}`,
    `Run type: ${input.run.type}`,
    `Flow: ${input.run.flowId}`,
    `Current stage: ${input.stage}`,
    `Source branch: ${input.run.sourceBranch}`,
    `Execution branch: ${input.branch}`,
    `Workspace: ${input.workspacePath}`,
    `Known input artifacts: ${inputNames.length > 0 ? inputNames.join(', ') : '(none)'}`,
  ].join('\n');
}

function normalizeOptionalText(text: string | null | undefined): string | null {
  const trimmed = text?.trim();
  return trimmed ? trimmed : null;
}

function normalizeBudget(budget: Partial<ContextPackBudget> | undefined): ContextPackBudget {
  return {
    maxTokens: budget?.maxTokens ?? DEFAULT_BUDGET.maxTokens,
    reservedForReasoning: budget?.reservedForReasoning ?? DEFAULT_BUDGET.reservedForReasoning,
    reservedForOutput: budget?.reservedForOutput ?? DEFAULT_BUDGET.reservedForOutput,
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'artifact';
}

export function contextSelectionAudit(pack: ContextPack): Record<string, unknown> {
  return {
    contextPackId: pack.id,
    mode: pack.mode,
    stage: pack.stage,
    selected: pack.manifest.map((item) => ({
      ref: item.ref,
      reason: item.reason,
      priority: item.priority,
      mode: item.mode,
      knowledgeClass: item.knowledgeClass,
      trustLevel: item.trustLevel,
      freshness: item.freshness,
      confidence: item.confidence,
      sourceType: item.sourceType,
      score: item.score,
      selectionReasons: item.selectionReasons ?? [],
      degradedFrom: item.degradedFrom,
      degradationReason: item.degradationReason,
      sourceRefs: item.sourceRefs ?? [],
    })),
    retrievalHints: pack.retrievalHints.map((hint) => ({
      id: hint.id,
      reason: hint.reason,
      sourceRefs: hint.sourceRefs,
      priority: hint.priority,
    })),
    calibrationSignals: (pack.calibrationSignals ?? []).map((signal) => ({
      id: signal.id,
      kind: signal.kind,
      severity: signal.severity,
      message: signal.message,
      subjectRefs: signal.subjectRefs,
      evidenceRefs: signal.evidenceRefs,
      recommendedAction: signal.recommendedAction,
      createdAt: signal.createdAt,
    })),
    supplement: pack.supplement ?? null,
  };
}

function boundedSupplementBudget(budget: Partial<ContextPackBudget> | undefined): Partial<ContextPackBudget> {
  return {
    maxTokens: Math.min(budget?.maxTokens ?? 6_000, 6_000),
    reservedForReasoning: Math.min(budget?.reservedForReasoning ?? 1_000, 1_000),
    reservedForOutput: Math.min(budget?.reservedForOutput ?? 1_000, 1_000),
  };
}

function retrievalHintsForContextRequest(
  request: ContextRequest,
  sensitivePathPatterns: readonly string[],
): RetrievalHint[] {
  const refs = uniqueStrings(request.requestedRefs).slice(0, 8).map((ref) => ({
    id: `hint_${slugify(`ctxreq_${request.id}_${ref}`)}`,
    title: `Requested context: ${ref}`,
    query: `Retrieve ${ref} for context request ${request.id}.`,
    reason: request.reason,
    sourceRefs: [`context_request:${request.id}`, ref],
    priority: request.priority,
  })).filter((hint) => !hint.sourceRefs.some((ref) => isSensitiveContextPath(ref, sensitivePathPatterns)));
  const questions = uniqueStrings(request.questions)
    .filter((question) => !lineContainsSensitivePath(question, sensitivePathPatterns))
    .slice(0, 8)
    .map((question, index) => ({
    id: `hint_${slugify(`ctxreq_${request.id}_question_${index + 1}`)}`,
    title: `Context question ${index + 1}`,
    query: question,
    reason: request.reason,
    sourceRefs: [`context_request:${request.id}`],
    priority: request.priority,
  }));
  return [...refs, ...questions];
}

function mergeRetrievalHints(hints: readonly RetrievalHint[]): RetrievalHint[] {
  const out = new Map<string, RetrievalHint>();
  for (const hint of hints) {
    if (!out.has(hint.id)) out.set(hint.id, hint);
  }
  return [...out.values()];
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
