# Research: Context Injection and Knowledge Management

- **Query**: Research the context injection and knowledge management subsystems
- **Scope**: internal
- **Date**: 2026-08-09

## Findings

### Architecture Overview

The platform implements two tightly integrated subsystems:

1. **Context Management** — builds and injects curated, trust-leveled context into agent sessions
2. **Knowledge Management** — captures, promotes, and feeds knowledge artifacts back into future context packs

These work as a feedback loop: artifacts → candidates → promoted knowledge → context injection → new artifacts.

---

## Context Management Architecture

### Core Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `ContextPack` | `packages/shared/src/types/context.ts` | Root type for all injected context |
| `buildContextPack()` | `apps/runner/src/context/builder.ts` | Main context pack assembly function |
| `renderContextPackForPrompt()` | `apps/runner/src/context/renderer.ts` | Converts ContextPack to agent-visible prompt text |
| `selectContextCandidates()` | `apps/runner/src/context/retriever.ts` | Selection/ranking/budgeting logic |

### Context Pack Structure

```typescript
interface ContextPack {
  id: string;
  workflowRunId: WorkflowRunId;
  stepRunId: StepRunId | null;
  taskBrief: string;
  stage: WorkflowStage;
  maturityProfile: ProjectMaturityProfile;
  budget: ContextPackBudget;
  mode: ContextPackMode; // 'bootstrap' | 'calibration' | 'recovery' | 'task_execution'
  projectSnapshot: string;
  manifest: ContextManifestItem[];
  sections: ContextSection[];
  retrievalHints: RetrievalHint[];
  calibrationSignals?: KnowledgeReviewSignal[];
  run: ContextPackRunMetadata;
  supplement?: ContextPackSupplement; // Present for incremental context requests
  createdAt: Iso8601;
}
```

### Context Section Metadata

Every section carries:
- **knowledgeClass**: `'seed' | 'recovered' | 'confirmed'` — provenance tier
- **trustLevel**: `'source' | 'accepted_knowledge' | 'summary' | 'inference'` — reliability
- **freshness**: `'current' | 'possibly_stale' | 'historical'` — temporal relevance
- **confidence**: `0.0–1.0` — numeric quality score
- **mode**: `'full' | 'summary' | 'snippet' | 'metadata_only' | 'retrieval_hint'` — inclusion depth
- **sourceRefs**: traceable origin (file:, artifact:, knowledge_artifact:, entity:)

### Context Request Protocol (08-09 P1)

**Incremental context retrieval** — agents can request missing facts mid-session:

1. Agent emits structured `context_request` (fenced JSON/YAML)
2. Runner parses via `parseContextRequestFromAgentOutput()` (`apps/runner/src/context/request.ts`)
3. Runner calls `buildIncrementalContextPack()` with base pack + request
4. Supplement pack is injected with `supplement.contextRequestId` linking back to the request

```typescript
interface ContextRequest {
  id: string;
  workflowRunId: WorkflowRunId;
  stepRunId: StepRunId | null;
  stage: WorkflowStage;
  reason: string;
  requestedRefs: string[]; // max 8, e.g. "code:src/foo.ts", "artifact:xyz"
  questions: string[];     // max 8
  priority: 1 | 2 | 3;     // 1=blocking, 2=important, 3=nice-to-have
  status: 'open' | 'fulfilled' | 'dismissed';
  createdAt: Iso8601;
}
```

### Context Injection Workflow

```
buildContextPack()
  ├─ Resolve maturity profile (codebaseAge, knowledgeCoverage, evidenceDensity)
  ├─ Build candidates from multiple sources:
  │   ├─ Task brief (priority=1, trustLevel='source')
  │   ├─ Project profile markdown (knowledgeClass='recovered', trustLevel='summary')
  │   ├─ KnowledgeArtifacts (via candidatesForKnowledgeArtifacts)
  │   ├─ Accepted knowledge markdown (legacy, replaced by KnowledgeArtifacts)
  │   ├─ Input artifacts from current run (trustLevel='source')
  │   ├─ Prior feedback (human rejection / reviewer remediation, trustLevel='inference')
  │   └─ Project inventory sources (capability map, source chunks, symbols, tests)
  ├─ selectContextCandidates() ranks, budgets, degrades candidates
  │   ├─ Budget enforcement (maxTokens, reservedForReasoning, reservedForOutput)
  │   ├─ Mode degradation chain: full → summary → snippet → retrieval_hint
  │   └─ Priority + freshness + confidence scoring
  └─ Render sections + retrievalHints + calibrationSignals
```

### Candidate Selection Logic

Located in `apps/runner/src/context/retriever.ts` (not read in this session but inferred from builder imports):
- BM25-style scoring for project inventory records (capabilities, symbols, domain entities, source chunks)
- Task token matching + source hint matching (file paths / contentSha256 hints)
- Capability correction suppression (wrong corrections downgrade attached capabilities)
- Budget degradation with auditability (tracks mode changes and reasons)

### Sensitive Path Filtering

All context goes through `sanitizeSensitiveContextText()` to redact:
- Default patterns: `CONTEXT_POLICY_SENSITIVE_PATH_PATTERNS_DEFAULT`
- Applied to: section content, sourceRefs, prior feedback, input artifacts
- Path-safety guard: `isPathSafeEntityId()` for dual-write entity IDs

---

## Knowledge Management Architecture

### Core Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `KnowledgeArtifact` | `packages/shared/src/types/artifact.ts` | Core knowledge record type |
| `createKnowledgeArtifact()` | `apps/api/src/workflow-engine.ts` | Factory + validation |
| `promoteDraftInTransaction()` | `apps/api/src/promote.ts` | Draft → entity promotion (REQ/DSN) |
| `persistKnowledgeCandidate()` | `apps/runner/src/knowledge.ts` | Legacy local storage (being phased out) |
| `/knowledge-artifacts` | `apps/api/src/routes/knowledge-artifacts.ts` | REST endpoints |

### KnowledgeArtifact Schema

```typescript
interface KnowledgeArtifact {
  id: ArtifactId;
  projectId: ProjectId;
  kind: KnowledgeArtifactKind;
  uri: string;
  size: number;
  contentType: string;
  status: KnowledgeArtifactStatus; // 'candidate' | 'accepted' | 'superseded' | 'rejected'
  version: number;
  entityId: string | null;         // REQ-001, DSN-042 for promoted entities
  derivedFromArtifactId: ArtifactId | null;
  subtype: string | null;
  metadata: Record<string, unknown>; // Extensible metadata store
  createdAt: Iso8601;
  updatedAt: Iso8601;
}
```

### Knowledge Artifact Kinds

From shared types (observed in routes/builder):
- **Project-scoped** (stored in `knowledge_artifacts` table):
  - `dev_guide`, `requirement`, `design`, `architecture_doc`, `decision_record`
  - `nfr`, `convention`, `domain_model`, `test_strategy`
- **Promotable drafts** (per-run → entity promotion):
  - `requirement_draft` → `requirement` (entity: `REQ-###`)
  - `design_doc` → `design` (entity: `DSN-###`)
- **Special kinds**:
  - `project_inventory` — heuristic capability map + source chunks
  - `source_chunk_index` — indexed code chunks for hybrid retrieval
  - `project_capability_map_correction` — human corrections to capability labels

### Knowledge Lifecycle

```
1. CREATION (per-run or seed)
   ├─ POST /knowledge-artifacts/projects/:projectId (general)
   ├─ POST /knowledge-artifacts/projects/:projectId/seed (seed knowledge)
   └─ Artifact stored with status='candidate' or status='accepted' (seed)

2. PROMOTION (draft → entity)
   ├─ POST /knowledge-artifacts/promote
   ├─ promoteDraftInTransaction() (apps/api/src/promote.ts)
   │   ├─ Extract entity_id (REQ-###, DSN-###) from draftText or auto-assign
   │   ├─ (designs only) Extract refReq — required per R29
   │   ├─ Compute nextVersion (1 for first, else max+1)
   │   ├─ Mark prior accepted rows as 'superseded'
   │   ├─ INSERT new accepted row into knowledge_artifacts
   │   ├─ UPSERT head row (requirements / designs table)
   │   └─ Dual-write markdown file to <localPath>/codestable/<kind>/<entity_id>.md
   └─ Response: { knowledgeArtifactId, entityId, entityKind, version }

3. CONTEXT INJECTION (next run)
   ├─ buildContextPack() queries knowledge_artifacts via store.knowledgeArtifacts.byProject()
   ├─ candidatesForKnowledgeArtifacts() converts each artifact to ContextCandidate
   │   ├─ contextMetadataForKnowledgeArtifact() normalizes metadata
   │   ├─ Applies review signals (downgrade if reviewStatus='needs_review')
   │   ├─ Title, content, summary extracted from metadata.{title, text, content, summary}
   │   └─ Base mode = knowledgeBaseMode(freshness, hasNegativeReviewSignal)
   └─ selectContextCandidates() ranks and budgets them alongside other sources

4. USAGE TRACKING
   ├─ POST /knowledge-artifacts/usage (bulk usage event)
   ├─ Updates metadata.hitCount, lastUsedAt, lastUsedBy, lastUsedInWorkflowRunId
   └─ Enables popularity scoring for future retrieval
```

### Dual-Write Entity Pipeline (V2 P1-1)

For promoted entities (`requirement`, `design`):

**Pre-transaction** (fail-fast):
- `ensureCodestableDir()` — `mkdir -p <localPath>/codestable/{requirements,designs}/`

**Transaction** (atomic):
- Extract/assign entity_id
- Supersede prior accepted versions
- INSERT knowledge_artifacts row + UPSERT entity head row

**Post-transaction** (best-effort):
- `renderEntityMarkdown()` — typed frontmatter + verbatim body
- `writeEntityFile()` — atomic tmp + rename to `<entity_id>.md`
- Failure logged but does NOT rollback DB (R10/R11, drift recoverable)

Files:
- `apps/api/src/promote.ts` — transaction logic
- `apps/api/src/promote-file.ts` — pure rendering + IO layer

---

## Integration Patterns

### Context ← Knowledge Flow

```
KnowledgeArtifact (DB)
  ↓ (store.knowledgeArtifacts.byProject)
ContextCandidate
  ↓ (selectContextCandidates: scoring + budgeting)
ContextSection
  ↓ (renderContextPackForPrompt)
Agent prompt text
```

**Key transformations**:
- `metadata.knowledgeClass` → candidate.knowledgeClass (seed/recovered/confirmed)
- `metadata.trustLevel` → candidate.trustLevel (source/accepted_knowledge/summary/inference)
- `metadata.freshness` → candidate.freshness (current/possibly_stale/historical)
- Review signals downgrade trustLevel + freshness + confidence

### Knowledge Metadata Normalization

`normalizeKnowledgeContextMetadata()` (in shared types, used by builder):
- Reads `metadata.{knowledgeClass, trustLevel, freshness, confidence, sourceRefs}`
- Applies fallbacks based on artifact.status:
  - `status='accepted'` → use metadata as-is (or defaults)
  - `status='superseded'` → downgrade to `knowledgeClass='recovered'`, `trustLevel='summary'`, `freshness='historical'`, `confidence=min(0.4)`
  - Other statuses → `knowledgeClass='recovered'`, possibly stale, `confidence=min(0.5)`
- Returns `NormalizedKnowledgeContextMetadata` for consistent candidate construction

### Project Inventory Special Handling

**Capability Map** (`project_inventory.json`):
- Parsed from input artifacts or knowledge artifacts
- Capabilities matched via BM25 + task tokens + source hints
- Focused down to: entrypoints → symbols (via graph edges) → domain entities → tests → hotspots
- Source chunks linked via `capabilityRefs`, `entrypointRefs`, `symbolRefs`

**Capability Corrections**:
- `project_capability_map_correction` artifacts with `action: 'wrong'` suppress capabilities
- Suppressed capabilities render as "Capability Correction" probes (evidence only, not guidance)

**Source Chunk Index** (`source-chunk-index.json`):
- Standalone or embedded in project_inventory
- Enriches current run source chunks with historical indexed metadata
- Matched by: `contentSha256`, `path:startLine:endLine`, `linkedRecordRefs`
- Deduplication: historical chunks suppressed if current run has same contentSha256 or sourceRef

### Prior Feedback Injection (08-09 P1-2)

**New in this research session**: prior-attempt feedback as a distinct candidate source.

Two sources:
1. **Human rejection** — gate comment from a failed acceptance
2. **Reviewer remediation** — structured action from a review verdict

Both render as:
- `manifestType: 'prior_feedback'` (not `task_artifact`)
- `trustLevel: 'inference'` — judgement, not fact
- `freshness: 'current'` — relevant to retry
- High priority (1) but moderate confidence (0.9 human, 0.75 reviewer)

Rationale (from builder.ts comments):
> Why a previous attempt was rejected — a human's gate comment or a reviewer verdict's remediation. Deliberately NOT `task_artifact`: that type carries facts this run produced, whereas feedback is a *judgement about a failure*, and the judgement itself may be wrong. Keeping them apart is what lets trust levels stay meaningful.

---

## Data Structures

### ContextManifestItem

Metadata snapshot of a selected section:

```typescript
interface ContextManifestItem {
  type: ContextManifestItemType; // 'project_profile' | 'seed' | 'domain' | ...
  ref: string;                    // section.id
  reason: string;
  priority: 1 | 2 | 3;
  mode: ContextInclusionMode;
  knowledgeClass: KnowledgeClass;
  trustRequired?: ContextTrustRequirement;
  sourceRefs?: string[];
  trustLevel?: ContextTrustLevel;
  freshness?: ContextFreshness;
  confidence?: number;
  sourceType?: ContextSourceType;
  score?: number;
  selectionReasons?: string[];
  degradedFrom?: ContextInclusionMode;   // Tracks budget degradation
  degradationReason?: string;
}
```

### ContextSection

Full content + metadata for injection:

```typescript
interface ContextSection {
  id: string;
  title: string;
  content: string;             // The actual text to inject
  sourceRefs: string[];
  reason: string;
  priority: 1 | 2 | 3;
  knowledgeClass: KnowledgeClass;
  trustLevel: ContextTrustLevel;
  freshness: ContextFreshness;
  confidence: number;
  mode: ContextInclusionMode;
  sourceType?: ContextSourceType;
  score?: number;
  selectionReasons?: string[];
  degradedFrom?: ContextInclusionMode;
  degradationReason?: string;
}
```

### ProjectMaturityProfile

Drives context pack mode selection:

```typescript
interface ProjectMaturityProfile {
  stage: 'greenfield' | 'growing' | 'legacy';
  codebaseAge: 'empty' | 'early' | 'established' | 'unknown';
  knowledgeCoverage: 'seeded' | 'partial' | 'recovered' | 'confirmed';
  evidenceDensity: 'low' | 'medium' | 'high';
  volatility: 'high' | 'medium' | 'low';
  primaryNeed: 'bootstrap' | 'calibrate' | 'recover';
}
```

**Mode selection** (`modeFor()` in builder.ts):
- `stage='context_pack'` → `'bootstrap'`
- `calibrationSignals.length > 0 && isImportantChangeStage(stage)` → `'calibration'`
- `primaryNeed='recover'` → `'recovery'`
- `primaryNeed='calibrate'` → `'calibration'`
- Else → `'task_execution'`

---

## Current Capabilities

### Context Injection

✅ Multi-source candidate assembly (task brief, project profile, knowledge artifacts, input artifacts, prior feedback, project inventory)  
✅ Trust-leveled sections with provenance metadata  
✅ Budget-aware selection with degradation chain (full → summary → snippet → retrieval_hint)  
✅ Incremental context request protocol (08-09 P1)  
✅ Sensitive path filtering + sanitization  
✅ Maturity-aware mode selection (bootstrap / calibration / recovery / task_execution)  
✅ Calibration signals for knowledge review (conflict / stale / superseded / upgrade/downgrade candidates)  
✅ Project inventory hybrid retrieval (BM25 + source hints + contentSha256 matching)  
✅ Source chunk index enrichment (historical → current merging)  
✅ Capability map corrections (suppress wrong capabilities, render as evidence-only probes)  

### Knowledge Management

✅ Multi-kind knowledge artifacts (guides, requirements, designs, decisions, conventions, domain models, test strategies)  
✅ Promotable draft → entity workflow (requirement_draft → REQ-###, design_doc → DSN-###)  
✅ Atomic promotion transaction (extract/assign entity_id, supersede prior, insert/upsert, dual-write)  
✅ Versioned entity heads (requirements / designs tables)  
✅ Dual-write markdown files (`codestable/{requirements,designs}/<entity_id>.md`)  
✅ Status lifecycle (candidate → accepted / superseded / rejected)  
✅ Usage tracking (hitCount, lastUsedAt, popularity scoring)  
✅ Extensible metadata store for specialized kinds (project_inventory, source_chunk_index, capability_map_correction)  
✅ Seed knowledge via API (`POST /knowledge-artifacts/projects/:projectId/seed`)  

---

## Limitations

### Context System

- **Budget overflow risk**: No hard cap enforcement before rendering; degradation is reactive (post-selection budget check)
- **Retrieval hint effectiveness**: Hints are injected as plain text; no structured retrieval command or callback
- **Context request retry loop**: Unbounded retry on context_request; runner could loop if agent keeps requesting
- **Manifest vs. section duplication**: Both carry overlapping metadata; manifest could be derived on-demand

### Knowledge System

- **Legacy dual storage**: `collectAcceptedKnowledge()` still reads `~/.ai-native/projects/{projectId}/knowledge/` markdown files alongside KnowledgeArtifacts (phasing out)
- **Dual-write divergence**: Post-transaction file write failure logged but not recovered; drift scan task planned but not implemented
- **No FK on current_artifact_id**: `requirements.current_artifact_id` and `designs.current_artifact_id` are bare TEXT (no DB FK per Q3=3-B comment in promote.ts)
- **Entity ID fallback race**: `nextEntityIdFallback()` runs in-tx but still queries existing rows; concurrent promotes could collide (SQLite write lock mitigates but not guaranteed unique)
- **Path-safety edge case**: `isPathSafeEntityId()` rejects exotic entity_ids; DB row committed but file write skipped (rare)

### Integration

- **No automatic drift reconciliation**: File ↔ DB divergence logged but manual intervention required
- **Capability correction propagation**: Wrong corrections suppress capabilities in context but don't auto-reject the artifact
- **Source chunk index merge complexity**: Historical + current merging has bounded limits (120 lexical tokens, 1200 search text chars, 120 linked record refs) that could silently drop data

---

## Related Specs

- `.trellis/spec/runtime-config-layer.md` — mentions context policy
- `.trellis/spec/api/backend/workflow-requests.md` — workflow run + step run lifecycle
- `.trellis/tasks/05-04-v2-entity-tables-bootstrap/prd.md` — entity promotion ADRs (Q1-Q5)
- `.trellis/tasks/05-04-v2-dual-write-pipeline/prd.md` — dual-write requirements (R1-R29)
- `.trellis/tasks/05-04-v2-artifact-kind-expansion/prd.md` — KnowledgeArtifact data model (Q1-Q4)
- `.trellis/tasks/08-09-*` — current task context (not explored)

---

## Caveats / Not Found

- `selectContextCandidates()` implementation not read (in `apps/runner/src/context/retriever.ts`)
- Exact BM25 scoring formula not inspected (inferred from builder imports + comments)
- Knowledge review signal generation logic not traced (buildKnowledgeReviewSignals mentioned but not followed)
- Entity head tables schema (`requirements`, `designs`) not inspected (only usage observed)
- Context request fulfillment workflow not traced (open → fulfilled transition logic)
