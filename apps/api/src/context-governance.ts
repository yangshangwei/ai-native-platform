import type { Artifact, ContextInclusionMode } from '@ainp/shared';
import { store, type WorkflowAction } from './store/store';
import { readArtifactContent } from './artifact-content';

export interface ContextGovernanceReadModel {
  schemaVersion: 'ainp.context_governance.v1';
  workflowRunId: string;
  projectId: string;
  contextPacks: ContextPackSummary[];
  manifest: ContextManifestSummaryItem[];
  sourceRefs: SourceRefSummary[];
  trustLevels: Record<string, number>;
  budgetDecisions: BudgetDecisionSummary[];
  contextRequests: ContextRequestSummary[];
  metrics: ContextGovernanceMetrics;
}

export interface ContextPackSummary {
  contextPackId: string;
  source: 'artifact.metadata' | 'agent_task.prompt';
  artifactId: string | null;
  taskId: string | null;
  stage: string | null;
  mode: string | null;
  supplement: unknown;
  manifest: ContextManifestSummaryItem[];
  retrievalHints: unknown[];
  calibrationSignals: unknown[];
  contextPack: unknown | null;
}

export interface ContextManifestSummaryItem {
  contextPackId: string;
  ref: string;
  reason: string;
  priority: number | null;
  mode: string | null;
  knowledgeClass: string | null;
  trustLevel: string | null;
  freshness: string | null;
  sourceType: string | null;
  sourceRefs: string[];
  score: number | null;
  selectionReasons: string[];
  degradedFrom: string | null;
  degradationReason: string | null;
}

export interface SourceRefSummary {
  sourceRef: string;
  contextPackIds: string[];
  manifestRefs: string[];
  trustLevels: string[];
  knowledgeClasses: string[];
}

export interface BudgetDecisionSummary {
  contextPackId: string;
  ref: string;
  mode: string | null;
  degradedFrom: string | null;
  degradationReason: string | null;
  score: number | null;
}

export interface ContextRequestSummary {
  id: string;
  actionId: string;
  status: string;
  priority: number | null;
  reason: string;
  requestedRefs: string[];
  questions: string[];
  sourceName: string | null;
  taskId: string | null;
  baseContextPackId: string | null;
  supplementContextPackId: string | null;
  requestArtifactId: string | null;
  supplementArtifactId: string | null;
  createdAt: string;
}

export interface ContextGovernanceMetrics {
  impactCoverage: RatioMetric;
  evidenceTraceability: RatioMetric;
  irrelevantContextRatio: RatioMetric;
  contextRequestCount: CountMetric;
  downstreamReworkSignal: CountMetric & {
    rejectedApprovals: number;
    failedGates: number;
    failedAgentResults: number;
  };
}

export interface RatioMetric {
  value: number;
  numerator: number;
  denominator: number;
  explanation: string;
}

export interface CountMetric {
  value: number;
  explanation: string;
}

export function buildContextGovernanceReadModel(workflowRunId: string): ContextGovernanceReadModel {
  const run = store.workflowRuns.get(workflowRunId);
  if (!run) throw new Error(`workflow run not found: ${workflowRunId}`);
  const artifacts = store.artifacts.byWorkflow(workflowRunId);
  const actions = store.workflowActions.byWorkflow(workflowRunId);
  const agentTasks = store.agentTasks.byWorkflow(workflowRunId);
  const agentResults = store.agentResults.byWorkflow(workflowRunId);
  const gates = store.gateRuns.byWorkflow(workflowRunId);
  const approvals = store.approvals.byWorkflow(workflowRunId);

  const contextPacks = [
    ...contextPackSummariesFromArtifacts(artifacts),
    ...contextPackSummariesFromAgentPrompts(agentTasks),
  ];
  const manifest = contextPacks.flatMap((pack) => pack.manifest);
  const contextRequests = contextRequestsFromActions(actions);

  return {
    schemaVersion: 'ainp.context_governance.v1',
    workflowRunId,
    projectId: run.projectId,
    contextPacks,
    manifest,
    sourceRefs: summarizeSourceRefs(manifest),
    trustLevels: summarizeTrustLevels(manifest),
    budgetDecisions: budgetDecisionsFromManifest(manifest),
    contextRequests,
    metrics: {
      impactCoverage: ratio(
        agentTasks.filter((task) => task.prompt.includes('ContextPack:')).length,
        agentTasks.length,
        'Agent tasks carrying a ContextPack prompt audit divided by total agent tasks.',
      ),
      evidenceTraceability: ratio(
        manifest.filter((item) => item.sourceRefs.length > 0).length,
        manifest.length,
        'Selected manifest items with at least one sourceRef divided by all selected manifest items.',
      ),
      irrelevantContextRatio: ratio(
        manifest.filter(isLowSignalManifestItem).length,
        manifest.length,
        'Deterministic low-signal proxy: priority=3 selected items with keywordOverlap=0 and no degradation evidence.',
      ),
      contextRequestCount: {
        value: contextRequests.length,
        explanation: 'Structured context_request workflow actions recorded for this run.',
      },
      downstreamReworkSignal: downstreamReworkMetric({ approvals, gates, agentResults }),
    },
  };
}

function contextPackSummariesFromArtifacts(artifacts: Artifact[]): ContextPackSummary[] {
  return artifacts
    .map((artifact): ContextPackSummary | null => {
      const selection = asRecord(artifact.metadata.contextSelection);
      if (!selection) return null;
      const contextPackId = stringField(selection, 'contextPackId') ?? `artifact:${artifact.id}`;
      const manifest = selectedItems(selection).map((item) => ({
        ...item,
        contextPackId,
      }));
      return {
        contextPackId,
        source: 'artifact.metadata' as const,
        artifactId: artifact.id,
        taskId: null,
        stage: stringField(selection, 'stage') ?? stringField(artifact.metadata, 'stage'),
        mode: stringField(selection, 'mode'),
        supplement: selection.supplement ?? null,
        manifest,
        retrievalHints: arrayField(selection, 'retrievalHints'),
        calibrationSignals: arrayField(selection, 'calibrationSignals'),
        contextPack: contextPackObjectFromArtifact(artifact),
      };
    })
    .filter((pack): pack is ContextPackSummary => pack !== null);
}

function contextPackSummariesFromAgentPrompts(
  agentTasks: ReturnType<typeof store.agentTasks.byWorkflow>,
): ContextPackSummary[] {
  return agentTasks
    .map((task): ContextPackSummary | null => {
      const contextPackId = /^ContextPack:\s*(.+)$/m.exec(task.prompt)?.[1]?.trim();
      if (!contextPackId) return null;
      const mode = /^ContextMode:\s*(.+)$/m.exec(task.prompt)?.[1]?.trim() ?? null;
      return {
        contextPackId,
        source: 'agent_task.prompt' as const,
        artifactId: null,
        taskId: task.id,
        stage: null,
        mode,
        supplement: null,
        manifest: manifestItemsFromPrompt(task.prompt, contextPackId),
        retrievalHints: [],
        calibrationSignals: [],
        contextPack: null,
      };
    })
    .filter((pack): pack is ContextPackSummary => pack !== null);
}

function contextPackObjectFromArtifact(artifact: Artifact): unknown | null {
  if (!artifact.contentType.includes('json') && !artifact.uri.endsWith('.json')) return null;
  try {
    const parsed = JSON.parse(readArtifactContent(artifact).text) as unknown;
    const record = asRecord(parsed);
    return record?.contextPack ?? record ?? null;
  } catch {
    return null;
  }
}

function selectedItems(selection: Record<string, unknown>): Omit<ContextManifestSummaryItem, 'contextPackId'>[] {
  return arrayField(selection, 'selected')
    .map((item) => normalizeManifestItem(item))
    .filter((item): item is Omit<ContextManifestSummaryItem, 'contextPackId'> => item !== null);
}

function normalizeManifestItem(item: unknown): Omit<ContextManifestSummaryItem, 'contextPackId'> | null {
  const record = asRecord(item);
  if (!record) return null;
  const ref = stringField(record, 'ref');
  if (!ref) return null;
  return {
    ref,
    reason: stringField(record, 'reason') ?? '',
    priority: numberField(record, 'priority'),
    mode: stringField(record, 'mode'),
    knowledgeClass: stringField(record, 'knowledgeClass'),
    trustLevel: stringField(record, 'trustLevel'),
    freshness: stringField(record, 'freshness'),
    sourceType: stringField(record, 'sourceType'),
    sourceRefs: stringArrayField(record, 'sourceRefs'),
    score: numberField(record, 'score'),
    selectionReasons: stringArrayField(record, 'selectionReasons'),
    degradedFrom: stringField(record, 'degradedFrom'),
    degradationReason: stringField(record, 'degradationReason'),
  };
}

function manifestItemsFromPrompt(
  prompt: string,
  contextPackId: string,
): ContextManifestSummaryItem[] {
  return prompt
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- ') && line.includes('sourceRefs='))
    .map((line) => manifestItemFromPromptLine(line, contextPackId))
    .filter((item): item is ContextManifestSummaryItem => item !== null);
}

function manifestItemFromPromptLine(
  line: string,
  contextPackId: string,
): ContextManifestSummaryItem | null {
  const match = /^-\s*([^:]+):\s*(.*?)\s*\((.*)\)\s*$/.exec(line);
  if (!match) return null;
  const fields = promptFields(match[3] ?? '');
  return {
    contextPackId,
    ref: (match[1] ?? '').trim(),
    reason: (match[2] ?? '').trim(),
    priority: numberFromString(fields.get('priority')),
    mode: fields.get('mode') ?? null,
    knowledgeClass: fields.get('knowledgeClass') ?? null,
    trustLevel: emptyToNull(fields.get('trustLevel')),
    freshness: emptyToNull(fields.get('freshness')),
    sourceType: emptyToNull(fields.get('sourceType')),
    sourceRefs: splitRefs(fields.get('sourceRefs')),
    score: numberFromString(fields.get('score')),
    selectionReasons: [],
    degradedFrom: null,
    degradationReason: fields.get('degradationReason') ?? null,
  };
}

function promptFields(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of text.split(';')) {
    const [rawKey, ...rest] = part.split('=');
    const key = rawKey?.trim();
    if (!key) continue;
    out.set(key, rest.join('=').trim());
  }
  const degraded = out.get('degraded');
  if (degraded?.includes('->')) {
    const [from] = degraded.split('->');
    out.set('degradedFrom', from?.trim() ?? '');
  }
  return out;
}

function contextRequestsFromActions(actions: WorkflowAction[]): ContextRequestSummary[] {
  return actions
    .filter((action) => action.kind === 'context_request')
    .map((action) => {
      const request = asRecord(action.payload.request) ?? {};
      return {
        id: stringField(request, 'id') ?? action.targetId ?? action.id,
        actionId: action.id,
        status: stringField(request, 'status') ?? 'open',
        priority: numberField(request, 'priority'),
        reason: stringField(request, 'reason') ?? '',
        requestedRefs: stringArrayField(request, 'requestedRefs'),
        questions: stringArrayField(request, 'questions'),
        sourceName: stringField(action.payload, 'sourceName'),
        taskId: stringField(action.payload, 'taskId'),
        baseContextPackId: stringField(action.payload, 'baseContextPackId'),
        supplementContextPackId: stringField(action.payload, 'supplementContextPackId'),
        requestArtifactId: stringField(action.payload, 'requestArtifactId'),
        supplementArtifactId: stringField(action.payload, 'supplementArtifactId'),
        createdAt: action.createdAt,
      };
    });
}

function summarizeSourceRefs(manifest: readonly ContextManifestSummaryItem[]): SourceRefSummary[] {
  const byRef = new Map<string, SourceRefSummary>();
  for (const item of manifest) {
    for (const sourceRef of item.sourceRefs) {
      const current = byRef.get(sourceRef) ?? {
        sourceRef,
        contextPackIds: [],
        manifestRefs: [],
        trustLevels: [],
        knowledgeClasses: [],
      };
      current.contextPackIds = unique([...current.contextPackIds, item.contextPackId]);
      current.manifestRefs = unique([...current.manifestRefs, item.ref]);
      current.trustLevels = unique([...current.trustLevels, item.trustLevel ?? 'unknown']);
      current.knowledgeClasses = unique([...current.knowledgeClasses, item.knowledgeClass ?? 'unknown']);
      byRef.set(sourceRef, current);
    }
  }
  return [...byRef.values()].sort((a, b) => a.sourceRef.localeCompare(b.sourceRef));
}

function summarizeTrustLevels(manifest: readonly ContextManifestSummaryItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of manifest) {
    const key = item.trustLevel ?? 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function budgetDecisionsFromManifest(
  manifest: readonly ContextManifestSummaryItem[],
): BudgetDecisionSummary[] {
  return manifest.map((item) => ({
    contextPackId: item.contextPackId,
    ref: item.ref,
    mode: item.mode,
    degradedFrom: item.degradedFrom,
    degradationReason: item.degradationReason,
    score: item.score,
  }));
}

function isLowSignalManifestItem(item: ContextManifestSummaryItem): boolean {
  if (item.ref === 'task_brief' || item.ref === 'workflow_run') return false;
  if (item.degradedFrom || item.mode === ('retrieval_hint' satisfies ContextInclusionMode)) return false;
  const keywordOverlapZero = item.selectionReasons.some((reason) => (
    reason === 'keywordOverlap=0'
  )) || item.reason.includes('keywordOverlap=0');
  return item.priority === 3 && keywordOverlapZero;
}

function downstreamReworkMetric(input: {
  approvals: ReturnType<typeof store.approvals.byWorkflow>;
  gates: ReturnType<typeof store.gateRuns.byWorkflow>;
  agentResults: ReturnType<typeof store.agentResults.byWorkflow>;
}): ContextGovernanceMetrics['downstreamReworkSignal'] {
  const rejectedApprovals = input.approvals.filter((approval) => approval.decision === 'rejected').length;
  const failedGates = input.gates.filter((gate) => gate.status === 'fail').length;
  const failedAgentResults = input.agentResults.filter((result) => result.status === 'failed').length;
  const value = rejectedApprovals + failedGates + failedAgentResults;
  return {
    value,
    rejectedApprovals,
    failedGates,
    failedAgentResults,
    explanation: 'Explicit rework proxy: rejected approvals + failed gates + failed agent results.',
  };
}

function ratio(numerator: number, denominator: number, explanation: string): RatioMetric {
  return {
    value: denominator > 0 ? Number((numerator / denominator).toFixed(4)) : 0,
    numerator,
    denominator,
    explanation,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringField(obj: Record<string, unknown>, key: string): string | null {
  const value = obj[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function numberField(obj: Record<string, unknown>, key: string): number | null {
  const value = obj[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function numberFromString(value: string | undefined): number | null {
  if (value === undefined || value === 'n/a') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringArrayField(obj: Record<string, unknown>, key: string): string[] {
  const value = obj[key];
  if (!Array.isArray(value)) return [];
  return unique(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0));
}

function arrayField(obj: Record<string, unknown>, key: string): unknown[] {
  const value = obj[key];
  return Array.isArray(value) ? value : [];
}

function splitRefs(value: string | undefined): string[] {
  if (!value || value === 'n/a') return [];
  return unique(value.split(',').map((item) => item.trim()).filter(Boolean));
}

function emptyToNull(value: string | undefined): string | null {
  if (!value || value === 'n/a') return null;
  return value;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
