# Fix Note: requirement-analysis stage design–impl gaps

**Task**: `.trellis/tasks/05-04-fix-requirement-analysis-stage-design-impl-gaps`
**Closed**: 2026-05-04
**ADR-lite decisions**: Q1=A · Q2=A · Q3=A (see `prd.md` §Decision)

## Scope landed

| PRD § | Gap | Resolution |
|---|---|---|
| **P0-1** | Coordinator LLM fallback only supported Claude Code | `apps/runner/src/agents/coordinator/llm-fallback.ts` rewritten with `LlmFallbackDeps` injection seam + codex one-shot using `--output-last-message`; `selectionOrder()` orders backends by project preference, falls back to the other CLI when the preferred one is unavailable, and degrades to `pause_for_human` only when both are unavailable. Threaded through `triageRequest` (`agents/coordinator/index.ts`) and `defaultTriage` in `cmd/watch.ts`. |
| **P0-2** | New-task form did `POST /workflow-requests` then `POST /messages` (race) | `POST /workflow-requests` body now accepts optional `firstMessage`. `apps/api/src/workflow-engine.ts` `createWorkflowRequest` writes both inside `db.transaction(...)`. `apps/web/src/main.ts` `submitWorkflowRequest` is now a single call. |
| **P0-3** | Coordinator triage could see `req.title` instead of the real first message | Same atomic write as P0-2 + `defaultTriage` reads `project.agentBackend` so the LLM fallback runs the user-preferred CLI. |
| **P1-4** | `requirement-workflow.md` flow diagram missed the Coordinator stage | Diagram updated; new chapter `## 对话分诊与 awaiting_clarification` describes the 4 routing cases, the chat-thread UX, and the LLM-fallback CLI-selection rules. |
| **P1-5** | Form `type` (feature/bugfix) was silently overridden by Coordinator | `apps/web/src/main.ts` adds `renderCoordinatorVerdictMetric(...)` rendered next to the existing Project metric. The user mark stays visible on the Project metric (`用户标记: feature`), and the Coordinator's runType is shown alongside; mismatch triggers `warn` kind. |
| **P1-7** | `PATCH /workflow-requests/:id/status` accepted any enum value | `apps/api/src/routes/workflow-request-chat.ts` adds `ALLOWED_TRANSITIONS` whitelist; illegal transitions (e.g. `completed → pending`, `cancelled → pending`) return 409 with `illegal status transition: <from> -> <to>`. Same-state writes are no-ops. |

## Files changed

### apps/api
- `src/workflow-engine.ts` — `createWorkflowRequest` accepts `firstMessage`; transactional write via `db.transaction`
- `src/routes/workflow-requests.ts` — POST validates `firstMessage` shape (role + non-empty content) **before** any DB write so atomicity holds
- `src/routes/workflow-request-chat.ts` — `ALLOWED_TRANSITIONS` map + 409 on illegal status transition
- `test/workflow-request-routes.test.ts` — 4 new cases (firstMessage round-trip, backward-compat, atomicity, role validation)
- `test/workflow-request-chat.test.ts` — 5 new cases for status whitelist (rejects `completed → pending` / `cancelled → pending`, accepts `pending → awaiting_clarification → pending`, same-state no-op, 404)

### apps/runner
- `src/agents/coordinator/llm-fallback.ts` — full rewrite: `LlmFallbackDeps` seam, `LlmBackendKind`, `selectionOrder`, codex one-shot, refactored shared spawn helper
- `src/agents/coordinator/index.ts` — `TriageInput.preferredBackend` forwarded to `classifyByLlm`
- `src/cmd/watch.ts` — `defaultTriage` looks up `project.agentBackend`, threads it as `preferredBackend` (best-effort: project-lookup failure is non-fatal)
- `test/coordinator-llm-fallback.test.ts` (new) — 9 cases covering backend-availability × `preferredBackend` combinations + invocation_failed degradation + JSON parse for both transport shapes

### apps/web
- `src/main.ts` — single-call submit (drops the second `POST /messages`); new `renderCoordinatorVerdictMetric(...)`; user-mark relabeled in Project metric

### docs
- `docs/user/requirement-workflow.md` — flow diagram updated; new chapter `## 对话分诊与 awaiting_clarification`
- `docs/2026-05-03-requirements-phase-adaptation-plan.md` — appended `## Closure (2026-05-04)` table mapping each PRD gap to its landing

## Verification

- `bun test` → **221 pass / 0 fail across 40 files** (final run)
- `bun run typecheck` → **PASS** for `packages/shared`, `apps/api`, `apps/runner`, `apps/web`
- New tests verify: atomic firstMessage write, atomicity-on-failure, status whitelist (3 illegal + 2 legal + same-state no-op + 404), LLM backend selection across 9 scenarios.

## Acceptance Criteria status

| AC | Status | Evidence |
|---|---|---|
| AC-1 (codex + claude both supported, project preference) | ✅ | `apps/runner/test/coordinator-llm-fallback.test.ts` covers all 4 combinations |
| AC-2 (single-call POST + atomic insert) | ✅ | `apps/api/test/workflow-request-routes.test.ts` "atomically inserts request + message" |
| AC-3 (Coordinator always sees first user message, never `title` fallback) | ✅ | Atomic write guarantees the message exists before the runner can ever observe `pending` |
| AC-4 (flow diagram + awaiting_clarification chapter) | ✅ | `docs/user/requirement-workflow.md` |
| AC-5 (dual-badge in task detail) | ✅ | `apps/web/src/main.ts` `renderCoordinatorVerdictMetric` |
| AC-6 (status whitelist, illegal transitions rejected) | ✅ | `apps/api/test/workflow-request-chat.test.ts` (3 illegal + 2 legal) |
| AC-7 (`bun test && bun run typecheck` green; existing e2e not regressed) | ✅ | 221/221 + 4 typechecks PASS; no existing test was modified except to seed pending-state under the new whitelist |

## Out of scope (per PRD)

- No `skill.implementation` / `skill.review` cs-* injection (P1+)
- No hook / `requiredGates` / `inputs/outputs` runtime-config layer (PR3+)
- No Tool-Policy sandbox enforcement (project memory directive)

## Notes for reviewers

- **Backward compat**: `POST /workflow-requests` without `firstMessage` is byte-for-byte identical to the pre-PR behaviour; CLI register / non-chat callers are untouched.
- **Test isolation**: bun:sqlite db module is process-shared across `apps/api/test/*.test.ts`. The new route tests use a `markCompleted` helper to flip created requests to a terminal status, and the new whitelist tests park their `pending` rows back to `cancelled` before exiting; this preserves the sibling test's `pending().toHaveLength(1)` invariant.
- **Codex one-shot transport**: chose `--output-last-message <file>` over stream-JSON tail because the file always contains exactly the final assistant text — fewer parser branches, robust against schema drift.
- **`LlmFallbackDeps`**: pure injection seam introduced solely so `coordinator-llm-fallback.test.ts` can exercise selection-strategy without spawning real CLIs. Production callers do not pass `deps`; the default falls through to `claudeCliAvailable` / `codexCliAvailable` + the spawn helpers.
