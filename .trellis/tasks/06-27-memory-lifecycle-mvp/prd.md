# Memory Lifecycle MVP

## Goal

Implement Epic D from the Agent Runtime docs by making long-lived project memory lifecycle metadata explicit, normalized, and enforceable during context selection. Stale, conflicted, superseded, or review-required memory must stay visible as evidence/review signal, but must not be injected as full authoritative context.

## Source Documents

- `docs/2026-06-27-agent-runtime-requirements.md`
- `docs/2026-06-27-agent-runtime-architecture-design.md`
- `docs/2026-06-27-agent-runtime-development-tasks.md`
- `docs/2026-06-27-agent-runtime-red-green-test-plan.md`
- `.trellis/spec/shared/backend/context-injection-protocol.md`

## Requirements

1. Define shared memory lifecycle metadata over `KnowledgeArtifact.metadata` without adding a new DB table.
2. Normalize memory type/classification defaults so historical artifacts remain readable.
3. Validate standardized memory lifecycle fields at API trust boundaries.
4. Context selection must keep stale/conflict/superseded/review-required knowledge as summary/retrieval evidence only, never full authoritative context.
5. `freshness='possibly_stale'` memory must degrade to summary/retrieval evidence; `confirmed/current` memory may remain full.
6. Cross-project KnowledgeArtifacts must stay excluded from ContextManifest.
7. Calibration/retro findings must create review signals/actions only; they must not auto-promote or auto-accept knowledge.
8. Usage metadata (`hitCount`, `lastUsedAt`, context pack/run ids) must remain updated for selected knowledge.

## Acceptance Criteria

- [x] Shared tests cover valid/invalid memory lifecycle metadata and safe defaults for legacy KnowledgeArtifacts.
- [x] Runner context tests prove `reviewStatus=conflict` accepted knowledge is not injected as full authoritative context.
- [x] Runner context tests prove `freshness=possibly_stale` degrades to summary/retrieval evidence while `confirmed/current` can be full.
- [x] Runner context tests prove cross-project KnowledgeArtifacts are excluded from ContextManifest.
- [x] API route tests prove invalid memory lifecycle metadata is rejected at write boundaries.
- [x] API/report tests prove retro/calibration review signals remain review actions and do not modify accepted knowledge.
- [x] Usage tests prove selected knowledge still updates `hitCount` / `lastUsedAt`.
- [x] `bun test packages/shared/test apps/api/test apps/runner/test` passes for touched surfaces.
- [x] `bun run eval` still passes.
- [x] `bun run eval -- --scenario-dir eval/scenarios-red` still exits 1.
- [x] `bun run typecheck` passes.

## Out of Scope

- New `memory_records` table.
- Full review queue UI.
- Automatic accepted-knowledge mutation from retro/calibration signals.
- Backend-native memory storage.
- Changing KnowledgeArtifact promotion semantics beyond metadata normalization.

## Technical Notes

- Use `KnowledgeArtifact.metadata` as the additive migration surface.
- Keep `KnowledgeArtifact.status` (`draft | accepted | superseded`) separate from memory lifecycle metadata.
- `reviewStatus` values such as `conflict`, `stale`, `superseded`, `needs_review`, `upgrade_candidate`, and `downgrade_candidate` are review signals, not authorization to rewrite accepted knowledge.
- ContextManifest should expose why memory was degraded via mode, freshness, trust level, score, source refs, and reason text.

## Definition of Done

- D1-D3 are implemented or verified with focused tests.
- Specs are updated with the Memory Lifecycle contract.
- Task is validated, committed, archived, and journaled without staging unrelated dirty Trellis files.
