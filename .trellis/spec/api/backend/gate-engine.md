# Gate Engine - AC Status Determination

## Overview

Gate engine evaluates acceptance criteria status through a two-tier system:
1. **Document-level evidence**: requirements, design, diff, review gates
2. **Execution-level evidence**: compile gate, test gate, passing test execution

## AC Status Logic

### Status Hierarchy

```
pass > at_risk > warn > fail
```

### Determination Rules

**passed** - All evidence present:
- Document tier: requirement + design + diff + review gates all pass
- Execution tier: compile gate pass + test gate pass + ≥1 passing test execution

**at_risk** - Document tier complete but execution tier incomplete:
- Document tier: all 4 gates pass
- Execution tier: missing any of (compile gate | test gate | passing tests)
- Semantic: "implementation claimed done but execution proof insufficient"

**warn** - Partial document evidence, no explicit failure:
- Some document gates pass, others missing/pending
- No hard blockers (test failures, compilation errors)

**fail** - Explicit failure signal:
- Any gate returns `fail` status
- Test execution with failures/errors
- Compilation failures

### Implementation Location

`apps/api/src/gate-engine.ts`:
- `evaluateBusinessAcceptanceMatrix()` lines 1638-1687
- Execution evidence query at lines 698-701
- Coverage stats message at line 883

## Execution Evidence Query

```typescript
const buildRuns = store.buildRuns.byWorkflow(workflowRunId);
const allTestRuns = buildRuns.flatMap(build => store.testRuns.byBuild(build.id));
const hasPassingTests = allTestRuns.some(t => 
  t.total > 0 && t.failed === 0 && t.errors === 0
);
```

Requires:
- `BuildRun` records in store with `status: 'passed'`
- `TestRun` records linked via `buildRunId`
- Test framework attribution via required `framework` field

## Cross-Layer Contract

**Gate authority**: AC status determined solely by gate engine
**Web role**: Transparent pass-through, no status derivation
**Fallback**: When matrix unavailable, web shows loading state, not derived status

See: `.trellis/spec/shared/backend/evidence-verifier-protocol.md`

## Evolution

**Before**: Web projection derived execution evidence from store
**After**: Gate produces authoritative status with execution evidence baked in
**Constraint**: Legacy matrices may lack `businessStatus` field (graceful degradation)

## Test Coverage

`apps/api/test/gate-engine.test.ts`:
- Three-evidence requirement: lines 568-620
- at_risk scenario: lines 2126-2330
- Full matrix evaluation with execution context
