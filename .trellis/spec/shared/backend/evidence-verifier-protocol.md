# Evidence and Verifier Protocol

## Scenario: digest-backed evidence gates and UI verifier artifacts

### 1. Scope / Trigger

- Trigger: any change that records command evidence, records file artifacts, reads evidence content, evaluates `evidence_gate`, generates completion reports, or changes UI verifier media/matrix behavior.
- This is a cross-layer contract: shared types define digest and verifier metadata, the runner posts command/artifact evidence, the API stores and validates evidence, and the web UI displays digest state.
- The gate engine, not the agent, decides pass/warn/fail. Agents may produce files and notes, but success claims must resolve to persisted evidence records.

### 2. Signatures

- Shared gate id: `GateId` includes `evidence_gate`.
- Command evidence fields on `CommandRun`:
  - `stdoutSha256?: string | null`
  - `stderrSha256?: string | null`
  - `combinedSha256?: string | null`
- File artifact evidence field on `Artifact`:
  - `sha256?: string | null`
- Tool invocation audit type: `ToolInvocation`
  - Runner-owned MVP tool ids: `runner.command`, `runner.git_diff_capture`,
    `runner.artifact_read`, `runner.context_supplement`
  - Result refs may point at digest-backed `CommandRun` / `Artifact` evidence,
  but the invocation row itself is only an audit index.
- Handoff audit type: `HandoffRecord`
  - Records bounded parent/child agent collaboration with `fromRole`,
    `toRole`, `reason`, input artifact refs, expected output schema, stop
    condition, lifecycle status, adoption decision, and parent/child
    AgentSession ids.
  - Handoff output is report/gate evidence only. It must never directly set
    WorkflowRun or GateRun status.
- Verifier metadata constants:
  - `VERIFIER_AC_MATRIX_SCHEMA_VERSION = 'ainp.verifier_ac_matrix.v1'`
  - `VERIFIER_MEDIA_SCHEMA_VERSION = 'ainp.verifier_media.v1'`
- Business acceptance matrix rows extend the verifier AC matrix contract. Each
  row may carry `scenarioType` (`core | boundary | exception | regression`),
  `verificationMethod`, `businessStatus` (`passed | missing | at_risk |
  failed`), `risk` / `riskAccepted`, and evidence refs. `status` remains the
  verifier execution status (`pass | fail | blocked`) for compatibility.
- Verifier media roles:
  - `screenshot_before`
  - `screenshot_after`
  - `video`
- Runner verifier convention:
  - Input directory: `<worktree>/.ainp-verifier/`
  - Output artifact directory: `<runArtifactsDir>/verifier/`
  - Matrix output: `verifier-ac-matrix.json`
- Completion report sidecar schema:
  - Markdown artifact: `kind='completion_report'`, `contentType='text/markdown'`
  - JSON artifact: `kind='completion_report'`, `contentType='application/json'`, `metadata.structured=true`, `metadata.schemaVersion='ainp.completion_report.v1'`
  - JSON payload: `{ schemaVersion, title, workflowRunId, run, summary, sections, handoffs, contextRequests, knowledgeReviewSignals, contextGovernanceMetrics, generatedAt }`
- API routes:
  - `POST /runner/events/artifact`
  - `POST /runner/events/run-gate` with `gateId: 'evidence_gate'`
  - `GET /command-runs/:id/logs`
  - `GET /artifacts/:id/content`
  - `POST /workflow-runs/:id/completion-report`

### 3. Contracts

- `runWhitelistedCommand()` must compute SHA-256 digests for stdout, stderr, and combined command output before posting `CommandRun`.
- `createArtifact()` must compute `sha256` for readable `file://` artifacts at ingest time. Existing rows may have null digest fields for backward compatibility.
- Command log and artifact-content routes must return explicit digest status. Missing expected digests are not silently treated as verified.
- `acceptance_gate` must fail for AC-bearing feature flows when no
  `ainp.verifier_ac_matrix.v1` matrix exists before acceptance, the matrix has
  no AC rows, any required AC row is missing/failed/blocked, an AC row has no
  evidence refs, the matrix does not cover `core`, `boundary`, and
  `exception` scenarios, or a row only cites a generic build/test command
  without stating the business behavior being verified. `test_gate=pass`
  remains necessary command evidence for code changes, but it is not
  sufficient for business acceptance.
- `evidence_gate` must fail when:
  - a passing rule has no evidence refs unless it is explicitly non-evidentiary, such as a manual decision or a not-applicable rule;
  - a passing rule cites refs that do not resolve to an `Artifact` or `CommandRun`;
  - passing compile/test gate evidence does not resolve to at least one `CommandRun`;
  - passing compile/test command evidence lacks SHA-256 digests;
  - acceptance has no persisted implementation/review/test evidence;
  - a UI run requires verifier evidence but lacks a verifier AC matrix, tagged media refs, or verifier artifact digests.
- `POST /workflow-runs/:id/completion-report` must run `evidence_gate` before report generation and return HTTP 409 if it fails.
- Completion report generation must create both the markdown report and the structured JSON sidecar from the same stored run/evidence snapshot. UI code should prefer the JSON sidecar when available and use markdown parsing only as a fallback.
- Completion report summaries must label run state as `Status at report generation` in markdown and JSON summary entries. Do not use a bare `Status` label because the artifact is a point-in-time snapshot, not a live workflow state contract.
- Completion report generation must include persisted Handoff records and their
  adoption decisions. Handoff evidence can explain review/debug findings, but
  gate status still comes only from Gate Engine evaluation.
- Runner review flow must run the verifier sub-stage before human acceptance
  when the run has AC-bearing requirement/design inputs or when a UI-titled
  task requires media verification. It then runs `acceptance_gate` and
  `evidence_gate` before waiting for acceptance.
- Verifier media artifacts must be explicitly tagged with verifier metadata. Plain `image/*` or `video/*` artifacts must not satisfy verifier evidence by content type alone.
- Verifier artifacts currently use `kind='other'`, but they must not count as the generic acceptance review artifact.
- Runner-owned tool executions must record `ToolInvocation` rows through API
  runner-event ingress. `runner.command` invocations must keep
  `runWhitelistedCommand()` as the hard command gate and link successful or
  failed executions to the resulting `CommandRun` id plus command digest when
  available. Denied whitelist attempts may record `status='denied'` with no
  `CommandRun` result ref because no subprocess was spawned.
- `runner.git_diff_capture` invocations must link to the diff `Artifact` and
  include changed-file path/count metadata. This makes diff capture auditable
  without making ToolInvocation the evidence artifact itself.
- Gate Engine remains the only pass/warn/fail authority. Do not derive gate
  status from `ToolInvocation.status`; gates must continue resolving primary
  `CommandRun` / `Artifact` evidence.

### 4. Validation & Error Matrix

- Passing rule has empty evidence refs and is not optional -> `evidence.pass_rules_have_refs` fail.
- Evidence ref points at no artifact or command run -> `evidence.refs_resolve` fail.
- Passing compile/test gate has only artifact evidence and no resolvable `CommandRun` -> `evidence.command_digests_present` fail.
- Compile/test command evidence lacks any command digest -> `evidence.command_digests_present` fail.
- File artifact evidence lacks `sha256` -> `evidence.artifact_digests_present` warn.
- ToolInvocation claims `runner.command` success but does not reference
  digest-bearing `CommandRun` evidence -> audit/read-model defect; fix the
  runner recording path and keep Evidence Gate rules anchored to the
  `CommandRun` / `Artifact` evidence graph.
- Handoff creation without at least one input artifact id or without an
  expected output schema -> HTTP 400 at runner ingress.
- Child reviewer/debugger output attempts to directly set WorkflowRun/GateRun
  status -> contract violation; record the output as handoff/report evidence
  and let Gate Engine or human adoption decide.
- Acceptance gate has only human/manual evidence -> `evidence.acceptance_has_execution_evidence` fail.
- Feature run with requirement/design ACs but no business acceptance matrix -> `acceptance.business_matrix_present` fail.
- Feature run with only `test_gate=pass` and no AC matrix evidence -> `acceptance.business_matrix_present` fail.
- Matrix row with `businessStatus=missing` / `failed` or `status=blocked` -> `acceptance.business_matrix_criteria_proven` fail.
- Matrix missing any of `core`, `boundary`, or `exception` rows -> `acceptance.business_matrix_scenarios_present` fail.
- UI-titled run has no verifier matrix -> `evidence.ui_verifier_matrix_present` fail.
- Verifier matrix row lacks video or before+after screenshots -> `evidence.ui_verifier_media_refs_present` fail.
- Verifier matrix cites untagged images or videos -> `evidence.ui_verifier_media_refs_present` fail.
- Verifier artifact lacks `sha256` -> `evidence.ui_verifier_artifact_digests_present` fail.
- Completion report requested while Evidence Gate fails -> HTTP 409 and no completion report artifact.
- Completion report generated without a structured JSON sidecar -> contract violation; fix report generation rather than making the UI parse markdown as the primary path.
- Completion report summary uses `Status: <run.status>` -> contract violation; replace with `Status at report generation: <run.status>`.

### 5. Good/Base/Bad Cases

- Good: a feature run has requirement/design ACs, a verifier matrix with
  business scenario rows, evidence refs, and `businessStatus=passed` for each
  required AC; `acceptance_gate` can pass when the other traceability/test
  rules also pass.
- Good: a UI run has a review artifact, a verifier matrix, tagged `screenshot_before` and `screenshot_after` artifacts, and all three artifacts carry `sha256`; `evidence_gate` passes.
- Good: a UI run has one tagged `video` verifier artifact and a matrix row citing it; media coverage passes.
- Base: a non-UI run has no verifier artifacts; verifier rules pass as not applicable.
- Base: legacy artifacts without digests still load; digest-sensitive gate rules warn or fail only where required.
- Base: a completed run with `run.status='passed'` generates a markdown report plus JSON sidecar; both summaries include `Status at report generation: passed`.
- Bad: `mvn test` / `bun test` is the only acceptance statement and no matrix
  row explains which business behavior the command proves.
- Bad: a generated verifier matrix is the newest `kind='other'` artifact and is treated as the review artifact.
- Bad: a matrix cites two plain `image/png` artifacts with before/after roles but no verifier metadata; the UI verifier rule must fail.
- Bad: completion report generation skips Evidence Gate because the runner already ran it earlier.
- Bad: report markdown or JSON summary says `Status: passed`, implying the artifact is a live status field instead of a generation-time snapshot.
- Bad: a child handoff result marks a run passed/failed without a GateRun or
  human adoption path.

### 6. Tests Required

- Gate engine tests:
  - passing rule with missing/unresolvable refs fails Evidence Gate;
  - passing compile/test gate with artifact-only evidence fails Evidence Gate;
  - digest-backed compile/test/acceptance chain passes;
  - feature run with passing `test_gate` but missing business acceptance
    matrix fails `acceptance_gate`;
  - feature run with complete matrix rows passes the matrix-specific
    acceptance rules;
  - matrix missing core/boundary/exception coverage fails the scenario rule;
  - UI run without verifier matrix/media fails;
  - tagged before+after screenshot matrix passes;
  - untagged image refs fail;
  - verifier artifacts do not satisfy acceptance `review_present`.
- Route tests:
  - `/runner/events/artifact` persists verifier screenshots and matrix with SHA-256 metadata;
  - `/runner/events/run-gate` can run `evidence_gate`;
  - completion report route returns 409 before artifact creation when Evidence Gate fails.
  - completion report route emits both markdown and JSON artifacts, with JSON `metadata.structured=true`, `schemaVersion='ainp.completion_report.v1'`, and no bare `Status:` summary line.
  - runner handoff ingress rejects missing input artifact refs or expected
    output schema.
  - workflow run handoff read model returns persisted handoffs.
  - completion report sidecar includes handoff evidence and adoption decisions.
  - completion report includes the business acceptance matrix when a verifier
    AC matrix artifact exists.
- Content route tests:
  - command log tampering flips digest verification to false;
  - artifact file tampering flips digest verification to false.
- Runner verification:
  - AC-bearing feature tasks insert the verifier sub-stage before acceptance
    and run Acceptance/Evidence Gates before `awaitHuman(review)`.
  - UI tasks still require media rows when the UI verifier rule applies.

### 7. Wrong vs Correct

#### Wrong

```ts
const review = store.artifacts.byKind(runId, 'other').at(-1);
```

This can treat generated verifier artifacts as human/agent review evidence.

#### Correct

```ts
const review = store.artifacts
  .byKind(runId, 'other')
  .filter(isAcceptanceReviewArtifact)
  .at(-1) ?? null;
```

#### Wrong

```ts
if (artifact.contentType.startsWith('image/')) roles.add(ref.role);
```

Plain screenshots are not enough; the artifact must be tagged as verifier evidence.

#### Correct

```ts
const isVerifierMedia =
  artifact.metadata.schemaVersion === VERIFIER_MEDIA_SCHEMA_VERSION
  || artifact.metadata.reportKind === 'verifier_media';
```

#### Wrong

```md
- **Status:** passed
```

The report artifact is a historical handoff. A bare status label reads like a
live workflow field and becomes ambiguous after the run continues or is retried.

#### Correct

```md
- **Status at report generation:** passed
```
