# Completion Summary

## Shipped

Implemented V1.1 calibration and noise reduction for legacy-project
understanding.

- Filtered package scripts so scanner keeps all scripts in `commands`, but only
  runtime/operator scripts become CLI capability entrypoints.
- Expanded route detection across Express/Hono/Fastify-style calls,
  `fastify.route({ method, url })`, Flask/FastAPI decorators, Go router and
  `http.HandleFunc` patterns, Rails-style routes, Spring/Nest-style mappings,
  Laravel/PHP `Route::get/post/...`, Django `path(...)` / `re_path(...)`,
  ASP.NET `[Route]` / `[HttpGet]` controller attributes, and Next.js App
  Router `app/api/**/route.ts` files.
- Added conservative Symfony YAML route extraction for static
  `app/config/routing.yml` / `config/routes.yaml` route blocks with literal
  route paths and literal bundle/FQCN controller targets, while leaving
  placeholders, imports, service-container routes, annotations, bundle imports,
  callbacks, and DI/runtime routing out of scope.
- Added Rails same-file static `scope "/prefix" do` route prefix handling, with
  source refs for both the scope line and the nested route line.
- Reduced job/queue noise by requiring line-level scheduling/queue evidence
  instead of repeatedly creating entries from worker-like path hints.
- Improved capability grouping so generic prefixes like `api`, `v1`, and `v2`
  are skipped when deriving labels such as `Orders API`.
- Added regression fixtures covering the calibrated route patterns, script
  filtering, queue dedupe, and capability labels.

Implemented the first V1.2 TypeScript/JavaScript parser-backed symbol graph
slice.

- Added additive `imports`, `exports`, and `symbolGraph` fields to
  `project-inventory.json`.
- Used the TypeScript compiler API through an optional dynamic import, so the
  runner falls back to heuristic extraction if the parser is unavailable.
- Extracted TS/JS imports, exported declarations, class methods, and function
  references from AST nodes.
- Added graph nodes for inventory entrypoints and symbols.
- Added graph edges for route -> handler and handler -> referenced service or
  method symbols when AST evidence can resolve them.
- Extended TS/JS route-handler graph resolution to follow local import/export
  evidence when a route callback is imported from a controller/module. Imported
  handler edges now cite the route line, import line, and resolved exported
  handler symbol instead of falling back to loose same-name method matches.
- Extended TS/JS symbol-reference graph resolution to follow local import/export
  evidence for imported services. Handler -> service edges now cite the call
  site, import line, and resolved exported service symbol before same-file
  fallback, and constructed service method calls no longer add noisy bare
  method-name edges when the constructed receiver is already known.
- Extended TS/JS route-handler graph resolution for default-imported handlers.
  Default imports now resolve through `export default function ...` and
  `export default <identifier>` evidence, so route-handler edges cite the route
  line, default import line, default export line, and resolved handler symbol
  instead of missing common controller modules.
- Extended Next.js App Router re-export handling for route files that use
  `export { GET, POST } from "./orders-handler"`. The scanner now emits one
  HTTP entrypoint per exported method and links each route-handler edge to the
  matching exported handler symbol in the target file with route and handler
  source refs.
- Extended Next.js App Router re-export handling to parser-backed multiline
  route files such as `export { GET, POST } from "./orders-handler"` split
  across several lines. The scanner now uses `InventoryExport` evidence for
  named re-exports instead of adding brittle multiline regex scanning.
- Extended Next.js App Router exported-const alias handling for route files
  such as `import { listOrders } from "./orders-handler"; export const GET =
  listOrders;`. The scanner now records the alias as import-backed export
  evidence and links the route-handler edge to the source handler symbol
  instead of stopping at the route-file `GET` const.
- Extended Next.js App Router local alias export handling for route files such
  as `async function listOrders() { ... } export { listOrders as GET };`.
  AST export evidence now creates the route entrypoint and links the
  route-handler edge to the local handler symbol.
- Extended Next.js App Router locally exported const alias handling for route
  files such as `import { listOrders } from "./orders-handler"; const GET =
  listOrders; export { GET };`. The scanner now records the const initializer
  as import-backed export evidence and links the route-handler edge to the
  source handler symbol instead of stopping at the local `GET` const.
- Extended that alias handling when the local const name differs from the
  exported HTTP method, such as `const handler = listOrders; export { handler
  as GET };`. Local named exports now preserve the `localName -> exportedAs`
  mapping so resolver evidence targets `GET` rather than the local helper
  variable name.
- Extended exported-const alias handling through one conservative local const
  alias hop, such as `const handler = listOrders; export const GET = handler;`.
  The scanner now records top-level identifier initializer aliases and uses
  them only when they point back to imported handler evidence.
- Extended local export handling for imported bindings, such as
  `import { listOrders } from "./orders-handler"; export { listOrders as GET
  };`. Export declarations without a `from` specifier now consult static
  import evidence before falling back to unresolved local re-export evidence.
- Extended TS/JS route-handler graph resolution for namespace-imported
  handlers such as `OrdersController.show`. Namespace property-access route
  callbacks now resolve to the exported member symbol and route-handler edges
  cite the route line, namespace import line, and resolved handler source ref
  instead of stopping at the namespace object or falling back to same-file
  handlers.
- Extended conservative non-TS receiver graph coverage for Rails/Ruby explicit
  constructed receivers such as `service = ReportService.new` and
  `repository = ReportRepository.new`. Ruby controller/service/repository
  chains now produce source-ref backed `symbol_reference` edges without
  inferring dynamic dispatch, autoloading, DI containers, factories, or runtime
  wiring.
- Extended conservative non-TS receiver graph coverage for Flask/Python
  explicit constructed receivers such as `service = BillingService()` and
  `repository = BillingRepository()`. Python handler/service/repository chains
  now produce source-ref backed `symbol_reference` edges without inferring
  Python imports, dataflow, dynamic dispatch, DI containers, factories, or
  runtime wiring.
- Extended Express/Fastify-style shorthand route extraction for middleware
  chains such as `router.get(path, auth, OrdersController.show)`. The scanner
  now treats the final simple callback argument as the route handler, preserves
  named and namespace import graph resolution, and refuses to fall back to
  middleware when the final callback is an inline or otherwise complex
  expression.
- Added Express `router.route(path).get(...).patch(...).delete(...)` chain
  extraction. The scanner emits one HTTP route per chained method, links final
  simple callback handlers through existing import/export-backed symbol graph
  resolution, and avoids creating route-handler edges to middleware or inline
  final callbacks.
- Added array middleware-chain handler extraction for Express/Fastify-style
  route calls and Express route chains. The scanner now recognizes final simple
  callbacks inside inline array arguments such as
  `router.get(path, [auth, validate, OrdersController.index])` and
  `router.route(path).patch([auth, validate, OrdersController.update])`, while
  leaving inline or complex final callbacks unresolved and avoiding
  route-handler edges to middleware.
- Added same-file static mount prefix extraction for Express router variables.
  The scanner now recognizes `Router()` / `express.Router()` variables mounted
  through static `.use("/prefix", routerVar)` calls, applies that prefix to
  direct route calls and `router.route(...).method(...)` chains, carries route
  and mount source refs, and keeps dynamic prefixes, cross-file mounts, and
  non-direct router args unresolved instead of guessing.
- Tightened Express mount prefix extraction so arbitrary objects with a
  `.use(...)` method do not create fake prefixed routes. Mount extraction now
  records the `.use` receiver and accepts only detected Express app/router
  variables or existing conventional route receiver names.
- Extended CommonJS default object-literal exports such as
  `module.exports = { OrdersService }` and
  `module.exports = { orders: OrdersService }`. The scanner now marks the
  referenced local object symbol as exported before AST method collection, so
  static object methods are available for route -> controller -> service ->
  repository graph edges without treating those methods as fake top-level
  exports.

Implemented the first V1.3 task-time ContextPack retrieval slice.

- Parsed current-run `project-inventory.json` input artifacts inside the
  ContextPack builder.
- Parsed governed historical inventory knowledge artifacts that embed
  `ainp.project_inventory.v1` content, so task-time retrieval can reuse a
  supplied prior scan when the current invocation has no inventory input.
- Converted task-matched capability map evidence into `code_probe` sections.
- Attached relevant symbols, test surfaces, and hotspots from the matched
  capability.
- Filtered generic task tokens such as `api` and `test` so unrelated
  capabilities are not selected solely because they share framework vocabulary.
- Tightened inventory capability match text so encoded record ids, same-file
  paths, test paths, hotspot paths, and source refs do not select unrelated
  capabilities from the same legacy route file.
- Added intra-capability focus tokens for task-time ContextPack narrowing, so
  already-selected multi-entrypoint capabilities can use action words such as
  `update` to prefer the PATCH/update handler chain over sibling GET/show
  routes without broadening global capability matching.
- Generalized those focus-only action tokens to cover `create`, `delete`,
  `destroy`, `remove`, `show`, and `update`, while keeping those verbs and
  their inflected variants out of global capability matching unless other
  business/source evidence selects the capability first.
- Excluded CLI script handler command text from capability search text, so
  operator scripts that mention source paths such as `orders-route.ts` do not
  re-select weak CLI capabilities for API-domain tasks.
- Kept historical inventory knowledge artifacts out of normal `knowledge_*`
  rendering, so raw inventory JSON is not injected as prose context.

Implemented the first V1.4 visualization and correction slice.

- Rendered the latest profile-bootstrap `project-inventory.json` as a compact
  project-page capability map when the matching run detail is loaded.
- Exposed capability confidence plus entrypoint, symbol, test, and hotspot
  evidence directly from the inventory artifact cache.
- Added accept, rename, merge, and mark-wrong actions for scanned
  capabilities.
- Persisted capability corrections as draft `explore` knowledge artifacts with
  `correctionKind='project_capability_map'`, `reviewStatus='needs_review'`,
  inventory/source refs, and original/corrected label metadata.
- Added the first durable correction feedback path for accepted governed
  corrections: accepted/non-review-required rename and merge metadata can
  annotate and match later inventory-driven ContextPack `code_probe` sections,
  while accepted mark-wrong metadata suppresses the heuristic capability and
  leaves source-backed hybrid inventory evidence available.
- Annotated source-level fallback evidence after accepted mark-wrong
  corrections. Hybrid and source chunk `code_probe` sections that remain
  useful after a capability grouping is suppressed now carry the correction
  artifact/source refs and correction review text for auditability.
- Locked the governance boundary with regression coverage so draft or
  review-required capability-map corrections do not rename, match, or suppress
  inventory capabilities before review is complete.
- Added Trellis-check regression coverage for accepted merge corrections, so
  merge targets can match and annotate capability `code_probe` sections without
  rendering the correction artifact as standalone knowledge.
- Reconciled implementation with the no-encoded-id matching contract: capability
  primary match text no longer includes internal inventory record ids, and a
  regression test now proves an encoded id alone cannot select a capability.

Implemented the first V2 hybrid retrieval slice.

- Added deterministic BM25-style lexical retrieval over current-run inventory
  entrypoints, symbols, tests, hotspots, and symbol graph edges.
- Kept capability matches as the primary graph lookup and used hybrid retrieval
  to supplement misses.
- Kept hybrid retrieval output as source-ref backed `code_probe` ContextPack
  sections; raw `project-inventory.json` remains a foundation input and is not
  injected as normal context.
- Matched hybrid retrieval graph edges against the scanner's real
  `node_entrypoint_*` / `node_symbol_*` symbolGraph endpoints as well as raw
  record ids, so selected symbol evidence can carry graph-edge source refs from
  actual `project-inventory.json` output.
- Treated symbol graph edge labels as first-class hybrid retrieval records, so
  call-site terms that only appear on an edge can select source-ref backed
  hybrid evidence and graph-pointed source chunks without requiring a matching
  capability, symbol, test, or hotspot record.
- Added a bounded `sourceChunks` contract to `project-inventory.json` using
  snippets from scanner-safe source/test files, with links back to entrypoints,
  symbols, tests, hotspots, and capabilities when available.
- Extended source chunks with graph-edge backlinks, so call-site chunks can
  cite the `symbolGraph` edge that made them relevant and ContextPack hybrid
  retrieval can select those chunks through graph evidence rather than snippet
  text alone.
- Taught ContextPack to select source chunk evidence only as supplemental
  `code_probe` sections when task terms match a source snippet or when selected
  hybrid inventory evidence points to the chunk.
- Ranked graph/inventory-pointed source chunks ahead of broad lexical-only
  source chunks before applying the tight source chunk cap, so call-site
  evidence selected through `symbolGraph` edges is not displaced by noisy
  snippets that merely repeat task terms.
- Added explicit task source-ref hint handling for source chunks. Task briefs
  that name a bounded source ref such as `file:apps/api/src/payments.ts#L20`
  can now select the matching `sourceChunks` record, rank that exact source-ref
  match first, and render/cite only the referenced line when available.
- Source chunk lexical matching now strips generated `L<number>:` prefixes
  before scoring, so synthetic line labels do not pull unrelated chunks into
  context merely because they share a line number.
- Source chunk lexical ranking now uses BM25-style scoring over the stripped
  snippet search terms and renders a `BM25 score` audit line for selected
  lexical chunks, while graph/source-ref/content-hash priority remains intact.
- Added small lexical normalization for task-time inventory matching so common
  CRUD verb forms such as `deleting` / `deleted` can match source chunk tokens
  such as `deleteOrder`, while preserving the existing generic-token and
  source-ref exclusion boundaries.
- Preserved capability-map primacy: matched capabilities remain priority-1
  evidence, while source chunks are priority-2 source support and never render
  as normal `input_*` or `knowledge_*` sections.
- Added regression coverage for relevant chunk selection, unrelated chunk
  exclusion, sensitive chunk exclusion, hybrid-pointer chunk selection, raw
  inventory omission, and capability-primary behavior.
- Added a default deterministic eval scenario,
  `eval/scenarios/legacy-project-understanding.json`, that measures the
  inventory-driven ContextPack path before real RAG expansion:
  capability-map primary selection, unrelated capability exclusion, raw
  inventory exclusion, and hybrid symbol/test fallback with scanner-real
  `node_symbol_*` graph edge source refs.
- Extended the default deterministic eval scenario with a graph-edge-backed
  source chunk selected through `graphEdgeRefs`, so the refund/reconciliation
  fallback path proves source chunk retrieval can follow symbol graph evidence
  rather than snippet lexical matches alone.
- Extended that deterministic eval with a historical-inventory variant that
  omits current-run `project-inventory.json` input and selects Orders API
  evidence from a governed inventory knowledge artifact.
- Added runner-side discovery of the latest prior per-run
  `project-inventory.json` artifact when the current invocation has no current
  inventory input and no governed inventory knowledge artifact. The discovered
  artifact is passed to ContextPack as invocation-local `code_probe` evidence,
  cached in `RunCtx.contextFoundation`, and is not added to normal
  `c.inputs`.
- Added a default scanner-to-context e2e eval scenario,
  `eval/scenarios/legacy-project-understanding-e2e.json`, that writes a
  temporary mini legacy project, runs real `buildProjectInventory()`, injects
  the generated `project-inventory.json`, then runs real `buildContextPack()`.
  This caught and now guards against same-file unrelated capability selection
  such as an Orders task pulling in Payments API evidence.
- Extended the scanner-to-context e2e eval harness and fixture expectations to
  assert scanner-generated source chunks carry `graphEdgeRefs` and that the
  refund/reconciliation variant selects the scanner-produced source chunk
  section.
- Extended the default polyglot scanner-to-context eval fixture with
  Flask/Python handler -> service -> repository, Rails/Ruby controller ->
  service -> repository, and Laravel/PHP controller -> service -> repository
  chains, and isolated Rails service/repository fixture paths from Laravel
  `app/Services` / `app/Repositories` paths so source-ref expectations remain
  deterministic on case-sensitive and case-insensitive filesystems.
- Extended the Rails polyglot scanner-to-context fixture to use a static
  `scope "/api/v1" do` route, preserving the final
  `GET /api/v1/reports/daily` entrypoint while requiring both scope and route
  source refs.

Implemented the P5-12 source-ref backed data-layer table reference slice.

- Added conservative static table-name reference detection for source-like
  non-test files, limited to exact table-name literals and SQL text contexts.
- Added `referenceSourceRefs` to scanned SQL table domain entities and threaded
  those refs into source chunk anchoring, source chunk indexes, capability
  source refs, and ContextPack inventory matching.
- Kept the behavior static-only: no live database access, ORM/runtime
  inference, or dynamic SQL reconstruction.
- Extended ContextPack rendering and eval expectations so table-focused tasks
  retrieve the repository/service code chunk that names the table, while raw
  `project-inventory.json` remains foundation input and sibling data domains
  stay excluded.

## Verified

Commands run successfully:

```bash
git diff --check
```

```bash
python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap
```

```bash
bun run test -- apps/web/test/projects-rendering.test.ts apps/api/test/knowledge-artifacts-route.test.ts apps/runner/test/context-builder.test.ts
```

```bash
bun run test -- apps/runner/test/project-inventory.test.ts
```

```bash
bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/orchestrator-profile-bootstrap.test.ts apps/runner/test/context-builder.test.ts packages/shared/test/flow-registry.test.ts apps/runner/test/flow-registry.test.ts apps/api/test/workflow-request-routes.test.ts apps/api/test/report-sidecars.test.ts apps/web/test/projects-rendering.test.ts
```

```bash
bun run typecheck
```

```bash
bun run test
```

```bash
bun run eval
```

Latest focused verification after the graph-edge source-ref fix passed: 4 test
files / 57 tests. Latest profile-bootstrap regression bundle passed: 9 test
files / 144 tests. Latest full-suite verification passed: 107 test files / 932
tests. Latest default eval suite after adding the legacy understanding scenario
passed: 9 scenarios / 21 variants.

Latest Ralph continuation evidence:

- Context snapshot:
  `.omx/context/legacy-project-understanding-evolution-roadmap-20260701T001113Z.md`.
- Trellis task validation passed.
- `git diff --check` passed.
- Focused regression passed: 4 test files / 57 tests.
- `bun run typecheck` passed.
- Latest inventory scanner regression passed: 1 test file / 37 tests.
- Latest default eval suite passed: 14 scenarios / 37 variants.

Latest Rails static scope continuation evidence:

- Focused Rails route calibration passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "calibrates route patterns"`.
- Inventory scanner regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` (37 tests).
- `bun run typecheck` passed.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  (14 scenarios / 37 variants).
- Focused scanner/context/API/UI regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts apps/web/test/projects-rendering.test.ts apps/api/test/knowledge-artifacts-route.test.ts`
  (4 test files / 105 tests).
- Full suite passed: 107 test files / 932 tests.
- Changed-files-only deslop review found no safe cleanup edits to make after
  the graph-edge source-ref fix; LSP/tsc diagnostics reported 0 errors for
  `apps/runner/src/context/builder.ts` and
  `apps/runner/test/context-builder.test.ts`.
- Post-deslop focused regression passed again: 4 test files / 57 tests.
- Latest Express route-chain continuation evidence:
  focused inventory/context regression passed with 2 test files / 41 tests;
- Latest Next.js App Router no-alias re-export continuation evidence:
  focused project-inventory regression passed with 1 test file / 25 tests.
  `bun run --filter @ainp/runner typecheck` passed; Trellis task validation
  passed; LSP/tsc diagnostics reported 0 errors for
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts`; direct CR/trailing whitespace
  scan was clean. Trellis-check found no fixed or unfixed defects, and no lint
  script exists in root or package `package.json` files.
- Latest array middleware-chain continuation evidence:
  focused inventory/context regression passed with 2 test files / 42 tests;
  `bun run --filter @ainp/runner typecheck` passed; direct CR/trailing
  whitespace scan was clean for the touched scanner and test files.
  Trellis-check found no fixed or unfixed defects, confirmed inline/complex
  final callbacks stay unresolved, and found no lint script in workspace
  `package.json` files.
- Latest multiline Next.js App Router re-export continuation evidence:
  focused project-inventory regression passed with 1 test file / 26 tests;
  `bun run typecheck` passed. Trellis-check then found and fixed one adjacent
  Express mount false-positive where arbitrary `.use("/prefix", routerVar)`
  receivers could create fake routes; post-fix focused project-inventory
  regression passed again with 1 test file / 26 tests;
  `bun run --filter @ainp/runner typecheck` passed; `git diff --check` passed;
  Trellis task validation passed; LSP/tsc diagnostics reported 0 errors for
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts`. Root `package.json` has no
  lint script, so lint was not run.
- Latest mounted Express router continuation evidence:
  focused inventory/context regression passed with 2 test files / 43 tests;
  `bun run --filter @ainp/runner typecheck` passed; direct CR/trailing
  whitespace scan was clean for the touched scanner and test files.
  Trellis-check fixed a route-chain false positive where arbitrary
  `receiver.route("/x").get(...)` calls could be accepted without the same
  Express receiver / known mounted-router guard used by direct route calls.
- Default eval suite passed after adding deterministic legacy-project
  understanding coverage: 9 scenarios / 21 variants.
- External architect verification was attempted but could not be counted:
  `omx explore` failed because both configured models returned provider 404,
  and `omx ask claude --agent-prompt architect` failed before analysis due CLI
  argument wrapping. The current sign-off evidence is therefore local static
  diagnostics plus focused/typecheck/full-suite tests, not an external
  architect approval.

Fresh Ralph hook verification after the legacy eval scenario was added:

- Trellis task validation passed.
- Default eval suite passed: 9 scenarios / 21 variants.
- Red eval suite failed as expected: 5 scenarios / 5 variants failed, command
  exit code 1.
- Focused runner tests passed: 2 test files / 24 tests.
- `bun run typecheck` passed.
- `git diff --check` passed.
- LSP/tsc diagnostics reported 0 errors for
  `apps/runner/src/context/builder.ts` and
  `apps/runner/test/context-builder.test.ts`.

Fresh verification after adding the scanner-to-context e2e legacy eval and
same-file capability noise fix:

- Default eval suite passed: 10 scenarios / 23 variants.
- Focused runner tests passed: 2 test files / 24 tests.

Fresh verification after adding middleware-chain route handler extraction:

- Trellis task validation passed.
- Focused runner/context tests passed: 2 test files / 40 tests.
- `bun run --filter @ainp/runner typecheck` passed.
- Direct CR/trailing whitespace scan reported no matches for
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts`.
- Trellis-check added a regression for complex final callbacks so inline
  callbacks do not silently reattach middleware as route-handler graph edges.

Fresh verification after documenting the e2e fixture and noise fix:

- Trellis task validation passed.
- `git diff --check` passed.
- Default eval suite passed: 10 scenarios / 23 variants
  (`.ainp/evals/eval-2026-07-01T00-36-07-899Z.json`).
- Focused runner tests passed: 2 test files / 24 tests.
- `bun run typecheck` passed.
- Full suite passed: 107 test files / 932 tests.
- Red eval suite failed as expected: 5 scenarios / 5 variants failed, command
  exit code 1 (`.ainp/evals/eval-2026-07-01T00-36-52-680Z.json`).
- LSP/tsc diagnostics reported 0 errors for
  `apps/runner/src/context/builder.ts` and
  `apps/runner/src/project-inventory.ts`; the LSP helper skipped
  `scripts/eval-harness.ts` because it could not locate a tsconfig from that
  file path, but `bun run typecheck` passed.
- No `lint` package script exists in `package.json`, so no lint command was
  available to run.

Fresh scanner calibration verification after adding Laravel/Django/ASP.NET
route coverage:

- `trellis-implement` completed the scoped implementation pass against
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts`.
- `bun run test -- apps/runner/test/project-inventory.test.ts` passed:
  1 test file / 2 tests.
- `bun run --filter @ainp/runner typecheck` passed.
- `git diff --check -- apps/runner/src/project-inventory.ts apps/runner/test/project-inventory.test.ts`
  passed.
- A `trellis-check` subprocess was started for independent review but produced
  no output for several wait windows and was terminated; the current check
  evidence is therefore main-session code review plus focused test/typecheck,
  not an independent Trellis check verdict.

Fresh verification after adding governed historical inventory knowledge reuse:

- Trellis task validation passed.
- `git diff --check` passed.
- Focused regression passed: 4 test files / 58 tests.
- Context builder and inventory focused tests passed: 2 test files / 25 tests.

Fresh verification after adding graph-backed source chunk evidence:

- `trellis-implement` completed a scoped implementation pass for
  `InventorySourceChunk.graphEdgeRefs`, scanner-side graph edge chunk backlinks,
  and ContextPack graph-edge pointer matching.
- The `trellis-check` subprocess was started but produced no output for several
  wait windows and was terminated; equivalent main-session verification was run
  instead.
- Focused runner tests passed: 2 test files / 37 tests.
- `bun run typecheck` passed.
- Default eval suite passed: 10 scenarios / 24 variants
  (`.ainp/evals/eval-2026-07-01T04-31-10-289Z.json`).
- Full suite passed: 107 test files / 951 tests.
- `git diff --check -- apps/runner/src/project-inventory.ts apps/runner/src/context/builder.ts apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  passed.
- Trellis task validation passed.
- Direct CR/trailing-whitespace checks on touched code and task docs produced
  no output.
- LSP/tsc diagnostics reported 0 errors for
  `apps/runner/src/project-inventory.ts`,
  `apps/runner/src/context/builder.ts`,
  `apps/runner/test/project-inventory.test.ts`, and
  `apps/runner/test/context-builder.test.ts`.
- Default eval suite passed: 10 scenarios / 24 variants
  (`.ainp/evals/eval-2026-07-01T00-58-42-568Z.json`).
- `bun run typecheck` passed.
- Full suite passed: 107 test files / 933 tests.

Fresh verification after adding default-imported route-handler graph
resolution:

- `bun run test -- apps/runner/test/project-inventory.test.ts` passed:
  1 test file / 6 tests.
- `bun run --filter @ainp/runner typecheck` passed.
- `bun run typecheck` passed.
- Direct CR/trailing-whitespace check on
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts` produced no output.
- Red eval suite failed as expected: 5 scenarios / 5 variants failed, command
  exit code 1 (`.ainp/evals/eval-2026-07-01T00-59-50-086Z.json`).
- LSP/tsc diagnostics reported 0 errors for
  `apps/runner/src/context/builder.ts` and
  `apps/runner/test/context-builder.test.ts`.

Fresh verification after adding default eval coverage for graph-edge-backed
source chunk retrieval:

- `bun run eval` passed: 10 scenarios / 24 variants
  (`.ainp/evals/eval-2026-07-01T04-41-15-394Z.json`).
- Focused runner tests passed: 2 test files / 37 tests.
- `bun run typecheck` passed.
- Trellis task validation passed.
- `git diff --check` passed.

Fresh Ralph hook verification after the historical inventory reuse slice:

- Trellis task validation passed.
- `git diff --check` passed.
- Focused regression passed: 4 test files / 58 tests.
- Default eval suite passed: 10 scenarios / 24 variants
  (`.ainp/evals/eval-2026-07-01T01-02-21-046Z.json`).
- `bun run typecheck` passed.
- Full suite passed: 107 test files / 933 tests.
- Red eval suite failed as expected: 5 scenarios / 5 variants failed, command
  exit code 1 (`.ainp/evals/eval-2026-07-01T01-02-49-189Z.json`).
- LSP/tsc diagnostics reported 0 errors for
  `apps/runner/src/context/builder.ts`,
  `apps/runner/test/context-builder.test.ts`, and
  `apps/runner/src/project-inventory.ts`.
- No `lint` package script exists in `package.json`, so no lint command was
  available to run.

Fresh verification after adding automatic historical per-run inventory
discovery:

- `trellis-implement` completed the scoped implementation pass against
  `apps/runner/src/orchestrator/invoke-skill.ts`,
  `apps/runner/src/api-client.ts`, and
  `apps/runner/test/orchestrator-invoke-skill.test.ts`.

Fresh verification after adding accepted capability-map correction feedback:

- `bun run test -- apps/runner/test/context-builder.test.ts` passed:
  1 test file / 28 tests.
- `bun run --filter @ainp/runner typecheck` passed.
- Independent `trellis-check` found no behavior defects and added the merge
  correction regression test; its focused test/typecheck/diff/task validation
  pass matched main-session verification.

Fresh verification after adding Rails controller/action intra-capability
focusing:

- Added a red/green ContextPack regression for same-capability Rails
  `GET show_refund` versus `PATCH update_refund` route evidence.
- Focused regression passed:
  `bun run test -- apps/runner/test/context-builder.test.ts -t "uses action words to focus same-capability Rails controller/action routes"`.
- Full ContextPack builder test file passed:
  `bun run test -- apps/runner/test/context-builder.test.ts` (69 tests).
- Focused Rails scanner-to-ContextPack eval passed:
  1 scenario / 1 variant, 0 failures
  (`legacy-project-understanding-rails-controller-action-e2e`).
- Runner typecheck passed:
  `bun x tsc -p apps/runner/tsconfig.json --noEmit`.
- Independent `trellis-check` found no scoped defects and reran
  `bun run test -- apps/runner/test/context-builder.test.ts` plus
  `bun x tsc -p apps/runner/tsconfig.json --noEmit` successfully.
- `bun test apps/runner/test/orchestrator-invoke-skill.test.ts apps/runner/test/context-builder.test.ts`
  passed: 2 test files / 31 tests.
- `bun run --filter @ainp/runner typecheck` passed.
- `git diff --check -- apps/runner/src/orchestrator/invoke-skill.ts apps/runner/src/api-client.ts apps/runner/test/orchestrator-invoke-skill.test.ts`
  passed.

Fresh verification after adding symbol graph edge hybrid retrieval:

- Focused graph-edge regression passed:
  `bun run test -- apps/runner/test/context-builder.test.ts -t "uses symbol graph edges as first-class hybrid fallback evidence"`
  (1 test passed / 42 skipped).
- Context builder regression passed:
  `bun run test -- apps/runner/test/context-builder.test.ts`
  (43 tests).
- Runner typecheck passed:
  `bun run --filter @ainp/runner typecheck`.
- Touched-file whitespace check passed:
  `git diff --check -- apps/runner/src/context/builder.ts apps/runner/test/context-builder.test.ts .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/prd.md .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/roadmap.md .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/task-breakdown.md .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/regression-test-plan.md .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/completion-summary.md`.
- Trellis task validation passed:
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.
- Focused legacy context-pack eval passed from a temporary one-file scenario
  directory:
  `bun run eval -- --scenario-dir /tmp/ainp-legacy-eval.DJThgv --out-dir /tmp/ainp-legacy-eval.DJThgv/out`
  (1 scenario / 6 variants).
- Main-session independent recheck on 2026-07-02 passed after the
  `trellis-implement` subprocess completed: no control characters or trailing
  whitespace in touched code/task files, context builder regression
  (43 tests), runner typecheck, Trellis task validation, touched-file
  `git diff --check`, and focused legacy context-pack eval (1 scenario /
  6 variants).
- A follow-up main-session cache refinement added
  `historicalInventoryArtifact` / `historicalInventoryArtifactChecked` to
  `RunCtx.contextFoundation` so repeated skill invocations in the same run do
  not refetch the same prior artifact.
- Main-session verification after the cache refinement passed:
  `bun test apps/runner/test/orchestrator-invoke-skill.test.ts apps/runner/test/context-builder.test.ts`
  (2 test files / 31 tests), `bun run --filter @ainp/runner typecheck`,
  `git diff --check`, and
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.

Fresh verification after adding the source chunk retrieval foundation:

- `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  passed: 2 test files / 33 tests.
- `bun run --filter @ainp/runner typecheck` passed.
- `git diff --check -- apps/runner/src/context/builder.ts apps/runner/test/context-builder.test.ts .trellis/spec/shared/backend/context-injection-protocol.md .trellis/spec/runner/backend/flow-registry.md`
  passed for tracked touched paths.
- `git diff --check --no-index /dev/null <untracked touched file>` emitted no
  whitespace diagnostics for `apps/runner/src/project-inventory.ts`,
  `apps/runner/test/project-inventory.test.ts`, and updated task docs. Git
  returns exit code 1 for ordinary no-index differences, so the diagnostic
  output was used for this untracked-file check.
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.

Fresh Trellis check follow-up after source chunk foundation:

- Independent Trellis check found a scanner-to-context eval regression where a
  broad Orders API source chunk cited and rendered the adjacent Payments route
  in the same file.
- ContextPack now derives source chunk refs and rendered snippet lines from
  matched task tokens, while preserving hybrid-pointer source refs when chunks
  are selected through inventory graph evidence.
- Added a focused regression ensuring an Orders source chunk cites only matched
  Orders lines and does not render `/api/payments`.
- `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  passed: 2 test files / 34 tests.
- `bun run eval` passed: 10 scenarios / 24 variants
  (`.ainp/evals/eval-2026-07-01T02-58-15-204Z.json`).
- `bun run typecheck` passed.
- `git diff --check` passed.
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.
- LSP/tsc diagnostics reported 0 errors for
  `apps/runner/src/context/builder.ts`,
  `apps/runner/src/project-inventory.ts`,
  `apps/runner/test/context-builder.test.ts`, and
  `apps/runner/test/project-inventory.test.ts`.

Fresh verification after adding imported TS/JS route-handler graph resolution:

- `bun run test -- apps/runner/test/project-inventory.test.ts` passed:
  1 test file / 3 tests.
- `bun run --filter @ainp/runner typecheck` passed.
- `git diff --check` passed.
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.

Fresh verification after adding imported TS/JS service-reference graph
resolution:

- Main-session implementation added import/export-aware `symbol_reference`
  resolution for imported services and suppressed noisy bare method-name edges
  for known constructed service receivers.
- Independent `trellis-check` strengthened the regression fixture so the
  imported service is reached through a local barrel re-export and corrected a
  stale deferred-scope note.
- `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  passed: 2 test files / 36 tests.

- `bun run --filter @ainp/runner typecheck` passed.
- `git diff --check` passed.
- Direct CR/trailing-whitespace check passed for the untracked inventory/test
  files and updated task/spec docs.
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.
- LSP/tsc diagnostics reported 0 errors for
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts`.

Fresh verification after adding namespace-imported TS/JS route-handler graph
resolution:

- `trellis-implement` completed a scoped V1.2 symbol graph increment for
  namespace property-access route callbacks, covering `import * as
  OrdersController` plus `router.get(..., OrdersController.show)`.
- Added a focused regression proving the scanner records
  `OrdersController.show`, resolves the exported `show` handler symbol, cites
  route/import/handler source refs, and does not choose a same-file `show`
  fallback.
- `bun run test -- apps/runner/test/project-inventory.test.ts` passed:
  1 test file / 7 tests.
- `bun run --filter @ainp/runner typecheck` passed.
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.
- Direct CR and trailing-whitespace checks on
  `apps/runner/src/project-inventory.ts`,
  `apps/runner/test/project-inventory.test.ts`, and this task summary produced
  no output.

Fresh verification after adding cross-file static Express router mounts:

- `trellis-implement` completed a scoped scanner increment for imported
  Express router variables mounted with static `app.use("/prefix", router)`
  calls across TS/JS files.
- The scanner now resolves local ES import/export evidence for named router
  exports and default router exports, applies the static mount prefix to child
  direct routes and `router.route(...).method(...)` chains, and carries both
  child route and mount source refs into route-handler graph edges.
- Dynamic mount prefixes, unresolved imports, exported non-router values, and
  non-direct mount args stay unprefixed/ignored.
- Independent `trellis-check` found and fixed one false-positive gap: an
  arbitrary object named `router` could still be accepted for
  `router.route(...).get(...)` chains through the legacy conventional receiver
  heuristic. Route chains now require a same-file Express app/router variable
  or a resolved mounted router.
- Added regression coverage for shadowed non-Express `router` / `app` objects,
  cross-file static mounts, default-exported routers, cross-file route chains,
  dynamic prefixes, unresolved imports, non-router exports, cross-file
  sourceRefs, and middleware functions not receiving `route_handler` edges.
- `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  passed: 2 test files / 45 tests.
- `bun run --filter @ainp/runner typecheck` passed.
- Direct CR and trailing-whitespace checks on
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts` produced no output.
- Lint-script discovery with `rg -n '"lint"\s*:' --glob package.json`
  produced no matches, so no package lint script was available from that scan.
- Main-session verification repeated after the summary update:
  `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  passed (2 test files / 45 tests), `bun run --filter @ainp/runner typecheck`
  passed, and
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.
- LSP/tsc diagnostics reported 0 errors for
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts`.

Fresh verification after adding CommonJS static Express router mounts:

- `trellis-implement` completed a scoped V1.2 scanner increment for old
  Node/Express projects that mount CommonJS router modules through static
  `app.use("/prefix", router)` calls.
- Top-level static `require("...")` evidence now feeds the existing
  `InventoryImport` model for identifier imports like
  `const ordersRouter = require("./orders-routes")`, destructured imports like
  `const { adminRouter } = require("./admin-routes")`, and namespace-style
  controller imports used by route callbacks.
- Conservative CommonJS export evidence now covers `module.exports = router`,
  `exports.router = router`, and `module.exports.router = router`, then reuses
  the existing import/export-backed mount resolver to prefix child direct
  routes and `router.route(...).method(...)` chains across `.js` / `.cjs`
  files.
- `trellis-check` found and fixed one conservatism bug: CommonJS export records
  now require the right-hand identifier to resolve to a local symbol, and
  imported handler resolution no longer guesses a same-name target when export
  resolution fails.
- Added regression coverage for CommonJS default router exports, named router
  exports, route-chain mounts, unresolved dynamic prefixes, missing router
  exports, exported non-router values, arbitrary non-Express route receivers,
  middleware functions not receiving `route_handler` edges, and unresolved
  CommonJS handler exports not creating bad handler edges.
- `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  passed: 2 test files / 46 tests.
- `bun run --filter @ainp/runner typecheck` passed.
- Direct CR and trailing-whitespace checks on
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts` produced no output.
- Lint-script discovery with `rg -n '"lint"\s*:' --glob package.json`
  produced no matches, so no package lint script was available from that scan.
- Main-session verification repeated after the summary update:
  `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  passed (2 test files / 46 tests), `bun run --filter @ainp/runner typecheck`
  passed, and
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.
- Direct CR and trailing-whitespace checks on
  `apps/runner/src/project-inventory.ts`,
  `apps/runner/test/project-inventory.test.ts`, and this task summary produced
  no output.
- LSP/tsc diagnostics reported 0 errors for
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts`.
- Remaining risk at that checkpoint: this slice was intentionally static and
  conservative. It did not resolve dynamic `require`, inline
  `module.exports = Router()`, or object export inference such as
  `module.exports = { router }`.

Fresh verification after adding CommonJS object and inline Router exports:

- Implemented the next scoped V1.2 scanner increment for old Node/Express
  projects using static CommonJS object exports such as
  `module.exports = { reportsRouter }`.
- CommonJS object export extraction now emits conservative `InventoryExport`
  evidence only when each exported property resolves to a local symbol. Missing
  identifiers in object exports are ignored rather than guessed.
- Explicit inline router default exports are now recognized for
  `module.exports = Router()` / `module.exports = express.Router()` when the
  route file uses the same explicit receiver in calls like
  `module.exports.get("/users", handler)`.
- The new behavior reuses the existing import/export-backed Express mount
  resolver, so static `app.use("/prefix", importedRouter)` can prefix child
  routes and route-handler graph edges still cite route, mount, import, and
  handler source refs.
- Added regression coverage for object-exported routers, missing object-export
  identifiers not producing export evidence, explicit inline
  `module.exports` routers, and bad object exports not creating mounted routes.
- `bun run test -- apps/runner/test/project-inventory.test.ts` first failed on
  the new regression before implementation, then passed after the scanner
  change.
- `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  passed: 2 test files / 47 tests.
- `bun run --filter @ainp/runner typecheck` passed.
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.
- Direct CR, trailing-whitespace, debug-log, and type-suppression scans on
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts` produced no output.
- LSP/tsc diagnostics reported 0 errors for
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts`.
- Lint-script discovery with `rg -n '"lint"\s*:' --glob package.json`
  produced no matches, so no package lint script was available from that scan.
- Remaining risk: the scanner still deliberately does not resolve dynamic
  `require`, computed object export keys, spread object exports, or fully
  anonymous inline router chains such as `module.exports = Router().get(...)`.

Fresh verification after adding CommonJS re-export barrels:

- Implemented the next scoped V1.2 scanner increment for old Node/Express
  projects that route imports through static CommonJS barrel modules.
- Static `module.exports = require("./routes")`,
  `exports.router = require("./routes").router`, and
  `module.exports.router = require("./routes")` assignments now emit
  conservative `InventoryExport` re-export evidence with the existing
  `specifier` contract.
- The new re-export evidence reuses the existing one-hop resolver for Express
  static mounts and route-handler graph resolution, so mounted routers can be
  discovered through a barrel without inventing a separate path.
- Added regression coverage for default CommonJS re-exports, named CommonJS
  re-exports, re-exporting a default router under a named export, and bad
  re-exports not producing mounted ghost routes.
- `bun run test -- apps/runner/test/project-inventory.test.ts` first failed on
  the new barrel regression before implementation, then passed after the
  scanner change: 1 test file / 16 tests.
- `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  passed: 2 test files / 48 tests.
- `bun run --filter @ainp/runner typecheck` passed.
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.
- Direct CR, trailing-whitespace, debug-log, and type-suppression scans on
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts` produced no output.
- LSP/tsc diagnostics reported 0 errors for
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts`.
- Lint-script discovery with `rg -n '"lint"\s*:' --glob package.json`
  produced no matches, so no package lint script was available from that scan.
- Remaining risk at that checkpoint: re-export resolution was intentionally
  one-hop and static. It did not follow dynamic `require`, nested barrel
  chains, computed require targets, computed export keys, or spread object
  exports.

Fresh verification after adding bounded two-hop re-export chains:

- Implemented the next scoped V1.2 scanner increment for old Node/Express
  projects that route imports through a short local barrel chain such as
  `app -> routes-index -> routes-feature -> reports-routes`.
- Re-export resolution for route-handler symbols and Express static router
  mounts now uses a shared `LOCAL_RE_EXPORT_MAX_DEPTH = 2` bound instead of the
  previous one-hop limit.
- Added regression coverage proving a two-hop static CommonJS re-export chain
  can mount a router and produce a `route_handler` graph edge, while a
  three-hop chain remains unmounted to keep recursion bounded and conservative.
- `bun run test -- apps/runner/test/project-inventory.test.ts` first failed on
  the new two-hop regression before implementation, then passed after the
  scanner change: 1 test file / 17 tests.
- `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  passed: 2 test files / 49 tests.
- `bun run --filter @ainp/runner typecheck` passed.
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.
- Direct CR, trailing-whitespace, debug-log, and type-suppression scans on
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts` produced no output.
- LSP/tsc diagnostics reported 0 errors for
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts`.
- Lint-script discovery with `rg -n '"lint"\s*:' --glob package.json`
  produced no matches, so no package lint script was available from that scan.
- Remaining risk: re-export resolution is still static and deliberately
  bounded. It does not follow dynamic `require`, chains deeper than two
  re-export edges, computed require targets, computed export keys, or spread
  object exports.

Fresh verification after adding CommonJS namespace service references:

- Implemented the next scoped V1.2 symbol graph increment for old Node/Express
  projects whose CommonJS controllers call service modules through namespace
  imports such as `const OrdersService = require("./orders-service")` and
  `OrdersService.listOrders()`.
- AST reference collection now records property-access calls as
  `receiver.method` when no constructed class receiver is known, and
  `resolveSymbolReferenceTarget()` resolves those references through the
  existing namespace import/export path before falling back to loose same-name
  matching.
- This upgrades CommonJS handler -> service graph edges from weak method-name
  fallback, such as `calls listOrders`, to source-backed namespace evidence,
  such as `calls OrdersService.listOrders`, with controller import, call-site,
  service export, and service symbol source refs.
- Added regression coverage for the full CommonJS
  route -> controller handler -> service function chain.
- `bun run test -- apps/runner/test/project-inventory.test.ts` first failed on
  the new namespace service regression before implementation, then passed after
  the scanner change: 1 test file / 18 tests.
- `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  passed: 2 test files / 50 tests.
- `bun run --filter @ainp/runner typecheck` passed.
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.
- Direct CR, trailing-whitespace, debug-log, and type-suppression scans on
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts` produced no output.
- LSP/tsc diagnostics reported 0 errors for
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts`.
- Lint-script discovery with `rg -n '"lint"\s*:' --glob package.json`
  produced no matches, so no package lint script was available from that scan.
- Remaining risk: this still does not perform type checking or dataflow. It
  resolves static namespace calls only when import/export evidence can identify
  the referenced service member.

Fresh verification after adding CommonJS inline object service exports:

- Implemented the next scoped V1.2 symbol graph increment for old CommonJS
  service modules that export inline object methods, such as
  `module.exports = { listOrders() { ... } }`.
- The scanner now creates exported function symbols for static methods,
  function expressions, and arrow functions inside a top-level
  `module.exports = { ... }` object literal, then emits normal
  `InventoryExport` evidence for those generated symbols.
- Missing object properties such as `missing: missingHandler` still do not
  create export evidence unless the referenced symbol exists locally.
- This allows the existing namespace service call resolver to link
  route -> handler -> inline-exported service method with source refs to the
  controller import, call site, and service object method line.
- Added regression coverage for a CommonJS
  route -> controller handler -> inline object service method chain.
- `bun run test -- apps/runner/test/project-inventory.test.ts` first failed on
  the new inline service export regression before implementation, then passed
  after the scanner change: 1 test file / 19 tests.
- `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  passed: 2 test files / 51 tests.
- `bun run --filter @ainp/runner typecheck` passed.
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.
- Direct CR, trailing-whitespace, debug-log, and type-suppression scans on
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts` produced no output.
- LSP/tsc diagnostics reported 0 errors for
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts`.
- Lint-script discovery with `rg -n '"lint"\s*:' --glob package.json`
  produced no matches, so no package lint script was available from that scan.
- Remaining risk: inline object export support is limited to static
  top-level `module.exports = { ... }` function-like properties. It does not
  infer nested objects, computed keys, spreads, runtime mutation, or type-level
  receiver identity.

Fresh verification after adding CommonJS property-assigned service exports:

- Implemented the next scoped V1.2 symbol graph increment for old CommonJS
  service modules that export functions through property assignments, such as
  `exports.listOrders = function () { ... }` and
  `module.exports.countOrders = () => 0`.
- The scanner now creates exported function symbols for static CommonJS
  property assignments whose right-hand side is a function expression or arrow
  function, then emits normal `InventoryExport` evidence for those symbols.
- Unresolved assignments such as `exports.missing = missingHandler` still do
  not create export evidence unless the referenced symbol exists locally.
- This extends the existing namespace service call resolver so
  `OrdersService.listOrders()` can link route -> handler -> property-exported
  service function with controller import, call-site, and service export source
  refs.
- Added regression coverage for a CommonJS
  route -> controller handler -> property-assigned service function chain.
- `bun run test -- apps/runner/test/project-inventory.test.ts` first failed on
  the new property-assigned service export regression before implementation,
  then passed after the scanner change: 1 test file / 20 tests.
- `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  passed: 2 test files / 52 tests.
- `bun run --filter @ainp/runner typecheck` passed.
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.
- Direct CR, trailing-whitespace, debug-log, and type-suppression scans on
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts` produced no output.
- LSP/tsc diagnostics reported 0 errors for
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts`.
- Lint-script discovery with `rg -n '"lint"\s*:' --glob package.json`
  produced no matches, so no package lint script was available from that scan.
- Remaining risk: property-assigned export support is limited to static
  top-level assignments with function-like right-hand sides. It does not infer
  runtime mutation, aliasing through intermediate objects, computed keys, or
  type-level receiver identity.

Fresh verification after adding constructed service method links:

- Implemented the next scoped V1.2 symbol graph increment for service instances
  constructed inside handlers, such as
  `const service = new ImportedOrderService(); service.remove();`.
- The scanner now preserves the existing class-level reference edge while also
  emitting a method-level target like `calls ImportedOrderService.remove` when
  the receiver was statically created by `new ImportedOrderService()`.
- Method resolution remains conservative: it first resolves the constructed
  class through existing local import/export/re-export evidence, then links
  only to method symbols in that resolved class whose parser signature carries
  the matching class prefix.
- Added regression coverage proving an imported route handler now links to the
  exported service class method symbol with controller import, construction
  line, call site, barrel export, class export, and method source refs.
- `bun run test -- apps/runner/test/project-inventory.test.ts -t "links imported TypeScript route handlers"`
  first failed on the new method-level regression before implementation, then
  passed after the scanner change.
- `bun run test -- apps/runner/test/project-inventory.test.ts`
  passed: 1 test file / 20 tests.
- `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  passed: 2 test files / 52 tests.
- `bun run --filter @ainp/runner typecheck` passed.
- Remaining risk: constructed method linking is still static and local. It does
  not infer factory returns, dependency injection containers, dynamic
  prototype mutation, namespace class constructors such as
  `new Services.OrderService()`, or type checker/dataflow identities.

Fresh verification after adding namespace-constructed service method links:

- Implemented the next scoped V1.2 symbol graph increment for TypeScript
  namespace/barrel service imports, such as
  `import * as Services from "./services"; const service = new Services.OrderService(); service.listOrders();`.
- Constructed receiver tracking now preserves qualified constructor names
  (`Services.OrderService`) instead of collapsing property-access constructors
  to the final identifier (`OrderService`).
- Symbol-reference resolution now handles static
  `Namespace.Class.method` targets by resolving `Namespace.Class` through the
  existing namespace import/export/re-export path, then linking only to the
  matching method symbol on the resolved class.
- Added regression coverage proving route -> namespace controller handler ->
  namespace-constructed service class -> service method edges carry controller
  import, construction line, call site, barrel export, class export, and method
  source refs.
- `bun run test -- apps/runner/test/project-inventory.test.ts -t "namespace-constructed TypeScript service"`
  first failed on the new namespace constructor regression before
  implementation, then passed after the scanner change.
- `bun run test -- apps/runner/test/project-inventory.test.ts`
  passed: 1 test file / 21 tests.
- `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  passed: 2 test files / 53 tests.
- `bun run --filter @ainp/runner typecheck` passed.
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.
- Direct CR, trailing-whitespace, debug-log, and type-suppression scans on
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts` produced no output.
- LSP/tsc diagnostics reported 0 errors for
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts`.
- Lint-script discovery with `rg -n '"lint"\s*:' --glob package.json`
  produced no matches, so no package lint script was available from that scan.
- Remaining risk: namespace constructor support is intentionally limited to
  static identifier chains shaped like `Namespace.Class` and
  `Namespace.Class.method`. It does not infer nested namespaces beyond one
  namespace segment, factory returns, dependency injection containers, computed
  property access, or type checker/dataflow identities.

Fresh verification after adding bound route handler normalization:

- Implemented the next scoped V1.2 route-handler increment for old
  Express/class-controller wiring such as
  `router.get("/orders", auth, OrdersController.index.bind(OrdersController))`.
- Handler extraction now conservatively normalizes static
  `Identifier.member.bind(...)` expressions back to `Identifier.member`, so
  existing namespace import/export resolution can create the route -> handler
  graph edge.
- The normalization is limited to direct identifier/property handler
  expressions followed by `.bind(`. It does not infer arbitrary function calls
  or dynamically selected handlers.
- Added regression coverage proving the route entrypoint records
  `handler='OrdersController.index'`, links to the exported controller symbol,
  and does not mistake the preceding `auth` middleware for the handler.
- `bun run test -- apps/runner/test/project-inventory.test.ts -t "bound TypeScript route handlers"`
  first failed on the new bound handler regression before implementation, then
  passed after the scanner change.
- `bun run test -- apps/runner/test/project-inventory.test.ts`
  passed: 1 test file / 22 tests.
- `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  passed: 2 test files / 54 tests.
- `bun run --filter @ainp/runner typecheck` passed.
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.
- Direct CR, trailing-whitespace, debug-log, and type-suppression scans on
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts` produced no output.
- LSP/tsc diagnostics reported 0 errors for
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts`.
- Lint-script discovery with `rg -n '"lint"\s*:' --glob package.json`
  produced no matches, so no package lint script was available from that scan.
- Remaining risk: bound handler support does not resolve instance variables,
  dependency-injected controllers, partially applied factories, or handlers
  selected through arrays/objects beyond the existing final-argument handling.

Fresh verification after adding constructed controller route handler links:

- Implemented the next scoped V1.2 route-handler increment for class-controller
  instances constructed in route files, such as
  `const controller = new OrdersController(); router.get("/orders", controller.index.bind(controller));`.
- Parser evidence now records static top-level constructed receivers
  (`controller -> OrdersController`) with source refs, and the route handler
  resolver uses that evidence when a handler is shaped like `controller.index`.
- Resolution remains conservative: the constructed target must resolve through
  existing local import/export/re-export evidence or a same-file class, and the
  final route-handler edge links only to the matching method symbol on that
  resolved class.
- Added regression coverage proving the route entrypoint keeps
  `handler='controller.index'`, links to the exported `OrdersController.index`
  method symbol, includes import/construction/route/class/method source refs,
  and does not create a route-handler edge to the class symbol itself.
- `bun run test -- apps/runner/test/project-inventory.test.ts -t "constructed controller instance route handlers"`
  first failed on the new instance-controller regression before
  implementation, then passed after the scanner change.
- `bun run test -- apps/runner/test/project-inventory.test.ts`
  passed: 1 test file / 23 tests.
- `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  passed: 2 test files / 55 tests.
- `bun run --filter @ainp/runner typecheck` passed.
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.
- Direct CR, trailing-whitespace, debug-log, and type-suppression scans on
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts` produced no output.
- LSP/tsc diagnostics reported 0 errors for
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts`.
- Lint-script discovery with `rg -n '"lint"\s*:' --glob package.json`
  produced no matches, so no package lint script was available from that scan.
- Remaining risk: constructed controller handler support covers static
  top-level `new` assignments only. It does not infer dependency-injected
  controllers, factory-returned controllers, reassigned variables, constructor
  arguments, or type checker/dataflow identities.

Fresh verification after adding Next App Router handler edges:

- Implemented the next scoped V1.1/V1.2 increment for Next.js App Router
  route files such as `app/api/orders/[id]/route.ts`.
- File-derived Next route entrypoints now set `handler` to the exported HTTP
  method name (`GET`, `POST`, `DELETE`, etc.), allowing the existing same-file
  route-handler resolver to link the entrypoint to the parser-backed exported
  function symbol.
- Added regression coverage in the existing multi-framework route fixture
  proving `GET /api/orders/[id]` records `handler='GET'` and produces a
  `route_handler` edge to `export async function GET()`.
- `bun run test -- apps/runner/test/project-inventory.test.ts -t "calibrates route patterns"`
  first failed on the new Next handler regression before implementation, then
  passed after the scanner change.
- `bun run test -- apps/runner/test/project-inventory.test.ts`
  passed: 1 test file / 23 tests.
- `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  passed: 2 test files / 55 tests.
- `bun run --filter @ainp/runner typecheck` passed.
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.
- Direct CR, trailing-whitespace, debug-log, and type-suppression scans on
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts` produced no output.
- LSP/tsc diagnostics reported 0 errors for
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts`.
- Lint-script discovery with `rg -n '"lint"\s*:' --glob package.json`
  produced no matches, so no package lint script was available from that scan.
- Remaining risk: this links only file-local exported HTTP method functions in
  Next route files. It does not infer handlers delegated through helper
  factories, wrapper exports, or runtime route composition.

Fresh verification after adding Next App Router exported const handlers:

- Implemented the next scoped V1.1/V1.2 increment for Next.js App Router
  route files that use `export const DELETE = async () => { ... }` or the
  equivalent exported const HTTP method style.
- File-derived Next route entrypoints now detect both
  `export function METHOD(...)` and `export const METHOD...` forms, while still
  setting `handler` to the exported HTTP method name so the existing
  parser-backed same-file symbol graph can link the route to the exported const
  symbol.
- Added regression coverage by changing the existing multi-framework Next
  fixture to use `export const DELETE = async () => {}` and asserting both the
  `DELETE /api/orders/[id]` entrypoint and route-handler edge to the `DELETE`
  const symbol.
- `bun run test -- apps/runner/test/project-inventory.test.ts -t "calibrates route patterns"`
  first failed on the exported const Next handler regression before
  implementation, then passed after the scanner change.
- `bun run test -- apps/runner/test/project-inventory.test.ts`
  passed: 1 test file / 23 tests.
- `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  passed: 2 test files / 55 tests.
- `bun run --filter @ainp/runner typecheck` passed.
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.
- Direct CR, trailing-whitespace, debug-log, and type-suppression scans on
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts` produced no output.
- LSP/tsc diagnostics reported 0 errors for
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts`.
- Lint-script discovery with `rg -n '"lint"\s*:' --glob package.json`
  produced no matches, so no package lint script was available from that scan.
- Remaining risk: exported const detection is line-based and limited to
  direct `export const METHOD` declarations. It does not infer re-exported
  route methods, aliased method constants, or wrapper-generated exports.

Fresh verification after adding static class-member constructed receiver graph
links:

- Implemented the next scoped V1.2 symbol graph increment for TypeScript/JavaScript
  service classes that construct repository collaborators as class members.
- Class field initializers such as `private store = new RecordStore()` and
  constructor assignments such as `this.store = new RecordStore()` now seed the
  existing constructed-receiver map for class method bodies.
- Method calls such as `this.store.find()` now produce source-backed
  `symbol_reference` edges from the service method to the constructed
  repository class and to the matched repository method, citing import,
  construction/assignment, call-site, class, and method source refs.
- The implementation stays deliberately narrow: static `new` expressions on
  direct `this.member` properties only; no DI/factory inference, computed
  properties, dynamic import/require, typechecker/dataflow identity, runtime
  mutation, or unbounded recursion.
- Added regression coverage for both class-field construction and constructor
  assignment, asserting edges from service methods to `RecordStore` and to
  `RecordStore.find` / `RecordStore.findAudit`.
- `bun test apps/runner/test/project-inventory.test.ts -t "links static this-member constructed receivers"`
  passed.
- `bun test apps/runner/test/project-inventory.test.ts` passed: 1 test file /
  27 tests / 266 expects.
- `bun run --filter @ainp/runner typecheck` passed.
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.
- LSP/tsc diagnostics reported 0 errors for
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts`.
- Independent Trellis-check found no fixed or unfixed defects. It repeated the
  focused regression, full inventory test file, and runner typecheck
  successfully. `@ainp/runner` has no lint script, so package lint was not
  available.
- Remaining repo-state note: `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts` are still untracked in this
  checkout, matching the pre-existing workspace shape. They were not staged,
  committed, or archived.

Fresh verification after adding private class-field constructed receiver graph
links:

- Implemented the next scoped V1.2 symbol graph increment for
  TypeScript/JavaScript classes that use private fields for constructed
  repository collaborators.
- Private field initializers such as `#store = new RecordStore()` and
  constructor assignments such as `this.#store = new RecordStore()` now use the
  same constructed-receiver key path as public `this.member` fields.
- Method calls such as `this.#store.find()` now produce source-backed
  `symbol_reference` edges from the service method to the constructed
  repository class and to the matched repository method, citing import,
  construction/assignment, call-site, class, and method source refs.
- The implementation remains static and conservative: direct private field
  `new` expressions only; no DI/factory inference, computed properties,
  dynamic import/require, typechecker/dataflow identity, runtime mutation
  outside direct constructor assignment, or unbounded recursion.
- Added regression coverage for both private field construction and
  constructor assignment, asserting edges from service methods to `RecordStore`
  and to `RecordStore.find` / `RecordStore.findAudit`.
- `bun test apps/runner/test/project-inventory.test.ts -t "private"` passed.
- `bun test apps/runner/test/project-inventory.test.ts` passed: 1 test file /
  28 tests / 275 expects.
- `bun run --filter @ainp/runner typecheck` passed.
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.
- LSP/tsc diagnostics reported 0 errors for
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts`.
- Direct CR, trailing-whitespace, debug-log, and type-suppression scans on the
  touched scanner/test files produced no output.
- Independent Trellis-check found no fixed or unfixed defects. It repeated the
  focused private-field regression, full inventory test file, runner
  typecheck, and whitespace scan successfully.
- Remaining repo-state note: `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts` are still untracked in this
  checkout, matching the pre-existing workspace shape. They were not staged,
  committed, or archived.

Fresh verification after adding exported object-literal controller/service
method graph links:

- Implemented the next scoped V1.2 symbol graph increment for
  TypeScript/ESM modules that export static object-literal controller or
  service surfaces.
- Exported object literals such as
  `export const OrdersController = { index() { ... } }` now keep the exported
  object as the export boundary while adding parser-backed non-exported method
  symbols for static method/property function members.
- Route callbacks such as `OrdersController.index` now resolve to the
  object-method symbol when the imported object export owns that member.
- Controller calls such as `OrdersService.listOrders()` now resolve through
  the same object-member path to the service object-method symbol, with source
  refs citing route import/call, object export/method, service import/export,
  and service method lines.
- The implementation remains static and conservative: exported object literals
  only; no dynamic import/require inference, DI/factory inference, computed
  property inference, typechecker/dataflow identity, runtime mutation,
  prototype assignment, or unbounded recursion.
- Added focused regression coverage for route -> controller object method ->
  service object method and asserted `index` / `listOrders` are not emitted as
  fake top-level exports.
- `bun test apps/runner/test/project-inventory.test.ts -t "object-literal"`
  passed: 1 test / 8 expects.
- `bun test apps/runner/test/project-inventory.test.ts` passed: 1 test file /
  29 tests / 283 expects.
- `bun run --filter @ainp/runner typecheck` passed.
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.
- LSP/tsc diagnostics reported 0 errors for
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts`.
- `git diff --check -- apps/runner/src/project-inventory.ts apps/runner/test/project-inventory.test.ts`
  produced no output.
- Direct CR, debug-log, TODO/FIXME, and type-suppression scans on the touched
  scanner/test files produced no output.
- Independent Trellis-check found no fixed or unfixed defects. It repeated the
  focused object-literal regression, full inventory test file, and runner
  typecheck successfully.
- Remaining repo-state note: `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts` are still untracked in this
  checkout, matching the pre-existing workspace shape. They were not staged,
  committed, or archived.

Fresh verification after adding named-export object-literal controller/service
method graph links:

- Implemented the next scoped V1.2 symbol graph increment for
  TypeScript/ESM modules that declare static object-literal controller or
  service surfaces first and export them later with local named exports.
- Local named exports such as `const OrdersController = { ... };
  export { OrdersController };` now mark the existing local object symbol as
  exported and emit `InventoryExport` evidence tied back to that symbol via
  `symbolRef`.
- Static object-literal methods are collected for those locally named-exported
  objects, while object methods remain non-exported `method` symbols and are
  not emitted as fake top-level exports.
- Route callbacks such as `OrdersController.index` now resolve to the
  controller object-method symbol, and controller calls such as
  `OrdersService.listOrders()` resolve to the service object-method symbol
  through source-ref-backed import/export evidence.
- The implementation remains static and conservative: local named exports and
  static object-literal function members only; no dynamic import/require
  inference, DI/factory inference, computed property inference,
  typechecker/dataflow identity, runtime mutation, prototype assignment, or
  unbounded recursion.
- Added focused regression coverage for route -> named-exported controller
  object method -> named-exported service object method and asserted `index` /
  `listOrders` are not emitted as fake top-level exports.
- `bun test apps/runner/test/project-inventory.test.ts -t 'object-literal.*named export|named export.*object-literal'`
  passed: 1 test / 8 expects.
- `bun test apps/runner/test/project-inventory.test.ts` passed: 1 test file /
  30 tests / 291 expects.
- `bun run --filter @ainp/runner typecheck` passed.
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.
- LSP/tsc diagnostics reported 0 errors for
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts`.
- `git diff --check -- apps/runner/src/project-inventory.ts apps/runner/test/project-inventory.test.ts`
  produced no output.
- Direct CR, debug-log, TODO/FIXME, and type-suppression scans on the touched
  scanner/test files produced no output.
- Independent Trellis-check found no fixed or unfixed defects. It repeated the
  focused named-export object-literal regression, full inventory test file, and
  runner typecheck successfully.
- Remaining repo-state note: `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts` are still untracked in this
  checkout, matching the pre-existing workspace shape. They were not staged,
  committed, or archived.

Fresh verification after adding CommonJS local object-literal controller/service
method graph links:

- Implemented the next scoped V1.2 symbol graph increment for old Node/CommonJS
  modules that declare static object-literal controller or service surfaces
  first and export them later with CommonJS assignments.
- Local CommonJS exports such as `const OrdersController = { ... };
  module.exports = OrdersController;`, `exports.InvoicesController =
  InvoicesController;`, and `module.exports.OrdersService = OrdersService;`
  now mark the existing local object symbol as exported and collect its static
  object-literal method symbols.
- Default `require()` object member route handlers such as
  `OrdersController.index` now resolve to the exported object-method symbol
  before falling back to named/namespace member exports, preserving existing
  `module.exports.index = index` behavior when no exported object method exists.
- CommonJS export evidence now carries both the export assignment source ref and
  the local symbol declaration source ref, so route and symbol graph edges cite
  the object boundary as well as the method/call site.
- Object methods remain non-exported `method` symbols and are not emitted as
  fake top-level exports.
- The implementation remains static and conservative: direct local identifier
  CommonJS assignments and static object-literal function members only; no
  dynamic require/import inference, `require(...).prop` identity inference,
  DI/factory inference, computed property inference, typechecker/dataflow
  identity, runtime mutation, prototype assignment, or unbounded recursion.
- Added focused regression coverage for default and named CommonJS object
  exports, route -> controller object method -> service object method graph
  links, object declaration source refs, and no fake top-level method exports.
- `bun test apps/runner/test/project-inventory.test.ts -t "CommonJS local object-literal"`
  passed: 1 test / 11 expects.
- `bun test apps/runner/test/project-inventory.test.ts` passed: 1 test file /
  31 tests / 302 expects.
- `bun run --filter @ainp/runner typecheck` passed.
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.
- `git diff --check -- apps/runner/src/project-inventory.ts apps/runner/test/project-inventory.test.ts .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/completion-summary.md`
  produced no output.
- Independent Trellis-check fixed two review findings: CommonJS export
  `sourceRefs` now include the local symbol declaration, and exported object
  methods are attempted before named/namespace member exports for route handlers
  and symbol references. It repeated the focused regression, full inventory
  test file, runner typecheck, `git diff --check`, and a direct CR/trailing
  whitespace scan successfully.
- Remaining repo-state note: `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts` are still untracked in this
  checkout, matching the pre-existing workspace shape. They were not staged,
  committed, or archived.

Fresh verification after adding CommonJS default object-literal export chains
and source chunk verb-form matching:

- Implemented the next scoped V1.2/V2 increment for old Node/CommonJS projects
  that export object-literal service/repository surfaces through
  `module.exports = { LocalObject }` or aliased object properties such as
  `module.exports = { orders: OrdersService }`.
- The scanner now pre-detects direct local identifiers inside static default
  CommonJS object-literal exports, marks those local object symbols exported,
  collects their static object method symbols, and can link route ->
  controller object method -> service object method -> repository object method
  chains with source refs.
- Object methods remain non-exported `method` symbols and are not emitted as
  fake top-level CommonJS exports.
- The implementation remains static and conservative: no dynamic require
  inference, nested object export inference, `require(...).prop` identity
  inference, DI/factory inference, computed property inference,
  typechecker/dataflow identity, runtime mutation, prototype assignment, or
  unbounded recursion.
- ContextPack inventory/source chunk matching now expands small lexical variants
  for CRUD-style task verbs, so task briefs such as "deleting orders" can match
  scanner chunks containing `deleteOrder` while still narrowing chunk
  sourceRefs to matched lines and excluding adjacent same-file routes.
- Updated the scanner-to-context e2e eval expectation so the route-handler
  graph-edge assertion targets the actual exported `deleteOrder()` route
  handler symbol rather than the downstream `OrderService.deleteOrder()` method.
- `bun test apps/runner/test/project-inventory.test.ts -t "CommonJS default object-literal"`
  passed: 1 test / 10 expects.
- `bun test apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  passed: 2 test files / 64 tests / 452 expects.
- `bun run --filter @ainp/runner typecheck` passed.
- `bun run typecheck` passed.
- `bun run test` passed: 107 test files / 978 tests.
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.
- `bun run eval` passed: 10 scenarios / 24 variants.
- LSP/tsc diagnostics reported 0 errors for
  `apps/runner/src/project-inventory.ts`,
  `apps/runner/src/context/builder.ts`,
  `apps/runner/test/project-inventory.test.ts`, and
  `apps/runner/test/context-builder.test.ts`.
- `git diff --check -- apps/runner/src/project-inventory.ts apps/runner/src/context/builder.ts apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts eval/scenarios/legacy-project-understanding-e2e.json .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/completion-summary.md`
  produced no output.
- Remaining repo-state note: the workspace is still broadly dirty/untracked.
  This continuation did not stage, commit, archive, or revert unrelated files.

Fresh verification after adding polyglot old-project eval coverage:

- Locked the ContextPack source-chunk noise fix with regression coverage:
  lexical source chunk matches no longer render broad linked capability or
  entrypoint refs from the chunk record, while hybrid graph-pointer matches
  still render graph-edge linked evidence.
- Added a default scanner-to-context polyglot legacy fixture,
  `eval/scenarios/legacy-project-understanding-polyglot-e2e.json`, covering a
  Flask Billing API, Flask Users API, Django Shipments route, Rails Reports
  route, pytest billing/users tests, and `.env` sensitive-file exclusion.
- The polyglot eval runs the real scanner and then the real ContextPack
  builder. It verifies detected Billing/Users/Shipments/Reports capabilities
  and routes, proves `.env` is excluded, selects Billing API/test/hotspot
  evidence for a billing task, excludes unrelated Users/Shipments/Reports
  capability refs, and excludes unrelated source refs from Users/Django/Rails
  files.
- `bun test apps/runner/test/context-builder.test.ts -t "source chunk"`
  passed: 4 tests / 30 expects.
- `bun run eval` passed: 11 scenarios / 25 variants.
- `bun test apps/runner/test/context-builder.test.ts` passed: 32 tests / 144
  expects.
- `bun test apps/runner/test/project-inventory.test.ts` passed: 32 tests / 312
  expects.
- `bun run --filter @ainp/runner typecheck` passed.
- `bun run typecheck` passed.
- `bun run test` passed: 107 test files / 978 tests.

Fresh verification after adding Python decorator route-handler graph evidence:

- Added a conservative non-TS V1.2 scanner increment for old Flask/FastAPI-style
  projects. Static Python route decorators such as `@app.route(...)` and
  `@router.get(...)` now bind to the following local `def` handler when the
  function is in the same file.
- The enriched entrypoints use the same stable route ids as the existing route
  detector, so older no-handler line matches are deduped behind the
  source-backed handler match.
- The symbol graph now emits route-handler edges for those Python routes when
  the local handler function symbol exists. This keeps the scope conservative:
  no dynamic decorator inference, no cross-file Python import resolution, no
  runtime Flask/FastAPI object identity inference, and no dataflow analysis.
- The framework calibration test now asserts Flask multi-method
  `@app.route(..., methods=[...])` and FastAPI-style `@router.get(...)`
  handlers, plus source-ref-backed graph edges from route lines to Python
  function definitions.
- The polyglot scanner-to-context eval now also requires Python handler symbols
  and `route_handler` graph evidence for the Billing/Shipments fixture.
- `bun test apps/runner/test/project-inventory.test.ts -t "calibrates route patterns"`
  passed: 1 test / 22 expects.
- `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  passed: 11 scenarios / 25 variants.
- `bun test apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  passed: 2 test files / 64 tests / 461 expects.
- `bun run --filter @ainp/runner typecheck` passed.
- `bun run typecheck` passed.
- `bun run test` passed: 107 test files / 978 tests.

Fresh verification after adding Rails route-to-controller-action graph evidence:

- Added a conservative Rails convention slice for legacy Ruby projects.
  Static routes such as `get "/api/reports/daily", to: "reports#daily"` now
  record handler identity as `ReportsController#daily`.
- Added Ruby `def action` symbol detection without requiring parentheses, so
  Rails controller actions such as `def daily` are available as source-backed
  handler symbols.
- Route-handler graph resolution can now connect a static Rails route to the
  action symbol when `app/controllers/<controller>_controller.rb` contains the
  matching controller class and action method. This remains intentionally
  narrow: no dynamic Rails routes, no namespaced controller inference, no
  concerns/metaprogramming, and no runtime routing inspection.
- The route calibration regression now covers Rails
  `SubscriptionsController#index` and `#create` graph edges with source refs to
  `config/routes.rb` plus the controller class/action lines.
- The polyglot scanner-to-context eval gained a Rails reports variant that
  proves ContextPack selects `Reports API` and `inventory_symbols_reports_api`
  evidence for a reports task, with source refs to the Rails route and
  controller action while excluding unrelated Flask/Django/test evidence.
- `bun test apps/runner/test/project-inventory.test.ts -t "calibrates route patterns"`
  passed: 1 test / 26 expects.
- `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  passed: 11 scenarios / 26 variants.
- `bun test apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  passed: 2 test files / 64 tests / 465 expects.
- `bun run --filter @ainp/runner typecheck` passed.
- `bun run typecheck` passed.
- `bun run test` passed: 107 test files / 978 tests.

Fresh verification after adding Django urls.py-to-views.py graph evidence:

- Added a conservative Django convention slice for legacy Python projects.
  Static `path(...)` / `re_path(...)` handlers such as
  `views.track_shipment` now resolve from a `urls.py` route file to a sibling
  `views.py` function symbol.
- Route-handler graph resolution can now connect Django routes to source-backed
  view functions with source refs for both the route declaration and the view
  definition. This remains intentionally narrow: no dynamic imports, no
  arbitrary namespace inference, no dynamic class-based view expansion, and no
  cross-directory project routing guesses.
- The route calibration regression now covers Django `path(...)` and
  `re_path(...)` entries with graph edges from `src/urls.py` to sibling
  `src/views.py`.
- The polyglot scanner-to-context eval gained a Django shipments variant that
  proves ContextPack selects `Shipments API` and `inventory_symbols_shipments_api`
  evidence for a shipment-tracking task, with source refs to `legacy_django/urls.py`
  and `legacy_django/views.py` while excluding unrelated Flask/Rails/test evidence.
- `bun test apps/runner/test/project-inventory.test.ts -t "calibrates route patterns"`
  passed: 1 test / 30 expects.
- `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  passed: 11 scenarios / 27 variants.
- `bun test apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  passed: 2 test files / 64 tests / 469 expects.
- `bun run --filter @ainp/runner typecheck` passed.
- `bun run typecheck` passed.
- `bun run test` passed: 107 test files / 978 tests.

Fresh verification after adding Laravel route-to-controller-action graph evidence:

- Added a conservative Laravel convention slice for legacy PHP projects.
  Static controller handlers such as
  `Route::get('/api/customers/{customer}', [CustomerController::class, 'show'])`
  and `Route::post('/api/customers', 'CustomerController@store')` now retain
  controller identity as `CustomerController@action`.
- Namespaced Laravel controller arrays such as
  `[App\Http\Controllers\CustomerController::class, 'update']` resolve back to
  the default `app/Http/Controllers/CustomerController.php` convention path
  instead of treating the full Laravel namespace as nested filesystem segments.
- PHP controller action methods such as `public function show(...)` are now
  emitted as source-backed method symbols. Route-handler graph resolution can
  connect static Laravel routes to those action symbols with source refs for
  the route declaration, controller class, and action method.
- This remains intentionally narrow: no Laravel route model binding inference,
  no service-container/DI inference, no controller namespace guessing beyond
  the static handler string, no invokable controller expansion, and no runtime
  route inspection.
- The route calibration regression now covers Laravel array, string, and
  namespaced array handlers with graph edges from `routes/web.php` to
  `app/Http/Controllers/CustomerController.php`.
- The polyglot scanner-to-context eval now includes a Laravel customers
  variant that proves ContextPack selects `Customers API` and
  `inventory_symbols_customers_api` evidence for a customer task while
  excluding unrelated Flask/Django/Rails/test evidence.
- `bun test apps/runner/test/project-inventory.test.ts -t "calibrates route patterns"`
  passed: 1 test / 36 expects.
- `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  passed: 11 scenarios / 28 variants.

Fresh verification after adding legacy inventory quality metrics to eval:

- Added explicit inventory quality stats to `legacy_project_understanding_fixture`
  eval output: capability count, route count, symbol count, graph edge count,
  route-handler edge count, source chunk count, and exclusion count.
- Added legacy-specific numeric eval gates so future old-project scenarios can
  assert lower bounds for scanner coverage and upper bounds for noisy capability
  or route creation instead of relying only on individual include/exclude
  checks.
- Tightened the polyglot scanner-to-context eval with quality gates for the
  current Flask/Django/Rails/Laravel fixture: exactly five capabilities, exactly
  five HTTP routes, at least five graph edges, at least five route-handler
  edges, at least seven source chunks, at least one sensitive exclusion, and a
  ContextPack selected-section ceiling of nine.
- The generated eval report now surfaces those stats per variant; the current
  polyglot fixture reports five capabilities, five routes, nine symbols, five
  graph edges, five route-handler edges, nine source chunks, and one sensitive
  exclusion across Billing/Rails/Django/Laravel variants.
- `jq empty eval/scenarios/legacy-project-understanding-polyglot-e2e.json`
  passed.
- `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  passed: 11 scenarios / 28 variants.

Fresh verification after adding a multi-domain monolith legacy eval:

- Added `eval/scenarios/legacy-project-understanding-monolith-e2e.json`, a
  scanner-real old Express/CommonJS fixture with billing, customers, and
  reports domains. It covers mounted routers, CommonJS controller objects,
  service/repository calls, domain-specific tests, filtered `test/build/lint`
  package scripts, and `.env` sensitive-file exclusion.
- The monolith eval uses the legacy inventory quality metrics as a
  quasi-real-project quality gate: exactly three API capabilities, exactly five
  HTTP routes, at least 28 symbols, at least 11 graph edges, at least five
  route-handler edges, at least 13 source chunks, and at least one sensitive
  exclusion.
- Added billing and customer task variants to verify task-time ContextPack
  selection stays domain-focused: billing tasks select billing route,
  controller/service/test evidence while excluding customers/reports, and
  customer tasks select customer route/controller/test evidence while excluding
  billing/reports.
- The generated eval report for this scenario now surfaces coverage/noise
  stats per variant. Current output reports three capabilities, five routes,
  28 symbols, 11 graph edges, five route-handler edges, 13 source chunks, and
  one sensitive exclusion for both variants.
- `jq empty eval/scenarios/legacy-project-understanding-monolith-e2e.json`
  passed.
- `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  passed: 12 scenarios / 30 variants.

Fresh verification after adding legacy inventory trend summary reporting:

- Added a top-level `legacyInventorySummary` section to eval JSON output. It
  aggregates all `legacy_project_understanding_fixture` variants with totals,
  averages, min, max, and per-variant stats for capability count, HTTP route
  count, symbol count, graph edge count, route-handler edge count, source chunk
  count, and sensitive exclusion count.
- Added selected ContextPack section totals/average/min/max to the same
  summary so task-time retrieval noise can be tracked alongside scanner
  coverage.
- Added a "Legacy Inventory Summary" table to the generated HTML report before
  the detailed variant table, so coverage/noise trends are visible without
  running ad hoc `jq`.
- Current eval output reports three legacy scenarios and eight legacy variants:
  34 total capabilities, 34 total HTTP routes, 112 symbols, 56 graph edges, 34
  route-handler edges, 70 source chunks, eight sensitive exclusions, and
  selected context sections averaging nine with a 7-11 min/max range.
- `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  passed: 12 scenarios / 30 variants.
- A JSON/HTML spot check confirmed `legacyInventorySummary` exists in the JSON
  report and `Legacy Inventory Summary` renders in the HTML report.

Fresh verification after adding Spring legacy scanner-to-context coverage:

- Added a conservative Spring/Java decorator binding slice. The scanner now
  links method-level Spring mapping annotations to the following Java method
  symbol and combines them with class-level `@RequestMapping` prefixes when the
  class-level annotation is prefix-only.
- Avoided duplicating bound Spring method annotations as unmounted routes, so
  paths like `GET /daily` and `GET /{customerId}` do not create extra
  `Daily API` or controller-name capabilities beside the intended
  `Reports API` / `Customers API` grouping.
- Added Java method symbol extraction for return-type declarations such as
  `public ResponseEntity<?> reconcileInvoice(...)`, while preserving existing
  Python/Django function classification by keeping language-specific patterns
  ahead of the broader Java method pattern.
- Expanded ContextPack generic-token filtering for framework and layer terms
  such as `spring`, `controller`, `service`, `repository`, and generic load
  verbs so old-project tasks match business tokens rather than every
  `*Controller` capability.
- Added `eval/scenarios/legacy-project-understanding-spring-e2e.json`, a
  scanner-real Spring-style Java monolith fixture with billing, customers, and
  reports domains. Its three variants prove billing, customer, and reports
  tasks select the right route/controller/test evidence while excluding
  unrelated domains and sensitive `.env` content.
- `bun run test -- apps/runner/test/project-inventory.test.ts` passed:
  32 tests.
- `bun run test -- apps/runner/test/context-builder.test.ts` passed:
  33 tests.
- `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  passed: 13 scenarios / 33 variants.
- `bun run typecheck` passed across shared, api, runner, and web tsconfigs.
- `bun run test` passed: 107 test files / 979 tests.

Fresh verification after adding ASP.NET legacy scanner-to-context coverage:

- Added `eval/scenarios/legacy-project-understanding-aspnet-e2e.json`, a
  scanner-real ASP.NET-style C# monolith fixture with billing, customers, and
  reports domains.
- The fixture verifies controller attribute routes such as
  `[Route("api/v1/billing")]` and action attributes such as
  `[HttpPost("invoices/{invoiceId}/reconcile")]` produce route-handler
  evidence and focused `code_probe` ContextPack sections.
- The fixture guards `[controller]` token expansion and action method handler
  evidence through billing, customer, and reports task variants, while checking
  unrelated controller/test domains and `.env` content stay out of selected
  context.
- Strengthened the route calibration unit fixture so ASP.NET `ProductsController`
  GET/POST routes assert route-handler graph edges to `Show` and `Create`
  action symbols with source refs from both attribute and method lines.
- `bun run test -- apps/runner/test/project-inventory.test.ts` passed:
  32 tests.
- `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  passed: 14 scenarios / 36 variants.
- `bun run typecheck` passed across shared, api, runner, and web tsconfigs.

Fresh verification after adding conservative Java/C# service graph evidence:

- Added a conservative non-TS symbol-reference extraction slice for Java and
  C# files. The scanner now records explicit constructed receivers such as
  `new BillingService()` and only emits `symbol_reference` edges for calls made
  through those receivers.
- The new edge extraction links Spring-style Java controller methods to
  constructed service classes/methods and service methods to constructed
  repository classes/methods, with source refs from construction lines, call
  lines, and resolved class/method symbols.
- The same conservative extraction now covers ASP.NET-style C# action methods,
  including underscore-prefixed fields such as `_billingService`, without
  inferring dependency injection, interfaces, factories, dynamic dispatch, or
  runtime wiring.
- Tightened broad Java/C# method heuristics so statement lines such as
  `return Ok(...)` are not misclassified as method declarations.
- Extended `eval/scenarios/legacy-project-understanding-spring-e2e.json` and
  `eval/scenarios/legacy-project-understanding-aspnet-e2e.json` so the default
  eval suite requires both `route_handler` and `symbol_reference` evidence for
  these old enterprise-stack fixtures.
- `bun run test -- apps/runner/test/project-inventory.test.ts` passed:
  34 tests.
- Focused regression bundle passed: `bun run test --
  apps/runner/test/project-inventory.test.ts
  apps/runner/test/context-builder.test.ts
  apps/web/test/projects-rendering.test.ts
  apps/api/test/knowledge-artifacts-route.test.ts` reported 4 files / 100
  tests passing.
- `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  passed: 14 scenarios / 36 variants.
- `bun run typecheck` passed across shared, api, runner, and web tsconfigs.

Fresh verification after adding conservative Laravel/PHP service graph evidence:

- Extended the conservative non-TS symbol-reference extraction slice to PHP
  files. The scanner now records explicit PHP constructed receivers such as
  `$service = new CustomerService()` and emits `symbol_reference` edges only
  for calls through those receivers, such as `$service->loadProfile(...)`.
- Laravel/PHP controller actions can now link to explicitly constructed service
  classes/methods and onward to repository classes/methods, with source refs
  from route, controller action, construction, call, service, and repository
  evidence.
- This remains intentionally static and conservative: Laravel IoC/container
  resolution, constructor injection, interface bindings, factories, and runtime
  wiring are still not inferred.
- Extended `eval/scenarios/legacy-project-understanding-polyglot-e2e.json` so
  its Laravel branch now proves route -> controller action ->
  service/repository `symbol_reference` evidence enters task-focused
  ContextPack selection without leaking into unrelated Flask/Django/Rails
  tasks.
- `bun run test -- apps/runner/test/project-inventory.test.ts` passed:
  35 tests.
- Focused regression bundle passed: `bun run test --
  apps/runner/test/project-inventory.test.ts
  apps/runner/test/context-builder.test.ts
  apps/web/test/projects-rendering.test.ts
  apps/api/test/knowledge-artifacts-route.test.ts` reported 4 files / 101
  tests passing.
- `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  passed: 14 scenarios / 36 variants.
- `bun run typecheck` passed across shared, api, runner, and web tsconfigs.

Fresh verification after adding accepted-wrong correction auditability for
hybrid/source fallback evidence:

- ContextPack now annotates hybrid and source chunk `code_probe` sections that
  are linked to a capability suppressed by an accepted mark-wrong correction.
  These sections carry the correction artifact/source refs and correction
  review text while remaining source-level fallback evidence.
- `bun run test -- apps/runner/test/context-builder.test.ts` passed:
  33 tests.
- Focused regression bundle passed: `bun run test --
  apps/runner/test/project-inventory.test.ts
  apps/runner/test/context-builder.test.ts
  apps/web/test/projects-rendering.test.ts
  apps/api/test/knowledge-artifacts-route.test.ts` reported 4 files / 101
  tests passing.
- `bun run typecheck` passed across shared, api, runner, and web tsconfigs.
- `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  passed: 14 scenarios / 36 variants.
- `git diff --check` passed.
- `python3 ./.trellis/scripts/task.py validate
  .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap` passed.

Fresh implementation after adding project-page correction-vs-scan comparison:

- Project capability rows now load project knowledge artifacts and compare the
  current `project-inventory.json` capability output with persisted
  `project_capability_map` correction artifacts.
- Prior accepted corrections from earlier inventory artifacts are surfaced on
  later scan rows as confirmed/renamed/merged/wrong status chips with compact
  comparison text, while draft or review-required corrections remain visible as
  pending review instead of authoritative truth.
- Submitting a capability correction refreshes the project knowledge artifact
  cache so the correction state can appear on the projects page without a
  manual navigation through the knowledge page.
- Added web regression coverage for a current scan that still emits `Orders
  API` while an older governed correction renamed the same capability to
  `Fulfillment API`.
- `bun run test -- apps/web/test/projects-rendering.test.ts` passed: 5 tests.
- Focused regression bundle passed: `bun run test --
  apps/runner/test/project-inventory.test.ts
  apps/runner/test/context-builder.test.ts
  apps/web/test/projects-rendering.test.ts
  apps/api/test/knowledge-artifacts-route.test.ts` reported 4 files / 102
  tests passing.
- `bun run typecheck` passed across shared, api, runner, and web tsconfigs.
- `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  passed: 14 scenarios / 36 variants.
- `git diff --check` passed.
- `python3 ./.trellis/scripts/task.py validate
  .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap` passed.

Fresh implementation after adding conservative Flask/Python service graph
evidence:

- Extended the conservative non-TS symbol-reference extraction slice to Python
  files. The scanner now records explicit Python constructed receivers such as
  `service = BillingService()` and emits `symbol_reference` edges only for
  calls through those receivers, such as `service.reconcile(...)`.
- Flask/Python route handlers can now link to explicitly constructed service
  classes/methods and onward to repository classes/methods, with source refs
  from route, handler, construction, call, service, and repository evidence.
- This remains intentionally static and conservative: Python import resolution,
  dataflow, decorator object identity, dependency injection, factories,
  dynamic dispatch, and runtime wiring are still not inferred.
- Extended `eval/scenarios/legacy-project-understanding-polyglot-e2e.json` so
  its Flask billing branch now proves route -> handler -> service/repository
  `symbol_reference` evidence enters task-focused ContextPack selection
  without leaking into unrelated Django/Rails/Laravel/test evidence.
- `bun run test -- apps/runner/test/project-inventory.test.ts` passed:
  37 tests.
- `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  passed: 14 scenarios / 36 variants.

Fresh implementation after tightening same-domain monolith context selection:

- ContextPack now narrows matched multi-entrypoint capabilities before rendering
  task evidence. When a capability contains multiple routes, the selected
  entrypoint is chosen by task-token fit and the attached symbol evidence is
  expanded through the symbolGraph-reachable handler -> service -> repository
  chain.
- Source chunks selected through focused inventory or graph pointers now render
  and cite the pointed source lines before falling back to broad lexical line
  matches. This keeps broad domain words such as billing or invoice from
  pulling adjacent same-file routes into the task context.
- Added lexical normalization for `-iation` task wording so
  `reconciliation` can match `reconcile*` source symbols without relying on
  unrelated domain tokens.
- Tightened the default old Express/CommonJS monolith eval so the billing
  reconciliation variant excludes same-domain audit route/controller/service/
  repository source refs while still selecting the billing route, handler,
  service, repository, and test evidence.
- `bun run test -- apps/runner/test/context-builder.test.ts` passed:
  34 tests.
- `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  passed: 14 scenarios / 36 variants.

Fresh implementation after adding Flask Blueprint prefix route coverage:

- The scanner now recognizes file-local Flask `Blueprint(...)` variables with
  static `url_prefix` values and combines that prefix with decorated
  `@blueprint.route(...)` / `@blueprint.get/post/...` routes.
- Blueprint-backed routes cite both the Blueprint definition line and the route
  decorator line, then link to the decorated Python handler in `symbolGraph`
  route-handler evidence.
- The polyglot scanner-to-context eval now exercises the Flask billing route
  through a Blueprint prefix while keeping the same task-focused billing
  service/repository ContextPack evidence and unrelated-domain exclusions.
- `bun run test -- apps/runner/test/project-inventory.test.ts` passed:
  37 tests.
- `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  passed: 14 scenarios / 36 variants.

Fresh implementation after adding Flask register_blueprint prefix coverage:

- The scanner now recognizes same-file static Flask
  `app.register_blueprint(bp, url_prefix="...")` calls and applies that
  registration prefix to decorated routes on the registered Blueprint variable.
- Registered Blueprint routes cite the Blueprint definition line, registration
  line, route decorator line, and handler line in source-backed route-handler
  evidence.
- The framework calibration regression covers a `support` Blueprint registered
  under `/api/v3/support`, while the polyglot scanner-to-context eval now uses
  `register_blueprint(...)` for the Flask billing route.
- This remains intentionally static: cross-file Blueprint registration,
  dynamic `url_prefix` expressions, Blueprint alias tracking, nested Blueprint
  behavior, and Flask runtime routing inspection are not inferred.
- `bun run test -- apps/runner/test/project-inventory.test.ts -t "calibrates route patterns"`
  passed.
- `bun run test -- apps/runner/test/project-inventory.test.ts` passed:
  41 tests.
- `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts apps/web/test/projects-rendering.test.ts apps/api/test/knowledge-artifacts-route.test.ts`
  passed: 4 test files / 110 tests.
- `bun run typecheck` passed.
- `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  passed: 14 scenarios / 37 variants.

Fresh implementation after adding FastAPI APIRouter prefix route coverage:

- The same conservative file-local Python prefix scanner now recognizes
  `APIRouter(prefix="...")` variables and combines the static prefix with
  decorated `@router.get/post/...` route paths.
- APIRouter-backed routes cite both the router definition line and decorator
  line, then link to the decorated Python handler in `symbolGraph`
  route-handler evidence.
- This remains intentionally static: cross-file `include_router(...)`, dynamic
  prefix expressions, runtime router object identity, and dependency injection
  are still not inferred.
- `bun run test -- apps/runner/test/project-inventory.test.ts -t "calibrates route patterns"`
  passed.

Fresh implementation after adding FastAPI include_router prefix coverage:

- The scanner now recognizes same-file static
  `app.include_router(router, prefix="...")` calls and combines the include
  prefix with the router's own static `APIRouter(prefix="...")` value before
  applying decorated `@router.get/post/...` paths.
- Include-mounted FastAPI routes cite the router definition line, the
  `include_router(...)` line, and the route decorator line, then link to the
  decorated Python handler in `symbolGraph` route-handler evidence.
- This remains intentionally static: cross-file router includes, dynamic prefix
  expressions, runtime router object identity, dependency injection, and Python
  import/dataflow resolution are still not inferred.
- `bun run test -- apps/runner/test/project-inventory.test.ts -t "calibrates route patterns"`
  passed.
- `bun run test -- apps/runner/test/project-inventory.test.ts`
  passed: 37 tests.
- `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts apps/web/test/projects-rendering.test.ts apps/api/test/knowledge-artifacts-route.test.ts`
  passed: 105 tests.
- `bun run typecheck` passed.
- `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  passed: 14 scenarios / 36 variants.
- `git diff --check` passed.
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.

Fresh implementation after adding Django include URLConf coverage:

- The scanner now recognizes static Django `path("prefix/", include("app.urls"))`
  URLConf mounts when the referenced `app/urls.py` file is present in the
  scanned repository.
- Child Django `path(...)` / `re_path(...)` routes in the included URLConf now
  render as full mounted routes, cite both the parent include line and child
  route line, and still resolve `views.<name>` handlers to sibling `views.py`
  function symbols in `symbolGraph` route-handler evidence.
- Parent include lines are no longer emitted as fake standalone business
  routes such as `ANY /api/v6/billing/`.
- The polyglot scanner-to-context eval now exercises the Django shipment route
  through a project-level URLConf include while preserving focused Shipments
  API ContextPack selection and unrelated-domain exclusions. The fixture now
  uses the static tuple include form.
- This remains intentionally static: dynamic include targets, runtime URLConf
  selection, Django settings, and import/dataflow inference are still not
  inferred.
- `bun run test -- apps/runner/test/project-inventory.test.ts -t "calibrates route patterns"`
  passed.
- `bun run test -- apps/runner/test/project-inventory.test.ts`
  passed: 37 tests.
- `bun run typecheck` passed.
- `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  passed: 14 scenarios / 36 variants.

Fresh implementation after adding Laravel prefix group route coverage:

- The scanner now recognizes same-file static
  `Route::prefix("...")->group(function () { ... })` blocks and applies the
  group prefix to nested `Route::get/post/...` and `Route::match(...)` routes.
- Prefix-group mounted Laravel routes cite both the group line and the nested
  route line, then continue resolving controller action handlers such as
  `CustomerController@show` into `symbolGraph` route-handler evidence.
- The polyglot scanner-to-context eval now exercises the Laravel customer
  route through a prefix group while preserving focused Customers API
  ContextPack selection and unrelated-domain exclusions.
- This remains intentionally static: dynamic prefixes, route names,
  middleware/runtime behavior, Laravel resource/controller conventions,
  service container binding, and cross-file route group composition are still
  not inferred.
- `bun run test -- apps/runner/test/project-inventory.test.ts -t "calibrates route patterns"`
  passed.
- `bun run test -- apps/runner/test/project-inventory.test.ts`
  passed: 37 tests.
- `bun run typecheck` passed.
- `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  passed: 14 scenarios / 36 variants.

Fresh implementation after adding Laravel chained prefix group coverage:

- The scanner now recognizes same-file static Laravel Route chains where
  `prefix(...)` is not the first chain segment, such as
  `Route::middleware('auth')->prefix('/api/v4/ops')->group(...)`.
- Nested routes inherit the static prefix and keep existing controller action
  handler resolution plus route-handler graph evidence.
- The framework calibration regression covers
  `GET /api/v4/ops/customers/{customer}` with source refs to both the group
  chain and nested route lines.
- This remains intentionally static: dynamic prefixes, multi-line chain parsing
  beyond the existing scanner shape, route names, middleware semantics, route
  model binding, and runtime Laravel route inspection are not inferred.
- `bun run test -- apps/runner/test/project-inventory.test.ts -t "calibrates route patterns"`
  passed.
- `bun run test -- apps/runner/test/project-inventory.test.ts`
  passed: 41 tests.
- `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts apps/web/test/projects-rendering.test.ts apps/api/test/knowledge-artifacts-route.test.ts`
  passed: 110 tests.
- `bun run typecheck` passed.
- `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  passed: 14 scenarios / 37 variants.
- `git diff --check` passed.
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.
- `rg -n "[ \t]+$" apps/runner/src/project-inventory.ts apps/runner/test/project-inventory.test.ts .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/roadmap.md .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/regression-test-plan.md .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/completion-summary.md`
  returned no trailing-whitespace matches.

Fresh implementation after adding NestJS controller decorator route coverage:

- The scanner now recognizes TypeScript/NestJS-style class-level
  `@Controller("...")` decorators and method-level `@Get/Post/Put/Patch/Delete`
  decorators inside that controller scope.
- Decorator-derived NestJS routes combine the controller prefix with the method
  route, attach the class method handler name, and produce `symbolGraph`
  route-handler edges to the actual class method symbol.
- TypeScript class method symbols now use the method-name source line rather
  than the preceding decorator line, so route-handler evidence can cite the
  controller decorator, route decorator, and handler method line.
- The scanner-to-context e2e eval now includes a Nest Catalog controller
  variant that selects NestJS decorator-derived route/method evidence while
  excluding unrelated Express Orders/Payments route evidence.
- This remains intentionally static: dynamic decorator arguments, guards,
  interceptors, modules, dependency injection containers, and runtime Nest
  routing behavior are still not inferred.
- `bun run test -- apps/runner/test/project-inventory.test.ts -t "calibrates route patterns"`
  passed.
- `bun run test -- apps/runner/test/project-inventory.test.ts`
  passed: 37 tests.
- `bun run typecheck` passed.
- `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  passed: 14 scenarios / 37 variants.

Fresh implementation after adding Rails static resources route coverage:

- The scanner now recognizes static Rails `resources :name` route declarations
  and expands RESTful actions into HTTP entrypoints. Static `only:` and
  `except:` filters bound the expansion, so unrelated default actions are not
  invented when the route file narrows the resource.
- Rails resources routes inherit existing static `scope "/prefix" do` prefixes,
  cite both the scope line and resources line, and use conventional
  `ReportsController#index`-style handlers so route-handler graph resolution can
  link to source-backed Ruby controller actions.
- The polyglot scanner-to-context eval now includes a `resources :reports,
  only: [:index]` sibling route next to the existing daily reports route. The
  scanner exposes `GET /api/v1/reports`, while the daily-reports ContextPack
  variant still excludes the sibling resources line and `index` action source
  refs.
- This remains intentionally static: no Rails `namespace`, `constraints`,
  nested `resources do ...` block expansion, singular `resource`, route concern,
  module, controller override, or runtime route inference is attempted.
- `bun run test -- apps/runner/test/project-inventory.test.ts -t "Rails resources"`
  passed.
- `bun run test -- apps/runner/test/project-inventory.test.ts`
  passed: 38 tests.
- `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  passed: 14 scenarios / 37 variants.
- `bun run typecheck` passed.
- `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts apps/web/test/projects-rendering.test.ts apps/api/test/knowledge-artifacts-route.test.ts`
  passed: 4 test files / 106 tests.
- `git diff --check` passed.
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.

Fresh implementation after adding Rails static namespace route coverage:

- The scanner now recognizes same-file static Rails `namespace :name do` blocks
  and treats the namespace name as a route path prefix for nested routes.
- Namespace-backed routes cite both the namespace line and nested route line,
  then reuse existing Rails `controller#action` graph resolution for
  route-handler evidence.
- The framework calibration regression covers `namespace :admin do` producing
  `GET /admin/subscriptions` and linking it to `SubscriptionsController#index`.
- This remains intentionally static: Rails controller module namespaces,
  `path:` / `module:` overrides, constraints, concerns, dynamic blocks, and
  runtime route inspection are not inferred.
- `bun run test -- apps/runner/test/project-inventory.test.ts -t "calibrates route patterns"`
  passed.
- `bun run test -- apps/runner/test/project-inventory.test.ts` passed:
  41 tests.
- `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts apps/web/test/projects-rendering.test.ts apps/api/test/knowledge-artifacts-route.test.ts`
  passed: 4 test files / 110 tests.
- `bun run typecheck` passed.
- `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  passed: 14 scenarios / 37 variants.

Fresh implementation after adding Laravel static resource-controller route coverage:

- The scanner now recognizes static Laravel `Route::resource(...)` and
  `Route::apiResource(...)` declarations and expands RESTful controller actions
  into HTTP entrypoints. Static `only(...)` and `except(...)` chains bound the
  expansion, so omitted resource actions are not invented.
- Laravel resource-controller routes inherit existing static
  `Route::prefix(...)->group(...)` prefixes, cite both group and resource lines,
  and emit conventional `CustomerController@action` handlers so existing
  route-handler graph resolution can link to source-backed PHP controller
  methods.
- The polyglot scanner-to-context eval now includes a
  `Route::apiResource('customers', CustomerController::class)->only(['index'])`
  sibling route next to the existing customer profile route. The scanner exposes
  `GET /api/v1/customers`, while the customer-profile ContextPack variant still
  excludes the sibling resource line and `index` action source refs.
- The ContextPack builder now ranks same-capability entrypoints with
  graph-reachable symbol text, so a task term that appears in a handler ->
  service chain, such as `profile` in `CustomerService.loadProfile`, can focus
  the correct route instead of selecting a sibling REST action that only shares
  the broad route noun.
- This remains intentionally static: dynamic route/controller expressions,
  Laravel route names, nested/dotted resources, route model binding semantics,
  middleware/runtime behavior, resource parameter overrides, and service
  container binding are still not inferred.
- `bun run test -- apps/runner/test/project-inventory.test.ts -t "Laravel apiResource"`
  passed.
- `bun run test -- apps/runner/test/context-builder.test.ts -t "graph-reachable symbol text"`
  passed.
- `bun run test -- apps/runner/test/project-inventory.test.ts`
  passed: 39 tests.
- `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts apps/web/test/projects-rendering.test.ts apps/api/test/knowledge-artifacts-route.test.ts`
  passed: 4 test files / 108 tests.
- `bun run typecheck` passed.
- `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  passed: 14 scenarios / 37 variants.
- `git diff --check` passed.
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.

Fresh implementation after adding Laravel invokable controller route coverage:

- The scanner now recognizes static Laravel invokable controller route handlers
  such as `Route::get('/api/health-check', HealthCheckController::class)` and
  normalizes them to the conventional `HealthCheckController@__invoke` handler
  identity.
- Existing Laravel controller convention resolution now links those routes to
  source-backed `__invoke` method symbols under
  `app/Http/Controllers/<Controller>.php`, with route, controller class, and
  method source refs.
- The framework calibration regression covers `HealthCheckController::__invoke`
  and route-handler graph evidence for `/api/health-check`.
- This remains intentionally static: invokable controllers outside the
  conventional controller path, dependency injection, route model binding,
  middleware, container aliases, and runtime Laravel route inspection are not
  inferred.
- `bun run test -- apps/runner/test/project-inventory.test.ts -t "calibrates route patterns"`
  passed.
- `bun run test -- apps/runner/test/project-inventory.test.ts` passed:
  41 tests.
- `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts apps/web/test/projects-rendering.test.ts apps/api/test/knowledge-artifacts-route.test.ts`
  passed: 4 test files / 110 tests.
- `bun run typecheck` passed.
- `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  passed: 14 scenarios / 37 variants.

Fresh implementation after adding Django class-based view route-handler evidence:

- The scanner now recognizes static Django class-based view handlers of the
  form `views.SomeView.as_view()` or directly imported `SomeView.as_view()` when
  they appear in a `urls.py` route file.
- Route-handler graph resolution now maps those handlers to sibling
  `views.py` class symbols, so the inventory can cite both the URLConf route
  declaration and the class-based view definition as source-backed evidence.
- The focused scanner regression covers
  `TrackShipmentView.as_view()` and `views.ShipmentAuditView.as_view()`
  resolving from `shipments/urls.py` to `shipments/views.py`.
- The polyglot scanner-to-context eval Django fixture now uses an
  include-mounted `TrackShipmentView.as_view()` route, proving scanner-real
  route -> class-based-view evidence flows into task-focused ContextPack
  selection.
- This remains intentionally static: no class hierarchy traversal, no
  `dispatch`/`get`/`post` method expansion, no arbitrary import/module
  resolution, no mixin behavior, and no runtime Django URL resolver inference is
  attempted.
- `bun run test -- apps/runner/test/project-inventory.test.ts -t "Django class-based view"`
  passed.
- `jq empty eval/scenarios/legacy-project-understanding-polyglot-e2e.json`
  passed.
- `bun run test -- apps/runner/test/project-inventory.test.ts` passed:
  40 tests.
- `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts apps/web/test/projects-rendering.test.ts apps/api/test/knowledge-artifacts-route.test.ts`
  passed: 4 test files / 109 tests.
- `bun run typecheck` passed.
- `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  passed: 14 scenarios / 37 variants.
- `git diff --check` passed.
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.
- Direct trailing-whitespace scan across touched scanner/context/eval/task-doc
  files produced no matches.

Fresh implementation after adding Django directly imported function-view evidence:

- The scanner now recognizes static Django function view handlers of the form
  `path("...", some_view)` when they appear in a `urls.py` route file and a
  sibling `views.py` file defines `def some_view(...)`.
- Route-handler graph resolution now maps those directly imported function
  handlers to sibling `views.py` function symbols, so the inventory can cite
  both the URLConf route declaration and the view function definition as
  source-backed evidence.
- The focused scanner regression covers `shipment_status` resolving from
  `shipments/urls.py` to `shipments/views.py`.
- This remains intentionally static: no Python import graph, alias resolution,
  wildcard import handling, cross-directory module resolution, or runtime Django
  URL resolver inference is attempted.
- `bun run test -- apps/runner/test/project-inventory.test.ts -t "directly imported Django function"`
  passed.
- `bun run test -- apps/runner/test/project-inventory.test.ts -t "Django class-based view"`
  passed.
- `bun run test -- apps/runner/test/project-inventory.test.ts` passed:
  41 tests.
- `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts apps/web/test/projects-rendering.test.ts apps/api/test/knowledge-artifacts-route.test.ts`
  passed: 4 test files / 110 tests.
- `bun run typecheck` passed.
- `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  passed: 14 scenarios / 37 variants.

Fresh implementation after adding Go Gorilla mux static method-chain coverage:

- The scanner now recognizes static Go/Gorilla mux-style
  `mux.HandleFunc("...", handler).Methods(...)` route declarations.
- `Methods(...)` expands both quoted HTTP methods and `http.Method*` constants,
  so a single static mux line can emit separate GET/POST/etc. entrypoints with
  the same source-backed handler.
- Route-handler graph evidence links each emitted mux route entrypoint to the
  matching Go handler function symbol, preserving both the route declaration
  line and handler definition line as source refs.
- The framework calibration regression covers
  `mux.HandleFunc("/api/orders/{id}/audit", auditOrder).Methods("GET", http.MethodPost)`
  and verifies GET plus POST entrypoints and graph edges to `auditOrder`.
- This remains intentionally static: no Gorilla router variable dataflow,
  subrouter prefix inference, middleware semantics, `PathPrefix`, runtime
  method registration, or arbitrary Go call graph inference is attempted.
- `bun run test -- apps/runner/test/project-inventory.test.ts -t "calibrates route patterns"`
  passed.
- `bun run test -- apps/runner/test/project-inventory.test.ts`
  passed: 41 tests.
- `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts apps/web/test/projects-rendering.test.ts apps/api/test/knowledge-artifacts-route.test.ts`
  passed: 110 tests.
- `bun run typecheck` passed.
- `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  passed: 14 scenarios / 37 variants.
- `git diff --check` passed.
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.
- `rg -n "[ \t]+$" apps/runner/src/project-inventory.ts apps/runner/test/project-inventory.test.ts .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/roadmap.md .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/regression-test-plan.md .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/completion-summary.md`
  returned no trailing-whitespace matches.

Fresh implementation after adding Go constructed service/repository graph coverage:

- The heuristic symbol-reference scanner now includes `.go` files for
  explicit constructed receiver evidence.
- Go receiver methods such as `func (s *BillingService) ReconcileInvoice(...)`
  are classified as method symbols, while `type BillingService struct` symbols
  can act as constructed graph targets.
- The scanner recognizes static Go constructions such as
  `service := NewBillingService()` and `repo := &BillingRepository{}`, then
  links calls like `service.ReconcileInvoice(...)` and
  `repo.MarkReconciled(...)` into source-ref-backed `symbol_reference` edges.
- The focused regression now proves a Go billing route produces
  route -> handler -> service type/method -> repository type/method evidence.
- This remains intentionally static: no Go import/package resolution, interface
  dispatch, dependency injection, factory dataflow beyond `NewType()` naming,
  embedded structs, pointer aliasing, or runtime call graph inference is
  attempted.
- `bun run test -- apps/runner/test/project-inventory.test.ts -t "Go route handlers"`
  passed.
- `bun run test -- apps/runner/test/project-inventory.test.ts`
  passed: 42 tests.
- `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts apps/web/test/projects-rendering.test.ts apps/api/test/knowledge-artifacts-route.test.ts`
  passed: 111 tests.
- `bun run typecheck` passed.
- `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  passed: 14 scenarios / 37 variants.
- `git diff --check` passed.
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.
- `rg -n "[ \t]+$" apps/runner/src/project-inventory.ts apps/runner/test/project-inventory.test.ts .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/roadmap.md .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/regression-test-plan.md .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/completion-summary.md`
  returned no trailing-whitespace matches.

Fresh implementation after adding Go scanner-to-context eval coverage:

- Added `eval/scenarios/legacy-project-understanding-go-e2e.json` to the
  default eval corpus.
- The new scenario writes a temporary legacy Go monolith with Billing,
  Customers, and Reports domains, runs the real scanner, then feeds the
  generated `project-inventory.json` into the real ContextPack builder.
- The billing variant proves scanner-real Go mux/http route evidence plus
  route -> handler -> service type/method -> repository type/method graph refs
  become task-focused `code_probe` context without injecting unrelated
  customer/report handler or test evidence.
- Customer and reports variants prove the same fixture can focus other domains
  while excluding Billing evidence, protecting the irrelevant-context boundary
  across old Go monoliths.
- The fixture remains deterministic and dependency-free: it does not compile Go
  code, start a service, inspect runtime routers, infer imports/packages, or
  perform model-backed retrieval.
- `jq empty eval/scenarios/legacy-project-understanding-go-e2e.json` passed.
- `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  passed with the new default scenario: 15 scenarios / 40 variants.
- `bun run test -- apps/runner/test/project-inventory.test.ts`
  passed: 42 tests.
- `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts apps/web/test/projects-rendering.test.ts apps/api/test/knowledge-artifacts-route.test.ts`
  passed: 111 tests.
- `bun run typecheck` passed.
- `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  passed in final verification: 15 scenarios / 40 variants.
- `git diff --check` passed.
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.
- `rg -n "[ \t]+$" apps/runner/src/project-inventory.ts apps/runner/test/project-inventory.test.ts eval/scenarios/legacy-project-understanding-go-e2e.json .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/prd.md .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/roadmap.md .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/regression-test-plan.md .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/completion-summary.md`
  returned no trailing-whitespace matches.

Fresh implementation after aligning project-page capability correction status:

- Project capability-map rows now normalize correction `reviewStatus` values
  the same way as the ContextPack builder: missing review status and
  `reviewStatus='none'` both mean no review-required signal.
- Accepted correction artifacts carrying normalized lifecycle metadata now show
  as governed/effective in the project UI instead of remaining in a pending
  visual state.
- When both an accepted/governed correction and a newer draft/review-required
  correction exist for the same capability, the project row prefers the
  governed correction, preserving the human-approved map while the draft
  remains reviewable in the knowledge workflow.
- Corrections with `needs_review`, `stale`, `conflict`, or other non-`none`
  review statuses are still treated as pending and do not become effective UI
  guidance.
- `bun run test -- apps/web/test/projects-rendering.test.ts` passed: 5 tests.
- `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts apps/web/test/projects-rendering.test.ts apps/api/test/knowledge-artifacts-route.test.ts`
  passed: 111 tests.
- `bun run typecheck` passed.
- `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  passed: 15 scenarios / 40 variants.
- `git diff --check` passed.
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.
- `rg -n "[ \t]+$" apps/web/src/page-projects.ts apps/web/test/projects-rendering.test.ts .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/roadmap.md .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/regression-test-plan.md .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/completion-summary.md`
  returned no trailing-whitespace matches.

Fresh implementation after adding accepted rename correction eval coverage:

- Added a default `legacy-project-understanding` eval variant for an accepted
  `project_capability_map` rename correction from `Orders API` to
  `Fulfillment API`.
- The variant proves task-time ContextPack matching can use the corrected label
  to select the original inventory capability plus its symbols, tests, and
  hotspots.
- The correction artifact is expected as `knowledge_artifact:*` source
  evidence on the selected `code_probe`, while `knowledge_*` section rendering
  remains excluded so governed corrections do not become standalone context.
- `jq empty eval/scenarios/legacy-project-understanding.json` passed.
- `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts apps/web/test/projects-rendering.test.ts apps/api/test/knowledge-artifacts-route.test.ts`
  passed: 111 tests.
- `bun run typecheck` passed.
- `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  passed: 15 scenarios / 41 variants.
- `git diff --check` passed.
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.
- `rg -n "[ \t]+$" eval/scenarios/legacy-project-understanding.json .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/prd.md .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/roadmap.md .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/regression-test-plan.md .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/completion-summary.md`
  returned no trailing-whitespace matches.

Fresh implementation after adding accepted merge correction eval coverage:

- Added a default `legacy-project-understanding` eval variant for an accepted
  `project_capability_map` merge correction from `Orders API` into
  `Commerce Operations`.
- The variant proves task-time ContextPack matching can use the merge target to
  select the original inventory capability plus its symbols, tests, and
  hotspots.
- The correction artifact is expected as `knowledge_artifact:*` source
  evidence on the selected `code_probe`, while `knowledge_*` section rendering
  remains excluded so governed merge corrections do not become standalone
  context.
- `jq empty eval/scenarios/legacy-project-understanding.json` passed.
- Focused legacy eval passed:
  `bun run eval -- --scenario-dir /tmp/ainp-legacy-eval.jlzBeB --out-dir /tmp/ainp-legacy-eval-results`
  reported 1 scenario / 5 variants passed.
- Independent Trellis-check found no fixed or unfixed defects and verified the
  correction path with `bun run test -- apps/runner/test/context-builder.test.ts`
  passing 35 tests.
- `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  passed: 15 scenarios / 42 variants.
- `git diff --check` passed.
- `rg -n "[ \t]+$" eval/scenarios/legacy-project-understanding.json .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/prd.md .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/roadmap.md .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/regression-test-plan.md .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/completion-summary.md`
  returned no trailing-whitespace matches.
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.

Fresh implementation after adding accepted mark-wrong correction eval coverage:

- Added a default `legacy-project-understanding` eval variant for an accepted
  `project_capability_map` mark-wrong correction against `cap_api_orders`.
- The variant proves the heuristic `inventory_capability_cap_api_orders`
  section is suppressed while source-level hybrid inventory evidence for the
  Orders route, symbol, and test surface remains available as `code_probe`
  context.
- The correction artifact is expected only through source refs such as
  `knowledge_artifact:kart_eval_cap_orders_wrong` and
  `capability:cap_api_orders`; `knowledge_kart_eval_cap_orders_wrong` and raw
  `input_project_inventory_json` rendering remain excluded.
- `bun run test -- apps/runner/test/context-builder.test.ts` passed:
  1 test file / 35 tests.
- Focused legacy eval passed:
  `bun run scripts/eval-harness.ts --scenario-dir /tmp/ainp-legacy-eval.eQ7kUP/scenarios --out-dir /tmp/ainp-legacy-eval.eQ7kUP/out`
  reported 1 scenario / 6 variants passed.
- Full deterministic eval suite passed:
  `bun run scripts/eval-harness.ts --scenario-dir eval/scenarios --out-dir /tmp/ainp-eval-full.kbuJU9`
  reported 15 scenarios / 43 variants passed.

Fresh implementation after adding JAX-RS Java route coverage:

- Added conservative JAX-RS / Jakarta REST annotation scanning for old Java
  resources. The scanner now combines class-level `@Path(...)` prefixes with
  method-level `@GET` / `@POST` and `@Path(...)` annotations to create
  source-ref backed HTTP route entrypoints.
- JAX-RS route entrypoints reuse the existing Java method symbol matching, so
  route -> handler graph edges are produced without introducing a new parser or
  runtime dependency.
- The new regression fixture also keeps the existing explicit constructed
  service/repository chain behavior, proving a JAX-RS resource method can still
  link to service and repository symbols through conservative static evidence.
- This does not infer JAX-RS dependency injection, resource locators,
  providers, filters, interface bindings, application path mounting, or
  container/runtime wiring.
- `bun run test -- apps/runner/test/project-inventory.test.ts` passed:
  1 test file / 43 tests.
- `bun run test` passed: 107 test files / 993 tests.
- `bun run typecheck` passed.
- `bun run scripts/eval-harness.ts --scenario-dir eval/scenarios --out-dir /tmp/ainp-eval-jaxrs`
  passed: 15 scenarios / 43 variants.
- `git diff --check` passed.
- `rg -n "[ \t]+$" apps/runner/src/project-inventory.ts apps/runner/test/project-inventory.test.ts .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/prd.md .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/roadmap.md .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/regression-test-plan.md .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/completion-summary.md`
  returned no trailing-whitespace matches.
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.

Fresh implementation after adding JAX-RS scanner-to-context eval coverage:

- Added default scanner-to-context e2e eval coverage for a JAX-RS / Jakarta
  REST-style Java monolith with billing, customers, and reports domains.
- The new scenario writes a temporary project, runs real
  `buildProjectInventory()`, injects the generated inventory into
  `buildContextPack()`, and verifies class-level `@Path(...)`, method-level
  HTTP/path annotations, route -> handler graph edges, explicit
  service/repository graph evidence, tests, hotspots, and sensitive-file
  exclusions.
- The focused eval exposed a task-time matching noise issue where generic
  framework/layer terms such as `JAX-RS` and `resource` could select sibling
  `*Resource` capabilities. The ContextPack task token filter now treats
  `jax`, `jaxrs`, `resource`, `resources`, and `rest` as non-business tokens.
- Added a ContextPack regression test proving a billing JAX-RS resource task
  does not select the unrelated Customers API only because both classes are
  named `*Resource`.
- `jq empty eval/scenarios/legacy-project-understanding-jaxrs-e2e.json`
  passed.
- `bun run test -- apps/runner/test/context-builder.test.ts` passed:
  1 test file / 36 tests.
- `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  passed: 2 test files / 79 tests.
- `bun run test` passed: 107 test files / 994 tests.
- `bun run typecheck` passed.
- Focused JAX-RS eval passed:
  `bun run scripts/eval-harness.ts --scenario-dir /tmp/ainp-jaxrs-eval.2ZH19v/scenarios --out-dir /tmp/ainp-jaxrs-eval.2ZH19v/out`
  reported 1 scenario / 3 variants passed.
- Full deterministic eval suite passed:
  `bun run scripts/eval-harness.ts --scenario-dir eval/scenarios --out-dir /tmp/ainp-eval-jaxrs-default`
  reported 16 scenarios / 46 variants passed.
- `git diff --check` passed.
- `rg -n "[ \t]+$" apps/runner/src/context/builder.ts apps/runner/src/project-inventory.ts apps/runner/test/context-builder.test.ts apps/runner/test/project-inventory.test.ts eval/scenarios/legacy-project-understanding-jaxrs-e2e.json .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/prd.md .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/roadmap.md .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/regression-test-plan.md .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/completion-summary.md`
  returned no trailing-whitespace matches.
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.

Fresh implementation after adding JAX-RS application path prefixes:

- Extended conservative JAX-RS scanning to recognize static
  `@ApplicationPath(...)` declarations and apply that application-level prefix
  to resource class `@Path(...)` routes inside the same scanned project.
- JAX-RS route source refs now include both the application path annotation
  line and the resource/method annotation lines, preserving auditability for
  mounted resource paths such as `@ApplicationPath("/api")` plus
  `@Path("/v1/billing")`.
- Updated the default JAX-RS scanner-to-context e2e fixture to use a separate
  `LegacyApplication` class with `@ApplicationPath("/api")` and resource
  classes mounted under `/v1/...`, while preserving the final
  `/api/v1/...` route expectations.
- `bun run test -- apps/runner/test/project-inventory.test.ts` passed:
  1 test file / 43 tests.
- `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  passed: 2 test files / 79 tests.
- `bun run test` passed: 107 test files / 994 tests.
- `bun run typecheck` passed.
- Focused JAX-RS eval passed:
  `bun run scripts/eval-harness.ts --scenario-dir /tmp/ainp-jaxrs-app-eval.l3WS0V/scenarios --out-dir /tmp/ainp-jaxrs-app-eval.l3WS0V/out`
  reported 1 scenario / 3 variants passed.
- Full deterministic eval suite passed:
  `bun run scripts/eval-harness.ts --scenario-dir eval/scenarios --out-dir /tmp/ainp-eval-jaxrs-application-path`
  reported 16 scenarios / 46 variants passed.
- `git diff --check` passed.
- `rg -n "[ \t]+$" apps/runner/src/context/builder.ts apps/runner/src/project-inventory.ts apps/runner/test/context-builder.test.ts apps/runner/test/project-inventory.test.ts eval/scenarios/legacy-project-understanding-jaxrs-e2e.json .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/prd.md .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/roadmap.md .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/regression-test-plan.md .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/completion-summary.md`
  returned no trailing-whitespace matches.
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.

Fresh implementation after adding Java Servlet scanner-to-context eval coverage:

- Added conservative Java Servlet annotation scanning for old Java web
  applications. The scanner now recognizes static `@WebServlet(...)`
  declarations, including single string paths, `urlPatterns = "..."`, and
  `urlPatterns = { ... }`, and maps servlet methods such as `doGet` and
  `doPost` to HTTP route entrypoints.
- Servlet route entrypoints reuse the existing Java method symbol matching, so
  route -> servlet method graph edges are produced without introducing a new
  parser or runtime dependency.
- The new regression fixture preserves the existing explicit constructed
  service/repository chain behavior, proving a servlet handler method can link
  to service and repository symbols through conservative static evidence.
- Added default scanner-to-context e2e eval coverage for a Java Servlet
  monolith with billing, customers, and reports domains. The scenario writes a
  temporary project, runs real `buildProjectInventory()`, injects the generated
  inventory into `buildContextPack()`, and verifies focused ContextPack
  selection without leaking unrelated servlet/test domains.
- This does not infer servlet container registration, filters, listeners,
  init-param behavior, dependency injection, interfaces, factories, or dynamic
  runtime wiring.
- `jq empty eval/scenarios/legacy-project-understanding-servlet-e2e.json`
  passed.
- `bun run test -- apps/runner/test/project-inventory.test.ts` passed:
  1 test file / 44 tests.
- `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  passed: 2 test files / 80 tests.
- `bun run typecheck` passed.
- Focused Servlet eval passed:
  `bun run scripts/eval-harness.ts --scenario-dir /tmp/ainp-servlet-eval.XD7TUR/scenarios --out-dir /tmp/ainp-servlet-eval.XD7TUR/out`
  reported 1 scenario / 3 variants passed.
- Full deterministic eval suite passed:
  `bun run scripts/eval-harness.ts --scenario-dir eval/scenarios --out-dir /tmp/ainp-eval-servlet-default`
  reported 17 scenarios / 49 variants passed.
- `bun run test` passed: 107 test files / 995 tests.

Fresh implementation after adding Struts scanner-to-context eval coverage:

- Added conservative Struts XML action mapping scanning for old Java MVC
  applications. The scanner now recognizes static Struts2 `struts.xml`
  `<package namespace=...><action name=... class=... method=...>` mappings and
  Struts1 `struts-config.xml` `<action path=... type=...>` mappings.
- Struts route entrypoints are emitted as `ANY` HTTP routes and map static
  Action classes to handler strings such as `ReconcileInvoiceAction#execute`.
  The route-handler graph resolver now links those handlers to the Action
  method symbol when present, or conservatively falls back to the Action class
  symbol.
- The new regression fixture preserves the existing explicit constructed
  service/repository chain behavior, proving a Struts Action method can link to
  service and repository symbols through conservative static evidence.
- Added default scanner-to-context e2e eval coverage for a Struts monolith with
  billing, customers, and reports domains. The scenario writes a temporary
  project, runs real `buildProjectInventory()`, injects the generated inventory
  into `buildContextPack()`, and verifies focused ContextPack selection
  without leaking unrelated Struts Action/test domains.
- The focused eval exposed the same framework-layer matching problem seen with
  JAX-RS resources: task terms such as `Struts` and `action` could select
  sibling `*Action` capabilities. The ContextPack task token filter now treats
  `struts`, `action`, and `actions` as non-business tokens.
- This does not infer wildcard actions, interceptors, forwards/results,
  dynamic method dispatch, dependency injection, interfaces, factories, or
  runtime framework wiring.
- `jq empty eval/scenarios/legacy-project-understanding-struts-e2e.json`
  passed.
- `bun run test -- apps/runner/test/project-inventory.test.ts` passed:
  1 test file / 45 tests.
- `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  passed: 2 test files / 82 tests.
- Focused Struts eval passed:
  `bun run scripts/eval-harness.ts --scenario-dir /tmp/ainp-struts-eval.7lBuqy/scenarios --out-dir /tmp/ainp-struts-eval.7lBuqy/out`
  reported 1 scenario / 3 variants passed.
- `bun run typecheck` passed.
- Full deterministic eval suite passed:
  `bun run scripts/eval-harness.ts --scenario-dir eval/scenarios --out-dir /tmp/ainp-eval-struts-default`
  reported 18 scenarios / 52 variants passed.
- `bun run test` passed: 107 test files / 997 tests.

Fresh implementation after adding `web.xml` Servlet scanner-to-context eval coverage:

- Added conservative Java Servlet deployment descriptor scanning for older Java
  web applications. The scanner now recognizes static `WEB-INF/web.xml`
  servlet-name / servlet-class / url-pattern mappings.
- `web.xml` Servlet route entrypoints resolve the target Servlet class file and
  emit one route per implemented servlet handler method such as `doGet` or
  `doPost`, preserving source refs to both the deployment descriptor mapping
  and the target Java handler method.
- The route-handler graph resolver now handles generic Java `Class#method`
  handler strings, so `BillingServlet#doPost` links to the servlet method
  symbol and then through the existing conservative explicit
  service/repository chain.
- Added default scanner-to-context e2e eval coverage for a `web.xml` Servlet
  monolith with billing, customers, and reports domains. The scenario writes a
  temporary project, runs real `buildProjectInventory()`, injects the generated
  inventory into `buildContextPack()`, and verifies focused ContextPack
  selection without leaking unrelated servlet/test domains.
- This does not infer servlet filters, listeners, init-param behavior,
  dependency injection, dynamic registration, wildcard servlet mappings, or
  runtime container wiring.
- `jq empty eval/scenarios/legacy-project-understanding-webxml-servlet-e2e.json`
  passed.
- `bun run test -- apps/runner/test/project-inventory.test.ts` passed:
  1 test file / 46 tests.
- `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  passed: 2 test files / 83 tests.
- `bun run typecheck` passed.
- Focused `web.xml` Servlet eval passed:
  `bun run scripts/eval-harness.ts --scenario-dir /tmp/ainp-webxml-servlet-eval.LSeMIj/scenarios --out-dir /tmp/ainp-webxml-servlet-eval.LSeMIj/out`
  reported 1 scenario / 3 variants passed.
- Full deterministic eval suite passed:
  `bun run scripts/eval-harness.ts --scenario-dir eval/scenarios --out-dir /tmp/ainp-eval-webxml-servlet-default`
  reported 19 scenarios / 55 variants passed.
- `bun run test` passed: 107 test files / 998 tests.

Fresh implementation after adding JAX-WS / SOAP scanner-to-context eval coverage:

- Added conservative JAX-WS / SOAP service annotation scanning for old Java
  service projects. The scanner now recognizes static `@WebService(...)`
  class annotations and non-excluded `@WebMethod(...)` operation annotations.
- JAX-WS service operations are emitted as source-ref backed `ANY
  /soap/<service>/<operation>` inventory entrypoints with `Class#method`
  handlers, allowing the existing Java route-handler resolver to link each
  SOAP operation to the annotated method symbol.
- The implementation reuses the existing conservative explicit
  service/repository chain for Java, so a SOAP operation method can link to
  `new Service()` / `service.call()` and repository evidence without inferring
  DI, container wiring, WSDL deployment descriptors, handlers, interceptors, or
  dynamic endpoint publication.
- Added task-token filtering for SOAP framework vocabulary such as `soap`,
  `web`, `webservice`, `webmethod`, `operation`, and `method`, preventing a
  task like "legacy SOAP web service" from selecting unrelated sibling SOAP
  capabilities through framework words alone.
- Added default scanner-to-context e2e eval coverage for a JAX-WS fixture with
  billing and customer SOAP services. The scenario writes a temporary project,
  runs real `buildProjectInventory()`, injects the generated inventory into
  `buildContextPack()`, and verifies focused billing ContextPack selection
  without leaking the unrelated customer SOAP service.
- `jq empty eval/scenarios/legacy-project-understanding-jaxws-e2e.json`
  passed.
- `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  passed: 2 test files / 85 tests.
- Focused JAX-WS eval passed:
  `bun run eval -- --scenario-dir /tmp/ainp-jaxws-eval-FVSpz4`
  reported 1 scenario / 1 variant passed.
- `bun run typecheck` passed.

Fresh implementation after adding WCF / .NET scanner-to-context eval coverage:

- Added conservative WCF / .NET service-contract scanning for old C# service
  projects. The scanner recognizes static `[ServiceContract(...)]` type
  attributes and `[OperationContract(...)]` methods.
- WCF operations are emitted as source-ref backed `ANY
  /wcf/<service>/<operation>` inventory entrypoints. `wcf` is ignored as a
  generic route prefix so capabilities are grouped under names such as
  `Billing Statement Service API`, not `Wcf API`.
- Interface-level WCF contracts can resolve to a unique static implementation
  class when the implementation declares the interface and the matching method
  exists. The route handler then uses the existing `Class#method` graph
  resolver and the existing conservative C# explicit constructed
  service/repository chain.
- Added task-token filtering for WCF framework vocabulary such as `wcf`,
  `contract`, `servicecontract`, and `operationcontract`, preventing a task
  like "legacy WCF service contract" from selecting unrelated sibling WCF
  capabilities through framework words alone.
- Added default scanner-to-context e2e eval coverage for a WCF fixture with
  billing and customer service contracts. The scenario writes a temporary
  project, runs real `buildProjectInventory()`, injects the generated
  inventory into `buildContextPack()`, and verifies focused billing ContextPack
  selection without leaking the unrelated customer WCF service.
- This does not infer WCF endpoint configuration, bindings, hosts, behaviors,
  service model config, DI/container wiring, multiple implementation
  disambiguation, or dynamic service publication.
- `jq empty eval/scenarios/legacy-project-understanding-wcf-e2e.json` passed.
- `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  passed: 2 test files / 87 tests.
- Focused WCF eval passed:
  `bun run eval -- --scenario-dir /tmp/ainp-wcf-eval.Nd5bXX/scenarios --out-dir /tmp/ainp-wcf-eval.Nd5bXX/out`
  reported 1 scenario / 1 variant passed.
- `bun run typecheck` passed.
- Full deterministic eval suite passed:
  `bun run eval -- --out-dir /tmp/ainp-eval-wcf-default-current`
  reported 21 scenarios / 57 variants passed.
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.
- `git diff --check -- ...` for touched tracked files passed; trailing
  whitespace scan over touched tracked and untracked files had no matches.

Fresh implementation after adding ASMX / .NET WebService scanner-to-context eval coverage:

- Added conservative ASMX / .NET WebService scanning for old C# SOAP-style
  service projects. The scanner recognizes static `[WebService(...)]` class
  attributes and `[WebMethod(...)]` operation methods.
- ASMX WebService operations are emitted as source-ref backed `ANY
  /asmx/<service>/<operation>` inventory entrypoints with `Class#method`
  handlers, allowing the existing handler resolver to link each operation to
  the C# method symbol.
- `asmx` is ignored as a generic route prefix so capability grouping produces
  domain names such as `Billing Statement Service API`, not `Asmx API`.
- The implementation reuses the existing conservative C# explicit
  service/repository chain, so an ASMX WebMethod can link to constructed
  manager/service/repository evidence without inferring `.asmx` directives,
  IIS mappings, SOAP extensions, config bindings, DI/container wiring, or
  dynamic service publication.
- Added task-token filtering for ASMX framework vocabulary so a task like
  "legacy ASMX web service" does not select unrelated sibling ASMX capabilities
  through framework words alone.
- Added default scanner-to-context e2e eval coverage for an ASMX fixture with
  billing and customer WebServices. The scenario writes a temporary project,
  runs real `buildProjectInventory()`, injects the generated inventory into
  `buildContextPack()`, and verifies focused billing ContextPack selection
  without leaking the unrelated customer ASMX service.
- `jq empty eval/scenarios/legacy-project-understanding-asmx-e2e.json` passed.
- `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  passed: 2 test files / 89 tests.
- Focused ASMX eval passed:
  `bun run eval -- --scenario-dir /tmp/ainp-asmx-eval.MLxDMx/scenarios --out-dir /tmp/ainp-asmx-eval.MLxDMx/out`
  reported 1 scenario / 1 variant passed.
- `bun run typecheck` passed.
- Full deterministic eval suite passed:
  `bun run eval -- --out-dir /tmp/ainp-eval-asmx-default`
  reported 22 scenarios / 58 variants passed.
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.
- `git diff --check -- ...` for touched tracked files passed; trailing
  whitespace scan over touched tracked and untracked files had no matches.

Fresh implementation after adding Spring XML MVC scanner-to-context eval coverage:

- Added conservative Spring XML MVC scanning for old Java web applications.
  The scanner recognizes static `SimpleUrlHandlerMapping` blocks in XML config
  files and extracts URL maps from `<prop key="/...">beanId</prop>` plus
  `<entry key="/..." value-ref="beanId" />` / `value="beanId"` mappings.
- Spring XML MVC routes are emitted as source-ref backed `ANY /...` inventory
  entrypoints with `Controller#handleRequest` handlers after resolving the
  same-file target bean id to a concrete controller class.
- Route source refs cite the mapping bean line, the `<prop>` / `<entry>` line,
  and the resolved controller bean definition line so ContextPack audits can
  explain why the XML route was selected.
- The implementation reuses the existing conservative Java explicit
  service/repository graph chain, so an XML-mapped controller can link through
  constructed service/repository evidence without inferring
  `DispatcherServlet`, `ViewResolver`, `HandlerAdapter`, bean aliases/imports,
  parent contexts, DI/container wiring, interceptors, or runtime mappings.
- Added task-token filtering for Spring XML MVC framework vocabulary such as
  `bean`, `beans`, `mapping`, `mappings`, `mvc`, and `xml`, so a task like
  "legacy Spring XML MVC mapping" does not select unrelated XML-mapped
  controller capabilities through framework words alone.
- Added default scanner-to-context e2e eval coverage for a Spring XML MVC
  fixture with billing and customer controllers. The scenario writes a
  temporary project, runs real `buildProjectInventory()`, injects the generated
  inventory into `buildContextPack()`, and verifies focused billing ContextPack
  selection without leaking the unrelated customer XML mapping.
- `jq empty eval/scenarios/legacy-project-understanding-springxml-e2e.json`
  passed.
- `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  passed: 2 test files / 91 tests.
- `bun run typecheck` passed.
- Focused Spring XML eval passed:
  `bun run eval -- --scenario-dir /tmp/ainp-springxml-eval-final.PaR6ku/scenarios --out-dir /tmp/ainp-springxml-eval-final.PaR6ku/out`
  reported 1 scenario / 1 variant passed.
- Full deterministic eval suite passed:
  `bun run eval -- --out-dir /tmp/ainp-eval-springxml-default-final`
  reported 23 scenarios / 59 variants passed.
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.
- `git diff --check -- ...` for touched tracked files passed; trailing
  whitespace scan over touched tracked and untracked files had no matches.
- Lint-script discovery with `rg -n '"lint"\s*:' --glob package.json`
  produced no matches, so no package lint script was available from that scan.

Fresh implementation after adding Spring XML URL bean-name mapping and graph-focused narrowing:

- Added conservative Spring XML MVC URL bean-name scanning for old Java web
  applications. The scanner now treats static `/...` bean `name` values, and
  conservative `/...` bean `id` values, as `ANY /...` inventory entrypoints
  mapped to `Controller#handleRequest`.
- URL bean-name routes cite the bean definition line and reuse the existing
  Java handler resolver plus explicit constructed service/repository graph
  chain. Dynamic `${...}` bean names remain ignored.
- Tightened task-time ContextPack narrowing for multi-entrypoint capabilities:
  when the selected entrypoint has graph-reachable symbols, the builder keeps
  those graph-focused symbols plus same-file class symbols and no longer merges
  sibling text-matched symbols back into capability/symbol sections.
- Extended the Spring XML scanner-to-context eval fixture with a
  `spring-xml-bean-name-billing-statement` variant. It now proves
  `SimpleUrlHandlerMapping` and URL bean-name routes can coexist in the same
  Billing capability while a statement task selects the bean-name route and
  excludes sibling invoice/controller evidence.
- Focused pre-fix regression evidence:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "bean-name URL"`
  failed before scanner support with no Spring XML URL bean-name routes.
- Focused scanner regression passed after implementation:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "bean-name URL"`.
- Focused pre-fix ContextPack regression evidence:
  `bun run test -- apps/runner/test/context-builder.test.ts -t "sibling symbols"`
  failed because graph-focused selection reintroduced `BillingController`.
- Focused ContextPack regression passed after narrowing:
  `bun run test -- apps/runner/test/context-builder.test.ts -t "sibling symbols"`.
- Focused Spring XML eval passed after fixture and narrowing updates:
  `bun run eval -- --scenario-dir /tmp/ainp-springxml-beanname-eval.EKV8TL/scenarios --out-dir /tmp/ainp-springxml-beanname-eval.EKV8TL/out`
  reported 1 scenario / 2 variants passed.
- Final focused regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  reported 2 test files / 93 tests passed.
- `bun run typecheck` passed.
- Final focused Spring XML eval passed:
  `bun run eval -- --scenario-dir /tmp/ainp-springxml-beanname-final.nuxyeW/scenarios --out-dir /tmp/ainp-springxml-beanname-final.nuxyeW/out`
  reported 1 scenario / 2 variants passed.
- Final default deterministic eval suite passed:
  `bun run eval -- --out-dir /tmp/ainp-eval-springxml-beanname-default-final`
  reported 23 scenarios / 60 variants passed.
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.
- `git diff --check -- ...` for touched tracked files passed; trailing
  whitespace scan over touched tracked and untracked files had no matches.
- LSP/tsc diagnostics reported 0 errors for
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/src/context/builder.ts`.
- Lint-script discovery with `rg -n '"lint"\s*:' --glob package.json`
  produced no matches, so no package lint script was available from that scan.

Fresh implementation after adding ASP.NET Web Forms scanner-to-context eval coverage:

- Added conservative ASP.NET Web Forms scanning for old C# page-based
  applications. The scanner treats `.aspx` files as code-intelligence
  candidates, parses static Page directives, and extracts
  `Inherits="..."` code-behind class evidence.
- Web Forms pages are emitted as source-ref backed `ANY /...aspx` inventory
  entrypoints derived from the static page path, with common web roots such as
  `web`, `webroot`, `wwwroot`, and `src/main/webapp` stripped from the route.
- Page routes map conservatively to `PageClass#Page_Load` graph evidence and
  reuse the existing C# explicit constructed service/repository chain. The
  scanner does not infer master pages, user controls, declarative event
  handlers, dynamic page routing, IIS configuration, DI/container wiring, or
  lifecycle events beyond `Page_Load`.
- Tightened C# symbol parsing so heuristic symbols recognize
  `partial class`, which is required for common Web Forms code-behind classes.
- Added task-token filtering for Web Forms framework vocabulary such as
  `asp`, `aspnet`, `net`, `form`, `forms`, `page`, `pages`, and `webforms`,
  so a task like "legacy ASP.NET Web Forms page" does not select unrelated
  page capabilities through framework words alone.
- Added default scanner-to-context e2e eval coverage for a Web Forms fixture
  with billing and customer pages. The scenario writes a temporary project,
  runs real `buildProjectInventory()`, injects the generated inventory into
  `buildContextPack()`, and verifies focused billing ContextPack selection
  without leaking unrelated customer page, code-behind, or test evidence.
- Focused scanner regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "Web Forms"`
  reported 1 test passed.
- `jq empty eval/scenarios/legacy-project-understanding-webforms-e2e.json`
  passed.
- Focused Web Forms eval passed:
  `bun run eval -- --scenario-dir /tmp/ainp-webforms-eval.TYIKuI/scenarios --out-dir /tmp/ainp-webforms-eval.TYIKuI/out`
  reported 1 scenario / 1 variant passed.
- Final focused regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  reported 2 test files / 94 tests passed.
- `bun run typecheck` passed.
- Final default deterministic eval suite passed:
  `bun run eval -- --out-dir /tmp/ainp-eval-webforms-default-final`
  reported 24 scenarios / 61 variants passed.

Fresh implementation after adding old ASP.NET route-table scanner-to-context eval coverage:

- Added conservative old ASP.NET MVC/Web API route-table scanning for static
  `MapRoute(...)` and `MapHttpRoute(...)` calls in C# files. The scanner
  extracts routes only when the call supplies static string evidence for
  `url` / `routeTemplate` plus static `controller` and `action` defaults.
- Route-table entries are emitted as source-ref backed `ANY /...` inventory
  entrypoints mapped to `Controller#Action` handlers. Source refs cite the
  route call line, the route string line, and the defaults line so ContextPack
  audits can explain why the route was selected.
- Broad conventional route templates such as `{controller}/{action}/{id}` are
  intentionally ignored. The implementation does not infer route constraints,
  route collections, filters, areas, bundles, IIS configuration, or dynamic
  route registration.
- The implementation reuses the existing C# `Controller#Action` handler
  resolver and explicit constructed service/repository graph chain, so a
  route-table action can link through constructed service/repository evidence
  without adding a new dependency or type checker.
- Added task-token filtering for old ASP.NET route-table vocabulary such as
  `route`, `routes`, `routeconfig`, and `webapiconfig`, so route-table-oriented
  task briefs do not select unrelated capabilities through framework words
  alone.
- Added a focused scanner regression that first failed with no route-table
  entrypoints, then passed after implementation:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "route table"`
  reported 1 test passed.
- Added default scanner-to-context e2e eval coverage for an old ASP.NET
  route-table fixture with billing and customer route-table entries. The
  scenario writes a temporary project, runs real `buildProjectInventory()`,
  injects the generated inventory into `buildContextPack()`, verifies focused
  billing ContextPack selection, and proves the dynamic default
  `{controller}/{action}` route is not expanded.
- `jq empty eval/scenarios/legacy-project-understanding-aspnet-routetable-e2e.json`
  passed.
- Focused ASP.NET route-table eval passed:
  `bun run eval -- --scenario-dir /tmp/ainp-aspnet-routetable-eval.fTav6O/scenarios --out-dir /tmp/ainp-aspnet-routetable-eval.fTav6O/out`
  reported 1 scenario / 1 variant passed.
- Final focused regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  reported 2 test files / 95 tests passed.
- `bun run typecheck` passed.
- Final focused ASP.NET route-table eval passed:
  `bun run eval -- --scenario-dir /tmp/ainp-aspnet-routetable-final.n62Xbj/scenarios --out-dir /tmp/ainp-aspnet-routetable-final.n62Xbj/out`
  reported 1 scenario / 1 variant passed.
- Final default deterministic eval suite passed:
  `bun run eval -- --out-dir /tmp/ainp-eval-aspnet-routetable-default-final`
  reported 25 scenarios / 62 variants passed.
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.
- `git diff --check -- ...` for touched tracked/untracked task files passed;
  trailing whitespace scan over the same files had no matches.
- LSP/tsc diagnostics reported 0 errors for
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/src/context/builder.ts`.
- Lint-script discovery with `rg -n '"lint"\s*:' --glob package.json`
  produced no matches, so no package lint script was available from that scan.

Fresh implementation after adding legacy JSP scanner-to-context eval coverage:

- Added conservative legacy JSP scanning for old Java web applications. The
  scanner treats `.jsp` files as code-intelligence candidates and emits
  source-ref backed `ANY /...jsp` page entrypoints derived from static page
  paths under web roots such as `src/main/webapp`.
- JSP and ASP.NET Web Forms route derivation now share the same conservative
  web-root-relative path helper, keeping page routes stable without adding
  framework-specific runtime inference.
- The JSP scanner intentionally does not infer tag libraries, includes, form
  actions, servlet container mappings, scriptlet call graphs, DI/container
  wiring, or runtime page dispatch behavior.
- Added task-token filtering for JSP/page rendering vocabulary such as `jsp`,
  `render`, `rendered`, `rendering`, and `renders`, so a task about JSP page
  rendering does not select unrelated page capabilities through framework
  words alone.
- Added a focused scanner regression that first failed with no JSP entrypoint,
  then passed after implementation:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "legacy JSP"`
  reported 1 test passed.
- Added default scanner-to-context e2e eval coverage for a legacy JSP fixture
  with billing and customer pages. The scenario writes a temporary project,
  runs real `buildProjectInventory()`, injects the generated inventory into
  `buildContextPack()`, verifies focused billing JSP page route/source chunk
  selection, and excludes unrelated customer page/test evidence.
- `jq empty eval/scenarios/legacy-project-understanding-jsp-e2e.json` passed.
- Final focused regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  reported 2 test files / 96 tests passed.
- `bun run typecheck` passed.
- Final focused JSP eval passed:
  `bun run eval -- --scenario-dir /tmp/ainp-jsp-final.U4eKCw/scenarios --out-dir /tmp/ainp-jsp-final.U4eKCw/out`
  reported 1 scenario / 1 variant passed.
- Final default deterministic eval suite passed:
  `bun run eval -- --out-dir /tmp/ainp-eval-jsp-default-final`
  reported 26 scenarios / 63 variants passed.
- `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  passed.
- `git diff --check -- ...` for touched task/code/eval files passed; trailing
  whitespace scan over the same files had no matches.
- LSP/tsc diagnostics reported 0 errors for
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/src/context/builder.ts`.
- Lint-script discovery with `rg -n '"lint"\s*:' --glob package.json`
  produced no matches, so no package lint script was available from that scan.

Fresh implementation after adding legacy CodeIgniter scanner-to-context eval coverage:

- Added conservative CodeIgniter 2/3 route config scanning for old PHP MVC
  applications. The scanner recognizes static
  `application/config/routes.php` assignments such as
  `$route['billing/statements'] = 'billing/statements'`.
- CodeIgniter route entries are emitted as source-ref backed `ANY /...`
  inventory entrypoints only when both the route path and `controller/method`
  target are literal evidence.
- Route entries map conservatively to `Controller@method` handler evidence
  using the CodeIgniter `application/controllers/<Controller>.php` convention,
  then reuse the existing PHP explicit constructed service/repository graph
  chain.
- The implementation intentionally does not infer `default_controller`,
  `404_override`, wildcard routes, `(:num)` / `(:any)` patterns, callbacks,
  hooks, libraries, loaders, URI dash translation, DI/container wiring, or
  runtime framework routing.
- Added task-token filtering for CodeIgniter/PHP framework vocabulary such as
  `codeigniter` and `php`, so a task about legacy CodeIgniter or PHP routes
  does not select unrelated capabilities through framework/language words
  alone.
- Added a focused scanner regression that first failed with no CodeIgniter
  entrypoint, then passed after implementation:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "CodeIgniter"`
  reported 1 test passed.
- Added default scanner-to-context e2e eval coverage for a legacy CodeIgniter
  fixture with billing and customer routes. The scenario writes a temporary
  project, runs real `buildProjectInventory()`, injects the generated
  inventory into `buildContextPack()`, verifies focused billing route,
  controller action, service/repository, and test selection, and excludes
  unrelated customer route/controller/test evidence.
- `jq empty eval/scenarios/legacy-project-understanding-codeigniter-e2e.json`
  passed.
- Focused CodeIgniter eval passed:
  `bun run eval -- --scenario-dir /tmp/ainp-codeigniter-eval.rUdZmq/scenarios --out-dir /tmp/ainp-codeigniter-eval.rUdZmq/out`
  reported 1 scenario / 1 variant passed.
- Final focused regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  reported 2 test files / 97 tests passed.
- `bun run typecheck` passed.
- Final default deterministic eval suite passed:
  `bun run eval -- --out-dir /tmp/ainp-eval-codeigniter-default-final`
  reported 27 scenarios / 64 variants passed.

Fresh implementation after adding Classic ASP scanner-to-context eval coverage:

- Added conservative Classic ASP scanning for old page-based IIS applications.
  The scanner treats `.asp` files as code-intelligence candidates and emits
  source-ref backed `ANY /...asp` page entrypoints derived from static page
  paths under web roots such as `web`.
- Classic ASP page routes reuse the same conservative web-root-relative route
  helper as JSP and ASP.NET Web Forms static page routes.
- The implementation intentionally does not infer server-side includes, form
  actions, COM objects, ADO calls, IIS mappings, VBScript call graphs,
  DI/container wiring, or runtime page dispatch behavior.
- Added task-token filtering for Classic ASP framework/runtime vocabulary such
  as `classic`, `asp`, `vbscript`, and `iis`, so a task about Classic ASP on
  IIS does not select unrelated page capabilities through framework/runtime
  words alone.
- Added a focused scanner regression that first failed with no Classic ASP
  entrypoints, then passed after implementation:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "Classic ASP"`
  reported 1 test passed.
- Added default scanner-to-context e2e eval coverage for a Classic ASP fixture
  with billing and customer pages. The scenario writes a temporary project,
  runs real `buildProjectInventory()`, injects the generated inventory into
  `buildContextPack()`, verifies focused billing page/source chunk/test
  selection, and excludes unrelated customer page/test evidence.
- `jq empty eval/scenarios/legacy-project-understanding-classic-asp-e2e.json`
  passed.
- Focused Classic ASP eval passed:
  `bun run eval -- --scenario-dir /tmp/ainp-classic-asp-eval.AFTd2L/scenarios --out-dir /tmp/ainp-classic-asp-eval.AFTd2L/out`
  reported 1 scenario / 1 variant passed.
- Final focused regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  reported 2 test files / 98 tests passed.
- `bun run typecheck` passed.
- Final default deterministic eval suite passed:
  `bun run eval -- --out-dir /tmp/ainp-eval-classic-asp-default-final`
  reported 28 scenarios / 65 variants passed.

Fresh implementation after adding ColdFusion scanner-to-context eval coverage:

- Added conservative ColdFusion/CFML scanning for old page-based applications.
  The scanner treats `.cfm` and `.cfml` files as code-intelligence candidates
  and emits source-ref backed `ANY /...cfm` / `ANY /...cfml` page entrypoints
  derived from static page paths under web roots such as `wwwroot`.
- ColdFusion page routes reuse the same conservative web-root-relative route
  helper as JSP, Classic ASP, and ASP.NET Web Forms static page routes.
- The implementation intentionally does not infer `cfinclude`, `cfform`, CFC
  components, datasources, application mappings, scheduled tasks, CFML call
  graphs, DI/container wiring, or runtime page dispatch behavior.
- Added task-token filtering for ColdFusion/CFML vocabulary such as
  `coldfusion`, `cfm`, and `cfml`, so a task about a ColdFusion page does not
  select unrelated page capabilities through framework/language words alone.
- Added a focused scanner regression that first failed with no ColdFusion
  entrypoints, then passed after implementation:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "ColdFusion"`
  reported 1 test passed.
- Added default scanner-to-context e2e eval coverage for a ColdFusion fixture
  with billing and customer pages. The scenario writes a temporary project,
  runs real `buildProjectInventory()`, injects the generated inventory into
  `buildContextPack()`, verifies focused billing page/source chunk/test
  selection, and excludes unrelated customer page/test evidence.
- `jq empty eval/scenarios/legacy-project-understanding-coldfusion-e2e.json`
  passed.
- Focused ColdFusion eval passed:
  `bun run eval -- --scenario-dir /tmp/ainp-coldfusion-eval.jllMws/scenarios --out-dir /tmp/ainp-coldfusion-eval.jllMws/out`
  reported 1 scenario / 1 variant passed.
- Final focused regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  reported 2 test files / 99 tests passed.
- `bun run typecheck` passed.
- Final default deterministic eval suite passed:
  `bun run eval -- --out-dir /tmp/ainp-eval-coldfusion-default-final`
  reported 29 scenarios / 66 variants passed.

Fresh implementation after adding legacy CakePHP scanner-to-context eval coverage:

- Added conservative CakePHP 2/3 route config scanning for old PHP MVC
  applications. The scanner recognizes static `Router::connect(...)`
  assignments in `app/Config/routes.php` or `config/routes.php` when the route
  path and controller/action array values are literal evidence.
- CakePHP route entries are emitted as source-ref backed `ANY /...` inventory
  entrypoints and map to `CakePHP:<Controller>Controller@<action>` handler
  evidence.
- The handler resolver maps old CakePHP 2 routes to
  `app/Controller/<Controller>Controller.php` and CakePHP 3-style routes to
  `src/Controller/<Controller>Controller.php`, then reuses the existing PHP
  explicit constructed service/repository graph chain.
- The implementation intentionally does not infer dynamic route patterns,
  plugin routing, prefixes, named params, passed args, callbacks, helpers,
  components, model conventions, or runtime route inspection.
- Added task-token filtering for CakePHP/PHP vocabulary such as `cakephp` and
  `php`, so a task about a legacy CakePHP route does not select unrelated route
  capabilities through framework/language words alone.
- Added a focused scanner regression that first failed with no CakePHP
  entrypoints, then passed after implementation:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "CakePHP"`
  reported 1 test passed.
- Added default scanner-to-context e2e eval coverage for a legacy CakePHP
  fixture with billing and customer routes. The scenario writes a temporary
  project, runs real `buildProjectInventory()`, injects the generated
  inventory into `buildContextPack()`, verifies focused billing route,
  controller action, service/repository, and test selection, and excludes
  unrelated customer route/controller/test evidence.
- `jq empty eval/scenarios/legacy-project-understanding-cakephp-e2e.json`
  passed.
- Focused CakePHP eval passed:
  `bun run eval -- --scenario-dir /tmp/ainp-cakephp-eval.tawgUw/scenarios --out-dir /tmp/ainp-cakephp-eval.tawgUw/out`
  reported 1 scenario / 1 variant passed.
- Final focused regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  reported 2 test files / 100 tests passed.
- `bun run typecheck` passed.
- Final default deterministic eval suite passed:
  `bun run eval -- --out-dir /tmp/ainp-eval-cakephp-default-final`
  reported 30 scenarios / 67 variants passed.

Fresh implementation after adding legacy Symfony XML scanner-to-context eval
coverage:

- Added conservative Symfony XML route config scanning for old Symfony
  applications. The scanner recognizes `app/config/routing.xml` and
  `config/routes.xml` static `<route>` elements when the route `path` /
  `pattern` and `_controller` / `controller` target are literal evidence.
- Symfony XML route entries are emitted as source-ref backed `ANY /...`
  inventory entrypoints and map literal bundle/FQCN controller targets to
  `Symfony:<Controller>@<action>` handler evidence.
- The handler graph reuses existing PHP symbol evidence, so route-handler edges
  are produced only when the target controller action symbol exists; explicit
  PHP service/repository construction remains the conservative downstream
  chain.
- The implementation intentionally does not infer placeholders, imports,
  service-container controller ids, XML namespaces, entity decoding, callbacks,
  annotations, bundle imports, DI/container wiring, or runtime route
  inspection.
- Added a focused scanner regression:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "Symfony XML"`
  reported 1 test passed.
- Added default scanner-to-context e2e eval coverage for a legacy Symfony XML
  fixture with billing and customer routes. The scenario writes a temporary
  project, runs real `buildProjectInventory()`, injects the generated
  inventory into `buildContextPack()`, verifies focused billing route,
  controller action, service/repository, and test selection, and excludes
  unrelated customer route/controller/test evidence.
- `jq empty eval/scenarios/legacy-project-understanding-symfony-xml-e2e.json`
  passed.
- Focused Symfony XML eval passed:
  `bun run eval -- --scenario-dir /tmp/ainp-symfony-xml-eval.J0NeCj`
  reported 1 scenario / 1 variant passed.
- Final focused regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  reported 2 test files / 102 tests passed.
- `bun x tsc -p apps/runner/tsconfig.json --noEmit` passed.
- `bun run typecheck` passed.
- Full test suite passed:
  `bun run test` reported 107 test files / 1017 tests passed.
- Final default deterministic eval suite passed:
  `bun run eval` reported 32 scenarios / 69 variants passed.
- Trellis task validation passed:
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.
- Direct trailing-whitespace and control-character scans over the touched
  scanner, test, eval, and task-doc files reported no matches.

Fresh implementation after adding explicit task source-ref source chunk
selection:

- ContextPack source chunk retrieval now parses conservative source hints in
  task briefs, including `file:apps/api/src/payments.ts#L20` and
  `apps/api/src/payments.ts:20`.
- Exact source-ref hint matches rank ahead of graph pointers and lexical
  snippet matches, then narrow the rendered source chunk snippet and selected
  source refs to the referenced line when that line is present in the bounded
  chunk.
- Source chunk lexical scoring strips generated `L<number>:` prefixes before
  matching task tokens, so unrelated chunks do not enter context merely because
  their scanner snippet line labels share the same number.
- Focused regression passed:
  `bun test apps/runner/test/context-builder.test.ts -t "selects source chunks from explicit task source refs"`.
- Context builder regression passed:
  `bun test apps/runner/test/context-builder.test.ts` reported 45 tests /
  212 assertions passed.
- `bun run typecheck` passed.
- Focused legacy understanding eval passed:
  `bun run eval -- --scenario-dir /tmp/ainp-legacy-eval.gxxOYb --out-dir /tmp/ainp-legacy-eval.gxxOYb/out`
  reported 1 scenario / 6 variants passed.
- Trellis task validation passed:
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.
- `git diff --check -- apps/runner/src/context/builder.ts apps/runner/test/context-builder.test.ts .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/completion-summary.md`
  passed.
- Direct control-character and trailing-whitespace scans over the touched
  builder, test, and task-doc files reported no matches.
- A `trellis-check` subprocess was started but stalled without useful output
  or tool activity and was terminated; this increment's check evidence is
  therefore the implementation regression plus main-session focused
  verification, not an independent Trellis-check verdict.

Fresh implementation after tightening hybrid BM25 inventory match text:

- ContextPack hybrid inventory retrieval no longer indexes raw inventory record
  ids, filesystem paths, graph node refs, or source refs as BM25 match text.
  Hybrid records still render and cite source refs after selection, but path
  and source-ref strings no longer create the match by themselves.
- This keeps explicit file/source-ref task hints on the source chunk retrieval
  path instead of letting unrelated symbols, tests, hotspots, or graph records
  from the same file win through hybrid lexical matching.
- Added a focused regression proving `file:apps/api/src/payments.ts#L20`
  selects the narrowed source chunk without selecting an unrelated
  `CustomerAuditReporter` hybrid symbol from the same `payments.ts` path.
- Trellis-check independently reviewed the increment and found no fixed or
  unfixed issues. It verified graph-edge labels still participate in hybrid
  fallback, source refs still render as `code_probe` evidence after selection,
  and explicit file refs route through source chunk matching rather than hybrid
  path/source-ref text.
- Focused regression passed:
  `bun run test -- apps/runner/test/context-builder.test.ts -t "does not let explicit source refs select unrelated hybrid records by path text"`.
- Context builder regression passed:
  `bun run test -- apps/runner/test/context-builder.test.ts` reported
  46 tests passed.
- `bun run typecheck` passed.
- Focused legacy understanding eval passed:
  `bun run eval -- --scenario-dir /tmp/ainp-legacy-eval.mv17Le --out-dir /tmp/ainp-legacy-eval.mv17Le/out`
  reported 1 scenario / 6 variants passed.
- Trellis task validation passed:
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.
- `git diff --check -- apps/runner/src/context/builder.ts apps/runner/test/context-builder.test.ts .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/completion-summary.md`
  passed.
- Direct control-character and trailing-whitespace scans over the touched
  builder, test, and task-doc files reported no matches.

Fresh implementation after adding absolute source-ref normalization:

- ContextPack source chunk source-ref hint parsing now receives the current
  workspace path and registered project local path, so task briefs that mention
  an absolute path under either root normalize back to the scanner's
  repo-relative inventory path before source chunk matching.
- The parser also accepts slash and backslash path separators plus absolute
  Unix/Windows-style path prefixes, while leaving arbitrary paths outside the
  known roots as literal paths instead of suffix-matching them into the repo.
- Added regression coverage for both `/tmp/workspace/...#L20` and
  `/repo/...#L20` task refs, proving the matching source chunk is selected,
  rendered, and cited at the referenced line without adjacent same-file lines.
- Trellis-check reviewed the scoped increment, found the missing
  `project.localPath` regression coverage, fixed it by table-driving the test,
  and reported no remaining production-path findings.
- Context builder regression passed:
  `bun run test -- apps/runner/test/context-builder.test.ts` reported
  48 tests passed.
- Runner typecheck passed:
  `bun run --filter @ainp/runner typecheck`.
- Focused legacy understanding eval passed:
  `bun run eval -- --scenario-dir /tmp/ainp-legacy-eval.Cw3fjo`
  reported 1 scenario / 6 variants passed.
- Trellis task validation passed:
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.
- `git diff --check -- apps/runner/src/context/builder.ts apps/runner/test/context-builder.test.ts .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/completion-summary.md`
  passed.
- Direct control-character and trailing-whitespace scans over the touched
  builder, test, and task-doc files reported no matches.

Fresh verification after adding Fastify alias route-object detection:

- Implemented a scoped V1.1/V1.2 scanner increment for Fastify projects that
  create a server instance through `fastify()`, `Fastify()`, or
  `require("fastify")()` and then declare static object-form routes with
  `server.route({ method, url, handler })`.
- The scanner now treats those statically constructed Fastify instance
  variables as valid `route(...)` receivers, while continuing to ignore
  arbitrary `.route(...)` receivers.
- Added regression coverage to the framework calibration fixture proving a
  `require("fastify")()` alias route produces a DELETE HTTP entrypoint,
  preserves the static handler name, and emits a source-ref-backed
  route-handler graph edge to the exported handler symbol.
- Focused route calibration passed:
  `bun test apps/runner/test/project-inventory.test.ts -t "calibrates route patterns"`.
- Inventory scanner regression passed:
  `bun test apps/runner/test/project-inventory.test.ts` reported 60 tests
  passed.
- Runner typecheck passed:
  `bun run --filter @ainp/runner typecheck`.

Independent main-session verification for the Fastify alias route-object
increment:

- Reviewed the scoped scanner and fixture changes against `check.jsonl`
  context, including the V1.1/V1.2 roadmap boundaries and the
  `profile.bootstrap` inventory contract in the runner backend flow registry
  spec.
- Confirmed the new Fastify receiver detection remains static and bounded to
  known Fastify instance aliases, with regression coverage proving arbitrary
  object `.route(...)` calls are ignored.
- Focused route calibration passed:
  `bun test apps/runner/test/project-inventory.test.ts -t "calibrates route patterns"`.
- Inventory scanner regression passed:
  `bun test apps/runner/test/project-inventory.test.ts` reported 60 tests and
  565 expects passed.
- Runner typecheck passed:
  `bun run --filter @ainp/runner typecheck`.
- File-level diagnostics passed for
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts` with 0 diagnostics.
- Trellis task validation passed:
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.
- `git diff --check -- apps/runner/src/project-inventory.ts apps/runner/test/project-inventory.test.ts .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/completion-summary.md`
  passed.
- Direct control-character and trailing-whitespace scans over the touched
  scanner, test, and task-doc files reported no matches.

Fresh research after reviewing GitHub codebase-understanding projects:

- Added
  `research/github-codebase-understanding-patterns.md`, summarizing common
  patterns from repository-map, semantic code search, Tree-sitter, hybrid
  BM25/vector, GraphRAG, MCP, and local-first codebase intelligence projects.
- Added the research artifact to both `implement.jsonl` and `check.jsonl` so
  future implementation and verification agents inherit the same direction:
  static inventory and graph evidence remain primary, hybrid retrieval/RAG
  stays supplemental until graph contracts and eval metrics are stable.

Fresh verification after adding statically imported/required Fastify factory
alias support:

- Extended the Fastify object-form route scanner so a route receiver is
  accepted when it is created by a known Fastify factory identifier, including
  default imports from `"fastify"` and CommonJS aliases from
  `require("fastify")`.
- Kept the detection static and conservative: arbitrary factory calls such as
  `makeServer()` still do not authorize `.route({ ... })` receivers.
- Added framework calibration coverage for imported and required Fastify
  factory aliases, including route-handler graph edges to exported handler
  symbols and a negative arbitrary-factory route.
- Focused route calibration passed:
  `bun test apps/runner/test/project-inventory.test.ts -t "calibrates route patterns"`.
- Inventory scanner regression passed:
  `bun test apps/runner/test/project-inventory.test.ts` reported 60 tests and
  566 expects passed.
- Runner typecheck passed:
  `bun run --filter @ainp/runner typecheck`.
- Independent Trellis-check reviewed the scoped increment, found no fixed or
  unfixed defects, confirmed arbitrary factory receivers remain ignored, and
  repeated the focused/full inventory scanner tests, runner typecheck, task
  validation, scoped `git diff --check`, and direct CR/trailing-whitespace scan.
- Main-session final verification also passed:
  `bun test apps/runner/test/project-inventory.test.ts -t "calibrates route patterns"`
  reported 1 test / 70 expects, and
  `bun test apps/runner/test/project-inventory.test.ts` reported 60 tests /
  566 expects.
- Project-level pre-commit verification passed:
  `bun run test` reported 107 test files / 1023 tests, and
  `bun run typecheck` completed all shared/api/runner/web TypeScript projects.
- File-level diagnostics reported 0 errors for
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts`.
- Trellis task validation, scoped `git diff --check`, and direct CR/trailing
  whitespace scans over the scanner, test, and task-doc files passed.

Fresh verification after adding conservative Hapi.js route-object detection:

- Extended the static route scanner for legacy Hapi.js projects that construct
  a server through `Hapi.server(...)`, `new Hapi.Server(...)`, or direct
  `require("@hapi/hapi").server(...)` / `require("hapi").server(...)` calls,
  then declare object-form `server.route({ method, path, handler })` routes.
- Kept detection conservative: arbitrary objects with a `.route(...)` method
  do not create route entrypoints, and only literal `method` / `path` evidence
  is accepted.
- Added framework calibration coverage proving Hapi route objects create
  source-ref-backed HTTP entrypoints and route-handler graph edges to exported
  handler symbols while ignoring an unrelated fake `.route(...)` receiver.
- Focused route calibration passed:
  `bun test apps/runner/test/project-inventory.test.ts -t "calibrates route patterns"`
  reported 1 test / 75 expects.
- Inventory scanner regression passed:
  `bun test apps/runner/test/project-inventory.test.ts` reported 60 tests /
  571 expects.
- Runner typecheck passed:
  `bun run --filter @ainp/runner typecheck`.

Independent Trellis-check fix for the Hapi.js route-object increment:

- Tightened Hapi factory detection so `Hapi` / `hapi` identifiers are trusted
  only when the file contains actual `@hapi/hapi` / `hapi` import or require
  evidence. This prevents local lookalikes such as
  `const Hapi = makeLocalFactory()` from authorizing `server.route({ ... })`
  entrypoints.
- Added namespace import support for real Hapi aliases such as
  `import * as Hapi from "@hapi/hapi"`, preserving conservative real-module
  coverage after removing implicit global factory names.
- Added regression coverage proving a local `Hapi.server(...)` lookalike stays
  ignored while existing real Hapi route object coverage remains intact.
- Focused route calibration passed:
  `bun test apps/runner/test/project-inventory.test.ts -t "calibrates route patterns"`
  reported 1 test / 76 expects.
- Inventory scanner regression passed:
  `bun test apps/runner/test/project-inventory.test.ts` reported 60 tests /
  572 expects.
- ContextPack authority-boundary regression passed:
  `bun test apps/runner/test/context-builder.test.ts` reported 48 tests / 230
  expects, including raw inventory JSON exclusion cases.
- Typecheck passed:
  `bun run typecheck`.
- Trellis task validation passed:
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.
- Scoped trailing-whitespace, carriage-return, and control-character scans over
  `apps/runner/src/project-inventory.ts`,
  `apps/runner/test/project-inventory.test.ts`, and this task summary produced
  no matches.

Fresh verification after adding conservative Koa Router route detection:

- Added same-file `koa-router` / `@koa/router` import and require evidence
  detection for Koa Router constructors, including static
  `new Router({ prefix: "..." })` / `Router({ prefix: "..." })` prefixes.
- Koa route declarations now emit source-ref-backed HTTP entrypoints with
  import/constructor/route refs and reuse existing route-handler graph
  resolution when the handler symbol can be resolved conservatively.
- Added negative coverage for local Koa lookalikes such as
  `const Router = makeLocalRouter()` and object-literal `.get(...)` receivers
  with no Koa Router import/require evidence.
- Focused Koa regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "Koa Router"`
  reported 2 tests passed.
- Inventory scanner regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported
  62 tests passed.
- Runner typecheck passed:
  `bun run --filter @ainp/runner typecheck`.
- Scoped whitespace checks passed: direct trailing-whitespace / carriage-return
  `rg` scan over the scanner, test, and task summary produced no matches;
  `git diff --check -- apps/runner/src/project-inventory.ts apps/runner/test/project-inventory.test.ts .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/completion-summary.md`
  also exited cleanly.

Independent Trellis-check fix for the Koa Router guard regression:

- Found that the new Koa lookalike guard could suppress valid static Express
  Router alias forms such as
  `const Router = express.Router; const router = Router();`.
- Tightened the guard so framework-backed `Router` aliases from
  `express.Router`, `require("express").Router`, `import { Router as ... } from
  "express"`, and destructured Express requires remain valid while local
  `const Router = makeLocalRouter()` lookalikes stay blocked.
- Added regression coverage proving Express alias routes are emitted and local
  lookalike routes are not.
- Focused alias regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "Express Router factory aliases"`
  reported 1 test passed.
- Focused Koa regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "Koa Router"`
  reported 2 tests passed.
- Inventory plus ContextPack regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  reported 111 tests passed, including raw inventory JSON exclusion coverage.
- Runner typecheck and Trellis validation passed:
  `bun run --filter @ainp/runner typecheck` and
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.

Fresh verification after adding source-ref-aware capability selection:

- ContextPack inventory matching now uses explicit task source refs such as
  `file:apps/api/src/routes.ts#L11` as source-backed evidence for capability
  selection, even when the inventory has entrypoints/symbols but no
  `sourceChunks`.
- Capability focusing now prefers exact source-ref matches before token
  scoring, so line-scoped tasks can select the relevant entrypoint/symbol
  without leaking unrelated same-file capabilities.
- Added regression coverage proving a source ref to one route/symbol selects
  the matching capability, excludes a sibling capability in the same file, and
  still does not render raw `project-inventory.json` as normal context.
- ContextPack regression passed:
  `bun run test -- apps/runner/test/context-builder.test.ts` reported
  49 tests passed.
- Inventory plus ContextPack regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  reported 112 tests passed.
- Project typecheck passed:
  `bun run typecheck`.

Fresh verification after adding Restify scanner-to-context eval coverage:

- Added default scanner-to-context e2e eval coverage for a Restify fixture with
  static `restify.createServer()` route evidence across billing, customers, and
  reports domains.
- The fixture verifies task-focused ContextPack selection for billing,
  customer, and reports tasks while excluding sibling Restify capability
  sections and keeping raw `project-inventory.json` out of selected normal
  context.
- Independent Trellis-check tightened the scenario by adding
  `inventorySourceChunkGraphEdgeRefsInclude` expectations for route-handler,
  controller-to-service, and service-to-repository graph-edge backlinks.
- JSON validation passed:
  `jq empty eval/scenarios/legacy-project-understanding-restify-e2e.json`.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 33 scenarios / 73 variants passed.
- Inventory scanner regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported
  64 tests passed.
- Runner typecheck passed:
  `bun x tsc -p apps/runner/tsconfig.json --noEmit`.
- Trellis task context validation passed:
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.

Fresh verification after adding Hapi scanner-to-context eval coverage:

- Added default scanner-to-context e2e eval coverage for a Hapi fixture with
  static `Hapi.server(...)` route-object evidence across billing, customers,
  and reports domains.
- The fixture verifies task-focused ContextPack selection for billing,
  customer, and reports tasks while excluding sibling Hapi capability sections,
  keeping raw `project-inventory.json` out of selected normal context, and
  preserving sensitive `.env` exclusion.
- The fixture also asserts graph-edge-backed source chunks for the billing
  route-handler, controller-to-service, and service-to-repository path so
  scanner regressions are caught before ContextPack assertions pass.
- The new eval exposed that `hapi` framework vocabulary could select sibling
  domains through generic task terms. Added `hapi` and `hapijs` to the
  ContextPack common task-token filter so framework names do not act as
  business intent.
- JSON validation passed:
  `jq empty eval/scenarios/legacy-project-understanding-hapi-e2e.json`.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 34 scenarios / 76 variants passed.
- Inventory and ContextPack regressions passed:
  `bun run test -- apps/runner/test/context-builder.test.ts apps/runner/test/project-inventory.test.ts`
  reported 116 tests passed.
- Runner typecheck passed:
  `bun x tsc -p apps/runner/tsconfig.json --noEmit`.
- Trellis task context validation passed:
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.

Fresh verification after adding Koa scanner-to-context eval coverage:

- Added default scanner-to-context e2e eval coverage for a Koa Router fixture
  with static `koa-router` / `@koa/router` constructor and prefix evidence
  across billing, customers, and reports domains.
- The fixture verifies task-focused ContextPack selection for billing,
  customer, and reports tasks while excluding sibling Koa capability sections,
  keeping raw `project-inventory.json` out of selected normal context, and
  preserving sensitive `.env` exclusion.
- The fixture also asserts graph-edge-backed source chunks for the billing
  route-handler, controller-to-service, and service-to-repository path so
  scanner regressions are caught before ContextPack assertions pass.
- The new eval exposed that `koa` framework vocabulary could select sibling
  domains through generic task terms. Added `koa` to the ContextPack common
  task-token filter so framework names do not act as business intent.
- JSON validation passed:
  `jq empty eval/scenarios/legacy-project-understanding-koa-e2e.json`.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 35 scenarios / 79 variants passed.
- Inventory and ContextPack regressions passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  reported 116 tests passed.
- Runner typecheck passed:
  `bun x tsc -p apps/runner/tsconfig.json --noEmit`.

Fresh implementation after adding irrelevant-context ratio eval support:

- Extended `context_pack_fixture` and `legacy_project_understanding_fixture`
  expectations with `relevantManifestRefPrefixes` and
  `irrelevantContextRatioMax`.
- Eval output now includes per-variant `contextQuality` metrics with selected,
  relevant, irrelevant, and ratio counts, and the legacy inventory summary now
  reports measured variant count plus average/max irrelevant-context ratio.
- Updated the Koa scanner-to-context e2e fixture to assert a max ratio of
  `0.1` for billing, customer, and reports tasks. This allows the current
  baseline `project_profile` section but fails if sibling-domain capability or
  source evidence leaks into the task context.
- Extended the same ratio gate to Restify and Hapi scanner-to-context e2e
  fixtures, so the current legacy Node framework set now guards task-focused
  context leakage consistently across Restify, Hapi, and Koa.
- Extended the ratio gate to the polyglot Flask/Django/Rails/Laravel
  scanner-to-context e2e fixture. The billing, Rails reports, Django
  shipments, and Laravel customers variants now each declare relevant
  manifest-ref prefixes and enforce `irrelevantContextRatioMax`.
- Extended the ratio gate to Spring, ASP.NET, and Go scanner-to-context e2e
  fixtures. Billing, customer, and reports variants for each stack now enforce
  the same deterministic low-signal ratio boundary.
- Extended the ratio gate to JAX-WS, WCF, and ASMX scanner-to-context e2e
  fixtures. The billing SOAP/WCF/ASMX service variants now guard against
  sibling customer service leakage with a strict `0.1` max ratio.
- Extended the ratio gate to the clean `web.xml` Servlet and Struts
  scanner-to-context e2e fixtures. Billing, customer, and reports variants now
  declare domain-specific relevant manifest-ref prefixes and enforce
  `irrelevantContextRatioMax: 0.13`, allowing the current low-signal
  `project_profile` section while failing if sibling servlet/action capability,
  symbol, test, hotspot, or source chunk evidence leaks into task context.
- Fixed the annotation Servlet leakage before adding its ratio gate. Capability
  grouping now scopes fallback handler-name matching to the entrypoint file, so
  generic Servlet method names such as `doGet` do not attach sibling servlet
  methods to unrelated customer/report capabilities. The generated source
  chunks now inherit only their own capability refs.
- Extended the ratio gate to the annotation Servlet scanner-to-context e2e
  fixture after the scanner fix. Billing, customer, and reports variants now
  enforce `irrelevantContextRatioMax: 0.13`.
- Focused Koa eval passed:
  `bun run eval -- --scenario-dir /tmp/ainp-koa-eval-quality/scenarios --out-dir /tmp/ainp-koa-eval-quality/out`
  reported 1 scenario / 3 variants passed. The report showed 3 measured
  variants, average irrelevant-context ratio `0.097`, and max ratio `0.1`.
- Focused Restify/Hapi/Koa eval passed:
  `bun run eval -- --scenario-dir /tmp/ainp-nodeframework-ratio/scenarios --out-dir /tmp/ainp-nodeframework-ratio/out`
  reported 3 scenarios / 9 variants passed. The report showed 9 measured
  variants, average irrelevant-context ratio `0.097`, and max ratio `0.1`.
- Focused polyglot eval passed:
  `bun run eval -- --scenario-dir /tmp/ainp-polyglot-ratio/scenarios --out-dir /tmp/ainp-polyglot-ratio/out`
  reported 1 scenario / 4 variants passed. The report showed 4 measured
  variants, average irrelevant-context ratio `0.104`, and max ratio `0.125`.
- Focused Spring/ASP.NET/Go eval passed:
  `bun run eval -- --scenario-dir /tmp/ainp-enterprise-ratio/scenarios --out-dir /tmp/ainp-enterprise-ratio/out`
  reported 3 scenarios / 9 variants passed. The report showed 9 measured
  variants, average irrelevant-context ratio `0.1105`, and max ratio `0.125`.
- Focused JAX-WS/WCF/ASMX eval passed:
  `bun run eval -- --scenario-dir /tmp/ainp-service-ratio/scenarios --out-dir /tmp/ainp-service-ratio/out`
  reported 3 scenarios / 3 variants passed. The report showed 3 measured
  variants, average irrelevant-context ratio `0.1`, and max ratio `0.1`.
- Focused Java Web ratio eval passed:
  `bun run eval -- --scenario-dir /tmp/ainp-javaweb-ratio.F31Xd0/scenarios --out-dir /tmp/ainp-javaweb-ratio.F31Xd0/out`
  reported 2 scenarios / 6 variants passed. The Struts variants measured
  ratios `0.0909`, `0.125`, and `0.1111`; the `web.xml` Servlet variants
  measured `0.0909`, `0.1111`, and `0.1111`.
- Focused annotation Servlet scanner regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "detects Java Servlet routes and links handlers to service methods"`
  reported 1 test passed, proving sibling `doGet` handlers are not attached to
  the wrong Servlet capability.
- Focused annotation Servlet ratio eval passed:
  `bun run eval -- --scenario-dir /tmp/ainp-servlet-ratio.oAoqH5/scenarios --out-dir /tmp/ainp-servlet-ratio.oAoqH5/out`
  reported 1 scenario / 3 variants passed. The billing, customer, and reports
  variants measured ratios `0.0909`, `0.125`, and `0.125`.
- Final default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 35 scenarios / 79 variants passed
  (`.ainp/evals/eval-2026-07-02T07-12-27-813Z.json`). The legacy summary
  reported 34 measured variants, average irrelevant-context ratio `0.1048`,
  and max ratio `0.125`.
- Focused runner regressions passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  reported 116 tests passed.
- Full TypeScript project check passed:
  `bun run typecheck`.
- JSON/Trellis/diff checks passed:
  `jq empty eval/scenarios/legacy-project-understanding-webxml-servlet-e2e.json eval/scenarios/legacy-project-understanding-struts-e2e.json`,
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`,
  and scoped `git diff --check`.

Fresh follow-up after fixing annotation Servlet generic handler leakage:

- Fixed scanner capability grouping so fallback handler-name matching is scoped
  to the entrypoint file. This prevents annotation Servlet tasks from attaching
  sibling `doGet` methods and source chunks to the wrong customer/report
  capability while preserving graph-backed cross-file handler links.
- Added scanner regression coverage inside
  `apps/runner/test/project-inventory.test.ts`, proving customer and report
  Servlet capabilities keep their own `doGet` handler symbols and exclude the
  sibling handler symbol.
- Added ratio gates to
  `eval/scenarios/legacy-project-understanding-servlet-e2e.json` for billing,
  customer, and reports variants with `irrelevantContextRatioMax: 0.13`.
- Focused annotation Servlet scanner regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "detects Java Servlet routes and links handlers to service methods"`
  reported 1 test passed.
- Full project-inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported 64
  tests passed.
- Focused annotation Servlet ratio eval passed:
  `bun run eval -- --scenario-dir /tmp/ainp-servlet-ratio.oAoqH5/scenarios --out-dir /tmp/ainp-servlet-ratio.oAoqH5/out`
  reported 1 scenario / 3 variants passed with ratios `0.0909`, `0.125`, and
  `0.125`.
- Final default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 35 scenarios / 79 variants passed
  (`.ainp/evals/eval-2026-07-02T07-12-27-813Z.json`). The legacy summary
  reported 34 measured variants, average irrelevant-context ratio `0.1048`,
  and max ratio `0.125`.
- Full TypeScript project check passed: `bun run typecheck`.
- Full test suite passed: `bun run test` reported 107 test files / 1031 tests
  passed.
- JSON/Trellis/diff/whitespace checks passed:
  `jq empty eval/scenarios/legacy-project-understanding-servlet-e2e.json eval/scenarios/legacy-project-understanding-webxml-servlet-e2e.json eval/scenarios/legacy-project-understanding-struts-e2e.json`,
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`,
  scoped `git diff --check`, and direct CR/trailing-whitespace scans over the
  touched scanner, test, spec, scenario, and task-doc files.

Fresh follow-up after adding enterprise old-stack ratio gates:

- Fixed ContextPack source chunk graph-pointer matching so source-ref overlap
  only points to a chunk when the overlapping file refs belong to the chunk's
  own path. Explicit inventory refs such as `graphEdgeRefs` still work, but a
  shared cross-file configuration ref no longer makes selected evidence point
  to sibling chunks.
- Added regression coverage in `apps/runner/test/context-builder.test.ts` for
  the JAX-RS-style case where billing and customer chunks both cite a shared
  application-level source ref such as `LegacyApplication.java#L3`; billing
  context now keeps the billing chunk and excludes the customer chunk.
- Added ratio gates to JAX-RS, Spring XML MVC, old ASP.NET RouteTable, and
  ASP.NET Web Forms scanner-to-context fixtures. The JAX-RS gate treats the
  application-level `LegacyApplication` chunk as relevant route-prefix
  evidence, while sibling resource chunks remain excluded.
- Focused enterprise old-stack ratio eval passed:
  `bun run eval -- --scenario-dir /tmp/ainp-enterprise-ratio2.uJP0Vx/scenarios --out-dir /tmp/ainp-enterprise-ratio2.uJP0Vx/out`
  reported 4 scenarios / 7 variants passed. The measured ratios were
  `0.0909` to `0.1111`, with average `0.0993` and max `0.1111`.
- Focused runner regressions passed:
  `bun run test -- apps/runner/test/context-builder.test.ts apps/runner/test/project-inventory.test.ts`
  reported 2 files / 117 tests passed.
- Final default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 35 scenarios / 79 variants passed
  (`.ainp/evals/eval-2026-07-02T07-24-01-308Z.json`). The legacy summary
  reported 41 measured variants, average irrelevant-context ratio `0.1039`,
  and max ratio `0.125`.
- Full TypeScript project check passed: `bun run typecheck`.
- Full test suite passed: `bun run test` reported 107 test files / 1032 tests
  passed.

Fresh follow-up after completing ratio-gate coverage for remaining legacy
understanding fixtures:

- Added ratio gates to the legacy JSP, Classic ASP, and ColdFusion
  scanner-to-context fixtures. Each page-style fixture now declares
  page/test-specific relevant manifest prefixes and allows only the current
  low-signal `project_profile` baseline.
- Added variant-aware ratio gates to the remaining broad baseline scenarios:
  `legacy-project-understanding.json`,
  `legacy-project-understanding-e2e.json`, and
  `legacy-project-understanding-monolith-e2e.json`. These now cover the
  handcrafted inventory baseline, source-ref same-file capability selection,
  accepted rename/merge/wrong capability corrections, historical inventory
  reuse, scanner-real Orders/Nest/hybrid variants, and billing/customer
  monolith variants.
- Added ratio gates to the legacy CodeIgniter, CakePHP, Symfony YAML, and
  Symfony XML fixtures after their scanner-to-context coverage landed, so the
  old PHP/Symfony stack fixtures now participate in the same deterministic
  low-signal leakage metric as the Java/.NET/Node/polyglot fixtures.
- Fixed a ContextPack retrieval noise issue exposed by the broadened ratio
  gates: when a strong capability match exists, weaker capability matches whose
  matched task tokens are fully covered by the strongest match are dropped
  unless selected by explicit source refs. This prevents incidental package
  script capabilities such as `CLI Start` pointing at an Orders route file from
  joining a more specific Orders API task context.
- Added a focused ContextPack regression proving the weak CLI capability and
  hotspot are excluded while the Orders API capability remains selected.
- Focused page-style ratio eval passed:
  `bun run eval -- --scenario-dir /tmp/ainp-pages-ratio.G5zw3n/scenarios --out-dir /tmp/ainp-pages-ratio.G5zw3n/out`
  reported 3 scenarios / 3 variants passed with ratios `0.1429`, `0.1429`,
  and `0.125`.
- Focused broad baseline ratio eval passed:
  `bun run eval -- --scenario-dir /tmp/ainp-broad-gated.z1Oy1Q/scenarios --out-dir /tmp/ainp-broad-gated.z1Oy1Q/out`
  reported 3 scenarios / 12 variants passed. The measured ratios ranged from
  `0.0909` to `0.1667`, with the `0.1667` cases limited to small six-item
  packs where the only low-signal item is `project_profile`.
- Final default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 35 scenarios / 79 variants passed
  (`.ainp/evals/eval-2026-07-02T07-53-25-674Z.json`). The legacy summary
  reported 53 measured variants, average irrelevant-context ratio `0.1059`,
  and max ratio `0.1667`.
- Focused runner regressions passed:
  `bun test apps/runner/test/context-builder.test.ts apps/runner/test/project-inventory.test.ts`
  reported 118 tests passed.
- Full TypeScript project check passed: `bun run typecheck`.
- Full test suite passed: `bun run test` reported 107 test files / 1033 tests
  passed.

Fresh follow-up after adding Hono scanner-to-context coverage:

- Added conservative Hono route scanning for static `Hono` constructor
  evidence from `hono` imports/requires. The scanner now combines
  `.basePath(...)` prefixes with route declarations and follows same-file
  `app.route(prefix, child)` mounts while rejecting local Hono lookalikes.
- Hono route declarations now emit source-ref-backed HTTP entrypoints with
  import, constructor/basePath, mount, and route-line evidence, then reuse the
  existing route -> handler and explicit service/repository graph edge
  machinery.
- Added `hono` to the ContextPack common task-token filter so framework names
  do not select sibling Hono domains through generic vocabulary alone.
- Added default scanner-to-context e2e eval coverage for a Hono fixture across
  billing, customer, and reports tasks with deterministic
  `irrelevantContextRatioMax: 0.1` gates.
- Focused Hono scanner regression passed:
  `bun test apps/runner/test/project-inventory.test.ts -t "detects Hono routes"`
  reported 1 test passed.
- Focused Hono eval passed:
  `bun run eval -- --scenario-dir /tmp/ainp-hono-eval.LQO1rn/scenarios --out-dir /tmp/ainp-hono-eval.LQO1rn/out`
  reported 1 scenario / 3 variants passed with ratios `0.0909`, `0.1`, and
  `0.1`.
- Final default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 36 scenarios / 82 variants passed
  (`.ainp/evals/eval-2026-07-02T08-21-57-546Z.json`). The legacy summary
  reported 56 measured variants, average irrelevant-context ratio `0.1054`,
  and max ratio `0.1667`.
- Full project test suite passed: `bun run test` reported 107 test files /
  1034 tests passed.
- Full TypeScript project check passed: `bun run typecheck`.
- JSON/Trellis/diff/whitespace checks passed:
  `jq empty eval/scenarios/legacy-project-understanding-hono-e2e.json`,
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`,
  scoped `git diff --check`, and direct CR/trailing-whitespace/conflict-marker
  scans over the touched scanner, context, test, scenario, and task-doc files.

Fresh follow-up after adding Fastify plugin register prefix coverage:

- Added conservative same-file Fastify plugin registration scanning for static
  `register(plugin, { prefix: "..." })` evidence. The scanner now combines the
  register prefix with shorthand and object-literal route declarations inside
  the registered plugin function, cites the plugin declaration, register line,
  and route line, and does not also emit the unprefixed plugin routes.
- Registered Fastify plugin routes reuse existing route -> handler and explicit
  service/repository graph machinery, so imported handlers still produce
  source-ref-backed graph edges into controller/service/repository symbols.
- Added `fastify` to the ContextPack common task-token filter so framework
  vocabulary does not select sibling Fastify domains by itself.
- Added default scanner-to-context e2e eval coverage for a Fastify plugin
  fixture across billing, customer, and reports tasks with deterministic
  `irrelevantContextRatioMax: 0.1` gates.
- Focused Fastify register scanner regression passed:
  `bun test apps/runner/test/project-inventory.test.ts -t "combines same-file Fastify register prefixes"`
  reported 1 test passed.
- Focused Fastify scanner-to-context eval passed:
  `bun run eval -- --scenario-dir /tmp/ainp-fastify-eval.pRdQbe/scenarios --out-dir /tmp/ainp-fastify-eval.pRdQbe/out`
  reported 1 scenario / 3 variants passed.
- Focused runner regressions passed:
  `bun test apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  reported 120 tests passed.
- Full TypeScript project check passed: `bun run typecheck`.
- Final default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 37 scenarios / 85 variants passed
  (`.ainp/evals/eval-2026-07-02T08-43-07-650Z.json`). The legacy summary
  reported 59 measured variants, average irrelevant-context ratio `0.105`,
  and max ratio `0.1667`.
- Full project test suite passed: `bun run test` reported 107 test files /
  1035 tests passed.
- JSON/Trellis/diff/whitespace checks passed:
  `jq empty eval/scenarios/legacy-project-understanding-fastify-e2e.json`,
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`,
  scoped `git diff --check`, and direct CR/trailing-whitespace/conflict-marker
  scans over the touched scanner, context, test, scenario, and task-doc files.

Fresh follow-up after adding scenario-level context-quality gates:

- Extended the eval harness with scenario-level `contextQualityGates` so a
  scenario can enforce minimum measured variants, maximum average
  irrelevant-context ratio, and maximum per-variant irrelevant-context ratio
  across all variants, not only per-variant expectations.
- Scenario checks now appear in JSON/HTML reports, console output, and
  `summary.failed`, so a failed aggregate context-quality gate makes
  `bun run eval` exit non-zero.
- Added aggregate gates to `legacy-project-understanding.json`:
  `measuredVariantsMin: 7`, `irrelevantContextRatioAverageMax: 0.15`, and
  `irrelevantContextRatioMax: 0.17`.
- Focused legacy eval passed:
  `bun run eval -- --scenario-dir /tmp/ainp-legacy-eval.1JM1by --out-dir /tmp/ainp-legacy-eval.1JM1by/out`
  reported 1 scenario / 7 variants passed with `scenarioChecks=3/0`; actual
  measured variants were `7`, average irrelevant-context ratio was `0.1437`,
  and max ratio was `0.1667`.
- Negative control passed: setting
  `irrelevantContextRatioAverageMax: 0` in a temporary scenario copy made eval
  exit non-zero with `negative_control_exit=1`, `scenarioChecks=2/1`, and the
  failed check
  `contextQualityGates.irrelevantContextRatioAverageMax` reporting actual
  `0.1437`.
- Full TypeScript project check passed: `bun run typecheck`.
- Final default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 37 scenarios / 85 variants passed with `scenarioChecks=3/0`
  (`.ainp/evals/eval-2026-07-02T09-29-26-593Z.json`).
- Focused ContextPack regression suite passed:
  `bun test apps/runner/test/context-builder.test.ts` reported 54 tests
  passed.
- JSON and scoped whitespace checks passed:
  `jq empty eval/scenarios/legacy-project-understanding.json` and
  scoped `git diff --check` over the eval harness, legacy scenario, and
  Trellis task docs.

Fresh implementation after adding conservative cross-file Python router mount resolution:

- Extended the project inventory scanner so Python route decorator extraction
  can use static prefixes from a local root app file that imports a Flask
  `Blueprint` or FastAPI `APIRouter` from another scanned `.py` file and mounts
  it with `register_blueprint(..., url_prefix="...")` or
  `include_router(..., prefix="...")`.
- The resolver is intentionally static and local: it follows one-line
  `from module import router_or_blueprint [as alias]` statements only when the
  module resolves to exactly one scanned project `.py` file, requires literal
  mount prefixes, and does not execute imports, follow package re-exports,
  inspect dotted runtime objects, or infer dynamic prefix variables.
- Cross-file mounted routes keep the decorator file as the entrypoint path so
  route -> handler and handler -> explicitly constructed service/repository
  graph evidence continues to resolve through existing Python graph logic.
  Source refs cite the imported router/blueprint definition, the importing app
  import line, the app mount call, and the route decorator.
- Added focused project-inventory regression coverage for an imported Flask
  Blueprint and imported FastAPI APIRouter mounted from a root app file,
  including mounted HTTP entrypoints, no unmounted duplicate route evidence,
  route-handler graph edges, and Flask handler -> service/repository graph
  evidence.
- Focused new regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "combines imported Flask Blueprint"`
  reported 1 test passed.
- Full focused project inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported 68
  tests passed.
- Full TypeScript project check passed: `bun run typecheck`.
- No eval scenario was changed for this increment; the existing deterministic
  test coverage was the scoped verification path.

Fresh implementation after adding Python import-backed constructed-receiver resolution:

- Extended heuristic inventory imports for Python so static local
  `from module import Name [as Alias]` statements produce import evidence when
  the module resolves to a scanned project `.py` file. The resolver remains
  conservative: it requires a concrete scanned target path, skips wildcard
  imports, does not execute Python, and does not follow package re-exports or
  dynamic import machinery.
- Python constructed receiver graph resolution now uses that import evidence
  before falling back to global name heuristics. This prevents old projects with
  multiple same-named service/repository classes from wiring a route handler to
  the wrong module simply because a shadow path sorts earlier.
- Added a focused regression where an unrelated `aaa_shadow` package defines a
  same-named `BillingService`; the Flask handler imports
  `services.billing_service.BillingService`, and the graph now links
  `route -> handler -> imported BillingService -> repository` with the import
  line included in source refs and no edge to the shadow class.
- Focused Python service graph regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "links Flask route handlers to constructed Python service"`.
- Full project inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported 68
  tests passed.
- Full TypeScript project check passed: `bun run typecheck`.

Fresh implementation after adding Go import-alias constructed-receiver resolution:

- Extended heuristic inventory imports for Go so static local `import "..."`,
  aliased `import billing "..."`, and simple import blocks produce namespace
  import evidence when the import path resolves to a unique scanned local Go
  package directory. The resolver maps the package to all scanned `.go` files
  in that directory and skips dot/blank imports, unresolved external packages,
  same-package imports, and ambiguous suffix matches.
- Go constructed receiver detection now preserves package qualifiers for
  static factory/composite construction such as
  `service := billing.NewBillingService()` and
  `repo := &billing.BillingRepository{}`. The symbol graph resolver treats
  resolved Go `type` symbols as class-like only after import/path evidence has
  identified the package, so same-named shadow types in other packages do not
  steal the handler -> service edge.
- Upgraded the focused Go service graph regression with an unrelated
  alphabetically earlier shadow `BillingService`; the route handler imports
  `legacy/internal/billing` as `billing`, and the graph now links
  `route -> handler -> imported BillingService -> repository` with the import
  line included in source refs and no edge to the shadow type.
- Focused Go service graph regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "links Go route handlers"`.
- Full project inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported 68
  tests passed.
- Full TypeScript project check passed: `bun run typecheck`.
- Full project test suite passed: `bun test` reported 108 test files / 1040
  tests passed.

Fresh implementation after adding PHP `use` import-backed constructed-receiver resolution:

- Extended heuristic inventory imports for PHP so static local class
  `use App\Services\BillingService;` and
  `use App\Services\BillingService as Billing;` statements produce import
  evidence when the imported FQCN resolves to a scanned local `.php` file. The
  resolver stays conservative: it skips `use function`, `use const`, grouped
  imports, unresolved autoload-only classes, self-imports, and ambiguous suffix
  matches.
- PHP constructed receiver graph resolution now uses that import evidence
  before falling back to global class-name heuristics. This prevents
  Laravel/Symfony-style old projects with multiple same-named service classes
  from wiring a controller action to a shadow class just because that path sorts
  earlier.
- Upgraded the focused Laravel service graph regression with an unrelated
  alphabetically earlier shadow `BillingService`; the controller imports
  `App\Services\BillingService`, and the graph now links
  `route -> controller action -> imported BillingService -> repository` with
  the PHP `use` line included in source refs and no edge to the shadow class.
- Focused Laravel service graph regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "links Laravel controller actions"`.
- Full project inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported 68
  tests passed.
- Full TypeScript project check passed: `bun run typecheck`.
- Full project test suite passed: `bun test` reported 108 test files / 1040
  tests passed.

Fresh implementation after adding Ruby require-backed constructed-receiver resolution:

- Extended heuristic inventory imports for Ruby so static local
  `require_relative "../services/billing_service"` and local `require`
  statements produce import evidence when the required file resolves to a
  scanned project `.rb` file. The resolver derives the class name from the
  required file name and stays conservative: it does not execute Ruby, follow
  Rails autoloading, infer gems, or resolve dynamic require paths.
- Ruby constructed receiver graph resolution now uses that require evidence
  before falling back to global class-name heuristics. This prevents old Rails
  projects with multiple same-named service classes from wiring a controller
  action to an unrelated shadow class.
- Upgraded the focused Rails service graph regression with an unrelated
  alphabetically earlier shadow `BillingService`; the controller requires the
  intended service file, and the graph now links
  `route -> controller action -> required BillingService -> repository` with
  the require line included in source refs and no edge to the shadow class.
- Focused Rails service graph regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "links Rails controller actions"`.
- Full project inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported 68
  tests passed.
- Full TypeScript project check passed: `bun run typecheck`.
- Full project test suite passed: `bun test` reported 108 test files / 1040
  tests passed.

Fresh implementation after adding Java package/import and C# namespace/using constructed-receiver resolution:

- Extended heuristic inventory imports for Java so static local package
  declarations, explicit class imports, and wildcard package imports produce
  import evidence when they resolve to scanned project `.java` files. Same
  package classes now form a local static visibility scope before global
  same-name fallback.
- Extended heuristic inventory imports for C# so file-scoped/block-scoped
  `namespace` declarations, local `using Some.Namespace;` directives, and
  alias `using Billing = Some.Namespace.BillingService;` directives produce
  import evidence when they resolve to scanned project `.cs` files.
- The resolver remains intentionally conservative: it requires a unique local
  directory or file target, skips unresolved external namespaces, skips
  ambiguous namespace suffixes, skips `using static`, and does not infer DI,
  assembly references, project references, runtime discovery, or generated
  partial-class wiring.
- Java/C# constructed receiver graph resolution can now use local
  package/namespace evidence before global class-name fallback. This prevents
  old Spring and ASP.NET projects with same-named classes in shadow packages
  from wiring handler -> service edges to the wrong class.
- Upgraded the focused Spring and ASP.NET service graph regressions with
  unrelated alphabetically earlier shadow `BillingService` classes. The graph
  now links handlers to the package/namespace-local service classes, includes
  package/namespace source refs, and has no edge to the shadow classes.
- Focused Spring regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "links Spring controller handlers"`.
- Focused ASP.NET regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "links ASP.NET action handlers"`.
- Full project inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported 68
  tests passed.
- Full TypeScript project check passed: `bun run typecheck`.
- Full project test suite passed: `bun test` reported 108 test files / 1040
  tests passed.
- Trellis task validation passed:
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.
- Scoped conflict-marker/trailing-whitespace scan over the touched inventory,
  inventory-test, and completion-summary files returned no matches.

Fresh implementation after adding conservative Java constructor-injected interface resolution:

- Extended internal constructed-receiver evidence with an optional target path,
  so scanner-derived receiver references can resolve to a specific local class
  without reopening global same-name fallback.
- Added conservative constructor-injection detection for Java/C#-style
  constructors: it parses explicit constructor parameter types and records a
  class-level receiver only for direct `field = parameter` or
  `this.field = parameter` assignments inside the constructor.
- Added unique implementation resolution for interface-typed constructor
  parameters. A receiver is recorded only when exactly one scanned local class
  declares that it implements the interface (`implements Interface` /
  `: IInterface` style signatures). Ambiguous or runtime DI/container wiring
  remains unresolved instead of guessed.
- The symbol-reference resolver now honors the internal target path before
  import/global fallback, so `uses Impl` and `calls Impl.method` edges point to
  the implementation class/method that the injection evidence selected.
- Added a focused Spring regression where a controller stores an injected
  `BillingWorkflow` interface field, the only implementation is
  `JdbcBillingWorkflow`, and an unrelated earlier shadow class with the same
  implementation name must not receive graph edges.
- Focused Spring constructor-injection regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "links Spring constructor-injected interface"`.
- Full project inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported 69
  tests passed.
- Full TypeScript project check passed: `bun run typecheck`.
- Full project test suite passed: `bun test` reported 108 test files / 1041
  tests passed.
- Trellis task validation passed:
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.
- Scoped conflict-marker/trailing-whitespace scan over the touched inventory,
  inventory-test, and completion-summary files returned no matches.

Fresh implementation after adding C# constructor-injected interface resolution coverage:

- Extended heuristic method detection with conservative C#-style constructor
  declarations that omit a return type and may place the opening brace on the
  next line, such as `public BillingController(IBillingWorkflow workflow)`.
- This lets the existing constructor-parameter injection evidence apply to old
  ASP.NET controllers that store interface parameters into fields before
  calling those fields from action methods.
- Added a focused ASP.NET regression where a controller stores an injected
  `IBillingWorkflow`, the only local implementation is `EfBillingWorkflow`,
  and an unrelated earlier shadow class with the same implementation name must
  not receive graph edges.
- Focused ASP.NET constructor-injection regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "links ASP.NET constructor-injected interface"`.
- Full project inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported 70
  tests passed.
- Full TypeScript project check passed: `bun run typecheck`.
- Full project test suite passed: `bun test` reported 108 test files / 1042
  tests passed.
- Trellis task validation passed:
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.
- Scoped conflict-marker/trailing-whitespace scan over the touched inventory,
  inventory-test, and completion-summary files returned no matches.

Fresh implementation after adding conservative typed factory-assigned receiver resolution:

- Added conservative Java/C# receiver detection for explicit typed assignments
  from static factory calls such as
  `BillingWorkflow billingWorkflow = BillingWorkflowFactory.create()`.
- The scanner does not execute or inspect factory bodies. It accepts only a
  declared receiver type plus a right-hand static callee whose owner name ends
  in `Factory`, then resolves the declared type to either a same-file/same-dir
  local class or a unique scanned implementation of an interface.
- Factory-assigned receiver evidence carries an internal target path, so later
  `uses Impl` and `calls Impl.method` graph edges resolve to the selected
  implementation before import/global fallback.
- Added a focused Spring regression where a controller field is initialized
  from `BillingWorkflowFactory.create()`, the declared interface has exactly one
  local implementation `JdbcBillingWorkflow`, and an unrelated earlier shadow
  class with the same implementation name must not receive graph edges.
- Focused Spring factory-assignment regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "links Spring factory-assigned interface"`.
- Full project inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported 71
  tests passed.
- Full TypeScript project check passed: `bun run typecheck`.
- Full project test suite passed: `bun test` reported 108 test files / 1043
  tests passed.
- Trellis task validation passed:
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.
- Scoped conflict-marker/trailing-whitespace scan over the touched inventory,
  inventory-test, and completion-summary files returned no matches.

Fresh verification after adding C# typed factory-assigned receiver coverage:

- Added ASP.NET regression coverage for explicit typed factory assignment such
  as `IBillingWorkflow _billingWorkflow = BillingWorkflowFactory.Create()`,
  proving the conservative factory receiver path applies to old C# controllers
  as well as Spring/Java controllers.
- The regression keeps the same safety contract as the Java fixture: the
  declared interface must resolve to exactly one scanned local implementation,
  graph edges must point to that implementation's method, and an unrelated
  earlier shadow implementation class must not receive graph edges.
- Focused ASP.NET factory-assignment regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "links ASP.NET factory-assigned interface"`.
- Full project inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported 72
  tests passed.
- Full TypeScript project check passed: `bun run typecheck`.
- Full project test suite passed: `bun test` reported 108 test files / 1044
  tests passed.
- Trellis task validation passed:
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.
- Scoped conflict-marker/trailing-whitespace scan over the touched inventory,
  inventory-test, and completion-summary files returned no matches.

Fresh implementation after adding conservative Spring XML property-injected receiver resolution:

- Added a static configured-receiver path for Spring XML bean property
  injection. The scanner now reads `<property name="..." ref="...">` and
  nested `<ref bean="...">` evidence inside Spring XML bean blocks, resolves
  the owner bean class and referenced target bean class to scanned local Java
  class symbols, then feeds that receiver evidence through the existing
  handler -> service -> repository graph builder.
- The resolution remains conservative: it does not execute or inspect the
  Spring container, expand placeholders, infer by type, or follow dynamic bean
  wiring. It only records a receiver when the property name is static, the ref
  points to exactly one XML bean definition, and both owner and target bean
  classes resolve to local Java class symbols.
- Configured receiver evidence now carries an optional owner class name so
  file-level configured receivers are applied only to the intended scanned
  Java class scope.
- Added a focused Spring XML regression where
  `<property name="billingWorkflow" ref="billingWorkflow" />` links
  `BillingController#handleRequest` to `JdbcBillingWorkflow.reconcile()` and
  on to `BillingRepository.markReconciled()`, while an unrelated same-name
  shadow implementation class receives no graph edge.
- Focused Spring XML property-injection regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "links Spring XML property-injected"`.
- Full project inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported 73
  tests passed.
- Full TypeScript project check passed: `bun run typecheck`.
- Full project test suite passed: `bun test` reported 108 test files / 1045
  tests passed.
- Default deterministic eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 37 scenarios / 85 variants passed.
- Trellis task validation passed:
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.
- Scoped conflict-marker/trailing-whitespace scan over the touched inventory,
  inventory-test, and completion-summary files returned no matches.

Fresh implementation after adding conservative ASP.NET `IServiceCollection` registration resolution:

- Added static C# service-registration evidence for
  `AddScoped<TService, TImplementation>()`,
  `AddTransient<TService, TImplementation>()`, and
  `AddSingleton<TService, TImplementation>()` calls.
- The scanner uses this registration evidence to resolve constructor-injected
  interface fields before falling back to the older unique-implementation
  rule. This lets old ASP.NET controllers link from route -> action ->
  configured implementation -> repository even when multiple local classes
  implement the same interface.
- Registration resolution remains conservative: it only handles static
  generic two-type registrations on a single line, requires the implementation
  class to be scanned locally, requires the implementation signature to declare
  the registered service/interface, uses existing C# namespace/using evidence
  when available, and skips duplicate or ambiguous registrations instead of
  guessing.
- Added a focused ASP.NET regression where `IBillingWorkflow` has both
  `EfBillingWorkflow` and `InMemoryBillingWorkflow` implementations, while
  `Startup.ConfigureServices()` registers
  `services.AddScoped<IBillingWorkflow, EfBillingWorkflow>()`. The graph now
  links `BillingController#ReconcileInvoice` to
  `EfBillingWorkflow.ReconcileInvoice()` and on to
  `BillingRepository.MarkReconciled()`, while the alternate implementation
  receives no edge.
- Focused ASP.NET service-registration regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "links ASP.NET service-registered"`.
- Full project inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported 74
  tests passed.
- Full TypeScript project check passed: `bun run typecheck`.
- Full project test suite passed: `bun test` reported 108 test files / 1046
  tests passed.
- Default deterministic eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 37 scenarios / 85 variants passed.
- Trellis task validation passed:
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.
- Scoped conflict-marker/trailing-whitespace scan over the touched inventory,
  inventory-test, and completion-summary files returned no matches.

Fresh implementation after adding ASP.NET `typeof(...)` service-registration resolution:

- Extended static C# service-registration evidence to also parse old
  ASP.NET-style registrations such as
  `services.AddTransient(typeof(IBillingWorkflow), typeof(EfBillingWorkflow))`
  in addition to generic `AddScoped<TService, TImplementation>()` style
  calls.
- Both registration forms now feed the same conservative resolution path:
  the implementation type must resolve to a scanned local C# class, the class
  signature must declare the registered service/interface, and ambiguous or
  duplicate registrations are skipped instead of guessed.
- Added a focused ASP.NET regression where `IBillingWorkflow` has both
  `EfBillingWorkflow` and `InMemoryBillingWorkflow`, while
  `Startup.ConfigureServices()` registers
  `services.AddTransient(typeof(IBillingWorkflow), typeof(EfBillingWorkflow))`.
  The graph links the controller action to `EfBillingWorkflow` and its
  repository chain, while the alternate implementation receives no edge.
- Focused ASP.NET `typeof(...)` registration regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "links ASP.NET typeof service registrations"`.
- Full project inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported 75
  tests passed.
- Full TypeScript project check passed: `bun run typecheck`.
- Full project test suite passed: `bun test` reported 108 test files / 1047
  tests passed.
- Default deterministic eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 37 scenarios / 85 variants passed.
- Trellis task validation passed:
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.
- Scoped conflict-marker/trailing-whitespace scan over the touched inventory,
  inventory-test, and completion-summary files returned no matches.

Fresh implementation after adding Spring XML named `constructor-arg` receiver resolution:

- Extended Spring XML configured receiver evidence so named constructor
  arguments such as
  `<constructor-arg name="billingWorkflow" ref="billingWorkflow" />` feed the
  same route -> controller -> service graph path as property injection.
- The scanner remains conservative: it only accepts static `name` + `ref` /
  nested `<ref bean="...">` evidence, requires the referenced bean id to
  resolve to exactly one XML bean definition, requires both owner and target
  bean classes to resolve to scanned local Java class symbols, and does not
  infer constructor parameter order or `index`-based wiring.
- Added a focused Spring XML regression where `BillingWorkflow` has both
  `JdbcBillingWorkflow` and `InMemoryBillingWorkflow` implementations, while
  XML constructor injection names `billingWorkflow` and points to
  `JdbcBillingWorkflow`. The graph links `BillingController#handleRequest` to
  `JdbcBillingWorkflow.reconcile()` and on to
  `BillingRepository.markReconciled()`, while the alternate implementation
  receives no edge.
- Focused Spring XML constructor-injection regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "links Spring XML constructor-injected"`.
- Full project inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported 76
  tests passed.
- Full TypeScript project check passed: `bun run typecheck`.
- Full project test suite passed: `bun test` reported 108 test files / 1048
  tests passed.
- Default deterministic eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 37 scenarios / 85 variants passed.
- Trellis task validation passed:
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.
- Scoped conflict-marker/trailing-whitespace scan over the touched inventory,
  inventory-test, and completion-summary files returned no matches.

Fresh eval hardening after adding section-local ContextPack source-ref gates:

- Added a red `context_pack_fixture` scenario proving
  `selectedSectionsInclude` checks source refs on the named selected section,
  not merely somewhere in the ContextPack manifest.
- The red fixture selects both `knowledge_kart_section_alpha` and
  `knowledge_kart_section_beta`, includes `doc:section-beta` in global
  ContextPack source refs, then intentionally expects `doc:section-beta` on
  the alpha section. This must fail because alpha only carries
  `doc:section-alpha`.
- Updated the eval harness spec to document this red-suite guard so future
  scanner-to-context assertions do not regress to global source-ref matching.
- Focused red fixture verification failed for the intended reason:
  `bun run eval -- --scenario-dir <temp-dir-with-section-red-scenario> --out-dir .ainp/evals/section-local-red-check`
  reported 1 scenario / 1 variant failed, with `manifestRefsInclude` and
  global `sourceRefsInclude:doc:section-beta` passing while
  `selectedSectionSourceRefsInclude:knowledge_kart_section_alpha:doc:section-beta`
  failed.

Fresh eval hardening after adding ASP.NET section-local source-ref gates:

- Added `selectedSectionsInclude` expectations to the ASP.NET billing
  reconciliation e2e variant so the selected billing capability, symbols, and
  tests sections each prove their own section-local source refs.
- The new gates require billing controller/service/repository/test refs on the
  relevant selected sections and exclude customers/reports controller/test refs
  from those same sections, rather than relying on aggregate ContextPack
  source refs.
- Focused ASP.NET eval passed:
  `bun run eval -- --scenario-dir <temp-dir-with-aspnet-scenario> --out-dir .ainp/evals/aspnet-section-local-check`
  reported 1 scenario / 3 variants passed, including all new
  `selectedSectionSourceRefsInclude` and `selectedSectionSourceRefsExclude`
  checks for `billing-reconciliation-primary`.

Fresh eval hardening after adding Go section-local source-ref gates:

- Added `selectedSectionsInclude` expectations to the Go billing
  reconciliation e2e variant so the selected billing capability, symbols, and
  tests sections each prove their own section-local source refs.
- The new gates require billing handler/service/repository/test refs on the
  relevant selected sections and exclude customers/reports route/test refs from
  those same sections, rather than relying only on aggregate ContextPack source
  refs.
- JSON validation and scoped whitespace hygiene passed:
  `jq empty eval/scenarios/legacy-project-understanding-go-e2e.json` and
  `git diff --check -- eval/scenarios/legacy-project-understanding-go-e2e.json .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/completion-summary.md`.
- Focused Go eval passed:
  `bun run eval -- --scenario-dir <temp-dir-with-go-scenario> --out-dir <temp-dir-with-go-scenario>/out`
  reported 1 scenario / 3 variants passed, including the new
  `selectedSectionSourceRefsInclude` and `selectedSectionSourceRefsExclude`
  checks for `go-billing-reconciliation-primary`.

Fresh eval hardening after adding JAX-RS section-local source-ref gates:

- Added `selectedSectionsInclude` expectations to the JAX-RS billing
  reconciliation e2e variant so the selected billing capability, symbols, and
  tests sections each prove their own section-local source refs.
- The new gates require JAX-RS application/resource/service/repository/test
  refs on the relevant selected sections and exclude customers/reports
  resource/test refs from those same sections, rather than relying only on
  aggregate ContextPack source refs.
- JSON validation, Trellis validation, and scoped conflict-marker/trailing
  whitespace hygiene passed for the touched JAX-RS scenario and task summary.
- Focused JAX-RS eval passed:
  `bun run eval -- --scenario-dir <temp-dir-with-jaxrs-scenario> --out-dir <temp-dir-with-jaxrs-scenario>/out`
  reported 1 scenario / 3 variants passed. The billing variant executed 22
  `selectedSection*` checks with no failures, while the customer/reports
  variants remained unchanged.

Fresh eval hardening after adding JAX-WS section-local source-ref gates:

- Added `selectedSectionsInclude` expectations to the JAX-WS billing SOAP e2e
  variant so the selected billing capability, symbols, and tests sections each
  prove their own SOAP billing source refs and exclude sibling customer SOAP
  refs.
- Focused JAX-WS eval passed:
  `bun run eval -- --scenario-dir <temp-dir-with-jaxws-scenario> --out-dir <temp-dir-with-jaxws-scenario>/out`
  reported `selectedCount=10`, `selectedSectionChecks=30`, and
  `selectedSectionFailures=0`.

Fresh eval hardening after adding WCF section-local source-ref gates:

- Added `selectedSectionsInclude` expectations to the WCF billing service
  contract e2e variant so the selected billing capability, symbols, and tests
  sections each prove their own WCF billing source refs and exclude sibling
  customer WCF refs.
- Focused WCF eval passed:
  `bun run eval -- --scenario-dir <temp-dir-with-wcf-scenario> --out-dir <temp-dir-with-wcf-scenario>/out`
  reported `selectedCount=10`, `selectedSectionChecks=38`, and
  `selectedSectionFailures=0`.

Fresh eval hardening after adding ASMX section-local source-ref gates:

- Added `selectedSectionsInclude` expectations to the ASMX billing WebService
  e2e variant so the selected billing capability, symbols, and tests sections
  each prove their own ASMX billing source refs and exclude sibling customer
  ASMX refs.
- Focused ASMX eval passed:
  `bun run eval -- --scenario-dir <temp-dir-with-asmx-scenario> --out-dir <temp-dir-with-asmx-scenario>/out`
  reported `selectedCount=10`, `selectedSectionChecks=33`, and
  `selectedSectionFailures=0`.

Fresh eval hardening after adding ASP.NET Web Forms section-local source-ref
gates:

- Added `selectedSectionsInclude` expectations to the Web Forms billing
  statement e2e variant so the selected billing capability, symbols, and tests
  sections each prove their own page, code-behind, service/repository, and test
  source refs while excluding sibling customer page/test refs.
- Focused Web Forms eval passed:
  `bun run eval -- --scenario-dir <temp-dir-with-webforms-scenario> --out-dir <temp-dir-with-webforms-scenario>/out`
  reported `selectedCount=10`, `selectedSectionChecks=40`, and
  `selectedSectionFailures=0`.

Fresh eval hardening after adding old ASP.NET route-table section-local
source-ref gates:

- Added `selectedSectionsInclude` expectations to the old ASP.NET MVC/Web API
  route-table billing statement e2e variant so the selected billing capability,
  symbols, and tests sections each prove their own static route table,
  controller, service/repository, and test source refs while excluding sibling
  customer route/controller/test refs.
- Focused old ASP.NET route-table eval passed:
  `bun run eval -- --scenario-dir <temp-dir-with-aspnet-routetable-scenario> --out-dir <temp-dir-with-aspnet-routetable-scenario>/out`
  reported `selectedCount=10`, `selectedSectionChecks=41`, and
  `selectedSectionFailures=0`.

Fresh eval hardening after adding page-oriented legacy section-local
source-ref gates:

- Added `selectedSectionsInclude` expectations to the JSP, Classic ASP, and
  ColdFusion billing page e2e variants so their selected billing page source
  chunks, billing test source chunks, capability sections, and tests sections
  each prove their own billing source refs while excluding sibling customer
  page/test refs.
- Focused page-oriented legacy eval passed:
  `bun run eval -- --scenario-dir <temp-dir-with-jsp-classic-asp-coldfusion-scenarios> --out-dir <temp-dir>/out`
  reported:
  `legacy-project-understanding-jsp-e2e selectedCount=8 selectedSectionChecks=18 selectedSectionFailures=0`,
  `legacy-project-understanding-classic-asp-e2e selectedCount=7 selectedSectionChecks=18 selectedSectionFailures=0`, and
  `legacy-project-understanding-coldfusion-e2e selectedCount=7 selectedSectionChecks=18 selectedSectionFailures=0`.

Fresh eval hardening after adding PHP route-config section-local source-ref
gates:

- Added `selectedSectionsInclude` expectations to the CodeIgniter, CakePHP,
  Symfony YAML, and Symfony XML billing route e2e variants so the selected
  billing capability, symbols, and tests sections each prove their own route
  config, controller, service/repository, and test source refs while excluding
  sibling customer route/controller/test refs.
- Focused PHP route-config eval passed:
  `bun run eval -- --scenario-dir <temp-dir-with-codeigniter-cakephp-symfony-scenarios> --out-dir <temp-dir>/out`
  reported:
  `legacy-project-understanding-codeigniter-e2e selectedCount=11 selectedSectionChecks=40 selectedSectionFailures=0`,
  `legacy-project-understanding-cakephp-e2e selectedCount=11 selectedSectionChecks=40 selectedSectionFailures=0`,
  `legacy-project-understanding-symfony-yaml-e2e selectedCount=11 selectedSectionChecks=45 selectedSectionFailures=0`, and
  `legacy-project-understanding-symfony-xml-e2e selectedCount=10 selectedSectionChecks=48 selectedSectionFailures=0`.

Fresh eval hardening after completing the remaining multi-variant legacy
section-local source-ref gates:

- Added variant-local `selectedSectionsInclude` expectations to the remaining
  multi-domain legacy e2e scenarios: the Express/CommonJS monolith, polyglot
  Flask/Django/Rails/Laravel fixture, and Struts fixture. Each variant now
  proves its own selected capability, symbols, and tests sections carry the
  matching domain source refs and exclude sibling-domain route/action/test refs.
- Focused remaining legacy eval passed:
  `bun run eval -- --scenario-dir <temp-dir-with-monolith-polyglot-struts-scenarios> --out-dir <temp-dir>/out`
  reported:
  `legacy-project-understanding-monolith-e2e/billing-reconciliation-primary selectedSectionChecks=40 selectedSectionFailures=0`,
  `legacy-project-understanding-monolith-e2e/customer-profile-primary selectedSectionChecks=28 selectedSectionFailures=0`,
  `legacy-project-understanding-polyglot-e2e/billing-primary selectedSectionChecks=65 selectedSectionFailures=0`,
  `legacy-project-understanding-polyglot-e2e/rails-reports-primary selectedSectionChecks=45 selectedSectionFailures=0`,
  `legacy-project-understanding-polyglot-e2e/django-shipments-primary selectedSectionChecks=21 selectedSectionFailures=0`,
  `legacy-project-understanding-polyglot-e2e/laravel-customers-primary selectedSectionChecks=41 selectedSectionFailures=0`,
  `legacy-project-understanding-struts-e2e/struts-billing-reconciliation-primary selectedSectionChecks=45 selectedSectionFailures=0`,
  `legacy-project-understanding-struts-e2e/struts-customer-profile-primary selectedSectionChecks=30 selectedSectionFailures=0`, and
  `legacy-project-understanding-struts-e2e/struts-reports-daily-primary selectedSectionChecks=29 selectedSectionFailures=0`.

Fresh eval hardening after adding section-local gates to the scanner-to-context
baseline:

- Added variant-local `selectedSectionsInclude` expectations to the baseline
  `legacy-project-understanding-e2e` scenario, covering the Orders capability
  map path, refund hybrid fallback path, and NestJS controller path. The
  hybrid fallback variant now proves the selected hybrid/source-chunk sections
  carry refund source refs without depending on a capability-map match.
- Focused baseline eval passed:
  `bun run eval -- --scenario-dir <temp-dir-with-baseline-scenario> --out-dir <temp-dir>/out`
  reported:
  `legacy-project-understanding-e2e/capability-map-primary selectedSectionChecks=34 selectedSectionFailures=0`,
  `legacy-project-understanding-e2e/hybrid-fallback-symbol-graph selectedSectionChecks=31 selectedSectionFailures=0`, and
  `legacy-project-understanding-e2e/nest-catalog-primary selectedSectionChecks=25 selectedSectionFailures=0`.

Fresh eval hardening after adding Hapi section-local source-ref gates:

- Added `selectedSectionsInclude` expectations to the Hapi billing
  reconciliation e2e variant so the selected billing capability, symbols, and
  tests sections each prove their own billing source refs.
- The new gates require billing route/controller/service/repository/test refs
  on the relevant selected sections and exclude customers/reports route,
  controller, and test refs from those same sections.
- Focused Hapi eval passed:
  `bun run eval -- --scenario-dir <temp-dir-with-hapi-scenario> --out-dir <temp-dir-with-hapi-scenario>/out`
  reported 1 scenario / 3 variants passed.

Fresh eval hardening after adding Restify section-local source-ref gates:

- Added `selectedSectionsInclude` expectations to the Restify billing
  reconciliation e2e variant so the selected billing capability, symbols, and
  tests sections each prove their own billing source refs.
- The new gates require billing route/controller/service/repository/test refs
  on the relevant selected sections and exclude customers/reports route,
  controller, and test refs from those same sections.
- JSON validation, Trellis validation, and scoped conflict-marker/trailing
  whitespace hygiene passed for the touched Restify scenario and task summary.
- Focused Restify eval passed:
  `bun run eval -- --scenario-dir <temp-dir-with-restify-scenario> --out-dir <temp-dir-with-restify-scenario>/out`
  reported 1 scenario / 3 variants passed. The billing variant executed 30
  `selectedSection*` checks with no failures, while the customer/reports
  variants did not receive the billing section-local gates.

Fresh eval hardening after adding Hono section-local source-ref gates:

- Added `selectedSectionsInclude` expectations to the Hono billing
  reconciliation e2e variant so the selected billing capability, symbols, and
  tests sections each prove their own billing source refs.
- The new gates require Hono billing route/controller/service/repository/test
  refs on the relevant selected sections and exclude customers/reports route,
  controller, and test refs from those same sections.
- Focused Hono eval passed:
  `bun run eval -- --scenario-dir <temp-dir-with-hono-scenario> --out-dir <temp-dir-with-hono-scenario>/out`
  reported 1 scenario / 3 variants passed. The billing variant executed 30
  `selectedSection*` checks with no failures, while the customer/reports
  variants did not receive the billing section-local gates.

Fresh eval hardening after adding Koa section-local source-ref gates:

- Added `selectedSectionsInclude` expectations to the Koa billing
  reconciliation e2e variant so the selected billing capability, symbols, and
  tests sections each prove their own billing source refs.
- The new gates require Koa billing router prefix/route, controller,
  service, repository, and test refs on the relevant selected sections and
  exclude customers/reports route, controller, and test refs from those same
  sections.
- Focused Koa eval passed:
  `bun run eval -- --scenario-dir <temp-dir-with-koa-scenario> --out-dir <temp-dir-with-koa-scenario>/out`
  reported 1 scenario / 3 variants passed. The billing variant executed 30
  `selectedSection*` checks with no failures, while the customer/reports
  variants did not receive the billing section-local gates.

Fresh eval hardening after adding Fastify section-local source-ref gates:

- Added `selectedSectionsInclude` expectations to the Fastify billing
  reconciliation e2e variant so the selected billing capability, symbols, and
  tests sections each prove their own billing source refs.
- The new gates require Fastify billing plugin registration/route, controller,
  service, repository, and test refs on the relevant selected sections and
  exclude customers/reports route, controller, and test refs from those same
  sections.
- Focused Fastify eval passed:
  `bun run eval -- --scenario-dir <temp-dir-with-fastify-scenario> --out-dir <temp-dir-with-fastify-scenario>/out`
  reported 1 scenario / 3 variants passed. The billing variant executed 44
  `selectedSection*` checks with no failures, while the customer/reports
  variants did not receive the billing section-local gates.

Fresh eval hardening after adding Spring annotation section-local source-ref
gates:

- Added `selectedSectionsInclude` expectations to the Spring annotation
  billing reconciliation e2e variant only, so the selected billing capability,
  symbols, and tests sections each prove their own Spring billing source refs.
- The new gates require billing controller, service, repository, and test refs
  on the relevant selected sections and exclude customer/report controller and
  test refs from those same sections.
- Focused Spring eval passed:
  `bun run eval -- --scenario-dir <temp-dir-with-spring-scenario> --out-dir <temp-dir-with-spring-scenario>/out`
  reported 1 scenario / 3 variants passed. The billing variant executed 24
  `selectedSection*` checks with no failures, while the customer/reports
  variants did not receive the billing section-local gates.

Fresh eval hardening after adding Java Servlet annotation section-local
source-ref gates:

- Added `selectedSectionsInclude` expectations to the Servlet billing
  reconciliation e2e variant only, so the selected billing capability,
  symbols, and tests sections each prove their own Servlet billing source refs.
- The new gates require billing servlet, service, repository, and test refs on
  the relevant selected sections and exclude customer/report servlet and test
  refs from those same sections.
- Focused Servlet eval passed:
  `bun run eval -- --scenario-dir <temp-dir-with-servlet-scenario> --out-dir <temp-dir-with-servlet-scenario>/out`
  reported 1 scenario / 3 variants passed. The billing variant executed 25
  `selectedSection*` checks with no failures, while the customer/reports
  variants did not receive the billing section-local gates.

Fresh eval hardening after adding `web.xml` Servlet section-local source-ref
gates:

- Added billing-only `selectedSectionsInclude` expectations to the `web.xml`
  Servlet e2e scenario, requiring the capability, symbols, and tests sections
  to each prove their own billing source refs.
- The new gates exclude customer/report `web.xml` mapping lines and sibling
  servlet test refs from those same selected billing sections.

Fresh eval hardening after adding Fastify/Restify/Go customer and reports
section-local source-ref gates:

- Added variant-local `selectedSectionsInclude` expectations to the Fastify
  customer-profile and reports-daily e2e variants so the selected capability,
  symbols, and tests sections each prove their own plugin registration/route,
  handler, and test source refs.
- Added equivalent Restify customer-profile and reports-daily gates, requiring
  the selected sections to carry the requested route, controller, and test refs
  while excluding sibling billing/report or billing/customer refs from those
  same sections.
- Added equivalent Go customer-profile and reports-daily gates, requiring the
  selected sections to carry the requested handler route/function and test refs
  while excluding sibling billing/report or billing/customer refs.
- Focused eval passed for the three touched scenarios:
  `bun run eval -- --scenario-dir <temp-dir-with-fastify-restify-go-scenarios> --out-dir <temp-dir>/out`
  reported 3 scenarios / 9 variants passed.
- JSON validation passed for the touched scenario files. A section-local
  coverage scan now reports 10 remaining legacy-project-understanding fixture
  variants with inventory manifest expectations but no effective
  `selectedSectionsInclude` gates, down from 16 before this batch.

Fresh eval hardening after completing the Java/.NET enterprise section-local
source-ref gates:

- Added variant-local `selectedSectionsInclude` expectations to the ASP.NET
  customer-profile and reports-daily e2e variants, requiring their selected
  capability, symbols, and tests sections to carry the matching controller and
  test refs while excluding sibling billing/report or billing/customer refs.
- Added equivalent Spring annotation, JAX-RS, Java Servlet annotation, and
  `web.xml` Servlet customer-profile and reports-daily gates.
- The JAX-RS gates intentionally preserve the shared application source ref
  where the selected sections already cite it, while still excluding sibling
  resource/test refs. The `web.xml` gates require both descriptor mapping refs
  and target Servlet/test refs on the selected sections.
- Focused eval passed for the five touched enterprise scenarios:
  `bun run eval -- --scenario-dir <temp-dir-with-enterprise-scenarios> --out-dir <temp-dir>/out`
  reported 5 scenarios / 15 variants passed.
- JSON validation passed for the touched enterprise scenario files. The
  effective section-local coverage scan now reports
  `missingVariantCount=0` for default legacy-project-understanding fixtures
  with inventory manifest expectations.
- Final verification for this eval-hardening batch passed:
  default eval reported 37 scenarios / 85 variants passed, `bun run typecheck`
  passed, Trellis task validation passed, touched scenario JSON validation
  passed, and touched-file `git diff --check` passed.

Fresh eval harness guard after section-local coverage reached zero:

- Added a harness-level guard for `legacy_project_understanding_fixture`
  scenarios: if a merged variant expectation declares `manifestRefsInclude`
  entries starting with `inventory_`, it must also declare
  `selectedSectionsInclude`.
- Added a red legacy scanner-to-context fixture that intentionally declares
  inventory manifest expectations without section-local gates. The fixture
  scans a tiny Orders API project and fails on
  `legacySelectedSectionsIncludeRequired:default`, proving the new guard catches
  global-only inventory evidence checks.
- Updated the eval harness spec to make section-local gates mandatory for
  legacy scanner-to-context inventory evidence.
- Verification passed: default eval still reports 37 scenarios / 85 variants
  passed, and the full red eval suite exits non-zero with the new scenario
  check failure included.

Fresh eval hardening after extending section-local gates to handcrafted
inventory ContextPack fixtures:

- Added `selectedSectionsInclude` expectations to all seven variants in the
  deterministic `legacy-project-understanding` ContextPack fixture. The gates
  now cover capability-map primary selection, same-file source-ref focusing,
  accepted rename/merge corrections, accepted mark-wrong hybrid fallback,
  governed historical inventory reuse, and symbol-graph hybrid fallback.
- Generalized the harness-level section-gate guard from
  `legacy_project_understanding_fixture` to both `context_pack_fixture` and
  `legacy_project_understanding_fixture`: any merged variant expectation with
  `inventory_*` manifest refs must now declare `selectedSectionsInclude`.
- Added a red `context_pack_fixture` that intentionally declares handcrafted
  inventory manifest expectations without section-local gates. It fails on
  `inventorySelectedSectionsIncludeRequired:default`, matching the scanner
  red fixture's guard behavior.
- Verification passed: focused `legacy-project-understanding` eval reported
  1 scenario / 7 variants passed, default eval reported 37 scenarios /
  85 variants passed, the full red eval suite exits non-zero with both
  inventory section-gate red fixtures included, `bun run typecheck` passed,
  Trellis task validation passed, touched JSON validation passed, and the
  combined inventory section-gate coverage scan reports
  `missingInventorySectionGateCount=0`.

Fresh V1.2 Next.js App Router exported-const alias continuation evidence:

- Added a regression for `import { listOrders } from "./orders-handler";`
  followed by `export const GET = listOrders;`, proving the route-handler edge
  resolves to `orders-handler.ts`'s `listOrders` symbol and not the route
  file's local `GET` const.
- Focused red/green regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "links exported const Next App Router handler aliases"`.
- Full project-inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported
  1 test file / 77 tests passed.
- Runner typecheck passed:
  `bun run --filter @ainp/runner typecheck`.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 37 scenarios / 85 variants passed.
- Trellis task validation passed, touched-file `git diff --check` passed, and
  direct conflict/trailing-whitespace scan reported no matches for the touched
  scanner/test files.

Fresh V1.2 Next.js App Router local alias export continuation evidence:

- Added a regression for `async function listOrders() { ... }` followed by
  `export { listOrders as GET };`, proving the scanner creates the
  `GET /api/orders` entrypoint from AST export evidence and links the
  route-handler edge to the local `listOrders` symbol.
- Focused red/green regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "links local alias-exported Next App Router handlers"`.
- Full project-inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported
  1 test file / 78 tests passed.
- Runner and full workspace typecheck passed:
  `bun run --filter @ainp/runner typecheck` and `bun run typecheck`.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 37 scenarios / 85 variants passed.
- Trellis task validation passed, touched-file `git diff --check` passed, and
  direct conflict/trailing-whitespace scan reported no matches for the touched
  scanner/test files.

Fresh V1.2 Next.js App Router locally exported const alias continuation
evidence:

- Added a regression for `import { listOrders } from "./orders-handler";`
  followed by `const GET = listOrders; export { GET };`, proving the
  route-handler edge resolves to `orders-handler.ts`'s `listOrders` symbol and
  not the route file's local `GET` const.
- Focused red/green regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "links locally exported const Next App Router handler aliases"`.
- Full project-inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported
  1 test file / 79 tests passed.
- Runner and full workspace typecheck passed:
  `bun run --filter @ainp/runner typecheck` and `bun run typecheck`.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 37 scenarios / 85 variants passed.
- Trellis task validation passed, LSP diagnostics reported 0 errors for the
  touched scanner/test files, and direct conflict/trailing-whitespace plus
  `git diff --check --no-index` scans reported no diagnostics for the touched
  files.

Fresh V1.2 Next.js App Router renamed local const export continuation
evidence:

- Added a regression for `import { listOrders } from "./orders-handler";`
  followed by `const handler = listOrders; export { handler as GET };`,
  proving the local-name/exported-name mapping is preserved and the
  route-handler edge resolves to `orders-handler.ts`'s `listOrders` symbol
  instead of the route file's local `handler` const.
- Focused red/green regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "links renamed local const Next App Router handler exports"`.
- Full project-inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported
  1 test file / 80 tests passed.
- Runner and full workspace typecheck passed:
  `bun run --filter @ainp/runner typecheck` and `bun run typecheck`.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 37 scenarios / 85 variants passed.
- Trellis task validation passed, LSP diagnostics reported 0 errors for the
  touched scanner/test files, and direct conflict/trailing-whitespace scan
  reported no matches for the touched files.

Fresh V1.2 Next.js App Router one-hop local const alias continuation evidence:

- Added a regression for `import { listOrders } from "./orders-handler";`
  followed by `const handler = listOrders; export const GET = handler;`,
  proving the scanner follows the local const alias one hop and resolves the
  route-handler edge to `orders-handler.ts`'s `listOrders` symbol instead of
  the route file's local `GET` const.
- Focused red/green regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "links exported const Next App Router handler aliases through local const aliases"`.
- Full project-inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported
  1 test file / 81 tests passed.
- Runner and full workspace typecheck passed:
  `bun run --filter @ainp/runner typecheck` and `bun run typecheck`.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 37 scenarios / 85 variants passed.
- Trellis task validation passed, LSP diagnostics reported 0 errors for the
  touched scanner/test files, and direct conflict/trailing-whitespace plus
  `git diff --check --no-index` scans reported no diagnostics for the touched
  files.

Fresh V1.2 Next.js App Router imported binding local export continuation
evidence:

- Added a regression for `import { listOrders } from "./orders-handler";`
  followed by `export { listOrders as GET };`, proving local export
  declarations of imported bindings are converted into import-backed export
  evidence and the route-handler edge resolves to `orders-handler.ts`'s
  `listOrders` symbol.
- Focused red/green regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "links local exports of imported Next App Router handlers"`.
- Full project-inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported
  1 test file / 82 tests passed.
- Runner and full workspace typecheck passed:
  `bun run --filter @ainp/runner typecheck` and `bun run typecheck`.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 37 scenarios / 85 variants passed.
- Trellis task validation passed, LSP diagnostics reported 0 errors for the
  touched scanner/test files, and direct conflict/trailing-whitespace plus
  `git diff --check --no-index` scans reported no diagnostics for the touched
  files.

Fresh V1.2/V1.3 Next.js Pages API continuation evidence:

- Added a scanner regression for old Next Pages API route files that declare a
  handler first and then export it with `export default handler;`. The
  inventory now has test coverage proving `ANY /api/...` entrypoints link to
  the default handler symbol and through to imported service symbols.
- Added a scanner-to-ContextPack e2e eval variant for a legacy Next Pages API
  invoice route. The fixture writes a temporary `pages/api/...` project, runs
  the real inventory scanner, then proves task-time ContextPack selection keeps
  the Pages API capability, handler/service symbols, source chunks, and tests
  while excluding unrelated Orders, Payments, Nest, and refund evidence.
- Focused regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "default handler aliases"`.
- Full project-inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported
  1 test file / 84 tests passed.
- Runner and full workspace typecheck passed:
  `bun run --filter @ainp/runner typecheck` and `bun run typecheck`.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 37 scenarios / 86 variants passed.
- Trellis task validation passed, LSP diagnostics reported 0 errors for the
  touched scanner/test files, the eval JSON parsed successfully, root lint was
  unavailable (`no-root-lint`), and direct conflict/trailing-whitespace plus
  `git diff --check --no-index` scans reported no diagnostics for the touched
  files.

Fresh V1.2/V1.3 Next.js Pages API re-export continuation evidence:

- Added a scanner regression for old Next Pages API route files that only
  re-export a default handler from another module, such as
  `export { showSubscription as default } from "../handlers/..."`. The
  inventory now has test coverage proving the thin route file creates an
  `ANY /api/...` entrypoint, links route -> external handler, and then links
  handler -> imported service.
- Added a scanner-to-ContextPack e2e eval variant for a legacy subscription
  Pages API route whose route file is only a re-export. The fixture proves
  task-time ContextPack selection follows the re-export to handler/service
  evidence and excludes unrelated Orders, Payments, Nest, refund, and sibling
  invoice evidence.
- Focused regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "re-exported default handlers"`.
- Full project-inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported
  1 test file / 85 tests passed.
- Runner and full workspace typecheck passed:
  `bun run --filter @ainp/runner typecheck` and `bun run typecheck`.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 37 scenarios / 87 variants passed.
- LSP diagnostics reported 0 errors for the touched scanner/test files.

Fresh V1.1/V1.2/V1.3 Next.js Pages API method-calibration evidence:

- Added conservative static `req.method` evidence extraction for old Next
  Pages API files. A `pages/api/**` file now emits concrete HTTP entrypoints
  when the route file contains static `req.method === "..."` checks or
  `switch (req.method) { case "..." }` branches, and falls back to `ANY` only
  when no static method evidence exists.
- Added a scanner regression for a Pages API handler with `switch
  (req.method)` branches, proving the scanner emits `GET` and `PATCH`
  entrypoints, suppresses the previous broad `ANY` entrypoint, preserves
  route -> default handler edges, and keeps handler -> service references.
- Updated the scanner-to-ContextPack e2e fixture so the legacy invoice Pages
  API route is selected as `POST /api/legacy-invoices/[id]`, proving method
  calibration flows from scanner output into task-time ContextPack selection.
- Focused regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "static Next Pages API req.method branches"`.
- Full project-inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported
  1 test file / 86 tests passed.
- Runner and full workspace typecheck passed:
  `bun run --filter @ainp/runner typecheck` and `bun run typecheck`.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 37 scenarios / 87 variants passed.
- LSP diagnostics reported 0 errors for the touched scanner/test files.

Fresh V1.2/V1.3 Next.js Pages API imported default handler evidence:

- Added import-backed `export default handler` evidence for TS/JS export
  assignments. When a Pages API route file imports a handler from another
  module and then re-exports it as default, the scanner now records the default
  export as re-export evidence and resolves route -> external handler ->
  imported service through the existing symbol graph path.
- Added a scanner regression for
  `import handler from "../../../src/api-handlers/invoice-handler"; export
  default handler;`, proving the thin route file links to the real default
  handler symbol and service instead of stopping at the route file.
- Added a scanner-to-ContextPack e2e eval variant for a legacy renewal Pages
  API route using an imported default handler. The fixture proves task-time
  ContextPack selection follows the import-backed default export to
  handler/service evidence and excludes unrelated Orders, Payments, Nest,
  refund, invoice, and subscription evidence.
- Focused regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "imported default handlers"`.
- Full project-inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported
  1 test file / 87 tests passed.
- Runner and full workspace typecheck passed:
  `bun run --filter @ainp/runner typecheck` and `bun run typecheck`.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 37 scenarios / 88 variants passed.
- LSP diagnostics reported 0 errors for the touched scanner/test files.

Fresh V1.1/V1.2/V1.3 Next.js Pages API CommonJS default handler evidence:

- Added CommonJS default handler coverage for old JS Pages API route files
  shaped as `const handler = require(...); module.exports = handler;`. The
  scanner now treats `module.exports = importedVariable` as import-backed
  default re-export evidence before falling back to a local `const` symbol.
- Added CommonJS default inline function export support for target handler
  modules shaped as `module.exports = function usageHandler(...) { ... }`,
  so route -> handler edges can land on the real handler symbol instead of
  stopping at the route file.
- Added a scanner regression proving `pages/api/usage/[id].js` can follow
  CommonJS route -> handler -> service evidence through `require` and
  `module.exports`.
- Added a scanner-to-ContextPack e2e eval variant for a legacy usage Pages API
  route using CommonJS route, handler, and service modules. The fixture proves
  task-time ContextPack selection follows the CommonJS chain and excludes
  unrelated Orders, Payments, Nest, refund, invoice, renewal, and subscription
  evidence.
- Focused regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "CommonJS default handlers"`.
- Full project-inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported
  1 test file / 88 tests passed.
- Runner and full workspace typecheck passed:
  `bun run --filter @ainp/runner typecheck` and `bun run typecheck`.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 37 scenarios / 89 variants passed.
- LSP diagnostics reported 0 errors for the touched scanner/test files.

Fresh V1.2/V1.3 constructed receiver alias normalization evidence:

- Normalized import-backed heuristic constructed receivers to the resolved
  class/type symbol before symbol-reference edges are emitted. Python alias
  constructions such as `from services.billing_service import BillingService
  as BillingSvc` followed by `service = BillingSvc()` now emit labels and
  edge ids for `BillingService` / `BillingService.reconcile` rather than the
  local alias, while preserving import, constructor, call-site, and target
  source refs.
- Updated the Flask/Python service graph regression to alias both the service
  and repository imports, proving route -> handler -> imported service ->
  imported repository evidence stays source-backed and avoids same-named
  shadow classes.
- Updated the scanner-to-ContextPack polyglot e2e fixture to use the same
  alias import shape, so default eval coverage now exercises alias-backed
  Flask billing evidence through task-time ContextPack selection.
- Focused regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "links Flask route handlers to constructed Python service"`.
- Full project-inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported
  1 test file / 88 tests passed.
- Runner typecheck passed:
  `bun run --filter @ainp/runner typecheck`.
- Full workspace typecheck passed:
  `bun run typecheck`.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 37 scenarios / 89 variants passed.
- Trellis task validation passed:
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.
- LSP diagnostics reported 0 errors for the touched scanner/test files, root
  lint was unavailable (`no-root-lint`), and direct conflict/trailing-whitespace
  plus `git diff --check --no-index` scans reported no diagnostics for the
  touched files.

Fresh V1.2/V1.3 Python namespace import receiver evidence:

- Extended heuristic Python import evidence to include static local
  `import module.path [as alias]` statements when the module resolves to a
  scanned local `.py` file. The scanner records these as namespace imports
  without executing Python, following dynamic import machinery, or treating
  unresolved third-party imports as local evidence.
- Extended Python constructed receiver detection to recognize namespace class
  calls such as `service = billing_service.BillingService()` and normalize the
  receiver through namespace import evidence before symbol-reference edges are
  emitted.
- Updated the Flask/Python service graph regression and the scanner-to-
  ContextPack polyglot e2e fixture to use namespace imports for both service
  and repository construction. The graph still emits canonical
  `BillingService` / `BillingRepository` labels and source-backed route ->
  handler -> service -> repository evidence.
- Focused regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "links Flask route handlers to constructed Python service"`.
- Full project-inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported
  1 test file / 88 tests passed.
- Runner typecheck passed:
  `bun run --filter @ainp/runner typecheck`.
- Full workspace typecheck passed:
  `bun run typecheck`.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 37 scenarios / 89 variants passed.
- Trellis task validation passed:
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.
- LSP diagnostics reported 0 errors for the touched scanner/test files, root
  lint was unavailable (`no-root-lint`), and direct conflict/trailing-whitespace
  plus `git diff --check --no-index` scans reported no diagnostics for the
  touched files.

Fresh V1.2/V1.3 Python multi-segment namespace receiver evidence:

- Extended import-backed Python constructed receiver normalization beyond
  `alias.Class()` to unaliased multi-segment namespace expressions such as
  `import services.billing_service` followed by
  `service = services.billing_service.BillingService()`. The resolver now
  matches the namespace expression against the static import specifier, so it
  does not treat a shared top-level package such as `services` as enough
  evidence to connect a sibling module.
- Updated the Flask/Python service graph regression and scanner-to-ContextPack
  polyglot e2e fixture to use unaliased multi-segment namespace imports for
  both service and repository construction while still emitting canonical
  `BillingService` / `BillingRepository` graph labels and source refs.
- Focused regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "links Flask route handlers to constructed Python service"`.
- Full project-inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported
  1 test file / 88 tests passed.
- Runner typecheck passed:
  `bun run --filter @ainp/runner typecheck`.
- Full workspace typecheck passed:
  `bun run typecheck`.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 37 scenarios / 89 variants passed.
- Trellis task validation passed:
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.
- LSP diagnostics reported 0 errors for the touched scanner/test files, root
  lint was unavailable (`no-root-lint`), and direct conflict/trailing-whitespace
  plus `git diff --check --no-index` scans reported no diagnostics for the
  touched files.

Fresh V1.2/V1.3 Python relative import receiver coverage:

- Verified the existing Python import module path resolver handles package-
  relative service/repository imports such as
  `from .services.billing_service import BillingService` and
  `from ..repositories.billing_repository import BillingRepository`.
- Updated the Flask/Python service graph regression to use relative imports
  for both service and repository construction while preserving canonical
  `BillingService` / `BillingRepository` graph labels, import/constructor/
  call-site/source symbol refs, and the same-named shadow service negative
  assertion.
- Updated the scanner-to-ContextPack polyglot e2e fixture to use the same
  relative import shape, so task-time ContextPack selection now exercises
  package-relative Flask billing evidence in the default legacy fixture set.
- Focused regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "links Flask route handlers to constructed Python service"`.
- Focused scanner-to-ContextPack polyglot eval passed:
  `bun run eval -- --scenario-dir <temp-dir-with-polyglot-scenario> --out-dir <temp-dir>/out`
  reported 1 scenario / 4 variants passed.
- Full project-inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported
  1 test file / 88 tests passed.
- Runner and full workspace typecheck passed:
  `bun run --filter @ainp/runner typecheck` and `bun run typecheck`.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 37 scenarios / 89 variants passed.
- Trellis task validation passed:
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.

Fresh V1.2/V1.3 Python package-relative module import receiver evidence:

- Extended Python `from ... import ...` import evidence so package-relative
  module imports such as `from .services import billing_service` resolve to
  the imported module file when it is present in the scanned repository. The
  scanner records the local module binding as namespace import evidence without
  executing Python imports or following dynamic import machinery.
- Added a Flask/Python service graph regression for
  `billing_service.BillingService()` and
  `billing_repository.BillingRepository()` receiver construction through
  relative module imports, including a same-named shadow service negative
  assertion.
- Updated the scanner-to-ContextPack polyglot e2e fixture to use relative
  module imports for the Flask billing service/repository chain, so default
  legacy eval coverage exercises this path through real inventory generation
  and task-time ContextPack selection.
- Red/green evidence: the new focused regression failed before the scanner
  change with only a `route_handler` edge, then passed after import evidence
  was extended.
- Focused regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "relative Python module imports"`.
- Focused scanner-to-ContextPack polyglot eval passed:
  `bun run eval -- --scenario-dir <temp-dir-with-polyglot-scenario> --out-dir <temp-dir>/out`
  reported 1 scenario / 4 variants passed.
- Full project-inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported
  1 test file / 89 tests passed.
- Runner and full workspace typecheck passed:
  `bun run --filter @ainp/runner typecheck` and `bun run typecheck`.
- Full test suite passed:
  `bun test` reported 108 files / 1061 tests passed.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 37 scenarios / 89 variants passed.
- Trellis task validation passed:
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.
- LSP diagnostics reported 0 errors for the touched scanner/test files, and
  direct conflict/trailing-whitespace plus `git diff --check` /
  `git diff --no-index --check` diagnostics were clean for the touched code,
  eval, and task-doc files.

Fresh V1.2/V1.3 Python package re-export receiver evidence:

- Extended import-backed constructed receiver normalization to follow bounded
  static Python re-export imports, so `from .services import BillingService`
  can resolve through `services/__init__.py` into
  `services/billing_service.py` without executing imports or using loose
  same-name matching.
- Included import target paths in the heuristic import resolution known-path
  set, so package files such as `__init__.py` that carry import evidence but
  no local class/function symbols can still be traversed.
- Added a Flask/Python regression for service and repository re-exports through
  `__init__.py`, including a same-named shadow service negative assertion.
  The red run proved the prior behavior fell back to the shadow service; the
  green run proves the graph now targets the canonical service/repository
  files and cites the re-export source refs.
- Updated the scanner-to-ContextPack polyglot e2e fixture to use package
  re-exports for the Flask billing service/repository chain and to assert the
  `__init__.py` re-export source refs in the billing selected sections.
- Focused regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "relative Python"`.
- Focused scanner-to-ContextPack polyglot eval passed:
  `bun run eval -- --scenario-dir <temp-dir-with-polyglot-scenario> --out-dir <temp-dir>/out`
  reported 1 scenario / 4 variants passed.
- Full project-inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported
  1 test file / 90 tests passed.
- Runner and full workspace typecheck passed:
  `bun run --filter @ainp/runner typecheck` and `bun run typecheck`.
- Full test suite passed:
  `bun test` reported 108 files / 1062 tests passed.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 37 scenarios / 89 variants passed.
- Trellis task validation passed:
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.

Fresh V1.2/V1.3 Python package namespace re-export coverage:

- Added scanner regression coverage for `from . import services` followed by
  `services.BillingService()` and `from .. import repositories` followed by
  `repositories.BillingRepository()`, both resolved through package
  `__init__.py` re-exports to canonical service/repository files.
- Added matching regression coverage for absolute package namespace imports
  such as `from legacy_billing import services` followed by
  `services.BillingService()` and `from legacy_billing import repositories`
  followed by `repositories.BillingRepository()`.
- Updated the scanner-to-ContextPack polyglot e2e fixture to use the same
  absolute package namespace import shape for the Flask billing
  service/repository chain while retaining section-local source-ref assertions
  for the re-export files.
- Focused regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "relative Python package"`.
- Focused absolute namespace regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "Python package namespace re-exports"`.
- Focused scanner-to-ContextPack polyglot eval passed:
  `bun run eval -- --scenario-dir <temp-dir-with-polyglot-scenario> --out-dir <temp-dir>/out`
  reported 1 scenario / 4 variants passed.
- Full project-inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported
  1 test file / 91 tests passed.
- Runner and full workspace typecheck passed:
  `bun run --filter @ainp/runner typecheck` and `bun run typecheck`.
- Full test suite passed:
  `bun test` reported 108 files / 1063 tests passed.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 37 scenarios / 89 variants passed.
- Trellis task validation passed:
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.

Fresh V1.2/V1.3 Python star import re-export coverage:

- Extended Python import evidence to conservatively expand local
  `from ... import *` statements when the target scanned `.py` file exposes
  bounded public static names through top-level declarations or static local
  re-export imports. Unresolved or overly broad star imports remain ignored,
  so the scanner does not execute Python imports or treat third-party/runtime
  import machinery as local evidence.
- Added a Flask/Python service graph regression for
  `from .services import *` and `from ..repositories import *` through
  `__init__.py` re-exports. The red run proved previous behavior fell back to
  a same-named shadow service; the green run proves the graph targets the
  canonical service/repository files and cites star-import plus re-export
  source refs.
- Updated the scanner-to-ContextPack polyglot e2e fixture to use the same
  star import shape for the Flask billing service/repository chain while
  retaining section-local source-ref assertions for the re-export files.
- Focused regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "conservative Python star imports"`.
- Focused scanner-to-ContextPack polyglot eval passed:
  `bun run eval -- --scenario-dir <temp-dir-with-polyglot-scenario> --out-dir <temp-dir>/out`
  reported 1 scenario / 4 variants passed.
- Full project-inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported
  1 test file / 93 tests passed.
- Runner and full workspace typecheck passed:
  `bun run --filter @ainp/runner typecheck` and `bun run typecheck`.
- Full test suite passed:
  `bun test` reported 108 files / 1065 tests passed.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 37 scenarios / 89 variants passed.
- Trellis task validation passed:
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.
- LSP diagnostics reported 0 errors for the touched scanner/test files, and
  direct conflict/trailing-whitespace plus `git diff --check` /
  `git diff --no-index --check` diagnostics were clean for the touched code,
  eval, and task-doc files.

Fresh V1.2/V1.3 Python star-imported module namespace coverage:

- Extended conservative Python star import expansion to emit namespace import
  evidence when a local package `__init__.py` exposes a local module binding,
  such as `from . import billing_service`. The scanner now records the star
  import and package import source refs while pointing the namespace binding
  at the concrete module file.
- Added a Flask/Python regression for `from .services import *` followed by
  `billing_service.BillingService()` and `from ..repositories import *`
  followed by `billing_repository.BillingRepository()`. The red run proved the
  previous scanner emitted only the route-handler edge; the green run proves
  the route -> handler -> service -> repository graph stays canonical and
  avoids same-named shadow service modules.
- Updated the scanner-to-ContextPack polyglot e2e fixture to use the same
  star-imported local module namespace shape for the Flask billing
  service/repository chain while retaining section-local source-ref assertions
  for the package `__init__.py` files and target service/repository files.
- Focused regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "star-imported local module namespaces"`.
- Focused combined Python star import regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "Python star"`
  reported 2 focused tests passed.
- Focused scanner-to-ContextPack polyglot eval passed:
  `bun run eval -- --scenario-dir <temp-dir-with-polyglot-scenario> --out-dir <temp-dir>/out`
  reported 1 scenario / 4 variants passed.
- Full project-inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported
  1 test file / 94 tests passed.
- Runner and full workspace typecheck passed:
  `bun run --filter @ainp/runner typecheck` and `bun run typecheck`.
- Full test suite passed:
  `bun test` reported 108 files / 1066 tests passed.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 37 scenarios / 89 variants passed.
- Trellis task validation passed:
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.
- LSP diagnostics reported 0 errors for the touched scanner/test files, and
  direct conflict/trailing-whitespace plus `git diff --check` /
  `git diff --no-index --check` diagnostics were clean for the touched code,
  eval, and task-doc files.

Fresh V1.2/V1.3 Python star import `__all__` filtering:

- Extended conservative Python star import expansion to honor simple static
  `__all__` list/tuple string-literal declarations in scanned local packages.
  Star import evidence now exposes only names listed in `__all__`, including
  local module namespace bindings such as `billing_service`, and leaves
  dynamic/unparseable `__all__` unsupported rather than guessed.
- Added a Flask/Python regression proving `from .services import *` can expose
  `billing_service.BillingService()` while not exposing an unlisted
  `admin_service.AdminService()` sibling from the same package.
- Updated the scanner-to-ContextPack polyglot fixture to keep the Flask billing
  package on static `__all__ = ["billing_service"]` and repository package on
  `__all__ = ["billing_repository"]`.
- Focused regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "honors Python __all__|Laravel controller actions"`
  reported 2 focused tests passed.
- Focused scanner-to-ContextPack polyglot eval passed:
  `bun run eval -- --scenario-dir <temp-dir-with-polyglot-scenario> --out-dir <temp-dir>/out`
  reported 1 scenario / 4 variants passed.

Fresh V1.2/V1.3 PHP fully qualified constructed receiver coverage:

- Extended PHP constructed receiver extraction to preserve fully qualified class
  names such as `\App\Services\BillingService` and resolve them through the
  existing static PHP path resolver before graph edges are emitted.
- Updated the Laravel service graph regression to construct
  `new \App\Services\BillingService()` without a `use` import while a
  same-named shadow `BillingService` exists elsewhere. The red run proved the
  handler -> service edge disappeared; the green run proves the route ->
  handler -> service -> repository graph resolves to the canonical app class.
- Updated the scanner-to-ContextPack polyglot Laravel fixture to use
  `new \App\Services\CustomerService()` and
  `new \App\Repositories\CustomerRepository()`, so task-time selection covers
  the FQCN graph path as well as scanner-only evidence.
- Focused regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "honors Python __all__|Laravel controller actions"`
  reported 2 focused tests passed.
- Full project-inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported
  1 test file / 95 tests passed.
- Runner typecheck passed:
  `bun run --filter @ainp/runner typecheck`.
- Full workspace typecheck passed:
  `bun run typecheck`.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 37 scenarios / 89 variants passed.
- Full test suite passed:
  `bun test` reported 108 files / 1067 tests passed.
- Trellis task validation passed:
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.
- LSP diagnostics reported 0 errors for
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts`.
- Conflict-marker and whitespace diagnostics were clean:
  `rg -n "<<<<<<<|>>>>>>>|=======" ...` had no matches, `git diff --check`
  had no output, and `git diff --no-index --check /dev/null <file>` had no
  output for the touched untracked code, eval, and task-doc files.

Fresh V1.2/V1.3 PHP grouped `use` import coverage:

- Extended PHP import evidence to expand grouped `use` declarations such as
  `use App\Repositories\{BillingRepository as BillingRepo};` into the same
  canonical import records used by ordinary `use App\Repositories\BillingRepository;`
  lines. Group members prefixed with `function` or `const` remain ignored.
- Updated the Laravel service graph regression to instantiate
  `new BillingRepo()` through a grouped alias import. The red run proved the
  service -> repository edges disappeared; the green run proves alias
  normalization now resolves the constructed receiver to the canonical
  `BillingRepository` class and method symbols.
- Updated the scanner-to-ContextPack polyglot Laravel fixture so
  `CustomerService` imports `CustomerRepository` through grouped alias syntax
  and task-time ContextPack selection still carries controller -> service ->
  repository graph evidence.
- Focused regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "Laravel controller actions"`.
- Focused scanner-to-ContextPack polyglot eval passed:
  `bun run eval -- --scenario-dir <temp-dir-with-polyglot-scenario> --out-dir <temp-dir>/out`
  reported 1 scenario / 4 variants passed.
- Full project-inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported
  1 test file / 95 tests passed.
- Full workspace typecheck passed:
  `bun run typecheck`.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 37 scenarios / 89 variants passed.
- Full test suite passed:
  `bun test` reported 108 files / 1067 tests passed.
- Trellis task validation passed:
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.
- LSP diagnostics reported 0 errors for
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts`.

Fresh V1.2/V1.3 PHP multi-line grouped `use` import coverage:

- Extended PHP import evidence collection to gather a bounded multi-line
  `use ...;` statement before parsing import members. The collector remains
  conservative: it starts only from line-leading `use`, skips `use function`
  and `use const`, and caps statement collection to avoid scanning arbitrary
  blocks.
- Updated the Laravel service graph regression to use a multi-line grouped
  alias import:
  `use App\Repositories\{ BillingRepository as BillingRepo };`. The red run
  proved the service -> repository edges disappeared with the previous
  line-only parser; the green run proves `new BillingRepo()` still resolves to
  the canonical `BillingRepository` class and method symbols.
- Updated the scanner-to-ContextPack polyglot Laravel fixture to use the same
  multi-line grouped alias syntax for `CustomerRepository`, with source-ref
  expectations adjusted to the new import/class/method line numbers.
- Focused regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "Laravel controller actions"`.
- Focused scanner-to-ContextPack polyglot eval passed:
  `bun run eval -- --scenario-dir <temp-dir-with-polyglot-scenario> --out-dir <temp-dir>/out`
  reported 1 scenario / 4 variants passed.

Fresh V1.2/V1.3 PHP/Laravel service-locator class literal coverage:

- Extended PHP receiver extraction to recognize assigned Laravel service
  locator calls when the target is a static class literal, including
  `app(...)`, `resolve(...)`, `\App::make(...)`, and `app()->make(...)`.
  These calls now feed the existing source-ref backed receiver graph without
  inferring string service names or runtime container bindings.
- Added a Laravel regression proving `app(\App\Services\BillingService::class)`
  and `\App::make(BillingRepo::class)` produce route -> controller ->
  service -> repository method edges through the existing FQCN and grouped
  alias import normalization paths.
- Updated the scanner-to-ContextPack polyglot fixture so its Laravel customer
  branch uses service-locator class literals while retaining task-focused
  selection and source-ref expectations.
- Red/green focused regression:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "service-locator class literals"`
  failed before the scanner change with only the route-handler edge, then
  passed after receiver extraction was added.
- Focused Laravel regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "Laravel"`
  reported 3 focused tests passed.
- Focused scanner-to-ContextPack polyglot eval passed:
  `bun run eval -- --scenario-dir <temp-dir-with-polyglot-scenario> --out-dir <temp-dir>/out`
  reported 1 scenario / 4 variants passed.

Fresh V1.2/V1.3 PHP/Laravel static factory class-call coverage:

- Extended PHP receiver extraction to recognize assigned static factory calls
  when the receiver is an explicit class name or FQCN and the method is in the
  conservative factory allowlist: `build`, `create`, `factory`, `getInstance`,
  `instance`, or `make`.
- Kept Laravel service-locator evidence separate by excluding the `App` facade
  from static factory receiver inference. Calls such as
  `\App::make(BillingRepo::class)` remain class-literal service-locator
  evidence, while `\App\Services\BillingService::make()` and
  `BillingRepo::instance()` feed the existing route -> controller -> service ->
  repository graph chain.
- Added a Laravel regression proving static factory assignments preserve
  source-ref backed service/repository method edges through FQCN and grouped
  alias import normalization.
- Focused regressions passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "static factory class calls|service-locator class literals"`.
- Full project-inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported
  1 test file / 97 tests passed.
- Runner package typecheck passed:
  `bun run --filter @ainp/runner typecheck`.
- Full workspace typecheck passed:
  `bun run typecheck`.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 37 scenarios / 89 variants passed.
- Full test suite passed:
  `bun test` reported 108 files / 1069 tests passed.
- Trellis task validation passed:
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.
- LSP diagnostics reported 0 errors for
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts`.
- Conflict-marker and whitespace diagnostics were clean:
  `git diff --check` and no-index whitespace checks for touched untracked
  legacy-task files had no output; anchored conflict-marker search had no
  matches.

Fresh V1.2/V1.3 Rails/Ruby `require_dependency` import evidence:

- Extended Ruby import evidence to recognize explicit Rails
  `require_dependency` statements alongside local `require` /
  `require_relative` forms.
- `require_dependency` resolution is Rails load-path aware but conservative:
  it only resolves uniquely matched scanned `.rb` files under Rails-style
  `app/` or `lib/` paths and does not execute Ruby, infer gems, or treat broad
  autoload constants as evidence.
- Added a red/green Rails regression with a same-named
  `aaa_shadow/services/billing_service.rb`. Before the scanner change, the
  controller's `BillingService.new` receiver linked to the shadow class; after
  the change, source refs include the `require_dependency` line and the graph
  points to `app/services/billing_service.rb`, then onward to the repository.
- Focused Rails regressions passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "require_dependency|Rails controller actions"`.
- Full project-inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported
  1 test file / 98 tests passed.
- Runner package typecheck passed:
  `bun run --filter @ainp/runner typecheck`.
- Full workspace typecheck passed:
  `bun run typecheck`.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 37 scenarios / 89 variants passed.
- Full test suite passed:
  `bun test` reported 108 files / 1070 tests passed.
- Trellis task validation passed:
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.
- LSP diagnostics reported 0 errors for
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts`.
- Conflict-marker and whitespace diagnostics were clean:
  `git diff --check`, no-index whitespace checks for touched untracked
  legacy-task files, and anchored conflict-marker search all passed.

Fresh V1.2/V1.3 Rails/Ruby namespaced class receiver coverage:

- Extended heuristic Ruby class symbol extraction so qualified declarations
  such as `class Billing::RefundService` emit the leaf class symbol
  `RefundService`.
- Tightened the generic class matchers so they no longer mislabel a Ruby
  namespace prefix (`Billing`) as the class when the declaration contains
  `::`.
- Added a red/green Rails regression that combines
  `require_dependency "billing/refund_service"`,
  `Billing::RefundService.new`, and
  `Billing::RefundRepository.new` with a same-named `aaa_shadow` service. The
  red run proved the service symbol was absent; the green run proves route ->
  controller -> namespaced service -> namespaced repository graph evidence is
  source-backed and excludes the shadow class.
- Focused Rails regressions passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "namespaced service|require_dependency|Rails controller actions"`.
- Full project-inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported
  1 test file / 99 tests passed.
- Runner package typecheck passed:
  `bun run --filter @ainp/runner typecheck`.
- Full workspace typecheck passed:
  `bun run typecheck`.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 37 scenarios / 89 variants passed.
- Full test suite passed:
  `bun test` reported 108 files / 1071 tests passed.
- Trellis task validation passed:
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.
- LSP diagnostics reported 0 errors for
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts`.
- Conflict-marker and whitespace diagnostics were clean:
  `git diff --check`, no-index whitespace checks for touched untracked
  legacy-task files, and anchored conflict-marker search all passed.

Fresh V1.2/V1.3 Rails/Ruby global-namespace receiver coverage:

- Extended Ruby constructed receiver extraction to accept explicit global
  namespace constants such as `::Billing::RefundService.new` and
  `::Billing::RefundRepository.new`.
- The receiver still normalizes to the leaf class symbol and relies on
  source-backed `require_dependency` / import evidence plus call-site refs; it
  does not execute Ruby constants or infer Rails autoload behavior.
- Added a red/green Rails regression proving route -> controller ->
  `::Billing::RefundService` -> `::Billing::RefundRepository` graph evidence is
  recovered. The red run produced only the route-handler edge; the green run
  includes the service/repository `symbol_reference` edges.
- Focused Rails regressions passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "global-namespace|namespaced service|require_dependency|Rails controller actions"`.
- Full project-inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported
  1 test file / 100 tests passed.
- Runner package typecheck passed:
  `bun run --filter @ainp/runner typecheck`.
- Full workspace typecheck passed:
  `bun run typecheck`.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 37 scenarios / 89 variants passed.
- Full test suite passed:
  `bun test` reported 108 files / 1072 tests passed.
- Trellis task validation passed:
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.
- LSP diagnostics reported 0 errors for
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts`.
- Conflict-marker and whitespace diagnostics were clean:
  `git diff --check`, no-index whitespace checks for touched untracked
  legacy-task files, and anchored conflict-marker search all passed.

Fresh V1.2/V1.3 Rails/Ruby explicit controller-path route coverage:

- Extended Rails `to:` route target parsing to accept slash-separated
  controller paths such as `admin/billing#approve_refund`.
- Preserved single-segment handler output such as
  `SubscriptionsController#index`, while path-aware handlers render as
  `admin/BillingController#approve_refund` and resolve to
  `app/controllers/admin/billing_controller.rb`.
- Kept the evidence boundary explicit: this uses only literal `to:` route
  targets and does not infer Rails controller namespaces from `namespace` /
  `scope` blocks or runtime autoloading.
- Added a red/green Rails regression proving route -> nested controller action
  -> namespaced service method graph evidence is recovered for the explicit
  controller path target.
- Focused Rails regressions passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "controller-path routes|Rails controller actions"`.
- Full project-inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported
  1 test file / 101 tests passed.
- Runner package typecheck passed:
  `bun run --filter @ainp/runner typecheck`.
- Full workspace typecheck passed:
  `bun run typecheck`.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 37 scenarios / 89 variants passed.
- Full test suite passed:
  `bun test` reported 108 files / 1073 tests passed.
- Trellis task validation passed:
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.
- LSP diagnostics reported 0 errors for
  `apps/runner/src/project-inventory.ts` and
  `apps/runner/test/project-inventory.test.ts`.
- Conflict-marker and whitespace diagnostics were clean:
  `git diff --check`, touched-file trailing-whitespace search, and anchored
  conflict-marker search all passed.

Fresh V1.2/V1.3 Laravel/PHP static controller-group route coverage:

- Extended Laravel route group evidence so static controller groups such as
  `Route::controller(BillingController::class)->prefix(...)->group(...)`
  carry the group controller alongside the mounted prefix.
- Nested quoted string actions such as
  `Route::post(..., "approveRefund")` now resolve to
  `BillingController@approveRefund`, while ordinary explicit array/string
  controller handlers still use the existing resolver.
- Kept the evidence boundary explicit: this covers static controller class
  literals plus quoted action names only, and does not inspect Laravel runtime
  routes, infer container bindings, or resolve dynamic controller values.
- Added a red/green Laravel regression. The red run produced a route with
  `handler: undefined`; the green run proves route -> controller action ->
  service -> repository graph evidence is source-backed and cites both group
  and route lines.
- Focused Laravel regressions passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "Laravel controller actions|controller-group string actions|Laravel service-locator|Laravel static factory|apiResource"`.
- Full project-inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported
  1 test file / 102 tests passed.
- Runner package typecheck passed:
  `bun run --filter @ainp/runner typecheck`.
- Full workspace typecheck passed:
  `bun run typecheck`.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 37 scenarios / 89 variants passed.
- Full test suite passed:
  `bun test` reported 108 files / 1074 tests passed.

Fresh V1.2/V1.3 Flask/Python static MethodView route coverage:

- Added static Flask `add_url_rule(...)` extraction for MethodView handlers
  shaped as `view_func=BillingRefundView.as_view(...)` with static
  `methods=[...]`.
- The scanner maps static HTTP methods to concrete class method handlers such
  as `BillingRefundView.post`, so route-handler graph edges point at the view
  method instead of stopping at the class or missing the route entirely.
- Kept the evidence boundary explicit: only static URL strings, static
  MethodView class references, and static method lists are used; dynamic
  `view_func` values and runtime Flask route maps remain out of scope.
- Added a red/green Flask regression. The red run produced no route
  entrypoint; the green run proves route -> MethodView method -> service ->
  repository graph evidence is source-backed.
- Focused Python regressions passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "MethodView|Flask route handlers|Blueprint|APIRouter|Django class-based view|directly imported Django"`.
- Full project-inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported
  1 test file / 103 tests passed.
- Runner package typecheck passed:
  `bun run --filter @ainp/runner typecheck`.
- Full workspace typecheck passed:
  `bun run typecheck`.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 37 scenarios / 89 variants passed.
- Full test suite passed:
  `bun test` reported 108 files / 1075 tests passed.

Fresh V1.2/V1.3 Flask/Python static `add_url_rule` function-view coverage:

- Extended static Flask `add_url_rule(...)` extraction beyond MethodView
  handlers to simple function views shaped as
  `view_func=approve_refund` with static `methods=[...]`.
- The scanner now emits the function view as the route handler, so existing
  import-backed handler resolution can link an `app.py` route registration to a
  `views.py` function and continue through explicit service/repository graph
  evidence.
- Kept the evidence boundary explicit: only static URL strings, simple static
  function handler names, static MethodView class references, and static method
  lists are used; dynamic `view_func` expressions and runtime Flask route maps
  remain out of scope.
- Added a red/green Flask regression. The red run produced no route
  entrypoint for `view_func=approve_refund`; the green run proves route ->
  imported function view -> service -> repository graph evidence is
  source-backed.
- Focused Flask function-view regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "add_url_rule function"`.
- Focused Python/Flask/Django regression bundle passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "add_url_rule function|MethodView|Flask route handlers|Blueprint|APIRouter|Django class-based view|directly imported Django"`
  reported 12 passed tests.
- Full project-inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported
  1 test file / 104 tests passed.
- Runner package typecheck passed:
  `bun run --filter @ainp/runner typecheck`.
- Full workspace typecheck passed:
  `bun run typecheck`.
- Trellis task context validation passed:
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.
- Whitespace diff check passed:
  `git diff --check`.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 37 scenarios / 89 variants passed.
- Full test suite passed:
  `bun test` reported 108 files / 1076 tests passed.

Fresh V1.2/V1.3 Java Play Framework static route coverage:

- Added conservative `conf/routes` scanning for Play Framework projects.
- Static route lines such as
  `POST /billing/refunds/:refundId/approve controllers.BillingController.approveRefund(...)`
  now produce source-ref backed HTTP entrypoints with
  `BillingController#approveRefund` handler evidence.
- The route-handler edge resolves to the Java controller method and continues
  through the existing explicit constructed service/repository graph.
- Kept the evidence boundary explicit: only static HTTP methods, literal paths,
  and Java `controllers.<Class>.<method>(...)` targets are used; wildcard/static
  asset routes, reverse routes, Scala controllers, DI/container wiring, and
  runtime router behavior remain out of scope.
- Added a red/green Play regression. The red run produced no route entrypoint
  from `conf/routes`; the green run proves route -> controller method ->
  service -> repository graph evidence is source-backed.
- Focused Play regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "Play Framework"`.
- Focused Java legacy regression bundle passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "Play Framework|Spring XML MVC|JAX-RS|JAX-WS|Servlet|Struts"`
  reported 8 passed tests.
- Full project-inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported
  1 test file / 105 tests passed.
- Runner package typecheck passed:
  `bun run --filter @ainp/runner typecheck`.
- Full workspace typecheck passed:
  `bun run typecheck`.
- Trellis task context validation passed:
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.
- Whitespace diff check passed:
  `git diff --check`.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 37 scenarios / 89 variants passed.
- Full test suite passed:
  `bun test` reported 108 files / 1077 tests passed.

Fresh V1.2/V1.3 PHP Slim/Silex-style static route coverage:

- Added conservative static PHP route scanning for Slim/Silex-style
  `$app` / `$router` / `$routes` calls.
- Static calls such as
  `$app->post("/billing/refunds/{refundId}/approve", [BillingController::class, "approveRefund"])`
  and `$app->get("/customers/{customerId}/profile", "CustomerController:profile")`
  now produce source-ref backed HTTP entrypoints with
  `Slim:Controller@action` handler evidence.
- The route-handler edge resolves to a unique PHP controller method and
  continues through the existing explicit constructed service/repository graph.
- Kept the evidence boundary explicit: only conventional app/router receivers,
  literal route paths, and literal controller callables are used; arbitrary
  object method calls, closures, wildcard routes, middleware, DI/container
  wiring, and runtime route inspection remain out of scope.
- Added a red/green Slim regression. The red run produced no route entrypoint
  from `$app->post(...)`; the green run proves route -> controller method ->
  service -> repository graph evidence is source-backed and that non-route
  receivers / closure handlers are ignored.
- Focused Slim regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "Slim-style"`.
- Focused PHP legacy regression bundle passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "Slim-style|Laravel service-locator|Laravel static factory|CodeIgniter|CakePHP|Symfony YAML|Symfony XML"`
  reported 7 passed tests.
- Full project-inventory regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` reported
  1 test file / 106 tests passed.
- Runner package typecheck passed:
  `bun run --filter @ainp/runner typecheck`.
- Full workspace typecheck passed:
  `bun run typecheck`.
- Trellis task context validation passed:
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.
- Whitespace diff check passed:
  `git diff --check`.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 37 scenarios / 89 variants passed.
- Full test suite passed:
  `bun test` reported 108 files / 1078 tests passed.

Fresh scanner-to-ContextPack Play/Slim e2e coverage and Play token
calibration:

- Added default scanner-to-ContextPack e2e eval coverage for a Play Framework
  Java fixture. The fixture writes a temporary old Play project with static
  `conf/routes`, runs the real scanner, then feeds the generated
  `project-inventory.json` into the real ContextPack builder.
- The Play fixture proves the billing route selects source-ref backed
  `conf/routes` evidence, `BillingController#approveRefund`, explicit
  service/repository graph evidence, and the billing test surface while
  excluding the sibling customer route/test and static asset route.
- The first Play eval run exposed a ContextPack noise issue: generic framework
  words in the task brief could select sibling Play route/test sections. The
  inventory task-token filter now treats `play` and `framework` as generic
  framework/layer vocabulary, keeping capability selection driven by domain
  terms such as billing/refund instead.
- Synchronized roadmap, PRD checklist, task breakdown, and regression test
  plan to include the Slim/Silex scanner-to-ContextPack fixture and the new
  Play Framework scanner-to-ContextPack fixture.
- Default eval suite passed after the Play fixture and token calibration:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 39 scenarios / 91 variants passed with `scenarioChecks=3/0`.
- Focused ContextPack calibration tests passed:
  `bun run test -- apps/runner/test/context-builder.test.ts -t "framework-language|Spring XML MVC capabilities|weak same-token"`
  reported 2 passed tests.
- Focused Play/Slim scanner regressions passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "Play Framework|Slim-style"`
  reported 2 passed tests.
- Runner package typecheck passed:
  `bun run --filter @ainp/runner typecheck`.
- Full workspace typecheck passed:
  `bun run typecheck`.
- Full test suite passed:
  `bun test` reported 108 files / 1078 tests passed.

Fresh legacy inventory quality gate hardening:

- Added scenario-level `inventoryQualityGates` support for
  `legacy_project_understanding_fixture` evals. The harness now aggregates
  scanner-real variant outputs and checks measured variant count, minimum
  symbol graph edge confidence, and minimum route-handler edge confidence at
  scenario level.
- Enabled the new quality gates for the multi-variant polyglot old-project
  fixture and the Play/Slim scanner-to-ContextPack fixtures. Current floors
  are polyglot `measuredVariantsMin=4`, graph confidence `0.68`, and
  route-handler confidence `0.9`; Play graph/route-handler floors are
  `0.68`/`0.8`; Slim floors are `0.68`/`0.9`.
- Updated the eval harness spec, task breakdown, regression plan, and roadmap
  to treat scenario-level inventory graph confidence floors as a minimum
  regression guard for future scanner-to-context legacy fixtures.
- Default eval suite passed after the gate hardening:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 39 scenarios / 91 variants passed with `scenarioChecks=12/0`.
  The new Play/Slim/polyglot inventory quality checks all passed with actual
  measured values matching or exceeding their floors.
- Full workspace typecheck passed:
  `bun run typecheck`.

Fresh red-suite coverage for inventory quality gates:

- Added `eval/scenarios-red/legacy-project-understanding-inventory-quality-gate.json`.
  The fixture uses a real temporary legacy TypeScript/Express-style project,
  lets scanner-to-ContextPack generation succeed, and then intentionally sets
  impossible `inventoryQualityGates` confidence floors.
- Red eval suite failed as expected:
  `bun run eval -- --scenario-dir eval/scenarios-red --out-dir .ainp/evals`
  reported 9 scenarios / 9 variants with non-zero exit. The new fixture's
  variant checks passed, while scenario checks failed on
  `inventoryQualityGates.graphEdgeConfidenceMin` (`expected=1.01`,
  `actual=0.7`) and
  `inventoryQualityGates.routeHandlerEdgeConfidenceMin` (`expected=1.01`,
  `actual=0.9`).
- Default eval suite still passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 39 scenarios / 91 variants passed with `scenarioChecks=12/0`.
- Full workspace typecheck passed:
  `bun run typecheck`.
- Trellis task context validation passed:
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.
- Whitespace diff check passed:
  `git diff --check`.

Fresh default graph-quality coverage for all graph-bearing legacy fixtures:

- Extended the eval harness so `legacy_project_understanding_fixture`
  scenarios that emit symbol graph evidence receive conservative default
  inventory quality checks even when a scenario omits explicit
  `inventoryQualityGates`.
- The default floors are `inventoryQualityDefaults.graphEdgeConfidenceMin=0.65`
  and `inventoryQualityDefaults.routeHandlerEdgeConfidenceMin=0.78`. Explicit
  `inventoryQualityGates` remain available for stricter scenario-specific
  floors, as used by the Play, Slim/Silex, and polyglot fixtures.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 39 scenarios / 91 variants passed with `scenarioChecks=60/0`.
  The report showed 24 graph-bearing legacy scenarios covered by default graph
  quality checks, plus 3 scenarios covered by explicit quality gates.
- Red eval suite still failed as expected:
  `bun run eval -- --scenario-dir eval/scenarios-red --out-dir .ainp/evals`
  reported 9 scenarios / 9 variants with non-zero exit and
  `scenarioChecks=3/4`. The missing-section red fixture now also passes the
  default graph quality checks before failing its intended section-gate check,
  while the inventory-quality red fixture still fails its impossible explicit
  graph confidence floors.
- Full workspace typecheck passed:
  `bun run typecheck`.

Fresh correction-rationale eval hardening:

- Extended `selectedSectionsInclude` in the eval harness so scenario fixtures
  can assert section-local `contentIncludes`, `contentExcludes`,
  `reasonIncludes`, and `reasonExcludes`, in addition to mode/source-ref
  checks. The harness output now exposes selected section reason/content
  summaries for those checks.
- Strengthened the deterministic
  `legacy-project-understanding/accepted-capability-wrong-correction` variant
  so the suppressed capability section must render `Heuristic capability
  suppressed`, and each hybrid fallback section must render the source-level
  fallback rationale plus `Accepted correction kart_eval_cap_orders_wrong`.
- Added `eval/scenarios-red/context-pack-section-content-bad-expectation.json`,
  proving section-local content checks fail when a selected section lacks the
  required rationale text.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 39 scenarios / 91 variants passed with `scenarioChecks=60/0`.
  The mark-wrong variant's 12 new selected-section content/reason checks all
  passed.
- Red eval suite failed as expected:
  `bun run eval -- --scenario-dir eval/scenarios-red --out-dir .ainp/evals`
  reported 10 scenarios / 10 variants with non-zero exit. The new content red
  fixture failed on
  `selectedSectionContentIncludes:knowledge_kart_section_content_alpha:this text is intentionally absent`.
- Full workspace typecheck passed:
  `bun run typecheck`.

Fresh correction governance-boundary eval coverage:

- Added the deterministic
  `legacy-project-understanding/review-required-capability-wrong-ignored`
  variant. It supplies an accepted project-capability-map mark-wrong correction
  with `reviewStatus='needs_review'` and verifies that the normal Orders
  capability, symbols, tests, and hotspots still select for the task.
- The variant excludes `inventory_correction_cap_api_orders`,
  `inventory_hybrid_entry_orders_delete`, and
  `knowledge_kart_eval_cap_orders_wrong_needs_review`, and checks that selected
  inventory sections do not carry the unreviewed correction's source refs or
  suppression/fallback rationale.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 39 scenarios / 92 variants passed with `scenarioChecks=60/0`.
- Red eval suite still failed as expected:
  `bun run eval -- --scenario-dir eval/scenarios-red --out-dir .ainp/evals`
  reported 10 scenarios / 10 variants with non-zero exit and
  `scenarioChecks=3/4`.
- Full workspace typecheck passed:
  `bun run typecheck`.

Fresh hybrid source-chunk evidence hardening:

- Tightened ContextPack source chunk fallback rendering so graph/inventory
  pointing records are deduplicated before section content, reason text, and
  source refs are assembled. The deterministic refund fallback no longer
  repeats the same graph edge id when a hybrid symbol match and graph-edge
  match both point at the same chunk.
- Updated source chunk linked evidence to include the real pointing inventory
  record, so graph-backed chunks show the `symbol_reference` edge and label
  that led the agent to the bounded snippet instead of only a synthetic
  `graphEdgeRefs` id.
- Strengthened
  `legacy-project-understanding/hybrid-fallback-symbol-graph` with
  section-local content and reason checks for the hybrid test section, hybrid
  symbol section, hybrid graph-edge section, and graph-pointed source chunk.
  The source chunk now proves it renders `Pointed by inventory evidence:
  edge_refund_repo`, the linked edge label, and the bounded snippet while
  excluding Orders/Payments context.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 39 scenarios / 92 variants passed with `scenarioChecks=60/0`.
- Red eval suite still failed as expected:
  `bun run eval -- --scenario-dir eval/scenarios-red --out-dir .ainp/evals`
  reported 10 scenarios / 10 variants with non-zero exit and
  `scenarioChecks=3/4`.
- Full workspace typecheck, Trellis task validation, and whitespace checks
  passed:
  `bun run typecheck`,
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`,
  and `git diff --check`.

Fresh correction governance-boundary expansion:

- Added deterministic
  `legacy-project-understanding/review-required-capability-rename-match-ignored`
  and
  `legacy-project-understanding/review-required-capability-merge-match-ignored`
  variants. They supply accepted project-capability-map corrections with
  `reviewStatus='needs_review'` and task briefs that use the proposed corrected
  label (`Fulfillment API`) or merge target (`Commerce Operations`).
- Both variants prove unreviewed rename/merge corrections do not participate
  in inventory matching: the original Orders capability is not selected for
  the corrected-label task, corrected-label symbol/test/hotspot sections are
  absent, correction artifacts do not render as `knowledge_*`, and correction
  source refs do not leak into the selected ContextPack.
- Raised the deterministic legacy understanding scenario quality gate from 8
  to 10 measured variants so the new correction-governance variants count
  toward the scenario-level irrelevant-context ratio checks.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 39 scenarios / 94 variants passed with `scenarioChecks=60/0`.
- Red eval suite still failed as expected:
  `bun run eval -- --scenario-dir eval/scenarios-red --out-dir .ainp/evals`
  reported 10 scenarios / 10 variants with non-zero exit and
  `scenarioChecks=3/4`.
- Full workspace typecheck, Trellis task validation, and whitespace checks
  passed:
  `bun run typecheck`,
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`,
  and `git diff --check`.

Fresh correction drift signal slice:

- Added a bounded ContextPack calibration signal for accepted,
  non-review-required project-capability-map corrections whose `capabilityId`
  no longer appears in the current-run `project-inventory.json`. The builder
  now emits a `stale` / `review_required` signal with the correction artifact,
  missing capability id, current inventory artifact, and original inventory
  source refs instead of silently dropping the correction or applying it to an
  unrelated capability.
- Added a focused ContextPack builder regression:
  `emits a stale review signal when an accepted capability correction no longer
  matches current inventory`.
- Added the deterministic
  `legacy-project-understanding/accepted-correction-missing-capability-drift-signal`
  eval variant. It uses a current inventory containing only Payments plus an
  accepted Fulfillment/Orders correction pointing to the missing Orders
  capability, then verifies a calibration signal is emitted while no
  inventory/correction section is injected.
- Raised the deterministic legacy understanding scenario quality gate from 10
  to 11 measured variants so the drift-signal variant participates in the
  scenario-level irrelevant-context ratio checks.
- Focused and full ContextPack builder tests passed:
  `bun run test -- apps/runner/test/context-builder.test.ts -t "stale review signal"`
  and `bun run test -- apps/runner/test/context-builder.test.ts`.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 39 scenarios / 95 variants passed with `scenarioChecks=60/0`.
- Red eval suite still failed as expected:
  `bun run eval -- --scenario-dir eval/scenarios-red --out-dir .ainp/evals`
  reported 10 scenarios / 10 variants with non-zero exit and
  `scenarioChecks=3/4`.
- Full workspace typecheck, Trellis task validation, and whitespace checks
  passed:
  `bun run typecheck`,
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`,
  and `git diff --check`.

Fresh calibration-signal eval hardening:

- Extended the eval harness with `calibrationSignalsInclude`, allowing
  ContextPack and legacy-project-understanding fixtures to assert structured
  review/calibration signal fields: id, kind, severity, recommended action,
  message includes/excludes, subject refs, and evidence refs.
- Strengthened
  `legacy-project-understanding/accepted-correction-missing-capability-drift-signal`
  so it now proves the stale drift signal cites
  `knowledge_artifact:kart_eval_cap_orders_rename_drift`,
  `capability:cap_api_orders`, the current inventory artifact, the original
  inventory artifact, and the original Orders source ref while excluding the
  unrelated Payments route source ref.
- Added
  `eval/scenarios-red/context-pack-calibration-signal-bad-expectation.json`,
  which intentionally requires a nonexistent signal evidence ref and fails on
  the new `calibrationSignalsInclude` check.
- ContextPack builder tests passed:
  `bun run test -- apps/runner/test/context-builder.test.ts`.
- Default eval suite passed:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  reported 39 scenarios / 95 variants passed with `scenarioChecks=60/0`.
- Red eval suite still failed as expected:
  `bun run eval -- --scenario-dir eval/scenarios-red --out-dir .ainp/evals`
  reported 11 scenarios / 11 variants with non-zero exit and
  `scenarioChecks=3/4`; the new calibration-signal red fixture failed on
  `calibrationSignalsInclude`.
- Full workspace typecheck, Trellis task validation, and whitespace checks
  passed:
  `bun run typecheck`,
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`,
  and `git diff --check`.

Fresh task-detail calibration signal audit UI:

- Extended the task-detail context-governance panel to render ContextPack
  calibration/review signals as read-only audit evidence. The panel now shows a
  signal count and per-signal kind, severity, recommended action, subject refs,
  and evidence refs, making stale accepted-correction drift visible to human
  reviewers without mutating knowledge state.
- Tightened the web DTO for `ContextGovernanceDto.contextPacks[].calibrationSignals`
  from `unknown[]` to a wide `ContextCalibrationSignalDto`, preserving forward
  compatibility while making the UI contract explicit.
- Added happy-dom coverage proving a stale `review_required`
  `mark_stale_or_supersede` drift signal renders with its correction artifact,
  capability subject, and source evidence refs.
- Extended the context-governance API route regression so
  `GET /workflow-runs/:id/context` proves artifact metadata calibration signals
  are exposed on the owning context pack before the Web renders them.
- Focused API/UI and web typecheck passed:
  `bun run test -- apps/api/test/context-governance-route.test.ts`,
  `bun run test -- apps/web/test/context-flow-panel.test.ts`, and
  `bun run --filter @ainp/web typecheck`.

Fresh source-chunk stable content hash foundation:

- Added `contentSha256` to inventory `sourceChunks`. The existing `sha256`
  remains a hash of the rendered snippet with line labels for backward
  compatibility, while `contentSha256` hashes the bounded source content
  without `L<number>:` prefixes so future cross-run source retrieval and drift
  comparison can survive line-number shifts.
- Added project-inventory regression coverage proving identical source content
  shifted by an inserted line keeps the same `contentSha256` while the legacy
  snippet `sha256` changes.
- ContextPack source chunk probes now render valid `contentSha256` values as
  `Content SHA-256` audit lines, so selected source evidence carries a stable
  cross-run/RAG anchor without changing retrieval scoring or replacing source
  refs.
- Source chunk generation now backfills reverse `sourceChunkRefs` onto linked
  entrypoints, symbols, symbol graph nodes/edges, tests, hotspots, and
  capabilities. This gives downstream hybrid/RAG consumers a direct path from a
  selected inventory record to bounded source chunks.
- Tightened ContextPack coverage so a hybrid-selected symbol can point to a
  source chunk through `sourceChunkRefs` even when the chunk itself does not
  carry the corresponding forward `symbolRefs` relation.
- Added historical inventory reuse coverage for the same source-level path: an
  accepted `project_inventory:latest` knowledge artifact can provide a
  hybrid-selected symbol with `sourceChunkRefs`, select the bounded source
  chunk, carry both knowledge artifact and original inventory artifact refs, and
  render `Content SHA-256` without injecting raw inventory JSON.
- Focused source chunk hash regression passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "source chunk content hashes"`.
- Focused ContextPack source chunk rendering regression passed:
  `bun run test -- apps/runner/test/context-builder.test.ts -t "selects source chunks as code probes"`.
- Focused reverse `sourceChunkRefs` ContextPack regression passed:
  `bun run test -- apps/runner/test/context-builder.test.ts -t "selects source chunks pointed to by hybrid inventory evidence"`.
- Focused historical inventory source chunk regression passed:
  `bun run test -- apps/runner/test/context-builder.test.ts -t "selects historical inventory source chunks"`.
- Full project inventory and ContextPack builder regressions passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts`
  (107 tests) and
  `bun run test -- apps/runner/test/context-builder.test.ts` (55 tests).
- Full workspace typecheck, Trellis task validation, whitespace checks, and
  default eval passed:
  `bun run typecheck`,
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`,
  `git diff --check`, and
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  (39 scenarios / 95 variants, `scenarioChecks=60/0`).
- Latest verification after reverse `sourceChunkRefs` passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  (162 tests), `bun run typecheck`,
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  (39 scenarios / 95 variants, `scenarioChecks=60/0`),
  Trellis task validation, and `git diff --check`.
- Latest verification after historical inventory source chunk coverage passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  (163 tests), `bun run typecheck`,
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  (39 scenarios / 95 variants, `scenarioChecks=60/0`),
  Trellis task validation, and `git diff --check`.

Fresh default eval coverage for historical inventory source chunk refs:

- Promoted the focused historical inventory `sourceChunkRefs` regression into
  the default deterministic `legacy-project-understanding` eval scenario.
  The new no-current-inventory variant uses an accepted
  `project_inventory:latest` knowledge artifact with a hybrid-selected
  `RefundReconciliationService` symbol that points directly to a bounded
  source chunk.
- The eval now proves the historical source chunk path carries
  `knowledge_artifact:*`, the original inventory artifact ref, source line refs
  for both the symbol and chunk, `Pointed by inventory evidence:
  sym_refund_reconciliation`, and `Content SHA-256`, while excluding raw
  `project-inventory.json`, ordinary `knowledge_*` rendering, and unrelated
  Orders/Payments source refs.
- Raised the deterministic legacy understanding scenario quality gate from 11
  to 12 measured variants and marked `project_profile` as relevant foundation
  context for the new source-chunk variant, keeping low-signal inventory
  leakage checks strict without treating the required project profile as noise.
- Default eval passed after the new variant:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  (39 scenarios / 96 variants, `scenarioChecks=60/0`).

Fresh historical source chunk hash drift calibration:

- Added a ContextPack calibration signal for current-vs-historical project
  inventory source chunk hash drift. When a fresh `project-inventory.json` and
  an accepted historical `project_inventory:latest` knowledge artifact contain
  the same source chunk identity but different valid `contentSha256` values,
  the builder emits a bounded `stale` / `review_required` signal with
  `mark_stale_or_supersede` action.
- The signal carries the knowledge artifact ref, source chunk subject ref,
  current inventory artifact ref, historical/original inventory artifact ref,
  and source line refs. It does not mutate accepted knowledge, invent a
  replacement chunk, or change ContextPack retrieval ranking.
- Added focused ContextPack builder coverage for the drift signal and promoted
  the behavior into the default deterministic `legacy-project-understanding`
  eval scenario with structured `calibrationSignalsInclude` assertions.
- Updated the shared Context Injection Protocol, roadmap, task breakdown, and
  regression test plan to make source chunk hash drift an explicit review
  signal contract for the V1.4/V2 bridge.
- Default eval passed after the new variant:
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  (39 scenarios / 97 variants, `scenarioChecks=60/0`).

Fresh source chunk drift identity hardening:

- Extended source chunk hash drift matching beyond exact chunk id and exact
  path/start/end windows. The calibration signal can now match current and
  historical chunks by the same chunk path plus explicit linked inventory
  record refs such as `symbolRefs`, `graphEdgeRefs`, `entrypointRefs`,
  `testRefs`, `hotspotRefs`, or `capabilityRefs`.
- This keeps the cross-run drift signal useful when source lines shift and
  generated chunk ids change, while still avoiding same-file-only matching.
  The behavior remains review-signal-only and does not mutate accepted
  knowledge or change ContextPack retrieval ranking.
- Added focused ContextPack coverage for linked-record drift matching and
  updated the default drift eval fixture so the current chunk has shifted
  lines/id but shares `symbolRefs` with the historical chunk.
- Focused linked-record regression and default eval passed:
  `bun run test -- apps/runner/test/context-builder.test.ts -t "linked inventory refs"`
  and `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  (39 scenarios / 97 variants, `scenarioChecks=60/0`).

Fresh explicit contentSha256 source chunk retrieval:

- Added task-time source chunk retrieval by explicit 64-character
  `contentSha256` hints. When a task brief carries a hash from previous source
  chunk evidence, ContextPack can select the matching bounded source chunk
  without relying on snippet terms, route labels, or broad same-file matching.
- Selected chunks render `Matched Content SHA-256` for auditability, but remain
  source-ref-backed `code_probe` sections: source refs still cite the inventory
  artifact and underlying source-file lines, and the hash is not emitted as a
  source ref or raw inventory context.
- Added focused ContextPack coverage and a default deterministic eval variant
  that selects the refund source chunk by hash, excludes an unrelated hashed
  Orders chunk, and verifies raw inventory JSON is not rendered.
- Focused hash-hint regression, runner typecheck, and default eval passed:
  `bun run test -- apps/runner/test/context-builder.test.ts -t "contentSha256 task hint"`,
  `bun run --filter @ainp/runner typecheck`, and
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  (39 scenarios / 98 variants, `scenarioChecks=60/0`).

Fresh historical contentSha256 source chunk retrieval coverage:

- Extended explicit `contentSha256` source chunk retrieval coverage to the
  no-current-inventory path. Accepted `project_inventory:latest` knowledge
  artifacts now have focused and default eval coverage proving the same hash
  hint can recover bounded historical source evidence.
- The selected historical source chunk carries `knowledge_artifact:*`, the
  original inventory artifact ref, and source-file refs while excluding raw
  inventory JSON, ordinary `knowledge_*` rendering, and unrelated hashed
  chunks.
- Focused historical hash-hint regression and default eval passed:
  `bun run test -- apps/runner/test/context-builder.test.ts -t "historical inventory source chunks by explicit contentSha256"`
  and `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  (39 scenarios / 99 variants, `scenarioChecks=60/0`).

Fresh contentSha256 current-first dedupe:

- Added current-first suppression for explicit `contentSha256` source chunk
  hints. When a hash matches both current-run inventory and accepted historical
  inventory, ContextPack selects the current source chunk and suppresses the
  historical duplicate for that hash.
- Historical inventory remains the fallback when no current chunk matches. The
  change only applies to explicit hash-hint source chunk matches; ordinary
  historical capability/symbol/source evidence selection is unchanged.
- Added focused ContextPack coverage and a default deterministic eval variant
  proving current-run hash evidence wins, historical duplicate sections and
  `knowledge_*` rendering stay out, and source refs cite only the current
  inventory artifact/source line.
- Focused current-first regression, runner typecheck, and default eval passed:
  `bun run test -- apps/runner/test/context-builder.test.ts -t "prefers current inventory source chunks"`,
  `bun run --filter @ainp/runner typecheck`, and
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  (39 scenarios / 100 variants, `scenarioChecks=60/0`).

Fresh exact-line source-ref hybrid supplement eval:

- Promoted the exact-line source-ref hybrid supplement behavior into the
  default deterministic legacy understanding scenario. The new variant proves a
  matched `Billing Statements API` capability stays primary while
  `file:apps/api/src/domain.ts#L77` adds the source-ref-backed symbol graph
  edge and its pointed source chunk.
- Added a paired path-only negative variant proving
  `file:apps/api/src/domain.ts` does not add an unrelated same-file hybrid
  record or unrelated same-file source chunk. The scenario
  `contextQualityGates.measuredVariantsMin` now requires the added measured
  coverage.
- Focused default-scenario eval and ContextPack regression passed:
  `bun run test -- apps/runner/test/context-builder.test.ts -t
  "path-only source hints|source refs add hybrid graph evidence"`,
  `bun run test -- apps/runner/test/context-builder.test.ts`,
  `bun run typecheck`, and
  `bun run eval -- --scenario-dir <temp-dir-containing-legacy-project-understanding.json>`
  (1 scenario / 19 variants, `scenarioChecks=3/0`).

Fresh correction superseded-signal implementation:

- Extended accepted, non-review-required capability-map rename/merge drift
  handling. When the corrected old `capabilityId` is absent from the current
  inventory but the current scan already contains a capability whose display
  label matches the correction's corrected label or merge target, ContextPack
  now emits a `superseded` / `review_required` calibration signal instead of a
  stale-only signal.
- The signal cites the correction artifact, old capability id, current
  matching capability id, current inventory/source refs, and original
  correction inventory/source refs. It does not apply the old correction to the
  current capability or attach correction source refs/review text to selected
  current inventory sections.
- Added focused ContextPack regression coverage for both rename
  `correctedLabel` and merge `mergeTarget` convergence, and added the default
  deterministic eval variant
  `accepted-correction-converged-label-superseded-signal`.
- Trellis check found and fixed a drift blind spot: a valid fresh inventory
  with an empty `capabilities` array now still emits stale review signals for
  accepted corrections whose old capability id is absent.
- Eval expectations were tightened so the superseded variant proves
  section-local source refs on the selected Fulfillment capability, and the
  monolith billing scenario treats graph-selected billing repository chunks as
  relevant evidence.
- Verification passed:
  `bun run test -- apps/runner/test/context-builder.test.ts -t "superseded review signals"`,
  `bun run test -- apps/runner/test/context-builder.test.ts -t "stale review signal|superseded review signals"`,
  `bun run test -- apps/runner/test/context-builder.test.ts`,
  `bun run --filter @ainp/runner typecheck`,
  `bun run eval -- --scenario-dir eval/scenarios`
  (39 scenarios / 104 variants / 60 scenario checks),
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`,
  JSON validation for touched eval scenario files,
  and `git diff --check -- <touched files>`.

Fresh correction ambiguity-signal implementation:

- Tightened accepted, non-review-required capability-map rename/merge drift
  handling for duplicate governed labels. When the old `capabilityId` is
  absent from the current inventory and the correction's corrected label or
  merge target matches more than one current capability display label,
  ContextPack now emits a `conflict` / `review_required` calibration signal
  instead of choosing the first deterministic label match as superseded.
- The ambiguity signal cites the correction artifact, missing old capability
  id, every matching current capability id/source ref, the current inventory
  artifact, and the original correction inventory/source evidence. Selected
  current capability sections continue to omit the old correction artifact,
  old capability ref, source refs, and review text.
- Added focused ContextPack regression coverage and the default deterministic
  eval variant
  `accepted-correction-ambiguous-converged-label-conflict-signal`. The existing
  single-label superseded and no-label stale cases remain covered separately.
- Updated the shared Context Injection Protocol so future ContextPack changes
  preserve the exact normalized-label split: no match is stale, one match is
  superseded, and multiple matches are conflict review evidence only.
- Verification passed:
  `bun run test -- apps/runner/test/context-builder.test.ts -t "conflict signal when an accepted correction label matches multiple current capabilities|superseded review signals|stale review signal"`,
  `bun run test -- apps/runner/test/context-builder.test.ts`,
  `bun run --filter @ainp/runner typecheck`,
  `bun run typecheck`,
  `bun run test` (107 test files / 1091 tests),
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`,
  `python3 -m json.tool eval/scenarios/legacy-project-understanding.json > /dev/null`,
  `git diff --check -- <touched files>`, and
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  (39 scenarios / 105 variants, `scenarioChecks=60/0`).

Fresh V1.1/V1.2/V1.3 Yii URL manager route coverage:

- Added conservative Yii/Yii2 URL manager scanning for common PHP config paths
  such as `config/web.php`, `config/main.php`, `frontend/config/main.php`,
  `backend/config/main.php`, and `protected/config/main.php`.
- The scanner accepts only static literal evidence: string-map rules such as
  `'billing/statements' => 'billing/statement/index'` and array-style rules
  with literal `pattern` / `route` values. Leading HTTP verbs in patterns and
  literal `verb` / `verbs` rule values calibrate methods when present.
- Yii route targets map to handler evidence such as
  `Yii:BillingRefundController@actionApprove`, then resolve to scanned PHP
  controller/action symbols when the expected controller file exists. Existing
  PHP constructed-receiver evidence supplies the controller -> service ->
  repository graph chain.
- Nonliteral route targets and runtime Yii behavior remain out of scope:
  modules, callbacks, imports, DI/container wiring, dynamic URL rules, and
  arbitrary Yii runtime routing are not inferred.
- Added focused scanner regression coverage for billing string-map and
  array-style Yii rules, source refs, route-handler edges, service/repository
  symbol-reference edges, customer sibling route detection, and nonliteral rule
  exclusion:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "static Yii"`.
- Added default scanner-to-ContextPack e2e eval coverage in
  `eval/scenarios/legacy-project-understanding-yii-e2e.json`, proving billing
  Yii route evidence, attached tests, graph-backed source chunks, raw inventory
  exclusion, and no leakage from the unrelated customer route/test.
- Verification passed:
  `python3 -m json.tool eval/scenarios/legacy-project-understanding-yii-e2e.json > /dev/null`,
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "static Yii"`,
  `bun run --filter @ainp/runner typecheck`,
  and `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  (40 scenarios / 106 variants, `scenarioChecks=62/0`).

Fresh V1.1/V1.2/V1.3 Zend Framework 1 route coverage:

- Added conservative Zend Framework 1 `application.ini` route scanning for
  static `resources.router.routes.*` entries in common config paths such as
  `application/configs/application.ini`, `application/config/application.ini`,
  `config/application.ini`, and `configs/application.ini`.
- The scanner accepts only literal INI evidence: route path,
  `defaults.controller`, `defaults.action`, and optional literal
  `reqs.method` / `reqs._method`. Dynamic route values, wildcard routes,
  custom route classes, plugins, DI/container wiring, and runtime route tables
  remain out of scope.
- Zend route targets map to handler evidence such as
  `Zend:BillingRefundController@approveAction`, then resolve to scanned PHP
  controller/action symbols when the expected controller file exists. Existing
  PHP constructed-receiver evidence supplies the controller -> service ->
  repository graph chain.
- Added focused scanner regression coverage for static Zend INI route
  resources, source refs, route-handler edges, explicit service/repository
  symbol-reference edges, customer sibling route detection, and dynamic route
  exclusion:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "Zend Framework"`.
- Added default scanner-to-ContextPack e2e eval coverage in
  `eval/scenarios/legacy-project-understanding-zend-e2e.json`, proving billing
  Zend route evidence, attached tests, graph-backed source chunks, raw
  inventory exclusion, and no leakage from the unrelated customer route/test.
- Focused verification passed:
  `python3 -m json.tool eval/scenarios/legacy-project-understanding-zend-e2e.json > /dev/null`,
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "Zend Framework"`,
  and focused Zend eval via a one-scenario temp scenario directory
  (1 scenario / 1 variant, `scenarioChecks=3/0`).
- Broader verification also passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts`,
  `bun run --filter @ainp/runner typecheck`, `bun run typecheck`,
  `bun run test` (107 test files / 1093 tests), and
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  (41 scenarios / 107 variants, `scenarioChecks=65/0`).

Fresh V1.1/V1.2/V1.3 Drupal 7 hook_menu route coverage:

- Added conservative Drupal 7 `.module` scanning for static `hook_menu()`
  definitions with literal `$items['...'] = array(...)` menu paths and literal
  `page callback` function values.
- `.module` files now participate in PHP-like source scanning, heuristic
  symbol extraction, PHP import evidence, and explicit constructed receiver
  graph extraction. This lets `Drupal:billing_refund_approve` route-handler
  evidence resolve to the same-file callback function and continue through
  explicit `new BillingRefundService()` / repository calls.
- Dynamic callback values, dynamic form ids, menu loaders, access callbacks,
  includes, module weights, DI/container wiring, and Drupal runtime route maps
  remain out of scope.
- Added focused scanner regression coverage for static Drupal menu routes,
  source refs, route-handler edges, explicit service/repository
  symbol-reference edges, customer sibling route detection, and dynamic
  callback exclusion:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "Drupal"`.
- Added default scanner-to-ContextPack e2e eval coverage in
  `eval/scenarios/legacy-project-understanding-drupal-e2e.json`, proving
  billing Drupal route evidence, attached tests, graph-backed source chunks,
  raw inventory exclusion, and no leakage from the unrelated customer route or
  dynamic callback.
- Focused verification passed:
  `python3 -m json.tool eval/scenarios/legacy-project-understanding-drupal-e2e.json > /dev/null`,
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "Drupal"`,
  and focused Drupal eval via a one-scenario temp scenario directory
  (1 scenario / 1 variant, `scenarioChecks=3/0`).
- Broader verification also passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts`,
  `bun run --filter @ainp/runner typecheck`, `bun run typecheck`,
  `bun run test` (107 test files / 1094 tests),
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`,
  `python3 -m json.tool eval/scenarios/legacy-project-understanding-drupal-e2e.json > /dev/null`,
  `git diff --check -- <touched files>`, trailing-whitespace scan, and
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  (42 scenarios / 108 variants, `scenarioChecks=68/0`).

Fresh Drupal 7 `drupal_get_form` static form route coverage:

- Extended Drupal `hook_menu()` scanning so literal
  `'page callback' => 'drupal_get_form'` menu items resolve through the first
  literal `page arguments` entry, producing handler evidence such as
  `Drupal:billing_refund_approve_form` instead of stopping at
  `Drupal:drupal_get_form`.
- The route -> form function graph edge can now continue through explicit PHP
  constructed service/repository calls inside the form function. Dynamic form
  ids such as `array($dynamic_form_id)` remain excluded.
- Added focused scanner regression coverage for static Drupal form routes,
  source refs, route-handler edges, service/repository symbol-reference edges,
  customer form sibling detection, dynamic form id exclusion, and no raw
  `Drupal:drupal_get_form` handler exposure:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "Drupal"`.
- Added default scanner-to-ContextPack e2e eval coverage in
  `eval/scenarios/legacy-project-understanding-drupal-form-e2e.json`, proving
  billing form route evidence, attached form tests, graph-backed source
  chunks, raw inventory exclusion, and no leakage from the unrelated customer
  form route/test or dynamic form id.
- Focused verification passed:
  `python3 -m json.tool eval/scenarios/legacy-project-understanding-drupal-form-e2e.json > /dev/null`,
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "Drupal"`,
  and focused Drupal form eval via a one-scenario temp scenario directory
  (1 scenario / 1 variant, `scenarioChecks=3/0`).
- Broader verification also passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts`,
  `bun run --filter @ainp/runner typecheck`, `bun run typecheck`,
  `bun run test` (107 test files / 1095 tests),
  `python3 -m json.tool eval/scenarios/legacy-project-understanding-drupal-form-e2e.json > /dev/null`,
  and `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  (43 scenarios / 109 variants, `scenarioChecks=71/0`).

Fresh V1.1/V1.2/V1.3 WordPress plugin action hook coverage:

- Added conservative WordPress plugin scanning for static `add_action(...)`
  calls whose hook names are literal `admin_post_*`, `admin_post_nopriv_*`,
  `wp_ajax_*`, or `wp_ajax_nopriv_*` values and whose callbacks are literal
  function names or static class callbacks.
- The scanner emits source-ref backed routes such as
  `/wp-admin/admin-post.php?action=billing_refund_approve` and maps them to
  handler evidence such as `WordPress:billing_refund_approve_admin_post` or
  `WordPress:BillingRefundAjaxController@status`. Callback functions and
  static class methods resolve into route-handler graph edges and continue
  through explicit PHP constructed service/repository calls.
- Capability grouping now recognizes `?action=` route values and derives the
  business label from the action token, so WordPress hooks such as
  `billing_refund_approve` group under `Billing API` instead of generic
  `Wp Admin API`.
- Dynamic hook names, dynamic callbacks, instance callbacks, shortcodes,
  includes, plugin load order, nonce/capability checks, DI/container wiring,
  and WordPress runtime dispatch remain out of scope.
- Added focused scanner regression coverage for admin-post and AJAX hooks,
  source refs, capability labels, route-handler edges, service/repository
  symbol-reference edges, sibling customer hook detection, and dynamic hook /
  callback exclusion:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "WordPress"`.
- Added default scanner-to-ContextPack e2e eval coverage in
  `eval/scenarios/legacy-project-understanding-wordpress-e2e.json`, proving
  billing admin-post route evidence, attached tests, graph-backed source
  chunks, raw inventory exclusion, and no leakage from sibling billing status
  AJAX, customer AJAX, or dynamic hook/callback values.
- Focused verification passed:
  `python3 -m json.tool eval/scenarios/legacy-project-understanding-wordpress-e2e.json > /dev/null`,
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "WordPress"`,
  and focused WordPress eval via a one-scenario temp scenario directory
  (1 scenario / 1 variant, `scenarioChecks=3/0`).
- Broader verification also passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts`,
  `bun run --filter @ainp/runner typecheck`, `bun run typecheck`,
  `bun run test` (107 test files / 1096 tests),
  `python3 -m json.tool eval/scenarios/legacy-project-understanding-wordpress-e2e.json > /dev/null`,
  and `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  (44 scenarios / 110 variants, `scenarioChecks=74/0`).

Fresh V1.1/V1.2/V1.3 WordPress REST route coverage:

- Added conservative WordPress REST scanning for static
  `register_rest_route(...)` calls whose namespace, route path, callback, and
  method declarations are literal or known `WP_REST_Server::*` constant
  evidence.
- The scanner emits source-ref backed REST routes such as
  `/wp-json/billing/v1/refunds/(?P<id>\d+)/approve`, expands
  `WP_REST_Server::EDITABLE` into `POST`, `PUT`, and `PATCH`, maps literal
  function callbacks to `WordPress:<callback>` handler evidence, and maps
  static class callbacks to `WordPress:<Class>@<method>` handler evidence.
- REST callback functions and static class methods resolve into route-handler
  graph edges and continue through explicit PHP constructed
  service/repository calls. Dynamic namespace/path/callback values, instance
  callbacks, permission callbacks, includes, plugin load order,
  nonce/capability checks, DI/container wiring, and WordPress runtime dispatch
  remain out of scope.
- Added focused scanner regression coverage for REST route method expansion,
  source refs, `wp-json` capability-label noise reduction, route-handler
  edges, service/repository symbol-reference edges, sibling customer route
  detection, and dynamic REST value exclusion:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "WordPress"`.
- Added default scanner-to-ContextPack e2e eval coverage in
  `eval/scenarios/legacy-project-understanding-wordpress-rest-e2e.json`,
  proving billing REST route evidence, attached tests, graph-backed source
  chunks, raw inventory exclusion, and no leakage from sibling customer REST or
  dynamic REST values.
- Focused verification passed:
  `jq . eval/scenarios/legacy-project-understanding-wordpress-rest-e2e.json > /dev/null`,
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "WordPress"`,
  and focused WordPress REST eval via a one-scenario temp scenario directory
  (1 scenario / 1 variant, `scenarioChecks=3/0`).
- Broader verification also passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts`,
  `bun run --filter @ainp/runner typecheck`, `bun run typecheck`,
  `bun run test` (107 test files / 1097 tests),
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  (45 scenarios / 111 variants, `scenarioChecks=77/0`),
  `python3 .trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`,
  `git diff --check -- <touched files>`, and touched-file trailing whitespace
  scan.

Fresh V1.1/V1.2/V1.3 WordPress static class-callback coverage:

- Added static WordPress callback parsing for PHP array callbacks such as
  `[BillingRefundAjaxController::class, 'status']`,
  `array(BillingRefundRestController::class, 'cancelRefund')`, and
  `array('BillingRefundRestController', 'cancelRefund')`.
- The scanner emits `WordPress:<Class>@<method>` handler evidence for both
  `add_action(...)` hooks and `register_rest_route(...)` callbacks, resolves
  the unique scanned class method symbol, and continues through explicit PHP
  constructed service/repository calls.
- Dynamic callback variables such as `[$controller, 'status']`, `$this`
  callbacks, runtime container wiring, includes, plugin load order,
  permission callbacks, nonce/capability checks, and WordPress runtime dispatch
  remain out of scope.
- Added focused scanner regression coverage in
  `apps/runner/test/project-inventory.test.ts` for hook and REST static class
  callbacks, route-handler edges, service/repository symbol-reference edges,
  and dynamic callback-variable exclusion:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "WordPress"`.
- Added default scanner-to-ContextPack e2e eval coverage in
  `eval/scenarios/legacy-project-understanding-wordpress-class-callback-e2e.json`,
  proving billing class-method route evidence, attached tests, graph-backed
  source chunks, raw inventory exclusion, and no leakage from sibling customer
  routes or dynamic callback variables.
- Focused verification passed:
  `jq . eval/scenarios/legacy-project-understanding-wordpress-class-callback-e2e.json > /dev/null`,
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "WordPress"`,
  and focused WordPress class-callback eval via a one-scenario temp scenario
  directory (1 scenario / 1 variant, `scenarioChecks=3/0`).
- Broader verification also passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts`,
  `bun run --filter @ainp/runner typecheck`, `bun run typecheck`,
  `bun run test` (107 test files / 1097 tests),
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  (46 scenarios / 112 variants, `scenarioChecks=80/0`),
  `python3 .trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`,
  and `git diff --check -- <touched files>`.

Fresh V1.1/V1.3 Sinatra static block-route coverage:

- Added conservative Sinatra-style Ruby route scanning for files with explicit
  Sinatra evidence such as `require "sinatra/base"`, `< Sinatra::Base`,
  `Sinatra::Application`, or `register Sinatra`.
- Static `get/post/put/patch/delete/options/head "/path" do ... end` route
  blocks now produce source-ref backed HTTP route entrypoints with bounded
  block line refs. The generic Rails route matcher is suppressed for
  Sinatra-like route declaration lines, so rejected dynamic or wildcard
  Sinatra routes are not reintroduced as Rails-style routes.
- Inline Sinatra blocks intentionally do not emit route-handler graph edges or
  fake handler symbols. ContextPack receives the route block through capability
  and source chunk evidence, and Ruby service/repository files remain available
  through existing explicit constructed-receiver/source evidence.
- Dynamic route expressions, wildcard paths, interpolated paths, Rack mounts,
  runtime dispatch, middleware semantics, and handler inference for inline
  blocks remain out of scope.
- Added focused scanner regression coverage in
  `apps/runner/test/project-inventory.test.ts` for static Sinatra block
  routes, bounded source refs, capability labels, dynamic route exclusion, and
  wildcard route exclusion:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "Sinatra"`.
- Added default scanner-to-ContextPack e2e eval coverage in
  `eval/scenarios/legacy-project-understanding-sinatra-e2e.json`, proving
  billing route block/source chunk evidence, attached tests, raw inventory
  exclusion, and no leakage from sibling customer routes, dynamic route
  expressions, or wildcard routes.
- Focused verification passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "Sinatra"`
  and focused Sinatra eval via a one-scenario temp scenario directory
  (1 scenario / 1 variant, `scenarioChecks=2/0`).
- Broader verification also passed:
  `jq . eval/scenarios/legacy-project-understanding-sinatra-e2e.json > /dev/null`,
  `bun run test -- apps/runner/test/project-inventory.test.ts`
  (114 tests), `bun run --filter @ainp/runner typecheck`,
  `bun run typecheck`,
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  (47 scenarios / 113 variants, `scenarioChecks=82/0`),
  `bun run test` (107 test files / 1098 tests),
  `python3 .trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`,
  `git diff --check -- <touched files>`, and touched-file trailing whitespace
  scan.

Fresh V1.1/V1.2/V1.3 Rails legacy `match ... via:` route coverage:

- Added conservative Rails legacy `match "/path", to: "...#...", via: ...`
  route scanning. Static symbol, string, array, `%i[...]`, and `:all` `via`
  method evidence now expands into concrete HTTP methods or `ANY`.
- Rails `match` routes inherit existing static `scope "/prefix" do` prefixes,
  cite both scope and route source refs, map literal `to:` targets to
  controller action handler evidence, and reuse the existing Ruby
  controller/service/repository symbol graph chain.
- Missing `via`, dynamic route expressions, wildcard paths, constraints,
  block routes, runtime route inspection, and Rails autoload namespace
  inference remain out of scope.
- Added focused scanner regression coverage in
  `apps/runner/test/project-inventory.test.ts` for scoped Rails match routes,
  `via: :post`, `via: [:get, :post]`, `via: :all`, route-handler graph edges,
  no-`via` exclusion, dynamic route exclusion, and wildcard route exclusion:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "Rails match"`.
- Added default scanner-to-ContextPack e2e eval coverage in
  `eval/scenarios/legacy-project-understanding-rails-match-e2e.json`, proving
  billing match-route evidence, attached tests, route-handler graph evidence,
  explicit service/repository graph evidence, raw inventory exclusion, and no
  leakage from sibling customer routes, no-`via` routes, dynamic route
  expressions, or wildcard routes.
- Focused verification passed:
  `jq . eval/scenarios/legacy-project-understanding-rails-match-e2e.json > /dev/null`,
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "Rails match"`,
  and focused Rails match eval via a one-scenario temp scenario directory
  (1 scenario / 1 variant, `scenarioChecks=3/0`).
- Broader verification also passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts`
  (115 tests), `bun run --filter @ainp/runner typecheck`,
  `bun run typecheck`,
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  (48 scenarios / 114 variants, `scenarioChecks=85/0`),
  `bun run test` (107 test files / 1099 tests),
  `python3 .trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`,
  `git diff --check -- <touched files>`, and touched-file trailing whitespace
  scan.

Fresh V1.1/V1.2/V1.3 Rails static `root` route coverage:

- Added conservative Rails `root` route scanning for static
  `root to: "...#..."` and `root "...#..."` declarations. These emit
  source-ref backed `GET /` entrypoints, or scoped root routes such as
  `GET /billing` when an existing static `scope "/prefix" do` block applies.
- Rails root routes cite both route and scope source refs, map literal
  controller targets to route-handler graph evidence, and reuse the existing
  Ruby controller/service/repository symbol graph chain.
- Redirect roots, dynamic targets, block routes, runtime route inspection, and
  Rails autoload namespace inference remain out of scope.
- Added focused scanner regression coverage in
  `apps/runner/test/project-inventory.test.ts` for global and scoped Rails
  root routes, route-handler graph edges, redirect exclusion, and dynamic
  target exclusion:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "Rails root"`.
- Added default scanner-to-ContextPack e2e eval coverage in
  `eval/scenarios/legacy-project-understanding-rails-root-e2e.json`, proving
  billing root-route evidence, attached tests, route-handler graph evidence,
  explicit service/repository graph evidence, raw inventory exclusion, and no
  leakage from sibling customer, redirect, or dynamic root evidence.
- Focused verification passed:
  `jq . eval/scenarios/legacy-project-understanding-rails-root-e2e.json > /dev/null`,
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "Rails root"`,
  and focused Rails root eval via a one-scenario temp scenario directory
  (1 scenario / 1 variant, `scenarioChecks=3/0`).
- Broader verification also passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts`
  (116 tests), `bun run --filter @ainp/runner typecheck`,
  `bun run typecheck`,
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  (49 scenarios / 115 variants, `scenarioChecks=88/0`),
  `python3 .trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`,
  `git diff --check -- <touched files>`, line-anchored conflict scan, and
  touched-file trailing whitespace scan.

Fresh V1.1/V1.2/V1.3 Rails singular `resource` route coverage:

- Added conservative Rails singular `resource :name` route scanning. Static
  singular resources now emit source-ref backed RESTful entrypoints without
  `:id` segments and honor static `only:` / `except:` action filters under
  existing static `scope "/prefix" do` prefixes.
- Singular Rails resources map to conventional plural controller action
  evidence such as `AccountsController#update`, then reuse the existing Ruby
  controller/service/repository symbol graph chain.
- Dynamic resource names, runtime route inspection, and Rails autoload
  namespace inference remain out of scope.
- Added focused scanner regression coverage in
  `apps/runner/test/project-inventory.test.ts` for scoped singular resources,
  no-id route shapes, `only:` action filtering, route-handler graph edges, and
  dynamic resource exclusion:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "singular resource"`.
- Added default scanner-to-ContextPack e2e eval coverage in
  `eval/scenarios/legacy-project-understanding-rails-singular-resource-e2e.json`,
  proving billing singular resource route evidence, attached tests,
  route-handler graph evidence, explicit service/repository graph evidence,
  raw inventory exclusion, and no leakage from sibling customer or dynamic
  resource evidence.
- Focused verification passed:
  `jq . eval/scenarios/legacy-project-understanding-rails-singular-resource-e2e.json > /dev/null`,
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "singular resource"`,
  and focused Rails singular resource eval via a one-scenario temp scenario
  directory (1 scenario / 1 variant, `scenarioChecks=3/0`).
- Broader verification also passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts`
  (117 tests), `bun run --filter @ainp/runner typecheck`,
  `bun run typecheck`,
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  (50 scenarios / 116 variants, `scenarioChecks=91/0`),
  `python3 .trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`,
  `git diff --check -- <touched files>`, line-anchored conflict scan, and
  touched-file trailing whitespace scan.

Fresh V1.1/V1.2/V1.3 Rails legacy hashrocket route target coverage:

- Added conservative Rails hashrocket target parsing for explicit static
  route targets such as `get "/path" => "controller#action"` and
  `match "/path" => "controller#action", via: :post`.
- Hashrocket route targets now map to the same controller action handler
  evidence as `to:` routes, cite existing scope and route source refs, and
  reuse the Ruby controller/service/repository symbol graph chain.
- Hashrocket `match` routes still require static `via` method evidence.
  No-`via` hashrocket matches, dynamic targets, redirects, implicit route
  targets, runtime route inspection, and Rails autoload namespace inference
  remain out of scope.
- Added focused scanner regression coverage in
  `apps/runner/test/project-inventory.test.ts` for static hashrocket
  `get` routes, hashrocket `match ... via:` routes, route-handler graph
  edges, and no-`via` hashrocket match exclusion:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "hashrocket"`.
- Added default scanner-to-ContextPack e2e eval coverage in
  `eval/scenarios/legacy-project-understanding-rails-hashrocket-e2e.json`,
  proving billing hashrocket route evidence, attached tests, route-handler
  graph evidence, explicit service/repository graph evidence, raw inventory
  exclusion, and no leakage from sibling customer or no-`via` hashrocket route
  evidence.
- Focused verification passed:
  `jq . eval/scenarios/legacy-project-understanding-rails-hashrocket-e2e.json > /dev/null`,
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "hashrocket"`,
  and focused Rails hashrocket eval via a one-scenario temp scenario directory
  (1 scenario / 1 variant, `scenarioChecks=3/0`).
- Broader verification also passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts`
  (118 tests), `bun run --filter @ainp/runner typecheck`,
  `bun run typecheck`,
  `bun run eval -- --scenario-dir eval/scenarios --out-dir .ainp/evals`
  (51 scenarios / 117 variants, `scenarioChecks=94/0`),
  `python3 .trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`,
  `git diff --check -- <touched files>`, line-anchored conflict scan, and
  touched-file trailing whitespace scan.

Fresh source-RAG readiness eval gates:

- Extended the legacy-project eval harness with source-RAG readiness metrics
  over scanner-real inventory output: valid source chunk `contentSha256`
  count, `sourceChunkIndex` entry/indexed chunk count, and linked
  inventory-record chunk count. Scenario-level `inventoryQualityGates` can now
  require coverage floors for those metrics without changing scanner output or
  ContextPack retrieval behavior.
- Added positive coverage to
  `eval/scenarios/legacy-project-understanding-e2e.json`, requiring all seven
  scanner-to-context variants to keep source chunks hashed, indexed, and linked
  to inventory records. The focused run reported 140/140 source chunks hashed,
  indexed, and linked across the scenario.
- Added
  `eval/scenarios-red/legacy-project-understanding-source-rag-readiness-gate.json`
  with an impossible source chunk index coverage floor. The red fixture exits
  non-zero on `inventoryQualityGates.sourceChunkIndexCoverageMin`, proving the
  new gate fails independently of route/framework fixture assertions.
- Updated the regression test plan so future real legacy-project corpus work
  keeps cross-run source retrieval anchors measurable instead of treating
  source chunks as unstructured fixture byproducts.
- Updated the runner eval-harness spec to document the new source-RAG
  readiness gate fields and red-fixture expectation.
- Focused positive eval passed:
  `bun run eval -- --scenario-dir <temp-dir-containing-legacy-project-understanding-e2e.json> --out-dir .ainp/evals-tmp-source-rag-positive`
  (1 scenario / 7 variants, `scenarioChecks=6/0`).
- Focused red eval failed as expected:
  `bun run eval -- --scenario-dir <temp-dir-containing-legacy-project-understanding-source-rag-readiness-gate.json> --out-dir .ainp/evals-tmp-source-rag-red`
  (1 scenario / 1 variant, `scenarioChecks=3/1`; failing check:
  `inventoryQualityGates.sourceChunkIndexCoverageMin`, expected `1.01`,
  actual `1`).
- JSON validation, runner typecheck, and whitespace checks passed:
  `jq . eval/scenarios/legacy-project-understanding-e2e.json > /dev/null`,
  `jq . eval/scenarios-red/legacy-project-understanding-source-rag-readiness-gate.json > /dev/null`,
  `bun run --filter @ainp/runner typecheck`, and
  `git diff --check -- <touched files>`.

Fresh Django tuple include URLConf coverage:

- Extended the Django URLConf scanner to recognize static tuple include forms
  such as `include(("billing.urls", "billing"), namespace="billing")` while
  keeping dynamic tuple module targets ignored.
- Tuple-mounted child routes continue through the existing mounted route path:
  the selected route cites both parent and child URLConf source refs, and
  route-handler graph evidence still resolves to the child `views.py` function
  symbol.
- Added focused regression coverage in
  `apps/runner/test/project-inventory.test.ts` for a static tuple include,
  dynamic tuple target exclusion, and source-ref backed route-handler graph
  evidence.
- Updated the scanner-to-ContextPack polyglot eval Django fixture to exercise
  the same static tuple include form while preserving its child route,
  ContextPack evidence expectations, and unrelated-domain exclusions.
- Verification passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "mounts static Django tuple include URLConfs"`,
  `bun test apps/runner/test/project-inventory.test.ts -t "captures stable docs"`,
  `bun run test -- apps/runner/test/project-inventory.test.ts` (120 tests),
  and `bun run --filter @ainp/runner typecheck`.

Fresh directory-backed legacy fixture input:

- Extended `legacy_project_understanding_fixture` so fixture source files can
  come from a checked-in `fixtureDir` as well as inline `files[]`. Relative
  fixture directories resolve against the scenario JSON file, are rejected if
  their real path escapes the repository root, recursively read only regular
  files in deterministic relative-path order, enforce max file count,
  per-file bytes, and total bytes, honor `excludePaths`, preserve relative
  paths in the temporary workspace, and merge with inline files before running
  the real `buildProjectInventory()` -> `buildContextPack()` path.
- Added `eval/fixtures/legacy-fixturedir-billing/` plus
  `eval/scenarios/legacy-project-understanding-fixturedir-e2e.json`. The
  scenario loads billing/customer source files from the fixture directory,
  merges an inline `package.json`, and asserts scanner-real billing
  route-handler/service/repository evidence, test evidence, source refs, and
  selected-section gates without selecting the sibling customer route or raw
  inventory JSON.
- Updated the eval harness spec, PRD, roadmap, task breakdown, and regression
  plan with the new `fixtureDir` contract and default scenario.
- Focused positive eval passed through a temp scenario directory under `eval/`:
  `bun run eval -- --scenario-dir <temp-dir-containing-legacy-project-understanding-fixturedir-e2e.json> --out-dir .ainp/evals-fixturedir`
  (1 scenario / 1 variant, `scenarioChecks=2/0`).

Fresh directory-backed legacy fixture red coverage:

- Added
  `eval/scenarios-red/legacy-project-understanding-fixturedir-path-escape.json`,
  which points `fixtureDir.path` outside the repository root and must fail
  during harness directory validation before scanner-to-ContextPack generation
  runs. This closes the prior positive-only `fixtureDir` coverage gap while
  keeping inline `files[]` compatibility unchanged.
- Updated the eval harness spec and regression test plan so future
  directory-backed legacy fixtures keep repository-root validation covered by a
  deterministic red scenario.
- Verification passed:
  `jq . eval/scenarios-red/legacy-project-understanding-fixturedir-path-escape.json > /dev/null`,
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`,
  `bun run --filter @ainp/runner typecheck`, and
  `git diff --check -- <touched files>`.
- Focused red eval failed for the intended reason:
  `bun run eval -- --scenario-dir <temp-dir-containing-only-legacy-project-understanding-fixturedir-path-escape.json> --out-dir <temp-dir>/out`
  exited `1` with
  `legacy fixtureDir.path escapes repository root: ../../..`.

Fresh directory-backed legacy fixture bounds red coverage:

- Added deterministic red fixtures for the remaining `fixtureDir` validation
  and budget paths:
  `legacy-project-understanding-fixturedir-not-directory.json`,
  `legacy-project-understanding-fixturedir-max-files.json`,
  `legacy-project-understanding-fixturedir-max-file-bytes.json`, and
  `legacy-project-understanding-fixturedir-max-total-bytes.json`.
- The new fixtures reuse the checked-in `legacy-fixturedir-billing` corpus (or
  a checked-in file inside it for the non-directory case), keep inline
  `files[]` compatibility untouched, and intentionally fail for the intended
  validation reason before scanner-to-ContextPack generation can run.
- Updated the eval harness spec and regression test plan so future red-suite
  expectations cover path escape, non-directory paths, file-count overflow,
  per-file byte overflow, and total-byte overflow.
- Verification passed:
  `jq . eval/scenarios-red/legacy-project-understanding-fixturedir-max-files.json eval/scenarios-red/legacy-project-understanding-fixturedir-max-file-bytes.json eval/scenarios-red/legacy-project-understanding-fixturedir-max-total-bytes.json eval/scenarios-red/legacy-project-understanding-fixturedir-not-directory.json > /dev/null`,
  `git diff --check -- <touched fixture/spec/task files>`,
  `bun run --filter @ainp/runner typecheck`, and
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.
- Focused red evals failed for the intended validation reasons:
  `legacy fixtureDir.path must be a directory`,
  `legacy fixtureDir exceeds maxFiles (1)`,
  `legacy fixtureDir file exceeds maxFileBytes`, and
  `legacy fixtureDir exceeds maxTotalBytes (100)`.

Fresh PHP constructor-injected interface receiver coverage:

- Extended the existing conservative constructor-injected receiver path to
  recognize PHP `__construct(...)` methods, normalize PHP `$param` names, and
  treat static `$this->field = $param` assignments as receiver evidence.
- The PHP path still requires an interface with exactly one scanned concrete
  implementation; it does not infer runtime containers, service strings, or
  dynamic bindings.
- Added focused Laravel-style regression coverage proving a controller action
  using `$this->workflow->approve(...)` links through the injected
  `BillingWorkflow` interface to `DatabaseBillingWorkflow.approve(...)` and on
  to repository graph evidence with source refs.
- Added negative Laravel-style regression coverage proving the same constructor
  injection path stays unresolved when the interface has multiple scanned
  implementations, even if static class-literal or string service bindings are
  present in a provider file.

Fresh NestJS TypeScript parameter-property receiver coverage:

- Extended TypeScript AST class-member receiver evidence so constructor
  parameter properties such as
  `constructor(private readonly workflow: BillingWorkflow) {}` and
  `constructor(private billingService: BillingService) {}` seed `this.<field>`
  receiver calls inside class methods.
- Imported concrete service classes continue through the existing
  import/export-backed symbol graph path. Interface-typed parameter properties
  resolve only through a single scanned concrete implementation class, matching
  the current conservative Java/C#/PHP constructor-injection boundary.
- The scanner still does not infer Nest providers, string tokens, decorators,
  modules, dynamic bindings, or runtime container wiring.
- Added focused NestJS regression coverage proving a decorated controller route
  links from route -> controller method -> unique implementation class ->
  method with source refs, a concrete class-typed parameter property links to
  the imported service class and method, and a negative ambiguous-interface
  case stays unresolved even when a Nest module provider hint names one
  implementation.
- Verification passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "NestJS parameter-property"`,
  `bun run test -- apps/runner/test/project-inventory.test.ts`,
  `bun run --filter @ainp/runner typecheck`,
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`,
  `git diff --check -- <touched files>`, and direct CR/trailing-whitespace
  scan over touched files.

Fresh Hapi route-array coverage:

- Extended conservative Hapi.js route scanning for the common static
  `server.route([{ ... }, { ... }])` array form while reusing the existing
  receiver guard for `Hapi.server(...)`, `new Hapi.Server(...)`, and direct
  `require("hapi").server(...)` construction evidence.
- Static array object entries now emit source-ref backed route entrypoints,
  preserve route -> handler graph evidence, and cite each object entry's own
  line instead of treating the surrounding array call as the only route source.
- Local `.route([...])` lookalikes remain ignored unless the receiver was
  already proven to be a Hapi server. Dynamic arrays, spread entries,
  non-object route variables, nested route factories, and runtime route tables
  remain out of scope.
- Added focused regression coverage proving two Hapi array object routes link
  to imported handler symbols and a fake route-array receiver does not create
  ghost route evidence.
- Updated `eval/scenarios/legacy-project-understanding-hapi-e2e.json` so the
  scanner-real Hapi ContextPack fixture registers billing, customer, and
  reports routes through `server.route([{ ... }, { ... }])` while preserving
  the existing domain-focused selection and sibling-domain rejection checks.
- Verification passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "Hapi route arrays"`,
  `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`,
  `bun run --filter @ainp/runner typecheck`,
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`,
  `git diff --check -- <touched files>`, direct CR/trailing-whitespace/debug
  scan over touched files, and a focused Hapi scanner-to-ContextPack eval
  copied into a temporary scenario directory (1 scenario / 3 variants,
  `scenarioChecks=2/0`).

Fresh historical sourceChunkIndex source-ref coverage:

- Extended ContextPack source chunk matching so source refs merged from a
  historical inventory `sourceChunkIndex` entry can satisfy explicit
  `file:...#Lx` task hints, even when the chunk range starts after the hinted
  source line and no selected inventory record has direct `sourceChunkRefs`.
- The selected chunk still renders only as bounded `code_probe` source
  evidence, keeps raw historical inventory JSON out of normal knowledge/input
  context, and excludes unrelated chunks.
- Added focused regression coverage in
  `apps/runner/test/context-builder.test.ts` and default eval coverage in
  `eval/scenarios/legacy-project-understanding.json`.
- Verification passed:
  `bun run test -- apps/runner/test/context-builder.test.ts -t "selects historical source chunk index evidence from explicit source refs"`,
  `bun run test -- apps/runner/test/context-builder.test.ts -t "historical source chunk index"`,
  `bun run test -- apps/runner/test/context-builder.test.ts` (73 tests),
  `bun run --filter @ainp/runner typecheck`,
  `jq empty eval/scenarios/legacy-project-understanding.json`, a focused
  legacy-project-understanding eval copied into a temporary scenario directory
  (1 scenario / 22 variants, `scenarioChecks=3/0`), the default eval suite
  against `eval/scenarios` with temporary output (53 scenarios / 120 variants,
  `scenarioChecks=106/0`),
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`,
  `git diff --check -- <touched files>`, direct debug/TS-suppression/CR/trailing
  whitespace scans over touched files, and LSP/tsc diagnostics for
  `apps/runner/src/context/builder.ts` and
  `apps/runner/test/context-builder.test.ts`.
- `trellis-check` was attempted through a Codex native subagent, but the local
  provider rejected `gpt-5.4-mini` with HTTP 404 before review. The effective
  check evidence is therefore the main-session spec read plus focused tests,
  typecheck, eval, static scans, and diagnostics above.

Fresh current-run source-ref duplicate precedence:

- Extended historical source chunk duplicate suppression so explicit
  `file:...#Lx` source-ref task hints prefer matching current-run inventory
  chunks over historical inventory chunks with the same chunk identity. This
  mirrors the existing current-run precedence for explicit `contentSha256`
  hints and keeps old source evidence from crowding out fresh scans.
- Added focused regression coverage in
  `apps/runner/test/context-builder.test.ts` and default eval coverage in
  `eval/scenarios/legacy-project-understanding.json`.
- Verification passed:
  `bun run test -- apps/runner/test/context-builder.test.ts -t "prefers current inventory source chunks over historical duplicates for source-ref hints"`,
  `bun run test -- apps/runner/test/context-builder.test.ts` (74 tests),
  `bun run --filter @ainp/runner typecheck`,
  `jq empty eval/scenarios/legacy-project-understanding.json`, a focused
  legacy-project-understanding eval copied into a temporary scenario directory
  (1 scenario / 23 variants, `scenarioChecks=3/0`), the default eval suite
  against `eval/scenarios` with temporary output (53 scenarios / 121 variants,
  `scenarioChecks=106/0`),
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`,
  `git diff --check -- <touched files>`, direct debug/TS-suppression/CR/trailing
  whitespace scans over touched files, and LSP/tsc diagnostics for
  `apps/runner/src/context/builder.ts` and
  `apps/runner/test/context-builder.test.ts`.
- A `trellis-check` Codex subagent was attempted with the default model path
  and read the Trellis check skill, PRD, eval/context specs, implementation,
  tests, and eval scenario. It did not report any findings before stalling
  without output; the residual subprocess was terminated. The effective check
  evidence is therefore the main-session verification listed above plus the
  partial independent review read-through.

Fresh current-run sourceChunkIndex metadata overlay:

- Extended ContextPack inventory parsing so governed historical
  `sourceChunkIndex` entries can overlay source refs and linked inventory refs
  onto matching current-run source chunks before source chunk ranking. Matching
  now uses stable chunk keys: `sourceChunkRef` / chunk id, exact
  `path:startLine:endLine`, hash+location, and linked inventory-record refs.
- This lets an explicit `file:...#Lx` task hint select the current-run bounded
  source chunk even when the current chunk itself lacks that source ref and the
  hinted line sits outside the chunk range, while still suppressing the
  historical duplicate and keeping raw historical inventory JSON out of normal
  context.
- Current-run source chunk sections cite the current inventory artifact before
  supplemental file/source refs, render as `code_probe`, and can show linked
  pointing evidence recovered from the historical index metadata.
- Added focused regression coverage in
  `apps/runner/test/context-builder.test.ts` and default eval coverage in
  `eval/scenarios/legacy-project-understanding.json`.
- Verification passed:
  `bun run test -- apps/runner/test/context-builder.test.ts -t "uses historical source chunk index refs as metadata"`,
  `jq empty eval/scenarios/legacy-project-understanding.json`, a focused
  legacy-project-understanding eval copied into a temporary scenario directory
  (1 scenario / 24 variants, `scenarioChecks=3/0`),
  `bun run test -- apps/runner/test/context-builder.test.ts` (75 tests), and
  `bun run --filter @ainp/runner typecheck`, `bun run typecheck`, the default eval suite against
  `eval/scenarios` with temporary output (53 scenarios / 122 variants,
  `scenarioChecks=106/0`),
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`,
  `git diff --check -- <touched files>`, direct debug/TS-suppression/CR/trailing
  whitespace scans over touched files, and LSP/tsc diagnostics for
  `apps/runner/src/context/builder.ts` and
  `apps/runner/test/context-builder.test.ts`.

Fresh capability-correction evidence durability:

- Extended project-page capability correction writes so draft governed
  knowledge artifacts now carry structured `evidenceRefs` and
  `inventoryRecordRefs` in addition to existing `sourceRefs`. The metadata
  preserves the inventory artifact id, capability id, entrypoint ids, symbol
  ids, test-surface ids, hotspot ids, and underlying source refs from the
  selected capability row.
- Extended ContextPack correction consumption so accepted, non-review-required
  capability correction `evidenceRefs` are merged into selected correction
  evidence and correction drift review signals. This keeps UI-submitted
  correction evidence traceable by inventory record id after the initial
  artifact write, without promoting draft corrections or rendering correction
  artifacts as standalone `knowledge_*` context.
- Added/strengthened focused regression coverage in
  `apps/web/test/projects-rendering.test.ts` and
  `apps/runner/test/context-builder.test.ts`.
- Verification passed:
  `bun run test -- apps/runner/test/context-builder.test.ts -t "accepted capability-map rename"`,
  `bun run test -- apps/web/test/projects-rendering.test.ts`,
  `bun x tsc -p apps/runner/tsconfig.json --noEmit && bun x tsc -p apps/web/tsconfig.json --noEmit`,
  `bun run test -- apps/runner/test/context-builder.test.ts apps/web/test/projects-rendering.test.ts apps/api/test/knowledge-artifacts-route.test.ts`
  (109 tests), `bun run typecheck`, and the default eval suite against
  `eval/scenarios` with temporary output (53 scenarios / 122 variants,
  `scenarioChecks=106/0`).

Fresh static WCF service-host evidence:

- Added static `.svc` `ServiceHost` directive extraction for legacy WCF
  projects. Host files such as `Services/BillingStatementService.svc` now
  produce source-ref backed `ANY /Services/BillingStatementService.svc`
  entrypoints when the `Service="..."` class value is static.
- WCF host entrypoints resolve to concrete service class symbols through a
  WCF-specific handler marker when the scanned service class match is unique,
  and stay grouped with the existing `[OperationContract]` service capability,
  so ContextPack can see the public service host path without creating a
  generic `Services API` capability.
- Extended the WCF scanner regression and scanner-to-ContextPack eval fixture
  to cover billing/customer `.svc` hosts, host route-handler graph edges, and
  unchanged focused selection for the billing operation.
- Deferred WCF endpoint/binding discovery from `web.config`, custom
  `Factory` attributes, dynamic `Service` values, DI/container wiring, and
  runtime service publication.
- Verification passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "WCF service contract"`,
  focused WCF eval copied into a temporary scenario directory (1 scenario / 1
  variant, `scenarioChecks=2/0`),
  `bun run test -- apps/runner/test/project-inventory.test.ts` (126 tests),
  `bun run --filter @ainp/runner typecheck`,
  `git diff --check -- <touched files>`, and
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.

Fresh Trellis-check WCF host follow-up:

- Fixed `.svc` `ServiceHost` extraction for static assembly-qualified service
  type names such as `Service="Namespace.Type, Assembly"` so the host handler
  resolves the service class name rather than the assembly suffix.
- Strengthened the WCF scanner regression so dynamic `Service` values do not
  create host entrypoints and ambiguous duplicate class names keep the host
  entrypoint source-backed but do not create unsafe route-handler graph edges.
- Fixed ContextPack multi-entrypoint focusing so an already-selected WCF
  capability keeps its `.svc` host entrypoint when the task explicitly mentions
  `.svc` or service-host work, without selecting sibling WCF service
  capabilities.
- Strengthened the scanner-to-ContextPack WCF eval fixture so the selected
  billing capability section must include the billing `.svc` host route and
  source ref while excluding the sibling customer host.
- Verification passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "WCF service contract"`,
  `bun run test -- apps/runner/test/context-builder.test.ts -t "WCF .svc host"`,
  and focused WCF eval copied into a temporary scenario directory (1 scenario /
  1 variant, `scenarioChecks=2/0`).

Fresh SQL/data-entity task-time evidence:

- Added conservative static SQL table detection for `.sql` files. Static
  `CREATE TABLE ...` statements now emit source-ref backed `table`
  `domainEntities`; dynamic SQL/runtime database inspection remains out of
  scope.
- Carried `domainEntityRefs` through matching capabilities, source chunks, and
  `sourceChunkIndex` entries so data-layer evidence can be selected through
  the same inventory/source-chunk ContextPack path as symbols/tests/hotspots.
- Extended ContextPack inventory parsing, capability search/rendering, hybrid
  retrieval, and source-chunk pointer rendering so business data terms such as
  `refund ledger` can select capability/domain/source-chunk `code_probe`
  evidence while generic `sql` / `schema` / `table` / model/entity terms are
  filtered and raw `project-inventory.json` remains excluded from normal
  context.
- Added focused regression and eval coverage proving SQL table evidence selects
  the intended billing data domain without leaking the sibling customer table.
- Verification passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`,
  focused eval copied into a temporary scenario directory
  (`legacy-project-understanding`, 1 scenario / 25 variants,
  `scenarioChecks=3/0`), and `bun run typecheck`.

Fresh source-ref backed data-layer table reference evidence:

- Added conservative static table-name usage links from scanned SQL table
  domain entities to source-like repository/service files through
  `referenceSourceRefs`.
- Carried those links into bounded source chunk anchors, `domainEntityRefs`,
  source chunk index entries, ContextPack source refs, and domain entity
  rendering so table-focused tasks can retrieve the code that queries the
  table, not only the schema definition.
- Kept the matching static and source-ref backed: exact table-name literals and
  SQL contexts only, no database inspection, ORM inference, or dynamic SQL
  reconstruction.
- Verification passed:
  `jq empty eval/scenarios/legacy-project-understanding.json`,
  `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  (2 files / 203 tests),
  focused eval copied into `/tmp/ainp-eval-table-ref-scenario`
  (1 scenario / 25 variants, `scenarioChecks=3/0`),
  `bun run typecheck`,
  `bun run test` (107 files / 1119 tests),
  `git diff --check -- <tracked touched files>`, and
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`.
- Extra note: native `bun test` is not the project test script and still fails
  two existing `context-builder.test.ts` content-hash assertions because Bun's
  matcher rejects `expect(undefined).not.toContain(...)`; the project Vitest
  script passes.

Fresh schema-qualified SQL table reference evidence:

- Extended the P5-12 static table-reference matcher so source-like non-test
  files link scanned SQL table domain entities when static SQL/text contains a
  schema-qualified table name whose final segment exactly matches the scanned
  table.
- Covered bare qualified SQL (`billing.refund_ledger_entries`), joined schema
  SQL (`public.refund_ledger_entries`), quoted identifiers
  (`"billing"."refund_ledger_entries"`), SQL Server bracket identifiers
  (`[billing].[refund_ledger_entries]`), and string literals containing a
  static qualified table name.
- Preserved the static-only boundary: suffix-only identifiers such as
  `archive_refund_ledger_entries`, dynamic schema expressions such as
  `${schema}.refund_ledger_entries`, and references in test files stay
  excluded.
- Updated ContextPack regression coverage so a schema-qualified repository SQL
  chunk remains selected through source-ref backed `domainEntityRefs` without
  sibling data-domain leakage.
- Tightened the scanner regression to assert the exact `referenceSourceRefs`
  list, so suffix-only, dynamic-schema, or test-file false positives cannot be
  hidden by subset-style matching.
- Verification passed:
  `jq empty eval/scenarios/legacy-project-understanding.json` and
  `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  (2 files / 204 tests), `bun run test` (107 files / 1120 tests),
  `bun run typecheck`,
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`,
  and `git diff --check` on the touched files.

Fresh static SQL foreign-key table relationship evidence:

- Added conservative static foreign-key relationship metadata between scanned
  SQL table domain entities. The scanner now recognizes static `.sql`
  `FOREIGN KEY (...) REFERENCES billing.refund_ledger_entries(id)` clauses and
  inline `REFERENCES refund_ledger_entries(id)` clauses inside already scanned
  `CREATE TABLE` statements.
- Kept the relationship source-ref backed and additive on existing table
  `domainEntities`: qualified table resolution uses captured schema names
  where available, unqualified references resolve only when the target is
  unique or uniquely matches the current table schema, and no DB inspection,
  ORM inference, or dynamic SQL reconstruction is attempted.
- Hardened the conservative parser to reject FK references with invalid SQL
  identifier parts or schema qualifiers that do not match the scanned table
  schema, avoiding table-name-only fallbacks that could create cross-schema
  false positives.
- Carried FK relationship source refs into bounded SQL source chunks and
  `sourceChunkIndex` `domainEntityRefs`, so a task that mentions either the
  referencing table or the referenced table can retrieve the relevant schema
  chunk through the existing `code_probe` path.
- Extended ContextPack domain-entity search/rendering to include explicit FK
  relationship names/source refs and to expand only directly related table
  records, preserving sibling-domain and raw inventory JSON exclusions.
- Verification passed for the new focused cases:
  `bun test apps/runner/test/project-inventory.test.ts --test-name-pattern "links static SQL foreign keys"` and
  `bun test apps/runner/test/context-builder.test.ts --test-name-pattern "uses static SQL foreign-key relationships"`.
  Project verification also passed with
  `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  (2 files / 206 tests), `bun run test` (107 files / 1122 tests), and
  `bun run typecheck`.
  A broader `bun test apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  run passed the inventory file and the new FK ContextPack test, but still
  failed three existing `context-builder.test.ts` source-chunk
  `contentSha256` / historical-index assertions unrelated to this FK slice.

Fresh static SQL join table relationship evidence:

- Added conservative source-ref backed join relationship metadata between
  scanned SQL table domain entities. The scanner now recognizes static
  `FROM billing.refund_ledger_entries ... JOIN billing.refund_audit_notes ...`
  SQL statements in source-like non-test files and `.sql` files.
- Kept the parser static-only and additive: scanned table resolution reuses the
  existing schema-qualified table identifier rules, test files are excluded,
  suffix-only names and dynamic schema expressions do not create join
  relationships, and no DB inspection, ORM inference, or dynamic SQL
  reconstruction is attempted.
- Extended ContextPack relationship parsing to accept `join` relationships and
  expanded focused capability domain-entity relation lookup against the full
  inventory table set, so a task that matches one side of a join can retrieve
  the directly joined table record and bounded query chunk.
- Carried join relationship source refs into source chunks and
  `sourceChunkIndex` `domainEntityRefs`, preserving source-ref backed
  `code_probe` evidence and raw inventory JSON exclusion.
- Verification passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "links static SQL joins"`,
  `bun run test -- apps/runner/test/context-builder.test.ts -t "uses static SQL join relationships"`,
  `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  (2 files / 208 tests), and `bun run typecheck`.

Fresh static SQL view dependency evidence:

- Added source-ref backed SQL view domain entities for static `.sql`
  `CREATE VIEW`, `CREATE OR REPLACE VIEW`, `CREATE OR ALTER VIEW`, and
  materialized-view declarations.
- Linked each scanned view to scanned table dependencies found through static
  `FROM` / `JOIN` identifiers in the view statement. Qualified, quoted, and
  bracketed table identifiers reuse the existing conservative SQL identifier
  rules; dynamic schema expressions and unresolved table names do not create
  dependency relationships.
- Carried view dependency source refs into both view and table
  `domainEntities`, bounded SQL source chunks, and `sourceChunkIndex`
  `domainEntityRefs`, preserving source-ref backed `code_probe` evidence.
- Extended ContextPack relationship parsing to accept `view_dependency`
  relationships, so a task that matches a business view can retrieve the view
  SQL and directly dependent table records without sibling data-domain leakage
  or raw inventory JSON.
- Verification passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  (2 files / 210 tests), `bun run typecheck`, `bun run test` (107 files /
  1126 tests), `python3 ./.trellis/scripts/task.py validate
  .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`, and
  `git diff --check` on the touched files.

Fresh P5-17 static SQL routine dependency evidence:

- Added source-ref backed SQL routine domain entities for static `.sql`
  `CREATE PROCEDURE`, `CREATE PROC`, and `CREATE FUNCTION` declarations,
  including conservative `CREATE OR REPLACE` procedure/function forms.
- Linked each scanned routine to scanned table dependencies found through
  static routine-body table references in `FROM`, `JOIN`, `UPDATE`,
  `INSERT INTO`, `DELETE FROM`, and `MERGE INTO` statements. Dynamic SQL string
  reconstruction, dynamic schema/table expressions, unresolved table names, and
  ambiguous unqualified table names remain out of scope.
- Carried routine dependency source refs into routine/table `domainEntities`,
  bounded SQL source chunks, and `sourceChunkIndex` `domainEntityRefs`,
  preserving source-ref backed `code_probe` evidence.
- Extended ContextPack relationship parsing to accept `routine_dependency`
  relationships, so a task that matches a business routine can retrieve the
  routine SQL and directly dependent table records without sibling data-domain
  leakage or raw inventory JSON.
- Verification passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  (2 files / 212 tests), `bun run typecheck`,
  `python3 ./.trellis/scripts/task.py validate
  .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`,
  tracked-file `git diff --check` for `apps/runner/src/context/builder.ts` and
  `apps/runner/test/context-builder.test.ts`, and no-index `git diff --check`
  diagnostics for the untracked touched scanner/test/task-doc files.

Fresh realistic directory-backed legacy corpus eval:

- Added a checked-in `fixtureDir` corpus for an old CommonJS/Express billing
  project with route/controller/service/repository/test layers, SQL
  table/view/routine evidence, and a sibling customer domain.
- Kept generated/vendor noise in the corpus while excluding it through
  `fixtureDir.excludePaths`, so the eval verifies directory filtering and
  focused ContextPack retrieval rather than relying on a handcrafted inventory.
- Added `legacy-project-understanding-directory-corpus-e2e.json` to the default
  eval scenario list with route entrypoint, capability label, symbol graph,
  SQL domain/routine source chunk, manifest prefix, source-ref include/exclude,
  inventory quality, and irrelevant-context ratio assertions.
- Verification passed:
  focused eval copied into a temporary scenario directory (1 scenario / 1
  variant, `scenarioChecks=6/0`) and
  `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  (2 files / 212 tests), `jq empty` for the new scenario JSON, tracked-file
  `git diff --check`, and no-index `git diff --check` diagnostics for the new
  untracked scenario/fixture files.

Fresh multi-domain Symfony directory-backed legacy corpus eval:

- Added a second checked-in `fixtureDir` corpus for an old Symfony-style
  commerce project with static YAML routing, billing/orders/customers
  controller/service/repository layers, SQL schema/routine evidence, and
  attached tests.
- Kept generated/vendor/cache noise in the corpus while excluding it through
  `fixtureDir.excludePaths`, and kept a tracked credential-like fixture to
  verify the scanner still records safe sensitive-file exclusion evidence.
- Added
  `legacy-project-understanding-symfony-directory-corpus-e2e.json` to the
  default eval scenario list with route entrypoint, capability label, symbol
  graph, SQL domain/routine source chunk, manifest prefix, source-ref
  include/exclude, inventory quality, and irrelevant-context ratio assertions.
- Used section-local `selectedSectionsInclude` gates for the billing
  capability, SQL domain entities, routine source chunk, symbols, and tests,
  including explicit exclusions for orders, customers, vendor, tmp, and cache
  paths.
- Verification passed: `jq empty` for the new scenario JSON; a focused eval
  copied into a repository-local temporary scenario/fixture directory (1
  scenario / 1 variant, `scenarioChecks=6/0`);
  `bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`
  (2 files / 212 tests); `bun run typecheck`;
  `python3 ./.trellis/scripts/task.py validate
  .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`; and
  touched-file control-character/trailing-whitespace checks. This remains
  deterministic scanner-real fixture coverage, not a claim that V2 real
  embeddings, cross-run RAG, or broad real-project corpus coverage is complete.

Fresh directory-backed source-RAG readiness tightening:

- Tightened both checked-in directory-backed legacy corpus scenarios so their
  scanner-real inventories must now produce full source chunk `contentSha256`
  coverage, full `sourceChunkIndex` coverage, and full linked
  inventory-record coverage before the scenarios pass.
- This turns the two larger corpus fixtures into stronger V2 pre-RAG gates:
  route/capability/domain checks are no longer enough if source chunk anchors
  needed by later cross-run retrieval silently disappear.
- Verification passed: `jq empty` for both tightened scenario JSON files; a
  focused eval copied into a repository-local temporary scenario/fixture
  directory (2 scenarios / 2 variants, `scenarioChecks=18/0`); the default eval
  suite (55 scenarios / 125 variants, `scenarioChecks=124/0`);
  `bun run test -- apps/runner/test/project-inventory.test.ts
  apps/runner/test/context-builder.test.ts` (2 files / 212 tests);
  `bun run typecheck`; `python3 ./.trellis/scripts/task.py validate
  .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`; and
  touched-file trailing-whitespace/control-character checks. The repo has no
  root `lint` script, so lint was not run for this JSON/Markdown-only slice.
- Full native `bun test` initially still failed on three
  `apps/runner/test/context-builder.test.ts` source-chunk/contentSha256
  assertions because Bun's native asymmetric matcher mutates a matched
  `sourceRefs` field when `toMatchObject` receives `expect.arrayContaining`.
  The test now copies the real source-ref array before matcher assertions, so
  the same source-ref coverage remains in place while the native Bun suite can
  validate the source-RAG anchor path.

Fresh source chunk Bun test compatibility fix:

- Updated the ContextPack source chunk `contentSha256` and historical
  `sourceChunkIndex` tests to assert copied `sourceRefs` arrays instead of
  reading a section field after Bun's asymmetric matcher has mutated it.
- Verification passed: native focused `bun test
  apps/runner/test/context-builder.test.ts -t
  'contentSha256|historical source chunk index'` (5 tests), Vitest
  `bun run test -- apps/runner/test/context-builder.test.ts` (81 tests), full
  native `bun test` (1134 tests), `bun run typecheck`, and the default eval
  suite (55 scenarios / 125 variants, `scenarioChecks=124/0`).

Fresh directory-backed Rails legacy corpus eval:

- Added a third checked-in `fixtureDir` corpus for an old Rails-style commerce
  project with static `config/routes.rb`, billing/orders/customers namespaced
  controller/service/repository layers, SQL schema/routine evidence, and
  attached tests.
- Kept generated/vendor/log noise in the corpus while excluding it through
  `fixtureDir.excludePaths`, and kept a tracked credential-like fixture to
  verify sensitive-file exclusion evidence.
- Added `legacy-project-understanding-rails-directory-corpus-e2e.json` to the
  default eval scenario list with route entrypoint, capability label, symbol
  graph, SQL domain/routine evidence, manifest prefix, source-ref include/
  exclude, irrelevant-context ratio, source-RAG readiness, and corpus diversity
  assertions.
- Focused verification passed for the new scenario copied into a
  repository-local temporary scenario/fixture directory (1 scenario / 1
  variant, `scenarioChecks=9/0`). Default eval also passed with the new Rails
  corpus included (56 scenarios / 126 variants, `scenarioChecks=133/0`), along
  with `bun run typecheck`, clean full native `bun test` (1134 tests), and
  Trellis task validation.

Fresh directory-backed Django legacy corpus eval:

- Added a fourth checked-in `fixtureDir` corpus for an old Django-style
  commerce project with project URLConf `include(...)` mounts, billing/orders/
  customers `urls.py` files, Python view/service/repository layers, SQL
  schema/view/routine evidence, and attached tests.
- Kept generated/vendor/log noise in the corpus while excluding it through
  `fixtureDir.excludePaths`, and kept a tracked credential-like fixture to
  verify sensitive-file exclusion evidence.
- Added `legacy-project-understanding-django-directory-corpus-e2e.json` to the
  default eval scenario list with route entrypoint, capability label, symbol
  graph, SQL domain/routine evidence, manifest prefix, source-ref include/
  exclude, irrelevant-context ratio, source-RAG readiness, and corpus diversity
  assertions.
- Focused verification passed for the new scenario copied into a
  repository-local temporary scenario/fixture directory (1 scenario / 1
  variant, `scenarioChecks=9/0`). The scanner-real output measured 3
  capabilities, 3 route entrypoints, 18 symbols, 15 graph edges, 20 source
  chunks, full source-RAG readiness coverage, 4 source file extensions, 8 path
  patterns, and 16 record kinds.
- Default eval passed with the new Django corpus included (57 scenarios / 127
  variants, `scenarioChecks=142/0`), along with `bun run typecheck`, clean
  full native `bun test` (1134 tests), Trellis task validation, JSON syntax
  validation, and touched-file whitespace checks. The repo has no root `lint`
  script, so no lint command was available to run.

Fresh directory-backed Laravel legacy corpus eval:

- Added a fifth checked-in `fixtureDir` corpus for an old Laravel-style
  commerce project with static `Route::controller(...)->prefix(...)->group(...)`
  route groups, billing/orders/customers PHP controller/service/repository
  layers, SQL schema/view/routine evidence, and attached tests.
- Kept generated/vendor/log noise in the corpus while excluding it through
  `fixtureDir.excludePaths`, and kept a tracked credential-like fixture to
  verify sensitive-file exclusion evidence.
- Added `legacy-project-understanding-laravel-directory-corpus-e2e.json` to
  the default eval scenario list with route entrypoint, capability label,
  symbol graph, SQL domain/routine evidence, manifest prefix, source-ref
  include/exclude, irrelevant-context ratio, source-RAG readiness, and corpus
  diversity assertions.
- Focused verification passed for the new scenario copied into a
  repository-local temporary scenario/fixture directory (1 scenario / 1
  variant, `scenarioChecks=9/0`). The scanner-real output measured 3
  capabilities, 3 route entrypoints, 21 symbols, 15 graph edges, 17 source
  chunks, full source-RAG readiness coverage, 4 source file extensions, 6 path
  patterns, and 18 record kinds.
- Default eval passed with the new Laravel corpus included (58 scenarios / 128
  variants, `scenarioChecks=151/0`), along with `bun run typecheck`, clean
  full native `bun test` (1134 tests), Trellis task validation, JSON syntax
  validation, and touched-file whitespace checks. The repo has no root `lint`
  script, so no lint command was available to run.

Fresh directory-backed Spring legacy corpus eval:

- Added a sixth checked-in `fixtureDir` corpus for an old Spring-style
  commerce project with static annotation routes across billing/orders/
  customers controllers, Java controller/service/repository layers, SQL
  schema/view/routine evidence, and attached tests.
- Kept generated target/vendor/log noise in the corpus while excluding it
  through `fixtureDir.excludePaths`, and kept a tracked credential-like
  fixture to verify sensitive-file exclusion evidence.
- Added `legacy-project-understanding-spring-directory-corpus-e2e.json` to
  the default eval scenario list with route entrypoint, capability label,
  symbol graph, SQL domain/routine evidence, manifest prefix, source-ref
  include/exclude, irrelevant-context ratio, source-RAG readiness, and corpus
  diversity assertions.
- Focused verification passed for the new scenario copied into a
  repository-local temporary scenario/fixture directory (1 scenario / 1
  variant, `scenarioChecks=9/0`). The scanner-real output measured 3
  capabilities, 6 route entrypoints, 24 symbols, 15 graph edges, 16 source
  chunks, full source-RAG readiness coverage, 4 source file extensions, 4 path
  patterns, and 16 record kinds.
- Default eval passed with the new Spring corpus included (59 scenarios / 129
  variants, `scenarioChecks=160/0`), along with `bun run typecheck` and clean
  full native `bun test` (1134 tests).

Fresh directory-backed ASP.NET legacy corpus eval:

- Added a seventh checked-in `fixtureDir` corpus for an old ASP.NET-style
  commerce project with static attribute routes across billing/orders/
  customers controllers, C# controller/service/repository layers, SQL
  schema/view/routine evidence, and attached tests.
- Kept generated bin/obj/log noise in the corpus while excluding it through
  `fixtureDir.excludePaths`, and kept a tracked credential-like fixture to
  verify sensitive-file exclusion evidence.
- Added `legacy-project-understanding-aspnet-directory-corpus-e2e.json` to
  the default eval scenario list with route entrypoint, capability label,
  symbol graph, SQL domain/routine evidence, manifest prefix, source-ref
  include/exclude, irrelevant-context ratio, source-RAG readiness, and corpus
  diversity assertions.
- Focused verification passed for the new scenario copied into a
  repository-local temporary scenario/fixture directory (1 scenario / 1
  variant, `scenarioChecks=9/0`). The scanner-real output measured 3
  capabilities, 3 route entrypoints, 24 symbols, 15 graph edges, 16 source
  chunks, full source-RAG readiness coverage, 4 source file extensions, 5 path
  patterns, and 15 record kinds.
- Default eval passed with the new ASP.NET corpus included (60 scenarios / 130
  variants, `scenarioChecks=169/0`), along with `bun run typecheck` and clean
  full native `bun test` (1134 tests).

Fresh directory-backed Go legacy corpus eval:

- Added an eighth checked-in `fixtureDir` corpus for an old Go-style commerce
  project with static mux/http routes across billing/orders/customers handlers,
  Go handler/service/repository layers, SQL schema/view/routine evidence, and
  attached tests.
- Kept generated vendor/tmp/log noise in the corpus while excluding it through
  `fixtureDir.excludePaths`, and kept a tracked credential-like fixture to
  verify sensitive-file exclusion evidence.
- Added `legacy-project-understanding-go-directory-corpus-e2e.json` to the
  default eval scenario list with route entrypoint, capability label, symbol
  graph, SQL domain/routine evidence, manifest prefix, source-ref
  include/exclude, irrelevant-context ratio, source-RAG readiness, and corpus
  diversity assertions.
- Focused verification passed for the new scenario copied into a
  repository-local temporary scenario/fixture directory (1 scenario / 1
  variant, `scenarioChecks=9/0`). The scanner-real output measured 3
  capabilities, 3 route entrypoints, 25 symbols, 15 graph edges, 20 source
  chunks, full source-RAG readiness coverage, 5 source file extensions, 6 path
  patterns, and 19 record kinds.
- Default eval passed with the new Go corpus included (61 scenarios / 131
  variants, `scenarioChecks=178/0`), along with `bun run typecheck` and clean
  full native `bun test` (1134 tests).

Fresh directory-backed Struts legacy corpus eval:

- Added a ninth checked-in `fixtureDir` corpus for an old Struts-style commerce
  project with static Struts2 `struts.xml` package/action mappings, a Struts1
  `struts-config.xml` action mapping, billing/orders/customers Java
  action/service/repository layers, SQL schema/view/routine evidence, and
  attached tests.
- Kept generated target/vendor/log noise in the corpus while excluding it
  through `fixtureDir.excludePaths`, and kept a tracked credential-like
  fixture to verify sensitive-file exclusion evidence.
- Added `legacy-project-understanding-struts-directory-corpus-e2e.json` to the
  default eval scenario list with route entrypoint, capability label, symbol
  graph, SQL domain/routine evidence, manifest prefix, source-ref
  include/exclude, irrelevant-context ratio, source-RAG readiness, and corpus
  diversity assertions.
- Focused verification passed for the new scenario copied into a
  repository-local temporary scenario/fixture directory (1 scenario / 1
  variant, `scenarioChecks=9/0`). The scanner-real output measured 3
  capabilities, 3 route entrypoints, 24 symbols, 15 graph edges, 3
  route-handler edges, 16 source chunks, full source-RAG readiness coverage, 5
  source file extensions, 5 path patterns, 17 record kinds, 1 sensitive-file
  exclusion, and an irrelevant-context ratio of `0.0833`.
- Default eval passed with the new Struts corpus included (62 scenarios / 132
  variants, `scenarioChecks=187/0`), along with `bun run typecheck` and clean
  full native `bun test` (1134 tests).

Fresh directory-backed JAX-RS legacy corpus eval:

- Added a tenth checked-in `fixtureDir` corpus for an old JAX-RS-style commerce
  project with static `@ApplicationPath`, resource class `@Path`, and
  method-level HTTP/path annotations across billing/orders/customers Java
  resources, plus resource/service/repository layers, SQL schema/view/routine
  evidence, and attached tests.
- Kept generated target/vendor/log noise in the corpus while excluding it
  through `fixtureDir.excludePaths`, and kept a tracked credential-like fixture
  to verify sensitive-file exclusion evidence.
- Added `legacy-project-understanding-jaxrs-directory-corpus-e2e.json` to the
  default eval scenario list with route entrypoint, capability label, symbol
  graph, SQL domain/routine evidence, manifest prefix, source-ref
  include/exclude, irrelevant-context ratio, source-RAG readiness, and corpus
  diversity assertions.
- Focused verification passed for the new scenario copied into a
  repository-local temporary scenario/fixture directory (1 scenario / 1
  variant, `scenarioChecks=9/0`). The scanner-real output measured 3
  capabilities, 3 route entrypoints, 25 symbols, 15 graph edges, 3
  route-handler edges, 17 source chunks, full source-RAG readiness coverage, 4
  source file extensions, 4 path patterns, 16 record kinds, 1 sensitive-file
  exclusion, and an irrelevant-context ratio of `0.0909`.
- Default eval passed with the new JAX-RS corpus included (63 scenarios / 133
  variants, `scenarioChecks=196/0`), along with `bun run typecheck` and clean
  full native `bun test` (1134 tests).

Fresh directory-backed WCF legacy corpus eval:

- Added an eleventh checked-in `fixtureDir` corpus for an old WCF-style
  commerce project with static `.svc` `ServiceHost` directives,
  `ServiceContract` / `OperationContract` operations across billing/orders/
  customers, C# implementation/manager/repository layers, SQL schema/view/
  routine evidence, and attached tests.
- Kept generated bin/obj/log noise in the corpus while excluding it through
  `fixtureDir.excludePaths`, and kept a tracked credential-like fixture to
  verify sensitive-file exclusion evidence.
- Added `legacy-project-understanding-wcf-directory-corpus-e2e.json` to the
  default eval scenario list with WCF host entrypoint, operation entrypoint,
  capability label, symbol graph, contract/implementation/repository source
  chunk evidence, manifest prefix, source-ref include/exclude,
  irrelevant-context ratio, source chunk hash/index readiness, and corpus
  diversity assertions.
- Focused verification passed for the new scenario copied into a
  repository-local temporary scenario/fixture directory (1 scenario / 1
  variant, `scenarioChecks=9/0`). The scanner-real output measured 3
  capabilities, 6 route entrypoints, 27 symbols, 18 graph edges, 6
  route-handler edges, 22 source chunks, full `contentSha256` and
  `sourceChunkIndex` coverage, 18 linked-record source chunks
  (`0.8182` coverage), 5 source file extensions, 6 path patterns, 17 record
  kinds, 1 sensitive-file exclusion, and an irrelevant-context ratio of
  `0.1111`.
- Default eval passed with the new WCF corpus included (64 scenarios / 134
  variants, `scenarioChecks=205/0`), along with `bun run typecheck` and clean
  full native `bun test` (1134 tests).

Fresh directory-backed JAX-WS legacy corpus eval:

- Added a twelfth checked-in `fixtureDir` corpus for an old JAX-WS/SOAP-style
  commerce project with static `@WebService` classes and `@WebMethod`
  operations across billing/orders/customers, Java service/manager/repository
  layers, SQL schema/view/routine evidence, and attached tests.
- Kept generated target/vendor/log noise in the corpus while excluding it
  through `fixtureDir.excludePaths`, and kept a tracked credential-like fixture
  to verify sensitive-file exclusion evidence.
- Added `legacy-project-understanding-jaxws-directory-corpus-e2e.json` to the
  default eval scenario list with SOAP operation entrypoints, capability
  labels, symbol graph evidence, selected service/manager/repository source
  chunks, manifest prefix, source-ref include/exclude, irrelevant-context
  ratio, source chunk hash/index readiness, and corpus diversity assertions.
- Focused verification passed for the new scenario copied into a
  repository-local temporary scenario/fixture directory (1 scenario / 1
  variant, `scenarioChecks=9/0`). The scanner-real output measured 3
  capabilities, 3 route entrypoints, 27 symbols, 15 graph edges, 3
  route-handler edges, 16 source chunks, full `contentSha256` and
  `sourceChunkIndex` coverage, 12 linked-record source chunks (`0.75`
  coverage), 4 source file extensions, 4 path patterns, 15 record kinds, 1
  sensitive-file exclusion, and an irrelevant-context ratio of `0.125`.
- Default eval passed with the new JAX-WS corpus included (65 scenarios / 135
  variants, `scenarioChecks=214/0`), along with `bun run typecheck` and clean
  full native `bun test` (1134 tests).
- Current JAX-WS ContextPack selection is calibrated to the stable SOAP
  operation and Java source-chunk contract: it selects the billing service,
  manager, repository, and symbol sections, but does not yet select JAX-WS SQL
  domain entities or tests as independent selected sections. Strengthening that
  should be an implementation change, not an eval-only assertion change.

Fresh directory-backed ASMX legacy corpus eval:

- Added a thirteenth checked-in `fixtureDir` corpus for an old ASP.NET
  ASMX/SOAP-style commerce project with `.asmx` host files plus static
  `[WebService]` classes and `[WebMethod]` operations across billing/orders/
  customers, C# service/manager/repository layers, SQL schema/view/routine
  evidence, and attached tests.
- Kept generated bin/obj/log noise in the corpus while excluding it through
  `fixtureDir.excludePaths`, and kept a tracked credential-like fixture to
  verify sensitive-file exclusion evidence.
- Added `legacy-project-understanding-asmx-directory-corpus-e2e.json` to the
  default eval scenario list with ASMX operation entrypoints, capability
  labels, symbol graph evidence, selected service/manager/repository source
  chunks, manifest prefix, source-ref include/exclude, irrelevant-context
  ratio, source chunk hash/index readiness, and corpus diversity assertions.
- Focused verification passed for the new scenario copied into a
  repository-local temporary scenario/fixture directory (1 scenario / 1
  variant, `scenarioChecks=9/0`). The scanner-real output measured 3
  capabilities, 3 route entrypoints, 24 symbols, 15 graph edges, 3
  route-handler edges, 16 source chunks, full `contentSha256` and
  `sourceChunkIndex` coverage, 12 linked-record source chunks (`0.75`
  coverage), 4 source file extensions, 5 path patterns, 16 record kinds, 1
  sensitive-file exclusion, and an irrelevant-context ratio of `0.125`.
- Default eval passed with the new ASMX corpus included (66 scenarios / 136
  variants, `scenarioChecks=223/0`), along with `bun run typecheck` and clean
  full native `bun test` (1134 tests).
- Current ASMX ContextPack selection is calibrated to the stable WebService
  operation and C# source-chunk contract: it selects the billing service,
  manager, repository, and symbol sections, but does not yet select ASMX SQL
  domain entities or tests as independent selected sections. Strengthening that
  should be an implementation change, not an eval-only assertion change.

Fresh directory-backed ASP.NET Web Forms legacy corpus eval:

- Added a fourteenth checked-in `fixtureDir` corpus for an old ASP.NET Web
  Forms commerce project with `.aspx` Page directives, `Inherits` code-behind
  classes, and `Page_Load` handler mapping across billing/orders/customers, C#
  page/service/repository layers, SQL schema/view/routine evidence, and
  attached tests.
- Kept generated bin/obj/log noise in the corpus while excluding it through
  `fixtureDir.excludePaths`, and kept a tracked credential-like fixture to
  verify sensitive-file exclusion evidence.
- Added `legacy-project-understanding-webforms-directory-corpus-e2e.json` to
  the default eval scenario list with Web Forms page route entrypoints,
  capability labels, symbol graph evidence, selected domain entities, SQL
  routine source chunk, code-behind source chunk, service/repository source
  chunks, tests, manifest prefix, source-ref include/exclude, irrelevant-
  context ratio, source-RAG readiness, and corpus diversity assertions.
- Focused verification passed for the new scenario copied into a
  repository-local temporary scenario/fixture directory (1 scenario / 1
  variant, `scenarioChecks=9/0`). The scanner-real output measured 3
  capabilities, 3 route entrypoints, 24 symbols, 15 graph edges, 3
  route-handler edges, 19 source chunks, full `contentSha256`,
  `sourceChunkIndex`, and linked-record source chunk coverage, 5 source file
  extensions, 10 path patterns, 16 record kinds, 1 sensitive-file exclusion,
  and an irrelevant-context ratio of `0.1818` before marking the billing domain
  entity section relevant.
- Default eval passed with the new Web Forms corpus included (67 scenarios /
  137 variants, `scenarioChecks=232/0`), along with `bun run typecheck` and
  clean full native `bun test` (1134 tests).
- Current Web Forms ContextPack selection is stronger than the recent SOAP
  directory corpora: for the billing page task it selects the page capability,
  domain entities, SQL routine chunk, tests, symbols, code-behind chunk,
  service chunk, and repository chunk while excluding sibling orders/customers
  pages, SQL, tests, and generated/log noise.

Fresh directory-backed CodeIgniter legacy commerce corpus eval:

- Added a fifteenth checked-in `fixtureDir` corpus for an old CodeIgniter 2/3
  commerce project with static `application/config/routes.php` assignments
  across billing/orders/customers, PHP controller/service/repository layers,
  SQL schema/view/routine evidence, and attached tests.
- Kept generated vendor/tmp/application-cache/log noise in the corpus while
  excluding it through `fixtureDir.excludePaths`, and kept a tracked
  credential-like PHP config file to verify sensitive-file exclusion evidence.
- Added `legacy-project-understanding-codeigniter-directory-corpus-e2e.json`
  to the default eval scenario list with CodeIgniter route entrypoints,
  capability labels, symbol graph evidence, selected handler/service/
  repository source chunks, selected SQL routine and domain-entity evidence,
  tests, manifest prefix, source-ref include/exclude, irrelevant-context ratio,
  source-RAG readiness, and corpus diversity assertions.
- Focused verification passed for the new scenario copied into a
  repository-local temporary scenario/fixture directory (1 scenario / 1
  variant, `scenarioChecks=9/0`). The scanner-real output measured 3
  capabilities, 3 route entrypoints, 21 symbols, 15 graph edges, 3
  route-handler edges, 17 source chunks, full `contentSha256`,
  `sourceChunkIndex`, and linked-record source chunk coverage, 4 source file
  extensions, 5 path patterns, 17 record kinds, 1 sensitive-file exclusion,
  and an irrelevant-context ratio of `0.0833`.
- No scanner changes were needed for P5-34; existing static CodeIgniter route
  config and PHP receiver-chain support handled the directory-backed corpus.

Fresh source chunk index lexical metadata:

- Added bounded deterministic lexical retrieval metadata to
  `ainp.source_chunk_index.v1` entries: `lexicalTokens`, compact token-only
  `searchText`, and combined `linkedRecordRefs`.
- The metadata is derived locally from the bounded chunk path,
  line-label-free chunk content, and existing linked inventory refs. It does
  not duplicate raw snippets, introduce embeddings/dependencies, or replace
  source refs / graph evidence as the authority.
- ContextPack source-chunk retrieval behavior was left unchanged for this
  increment; the existing source-ref, `contentSha256`, graph-pointer, and
  historical index paths already consume authoritative chunk/source evidence,
  and index-only metadata still must not render as normal context.
- Tightened the durable `source_chunk_index_entries` catalog search path to
  normalize query text into exact lexical tokens before matching
  `lexicalTokens` / compact `searchText`. This keeps cross-run source-index
  lookup from selecting unrelated rows through substring noise such as `fund`
  matching `refund`, while preserving metadata-only API responses.
- Added deterministic relevance ordering for durable catalog search:
  multi-token queries now recall rows matching any exact query token, then rank
  rows by the number of exact query tokens matched before applying the existing
  `created_at`, path, line-window, and id tie-breakers. This keeps the catalog
  useful as a recall surface for later hybrid retrieval without treating
  metadata-only index rows as authoritative source context.
- Narrowed runner-side task-time catalog lookup for source chunk indexes.
  ContextPack input assembly now sends a bounded `q` derived from the
  task/user request when it asks the durable `source_chunk_index_entries`
  catalog for current or historical source chunk index metadata. Long task
  briefs are capped to the API's 200-character query limit, catalog failures or
  empty result sets still fall back to the prior no-index behavior, and catalog
  envelopes remain metadata-only instead of rendering as normal input context.
- Narrowed context_request supplement catalog lookup for source chunk indexes.
  Supplement ContextPack assembly now derives its catalog `q` first from the
  sanitized context_request requested refs/questions, then appends the original
  task brief when it fits inside the existing 200-character bound. Historical
  inventory discovery can also retry the metadata-only catalog lookup after a
  base no-row cache result, so a more specific supplement request can recover
  source chunk index rows without rendering index JSON as normal context.
- Focused verification passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts` (1 file / 131
  tests).
- Additional catalog verification passed:
  `bun test apps/api/test/projects-route.test.ts` (29 tests),
  `bun test apps/api/test/workflow-engine.test.ts --test-name-pattern "source chunk index"` (2 tests),
  `bun test apps/runner/test/orchestrator-invoke-skill.test.ts --test-name-pattern "catalog"` (5 catalog-focused invoke-skill tests, including catalog-only and catalog-failure fallbacks),
  `bun run --filter @ainp/runner typecheck`,
  `bun run --filter @ainp/api typecheck`,
  `bun run typecheck`, and
  `git diff --check -- apps/api/src/store/store.ts apps/api/test/projects-route.test.ts apps/runner/src/orchestrator/invoke-skill.ts apps/runner/test/orchestrator-invoke-skill.test.ts .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/task-breakdown.md .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/completion-summary.md`.
- Trellis-check independently reviewed the task-time catalog query narrowing
  slice and found no runtime issues. It tightened the long-query regression to
  assert the exact word-bounded query under the API cap, added thrown-catalog
  fallback coverage, and re-ran the catalog tests, runner typecheck, and
  diff-check successfully.
- Trellis-check independently reviewed the catalog ranking slice and found no
  issues. It verified the metadata-only response boundary, exact-token
  matching, relevance `ORDER BY` parameter ordering, and the
  `q=refund settlement` regression that ranks a two-token match ahead of a
  newer one-token match.
- P5-39 focused verification passed:
  `bun test apps/runner/test/orchestrator-invoke-skill.test.ts` (15 tests,
  including current and historical context_request supplement catalog query
  regressions),
  `bun run --filter @ainp/runner typecheck`, and
  `git diff --check -- apps/runner/src/orchestrator/invoke-skill.ts apps/runner/test/orchestrator-invoke-skill.test.ts .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/task-breakdown.md .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/completion-summary.md`.
- P5-40 profile-contract hardening passed:
  `executeProfileBootstrap` now validates `project-profile.json` required
  top-level onboarding fields, current `projectId` / `workflowRunId`, and the
  `project-inventory.json` artifact id before registering profile artifacts.
  Focused regressions cover wrong schema, missing required fields, mismatched
  project/run identity, and mismatched inventory provenance. Verification
  passed with
  `bun test apps/runner/test/orchestrator-profile-bootstrap.test.ts`,
  `bun run --filter @ainp/runner typecheck`, and scoped `git diff --check`.
- P5-41 profile-contract centralization passed:
  the `ainp.project_profile.v1` schema version, required top-level field list,
  provenance fields, and fail-closed validator now live in
  `apps/runner/src/project-profile-contract.ts`. `executeProfileBootstrap` and
  the `project-profile-bootstrap` skill prompt both consume that shared
  contract, while the focused validator regression keeps nested `sourceRefs`
  outside this slice.
- P5-42 deterministic profile-bootstrap eval fixture passed:
  `agent_backend_fixture` now supports a `profile_bootstrap_success` behavior
  that runs the real `profile.bootstrap` stage order through production
  inventory/profile/completion/knowledge step functions with fake API deps and
  a fake profile backend. The default scenario
  `eval/scenarios/profile-bootstrap-fixture.json` verifies no external model
  CLI is used, `project-profile.json` preserves `ainp.project_profile.v1`
  schema and current project/run/inventory-artifact provenance,
  `project-inventory.json` remains the source-truth artifact,
  `source-chunk-index.json` is persisted as metadata but not injected as a
  profile input, profile markdown does not dump raw inventory/source-index
  JSON, and unapproved profile knowledge candidates remain reviewable only.
  Focused verification passed with
  `bun run scripts/eval-harness.ts --scenario-dir /tmp/ainp-profile-eval-scenario --out-dir /tmp/ainp-profile-eval-out`
  and `bun x tsc -p apps/runner/tsconfig.json --noEmit`.
  Full default eval was also attempted with
  `bun run eval -- --out-dir /tmp/ainp-default-eval-out`; the new
  `profile-bootstrap-fixture` scenario passed, but the overall suite failed on
  five unrelated legacy-understanding expectation checks in CodeIgniter,
  directory-corpus SQL routine, Symfony SQL routine, WCF irrelevant-context
  ratio, and historical sourceChunkIndex metadata-overlay fixtures.
- P5-43 restored the default legacy-project-understanding eval gate after
  P5-42:
  source chunk `summary` mode now uses a line-preserving source chunk summary
  instead of generic input-artifact truncation, so selected SQL/PHP chunks keep
  the proof lines and graph-edge labels required by scanner-to-context evals.
  Historical `sourceChunkIndex` overlays now merge file-line index metadata
  onto matching current-run chunks without leaking historical
  `knowledge_artifact:` / prior artifact refs into current source refs. The WCF
  fixture relevance manifest now classifies the selected billing `.svc` source
  chunk as relevant service-host evidence.
  Focused verification passed with five isolated eval runs for CodeIgniter,
  directory corpus, Symfony directory corpus, WCF, and
  `legacy-project-understanding`, plus
  `bun test apps/runner/test/context-builder.test.ts`.
  Full default eval passed:
  `bun run eval -- --out-dir /tmp/ainp-default-eval-current`
  (69 scenarios / 140 variants / 241 scenario checks). Typecheck passed with
  `bun run typecheck`.
- Trellis-check independently reviewed P5-43 and found one boundary hardening:
  historical `sourceChunkIndex` entry `sourceRefs` are now filtered to `file:`
  refs before merging into current-run chunks, so polluted historical index
  entries cannot promote `knowledge_artifact:` or prior artifact provenance into
  current chunk source refs. The existing regression was strengthened by adding
  those polluted refs inside the historical index entry itself. Check
  verification passed with the focused historical-index regression,
  `bun test apps/runner/test/context-builder.test.ts`, isolated WCF eval,
  `bun run typecheck`, scoped `git diff --check`, and Trellis task validation.
  A post-check default eval also passed with
  `bun run eval -- --out-dir /tmp/ainp-default-eval-post-check`
  (69 scenarios / 140 variants / 241 scenario checks).
- P5-44 added static WCF `system.serviceModel` endpoint discovery:
  `web.config`, `app.config`, and other `.config` files are scanned as
  analysis-only inputs when they contain static WCF service model declarations.
  Static `<service name="..."><endpoint address="..." contract="..." />`
  declarations now emit source-ref backed endpoint-address routes and
  config-backed WCF operation routes using the existing
  `ANY /wcf/<service>/<operation>` shape. Config-backed operation evidence
  cites the config service/endpoint lines plus contract, operation, method, and
  unique implementation lines when resolvable. Dynamic service names and
  dynamic endpoint addresses are ignored, and ambiguous implementation class
  matches fall back to the unique contract operation symbol instead of linking
  an arbitrary service class. No binding behavior, custom factory,
  external-include, DI/container, runtime host, or live endpoint inference was
  added.
- P5-44 focused verification passed:
  `bun test apps/runner/test/project-inventory.test.ts -t "WCF"`,
  WCF-only eval subset via a temporary scenario directory containing
  `legacy-project-understanding-wcf-e2e.json` and
  `legacy-project-understanding-wcf-directory-corpus-e2e.json`
  (2 scenarios / 2 variants / 11 checks), and `bun run typecheck`.
  P5-45 below restores the unrelated full native inventory regression gate.
- P5-45 restored native Bun coverage for the source-chunk-index regression
  gate without changing production scanner semantics. The two non-WCF
  `lexicalTokens` checks now assert token membership with direct `toContain`
  checks outside `toMatchObject`, so Bun's asymmetric matcher no longer
  replaces the reused `lexicalTokens` arrays before later length and equality
  assertions.
- P5-45 verification passed:
  `bun test apps/runner/test/project-inventory.test.ts` (132 tests),
  `bun test apps/runner/test/project-inventory.test.ts -t "WCF"` (2 tests),
  `bun run typecheck`, and a scoped CR/trailing-whitespace scan over
  `apps/runner/test/project-inventory.test.ts`,
  `.trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/task-breakdown.md`,
  and
  `.trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/completion-summary.md`.
  The touched files are untracked in this worktree, so a direct scoped
  whitespace scan was used instead of relying on `git diff --check` to inspect
  untracked paths.
- Trellis-check P5-44 follow-up tightened config-backed WCF contract matching:
  `system.serviceModel` endpoints now prefer the fully qualified static
  `contract="Namespace.IContract"` value when matching scanned
  `ServiceContract` operations, falling back to the basename only for legacy
  contracts where no namespace evidence is available. This prevents a config
  endpoint for one namespaced contract from emitting operation routes for a
  sibling contract with the same interface basename. Verification passed with
  `bun test apps/runner/test/project-inventory.test.ts -t "WCF"` (2 tests),
  `bun test apps/runner/test/project-inventory.test.ts` (132 tests), and
  `bun run typecheck`.
- P5-46 added a metadata-only cross-run source-RAG fallback for task-time
  ContextPack assembly. When current-run `project-inventory.json` contains
  task-matched, source-ref backed inventory records but has no bounded
  `sourceChunks`, those current records are reused as pointers into accepted
  historical project inventory / `sourceChunkIndex` metadata. ContextPack then
  renders only a paired bounded historical source chunk, cites the current
  inventory artifact/source refs plus historical provenance, and keeps raw
  inventory JSON, raw source-chunk-index JSON, and index-only rows out of
  normal context.
- P5-46 focused verification passed:
  `bun test apps/runner/test/context-builder.test.ts`,
  `bun test apps/runner/test/project-inventory.test.ts apps/runner/test/context-builder.test.ts`,
  `bun run typecheck`, and the default eval suite with
  `bun run eval -- --out-dir /tmp/ainp-eval-p5-46` (69 scenarios / 140
  variants / 241 scenario checks).
- P5-46 review tightened two fallback boundaries after inspection:
  historical project inventories are consumed as cross-run source-chunk
  fallback sources only after Knowledge Gate acceptance, and current-run
  fallback pointer records must carry source refs before they can unlock a
  historical bounded chunk. Added focused regressions for draft historical
  inventories and source-less current pointers.
- P5-47 added a directory-backed CakePHP commerce scanner-to-ContextPack eval
  corpus without changing production scanner or ContextPack code. The fixture
  exercises static `Router::connect(...)` routes across billing, orders, and
  customers; PHP controller/service/repository graph evidence; SQL table,
  view, and routine evidence; billing/order/customer tests; credential-like
  sensitive config exclusion; and filtered vendor/tmp/log noise. The scenario
  asserts billing-only task-time ContextPack selection, bounded source chunks,
  sourceChunkIndex coverage, linked-record coverage, graph confidence,
  corpus-diversity gates, raw inventory exclusion, and sibling-domain leakage
  exclusion.
- P5-47 focused verification passed:
  `bun run eval -- --scenario-dir eval/scenarios-cakephp-only --out-dir /private/tmp/ainp-evals-cakephp`
  (1 scenario / 1 variant / 9 scenario checks). The temporary scenario
  directory was removed after the passing run.
- P5-47 review follow-up fixed two fixture/scenario issues: the log-noise file
  is now trackable despite repo-wide `logs/` ignores via a fixture-local
  `.gitignore`, and the dynamic CakePHP `/billing/:id` route is explicitly
  asserted as excluded from task-focused context. The fixture-local `.gitignore`
  is excluded from eval input so it cannot become scanner evidence.
- P5-47 review verification passed:
  `bun run eval -- --scenario-dir /private/tmp/ainp-cakephp-scenario.MLYXuz --out-dir /private/tmp/ainp-evals-cakephp-check`
  (1 scenario / 1 variant / 9 scenario checks), `jq empty
  eval/scenarios/legacy-project-understanding-cakephp-directory-corpus-e2e.json`,
  and `bun run typecheck`.
- P5-48 added a directory-backed Yii/Yii2 commerce scanner-to-ContextPack eval
  corpus without changing production scanner or ContextPack code. The fixture
  exercises static `config/web.php` URL manager rules across billing, orders,
  and customers; PHP controller/service/repository graph evidence; SQL table,
  view, and routine evidence; billing/order/customer tests; credential-like
  sensitive config exclusion; filtered vendor/tmp/log noise; and a
  fixture-local `.gitignore` that makes the checked-in log-noise file
  trackable while keeping `.gitignore` excluded from eval input.
- P5-48 scenario assertions cover billing-only task-time ContextPack
  selection, bounded source chunks, sourceChunkIndex coverage, linked-record
  coverage, graph confidence, corpus-diversity gates, raw inventory exclusion,
  and sibling-domain leakage exclusion across orders/customers routes, SQL,
  tests, and generated noise.
- P5-48 focused verification passed:
  `jq empty eval/scenarios/legacy-project-understanding-yii-directory-corpus-e2e.json`,
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "detects static Yii URL manager routes"`
  (1 test / 131 skipped), and isolated eval via a temporary one-file scenario
  directory:
  `bun run eval -- --scenario-dir /tmp/ainp-yii-scenario.Q9lJ4B --out-dir /tmp/ainp-yii-eval.55xWGe`
  (1 scenario / 1 variant / 9 scenario checks).
- P5-49 added a directory-backed Zend Framework 1 commerce
  scanner-to-ContextPack eval corpus without changing production scanner or
  ContextPack code. The fixture exercises static
  `application/configs/application.ini` router resources across billing,
  orders, and customers; PHP controller/service/repository graph evidence; SQL
  table, view, and routine evidence; billing/order/customer tests;
  credential-like sensitive config exclusion; filtered vendor/tmp/log noise;
  and a fixture-local `.gitignore` that makes the checked-in log-noise file
  trackable while keeping `.gitignore` excluded from eval input.
- P5-49 scenario assertions cover billing-only task-time ContextPack
  selection, bounded source chunks, sourceChunkIndex coverage, linked-record
  coverage, graph confidence, corpus-diversity gates, raw inventory exclusion,
  and sibling-domain leakage exclusion across orders/customers routes, SQL,
  tests, and generated noise.
- P5-49 focused verification passed:
  `jq empty eval/scenarios/legacy-project-understanding-zend-directory-corpus-e2e.json`,
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "Zend Framework"`
  (1 test / 131 skipped), and isolated eval via a temporary one-file scenario
  directory:
  `bun run eval -- --scenario-dir /tmp/ainp-zend-scenario.1Tkw1q --out-dir /tmp/ainp-zend-eval.U8ZH2S`
  (1 scenario / 1 variant / 9 scenario checks). A lightweight
  `git check-ignore -v --non-matching` check covered the fixture-local
  `.gitignore`, the tracked `logs/application.log` noise file, and the
  vendor/tmp noise files that the scenario excludes via `fixtureDir.excludePaths`.
- Source-chunk-index provenance follow-up fixed the ContextPack regression
  where standalone/catalog-backed `source-chunk-index.json` inputs enriched
  matching source chunks but lost the index artifact provenance before
  source-ref rendering. Parsed standalone index entries now retain input
  provenance as metadata and merge that provenance into selected source chunk
  `sourceRefs`; embedded `project-inventory.json` `sourceChunkIndex` metadata
  remains metadata-only so stale historical knowledge refs are not stamped onto
  current chunks.
- Source-chunk-index provenance verification passed:
  `bun run test -- apps/runner/test/orchestrator-invoke-skill.test.ts -t "source chunk index"`
  (6 tests / 9 skipped),
  `bun test -t "uses historical source chunk index refs as metadata for matching current source chunks"`
  (1 test / 1161 filtered), `bun run typecheck`, `bun run eval`
  (72 scenarios / 143 variants / 268 scenario checks), and full `bun test`
  (1162 tests / 4969 assertions).
- The existing conservative Python constructor-injected receiver increment is
  present and now recorded here: `apps/runner/test/project-inventory.test.ts`
  includes `links Flask MethodView constructor-injected Python receivers
  through imported types`, proving static Flask `MethodView` route handlers can
  follow imported typed `__init__` receiver assignments from view -> workflow
  -> repository while avoiding same-named shadow modules.
- This increment added conservative Go constructor-injected struct field
  receiver evidence. The scanner now recognizes static `NewType(...) *Type`
  constructors that return source-backed `Type{field: param}` composite
  literals, attaches those field receivers to Go methods for the owning
  receiver type, and preserves route -> constructed handler method -> workflow
  -> repository graph edges without inferring containers, runtime wiring, or
  dynamic field aliases. `http.HandleFunc` and mux `HandleFunc(...).Methods`
  route parsing now preserves `handler.Method` callback evidence instead of
  truncating it to the receiver variable.
- The new regression `links Go constructor-injected handler fields to workflow
  and repository methods` proves a static `handler :=
  NewBillingHandler(NewBillingWorkflow(NewBillingRepository()))` route reaches
  `BillingHandler.Approve`, `BillingWorkflow.ApproveRefund`, and
  `BillingRepository.SaveApproval`, while a sibling dynamic `any` constructor
  field does not link to the workflow/service graph.
- Focused verification passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "links Go constructor-injected handler fields"`,
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "links Go route handlers to constructed service"`,
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "links Flask MethodView constructor-injected Python receivers through imported types"`,
  `bun run typecheck`, and
  `bun run test -- apps/runner/test/project-inventory.test.ts`
  (134 tests).
- Trellis-check follow-up fixed a false-positive Go receiver risk: constructor
  field evidence is now scoped by package directory plus owner type, so a
  same-named receiver type in another Go package cannot inherit another
  package's constructor-injected fields. The Go regression now covers this with
  a shadow `BillingHandler.Approve` method and also exercises exported
  `Type{Field: param}` composite field assignments. Verification passed:
  `bun run test -- apps/runner/test/project-inventory.test.ts -t "links Go constructor-injected handler fields"`,
  `bun run test -- apps/runner/test/project-inventory.test.ts`, and
  `bun run typecheck`.
- Source-chunk-index linked-record reuse now normalizes explicit record
  identity between standalone/catalog index rows and current bounded chunks.
  A standalone `source-chunk-index.json` row with combined
  `linkedRecordRefs` such as `symbol:<id>` can enrich a current source chunk
  that carries the typed `symbolRefs: ["<id>"]`, while the match remains
  path-scoped, source-ref backed, and metadata-only. The regression also keeps
  unrelated linked-record rows and raw source-chunk-index JSON out of rendered
  ContextPack sections.
- Source-chunk-index linked-record verification passed:
  `bun run test -- apps/runner/test/context-builder.test.ts -t "standalone source chunk index linkedRecordRefs overlay current typed source chunk refs"`
  (1 test / 89 skipped),
  `bun run test -- apps/runner/test/context-builder.test.ts` (90 tests), and
  `bun run typecheck`.
- Source-chunk-index catalog lookup now has a task-time exact linked-record
  fallback. Runner ContextPack input assembly derives bounded exact inventory
  record refs from task-matched current or loaded historical inventory records,
  tries normal metadata-only lexical `q` lookup first, then retries the
  project/artifact-scoped `source_chunk_index_entries` catalog by exact
  `linkedRecordRef` when lexical lookup returns no rows. Returned rows are
  deduped into the standalone source-index envelope and still rely on existing
  ContextPack path/source-chunk pairing before any source chunk renders. The
  task-time record-ref derivation uses exact normalized token matches rather
  than substring matching, so terms such as `fund` do not select `refund`
  records and trigger unrelated catalog lookups.
- P5-51 focused verification passed:
  `bun test apps/runner/test/orchestrator-invoke-skill.test.ts` (17 tests /
  147 assertions), including a regression where lexical lookup misses but
  `symbol:sym_delete_order` retrieves metadata for the current source chunk,
  plus a same-linked-record different-path noise row that remains excluded
  from rendered ContextPack evidence and a substring-only `fund` vs `refund`
  regression that prevents noisy exact-ref fallback calls;
  `bun test apps/runner/test/context-builder.test.ts` (90 tests / 528
  assertions), `bun run test -- apps/runner/test/orchestrator-invoke-skill.test.ts apps/runner/test/context-builder.test.ts`
  (107 Vitest tests), and `bun run typecheck` also passed.
- P5-52 added a directory-backed Drupal 7 commerce scanner-to-ContextPack eval
  corpus without changing production scanner or ContextPack code. The fixture
  exercises static `.module` `hook_menu()` routes across billing, orders, and
  customers; a billing `drupal_get_form` form callback that resolves to the
  concrete form handler instead of `Drupal:drupal_get_form`; explicit PHP
  service/repository graph evidence; SQL table, view, and routine evidence;
  billing/order/customer tests; credential-like sensitive config exclusion;
  and filtered vendor/tmp/log noise.
- P5-52 scenario assertions cover billing-only task-time ContextPack
  selection, bounded source chunks for the Drupal module/service/repository
  and SQL routine, sourceChunkIndex coverage, linked-record coverage, graph
  confidence, corpus-diversity gates, raw inventory exclusion, SQL
  table/routine/view relationship evidence, and sibling-domain leakage
  exclusion across orders/customers routes, SQL, tests, and generated noise.
- P5-52 focused verification passed:
  `python3 -m json.tool eval/scenarios/legacy-project-understanding-drupal-directory-corpus-e2e.json > /dev/null`,
  isolated eval via a temporary one-file scenario directory with
  `bun run eval -- --scenario-dir eval/scenarios-drupal-focus --out-dir /private/tmp/ainp-eval-drupal-focus`
  (1 scenario / 1 variant / 9 scenario checks), `bun test
  apps/runner/test/project-inventory.test.ts -t "Drupal"` (2 tests / 132
  filtered), and `bun run typecheck`.
- Phase 6 post-Drupal verification passed after the Trellis check found no
  issues requiring edits: `bun test` (1167 tests / 5016 assertions) and the
  default eval suite with
  `bun run eval -- --out-dir /tmp/ainp-eval-p6-after-drupal` (73 scenarios /
  144 variants / 277 scenario checks).
- P5-53 added deterministic BM25-style lexical scoring to the durable
  `source_chunk_index_entries` lookup. Catalog query filtering still uses exact
  normalized tokens over metadata-only `lexicalTokens` and compact
  `searchText`, but matching rows now rank by BM25-style term frequency and
  metadata length normalization before the existing stable recency/path/line/id
  tie-breakers.
- P5-53 preserves the existing authority boundary: catalog rows remain
  metadata-only, task-time ContextPack assembly still pairs returned index rows
  with bounded source chunks/source refs before rendering evidence, and no
  embedding/vector service or raw snippet/index rendering was added.
- P5-53 focused verification passed:
  `bun run test -- apps/api/test/projects-route.test.ts` (29 tests),
  `bun run test -- apps/runner/test/orchestrator-invoke-skill.test.ts -t "source chunk index"`
  (7 tests / 10 skipped), `bun run typecheck`,
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`,
  and
  `git diff --check -- apps/api/src/store/store.ts apps/api/test/projects-route.test.ts .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/task-breakdown.md .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap/completion-summary.md`.
- P5-54 added vector-ready hybrid source chunk catalog search without adding
  an embedding provider or dependency. The durable
  `source_chunk_index_entries` catalog now has additive embedding metadata
  columns for model/id, dimensions, and a bounded vector JSON payload through
  ordinary contiguous column migrations. Existing rows remain valid with null
  embedding metadata, and source-index artifact ingestion persists optional
  embedding metadata from
  `ainp.source_chunk_index.v1` entries when present and internally consistent.
- P5-54 API/store lookup accepts a supplied query embedding vector, rejects
  malformed, zero, excessive-dimension, and non-finite vectors, excludes
  incompatible stored row dimensions from cosine scoring, and ranks compatible
  rows by deterministic cosine similarity. When lexical `q` is also supplied,
  exact-token BM25 scoring is added to the vector score while preserving the
  P5-53 no-vector BM25 path and exact-token non-match behavior such as `fund`
  not matching `refund`.
- P5-54 preserves the authority boundary: catalog responses and runner
  catalog envelopes remain metadata-only, can carry embedding metadata, and do
  not render raw source-index JSON, raw snippets, or source chunks without the
  existing bounded chunk/source-ref pairing path.
- P5-54 focused verification passed:
  `bun run test -- apps/api/test/projects-route.test.ts apps/api/test/workflow-engine.test.ts apps/api/test/db-migrations.test.ts`
  (3 files / 56 tests),
  `bun run test -- apps/runner/test/orchestrator-invoke-skill.test.ts -t "source chunk index"`
  (7 tests / 10 skipped), `bun run typecheck`,
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`,
  and scoped `git diff --check`.
- P5-55 activated task-time vector retrieval for source chunk catalog lookups
  using a deterministic local runner helper rather than an embedding provider.
  `ainp.source_chunk_index.v1` entries now carry nested metadata with stable
  model id `ainp-local-source-chunk-lexical-v1`, 32 dimensions, and finite
  non-zero vectors derived only from bounded lexical/search text. The runner
  also derives a matching query vector from task/catalog `q` text and passes it
  to `source_chunk_index_entries` lookups so the P5-54 API path can rank with
  hybrid vector+BM25 automatically.
- P5-55 preserves the source authority boundary: vectors are retrieval signals
  only, existing lexical fields and source refs remain unchanged, linked-record
  fallback queries stay exact-ref based and do not require embeddings, and
  catalog envelopes remain metadata-only without rendering raw index JSON or
  snippets unless paired with existing bounded source chunks/source refs.
- P5-56 added an injectable source-chunk embedding provider abstraction shared
  by source-chunk-index generation and task-time catalog query-vector
  derivation. The default remains the deterministic local provider with no
  network access, no new dependency, and no requirement for a configured
  external service. Provider failures, invalid vectors, dimension mismatches,
  and missing model metadata fall back to the local provider rather than
  blocking inventory or ContextPack assembly.
- P5-56/P5-57 preserve the authority boundary: external providers receive only
  bounded lexical/search text, provider vectors are retrieval signals only, API
  vector scoring requires compatible `embeddingModel` identity, catalog
  responses remain metadata-only, and exact linked-record fallback remains
  ref-only with no `q`, query embedding, or query embedding model.
- P5-57 wired the configured provider into real runner flows through
  `AINP_SOURCE_CHUNK_EMBEDDING_URL` plus optional model/API-key/timeout
  settings. Both `executeInventory` and task-time source-chunk catalog `q`
  lookups now use the configured provider when available and valid, while the
  local deterministic provider remains the default and fallback.
- P5-56/P5-57 verification passed before final eval: focused runner/API tests
  for source chunk embedding, inventory, ContextPack, catalog lookup, and
  project routes; `bun run typecheck`; full `bun test` (1174 tests); scoped
  `git diff --check`; Trellis task validation; and an independent
  `trellis-check` subprocess with no reported issues.
- P6-5 default eval gate passed after P5-57 with no code changes required:
  `bun run eval` produced 73 scenarios / 144 variants / 144 passed / 0 failed
  and 277 scenario checks. Reports:
  `.ainp/evals/eval-2026-07-04T10-48-24-067Z.json` and
  `.ainp/evals/eval-2026-07-04T10-48-24-067Z.html`.
- Trellis task validation passed after the P6-5 eval:
  `python3 ./.trellis/scripts/task.py validate .trellis/tasks/07-01-legacy-project-understanding-evolution-roadmap`
  reported `implement.jsonl` with 9 entries and `check.jsonl` with 5 entries.
- Continuation verification on 2026-07-04 found no remaining implementation
  gap for the documented V1.1-V2 scope and made no code changes. Fresh checks
  passed: `bun run typecheck`; `bun run eval` (73 scenarios / 144 variants /
  144 passed / 0 failed / 277 scenario checks; reports
  `.ainp/evals/eval-2026-07-04T11-04-47-256Z.json` and
  `.ainp/evals/eval-2026-07-04T11-04-47-256Z.html`); focused provider/catalog
  tests for `source-chunk-embedding`, `orchestrator-profile-bootstrap`,
  `orchestrator-invoke-skill`, and `projects-route`; Trellis task validation;
  and scoped `git diff --check`.

## Deferred

The task still documents but does not implement:

- V1.2 broader non-TS parser expansion beyond the current conservative
  Java/C#/PHP/Ruby/Python/Go constructed-receiver slice, including
  DI/IoC/container, runtime wiring, broader dataflow resolution, and deeper
  cross-package call chains that need stronger language semantics.
- Managed vector-index operations beyond the current metadata-only
  source-chunk catalog path, including reindexing jobs, index health,
  provider-specific batching, and production observability.
- Broad real legacy-project source-RAG evaluation and external semantic
  retrieval. Deterministic static, scanner-to-context, metadata-only cross-run
  source anchor coverage, local dependency-free vector signals, and optional
  bounded provider vectors now exist, but they are not a substitute for broad
  old-project coverage.

## Finish State

Task archive was intentionally deferred because the working tree contains many
uncommitted changes outside this task. Archiving should happen after related
code changes are grouped or with an explicit no-commit archive decision.
