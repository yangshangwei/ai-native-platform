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
│   ├── agent-backend-preflight.ts # Pure preflight logic
│   └── …
├── node/                          # Node-only helpers — `@ainp/shared/node` subpath
│   ├── index.ts                   # node/ barrel — NEVER re-exported from src/index.ts
│   ├── agent-backend-preflight.ts # Preflight execution shell (spawn-based)
│   └── digest.ts                  # sha256 file/buffer/combined-stream digests
└── config/
    ├── registry.ts
    ├── defaults.ts
    └── template.ts
```

---

## The shared rule

**No I/O. No side effects. No environment access.** The main entry of
`packages/shared/` must be importable from any layer (api server, runner CLI,
web SPA) without pulling in node-specific imports the consumer can't satisfy.
The one controlled exception is the `node/` subpath (see below), which is
physically isolated from the main barrel.

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

### `node/` — the node-only subpath (`@ainp/shared/node`)

Controlled exception to the zero-I/O rule, exported via package.json
`"./node": "./src/node/index.ts"` (precedent: the FLOW_REGISTRY relocation
to shared; decided in task 06-12-dedupe-preflight-and-digest-via-shared-
node-subpath). Code here may import `node:child_process`, `node:crypto`,
`node:fs`, and read `process.env`.

**Admission criteria — both must hold:**

1. The code genuinely needs node built-ins (spawn, fs, crypto streams) and
   cannot be expressed as a pure helper taking injected inputs.
2. It is consumed by **both** `apps/api/` and `apps/runner/`. Single-consumer
   I/O code stays in the app that owns it.

**Red lines:**

- `src/index.ts` (the main barrel) must NOT re-export anything from
  `src/node/`. The main barrel is bundled into the web SPA; one `node:*`
  import breaks the Vite build.
- `apps/web/` must NOT import `@ainp/shared/node`. Typecheck does NOT catch
  this: the workspace symlink under `apps/web/node_modules` lets TypeScript
  resolve the subpath via package.json `exports` even without a tsconfig
  paths mapping. The guard is
  `packages/shared/test/node-subpath-redline.test.ts`, which also asserts
  the main barrel stays free of `node/` re-exports.
- Pure logic does not belong here. Keep classification/parsing in `utils/`
  (e.g. `utils/agent-backend-preflight.ts`) and only the execution shell in
  `node/` (e.g. `node/agent-backend-preflight.ts`).

Current residents: `node/agent-backend-preflight.ts` (CLI preflight spawn
shell shared by api routes and runner backend selection) and
`node/digest.ts` (sha256 file/buffer digests plus the
`sha256CombinedStreams` separator contract referenced by
`types/command.ts:combinedSha256`).

Resolution wiring when adding consumers: `@ainp/shared/node` path mapping in
the consumer's tsconfig and the `@ainp/shared/node` alias in the root
`vitest.config.ts` (it must stay listed before `@ainp/shared`).

### `config/`

Defaults and template config used by both api and runner. `registry.ts`
declares the keys; `defaults.ts` provides starter values; `template.ts` is
the user-facing template.

### `index.ts` — the barrel

Every public symbol must be re-exported here, in topic order matching the
filesystem layout — **except `node/`**, which has its own barrel
(`node/index.ts`) exposed only via the `@ainp/shared/node` subpath.
Consumers always do
`import { Foo } from '@ainp/shared'`, never deep imports like
`import { Foo } from '@ainp/shared/src/types/foo'`. Reason: keeps the public
surface explicit and ensures circular-import detection runs against the
barrel rather than ad-hoc paths.

---

## Cross-package usage

`packages/shared/` is consumed by:

- `apps/api/` — server-side types, FLOW_REGISTRY, utils, `@ainp/shared/node`.
- `apps/runner/` — same plus subprocess argv helpers.
- `apps/web/` — types only via the main entry (never `@ainp/shared/node`;
  any node-touching util would break the Vite build).

`packages/shared/` MUST NOT depend on:

- `apps/api/`
- `apps/runner/`
- `apps/web/`
- Any node-only package, react/vue, vite, hono, bun:sqlite.

If a future shared util genuinely needs to do I/O, it goes in `src/node/`
(when it meets the admission criteria above) or stays in the layer that owns
the I/O surface — never in the main entry.

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
  (Exception: `src/node/`.)
- **`fs` / `child_process` / `bun:sqlite` / `fetch` imports.** No I/O.
  (Exception: `fs`/`child_process`/`crypto` inside `src/node/` only.)
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
