# Gate Engine Architecture

**Date**: 2026-08-09  
**Status**: Current Implementation  
**Audience**: Developers, QA Engineers, Architects

## Overview

The Gate Engine is a **declarative rule-based quality gate system** that validates workflow artifacts against explicit criteria. Agents provide artifacts; gates decide pass/warn/fail through deterministic rules.

**Core Principle**: Agents attach advisory notes but **never set gate status**. Only the Gate Engine decides pass/warn/fail by running rules over platform-trusted evidence.

**Location**: `apps/api/src/gate-engine.ts` (1758 lines)

---

## Architecture Principles

### 1. Evidence-First Validation

Gates operate on **platform-trusted artifacts** only:
- `CommandRun` records (exit codes, output digests)
- `BuildRun` / `TestRun` records (Surefire reports)
- `Artifact` records (requirement drafts, design docs, diffs)

**Never trust**: Agent self-reports, LLM claims of completion.

### 2. Declarative Rule Model

Each gate defines explicit rules with deterministic pass/warn/fail logic:

```typescript
interface RuleResult {
  ruleId: string;
  status: 'pass' | 'warn' | 'fail' | 'skipped';
  message: string;
  evidenceRefs: EvidenceRef[];  // Traceable proof
}

interface GateRun {
  gateId: string;
  status: 'pass' | 'warn' | 'fail';  // worst(ruleResults)
  ruleResults: RuleResult[];
  evidenceRefs: EvidenceRef[];
  agentNote: string | null;  // Advisory only, never overrides
}
```

**Status aggregation**: `worst(ruleResults)` — if any rule fails, gate fails.

### 3. Tamper Detection (08-09 P1-1)

Every artifact carries a SHA-256 digest. The Evidence Gate verifies:
- Digests match file contents on disk
- All passing gates have digest-verified evidence
- No ghost evidence (artifacts referenced but missing)

**Why**: Prevents agents from fabricating evidence or tampering with outputs.

---

## Gate Catalog

### Build & Test Gates

#### Compile Gate
**Trigger**: After `recordMavenBuild()` with `phase='compile'`

**Rules**:
- `compile-exit-code`: `exitCode === 0` → pass, else fail
- `compile-timeout`: `!timedOut` → pass, else fail

**Evidence**: `CommandRun` record with compile command.

#### Test Gate
**Trigger**: After `recordMavenBuild()` with `phase='test'`

**Rules**:
- `test-exit-code`: `exitCode === 0` → pass, else fail
- `test-timeout`: `!timedOut` → pass, else fail
- `test-failures`: Parse Surefire reports, `failures === 0` → pass, else fail
- `test-errors`: `errors === 0` → pass, else fail
- `test-skipped`: `skipped < threshold` → pass, else warn

**Evidence**: `BuildRun` + `TestRun[]` records with parsed Surefire XML.

**Location**: `apps/api/src/gate-engine.ts:150-280`

---

### Requirement Gate

**Trigger**: After requirement draft artifact created

**Rules**:
1. **REQ-ID-PRESENT** (`req-id-present`)  
   - Artifact contains `REQ-###` identifier  
   - fail if missing

2. **ACCEPTANCE-CRITERIA** (`req-ac-present`)  
   - Artifact contains `AC-###` identifiers (at least 1)  
   - fail if missing

3. **SCOPE-DEFINED** (`req-scope-defined`)  
   - Has "Scope" or "边界" section  
   - warn if missing

4. **CONTEXT-EVIDENCE** (`req-context-evidence`)  
   - References project context (files, modules, domain entities)  
   - warn if missing

5. **CS-REQ-STRUCTURE** (`req-cs-structure`)  
   - Contains required sections:  
     - 用户故事 / User Story  
     - 为什么需要 / Why  
     - 怎么解决 / How  
     - 边界 / Boundary  
   - warn if missing (not fail, to allow flexibility)

**Evidence**: `Artifact` with `kind='requirement_draft'`, `sha256` digest.

**Location**: `apps/api/src/gate-engine.ts:350-520`

---

### Design Gate

**Trigger**: After design doc artifact created

**Rules**:
1. **DSN-ID-PRESENT** (`dsn-id-present`)  
   - Artifact contains `DSN-###` identifier  
   - fail if missing

2. **REQUIREMENT-COVERAGE** (`dsn-req-coverage`)  
   - Design references the requirement's `REQ-###` ID  
   - Coverage matrix: each REQ AC → design section  
   - fail if requirement not referenced

3. **TEST-STRATEGY** (`dsn-test-strategy`)  
   - Has "Test Strategy" or "测试策略" section  
   - Explains how to verify the design  
   - fail if missing

4. **BUSINESS-VERIFICATION** (`dsn-business-verification`)  
   - Design includes business acceptance steps (not just command-only checks)  
   - warn if only technical verification present

5. **STRUCTURE-SECTIONS** (`dsn-structure`)  
   - Contains required sections:  
     - 现状 / Current State  
     - 变化 / Changes  
     - 挂载点 / Integration Points  
     - 推进策略 / Rollout Strategy  
   - warn if missing

**Evidence**: `Artifact` with `kind='design_doc'`, `sha256` digest, linked `derivedFromArtifactId` (requirement).

**Location**: `apps/api/src/gate-engine.ts:520-750`

---

### Diff Scope Gate

**Trigger**: After implementation stage generates diff

**Rules**:
1. **ALLOWED-PREFIXES** (`diff-scope-allowed`)  
   - Changed files match `project.config.allowedDiffPrefixes`  
   - fail if files outside scope

2. **NO-UNEXPECTED-DELETES** (`diff-scope-no-deletes`)  
   - Deleted files within allowed scope  
   - warn if critical files deleted (e.g., core domain models)

**Evidence**: `Artifact` with `kind='implementation_diff'`, file list parsed from diff.

**Location**: `apps/api/src/gate-engine.ts:780-890`

---

### Sensitive Change Gate

**Trigger**: After implementation diff created

**Rules**:
1. **POM-CHANGES** (`sensitive-pom`)  
   - Warns if `pom.xml` modified  
   - Reason: Dependency changes need review

2. **GITIGNORE-CHANGES** (`sensitive-gitignore`)  
   - Warns if `.gitignore` modified  
   - Reason: Could expose secrets

3. **SECURITY-PATHS** (`sensitive-security`)  
   - Warns if paths matching security patterns changed:  
     - `**/auth/**`, `**/security/**`, `**/AuthFilter.java`  
   - Reason: Security-critical code needs scrutiny

**Evidence**: `Artifact` with `kind='implementation_diff'`.

**All rules**: Status = `warn` (not fail), triggers human review.

**Location**: `apps/api/src/gate-engine.ts:890-980`

---

### Test Integrity Gate

**Trigger**: After implementation diff + test reports

**Rules**:
1. **NO-TEST-DELETION** (`test-integrity-no-deletion`)  
   - No test files deleted  
   - fail if test files removed (unless explicitly approved)

2. **NO-TEST-WEAKENING** (`test-integrity-no-weakening`)  
   - `@Test` annotations not removed  
   - Assertion count not decreased  
   - No `@Ignore` or `@Disabled` added without reason  
   - fail if tests weakened

3. **TEST-COVERAGE-STABLE** (`test-integrity-coverage`)  
   - Test count ≥ baseline  
   - warn if coverage dropped

**Evidence**: Diff + pre/post test run counts.

**Why**: Prevents agents from "passing tests" by deleting them.

**Location**: `apps/api/src/gate-engine.ts:980-1150`

---

### Acceptance Traceability Gate

**Trigger**: After review stage completes

**Rules**:
1. **REQ-TO-DESIGN** (`trace-req-design`)  
   - Every REQ AC has corresponding design section  
   - fail if missing

2. **DESIGN-TO-DIFF** (`trace-design-diff`)  
   - Changed files align with design's "挂载点"  
   - warn if unexpected files changed

3. **DIFF-TO-TESTS** (`trace-diff-tests`)  
   - Changed code has test coverage  
   - fail if new code untested

4. **TESTS-TO-AC** (`trace-tests-ac`)  
   - Each AC has at least one test that verifies it  
   - fail if AC untested

5. **REVIEW-VERDICT** (`trace-review`)  
   - Reviewer verified acceptance matrix  
   - fail if reviewer marked "incomplete"

6. **BUSINESS-ACCEPTANCE** (`trace-business`)  
   - Manual human approval recorded (for business-facing changes)  
   - fail if missing approval

**Evidence**: Cross-artifact validation across requirement, design, diff, test reports, review verdict, approval record.

**Location**: `apps/api/src/gate-engine.ts:1150-1450`

---

### Evidence Gate (Meta-Gate)

**Trigger**: Before completion or acceptance stage

**Rules**:
1. **ALL-GATES-HAVE-EVIDENCE** (`evidence-all-gates`)  
   - Every passing gate has `evidenceRefs`  
   - fail if any gate passed without evidence

2. **DIGESTS-PRESENT** (`evidence-digests-present`)  
   - CommandRuns have stdout/stderr/combined SHA-256  
   - Artifacts have content SHA-256  
   - warn if missing (coverage gap)

3. **DIGESTS-MATCH** (`evidence-digests-match`)  
   - Recompute SHA-256 from disk files  
   - Compare with stored digests  
   - fail if mismatch (tamper detected)

4. **NO-GHOST-EVIDENCE** (`evidence-no-ghost`)  
   - All referenced artifacts exist on disk  
   - fail if referenced but missing

**Why**: Ensures the entire evidence chain is tamper-proof and complete.

**Location**: `apps/api/src/gate-engine.ts:1450-1600`

---

### Manual Gate

**Trigger**: Explicit human approval points

**Rules**:
1. **APPROVAL-RECORDED** (`manual-approval`)  
   - `ApprovalRecord` exists with `status='approved'`  
   - fail if rejected or pending

2. **APPROVER-AUTHORIZED** (`manual-approver`)  
   - Approver is in authorized user list (future: RBAC)  
   - warn if approver not in list

**Evidence**: `ApprovalRecord` with timestamp, approver ID, comment.

**Location**: `apps/api/src/gate-engine.ts:1600-1700`

---

## Gate Execution Flow

```
Workflow Engine triggers gate:
  ↓
runGate(gateId, context)
  ├─ Load evidence (artifacts, command runs, test runs)
  ├─ Run rules sequentially
  │   ├─ Rule 1: pass/warn/fail
  │   ├─ Rule 2: pass/warn/fail
  │   └─ Rule N: pass/warn/fail
  ├─ Aggregate: worst(ruleResults)
  ├─ Attach evidenceRefs (traceable proof)
  └─ Persist GateRun record
  ↓
GateRun.status determines workflow continuation:
  - pass → continue
  - warn → continue with warning logged
  - fail → block stage, require human review or rework
```

---

## Agent Note vs. Gate Status

**Agent Note**: Advisory text from agent explaining what it checked.

**Gate Status**: Deterministic outcome from rule evaluation.

**Invariant**: `agentNote` NEVER overrides `status`. Even if agent says "all tests passed", gate runs rules to verify.

**Why**: LLMs hallucinate. Only platform-verified evidence is trusted.

---

## Evidence Chain Design

### Artifact SHA-256 Digests

Every artifact stored with:
```typescript
interface Artifact {
  id: ArtifactId;
  uri: string;
  sha256: string;  // Computed on upload
  // ...
}
```

**Evidence Gate** recomputes `sha256` from disk and compares with stored value.

**If mismatch**: Gate fails with `evidence-digests-match` rule violation.

### CommandRun Output Digests

```typescript
interface CommandRun {
  id: CommandRunId;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  combined: string;
  stdoutSha256: string;
  stderrSha256: string;
  combinedSha256: string;
  // ...
}
```

**Why three digests**: Enables partial validation (e.g., only verify stdout for parse checks).

### Cross-Artifact References

```typescript
interface EvidenceRef {
  type: 'artifact' | 'command_run' | 'test_run' | 'approval';
  id: string;
  digest?: string;
  description: string;
}
```

**Traceability**: Every `RuleResult` includes `evidenceRefs[]` pointing to exact proof.

---

## Integration Points

### Workflow Engine → Gate Engine

Gates are triggered automatically after specific workflow events:

| Event | Gate Triggered | Auto-trigger |
|-------|----------------|--------------|
| `recordMavenBuild(phase='compile')` | Compile Gate | Yes |
| `recordMavenBuild(phase='test')` | Test Gate | Yes |
| Requirement artifact created | Requirement Gate | Manual (runner calls) |
| Design artifact created | Design Gate | Manual |
| Implementation diff created | Diff Scope + Sensitive Change | Manual |
| Review stage finishes | Acceptance Traceability | Manual |
| Before completion | Evidence Gate | Manual |

**Location**: `apps/api/src/workflow-engine.ts:780-850` (auto-trigger logic)

### Runner → Gate API

Runner orchestrator calls gates via REST:

```typescript
// Example: Run requirement gate
const gateRun = await api.runGate({
  workflowRunId: run.id,
  stepRunId: stepRun.id,
  gateId: 'requirement',
  context: { artifactId: requirementArtifact.id },
});

if (gateRun.status === 'fail') {
  // Block stage, log failure
}
```

**Endpoint**: `POST /gate-runs`

**Location**: `apps/api/src/routes/gate-runs.ts`

---

## Design Decisions

### Why Declarative Rules?

**Problem**: Agents could claim "I checked X" without proof.

**Solution**: Explicit rules that gate engine runs over trusted artifacts.

**Trade-off**: Adding new validation requires code changes (not runtime-configurable).

### Why SHA-256 Digests?

**Problem**: Agents could modify artifacts after gates pass.

**Solution**: Store digest on artifact creation, verify on evidence gate.

**Trade-off**: Extra storage (64 chars per artifact), but negligible compared to content size.

### Why Warn vs. Fail?

**Fail**: Blocks workflow, requires human intervention or agent rework.

**Warn**: Logs issue, allows continuation with noted risk.

**Use warn when**:
- Issue is non-critical (style, missing optional section)
- Human judgment needed (e.g., sensitive file changed legitimately)

**Use fail when**:
- Correctness broken (tests fail, compile error)
- Required artifact missing (REQ-ID, AC-ID)
- Evidence tampering detected

---

## Current Limitations

1. **No gate chaining**: Gates are independent. Cannot express "Gate B requires Gate A to pass first".

2. **No conditional rules**: Rules always run. Cannot express "Rule X only if Y condition".

3. **No runtime rule configuration**: All rules hardcoded. Cannot toggle rules per project without code change.

4. **No gate versioning**: Gate logic changes affect all runs. No A/B testing of gate variants.

5. **No evidence replay**: Cannot re-run gates on historical runs after rule changes.

---

## Future Enhancements

### Planned

1. **Rule DSL**: Express rules as JSON/YAML for runtime configuration
2. **Gate DAG**: Express dependencies between gates (Gate B depends on Gate A)
3. **Evidence replay**: Re-run gates on historical runs with new rules
4. **Per-project gate config**: Toggle gates or rules per project

### Considered but Deferred

1. **LLM-based gates**: Use LLM to judge subjective criteria (e.g., "Is design clear?")  
   **Risk**: Non-deterministic, hard to debug
   
2. **Auto-remediation**: Agent auto-fixes gate failures  
   **Risk**: Could paper over real issues

---

## Related Documentation

- `apps/api/src/workflow-engine.ts` — Triggers gates after workflow events
- `2026-08-09-workflow-engine-architecture.md` — Workflow lifecycle and state management
- `.trellis/spec/api/backend/gate-engine.md` — Gate rule specification format (if exists)

---

## Code References

- `apps/api/src/gate-engine.ts` — Main implementation (1758 lines)
- `apps/api/src/routes/gate-runs.ts` — REST endpoints (lines 1-180)
- `packages/shared/src/types/gate.ts` — Type definitions (lines 1-150)
- `apps/runner/src/orchestrator/gates.ts` — Runner-side gate invocation (lines 1-120)
