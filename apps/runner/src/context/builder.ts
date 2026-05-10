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
}

const DEFAULT_BUDGET = {
  maxTokens: 12_000,
  reservedForReasoning: 2_000,
  reservedForOutput: 2_000,
} as const satisfies ContextPackBudget;

const MAX_CALIBRATION_SIGNALS = 12;

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

  candidates.push(...candidatesForKnowledgeArtifacts(safeKnowledgeArtifacts, sensitivePathPatterns));

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

  candidates.push(...candidatesForInputArtifacts(safeInputArtifacts, sensitivePathPatterns));

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
  const metadata = normalizeKnowledgeContextMetadata(artifact.metadata, {
    status: artifact.status,
    fallbackSourceRefs: fallbackSourceRefsForKnowledgeArtifact(artifact),
  });
  const reviewStatus = reviewStatusForMetadata(artifact.metadata);
  const hasNegativeReviewSignal = reviewStatus === 'conflict'
    || reviewStatus === 'stale'
    || reviewStatus === 'superseded'
    || reviewStatus === 'downgrade_candidate';
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
    priority: metadata.knowledgeClass === 'confirmed' && !hasNegativeReviewSignal ? 1 : 2,
    knowledgeClass: metadata.knowledgeClass,
    trustLevel: hasNegativeReviewSignal ? 'summary' : metadata.trustLevel,
    freshness: hasNegativeReviewSignal ? 'historical' : metadata.freshness,
    confidence: hasNegativeReviewSignal ? Math.min(metadata.confidence, 0.45) : metadata.confidence,
    mode: 'full',
    createdAt: artifact.updatedAt ?? artifact.createdAt,
  });
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

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
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

function knowledgeEvidenceItem(artifact: KnowledgeArtifact): KnowledgeEvidenceItem {
  const metadata = normalizeKnowledgeContextMetadata(artifact.metadata, {
    status: artifact.status,
    fallbackSourceRefs: fallbackSourceRefsForKnowledgeArtifact(artifact),
  });
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
  return value?.trim().toLowerCase().replace(/[\s-]+/g, '_') || null;
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
    || name === 'accepted_knowledge.md';
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
