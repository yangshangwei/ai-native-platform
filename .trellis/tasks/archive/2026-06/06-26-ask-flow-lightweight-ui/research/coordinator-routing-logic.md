# Research: Coordinator Routing Logic

- **Query**: How does the coordinator determine routeCase "ask" vs "dev" vs "fix" and what happens downstream
- **Scope**: internal
- **Date**: 2026-06-26

## Findings

### 1. Coordinator Entry Point — Triage Pipeline

| File Path | Description |
|---|---|
| `apps/runner/src/agents/coordinator/index.ts` | Entry point: `triageRequest()` — rules first, LLM fallback if confidence < threshold |
| `apps/runner/src/agents/coordinator/rules.ts` | Async wrapper resolving config, delegates to shared core |
| `packages/shared/src/coordinator/rules-core.ts` | Pure rule-based classifier: `classifyByRulesCore()` |
| `apps/runner/src/agents/coordinator/llm-fallback.ts` | LLM-backed fallback (Claude Code / Codex CLI one-shot) |
| `apps/runner/src/agents/coordinator/decision.ts` | JSON parsing of LLM output into `CoordinatorAction` |
| `apps/runner/src/agents/coordinator/clarification-policy.ts` | Max-round enforcement for clarification loops |
| `apps/runner/src/agents/coordinator/prompt.ts` | Builds user prompt for LLM fallback |

### 2. RouteCase / RunType Determination

**Type definitions** (`packages/shared/src/types/coordinator.ts`):

```typescript
export type RouteCase =
  | 'feature_clear'
  | 'feature_brainstorm'
  | 'roadmap_needed'
  | 'bugfix'
  | 'refactor_clear'
  | 'ask'
  | 'unclear';

export type CoordinatorAction =
  | { action: 'proceed'; routeCase: RouteCase; runType: 'feature' | 'bugfix' | 'smoke' | 'refactor' | 'ask'; reason: string }
  | { action: 'pause_for_human'; questions: string[]; reason: string }
  | { action: 'abort'; reason: string };
```

**Rule-based classification** (`packages/shared/src/coordinator/rules-core.ts:72-186`):

Decision rules (order matters):
1. **Too short** (< 6 chars) -> `pause_for_human` (rule.too_short)
2. **Large scope** (keywords OR regex, length > 8) -> `pause_for_human` (rule.large_scope_detected)
3. **Ask** (ask keywords OR question mark OR question word, length > 6) -> `proceed` with routeCase='ask', runType='ask' (rule.ask_question_detected)
4. **Refactor** (refactor keywords, length > 8) -> `proceed` with routeCase='refactor_clear', runType='refactor'
5. **Bug dominant** (bug count - feature count >= 2) -> `proceed` with routeCase='bugfix', runType='bugfix'
6. **Feature dominant** (feature count - bug count >= 2, length > 20) -> `proceed` with routeCase='feature_clear', runType='feature'
7. **Ambiguous** fallthrough -> `proceed` with routeCase='feature_clear', runType='feature', confidence=0.4 (triggers LLM fallback)

**Ask detection specifics** (rules-core.ts:115-129):
```typescript
const hasQuestionMark = /[?？]/.test(text);
const hasQuestionWord = /^(为什么|怎么|如何|在哪|是不是|能不能|可以|解释|告诉我|查一下|what|why|how|where|when|can|could|is it|explain|tell me)/i.test(text);

if ((ask.count >= 1 || hasQuestionMark || hasQuestionWord) && text.length > 6) {
  // -> proceed, routeCase='ask', runType='ask'
}
```

Ask keywords are defined in `packages/shared/src/config/defaults.ts:83-107` and include Chinese + English question words.

**LLM fallback** (`decision.ts:62-71`):
```typescript
const KNOWN_ROUTE_CASES = new Set(['feature_clear', 'feature_brainstorm', 'roadmap_needed', 'bugfix', 'refactor_clear', 'ask', 'unclear']);
const KNOWN_RUN_TYPES = new Set(['feature', 'bugfix', 'smoke', 'refactor', 'ask']);
```
LLM output is parsed and normalized to these known sets; unknown values default to 'feature_clear' / 'feature'.

### 3. Triage Flow — triageRequest() in index.ts

```
triageRequest(input) {
  1. classifyByRules(input) -> ruleResult
  2. Read threshold, clarificationStyle, maxClarificationRounds from config
  3. IF ruleResult.confidence >= threshold AND no grill-me override needed:
       -> use ruleResult (source='rules')
     ELSE:
       -> classifyByLlm(input) -> llmResult
       -> IF llmResult failed transiently AND ruleResult was 'proceed':
            -> fall back to ruleResult (degraded fallback)
       -> ELSE: use llmResult (source='llm')
  4. enforceMaxClarificationRounds() on final output
  5. Return CoordinatorDecision
}
```

### 4. What Happens After Routing — Watch Loop

| File Path | Description |
|---|---|
| `apps/runner/src/cmd/watch.ts` | Watch daemon: polls pending requests, triages, orchestrates |

**Key flow** (`watch.ts:60-107`):

```
processNextWorkflowRequest() {
  1. listPending() -> [next request]
  2. IF next.flowId set (user pinned it):
       -> skip Coordinator, derive runType from FlowDef.kind
     ELSE:
       -> triage(next) -> TriageOutcome
       -> IF paused: return 'paused' (request goes to awaiting_clarification)
       -> IF aborted: return 'aborted' (request cancelled)
       -> runType = triage.runType
  3. claim(next.id) -> claimedRequest
  4. orchestrate(claimed, runType, agentTaskBrief)
}
```

**defaultTriage** (`watch.ts:150-204`):
- Pulls chat messages for the request
- Calls `triageRequest()` with full message history
- On `proceed`: returns `{ action: 'proceed', runType: decision.decision.runType }`
- On `pause_for_human`: posts questions to chat thread, flips status to 'awaiting_clarification'
- On `abort`: sets status to 'cancelled'

### 5. Ask Flow — Lightweight Path (06-25 implementation)

The "ask" flow is a **chat-only, no-orchestration path**. Key behavior:

**Creation** (`apps/api/src/workflow-engine.ts:165-175`):
```typescript
status: params.kind === 'ask' ? 'awaiting_clarification' : 'pending',
```
When `kind='ask'`, the request starts as `awaiting_clarification` rather than `pending`. This means the runner watch loop **never picks it up** (it only polls for status='pending').

**Orchestrator guard** (`apps/runner/src/orchestrator.ts:109-112`):
```typescript
// 06-25 ask-flow: 'ask' requests never reach orchestrator (they have
// status='awaiting_clarification', not 'pending'), but TypeScript doesn't
// know that. Filter out 'ask' to satisfy createWorkflowRun's type constraint.
const executableRunType = opts.runType === 'ask' ? 'feature' : (opts.runType ?? 'feature');
```

**API filtering** (`apps/api/src/routes/workflow-requests.ts:47-48`):
```typescript
// 06-25 ask-flow: exclude kind='ask' from task list (R2 filtering requirement)
const filtered = items.filter(r => r.kind !== 'ask');
```

**Frontend filtering** (`apps/web/src/data-loading.ts:87-88`):
```typescript
// 06-25 ask-flow: API already filters kind='ask', but defense-in-depth filter here too
data.requests = requests.filter(r => r.kind !== 'ask');
```

**Frontend creation** (`apps/web/src/page-new-task.ts:731-732`):
```typescript
// 06-25 ask-flow: when user selects 'ask' type, set kind='ask'
...(typeOverride === 'ask' && { kind: 'ask' as const }),
```

### 6. Run Metadata Persistence

**CoordinatorDecision** is persisted via:
```typescript
await api.persistCoordinatorDecision(decision);  // watch.ts:176
```

The decision includes: `id`, `workflowRequestId`, `workflowRunId` (null at decision time), `source`, `decision` (action/routeCase/runType/reason), `confidence`, `rulesFired`, `decidedAt`.

**WorkflowRequest** carries:
- `kind: 'ask' | null` — discriminator for read-only Q&A
- `type: WorkflowRunType` — the run type
- `status` — flipped based on routing outcome

**Stream events** emitted to frontend (`llm-fallback.ts:154-170`):
```typescript
await emitMeta(emit, 'decided', {
  action: decision.action,
  confidence,
  rulesFired,
  source,
  routeCase: decision.action === 'proceed' ? decision.routeCase : null,
  runType: decision.action === 'proceed' ? decision.runType : null,
});
```

### 7. Flow Registry (No Ask Flow)

There is **no flow in FLOW_REGISTRY for 'ask'** (`packages/shared/src/flows/registry.ts`). The registry has:
- `feature.standard` (kind: 'feature')
- `feature.fastforward` (kind: 'feature')
- `issue.standard` (kind: 'bugfix')
- `refactor.standard` (kind: 'refactor')

The ask path intentionally bypasses the orchestrator entirely — it's pure chat.

### 8. Frontend UI for Ask Flow

**Preview hint** (`apps/web/src/page-new-task.ts:446-454`):
```typescript
if (coordPreview.predictedRunType === 'ask') {
  children.push(el('p', {
    class: 'muted compact',
    text: '📖 问答模式：不开分支、不改文件，只回答问题。',
  }));
}
```

**Type dropdown** includes 'ask' as a selectable option (`page-new-task.ts:236`).

**Coordinator preview display** (`page-new-task.ts:426-428`):
```typescript
coordPreview.predictedRunType === 'ask'
  ? `AI 判定: 问答 · 置信 ${confPct}%`
  : `AI 判定: ${coordPreview.predictedRunType} · 置信 ${confPct}%`
```

## Summary: Ask Flow Data Path

```
User types question in New Task form
  -> /coordinator/preview (dry-run) -> predictedRunType='ask', UI shows hint
  -> User submits
  -> POST /workflow-requests with kind='ask'
  -> WorkflowRequest created with status='awaiting_clarification' (NOT 'pending')
  -> Runner watch loop ignores it (only polls status='pending')
  -> Request stays in chat-only mode (no branch, no code changes)
  -> Excluded from task list in API + frontend (kind='ask' filtered)
```

## Caveats / Not Found

- There is NO dedicated backend handling for "answering" the ask question (the 06-25 implementation only routes/filters; the actual Q&A answer generation is not yet implemented in the codebase).
- The `WorkflowRequest.kind` field is the sole discriminator between ask and normal tasks; `runType` alone is insufficient since the orchestrator guard coerces 'ask' to 'feature'.
- The `FLOW_REGISTRY` has no ask-specific flow definition — the design intent is that ask never reaches the orchestrator at all.
