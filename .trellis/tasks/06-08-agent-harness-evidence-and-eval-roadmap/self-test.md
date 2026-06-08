# Agent Harness Evidence Self-Test Guide

This guide verifies the M1/M2 evidence hardening changes and the current M4/M5/M6/M3 foundation locally.

## Automated Verification

Run from the repo root:

```bash
bun run typecheck
bun test apps/api/test/artifact-content.test.ts apps/api/test/command-log-routes.test.ts apps/api/test/gate-engine.test.ts apps/api/test/report-sidecars.test.ts
bun test apps/api/test/gate-engine.test.ts apps/api/test/verifier-evidence-route.test.ts
bun test apps/api/test/knowledge-artifacts-route.test.ts apps/api/test/router.test.ts apps/runner/test/knowledge.test.ts apps/runner/test/context-builder.test.ts
bun run eval
bun test
```

Expected results:

- TypeScript exits with status 0.
- Targeted tests pass and cover command log digest verification, artifact digest verification, Evidence Gate pass/fail rules, artifact-only compile/test evidence rejection, and completion-report 409 blocking when Evidence Gate fails.
- Verifier tests pass and cover UI Evidence Gate blocking when verifier refs are missing, verifier artifacts not counting as review evidence, rejection of untagged screenshots, and screenshot/matrix artifact ingestion through `/runner/events/artifact`.
- Router/knowledge/context tests pass and cover scoped structured KnowledgeArtifact selection plus legacy markdown fallback behavior.
- Knowledge artifact route tests pass and cover selected-knowledge usage metadata (`hitCount`, `lastUsedAt`, ContextPack provenance).
- Eval harness prints `failed=0` and writes JSON/HTML reports under `.ainp/evals`.
- Full `bun test` passes with no failed tests.

## Eval Harness Check

Run:

```bash
bun run eval
```

Expected:

- Console includes `scenarios=3 variants=7 passed=7 failed=0`.
- A JSON report and HTML report are written under `.ainp/evals`.
- No `.ainp/evals` files appear in `git status` because `.ainp/` is ignored.

## Retro Report Check

The deterministic route test is:

```bash
bun test apps/api/test/report-sidecars.test.ts
```

Expected:

- The `retro route emits fact-first retro artifacts with knowledge/eval candidates` test passes.
- The `retro action route confirms findings into knowledge actions or eval drafts` test passes.
- The retro sidecar schema is `ainp.retro_report.v1`.
- Retro artifacts carry `metadata.reportKind=retro_report` and SHA-256 digests.
- Retro findings include gate, command, and knowledge-review evidence when the fixture records them.
- Retro confirmation creates either a `knowledge_suggestion_action` workflow action or an `ainp.eval.scenario_draft.v1` JSON artifact with SHA-256 digest metadata.

## Manual UI Smoke

Start the platform:

```bash
bun run dev:api
bun run dev:web
```

Open `http://127.0.0.1:5173/`.

1. Register or select `examples/java-maven-sample`.
2. Create a task and let the local Runner execute it. The Web UI can start the API-managed runner; fallback command is:

   ```bash
   bun run runner -- watch
   ```

3. Open the run detail page and expand `Evidence Drill-down`.
4. Expected evidence checks:
   - Command rows show a short `sha256` value instead of only stdout/stderr refs.
   - Opening command logs shows `stdout sha256 verified` and `stderr sha256 verified`.
   - File artifact rows show a short `sha256` value when the artifact was readable at ingest time.
   - Opening artifact content shows `sha256 verified`.
   - Completion is blocked if a passing gate has missing or unresolvable evidence.

## Manual Tamper Checks

Use a real completed or in-progress run that has command evidence.

1. Fetch run detail and identify a command run:

   ```bash
   curl -s http://127.0.0.1:8787/workflow-runs/<RUN_ID> | jq '.commands[] | {id, stdoutRef, stderrRef, stdoutSha256, stderrSha256}'
   ```

2. Confirm the log is initially verified:

   ```bash
   curl -s http://127.0.0.1:8787/command-runs/<COMMAND_RUN_ID>/logs | jq '.stdout.digest, .stderr.digest'
   ```

   Expected: `verified` is `true` for unchanged digest-backed logs.

3. Append text to the local `stdoutRef` file path, then fetch logs again:

   ```bash
   printf '\nTAMPERED\n' >> <STDOUT_FILE_PATH>
   curl -s http://127.0.0.1:8787/command-runs/<COMMAND_RUN_ID>/logs | jq '.stdout.digest'
   ```

   Expected: `verified` becomes `false` and `actual` differs from `expected`.

4. Repeat the same check for a file artifact:

   ```bash
   curl -s http://127.0.0.1:8787/workflow-runs/<RUN_ID> | jq '.artifacts[] | select(.sha256 != null) | {id, uri, sha256}'
   curl -s http://127.0.0.1:8787/artifacts/<ARTIFACT_ID>/content | jq '.digest'
   printf '\nTAMPERED\n' >> <ARTIFACT_FILE_PATH>
   curl -s http://127.0.0.1:8787/artifacts/<ARTIFACT_ID>/content | jq '.digest'
   ```

   Expected: the final artifact digest has `verified=false`.

## Completion Gate Check

The automated route test is the fastest deterministic check:

```bash
bun test apps/api/test/report-sidecars.test.ts
```

Expected: the test named `completion report route blocks when Evidence Gate fails` returns 409 before any completion report artifact is created.

## Verifier Evidence Check

The deterministic verifier checks are:

```bash
bun test apps/api/test/gate-engine.test.ts apps/api/test/verifier-evidence-route.test.ts
```

Expected:

- A UI-titled workflow run fails Evidence Gate when no `ainp.verifier_ac_matrix.v1` artifact exists.
- A verifier AC matrix with before and after screenshot artifacts passes the UI verifier Evidence Gate rules.
- Verifier matrix/media artifacts do not satisfy the generic acceptance `review_present` rule.
- Untagged image artifacts cited by a verifier matrix do not satisfy verifier media coverage.
- Verifier screenshot and matrix artifacts posted through `/runner/events/artifact` receive SHA-256 metadata.

Manual runner convention for UI tasks:

1. Before the review stage finishes, place verifier media under the run worktree at `.ainp-verifier/`.
2. Use filenames that identify role, for example:

   ```text
   .ainp-verifier/AC-001-before.png
   .ainp-verifier/AC-001-after.png
   ```

   A `.webm`, `.mp4`, or `.mov` file is treated as video evidence.

3. The runner verifier sub-stage copies recognized media into the run artifact directory, posts them through `/runner/events/artifact`, and writes `verifier-ac-matrix.json`.
4. Before waiting for human acceptance, the runner runs Evidence Gate. UI acceptance is blocked when the verifier matrix/media refs are missing, untagged, or missing SHA-256 metadata.
5. Evidence Gate requires each AC matrix row to cite either before+after screenshots or video evidence, and all verifier artifacts must carry SHA-256 metadata.

## Playwright Capture Follow-Up Boundary

No Playwright dependency is installed in this increment. Automatic capture remains the M3 follow-up. That self-test must add:

```bash
bunx playwright install --with-deps chromium
bun test <verifier tests>
```

Expected future checks:

- Playwright capture writes before/after screenshot or video files into `.ainp-verifier/`.
- Screenshot/video artifacts have digest metadata.
- AC-to-evidence matrix cites artifact ids and command/verifier run ids.
- Evidence Gate blocks UI acceptance when required verifier refs are missing.
