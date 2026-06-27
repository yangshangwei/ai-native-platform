# Eval Harness

## Scenario: deterministic agent backend fixtures

### 1. Scope / Trigger

- Trigger: changes to `scripts/eval-harness.ts`, `eval/scenarios/*`, or scenario schemas used to validate Agent Runtime behavior.
- Eval scenarios must be deterministic and runnable without external Claude Code/Codex binaries unless a future scenario explicitly opts into a real backend lane.
- Agent backend fixtures protect Runner orchestration contracts, not model quality.

### 2. Signatures

- Command: `bun run eval -- [--scenario-dir <dir>] [--out-dir <dir>]`.
- Scenario schema version: `ainp.eval.scenario.v1`.
- Supported scenario kinds:
  - `router_recommendation`
  - `agent_backend_fixture`
- `agent_backend_fixture.input.behavior`:
  - `success`
  - `failure`
  - `context_request`
- `agent_backend_fixture.expectations` supports checks for session start/finish, final status, AgentResult linkage, observed error, context request capture, output count, backend call count, and external CLI usage.
- Report schema: `ainp.eval.result.v1`; JSON and HTML reports include scenario kind, variant, checks, output, and pass/fail status.

### 3. Contracts

- Default `bun run eval` must run only scenarios expected to pass.
- Red fixtures belong outside the default scenario directory, for example `eval/scenarios-red/`, and must fail when run explicitly.
- `agent_backend_fixture` must call Runner `invokeSkill()` with a fake `AgentBackend` and fake API deps; it must not spawn Claude Code, Codex, or any other external model CLI.
- Successful fake invocations must be finishable through `finishAgentSuccess()` so AgentSession success linkage is tested through the same helper used by orchestration.
- Failing fake invocations must record a failed AgentResult and failed AgentSession before surfacing the error.
- Context-request fake invocations must use the real `context_request` parser/capture path and record supplement artifacts through fake deps.
- Context-request fake invocations in the default suite must model the bounded retry path: first backend call emits `context_request`, second backend call succeeds, and expectations assert `backendCalls: 2`.

### 4. Validation & Error Matrix

- Unsupported `schemaVersion` -> reject scenario before running variants.
- Unsupported `kind` -> reject scenario before running variants.
- `router_recommendation` missing `input.projectId`, `input.title`, or `input.runType` -> reject scenario.
- `agent_backend_fixture` missing `input.title` or `input.behavior` -> reject scenario.
- Any failed expectation -> variant status `fail`; if any variant fails, the eval command exits 1.
- A default scenario that depends on real Claude Code/Codex CLI -> contract violation; replace with fake backend coverage.

### 5. Good/Base/Bad Cases

- Good: default suite includes an `agent_backend_fixture` success variant, failure variant, and context_request variant, all passing deterministic expectations.
- Good: the context_request variant checks `contextRequestCaptured: true`, `finalStatus: 'success'`, and `backendCalls: 2`.
- Good: `bun run eval -- --scenario-dir eval/scenarios-red` exits 1 for an intentionally bad AgentSession expectation.
- Base: router-only scenarios continue to run unchanged and report `kind: 'router_recommendation'`.
- Bad: a fixture calls `selectAgentBackend()` and fails on a developer machine without Codex or Claude Code installed.
- Bad: a red scenario is placed under `eval/scenarios/`, causing the default eval suite to fail.

### 6. Tests Required

- Default eval command passes with router and agent fixture scenarios.
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
