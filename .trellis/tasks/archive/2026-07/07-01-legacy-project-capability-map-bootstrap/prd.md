# Legacy Project Capability Map Bootstrap

## Goal

Upgrade the existing legacy project profile bootstrap from a file/config
inventory into an evidence-backed capability map so AI agents can quickly
understand what an old project does, where core functionality enters the system,
which modules/entities/tests support it, and which areas are risky to change.

## Background

The current `profile.bootstrap` flow already creates a read-only inventory and
then asks the `project-profile-bootstrap` agent to synthesize a project profile.
That inventory is safe and useful, but it is mostly file-centric:

- documents and config summaries,
- package scripts,
- module directory hints,
- Git branch/commit/dirty state,
- recent commits and churn paths.

For legacy onboarding, the missing layer is a deterministic "what does this
system actually do?" map. The agent should see entrypoints, symbol outlines,
domain/entity hints, tests, and hotspots before it writes a profile.

## Research References

- [`research-oss-codebase-understanding.md`](research-oss-codebase-understanding.md)
  - OSS tools converge on digest, repo-map/symbol-map, RAG, static graph, and
    multi-agent docs. The recommended MVP is deterministic static evidence first
    and LLM synthesis second.

## Requirements

### Functional Requirements

| ID | Requirement |
| --- | --- |
| FR-1 | Extend project bootstrap inventory with deterministic code-intelligence sections for entrypoints, symbols, domain/entity hints, tests, hotspots, and capabilities. |
| FR-2 | Keep the scan read-only; it must not execute project code, build commands, test commands, package installs, migrations, or generators. |
| FR-3 | Preserve existing inventory outputs and `profile.bootstrap` flow behavior. Existing consumers of `project-inventory.json` must continue to work. |
| FR-4 | Detect common entrypoints from local source/config evidence, including HTTP routes/handlers, CLI-like command scripts, scheduled/job/queue hints, and app/server bootstrap files where possible. |
| FR-5 | Extract a compact symbol map from supported source files using dependency-free heuristics for the MVP. |
| FR-6 | Infer domain/entity hints from model/entity/schema/table naming patterns and source paths without claiming them as authoritative business facts. |
| FR-7 | Map test surfaces by test file path/name and nearby target module hints. |
| FR-8 | Use Git churn plus simple source-size/symbol-density heuristics to identify hotspots. |
| FR-9 | Produce a capability map that groups related entrypoints, modules, tests, and hotspots with source refs and confidence scores. |
| FR-10 | Update the profile synthesis prompt so `project-profile-bootstrap` treats the capability map as first-class evidence and still separates facts, inferences, and open questions. |
| FR-11 | Expose warnings/exclusions for unsupported languages, skipped oversized files, sensitive files, and budget truncation. |
| FR-12 | Keep generated profile knowledge reviewable through the existing Knowledge Gate; no auto-promotion. |

### Non-Functional Requirements

| ID | Requirement |
| --- | --- |
| NFR-1 | No new runtime dependency for the MVP. |
| NFR-2 | Deterministic ordering and stable ids for tests and diff review. |
| NFR-3 | Scan budgets must remain bounded by file count, captured file count, file size, and total bytes. |
| NFR-4 | Sensitive/generated/binary/oversized filtering must apply before code intelligence extraction. |
| NFR-5 | Confidence must be conservative. Heuristic findings are hints unless tied to strong source evidence. |
| NFR-6 | The implementation should be additive and reversible; do not replace `project-inventory.json` with an incompatible artifact. |

## MVP Scope

The MVP enhances the existing `project-inventory.json` payload with additional
top-level sections:

- `entrypoints`
- `symbols`
- `domainEntities`
- `testSurfaces`
- `hotspots`
- `capabilities`

It also updates tests and the `project-profile-bootstrap` skill prompt so the
profile agent can use these sections.

## Out Of Scope

- Full tree-sitter or LSP-backed multi-language parsing.
- Embedding/vector index or persistent semantic search.
- Full call graph or dataflow graph.
- Running project tests/builds during bootstrap.
- Remote repository cloning.
- Automatic knowledge promotion.
- UI graph visualization for the new sections.

## Decision (ADR-lite)

**Context:** The previous inventory is safe but shallow. GitHub tools show two
strong patterns: repo digest for speed and repo/symbol maps for useful AI
navigation. Full RAG or dependency-heavy parsing would be larger than this
increment and would introduce infrastructure choices that are not required to
improve profile quality.

**Decision:** Implement a dependency-free deterministic capability map inside
the existing read-only inventory stage. Keep `project-inventory.json` as the
single input to the profile agent, with additive sections and source refs.

**Consequences:**

- The platform gets immediate higher-signal onboarding without new services.
- Heuristic extraction will miss some framework-specific cases; output must
  carry confidence and warnings.
- A later task can replace or enrich heuristics with tree-sitter/LSP/RAG while
  keeping the same capability-map contract.

## Acceptance Criteria

- [ ] `project-inventory.json` still includes existing repo/scan/sources/commands/modules/git/exclusions/warnings fields.
- [ ] `project-inventory.json` includes deterministic `entrypoints`, `symbols`, `domainEntities`, `testSurfaces`, `hotspots`, and `capabilities` arrays.
- [ ] Fixture repositories with routes/controllers/services/models/tests produce at least one capability with source refs.
- [ ] Sensitive files such as `.env` and credential paths do not appear in excerpts, symbols, entrypoints, or capabilities.
- [ ] Generated/large/binary files are excluded before capability extraction.
- [ ] `profile.bootstrap` still runs `inventory -> profile -> completion -> knowledge` and does not dispatch implementation/build/test stages.
- [ ] Missing/unready backend still preserves inventory and fails only at `profile`.
- [ ] The profile skill prompt instructs the agent to use capability-map evidence and distinguish facts/inferences/open questions.
- [ ] Existing profile bootstrap tests pass.
- [ ] Full `bun run test` and `bun run typecheck` pass.

## Definition Of Done

- Markdown planning docs are present: PRD, solution design, task breakdown, and
  regression test plan.
- Implement/check context JSONL files reference relevant specs and task docs.
- The task is started through Trellis before implementation.
- Focused tests cover the new scanner sections.
- Project-wide tests and typecheck pass.
- Specs are updated if the inventory/profile contract changes.

## Technical Notes

- Current scanner: `apps/runner/src/project-inventory.ts`
- Inventory orchestration: `apps/runner/src/orchestrator/steps.ts`
- Profile skill prompt: `apps/runner/src/skills/index.ts`
- Flow contract: `.trellis/spec/runner/backend/flow-registry.md`
- Context/knowledge contract: `.trellis/spec/shared/backend/context-injection-protocol.md`
