# Agent Runtime eval fixture requirements

## Source Docs

- `docs/2026-06-27-agent-runtime-development-tasks.md`
- `docs/2026-06-27-agent-runtime-red-green-test-plan.md`
- `docs/2026-06-27-agent-runtime-architecture-design.md`
- `docs/2026-06-27-agent-runtime-requirements.md`

## Current sequence

A1-A3, F2, and C1-C3 are already implemented in prior tasks. The next documented slice is F1/F3/F4:

- F1: `context_pack_fixture` with fixed project profile, knowledge, input artifacts, manifest/sourceRefs/degradation assertions.
- F3: `workflow_fixture` with replayed StepRun, GateRun, CommandRun, Artifact evidence and assertions for Evidence Gate, Completion Report, and Retro evidence.
- F4: report output must show scenario kind, variant, checks, evidence, and exit 1 on failure.

## Required red/green behavior

Context fixture:

- Green: accepted/current/confirmed memory matching the task enters the ContextManifest with sourceRefs/trust/freshness/score.
- Green: budget pressure causes deterministic degradation rather than unstable selection.
- Red: stale/conflict memory must not be injected as authoritative full context.
- Red: cross-project or sensitive context must not appear in selected authoritative context.

Workflow fixture:

- Green: complete workflow evidence includes digest-backed compile/test command evidence, artifacts, gates, and completion report references.
- Red: tampered or missing digest evidence fails checks.
- Red: report evidence that only cites agent summary without artifact/gate/command evidence is insufficient.
- Yellow/observable behavior can be represented as checks that expect warning-style outputs, but this task should prioritize green/red fixture coverage.

## Boundary rules

- Workflow Engine remains the only platform state writer.
- Gate Engine remains the pass/warn/fail authority.
- Eval fixtures must be deterministic and must not depend on real external agent CLIs.
- Do not implement Tool Registry persistence in this task; fixture-level evidence can model command/artifact evidence with existing types/helpers.
