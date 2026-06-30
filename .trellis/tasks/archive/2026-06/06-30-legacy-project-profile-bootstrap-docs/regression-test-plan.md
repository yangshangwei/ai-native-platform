# Legacy Project Profile Bootstrap - Regression Test Plan

## Test Goals

Regression coverage must prove:

1. The new flow is registered and type-safe.
2. The bootstrap run is read-only and does not execute implementation/build/test stages.
3. Inventory generation is deterministic, bounded, and safe around sensitive files.
4. Profile artifacts are valid markdown/JSON and cite inventory evidence.
5. Knowledge candidates are reviewable and not automatically accepted.
6. Accepted profile-derived knowledge can be selected by later `ContextPack` construction.
7. Web UI can start and inspect a profile bootstrap without breaking existing flows.

## Unit Tests

### Shared Flow Contracts

| Test | Expected |
| --- | --- |
| `FLOW_REGISTRY['profile.bootstrap']` exists. | Flow id is registered. |
| `profile.bootstrap` stages equal `inventory -> profile -> completion -> knowledge`. | Stage order is pinned. |
| `isFlowId('profile.bootstrap')` returns true. | API/runner guards accept the flow. |
| `isWorkflowStage('inventory')` and `isWorkflowStage('profile')` return true. | Stage guard accepts new stages. |
| Existing flow stage arrays are unchanged. | Feature/issue/refactor regressions are caught. |

### Runner Inventory

Fixture repository should include:

```text
README.md
package.json
apps/api/src/index.ts
docs/architecture.md
.github/workflows/ci.yml
.env
node_modules/generated.js
large-file.txt
binary.bin
```

| Test | Expected |
| --- | --- |
| Inventory captures README headings and package scripts. | Docs/config evidence appears. |
| Inventory captures source tree module paths. | Modules are stable and sorted. |
| Inventory excludes `.env`. | No secret content appears. |
| Inventory excludes `node_modules` and generated dirs. | Exclusion reason is recorded. |
| Inventory excludes oversized files. | Exclusion reason is `too_large`. |
| Binary files are excluded. | No binary content appears. |
| Missing git command falls back gracefully. | `git=null` and warning recorded. |
| Dirty repo is reported but not modified. | `repo.dirty` is true/false and no writes occur. |

### Profile JSON Validation

| Test | Expected |
| --- | --- |
| Valid profile JSON passes validation. | Artifact can be persisted. |
| Missing schema version fails validation. | Profile stage fails with clear error. |
| Claim without source refs is downgraded/open question. | Candidate is not suggested for promotion. |
| Candidate with invalid knowledge subtype is rejected. | Warning is emitted. |

### Knowledge Candidate Generation

| Test | Expected |
| --- | --- |
| `architecture` profile candidate renders in knowledge candidate markdown. | Markdown contains architecture section. |
| Confidence below threshold is not in default promotion set. | Candidate is review-only or open question. |
| Invalid kind/subtype is dropped. | Artifact warning explains why. |
| Source refs are preserved in JSON sidecar. | Promotion provenance remains available. |

### Context Retrieval

| Test | Expected |
| --- | --- |
| Accepted profile-derived architecture knowledge is selected for relevant future task. | `ContextPack.manifest` includes artifact source ref. |
| Draft profile candidate is not treated as accepted knowledge. | Draft candidate absent from authoritative sections. |
| Stale/conflicting profile knowledge follows existing review signal behavior. | Review signal appears or candidate is downranked. |

## Integration Tests

### API Request Creation

| Test | Expected |
| --- | --- |
| `POST /workflow-requests` accepts `type='profile'`, `flowId='profile.bootstrap'`. | Request is pending with correct flow id. |
| Optional `POST /projects/:id/profile-bootstrap` creates a request. | Response includes request id. |
| Invalid flow id is rejected. | 4xx with validation message. |
| `kind='ask'` isolation remains unchanged. | Ask requests still never enter runner execution. |

### Runner Watch And Orchestrator

| Test | Expected |
| --- | --- |
| Runner claims profile request. | WorkflowRun is created with `type='profile'`. |
| Orchestrator executes only profile flow stages. | No `implementation` or `build_test` step runs. |
| Inventory artifact is created before profile stage. | Profile stage receives inventory input. |
| Profile stage failure preserves inventory artifact. | User can inspect partial output. |
| Completion report cites inventory/profile artifacts. | Evidence references are present. |
| Knowledge stage produces candidate artifact. | Candidate can be reviewed. |

### Web Projection/UI

| Test | Expected |
| --- | --- |
| Project page renders `Generate legacy profile`. | Button exists for registered project. |
| Clicking action posts correct request body. | `type='profile'`, `flowId='profile.bootstrap'`. |
| Running profile request disables duplicate action. | Button disabled/loading state appears. |
| Latest profile card links artifacts. | Profile/inventory links resolve to artifact content. |
| Existing feature/issue/refactor UI still renders. | No projection crash on older runs. |

## E2E Test

### Happy Path

Use an isolated temp root, following existing full E2E environment guidance:

- `AINP_HOME`
- `AINP_DB_PATH`
- `AINP_ARTIFACTS_DIR`
- `AINP_REPORTS_DIR`
- `AINP_PROJECTS_DIR`

All should live under the same temporary root so artifact allowlists accept the
project path.

Scenario:

1. Create fixture legacy project under temp projects dir.
2. Register project.
3. Create profile bootstrap request.
4. Start runner watch or call orchestrator test harness.
5. Wait for run completion or knowledge gate pause.
6. Assert artifacts exist:
   - inventory JSON
   - `project-profile.md`
   - `project-profile.json`
   - completion report
   - knowledge candidate
7. Assert no implementation diff artifact exists.
8. Accept one knowledge candidate.
9. Start a later lightweight task/context-pack build.
10. Assert accepted profile knowledge is eligible in `ContextPack`.

### Failure E2E

Scenario:

1. Register project with missing/unreadable path.
2. Start profile bootstrap.
3. Assert run fails at `inventory`.
4. Assert error message is actionable.
5. Assert no knowledge candidate is produced.

## Manual QA

| Check | Expected |
| --- | --- |
| Start profile bootstrap from Web on a real old project. | Progress is visible in workbench/project surface. |
| Inspect generated markdown. | Facts/inferences/open questions are visually distinct. |
| Inspect JSON artifact. | Valid schema and source refs. |
| Review candidate knowledge. | User can accept/reject without leaving broken states. |
| Run a later normal task. | Accepted profile knowledge appears in context governance. |
| Re-run profile bootstrap. | Latest run is visible; old artifacts remain traceable. |

## Commands

Expected verification commands after implementation:

```bash
bun run test
bun run typecheck
bun run e2e
```

Focused tests should be runnable before the full suite:

```bash
bun run test -- flow-registry
bun run test -- project-inventory
bun run test -- knowledge
bun run test -- web
```

Exact focused command names may need adjustment to match actual test filenames.

## Regression Risks To Watch

- `FlowId` exhaustiveness failures in API/runner/web.
- Web projections assuming only feature/issue/refactor run types.
- Runner `dispatchStep()` missing new stage cases.
- Knowledge candidate report assuming a feature completion report shape.
- Artifact allowlist failures when E2E project paths sit outside `AINP_HOME`.
- Bun native test runner accidentally used instead of `bun run test`.

