# End-to-End Business Flow Validation

Date: 2026-05-05

## Objective

Validate the current AI Native Platform business flow end to end and identify process problems.

## Environment

- API: `http://127.0.0.1:8787/health` returned `ok: true`.
- Bun: `1.3.11`.
- Java: `openjdk 1.8.0_452`.
- Maven: `3.9.11`.
- Sample project: `examples/java-maven-sample` is a Git worktree.
- Agent CLIs:
  - `codex --version` returned `codex-cli 0.128.0`; `codex login status` reported logged in, but runtime calls returned `403 insufficient balance`.
  - `claude --version` returned `2.1.117`; `claude auth status` reported logged in, but workflow implementation did not exit before Runner timeout.

## Validation Matrix

| Flow | Command / Entry | Result | Evidence |
| --- | --- | --- | --- |
| Direct documented full E2E with Codex | `bun run e2e` after configuring project backend to `codex` | Failed at `implementation` before a full standard-lifecycle proof | `run_6beb318c2ee7`, status `failed`, agent result `codex exited 1 during implementation`; console showed `403 Forbidden: insufficient balance`; run `flowId = feature.fastforward` |
| Direct documented full E2E with Claude Code | `bun run e2e` after configuring project backend to `claude_code` | Failed at `implementation` before a full standard-lifecycle proof | `run_340b2046742a`, status `failed`, agent result `claude exited 143 during implementation`; stream repeatedly printed `Done.` until 10-minute timeout; run `flowId = feature.fastforward` |
| Build/test smoke | `bun run smoke` | Passed | `run_faee3a65b583`, status `passed`, `mvn -B test` exit `0`, `test_gate=pass`, Surefire `3 passed / 3` |
| API-managed Runner control + WorkflowRequest queue | `POST /runner/control/start`, then `POST /workflow-requests` | Runner consumed request but paused before WorkflowRun | `wreq_5218be86ddc5`, status `awaiting_clarification`; runner logs show Coordinator `pause_for_human`; message duplicated after manual `watch --once` |
| Browser UI: project onboarding + short feature request | gstack browser drove `http://127.0.0.1:5174/#projects` and `#new-task`; API used isolated `AINP_DB_PATH=/tmp/ainp-browser-e2e-20260505.sqlite`, `AINP_HOME=/tmp/ainp-browser-e2e-home`, API `:8788`, Web `:5174` | UI path worked through project registration, Codex preflight, request creation, API-managed runner start, and runner claim; workflow then failed correctly at implementation gate | Project `proj_2a63e4149468` registered with `agentBackend=codex`; `wreq_ff2af8d5f1ee` claimed; `run_ca7bc0294635`, `flowId=feature.fastforward`, `status=failed`, `diff_scope_gate=fail`, `sensitive_change_gate=warn`; screenshot `/tmp/ainp-browser-failed-task.png`; annotated screenshot `/tmp/ainp-browser-failed-task-annotated.png` |
| Browser UI: project onboarding + explicit standard-flow-sized request | Same browser-driven UI path with a longer task title so Smart Router selected `feature.standard` | UI path again worked through request creation and runner start; standard workflow failed at `context_pack` before first manual gate | `wreq_a2942c88512d` claimed; `run_e83d36c8b93c`, `flowId=feature.standard`, `status=failed`, `currentStage=context_pack`; `agentResults[0].summary = codex produced empty artifact at /Users/artisan/.ai-native/artifacts/run_e83d36c8b93c/context_pack/context_pack.md`; `.codex-last-message.txt` says Codex was blocked because the required artifact path was outside writable roots; screenshot `/tmp/ainp-browser-standard-failed-task.png`; annotated screenshot `/tmp/ainp-browser-standard-failed-task-annotated.png` |
| Internal full standard lifecycle with deterministic fake Claude backend | `AINP_CLAUDE_BIN=.trellis/.../fake-claude-e2e.mjs bun run runner -- orchestrate --flow-id feature.standard ...` plus auto approvals | Passed | `run_75dd25561a7a`, status `passed`; gates `requirement/design/diff_scope/sensitive_change/compile/test/acceptance/knowledge` all `pass`; compile/test commands exit `0`; Surefire `4 passed / 4`; completion and knowledge artifacts generated |

## Verification Command Coverage

- `bun test` and `bun run typecheck` are useful repo-health checks, but they do not validate the end-to-end business objective by themselves.
- `bun run smoke` covers the narrow command-execution slice: project registration, worktree prep, `mvn -B test`, and persisted command/build evidence.
- The deterministic fake-backend run `run_75dd25561a7a` proves the internal standard lifecycle, gate engine, artifact/report generation, and knowledge persistence path, but it is task-local evidence rather than a user-facing real-backend proof.
- The PRD's two user-facing acceptance paths are covered only when combined with:
  - the real direct-path attempts via `bun run e2e`, and
  - the API-managed queue path via `POST /runner/control/start` plus `POST /workflow-requests`.
- Therefore the verification set is sufficient to classify the product state for this task, but only because it includes the failed real-backend and queue-path evidence in addition to the green smoke/typecheck/test/fake-backend checks.

## Confirmed Green Path

The platform's internal workflow engine, runner orchestration, gate engine, artifact persistence, Maven command execution, completion report generation, and knowledge candidate/persistence path can complete successfully when the Agent Backend behaves deterministically and exits cleanly.

Key evidence from `run_75dd25561a7a`:

- `run.status = passed`, `currentStage = completion`, `flowId = feature.standard`.
- `currentStage = completion` is internally consistent with a green knowledge phase because successful runs are normalized to `completion` at workflow finalization; knowledge success is evidenced by `knowledge_gate = pass`, the `knowledge_candidate` artifact, and the persisted knowledge file.
- Steps passed: `context_pack`, `requirement`, `design`, `implementation`, `build_test`, `review`.
- Commands passed:
  - `mvn -B -DskipTests compile`, exit `0`.
  - `mvn -B test`, exit `0`.
- Gates passed:
  - `requirement_gate`, `design_gate`, `diff_scope_gate`, `sensitive_change_gate`, `compile_gate`, `test_gate`, `acceptance_gate`, `knowledge_gate`.
- Artifacts generated:
  - `project_profile`, `context_pack`, `requirement_draft`, `design_doc`, `diff`, `surefire_report`, `review`, `completion_report`, `knowledge_candidate`.
- Knowledge was persisted to `/Users/artisan/.ai-native/projects/proj_5af0f51aa230/knowledge/run_75dd25561a7a.md`.

## Task-Local Fixture Scope

- `research/fake-claude-e2e.mjs` is a task-local deterministic CLI stub created only to capture validation evidence for this task.
- It is stored under the task's `research/` directory, is not wired into product code or CI entrypoints, and should not be treated as a shipped backend fixture.
- Its only intended side effect is to mutate the sample Java worktree used by the validation run so compile/test/report evidence is real.

## Issues Found

1. `scripts/e2e.ts` is stale against the current Agent Backend setup rule.
   - First run failed before workflow creation because `ensureProject()` creates or reuses `java-sample` without setting `agentBackend`.
   - Current product requires project backend to be configured before workflow creation.
   - The script should either register with `--agent-backend`, call the API backend update endpoint, or fail with a clearer precondition message.

2. `scripts/e2e.ts` no longer proves the documented "full 9-stage lifecycle" under current Smart Router behavior.
   - Even after backend setup, the API recommended `feature.fastforward` for the short title.
   - Runs `run_6beb318c2ee7` and `run_340b2046742a` were created with `flowId = feature.fastforward`, so they skipped `context_pack`, `requirement`, `design`, and `knowledge`.
   - The script's comment and assertions claim full lifecycle coverage, but the runtime default now routes short feature titles to fastforward unless `flowId` is explicit.

3. Real Codex backend is currently environment-blocked.
   - Preflight/login passed, but runtime failed with `403 Forbidden: insufficient balance`.
   - This is likely account/billing state, not a platform engine defect.
   - The platform correctly recorded agent task/result failure and workflow failure at `implementation`.

4. Real Claude Code backend can edit the worktree but did not terminate cleanly.
   - The runner stream showed implementation work completed and repeated `Done.` messages.
   - Runner timed out after 10 minutes and recorded `claude exited 143 during implementation`.
   - This is an end-to-end risk because a successful model answer did not translate into a successful stage completion.
   - Suspected area: Claude Code hook/runtime behavior or `--print` termination semantics in the local CLI environment.

5. Queue intake can pause a concrete-looking request because Coordinator LLM fallback is brittle.
   - `wreq_5218be86ddc5` with title `增加一个 subtract 方法并补测试` ended at `awaiting_clarification`.
   - Latest decision reason: `claude_code CLI invocation failed: claude one-shot timed out`.
   - This blocks Web-like task intake before the user gets a workflow run.

6. Duplicate Coordinator clarification messages are possible when two watch consumers process the same awaiting request.
   - The request messages include the same Coordinator question twice.
   - Evidence: `wreq_5218be86ddc5/messages` had two coordinator messages with `LLM 调用失败，能否补充更多上下文？`.
   - Cause observed in validation: API-managed watch paused the request; a manual `watch --once` run later processed the same request state again.

7. Browser/UI queue flow is not currently green with real Codex, even though UI intake itself works.
   - Browser-driven project onboarding worked: local sample path was detected, Codex was selected, and Codex preflight returned `connected`.
   - Browser-driven task creation worked: `POST /api/workflow-requests` returned `201`, and the UI triggered `POST /api/runner/control/start`.
   - Short feature request `run_ca7bc0294635` reached real implementation, but Codex added `.gitignore`; `diff_scope_gate` failed with `outside scope: .gitignore`, and `sensitive_change_gate` warned on `.gitignore`.
   - This is a useful product signal: the fast-forward prompt/gate combination permits the agent to make a plausible extra hygiene edit that the platform later rejects.

8. `feature.standard` with Codex cannot currently produce non-worktree artifacts.
   - Browser-driven standard request `run_e83d36c8b93c` selected `feature.standard` and entered `context_pack`.
   - The runner asked Codex to write `context_pack.md` under `/Users/artisan/.ai-native/artifacts/...`.
   - Codex sandbox rejected the write because that artifact path is outside the project writable roots; `context_pack.md` remained `0` bytes and the run failed.
   - Likely product-side fix area: align Codex `--add-dir` / sandbox writable roots with the artifact output directory, or place agent-produced artifacts under a writable path that Codex can access.

9. Failed runs can leave the UI task detail page visually under-informative at the first viewport.
   - Browser screenshots for both failed task detail pages showed only the sidebar and `Runner 已自动运行` in the captured viewport.
   - API evidence had rich failure detail, but the first viewport did not expose the failed stage summary strongly enough in the snapshot.
   - This is lower priority than the runtime blockers, but it affects browser dogfooding and supportability.

## Recommended Follow-ups

- Fix `scripts/e2e.ts` so it configures an Agent Backend explicitly and uses `--flow-id feature.standard` or an API path that forces standard flow when it claims full lifecycle coverage.
- Add a deterministic fake backend or test fixture mode for CI-style E2E validation so the platform can verify the business engine without spending real LLM credits or depending on user account state.
- Investigate Claude Code one-shot/runtime termination under the current local hook setup; a completed assistant answer must produce process exit before Runner timeout.
- Harden Coordinator pause handling so an already-paused request is not re-paused with duplicate coordinator messages by concurrent or repeated watch runs.
- Consider a rules-first bypass for obviously small feature requests so Web intake is less dependent on LLM fallback availability.
- For Codex-backed standard flows, ensure the artifact output directory is inside Codex writable roots or pass sandbox/add-dir settings that actually permit writing the requested artifact path.
- Tighten the fast-forward implementation prompt or allowed-write policy so model hygiene edits like `.gitignore` do not make otherwise valid small changes fail late at `diff_scope_gate`.
