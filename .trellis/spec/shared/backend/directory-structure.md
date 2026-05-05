# Directory Structure

> Module layout for `packages/shared/`.

---

## Top-level layout

```
packages/shared/src/
├── index.ts                       # Barrel — every public export comes through here
├── types/                         # Zero-runtime type definitions
│   ├── ids.ts
│   ├── project.ts
│   ├── workflow.ts                # WorkflowRun, WorkflowStage, FlowId, …
│   ├── artifact.ts
│   ├── knowledge-entity.ts
│   ├── dual-write.ts
│   ├── command.ts
│   ├── gate.ts
│   ├── build.ts
│   ├── agent.ts
│   ├── agent-event.ts
│   ├── execution-environment.ts
│   ├── skill.ts
│   ├── coordinator.ts
│   ├── request-message.ts
│   └── router.ts                  # RouterInput, RouterRecommendation
├── flows/
│   └── registry.ts                # Canonical FLOW_REGISTRY (W2-4 relocation)
├── utils/                         # Pure helpers — no I/O, no state
│   ├── id.ts                      # newId(), nowIso(), slugify
│   ├── whitelist.ts               # COMMAND_WHITELIST + isWhitelisted
│   ├── surefire.ts                # Surefire XML parser
│   ├── redaction.ts               # Secret-scrubbing helpers
│   ├── agent-backend-cli.ts       # Cross-platform CLI argv contract
│   └── agent-backend-preflight.ts # Pure preflight logic
└── config/
    ├── registry.ts
    ├── defaults.ts
    └── template.ts
```

---

## The shared rule

**No I/O. No side effects. No environment access.** `packages/shared/` must
be importable from any layer (api server, runner CLI, web SPA) without
pulling in node-specific imports the consumer can't satisfy.

In practice:

- ❌ `import 'node:fs'`
- ❌ `import 'node:child_process'`
- ❌ `import 'bun:sqlite'`
- ❌ `process.env.X` reads (take env as a parameter; see
  `agent-backend-cli.ts:51-58` where `opts.env` is injected, not read from
  `process.env`)
- ❌ `console.*`
- ❌ `fetch(...)`
- ❌ `import 'react' / 'vue'` — there's no UI here

The one exception is `globalThis` introspection for cross-runtime defaults,
e.g. `agent-backend-cli.ts:143-146`:

```ts
function defaultPlatform(): string {
  const maybeGlobal = globalThis as { process?: { platform?: string } };
  return maybeGlobal.process?.platform ?? 'linux';
}
```

That's a graceful runtime-detection fallback — it doesn't import `node:*` or
`process` directly, and it has a default. Use this pattern only when truly
necessary.

---

## Where things go

### `types/<topic>.ts`

One file per cohesive type cluster. The file owns the type, its `Kind`
union, the `is<Kind>` guard, and any narrow helpers. Examples:

- `types/agent.ts` — `AgentBackendKind`, `ProjectAgentBackendKind`,
  `isProjectAgentBackendKind` guard.
- `types/workflow.ts` — `WorkflowStage`, `FlowId`, `WorkflowRunStatus`,
  `WorkflowRunType`.
- `types/router.ts` — `RouterInput`, `RouterRecommendation`.

Don't create utility types in random files; if a type is general (e.g.
`MapLike<T>`), it belongs at top of the relevant feature file or in `ids.ts`.

### `flows/registry.ts`

Canonical `FLOW_REGISTRY` post-W2-4. Both `apps/api/src/router.ts` and
`apps/runner/src/orchestrator.ts` import from here (the runner has a re-
export shim at `apps/runner/src/flows/registry.ts` for backwards
compatibility). Adding a new flow means a new `FlowDef` entry here, plus
type extension in `types/workflow.ts:FlowId`.

### `utils/<topic>.ts`

Pure helpers. Each file owns one concept:

- `id.ts` — id generation (`newId(prefix)`), timestamps (`nowIso()`),
  slugifying.
- `whitelist.ts` — the 8-pattern command whitelist used by
  `apps/runner/src/command-runner.ts`. Adding a command pattern is a spec-
  level decision (review for command-injection safety).
- `agent-backend-cli.ts` — `resolveAgentBackendCliBin`,
  `buildResolvedAgentBackendCliSpawn`. The cross-platform argv contract
  shared by api preflight and runner spawning.

### `config/`

Defaults and template config used by both api and runner. `registry.ts`
declares the keys; `defaults.ts` provides starter values; `template.ts` is
the user-facing template.

### `index.ts` — the barrel

Every public symbol must be re-exported here, in topic order matching the
filesystem layout. Consumers always do
`import { Foo } from '@ainp/shared'`, never deep imports like
`import { Foo } from '@ainp/shared/src/types/foo'`. Reason: keeps the public
surface explicit and ensures circular-import detection runs against the
barrel rather than ad-hoc paths.

---

## Cross-package usage

`packages/shared/` is consumed by:

- `apps/api/` — server-side types, FLOW_REGISTRY, utils.
- `apps/runner/` — same plus subprocess argv helpers.
- `apps/web/` — types only (any util that touches node would break the Vite
  build).

`packages/shared/` MUST NOT depend on:

- `apps/api/`
- `apps/runner/`
- `apps/web/`
- Any node-only package, react/vue, vite, hono, bun:sqlite.

If a future shared util genuinely needs to do I/O, it doesn't belong in
shared — push it to the layer that owns the I/O surface.

---

## File-naming conventions

Same as the rest of the monorepo: `kebab-case.ts` for modules,
`<file>.test.ts` for tests next to the file. Type files take the singular
form when they own one main type (`workflow.ts` owns the WorkflowRun
cluster), pluralized form for collections (`flows/registry.ts` owns the
FLOW_REGISTRY).

---

## Forbidden patterns

- **`process.env` reads.** Take env as a parameter; let callers decide.
- **`fs` / `child_process` / `bun:sqlite` / `fetch` imports.** No I/O.
- **`console.log` / `console.error`.** Pure code is silent; callers decide
  what to log.
- **Importing from `apps/*`.** Inverts the dependency direction and creates
  a cycle.
- **Deep imports from consumers.** Consumers always go through the barrel
  `@ainp/shared`. Internally within `packages/shared/src/`, files may
  import their siblings directly with relative paths.
- **Adding a util that's only used by one consumer.** If only `apps/runner/`
  uses it, it lives in `apps/runner/src/`. Shared is for genuinely cross-
  cutting code.
