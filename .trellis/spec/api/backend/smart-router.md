# Smart Router (V2 W2-4)

## Scenario: rule-based flow + start_stage + knowledge + estimates recommendation for new workflow runs

### 1. Scope / Trigger

- Trigger: changes to `apps/api/src/router.ts` (recommend function), `apps/api/src/routes/router.ts` (the `POST /router/recommend` endpoint), `apps/api/src/workflow-engine.ts:createWorkflowRun` (the auto-pick integration site), or `packages/shared/src/types/router.ts` (`RouterInput` / `RouterRecommendation`).
- Adding a new flow (W2-2c+ scenarios): the router auto-picks based on `runType` + repo state; flowId rules R10 in this spec must be extended to map any new WorkflowRunType / variant.
- Schema/type changes touching `workflow_runs.start_stage` or `WorkflowRun.startStage`.
- Changes to relevant knowledge selection logic (token / matching algorithm).

### 2. Signatures

- `RouterInput` (`@ainp/shared`) — `{ projectId, title, runType, messageHistory? }`.
- `RouterRecommendation` (`@ainp/shared`) — `{ flowId, startStage, relevantKnowledge[], estimates: {timeSec, tokens}, reason, rulesFired[], confidence }`.
- `recommend(input: RouterInput): RouterRecommendation` (`apps/api/src/router.ts`) — pure function, deterministic, no side effects.
- `POST /router/recommend` body: `RouterInput` JSON → 200 with `RouterRecommendation` JSON. Read-only endpoint; no DB writes.
- `createWorkflowRun(params)` (`apps/api/src/workflow-engine.ts`) — when `params.flowId` is undefined, calls `recommend(...)` internally to fill `flowId` AND `start_stage`; user-supplied flowId still wins (skips router entirely).

### 3. Contracts

#### Decision rules (V1 = rules-only; LLM fallback Wave 3)

**R10 — flowId selection** (priority-ordered short-circuit):

1. `runType === 'bugfix'` → `flowId = 'issue.standard'` (rule id: `flow.bugfix_to_issue_standard`)
2. `runType === 'refactor'` → `flowId = 'refactor.standard'` (rule id: `flow.refactor_to_refactor_standard`)
3. `runType === 'smoke'` → `flowId = 'feature.standard'` (rule id: `flow.smoke_to_feature_standard`)
4. `runType === 'feature'` AND (`title.length < 60` OR title contains a small-change keyword from `SMALL_CHANGE_KEYWORDS = ['typo', 'rename', '改个', '小修', 'fix typo', 'simple', '一行', 'one-line', '微调']`) → `flowId = 'feature.fastforward'` (rule id: `flow.feature_short_to_fastforward` or `flow.feature_small_keyword_to_fastforward`)
5. Otherwise → `flowId = 'feature.standard'` (rule id: `flow.feature_default_standard`)

**R11 — startStage selection** (only meaningful for `feature.standard`):

1. If `flowId !== 'feature.standard'` → `startStage = null` (rule id: `startStage.short_flow_no_skip`). Other flows are short and run head-to-tail.
2. Else if any accepted KnowledgeArtifact with `kind='design'` matches title keywords → `startStage = 'implementation'` (rule id: `startStage.has_accepted_design`).
3. Else if any accepted KnowledgeArtifact with `kind='requirement'` matches title keywords → `startStage = 'design'` (rule id: `startStage.has_accepted_requirement`).
4. Else → `startStage = null` (rule id: `startStage.no_skip`).

Keyword matching: tokenize title by `[\s\-_/.,;:!?()[]{}'"`+]+` separator, keep words ≥4 chars; check if any token is a substring of `entityId + metadata.json` (lowercased) of the candidate artifact.

**R12 — relevantKnowledge selection**:

- Source: `store.knowledgeArtifacts.byProject(projectId).filter(a => a.status === 'accepted')`.
- Score each candidate by count of overlapping keywords (same tokenizer as R11) between the title words and the candidate's `entityId + metadata.json` haystack.
- Sort descending by score; return top 5 (`KNOWLEDGE_LIMIT = 5`) with `score > 0`. Empty array if no matches.

**R13 — estimates calculation**:

- Resolve flow stages via `FLOW_REGISTRY[flowId].stages`.
- If `startStage` is non-null, slice from index of `startStage`.
- Per stage: agent kind = 90 sec / 8000 tokens; engine (and any non-agent) kind = 30 sec / 0 tokens.
- Sum across remaining stages.
- V1 uses static constants; Wave 3 will calibrate from past runs.

#### Coordinator boundary

The Coordinator (`apps/runner/src/agents/coordinator/`) is the **upstream intent classifier** — it produces `routeCase + runType` from text. Coordinator does NOT call the router. Router consumes Coordinator's `runType` as one signal among many. Coordinator and Router are independent modules, in different packages, with non-overlapping responsibilities.

#### createWorkflowRun integration

```ts
// inside createWorkflowRun(params)
let flowId = params.flowId;
let startStage: WorkflowStage | null = params.startStage ?? null;

if (flowId === undefined) {
  // Auto-pick path: router fills flowId + startStage.
  const rec = recommend({
    projectId: params.projectId,
    title: params.title,
    runType: params.type,
  });
  flowId = rec.flowId;
  startStage = rec.startStage;
  // Audit: record router recommendation in workflow_run.created payload.
}
// else: explicit user-supplied flowId wins; router never called.

const run: WorkflowRun = { ..., flowId, startStage, ... };
```

User-supplied `body.flowId` always wins (W2-1 ADR Q3 contract preserved).

### 4. Validation & Error Matrix

- `POST /router/recommend` body missing `projectId` → HTTP 400 with `{error: 'projectId required'}`.
- `POST /router/recommend` body missing `runType` → HTTP 400 with `{error: 'runType required'}`.
- `POST /router/recommend` body's `runType` is not a registered `WorkflowRunType` → HTTP 400.
- `recommend(input)` returning a `flowId` not in FLOW_REGISTRY → impossible at runtime (FlowId is a literal union, tsc enforces); if it ever happens it's a bug in the rules table.
- `recommend(input)` returning a `startStage` not present in the chosen `flow.stages` → orchestrator's `runWorkflow()` throws `unknown startStage in flow` at run start (defensive). Router's R11 rules only emit stages that exist in `feature.standard`, so this is a programming error if encountered.
- Router throwing on internal error → `createWorkflowRun()` does NOT swallow; the API request fails with 500. (Pure-function router shouldn't throw; catch-all is purely defensive.)

### 5. Good/Base/Bad Cases

- **Good** — V1 release: `recommend({ runType: 'bugfix', title: 'NPE in payment service', projectId })` → `flowId='issue.standard'`, `startStage=null`, `rulesFired=['flow.bugfix_to_issue_standard', 'startStage.short_flow_no_skip']`, deterministic. UI displays "issue.standard / start from beginning / 6 stages / ~360 sec / ~32K tokens".

- **Good** — Smart skip: `recommend({ runType: 'feature', title: 'implement export feature design', projectId })` where project has accepted DSN-export → `flowId='feature.standard'`, `startStage='implementation'`. Skips context_pack/requirement/design. Estimates reduced accordingly.

- **Base** — Auto-pick on missing flowId: `POST /workflow-runs body={projectName, type: 'feature', title: 'fix typo'}` → router fills `flowId='feature.fastforward'` → run created with that flow. User saw no "smart routing" UX but got the right flow auto-magically.

- **Base** — UI dry-run: User in UI types title → debounced `POST /router/recommend` returns `RouterRecommendation` → UI shows "we recommend feature.fastforward (~240 sec / ~24K tokens)" → user clicks "use" → `POST /workflow-runs body={..., flowId: 'feature.fastforward'}` → router skipped (explicit flowId wins).

- **Bad** — Forgetting to update R10 when adding a new WorkflowRunType: a new runType arriving from Coordinator falls through R10 cases 1-3, doesn't match feature, lands at the default in step 5 (`feature.standard`). Behavior may be surprising. Mitigation: when adding a WorkflowRunType, R10 rules table MUST be extended (this spec doc + rules.ts).

- **Bad** — Hard-coding flowId or startStage outside the rules table: any rule that doesn't append to `rulesFired[]` makes router decisions unauditable. Always go through the rules path; never short-circuit to `return { flowId: '...', ... }` without recording the rule id.

- **Bad** — Calling `recommend()` from outside `apps/api/`: the router is server-side ONLY. Runner-side code that needs flow recommendations should let `createWorkflowRun()` auto-pick or call `POST /router/recommend` over HTTP. Direct cross-package import is a layering violation.

- **Bad** — Passing user-supplied `body.flowId` AND also computing router output: redundant work + risk of inconsistency. The integration MUST short-circuit when flowId is supplied — router is the fallback, not the augmentation.

### 6. References

- W2-4 PRD: `.trellis/tasks/05-05-v2-w2-4-smart-router/prd.md` — ADRs Q1=C (V1 scope), Q2=C (api-side + endpoint), Q3=B (DB column + slice), Q4=A (auto-pick + dry-run), Q5=A (rules-only). R1-R35, AC-1-AC-23.
- Wave 2 roadmap: `.trellis/tasks/archive/2026-05/05-04-v2-wave2-workflow-polymorphism/prd.md` § "W2-4" (smart router scope + 4-PR estimate).
- V2 design notes: `docs/2026-05-04-ai-native-platform-v2-design-notes.md` § 1.3 (流程僵化短板) / § 3.2 (Routing over Prescribing) / § 4.2 (3 工作流).
- Implementation: `apps/api/src/router.ts`, `apps/api/src/routes/router.ts`, `apps/api/src/workflow-engine.ts:createWorkflowRun`, `packages/shared/src/types/router.ts`, `packages/shared/src/flows/registry.ts` (FLOW_REGISTRY).
- Tests: `apps/api/test/router.test.ts` (8 unit cases for R10/R11/R12/R13), `apps/api/test/router-route.test.ts` (endpoint integration), `apps/api/test/workflow-engine.test.ts` (createWorkflowRun integration).
- Spec cross-ref: `.trellis/spec/runner/backend/flow-registry.md` (FLOW_REGISTRY contracts; § Smart Router will append router-side considerations in PR4).
- Coordinator (upstream intent classifier): `apps/runner/src/agents/coordinator/` — independent of router, NOT modified by W2-4 except for the `CoordinatorAction.runType` literal-mirror fix (+= 'refactor'; W2-2b oversight).
