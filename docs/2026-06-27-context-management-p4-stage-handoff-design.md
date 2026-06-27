# Context Management P4 Stage Handoff Design

> Date: 2026-06-27  
> Related PRD: `.trellis/tasks/06-27-context-management-p4-stage-handoff/prd.md`

## 1. Design Summary

P4 adds a deterministic stage semantic handoff layer between stage artifacts
and downstream prompt consumption. The MVP reuses existing runner/API handoff
infrastructure, adds a `stageHandoff` metadata payload, and wires the
`requirement -> design` path.

The design intentionally keeps handoff as evidence, not control flow. Gates,
workflow status, and approval decisions continue to be owned by existing gate
and workflow mechanisms.

## 2. Current Building Blocks

- `HandoffRecord` exists in `packages/shared/src/types/handoff.ts`.
- API already stores handoffs and exposes `/workflow-runs/:id/handoffs`.
- Runner already calls `deps.api.recordHandoff()` for reviewer/debugger
  bounded handoffs.
- P2 stage checkpoints record named input and output artifact maps.
- P3 renderer can inject summary/reference inputs and audit selected modes.
- Context governance already aggregates context packs and context requests.

## 3. Proposed Contract

Add a stage handoff payload:

```ts
interface StageProducedArtifactRef {
  key: string;
  artifactId: string;
  kind: string;
  injectionPreference: 'full' | 'summary' | 'reference';
}

interface StageHandoffMetadata {
  schemaVersion: 'ainp.stage_handoff.v1';
  workflowRunId: string;
  fromStage: WorkflowStage;
  toStage: WorkflowStage;
  summary: string;
  decisions: string[];
  risks: string[];
  openQuestions: string[];
  producedArtifacts: StageProducedArtifactRef[];
  createdAt: string;
}
```

Recommended placement:

- Shared type: `packages/shared/src/types/context.ts` or a new
  `types/stage-handoff.ts`.
- Runtime record: `HandoffRecord.metadata.stageHandoff`.
- Optional artifact: Markdown `other` artifact named
  `stage_handoff.requirement.design.md`.

## 4. Runner Flow

### 4.1 Requirement Stage Finish

Current flow:

```text
runStage(requirement)
  -> invokeSkill()
  -> post requirement.md artifact
  -> finish agent success
  -> checkpoint finish
  -> stepFinished
```

P4 flow:

```text
runStage(requirement)
  -> invokeSkill()
  -> post requirement.md artifact
  -> build StageHandoffMetadata(requirement -> design)
  -> record HandoffRecord with metadata.stageHandoff
  -> add handoff markdown to RunCtx.inputs
  -> optionally post handoff artifact
  -> finish agent success
  -> checkpoint finish includes produced artifacts
  -> stepFinished
```

The handoff creation should happen after output artifacts are persisted and
before downstream stages can read `RunCtx.inputs`.

### 4.2 Handoff Extraction

Use deterministic Markdown extraction:

- `summary`: first non-empty paragraph below the title, capped by a small
  character limit.
- `decisions`: bullets under headings matching `Decisions`, `Confirmed`,
  `Constraints`, `Acceptance`, or Chinese equivalents such as `已确认` /
  `约束`.
- `risks`: bullets under headings matching `Risks`, `风险`.
- `openQuestions`: bullets under headings matching `Open Questions`,
  `Questions`, `未决问题`.

Fallback rules:

- Missing summary -> first meaningful paragraph.
- Missing lists -> `[]`.
- Never invent a decision/risk/question that does not appear in the artifact.

### 4.3 Design Stage Consumption

Before `invokeSkill()` for `design`:

1. Find latest handoff where `fromStage='requirement'` and `toStage='design'`.
2. Render a compact Markdown input:

   ```markdown
   # Stage Handoff: requirement -> design

   ## Summary
   ...

   ## Decisions
   - ...

   ## Risks
   - ...

   ## Open Questions
   - ...

   ## Produced Artifacts
   - requirement.md: artifact://requirement.md/<artifactId> (summary)
   ```

3. Add it to `RunCtx.inputs['stage_handoff.requirement.design.md']`.
4. Add its artifact id to `RunCtx.inputArtifactIds` if a handoff artifact was
   persisted.
5. Configure design-stage input policy so this handoff is `full` or `summary`
   and `requirement.md` remains `summary/reference`.

## 5. API/Governance Flow

Extend `ContextGovernance`:

```ts
interface StageHandoffSummary {
  id: string;
  artifactId: string | null;
  fromStage: string;
  toStage: string;
  summary: string;
  decisions: string[];
  risks: string[];
  openQuestions: string[];
  producedArtifacts: StageProducedArtifactRef[];
  createdAt: string;
}
```

`GET /workflow-runs/:id/context` should derive these summaries from persisted
handoffs and/or artifacts. It should ignore malformed metadata rather than
inventing missing values.

## 6. Context Flow Panel Follow-up Design

After P4, the existing `context-flow-panel` task should use one backend read
model rather than reconstructing everything from raw DTOs:

- Context pack nodes: base/supplement artifacts.
- Checkpoint nodes: stage start/finish snapshots.
- Handoff edges: `fromStage -> toStage` with produced artifact refs.
- Injection decisions: prompt audit/input injection audit.
- Retry chain: base context pack -> context_request -> supplement pack ->
  retry session.

The UI should remain a visualization layer. It should not compute trust,
handoff extraction, or context selection itself.

## 7. Compatibility

- Existing role/session `HandoffRecord` remains valid.
- Stage handoff records are distinguished by
  `metadata.stageHandoff.schemaVersion`.
- Handoff does not replace `RunCtx.inputs`, `inputArtifactIds`, or artifacts.
- Existing workflows without stage handoff continue to work.

## 8. Tests

- Shared contract test for `StageHandoffMetadata`.
- Runner test: requirement stage creates a handoff after `requirement.md`.
- Runner test: design stage receives the handoff input before invocation.
- API route/governance test: context read model exposes stage handoffs.
- Regression: existing bounded reviewer/debugger handoff tests still pass.
