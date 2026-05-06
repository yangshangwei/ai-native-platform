# Quality Guidelines

> Code standards specific to `apps/runner/`.

---

## Pre-commit gate

```bash
bun test
bun run typecheck
```

The runner has the most cross-package dependencies — `@ainp/shared` types,
api response shapes via `api-client.ts`, plus subprocess contracts for git,
maven, jdk, claude, codex. Any of those drift causes runner failures that
won't show up in api/web typecheck. Run both, every time.

The CLAUDE.md hot-path note: `apps/runner/src/orchestrator.ts` is referenced
60+ times in recent task records. Treat it as load-bearing — don't refactor
its public surface without a task that lists every caller.

---

## Test placement

Co-located with the file under test:

```
apps/runner/src/flows/registry.ts
apps/runner/src/flows/registry.test.ts          ← flow-registry.test.ts shape
apps/runner/src/agents/claude-code-parser.ts
apps/runner/src/agents/claude-code-parser.test.ts
```

Test the pure pieces directly (parser → AgentStreamEvent[]; flow registry
shape; backend selection logic). For end-to-end runs, use `bun run e2e` (the
documented full-lifecycle smoke) and `bun run smoke` (narrow command-execution
slice).

The `research/fake-claude-e2e.mjs` deterministic stub created in
`05-05-end-to-end-business-flow-check` is **task-local**, not a shipped
fixture. If a future task needs CI-side determinism, promote a similar
fixture to `apps/runner/src/agents/native.ts` (the existing deterministic
backend) or a new `tests/fixtures/` directory — don't depend on the task
research file.

---

## Naming

| What | Convention | Example |
|---|---|---|
| Function | `camelCase` | `cmdOrchestrate`, `processNextWorkflowRequest`, `selectAgentBackend` |
| Type / interface | `PascalCase` | `OrchestrateOpts`, `RunCtx`, `AgentBackend` |
| File | `kebab-case.ts` | `command-runner.ts`, `agent-backend-preflight.ts` |
| Const | `SCREAMING_SNAKE` for module-level config | `WORKTREES_DIR`, `DEFAULT_TIMEOUT_MS`, `DEFAULT_MAX_LOG_BYTES` |
| Cmd entry | `cmd<Verb>(opts)` | `cmdRun`, `cmdOrchestrate`, exported as named function |

`RunCtx` and other intra-orchestrator types stay private (not exported)
unless a test needs them. The orchestrator header documents this:

> File-private (PRD R14: not exported); ADR Q1=α (thin) means `kind` /
> `skillId` on each StageStep are populated but not read at runtime in this PR.

---

## Pure functions vs side effects

- `flows/registry.ts` re-exports a pure data structure. Don't add behavior.
- `skills/index.ts:findSkillForStage(stage, runType)` should remain pure.
- Parsers in `agents/*-parser.ts` are pure: bytes → events.
- Anything that spawns, fetches, reads/writes files is by definition not
  pure. Confine that to: `sh.ts`, `command-runner.ts`, agent backends,
  `worktree.ts`, `api-client.ts`, `cmd/*`, `orchestrator.ts`.

A pure helper that touches `process.env` even once is no longer pure. If
you need env-driven behavior, take it as a parameter and let the cmd layer
inject it.

---

## Idempotency

Watch consumers, retries, and supervision restarts mean the runner can repeat
work. Make repeats safe:

- `worktree.ts:prepare()` is idempotent: if the worktree exists at the
  expected path on the right branch, it reuses.
- `api.workspacePrepared` is idempotent on the engine side.
- `api.commandRun` is **not** idempotent across calls with the same
  CommandRun id — generate a fresh id per attempt.

The current
`codestable/issues/2026-05-05-coordinator-duplicate-clarification-on-watch-race/`
is exactly an idempotency violation: a second watch consumer re-processes a
request that should have been excluded by status. **Always check the state
filter on the listing query before re-processing.**

---

## Subprocess contract

Every spawn must:

1. Pass an explicit `timeoutMs` for external tools (claude, codex, mvn, git).
   `sh.ts` accepts it; `command-runner.ts` defaults via `DEFAULT_TIMEOUT_MS`.
2. Use `shell: false` (the `agent-backend-cli.ts:75-99` helper enforces
   this). Reason: shell:true enables string interpolation that opens command
   injection if any argv comes from user input.
3. On Windows shims (`.cmd` / `.bat`), wrap via `cmd.exe /d /s /c call <shim>`
   per `agent-backend-cli.ts:82-90`. The runner's tests cover this contract;
   bypassing it makes Windows behavior non-deterministic.

The archived task `05-04-windows-shim-argv-contract` documents the rationale
in spec form (see `.trellis/spec/shared/backend/agent-backend-contract.md`).

---

## Anti-patterns this team has hit

### 1. Bypassing the central spawn helper

> Reference: archived task `05-04-agent-backend-cli-windows-shim-call`.

Pre-fix, agent backends spawned `claude` directly with the bin path. On
Windows, `.cmd` shims need `cmd.exe /d /s /c call <shim>` wrapping.
`agent-backend-cli.ts` was added precisely to centralize that contract;
**never call `spawn(binPath, args)` directly for an agent backend** — go
through `buildResolvedAgentBackendCliSpawn()`.

### 2. Hard-coded full lifecycle assumption

> Reference: end-to-end validation report (this task's research).

`scripts/e2e.ts` historically claimed full 9-stage coverage while relying on
implicit routing defaults. Lesson: when an e2e script claims a specific path,
**pass `--flow-id <flowId>` explicitly** or assert the recommendation, don't
trust defaults.

### 3. Missing project agentBackend

> Reference: end-to-end validation report § Issues Found #1.

`scripts/e2e.ts` historically ran `ensureProject()` without setting
`agentBackend`. Current product requires the project's `agentBackend` to
be configured before workflow creation — projects must be registered with
`--agent-backend` or have it set via the API afterwards.

---

## Forbidden patterns

- **`any` to silence type errors at the api boundary.** The runner's view of
  api types comes from `@ainp/shared`; if you need to widen, fix the type
  there.
- **Direct `import { db } from 'apps/api/...'`.** No DB access from runner.
- **`process.exit(...)` in non-cmd files.** Cmd layer owns exit codes.
- **Catching an `await api.x(...)` without recording the failure.** Either
  let bubble (default) or write a structured event/log, not silent
  continue.
- **New `spawn` invocation outside the three sanctioned modules** (`sh.ts`,
  `command-runner.ts`, agent backends). Each adds a new contract surface
  that's hard to verify across platforms.
