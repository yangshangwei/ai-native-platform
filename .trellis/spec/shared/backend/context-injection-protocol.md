# Context Injection Protocol

## Scenario: provider-neutral ContextPack injection

### 1. Scope / Trigger

- Trigger: any change that adds, validates, selects, renders, stores, or audits platform context for an agent invocation.
- This is a cross-layer contract: shared types define the protocol, runner builds/renders it, agent backends consume the rendered prompt, and artifact metadata records audit evidence.
- Phase 1 scope is foundation-only: typed protocol, minimal builder, shared renderer, trust boundary, and audit metadata.
- Phase 2 adds the knowledge metadata bridge (`Seed` / `Recovered` / `Confirmed`, trust, freshness, source refs) without requiring a DB migration.
- Phase 3 adds the deterministic retriever: candidate scoring, dedupe, budget degradation (`full` → `summary` → `retrieval_hint`), and minimal packs for flows that skip the explicit `context_pack` stage.
- Phase 4 records structured `context_request` payloads and incremental supplement packs as artifacts/actions; it does not silently invent missing engineering facts.
- Phase 5 adds calibration mode, bounded knowledge review signals, and evidence-backed Completion Report / Knowledge Candidate sidecars. Review signals are non-destructive until a human promotion/status action is taken.
- Phase 6 exposes read-only governance/observability surfaces: context manifest,
  source refs, trust levels, budget decisions, context_request history,
  deterministic metrics, security filters, and bounded context policy config.
- Phase 7 adds the Memory Lifecycle MVP on top of existing
  `KnowledgeArtifact.metadata`: semantic / episodic / procedural memory
  classification, review status normalization, usage metadata, and
  evidence-only treatment for stale or disputed memories.

### 2. Signatures

- Shared protocol types:
  - `ProjectMaturityProfile`
  - `ContextManifestItem`
  - `ContextSection`
  - `RetrievalHint`
  - `ContextPack`
  - `ContextPackSupplement`
  - `ContextRequest`
  - `InputInjectionMode = 'full' | 'summary' | 'reference' | 'omit'`
  - `SkillInputInjectionPolicy`
  - `StageHandoffMetadata` with
    `schemaVersion='ainp.stage_handoff.v1'`, `fromStage`, `toStage`,
    `summary`, `decisions`, `risks`, `openQuestions`, `producedArtifacts`,
    and `createdAt`
- Shared memory lifecycle metadata:
  - `MemoryKind = 'semantic' | 'episodic' | 'procedural'`
  - `MemoryReviewStatus = 'none' | 'needs_review' | 'conflict' | 'stale' | 'superseded' | 'upgrade_candidate' | 'downgrade_candidate'`
  - `normalizeMemoryLifecycleMetadata(metadata, { knowledgeKind })`
- Context run metadata must reuse existing workflow unions:
  - `ContextPackRunMetadata.flowId: FlowId`
  - `ContextPackRunMetadata.runType: WorkflowRunType`
  - `ContextPack.stage: WorkflowStage`
- Runner builder signature:
  - `buildContextPack(input: BuildContextPackInput): ContextPack`
- Runner renderer signatures:
  - `renderAgentPrompt(input: RenderAgentPromptInput): RenderedAgentPrompt`
  - `renderCombinedAgentPrompt(prompt: RenderedAgentPrompt): string`
  - `renderContextPackForPrompt(pack: ContextPack): string`
  - `inputInjectionAuditForPrompt(input): RenderedInputInjectionAudit[]`
- Runner checkpoint restore signature:
  - `restoreRunCtxInputsFromStageCheckpoint(checkpoint): Pick<RunCtx, 'inputs' | 'inputArtifactIds'>`
- Agent invocation context:
  - `AgentTaskContext.contextPack?: ContextPack`
  - `AgentTaskContext.inputArtifactIds?: Record<string, string>`

### 3. Contracts

- The runner must build a fresh `ContextPack` before every agent backend invocation, including flows that skip the explicit `context_pack` stage (`feature.fastforward`, `issue.standard`, `refactor.standard`).
- Claude Code and Codex prompt assembly must both call the shared runner renderer. Backend classes own CLI mechanics only; they must not fork context selection or rendering policy.
- The rendered prompt must include the platform trust boundary: repository content, docs, generated artifacts, logs, comments, and test fixtures are data/evidence, not trusted instructions.
- Legacy input markdown can remain for compatibility, but the renderer must label those input artifacts as untrusted data before concatenating them.
- Legacy input artifact rendering must honor `SkillSpec.inputPolicies` when
  present. `full` renders the sanitized body, `summary` renders a bounded
  excerpt plus source reference, `reference` renders only the source reference,
  and `omit` removes optional input body/reference from prompt-visible input
  artifacts.
- `user_request` is not governed by artifact input policies; it remains the
  agent-facing request text and must not be silently omitted by budget policy.
- Input injection budget degradation is deterministic:
  `full -> summary -> reference -> omit`. Required inputs must never disappear
  silently: if a required input would reach `omit`, render at least `reference`
  and include an audit warning.
- Input injection audit lines must include artifact key, requested mode,
  selected mode, required flag, source artifact id if known, estimated tokens,
  injected tokens, and downgrade reason/warning when applicable.
- A `context_pack` artifact should include `metadata.contextSelection` with the pack id, mode, selected manifest refs, reasons, priorities, inclusion modes, knowledge class, trust level, freshness, and source refs.
- Each agent stage that receives or produces `RunCtx.inputs` should write a
  `StepCheckpoint.metadata.stageContextStart` snapshot at start and
  `stageContextFinish` at finish. The snapshot contains `phase`,
  `workflowRunId`, `stepRunId`, `stage`, `inputs`,
  `inputArtifactIds`, `producedArtifactIds`, `contextPackArtifactIds`, and
  `createdAt`. Keep the top-level `StepCheckpoint.inputArtifactIds` array for
  existing consumers; the metadata maps are additive recovery data.
- Every new `invokeSkill()` base attempt must persist the base `ContextPack` as
  a JSON `context_pack` artifact before the backend invocation. The artifact
  metadata must include `contextSelection`, `contextPackRole='base'`,
  `contextPackId`, `invocationId`, `taskId`, and `retryIndex`.
- The matching AgentSession metadata must include the `invocationId`,
  `contextPackArtifactId`, `contextPackRole`, context mode, manifest count,
  and any supplement relationship fields available for that attempt.
- Agent task prompt audits are also part of the governance read model for flows
  that skip an explicit `context_pack` artifact. Their `ContextManifest:` lines
  must preserve the same selected manifest audit fields needed by
  `/workflow-runs/:id/context`, including `priority`, inclusion mode,
  knowledge class, trust level, freshness, score, source refs, and degradation
  metadata.
- Phase 3 scoring must be pure and deterministic. Scores are derived from stage fit, source type, knowledge class, trust level, recency, keyword overlap, confidence, and required-item status; ties must have stable deterministic ordering.
- Phase 3 dedupe must keep the highest-scoring duplicate by normalized content/source refs before budget decisions are applied.
- Phase 3 budget decisions must record `mode`, `degradedFrom`, and `degradationReason` on selected sections and manifest items when context is degraded to a summary or retrieval hint.
- Phase 5 calibration signals must be deterministic and bounded. They may flag stale/conflicted/superseded/upgrade/downgrade conditions, but must record workflow actions / report sidecars only; they must not directly overwrite confirmed knowledge.
- Completion Report and Knowledge Candidate output must be assembled from persisted run evidence (artifacts, command runs, gate runs, context-request actions, approvals, and calibration/review signals), not fixed canned suggestions.
- Router/context planning must ignore accepted knowledge whose metadata marks it as stale, conflicted, review-required, downgraded, superseded, or historical.
- `freshness='possibly_stale'` memory may be selected for context, but only as
  summary/retrieval evidence. It must not be injected as `mode='full'`
  authoritative context. `knowledgeClass='confirmed'` plus
  `freshness='current'` and no negative `reviewStatus` may remain full context.
- Knowledge with `reviewStatus` of `conflict`, `stale`, `superseded`,
  `needs_review`, or downgrade/supersede candidates is evidence only: lower it
  to summary trust/historical freshness, emit bounded review signals where
  relevant, and never mutate accepted knowledge from context selection.
- `GET /workflow-runs/:id/context` is the canonical Phase 6 read model for
  "why the agent knew this". It must be assembled from persisted artifacts,
  workflow actions, agent task prompt audits, gates, approvals, and agent
  results; it must not invent missing context or call an LLM.
- P4 stage handoff records use existing `HandoffRecord.metadata.stageHandoff`
  plus an optional per-run `other` artifact for human-readable Markdown. The
  handoff is evidence/navigation only: it must not set workflow status, gate
  status, approval state, or replace the source artifact it summarizes.
- The MVP stage handoff path is `requirement -> design`. After
  `requirement.md` is persisted, the runner records a
  `StageHandoffMetadata` payload and exposes a compact input named
  `stage_handoff.requirement.design.md` before the design agent invocation.
  The original `requirement.md` artifact id must remain present in
  `producedArtifacts` and `RunCtx.inputArtifactIds`.
- `GET /workflow-runs/:id/context` must expose valid stage handoffs from
  persisted handoff metadata as `stageHandoffs`. Malformed or unknown
  `metadata.stageHandoff` payloads are ignored rather than coerced.
- Phase 6 metrics are deterministic proxies:
  - impact coverage = agent tasks with ContextPack prompt audit / all agent tasks
  - evidence traceability = manifest items with sourceRefs / all manifest items
  - irrelevant-context ratio = low-signal manifest proxy, not semantic judging
  - context request count = recorded `context_request` actions
  - downstream rework signal = rejected approvals + failed gates + failed agent results
- Context policy config is bounded to registered keys (`context.policy.*`) until
  the config layer grows scoped project overrides. Do not add ad-hoc schema
  tables just for Phase 6.
- Sensitive path patterns must be excluded from selected context and project
  profile path outlines. Cross-project knowledge artifacts must be ignored even
  if mistakenly passed to the builder.
- Accepted knowledge selected by the Phase 1 builder is represented as:
  - `knowledgeClass: 'confirmed'`
  - `trustLevel: 'accepted_knowledge'`
  - `freshness: 'possibly_stale'`
  - `sourceRefs` including `knowledge:accepted`
- Knowledge metadata defaults are status-derived. If a row moves from
  `draft` to `accepted`, fields that still match the old default must be
  re-defaulted to accepted/confirmed values; explicit overrides such as
  `knowledgeClass: 'seed'` must be preserved.
- A missing project profile or missing accepted knowledge should produce a `RetrievalHint`; Phase 1 does not implement automatic retrieval from that hint.
- Same-step context retry is bounded to one automatic retry in the current Runner contract. When an agent emits a structured `context_request`, the Runner builds a supplement ContextPack with `supplement.contextRequestId`, `supplement.baseContextPackId`, and `supplement.retryIndex`, finishes the base invocation as a successful context-request capture, and retries the same skill using that supplement pack.
- The context_request action payload should link the request to
  `baseContextPackId`, `baseContextPackArtifactId`,
  `supplementContextPackId`, `requestArtifactId`, and
  `supplementArtifactId` so the governance read model can reconstruct the
  full base -> request -> supplement -> retry chain.
- The retry invocation must create a child AgentSession with `parentSessionId` pointing to the base session and `retryIndex = 1`. If the retry also emits a context_request, the Runner must stop and fail the retry invocation instead of looping.

### 4. Validation & Error Matrix

- Unknown `knowledgeClass`, `trustLevel`, `freshness`, or `ContextPack.mode` at a trust boundary -> reject or ignore via the shared `is*()` guards; do not silently coerce to a trusted value.
- Unknown `memoryKind` or `reviewStatus` in `KnowledgeArtifact.metadata` at an
  API/engine trust boundary -> reject before persistence. Legacy rows missing
  those fields must normalize safely (`semantic` or kind-derived default,
  `reviewStatus='none'`, empty `supersedes`, `hitCount=0`, `lastUsedAt=null`).
- Unknown `KnowledgeArtifactStatus` at the API/engine trust boundary -> reject before normalizing context metadata; invalid status must not fall through to a 500.
- Invalid `flowId`, `runType`, or `stage` in a `ContextPack` fixture -> TypeScript failure; do not widen these fields to plain `string`.
- Backend-specific renderer drift -> test failure proving Claude Code and Codex no longer contain the same rendered context body.
- Missing `contextPack` on direct backend tests -> allowed; backends must remain callable for focused CLI tests.
- Legacy input artifact with prompt-like text -> render under the untrusted-data heading; never elevate it above Platform Contract / Role Contract / Tool Policy.
- Optional input exceeds all budget modes -> omit it and record the downgrade
  in the input injection audit.
- Required input exceeds all budget modes or requests `omit` -> render
  reference-only, not full body, and record an audit warning explaining why the
  required input was preserved as a reference.
- Step checkpoint lacks valid `stageContextFinish` / `stageContextStart`
  metadata -> restore helper must throw rather than guessing `RunCtx.inputs`.
- Calibration/review action received from the runner -> record a workflow action and report evidence; do not mutate `knowledge_artifacts` status/content unless the explicit knowledge status/promotion endpoint is called.
- Superseding an accepted knowledge artifact -> retarget status-derived context metadata to recovered/summary/historical so stale confirmed facts do not remain authoritative.
- `reviewStatus=conflict` accepted knowledge appears as `mode='full'` in a
  ContextPack -> contract violation; keep it as summary/retrieval evidence and
  surface review signals/report sidecars instead.
- Phase 5 implementation -> must not add Phase 6 UI dashboards, manifest browsing endpoints, metrics collection, or context policy controls.
- Phase 6 read endpoint receives a missing workflow run id -> HTTP 404; it must
  not fall back to another run or project.
- Sensitive artifact names such as `.env*`, `.ssh/*`, private key files, and
  credential paths -> excluded from ContextPack selected sections and profile
  outlines.
- Knowledge artifact whose `projectId` does not match the current run's project
  -> ignored; no cross-project sourceRefs should appear in the manifest.
- A context_request whose requested refs/questions are fully removed by sensitive-path filtering -> do not retry; log/record the filtered request path as a non-retry condition.
- A retry attempt that emits another context_request -> fail the retry AgentSession with a retry-limit error; do not start a third backend invocation.

### 5. Good/Base/Bad Cases

- Good: `invokeSkill()` calls `buildContextPack()`, passes `contextPack` into `backend.run()`, and stores a prompt audit containing the context manifest reasons.
- Good: Claude Code uses `renderAgentPrompt()` for `{ systemPrompt, userPrompt }`; Codex uses the same result via `renderCombinedAgentPrompt()`.
- Good: a `context_pack` artifact has `metadata.contextSelection.selected[]` explaining why each section was selected.
- Good: a design-stage prompt renders `requirement.md` as summary/reference
  with `artifact://requirement.md/<id>` instead of injecting the full body.
- Good: a design-stage prompt includes
  `stage_handoff.requirement.design.md` with summary, decisions, risks, open
  questions, and `artifact://requirement.md/<id>` reference, while
  `requirement.md` remains available as the source artifact.
- Good: a stage finish checkpoint can restore both
  `RunCtx.inputs['requirement.md']` and
  `RunCtx.inputArtifactIds['requirement.md']`.
- Good: a normal agent invocation creates a base `context_pack` artifact and
  stores its artifact id in the AgentSession metadata before the backend runs.
- Good: an implementation backend first emits `context_request`, then succeeds after the supplement retry; the base and retry AgentSessions are linked by `parentSessionId`, and the retry context pack has `supplement.retryIndex = 1`.
- Good: confirmed/current memory without negative review status is selected as
  full context when relevant.
- Good: possibly-stale or conflict-marked memory is selected only as summary or
  retrieval evidence and carries manifest reasons/source refs explaining why.
- Base: tests that construct a backend context without `contextPack` still run, and the renderer simply omits the Context Injection Layer.
- Bad: Claude Code and Codex each hand-build prompt context strings.
- Bad: raw `context_pack.md`, `project_profile.md`, or accepted knowledge markdown appears in the user prompt without an untrusted-data label.
- Bad: large optional artifacts are always rendered in full because a skill has
  no special-case renderer logic.
- Bad: required artifacts are silently dropped under budget pressure without a
  reference and audit warning.
- Bad: repeated context_request output recursively retries until timeout.
- Bad: implementing context request retries, calibration conflict closure, or UI manifest endpoints as part of Phase 3; those belong to later phases.

### 6. Tests Required

- Shared tests assert canonical literal catalogs and `is*()` guards for `KnowledgeClass`, `ContextTrustLevel`, `ContextFreshness`, and `ContextPackMode`.
- Shared type smoke tests construct a `ContextPack` and `ContextRequest` carrying source refs, trust level, freshness, maturity profile, manifest entries, and typed run metadata.
- Runner builder tests cover:
  - minimal pack with no historical knowledge,
  - accepted knowledge included as confirmed selected context,
  - retrieval hints when knowledge/profile inputs are absent.
- Renderer tests cover:
  - the 8-layer context structure,
  - the platform trust boundary,
  - untrusted labeling for legacy input artifacts,
  - `context_pack` stage constraints,
  - `SkillSpec.inputPolicies` summary/reference/omit rendering,
  - required-input preservation and optional-input budget omission.
- Runner stage tests cover start/finish stage context checkpoint metadata,
  named `inputArtifactIds` maps, produced artifact id maps, context pack
  artifact ids, and restore helper behavior.
- Backend tests cover both Claude Code and Codex receiving the same shared ContextPack rendering.
- Retriever tests cover deterministic scoring components, stable dedupe, and budget degradation through `full` → `summary` → `retrieval_hint`.
- Builder tests cover minimal invocation packs for `feature.fastforward`, `issue.standard`, and `refactor.standard` flows that skip an explicit `context_pack` stage.
- Renderer/audit tests cover source refs and degradation fields appearing in prompt-visible context and persisted audit metadata.
- Calibration tests cover bounded deterministic review signals and code-fact-vs-confirmed-knowledge conflict signals.
- Memory lifecycle tests cover shared `memoryKind` / `reviewStatus` guards,
  invalid metadata rejection, possibly-stale summary degradation,
  conflict-marked evidence-only selection, cross-project exclusion, and selected
  knowledge usage metadata updates.
- API/report tests cover context request chains and knowledge review signals in Completion Report / Knowledge Candidate JSON sidecars.
- Runner invokeSkill tests cover same-step context_request retry success, retry-limit failure, and sensitive-only context_request no-retry behavior.
- Runner invokeSkill tests cover base ContextPack artifact persistence,
  AgentSession context artifact metadata, and reuse of the supplement artifact
  for the retry session.
- API/governance tests cover `/workflow-runs/:id/context` manifest, sourceRefs,
  trust levels, budget decisions, context_request history, and deterministic
  metric formulas.
- API/governance tests cover `stageHandoffs` parsed from
  `HandoffRecord.metadata.stageHandoff`, including produced artifact refs.
- Runner stage tests cover `requirement -> design` handoff creation,
  persistence as handoff metadata/artifact evidence, and design-stage
  consumption before invocation.
- API/governance tests cover artifact-sourced context pack `role`,
  `invocationId`, `retryIndex`, and context request
  `baseContextPackArtifactId` fields.
- API/governance tests must cover both artifact metadata and `agent_task.prompt`
  audit sources, including prompt-parsed manifest priority for flows without a
  standalone `context_pack` artifact.
- Security governance tests cover prompt-injection boundary rendering,
  sensitive path exclusion, and cross-project knowledge isolation.
- Config tests cover bounded `context.policy.*` keys and validation.
- Router tests cover exclusion of historical, stale, conflicted, review-required, downgraded, and superseded accepted knowledge.

### 7. Wrong vs Correct

#### Wrong

```ts
// Backend-specific prompt assembly forks context policy.
const prompt = `${skill.instructions}\n${ctx.inputs['context_pack.md'] ?? ''}`;
```

#### Correct

```ts
const rendered = renderAgentPrompt({
  skill,
  workflowRunId: ctx.workflowRunId,
  workspacePath: ctx.workspacePath,
  artifactsDir: ctx.artifactsDir,
  branch: ctx.branch,
  title: ctx.title,
  inputs: ctx.inputs,
  mode: 'implementation',
  contextPack: ctx.contextPack,
});
```
