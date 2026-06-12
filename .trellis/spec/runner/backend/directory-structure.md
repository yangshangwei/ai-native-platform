# Directory Structure

> Module layout for `apps/runner/`.

---

## Top-level layout

```
apps/runner/src/
├── index.ts                       # CLI entry; argv dispatch to cmd/*
├── cmd/                           # CLI subcommands (one file per verb)
│   ├── doctor.ts
│   ├── register.ts
│   ├── run.ts
│   └── watch.ts
├── orchestrator.ts                # `cmdOrchestrate` — the 8/9-stage driver
├── api-client.ts                  # The runner's view of the API (HTTP fetch)
├── command-runner.ts              # Whitelisted command exec → CommandRun event
├── worktree.ts                    # Git worktree prep for a WorkflowRun
├── backend-selection.ts           # Resolve project's AgentBackend instance
├── agent-backend-preflight.ts     # Pre-CLI availability check before spawning
├── heartbeat.ts                   # Tool versions + runner registration ping
├── knowledge.ts                   # Knowledge promote/reject flow client-side
├── profile.ts                     # `generateProjectProfile` cache helper
├── reports.ts                     # Surefire report ingest
├── sh.ts                          # Thin spawn wrapper for runner-internal needs
├── versions.ts                    # `jdk` / `maven` detection
├── config.ts                      # Constants (timeouts, dirs)
├── config-client.ts               # API config fetch
├── orchestrator/                  # De-closured orchestrator internals (06-12)
│   ├── types.ts                   # RunCtx / OkRef / OrchestrateOpts — shared step contracts
│   ├── steps.ts                   # executeXxx / runStage / runContextPack (deps-injected)
│   ├── invoke-skill.ts            # invokeSkill + context-request capture + foundation
│   ├── approval.ts                # awaitApproval / waitForApprovalDecision / sensitive checkpoint
│   └── verifier-media.ts          # Verifier media pure functions (unit-tested)
├── agents/                        # AgentBackend implementations
│   ├── types.ts                   # AgentBackend / AgentTaskContext / AgentRunResult contracts
│   ├── cli-common.ts              # Shared CLI-backend helpers (consumeLines, exitsZero, emit factories, diff capture)
│   ├── native.ts                  # Deterministic fixture (re-exports types.ts contracts)
│   ├── claude-code.ts             # Real Claude Code CLI
│   ├── claude-code-parser.ts
│   ├── codex.ts                   # Real Codex CLI
│   ├── codex-parser.ts
│   └── coordinator/               # Triage agent + LLM fallback (+ decision.ts: pure JSON decision parsing)
├── flows/
│   └── registry.ts                # Re-export of @ainp/shared FLOW_REGISTRY (W2-4)
└── skills/
    └── index.ts                   # Skill lookup by stage
```

---

## Where things go

### `cmd/<verb>.ts` — CLI subcommands

One file per CLI verb, exporting `cmd<Verb>(opts)`. The verb is parsed in
`index.ts` and dispatched:

- `runner orchestrate` → `orchestrator.ts` is at top level (substantial driver
  with private `RunCtx` interface; see `orchestrator.ts:78-93`).
- `runner run <command>` → `cmd/run.ts` (smoke-style entry; see `cmd/run.ts:32`).
- `runner watch` → `cmd/watch.ts`. Implements `processNextWorkflowRequest`
  (`watch.ts:45`) + the polling loop.
- `runner register` → `cmd/register.ts`. Project registration + initial profile.
- `runner doctor` → `cmd/doctor.ts`. Diagnostics.

Cmd files do CLI parsing and orchestration. The substantial behavior lives in
top-level service modules.

### Top-level service modules

Single named purpose each. The runner's flat structure is intentional — it's
a small enough surface that nesting doesn't help.

- `orchestrator.ts` — runs the lifecycle. Invokes `selectAgentBackend`,
  prepares the worktree, calls `runWhitelistedCommand`, drives stage
  transitions via `api-client.ts`. `RunCtx` is private to the module per
  PRD R14: not exported.
- `api-client.ts` — every HTTP call to api goes through this single
  `request(method, path, body)` function (`api-client.ts:25-36`). The runner
  has no DB access; this IS its persistence layer (see
  `database-guidelines.md`).
- `command-runner.ts` — runs whitelisted commands and emits `CommandRun`. See
  `packages/shared/src/utils/whitelist.ts` for the whitelist (8 patterns
  including `git status`, `mvn -B test`, `./mvnw -B -DskipTests compile`).
- `worktree.ts` — `TrustedLocalWorktreeEnvironment.prepare(run)` creates a
  detached worktree at `WORKTREES_DIR/<projectId>/<runId>/` on the run's
  branch. Idempotent.
- `sh.ts` — thin `spawn` wrapper for runner-internal needs (git, tool
  detection). Distinguished from `command-runner.ts` by the comment at top:

  > Not the user-facing whitelisted command runner — that one lives in
  > `command-runner.ts` and produces a CommandRun.

### `agents/` — AgentBackend implementations

`agents/types.ts` defines the `AgentBackend` interface (moved out of
`native.ts` on 06-11 — the production contract no longer lives in the fixture
file; `native.ts` re-exports the types so old import paths keep working):

```ts
export interface AgentBackend {
  kind: 'native' | 'codex' | 'claude_code';
  run(skill: SkillSpec, ctx: AgentTaskContext): Promise<{ outputs: AgentArtifactOutput[] }>;
}
```

Real backends (`claude-code.ts`, `codex.ts`) implement that interface and
reuse `packages/shared/src/utils/agent-backend-cli.ts` for the spawn contract
(`buildResolvedAgentBackendCliSpawn` returns the windowsHide / shell:false /
argv shape).

Parsers (`*-parser.ts`) sit alongside their backend: their job is to turn the
backend's stdout stream into `AgentStreamEvent`s for the agent-stream-bus.

### `flows/registry.ts` — re-export shim

Per W2-4 (`05-05-v2-w2-4-smart-router`), the canonical `FLOW_REGISTRY` lives
in `packages/shared/src/flows/registry.ts` so that both api (`router.ts`'s
`recommend`) and runner (`orchestrator.ts`) can read from one source. The
runner-side file is a thin re-export so existing
`from './flows/registry'` imports keep working.

### `skills/index.ts` — stage-to-skill lookup

`findSkillForStage(stage, runType)` returns the `SkillSpec` the agent should
execute. Lives here because it's runner-only logic (the API doesn't pick
skills).

---

## Cross-package imports

`apps/runner/` may import from:

- `@ainp/shared` — types, FLOW_REGISTRY, command whitelist,
  agent-backend-cli helpers, surefire parser, redaction, id helpers.
- `node:*`.

`apps/runner/` MUST NOT import from:

- `apps/api/` — would create a layering cycle. The runner's only view of api
  is `api-client.ts`'s HTTP fetch.
- `apps/api/src/store/` — the runner has no DB access at all. (See
  `database-guidelines.md`.)
- `apps/web/`.

---

## File-naming conventions

Same as api: `kebab-case.ts` for modules, `<file>.test.ts` next to the file
under test. Don't introduce nested folders inside `cmd/` — when a verb gets
substantial, extract the substantial behavior to a top-level module and keep
the cmd file thin.

---

## Forbidden patterns

- **Business logic inside `cmd/<verb>.ts`.** A 100-line cmd file usually
  means the substantial work belongs at top level. Cmd files should parse
  options, call the service, and exit cleanly.
- **Direct DB access via `bun:sqlite` or `apps/api/src/store/`.** The runner
  is a remote consumer of the API; everything goes through `api-client.ts`.
- **`spawn` outside `sh.ts` / `command-runner.ts` / agent backends.** Those
  three modules own process invocation; introducing a fourth invocation
  surface complicates the Windows-shim contract (see
  `agent-backend-runtime.md`).
- **Importing `flows/registry.ts` directly when you mean the canonical
  registry.** Either form works at runtime, but new code should prefer
  `import { FLOW_REGISTRY } from '@ainp/shared'` to make the cross-layer
  origin explicit.
