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
- `agent_backend_fixture.input.behavior`:
  - `success`
  - `failure`
  - `context_request`
- `agent_backend_fixture.expectations` supports checks for session start/finish, final status, AgentResult linkage, observed error, context request capture, output count, backend call count, and external CLI usage.
- `context_pack_fixture.expectations` supports checks for mode, manifest refs, source refs, authoritative source-ref exclusion, section inclusion modes, retrieval hint count, calibration signal count, and selected item count.
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
- `context_pack_fixture` must call the real Runner context builder and expose structured manifest/source-ref/degradation output for expectations. It must not snapshot the whole ContextPack.
- `workflow_fixture` must seed deterministic workflow evidence into the eval SQLite store, call the real Evidence Gate, and use report generators for completion/retro sidecar checks. It must not run a live API server.
- Business acceptance workflow fixtures must call the real Acceptance Gate
  before Evidence Gate. They must not hand-implement matrix verdicts.
- `graph_runtime_fixture` must use the real shared flow-to-graph adapter, API graph resume helper, graph ledger store, and Runner graph scheduler. It must not hand-implement alternate graph traversal or resume rules.

### 4. Validation & Error Matrix

- Unsupported `schemaVersion` -> reject scenario before running variants.
- Unsupported `kind` -> reject scenario before running variants.
- `router_recommendation` missing `input.projectId`, `input.title`, or `input.runType` -> reject scenario.
- `agent_backend_fixture` missing `input.title` or `input.behavior` -> reject scenario.
- `context_pack_fixture` missing `input.title` -> reject scenario.
- `workflow_fixture` missing `input.title` or `input.profile` -> reject scenario.
- `graph_runtime_fixture` missing `input.title`, `input.flowId`, or `input.profile` -> reject scenario.
- Any failed expectation -> variant status `fail`; if any variant fails, the eval command exits 1.
- A default scenario that depends on real Claude Code/Codex CLI -> contract violation; replace with fake backend coverage.

### 5. Good/Base/Bad Cases

- Good: default suite includes an `agent_backend_fixture` success variant, failure variant, and context_request variant, all passing deterministic expectations.
- Good: the context_request variant checks `contextRequestCaptured: true`, `finalStatus: 'success'`, and `backendCalls: 2`.
- Good: default suite includes `context_pack_fixture` variants for selected accepted/current knowledge and observable budget degradation.
- Good: default suite includes `workflow_fixture` with digest-backed compile/test/acceptance evidence, passing Evidence Gate, and generated completion/retro report sidecars.
- Good: default suite includes a login captcha toggle workflow fixture whose
  complete variant covers core, boundary, and exception AC rows, plus a
  test-only variant that expects Acceptance Gate failure even though
  `test_gate` is passing.
- Good: default suite includes `graph_runtime_fixture` variants for linear graph equivalence, failed-node resume creating a new ready attempt, and completed-node resume rejection.
- Good: `bun run eval -- --scenario-dir eval/scenarios-red` exits 1 for an intentionally bad AgentSession expectation.
- Good: red suite includes context/workflow/graph bad expectations for sensitive context, missing command digests, and invalid graph resume expectations.
- Base: router-only scenarios continue to run unchanged and report `kind: 'router_recommendation'`.
- Bad: a fixture calls `selectAgentBackend()` and fails on a developer machine without Codex or Claude Code installed.
- Bad: a red scenario is placed under `eval/scenarios/`, causing the default eval suite to fail.
- Bad: `context_pack_fixture` uses whole-pack snapshots that churn on harmless score/id/timestamp changes.
- Bad: `workflow_fixture` hand-implements an alternate Evidence Gate instead of calling the real gate.
- Bad: a business-acceptance workflow fixture marks the test-only path as
  accepted. It must expect `acceptance.business_matrix_present=fail`.
- Bad: `graph_runtime_fixture` hand-implements a fake scheduler/resume policy instead of calling the real Graph Runtime helpers.

### 6. Tests Required

- Default eval command passes with router, context, workflow, graph, and agent fixture scenarios.
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
