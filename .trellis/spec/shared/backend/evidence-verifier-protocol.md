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
- Verifier metadata constants:
  - `VERIFIER_AC_MATRIX_SCHEMA_VERSION = 'ainp.verifier_ac_matrix.v1'`
  - `VERIFIER_MEDIA_SCHEMA_VERSION = 'ainp.verifier_media.v1'`
- Verifier media roles:
  - `screenshot_before`
  - `screenshot_after`
  - `video`
- Runner verifier convention:
  - Input directory: `<worktree>/.ainp-verifier/`
  - Output artifact directory: `<runArtifactsDir>/verifier/`
  - Matrix output: `verifier-ac-matrix.json`
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
- `evidence_gate` must fail when:
  - a passing rule has no evidence refs unless it is explicitly non-evidentiary, such as a manual decision or a not-applicable rule;
  - a passing rule cites refs that do not resolve to an `Artifact` or `CommandRun`;
  - passing compile/test gate evidence does not resolve to at least one `CommandRun`;
  - passing compile/test command evidence lacks SHA-256 digests;
  - acceptance has no persisted implementation/review/test evidence;
  - a UI run requires verifier evidence but lacks a verifier AC matrix, tagged media refs, or verifier artifact digests.
- `POST /workflow-runs/:id/completion-report` must run `evidence_gate` before report generation and return HTTP 409 if it fails.
- Runner review flow must run the verifier sub-stage for UI-titled tasks before human acceptance, then run `evidence_gate` before waiting for acceptance.
- Verifier media artifacts must be explicitly tagged with verifier metadata. Plain `image/*` or `video/*` artifacts must not satisfy verifier evidence by content type alone.
- Verifier artifacts currently use `kind='other'`, but they must not count as the generic acceptance review artifact.

### 4. Validation & Error Matrix

- Passing rule has empty evidence refs and is not optional -> `evidence.pass_rules_have_refs` fail.
- Evidence ref points at no artifact or command run -> `evidence.refs_resolve` fail.
- Passing compile/test gate has only artifact evidence and no resolvable `CommandRun` -> `evidence.command_digests_present` fail.
- Compile/test command evidence lacks any command digest -> `evidence.command_digests_present` fail.
- File artifact evidence lacks `sha256` -> `evidence.artifact_digests_present` warn.
- Acceptance gate has only human/manual evidence -> `evidence.acceptance_has_execution_evidence` fail.
- UI-titled run has no verifier matrix -> `evidence.ui_verifier_matrix_present` fail.
- Verifier matrix row lacks video or before+after screenshots -> `evidence.ui_verifier_media_refs_present` fail.
- Verifier matrix cites untagged images or videos -> `evidence.ui_verifier_media_refs_present` fail.
- Verifier artifact lacks `sha256` -> `evidence.ui_verifier_artifact_digests_present` fail.
- Completion report requested while Evidence Gate fails -> HTTP 409 and no completion report artifact.

### 5. Good/Base/Bad Cases

- Good: a UI run has a review artifact, a verifier matrix, tagged `screenshot_before` and `screenshot_after` artifacts, and all three artifacts carry `sha256`; `evidence_gate` passes.
- Good: a UI run has one tagged `video` verifier artifact and a matrix row citing it; media coverage passes.
- Base: a non-UI run has no verifier artifacts; verifier rules pass as not applicable.
- Base: legacy artifacts without digests still load; digest-sensitive gate rules warn or fail only where required.
- Bad: a generated verifier matrix is the newest `kind='other'` artifact and is treated as the review artifact.
- Bad: a matrix cites two plain `image/png` artifacts with before/after roles but no verifier metadata; the UI verifier rule must fail.
- Bad: completion report generation skips Evidence Gate because the runner already ran it earlier.

### 6. Tests Required

- Gate engine tests:
  - passing rule with missing/unresolvable refs fails Evidence Gate;
  - passing compile/test gate with artifact-only evidence fails Evidence Gate;
  - digest-backed compile/test/acceptance chain passes;
  - UI run without verifier matrix/media fails;
  - tagged before+after screenshot matrix passes;
  - untagged image refs fail;
  - verifier artifacts do not satisfy acceptance `review_present`.
- Route tests:
  - `/runner/events/artifact` persists verifier screenshots and matrix with SHA-256 metadata;
  - `/runner/events/run-gate` can run `evidence_gate`;
  - completion report route returns 409 before artifact creation when Evidence Gate fails.
- Content route tests:
  - command log tampering flips digest verification to false;
  - artifact file tampering flips digest verification to false.
- Runner verification:
  - UI tasks insert the verifier sub-stage before acceptance and run Evidence Gate before `awaitHuman(review)`.

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
