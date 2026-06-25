# Coordinator Clarification Policy

## Scenario: Grill Me clarification routing

### 1. Scope / Trigger

- Trigger: changing Coordinator clarification behavior or runtime config keys under `coordinator.clarification_*`.
- Applies to Runner pre-run triage in `apps/runner/src/agents/coordinator/`.
- Does not apply to read-only `ask` requests that are already routed as Q&A instead of workflow clarification.

### 2. Signatures

- `triageRequest(input: TriageInput): Promise<CoordinatorDecision>`
- `classifyByLlm(input: ClassifyInput, opts?: ClassifyByLlmOptions): Promise<ClassifyOutput>`
- `coordinator.clarification_style`: `'default' | 'grill-me'`
- `coordinator.max_clarification_rounds`: number, inclusive range from the registry.

### 3. Contracts

- Rule classification can still run first for cheap routing evidence.
- If a rule result is `pause_for_human` and `coordinator.clarification_style === 'grill-me'`, the final user-visible clarification question must be produced through the LLM Grill Me path, not from rule fallback question arrays.
- Grill Me clarification emits one question per turn. If the model returns multiple questions, truncate to the first question before persistence.
- The max-round cap counts existing `messageHistory` entries with `role === 'coordinator'`.
- Once `coordinator.max_clarification_rounds` is reached, no path may emit another `pause_for_human` question. Convert post-limit clarification attempts into a non-question terminal decision.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Rule says `pause_for_human`, style is `default` | Keep rule result; do not require LLM. |
| Rule says `pause_for_human`, style is `grill-me` | Call `classifyByLlm()` so Grill Me prompt controls the question. |
| LLM returns multiple questions in Grill Me mode | Persist only the first question. |
| Existing coordinator messages >= max rounds | Do not ask again; force convergence/terminal decision. |
| LLM unavailable before max rounds | Return configured unavailable fallback question. |
| LLM unavailable at/after max rounds | Do not ask fallback question; convert to terminal non-question decision. |

### 5. Good/Base/Bad Cases

- Good: `"权限"` with Grill Me enabled routes through `classifyByLlm()` and persists one deepening question.
- Base: `"权限"` with default style can use the existing rule fallback questions.
- Bad: large-scope rule fallback persists two decomposition questions while Grill Me is enabled.
- Bad: max rounds already reached but an unavailable/invocation-failed fallback asks for more context.

### 6. Tests Required

- Entry-level `triageRequest()` tests for rule-originated `too_short` and `large_scope` clarification under Grill Me.
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
  !(clarificationStyle === 'grill-me' && ruleResult.decision.action === 'pause_for_human')
) {
  return ruleResult;
}
```

Then apply a shared max-round policy to the selected final output before emitting or persisting it.
