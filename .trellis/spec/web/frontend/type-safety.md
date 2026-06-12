# Type Safety

> Type-safety conventions for `apps/web/`.

---

## TL;DR

- TypeScript strict mode is enabled at the workspace level.
- Cross-package types come from `@ainp/shared`.
- Web DTOs that mirror a shared entity are **derived** from it
  (Pick/Omit/Weaken/Optionalize) — never hand-copied as a parallel
  interface. See "Deriving DTOs from `@ainp/shared`".
- Web-private DTOs exist only for shapes with no shared source (api-private
  store/route shapes, redacted variants) and must carry a comment pointing
  at the api source they hand-align with.
- Validate every value that crosses a runtime boundary (URL, localStorage,
  fetch response) with a guard.

---

## Source-of-truth: `@ainp/shared`

The api's response shapes are defined in `packages/shared/src/types/`:

- `Project`, `WorkflowRun`, `WorkflowRequest`, `KnowledgeArtifact`, `Artifact`,
  `CommandRun`, `BuildRun`, `TestRun`, `GateRun`, `AgentTask`, `AgentResult`,
  `AgentStreamEvent`, `RouterRecommendation`, `RequirementEntity`,
  `DesignEntity`, `RequestMessage`, `CoordinatorDecision`.

The web SPA imports these directly:

```ts
import type { WorkflowRun, AgentStreamEvent, RouterRecommendation } from '@ainp/shared';
```

No node-only utility from `@ainp/shared` should be imported (the package
contains some, e.g. `agent-backend-cli.ts`, but those have node-side
defaults and are not safe for the browser). Stick to types and pure
constants like `STAGES` exported from `projection.ts`.

---

## Deriving DTOs from `@ainp/shared`

**Shadow DTOs must be derived from the shared entity, not hand-copied.**
A hand-copied parallel interface diverges silently the moment the api adds
or retypes a field; a derived type turns the same change into a web compile
error. The templates live in `apps/web/src/projection.ts`:

```ts
/** Explicitly weaken the K fields of T to plain string. Comment each use. */
export type Weaken<T, K extends keyof T> = Omit<T, K> & { [P in K]: string };
/** Demote the K fields of T from required to optional. Comment each use. */
export type Optionalize<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
```

The patterns, in order of preference:

```ts
// 1. Exact alias — the api serializes the shared entity verbatim.
export type WorkflowRequestDto = WorkflowRequest;

// 2. Pick — declare only what the SPA actually consumes.
export type BuildRunDto = Pick<BuildRun, 'id' | 'status' | 'jdkVersion' | 'mavenCommand'>;

// 3. Omit + additions — for genuinely different wire shapes (e.g. redaction).
export type ProjectDto = Omit<Project, 'sourceCredential'> & {
  /** API-added replacement for the redacted credential (routes/projects.ts:535). */
  hasSourceCredential?: boolean;
};

// 4. Weaken / Optionalize — every deliberate deviation is declared and commented.
export type ArtifactDto = Optionalize<Pick<Artifact, /* … */ 'metadata'>, 'metadata'>;
```

Rules:

- **Forbidden:** re-declaring a field list that parallels a shared entity.
  If the shape exists in `packages/shared/src/types/` (or
  `packages/shared/src/config/`), derive from it.
- Every `Weaken` / `Optionalize` use site carries a comment explaining *why*
  the deviation exists (legacy fixtures, historical comparison contract, …).
- Shapes with **no shared source** (api-private store/route shapes such as
  `ApprovalDto`, `RunnerDto`, `ProjectionConfigOverride`) stay hand-written,
  but must carry a comment naming the api source they hand-align with.
- `@ainp/shared/node` types are off-limits to the web (e.g.
  `DigestVerificationDto` stays a hand-aligned shadow).

---

## Web-private DTOs

When the web's view of a resource differs from the api's storage shape, the
SPA declares its own DTO — derived per the section above. Web DTOs live in
`apps/web/src/types.ts` (app-wide) or `apps/web/src/projection.ts`
(run-detail shapes). Don't copy the whole shape "just in case" — `Pick`
only what the SPA actually consumes; an explicit, narrow DTO makes
divergence obvious, and a shared-type change breaks the `Pick` key list at
compile time.

---

## Runtime validation

Values that cross a runtime boundary are `unknown` until proven otherwise.

### Fetch responses

```ts
const res = await fetch(`${API_BASE}/projects`);
if (!res.ok) throw new Error(`projects fetch ${res.status}`);
const body = (await res.json()) as { items: ProjectDto[] };
// body is typed; trust the api contract.
```

If the api's contract is uncertain (e.g., a new endpoint), narrow with a
guard before trusting.

### URL hash / query params

```ts
const page = decodeURIComponent(location.hash.slice(1));
if (isPage(page)) state.page = page;
else state.page = 'workbench';
```

`isPage` is the trust-boundary guard. Same pattern as the api uses for
`isFlowId` (see `apps/api/src/routes/workflow-runs.ts:23`).

### localStorage / sessionStorage

Always typed as `string | null`. Parse + validate explicitly:

```ts
const raw = localStorage.getItem('lastProject');
const projectId = raw && raw.startsWith('proj_') ? raw : null;
```

Don't `JSON.parse(localStorage.getItem('foo'))` and trust the result —
it might be `null`, a malformed string, or a value from an old format.

---

## `as const` narrowing

For literal arrays used in trust-boundary checks, use `as const`:

```ts
const PAGES = ['workbench', 'task', 'projects', 'new-task', 'reports', 'knowledge', 'settings'] as const;
type Page = (typeof PAGES)[number];

function isPage(value: unknown): value is Page {
  return typeof value === 'string' && (PAGES as readonly string[]).includes(value);
}
```

The `as const` narrows the array's type from `string[]` to the readonly
literal tuple. `(typeof PAGES)[number]` then derives the union — single
source of truth between runtime check and compile-time type.

---

## Discriminated unions

For state branches, prefer discriminated unions over flag combinations:

```ts
// ✅ GOOD
type LoadingState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: string };

// ❌ BAD
interface BadLoadingState<T> {
  isLoading: boolean;
  isError: boolean;
  data?: T;
  error?: string;
}
```

The discriminated form makes the renderer's switch exhaustive — TypeScript
flags missing branches.

---

## Optional vs nullable

Match the api's existing convention:

- `field?: string` — field may be missing entirely.
- `field: string | null` — field is always present, may be null.

The api side commits to one or the other per field; web should mirror.
Mixing them silently allows runtime `field == null` checks to be wrong.

---

## Forbidden patterns

- **`any`** in fetch return casts. Always declare the shape.
- **`@ts-ignore` / `@ts-expect-error`** to silence. Fix the type.
- **Redefining shared types locally** when `@ainp/shared` already exports
  them. Web-private DTOs only when the shape genuinely differs.
- **`as Foo` casts** without an `is*Foo()` guard backing them. The cast
  lies if the value isn't actually `Foo`.
- **Trusting URL fragments / search params without a guard.** Anyone can
  visit `#randomstring`.
- **`!` non-null assertion** on values that come from the DOM or fetch.
  `document.getElementById('x')!` is a runtime crash waiting; check or
  return early.
