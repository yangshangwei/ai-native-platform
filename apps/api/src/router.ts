import type {
  ArtifactId,
  FlowId,
  RouterInput,
  RouterRecommendation,
  WorkflowStage,
} from '@ainp/shared';
import { FLOW_REGISTRY } from '@ainp/shared';
import { store } from './store/store';

// ---------------------------------------------------------------------------
// V2 W2-4 / PR1 — Smart Router (rules-only V1).
//
// Pure function `recommend(input)` returning a RouterRecommendation.
// Server-side; consumes `store.knowledgeArtifacts.byProject(...)` directly
// (no DB round-trip vs runner-side router which would need HTTP fetches).
//
// Decision rules (W2-4 PRD R10-R13):
//   R10 flowId: priority-ordered short-circuit on Coordinator's runType:
//     - bugfix → issue.standard
//     - refactor → refactor.standard
//     - smoke → feature.standard (don't fastforward smokes)
//     - feature + small-change signal (short title or keyword) → feature.fastforward
//     - feature default → feature.standard
//   R11 startStage: only feature.standard supports skip; rules:
//     - matching accepted DSN-### → 'implementation'
//     - matching accepted REQ-### (no DSN) → 'design'
//     - else → null (start from head)
//   R12 relevantKnowledge: top-5 accepted KnowledgeArtifact ids by keyword overlap
//   R13 estimates: per-stage static (agent: 90s/8K tokens, engine: 30s/0)
//
// Called by `createWorkflowRun()` when body.flowId is missing for audit/preview
// parity, but conservative run creation does not silently apply skip
// recommendations. Also exposed via `POST /router/recommend` for UI dry-run.
// User-supplied flowId always wins (W2-1 ADR Q3 contract preserved).
//
// Non-goals (Wave 3 follow-up):
//   - LLM fallback (V1 rules-only per Wave 2 roadmap)
//   - History-based learning ("same shape of request used flow X before")
//   - Estimate calibration from past runs
//
// References:
//   - W2-4 PRD: `.trellis/tasks/05-05-v2-w2-4-smart-router/prd.md`
//   - Spec: `.trellis/spec/api/backend/smart-router.md`
//   - V2 design notes § 3.2 (Routing over Prescribing)
// ---------------------------------------------------------------------------

const STAGE_AGENT_TIME_SEC = 90;
const STAGE_AGENT_TOKENS = 8000;
const STAGE_ENGINE_TIME_SEC = 30;
const STAGE_ENGINE_TOKENS = 0;

const SMALL_CHANGE_KEYWORDS: readonly string[] = [
  'typo',
  'rename',
  '改个',
  '小修',
  'fix typo',
  'simple',
  '一行',
  'one-line',
  '微调',
];

const KNOWLEDGE_LIMIT = 5;
const MIN_KEYWORD_LEN = 4;

export function recommend(input: RouterInput): RouterRecommendation {
  const rulesFired: string[] = [];
  const flowId = recommendFlowId(input, rulesFired);
  const startStage = recommendStartStage(input, flowId, rulesFired);
  const relevantKnowledge = recommendKnowledge(input);
  const estimates = computeEstimates(flowId, startStage);

  return {
    flowId,
    startStage,
    relevantKnowledge,
    estimates,
    reason: rulesFired.join(' / '),
    rulesFired,
    confidence: 1.0, // V1 deterministic rules
  };
}

function recommendFlowId(input: RouterInput, rulesFired: string[]): FlowId {
  if (input.runType === 'bugfix') {
    rulesFired.push('flow.bugfix_to_issue_standard');
    return 'issue.standard';
  }
  if (input.runType === 'refactor') {
    rulesFired.push('flow.refactor_to_refactor_standard');
    return 'refactor.standard';
  }
  if (input.runType === 'smoke') {
    rulesFired.push('flow.smoke_to_feature_standard');
    return 'feature.standard';
  }
  // runType === 'feature'
  const titleLower = input.title.toLowerCase();
  const isShort = input.title.length < 60;
  const hasSmallKw = SMALL_CHANGE_KEYWORDS.some((kw) => titleLower.includes(kw.toLowerCase()));
  if (isShort || hasSmallKw) {
    rulesFired.push(
      hasSmallKw ? 'flow.feature_small_keyword_to_fastforward' : 'flow.feature_short_to_fastforward',
    );
    return 'feature.fastforward';
  }
  rulesFired.push('flow.feature_default_standard');
  return 'feature.standard';
}

function recommendStartStage(
  input: RouterInput,
  flowId: FlowId,
  rulesFired: string[],
): WorkflowStage | null {
  // Only feature.standard supports prefix skip — other flows are short
  // and run head-to-tail.
  if (flowId !== 'feature.standard') {
    rulesFired.push('startStage.short_flow_no_skip');
    return null;
  }

  const accepted = store.knowledgeArtifacts
    .byProject(input.projectId)
    .filter((a) => a.status === 'accepted');

  if (matchesAnyKnowledge(input.title, accepted, 'design')) {
    rulesFired.push('startStage.has_accepted_design');
    return 'implementation';
  }

  if (matchesAnyKnowledge(input.title, accepted, 'requirement')) {
    rulesFired.push('startStage.has_accepted_requirement');
    return 'design';
  }

  rulesFired.push('startStage.no_skip');
  return null;
}

function recommendKnowledge(input: RouterInput): ArtifactId[] {
  const accepted = store.knowledgeArtifacts
    .byProject(input.projectId)
    .filter((a) => a.status === 'accepted');

  const titleWords = extractKeywords(input.title);
  if (titleWords.length === 0) return [];

  const scored = accepted.map((a) => {
    const haystack = `${a.entityId ?? ''} ${JSON.stringify(a.metadata ?? {})}`.toLowerCase();
    const score = titleWords.filter((w) => haystack.includes(w)).length;
    return { id: a.id, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored
    .filter((s) => s.score > 0)
    .slice(0, KNOWLEDGE_LIMIT)
    .map((s) => s.id);
}

function computeEstimates(
  flowId: FlowId,
  startStage: WorkflowStage | null,
): { timeSec: number; tokens: number } {
  const flow = FLOW_REGISTRY[flowId];
  let stages = flow.stages;
  if (startStage) {
    const idx = stages.findIndex((s) => s.stage === startStage);
    if (idx >= 0) stages = stages.slice(idx);
  }
  let timeSec = 0;
  let tokens = 0;
  for (const step of stages) {
    if (step.kind === 'agent') {
      timeSec += STAGE_AGENT_TIME_SEC;
      tokens += STAGE_AGENT_TOKENS;
    } else {
      // engine / gate / human all costed as light engine work for V1.
      timeSec += STAGE_ENGINE_TIME_SEC;
      tokens += STAGE_ENGINE_TOKENS;
    }
  }
  return { timeSec, tokens };
}

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s\-_/.,;:!?()\[\]{}'"`]+/)
    .filter((w) => w.length >= MIN_KEYWORD_LEN);
}

function matchesAnyKnowledge(
  title: string,
  accepted: ReturnType<typeof store.knowledgeArtifacts.byProject>,
  kind: 'design' | 'requirement',
): boolean {
  const words = extractKeywords(title);
  if (words.length === 0) return false;
  return accepted.some((a) => {
    if (a.kind !== kind) return false;
    const haystack = `${a.entityId ?? ''} ${JSON.stringify(a.metadata ?? {})}`.toLowerCase();
    return words.some((w) => haystack.includes(w));
  });
}
