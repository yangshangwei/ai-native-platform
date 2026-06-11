# Technical Design — Business Flow End-to-End Audit and Hardening

## Objective

Prove the current AI Native Platform can still carry a user request through the complete business process and expose any broken contracts. This is an audit-first task: code changes should be made only when verification identifies a product-side defect.

## Current architecture

### Durable product flow

1. Web/API creates `WorkflowRequest` with project, title, branch, optional type/flow overrides, and first message.
2. Runner `watch` claims pending requests, runs Coordinator triage, and creates a `WorkflowRun`.
3. API Smart Router recommends/audits flow selection; conservative creation defaults keep compatibility unless explicit overrides are supplied.
4. Runner prepares a local git worktree and iterates `FLOW_REGISTRY[run.flowId].stages`.
5. Each agent stage receives a fresh provider-neutral `ContextPack` through the shared renderer.
6. Runner emits artifacts, command runs, gates, approvals, and workflow actions through API event routes.
7. API Gate Engine decides gates. Manual approval rows unblock human checkpoints.
8. Completion/report/knowledge/context-governance surfaces assemble persisted evidence rather than trusting LLM claims.
9. Web presents the lifecycle, next action, evidence, reports, knowledge, stream logs, and context governance read model.

### Context Injection Layer checkpoints

- Shared types define `ContextPack`, `ContextManifestItem`, `ContextSection`, `ContextRequest`, and maturity/profile metadata.
- Runner `buildContextPack()` selects context, applies scoring/dedupe/budget degradation, and records selection audit metadata.
- Runner `renderAgentPrompt()` is the only prompt assembly policy for Claude Code and Codex backends.
- `context_request` parsing and incremental context packs are recorded as artifacts/actions.
- API `/workflow-runs/:id/context` derives the governance read model from persisted artifacts/actions/task prompts.
- Web displays the governance surface without inventing client-side state.

## Data-flow map

```text
User/Web
  -> /workflow-requests
  -> Runner watch/Coordinator
  -> /workflow-runs + FLOW_REGISTRY
  -> worktree + ContextPack builder/renderer
  -> Agent backend / command runner
  -> /runner/events/*
  -> store + gate engine + reports/context governance
  -> Web task detail / reports / knowledge / context panels
```

## Implementation policy

- Start with verification. Do not edit product code unless a concrete defect is found.
- If a defect is found, prefer an existing helper or projection path before adding a new abstraction.
- Keep fixes in the layer that owns the contract:
  - shared type/catalog mismatch -> `packages/shared`.
  - stage orchestration/context pack invocation -> `apps/runner`.
  - state/gate/report/context read model -> `apps/api`.
  - rendering/navigation/browser breakage -> `apps/web`.
- Do not introduce dependencies.
- Do not weaken gates or broaden success criteria to pass tests.

## Verification plan

1. Static/automated baseline:
   - `bun run typecheck`
   - `bun test` or focused suites if a full run is too slow and focused failures guide the work.
2. Runtime services:
   - Start API on `127.0.0.1:8787` with an isolated task DB if useful.
   - Start Web on an available port, preferably `127.0.0.1:5173`.
3. Runtime flow checks:
   - `bun run e2e` for direct full lifecycle.
   - `bun run scripts/e2e-via-watch.ts` for request queue + Coordinator + watch.
4. Browser checks:
   - Desktop screenshot/navigation pass.
   - Mobile screenshot/navigation pass.
   - Inspect console/network errors.
5. Completion audit:
   - Map every PRD acceptance criterion to evidence.
   - Classify any remaining failures as product defect, test harness defect, or environment blocker.

## Expected artifacts

- PRD: `prd.md`.
- Design/current-state map: this file and `research/current-business-flow-map.md`.
- Verification output: command logs in session plus any screenshots captured by browser automation.
- Product changes only if required by verification.

## Rollback strategy

- Trellis/task artifacts are additive and can be reviewed independently.
- Product code changes, if any, should be small and revertible per failing check.
- If a runtime smoke mutates local `~/.ai-native` state, use isolated env paths where possible during verification.
