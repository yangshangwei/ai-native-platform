# Legacy Project Capability Map Bootstrap - Completion Summary

## Completed

- Created planning artifacts:
  - `prd.md`
  - `solution-design.md`
  - `task-breakdown.md`
  - `regression-test-plan.md`
  - `research-oss-codebase-understanding.md`
- Curated Trellis implementation and check context files.
- Extended `project-inventory.json` with additive capability-map sections:
  - `entrypoints`
  - `symbols`
  - `domainEntities`
  - `testSurfaces`
  - `hotspots`
  - `capabilities`
- Kept the scanner read-only and dependency-free.
- Reused existing filtering before extraction:
  sensitive paths, generated paths, binary files, oversized files, and budget
  exclusions.
- Updated `project-profile-bootstrap` skill instructions so the profile agent
  treats capability-map evidence as first-class and keeps heuristic
  interpretations in open questions.
- Updated the runner flow-registry spec to document capability-map additions to
  the `profile.bootstrap` inventory artifact.
- Expanded the inventory fixture test to cover routes, CLI scripts, bootstrap,
  queue/job hints, symbols, domain entities, test surfaces, hotspots,
  capabilities, and secret exclusion.

## Verification

Focused inventory:

```bash
bun run test -- apps/runner/test/project-inventory.test.ts
```

Result: 1 test passed.

Focused profile/context regression:

```bash
bun run test -- apps/runner/test/orchestrator-profile-bootstrap.test.ts apps/runner/test/context-builder.test.ts
```

Result: 2 files / 24 tests passed.

Profile bootstrap regression bundle:

```bash
bun run test -- apps/runner/test/project-inventory.test.ts apps/runner/test/orchestrator-profile-bootstrap.test.ts apps/runner/test/context-builder.test.ts packages/shared/test/flow-registry.test.ts apps/runner/test/flow-registry.test.ts apps/api/test/workflow-request-routes.test.ts apps/api/test/report-sidecars.test.ts apps/web/test/projects-rendering.test.ts
```

Result: 8 files / 111 tests passed.

Typecheck:

```bash
bun run typecheck
```

Result: passed.

Full unit/integration suite:

```bash
bun run test
```

Result: 107 files / 923 tests passed.

## Remaining Risks

- Extraction is regex/heuristic based. It is intentionally conservative but
  will miss framework-specific or dynamic entrypoints.
- No tree-sitter/LSP/RAG index was added in this MVP; those remain follow-up
  enhancements if higher symbol precision or task-specific semantic search is
  needed.
- Existing full `scripts/e2e.ts` still targets `feature.standard`; profile
  bootstrap has focused integration coverage but no separate full external E2E
  script in this task.
- The current worktree contains pre-existing uncommitted `profile.bootstrap`
  changes. This task builds on them and does not attempt to split or revert
  that earlier work.
