# Memory Lifecycle MVP research

## Current code facts

- `KnowledgeArtifact` already stores project-scoped long-lived knowledge in `knowledge_artifacts` with freeform `metadata_json`.
- Shared context metadata already includes `knowledgeClass`, `trustLevel`, `freshness`, `sourceRefs`, and `confidence`, plus guards and `normalizeKnowledgeContextMetadata()`.
- `apps/runner/src/context/builder.ts` already:
  - filters knowledge artifacts by `projectId`;
  - filters sensitive paths/source refs;
  - emits bounded `calibrationSignals`;
  - treats `reviewStatus=conflict|stale|superseded|downgrade_candidate` as lower trust/historical evidence.
- `apps/api/src/routes/knowledge-artifacts.ts` already validates knowledge class/trust/freshness for seed writes and records `/usage` hit metadata.
- `apps/api/src/routes/workflow-runs.ts` already maps retro/review action names to `needs_review`-style knowledge actions.

## Gaps to close

- No shared named contract for semantic / episodic / procedural memory metadata.
- `reviewStatus` and lifecycle-specific fields are accepted as freeform metadata without shared validation.
- `freshness='possibly_stale'` can still be selected as full context when budget allows; the red/green plan requires it to degrade to summary/retrieval evidence.
- Negative review status can remain full content because only trust/freshness are lowered; base inclusion mode is still full.

## Epic D requirements distilled

- D1: Shared metadata normalizer for memory kind/lifecycle/review status over KnowledgeArtifact metadata.
- D2: Context selection treats stale/conflict/superseded/possibly-stale memory as evidence only, while confirmed/current memory remains eligible for full context.
- D3: Review signals from calibration/retro remain actions/report evidence and do not directly mutate accepted knowledge.

## Red/green behavior

- Red: `reviewStatus=conflict` accepted knowledge appears as `mode='full'` authoritative context.
- Red: a cross-project KnowledgeArtifact appears in ContextManifest.
- Yellow: `freshness='possibly_stale'` accepted knowledge appears as summary/retrieval evidence with review signal.
- Green: `knowledgeClass='confirmed'`, `freshness='current'`, no negative review status appears as full context when relevant.
- Green: selected knowledge usage updates hit metadata.

## Boundaries

- Workflow Engine remains the only writer for KnowledgeArtifact mutation.
- Context selection may degrade or signal memory, but must not promote, accept, supersede, or delete knowledge.
- Memory lifecycle metadata must be additive and backward-compatible for legacy rows.
