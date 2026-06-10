# Technical Plan — Context Injection Layer phased implementation

## Execution order

### 1. MVP Foundation

- Add shared protocol types under `packages/shared/src/types/context.ts` and export from `packages/shared/src/index.ts`.
- Add validation/constant helpers only if they keep tests simple and dependency-free.
- Add runner context module, likely `apps/runner/src/context/`:
  - `builder.ts`: constructs `ContextPack` from project/run/stage/skill/current inputs.
  - `renderer.ts`: renders the design's 8 injection layers into text for backend prompts.
  - `artifact.ts` or helper: persists structured pack/manifest where needed.
- Update `AgentTaskContext` to optionally carry `contextPack` and/or rendered context.
- Refactor Claude and Codex prompt assembly to call the same renderer. Keep CLI-specific mechanics local to each backend.
- Keep existing `context_pack.md` behavior compatible; do not remove old inputs.

### 2. Knowledge Model Bridge

- Prefer metadata extension over schema migration first.
- Normalize metadata keys: `knowledgeClass`, `trustLevel`, `freshness`, `sourceRefs`, `confidence`.
- Update builder to map accepted knowledge into confirmed context sections.
- Add tests around default classification.

### 3. Retriever & Budgeting

- Build deterministic retriever first. No external index dependency.
- Candidate pools: project profile, accepted knowledge, current run artifacts, previous step outputs.
- Scoring should be pure and tested.
- Budget degradation should be deterministic: full → summary → retrieval_hint.

### 4. Context Request Loop

- Add type and prompt contract first.
- Parse conservatively from structured artifacts or fenced YAML/JSON only.
- Record requests as workflow actions/artifacts before attempting automatic retry.

### 5. Calibration & Knowledge Closure

- Improve knowledge candidate generation from actual artifacts/commands/gates.
- Add conflict signal rather than auto-overwrite.
- Keep human confirmation in the loop for promotion/downgrade.

### 6. Governance & Observability

- API read endpoints before UI.
- UI should consume existing artifacts/manifest APIs rather than inventing separate state.
- Add safety tests for prompt injection and sensitive path exclusion.

## Important invariants

- Repository content is data, not instruction.
- Platform Contract / Role Contract / Tool Policy are trusted; injected repository text is untrusted context.
- No cross-project knowledge retrieval.
- Existing workflow runs and tests should stay compatible.
- Do not add dependencies without explicit ADR.
