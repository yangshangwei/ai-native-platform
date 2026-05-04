import type {
  Project,
  WorkflowRequest,
  WorkflowRun,
  StepRun,
  CommandRun,
  GateRun,
  Artifact,
  KnowledgeArtifact,
  KnowledgeArtifactKind,
  KnowledgeArtifactStatus,
  RequirementEntity,
  RequirementEntityStatus,
  DesignEntity,
  BuildRun,
  TestRun,
  AgentTask,
  AgentResult,
  AgentStreamEvent,
  CoordinatorDecision,
  RequestMessage,
} from '@ainp/shared';
import { isProjectAgentBackendKind } from '@ainp/shared';
import { appendFileSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { db } from './db';

/**
 * SQLite-backed store. Keeps a Map-like surface for the entities that the
 * earlier in-memory store exposed (projects, workflowRuns, stepRuns,
 * commandRuns) so existing callers in workflow-engine.ts and routes don't
 * change. Newer entities expose explicit repo methods.
 */

interface MapLike<T extends { id: string }> {
  set(id: string, value: T): void;
  get(id: string): T | undefined;
  has(id: string): boolean;
  values(): T[];
  readonly size: number;
}

function bool(b: boolean): number {
  return b ? 1 : 0;
}

function unbool(n: number | bigint | null): boolean {
  return Boolean(n);
}

function parseStringArrayJson(value: string | null): string[] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  } catch {
    return undefined;
  }
}

/** Positional INSERT helper. Keys define column order; values bind 1:1. */
function upsertRow(table: string, row: Record<string, unknown>): void {
  const cols = Object.keys(row);
  const sql = `INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${cols
    .map(() => '?')
    .join(',')})`;
  db.prepare(sql).run(...(Object.values(row) as never[]));
}

function insertRow(table: string, row: Record<string, unknown>): void {
  const cols = Object.keys(row);
  const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols
    .map(() => '?')
    .join(',')})`;
  db.prepare(sql).run(...(Object.values(row) as never[]));
}

function countRows(table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
}

// ---- projects --------------------------------------------------------------

interface ProjectRow {
  id: string;
  name: string;
  local_path: string;
  source_kind: string | null;
  source_url: string | null;
  source_auth_kind: string | null;
  source_username: string | null;
  source_credential: string | null;
  status: string | null;
  archived_at: string | null;
  agent_backend: string | null;
  language: string;
  build_tool: string;
  default_branch: string;
  source_branches_json: string | null;
  registered_at: string;
}

function rowToProject(r: ProjectRow): Project {
  return {
    id: r.id,
    name: r.name,
    localPath: r.local_path,
    sourceKind: (r.source_kind ?? 'local') as Project['sourceKind'],
    sourceUrl: r.source_url ?? null,
    sourceAuthKind: (r.source_auth_kind ?? 'none') as Project['sourceAuthKind'],
    sourceUsername: r.source_username ?? null,
    sourceCredential: r.source_credential ?? null,
    status: (r.status ?? 'active') as Project['status'],
    archivedAt: r.archived_at ?? null,
    agentBackend: isProjectAgentBackendKind(r.agent_backend) ? r.agent_backend : null,
    language: r.language as Project['language'],
    buildTool: r.build_tool as Project['buildTool'],
    defaultBranch: r.default_branch,
    sourceBranches: parseStringArrayJson(r.source_branches_json),
    registeredAt: r.registered_at,
  };
}

const projects: MapLike<Project> & {
  findByName(name: string): Project | undefined;
  delete(id: string): void;
} = {
  set(_id, p) {
    upsertRow('projects', {
      id: p.id,
      name: p.name,
      local_path: p.localPath,
      source_kind: p.sourceKind ?? 'local',
      source_url: p.sourceUrl ?? null,
      source_auth_kind: p.sourceAuthKind ?? 'none',
      source_username: p.sourceUsername ?? null,
      source_credential: p.sourceCredential ?? null,
      status: p.status ?? 'active',
      archived_at: p.archivedAt ?? null,
      agent_backend: p.agentBackend ?? null,
      language: p.language,
      build_tool: p.buildTool,
      default_branch: p.defaultBranch,
      source_branches_json: p.sourceBranches ? JSON.stringify(p.sourceBranches) : null,
      registered_at: p.registeredAt,
    });
  },
  get(id) {
    const r = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | null;
    return r ? rowToProject(r) : undefined;
  },
  has(id) {
    return Boolean(db.prepare('SELECT 1 FROM projects WHERE id = ?').get(id));
  },
  values() {
    return (db.prepare('SELECT * FROM projects').all() as ProjectRow[]).map(rowToProject);
  },
  get size() {
    return countRows('projects');
  },
  findByName(name) {
    const r = db.prepare('SELECT * FROM projects WHERE name = ?').get(name) as ProjectRow | null;
    return r ? rowToProject(r) : undefined;
  },
  delete(id) {
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  },
};

// ---- workflow_runs ---------------------------------------------------------

interface WorkflowRunRow {
  id: string;
  project_id: string;
  type: string;
  status: string;
  current_stage: string;
  config_snapshot_id: string | null;
  source_branch: string | null;
  branch: string;
  workspace_path: string | null;
  title: string;
  created_at: string;
  updated_at: string;
}

function rowToWorkflowRun(r: WorkflowRunRow): WorkflowRun {
  return {
    id: r.id,
    projectId: r.project_id,
    type: r.type as WorkflowRun['type'],
    status: r.status as WorkflowRun['status'],
    currentStage: r.current_stage as WorkflowRun['currentStage'],
    configSnapshotId: r.config_snapshot_id,
    sourceBranch: r.source_branch ?? '',
    branch: r.branch,
    workspacePath: r.workspace_path,
    title: r.title,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const workflowRuns: MapLike<WorkflowRun> & {
  byProject(projectId: string): WorkflowRun[];
} = {
  set(_id, run) {
    upsertRow('workflow_runs', {
      id: run.id,
      project_id: run.projectId,
      type: run.type,
      status: run.status,
      current_stage: run.currentStage,
      config_snapshot_id: run.configSnapshotId,
      source_branch: run.sourceBranch || null,
      branch: run.branch,
      workspace_path: run.workspacePath,
      title: run.title,
      created_at: run.createdAt,
      updated_at: run.updatedAt,
    });
  },
  get(id) {
    const r = db.prepare('SELECT * FROM workflow_runs WHERE id = ?').get(id) as
      | WorkflowRunRow
      | null;
    return r ? rowToWorkflowRun(r) : undefined;
  },
  has(id) {
    return Boolean(db.prepare('SELECT 1 FROM workflow_runs WHERE id = ?').get(id));
  },
  values() {
    return (
      db.prepare('SELECT * FROM workflow_runs ORDER BY created_at ASC').all() as WorkflowRunRow[]
    ).map(rowToWorkflowRun);
  },
  get size() {
    return countRows('workflow_runs');
  },
  byProject(projectId) {
    return (
      db
        .prepare('SELECT * FROM workflow_runs WHERE project_id = ? ORDER BY created_at ASC')
        .all(projectId) as WorkflowRunRow[]
    ).map(rowToWorkflowRun);
  },
};

// ---- workflow_requests -------------------------------------------------------

interface WorkflowRequestRow {
  id: string;
  project_id: string;
  type: string;
  title: string;
  branch: string;
  status: string;
  claimed_by: string | null;
  workflow_run_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

function rowToWorkflowRequest(r: WorkflowRequestRow): WorkflowRequest {
  return {
    id: r.id,
    projectId: r.project_id,
    type: r.type as WorkflowRequest['type'],
    title: r.title,
    branch: r.branch,
    status: r.status as WorkflowRequest['status'],
    claimedBy: r.claimed_by,
    workflowRunId: r.workflow_run_id,
    error: r.error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const workflowRequests = {
  set(_id: string, req: WorkflowRequest): void {
    upsertRow('workflow_requests', {
      id: req.id,
      project_id: req.projectId,
      type: req.type,
      title: req.title,
      branch: req.branch,
      status: req.status,
      claimed_by: req.claimedBy,
      workflow_run_id: req.workflowRunId,
      error: req.error,
      created_at: req.createdAt,
      updated_at: req.updatedAt,
    });
  },
  get(id: string): WorkflowRequest | undefined {
    const r = db.prepare('SELECT * FROM workflow_requests WHERE id = ?').get(id) as
      | WorkflowRequestRow
      | null;
    return r ? rowToWorkflowRequest(r) : undefined;
  },
  values(): WorkflowRequest[] {
    return (
      db.prepare('SELECT * FROM workflow_requests ORDER BY created_at ASC').all() as WorkflowRequestRow[]
    ).map(rowToWorkflowRequest);
  },
  byStatus(status: WorkflowRequest['status']): WorkflowRequest[] {
    return (
      db
        .prepare('SELECT * FROM workflow_requests WHERE status = ? ORDER BY created_at ASC')
        .all(status) as WorkflowRequestRow[]
    ).map(rowToWorkflowRequest);
  },
  pending(): WorkflowRequest[] {
    return this.byStatus('pending');
  },
  updateStatus(id: string, status: WorkflowRequest['status']): WorkflowRequest | undefined {
    const current = this.get(id);
    if (!current) return undefined;
    const next: WorkflowRequest = { ...current, status, updatedAt: new Date().toISOString() };
    this.set(id, next);
    return next;
  },
  get size(): number {
    return countRows('workflow_requests');
  },
};

// ---- step_runs -------------------------------------------------------------

interface StepRunRow {
  id: string;
  workflow_run_id: string;
  stage: string;
  name: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
}

function rowToStepRun(r: StepRunRow): StepRun {
  return {
    id: r.id,
    workflowRunId: r.workflow_run_id,
    stage: r.stage as StepRun['stage'],
    name: r.name,
    status: r.status as StepRun['status'],
    startedAt: r.started_at,
    completedAt: r.completed_at,
  };
}

const stepRuns: MapLike<StepRun> & {
  byWorkflow(workflowRunId: string): StepRun[];
} = {
  set(_id, s) {
    upsertRow('step_runs', {
      id: s.id,
      workflow_run_id: s.workflowRunId,
      stage: s.stage,
      name: s.name,
      status: s.status,
      started_at: s.startedAt,
      completed_at: s.completedAt,
    });
  },
  get(id) {
    const r = db.prepare('SELECT * FROM step_runs WHERE id = ?').get(id) as StepRunRow | null;
    return r ? rowToStepRun(r) : undefined;
  },
  has(id) {
    return Boolean(db.prepare('SELECT 1 FROM step_runs WHERE id = ?').get(id));
  },
  values() {
    return (db.prepare('SELECT * FROM step_runs').all() as StepRunRow[]).map(rowToStepRun);
  },
  get size() {
    return countRows('step_runs');
  },
  byWorkflow(workflowRunId) {
    return (
      db
        .prepare(
          'SELECT * FROM step_runs WHERE workflow_run_id = ? ORDER BY COALESCE(started_at, "") ASC',
        )
        .all(workflowRunId) as StepRunRow[]
    ).map(rowToStepRun);
  },
};

// ---- command_runs ----------------------------------------------------------

interface CommandRunRow {
  id: string;
  workflow_run_id: string;
  step_run_id: string | null;
  cwd: string;
  command: string;
  stage: string;
  status: string;
  exit_code: number | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  stdout_ref: string;
  stderr_ref: string;
  stdout_bytes: number;
  stderr_bytes: number;
  timed_out: number;
  truncated: number;
}

function rowToCommandRun(r: CommandRunRow): CommandRun {
  return {
    id: r.id,
    workflowRunId: r.workflow_run_id,
    stepRunId: r.step_run_id,
    cwd: r.cwd,
    command: r.command,
    stage: r.stage as CommandRun['stage'],
    status: r.status as CommandRun['status'],
    exitCode: r.exit_code,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    durationMs: r.duration_ms,
    stdoutRef: r.stdout_ref,
    stderrRef: r.stderr_ref,
    stdoutBytes: r.stdout_bytes,
    stderrBytes: r.stderr_bytes,
    timedOut: unbool(r.timed_out),
    truncated: unbool(r.truncated),
  };
}

const commandRuns: MapLike<CommandRun> & {
  byWorkflow(workflowRunId: string): CommandRun[];
  byStep(stepRunId: string): CommandRun[];
} = {
  set(_id, c) {
    upsertRow('command_runs', {
      id: c.id,
      workflow_run_id: c.workflowRunId,
      step_run_id: c.stepRunId,
      cwd: c.cwd,
      command: c.command,
      stage: c.stage,
      status: c.status,
      exit_code: c.exitCode,
      started_at: c.startedAt,
      finished_at: c.finishedAt,
      duration_ms: c.durationMs,
      stdout_ref: c.stdoutRef,
      stderr_ref: c.stderrRef,
      stdout_bytes: c.stdoutBytes,
      stderr_bytes: c.stderrBytes,
      timed_out: bool(c.timedOut),
      truncated: bool(c.truncated),
    });
  },
  get(id) {
    const r = db.prepare('SELECT * FROM command_runs WHERE id = ?').get(id) as
      | CommandRunRow
      | null;
    return r ? rowToCommandRun(r) : undefined;
  },
  has(id) {
    return Boolean(db.prepare('SELECT 1 FROM command_runs WHERE id = ?').get(id));
  },
  values() {
    return (db.prepare('SELECT * FROM command_runs').all() as CommandRunRow[]).map(
      rowToCommandRun,
    );
  },
  get size() {
    return countRows('command_runs');
  },
  byWorkflow(workflowRunId) {
    return (
      db
        .prepare('SELECT * FROM command_runs WHERE workflow_run_id = ? ORDER BY started_at ASC')
        .all(workflowRunId) as CommandRunRow[]
    ).map(rowToCommandRun);
  },
  byStep(stepRunId) {
    return (
      db
        .prepare('SELECT * FROM command_runs WHERE step_run_id = ? ORDER BY started_at ASC')
        .all(stepRunId) as CommandRunRow[]
    ).map(rowToCommandRun);
  },
};

// ---- gate_runs -------------------------------------------------------------

interface GateRunRow {
  id: string;
  gate_id: string;
  workflow_run_id: string;
  step_run_id: string | null;
  status: string;
  rule_results_json: string;
  evidence_refs_json: string;
  command_run_ids_json: string;
  decided_at: string;
  agent_note: string | null;
}

function rowToGateRun(r: GateRunRow): GateRun {
  return {
    id: r.id,
    gateId: r.gate_id as GateRun['gateId'],
    workflowRunId: r.workflow_run_id,
    stepRunId: r.step_run_id,
    status: r.status as GateRun['status'],
    ruleResults: JSON.parse(r.rule_results_json),
    evidenceRefs: JSON.parse(r.evidence_refs_json),
    commandRunIds: JSON.parse(r.command_run_ids_json),
    decidedAt: r.decided_at,
    agentNote: r.agent_note,
  };
}

const gateRuns = {
  insert(g: GateRun): void {
    insertRow('gate_runs', {
      id: g.id,
      gate_id: g.gateId,
      workflow_run_id: g.workflowRunId,
      step_run_id: g.stepRunId,
      status: g.status,
      rule_results_json: JSON.stringify(g.ruleResults),
      evidence_refs_json: JSON.stringify(g.evidenceRefs),
      command_run_ids_json: JSON.stringify(g.commandRunIds),
      decided_at: g.decidedAt,
      agent_note: g.agentNote,
    });
  },
  get(id: string): GateRun | undefined {
    const r = db.prepare('SELECT * FROM gate_runs WHERE id = ?').get(id) as GateRunRow | null;
    return r ? rowToGateRun(r) : undefined;
  },
  byWorkflow(workflowRunId: string): GateRun[] {
    return (
      db
        .prepare('SELECT * FROM gate_runs WHERE workflow_run_id = ? ORDER BY decided_at ASC')
        .all(workflowRunId) as GateRunRow[]
    ).map(rowToGateRun);
  },
  latestForGate(workflowRunId: string, gateId: GateRun['gateId']): GateRun | undefined {
    const r = db
      .prepare(
        'SELECT * FROM gate_runs WHERE workflow_run_id = ? AND gate_id = ? ORDER BY decided_at DESC LIMIT 1',
      )
      .get(workflowRunId, gateId) as GateRunRow | null;
    return r ? rowToGateRun(r) : undefined;
  },
  get size(): number {
    return countRows('gate_runs');
  },
};

// ---- artifacts -------------------------------------------------------------

interface ArtifactRow {
  id: string;
  kind: string;
  uri: string;
  workflow_run_id: string;
  step_run_id: string | null;
  size: number;
  content_type: string;
  created_at: string;
  metadata_json: string;
}

function rowToArtifact(r: ArtifactRow): Artifact {
  return {
    id: r.id,
    kind: r.kind as Artifact['kind'],
    uri: r.uri,
    workflowRunId: r.workflow_run_id,
    stepRunId: r.step_run_id,
    size: r.size,
    contentType: r.content_type,
    createdAt: r.created_at,
    metadata: JSON.parse(r.metadata_json) as Record<string, unknown>,
  };
}

const artifacts = {
  insert(a: Artifact): void {
    insertRow('artifacts', {
      id: a.id,
      kind: a.kind,
      uri: a.uri,
      workflow_run_id: a.workflowRunId,
      step_run_id: a.stepRunId,
      size: a.size,
      content_type: a.contentType,
      created_at: a.createdAt,
      metadata_json: JSON.stringify(a.metadata),
    });
  },
  get(id: string): Artifact | undefined {
    const r = db.prepare('SELECT * FROM artifacts WHERE id = ?').get(id) as ArtifactRow | null;
    return r ? rowToArtifact(r) : undefined;
  },
  byWorkflow(workflowRunId: string): Artifact[] {
    return (
      db
        .prepare('SELECT * FROM artifacts WHERE workflow_run_id = ? ORDER BY created_at ASC')
        .all(workflowRunId) as ArtifactRow[]
    ).map(rowToArtifact);
  },
  byKind(workflowRunId: string, kind: Artifact['kind']): Artifact[] {
    return (
      db
        .prepare(
          'SELECT * FROM artifacts WHERE workflow_run_id = ? AND kind = ? ORDER BY created_at ASC',
        )
        .all(workflowRunId, kind) as ArtifactRow[]
    ).map(rowToArtifact);
  },
};

// ---- knowledge_artifacts ---------------------------------------------------
// V2 P0-1: project-scoped, long-lived, editable, versioned. Sibling to
// `artifacts` (per-run, one-shot). See PRD ADR Q1 / Q2 / Q3 / Q4.

interface KnowledgeArtifactRow {
  id: string;
  kind: string;
  uri: string;
  project_id: string;
  size: number;
  content_type: string;
  status: string;
  version: number;
  entity_id: string | null;
  derived_from_artifact_id: string | null;
  subtype: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

function rowToKnowledgeArtifact(r: KnowledgeArtifactRow): KnowledgeArtifact {
  return {
    id: r.id,
    kind: r.kind as KnowledgeArtifactKind,
    uri: r.uri,
    projectId: r.project_id,
    size: r.size,
    contentType: r.content_type,
    status: r.status as KnowledgeArtifactStatus,
    version: r.version,
    entityId: r.entity_id,
    derivedFromArtifactId: r.derived_from_artifact_id,
    subtype: r.subtype,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    metadata: JSON.parse(r.metadata_json) as Record<string, unknown>,
  };
}

const knowledgeArtifacts = {
  insert(a: KnowledgeArtifact): void {
    insertRow('knowledge_artifacts', {
      id: a.id,
      kind: a.kind,
      uri: a.uri,
      project_id: a.projectId,
      size: a.size,
      content_type: a.contentType,
      status: a.status,
      version: a.version,
      entity_id: a.entityId,
      derived_from_artifact_id: a.derivedFromArtifactId,
      subtype: a.subtype,
      metadata_json: JSON.stringify(a.metadata),
      created_at: a.createdAt,
      updated_at: a.updatedAt,
    });
  },
  get(id: string): KnowledgeArtifact | undefined {
    const r = db
      .prepare('SELECT * FROM knowledge_artifacts WHERE id = ?')
      .get(id) as KnowledgeArtifactRow | null;
    return r ? rowToKnowledgeArtifact(r) : undefined;
  },
  byProject(projectId: string): KnowledgeArtifact[] {
    return (
      db
        .prepare(
          'SELECT * FROM knowledge_artifacts WHERE project_id = ? ORDER BY created_at ASC',
        )
        .all(projectId) as KnowledgeArtifactRow[]
    ).map(rowToKnowledgeArtifact);
  },
  byKind(projectId: string, kind: KnowledgeArtifactKind): KnowledgeArtifact[] {
    return (
      db
        .prepare(
          'SELECT * FROM knowledge_artifacts WHERE project_id = ? AND kind = ? ORDER BY created_at ASC',
        )
        .all(projectId, kind) as KnowledgeArtifactRow[]
    ).map(rowToKnowledgeArtifact);
  },
  byEntityId(projectId: string, entityId: string): KnowledgeArtifact[] {
    return (
      db
        .prepare(
          'SELECT * FROM knowledge_artifacts WHERE project_id = ? AND entity_id = ? ORDER BY version ASC',
        )
        .all(projectId, entityId) as KnowledgeArtifactRow[]
    ).map(rowToKnowledgeArtifact);
  },
  /** Highest-version row for an entity_id (the "current" record). */
  latestByEntityId(projectId: string, entityId: string): KnowledgeArtifact | undefined {
    const r = db
      .prepare(
        'SELECT * FROM knowledge_artifacts WHERE project_id = ? AND entity_id = ? ORDER BY version DESC LIMIT 1',
      )
      .get(projectId, entityId) as KnowledgeArtifactRow | null;
    return r ? rowToKnowledgeArtifact(r) : undefined;
  },
  updateStatus(id: string, status: KnowledgeArtifactStatus, updatedAt: string): void {
    db.prepare(
      'UPDATE knowledge_artifacts SET status = ?, updated_at = ? WHERE id = ?',
    ).run(status, updatedAt, id);
  },
};

// ---- requirements / designs entity tables (V2 P0-2) ----------------------
// Head-pointer model. Each row points at the *current* accepted version of
// a REQ-### / DSN-### in `knowledge_artifacts`; historical versions stay in
// `knowledge_artifacts` keyed by (project_id, entity_id). The API promote
// transaction (PR3) is the single canonical writer; `upsertHead` is the
// transaction's UPSERT step.
//
// Q3=3-B FK rules:
//   - `current_artifact_id` is bare TEXT (no DB FK) — referential
//     integrity is upheld by the promote transaction.
//   - `designs.ref_req` IS a strong FK to `requirements(id)` with
//     ON DELETE RESTRICT. The DB will reject INSERTs / DELETEs that
//     would violate REQ↔DSN traceability.
//
// See `.trellis/tasks/05-04-v2-entity-tables-bootstrap/prd.md` ADR Q1-Q5.

interface RequirementEntityRow {
  id: string;
  project_id: string;
  status: string;
  current_version: number;
  current_artifact_id: string;
  created_at: string;
  updated_at: string;
}

function rowToRequirementEntity(r: RequirementEntityRow): RequirementEntity {
  return {
    id: r.id,
    projectId: r.project_id,
    status: r.status as RequirementEntityStatus,
    currentVersion: r.current_version,
    currentArtifactId: r.current_artifact_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

interface RequirementEntityHeadInput {
  /** Entity_id, e.g. "REQ-001". */
  id: string;
  projectId: string;
  status: RequirementEntityStatus;
  currentVersion: number;
  currentArtifactId: string;
  /** ISO 8601 timestamp; used for both `created_at` (on first insert) and `updated_at`. */
  now: string;
}

const requirementEntities = {
  insert(e: RequirementEntity): void {
    insertRow('requirements', {
      id: e.id,
      project_id: e.projectId,
      status: e.status,
      current_version: e.currentVersion,
      current_artifact_id: e.currentArtifactId,
      created_at: e.createdAt,
      updated_at: e.updatedAt,
    });
  },
  get(projectId: string, id: string): RequirementEntity | undefined {
    const r = db
      .prepare('SELECT * FROM requirements WHERE project_id = ? AND id = ?')
      .get(projectId, id) as RequirementEntityRow | null;
    return r ? rowToRequirementEntity(r) : undefined;
  },
  byProject(projectId: string): RequirementEntity[] {
    return (
      db
        .prepare('SELECT * FROM requirements WHERE project_id = ? ORDER BY id ASC')
        .all(projectId) as RequirementEntityRow[]
    ).map(rowToRequirementEntity);
  },
  /**
   * INSERT new entity head OR UPDATE existing one. Conflict target is the
   * primary key `id`. On UPDATE: `created_at` is preserved; `updated_at`,
   * `status`, `current_version`, `current_artifact_id` move forward.
   * Returns the post-state row.
   */
  upsertHead(input: RequirementEntityHeadInput): RequirementEntity {
    db.prepare(
      `INSERT INTO requirements (id, project_id, status, current_version, current_artifact_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         current_version = excluded.current_version,
         current_artifact_id = excluded.current_artifact_id,
         updated_at = excluded.updated_at`,
    ).run(
      input.id,
      input.projectId,
      input.status,
      input.currentVersion,
      input.currentArtifactId,
      input.now,
      input.now,
    );
    // Re-read so callers see the canonical post-state (preserves created_at
    // on UPDATE-path).
    const r = db
      .prepare('SELECT * FROM requirements WHERE id = ?')
      .get(input.id) as RequirementEntityRow;
    return rowToRequirementEntity(r);
  },
  setStatus(id: string, status: RequirementEntityStatus, updatedAt: string): void {
    db.prepare('UPDATE requirements SET status = ?, updated_at = ? WHERE id = ?').run(
      status,
      updatedAt,
      id,
    );
  },
};

interface DesignEntityRow extends RequirementEntityRow {
  ref_req: string;
}

function rowToDesignEntity(r: DesignEntityRow): DesignEntity {
  return {
    id: r.id,
    projectId: r.project_id,
    status: r.status as RequirementEntityStatus,
    currentVersion: r.current_version,
    currentArtifactId: r.current_artifact_id,
    refReq: r.ref_req,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

interface DesignEntityHeadInput extends RequirementEntityHeadInput {
  /** ID of the requirement this design references; FK to `requirements.id`. */
  refReq: string;
}

const designEntities = {
  insert(e: DesignEntity): void {
    insertRow('designs', {
      id: e.id,
      project_id: e.projectId,
      status: e.status,
      current_version: e.currentVersion,
      current_artifact_id: e.currentArtifactId,
      ref_req: e.refReq,
      created_at: e.createdAt,
      updated_at: e.updatedAt,
    });
  },
  get(projectId: string, id: string): DesignEntity | undefined {
    const r = db
      .prepare('SELECT * FROM designs WHERE project_id = ? AND id = ?')
      .get(projectId, id) as DesignEntityRow | null;
    return r ? rowToDesignEntity(r) : undefined;
  },
  byProject(projectId: string): DesignEntity[] {
    return (
      db
        .prepare('SELECT * FROM designs WHERE project_id = ? ORDER BY id ASC')
        .all(projectId) as DesignEntityRow[]
    ).map(rowToDesignEntity);
  },
  byRefReq(projectId: string, refReq: string): DesignEntity[] {
    return (
      db
        .prepare(
          'SELECT * FROM designs WHERE project_id = ? AND ref_req = ? ORDER BY id ASC',
        )
        .all(projectId, refReq) as DesignEntityRow[]
    ).map(rowToDesignEntity);
  },
  /**
   * INSERT or UPDATE the design entity head. `ref_req` is preserved across
   * UPDATEs (it should not change for a given DSN-### — if a design moves
   * to reference a different REQ that is a new entity).
   */
  upsertHead(input: DesignEntityHeadInput): DesignEntity {
    db.prepare(
      `INSERT INTO designs (id, project_id, status, current_version, current_artifact_id, ref_req, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         current_version = excluded.current_version,
         current_artifact_id = excluded.current_artifact_id,
         updated_at = excluded.updated_at`,
    ).run(
      input.id,
      input.projectId,
      input.status,
      input.currentVersion,
      input.currentArtifactId,
      input.refReq,
      input.now,
      input.now,
    );
    const r = db
      .prepare('SELECT * FROM designs WHERE id = ?')
      .get(input.id) as DesignEntityRow;
    return rowToDesignEntity(r);
  },
  setStatus(id: string, status: RequirementEntityStatus, updatedAt: string): void {
    db.prepare('UPDATE designs SET status = ?, updated_at = ? WHERE id = ?').run(
      status,
      updatedAt,
      id,
    );
  },
};

// ---- build_runs ------------------------------------------------------------

interface BuildRunRow {
  id: string;
  workflow_run_id: string;
  step_run_id: string | null;
  language: string;
  build_tool: string;
  jdk_version: string;
  maven_command: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  command_run_ids_json: string;
  artifact_ids_json: string;
}

function rowToBuildRun(r: BuildRunRow): BuildRun {
  return {
    id: r.id,
    workflowRunId: r.workflow_run_id,
    stepRunId: r.step_run_id,
    language: r.language as BuildRun['language'],
    buildTool: r.build_tool as BuildRun['buildTool'],
    jdkVersion: r.jdk_version,
    mavenCommand: r.maven_command,
    status: r.status as BuildRun['status'],
    startedAt: r.started_at,
    completedAt: r.completed_at,
    commandRunIds: JSON.parse(r.command_run_ids_json),
    artifactIds: JSON.parse(r.artifact_ids_json),
  };
}

const buildRuns = {
  insert(b: BuildRun): void {
    insertRow('build_runs', {
      id: b.id,
      workflow_run_id: b.workflowRunId,
      step_run_id: b.stepRunId,
      language: b.language,
      build_tool: b.buildTool,
      jdk_version: b.jdkVersion,
      maven_command: b.mavenCommand,
      status: b.status,
      started_at: b.startedAt,
      completed_at: b.completedAt,
      command_run_ids_json: JSON.stringify(b.commandRunIds),
      artifact_ids_json: JSON.stringify(b.artifactIds),
    });
  },
  byWorkflow(workflowRunId: string): BuildRun[] {
    return (
      db
        .prepare('SELECT * FROM build_runs WHERE workflow_run_id = ? ORDER BY started_at ASC')
        .all(workflowRunId) as BuildRunRow[]
    ).map(rowToBuildRun);
  },
};

// ---- test_runs -------------------------------------------------------------

interface TestRunRow {
  id: string;
  build_run_id: string;
  framework: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  errors: number;
  report_artifact_ids_json: string;
}

function rowToTestRun(r: TestRunRow): TestRun {
  return {
    id: r.id,
    buildRunId: r.build_run_id,
    framework: r.framework as TestRun['framework'],
    total: r.total,
    passed: r.passed,
    failed: r.failed,
    skipped: r.skipped,
    errors: r.errors,
    reportArtifactIds: JSON.parse(r.report_artifact_ids_json),
  };
}

const testRuns = {
  insert(t: TestRun): void {
    insertRow('test_runs', {
      id: t.id,
      build_run_id: t.buildRunId,
      framework: t.framework,
      total: t.total,
      passed: t.passed,
      failed: t.failed,
      skipped: t.skipped,
      errors: t.errors,
      report_artifact_ids_json: JSON.stringify(t.reportArtifactIds),
    });
  },
  byBuild(buildRunId: string): TestRun[] {
    return (
      db
        .prepare('SELECT * FROM test_runs WHERE build_run_id = ?')
        .all(buildRunId) as TestRunRow[]
    ).map(rowToTestRun);
  },
};

// ---- agent tasks/results ---------------------------------------------------

interface AgentTaskRow {
  id: string;
  workflow_run_id: string;
  step_run_id: string | null;
  kind: string;
  backend: string;
  prompt: string;
  input_artifact_ids_json: string;
  created_at: string;
}

function rowToAgentTask(r: AgentTaskRow): AgentTask {
  return {
    id: r.id,
    workflowRunId: r.workflow_run_id,
    stepRunId: r.step_run_id,
    kind: r.kind as AgentTask['kind'],
    backend: r.backend as AgentTask['backend'],
    prompt: r.prompt,
    inputArtifactIds: JSON.parse(r.input_artifact_ids_json),
    createdAt: r.created_at,
  };
}

const agentTasks = {
  insert(t: AgentTask): void {
    insertRow('agent_tasks', {
      id: t.id,
      workflow_run_id: t.workflowRunId,
      step_run_id: t.stepRunId,
      kind: t.kind,
      backend: t.backend,
      prompt: t.prompt,
      input_artifact_ids_json: JSON.stringify(t.inputArtifactIds),
      created_at: t.createdAt,
    });
  },
  get(id: string): AgentTask | undefined {
    const r = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(id) as
      | AgentTaskRow
      | null;
    return r ? rowToAgentTask(r) : undefined;
  },
  byWorkflow(workflowRunId: string): AgentTask[] {
    return (
      db
        .prepare('SELECT * FROM agent_tasks WHERE workflow_run_id = ? ORDER BY created_at ASC')
        .all(workflowRunId) as AgentTaskRow[]
    ).map(rowToAgentTask);
  },
};

interface AgentResultRow {
  id: string;
  task_id: string;
  status: string;
  summary: string;
  output_artifact_ids_json: string;
  started_at: string;
  completed_at: string;
}

function rowToAgentResult(r: AgentResultRow): AgentResult {
  return {
    id: r.id,
    taskId: r.task_id,
    status: r.status as AgentResult['status'],
    summary: r.summary,
    outputArtifactIds: JSON.parse(r.output_artifact_ids_json),
    startedAt: r.started_at,
    completedAt: r.completed_at,
  };
}

const agentResults = {
  insert(r: AgentResult): void {
    insertRow('agent_results', {
      id: r.id,
      task_id: r.taskId,
      status: r.status,
      summary: r.summary,
      output_artifact_ids_json: JSON.stringify(r.outputArtifactIds),
      started_at: r.startedAt,
      completed_at: r.completedAt,
    });
  },
  byTask(taskId: string): AgentResult | undefined {
    const r = db.prepare('SELECT * FROM agent_results WHERE task_id = ?').get(taskId) as
      | AgentResultRow
      | null;
    return r ? rowToAgentResult(r) : undefined;
  },
  byWorkflow(workflowRunId: string): AgentResult[] {
    return (
      db
        .prepare(
          `SELECT ar.*
             FROM agent_results ar
             JOIN agent_tasks at ON at.id = ar.task_id
            WHERE at.workflow_run_id = ?
            ORDER BY ar.started_at ASC`,
        )
        .all(workflowRunId) as AgentResultRow[]
    ).map(rowToAgentResult);
  },
};

// ---- agent stream events ---------------------------------------------------

interface AgentEventRow {
  id: string;
  workflow_run_id: string;
  step_run_id: string | null;
  agent_kind: string;
  sequence: number;
  type: string;
  payload_json: string;
  text: string | null;
  ts: string;
}

function rowToAgentEvent(r: AgentEventRow): AgentStreamEvent {
  return {
    id: r.id,
    workflowRunId: r.workflow_run_id,
    stepRunId: r.step_run_id,
    agentKind: r.agent_kind as AgentStreamEvent['agentKind'],
    sequence: r.sequence,
    type: r.type as AgentStreamEvent['type'],
    payload: JSON.parse(r.payload_json) as Record<string, unknown>,
    text: r.text,
    ts: r.ts,
  };
}

const agentEvents = {
  insert(e: AgentStreamEvent): void {
    insertRow('agent_events', {
      id: e.id,
      workflow_run_id: e.workflowRunId,
      step_run_id: e.stepRunId,
      agent_kind: e.agentKind,
      sequence: e.sequence,
      type: e.type,
      payload_json: JSON.stringify(e.payload),
      text: e.text,
      ts: e.ts,
    });
  },
  byWorkflow(workflowRunId: string, sinceSeq = -1): AgentStreamEvent[] {
    return (
      db
        .prepare(
          'SELECT * FROM agent_events WHERE workflow_run_id = ? AND sequence > ? ORDER BY sequence ASC',
        )
        .all(workflowRunId, sinceSeq) as AgentEventRow[]
    ).map(rowToAgentEvent);
  },
  nextSequence(workflowRunId: string): number {
    const r = db
      .prepare('SELECT COALESCE(MAX(sequence), -1) AS m FROM agent_events WHERE workflow_run_id = ?')
      .get(workflowRunId) as { m: number };
    return r.m + 1;
  },
};

// ---- workflow actions + approvals + audit_log + runners -------------------

export interface WorkflowAction {
  id: string;
  workflowRunId: string;
  kind: string;
  targetId: string | null;
  action: string;
  actor: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

interface WorkflowActionRow {
  id: string;
  workflow_run_id: string;
  kind: string;
  target_id: string | null;
  action: string;
  actor: string;
  payload_json: string;
  created_at: string;
}

function rowToWorkflowAction(r: WorkflowActionRow): WorkflowAction {
  return {
    id: r.id,
    workflowRunId: r.workflow_run_id,
    kind: r.kind,
    targetId: r.target_id,
    action: r.action,
    actor: r.actor,
    payload: JSON.parse(r.payload_json) as Record<string, unknown>,
    createdAt: r.created_at,
  };
}

const workflowActions = {
  insert(action: WorkflowAction): void {
    insertRow('workflow_actions', {
      id: action.id,
      workflow_run_id: action.workflowRunId,
      kind: action.kind,
      target_id: action.targetId,
      action: action.action,
      actor: action.actor,
      payload_json: JSON.stringify(action.payload),
      created_at: action.createdAt,
    });
  },
  byWorkflow(workflowRunId: string): WorkflowAction[] {
    return (
      db
        .prepare('SELECT * FROM workflow_actions WHERE workflow_run_id = ? ORDER BY created_at ASC')
        .all(workflowRunId) as WorkflowActionRow[]
    ).map(rowToWorkflowAction);
  },
};

export interface Approval {
  id: string;
  workflowRunId: string;
  gateRunId: string | null;
  gateId: string;
  decision: 'approved' | 'rejected';
  actor: string;
  comment: string | null;
  decidedAt: string;
}

interface ApprovalRow {
  id: string;
  workflow_run_id: string;
  gate_run_id: string | null;
  gate_id: string;
  decision: string;
  actor: string;
  comment: string | null;
  decided_at: string;
}

function rowToApproval(r: ApprovalRow): Approval {
  return {
    id: r.id,
    workflowRunId: r.workflow_run_id,
    gateRunId: r.gate_run_id,
    gateId: r.gate_id,
    decision: r.decision as Approval['decision'],
    actor: r.actor,
    comment: r.comment,
    decidedAt: r.decided_at,
  };
}

const approvals = {
  insert(a: Approval): void {
    insertRow('approvals', {
      id: a.id,
      workflow_run_id: a.workflowRunId,
      gate_run_id: a.gateRunId,
      gate_id: a.gateId,
      decision: a.decision,
      actor: a.actor,
      comment: a.comment,
      decided_at: a.decidedAt,
    });
  },
  byWorkflow(workflowRunId: string): Approval[] {
    return (
      db
        .prepare('SELECT * FROM approvals WHERE workflow_run_id = ? ORDER BY decided_at ASC')
        .all(workflowRunId) as ApprovalRow[]
    ).map(rowToApproval);
  },
  latestForGate(workflowRunId: string, gateId: string): Approval | undefined {
    const r = db
      .prepare(
        'SELECT * FROM approvals WHERE workflow_run_id = ? AND gate_id = ? ORDER BY decided_at DESC LIMIT 1',
      )
      .get(workflowRunId, gateId) as ApprovalRow | null;
    return r ? rowToApproval(r) : undefined;
  },
};

export interface AuditEntry {
  id: string;
  workflowRunId: string | null;
  kind: string;
  payload: Record<string, unknown>;
  at: string;
}

interface AuditRow {
  id: string;
  workflow_run_id: string | null;
  kind: string;
  payload_json: string;
  at: string;
}

function rowToAudit(r: AuditRow): AuditEntry {
  return {
    id: r.id,
    workflowRunId: r.workflow_run_id,
    kind: r.kind,
    payload: JSON.parse(r.payload_json),
    at: r.at,
  };
}

const auditLog = {
  insert(e: AuditEntry): void {
    insertRow('audit_log', {
      id: e.id,
      workflow_run_id: e.workflowRunId,
      kind: e.kind,
      payload_json: JSON.stringify(e.payload),
      at: e.at,
    });
  },
  byWorkflow(workflowRunId: string): AuditEntry[] {
    return (
      db
        .prepare('SELECT * FROM audit_log WHERE workflow_run_id = ? ORDER BY at ASC')
        .all(workflowRunId) as AuditRow[]
    ).map(rowToAudit);
  },
};

export interface RunnerRecord {
  id: string;
  host: string;
  version: string;
  jdkVersion: string | null;
  mavenVersion: string | null;
  gitVersion: string | null;
  lastSeenAt: string;
  status: 'online' | 'stale' | 'offline';
}

interface RunnerRow {
  id: string;
  host: string;
  version: string;
  jdk_version: string | null;
  maven_version: string | null;
  git_version: string | null;
  last_seen_at: string;
  status: string;
}

function rowToRunner(r: RunnerRow): RunnerRecord {
  return {
    id: r.id,
    host: r.host,
    version: r.version,
    jdkVersion: r.jdk_version,
    mavenVersion: r.maven_version,
    gitVersion: r.git_version,
    lastSeenAt: r.last_seen_at,
    status: r.status as RunnerRecord['status'],
  };
}

const runners = {
  upsert(r: RunnerRecord): void {
    upsertRow('runners', {
      id: r.id,
      host: r.host,
      version: r.version,
      jdk_version: r.jdkVersion,
      maven_version: r.mavenVersion,
      git_version: r.gitVersion,
      last_seen_at: r.lastSeenAt,
      status: r.status,
    });
  },
  list(): RunnerRecord[] {
    return (
      db.prepare('SELECT * FROM runners ORDER BY last_seen_at DESC').all() as RunnerRow[]
    ).map(rowToRunner);
  },
};

// ---- coordinator_decisions + workflow_request_messages (Phase B) ----------

const coordinatorDecisions = {
  insert(d: CoordinatorDecision): void {
    insertRow('coordinator_decisions', {
      id: d.id,
      workflow_request_id: d.workflowRequestId,
      workflow_run_id: d.workflowRunId,
      source: d.source,
      decision_json: JSON.stringify(d.decision),
      confidence: d.confidence,
      rules_fired_json: JSON.stringify(d.rulesFired),
      decided_at: d.decidedAt,
    });
  },
  latestForRequest(workflowRequestId: string): CoordinatorDecision | null {
    const row = db
      .prepare(
        `SELECT * FROM coordinator_decisions
         WHERE workflow_request_id = ?
         ORDER BY decided_at DESC LIMIT 1`,
      )
      .get(workflowRequestId) as
      | {
          id: string;
          workflow_request_id: string;
          workflow_run_id: string | null;
          source: string;
          decision_json: string;
          confidence: number;
          rules_fired_json: string;
          decided_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      workflowRequestId: row.workflow_request_id,
      workflowRunId: row.workflow_run_id,
      source: row.source as CoordinatorDecision['source'],
      decision: JSON.parse(row.decision_json) as CoordinatorDecision['decision'],
      confidence: row.confidence,
      rulesFired: JSON.parse(row.rules_fired_json) as string[],
      decidedAt: row.decided_at,
    };
  },
};

const requestMessages = {
  insert(m: RequestMessage): void {
    insertRow('workflow_request_messages', {
      id: m.id,
      workflow_request_id: m.workflowRequestId,
      role: m.role,
      content: m.content,
      coordinator_decision_id: m.coordinatorDecisionId,
      created_at: m.createdAt,
    });
  },
  listForRequest(workflowRequestId: string): RequestMessage[] {
    const rows = db
      .prepare(
        `SELECT * FROM workflow_request_messages
         WHERE workflow_request_id = ?
         ORDER BY created_at ASC`,
      )
      .all(workflowRequestId) as Array<{
      id: string;
      workflow_request_id: string;
      role: string;
      content: string;
      coordinator_decision_id: string | null;
      created_at: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      workflowRequestId: r.workflow_request_id,
      role: r.role as RequestMessage['role'],
      content: r.content,
      coordinatorDecisionId: r.coordinator_decision_id,
      createdAt: r.created_at,
    }));
  },
};

// ---- config_overrides + config_audit (PR1: runtime config layer) ----------

export interface ConfigOverride {
  key: string;
  scope: string;
  valueJson: string;
  updatedAt: string;
  updatedBy: string | null;
}

interface ConfigOverrideRow {
  key: string;
  scope: string;
  value_json: string;
  updated_at: string;
  updated_by: string | null;
}

function rowToConfigOverride(r: ConfigOverrideRow): ConfigOverride {
  return {
    key: r.key,
    scope: r.scope,
    valueJson: r.value_json,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
  };
}

const configOverrides = {
  get(key: string): ConfigOverride | undefined {
    const r = db.prepare('SELECT * FROM config_overrides WHERE key = ?').get(key) as
      | ConfigOverrideRow
      | null;
    return r ? rowToConfigOverride(r) : undefined;
  },
  getAll(): Record<string, ConfigOverride> {
    const rows = db.prepare('SELECT * FROM config_overrides ORDER BY key ASC').all() as ConfigOverrideRow[];
    const out: Record<string, ConfigOverride> = {};
    for (const r of rows) out[r.key] = rowToConfigOverride(r);
    return out;
  },
  set(o: ConfigOverride): void {
    upsertRow('config_overrides', {
      key: o.key,
      scope: o.scope,
      value_json: o.valueJson,
      updated_at: o.updatedAt,
      updated_by: o.updatedBy,
    });
  },
  delete(key: string): void {
    db.prepare('DELETE FROM config_overrides WHERE key = ?').run(key);
  },
};

export interface ConfigAuditEntry {
  id: string;
  key: string;
  oldValueJson: string | null;
  newValueJson: string | null;
  changedAt: string;
  changedBy: string | null;
}

interface ConfigAuditRow {
  id: string;
  key: string;
  old_value_json: string | null;
  new_value_json: string | null;
  changed_at: string;
  changed_by: string | null;
}

function rowToConfigAudit(r: ConfigAuditRow): ConfigAuditEntry {
  return {
    id: r.id,
    key: r.key,
    oldValueJson: r.old_value_json,
    newValueJson: r.new_value_json,
    changedAt: r.changed_at,
    changedBy: r.changed_by,
  };
}

/**
 * Append a config_audit entry to a UTC-day-rotated jsonl mirror under
 * `.omc/audit/`. SQLite remains the single source of truth — this mirror
 * exists purely for grep-friendly post-hoc forensics. Failures are
 * console.warn'd and swallowed (fail-open per PRD §D5 + PR4 §D-PR4.1).
 */
function mirrorConfigAuditEntry(entry: ConfigAuditEntry): void {
  try {
    const day = entry.changedAt.slice(0, 10); // 'YYYY-MM-DD' from ISO UTC string
    const dir = path.resolve(process.cwd(), '.omc', 'audit');
    const file = path.join(dir, `config-${day}.jsonl`);
    mkdirSync(dir, { recursive: true });
    appendFileSync(file, `${JSON.stringify(entry)}\n`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[config-audit] mirror failed:', msg);
  }
}

const configAudit = {
  insert(e: ConfigAuditEntry): void {
    insertRow('config_audit', {
      id: e.id,
      key: e.key,
      old_value_json: e.oldValueJson,
      new_value_json: e.newValueJson,
      changed_at: e.changedAt,
      changed_by: e.changedBy,
    });
    mirrorConfigAuditEntry(e);
  },
  listByKey(key: string, limit = 20): ConfigAuditEntry[] {
    return (
      db
        .prepare(
          'SELECT * FROM config_audit WHERE key = ? ORDER BY changed_at DESC LIMIT ?',
        )
        .all(key, limit) as ConfigAuditRow[]
    ).map(rowToConfigAudit);
  },
  listAll(limit = 20): ConfigAuditEntry[] {
    return (
      db
        .prepare('SELECT * FROM config_audit ORDER BY changed_at DESC LIMIT ?')
        .all(limit) as ConfigAuditRow[]
    ).map(rowToConfigAudit);
  },
};

// ---- public surface --------------------------------------------------------

export const store = {
	  projects,
	  workflowRequests,
	  workflowRuns,
  stepRuns,
  commandRuns,
  gateRuns,
  artifacts,
  knowledgeArtifacts,
  requirementEntities,
  designEntities,
  buildRuns,
  testRuns,
  agentTasks,
  agentResults,
  agentEvents,
  workflowActions,
  approvals,
  auditLog,
  runners,
  coordinatorDecisions,
  requestMessages,
  configOverrides,
  configAudit,
  // Back-compat helpers used by older routes:
  projectByName: (name: string) => projects.findByName(name),
  workflowRunsByProject: (projectId: string) => workflowRuns.byProject(projectId),
  commandRunsByWorkflow: (workflowRunId: string) => commandRuns.byWorkflow(workflowRunId),
};
