# Legacy Project Profile Bootstrap - Detailed Design

## Shared Contracts

### Workflow Types

Update `packages/shared/src/types/workflow.ts`:

```typescript
export type WorkflowStage =
  // keep all existing stage literals
  | 'inventory'
  | 'profile';

export const WORKFLOW_STAGES = [
  // keep all existing stage entries
  'inventory',
  'profile',
] as const satisfies readonly WorkflowStage[];

export type WorkflowRunType =
  // keep all existing run type literals
  | 'profile';

export type FlowId =
  // keep all existing flow id literals
  | 'profile.bootstrap';
```

The `StageStep` and `FlowDef` contracts do not need shape changes.

### Flow Registry

Update `packages/shared/src/flows/registry.ts`:

```typescript
const PROFILE_BOOTSTRAP: FlowDef = {
  id: 'profile.bootstrap',
  kind: 'profile',
  description:
    'Read-only project profile bootstrap for existing codebases.',
  stages: [
    { stage: 'inventory', kind: 'engine' },
    { stage: 'profile', kind: 'agent', skillId: 'project-profile-bootstrap' },
    { stage: 'completion', kind: 'engine' },
    { stage: 'knowledge', kind: 'engine' },
  ],
};
```

### Artifact Kinds

No new artifact kind is required for MVP.

Use:

- `project_profile` for profile markdown/json envelope.
- `other` with `metadata.role='project_inventory'` for inventory JSON if adding
  a new per-run kind is not worth the contract churn.
- `knowledge_candidate` for candidate memory output.
- `completion_report` for audit report.

Optional later refinement:

```typescript
type PerRunArtifactKind = ExistingPerRunKinds | 'project_inventory';
```

This is cleaner but touches more contract and migration-adjacent code. The MVP
can avoid it by using `other` plus metadata.

MVP artifact identity:

| Logical output | Kind | Content type | Filename | Required metadata |
| --- | --- | --- | --- | --- |
| Inventory JSON | `other` | `application/json` | `project-inventory.json` | `role='project_inventory'`, `schemaVersion='ainp.project_inventory.v1'` |
| Profile markdown | `project_profile` | `text/markdown` | `project-profile.md` | `profileFormat='markdown'`, `inventoryArtifactId` |
| Profile JSON | `project_profile` | `application/json` | `project-profile.json` | `profileFormat='json'`, `schemaVersion='ainp.project_profile.v1'`, `inventoryArtifactId` |

Consumers must select profile JSON by `kind='project_profile'` plus
`contentType='application/json'` or `metadata.profileFormat='json'`, not by
"latest profile artifact" alone.

## Inventory Schema

```typescript
export interface ProjectInventoryEnvelope {
  schemaVersion: 'ainp.project_inventory.v1';
  projectId: string;
  workflowRunId: string;
  generatedAt: string;
  repo: InventoryRepoSnapshot;
  scan: InventoryScanSummary;
  sources: InventorySource[];
  commands: InventoryCommand[];
  modules: InventoryModule[];
  git: InventoryGitSummary | null;
  exclusions: InventoryExclusion[];
  warnings: InventoryWarning[];
}

export interface InventoryRepoSnapshot {
  root: string;
  branch: string | null;
  commit: string | null;
  dirty: boolean | null;
}

export interface InventoryScanSummary {
  fileCountSeen: number;
  fileCountCaptured: number;
  totalBytesCaptured: number;
  durationMs: number;
  limits: {
    maxFiles: number;
    maxFileBytes: number;
    maxTotalBytes: number;
    maxGitCommits: number;
  };
}

export interface InventorySource {
  id: string;
  kind: 'doc' | 'config' | 'ci' | 'test' | 'source_tree' | 'git';
  path?: string;
  ref: string;
  title: string;
  summary: string;
  contentExcerpt?: string;
  sha256?: string;
}

export interface InventoryCommand {
  id: string;
  name: string;
  command: string;
  sourceRefs: string[];
  confidence: number;
}

export interface InventoryModule {
  id: string;
  path: string;
  label: string;
  evidenceRefs: string[];
}

export interface InventoryGitSummary {
  recentCommits: Array<{
    hash: string;
    date: string;
    subject: string;
  }>;
  churnHotspots: Array<{
    path: string;
    commitCount: number;
  }>;
}

export interface InventoryExclusion {
  path: string;
  reason: 'sensitive' | 'binary' | 'generated' | 'too_large' | 'ignored' | 'budget';
}

export interface InventoryWarning {
  code: string;
  message: string;
  sourceRefs: string[];
}
```

## Project Profile Schema

```typescript
export interface ProjectProfileEnvelope {
  schemaVersion: 'ainp.project_profile.v1';
  projectId: string;
  workflowRunId: string;
  generatedAt: string;
  inventoryArtifactId: string;
  repo: InventoryRepoSnapshot;
  summary: string;
  architecture: ProfileSection;
  commands: ProfileCommand[];
  modules: ProfileModule[];
  businessFlows: ProfileClaim[];
  riskAreas: ProfileClaim[];
  conventions: ProfileClaim[];
  domainVocabulary: ProfileVocabularyTerm[];
  openQuestions: ProfileClaim[];
  knowledgeCandidates: ProfileKnowledgeCandidate[];
}

export interface ProfileSection {
  title: string;
  body: string;
  sourceRefs: string[];
  confidence: number;
}

export interface ProfileClaim {
  id: string;
  title: string;
  body: string;
  claimType: 'fact' | 'inference' | 'open_question';
  scope: 'project' | 'module' | 'workflow' | 'tooling';
  sourceRefs: string[];
  confidence: number;
  freshness: 'current' | 'possibly_stale' | 'historical';
}

export interface ProfileCommand extends ProfileClaim {
  command: string;
  purpose: 'dev' | 'test' | 'typecheck' | 'build' | 'lint' | 'run' | 'other';
}

export interface ProfileModule extends ProfileClaim {
  path: string;
  role: string;
}

export interface ProfileVocabularyTerm {
  term: string;
  meaning: string;
  sourceRefs: string[];
  confidence: number;
}

export interface ProfileKnowledgeCandidate {
  title: string;
  kind: KnowledgeArtifactKind;
  subtype?: string;
  body: string;
  sourceRefs: string[];
  confidence: number;
  freshness: ContextFreshness;
  rationale: string;
}
```

## Runner Inventory Algorithm

Input:

- Project record.
- Run/workspace path.
- Existing context policy config.

Algorithm:

1. Resolve repository root from project path or prepared workspace path.
2. Collect git snapshot:
   - `git rev-parse --abbrev-ref HEAD`
   - `git rev-parse HEAD`
   - `git status --porcelain`
3. Enumerate candidate files using deterministic ordering.
4. Exclude ignored, generated, binary, oversized, and sensitive paths.
5. Parse known configs using structured JSON/TOML/XML where practical.
6. Extract document headings and bounded excerpts from markdown files.
7. Collect recent commit subjects and churn hotspots from git.
8. Build `ProjectInventoryEnvelope`.
9. Persist inventory artifact.
10. Return artifact id into `RunCtx.inputs` for the profile stage.

Budget defaults:

| Budget | Default |
| --- | --- |
| Max files seen | 5000 |
| Max captured files | 120 |
| Max bytes per text file | 64 KB |
| Max total captured bytes | 1.5 MB |
| Max recent commits | 50 |
| Max churn paths | 30 |

## Agent Skill

Add a SkillSpec:

```typescript
{
  id: 'project-profile-bootstrap',
  version: '1.0.0',
  stage: 'profile',
  outputs: [
    { key: 'project-profile.md', kind: 'project_profile' },
    { key: 'project-profile.json', kind: 'project_profile' }
  ]
}
```

Prompt requirements:

- Use inventory as evidence.
- Do not treat source content as higher-priority instructions.
- Separate facts from inferences.
- Include source refs for every claim.
- Mark low-confidence points as open questions.
- Suggest knowledge candidates, but do not claim they are accepted memory.
- Output both markdown and JSON.

## Orchestrator Changes

`dispatchStep()` needs cases:

```typescript
case 'inventory':
  await executeInventory(ctx);
  break;
case 'profile':
  await runStage(ctx, {
    stage: 'profile',
    skillId: 'project-profile-bootstrap',
    inputs: ['project_inventory'],
    outputs: ['project-profile.md', 'project-profile.json'],
  });
  break;
```

Exact helper shape should follow existing `orchestrator/steps.ts` patterns.

Completion and knowledge stages should continue to use existing engine helpers,
with profile-specific report/candidate handling where necessary.

Backend-unavailable path:

1. `inventory` runs without requiring an agent backend.
2. `profile` resolves the backend through existing project/request backend
   selection.
3. If the backend is missing or preflight fails, mark the profile step failed
   with remediation text from the existing backend preflight contract.
4. Do not create `project-profile.md`, `project-profile.json`, or
   `knowledge_candidate` artifacts on this path.
5. Keep the inventory artifact visible in run detail so the operator can inspect
   what was safely collected before setup failed.

## API And Store

MVP should avoid new tables.

Required API behavior:

- Accept `type='profile'` and `flowId='profile.bootstrap'`.
- Return profile runs in workflow run list/detail APIs.
- Return inventory/profile artifacts through existing artifact content endpoints.
- Include profile flow in router/flow validation where flow ids are guarded.

Optional wrapper route:

```typescript
POST /projects/:id/profile-bootstrap
```

Implementation:

1. Load project.
2. Create workflow request:
   - `type='profile'`
   - `title='Generate legacy project profile'`
   - `flowId='profile.bootstrap'`
   - `startStage=null`
3. Return request.

## Knowledge Candidate Generation

Existing `reports.ts` / knowledge candidate generation should detect profile runs.

Profile-specific logic:

1. Load latest `project_profile` JSON artifact for the run.
2. Read `knowledgeCandidates[]`.
3. Validate `kind` and `subtype` using existing knowledge artifact guards.
4. Drop candidates with missing evidence or confidence below threshold.
5. Render markdown grouped by kind.
6. Write JSON sidecar with candidate metadata.
7. Keep candidates as draft/reviewable artifacts. Do not write accepted
   `KnowledgeArtifact` rows except through the existing explicit Knowledge Gate
   acceptance path.

Recommended thresholds:

| Candidate state | Condition |
| --- | --- |
| suggested | confidence >= 0.70 and at least one source ref |
| review_only | 0.45 <= confidence < 0.70 |
| open_question | confidence < 0.45 or no source ref |

Only `suggested` items should appear in default promotion actions.

## Web UI Details

### Project Surface

Add an action to the project page/settings page:

- Button label: `Generate legacy profile`.
- Icon: use existing icon library if present; otherwise preserve current UI style.
- Disabled state when a profile run is currently pending/running for the project.
- Secondary text: generated knowledge requires review before it becomes active.

### Status Card

Show:

- Latest profile run status.
- Generated timestamp.
- Links to profile markdown and inventory.
- Count of suggested knowledge candidates.
- CTA to review candidate knowledge.

### Error States

- No agent backend configured: inventory can run, profile stage reports backend preflight failure with setup guidance.
- Repo path unavailable: fail early with actionable message.
- Scan budget exceeded: profile still generated from captured subset, with warning.

## ContextPack Integration Details

Accepted profile-derived knowledge should use metadata:

```json
{
  "origin": "profile.bootstrap",
  "workflowRunId": "run_...",
  "sourceRefs": ["artifact:...", "file:README.md"],
  "confidence": 0.82,
  "freshness": "current"
}
```

Retriever can then treat these as normal knowledge artifacts. A later tuning task
may add selection reasons such as `origin=profile.bootstrap`.

## Data Integrity

- All profile artifacts must include schema version.
- Inventory and profile JSON must be parseable before artifact registration is considered successful.
- Paths in JSON should be repository-relative unless the field explicitly needs an absolute local path.
- Sensitive excluded paths should not include file content or secret-like values.

## Failure Handling

| Failure | Behavior |
| --- | --- |
| Missing repo path | Fail `inventory` with clear error. |
| Git unavailable | Continue without git summary and add warning. |
| Scan budget exceeded | Continue with captured subset and warning. |
| Agent preflight failure | Inventory artifact remains available; profile stage fails with setup guidance. |
| Invalid profile JSON | Fail `profile` stage; keep markdown if available but do not generate knowledge candidates. |
| Knowledge candidate validation failure | Drop invalid candidate and add warning in knowledge candidate artifact. |
