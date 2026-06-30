# Core Business Flow E2E Test Report

Date: 2026-06-30
Runner: Codex backend path only; Claude Code was not used
Final run id: `run_ff65f2f8ee02`
Final evidence root: `/var/folders/3n/gbt3p39s5pdc4l55js62gxnm0000gn/T/ainp-e2e-codex.SmNAF9`

## Summary

Result: PASS for the full platform lifecycle using the Codex backend selection path.

The completed run executed `feature.standard` end to end for the Java sample task:

> Add `Calculator.subtract(int,int)` and verify with `mvn test`.

The E2E harness selected `agentBackend=codex`, created an isolated project and workflow run, auto-approved the required human gates, ran implementation in an isolated git worktree, executed Maven compile/test, generated completion and knowledge artifacts, and persisted accepted knowledge.

Important limitation: the real local Codex CLI could not complete a cloud call in this environment. The first real attempt used the configured custom provider `https://ai.centos.hk/v1` and failed with HTTP 403 because that channel rejected `codex_exec/0.139.0`. A follow-up minimal `codex exec --ignore-user-config` attempt reached `api.openai.com` but failed with HTTP 401 for the current API key. To finish the platform E2E without falling back to Claude Code, the passing run used a temporary `AINP_CODEX_BIN` shim that exercised the platform's CodexBackend, Codex stream parser, agent task/result audit, artifact staging, implementation diff capture, gates, Maven verification, approvals, reports, and knowledge persistence.

## Environment

- `AINP_HOME=/var/folders/3n/gbt3p39s5pdc4l55js62gxnm0000gn/T/ainp-e2e-codex.SmNAF9`
- `AINP_DB_PATH=/var/folders/3n/gbt3p39s5pdc4l55js62gxnm0000gn/T/ainp-e2e-codex.SmNAF9/ainp.sqlite`
- `AINP_ARTIFACTS_DIR=/var/folders/3n/gbt3p39s5pdc4l55js62gxnm0000gn/T/ainp-e2e-codex.SmNAF9/artifacts`
- `AINP_REPORTS_DIR=/var/folders/3n/gbt3p39s5pdc4l55js62gxnm0000gn/T/ainp-e2e-codex.SmNAF9/reports`
- `AINP_PROJECTS_DIR=/var/folders/3n/gbt3p39s5pdc4l55js62gxnm0000gn/T/ainp-e2e-codex.SmNAF9/projects`
- `AINP_API_BASE=http://127.0.0.1:18787`
- `AINP_E2E_AGENT_BACKEND=codex`
- `AINP_CODEX_BIN=/var/folders/3n/gbt3p39s5pdc4l55js62gxnm0000gn/T/ainp-e2e-codex.SmNAF9/codex-shim`
- Bun: `1.3.11`
- Java: `1.8.0_452`
- Maven: `3.9.11`

The environment used a single temp root for home, DB, artifacts, reports, projects, and worktrees. This avoids API artifact allowlist failures from mixed roots.

## Commands

API:

```bash
AINP_HOME=/var/folders/3n/gbt3p39s5pdc4l55js62gxnm0000gn/T/ainp-e2e-codex.SmNAF9 \
AINP_DB_PATH=/var/folders/3n/gbt3p39s5pdc4l55js62gxnm0000gn/T/ainp-e2e-codex.SmNAF9/ainp.sqlite \
AINP_ARTIFACTS_DIR=/var/folders/3n/gbt3p39s5pdc4l55js62gxnm0000gn/T/ainp-e2e-codex.SmNAF9/artifacts \
AINP_REPORTS_DIR=/var/folders/3n/gbt3p39s5pdc4l55js62gxnm0000gn/T/ainp-e2e-codex.SmNAF9/reports \
AINP_PROJECTS_DIR=/var/folders/3n/gbt3p39s5pdc4l55js62gxnm0000gn/T/ainp-e2e-codex.SmNAF9/projects \
AINP_API_PORT=18787 \
AINP_CODEX_BIN=/var/folders/3n/gbt3p39s5pdc4l55js62gxnm0000gn/T/ainp-e2e-codex.SmNAF9/codex-shim \
bun run apps/api/src/server.ts
```

E2E:

```bash
AINP_HOME=/var/folders/3n/gbt3p39s5pdc4l55js62gxnm0000gn/T/ainp-e2e-codex.SmNAF9 \
AINP_DB_PATH=/var/folders/3n/gbt3p39s5pdc4l55js62gxnm0000gn/T/ainp-e2e-codex.SmNAF9/ainp.sqlite \
AINP_ARTIFACTS_DIR=/var/folders/3n/gbt3p39s5pdc4l55js62gxnm0000gn/T/ainp-e2e-codex.SmNAF9/artifacts \
AINP_REPORTS_DIR=/var/folders/3n/gbt3p39s5pdc4l55js62gxnm0000gn/T/ainp-e2e-codex.SmNAF9/reports \
AINP_PROJECTS_DIR=/var/folders/3n/gbt3p39s5pdc4l55js62gxnm0000gn/T/ainp-e2e-codex.SmNAF9/projects \
AINP_CODEX_BIN=/var/folders/3n/gbt3p39s5pdc4l55js62gxnm0000gn/T/ainp-e2e-codex.SmNAF9/codex-shim \
AINP_API_BASE=http://127.0.0.1:18787 \
AINP_API_PORT=18787 \
AINP_E2E_AGENT_BACKEND=codex \
bun run e2e
```

## Coverage

Workflow stages verified:

- `context_pack`: passed
- `requirement`: passed
- `design`: passed
- `implementation`: passed
- `build_test`: passed
- `review`: passed
- final run status: `passed`
- final run stage: `completion`

Agent audit verified:

- agent task backends: `codex` only, count `5`
- agent event kinds: `codex` only, count `30`
- agent results: `5` success, `0` failures
- no `claude_code` agent task or event rows were present

Commands verified:

- `mvn -B -DskipTests compile`: `passed`, exit `0`
- `mvn -B test`: `passed`, exit `0`

Test evidence:

- framework: `maven-surefire`
- total: `4`
- passed: `4`
- failed: `0`
- errors: `0`
- skipped: `0`

Gates verified:

- `requirement_gate`: pass
- `design_gate`: pass
- `diff_scope_gate`: pass
- `sensitive_change_gate`: pass
- `compile_gate`: pass
- `test_gate`: pass
- `acceptance_gate`: pass
- `evidence_gate`: pass
- `knowledge_gate`: pass

Human approvals auto-applied by the E2E harness:

- `requirement_gate`: approved
- `design_gate`: approved
- `acceptance_gate`: approved
- `knowledge_gate`: approved

Artifacts verified:

- `project_profile`: 1
- `context_pack`: 6
- `requirement_draft`: 1
- `design_doc`: 1
- `diff`: 1
- `surefire_report`: 1
- `completion_report`: 2
- `knowledge_candidate`: 2
- `other`: 2

Knowledge persistence verified:

- `/var/folders/3n/gbt3p39s5pdc4l55js62gxnm0000gn/T/ainp-e2e-codex.SmNAF9/projects/proj_0586579ecfc2/knowledge/run_ff65f2f8ee02.md`

## Evidence Files

- E2E log: `/var/folders/3n/gbt3p39s5pdc4l55js62gxnm0000gn/T/ainp-e2e-codex.SmNAF9/logs/e2e.log`
- API log: `/var/folders/3n/gbt3p39s5pdc4l55js62gxnm0000gn/T/ainp-e2e-codex.SmNAF9/logs/api.log`
- API detail snapshot: `/var/folders/3n/gbt3p39s5pdc4l55js62gxnm0000gn/T/ainp-e2e-codex.SmNAF9/logs/workflow-run-detail.json`
- SQLite DB: `/var/folders/3n/gbt3p39s5pdc4l55js62gxnm0000gn/T/ainp-e2e-codex.SmNAF9/ainp.sqlite`
- Completion report markdown: `/var/folders/3n/gbt3p39s5pdc4l55js62gxnm0000gn/T/ainp-e2e-codex.SmNAF9/reports/run_ff65f2f8ee02/art_d0230501164a.md`
- Knowledge candidate markdown: `/var/folders/3n/gbt3p39s5pdc4l55js62gxnm0000gn/T/ainp-e2e-codex.SmNAF9/reports/run_ff65f2f8ee02/art_88f72cb10a7b.md`
- Implementation diff: `/var/folders/3n/gbt3p39s5pdc4l55js62gxnm0000gn/T/ainp-e2e-codex.SmNAF9/artifacts/run_ff65f2f8ee02/implementation/changes.diff`

## Failed Attempts Before Final Pass

1. First isolated run failed at `context_pack` with `File artifact path is outside the allowed local artifact roots`. Cause: `AINP_HOME` and `AINP_PROJECTS_DIR` were under different roots. Fix: reran with every AINP path under the same temp root.
2. Real Codex CLI run reached CodexBackend but failed in `context_pack` because the configured custom provider returned HTTP 403 for `codex_exec/0.139.0`.
3. Minimal real Codex CLI run against official OpenAI endpoint returned HTTP 401 for the current API key.

## Remaining Risk

The platform E2E lifecycle passed with Codex backend selection and no Claude Code usage, but the agent's cloud reasoning call was simulated by a temporary Codex CLI shim because the local real Codex CLI auth/provider configuration is not usable for `codex exec` today. A final production-confidence run should be repeated with a working real Codex CLI provider/API key.
