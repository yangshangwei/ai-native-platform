# Flow Registry & runWorkflow Dispatch

## Scenario: declarative flow definitions driving the orchestrator

### 1. Scope / Trigger

- Trigger: changes to `apps/runner/src/flows/registry.ts`, `apps/runner/src/orchestrator.ts` (the `cmdOrchestrate` body, `dispatchStep`, or any `executeXxx` step implementation), or the `FlowId` / `FlowDef` / `StageStep` types in `packages/shared/src/types/workflow.ts`.
- Adding a new flow variant (e.g. `feature.fastforward` in W2-3, `issue.standard` / `refactor.standard` in W2-2) — the new entry must land in `FLOW_REGISTRY` and the new id must be added to the `FlowId` literal union.
- Schema/type changes touching `workflow_runs.flow_id` or `WorkflowRun.flowId`.

### 2. Signatures

- `FlowId` (`@ainp/shared`) — string-literal union, **not** a free `string`. Today: `'feature.standard'`. Future entries documented at the type definition.
- `StageStep` (`@ainp/shared`) — `{ stage: WorkflowStage; kind: StageStepKind; skillId?: string }`. `kind` is `'agent' | 'gate' | 'human' | 'engine'`.
- `FlowDef` (`@ainp/shared`) — `{ id: FlowId; kind: WorkflowRunType; description: string; stages: readonly StageStep[] }`.
- `FLOW_REGISTRY` (`apps/runner/src/flows/registry.ts`) — `Readonly<Record<FlowId, FlowDef>>`. Single source of truth for V2 flow definitions.
- `dispatchStep(step: StageStep, ctx: RunCtx): Promise<void>` — inner function of `cmdOrchestrate`, single-point router.
- `executeImplementation(c: RunCtx)` / `executeBuildTest(c)` / `executeAcceptance(c)` / `executeCompletion(c)` / `executeKnowledgePromotion(c)` — inner functions of `cmdOrchestrate`, 1:1 lifts of the V1 inline blocks.
- `RunCtx` — file-private interface in `orchestrator.ts`; carries `project`, `run`, `workspace`, `backend`, `tools`, `opts`, `runArtifactsDir`, `inputs`, `inputArtifactIds`, `draftsToPromote`, `ok` across step implementations. **Not exported**.

### 3. Contracts

#### Thin (W2-1 = α) semantics

- `runWorkflow` (i.e. `cmdOrchestrate`) drives lifecycle iteration from `FLOW_REGISTRY[run.flowId].stages` via `for (const step of flow.stages) await dispatchStep(step, ctx)`.
- `StageStep.kind` and `StageStep.skillId` are **populated for every step but NOT read at runtime in W2-1**. They exist so the surface is stable when W2-3 / W2-4 begin consuming them through a generic dispatcher. Treat them as forward-compatible declarations, not authoritative routing data.
- `dispatchStep` switches on `step.stage` (a `WorkflowStage`) and routes to `runContextPack` / `runStage(...)` / `executeXxx(ctx)`. The `kind` / `skillId` fields are ignored.
- `runContextPack` and `runStage` helpers are kept verbatim from V1; only the five inline blocks (implementation / build_test / acceptance / completion / knowledge) were extracted into named `executeXxx(ctx)` functions. Logic byte-for-byte equivalent to V1 (zero-regression invariant — PRD AC-2 / AC-3 / pinned by `apps/runner/test/flow-registry.test.ts`).

#### Stage layout for `feature.standard`

Eight steps, in this exact order — pinned by `apps/runner/test/flow-registry.test.ts` against an out-of-band reference array (PRD AC-10):

1. `context_pack` (kind=`engine` semantically — runner-side; `runContextPack` helper)
2. `requirement` (kind=`agent`)
3. `design` (kind=`agent`)
4. `implementation` (kind=`agent`) — `executeImplementation`
5. `build_test` (kind=`engine`) — `executeBuildTest`
6. `review` (kind=`agent`) — `runStage('review', ...)` then `executeAcceptance(ctx)` inline. WorkflowStage has no `'acceptance'` literal; V1 collapses human acceptance into `awaitHuman({ stage: 'review' })` immediately after the review agent emits its artifact, so the review step owns both halves here.
7. `completion` (kind=`engine`) — `executeCompletion`
8. `knowledge` (kind=`engine`) — `executeKnowledgePromotion`

Note that `'init'` (a `WorkflowStage` enum value) is **not** a step in this flow — it is a status placeholder for `run.currentStage` between row creation and the first stage transition, never dispatched. `dispatchStep` rejects `'init'` explicitly.

#### Entry contract — `flowId` plumbing

- `WorkflowRun.flowId: FlowId` is **required** in TypeScript and **NOT NULL** in the `workflow_runs.flow_id` column with `DEFAULT 'feature.standard'` (PRD ADR Q2 — explicit backfill, no NULL state).
- `createWorkflowRun(params)` accepts optional `flowId?: FlowId`; default `'feature.standard'` is applied at the API layer when omitted. Existing call sites (API routes, runner triggers) need no changes for V1-equivalent runs (PRD AC-14).
- `runWorkflow` reads `run.flowId` and looks up `FLOW_REGISTRY[run.flowId]`. If the entry is missing the run aborts with a clear error rather than falling back — defensive `?? 'feature.standard'` shortcuts in the orchestrator are forbidden (PRD ADR Q2 consequence).

#### `executeXxx(ctx: RunCtx)` invariants

- All five `executeXxx` share a single `RunCtx` interface, declared above `cmdOrchestrate` and **not exported** (PRD R14).
- `ctx.ok` is a boxed `{ value: boolean }`. Mutate `ctx.ok.value = false` to mark the run failed. Most failure paths *also* throw (so the outer catch sets it again) — the only ok-without-throw path is `executeKnowledgePromotion` on `knowledge_gate` rejection, which preserves the V1 quirk of letting the run reach `finally` cleanly while still reporting failure.
- `executeXxx` MUST NOT close over outer `cmdOrchestrate` state for run-scoped data — read everything through `ctx`. Closures over module-level helpers (`api`, `mustSkill`, `awaitApproval`, etc.) are fine and expected.
- Adding a new captured field: extend `RunCtx`, populate at construction site, then read inside `executeXxx`. Do not introduce a parallel ctx-like struct.

#### Adding a new flow (W2-3 onwards)

1. Add the new id to the `FlowId` literal union in `packages/shared/src/types/workflow.ts`.
2. Append an entry to `FLOW_REGISTRY` in `apps/runner/src/flows/registry.ts`. `Readonly<Record<FlowId, FlowDef>>` exhaustiveness will trip `tsc --noEmit` if you forget.
3. Update / add `dispatchStep` cases if the new flow introduces a `WorkflowStage` value not handled yet. The default branch uses `_exhaustive: never` to enforce coverage.
4. The route layer (or coordinator decision) supplies `flowId` to `createWorkflowRun({ ..., flowId })`.
5. Pin the new flow's stage order against an out-of-band reference array in `apps/runner/test/flow-registry.test.ts` (mirroring the `feature.standard` test).

### 4. Validation & Error Matrix

- New `FlowId` literal added without registering in `FLOW_REGISTRY` -> `tsc --noEmit` fails on the `Readonly<Record<FlowId, FlowDef>>` type (the `Record` requires every union literal to have a value).
- `WorkflowStage` gains a new value but `dispatchStep` switch isn't updated -> `_exhaustive: never` assignment at the default branch fails `tsc --noEmit`.
- `run.flowId` references an id that is not in `FLOW_REGISTRY` at runtime -> `cmdOrchestrate` throws `unknown flowId in registry: <id> (run=<runId>)` before entering the for-of loop. No silent fallback.
- `workflow_runs.flow_id` somehow ends up empty (cannot happen via `createWorkflowRun`) -> the migration's defensive `UPDATE ... WHERE flow_id = ''` normalises it on next API boot. NULL never occurs because the column is `NOT NULL`.
- Modifying `feature.standard.stages` order without updating the V1 reference array in `apps/runner/test/flow-registry.test.ts` -> the `stages.map(s => s.stage) toEqual(V1_STAGE_ORDER)` assertion fails. This is the zero-regression canary.
- Reading `step.kind` / `step.skillId` inside W2-1 dispatchStep / executeXxx -> contract violation; the W2-1 ADR Q1=α explicitly leaves these as placeholders. W2-3 is the gate that flips this.
- Closing over outer `ok` (the unboxed boolean style) inside `executeXxx` -> would silently lose mutation across function boundaries. Always go through `ctx.ok.value`.

### 5. Good/Base/Bad Cases

- **Good** — `runWorkflow` lookup: `const flow = FLOW_REGISTRY[run.flowId]; if (!flow) throw ...; for (const step of flow.stages) await dispatchStep(step, ctx);`. Single point of dispatch; failure surfaces a clear error.
- **Good** — extending in W2-3: add `'feature.fastforward'` to `FlowId` union, register in `FLOW_REGISTRY` with the abbreviated stages list, add to dispatch test, route layer passes `flowId: 'feature.fastforward'`. No runner code change beyond the registry.
- **Base** — V1 feature run: route omits `flowId` -> `createWorkflowRun` defaults to `'feature.standard'` -> runner fetches the same 8-stage pipeline as V1 -> behavior byte-for-byte identical to pre-W2-1. This is the AC-2 zero-regression target.
- **Bad** — adding `??` fallback in orchestrator: `const flowId = run.flowId ?? 'feature.standard';` is a contract violation. The DB column is NOT NULL with DEFAULT and the TS field is required; runtime fallback hides bugs. Q2 ADR explicitly forbids this.
- **Bad** — reading `step.kind` to dispatch in W2-1: e.g. `if (step.kind === 'engine') { await runEngine(step) }`. The kind field is unread placeholder data in W2-1; consuming it now creates contract drift between this PR's structure and what W2-3 actually delivers. Wait for W2-3.
- **Bad** — splitting `dispatchStep` into per-stage helpers that the main loop calls: forks the dispatch surface and breaks the single-point-router invariant. Every stage MUST flow through `dispatchStep`.
- **Bad** — making `flowId` optional on `WorkflowRun` (TS) to ease fixture construction: violates the NOT NULL DB invariant and the Q3 ADR. Update fixtures instead.

### 6. References

- PRD: `.trellis/tasks/05-04-v2-w2-1-flow-registry-bootstrap/prd.md` — ADRs Q1–Q4, R1–R19, AC-1–AC-19.
- Wave 2 roadmap: `.trellis/tasks/archive/2026-05/05-04-v2-wave2-workflow-polymorphism/prd.md` — locks shared conventions across all Wave 2 child tasks.
- V2 design notes: `docs/2026-05-04-ai-native-platform-v2-design-notes.md` § 2.1 (work-type polymorphism), § 5 (Wave 2 estimates).
- Implementation: `apps/runner/src/flows/registry.ts`, `apps/runner/src/orchestrator.ts`, `packages/shared/src/types/workflow.ts`.
- Tests: `packages/shared/test/flow-registry.test.ts` (type smoke), `apps/runner/test/flow-registry.test.ts` (V1 stage-order pin).
