# Fix E2E blockers: claude-code no-exit + coordinator fallback + watch race

## Goal

Unblock the three real-LLM business paths that 2026-05-05 E2E validation flagged:

1. **Direct CLI E2E with real Claude Code backend** — currently times out at 10 min in `implementation` because `claude` CLI doesn't exit after the assistant response is complete (`run_340b2046742a`).
2. **Web / API queue path** — concrete `WorkflowRequest` gets paused at `awaiting_clarification` whenever the Coordinator's LLM one-shot fails or times out, even though the rule classifier already produced a usable `proceed` decision (`wreq_5218be86ddc5`).
3. **Watch race on awaiting_clarification** — two concurrent watches both run triage on the same `pending` `WorkflowRequest`, posting duplicate coordinator clarification messages.

After fix, re-run **L4** (`bun run e2e` with real Claude Code backend) and confirm the documented full lifecycle reaches `passed`.

## What I already know

### Issue 1 — `claude` CLI doesn't exit after `--print` finishes

- **File**: `apps/runner/src/agents/claude-code.ts`, function `invokeCli` (lines 145–218).
- **Lifecycle today**: spawn `claude --print --output-format stream-json --include-partial-messages --no-session-persistence ...`, drain stdout via `createInterface`, `await child.once('exit')`. No active termination unless the 10-minute `DEFAULT_TIMEOUT_MS` fires.
- **Behaviour mismatch**: stream-json emits `{type:"result", subtype:"success", ...}` once the assistant is finished (the deterministic stub at `.trellis/tasks/archive/2026-05/05-05-end-to-end-business-flow-check/research/fake-claude-e2e.mjs:205` does exactly this and exits cleanly). Real `claude` keeps the process alive — likely waiting on something the user's `~/.claude/` configuration (OMC + Trellis hooks) keeps open (a hook loop, a session keepalive, or stdin fd that never closes).
- **Why fake passes but real doesn't**: fake stub exits via `process.exit(0)` after emitting `result`. Real `claude` relies on its own internal lifecycle that depends on local config.
- **Severity**: P1 — blocks L4. Without this, no real Claude Code business flow can be proven green.

### Issue 2 — Coordinator pauses concrete requests on LLM failure

- **Files**: `apps/runner/src/agents/coordinator/index.ts` (entry merging) + `llm-fallback.ts` (failure cases).
- **Today's behaviour** at `index.ts:35–67`:
  1. `classifyByRules` produces `ruleResult`. For `增加一个 subtract 方法并补测试` the rule classifier returns `proceed/feature_clear` with confidence `0.4` (the ambiguous default branch — `rules.ts:127–137`).
  2. `0.4 < threshold (0.65)` → calls `classifyByLlm`.
  3. `classifyByLlm` tries `claude_code` one-shot → times out (related to Issue 1 family) → returns `{decision: pause_for_human, questions: [fallback.invocationFailed]}` at `llm-fallback.ts:141–151`.
  4. `index.ts:54` overwrites `final = llmResult` — **the rule's earlier `proceed` decision is silently discarded**.
- **Result**: Coordinator emits a clarification question for a request that the rule classifier already considered routable, then `watch.ts:132` flips status to `awaiting_clarification`, blocking the Web entry.
- **Severity**: P1 — blocks Web/queue intake when LLM has any availability issue.

### Issue 3 — Two watches duplicate-process the same `pending` request

- **File**: `apps/runner/src/cmd/watch.ts`.
- **Today's behaviour**:
  - `listPending` queries `status: 'pending'` (`watch.ts:150`).
  - `defaultTriage` runs the LLM (slow, multi-second). During this window the request is still `pending`, **not yet locked**.
  - If a second watch process polls during that window, it also lists the request and runs `triage` — both watches end up calling `postRequestMessage` with the same coordinator question, then both call `setRequestStatus('awaiting_clarification')` (idempotent on status, but messages already duplicated).
- **Reproduction confirmed**: two coordinator messages with identical text on `wreq_5218be86ddc5` after API-managed watch + manual `watch --once` overlapped.
- **Severity**: P2 — message duplication only; doesn't advance to wrong state. But the underlying lack of triage idempotency is a latent risk if any future hook adds side effects (counters, notifications, billing).

## Proposed fixes (each with 2–3 candidate approaches)

### Fix 1 — Result-event-driven shutdown for Claude Code backend

**Approach A (Recommended)** — Detect `{type:"result"}` in the stream-json parser; when seen, schedule a 5-second grace SIGTERM if the child hasn't naturally exited.

- *How*: extend `claude-code-parser.ts` to set a flag when `parsed.type === 'result'`; in `invokeCli`, after consumeLines reads the line, start a grace timer that calls `child.kill('SIGTERM')` if `exit` hasn't fired. Treat exit code 143 as success when the `result` event was seen and `subtype === 'success'`.
- *Pros*: pure runner-side fix, no dependency on user's `~/.claude/` config; matches the contract the fake stub already follows; backward compatible.
- *Cons*: introduces a 5-second post-result wait. Acceptable trade-off vs 10-minute hang.

**Approach B** — Run `claude` with isolated config: `CLAUDE_CONFIG_DIR=$tmp` to bypass user-level hooks.

- *Pros*: addresses the suspected root cause (user hooks keeping CLI alive).
- *Cons*: brittle — requires CLI to honor the override, and may hide real product hooks the user wants. Doesn't help if the cause is somewhere else (e.g., stdin fd handling).

**Approach C** — Add `--exit-on-result` style flag passthrough (only if Claude CLI supports it; needs version check).

- *Pros*: lets the CLI handle its own lifecycle.
- *Cons*: depends on CLI feature; can't be relied on across Claude versions.

### Fix 2 — Preserve rule's `proceed` when LLM fails

**Approach A (Recommended)** — In `coordinator/index.ts`, when `llmResult.decision.action === 'pause_for_human'` AND `ruleResult.decision.action === 'proceed'` AND the LLM failure was due to invocation/timeout/empty (not an explicit LLM-judged ambiguity), keep `ruleResult` and tag `source = 'rules.degraded'`.

- *How*: extend `ClassifyOutput` with a `failureKind` field set by `llm-fallback.ts` (`'invocation_failed' | 'empty' | 'invalid_json' | 'unknown_action' | 'unavailable' | null`). At `index.ts`, if LLM `failureKind` is one of `{invocation_failed, empty, unavailable}` and rule said `proceed`, fall back to rule's decision.
- *Pros*: clean separation between "LLM judged ambiguous" (legit pause) and "LLM unavailable" (use rule's default); minimal API surface change.
- *Cons*: adds a small failure-kind enum.

**Approach B** — Lower the rule confidence threshold for cases with feature keywords + min length.

- *Pros*: simpler.
- *Cons*: hides the fallback intent inside rule weights; harder to reason about when LLM is up vs down.

**Approach C** — Use Smart Router (`/router/recommend`) as the third tier when LLM is down.

- *Pros*: makes Smart Router authoritative for "no-LLM" mode.
- *Cons*: needs API call and routing logic; bigger surface than necessary.

### Fix 3 — Atomic triage lock

**Approach A (Recommended)** — Add API endpoint `POST /workflow-requests/:id/claim-for-triage` that atomically transitions `pending → triaging` with `runnerId`. Watch calls it before running triage; loser sees null return and skips.

- *How*: add `triaging` to `WorkflowRequestStatus` (it's terminal-safe; orchestrate path uses `claim`/`in_progress`); update `listPending` to keep returning `pending` only; on triage outcome:
  - `proceed`: continue to `claim` (status moves to `in_progress`).
  - `pause_for_human`: transition `triaging → awaiting_clarification`.
  - `abort`: transition `triaging → cancelled`.
- *Pros*: race-free; explicit state for "triage in progress"; prevents Issue 3 root cause not just symptom.
- *Cons*: schema migration — requires `WorkflowRequestStatus` enum update + API route + idempotent down-grade for failures.

**Approach B (Lower-risk)** — Re-fetch status before posting/setRequestStatus; if no longer `pending`, skip.

- *How*: at the end of `defaultTriage`, before `postRequestMessage`, call `api.getWorkflowRequest(req.id)`; if `status !== 'pending'`, abort.
- *Pros*: no schema change; small diff.
- *Cons*: still has TOCTOU window (re-fetch → post is non-atomic). Reduces probability, doesn't eliminate.

**Approach C** — Coordinator-decision dedup: `postRequestMessage` rejects an exact-duplicate `(requestId, role=coordinator, content)` within N seconds.

- *Pros*: backstop at the message layer; survives even worse races in the future.
- *Cons*: doesn't prevent the wasted LLM call; just hides the duplicate symptom.

## Decision (ADR-lite)

**Context**: 2026-05-05 E2E validation surfaced 3 issues (1 in `claude-code` runtime, 2 in coordinator/watch). User wants real-LLM L4 to turn green and is willing to ship 2 fixes in this task.

**Decision**: **Scope B** — land Fix 1 + Fix 2; defer Fix 3 (P2, schema-touching) to a follow-up task.

**Consequences**:
- Two P1 user-visible blockers go green: real Claude Code direct E2E + Web queue intake on slow LLM.
- Diff stays focused; no `WorkflowRequestStatus` enum migration in this task.
- Issue 3 (duplicate clarification on watch race) stays open as P2; once Fix 1 lands, its trigger probability drops because requests rarely get paused.

## Assumptions (Temporary)

- The Claude Code CLI `--print` mode does emit `{type:"result"}` in stream-json on the local 2.1.117 version (consistent with how the fake stub mimics it; will verify at fix time).
- `WorkflowRequestStatus` schema can be safely extended if Scope C is chosen (no external consumer depends on enum closure).
- L4 evidence reuse: same shape as L3 — `passed` status, all 9 stages, 4 manual approvals, 2 mvn commands exit 0, complete artifact set.

## Requirements

- Fix 1 lands with a unit test exercising the `result`-event grace shutdown path.
- Fix 2 lands with a unit test where rules return `proceed/feature_clear@0.4` and LLM fallback returns an `invocation_failed`-class outcome → final coordinator decision must be `proceed`, not `pause_for_human`.
- After fixes: `bun run e2e` with real Claude Code backend reaches `passed` status with full 9-stage evidence (gates, commands, artifacts, approvals).
- After fixes: submitting `POST /workflow-requests` with a concrete title (e.g. `增加一个 subtract 方法并补测试`) while real Claude Code is configured does **not** pause at `awaiting_clarification` even when the LLM one-shot is slow/unavailable; the watch creates a `WorkflowRun`.
- Each fixed issue gets a `*-fix-note.md` under `CodeStable/issues/2026-05-05-{issue-slug}/` (per `cs-issue-fix` skill).

## Acceptance Criteria

- [x] `bun run e2e` with project `agentBackend=claude_code` exits 0 and `run.status=passed`. — **PASS** `run_2f6dc6b27c80` (full feature.standard 9 stages, $0.62 / 222s, all 4 manual approvals auto-approved, 11 artifacts incl. completion_report + knowledge_candidate). Required `scripts/e2e.ts` to also pass `--flow-id feature.standard`; that minor harness patch is included in this task.
- [x] New unit test for `result`-event shutdown passes; existing 425+ tests stay green. — **PASS** 56 files / 431 tests (425 → 431, +4 coordinator-degraded + +2 grace shutdown).
- [x] Submitting `POST /workflow-requests` with title `增加一个 subtract 方法并补测试` while real Claude Code is configured but slow/unavailable does **not** pause at `awaiting_clarification`; the watch creates a `WorkflowRun`. — **PASS** `wreq_c3692cf3350c` triaged within 1.2s, status went to `claimed`, `workflowRunId=run_584fec47f82a` created.
- [x] New unit test for "rule proceed + LLM fail = proceed" passes. — **PASS** `apps/runner/test/coordinator-degraded-fallback.test.ts` (4/4).
- [x] Two issue reports under `CodeStable/issues/2026-05-05-{claude-code-implementation-no-exit, coordinator-fallback-pauses-concrete-request}` get `fix-note.md` documenting what was changed. — **PASS** both fix-notes written.
- [x] `CodeStable/issues/2026-05-05-coordinator-duplicate-clarification-on-watch-race` is **explicitly noted as deferred** (left as P2 follow-up) without a fix-note in this task. — **PASS** noted in both fix-notes' "follow-ups" section.

## Definition of Done

- All targeted unit/integration tests pass; `bun test` total stays at 425+ green.
- `bun run typecheck` clean.
- `bun run e2e` with real Claude Code reaches `passed` (one full successful run captured as evidence).
- Each addressed issue's report directory under `CodeStable/issues/` has a `*-fix-note.md` (per `cs-issue-fix` skill).
- Trellis archive: this task's `check.jsonl` records L4 evidence run id; `prd.md` marks Acceptance Criteria checkboxes.

## Out of Scope

- Codex backend `403 insufficient balance` — environmental (account billing), not platform.
- UI dogfood polish (failed task detail page first-viewport informativeness — issue from prior task's report).
- Smart Router prompt/gate tightening for fast-forward `.gitignore` edits — separate concern.
- Non-Java languages, Docker/sandbox enforcement, IDE integration.

## Technical Notes

- Issue 1 root area:
  - `apps/runner/src/agents/claude-code.ts:183–217` — spawn + drain + exit-await.
  - `apps/runner/src/agents/claude-code-parser.ts` — stream-json line parser; needs to surface `result` events to the invoker.
  - `apps/runner/src/agents/claude-code.ts:48` — `DEFAULT_TIMEOUT_MS = 10 * 60 * 1000`.
- Issue 2 root area:
  - `apps/runner/src/agents/coordinator/index.ts:35–67` — entry merging.
  - `apps/runner/src/agents/coordinator/llm-fallback.ts:141–151` — invocation_failed return.
  - `apps/runner/src/agents/coordinator/rules.ts:127–137` — ambiguous default `proceed/feature_clear@0.4`.
- Issue 3 root area:
  - `apps/runner/src/cmd/watch.ts:142–179` — main loop, `listPending` only filters `status=pending`.
  - `apps/runner/src/cmd/watch.ts:86–140` — `defaultTriage` posts message + sets status sequentially without locking.
  - API route side: `apps/api/src/routes/workflow-requests.ts` (need to confirm location for new `claim-for-triage` if Scope C).
- Existing relevant specs:
  - `.trellis/spec/runner/backend/agent-backend-runtime.md` — Agent Backend lifecycle expectations.
  - `.trellis/spec/runner/backend/index.md` — runner architecture.
  - `.trellis/spec/api/backend/index.md` — API surface conventions (relevant to Fix 3 API endpoint).
- Issue reports under `CodeStable/issues/2026-05-05-*` (root-cause hypotheses, severity, reproduction).
- Memory directive: `Use Local Runner + Git worktree + host JDK/Maven/Git for development execution. Do not pursue Docker/K8s/microVM/tool-policy sandbox-level enforcement for the current MVP.`
- Memory directive: `Claude Code CLI 调用必须实时流式` — `result`-event shutdown must remain real-time (no buffering of stream lines in front).
