# Phase B Implementation Plan

This plan turns M4/M5/M6/M3 into concrete follow-up work while Phase A ships M1/M2.

## M4 Eval Harness

Current increment:

- `scripts/eval-harness.ts` reads fixed JSON scenarios from `eval/scenarios`.
- Scenario schema version: `ainp.eval.scenario.v1`.
- Result schema version: `ainp.eval.result.v1`.
- Outputs JSON and HTML reports under `.ainp/evals` by default. This path is local state and already ignored by git.
- Variants carry `backend`, `skillVariant`, and `knowledgeVariant` metadata so A/B comparison is part of the schema even when a scenario currently uses deterministic rules.
- Current scenarios cover Smart Router scoped knowledge behavior, suppression of stale/conflicted knowledge, and bugfix/refactor/smoke flow routing.

Next increments:

- Add scenario kind `workflow_fixture` to replay persisted events/gates/logs through Evidence Gate and completion report generation.
- Add scenario kind `agent_backend_fixture` for fake Codex/Claude CLI outputs, comparing skill variants without external model calls.
- Add scenario kind `verifier_fixture` after M3 defines screenshot/video artifact shape.

Self-test:

```bash
bun run eval
```

Expected: console prints `scenarios=3 variants=7 passed=7 failed=0` and writes one JSON plus one HTML report path.

## M5 Knowledge Refinement

Target behavior:

- Stop treating accepted knowledge as a single unbounded markdown blob for prompt injection.
- Select scoped top-N entries by task/stage relevance.
- Prefer entries with confirmed/current metadata and evidence refs.
- Suppress stale, conflict, superseded, downgrade-candidate, and review-required entries.
- Track `hitCount`, `lastUsedAt`, `reviewStatus`, and source/evidence refs as metadata on knowledge artifacts.

Implementation boundary:

- Shared metadata stays in `packages/shared/src/types/artifact.ts`.
- API ranking continues in `apps/api/src/router.ts` for route preview and run creation.
- Runner prompt injection changes belong in `apps/runner/src/knowledge.ts` and `apps/runner/src/context/builder.ts`.
- ContextPack manifest must record selected knowledge ids, selection reasons, score, freshness, trust, and source refs.

Acceptance checks:

- A project with more than 5 accepted matching knowledge entries injects at most 5 selected entries.
- A stale/conflict-marked accepted entry is not injected and is reported as a review signal.
- Selection is deterministic for equal scores.
- Selected structured knowledge artifacts increment `hitCount` and record `lastUsedAt` plus ContextPack provenance after agent invocation.
- `bun test apps/api/test/knowledge-artifacts-route.test.ts apps/runner/test/knowledge.test.ts apps/runner/test/context-builder.test.ts apps/api/test/router.test.ts` passes.

Current increment:

- `acceptedKnowledgeMarkdownForContext()` keeps legacy concatenated markdown only when structured KnowledgeArtifacts are absent.
- Orchestrator ContextPack generation uses structured KnowledgeArtifacts as the primary knowledge input when the API can provide them.
- Existing ContextPack selection remains responsible for scoring, budget degradation, source refs, trust, freshness, and review signals.
- Runner reports selected structured-knowledge usage to `POST /knowledge-artifacts/usage`; the API updates metadata with `hitCount`, `lastUsedAt`, `lastUsedContextPackId`, `lastUsedAgentTaskId`, mode, score, and source refs.

## M6 Retro Loop

Target behavior:

- Generate one retro artifact per workflow run from persisted data: steps, gates, commands, artifacts, approvals, agent events, context requests, Evidence Gate results, and digest verification state.
- Retro output must separate facts from inferred lessons.
- Confirmed retro findings can become knowledge candidates or eval scenarios.

Implementation boundary:

- Report assembly belongs next to `apps/api/src/reports.ts` or a sibling `retro.ts`.
- Write artifacts with kind `other` initially unless a dedicated per-run artifact kind is added.
- Keep promotion human-gated; retro generation alone must not mutate accepted knowledge.

Acceptance checks:

- Retro artifact exists after a completed run.
- Retro JSON includes failed/warn gates, command failures, missing evidence, stale knowledge signals, and context request chain.
- Confirmed retro action creates either a knowledge action payload or an eval scenario draft.

Current increment:

- `POST /workflow-runs/:id/retro` generates markdown + JSON sidecar artifacts.
- Retro artifacts use `kind='other'` with `metadata.reportKind='retro_report'` and `schemaVersion='ainp.retro_report.v1'`.
- Sidecars include findings, promotion candidates, gate/command/agent issues, context requests, rejected approvals, and knowledge review signal ids.
- `POST /workflow-runs/:id/retro-actions` keeps promotion human-gated while turning confirmed findings into either `knowledge_suggestion_action` rows or digest-backed `ainp.eval.scenario_draft.v1` JSON artifacts.
- File artifacts are created through `createArtifact()`, so digest metadata is recorded when the files are readable.

## M3 Verifier / Playwright Evidence

Target behavior:

- Add a verifier sub-stage for UI tasks after implementation/build_test and before acceptance.
- Capture AC-to-evidence matrix with before/after screenshot or video artifacts.
- Verifier output must be persisted as artifacts and referenced by Evidence Gate.
- Evidence Gate should fail UI acceptance when verifier evidence is required but absent.

Implementation boundary:

- Runner verifier orchestration belongs in `apps/runner/src/orchestrator.ts` behind a narrow stage/sub-stage hook.
- Artifact ingest remains through API `/runner/events/artifact`.
- UI evidence display extends current Evidence Drill-down rather than adding a separate report surface.
- No Playwright dependency was added in Phase A. Introduce it only in the M3 task, with browser install/self-test instructions.

Acceptance checks:

- UI workflow with verifier enabled records screenshot artifacts with digests.
- AC matrix cites artifact ids and command/verifier run ids.
- Tampering with screenshot files surfaces digest mismatch through artifact content where readable.
- Evidence Gate blocks acceptance when required verifier refs are missing.

Current increment:

- Shared verifier metadata defines `ainp.verifier_ac_matrix.v1` and `ainp.verifier_media.v1`.
- Runner inserts a review-stage verifier sub-stage for UI-titled tasks.
- Runner copies recognized files from `.ainp-verifier/` into the run artifact directory, posts before/after screenshot or video artifacts through `/runner/events/artifact`, and writes `verifier-ac-matrix.json`.
- Evidence Gate runs before human acceptance and before completion report generation. It fails UI runs when the verifier AC matrix is missing, when AC rows do not cite tagged before+after screenshots or video, or when verifier artifacts lack SHA-256 metadata.
- Verifier artifacts use `kind='other'` initially but are excluded from the generic acceptance review artifact slot, so generated verifier matrices cannot mask a missing review artifact.
- Automatic Playwright/browser capture remains a follow-up; this increment intentionally keeps dependency changes at zero.

Self-test:

```bash
bun test apps/api/test/gate-engine.test.ts apps/api/test/verifier-evidence-route.test.ts
```

Expected: UI verifier Evidence Gate rules fail on missing refs or untagged image refs, verifier artifacts do not count as review evidence, and rules pass when a matrix cites digest-backed before/after screenshot artifacts.
