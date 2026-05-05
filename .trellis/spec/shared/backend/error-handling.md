# Error Handling

> Error patterns for `packages/shared/`.

---

## Two roles for shared in the error story

1. **Define error-shape types** that api and runner both use to describe
   failures.
2. **Expose narrow predicates that throw on programmer errors** (invariant
   violations) but never on expected runtime conditions.

What shared does NOT do: catch errors, log errors, decide HTTP status codes,
or recover. Those are decisions the consumer (api / runner) makes after
calling shared.

---

## Error TYPES, not error logic

Shared types describe what a failure looks like in transit. Examples:

- `types/agent.ts` — `AgentResult` carries `ok: boolean`, `error: string |
  null`, etc. Both api (writing) and runner (producing) use the same shape.
- `types/coordinator.ts` — `CoordinatorDecision` is a discriminated union
  including `pause_for_human` and `unable` outcomes; the failure path is
  modeled in the type, not in a thrown error.
- `types/router.ts` — `RouterRecommendation` includes `rulesFired: string[]`
  so callers can see which rule chose what; smart-router doesn't throw,
  it returns.

A function that "fails" in business terms should return a discriminated
shape, not throw. Throws are reserved for the next category.

---

## When shared CAN throw

Programmer errors / invariants only:

```ts
// packages/shared/src/utils/agent-backend-cli.ts:42
throw new Error(`Unsupported ${backend} CLI purpose: ${purpose}`);
```

The argument was already a typed union (`AgentBackendCliPurpose`), so reaching
this branch means the caller passed something the type system shouldn't have
allowed. Throwing is right because the developer needs to fix the call site.

When you `throw` from shared:

1. Use a plain `Error(...)` with a descriptive message that names the
   identifiers involved (backend, purpose, etc.).
2. Don't introduce a custom error class unless the caller needs to branch
   on it. Most consumers only need `instanceof Error` and `err.message`.
3. Don't `throw` for expected runtime conditions. "User passed an empty
   string" is expected; return a structured result.

---

## What shared MUST NOT do

- **`console.log` / `console.error` errors.** Pure code is silent. Callers
  attach run_id / context that shared doesn't know about.
- **`process.exit(...)`.** Shared has no concept of process lifecycle.
- **`try { ... } catch { return null }` swallowing.** Either the operation
  is well-defined (return a structured result) or it's a programmer error
  (throw).
- **Mapping to HTTP status codes.** That's an api-route decision.
- **Mapping to runner exit codes.** That's a cmd-layer decision.

---

## A concrete example: `surefire.ts`

The Surefire XML parser is shared because both the runner (which produces
`MavenBuildEvent`s) and the api (which ingests them) might need to validate.
It's pure: input bytes → parsed structure or a structured "could not parse"
result.

If parsing fails:

- ❌ Don't `console.error('parse failed')`.
- ❌ Don't `throw new Error('parse failed')` for malformed user input.
- ✅ Return a result shape that signals "no tests parsed" so the api can
  decide whether that's fatal (fail the test gate) or benign (no tests
  run).

The api/runner consumer will write the audit log; shared just hands back
what happened.

---

## Discriminated unions instead of error classes

This codebase prefers narrow union types over class hierarchies for failure
modeling. Example pattern:

```ts
type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string };

function parseSomething(input: string): ParseResult<Something> {
  if (!isValid(input)) return { ok: false, reason: 'malformed input' };
  return { ok: true, value: ... };
}
```

Caller code becomes a `switch` on `result.ok`, with TS exhaustiveness ensuring
both branches are handled. Compared to a thrown error, this:

- Stays in the type system (no need to remember to `try`).
- Is JSON-serializable (so it can cross the api/runner HTTP boundary).
- Doesn't require unwinding the stack.

---

## Forbidden patterns

- **`throw` for expected business outcomes.** Use a discriminated result
  shape.
- **`console.*` of any kind in shared.** Even error reporting. Caller decides.
- **Custom Error subclasses without a clear consumer branch.** Adds boilerplate;
  most callers only ever `instanceof Error` check.
- **Reading `process.env` in shared.** Take it as a parameter, like
  `agent-backend-cli.ts:51` does (`opts.env ?? {}`).
- **"Helpful" fallbacks in shared utils.** A fallback hides the failure;
  the consumer needs the failure to write the audit row. If a default makes
  sense, document why and which call site decides.
