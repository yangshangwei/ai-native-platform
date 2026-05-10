import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { newId, type Artifact } from '@ainp/shared';
import { store } from './store/store';
import { createArtifact, audit } from './workflow-engine';
import { buildContextGovernanceReadModel } from './context-governance';

const REPORTS_DIR = process.env.AINP_REPORTS_DIR ?? join(homedir(), '.ai-native', 'reports');

export interface GeneratedArtifactWithSidecar {
  artifact: Artifact;
  sidecar: Artifact;
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

  const stages = [
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

  const md = [
    `# Completion Report`,
    ``,
    `- **Workflow Run:** \`${run.id}\``,
    `- **Title:** ${run.title}`,
    `- **Project:** ${project?.name ?? run.projectId}`,
    `- **Branch:** \`${run.branch}\``,
    `- **Workspace:** \`${run.workspacePath ?? '-'}\``,
    `- **Status:** ${run.status}`,
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
    `_Generated by ainp-api at ${new Date().toISOString()}._`,
  ].join('\n');

  const outDir = join(REPORTS_DIR, workflowRunId);
  await mkdir(outDir, { recursive: true });
  const reportId = newId('art');
  const path = join(outDir, `${reportId}.md`);
  await writeFile(path, md, 'utf8');
  const generatedAt = new Date().toISOString();
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
      `Status: ${run.status}`,
    ],
    sections: [
      { title: 'Stage timeline', body: stageTimeline },
      { title: 'Gates', body: gatesBody },
      { title: 'Build & Tests', body: buildBody },
      { title: `Commands (${commands.length})`, body: commandsBody },
      { title: `Artifacts (${artifacts.length})`, body: artifactsBody },
      { title: `Approvals (${approvals.length})`, body: approvalsBody },
      { title: `Context Requests (${contextRequests.length})`, body: contextRequestsBody },
      { title: `Knowledge Review Signals (${knowledgeReviewSignals.length})`, body: knowledgeReviewBody },
      { title: 'Context Governance Metrics', body: governanceMetricsBody },
    ],
    contextRequests,
    knowledgeReviewSignals,
    contextGovernanceMetrics: contextGovernance.metrics,
    generatedAt,
  };
  const jsonText = `${JSON.stringify(json, null, 2)}\n`;
  const jsonId = newId('art');
  const jsonPath = join(outDir, `${jsonId}.json`);
  await writeFile(jsonPath, jsonText, 'utf8');
  audit(workflowRunId, 'completion_report.generated', { path, sidecarPath: jsonPath });

  const artifact = createArtifact({
    workflowRunId,
    stepRunId: null,
    kind: 'completion_report',
    uri: `file://${path}`,
    size: Buffer.byteLength(md, 'utf8'),
    contentType: 'text/markdown',
    metadata: { generatedAt, output: 'completion_report.md' },
  });
  const sidecar = createArtifact({
    workflowRunId,
    stepRunId: null,
    kind: 'completion_report',
    uri: `file://${jsonPath}`,
    size: Buffer.byteLength(jsonText, 'utf8'),
    contentType: 'application/json',
    metadata: {
      generatedAt,
      output: 'completion_report.json',
      structured: true,
      schemaVersion: 'ainp.completion_report.v1',
    },
  });
  return { artifact, sidecar };
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
    `_Generated at ${new Date().toISOString()}._`,
  ].join('\n');

  const outDir = join(REPORTS_DIR, workflowRunId);
  await mkdir(outDir, { recursive: true });
  const id = newId('art');
  const path = join(outDir, `${id}.md`);
  await writeFile(path, md, 'utf8');
  const generatedAt = new Date().toISOString();
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
  const jsonText = `${JSON.stringify(json, null, 2)}\n`;
  const jsonId = newId('art');
  const jsonPath = join(outDir, `${jsonId}.json`);
  await writeFile(jsonPath, jsonText, 'utf8');
  audit(workflowRunId, 'knowledge_candidate.generated', { path, sidecarPath: jsonPath });

  const artifact = createArtifact({
    workflowRunId,
    stepRunId: null,
    kind: 'knowledge_candidate',
    uri: `file://${path}`,
    size: Buffer.byteLength(md, 'utf8'),
    contentType: 'text/markdown',
    metadata: { generatedAt, output: 'knowledge_candidate.md' },
  });
  const sidecar = createArtifact({
    workflowRunId,
    stepRunId: null,
    kind: 'knowledge_candidate',
    uri: `file://${jsonPath}`,
    size: Buffer.byteLength(jsonText, 'utf8'),
    contentType: 'application/json',
    metadata: {
      generatedAt,
      output: 'knowledge_candidate.json',
      structured: true,
      schemaVersion: 'ainp.knowledge_candidate.v1',
    },
  });
  return { artifact, sidecar };
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
  kind: 'Pattern' | 'Decision' | 'Pitfall' | 'Review';
  text: string;
  evidence: string;
  sourceRefs: string[];
  recommendedAction: string;
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
