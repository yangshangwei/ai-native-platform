# Eval Harness

## Scenario: deterministic Agent Runtime fixtures

### 1. Scope / Trigger

- Trigger: changes to `scripts/eval-harness.ts`, `eval/scenarios/*`, or scenario schemas used to validate Agent Runtime behavior.
- Eval scenarios must be deterministic and runnable without external Claude Code/Codex binaries unless a future scenario explicitly opts into a real backend lane.
- Agent Runtime fixtures protect Runner/API orchestration contracts, context selection, evidence gates, and reports; they do not measure model quality.

### 2. Signatures

- Command: `bun run eval -- [--scenario-dir <dir>] [--out-dir <dir>]`.
- Scenario schema version: `ainp.eval.scenario.v1`.
- Supported scenario kinds:
  - `router_recommendation`
  - `agent_backend_fixture`
  - `context_pack_fixture`
  - `workflow_fixture`
  - `graph_runtime_fixture`
  - `legacy_project_understanding_fixture`
- `agent_backend_fixture.input.behavior`:
  - `success`
  - `failure`
  - `context_request`
  - `profile_bootstrap_success`
- `agent_backend_fixture.expectations` supports checks for session start/finish, final status, AgentResult linkage, observed error, context request capture, output count, backend call count, external CLI usage, and profile-bootstrap fixture boundaries.
- `context_pack_fixture.expectations` supports checks for mode, manifest refs,
  selected section refs with section-local source-ref include/exclude gates,
  source refs, authoritative source-ref exclusion, section inclusion modes,
  retrieval hint count, calibration signal count, structured calibration
  signal inclusion by kind/severity/action/message/source refs, selected item
  count, and deterministic irrelevant-context ratio proxies using
  scenario-declared relevant manifest-ref prefixes.
- `legacy_project_understanding_fixture.input` supports a temporary fixture
  project via inline `files[]`, a bounded checked-in `fixtureDir`, or both,
  plus optional `inventoryLimits`, optional context `budget`, and optional
  `sensitivePathPatterns`.
- `legacy_project_understanding_fixture.input.fixtureDir` shape:
  `{ path: string, maxFiles?: number, maxFileBytes?: number,
  maxTotalBytes?: number, excludePaths?: string[] }`. Relative paths resolve
  against the scenario JSON file location. The resolved real directory must
  stay inside the repository root. The harness recursively reads only regular
  files, sorts relative paths deterministically, applies exclude prefixes
  before reading, enforces file count/per-file/total byte bounds, preserves
  relative paths in the temporary workspace, and then merges those files with
  inline `files[]`.
- `legacy_project_understanding_fixture.expectations` includes all
  `context_pack_fixture` expectations plus scanner inventory checks for
  capability labels, entrypoint routes, symbol names, symbol graph edge kinds,
  symbol graph edge confidence floors, source-chunk graph-edge refs, and
  exclusions.
- `legacy_project_understanding_fixture.expectations.inventoryQualityGates`
  supports scenario-level aggregate checks for measured legacy variants,
  minimum symbol graph edge confidence, and minimum route-handler edge
  confidence. It also supports source-RAG readiness floors for source chunk
  `contentSha256` coverage, `sourceChunkIndex` coverage, and linked
  inventory-record coverage. It also supports deterministic corpus-readiness
  floors for distinct scanner-backed source file extensions, source path
  patterns, and inventory record kinds. Use it on multi-variant legacy fixtures
  so a newly added variant cannot silently skip graph quality floors, cross-run
  source retrieval anchors, or fixture diversity coverage.
- Graph-bearing `legacy_project_understanding_fixture` scenarios receive
  conservative default graph quality floors even when `inventoryQualityGates`
  is omitted: symbol graph edge confidence must be at least `0.65`, and
  route-handler edge confidence must be at least `0.78`. Explicit
  `inventoryQualityGates` values override these defaults when a scenario needs
  a stricter floor.
- `workflow_fixture.input.profile` supports `complete`, `missing_command_digest`,
  `artifact_only_compile`, `captcha_business_acceptance`, and
  `captcha_test_only`.
- `workflow_fixture.expectations` supports checks for Acceptance Gate
  status/rule statuses, Evidence Gate status/rule statuses, business
  acceptance matrix row count/scenario types, digest-backed commands,
  completion report generation, completion report business-matrix presence,
  retro report generation, retro finding count, and report artifact count.
- `graph_runtime_fixture.input.profile` supports `linear_equivalence`, `failed_resume`, and `completed_resume`.
- `graph_runtime_fixture.expectations` supports checks for FLOW_REGISTRY stage-order equivalence, scheduler runnable stages, failed-node resume attempt creation, completed-node resume rejection, source-checkpoint linkage, and graph event emission.
- Report schema: `ainp.eval.result.v1`; JSON and HTML reports include scenario kind, variant, checks, output, and pass/fail status.

### 3. Contracts

- Default `bun run eval` must run only scenarios expected to pass.
- Red fixtures belong outside the default scenario directory, for example `eval/scenarios-red/`, and must fail when run explicitly.
- `agent_backend_fixture` must call Runner `invokeSkill()` with a fake `AgentBackend` and fake API deps; it must not spawn Claude Code, Codex, or any other external model CLI.
- Successful fake invocations must be finishable through `finishAgentSuccess()` so AgentSession success linkage is tested through the same helper used by orchestration.
- Failing fake invocations must record a failed AgentResult and failed AgentSession before surfacing the error.
- Context-request fake invocations must use the real `context_request` parser/capture path and record supplement artifacts through fake deps.
- Context-request fake invocations in the default suite must model the bounded retry path: first backend call emits `context_request`, second backend call succeeds, and expectations assert `backendCalls: 2`.
- Profile-bootstrap fake invocations must run the real `profile.bootstrap`
  dispatcher stages with production `executeInventory`, `executeProfileBootstrap`,
  `executeCompletion`, and `executeKnowledgePromotion` step functions, while
  using fake API deps and a fake backend output. Expectations may assert the
  flow order, persisted inventory/profile artifacts, profile JSON contract and
  provenance, source-index metadata not being injected as a profile input, raw
  inventory JSON not being dumped into profile markdown, and unapproved
  knowledge candidates remaining reviewable only.
- `context_pack_fixture` must call the real Runner context builder and expose structured manifest/source-ref/degradation output for expectations. It must not snapshot the whole ContextPack.
- `context_pack_fixture` may declare `relevantManifestRefPrefixes` and
  `irrelevantContextRatioMax` to measure a deterministic low-signal manifest
  proxy. The harness treats selected manifest refs that do not equal or start
  with one of those prefixes as irrelevant for that scenario variant; this is
  a regression guard for task-focused context leakage, not semantic judging.
- `context_pack_fixture` may declare `selectedSectionsInclude` when a source
  ref, content snippet, or selection reason must be carried by a specific
  selected section, not merely present somewhere in the pack. Use this for
  scanner-to-context contracts where capability, symbol, test, source-chunk,
  correction-review text, or fallback rationale must stay attached to the
  manifest item that selected it.
- `context_pack_fixture` may declare `calibrationSignalsInclude` when a
  review/calibration signal must carry a specific kind, severity, recommended
  action, message text, subject refs, or evidence refs. Use this for correction
  drift and knowledge-governance contracts where a signal count alone would not
  prove the right artifact/source evidence was cited.
- `context_pack_fixture` and `legacy_project_understanding_fixture` variants
  that declare `manifestRefsInclude` entries starting with `inventory_` must
  also declare `selectedSectionsInclude`. Inventory-backed evals must prove
  evidence is attached to the selected capability/symbol/test/source-chunk
  sections, not only present globally somewhere in the ContextPack.
- `workflow_fixture` must seed deterministic workflow evidence into the eval SQLite store, call the real Evidence Gate, and use report generators for completion/retro sidecar checks. It must not run a live API server.
- Business acceptance workflow fixtures must call the real Acceptance Gate
  before Evidence Gate. They must not hand-implement matrix verdicts.
- `graph_runtime_fixture` must use the real shared flow-to-graph adapter, API graph resume helper, graph ledger store, and Runner graph scheduler. It must not hand-implement alternate graph traversal or resume rules.
- `legacy_project_understanding_fixture` must write merged inline
  `input.files[]` plus checked-in `input.fixtureDir` files into a temporary
  workspace, call the real Runner `buildProjectInventory()`, inject the
  generated `project-inventory.json` as an input artifact, then call the real
  Runner `buildContextPack()`.
- `legacy_project_understanding_fixture` must not snapshot whole inventories or whole ContextPacks. Its output must expose stable scanner summaries plus structured manifest/source-ref/degradation output.
- `legacy_project_understanding_fixture` file paths must avoid case-only sibling
  directory conflicts such as `app/services` and `app/Services` in the same
  temporary project. Those paths collapse on case-insensitive filesystems and
  make scanner source refs nondeterministic across developer machines and CI.
- Scanner-to-context legacy fixtures must assert that capability-map matches stay primary, unrelated same-file capabilities are excluded, and hybrid fallback only runs when capability matching finds no capability.
- Legacy understanding fixtures must keep raw `project-inventory.json` as a foundation input only; selected eval evidence must remain source-ref backed `code_probe` sections.

### 4. Validation & Error Matrix

- Unsupported `schemaVersion` -> reject scenario before running variants.
- Unsupported `kind` -> reject scenario before running variants.
- `router_recommendation` missing `input.projectId`, `input.title`, or `input.runType` -> reject scenario.
- `agent_backend_fixture` missing `input.title` or `input.behavior` -> reject scenario.
- `context_pack_fixture` missing `input.title` -> reject scenario.
- `workflow_fixture` missing `input.title` or `input.profile` -> reject scenario.
- `graph_runtime_fixture` missing `input.title`, `input.flowId`, or `input.profile` -> reject scenario.
- `legacy_project_understanding_fixture` missing `input.title` or both a
  non-empty `input.files[]` and valid `input.fixtureDir.path` -> reject
  scenario.
- `legacy_project_understanding_fixture.input.fixtureDir.path` missing,
  nonexistent, outside the repository root, not a directory, or exceeding its
  declared/default file count or byte bounds -> reject the fixture run
  deterministically.
- Any failed expectation -> variant status `fail`; if any variant fails, the eval command exits 1.
- A default scenario that depends on real Claude Code/Codex CLI -> contract violation; replace with fake backend coverage.

### 5. Good/Base/Bad Cases

- Good: default suite includes an `agent_backend_fixture` success variant, failure variant, and context_request variant, all passing deterministic expectations.
- Good: the context_request variant checks `contextRequestCaptured: true`, `finalStatus: 'success'`, and `backendCalls: 2`.
- Good: default suite includes an `agent_backend_fixture`
  `profile_bootstrap_success` scenario that runs `profile.bootstrap` with a
  fake profile backend, verifies `project-profile.json` provenance against the
  generated `project-inventory.json` artifact, keeps `source-chunk-index.json`
  out of profile inputs, avoids raw inventory prose dumps, and proves an
  unapproved knowledge candidate is not persisted as accepted knowledge.
- Good: default suite includes `context_pack_fixture` variants for selected accepted/current knowledge and observable budget degradation.
- Good: default suite includes a `context_pack_fixture` legacy-project understanding variant where no current-run inventory input is present and a governed historical inventory knowledge artifact supplies `code_probe` evidence instead of raw JSON context.
- Good: task-focused legacy fixtures set relevant manifest-ref prefixes and a
  bounded `irrelevantContextRatioMax` so sibling-domain context leakage fails
  deterministically without relying on LLM scoring.
- Good: default suite includes `workflow_fixture` with digest-backed compile/test/acceptance evidence, passing Evidence Gate, and generated completion/retro report sidecars.
- Good: default suite includes a login captcha toggle workflow fixture whose
  complete variant covers core, boundary, and exception AC rows, plus a
  test-only variant that expects Acceptance Gate failure even though
  `test_gate` is passing.
- Good: default suite includes `graph_runtime_fixture` variants for linear graph equivalence, failed-node resume creating a new ready attempt, and completed-node resume rejection.
- Good: default suite includes `legacy_project_understanding_fixture` variants that scan a temporary mini legacy project before context selection, prove capability-map primary selection, exclude unrelated same-file capabilities, verify sensitive-file exclusions, and prove hybrid fallback over scanner-real symbol/test evidence.
- Good: default suite includes a directory-backed
  `legacy_project_understanding_fixture` whose source files come from
  `eval/fixtures/`, proving checked-in fixture directories feed the same
  scanner-to-ContextPack path and support inventory/source-ref/selected-section
  assertions while inline `files[]` remains supported.
- Good: multi-variant legacy understanding fixtures declare
  `inventoryQualityGates` for measured variant count plus graph and
  route-handler confidence floors, keeping symbol-graph quality measurable at
  scenario level as fixtures evolve.
- Good: graph-bearing legacy understanding fixtures without explicit
  `inventoryQualityGates` still receive default `inventoryQualityDefaults`
  checks, so omission of a custom gate does not remove graph confidence
  coverage.
- Good: scanner-to-context legacy fixtures can declare source-RAG readiness
  `inventoryQualityGates` so every generated source chunk remains hashable,
  indexed, and linked to inventory records before real cross-run source corpus
  expansion.
- Good: scanner-to-context legacy fixtures can declare corpus-readiness
  `inventoryQualityGates` for source extension, path-pattern, and record-kind
  diversity so real legacy corpus claims are backed by measured fixture shape,
  not only by route counts.
- Good: red suite includes a `selectedSectionsInclude` fixture where a source
  ref exists globally on the ContextPack but is attached to a different
  selected section; the fixture must fail on the section-local source-ref
  expectation.
- Good: red suite includes a `selectedSectionsInclude` fixture where the
  selected section exists but lacks expected content text; the fixture must
  fail on the section-local content expectation.
- Good: red suite includes a `calibrationSignalsInclude` fixture where a
  signal exists but lacks an intentionally expected evidence ref; the fixture
  must fail on the structured calibration signal expectation.
- Good: red suite includes a `legacy_project_understanding_fixture` that
  declares inventory manifest expectations without `selectedSectionsInclude`;
  the fixture must fail on the harness-level section-gate coverage check.
- Good: red suite includes a `legacy_project_understanding_fixture` that
  declares impossible `inventoryQualityGates`; the fixture must fail on the
  scenario-level graph confidence checks even when scanner-to-context
  generation succeeds.
- Good: red suite includes `legacy_project_understanding_fixture` scenarios
  whose `fixtureDir.path` resolves outside the repository root, points at a
  checked-in file instead of a directory, exceeds `maxFiles`, exceeds
  `maxFileBytes`, and exceeds `maxTotalBytes`; each fixture must fail during
  directory validation before scanner-to-context generation starts.
- Good: red suite includes a `legacy_project_understanding_fixture` that
  declares an impossible source-RAG readiness floor; the fixture must fail on
  the scenario-level source chunk coverage check even when scanner-to-context
  generation succeeds.
- Good: red suite includes a `legacy_project_understanding_fixture` that
  declares an impossible corpus-readiness floor; the fixture must fail on the
  scenario-level source extension/path/record-kind diversity check even when
  scanner-to-context generation succeeds.
- Good: red suite includes a `context_pack_fixture` that declares handcrafted
  inventory manifest expectations without `selectedSectionsInclude`; it must
  fail on the same harness-level section-gate coverage check.
- Good: `bun run eval -- --scenario-dir eval/scenarios-red` exits 1 for an intentionally bad AgentSession expectation.
- Good: red suite includes context/workflow/graph bad expectations for sensitive context, missing command digests, and invalid graph resume expectations.
- Base: router-only scenarios continue to run unchanged and report `kind: 'router_recommendation'`.
- Bad: a fixture calls `selectAgentBackend()` and fails on a developer machine without Codex or Claude Code installed.
- Bad: a red scenario is placed under `eval/scenarios/`, causing the default eval suite to fail.
- Bad: `context_pack_fixture` uses whole-pack snapshots that churn on harmless score/id/timestamp changes.
- Bad: irrelevant-context ratio expectations use broad prefixes such as
  `inventory_` that mark sibling-domain evidence as relevant and hide leakage.
- Bad: `workflow_fixture` hand-implements an alternate Evidence Gate instead of calling the real gate.
- Bad: a business-acceptance workflow fixture marks the test-only path as
  accepted. It must expect `acceptance.business_matrix_present=fail`.
- Bad: `graph_runtime_fixture` hand-implements a fake scheduler/resume policy instead of calling the real Graph Runtime helpers.
- Bad: `legacy_project_understanding_fixture` passes a handcrafted inventory directly to ContextPack and therefore misses scanner-to-context regressions.
- Bad: `legacy_project_understanding_fixture` reads an arbitrary absolute
  directory or a relative path outside the repository root. Fixture directories
  must be checked-in, root-guarded inputs.
- Bad: inventory capability matching uses encoded ids, same-file paths, symbol paths, test paths, hotspot paths, or generic source refs as primary capability match text. That can select unrelated capabilities from the same route file.
- Bad: an inventory-backed ContextPack or scanner-to-context fixture asserts
  only `manifestRefsInclude` / global `sourceRefsInclude`. That can miss
  regressions where a source ref is present in the pack but attached to the
  wrong selected section.

### 6. Tests Required

- Default eval command passes with router, context, workflow, graph, agent, and legacy-project-understanding fixture scenarios.
- Red fixture command exits non-zero when run against `eval/scenarios-red`.
- Runner tests remain green because the fixture reuses Runner invocation contracts instead of forking behavior.
- Typecheck remains green for packages covered by project `tsconfig` files.

### 7. Wrong vs Correct

#### Wrong

```ts
// Eval depends on a local Codex install, so CI can fail for environment reasons.
const backend = await selectAgentBackend(project);
```

#### Correct

```ts
const backend: AgentBackend = {
  kind: 'native',
  run: async () => ({ outputs: [], lastMessage: 'fixture result' }),
};
await invokeSkill(ctx, skill, skillCtx, fakeDeps);
```
