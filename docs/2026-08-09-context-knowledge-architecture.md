# Context and Knowledge Management Architecture

**Date**: 2026-08-09  
**Status**: Current Implementation  
**Audience**: Developers, Architects

## Overview

The platform implements two tightly integrated subsystems that form a **feedback loop**:

1. **Context Management** — Builds curated, trust-leveled context packs and injects them into agent sessions
2. **Knowledge Management** — Captures artifacts, promotes them to reusable knowledge, and feeds them back into future context packs

**Core Flow**: Artifacts → Candidates → Promoted Knowledge → Context Injection → New Artifacts (repeat)

---

## Context Management Architecture

### Purpose

Provide agents with **relevant, trustworthy, budget-aware context** drawn from multiple sources (project profile, accepted knowledge, prior feedback, input artifacts, project inventory).

**Key Challenge**: Balance completeness vs. token budget. Not everything can fit in the prompt.

**Solution**: Multi-source candidate assembly → scoring/ranking → budget enforcement with degradation.

---

### Core Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `ContextPack` | `packages/shared/src/types/context.ts` | Root structure for all injected context |
| `buildContextPack()` | `apps/runner/src/context/builder.ts` | Assembles context from multiple sources |
| `selectContextCandidates()` | `apps/runner/src/context/retriever.ts` | Scores, ranks, budgets candidates |
| `renderContextPackForPrompt()` | `apps/runner/src/context/renderer.ts` | Converts ContextPack to agent prompt text |

---

### ContextPack Structure

```typescript
interface ContextPack {
  id: string;
  workflowRunId: WorkflowRunId;
  stepRunId: StepRunId | null;
  taskBrief: string;
  stage: WorkflowStage;
  maturityProfile: ProjectMaturityProfile;
  budget: ContextPackBudget;
  mode: ContextPackMode;  // 'bootstrap' | 'calibration' | 'recovery' | 'task_execution'
  projectSnapshot: string;
  manifest: ContextManifestItem[];  // Metadata of selected sections
  sections: ContextSection[];       // Full content for injection
  retrievalHints: RetrievalHint[];  // "You may need X, search Y"
  calibrationSignals?: KnowledgeReviewSignal[];  // Conflict/stale warnings
  run: ContextPackRunMetadata;
  supplement?: ContextPackSupplement;  // Present for incremental context requests
  createdAt: Iso8601;
}
```

**Key Fields**:
- `manifest`: Lightweight metadata for observability (what was selected, why, what mode)
- `sections`: Full text content injected into prompt
- `retrievalHints`: Suggested searches if agent needs more context (retrieval-augmented pattern)
- `calibrationSignals`: Warnings about knowledge conflicts or staleness

---

### Context Section Metadata

Every section carries **provenance metadata** for trust-aware reasoning:

```typescript
interface ContextSection {
  id: string;
  title: string;
  content: string;
  sourceRefs: string[];  // Traceable origins (file:, artifact:, knowledge_artifact:)
  reason: string;
  priority: 1 | 2 | 3;
  knowledgeClass: 'seed' | 'recovered' | 'confirmed';
  trustLevel: 'source' | 'accepted_knowledge' | 'summary' | 'inference';
  freshness: 'current' | 'possibly_stale' | 'historical';
  confidence: number;  // 0.0 – 1.0
  mode: ContextInclusionMode;  // 'full' | 'summary' | 'snippet' | 'metadata_only' | 'retrieval_hint'
  degradedFrom?: ContextInclusionMode;  // Tracks budget degradation
  degradationReason?: string;
}
```

**Trust Levels**:
- `source`: First-party data (user request, task brief, input artifacts)
- `accepted_knowledge`: Human-approved or promoted knowledge (REQ-###, DSN-###)
- `summary`: Derived representation (project profile, capability map)
- `inference`: Model-generated judgment (prior feedback, reviewer remediation)

**Freshness**:
- `current`: Active in this run
- `possibly_stale`: Not recently updated
- `historical`: From superseded or past runs

**Knowledge Class**:
- `seed`: Explicitly provided by user (project goals, architecture constraints)
- `recovered`: Discovered from codebase (capability map, inventory)
- `confirmed`: Human-validated (promoted requirements, designs)

---

### Context Building Flow

```
buildContextPack()
  ├─ Resolve maturity profile (codebaseAge, knowledgeCoverage, evidenceDensity)
  ├─ Build candidates from multiple sources:
  │   ├─ Task brief (priority=1, trustLevel='source')
  │   ├─ Project profile markdown (knowledgeClass='recovered', trustLevel='summary')
  │   ├─ KnowledgeArtifacts (via candidatesForKnowledgeArtifacts)
  │   ├─ Input artifacts from current run (trustLevel='source')
  │   ├─ Prior feedback (human rejection / reviewer remediation, trustLevel='inference')
  │   └─ Project inventory (capability map, source chunks, symbols, tests)
  ├─ selectContextCandidates() — scores, ranks, budgets, degrades candidates
  │   ├─ Budget enforcement (maxTokens, reservedForReasoning, reservedForOutput)
  │   ├─ Mode degradation chain: full → summary → snippet → retrieval_hint
  │   └─ Priority + freshness + confidence scoring
  └─ Render sections + retrievalHints + calibrationSignals
```

**Location**: `apps/runner/src/context/builder.ts` (estimated 2275 lines based on research, partial read)

---

### Candidate Selection & Budget Enforcement

**Purpose**: Fit context within token budget while maximizing relevance.

**Algorithm** (BM25-style scoring + degradation):

1. **Score candidates**:
   - Base score = priority × freshness × confidence
   - Boost: task token match, source hint match (file paths, contentSha256)
   - Penalize: suppressed capabilities (wrong corrections)

2. **Sort by score** (descending)

3. **Budget loop**:
   - Add candidates in score order
   - If candidate exceeds remaining budget, **degrade mode**:
     - `full` → `summary` (10% of original tokens)
     - `summary` → `snippet` (3% of original)
     - `snippet` → `retrieval_hint` (0.5% of original, just metadata)
   - Track degradation reason (e.g., "Budget constraint: degraded from full to summary")

4. **Return selected sections + retrieval hints**

**Why degradation > dropping**: Agents still know the knowledge exists (via retrieval hints) and can request it later.

**Location**: `apps/runner/src/context/retriever.ts` (not fully read, inferred from builder imports)

---

### Incremental Context Request Protocol (08-09 P1)

**Problem**: Agent starts execution but realizes it needs missing context mid-session.

**Solution**: Structured `context_request` protocol.

#### Agent-Side Emission

Agent emits fenced JSON/YAML:

````markdown
```context_request
id: ctx-req-001
reason: "Need database schema to design migration"
requestedRefs:
  - code:src/schema.sql
  - artifact:prev-design-doc
questions:
  - "What ORM is used?"
  - "Are there existing migrations?"
priority: 1
```
````

#### Runner-Side Handling

1. Runner parses via `parseContextRequestFromAgentOutput()` (`apps/runner/src/context/request.ts`)
2. Calls `buildIncrementalContextPack()` with base pack + request
3. Re-invokes agent with **supplement pack**:
   ```typescript
   interface ContextPackSupplement {
     contextRequestId: string;
     reason: string;
     sections: ContextSection[];
     retrievalHints: RetrievalHint[];
   }
   ```
4. Supplement is appended to base pack (base remains unchanged)

**Max retries**: 1 (to prevent loops)

**Location**: `apps/runner/src/context/request.ts`, `apps/runner/src/orchestrator/invoke-skill.ts:103-125`

---

### Prior Feedback Injection (08-09 P1-2)

**New capability**: Inject feedback from previous failed attempts as a distinct candidate source.

**Two Sources**:
1. **Human rejection** — Gate comment from failed acceptance
2. **Reviewer remediation** — Structured action from review verdict

**Rendering**:
```typescript
{
  manifestType: 'prior_feedback',  // Not 'task_artifact'
  trustLevel: 'inference',         // Judgment, not fact
  freshness: 'current',
  priority: 1,
  confidence: 0.9 (human) / 0.75 (reviewer)
}
```

**Why separate from task_artifact**: Feedback is a **judgment about a failure**, not a fact this run produced. The judgment itself may be wrong.

**Rationale** (from builder.ts comments):
> Why a previous attempt was rejected — a human's gate comment or a reviewer verdict's remediation. Deliberately NOT `task_artifact`: that type carries facts this run produced, whereas feedback is a *judgement about a failure*, and the judgement itself may be wrong. Keeping them apart is what lets trust levels stay meaningful.

---

## Knowledge Management Architecture

### Purpose

Capture executable artifacts, promote them to reusable knowledge entities (REQ-###, DSN-###), and make them available for future context packs.

**Lifecycle**: Artifact → Candidate → Accepted → Superseded

---

### Core Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `KnowledgeArtifact` | `packages/shared/src/types/artifact.ts` | Core knowledge record |
| `createKnowledgeArtifact()` | `apps/api/src/workflow-engine.ts` | Factory + validation |
| `promoteDraftInTransaction()` | `apps/api/src/promote.ts` | Draft → entity promotion |
| `/knowledge-artifacts` | `apps/api/src/routes/knowledge-artifacts.ts` | REST endpoints |

---

### KnowledgeArtifact Schema

```typescript
interface KnowledgeArtifact {
  id: ArtifactId;
  projectId: ProjectId;
  kind: KnowledgeArtifactKind;
  uri: string;
  size: number;
  contentType: string;
  status: 'candidate' | 'accepted' | 'superseded' | 'rejected';
  version: number;
  entityId: string | null;         // REQ-001, DSN-042 for promoted entities
  derivedFromArtifactId: ArtifactId | null;
  subtype: string | null;
  metadata: Record<string, unknown>;  // Extensible metadata store
  createdAt: Iso8601;
  updatedAt: Iso8601;
}
```

**Key Fields**:
- `status`: Lifecycle state
- `entityId`: Stable ID after promotion (`requirement_draft` → `REQ-###`)
- `version`: Increments on entity update (v1, v2, ...)
- `metadata`: Carries context metadata (knowledgeClass, trustLevel, freshness, confidence), business metadata (title, refReq), usage tracking (hitCount, lastUsedAt)

---

### Knowledge Artifact Kinds

**Project-scoped** (stored in `knowledge_artifacts` table):
- `dev_guide`, `requirement`, `design`, `architecture_doc`, `decision_record`
- `nfr`, `convention`, `domain_model`, `test_strategy`

**Promotable drafts** (per-run → entity promotion):
- `requirement_draft` → `requirement` (entity: `REQ-###`)
- `design_doc` → `design` (entity: `DSN-###`)

**Special kinds**:
- `project_inventory` — Heuristic capability map + source chunks
- `source_chunk_index` — Indexed code chunks for hybrid retrieval
- `project_capability_map_correction` — Human corrections to capability labels

---

### Knowledge Lifecycle

#### 1. Creation

```
POST /knowledge-artifacts/projects/:projectId (general)
POST /knowledge-artifacts/projects/:projectId/seed (seed knowledge)
```

Artifact stored with `status='candidate'` (pending human review) or `status='accepted'` (seed knowledge, pre-approved).

#### 2. Promotion (Draft → Entity)

```
POST /knowledge-artifacts/promote
```

**Flow** (`promoteDraftInTransaction()`):

1. **Extract entity_id** (REQ-###, DSN-###) from draftText or auto-assign
2. **(designs only)** Extract refReq — required per R29
3. **Compute nextVersion** (1 for first, else max+1)
4. **Mark prior accepted rows as 'superseded'**
5. **INSERT new accepted row** into knowledge_artifacts
6. **UPSERT head row** (requirements / designs table)
7. **Dual-write markdown file** to `<localPath>/codestable/<kind>/<entity_id>.md`

**Response**:
```typescript
{
  knowledgeArtifactId: ArtifactId;
  entityId: string;
  entityKind: 'requirement' | 'design';
  version: number;
}
```

**Location**: `apps/api/src/promote.ts`

---

#### 3. Context Injection (Next Run)

```
buildContextPack()
  ↓
Query knowledge_artifacts via store.knowledgeArtifacts.byProject()
  ↓
candidatesForKnowledgeArtifacts() converts each to ContextCandidate
  ├─ contextMetadataForKnowledgeArtifact() normalizes metadata
  ├─ Applies review signals (downgrade if reviewStatus='needs_review')
  ├─ Title, content, summary extracted from metadata.{title, text, content, summary}
  └─ Base mode = knowledgeBaseMode(freshness, hasNegativeReviewSignal)
  ↓
selectContextCandidates() ranks and budgets alongside other sources
```

**Metadata Normalization**:
- `status='accepted'` → use metadata as-is (or defaults)
- `status='superseded'` → downgrade to `knowledgeClass='recovered'`, `trustLevel='summary'`, `freshness='historical'`, `confidence=min(0.4)`
- Other statuses → `knowledgeClass='recovered'`, possibly stale, `confidence=min(0.5)`

---

#### 4. Usage Tracking

```
POST /knowledge-artifacts/usage (bulk usage event)
```

Updates `metadata.hitCount`, `lastUsedAt`, `lastUsedBy`, `lastUsedInWorkflowRunId`.

**Purpose**: Enable popularity scoring for future retrieval (frequently-used knowledge ranks higher).

---

### Dual-Write Entity Pipeline (V2 P1-1)

For promoted entities (`requirement`, `design`), the platform maintains **two representations**:

1. **Database row** (knowledge_artifacts table + entity head table)
2. **Markdown file** (`codestable/{requirements,designs}/<entity_id>.md`)

**Why**: Enables Git-based review, human editing, version control.

#### Pre-Transaction (Fail-Fast)

```typescript
ensureCodestableDir()  // mkdir -p <localPath>/codestable/{requirements,designs}/
```

#### Transaction (Atomic)

```typescript
// Extract/assign entity_id
// Supersede prior accepted versions
// INSERT knowledge_artifacts row + UPSERT entity head row
```

#### Post-Transaction (Best-Effort)

```typescript
renderEntityMarkdown()  // Typed frontmatter + verbatim body
writeEntityFile()       // Atomic tmp + rename to <entity_id>.md
```

**Failure handling**: Logged but does NOT rollback DB. Drift recoverable via manual sync (planned).

**Files**:
- `apps/api/src/promote.ts` — Transaction logic
- `apps/api/src/promote-file.ts` — Pure rendering + IO layer

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

**Key Transformations**:
- `metadata.knowledgeClass` → `candidate.knowledgeClass` (seed/recovered/confirmed)
- `metadata.trustLevel` → `candidate.trustLevel` (source/accepted_knowledge/summary/inference)
- Review signals downgrade trustLevel + freshness + confidence

---

### Project Inventory Special Handling

#### Capability Map (`project_inventory.json`)

**Purpose**: Heuristic map of codebase capabilities (entrypoints → symbols → domain entities → tests).

**Retrieval**:
- BM25 + task tokens + source hints
- Focused down to: entrypoints → symbols (via graph edges) → domain entities → tests → hotspots
- Source chunks linked via `capabilityRefs`, `entrypointRefs`, `symbolRefs`

#### Capability Corrections

**Problem**: Capability map may label capabilities incorrectly (e.g., "auth" when it's actually "audit").

**Solution**: `project_capability_map_correction` artifacts with `action: 'wrong'` suppress capabilities.

**Rendering**: Suppressed capabilities render as "Capability Correction" probes (evidence-only, not guidance).

#### Source Chunk Index (`source-chunk-index.json`)

**Purpose**: Indexed code chunks for hybrid retrieval.

**Matching**:
- By `contentSha256` (exact match)
- By `path:startLine:endLine` (location match)
- By `linkedRecordRefs` (related entities)

**Deduplication**: Historical chunks suppressed if current run has same `contentSha256` or `sourceRef`.

---

## Maturity Profile & Mode Selection

### ProjectMaturityProfile

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

### Context Pack Mode Selection

```typescript
function modeFor(stage: WorkflowStage, profile: ProjectMaturityProfile): ContextPackMode {
  if (stage === 'context_pack') return 'bootstrap';
  if (calibrationSignals.length > 0 && isImportantChangeStage(stage)) return 'calibration';
  if (profile.primaryNeed === 'recover') return 'recovery';
  if (profile.primaryNeed === 'calibrate') return 'calibration';
  return 'task_execution';
}
```

**Modes**:
- `bootstrap`: Greenfield project, seed knowledge
- `calibration`: Growing project, resolve conflicts
- `recovery`: Legacy project, discover existing knowledge
- `task_execution`: Normal workflow execution

---

## Design Decisions

### Why Multi-Source Candidates?

**Problem**: No single source has complete context.

**Solution**: Assemble candidates from task brief, project profile, knowledge artifacts, input artifacts, prior feedback, project inventory.

**Trade-off**: Complex assembly logic, but necessary for completeness.

### Why Budget Degradation > Dropping?

**Problem**: Dropping candidates leaves gaps in agent knowledge.

**Solution**: Degrade mode (full → summary → snippet → retrieval_hint) so agent knows knowledge exists.

**Trade-off**: Retrieval hints may not be followed, but better than silent gaps.

### Why Dual-Write (DB + File)?

**Problem**: Database good for queries, files good for Git review.

**Solution**: Maintain both, best-effort sync.

**Trade-off**: Drift possible (DB success, file write fails), but logged and recoverable.

### Why Trust Levels?

**Problem**: Not all context is equally reliable.

**Solution**: Tag with `trustLevel` (source > accepted_knowledge > summary > inference).

**Trade-off**: Agents must interpret trust levels (not all models do), but explicit > implicit.

---

## Current Capabilities

### Context Injection

✅ Multi-source candidate assembly  
✅ Trust-leveled sections with provenance metadata  
✅ Budget-aware selection with degradation chain  
✅ Incremental context request protocol (08-09 P1)  
✅ Sensitive path filtering + sanitization  
✅ Maturity-aware mode selection  
✅ Calibration signals for knowledge review  
✅ Project inventory hybrid retrieval (BM25 + source hints)  
✅ Source chunk index enrichment  
✅ Capability map corrections

### Knowledge Management

✅ Multi-kind knowledge artifacts  
✅ Promotable draft → entity workflow  
✅ Atomic promotion transaction  
✅ Versioned entity heads  
✅ Dual-write markdown files  
✅ Status lifecycle (candidate → accepted → superseded)  
✅ Usage tracking (hitCount, popularity scoring)  
✅ Extensible metadata store

---

## Current Limitations

### Context System

1. **Budget overflow risk**: No hard cap enforcement before rendering; degradation is reactive.
2. **Retrieval hint effectiveness**: Hints are plain text; no structured retrieval command.
3. **Context request retry loop**: Unbounded retry on context_request; runner could loop.
4. **Manifest vs. section duplication**: Both carry overlapping metadata.

### Knowledge System

1. **Legacy dual storage**: Still reads `~/.ai-native/projects/{projectId}/knowledge/` markdown files (phasing out).
2. **Dual-write divergence**: Post-transaction file write failure logged but not auto-recovered.
3. **No FK on current_artifact_id**: `requirements.current_artifact_id` and `designs.current_artifact_id` are bare TEXT (no DB FK).
4. **Entity ID fallback race**: `nextEntityIdFallback()` could collide under concurrent promotes (SQLite write lock mitigates).

---

## Related Documentation

- `2026-08-09-workflow-engine-architecture.md` — Workflow state management
- `2026-08-09-agent-backend-architecture.md` — Agent execution layer
- `.trellis/tasks/05-04-v2-entity-tables-bootstrap/prd.md` — Entity promotion ADRs
- `.trellis/tasks/05-04-v2-dual-write-pipeline/prd.md` — Dual-write requirements

---

## Code References

- `apps/runner/src/context/builder.ts` — Context pack assembly (~2275 lines, partial read)
- `apps/runner/src/context/renderer.ts` — Prompt rendering
- `apps/runner/src/context/request.ts` — Incremental context request
- `apps/runner/src/context/retriever.ts` — Candidate selection
- `apps/api/src/promote.ts` — Knowledge promotion
- `apps/api/src/promote-file.ts` — Dual-write file layer
- `apps/api/src/routes/knowledge-artifacts.ts` — REST endpoints
- `packages/shared/src/types/context.ts` — Type definitions
- `packages/shared/src/types/artifact.ts` — KnowledgeArtifact schema
