import type {
  ContextFreshness,
  ContextInclusionMode,
  ContextPackBudget,
  ContextSection,
  ContextSourceType,
  ContextTrustLevel,
  KnowledgeClass,
  WorkflowStage,
} from '@ainp/shared';

export interface ContextCandidate {
  id: string;
  title: string;
  sourceType: ContextSourceType;
  content: string;
  sourceRefs: string[];
  reason: string;
  priority: 1 | 2 | 3;
  knowledgeClass: KnowledgeClass;
  trustLevel: ContextTrustLevel;
  freshness: ContextFreshness;
  confidence: number;
  createdAt?: string | null;
  summary?: string | null;
  retrievalQuery?: string | null;
  required?: boolean;
  baseMode?: ContextInclusionMode;
}

export interface ContextScoreComponents {
  stage: number;
  sourceType: number;
  knowledgeClass: number;
  trustLevel: number;
  recency: number;
  keywordOverlap: number;
  confidence: number;
  required: number;
}

export interface ContextScore {
  total: number;
  components: ContextScoreComponents;
  reasons: string[];
  keywordMatches: string[];
}

export interface ScoredContextCandidate {
  candidate: ContextCandidate;
  score: ContextScore;
}

export interface SelectedContextCandidate extends ScoredContextCandidate {
  section: ContextSection;
}

export interface SelectContextCandidatesInput {
  candidates: readonly ContextCandidate[];
  stage: WorkflowStage;
  taskBrief: string;
  budget: ContextPackBudget;
  referenceTime: string;
}

const APPROX_CHARS_PER_TOKEN = 4;
const SCORE_SELECTION_FLOOR = 20;

export function scoreContextCandidate(input: {
  candidate: ContextCandidate;
  stage: WorkflowStage;
  taskBrief: string;
  referenceTime: string;
}): ContextScore {
  const keywordMatches = keywordMatchesFor(input.taskBrief, input.candidate);
  const components: ContextScoreComponents = {
    stage: stageScore(input.stage, input.candidate),
    sourceType: sourceTypeScore(input.candidate.sourceType),
    knowledgeClass: knowledgeClassScore(input.candidate.knowledgeClass),
    trustLevel: trustLevelScore(input.candidate.trustLevel),
    recency: recencyScore(input.candidate, input.referenceTime),
    keywordOverlap: Math.min(keywordMatches.length, 8) * 4,
    confidence: Math.round(input.candidate.confidence * 10),
    required: input.candidate.required ? 100 : 0,
  };
  const reasons = [
    `stage=${components.stage}`,
    `sourceType=${input.candidate.sourceType}:${components.sourceType}`,
    `knowledgeClass=${input.candidate.knowledgeClass}:${components.knowledgeClass}`,
    `trustLevel=${input.candidate.trustLevel}:${components.trustLevel}`,
    `recency=${components.recency}`,
    `keywordOverlap=${keywordMatches.length}`,
    `confidence=${input.candidate.confidence}`,
  ];
  if (input.candidate.required) reasons.push('required=true');
  return {
    total: Object.values(components).reduce((sum, value) => sum + value, 0),
    components,
    reasons,
    keywordMatches,
  };
}

export function selectContextCandidates(
  input: SelectContextCandidatesInput,
): SelectedContextCandidate[] {
  const scored = input.candidates
    .map((candidate) => ({
      candidate,
      score: scoreContextCandidate({
        candidate,
        stage: input.stage,
        taskBrief: input.taskBrief,
        referenceTime: input.referenceTime,
      }),
    }))
    .filter((item) => item.candidate.required || item.score.total >= SCORE_SELECTION_FLOOR);

  const deduped = dedupeScoredCandidates(scored);
  const sorted = [...deduped].sort(compareScoredCandidates);
  const selected: SelectedContextCandidate[] = [];
  let remaining = contextTokenBudget(input.budget);

  for (const item of sorted) {
    const inclusion = chooseInclusion(item.candidate, remaining);
    remaining -= inclusion.estimatedTokens;
    selected.push({
      ...item,
      section: {
        id: item.candidate.id,
        title: item.candidate.title,
        content: inclusion.content,
        sourceRefs: uniqueStrings(item.candidate.sourceRefs),
        reason: reasonWithScore(item.candidate.reason, item.score),
        priority: item.candidate.priority,
        knowledgeClass: item.candidate.knowledgeClass,
        trustLevel: item.candidate.trustLevel,
        freshness: item.candidate.freshness,
        confidence: item.candidate.confidence,
        mode: inclusion.mode,
        sourceType: item.candidate.sourceType,
        score: item.score.total,
        selectionReasons: item.score.reasons,
        degradedFrom: inclusion.degradedFrom,
        degradationReason: inclusion.degradationReason,
      },
    });
  }

  return selected;
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / APPROX_CHARS_PER_TOKEN));
}

function chooseInclusion(
  candidate: ContextCandidate,
  remainingBudget: number,
): {
  mode: ContextInclusionMode;
  content: string;
  estimatedTokens: number;
  degradedFrom?: ContextInclusionMode;
  degradationReason?: string;
} {
  const baseMode = candidate.baseMode ?? 'full';
  const full = normalizeText(candidate.content) || retrievalHintContent(candidate);
  if (baseMode === 'metadata_only') {
    const content = full;
    return { mode: 'metadata_only', content, estimatedTokens: estimateTokens(content) };
  }
  if (baseMode === 'summary') {
    const summary = normalizeText(candidate.summary) || summarizeText(full);
    const summaryTokens = estimateTokens(summary);
    if (summaryTokens <= remainingBudget || candidate.required) {
      return { mode: 'summary', content: summary, estimatedTokens: summaryTokens };
    }
    const hint = retrievalHintContent(candidate);
    const hintTokens = estimateTokens(hint);
    return {
      mode: 'retrieval_hint',
      content: hint,
      estimatedTokens: hintTokens,
      degradedFrom: 'summary',
      degradationReason: `summary estimate ${summaryTokens} tokens exceeded remaining context budget ${remainingBudget}`,
    };
  }

  const fullTokens = estimateTokens(full);
  if (fullTokens <= remainingBudget || candidate.required) {
    return { mode: baseMode, content: full, estimatedTokens: fullTokens };
  }

  const summary = normalizeText(candidate.summary) || summarizeText(full);
  const summaryTokens = estimateTokens(summary);
  if (summaryTokens <= remainingBudget) {
    return {
      mode: 'summary',
      content: summary,
      estimatedTokens: summaryTokens,
      degradedFrom: baseMode,
      degradationReason: `full estimate ${fullTokens} tokens exceeded remaining context budget ${remainingBudget}`,
    };
  }

  const hint = retrievalHintContent(candidate);
  const hintTokens = estimateTokens(hint);
  return {
    mode: 'retrieval_hint',
    content: hint,
    estimatedTokens: hintTokens,
    degradedFrom: baseMode,
    degradationReason: `summary estimate ${summaryTokens} tokens exceeded remaining context budget ${remainingBudget}`,
  };
}

function contextTokenBudget(budget: ContextPackBudget): number {
  return Math.max(1, budget.maxTokens - budget.reservedForReasoning - budget.reservedForOutput);
}

function dedupeScoredCandidates(
  candidates: readonly ScoredContextCandidate[],
): ScoredContextCandidate[] {
  const byFingerprint = new Map<string, ScoredContextCandidate>();
  for (const item of candidates) {
    const key = candidateFingerprint(item.candidate);
    const existing = byFingerprint.get(key);
    if (!existing || compareScoredCandidates(item, existing) < 0) {
      byFingerprint.set(key, item);
    }
  }
  return [...byFingerprint.values()];
}

function candidateFingerprint(candidate: ContextCandidate): string {
  const normalizedContent = normalizeText(candidate.content).toLowerCase().replace(/\s+/g, ' ');
  if (normalizedContent) return `content:${normalizedContent}`;
  const refs = uniqueStrings(candidate.sourceRefs).sort().join('|');
  return `refs:${refs || candidate.id}`;
}

function compareScoredCandidates(a: ScoredContextCandidate, b: ScoredContextCandidate): number {
  return (
    compareNumberDesc(a.score.total, b.score.total)
    || compareNumberAsc(a.candidate.priority, b.candidate.priority)
    || compareNumberDesc(sourceTypeScore(a.candidate.sourceType), sourceTypeScore(b.candidate.sourceType))
    || compareStringDesc(a.candidate.createdAt ?? '', b.candidate.createdAt ?? '')
    || a.candidate.id.localeCompare(b.candidate.id)
  );
}

function compareNumberDesc(a: number, b: number): number {
  return b - a;
}

function compareNumberAsc(a: number, b: number): number {
  return a - b;
}

function compareStringDesc(a: string, b: string): number {
  return b.localeCompare(a);
}

function reasonWithScore(reason: string, score: ContextScore): string {
  const matches = score.keywordMatches.length > 0
    ? `; keywordMatches=${score.keywordMatches.join(',')}`
    : '';
  return `${reason} Scoring: ${score.reasons.join('; ')}; total=${score.total}${matches}.`;
}

function stageScore(stage: WorkflowStage, candidate: ContextCandidate): number {
  if (candidate.required) return 30;
  const id = candidate.id.toLowerCase();
  const refs = candidate.sourceRefs.join(' ').toLowerCase();
  const source = candidate.sourceType;
  const text = `${id} ${refs}`;

  switch (stage) {
    case 'context_pack':
      return source === 'project_profile' || source === 'knowledge_artifact' ? 20 : 8;
    case 'requirement':
      return source === 'project_profile' || source === 'knowledge_artifact' ? 18 : 10;
    case 'design':
      return text.includes('requirement') || source === 'knowledge_artifact' ? 24 : 12;
    case 'implementation':
      return includesAny(text, ['design', 'analysis', 'analyze', 'plan', 'refactor_plan', 'report'])
        ? 28
        : source === 'knowledge_artifact' ? 18 : 12;
    case 'build_test':
      return includesAny(text, ['diff', 'test', 'build', 'implementation']) ? 28 : 10;
    case 'review':
      return includesAny(text, ['diff', 'build', 'test', 'implementation', 'design', 'analysis']) ? 30 : 12;
    case 'completion':
    case 'knowledge':
      return source === 'run_artifact' ? 26 : 12;
    case 'report':
    case 'analyze':
      return source === 'task_brief' || source === 'project_profile' ? 20 : 12;
    case 'scan':
    case 'plan':
      return source === 'project_profile' || source === 'knowledge_artifact' ? 22 : 12;
    case 'init':
      return 0;
  }
}

function sourceTypeScore(sourceType: ContextSourceType): number {
  switch (sourceType) {
    case 'task_brief':
      return 30;
    case 'workflow_metadata':
      return 26;
    case 'run_artifact':
      return 24;
    case 'current_input':
      return 20;
    case 'knowledge_artifact':
      return 18;
    case 'project_profile':
      return 16;
  }
}

function knowledgeClassScore(knowledgeClass: KnowledgeClass): number {
  switch (knowledgeClass) {
    case 'confirmed':
      return 18;
    case 'seed':
      return 12;
    case 'recovered':
      return 8;
  }
}

function trustLevelScore(trustLevel: ContextTrustLevel): number {
  switch (trustLevel) {
    case 'source':
      return 18;
    case 'accepted_knowledge':
      return 16;
    case 'summary':
      return 8;
    case 'inference':
      return 2;
  }
}

function recencyScore(candidate: ContextCandidate, referenceTime: string): number {
  const freshness =
    candidate.freshness === 'current' ? 12
      : candidate.freshness === 'possibly_stale' ? 6
        : 0;
  const createdAtBonus = createdAtRecencyBonus(candidate.createdAt, referenceTime);
  return freshness + createdAtBonus;
}

function createdAtRecencyBonus(createdAt: string | null | undefined, referenceTime: string): number {
  if (!createdAt) return 0;
  const created = Date.parse(createdAt);
  const reference = Date.parse(referenceTime);
  if (!Number.isFinite(created) || !Number.isFinite(reference)) return 0;
  const ageDays = Math.max(0, (reference - created) / (1000 * 60 * 60 * 24));
  if (ageDays <= 7) return 8;
  if (ageDays <= 30) return 4;
  if (ageDays <= 365) return 1;
  return 0;
}

function keywordMatchesFor(taskBrief: string, candidate: ContextCandidate): string[] {
  const queryTokens = tokenize(taskBrief);
  if (queryTokens.length === 0) return [];
  const candidateTokens = new Set(tokenize([
    candidate.id,
    candidate.title,
    candidate.content,
    candidate.sourceRefs.join(' '),
  ].join(' ')));
  return uniqueStrings(queryTokens.filter((token) => candidateTokens.has(token))).sort();
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_#.-]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'this',
  'that',
  'from',
  'into',
  'must',
  'should',
  'would',
  'could',
  'about',
  'current',
  'context',
  'implement',
  'implementation',
]);

function includesAny(text: string, needles: readonly string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function summarizeText(text: string): string {
  const normalized = normalizeText(text);
  if (normalized.length <= 700) return normalized;
  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  let summary = '';
  for (const line of lines) {
    const next = summary ? `${summary}\n${line}` : line;
    if (next.length > 700) break;
    summary = next;
  }
  return `${(summary || normalized.slice(0, 680)).slice(0, 700)}\n…(summary truncated; retrieve source for full context)`;
}

function retrievalHintContent(candidate: ContextCandidate): string {
  const query = normalizeText(candidate.retrievalQuery);
  if (query) return query;
  const refs = uniqueStrings(candidate.sourceRefs).join(', ') || candidate.id;
  return `Retrieve ${candidate.title} from ${refs} if this fact is needed.`;
}

function normalizeText(text: string | null | undefined): string {
  return text?.trim() ?? '';
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
