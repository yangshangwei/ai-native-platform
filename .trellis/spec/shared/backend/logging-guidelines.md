# Logging Guidelines

> Logging strategy for `packages/shared/`.

---

## TL;DR

**Shared is silent.** No `console.log`. No `console.error`. No log libraries.
No log helpers. The only acceptable "logging" is returning structured data
the caller can log.

---

## Why

Shared is pure code consumed from three different layers:

- The **api** writes durable audit rows + uses console for process events.
- The **runner** writes durable agent_events + uses console for live CLI
  feedback.
- The **web** uses `console.*` only for dev debugging; the real telemetry is
  the api itself.

Each consumer attaches different context (run_id, agent_task_id, project_id,
session_id) to its log entries. Shared doesn't know which it is. If shared
called `console.log('something happened')`, the message would arrive without
context, hide in three different output streams, and clutter the api's
production stderr feed for no reason.

---

## What "silent" means

In `packages/shared/src/`:

- ❌ `console.log` / `console.error` / `console.warn` / `console.info`
- ❌ `console.debug` (still hits stderr in many runtimes)
- ❌ Importing a logger like `pino` / `winston` / `debug`
- ❌ Writing to `process.stdout.write` / `process.stderr.write`
- ❌ Throwing-with-side-effect patterns where the throw is "for logging"

```ts
// ❌ BAD
function maybeFail(n: number): boolean {
  if (n < 0) {
    console.error('shared: negative input');
    return false;
  }
  return true;
}

// ✅ GOOD
function maybeFail(n: number): { ok: boolean; reason?: string } {
  if (n < 0) return { ok: false, reason: 'negative input' };
  return { ok: true };
}
```

The caller (api route, runner cmd, web init) gets to decide whether
"negative input" is a 400, an audit row, a console error, or all three.

---

## The acceptable shape: structured returns

When something noteworthy happens, encode it in the return value:

```ts
// packages/shared/src/types/router.ts
export interface RouterRecommendation {
  flowId: FlowId;
  startStage: WorkflowStage | null;
  relevantKnowledge: ArtifactId[];
  estimates: { timeSec: number; tokens: number };
  reason: string;
  rulesFired: string[];     // ← lets the caller log which rules chose
  confidence: number;
}
```

The smart-router function (api-side, but the type is shared) returns the
rules it fired. The api logs them via the audit row; the UI displays them in
the recommendation card. Both use the same data shape.

---

## What if I really need to debug shared code?

Two options that don't violate the silence rule:

1. **A test.** If you want to inspect a value during dev, write a test that
   asserts its shape. Tests can `console.log` because they only run during
   `bun test` — not in production.
2. **Caller-side debug logging.** Have the consumer log the input/output
   around the shared call:
   ```ts
   const out = sharedFn(input);
   if (process.env.AINP_DEBUG_RUNNER) console.log('[runner] sharedFn', input, out);
   ```
   The consumer knows its env-var conventions and run context.

If you find yourself wanting a debug log inside shared during normal
operation, the function probably returns too little information. Add a
field to the return type instead.

---

## Forbidden patterns

- **`console.*` anywhere in `packages/shared/src/`.** Every grep should
  return zero results.
- **Importing a logger.** Even `debug` (the npm package) — it pulls in
  process.env reads at import time.
- **"Helpful" warnings about deprecated args.** If an arg is deprecated,
  remove it, or change the type so the consumer fails to compile.
- **`process.stdout.write` / `process.stderr.write`.** Same as console;
  shared has no business writing to either stream.
- **Wrapper functions that take a logger callback.** "Logging-aware" shared
  functions sound general but are a smell — they leak consumer concerns
  into pure code. Return data; let the caller log.
