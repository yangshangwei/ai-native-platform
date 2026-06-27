# Context Management P4 Stage Handoff Requirements

> Date: 2026-06-27  
> Status: Planning  
> Scope: Backend MVP first; UI follows in `context-flow-panel`.

## 1. Background

P1-P3 made context usage durable and governable at the invocation and stage
levels:

- P1 persists base and supplement `ContextPack` artifacts for each agent
  invocation.
- P2 records stage start/finish context snapshots in `StepCheckpoint.metadata`.
- P3 lets skills choose input artifact injection modes and records input
  injection audit lines.

The remaining gap is semantic stage-to-stage handoff. Today, downstream stages
can receive artifact bodies and artifact ids, but the platform does not record
what the upstream stage believes is important for the next stage: confirmed
decisions, risks, open questions, and recommended injection preference.

## 2. Problem

The current implicit handoff creates these problems:

1. Downstream agents must infer stage priorities from raw artifact content.
2. Governance can show artifacts and context packs, but not the semantic reason
   a stage output should guide the next stage.
3. The planned Context Flow panel cannot explain why an artifact moved from one
   stage to another beyond "it was an input/output id".
4. Resume/replay can restore inputs, but cannot restore the stage-level intent
   behind those inputs.

## 3. Goals

1. Add a stage semantic handoff record for backend workflows.
2. Prove the first handoff path: `requirement -> design`.
3. Feed handoff content into the downstream stage before agent invocation.
4. Expose handoff evidence in the context governance read model.
5. Keep the implementation compatible with existing bounded multi-agent
   `HandoffRecord` behavior.

## 4. Non-goals

1. Do not build the Web Context Flow panel in P4.
2. Do not introduce a new database table unless existing artifact/action/handoff
   storage cannot carry the MVP.
3. Do not let handoff records own workflow status, gate status, or approval
   decisions.
4. Do not use an LLM to generate handoff summaries in the MVP.
5. Do not implement hybrid retrieval, embeddings, BM25, or MCP resources.

## 5. Functional Requirements

### FR1: Stage Handoff Contract

Define a stable contract for stage handoff data:

```ts
type StageHandoff = {
  schemaVersion: 'ainp.stage_handoff.v1'
  workflowRunId: string
  fromStage: WorkflowStage
  toStage: WorkflowStage
  summary: string
  decisions: string[]
  risks: string[]
  openQuestions: string[]
  producedArtifacts: Array<{
    key: string
    artifactId: string
    kind: string
    injectionPreference: 'full' | 'summary' | 'reference'
  }>
  createdAt: string
}
```

The contract may be represented as a shared type, as `HandoffRecord.metadata`,
or as artifact metadata. The final implementation must document the chosen
storage location in the shared context protocol.

### FR2: Requirement Stage Handoff Creation

When the `requirement` stage finishes:

- Detect the `requirement.md` output artifact.
- Create a stage handoff from `requirement` to `design`.
- Include `requirement.md` in `producedArtifacts`.
- Recommend `summary` or `reference` injection for the requirement artifact.
- Derive summary/decisions/risks/open questions deterministically from the
  requirement artifact body.

If the extractor cannot find a section, it must produce an empty array or
fallback summary rather than inventing facts.

### FR3: Design Stage Handoff Consumption

Before invoking the `design` skill:

- Load the latest applicable upstream stage handoff for `requirement -> design`.
- Add a handoff input such as `stage_handoff.requirement.design.md` or an
  equivalent context candidate.
- Preserve the original `requirement.md` artifact and artifact id.
- Make the design prompt prefer the handoff summary and artifact reference
  over blindly injecting the full requirement body.

### FR4: Governance Exposure

Extend `GET /workflow-runs/:id/context` so the read model includes stage
handoffs:

- handoff id or artifact id
- fromStage / toStage
- summary
- decisions
- risks
- openQuestions
- producedArtifacts
- createdAt

The governance read model must remain deterministic and assembled from
persisted artifacts/actions/records. It must not call an LLM.

### FR5: Context Flow Panel Readiness

P4 must leave enough persisted evidence for the later `context-flow-panel` task
to visualize:

- context pack lineage
- stage checkpoints
- input injection decisions
- stage handoffs
- context_request retry chain

No UI code is required in this task.

## 6. Acceptance Criteria

- A typed or documented `StageHandoff` contract exists.
- Requirement stage emits a `requirement -> design` handoff after
  `requirement.md` is persisted.
- Design stage receives handoff content before invoking the design agent.
- Handoff content includes summary, decisions, risks, openQuestions, and
  produced artifact references.
- Context governance exposes handoffs for a workflow run.
- Existing bounded multi-agent handoff tests still pass.
- Relevant runner/API tests cover creation, consumption, and governance.
- `bun run typecheck` passes.

## 7. Open Decisions

### D1: Storage Location

Recommended MVP: store stage handoff as a `HandoffRecord` with
`metadata.stageHandoff`, plus optional `other` artifact for human-readable
Markdown if needed.

Reason: the API already validates/stores/exposes handoffs, and the contract
already states handoff records do not own workflow status.

### D2: Extractor Strategy

Recommended MVP: deterministic Markdown section/heading extraction.

Reason: this avoids adding an LLM dependency and keeps governance evidence
reproducible.

### D3: Design-stage Consumption Surface

Recommended MVP: add a named `RunCtx.inputs` entry for the handoff markdown and
`RunCtx.inputArtifactIds` when a backing artifact exists.

Reason: this reuses P3 input policy and existing renderer mechanics.
