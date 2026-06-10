# Current implementation map for Context Injection Layer MVP

## Reference design docs

- `docs/2026-05-09-ai-native-platform-project-lifecycle-context-injection-design.md`
- `docs/2026-05-09-ai-native-platform-project-lifecycle-context-injection-execution.md`
- `docs/2026-05-09-ai-native-platform-context-injection-handoff.md`

## Current matching implementation

- Workflow has a `context_pack` stage in `WorkflowStage` and `feature.standard` begins with that stage.
- Runner `runContextPack()` currently:
  - generates/reuses a thin project profile,
  - reads accepted knowledge from the per-project knowledge directory,
  - invokes the context_pack skill,
  - persists a `context_pack` artifact.
- Claude Code and Codex already share the `AgentBackend` interface and consume the same `SkillSpec`/`AgentTaskContext` contract.
- API already has per-run artifacts, project-scoped `knowledge_artifacts`, requirement/design entity head tables, and promotion of accepted requirement/design drafts.
- Router can use accepted knowledge for coarse recommendations.

## Important gaps vs design

- No typed `ProjectMaturityProfile` yet; current `ProjectProfile` is a thin repository scan.
- No typed `ContextManifest` / `ContextPack` protocol; current context is markdown plus raw `ctx.inputs` prompt concatenation.
- No `Seed / Recovered / Confirmed` knowledge class, `trustLevel`, or `freshness` model.
- Claude Code and Codex each render prompts locally; there is no shared context-pack renderer for the design's 8 injection layers.
- `feature.fastforward`, `issue.standard`, and `refactor.standard` skip `context_pack`, so context injection is not yet per-agent-invocation.
- No structured `context_request` supplement protocol.

## Likely implementation slices

1. Shared context protocol types in `packages/shared`.
2. Runner-side ContextPack builder and provider-neutral renderer.
3. Claude/Codex prompt assembly refactor to consume rendered context layers.
4. Knowledge metadata bridge for `knowledgeClass`, `trustLevel`, `freshness`, and `sourceRefs`.
5. Minimal context-pack artifact persistence and tests before advanced retrieval/scoring.

## Recommended MVP boundary

Implement the protocol + rendering + metadata bridge first. Defer code indexing, scoring, UI observability, calibration mode, and full incremental context_request loops unless explicitly pulled into this task.
