# Legacy Project Profile Bootstrap - Requirements

## Background

AI Native Platform already supports an evidence-driven delivery loop:
`WorkflowRequest -> WorkflowRun -> artifacts/gates/reports -> Knowledge Candidate -> Knowledge Gate`.
It also has a provider-neutral `ContextPack` layer that can reuse project profile,
accepted knowledge, run history, and current task artifacts.

The missing capability is a fast way to initialize useful long-term knowledge for
an existing legacy project. Today a newly registered old project depends on sparse
manual notes or whatever the first delivery task discovers. That makes early agent
runs less grounded and forces users to repeatedly explain architecture, commands,
domain vocabulary, and risk areas.

This feature introduces a read-only bootstrap workflow that scans an existing
repository, produces a reviewable project profile, and turns high-confidence
findings into knowledge candidates. Nothing becomes authoritative until the user
accepts it through the existing Knowledge Gate.

## Goal

Provide a "Generate Legacy Project Profile" capability for registered projects.
The feature should quickly create a traceable old-project information package that
can be reviewed by humans, promoted to long-lived project knowledge, and reused by
future `ContextPack` construction.

## Users

- Project owner onboarding an old codebase into AI Native Platform.
- Tech lead who wants agent runs to inherit architecture, commands, and risk
  context before the first implementation task.
- Developer joining a legacy project who needs a trustworthy orientation document.
- Operator reviewing which automatically recovered facts are safe to promote.

## Problems

1. Legacy projects often have scattered knowledge across README files, docs,
   configuration, tests, commits, and team conventions.
2. A generic agent summary is not enough because it lacks evidence references and
   can silently mix facts with inference.
3. Automatically writing all discoveries into long-term memory is risky; stale or
   inferred statements can mislead future agent runs.
4. The platform already has knowledge promotion and context injection mechanisms,
   so a separate memory system would duplicate lifecycle and governance logic.

## Requirements

### Functional Requirements

| ID | Requirement |
| --- | --- |
| FR-1 | A user can start a read-only legacy project profile bootstrap for a registered project. |
| FR-2 | The bootstrap produces a repository inventory artifact with file/config/command/git evidence. |
| FR-3 | The bootstrap produces a human-readable `project-profile.md` artifact. |
| FR-4 | The bootstrap produces a structured `project-profile.json` artifact. |
| FR-5 | The bootstrap separates facts, inferences, and open questions. |
| FR-6 | Each load-bearing claim includes `sourceRefs`, confidence, freshness, and scope. |
| FR-7 | The bootstrap generates `knowledge_candidate` output that maps profile findings to existing `KnowledgeArtifactKind` values. |
| FR-8 | Knowledge candidates remain draft/reviewable until accepted through the Knowledge Gate. |
| FR-9 | Future `ContextPack` construction can prefer accepted profile knowledge when relevant. |
| FR-10 | The workflow must not modify the target project worktree. |
| FR-11 | Sensitive paths and generated/heavy files are excluded from inventory content capture. |
| FR-12 | The UI shows generation status, artifacts, candidate knowledge, and review actions from the project surface. |
| FR-13 | If no agent backend is configured or preflight-ready, the workflow still produces the read-only inventory when possible, then fails the profile stage with actionable setup guidance instead of fabricating a profile. |

### Non-Functional Requirements

| ID | Requirement |
| --- | --- |
| NFR-1 | Bootstrap must be safe for local trusted execution and default to read-only operations. |
| NFR-2 | The scan must be bounded by file count, byte count, and timeout budgets. |
| NFR-3 | Results must be deterministic enough for tests: stable ordering, normalized paths, stable JSON shape. |
| NFR-4 | The design must reuse `FLOW_REGISTRY`, `Workflow Engine`, artifact storage, and Knowledge Gate. |
| NFR-5 | No new runtime dependency is required for the MVP. |
| NFR-6 | The feature must work even if no agent backend is configured, at least for inventory generation and explicit preflight messaging; profile synthesis requires a real configured backend and must fail closed when unavailable. |

## MVP Scope

The MVP covers one local registered project at a time:

1. A Web entry point on the project/detail or settings surface.
2. A new workflow flow, tentatively `profile.bootstrap`.
3. Runner inventory collection from repository files and git metadata.
4. Agent-assisted profile synthesis using the existing backend abstraction.
5. Artifact persistence for inventory, markdown profile, JSON profile, and knowledge candidate.
6. Review UI that links to artifacts and existing knowledge acceptance actions.
7. Unit, integration, and E2E coverage for the happy path and safety failures.

## Out Of Scope

- Full semantic code index or embeddings.
- Cross-repository organization memory.
- Automatic promotion of knowledge without human review.
- Editing or refactoring the target project.
- Remote repository cloning.
- Auth/multi-tenant isolation beyond current local trusted mode.
- Replacing existing `context_pack` behavior.

## Proposed User Flow

1. User registers or opens an existing project.
2. User clicks "Generate legacy profile".
3. API creates a `WorkflowRequest` with `flowId='profile.bootstrap'`.
4. API-managed Runner starts or reuses the local runner watch process.
5. Runner claims the request and executes inventory, profile synthesis, completion, and knowledge.
6. UI shows progress and links to generated artifacts.
7. User reviews project profile and knowledge candidates.
8. User accepts, edits, or rejects candidate knowledge.
9. Accepted knowledge becomes available to later `ContextPack` retrieval.

## Acceptance Criteria

- [x] A registered project can start a profile bootstrap from the Web UI.
- [x] The created run uses the new bootstrap flow and does not execute build/test or implementation stages.
- [x] Inventory output is persisted as an artifact and cites inspected files/configs/commits.
- [x] `project-profile.md` and `project-profile.json` are persisted as artifacts.
- [x] The generated profile includes architecture map, commands, test strategy, risk areas, domain vocabulary, and open questions when evidence is insufficient.
- [x] Knowledge candidates are generated as draft/reviewable output and require human acceptance.
- [x] Accepted profile knowledge appears as eligible context in a later task's `ContextPack`.
- [x] Sensitive and excluded paths do not appear as full content in artifacts.
- [x] Missing/unready agent backend leaves an inspectable inventory artifact and clear setup/preflight guidance; it does not generate profile or knowledge artifacts.
- [x] Regression tests cover shared flow contracts, runner inventory, API request handling, knowledge candidate generation, UI action, and E2E happy path.

## Open Decisions

| Decision | Recommendation | Rationale |
| --- | --- | --- |
| Flow id | `profile.bootstrap` | Shorter than `legacy_profile.bootstrap`; names the durable concept rather than only legacy projects. |
| Run type | Add `WorkflowRunType='profile'` | Avoid overloading `feature` or `ask`; this is read-only workflow execution with artifacts. |
| Stages | Add `inventory` and `profile` stages | Existing `scan`/`analyze` names are refactor/issue-shaped; profile bootstrap needs explicit stage semantics. |
| Profile artifact kind | Reuse per-run `project_profile`; add metadata role | `project_profile` already exists and is used by context systems. |
| Knowledge kinds | Reuse existing `architecture`, `decision`, `lesson`, `pattern`, `dev_guide`, `api_doc`, `explore` | Avoid expanding knowledge taxonomy before evidence proves a gap. |
| No backend behavior | Inventory succeeds, profile fails closed with setup guidance | Preserves read-only scan value without inventing unsupported long-term memory. |

## Technical Notes

- Current flow registry lives in `packages/shared/src/flows/registry.ts`.
- Flow id and stage unions live in `packages/shared/src/types/workflow.ts`.
- Per-run artifact kind `project_profile` already exists in `packages/shared/src/types/artifact.ts`.
- Knowledge artifact kinds already include `architecture`, `decision`, `lesson`,
  `pattern`, `explore`, `dev_guide`, and `api_doc`.
- `ContextPackMode` already includes `bootstrap`.
- Runner context retrieval already scores candidates by source type, knowledge
  class, trust level, freshness, confidence, and task keyword overlap.
