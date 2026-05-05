# Logging Guidelines

> Logging strategy for `apps/runner/`.

---

## The runner is a CLI

The runner runs in a terminal — under `bun run runner`, `bun run e2e`, or
under api-managed `runner watch` supervision. Console output IS the user-
facing channel during a live run; the durable record lives in the api's
`workflow_audit` and `agent_events` tables.

Two sinks; two purposes:

| Sink | Tool | Audience |
|---|---|---|
| Console (stdout/stderr) | `console.log` / `console.error` | The human running the CLI right now |
| API events | `api.agentEvent(...)`, `api.commandRun(...)`, etc. | The engine + the audit log + future readers |

The runner often writes both for the same fact:

```ts
// apps/runner/src/cmd/run.ts:73-77
console.log(
  `[runner] command ${cr.status} (exit=${cr.exitCode}, ${cr.durationMs}ms): ${cr.command}`,
);
console.log(`[runner]   stdout -> ${cr.stdoutRef}`);
console.log(`[runner]   stderr -> ${cr.stderrRef}`);
```

The console gives the human immediate feedback; the `api.commandRun(cr)` call
that ran a few lines earlier persisted the same fact.

---

## Console conventions

### Prefix every line with `[runner]`

Rationale: when api and runner run in the same terminal (dev mode), the
prefix lets the human filter: `2>&1 | grep '\[runner\]'`. Use `[api]` from
the api side; the prefix is the convention.

### One line per significant event

```ts
console.log(`[runner] workflow-run ${run.id} for project ${project.name} created`);
console.log(`[runner] worktree ready at ${workspace.path} (branch ${workspace.branch})`);
```

Don't multi-line with `JSON.stringify(run, null, 2)`. The reader scrolls
past it. If you really need the structure, log a one-line summary AND record
the full structure as an api event.

### Include the run id when inside a run

Multiple runs interleave. `[runner] step started` is useless;
`[runner] run_xxx step started build_test` is debuggable.

### Use `console.error` for errors

```ts
// BAD
console.log(`[runner] failed: ${err}`);

// GOOD
console.error(`[runner] orchestrate failed: ${err instanceof Error ? err.message : err}`);
```

Process supervisors split stdout/stderr; alerting wires off stderr. Mixing
silently masks problems.

---

## Streaming agent backend output

Agent backends (Claude Code, Codex) produce streaming stdout. The runner
parses each line into `AgentStreamEvent` rows via `agents/<backend>-parser.ts`
and POSTs to `/runner/events/agent-event`. The api persists in
`agent_events` AND publishes to the live SSE bus
(`apps/api/src/agent-stream-bus.ts`).

Console behavior during streaming:

- The runner relays a compact one-liner per parsed event so the operator can
  see "something is happening".
- Don't dump the entire raw stdout — that's the client's job (web UI tails
  via SSE).

The current
`codestable/issues/2026-05-05-claude-code-implementation-no-exit/` issue
references the symptom of "stream repeatedly printed `Done.`" — that's
because the parser saw legitimate `Done.` events but the CLI didn't exit.
The runner correctly forwarded each event; the bug is in the CLI termination
contract, not the logging layer.

---

## What gets persisted vs printed

| Fact | Console | API event | DB row |
|---|---|---|---|
| Workflow run created | ✓ summary | ✓ via createWorkflowRun | workflow_runs + workflow_audit |
| Step started/finished | ✓ name | ✓ stepStarted/Finished | step_runs |
| Command exit | ✓ status+exit | ✓ commandRun | command_runs |
| Agent event line | one-line summary | ✓ agentEvent | agent_events |
| Maven Surefire ingest | ✓ count | ✓ mavenBuild | builds + tests + artifacts |
| Worktree path | ✓ once | ✓ workspacePrepared | workflow_runs.workspace_path |
| Heartbeat tool versions | once at startup | ✓ heartbeat | runners |

If a fact ISN'T in the rightmost column, postmortem can't see it. **The DB
column always wins as source of truth.**

---

## Debugging-only logs

If you add a noisy log for debugging, gate it behind an env var:

```ts
if (process.env.AINP_DEBUG_RUNNER) {
  console.log(`[runner] debug: ${...}`);
}
```

Otherwise it ships to every user. The team has hit this before — large
streamed outputs in production sessions hide real signal.

---

## Forbidden patterns

- **Silencing stderr from spawned children.** `command-runner.ts` captures
  stderr and persists it via `cr.stderrRef`; never drop it.
- **Log lines without a tag/run id when inside a run.** Untraceable noise.
- **`console.log(JSON.stringify(largeObject))` in a hot path.** Stringifying
  per-event objects per agent stream tick is expensive AND illegible.
- **Writing to `process.stderr.write` without a newline.** Breaks log
  shippers that delimit on `\n`.
- **Mixing audit-shaped data into console only.** Anything important enough
  to persist must go through `api-client.ts` so it lands in `agent_events` /
  `workflow_audit`.
