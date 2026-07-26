import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  FLOW_REGISTRY,
  VERIFIER_AC_MATRIX_SCHEMA_VERSION,
  isContextFreshness,
  isKnowledgeArtifactKind,
  isValidKnowledgeSubtype,
  newId,
  nowIso,
  pathToFileUri,
  type Artifact,
  type ArtifactKind,
  type ContextFreshness,
  type KnowledgeArtifactKind,
} from '@ainp/shared';
import { store } from './store/store';
import { createArtifact, audit } from './workflow-engine';
import { buildContextGovernanceReadModel } from './context-governance';
import { readArtifactContent } from './artifact-content';

// Honors AINP_REPORTS_DIR, then AINP_HOME (so one AINP_HOME relocates the
// whole local store together), then the ~/.ai-native default.
const REPORTS_DIR =
  process.env.AINP_REPORTS_DIR ??
  join(process.env.AINP_HOME ?? join(homedir(), '.ai-native'), 'reports');

export interface GeneratedArtifactWithSidecar {
  artifact: Artifact;
  sidecar: Artifact;
}

/**
 * Shared persistence tail for the three report generators: write the markdown
 * report + JSON sidecar under REPORTS_DIR/<runId>/, audit the generation, and
 * register both files as artifacts. The JSON object and both metadata objects
 * must already embed `generatedAt`.
 */
async function persistReportPair(params: {
  workflowRunId: string;
  md: string;
  json: unknown;
  /** filename extensions, e.g. '.md' / '.json' or '.retro.md' / '.retro.json' */
  mdExt: string;
  jsonExt: string;
  auditKind: string;
  artifactKind: ArtifactKind;
  mdMetadata: Record<string, unknown>;
  jsonMetadata: Record<string, unknown>;
}): Promise<GeneratedArtifactWithSidecar> {
  const outDir = join(REPORTS_DIR, params.workflowRunId);
  await mkdir(outDir, { recursive: true });
  const mdId = newId('art');
  const path = join(outDir, `${mdId}${params.mdExt}`);
  await writeFile(path, params.md, 'utf8');
  const jsonText = `${JSON.stringify(params.json, null, 2)}\n`;
  const jsonId = newId('art');
  const jsonPath = join(outDir, `${jsonId}${params.jsonExt}`);
  await writeFile(jsonPath, jsonText, 'utf8');
  audit(params.workflowRunId, params.auditKind, { path, sidecarPath: jsonPath });

  const artifact = createArtifact({
    workflowRunId: params.workflowRunId,
    stepRunId: null,
    kind: params.artifactKind,
    uri: pathToFileUri(path),
    size: Buffer.byteLength(params.md, 'utf8'),
    contentType: 'text/markdown',
    metadata: params.mdMetadata,
  });
  const sidecar = createArtifact({
    workflowRunId: params.workflowRunId,
    stepRunId: null,
    kind: params.artifactKind,
    uri: pathToFileUri(jsonPath),
    size: Buffer.byteLength(jsonText, 'utf8'),
    contentType: 'application/json',
    metadata: params.jsonMetadata,
  });
  return { artifact, sidecar };
}

/**
 * Completion Report — server-side assembly. Pulls every persisted record for
 * the run and renders a markdown summary. The same data is exposed as a JSON
 * sidecar artifact so the UI can render without markdown parsing.
 *
 * IMPORTANT: this is the audit/source-of-truth handoff, not a sales doc.
 * Every claim must cite an evidence row.
 */
export async function generateCompletionReport(
  workflowRunId: string,
): Promise<GeneratedArtifactWithSidecar> {
  const run = store.workflowRuns.get(workflowRunId);
  if (!run) throw new Error(`workflow run not found: ${workflowRunId}`);

  const project = store.projects.get(run.projectId);
  const steps = store.stepRuns.byWorkflow(workflowRunId);
  const commands = store.commandRuns.byWorkflow(workflowRunId);
  const gates = store.gateRuns.byWorkflow(workflowRunId);
  const artifacts = store.artifacts.byWorkflow(workflowRunId);
  const builds = store.buildRuns.byWorkflow(workflowRunId);
  const approvals = store.approvals.byWorkflow(workflowRunId);
  const handoffs = store.handoffs.byWorkflow(workflowRunId);
  const stepCheckpoints = store.stepCheckpoints.byWorkflow(workflowRunId);
  const contextRequestActions = store.workflowActions
    .byWorkflow(workflowRunId)
    .filter((action) => action.kind === 'context_request');
  const knowledgeReviewSignals = collectKnowledgeReviewSignals({
    artifacts,
    actions: store.workflowActions.byWorkflow(workflowRunId),
  });
  const contextGovernance = buildContextGovernanceReadModel(workflowRunId);

  const stageRow = (stage: string): string => {
    const ss = steps.filter((s) => s.stage === stage);
    if (ss.length === 0) return `| ${stage} | — | — |`;
    const last = ss[ss.length - 1]!;
    return `| ${stage} | ${last.status} | ${last.completedAt ?? last.startedAt ?? ''} |`;
  };

  const gateRow = (g: (typeof gates)[number]): string =>
    `| ${g.gateId} | ${g.status} | ${g.ruleResults.map((r) => `${r.ruleId}=${r.status}`).join('; ')} |`;

  const stages = FLOW_REGISTRY[run.flowId]?.stages.map((step) => step.stage) ?? [
    'requirement',
    'design',
    'implementation',
    'build_test',
    'review',
    'completion',
    'knowledge',
  ];
  const stageTimeline = stages.map(stageRow).join('\n');
  const gatesBody = gates.length === 0 ? `| (none) | | |` : gates.map(gateRow).join('\n');
  const buildBody =
    builds.length === 0
      ? '_No Maven builds recorded._'
      : builds
          .map((b) => {
            const ts = store.testRuns.byBuild(b.id);
            const counts = ts
              .map(
                (t) =>
                  `${t.framework}: total=${t.total} passed=${t.passed} failed=${t.failed} errors=${t.errors} skipped=${t.skipped}`,
              )
              .join('\n');
            return `- BuildRun \`${b.id}\` status=${b.status} jdk=${b.jdkVersion} cmd=\`${b.mavenCommand}\`\n${counts ? counts.split('\n').map((l) => `  - ${l}`).join('\n') : ''}`;
          })
          .join('\n');
  const commandsBody =
    commands.length === 0
      ? '_no commands_'
      : commands
          .map(
            (c) =>
              `- \`${c.command}\` -> ${c.status} exit=${c.exitCode} (${c.durationMs}ms) stdout=${c.stdoutRef}`,
          )
          .join('\n');
  const artifactsBody =
    artifacts.length === 0
      ? '_no artifacts_'
      : artifacts.map((a) => `- ${a.kind}: \`${a.uri}\``).join('\n');
  const approvalsBody =
    approvals.length === 0
      ? '_no approvals_'
      : approvals
          .map((a) => `- ${a.gateId}: ${a.decision} by ${a.actor}${a.comment ? ` — ${a.comment}` : ''}`)
          .join('\n');
  const handoffSummaries = handoffs.map((handoff) => ({
    id: handoff.id,
    status: handoff.status,
    adoptionDecision: handoff.adoptionDecision,
    fromRole: handoff.fromRole,
    toRole: handoff.toRole,
    reason: handoff.reason,
    inputArtifactIds: handoff.inputArtifactIds,
    outputArtifactIds: handoff.outputArtifactIds,
    parentSessionId: handoff.parentSessionId,
    childSessionId: handoff.childSessionId,
    expectedOutput: handoff.expectedOutput,
  }));
  const handoffsBody =
    handoffSummaries.length === 0
      ? '_no handoffs_'
      : handoffSummaries
          .map((handoff) => [
            `- \`${handoff.id}\` ${handoff.fromRole} -> ${handoff.toRole} status=${handoff.status} adoption=${handoff.adoptionDecision}`,
            `  - reason: ${handoff.reason}`,
            `  - sessions: parent=${handoff.parentSessionId ?? '(none)'}, child=${handoff.childSessionId ?? '(none)'}`,
            `  - input artifacts: ${handoff.inputArtifactIds.join(', ') || '(none)'}`,
            `  - output artifacts: ${handoff.outputArtifactIds.join(', ') || '(none)'}`,
            `  - expected: ${handoff.expectedOutput.schemaVersion} ${handoff.expectedOutput.artifactKind} — ${handoff.expectedOutput.description}`,
          ].join('\n'))
          .join('\n');
  const stepCheckpointSummaries = stepCheckpoints.map((checkpoint) => ({
    id: checkpoint.id,
    stepRunId: checkpoint.stepRunId,
    stage: checkpoint.stage,
    status: checkpoint.status,
    inputArtifactIds: checkpoint.inputArtifactIds,
    outputArtifactIds: checkpoint.outputArtifactIds,
    contextPackId: checkpoint.contextPackId,
    agentSessionIds: checkpoint.agentSessionIds,
    toolInvocationIds: checkpoint.toolInvocationIds,
    gateRunIds: checkpoint.gateRunIds,
    retryIndex: checkpoint.retryIndex,
    resumeCursor: checkpoint.resumeCursor,
    failureReason: checkpoint.failureReason,
  }));
  const stepCheckpointsBody =
    stepCheckpointSummaries.length === 0
      ? '_no step checkpoints_'
      : stepCheckpointSummaries
          .map((checkpoint) => [
            `- \`${checkpoint.stepRunId}\` ${checkpoint.stage} status=${checkpoint.status} retry=${checkpoint.retryIndex}`,
            `  - contextPack: ${checkpoint.contextPackId ?? '(none)'}`,
            `  - sessions: ${checkpoint.agentSessionIds.join(', ') || '(none)'}`,
            `  - tools: ${checkpoint.toolInvocationIds.join(', ') || '(none)'}`,
            `  - gates: ${checkpoint.gateRunIds.join(', ') || '(none)'}`,
            `  - failure: ${checkpoint.failureReason ?? '(none)'}`,
          ].join('\n'))
          .join('\n');
  const contextRequests = contextRequestActions.map((action) => {
    const request = (action.payload.request ?? {}) as {
      id?: string;
      reason?: string;
      requestedRefs?: string[];
      questions?: string[];
      priority?: number;
      status?: string;
    };
    return {
      id: request.id ?? action.targetId ?? action.id,
      actionId: action.id,
      status: request.status ?? 'open',
      priority: request.priority ?? null,
      reason: request.reason ?? '',
      requestedRefs: Array.isArray(request.requestedRefs) ? request.requestedRefs : [],
      questions: Array.isArray(request.questions) ? request.questions : [],
      sourceName: typeof action.payload.sourceName === 'string' ? action.payload.sourceName : null,
      taskId: typeof action.payload.taskId === 'string' ? action.payload.taskId : null,
      baseContextPackId: typeof action.payload.baseContextPackId === 'string'
        ? action.payload.baseContextPackId
        : null,
      supplementContextPackId: typeof action.payload.supplementContextPackId === 'string'
        ? action.payload.supplementContextPackId
        : null,
      requestArtifactId: typeof action.payload.requestArtifactId === 'string'
        ? action.payload.requestArtifactId
        : null,
      supplementArtifactId: typeof action.payload.supplementArtifactId === 'string'
        ? action.payload.supplementArtifactId
        : null,
    };
  });
  const contextRequestsBody =
    contextRequests.length === 0
      ? '_no context requests_'
      : contextRequests
          .map((request) => [
            `- \`${request.id}\` status=${request.status} priority=${request.priority ?? 'n/a'} source=${request.sourceName ?? 'unknown'}`,
            `  - reason: ${request.reason || '(none)'}`,
            request.requestedRefs.length > 0
              ? `  - requestedRefs: ${request.requestedRefs.join(', ')}`
              : null,
            request.questions.length > 0
              ? `  - questions: ${request.questions.join(' | ')}`
              : null,
            `  - supplement: ${request.baseContextPackId ?? '(none)'} -> ${request.supplementContextPackId ?? '(none)'}`,
            `  - artifacts: request=${request.requestArtifactId ?? '(none)'}, supplement=${request.supplementArtifactId ?? '(none)'}`,
          ].filter((line): line is string => line !== null).join('\n'))
          .join('\n');
  const knowledgeReviewBody =
    knowledgeReviewSignals.length === 0
      ? '_no knowledge review signals_'
      : knowledgeReviewSignals
          .map((signal) => [
            `- \`${signal.id}\` ${signal.kind} severity=${signal.severity} action=${signal.recommendedAction}`,
            `  - message: ${signal.message}`,
            `  - subjects: ${signal.subjectRefs.join(', ') || '(none)'}`,
            `  - evidence: ${signal.evidenceRefs.join(', ') || '(none)'}`,
          ].join('\n'))
          .join('\n');
  const governanceMetricsBody = [
    `- impact coverage: ${formatRatioMetric(contextGovernance.metrics.impactCoverage)}`,
    `- evidence traceability: ${formatRatioMetric(contextGovernance.metrics.evidenceTraceability)}`,
    `- irrelevant-context ratio: ${formatRatioMetric(contextGovernance.metrics.irrelevantContextRatio)}`,
    `- context request count: ${contextGovernance.metrics.contextRequestCount.value}`,
    `- downstream rework signal: ${contextGovernance.metrics.downstreamReworkSignal.value} (rejected approvals=${contextGovernance.metrics.downstreamReworkSignal.rejectedApprovals}, failed gates=${contextGovernance.metrics.downstreamReworkSignal.failedGates}, failed agents=${contextGovernance.metrics.downstreamReworkSignal.failedAgentResults})`,
  ].join('\n');
  const acceptanceMatrix = latestAcceptanceMatrixSummary(artifacts);
  const acceptanceMatrixBody = acceptanceMatrix.body;

  const md = [
    `# Completion Report`,
    ``,
    `- **Workflow Run:** \`${run.id}\``,
    `- **Title:** ${run.title}`,
    `- **Project:** ${project?.name ?? run.projectId}`,
    `- **Branch:** \`${run.branch}\``,
    `- **Workspace:** \`${run.workspacePath ?? '-'}\``,
    `- **Status at report generation:** ${run.status}`,
    ``,
    `## Stage timeline`,
    ``,
    `| Stage | Status | At |`,
    `|---|---|---|`,
    stageTimeline,
    ``,
    `## Gates`,
    ``,
    `| Gate | Status | Rules |`,
    `|---|---|---|`,
    gatesBody,
    ``,
    `## Build & Tests`,
    ``,
    buildBody,
    ``,
    `## Business Acceptance Matrix`,
    ``,
    acceptanceMatrixBody,
    ``,
    `## Commands (${commands.length})`,
    ``,
    commandsBody,
    ``,
    `## Artifacts (${artifacts.length})`,
    ``,
    artifactsBody,
    ``,
    `## Approvals (${approvals.length})`,
    ``,
    approvalsBody,
    ``,
    `## Handoffs (${handoffs.length})`,
    ``,
    handoffsBody,
    ``,
    `## Context Requests (${contextRequests.length})`,
    ``,
    contextRequestsBody,
    ``,
    `## Knowledge Review Signals (${knowledgeReviewSignals.length})`,
    ``,
    knowledgeReviewBody,
    ``,
    `## Context Governance Metrics`,
    ``,
    governanceMetricsBody,
    ``,
    `_Generated by ainp-api at ${nowIso()}._`,
  ].join('\n');

  const generatedAt = nowIso();
  const json = {
    schemaVersion: 'ainp.completion_report.v1',
    title: 'Completion Report',
    workflowRunId: run.id,
    run: {
      id: run.id,
      title: run.title,
      project: project?.name ?? run.projectId,
      branch: run.branch,
      workspace: run.workspacePath,
      status: run.status,
    },
    summary: [
      `Workflow Run: ${run.id}`,
      `Title: ${run.title}`,
      `Project: ${project?.name ?? run.projectId}`,
      `Status at report generation: ${run.status}`,
    ],
    sections: [
      { title: 'Stage timeline', body: stageTimeline },
      { title: 'Gates', body: gatesBody },
      { title: 'Build & Tests', body: buildBody },
      { title: 'Business Acceptance Matrix', body: acceptanceMatrixBody },
      { title: `Commands (${commands.length})`, body: commandsBody },
      { title: `Artifacts (${artifacts.length})`, body: artifactsBody },
      { title: `Approvals (${approvals.length})`, body: approvalsBody },
      { title: `Handoffs (${handoffs.length})`, body: handoffsBody },
      { title: `Step Checkpoints (${stepCheckpoints.length})`, body: stepCheckpointsBody },
      { title: `Context Requests (${contextRequests.length})`, body: contextRequestsBody },
      { title: `Knowledge Review Signals (${knowledgeReviewSignals.length})`, body: knowledgeReviewBody },
      { title: 'Context Governance Metrics', body: governanceMetricsBody },
    ],
    handoffs: handoffSummaries,
    stepCheckpoints: stepCheckpointSummaries,
    contextRequests,
    businessAcceptanceMatrix: acceptanceMatrix.rows,
    knowledgeReviewSignals,
    contextGovernanceMetrics: contextGovernance.metrics,
    generatedAt,
  };
  return persistReportPair({
    workflowRunId,
    md,
    json,
    mdExt: '.md',
    jsonExt: '.json',
    auditKind: 'completion_report.generated',
    artifactKind: 'completion_report',
    mdMetadata: { generatedAt, output: 'completion_report.md' },
    jsonMetadata: {
      generatedAt,
      output: 'completion_report.json',
      structured: true,
      schemaVersion: 'ainp.completion_report.v1',
    },
  });
}

interface AcceptanceMatrixReportRow {
  id: string;
  text: string;
  scenarioType: string;
  status: string;
  verificationMethod: string;
  evidenceRefs: Array<{
    artifactId: string;
    claim: string;
    role?: string;
  }>;
  evidence: string[];
  risk: string | null;
}

function latestAcceptanceMatrixSummary(artifacts: Artifact[]): { body: string; rows: AcceptanceMatrixReportRow[] } {
  const artifact = artifacts
    .filter((candidate) =>
      candidate.metadata.schemaVersion === VERIFIER_AC_MATRIX_SCHEMA_VERSION ||
      candidate.metadata.reportKind === 'verifier_ac_matrix' ||
      candidate.metadata.verifierArtifactType === 'ac_matrix',
    )
    .at(-1) ?? null;
  if (!artifact) return { body: '_no business acceptance matrix_', rows: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(readArtifactContent(artifact).text);
  } catch {
    return {
      body: `- Matrix artifact \`${artifact.id}\` could not be parsed.`,
      rows: [],
    };
  }
  const record = asRecord(parsed);
  const rawRows = Array.isArray(record?.acceptanceCriteria)
    ? record.acceptanceCriteria
    : [];
  const rows = rawRows
    .map((raw): AcceptanceMatrixReportRow | null => {
      const row = asRecord(raw);
      if (!row || typeof row.id !== 'string') return null;
      const evidenceRefs = (Array.isArray(row.evidenceRefs) ? row.evidenceRefs : [])
        .map((ref) => {
          if (typeof ref === 'string' && ref.trim()) {
            return {
              artifactId: ref.startsWith('artifact:') ? ref.slice('artifact:'.length) : ref,
              claim: 'business acceptance evidence',
            };
          }
          const refRecord = asRecord(ref);
          if (!refRecord || typeof refRecord.artifactId !== 'string' || !refRecord.artifactId.trim()) {
            return null;
          }
          return {
            artifactId: refRecord.artifactId,
            claim: typeof refRecord.claim === 'string'
              ? refRecord.claim
              : 'business acceptance evidence',
            ...(typeof refRecord.role === 'string' ? { role: refRecord.role } : {}),
          };
        })
        .filter((ref): ref is NonNullable<typeof ref> => Boolean(ref));
      return {
        id: row.id,
        text: typeof row.text === 'string' ? row.text : '',
        scenarioType: typeof row.scenarioType === 'string' ? row.scenarioType : 'core',
        status: typeof row.businessStatus === 'string'
          ? row.businessStatus
          : typeof row.status === 'string'
            ? row.status
            : 'missing',
        verificationMethod: typeof row.verificationMethod === 'string' ? row.verificationMethod : '',
        evidenceRefs,
        evidence: evidenceRefs.map((ref) => `${ref.claim} (${ref.artifactId})`),
        risk: typeof row.risk === 'string'
          ? row.risk
          : typeof row.notes === 'string' && row.businessStatus !== 'passed'
            ? row.notes
            : null,
      };
    })
    .filter((row): row is AcceptanceMatrixReportRow => Boolean(row));

  if (rows.length === 0) {
    return { body: `- Matrix artifact \`${artifact.id}\` has no AC rows.`, rows };
  }

  const body = [
    `- Matrix artifact: \`${artifact.id}\``,
    '',
    '| AC | Scenario | Status | Verification | Evidence | Risk |',
    '|---|---|---|---|---|---|',
    ...rows.map((row) =>
      `| ${row.id} | ${row.scenarioType} | ${row.status} | ${escapeTableCell(row.verificationMethod || row.text)} | ${escapeTableCell(row.evidence.join('; ') || '(none)')} | ${escapeTableCell(row.risk ?? '')} |`,
    ),
  ].join('\n');
  return { body, rows };
}

/**
 * Knowledge Candidate — distilled from the completed run. Marked as a
 * candidate; only the human Knowledge Gate promotes it into long-term
 * memory.
 */
export async function generateKnowledgeCandidate(
  workflowRunId: string,
): Promise<GeneratedArtifactWithSidecar> {
  const run = store.workflowRuns.get(workflowRunId);
  if (!run) throw new Error(`workflow run not found: ${workflowRunId}`);
  if (run.type === 'profile' || run.flowId === 'profile.bootstrap') {
    return generateProfileKnowledgeCandidate(workflowRunId);
  }

  const commands = store.commandRuns.byWorkflow(workflowRunId);
  const gates = store.gateRuns.byWorkflow(workflowRunId);
  const artifacts = store.artifacts.byWorkflow(workflowRunId);
  const actions = store.workflowActions.byWorkflow(workflowRunId);
  const contextRequests = actions.filter((action) => action.kind === 'context_request');
  const builds = store.buildRuns.byWorkflow(workflowRunId);
  const buildSummary =
    builds.length === 0
      ? 'No Maven build was executed.'
      : builds
          .map((b) => `- BuildRun ${b.id}: status=${b.status}, cmd=\`${b.mavenCommand}\``)
          .join('\n');

  const testRuns = builds.flatMap((b) => store.testRuns.byBuild(b.id));
  const testSummary =
    testRuns.length === 0
      ? 'No test reports collected.'
      : testRuns
          .map(
            (t) =>
              `- ${t.framework}: total=${t.total} passed=${t.passed} failed=${t.failed} errors=${t.errors}`,
          )
          .join('\n');

  const diffArtifact = artifacts.filter((artifact) => artifact.kind === 'diff').at(-1) ?? null;
  const knowledgeReviewSignals = collectKnowledgeReviewSignals({ artifacts, actions });
  const suggestions = buildKnowledgeSuggestions({
    runId: run.id,
    title: run.title,
    commands,
    gates,
    artifacts,
    builds,
    testRuns,
    contextRequests,
    knowledgeReviewSignals,
  });

  const md = [
    `# Knowledge Candidate`,
    ``,
    `- **From workflow run:** \`${run.id}\``,
    `- **Title:** ${run.title}`,
    ``,
    `## Status`,
    `Candidate. Will be promoted into long-term knowledge only after the`,
    `Knowledge Gate is approved by a human.`,
    ``,
    `## What was changed`,
    diffArtifact ? `Diff artifact: \`${diffArtifact.uri}\`` : '_No diff artifact found._',
    ``,
    `## Build outcome`,
    buildSummary,
    ``,
    `## Test outcome`,
    testSummary,
    ``,
    `## Reusable lessons`,
    ...suggestions.map((item) => `- ${item.kind}: ${item.text} Evidence: ${item.evidence}`),
    ``,
    `## Provenance`,
    `Generated from artifacts, command runs, and gate runs persisted on this`,
    `workflow run. See the matching Completion Report for evidence refs.`,
    ``,
    `_Generated at ${nowIso()}._`,
  ].join('\n');

  const generatedAt = nowIso();
  const json = {
    schemaVersion: 'ainp.knowledge_candidate.v1',
    workflowRunId: run.id,
    title: 'Knowledge Candidate',
    status: 'candidate',
    suggestions,
    provenance: {
      runId: run.id,
      title: run.title,
      diffArtifactUri: diffArtifact?.uri ?? null,
      buildRunIds: builds.map((b) => b.id),
      commandRunIds: commands.map((command) => command.id),
      gateRunIds: gates.map((gate) => gate.id),
      artifactIds: artifacts.map((artifact) => artifact.id),
      contextRequestActionIds: contextRequests.map((action) => action.id),
      knowledgeReviewSignalIds: knowledgeReviewSignals.map((signal) => signal.id),
    },
    generatedAt,
  };
  return persistReportPair({
    workflowRunId,
    md,
    json,
    mdExt: '.md',
    jsonExt: '.json',
    auditKind: 'knowledge_candidate.generated',
    artifactKind: 'knowledge_candidate',
    mdMetadata: { generatedAt, output: 'knowledge_candidate.md' },
    jsonMetadata: {
      generatedAt,
      output: 'knowledge_candidate.json',
      structured: true,
      schemaVersion: 'ainp.knowledge_candidate.v1',
    },
  });
}

async function generateProfileKnowledgeCandidate(
  workflowRunId: string,
): Promise<GeneratedArtifactWithSidecar> {
  const run = store.workflowRuns.get(workflowRunId);
  if (!run) throw new Error(`workflow run not found: ${workflowRunId}`);

  const profileArtifact = latestProfileJsonArtifact(workflowRunId);
  if (!profileArtifact) {
    throw new Error('profile knowledge candidate requires a project-profile.json artifact');
  }

  const profileText = readArtifactContent(profileArtifact).text;
  const profile = parseProfileEnvelope(profileText);
  const sourceRefsBase = [`workflow_run:${run.id}`, `artifact:${profileArtifact.id}`];
  const { candidates, warnings } = normalizeProfileKnowledgeCandidates({
    rawCandidates: Array.isArray(profile.knowledgeCandidates) ? profile.knowledgeCandidates : [],
    workflowRunId: run.id,
    profileArtifactId: profileArtifact.id,
    sourceRefsBase,
  });
  const groupedCandidates = groupProfileCandidatesByKind(candidates);
  const candidateSections = groupedCandidates.length === 0
    ? ['_No profile knowledge candidates met the source and confidence threshold._']
    : groupedCandidates.flatMap(([kind, items]) => [
        `### ${kind}`,
        ``,
        ...items.map((candidate) => [
          `- **${candidate.title}** (${candidate.knowledgeKind}${candidate.subtype ? `/${candidate.subtype}` : ''}, confidence=${candidate.confidence.toFixed(2)}, freshness=${candidate.freshness})`,
          `  - ${candidate.body}`,
          `  - Source refs: ${candidate.sourceRefs.join(', ')}`,
          `  - Rationale: ${candidate.rationale || '(none provided)'}`,
        ].join('\n')),
        ``,
      ]);
  const warningLines = warnings.length === 0
    ? ['_No candidates were dropped._']
    : warnings.map((warning) => `- ${warning.reason}${warning.title ? `: ${warning.title}` : ''}`);
  const suggestions = candidates.map(profileCandidateToSuggestion);

  const md = [
    `# Knowledge Candidate`,
    ``,
    `- **From workflow run:** \`${run.id}\``,
    `- **Title:** ${run.title}`,
    `- **Origin:** profile.bootstrap`,
    `- **Profile artifact:** \`${profileArtifact.id}\``,
    ``,
    `## Status`,
    `Candidate. Generated profile knowledge remains reviewable and is not`,
    `accepted memory until a human approves it through the Knowledge Gate.`,
    ``,
    `## Profile-derived candidates`,
    ``,
    ...candidateSections,
    `## Dropped candidates / warnings`,
    ``,
    ...warningLines,
    ``,
    `## Provenance`,
    `Generated from project-profile.json suggested knowledge candidates.`,
    `Source refs, confidence, freshness, and origin metadata are preserved in`,
    `the JSON sidecar for human review and later promotion decisions.`,
    ``,
    `_Generated at ${nowIso()}._`,
  ].join('\n');

  const generatedAt = nowIso();
  const json = {
    schemaVersion: 'ainp.knowledge_candidate.v1',
    workflowRunId: run.id,
    title: 'Knowledge Candidate',
    status: 'candidate',
    origin: 'profile.bootstrap',
    suggestions,
    profileCandidates: candidates,
    warnings,
    provenance: {
      runId: run.id,
      title: run.title,
      profileArtifactId: profileArtifact.id,
      profileArtifactUri: profileArtifact.uri,
      artifactIds: [profileArtifact.id],
      sourceRefs: sourceRefsBase,
    },
    generatedAt,
  };
  return persistReportPair({
    workflowRunId,
    md,
    json,
    mdExt: '.md',
    jsonExt: '.json',
    auditKind: 'knowledge_candidate.generated',
    artifactKind: 'knowledge_candidate',
    mdMetadata: {
      generatedAt,
      output: 'knowledge_candidate.md',
      origin: 'profile.bootstrap',
      profileArtifactId: profileArtifact.id,
    },
    jsonMetadata: {
      generatedAt,
      output: 'knowledge_candidate.json',
      structured: true,
      schemaVersion: 'ainp.knowledge_candidate.v1',
      origin: 'profile.bootstrap',
      profileArtifactId: profileArtifact.id,
    },
  });
}

/**
 * Retro Report — fact-first run review. This is a generated per-run artifact
 * that feeds later human decisions; it does not promote long-term knowledge by
 * itself.
 */
export async function generateRetroReport(
  workflowRunId: string,
): Promise<GeneratedArtifactWithSidecar> {
  const run = store.workflowRuns.get(workflowRunId);
  if (!run) throw new Error(`workflow run not found: ${workflowRunId}`);

  const steps = store.stepRuns.byWorkflow(workflowRunId);
  const commands = store.commandRuns.byWorkflow(workflowRunId);
  const gates = store.gateRuns.byWorkflow(workflowRunId);
  const artifacts = store.artifacts.byWorkflow(workflowRunId);
  const builds = store.buildRuns.byWorkflow(workflowRunId);
  const testRuns = builds.flatMap((build) => store.testRuns.byBuild(build.id));
  const approvals = store.approvals.byWorkflow(workflowRunId);
  const actions = store.workflowActions.byWorkflow(workflowRunId);
  const agentTasks = store.agentTasks.byWorkflow(workflowRunId);
  const agentResults = store.agentResults.byWorkflow(workflowRunId);
  const agentEvents = store.agentEvents.byWorkflow(workflowRunId);
  const auditEntries = store.auditLog.byWorkflow(workflowRunId);
  const knowledgeReviewSignals = collectKnowledgeReviewSignals({ artifacts, actions });

  const gateIssues = gates
    .filter((gate) => gate.status !== 'pass' || gate.ruleResults.some((rule) => rule.status !== 'pass'))
    .map((gate) => ({
      gateRunId: gate.id,
      gateId: gate.gateId,
      status: gate.status,
      ruleResults: gate.ruleResults.filter((rule) => rule.status !== 'pass'),
      evidenceRefs: gate.evidenceRefs,
    }));
  const commandIssues = commands
    .filter((command) => command.status !== 'passed' || !command.combinedSha256)
    .map((command) => ({
      commandRunId: command.id,
      command: command.command,
      status: command.status,
      exitCode: command.exitCode,
      digestBacked: Boolean(command.stdoutSha256 && command.stderrSha256 && command.combinedSha256),
      stdoutRef: command.stdoutRef,
      stderrRef: command.stderrRef,
    }));
  const agentIssues = agentResults
    .filter((result) => result.status !== 'success')
    .map((result) => ({
      agentResultId: result.id,
      taskId: result.taskId,
      status: result.status,
      summary: result.summary,
    }));
  const rejectedApprovals = approvals
    .filter((approval) => approval.decision !== 'approved')
    .map((approval) => ({
      approvalId: approval.id,
      gateId: approval.gateId,
      decision: approval.decision,
      actor: approval.actor,
      comment: approval.comment,
    }));
  const contextRequests = actions
    .filter((action) => action.kind === 'context_request')
    .map((action) => ({
      actionId: action.id,
      targetId: action.targetId,
      baseContextPackId: stringField(action.payload, 'baseContextPackId'),
      supplementContextPackId: stringField(action.payload, 'supplementContextPackId'),
      requestArtifactId: stringField(action.payload, 'requestArtifactId'),
      supplementArtifactId: stringField(action.payload, 'supplementArtifactId'),
    }));
  const findings = [
    ...gateIssues.map((issue) => ({
      kind: 'gate_issue',
      severity: issue.status === 'fail' ? 'high' : 'medium',
      summary: `${issue.gateId} ended as ${issue.status}`,
      evidenceRefs: [`gate:${issue.gateRunId}`, ...issue.evidenceRefs.map((ref) => `artifact:${ref.artifactId}`)],
      recommendedAction: issue.status === 'fail' ? 'create_eval_case' : 'review_before_knowledge_promotion',
    })),
    ...commandIssues.map((issue) => ({
      kind: 'command_issue',
      severity: issue.status === 'passed' ? 'medium' : 'high',
      summary: `${issue.command} status=${issue.status} digestBacked=${issue.digestBacked}`,
      evidenceRefs: [`command:${issue.commandRunId}`, issue.stdoutRef, issue.stderrRef],
      recommendedAction: issue.digestBacked ? 'inspect_command_log' : 'require_digest_backed_command_evidence',
    })),
    ...agentIssues.map((issue) => ({
      kind: 'agent_issue',
      severity: 'high',
      summary: `${issue.taskId} result=${issue.status}: ${issue.summary}`,
      evidenceRefs: [`agent_result:${issue.agentResultId}`, `agent_task:${issue.taskId}`],
      recommendedAction: 'create_eval_case',
    })),
    ...knowledgeReviewSignals.map((signal) => ({
      kind: 'knowledge_review',
      severity: signal.severity,
      summary: signal.message,
      evidenceRefs: signal.evidenceRefs,
      recommendedAction: signal.recommendedAction,
    })),
  ];
  const promotionCandidates = findings.map((finding, index) => ({
    id: `retro-${String(index + 1).padStart(3, '0')}`,
    target: finding.recommendedAction === 'create_eval_case' ? 'eval_candidate' : 'knowledge_review',
    findingKind: finding.kind,
    summary: finding.summary,
    evidenceRefs: finding.evidenceRefs,
    recommendedAction: finding.recommendedAction,
  }));
  const summary = {
    workflowRunId: run.id,
    title: run.title,
    status: run.status,
    steps: steps.length,
    commands: commands.length,
    gates: gates.length,
    artifacts: artifacts.length,
    approvals: approvals.length,
    agentTasks: agentTasks.length,
    agentResults: agentResults.length,
    agentEvents: agentEvents.length,
    auditEntries: auditEntries.length,
    findings: findings.length,
    promotionCandidates: promotionCandidates.length,
  };

  const md = [
    '# Retro Report',
    '',
    `- **Workflow Run:** \`${run.id}\``,
    `- **Title:** ${run.title}`,
    `- **Status:** ${run.status}`,
    '',
    '## Evidence Summary',
    '',
    `- steps=${summary.steps}`,
    `- commands=${summary.commands}`,
    `- gates=${summary.gates}`,
    `- artifacts=${summary.artifacts}`,
    `- approvals=${summary.approvals}`,
    `- agentTasks=${summary.agentTasks}`,
    `- agentEvents=${summary.agentEvents}`,
    '',
    '## Findings',
    '',
    findings.length === 0
      ? '_No retro findings were generated from persisted evidence._'
      : findings.map((finding) => `- ${finding.kind} severity=${finding.severity}: ${finding.summary}`).join('\n'),
    '',
    '## Promotion Candidates',
    '',
    promotionCandidates.length === 0
      ? '_No knowledge/eval candidates were generated._'
      : promotionCandidates.map((candidate) => `- ${candidate.id} -> ${candidate.target}: ${candidate.summary}`).join('\n'),
    '',
    '_Generated from persisted workflow evidence; no long-term knowledge was mutated._',
  ].join('\n');

  const generatedAt = nowIso();
  const json = {
    schemaVersion: 'ainp.retro_report.v1',
    workflowRunId: run.id,
    title: 'Retro Report',
    generatedAt,
    summary,
    findings,
    promotionCandidates,
    evidence: {
      stepIds: steps.map((step) => step.id),
      commandRunIds: commands.map((command) => command.id),
      gateRunIds: gates.map((gate) => gate.id),
      artifactIds: artifacts.map((artifact) => artifact.id),
      approvalIds: approvals.map((approval) => approval.id),
      agentTaskIds: agentTasks.map((task) => task.id),
      agentResultIds: agentResults.map((result) => result.id),
      contextRequests,
      rejectedApprovals,
      gateIssues,
      commandIssues,
      agentIssues,
      knowledgeReviewSignalIds: knowledgeReviewSignals.map((signal) => signal.id),
    },
  };
  return persistReportPair({
    workflowRunId,
    md,
    json,
    mdExt: '.retro.md',
    jsonExt: '.retro.json',
    auditKind: 'retro_report.generated',
    artifactKind: 'other',
    mdMetadata: {
      generatedAt,
      output: 'retro_report.md',
      reportKind: 'retro_report',
      schemaVersion: 'ainp.retro_report.v1',
    },
    jsonMetadata: {
      generatedAt,
      output: 'retro_report.json',
      reportKind: 'retro_report',
      structured: true,
      schemaVersion: 'ainp.retro_report.v1',
    },
  });
}

export async function generateRetroEvalScenarioDraft(
  workflowRunId: string,
  input: {
    targetId: string;
    actor: string;
    payload?: Record<string, unknown>;
  },
): Promise<Artifact> {
  const run = store.workflowRuns.get(workflowRunId);
  if (!run) throw new Error(`workflow run not found: ${workflowRunId}`);

  const payload = input.payload ?? {};
  const generatedAt = nowIso();
  const title = stringField(payload, 'title') ?? `Retro eval scenario ${input.targetId}`;
  const evidenceRefs = stringArray(payload.evidenceRefs);
  const suggestedScenario = asRecord(payload.scenario) ?? {
    schemaVersion: 'ainp.eval.scenario.v1',
    id: safeDraftId(`${run.id}-${input.targetId}`),
    title,
    description: stringField(payload, 'summary') ?? 'Drafted from a confirmed retro finding.',
    kind: stringField(payload, 'scenarioKind') ?? 'workflow_fixture',
    input: {
      workflowRunId: run.id,
      retroCandidateId: input.targetId,
      evidenceRefs,
    },
    expectations: asRecord(payload.expectations) ?? {},
  };
  const draft = {
    schemaVersion: 'ainp.eval.scenario_draft.v1',
    workflowRunId: run.id,
    targetId: input.targetId,
    title,
    status: 'draft',
    actor: input.actor,
    generatedAt,
    source: {
      kind: 'retro_candidate',
      findingKind: stringField(payload, 'findingKind'),
      recommendedAction: stringField(payload, 'recommendedAction'),
      summary: stringField(payload, 'summary'),
      evidenceRefs,
    },
    suggestedScenario,
    payload,
  };

  const outDir = join(REPORTS_DIR, workflowRunId);
  await mkdir(outDir, { recursive: true });
  const artifactId = newId('art');
  const path = join(outDir, `${artifactId}.eval-scenario-draft.json`);
  const jsonText = `${JSON.stringify(draft, null, 2)}\n`;
  await writeFile(path, jsonText, 'utf8');
  audit(workflowRunId, 'retro_action.eval_scenario_draft_created', {
    targetId: input.targetId,
    path,
  });

  return createArtifact({
    workflowRunId,
    stepRunId: null,
    kind: 'other',
    uri: pathToFileUri(path),
    size: Buffer.byteLength(jsonText, 'utf8'),
    contentType: 'application/json',
    metadata: {
      generatedAt,
      output: 'eval_scenario_draft.json',
      reportKind: 'eval_candidate',
      structured: true,
      schemaVersion: 'ainp.eval.scenario_draft.v1',
      retroCandidateId: input.targetId,
    },
  });
}

interface KnowledgeReviewSignalSummary {
  id: string;
  kind: string;
  severity: string;
  message: string;
  subjectRefs: string[];
  evidenceRefs: string[];
  recommendedAction: string;
}

interface KnowledgeSuggestion {
  id: string;
  kind: 'Pattern' | 'Decision' | 'Pitfall' | 'Lesson' | 'Review';
  text: string;
  evidence: string;
  sourceRefs: string[];
  recommendedAction: string;
}

interface ProfileKnowledgeCandidateSummary {
  id: string;
  title: string;
  knowledgeKind: KnowledgeArtifactKind;
  kind: KnowledgeArtifactKind;
  subtype: string | null;
  body: string;
  sourceRefs: string[];
  confidence: number;
  freshness: ContextFreshness;
  rationale: string;
  origin: 'profile.bootstrap';
  workflowRunId: string;
  profileArtifactId: string;
  status: 'candidate';
}

interface ProfileKnowledgeCandidateWarning {
  index: number;
  title: string | null;
  reason: string;
}

function latestProfileJsonArtifact(workflowRunId: string): Artifact | null {
  return store.artifacts.byKind(workflowRunId, 'project_profile')
    .filter((artifact) => {
      const profileFormat = artifact.metadata.profileFormat;
      return artifact.contentType === 'application/json'
        || profileFormat === 'json'
        || artifact.metadata.output === 'project-profile.json';
    })
    .at(-1) ?? null;
}

function parseProfileEnvelope(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`profile knowledge candidate requires valid project-profile.json: ${(err as Error).message}`);
  }
  const profile = asRecord(parsed);
  if (!profile || profile.schemaVersion !== 'ainp.project_profile.v1') {
    throw new Error('profile knowledge candidate requires schemaVersion ainp.project_profile.v1');
  }
  return profile;
}

function normalizeProfileKnowledgeCandidates(input: {
  rawCandidates: unknown[];
  workflowRunId: string;
  profileArtifactId: string;
  sourceRefsBase: string[];
}): {
  candidates: ProfileKnowledgeCandidateSummary[];
  warnings: ProfileKnowledgeCandidateWarning[];
} {
  const candidates: ProfileKnowledgeCandidateSummary[] = [];
  const warnings: ProfileKnowledgeCandidateWarning[] = [];

  input.rawCandidates.forEach((rawCandidate, index) => {
    const record = asRecord(rawCandidate);
    const title = typeof record?.title === 'string' && record.title.trim()
      ? record.title.trim()
      : null;
    const warn = (reason: string): void => {
      warnings.push({ index, title, reason });
    };

    if (!record) {
      warn('candidate is not an object');
      return;
    }

    if (!isKnowledgeArtifactKind(record.kind)) {
      warn(`invalid knowledge kind '${String(record.kind)}'`);
      return;
    }
    const subtype = typeof record.subtype === 'string' && record.subtype.trim()
      ? record.subtype.trim()
      : undefined;
    if (!isValidKnowledgeSubtype(record.kind, subtype)) {
      warn(`invalid subtype '${String(record.subtype)}' for ${record.kind}`);
      return;
    }

    const confidence = typeof record.confidence === 'number' && Number.isFinite(record.confidence)
      ? record.confidence
      : NaN;
    if (!Number.isFinite(confidence) || confidence < 0.7) {
      warn(`confidence ${Number.isFinite(confidence) ? confidence.toFixed(2) : 'missing'} is below the 0.70 suggested threshold`);
      return;
    }

    const sourceRefs = stringArray(record.sourceRefs);
    if (sourceRefs.length === 0) {
      warn('missing sourceRefs');
      return;
    }

    const body = typeof record.body === 'string' && record.body.trim()
      ? record.body.trim()
      : '';
    if (!body) {
      warn('missing body');
      return;
    }

    const freshness = isContextFreshness(record.freshness) ? record.freshness : 'possibly_stale';
    const candidate: ProfileKnowledgeCandidateSummary = {
      id: `KS-${String(candidates.length + 1).padStart(3, '0')}`,
      title: title ?? `${record.kind} candidate ${index + 1}`,
      knowledgeKind: record.kind,
      kind: record.kind,
      subtype: subtype ?? null,
      body,
      sourceRefs: [...new Set([...input.sourceRefsBase, ...sourceRefs])],
      confidence,
      freshness,
      rationale: typeof record.rationale === 'string' ? record.rationale.trim() : '',
      origin: 'profile.bootstrap',
      workflowRunId: input.workflowRunId,
      profileArtifactId: input.profileArtifactId,
      status: 'candidate',
    };
    candidates.push(candidate);
  });

  return { candidates, warnings };
}

function groupProfileCandidatesByKind(
  candidates: ProfileKnowledgeCandidateSummary[],
): Array<[KnowledgeArtifactKind, ProfileKnowledgeCandidateSummary[]]> {
  const groups = new Map<KnowledgeArtifactKind, ProfileKnowledgeCandidateSummary[]>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.knowledgeKind) ?? [];
    group.push(candidate);
    groups.set(candidate.knowledgeKind, group);
  }
  return [...groups.entries()];
}

function profileCandidateToSuggestion(candidate: ProfileKnowledgeCandidateSummary): KnowledgeSuggestion & {
  knowledgeKind: KnowledgeArtifactKind;
  subtype: string | null;
  title: string;
  confidence: number;
  freshness: ContextFreshness;
  origin: 'profile.bootstrap';
  profileArtifactId: string;
} {
  return {
    id: candidate.id,
    kind: displayKnowledgeSuggestionKind(candidate),
    knowledgeKind: candidate.knowledgeKind,
    subtype: candidate.subtype,
    title: candidate.title,
    text: `${candidate.title}: ${candidate.body}`,
    evidence: candidate.sourceRefs.join(', '),
    sourceRefs: candidate.sourceRefs,
    confidence: candidate.confidence,
    freshness: candidate.freshness,
    origin: candidate.origin,
    profileArtifactId: candidate.profileArtifactId,
    recommendedAction: 'needs_review',
  };
}

function displayKnowledgeSuggestionKind(
  candidate: ProfileKnowledgeCandidateSummary,
): KnowledgeSuggestion['kind'] {
  if (candidate.knowledgeKind === 'decision') return 'Decision';
  if (candidate.knowledgeKind === 'lesson' && candidate.subtype === 'pitfall') return 'Pitfall';
  if (candidate.knowledgeKind === 'pattern' || candidate.knowledgeKind === 'architecture') return 'Pattern';
  return 'Lesson';
}

function collectKnowledgeReviewSignals(input: {
  artifacts: Artifact[];
  actions: ReturnType<typeof store.workflowActions.byWorkflow>;
}): KnowledgeReviewSignalSummary[] {
  const signals: KnowledgeReviewSignalSummary[] = [];
  const seen = new Set<string>();

  const push = (signal: KnowledgeReviewSignalSummary): void => {
    if (seen.has(signal.id)) return;
    seen.add(signal.id);
    signals.push(signal);
  };

  for (const artifact of input.artifacts) {
    const contextSelection = asRecord(artifact.metadata.contextSelection);
    const artifactSignals = Array.isArray(contextSelection?.calibrationSignals)
      ? contextSelection.calibrationSignals
      : [];
    for (const rawSignal of artifactSignals) {
      const signal = normalizeReviewSignal(rawSignal, `artifact:${artifact.id}`);
      if (signal) push(signal);
    }
  }

  for (const action of input.actions) {
    if (action.kind !== 'knowledge_suggestion_action') continue;
    if (!isReviewAction(action.action)) continue;
    const payload = action.payload ?? {};
    push({
      id: `knowledge_action:${action.id}`,
      kind: action.action,
      severity: action.action === 'needs_review' || action.action === 'mark_stale'
        ? 'review_required'
        : 'warning',
      message: typeof payload.reason === 'string'
        ? payload.reason
        : `Knowledge action ${action.action} was recorded for ${action.targetId ?? 'an untargeted candidate'}.`,
      subjectRefs: [
        action.targetId ? `knowledge_suggestion:${action.targetId}` : '',
        typeof payload.targetKnowledgeId === 'string' ? `knowledge_artifact:${payload.targetKnowledgeId}` : '',
      ].filter(Boolean),
      evidenceRefs: stringArray(payload.evidenceRefs),
      recommendedAction: action.action,
    });
  }

  return signals;
}

function buildKnowledgeSuggestions(input: {
  runId: string;
  title: string;
  commands: ReturnType<typeof store.commandRuns.byWorkflow>;
  gates: ReturnType<typeof store.gateRuns.byWorkflow>;
  artifacts: Artifact[];
  builds: ReturnType<typeof store.buildRuns.byWorkflow>;
  testRuns: ReturnType<typeof store.testRuns.byBuild>;
  contextRequests: ReturnType<typeof store.workflowActions.byWorkflow>;
  knowledgeReviewSignals: KnowledgeReviewSignalSummary[];
}): KnowledgeSuggestion[] {
  const suggestions: KnowledgeSuggestion[] = [];

  const push = (suggestion: Omit<KnowledgeSuggestion, 'id'>): void => {
    const id = `KS-${String(suggestions.length + 1).padStart(3, '0')}`;
    suggestions.push({ id, ...suggestion });
  };

  const failedCommands = input.commands.filter((command) => command.status !== 'passed');
  const passedCommands = input.commands.filter((command) => command.status === 'passed');
  if (failedCommands.length > 0) {
    const command = failedCommands[0]!;
    push({
      kind: 'Pitfall',
      text: `Command \`${command.command}\` ended with status=${command.status} exit=${command.exitCode ?? 'n/a'} during "${input.title}". Preserve command logs as the evidence trail before retrying.`,
      evidence: `commandRun=${command.id}; stdout=${command.stdoutRef}; stderr=${command.stderrRef}`,
      sourceRefs: [`command:${command.id}`, command.stdoutRef, command.stderrRef],
      recommendedAction: 'needs_review',
    });
  } else if (passedCommands.length > 0) {
    const commands = passedCommands.slice(0, 3);
    push({
      kind: 'Decision',
      text: `Verification for "${input.title}" used real command evidence: ${commands.map((command) => `\`${command.command}\``).join(', ')}.`,
      evidence: `commandRuns=${commands.map((command) => command.id).join(',')}`,
      sourceRefs: commands.map((command) => `command:${command.id}`),
      recommendedAction: 'accepted',
    });
  }

  const warningGates = input.gates.filter((gate) => gate.status !== 'pass');
  if (warningGates.length > 0) {
    const gate = warningGates[0]!;
    push({
      kind: gate.status === 'fail' ? 'Pitfall' : 'Review',
      text: `Gate \`${gate.gateId}\` finished with status=${gate.status}; future runs should inspect rule evidence before promoting related knowledge.`,
      evidence: `gateRun=${gate.id}; rules=${gate.ruleResults.map((rule) => `${rule.ruleId}:${rule.status}`).join(',')}`,
      sourceRefs: [`gate:${gate.id}`, ...gate.evidenceRefs.map((ref) => `artifact:${ref.artifactId}`)],
      recommendedAction: gate.status === 'fail' ? 'downgrade_candidate' : 'needs_review',
    });
  } else if (input.gates.length > 0) {
    const gateIds = input.gates.map((gate) => gate.gateId).join(', ');
    push({
      kind: 'Decision',
      text: `Quality gates passed for "${input.title}": ${gateIds}. Treat the gate rows as the durable acceptance evidence.`,
      evidence: `gateRuns=${input.gates.map((gate) => gate.id).join(',')}`,
      sourceRefs: input.gates.map((gate) => `gate:${gate.id}`),
      recommendedAction: 'accepted',
    });
  }

  if (input.contextRequests.length > 0) {
    const action = input.contextRequests[0]!;
    const request = asRecord(action.payload.request);
    push({
      kind: 'Pattern',
      text: `The run used structured context_request \`${action.targetId ?? action.id}\` instead of inventing missing context.`,
      evidence: `workflowAction=${action.id}; supplement=${String(action.payload.supplementContextPackId ?? 'n/a')}; reason=${String(request?.reason ?? '')}`,
      sourceRefs: [`workflow_action:${action.id}`],
      recommendedAction: 'accepted',
    });
  }

  const diff = input.artifacts.filter((artifact) => artifact.kind === 'diff').at(-1);
  if (diff) {
    push({
      kind: 'Pattern',
      text: `The implementation produced a diff artifact with explicit URI \`${diff.uri}\`; use it as the change-scope source of truth.`,
      evidence: `artifact=${diff.id}; uri=${diff.uri}`,
      sourceRefs: [`artifact:${diff.id}`, diff.uri],
      recommendedAction: 'accepted',
    });
  }

  for (const signal of input.knowledgeReviewSignals.slice(0, 2)) {
    push({
      kind: 'Review',
      text: `Knowledge review signal \`${signal.id}\` (${signal.kind}) requires human calibration before changing confirmed knowledge.`,
      evidence: `subjects=${signal.subjectRefs.join(',') || 'n/a'}; evidence=${signal.evidenceRefs.join(',') || 'n/a'}`,
      sourceRefs: [...signal.subjectRefs, ...signal.evidenceRefs],
      recommendedAction: signal.recommendedAction,
    });
  }

  if (input.builds.length > 0 && input.testRuns.length > 0) {
    const totals = input.testRuns.reduce(
      (acc, test) => ({
        total: acc.total + test.total,
        failed: acc.failed + test.failed + test.errors,
      }),
      { total: 0, failed: 0 },
    );
    push({
      kind: totals.failed > 0 ? 'Pitfall' : 'Decision',
      text: `Build/test evidence covered ${totals.total} test case(s) with ${totals.failed} failure/error(s).`,
      evidence: `buildRuns=${input.builds.map((build) => build.id).join(',')}; testRuns=${input.testRuns.map((test) => test.id).join(',')}`,
      sourceRefs: [
        ...input.builds.map((build) => `build:${build.id}`),
        ...input.testRuns.map((test) => `test:${test.id}`),
      ],
      recommendedAction: totals.failed > 0 ? 'needs_review' : 'accepted',
    });
  }

  if (suggestions.length === 0) {
    push({
      kind: 'Review',
      text: `No durable project knowledge was inferred from run evidence for "${input.title}". Leave this candidate unpromoted unless a human adds a specific lesson.`,
      evidence: `workflowRun=${input.runId}`,
      sourceRefs: [`workflow_run:${input.runId}`],
      recommendedAction: 'ignored',
    });
  }

  return suggestions;
}

function normalizeReviewSignal(value: unknown, fallbackRef: string): KnowledgeReviewSignalSummary | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = typeof record.id === 'string' && record.id.trim()
    ? record.id
    : `signal:${fallbackRef}`;
  return {
    id,
    kind: typeof record.kind === 'string' ? record.kind : 'needs_review',
    severity: typeof record.severity === 'string' ? record.severity : 'warning',
    message: typeof record.message === 'string' ? record.message : 'Knowledge review signal recorded.',
    subjectRefs: stringArray(record.subjectRefs),
    evidenceRefs: stringArray(record.evidenceRefs),
    recommendedAction: typeof record.recommendedAction === 'string'
      ? record.recommendedAction
      : 'needs_review',
  };
}

function isReviewAction(action: string): boolean {
  return action === 'upgrade'
    || action === 'downgrade'
    || action === 'supersede'
    || action === 'mark_stale'
    || action === 'needs_review'
    || action === 'upgrade_candidate'
    || action === 'downgrade_candidate';
}

function formatRatioMetric(metric: { value: number; numerator: number; denominator: number }): string {
  const pct = Math.round(metric.value * 100);
  return `${pct}% (${metric.numerator}/${metric.denominator})`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0))];
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim();
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function safeDraftId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'retro-eval-scenario';
}
