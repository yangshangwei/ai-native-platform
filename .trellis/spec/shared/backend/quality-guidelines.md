# Quality Guidelines

> Code standards specific to `packages/shared/`.

---

## Pre-commit gate

```bash
bun test
bun run typecheck
```

Shared is the most-cross-coupled package: a breaking change here ripples to
api, runner, and web simultaneously. Run BOTH commands. A type tweak that
typechecks alone might fail at the runner-side or web-side because the
generic parameter is used differently.

When you change a public type, grep for its identifier across the workspace:

```bash
grep -rn "WorkflowRun" apps/ packages/
```

---

## Test placement

Co-located. `whitelist.test.ts` next to `whitelist.ts`, `surefire.test.ts`
next to `surefire.ts`, etc. Tests run via `bun test` from repo root.

Type-only files (`types/*.ts`) usually don't have tests — the type system IS
the test. If you add a runtime guard (`is*()` predicate), the guard SHOULD
have a test that proves it accepts the union members and rejects nearby
strings.

---

## Naming

| What | Convention | Example |
|---|---|---|
| Type / interface | `PascalCase` | `WorkflowRun`, `RouterInput` |
| Type alias for union | `PascalCase` | `WorkflowStage`, `FlowId` |
| Type guard | `is<Type>` | `isProjectAgentBackendKind`, `isFlowId` |
| Pure function | `camelCase` | `newId`, `isWhitelisted`, `agentBackendDefaultBin` |
| Constant | `SCREAMING_SNAKE` | `COMMAND_WHITELIST`, `FLOW_REGISTRY`, `KNOWLEDGE_LIMIT` |
| File | `kebab-case.ts` | `agent-backend-cli.ts`, `request-message.ts` |

Type files take the topic as filename: `workflow.ts`, `router.ts`,
`request-message.ts`. Plurals only for collections (`flows/registry.ts`).

---

## Type-first design

Every public export should have an exported type. Examples in
`agent-backend-cli.ts`:

```ts
export type AgentBackendCliPurpose = 'version' | 'claude_auth_status' | 'codex_login_status';
export interface AgentBackendCliResolveOptions { ... }
export interface AgentBackendCliSpawnOptions extends AgentBackendCliResolveOptions { ... }
export interface AgentBackendCliSpawn { ... }
export function agentBackendEnvKey(backend: ProjectAgentBackendKind): 'AINP_CLAUDE_BIN' | 'AINP_CODEX_BIN'
export function buildAgentBackendCliSpawn(...): AgentBackendCliSpawn
```

Reason: shared is the type contract between api / runner / web. If you
export a function whose return type is inferred-only, consumers can't refer
to it cleanly. **Annotate the return type explicitly** for any non-trivial
public function.

---

## Barrel discipline (`index.ts`)

Every public symbol must be re-exported from `packages/shared/src/index.ts`:

```ts
export * from './types/ids';
export * from './types/project';
export * from './types/workflow';
// ...
export * from './flows/registry';
// ...
export * from './utils/id';
export * from './utils/whitelist';
// ...
```

Adding a new file:

1. Write the file with named exports only (no `export default`).
2. Add a matching `export * from './path'` line in `index.ts`.
3. Verify `bun run typecheck` passes — name collisions in the barrel
   surface here.

---

## Purity

Every export must be a pure function or a pure data definition:

- `types/*.ts` — pure type declarations. Zero runtime cost.
- `flows/registry.ts` — pure data. `FLOW_REGISTRY[flowId]` returns the
  same `FlowDef` every time.
- `utils/*.ts` — pure functions. `newId('proj')` reads no I/O (it generates
  randomness, but doesn't touch the filesystem or env).
- `config/*.ts` — pure constants and defaults.

If a function genuinely needs to read env, accept the env as a parameter:

```ts
// packages/shared/src/utils/agent-backend-cli.ts:51-58
export function resolveAgentBackendCliCandidates(
  backend: ProjectAgentBackendKind,
  opts: AgentBackendCliResolveOptions = {},
): string[] {
  const platform = opts.platform ?? defaultPlatform();
  const env = opts.env ?? {};
  // ...
}
```

The `opts.env ?? {}` lets the api preflight pass `process.env` and the
runner pass a custom test env, without shared reading the global itself.

---

## Anti-patterns this team has hit

### 1. Type extension protocol

> Reference: archived task `05-04-v2-artifact-kind-expansion`.

Adding `KnowledgeArtifactKind` cases (e.g. splitting per-run vs. knowledge
artifacts) needs to ripple to: api store mapping, api migrations, api routes
that filter, runner orchestrator that emits, web UI that displays, AND any
literal trust-boundary list in route guards. **When adding a union member
to a shared type**, the task should explicitly enumerate every consumer in
the PRD. The task `05-04-v2-artifact-kind-expansion` documents the
ripple-list pattern.

### 2. FLOW_REGISTRY relocation (W2-4)

> Reference: archived task `05-05-v2-w2-4-smart-router`.

The original `FLOW_REGISTRY` lived in `apps/runner/src/flows/registry.ts`.
W2-4 needed the api side (`router.ts`) to read it without reaching across
package boundaries, so the registry was relocated to
`packages/shared/src/flows/registry.ts` and the runner-side file became a
re-export shim. **Lesson**: a type that two layers need is by definition a
shared type. Don't fight that with re-export gymnastics — relocate.

---

## Forbidden patterns

- **`any`** in any public type. Internal `any` is sometimes unavoidable
  (JSON parsing) but never exposed.
- **`console.*` / `process.env` reads / `node:fs` / `bun:sqlite` /
  `child_process`.** See `directory-structure.md` § The shared rule.
- **`import 'react' / 'vue' / 'hono'`.** Shared has no UI / server framework
  dependency.
- **Deep imports across packages** (`@ainp/shared/src/types/foo`).
  Consumers go through the barrel.
- **`export default`.** Use named exports — they integrate with `export *`
  re-export and are searchable by name.
- **Adding a single-consumer util to shared.** Used by only one app? Lives
  in that app.
- **Forgetting to re-export from `index.ts`.** A new file that's not in the
  barrel is invisible to consumers via `@ainp/shared`.
