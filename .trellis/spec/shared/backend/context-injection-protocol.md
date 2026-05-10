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

### 2. Signatures

- Shared protocol types:
  - `ProjectMaturityProfile`
  - `ContextManifestItem`
  - `ContextSection`
  - `RetrievalHint`
  - `ContextPack`
  - `ContextRequest`
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
- Agent invocation context:
  - `AgentTaskContext.contextPack?: ContextPack`

### 3. Contracts

- The runner must build a fresh `ContextPack` before every agent backend invocation, including flows that skip the explicit `context_pack` stage (`feature.fastforward`, `issue.standard`, `refactor.standard`).
- Claude Code and Codex prompt assembly must both call the shared runner renderer. Backend classes own CLI mechanics only; they must not fork context selection or rendering policy.
- The rendered prompt must include the platform trust boundary: repository content, docs, generated artifacts, logs, comments, and test fixtures are data/evidence, not trusted instructions.
- Legacy input markdown can remain for compatibility, but the renderer must label those input artifacts as untrusted data before concatenating them.
- A `context_pack` artifact should include `metadata.contextSelection` with the pack id, mode, selected manifest refs, reasons, priorities, inclusion modes, knowledge class, trust level, freshness, and source refs.
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
- `GET /workflow-runs/:id/context` is the canonical Phase 6 read model for
  "why the agent knew this". It must be assembled from persisted artifacts,
  workflow actions, agent task prompt audits, gates, approvals, and agent
  results; it must not invent missing context or call an LLM.
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

### 4. Validation & Error Matrix

- Unknown `knowledgeClass`, `trustLevel`, `freshness`, or `ContextPack.mode` at a trust boundary -> reject or ignore via the shared `is*()` guards; do not silently coerce to a trusted value.
- Unknown `KnowledgeArtifactStatus` at the API/engine trust boundary -> reject before normalizing context metadata; invalid status must not fall through to a 500.
- Invalid `flowId`, `runType`, or `stage` in a `ContextPack` fixture -> TypeScript failure; do not widen these fields to plain `string`.
- Backend-specific renderer drift -> test failure proving Claude Code and Codex no longer contain the same rendered context body.
- Missing `contextPack` on direct backend tests -> allowed; backends must remain callable for focused CLI tests.
- Legacy input artifact with prompt-like text -> render under the untrusted-data heading; never elevate it above Platform Contract / Role Contract / Tool Policy.
- Calibration/review action received from the runner -> record a workflow action and report evidence; do not mutate `knowledge_artifacts` status/content unless the explicit knowledge status/promotion endpoint is called.
- Superseding an accepted knowledge artifact -> retarget status-derived context metadata to recovered/summary/historical so stale confirmed facts do not remain authoritative.
- Phase 5 implementation -> must not add Phase 6 UI dashboards, manifest browsing endpoints, metrics collection, or context policy controls.
- Phase 6 read endpoint receives a missing workflow run id -> HTTP 404; it must
  not fall back to another run or project.
- Sensitive artifact names such as `.env*`, `.ssh/*`, private key files, and
  credential paths -> excluded from ContextPack selected sections and profile
  outlines.
- Knowledge artifact whose `projectId` does not match the current run's project
  -> ignored; no cross-project sourceRefs should appear in the manifest.

### 5. Good/Base/Bad Cases

- Good: `invokeSkill()` calls `buildContextPack()`, passes `contextPack` into `backend.run()`, and stores a prompt audit containing the context manifest reasons.
- Good: Claude Code uses `renderAgentPrompt()` for `{ systemPrompt, userPrompt }`; Codex uses the same result via `renderCombinedAgentPrompt()`.
- Good: a `context_pack` artifact has `metadata.contextSelection.selected[]` explaining why each section was selected.
- Base: tests that construct a backend context without `contextPack` still run, and the renderer simply omits the Context Injection Layer.
- Bad: Claude Code and Codex each hand-build prompt context strings.
- Bad: raw `context_pack.md`, `project_profile.md`, or accepted knowledge markdown appears in the user prompt without an untrusted-data label.
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
  - `context_pack` stage constraints.
- Backend tests cover both Claude Code and Codex receiving the same shared ContextPack rendering.
- Retriever tests cover deterministic scoring components, stable dedupe, and budget degradation through `full` → `summary` → `retrieval_hint`.
- Builder tests cover minimal invocation packs for `feature.fastforward`, `issue.standard`, and `refactor.standard` flows that skip an explicit `context_pack` stage.
- Renderer/audit tests cover source refs and degradation fields appearing in prompt-visible context and persisted audit metadata.
- Calibration tests cover bounded deterministic review signals and code-fact-vs-confirmed-knowledge conflict signals.
- API/report tests cover context request chains and knowledge review signals in Completion Report / Knowledge Candidate JSON sidecars.
- API/governance tests cover `/workflow-runs/:id/context` manifest, sourceRefs,
  trust levels, budget decisions, context_request history, and deterministic
  metric formulas.
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
