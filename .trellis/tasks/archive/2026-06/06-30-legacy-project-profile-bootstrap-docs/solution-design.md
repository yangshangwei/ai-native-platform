# Legacy Project Profile Bootstrap - Solution Design

## Design Summary

Add a read-only workflow that converts scattered legacy repository evidence into
a governed project profile:

```text
Web project action
  -> WorkflowRequest(flowId='profile.bootstrap', type='profile')
  -> Runner watch
  -> inventory stage
  -> profile synthesis stage
  -> completion report
  -> knowledge candidate
  -> human Knowledge Gate
  -> accepted knowledge available to ContextPack
```

The system reuses existing platform primitives:

- `FLOW_REGISTRY` remains the flow source of truth.
- API `Workflow Engine` remains the only state writer.
- Runner remains responsible for local filesystem/git inspection and agent calls.
- Artifacts remain the evidence and report carrier.
- Knowledge Candidate and Knowledge Gate remain the long-term memory governance path.
- `ContextPack` remains the injection mechanism for future agent runs.

## Architecture

```text
Browser / apps/web
  Project page / settings
  - "Generate legacy profile"
  - run status
  - profile artifact links
  - knowledge candidate review entry
          |
          v
apps/api
  POST /workflow-requests
  GET run detail / artifacts / knowledge actions
  Workflow Engine writes run/step/artifact/gate/action/audit state
          |
          v
apps/runner
  watch claims request
  inventory stage reads repo + git safely
  profile stage calls AgentBackend with inventory context
  engine stages generate completion + knowledge candidate
          |
          v
Project filesystem
  read-only file/config/git scan
```

## Flow Definition

Add a new flow:

```typescript
const PROFILE_BOOTSTRAP: FlowDef = {
  id: 'profile.bootstrap',
  kind: 'profile',
  description:
    'Read-only legacy project bootstrap. Runs inventory -> profile -> completion -> knowledge.',
  stages: [
    { stage: 'inventory', kind: 'engine' },
    { stage: 'profile', kind: 'agent', skillId: 'project-profile-bootstrap' },
    { stage: 'completion', kind: 'engine' },
    { stage: 'knowledge', kind: 'engine' },
  ],
};
```

Required shared contract changes:

- Add `WorkflowRunType='profile'`.
- Add `FlowId='profile.bootstrap'`.
- Add `WorkflowStage='inventory' | 'profile'`.
- Add both stages to `WORKFLOW_STAGES`.
- Add `PROFILE_BOOTSTRAP` to `FLOW_REGISTRY`.
- Pin stage order in flow registry tests.

## Stage Responsibilities

| Stage | Kind | Responsibility | Artifacts |
| --- | --- | --- | --- |
| `inventory` | engine | Read-only repository inventory and evidence capture. | `project_inventory.json`, optional markdown summary as `other` |
| `profile` | agent | Synthesize human and machine profile from inventory. | `project_profile` markdown and JSON sidecar |
| `completion` | engine | Produce run completion report citing artifacts. | `completion_report` |
| `knowledge` | engine | Generate reviewable knowledge candidates. | `knowledge_candidate` |

Artifact metadata contract for MVP:

- Inventory JSON uses `kind='other'`, `contentType='application/json'`,
  `metadata.role='project_inventory'`,
  `metadata.schemaVersion='ainp.project_inventory.v1'`, and a stable
  filename `project-inventory.json`.
- Profile markdown uses `kind='project_profile'`,
  `contentType='text/markdown'`, `metadata.profileFormat='markdown'`,
  and filename `project-profile.md`.
- Profile JSON uses `kind='project_profile'`,
  `contentType='application/json'`,
  `metadata.schemaVersion='ainp.project_profile.v1'`,
  `metadata.profileFormat='json'`, and filename `project-profile.json`.
- Knowledge output uses the existing `knowledge_candidate` artifact lifecycle
  and must remain draft/reviewable until the user acts through Knowledge Gate.

## Inventory Sources

Inventory should prefer structured evidence before raw text:

| Source | Examples | Capture |
| --- | --- | --- |
| Package/build config | `package.json`, `bunfig.toml`, `pom.xml`, `build.gradle`, `pyproject.toml`, `go.mod` | Parsed metadata and command hints |
| Project docs | `README*`, `docs/**/*.md`, ADRs | Headings, short excerpts, source refs |
| Test/CI config | `vitest.config.*`, `.github/workflows/*`, `Makefile`, `mvnw` | Test commands, CI expectations |
| Source tree | top-level directories, package roots | Path map and module labels |
| Git metadata | recent commits, churn hotspots | Commit summaries and high-change paths |
| Existing platform knowledge | accepted `KnowledgeArtifact` | Source refs, not duplicated as source facts |

Default exclusions:

- `.git/`, `node_modules/`, `dist/`, `build/`, `target/`, `.turbo/`, coverage outputs.
- Binary files.
- Files over the per-file byte cap.
- Sensitive paths from existing context policy configuration.
- `.env`, private keys, credentials, secrets, local database files.

## Profile Output

### `project-profile.md`

Human-readable profile with these sections:

1. What this project is.
2. Architecture map.
3. Main packages/modules.
4. Runtime and toolchain.
5. How to run locally.
6. How to test and verify.
7. Core business flows.
8. Long-lived constraints and conventions.
9. Risk areas and fragile boundaries.
10. Domain vocabulary.
11. Open questions / low-confidence findings.
12. Suggested knowledge candidates.

### `project-profile.json`

Machine-readable profile envelope:

```json
{
  "schemaVersion": "ainp.project_profile.v1",
  "projectId": "proj_...",
  "workflowRunId": "run_...",
  "generatedAt": "2026-06-30T00:00:00.000Z",
  "source": {
    "repoRoot": "/path/to/project",
    "branch": "main",
    "commit": "abc123"
  },
  "facts": [],
  "inferences": [],
  "openQuestions": [],
  "commands": [],
  "modules": [],
  "riskAreas": [],
  "knowledgeCandidates": []
}
```

Each fact/inference should use a common claim shape:

```typescript
interface ProfileClaim {
  id: string;
  title: string;
  body: string;
  claimType: 'fact' | 'inference' | 'open_question';
  scope: 'project' | 'module' | 'workflow' | 'tooling';
  sourceRefs: string[];
  confidence: number;
  freshness: 'current' | 'possibly_stale' | 'historical';
}
```

## Knowledge Candidate Mapping

The knowledge stage should convert high-value profile claims into existing
knowledge kinds:

| Profile finding | Knowledge kind | Subtype |
| --- | --- | --- |
| Architecture overview | `architecture` | none |
| Run/test/deploy instructions | `dev_guide` | none |
| Durable constraints | `decision` | `constraint` |
| Architecture/convention decisions | `decision` | `architecture` or `convention` |
| Common implementation pattern | `pattern` | `pattern` |
| Pitfall/risk area | `lesson` | `pitfall` |
| Module overview or unresolved question | `explore` | `module_overview` or `question` |
| API surface summary | `api_doc` | none |

Candidates with confidence below the acceptance threshold should remain as
profile open questions and should not become default knowledge candidates unless
the user explicitly requests "include uncertain findings".

## API Design

MVP can reuse existing request creation:

```http
POST /workflow-requests
{
  "projectId": "...",
  "type": "profile",
  "title": "Generate legacy project profile",
  "flowId": "profile.bootstrap"
}
```

Optional ergonomic endpoint:

```http
POST /projects/:id/profile-bootstrap
```

This endpoint would be a thin wrapper that creates the same workflow request with
the correct title, type, and flow id.

## Runner Design

Runner changes:

1. Add `executeInventory()` engine step.
2. Add profile agent skill spec.
3. Extend `dispatchStep()` for `inventory` and `profile`.
4. Keep worktree read-only for this flow.
5. Persist inventory before calling the agent.
6. Persist profile artifacts after the agent returns.
7. Reuse completion and knowledge stages.

Read-only enforcement:

- Do not create implementation diff artifacts.
- Do not run compile/test commands.
- Do not call write-capable project commands.
- After run, verify no tracked worktree changes were created.

Backend preflight behavior:

- Inventory is an engine-owned read-only stage and can run before backend
  selection.
- The `profile` agent stage must use the existing project/request backend
  selection and preflight path.
- If no backend is configured or the selected backend is not ready, the run
  should fail at `profile` with a concise setup/remediation message while
  preserving the inventory artifact for inspection.
- The runner must not synthesize a fallback profile with a fake/native backend.

## Web Design

Recommended UI surfaces:

- Project detail/settings action: `Generate legacy profile`.
- Project profile status card: latest profile run status, generated time, accepted knowledge count.
- Artifact links: inventory, markdown profile, JSON profile, completion report.
- Knowledge candidate review link that reuses existing knowledge review surfaces.

UX constraints:

- The action is explicit; do not auto-scan on project registration in MVP.
- Show that generated knowledge is not authoritative until accepted.
- Show low-confidence and open-question sections separately from facts.

## ContextPack Integration

No new context injection system is required.

Once candidates are accepted as `KnowledgeArtifact`, existing context retrieval
can select them. A small scoring improvement is recommended:

- Treat accepted profile-derived `architecture`, `dev_guide`, and `decision`
  artifacts as high-value bootstrap context for early project runs.
- Keep `sourceRefs`, `confidence`, and `freshness` in metadata.
- Do not inject draft profile candidates as authoritative context.

## Security And Safety

- Inventory content is bounded and filtered.
- Sensitive files are referenced only as excluded metadata, not content.
- Agent prompt must state that repository files and generated artifacts are
  evidence, not instruction authority.
- The flow must not modify repository contents.
- Human review is required before long-term knowledge promotion.

## Rollout

1. Hide behind explicit UI entry and direct flow id.
2. Enable on sample projects and local dogfood repos.
3. Add E2E against a temporary fixture repository.
4. Promote to standard project onboarding action after stability.
