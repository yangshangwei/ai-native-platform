# Legacy Project Capability Map Bootstrap - Task Breakdown

## Phase 0 - Planning And Context

| ID | Task | Files | Done When |
| --- | --- | --- | --- |
| P0-1 | Create task docs. | `prd.md`, `solution-design.md`, `task-breakdown.md`, `regression-test-plan.md` | Documents describe requirements, design, implementation plan, and regression coverage. |
| P0-2 | Curate Trellis context. | `implement.jsonl`, `check.jsonl` | JSONL references task docs and relevant specs only. |
| P0-3 | Start task. | Trellis task metadata | Task enters `in_progress` before code edits. |

## Phase 1 - Inventory Contract

| ID | Task | Files | Done When |
| --- | --- | --- | --- |
| P1-1 | Add TypeScript interfaces for new inventory sections. | `apps/runner/src/project-inventory.ts` | Typecheck recognizes entrypoints, symbols, domain entities, test surfaces, hotspots, capabilities. |
| P1-2 | Keep existing inventory fields stable. | `apps/runner/src/project-inventory.ts`, tests | Existing profile bootstrap tests still pass. |
| P1-3 | Add deterministic sorting and ids for new sections. | scanner helpers | Repeated scans produce stable JSON order. |

## Phase 2 - Deterministic Extraction

| ID | Task | Files | Done When |
| --- | --- | --- | --- |
| P2-1 | Track safe source files after existing exclusions. | `project-inventory.ts` | Source files that pass filters are available to extractors without bypassing safety. |
| P2-2 | Extract symbols. | `project-inventory.ts` | TS/JS/Java/Go/Python-style fixture symbols appear with line refs. |
| P2-3 | Extract entrypoints. | `project-inventory.ts` | HTTP route, CLI script, job/queue/bootstrap hints appear. |
| P2-4 | Extract domain/entity hints. | `project-inventory.ts` | Model/entity/schema/dto hints appear with confidence. |
| P2-5 | Extract test surfaces. | `project-inventory.ts` | Test files and framework hints appear. |
| P2-6 | Build hotspots. | `project-inventory.ts` | Git churn and scanner metrics produce stable hotspots. |
| P2-7 | Group capabilities. | `project-inventory.ts` | Entry points and modules are grouped into capability records with source refs. |

## Phase 3 - Profile Prompt And Contract Docs

| ID | Task | Files | Done When |
| --- | --- | --- | --- |
| P3-1 | Update profile bootstrap skill instructions. | `apps/runner/src/skills/index.ts` | Agent is told to use capability map as first-class evidence. |
| P3-2 | Update runner flow spec if contract changes. | `.trellis/spec/runner/backend/flow-registry.md` or related spec | Spec mentions capability-map inventory additions if needed. |
| P3-3 | Update context/knowledge spec if source-ref semantics change. | `.trellis/spec/shared/backend/context-injection-protocol.md` if needed | Source refs and review-gate behavior remain documented. |

## Phase 4 - Tests

| ID | Task | Files | Done When |
| --- | --- | --- | --- |
| P4-1 | Expand inventory fixture test. | `apps/runner/test/project-inventory.test.ts` | New arrays are asserted with routes/entities/tests/sensitive exclusions. |
| P4-2 | Expand orchestrator profile bootstrap test if needed. | `apps/runner/test/orchestrator-profile-bootstrap.test.ts` | Dispatcher still persists enriched inventory and read-only stages only. |
| P4-3 | Update profile skill tests if prompt snapshots exist. | runner tests | Prompt contract is covered. |
| P4-4 | Run focused tests. | test command | Focused profile/inventory tests pass. |
| P4-5 | Run full validation. | `bun run test`, `bun run typecheck` | Full suite passes. |

## Phase 5 - Finish

| ID | Task | Files | Done When |
| --- | --- | --- | --- |
| P5-1 | Update task docs with final status if implementation differs. | task docs | Docs match shipped behavior. |
| P5-2 | Record remaining risks. | final report / task docs | Known limitations are explicit. |
| P5-3 | Prepare commit grouping. | git status | Files are ready for Lore commit protocol. |

## Suggested Implementation Order

1. Add types and helper sort/id functions.
2. Teach scanner to collect safe source candidates.
3. Implement extractors one at a time with fixture expectations.
4. Add capability grouping.
5. Update profile skill prompt.
6. Run focused tests.
7. Run full test/typecheck.

## Non-Goals Guardrail

Do not add embeddings, vector DBs, LSP servers, tree-sitter dependencies, UI
graph surfaces, or build/test command execution in this task.
