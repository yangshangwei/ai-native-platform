# Legacy Project Profile Bootstrap - Task Breakdown

## Phase 0 - Planning And Contract Lock

| ID | Task | Files | Done When |
| --- | --- | --- | --- |
| P0-1 | Confirm flow naming and run type decision. | task docs | `profile.bootstrap` and `profile` are accepted or replaced consistently. |
| P0-2 | Finalize inventory/profile JSON schemas. | task docs / shared types if promoted | Schema version and required fields are fixed for MVP. |
| P0-3 | Define scan budgets and exclusions. | runner docs/spec | Sensitive/generated/large path policy is explicit. |

## Phase 1 - Shared Contracts

| ID | Task | Files | Done When |
| --- | --- | --- | --- |
| P1-1 | Add `WorkflowRunType='profile'`. | `packages/shared/src/types/workflow.ts` | Typecheck recognizes profile requests/runs. |
| P1-2 | Add stages `inventory` and `profile`. | `packages/shared/src/types/workflow.ts` | `WORKFLOW_STAGES` guard passes. |
| P1-3 | Add `FlowId='profile.bootstrap'`. | `packages/shared/src/types/workflow.ts` | Flow id is accepted by `isFlowId`. |
| P1-4 | Register flow in `FLOW_REGISTRY`. | `packages/shared/src/flows/registry.ts` | Registry exhaustiveness passes. |
| P1-5 | Add flow registry tests. | `apps/runner/test/flow-registry.test.ts` | Stage order is pinned. |

## Phase 2 - Runner Inventory

| ID | Task | Files | Done When |
| --- | --- | --- | --- |
| P2-1 | Implement inventory data builder. | `apps/runner/src/project-inventory.ts` or equivalent | Fixture repo produces stable inventory JSON. |
| P2-2 | Implement exclusion/sensitivity filtering. | runner inventory module, shared context policy helpers | `.env`, generated dirs, binary and oversized files are excluded. |
| P2-3 | Add structured parsers for common configs. | runner inventory module | `package.json`, Maven, CI, and README evidence is captured. |
| P2-4 | Add git summary collection with graceful fallback. | runner inventory module | Missing git does not crash inventory. |
| P2-5 | Persist inventory artifact. | orchestrator step/API client path | Run detail shows inventory artifact. |

## Phase 3 - Profile Agent Stage

| ID | Task | Files | Done When |
| --- | --- | --- | --- |
| P3-1 | Add `project-profile-bootstrap` SkillSpec. | `apps/runner/src/skills/index.ts` | Stage has prompt/output contract. |
| P3-2 | Add prompt renderer text for profile synthesis. | runner skill/prompt code | Agent is instructed to separate facts/inferences/open questions. |
| P3-3 | Extend orchestrator dispatch for `profile`. | `apps/runner/src/orchestrator/steps.ts` or dispatcher | Profile stage consumes inventory and emits artifacts. |
| P3-4 | Validate profile JSON before artifact registration. | runner/profile helper | Invalid JSON fails profile stage with clear error. |

## Phase 4 - API And Workflow Request Support

| ID | Task | Files | Done When |
| --- | --- | --- | --- |
| P4-1 | Allow profile run/request type through API validation. | API routes/shared guards | Request creation accepts `type='profile'`. |
| P4-2 | Add optional project bootstrap route. | `apps/api/src/routes/projects.ts` or new route | `POST /projects/:id/profile-bootstrap` creates correct request. |
| P4-3 | Ensure run detail/projection handles new stages. | API projection/read model if any | Profile run detail renders without unknown-stage errors. |
| P4-4 | Add audit logs for bootstrap request creation. | workflow engine/action path | Profile bootstrap is traceable. |

## Phase 5 - Knowledge Candidate Generation

| ID | Task | Files | Done When |
| --- | --- | --- | --- |
| P5-1 | Load profile JSON in knowledge stage. | `apps/api/src/reports.ts` or runner report helper | Knowledge candidate generation reads `project-profile.json`. |
| P5-2 | Validate candidate kind/subtype. | report/knowledge helper | Invalid candidate is dropped with warning. |
| P5-3 | Render profile-specific knowledge candidate markdown. | reports code | Candidate artifact is grouped by knowledge kind. |
| P5-4 | Preserve source refs and confidence metadata. | reports/promote path | Promoted knowledge keeps profile provenance. |

## Phase 6 - Web UI

| ID | Task | Files | Done When |
| --- | --- | --- | --- |
| P6-1 | Add project/profile action UI. | `apps/web/src/page-projects.ts` or settings/project page | User can start bootstrap from project surface. |
| P6-2 | Add profile run status card. | web page/projection helpers | Latest profile status and artifact links are visible. |
| P6-3 | Link to knowledge candidate review. | web knowledge/task detail integration | User can review generated candidates. |
| P6-4 | Handle disabled/loading/error states. | web state/projection | Duplicate running bootstrap is prevented. |

## Phase 7 - Verification

| ID | Task | Files | Done When |
| --- | --- | --- | --- |
| P7-1 | Add shared contract tests. | shared/runner tests | Flow id/stages are pinned. |
| P7-2 | Add runner inventory unit tests. | runner tests | Inventory is stable and safe. |
| P7-3 | Add API request tests. | API tests | Profile bootstrap request/route works. |
| P7-4 | Add report/knowledge tests. | API/runner tests | Candidates are generated and invalid entries dropped. |
| P7-5 | Add Web projection tests. | web tests | UI action creates expected request and links artifacts. |
| P7-6 | Add E2E fixture flow. | `scripts/e2e.ts` or dedicated e2e test | Temporary project runs bootstrap and produces artifacts. |

## Suggested Implementation Order

1. Shared contracts and registry tests.
2. Runner inventory with unit tests.
3. Orchestrator profile flow using stub/fake agent tests.
4. API request support.
5. Knowledge candidate conversion.
6. Web entry point and status card.
7. E2E test and documentation/spec updates.

## Risk Register

| Risk | Mitigation |
| --- | --- |
| Agent produces confident but unsupported claims. | Require source refs and confidence; keep human gate. |
| Inventory captures secrets. | Reuse sensitive path policy; exclude `.env`, keys, credentials, binary files, and oversized files. |
| New flow breaks router/watch assumptions. | Contract tests for request kind, watch filtering, flow dispatch. |
| Profile run accidentally modifies repo. | No implementation/build stages; verify clean worktree after run. |
| Knowledge taxonomy is insufficient. | Reuse existing kinds first; document dropped/unknown candidates as open questions. |
| E2E flakiness from user machine agent backend. | Use fake/test backend where possible; isolate env vars and project paths. |

