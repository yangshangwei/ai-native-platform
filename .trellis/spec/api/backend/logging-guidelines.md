# Logging Guidelines

> Logging strategy for `apps/api/`.

---

## Two channels

| Channel | Tool | When |
|---|---|---|
| **Audit log** | `workflow_audit` rows via the engine | Anything that needs to be replayable / queryable later — every workflow lifecycle event lives here. |
| **Console** | `console.log` / `console.error` from `server.ts`, route handlers, engine | Operator-facing info during the API process lifetime. Not durable. |

The audit log is the durable system-of-record. Console output exists for live
dev/debug and process-level events (`server.ts` startup banner). Don't conflate
the two.

---

## Audit log (the important channel)

Every workflow state change writes a row to `workflow_audit` via the engine:

- `workflow_run.created`
- `step.started` / `step.finished`
- `gate.<name>.passed` / `gate.<name>.failed`
- `agent_task.created` / `agent_task.completed`
- `command_run.recorded`
- `knowledge.promoted` / `knowledge.rejected`
- `workflow_run.failed` / `workflow_run.completed`

Plus the W2-4 addition:

- `workflow_run.created` row carries `routerRecommendation` iff the smart
  router fired (i.e. caller omitted `flowId`).

Audit rows are read by:

- The completion report generator (`apps/api/src/reports.ts`) which renders
  the durable evidence list.
- The UI timeline (via the workflow-runs route).
- Future verifier gates (P3-1 traceability) that walk the audit log.

**Anything you'd want to investigate two weeks later belongs in
`workflow_audit`.** Console output is gone after `server.ts` restarts.

---

## Console

The API runs as a Bun process under the user's shell or a process supervisor.
Console output is what the operator sees in real time.

### Acceptable console writes

```ts
// apps/api/src/server.ts:11
console.log(`[api] listening on http://${server.hostname}:${server.port}`);
```

Process-level lifecycle: server start, fatal failure on import. One line per
event; prefix with `[api]` so multi-process logs (`api`, `runner`) interleave
readably.

### Forbidden console writes

- **Per-request logging in hot paths without a tag.** A request hitting
  `/runner/events/agent-event` runs many times per second during a busy run;
  unstructured `console.log(body)` floods the terminal and hides real
  problems.
- **Logging request bodies that may contain secrets.** `POST /projects`
  carries `sourceCredential` (PAT / passwords). Never log the body
  whole-cloth. If you must log:
  `console.log('[projects] register', { name: body.name, sourceKind: body.sourceKind })`.
  See `packages/shared/src/utils/redaction.ts` for the team's redaction
  helpers.
- **`console.log(err)` instead of `console.error(err)`.** Anything that
  surfaces in stderr is what process supervisors / log shippers split on.
  Mixing causes alert noise.

---

## SSE channels (live, not durable)

The API exposes Server-Sent Events for live tailing. The bus header
(`apps/api/src/agent-stream-bus.ts:7-10`) states the rule explicitly:

> History is in `agent_events` SQLite — this bus is **only** for live tail.
> SSE endpoints fetch history first, then attach a subscriber to receive
> subsequent events (no race because both go through `publish`).

`server.ts:7-9` documents the `idleTimeout: 255` connection setting because
SSE subscribers can sit quiet for minutes (model thinking) and must NOT be
cut off — a 5s ping keeps writes flowing well under the threshold.

**Don't log SSE events to console** — they're already persisted in
`agent_events`, and console output during a live stream is just noise.

---

## What about structured loggers?

There is no structured logger (pino / winston / etc.) in `apps/api/` today.
The team's intentional choice for MVP: the durable channel is
`workflow_audit`, which is structured by virtue of being a SQLite table;
console is for humans.

If a future task adds a structured logger, the rule is: **it does not replace
the audit log.** Audit rows must still be written for any state change.

---

## Common mistakes

- **Writing audit rows from outside `workflow-engine.ts`.** The engine is the
  sole writer; an audit row written from a route or service bypasses the
  ordering invariants the engine maintains.
- **Forgetting to include `workflowRunId` in console messages inside engine
  helpers.** Multiple runs interleave in a single process; `console.log('step started')`
  is useless without the run id.
- **Logging the raw return value of `store.workflowRuns.values()`.** That's
  every run in the DB — slow, noisy, and prints sensitive title fields.
