# Graph Runtime Resume Branch Join Handoff

## Purpose

Use this handoff to start a new session for the Graph Runtime resume/branch/join work. The current MVP direction is **Failure resume first**: prove current linear flows can be represented as graph definitions, then add API/Runner graph run state and checkpoint-backed node-boundary resume before branch/join behavior.

## Current Task

- Trellis task: `.trellis/tasks/06-27-graph-runtime-resume-branch-join-planning`
- Status: `in_progress`
- Branch: `feat/context-injection-layer-mvp`
- Priority: `P2`
- Base branch in task metadata: `feat/context-injection-layer-mvp`

## Primary Source Documents

Read these first:

1. `docs/2026-06-27-graph-runtime-requirements.md`
2. `docs/2026-06-27-graph-runtime-architecture-design.md`
3. `docs/2026-06-27-graph-runtime-development-tasks.md`

Supporting task docs:

- `.trellis/tasks/06-27-graph-runtime-resume-branch-join-planning/prd.md`
- `.trellis/tasks/06-27-graph-runtime-resume-branch-join-planning/research/graph-runtime-patterns.md`
- `.trellis/tasks/06-27-graph-runtime-resume-branch-join-planning/implement.jsonl`
- `.trellis/tasks/06-27-graph-runtime-resume-branch-join-planning/check.jsonl`

## Decision Summary

The user selected option `1`: **Failure resume first**.

Implications:

- MVP should not start with branch fan-out, join fan-in, or human interrupt/resume behavior.
- First prove graph runtime compatibility with current linear `FLOW_REGISTRY` behavior.
- Resume must be explicit, node-boundary based, and idempotency-aware.
- Workflow Engine remains `WorkflowRun.status` authority.
- Gate Engine remains pass/warn/fail authority.
- Graph Runtime owns scheduling/readiness state only.

## Completed in Current Worktree

Formal docs were created:

- `docs/2026-06-27-graph-runtime-requirements.md`
- `docs/2026-06-27-graph-runtime-architecture-design.md`
- `docs/2026-06-27-graph-runtime-development-tasks.md`

Shared graph foundation was started:

- `packages/shared/src/types/graph-runtime.ts`
  - Defines graph runtime schema/version constant.
  - Defines `GraphDefinition`, `GraphNodeDefinition`, `GraphEdgeDefinition`, `GraphRun`, `GraphNodeRun`, `GraphEvent`.
  - Defines node/run statuses, edge modes, join/resume/failure policies, event types, and guard functions.
- `packages/shared/src/flows/graph-adapter.ts`
  - Adds `flowToGraphDefinition(flow)`.
  - Adds `graphStageOrder(graph)`.
  - Adds `assertGraphMatchesFlowOrder(graph, flow)`.
  - Converts current linear `FlowDef` entries into equivalent graph definitions.
- `packages/shared/src/types/ids.ts`
  - Adds `GraphDefinitionId`, `GraphRunId`, `GraphNodeRunId`, `GraphEventId`.
- `packages/shared/src/index.ts` and `packages/shared/src/browser.ts`
  - Export graph runtime types and graph adapter.
- `packages/shared/test/graph-runtime.test.ts`
  - Covers shared graph type shape and trust-boundary guards.
- `packages/shared/test/flow-graph-adapter.test.ts`
  - Covers all registered `FLOW_REGISTRY` flows converting to equivalent linear graphs.
  - Covers invalid edge target rejection.

Trellis context files were updated to include the formal docs:

- `.trellis/tasks/06-27-graph-runtime-resume-branch-join-planning/implement.jsonl`
- `.trellis/tasks/06-27-graph-runtime-resume-branch-join-planning/check.jsonl`

## Verification Already Run

These passed in the current worktree:

```bash
bun test packages/shared/test
bun run typecheck
python3 ./.trellis/scripts/task.py validate .trellis/tasks/06-27-graph-runtime-resume-branch-join-planning
git diff --check -- docs/2026-06-27-graph-runtime-requirements.md docs/2026-06-27-graph-runtime-architecture-design.md docs/2026-06-27-graph-runtime-development-tasks.md packages/shared/src packages/shared/test .trellis/tasks/06-27-graph-runtime-resume-branch-join-planning
```

Observed shared test result:

- `116 pass`
- `0 fail`

## Current Worktree Notes

There are unrelated dirty Trellis paths in the repository. Do not touch them unless explicitly asked:

- Deleted `.trellis/tasks/06-26-align-my-todos-layout/*`
- Untracked `.trellis/tasks/06-26-ask-flow-lightweight-ui/`
- Untracked `.trellis/tasks/06-27-context-flow-panel/`
- Untracked `.trellis/tasks/archive/2026-06/06-26-align-my-todos-layout/`

Relevant uncommitted changes for this graph runtime task include:

- `.trellis/tasks/06-27-graph-runtime-resume-branch-join-planning/`
- `docs/2026-06-27-graph-runtime-*.md`
- `packages/shared/src/types/graph-runtime.ts`
- `packages/shared/src/flows/graph-adapter.ts`
- `packages/shared/test/graph-runtime.test.ts`
- `packages/shared/test/flow-graph-adapter.test.ts`
- shared export/id edits under `packages/shared/src/`

## Recommended New Session Start

1. Confirm current state:

   ```bash
   git status --short
   python3 ./.trellis/scripts/task.py current --source
   sed -n '1,260p' .trellis/tasks/06-27-graph-runtime-resume-branch-join-planning/handoff.md
   ```

2. Re-run the latest fast checks before continuing:

   ```bash
   bun test packages/shared/test
   bun run typecheck
   python3 ./.trellis/scripts/task.py validate .trellis/tasks/06-27-graph-runtime-resume-branch-join-planning
   ```

3. If the goal is to preserve the completed foundation before deeper API/Runner work, commit the current graph docs + shared foundation first. Suggested commit scope:

   - `docs/2026-06-27-graph-runtime-requirements.md`
   - `docs/2026-06-27-graph-runtime-architecture-design.md`
   - `docs/2026-06-27-graph-runtime-development-tasks.md`
   - `.trellis/tasks/06-27-graph-runtime-resume-branch-join-planning/**`
   - `packages/shared/src/types/graph-runtime.ts`
   - `packages/shared/src/flows/graph-adapter.ts`
   - `packages/shared/src/types/ids.ts`
   - `packages/shared/src/index.ts`
   - `packages/shared/src/browser.ts`
   - `packages/shared/test/graph-runtime.test.ts`
   - `packages/shared/test/flow-graph-adapter.test.ts`

4. Continue with **Epic C - API Graph Run Ledger** from `docs/2026-06-27-graph-runtime-development-tasks.md`.

## Next Implementation Slice

Recommended next slice: **Epic C - API Graph Run Ledger**.

Scope:

- Add additive SQLite tables/read models for:
  - graph definitions or graph definition snapshots;
  - graph runs;
  - graph node runs;
  - optional graph events.
- Link graph node runs to `StepRun` and `StepCheckpoint`.
- Add API read model/helpers and possibly read routes.
- Keep legacy runs safe: missing graph rows return empty graph metadata.
- Do not wire Runner scheduling behavior yet unless Epic C is complete and tested.

Primary files likely involved:

- `apps/api/src/store/db.ts`
- `apps/api/src/store/store.ts`
- `apps/api/src/workflow-engine.ts`
- `apps/api/src/step-checkpoints.ts`
- `apps/api/src/routes/workflow-runs.ts` or a new graph route module
- `apps/api/test/*`

Specs to read before API work:

- `.trellis/spec/api/backend/index.md`
- `.trellis/spec/api/backend/database.md`
- `.trellis/spec/shared/backend/evidence-verifier-protocol.md`
- `.trellis/spec/runner/backend/flow-registry.md`

Expected Epic C tests:

- Legacy workflow run with no graph rows returns empty graph metadata.
- Graph run and graph node run can be persisted and queried by `workflowRunId`.
- Graph node run can link to a `StepRun` and `StepCheckpoint`.
- Node run referencing a different workflow's step is rejected.

## Guardrails

- Do not derive `WorkflowRun.status` from graph node status.
- Do not derive GateRun pass/warn/fail from graph join policy.
- Do not silently rerun a completed side-effecting node.
- Do not replace `FLOW_REGISTRY` or current `dispatchStep()` behavior in the next slice.
- Do not add external graph-runtime dependencies.
- Keep migrations additive and versioned; do not edit or renumber existing migrations.
- Keep docs in English, matching existing project docs.

## Longer Roadmap

After Epic C:

1. Epic D: linear graph scheduler behind existing dispatch.
2. Epic E: checkpoint-backed node-boundary resume.
3. Epic F: graph runtime eval fixtures.
4. Post-MVP: branch fan-out.
5. Post-MVP: join fan-in.
6. Post-MVP: human interrupt/resume.

