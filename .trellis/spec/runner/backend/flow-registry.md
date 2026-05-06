# Flow Registry & runWorkflow Dispatch

## Scenario: declarative flow definitions driving the orchestrator

### 1. Scope / Trigger

- Trigger: changes to `apps/runner/src/flows/registry.ts`, `apps/runner/src/orchestrator.ts` (the `cmdOrchestrate` body, `dispatchStep`, or any `executeXxx` step implementation), or the `FlowId` / `FlowDef` / `StageStep` types in `packages/shared/src/types/workflow.ts`.
- Adding a new flow variant — the new entry must land in `FLOW_REGISTRY` and the new id must be added to the `FlowId` literal union AND to the `KNOWN_FLOW_IDS` validation lists at the trust boundaries.
- Schema/type changes touching `workflow_runs.flow_id` or `WorkflowRun.flowId`.
- Changes to the trust-boundary FlowId validation lists in `apps/api/src/routes/workflow-runs.ts` and `apps/runner/src/index.ts`.

### 2. Signatures

- `FlowId` (`@ainp/shared`) — string-literal union, **not** a free `string`. Today: `'feature.standard' | 'feature.fastforward' | 'issue.standard' | 'refactor.standard'`.
- `StageStep` (`@ainp/shared`) — `{ stage: WorkflowStage; kind: StageStepKind; skillId?: string }`. `kind` is `'agent' | 'gate' | 'human' | 'engine'`.
- `FlowDef` (`@ainp/shared`) — `{ id: FlowId; kind: WorkflowRunType; description: string; stages: readonly StageStep[] }`.
- `FLOW_REGISTRY` (`apps/runner/src/flows/registry.ts`) — `Readonly<Record<FlowId, FlowDef>>`. Single source of truth for V2 flow definitions.
- `dispatchStep(step: StageStep, ctx: RunCtx): Promise<void>` — inner function of `cmdOrchestrate`, single-point router.
- `executeImplementation(c: RunCtx)` / `executeBuildTest(c)` / `executeAcceptance(c)` / `executeCompletion(c)` / `executeKnowledgePromotion(c)` — inner functions of `cmdOrchestrate`, 1:1 lifts of the V1 inline blocks.
- `RunCtx` — file-private interface in `orchestrator.ts`; carries `project`, `run`, `workspace`, `backend`, `tools`, `opts`, `runArtifactsDir`, `inputs`, `inputArtifactIds`, `draftsToPromote`, `ok` across step implementations. **Not exported**.
- `OrchestrateOpts.flowId?: FlowId` (`apps/runner/src/orchestrator.ts`) — W2-3 PR2: optional flow id on the runner CLI/orchestrator entry; forwarded to `api.createWorkflowRun`.
- `api.createWorkflowRun({ projectName, title, type?, sourceBranch?, flowId? })` (`apps/runner/src/api-client.ts`) — runner-side HTTP wrapper; threads flowId through the body.
- `POST /workflow-runs` (`apps/api/src/routes/workflow-runs.ts`) — body shape includes `flowId?: string`. Validated against `KNOWN_FLOW_IDS`; unknown values return HTTP 400. Forwards to `createWorkflowRun({ ..., flowId })`.
- `runner orchestrate --flow-id <FlowId>` — CLI flag (W2-3 PR2). `parseFlowIdFlag` exits 2 on unknown value.

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

#### Stage layout for `feature.fastforward` (W2-3)

Strict 4-stage subset of `feature.standard` — the V2 doc § 1.3 "patch a semicolon shouldn't walk 9 stages" use case. Pinned by the same test file (`apps/runner/test/flow-registry.test.ts`) against its own out-of-band reference array (W2-3 task PRD AC-6):

1. `implementation` (kind=`agent`, skillId=`cs-feat-impl`) — `executeImplementation`
2. `build_test` (kind=`engine`) — `executeBuildTest`
3. `review` (kind=`agent`, skillId=`cs-feat-accept`) — `runStage('review', ...)` then `executeAcceptance(ctx)` inline. Human acceptance gate is preserved; fastforward MUST NOT bypass human ack.
4. `completion` (kind=`engine`) — `executeCompletion`

Skipped from `feature.standard`: `context_pack` (heavy profile + knowledge load), `requirement` (no PRD), `design` (no design doc), `knowledge` (small changes rarely produce reusable knowledge).

Known degradation: the implementation skill on a fastforward run won't see `inputs['project_profile.md']` / `inputs['accepted_knowledge.md']` (context_pack didn't run). The skill is expected to handle absent inputs gracefully — `invokeSkill`'s `inputArtifactIds` mapping already filters undefined entries via `.filter((id): id is string => Boolean(id))`. Likewise `executeAcceptance` iterates `c.draftsToPromote` which is empty (no requirement/design ran), so the post-acceptance promotion loop is a no-op for fastforward runs.

Resolved (W2-2a): `acceptance_gate` (the traceability gate inside `executeAcceptance`) was originally designed assuming requirement/design artifacts exist, which would have failed on fastforward runs. W2-2a made `runAcceptanceTraceabilityGate` stage-history-aware: if no `StepRun` for `requirement` / `design` exists on the workflow run, the corresponding rule returns `pass` with `"not applicable: ... stage not in this flow"` instead of failing. The fastforward and issue flows both rely on this. See "Stage layout for `issue.standard`" and § 4 below.

#### Stage layout for `issue.standard` (W2-2a)

Six steps, in this exact order — pinned by `apps/runner/test/flow-registry.test.ts` against an out-of-band reference array (W2-2a PRD AC-7):

1. `report` (kind=`agent`, skillId=`cs-issue-report`) — produces a structured bug report (`report.md`, kind=`'other'`) via `executeReport(c)` inner function. PRD ADR Q4=B: SkillSpec `skill.issue_report` ships placeholder instructions sufficient for the LLM to emit schema-correct artifacts; prompt-tuning is a follow-up.
2. `analyze` (kind=`agent`, skillId=`cs-issue-analyze`) — produces root-cause + 2-3 fix options (`analysis_doc.md`, kind=`'other'`) via `executeAnalyze(c)` inner function. Same SkillSpec placeholder caveat.
3. `implementation` (kind=`agent`, skillId=`cs-issue-fix`) — `executeImplementation`. **Reuses** the same stage / executor / SkillSpec as `feature.standard`; the different prompt for "issue fix" vs "feature impl" is a `skillId` concern handled by W2-4 routing — W2-1 ADR Q1=α leaves `skillId` as a placeholder. PRD ADR Q1=A. The `skill.implementation.inputs[design.md].required` was relaxed from `true` to `false` so issue runs (which have no design step) are still schema-valid; the implementation skill instructions explicitly fall back to `analysis_doc.md` / `report.md`.
4. `build_test` (kind=`engine`) — `executeBuildTest`.
5. `review` (kind=`agent`, skillId=`cs-feat-accept`) — same dual-half (review agent + inline `executeAcceptance`) as `feature.standard` / `feature.fastforward`.
6. `completion` (kind=`engine`) — `executeCompletion`.

Skipped from `feature.standard`: `context_pack` (issue work has no project-wide profile reload need), `requirement` (no PRD), `design` (no design doc), `knowledge` (a single bug fix rarely produces reusable knowledge — V2 § 4.2).

`FlowDef.kind = 'bugfix'` (W2-2a PRD ADR Q2=A). The naming asymmetry (`run.type='bugfix'` vs `run.flowId='issue.standard'`) is deliberate: `'bugfix'` is the existing `WorkflowRunType` the Coordinator (`apps/runner/src/agents/coordinator/rules.ts`) already routes bug-shaped inputs to; W2-2a does NOT rename `'bugfix'` → `'issue'` (cross-task V1→V2 cleanup, follow-up). W2-4 router will provide the type → flowId mapping (`'bugfix' → 'issue.standard'`).

Acceptance gate rule for issue.standard: `runAcceptanceTraceabilityGate` is **stage-history-aware** (W2-2a PRD ADR Q3=C). Since `issue.standard` schedules NO `requirement` / `design` step, the gate's `acceptance.requirement_present` / `acceptance.design_present` rules return `pass` with note `"not applicable: ... stage not in this flow"`. The other three rules (`diff_present` / `review_present` / `test_gate_passed`) still apply. Same mechanism gives `feature.fastforward` a passing acceptance gate (W2-3 R-Risk-2 fix as side effect).

Knowledge promotion: `c.draftsToPromote` is naturally empty on `issue.standard` runs (no `requirement` / `design` step writes into it), so the `executeAcceptance` post-acceptance promotion loop is a no-op. W2-2a does NOT extend `KnowledgeArtifactKind` or `promoteAcceptedDraftToKnowledge` to handle `analysis_doc` / `report` (PRD ADR Q5=A — issue-specific analysis is not project knowledge).

#### Stage layout for `refactor.standard` (W2-2b)

Six steps, in this exact order — pinned by `apps/runner/test/flow-registry.test.ts` against an out-of-band reference array (W2-2b PRD AC-9):

1. `scan` (kind=`agent`, skillId=`cs-refactor-scan`) — produces a refactor scan (`scan_doc.md`, kind=`'other'`) via `executeScan(c)` inner function. Identifies candidate refactor points + priority. PRD ADR Q4 (inherited from W2-2a B): SkillSpec `skill.refactor_scan` ships placeholder instructions; prompt-tuning is a follow-up.
2. `plan` (kind=`agent`, skillId=`cs-refactor-design`) — produces refactor plan (`refactor_plan.md`, kind=`'other'`) via `executePlan(c)` inner function. **NEW WorkflowStage** (PRD ADR Q1=B) — distinct from feature `'design'` to avoid the `design_gate` REQ-### / AC-### tracing assumptions; refactor plan does NOT cite REQ. Same SkillSpec placeholder caveat.
3. `implementation` (kind=`agent`, skillId=`cs-refactor-apply`) — `executeImplementation`. **Reuses** the same stage / executor / SkillSpec as `feature.standard` and `issue.standard`; the different prompt for "refactor apply" (preserve behaviour) vs "feature impl" / "issue fix" is a `skillId` concern handled by W2-4 routing — W2-1 ADR Q1=α leaves `skillId` as a placeholder. The `skill.implementation.instructions` was extended in W2-2b PR1 with "If `refactor_plan.md` is present, follow it as primary reference and preserve behaviour — do NOT introduce visible changes."
4. `build_test` (kind=`engine`) — `executeBuildTest`.
5. `review` (kind=`agent`, skillId=`cs-feat-accept`) — same dual-half (review agent + inline `executeAcceptance`) as other flows.
6. `completion` (kind=`engine`) — `executeCompletion`.

Skipped from `feature.standard`: `context_pack` (refactor scope is internal restructure, no project-wide profile reload), `requirement` (no PRD), `design` (uses `'plan'` instead, see above), `knowledge` (a single refactor rarely produces reusable project knowledge — V2 § 4.2).

`FlowDef.kind = 'refactor'` (W2-2b PRD ADR Q2=A). Unlike W2-2a which reused `'bugfix'` for `issue.standard` (because Coordinator already produces it), W2-2b **adds `'refactor'`** to `WorkflowRunType`. Rationale: Coordinator does NOT currently produce a refactor signal (RouteCase has `feature_clear / feature_brainstorm / bugfix / roadmap_needed / unclear`), so reusing 'feature' or 'bugfix' would manufacture future ambiguity for W2-4 routing. Adding the proper type keeps `<work_kind>.<variant>` naming symmetric (`refactor.standard` / kind = `'refactor'`). Affects 3 mirror sites: `apps/runner/src/api-client.ts` (literal × 2) + `apps/web/src/main.ts` (UI literal + select option).

Acceptance gate rule for refactor.standard: same as `issue.standard` — `runAcceptanceTraceabilityGate`'s stage-history-aware logic (W2-2a PR2) auto-adapts. refactor.standard schedules NO `requirement` / `design` step, so `acceptance.requirement_present` / `acceptance.design_present` rules return `pass` with N/A note. The `diff_present` / `review_present` / `test_gate_passed` rules still apply. Zero gate-engine changes in W2-2b.

Knowledge promotion: identical handling to `issue.standard` — `c.draftsToPromote` is naturally empty on `refactor.standard` runs (no `requirement` / `design` step writes into it). W2-2b does NOT extend `KnowledgeArtifactKind` or `promoteAcceptedDraftToKnowledge` (PRD ADR Q5=A inherited).

#### Smart Router (W2-4)

`apps/api/src/router.ts:recommend(input)` is a pure function that maps a `RouterInput` (`{ projectId, title, runType }`) to a `RouterRecommendation` (`{ flowId, startStage, relevantKnowledge[], estimates, reason, rulesFired, confidence }`). The full canonical contract — rule list R10-R13, audit + UI surfaces, Wave 3 follow-up — lives in `.trellis/spec/api/backend/smart-router.md`. This section captures only the FLOW_REGISTRY-facing semantics.

Trigger paths (W2-4 PR3):
- `createWorkflowRun({ projectId, type, title })` with no `flowId` calls `recommend()` for audit/preview parity, but created runs use conservative defaults (`feature.standard` for feature/smoke, `issue.standard` for bugfix, `refactor.standard` for refactor) and `startStage = null` unless explicitly supplied. The `workflow_run.created` audit row carries a `routerRecommendation: { flowId, startStage, rulesFired }` field; explicit-flowId callers get the field absent.
- `POST /router/recommend` (`apps/api/src/routes/router.ts`) is the read-only HTTP surface. UI / automation can dry-run the recommendation without creating a run. Validates `projectId` (must be registered) + `runType` (must be a known `WorkflowRunType`); rejects unknown values with HTTP 400.

`startStage` semantics (W2-4 PR2):
- `WorkflowRun.startStage: WorkflowStage | null` — `null` means "start from the flow's first stage" (V1 default; preserves byte-for-byte equivalent runs for legacy callers).
- `workflow_runs.start_stage TEXT` is nullable; the migration is idempotent (mirrors W2-1 PR3's `flow_id` migration template).
- `cmdOrchestrate` slices `flow.stages` via the exported pure helper `sliceStagesFromStartStage({ flowId, runId, stages, startStage })`. Helper contract:
  - null/undefined → returns `stages` unchanged.
  - matching index N → returns `stages.slice(N)`; logs `[runner] starting from stage X (skipping N earlier stage(s))` when `N > 0`.
  - present but not in flow → throws `unknown startStage in flow: <stage> (flow=<flowId>, run=<runId>)`. **Never silently skip** (PRD R-Risk-1).
- Only `feature.standard` carries non-null `startStage` recommendations today; the other three flows are short and run head-to-tail. Adding a new long flow that supports skip-prefix means: (1) verifying `recommendStartStage` in `apps/api/src/router.ts` actually emits non-null for it; (2) updating router unit tests; (3) optionally extending the spec doc here.

UI override (W2-4 PR4):
- The 智能推荐 card on the task creation form posts `/router/recommend` on title blur (debounced 400ms) and renders the recommendation as a preview. The Coordinator → workflow_request → workflow_run pipeline does **not** silently apply preview `(flowId, startStage)` skips; UI override of `(flowId, startStage)` is a follow-up that requires extending the workflow_request body (out of W2-4 scope per PRD).
- `POST /workflow-runs` body now accepts an optional `startStage?: string` field, validated against `WorkflowStage`. Direct CLI / runner triggers (skipping the Coordinator queue) can already plumb the override end-to-end.

#### Entry contract — `flowId` plumbing

- `WorkflowRun.flowId: FlowId` is **required** in TypeScript and **NOT NULL** in the `workflow_runs.flow_id` column with `DEFAULT 'feature.standard'` (PRD ADR Q2 — explicit backfill, no NULL state).
- `createWorkflowRun(params)` accepts optional `flowId?: FlowId`; when omitted, the API applies conservative run-type defaults (`feature.standard` for feature/smoke, `issue.standard` for bugfix, `refactor.standard` for refactor). Existing call sites (API routes, runner triggers) need no changes for V1-equivalent feature runs (PRD AC-14).
- `runWorkflow` reads `run.flowId` and looks up `FLOW_REGISTRY[run.flowId]`. If the entry is missing the run aborts with a clear error rather than falling back — defensive `?? 'feature.standard'` shortcuts in the orchestrator are forbidden (PRD ADR Q2 consequence).
- **Trust-boundary validation (W2-3 PR2)**: each external entry into the system that accepts a flowId carries its own `KNOWN_FLOW_IDS` allow-list. There are two:
  - `apps/api/src/routes/workflow-runs.ts` — `isFlowId(value)` rejects unknown bodies with HTTP 400.
  - `apps/runner/src/index.ts` — `parseFlowIdFlag` rejects unknown CLI args with `process.exit(2)`.
  Both lists MUST stay in sync with the `FlowId` union in `@ainp/shared`. Adding a new flow means updating: (1) the union; (2) FLOW_REGISTRY; (3) both KNOWN_FLOW_IDS lists; (4) the `KNOWN_FLOW_IDS` mention here in the spec doc.
- **Trigger paths**:
  - HTTP: `POST /workflow-runs` body `{ ..., flowId: 'feature.fastforward' }` → route forwards → engine writes `workflow_runs.flow_id` → runner reads `run.flowId`.
  - Runner CLI: `runner orchestrate --project foo --title bar --flow-id feature.fastforward` → `parseFlowIdFlag` validates → `cmdOrchestrate({ flowId })` → `api.createWorkflowRun({ flowId })` → same body path.
  - Runner watch loop (`cmdWatch`): currently does NOT supply flowId; feature requests default to `'feature.standard'`. Applying a fastforward/startStage recommendation requires an explicit future override path.
  - Runner smoke (`cmdRun`): does NOT use FLOW_REGISTRY at all (it runs a single whitelisted command, not a pipeline).

#### `executeXxx(ctx: RunCtx)` invariants

- All five `executeXxx` share a single `RunCtx` interface, declared above `cmdOrchestrate` and **not exported** (PRD R14).
- `ctx.ok` is a boxed `{ value: boolean }`. Mutate `ctx.ok.value = false` to mark the run failed. Most failure paths *also* throw (so the outer catch sets it again) — the only ok-without-throw path is `executeKnowledgePromotion` on `knowledge_gate` rejection, which preserves the V1 quirk of letting the run reach `finally` cleanly while still reporting failure.
- `executeXxx` MUST NOT close over outer `cmdOrchestrate` state for run-scoped data — read everything through `ctx`. Closures over module-level helpers (`api`, `mustSkill`, `awaitApproval`, etc.) are fine and expected.
- Adding a new captured field: extend `RunCtx`, populate at construction site, then read inside `executeXxx`. Do not introduce a parallel ctx-like struct.

#### Adding a new flow (W2-3 onwards)

Recipe — first executed by W2-3 to add `feature.fastforward`:

1. Add the new id to the `FlowId` literal union in `packages/shared/src/types/workflow.ts`.
2. Append an entry to `FLOW_REGISTRY` in `apps/runner/src/flows/registry.ts`. `Readonly<Record<FlowId, FlowDef>>` exhaustiveness will trip `tsc --noEmit` if you forget.
3. Update / add `dispatchStep` cases if the new flow introduces a `WorkflowStage` value not handled yet. The default branch uses `_exhaustive: never` to enforce coverage.
4. The route layer (or coordinator decision) supplies `flowId` to `createWorkflowRun({ ..., flowId })`.
5. Pin the new flow's stage order against an out-of-band reference array in `apps/runner/test/flow-registry.test.ts` (mirroring the `feature.standard` test).
6. **Update the trust-boundary validation lists**: add the new id to `KNOWN_FLOW_IDS` in BOTH `apps/api/src/routes/workflow-runs.ts` AND `apps/runner/src/index.ts`. Without this step the API returns 400 and the CLI exits 2 even though the registry "knows" about the flow.
7. Update this spec doc's `feature.standard` / `feature.fastforward` stage layout sections to add a parallel block describing the new flow's stages, skipped stages, known degradations.

Verify: `bun test` should grow by the new flow's tests; `bun run --filter '*' typecheck` should stay green.

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
- **Good** — W2-3 `feature.fastforward` extension (now shipped): added to `FlowId` union, registered in `FLOW_REGISTRY` with the abbreviated 4-stage list (`implementation` → `build_test` → `review` → `completion`), pinned against an out-of-band reference array, both trust-boundary `KNOWN_FLOW_IDS` lists updated, route + CLI plumbed end-to-end. No runner orchestrator code change beyond the registry — proof that W2-1's thin abstraction held.
- **Good** — W2-2a `issue.standard` extension (now shipped): same recipe with two new `WorkflowStage` values (`report` / `analyze`), two new `executeXxx` inner functions, two placeholder `SkillSpec`s, and the `skill.implementation.inputs[design.md].required` relaxed from `true` to `false` so issue runs are schema-valid. `kind: 'bugfix'` reused (no `WorkflowRunType` extension). `runAcceptanceTraceabilityGate` made stage-history-aware in the same task (PR2) so flows without requirement/design steps don't fail the traceability rules — closes W2-3 R-Risk-2 (fastforward acceptance gate) as a side benefit. Confirms W2-1 thin abstraction holds across **work-kind** extension (`feature` → `bugfix`), not just **variant** extension within `feature`.
- **Good** — W2-2b `refactor.standard` extension (now shipped): same recipe with two new `WorkflowStage` values (`scan` / `plan`), two new `executeXxx` inner functions, two placeholder `SkillSpec`s, and `skill.implementation.instructions` extended with refactor_plan fallback. **First flow to extend `WorkflowRunType`** (`+= 'refactor'`) — unlike W2-2a's `'bugfix'` reuse, refactor has no upstream Coordinator signal so adding the proper type is honest. `runAcceptanceTraceabilityGate` auto-adapts (no PR2 needed since W2-2a already shipped the stage-history-aware refactor). Result: W2-2b is the smallest of the three flow extensions (~2 PR vs W2-3's 3 PR vs W2-2a's 3 PR), proving the abstraction tightens as it accretes — each addition reuses prior infrastructure.
- **Good** — W2-4 smart-router (now shipped): `flowId` and `startStage` both become *recommendations* the API computes from `(projectId, runType, title, knowledgeArtifacts)` rather than caller-supplied parameters. Implementation paths: (1) `apps/api/src/router.ts:recommend()` pure function, rules-only V1; (2) `POST /router/recommend` for UI dry-run; (3) `createWorkflowRun()` calls `recommend()` exactly when `params.flowId === undefined`; (4) `cmdOrchestrate` honors `run.startStage` via the pure helper `sliceStagesFromStartStage` (throws on unknown stage — never silently skips). Explicit `body.flowId` / explicit `params.flowId` always wins. Confirms the W2-1 thin abstraction is robust enough to support routing layered on top without touching the orchestrator's per-stage execution code.
- **Base** — V1 feature run: route omits `flowId` -> `createWorkflowRun` defaults to `'feature.standard'` -> runner fetches the same 8-stage pipeline as V1 -> behavior byte-for-byte identical to pre-W2-1. This is the AC-2 zero-regression target.
- **Base** — fastforward triggered via API: `POST /workflow-runs { ..., flowId: 'feature.fastforward' }` -> 201 with `run.flowId === 'feature.fastforward'` -> runner picks up the 4-stage subset -> 4 dispatched stages.
- **Bad** — adding `??` fallback in orchestrator: `const flowId = run.flowId ?? 'feature.standard';` is a contract violation. The DB column is NOT NULL with DEFAULT and the TS field is required; runtime fallback hides bugs. Q2 ADR explicitly forbids this.
- **Bad** — extending `FLOW_REGISTRY` but forgetting to update `KNOWN_FLOW_IDS` in routes/index.ts: registry "has" the flow internally but external entries reject it (HTTP 400 / CLI exit 2). Drift between the source-of-truth (FLOW_REGISTRY) and the trust-boundary lists is a real maintenance risk; the "Adding a new flow" recipe step 6 is mandatory.
- **Bad** — reading `step.kind` to dispatch in W2-1 / W2-3: e.g. `if (step.kind === 'engine') { await runEngine(step) }`. The kind field is unread placeholder data through W2-3; consuming it now creates contract drift between the structure and what W2-4 will actually deliver. Wait for W2-4.
- **Bad** — splitting `dispatchStep` into per-stage helpers that the main loop calls: forks the dispatch surface and breaks the single-point-router invariant. Every stage MUST flow through `dispatchStep`.
- **Bad** — making `flowId` optional on `WorkflowRun` (TS) to ease fixture construction: violates the NOT NULL DB invariant and the Q3 ADR. Update fixtures instead.
- **Bad** — adding `requirement` / `design` to fastforward to "fix" a downstream gate or skill failure: defeats the fast-forward semantics. Fix the downstream component instead.

### 6. References

- W2-1 PRD: `.trellis/tasks/archive/2026-05/05-04-v2-w2-1-flow-registry-bootstrap/prd.md` — ADRs Q1–Q4, R1–R19, AC-1–AC-19.
- W2-3 PRD: `.trellis/tasks/archive/2026-05/05-05-v2-w2-3-fastforward-channel/prd.md` — ADRs Q1–Q4 (4-stage subset / union extension / body.flowId / CLI --flow-id), R1–R17, AC-1–AC-14.
- W2-2a PRD: `.trellis/tasks/archive/2026-05/05-05-v2-w2-2a-issue-standard-flow/prd.md` — ADRs Q0–Q5 (split / stages / 'bugfix' kind / stage-history acceptance / placeholder SkillSpecs / no knowledge promotion), R1–R26, AC-1–AC-25.
- W2-2b PRD: `.trellis/tasks/05-05-v2-w2-2b-refactor-standard-flow/prd.md` — ADRs Q1 (stages: scan / plan / implementation reuse) / Q2 (`WorkflowRunType += 'refactor'`); inherits Q0/Q3/Q4/Q5 from W2-2a. R1–R28, AC-1–AC-23.
- W2-4 PRD: `.trellis/tasks/05-05-v2-w2-4-smart-router/prd.md` — ADRs Q1–Q5 (recommendation shape / server-side endpoint / startStage column + slice / original auto-pick scope later narrowed to advisory creation / rules-only V1). R1–R35, AC-1–AC-23.
- Smart Router spec: `.trellis/spec/api/backend/smart-router.md` — canonical R10–R13 rule reference + audit/UI surface.
- Wave 2 roadmap: `.trellis/tasks/archive/2026-05/05-04-v2-wave2-workflow-polymorphism/prd.md` — locks shared conventions across all Wave 2 child tasks.
- V2 design notes: `docs/2026-05-04-ai-native-platform-v2-design-notes.md` § 1.3 (V1 short-list — fastforward motivation), § 2.1 (work-type polymorphism), § 5 (Wave 2 estimates).
- Implementation: `apps/runner/src/flows/registry.ts`, `apps/runner/src/orchestrator.ts`, `apps/runner/src/api-client.ts`, `apps/runner/src/index.ts`, `apps/api/src/routes/workflow-runs.ts`, `packages/shared/src/types/workflow.ts`.
- Tests: `packages/shared/test/flow-registry.test.ts` (type smoke), `apps/runner/test/flow-registry.test.ts` (V1 + fastforward stage-order pin), `apps/api/test/workflow-runs-route.test.ts` (W2-3 PR2 route plumbing).
