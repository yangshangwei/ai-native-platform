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
