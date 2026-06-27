# Coordinator Clarification Policy

## Scenario: Grill Me clarification routing

### 1. Scope / Trigger

- Trigger: changing Coordinator clarification behavior or runtime config keys under `coordinator.clarification_*`.
- Applies to Runner pre-run triage in `apps/runner/src/agents/coordinator/`.
- Applies to read-only `ask` routing only as a lightweight Grill Me gate when `coordinator.clarification_style === 'grill-me'`.

### 2. Signatures

- `triageRequest(input: TriageInput): Promise<CoordinatorDecision>`
- `classifyByLlm(input: ClassifyInput, opts?: ClassifyByLlmOptions): Promise<ClassifyOutput>`
- `coordinator.clarification_style`: `'default' | 'grill-me'`
- `coordinator.max_clarification_rounds`: number, inclusive range from the registry.

### 3. Contracts

- Rule classification can still run first for cheap routing evidence.
- If a rule result is `pause_for_human` and `coordinator.clarification_style === 'grill-me'`, the final user-visible clarification question must be produced through the LLM Grill Me path, not from rule fallback question arrays.
- If a rule result is `proceed/runType='ask'` and `coordinator.clarification_style === 'grill-me'`, route through the LLM Grill Me path before finalizing. The LLM may immediately return `proceed/runType='ask'` for simple answerable questions, or `pause_for_human` with one deepening question for ambiguous/high-risk questions.
- Grill Me clarification emits one question per turn. If the model returns multiple questions, truncate to the first question before persistence.
- The max-round cap counts existing `messageHistory` entries with `role === 'coordinator'`.
- Once `coordinator.max_clarification_rounds` is reached, no path may emit another `pause_for_human` question. Convert post-limit clarification attempts into a non-question terminal decision.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Rule says `pause_for_human`, style is `default` | Keep rule result; do not require LLM. |
| Rule says `pause_for_human`, style is `grill-me` | Call `classifyByLlm()` so Grill Me prompt controls the question. |
| Rule says `proceed/runType='ask'`, style is `default` | Keep rule result; direct ask routing remains cheap. |
| Rule says `proceed/runType='ask'`, style is `grill-me` | Call `classifyByLlm()` so Grill Me can proceed immediately or ask one follow-up. |
| LLM returns multiple questions in Grill Me mode | Persist only the first question. |
| Existing coordinator messages >= max rounds | Do not ask again; force convergence/terminal decision. |
| LLM unavailable before max rounds | Return configured unavailable fallback question. |
| LLM unavailable at/after max rounds | Do not ask fallback question; convert to terminal non-question decision. |

### 5. Good/Base/Bad Cases

- Good: `"权限"` with Grill Me enabled routes through `classifyByLlm()` and persists one deepening question.
- Good: `"怎么实现登录流程？"` with Grill Me enabled routes through `classifyByLlm()`; simple questions can still proceed as `runType='ask'`.
- Good: `"这个为什么不对？"` with Grill Me enabled can pause for one concrete follow-up question before answering.
- Base: `"权限"` with default style can use the existing rule fallback questions.
- Base: ask-like text with default style can use the existing rule `proceed/runType='ask'` result.
- Bad: large-scope rule fallback persists two decomposition questions while Grill Me is enabled.
- Bad: rule-detected ask bypasses Grill Me when the user configured Grill Me.
- Bad: max rounds already reached but an unavailable/invocation-failed fallback asks for more context.

### 6. Tests Required

- Entry-level `triageRequest()` tests for rule-originated `too_short` and `large_scope` clarification under Grill Me.
- Entry-level `triageRequest()` tests for rule-originated `ask` under Grill Me where the LLM proceeds as ask and where it asks one follow-up.
- Regression test that default style preserves rule fallback behavior.
- Max-round test where rule-originated clarification would ask again but is converted to a terminal non-question decision.
- LLM fallback tests for prompt selection, single-question truncation, and max-round hard stop.

### 7. Wrong vs Correct

#### Wrong

```typescript
if (ruleResult.confidence >= threshold) {
  return ruleResult;
}
```

This lets high-confidence rule pauses bypass Grill Me and max-round enforcement.

#### Correct

```typescript
if (
  ruleResult.confidence >= threshold &&
  !(clarificationStyle === 'grill-me' && ruleResult.decision.action === 'pause_for_human') &&
  !(clarificationStyle === 'grill-me' && ruleResult.decision.action === 'proceed' && ruleResult.decision.runType === 'ask')
) {
  return ruleResult;
}
```

Then apply a shared max-round policy to the selected final output before emitting or persisting it.

## Scenario: ask routing never creates WorkflowRun

### 1. Scope / Trigger

- Trigger: changing `runner watch` request polling, Coordinator `ask` routing, or `WorkflowRequest.kind` handling.
- Read-only Q&A requests are chat/request-channel work only. They must not enter the orchestrator, create a branch, or create a `WorkflowRun`.

### 2. Signatures

- `WorkflowRequest.kind: 'ask' | null` marks read-only Q&A requests.
- `WorkflowRequest.status: 'awaiting_clarification'` is the queue-skipping status used by ask requests.
- `processNextWorkflowRequest(deps)` must skip pending rows whose `kind === 'ask'`.
- `defaultTriage(req)` must convert `proceed/runType='ask'` into `{ action: 'paused' }` after setting request status to `awaiting_clarification`.
- `cmdWatch().listPending` must filter `api.listWorkflowRequests({ status: 'pending' }).items` with `request.kind !== 'ask'`.

### 3. Contracts

- Ask requests may still have Coordinator decisions and request-channel stream events, but they have no run-channel events because no run exists.
- A malformed or legacy pending ask row must not block later normal pending requests; the watch loop should choose the first non-ask item.
- A normal pending request that the Coordinator classifies as `runType='ask'` must stop before `claim()` and `orchestrate()`.
- Do not rely only on `status !== 'pending'`; keep the explicit `kind !== 'ask'` guard as defense in depth.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Pending list contains `{ kind: 'ask' }` followed by normal work | Skip ask row and process the normal request. |
| Pending list contains only ask rows | Return `idle`; do not claim or orchestrate. |
| Coordinator returns `proceed/runType='ask'` for a normal pending request | Set request status to `awaiting_clarification`, return `paused`, and do not create a WorkflowRun. |
| Ask request somehow reaches `cmdOrchestrate` | Treat as a bug; add a watch/defaultTriage guard rather than adding an ask flow to `FLOW_REGISTRY`. |

### 5. Good/Base/Bad Cases

- Good: `kind='ask'` request stays on the request chat/stream channel and never appears as a run.
- Base: normal feature/bugfix/refactor requests still pass through claim + orchestrate unchanged.
- Bad: coercing `runType='ask'` to `feature` and creating a feature.standard run; this reintroduces the misleading stage board.
- Bad: adding `ask.standard` to `FLOW_REGISTRY`; ask is not a workflow pipeline.

### 6. Tests Required

- `apps/runner/test/watch.test.ts` should cover pending ask rows being skipped without blocking normal work.
- `apps/runner/test/watch.test.ts` should cover `triage.runType === 'ask'` returning `paused` without `claim()`, `orchestrate()`, or `complete()`.
- Coordinator tests should continue to cover rule/LLM ask classification separately; watch tests own queue isolation.

### 7. Wrong vs Correct

#### Wrong

```typescript
const [next] = await deps.listPending();
// Later: opts.runType === 'ask' ? 'feature' : opts.runType
```

#### Correct

```typescript
const next = (await deps.listPending()).find((request) => request.kind !== 'ask');
if (!next) return 'idle';
if (triage.runType === 'ask') return 'paused';
```
