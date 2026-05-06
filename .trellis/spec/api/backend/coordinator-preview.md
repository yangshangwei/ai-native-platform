# Coordinator Preview (V1)

## Scenario: rule-based runType prediction + UI hint for new-task form

### 1. Scope / Trigger

- Trigger: changes to `apps/api/src/routes/coordinator.ts` (the `POST /coordinator/preview` endpoint), or `packages/shared/src/coordinator/rules-core.ts` (`classifyByRulesCore` / `deriveHint` / `ClassifyHint`).
- Adding a new runType signal (refactor was added 2026-05-06): both the runner-side `classifyByRules` (thin wrapper in `apps/runner/src/agents/coordinator/rules.ts`) and the API preview endpoint pick it up automatically because they both delegate to the shared core.
- Schema change touching `CoordinatorAction.runType` or `RouteCase`: rebuild this spec section + flow-registry / smart-router specs.

### 2. Signatures

- `ClassifyCoreInput` (`@ainp/shared`) — `{ userRequest, bugKeywords, featureKeywords, refactorKeywords, largeScopeKeywords, largeScopeRegex, fallbackTooShortQuestions, fallbackLargeScopeTemplate, fallbackLargeScopeFollowup }`. All keyword / regex / fallback values come in as parameters; **the core does no IO** (no `getConfig`, no `process.env`).
- `ClassifyCoreOutput` (`@ainp/shared`) — `{ decision: CoordinatorAction, confidence: number (0..1), rulesFired: string[] }`.
- `classifyByRulesCore(input: ClassifyCoreInput): ClassifyCoreOutput` — pure deterministic rule classifier.
- `deriveHint(rulesFired: string[]): 'too_short' | 'large_scope' | null` — UI helper that distills the rule list into a single yellow-callout signal.
- `POST /coordinator/preview` body `{ title: string }` → 200 with `{ predictedRunType, confidence, rulesFired, hint }`. Read-only endpoint; no DB writes; no LLM call; zero token cost.

### 3. Contracts

#### Decision rules (rules-only — no LLM at the preview layer)

Identical to the runner-side coordinator's rule fast-path. Order matters:

1. **`rule.too_short`** — `userRequest.trim().length < 6` → `pause_for_human`. `predictedRunType = null`. `hint = 'too_short'`.
2. **`rule.large_scope_detected`** — large-scope keyword hit OR `(\S+?\s*系统|\S+?\s*体系)` regex hit, AND text length > 8 → `pause_for_human`. `predictedRunType = null`. `hint = 'large_scope'`.
3. **`rule.refactor_keywords_dominant`** *(2026-05-06 added)* — `refactor.count >= 1 && length > 8` → `proceed/refactor`. `predictedRunType = 'refactor'`. **MUST precede** the bug-vs-feature ratio because refactor verbs (`重构`, `优化`, `refactor`, `extract`, ...) are neither bug nor feature, and would otherwise fall through to the ambiguous default.
4. **`rule.bug_keywords_dominant`** — `bug.count - feature.count >= 2` → `proceed/bugfix`.
5. **`rule.feature_keywords_dominant`** — `feature.count - bug.count >= 2 && length > 20` → `proceed/feature`.
6. **`rule.ambiguous`** (default) — confidence 0.4 → `proceed/feature`. The runner-side `triageRequest` will trigger LLM fallback (preview never does — preview is rules-only by design).

#### Confidence

- `too_short`: 0.85 (high — rule is unambiguous)
- `large_scope`: 0.75
- `refactor`: `min(0.9, 0.6 + count * 0.08)`
- `bugfix`: `min(0.95, 0.6 + count * 0.08)`
- `feature_clear`: `min(0.9, 0.55 + count * 0.08)`
- `ambiguous`: 0.4

The UI renders confidence as a percentage. The runner-side threshold (`coordinator.confidence_threshold`, default 0.65) decides whether to skip LLM fallback — the preview endpoint **never** crosses that threshold to call the LLM, so end users always see rules-only verdicts here.

#### Response shape

```ts
{
  predictedRunType: 'feature' | 'bugfix' | 'smoke' | 'refactor' | null,
  // null when decision.action !== 'proceed' (too_short / large_scope cases)
  confidence: number,        // 0..1
  rulesFired: string[],      // each id matches /^rule\./
  hint: 'too_short' | 'large_scope' | null,
}
```

#### Smart Router boundary

Coordinator and Smart Router are independent. The new-task UI calls them sequentially:

```text
POST /coordinator/preview { title }
  → predictedRunType
POST /router/recommend { projectId, title, runType: predictedRunType ?? 'feature' }
  → flowId + startStage + estimates
```

When the user manually overrides `Type` in the new-task form's "advanced" disclosure, the UI **skips** `/coordinator/preview` and feeds the override directly into `/router/recommend`. This matches the server-side override semantics: explicit user choice wins over AI judgment.

### 4. MVP limitations

- **Override resolution is NOT applied at the preview layer.** Keyword / regex / fallback values come from `CONFIG_REGISTRY.default` (compile-time constants). Runtime overrides written via `PUT /config/overrides/*` only affect the runner-side `triageRequest`. When overrides are present, preview may diverge from the actual coordinator decision.
  - Acceptable for MVP because most projects never write overrides; the runner remains correct.
  - Follow-up: have `/coordinator/preview` consult `store.config.overrides` (or call the same `getConfig`-like resolver) before delegating to the core. Out of scope for the 2026-05-06 task.
- **No LLM fallback.** Preview is rules-only by design — invoking the LLM here would burn tokens on every keystroke debounce.
- **Stateless.** No caching; the UI side does its own debounce + cache key.

### 5. Test coverage

- `apps/api/test/coordinator-preview.test.ts` — endpoint behavior (8 cases: too_short / large_scope / bugfix / feature / refactor zh+en / 400 missing-title / 400 empty-title).
- `apps/runner/test/coordinator-rules.test.ts` — runner wrapper still passes existing 7 cases plus 4 new refactor cases. Verifies the wrapper-to-core delegation.

### 6. Why it lives in `apps/api/`

The runner-side `triageRequest` (in `apps/runner/src/agents/coordinator/index.ts`) is invoked **after** Runner watch claims a WorkflowRequest — too late for the new-task UI to show pre-submit hints. By exposing the rule fast-path as an HTTP endpoint on the API side (which the runner does NOT depend on), the UI can preview without round-tripping through the runner queue. Both sides delegate to the same shared core (`packages/shared/src/coordinator/rules-core.ts`), so the algorithm stays identical.
