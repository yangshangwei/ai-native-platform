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
  AgentSession,
  AgentStreamEvent,
  CoordinatorDecision,
  RequestMessage,
  ToolInvocation,
  HandoffRecord,
  StepCheckpoint,
  GraphDefinition,
  GraphRun,
  GraphNodeRun,
  GraphEvent,
} from '@ainp/shared';
import {
  errorMessage,
  isProjectAgentBackendKind,
  normalizeMemoryLifecycleMetadata,
  nowIso,
} from '@ainp/shared';
import { appendFileSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { db } from './db';

/**
 * SQLite-backed store. Keeps a Map-like surface for the entities that the
 * earlier in-memory store exposed (projects, workflowRuns, stepRuns,
 * commandRuns) so existing callers in workflow-engine.ts and routes don't
 * change. Newer entities expose explicit repo methods.
 */

// TODO: drop the ignored first `set(_id, ...)` parameter (legacy Map-store
// signature) once the ~57 call sites across src + tests migrate to a
// single-argument `set(value)`.
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

/**
 * Table binding: couples a table name with its Row→Domain mapper and the
 * Domain→Row column mapping, and exposes the handful of query shapes every
 * repo below is assembled from. This removes the per-entity
 * prepare→get/all→map read-path boilerplate; the field mappings themselves
 * stay explicit per entity (they carry real schema information).
 */
function defineTable<Row, T>(def: {
  table: string;
  fromRow: (row: Row) => T;
  toRow: (value: T) => Record<string, unknown>;
}) {
  const { table, fromRow, toRow } = def;
  const one = (sql: string, ...params: unknown[]): T | undefined => {
    const r = db.prepare(sql).get(...(params as never[])) as Row | null;
    return r ? fromRow(r) : undefined;
  };
  const all = (sql: string, ...params: unknown[]): T[] =>
    (db.prepare(sql).all(...(params as never[])) as Row[]).map(fromRow);
  return {
    insert: (value: T): void => insertRow(table, toRow(value)),
    upsert: (value: T): void => upsertRow(table, toRow(value)),
    byId: (id: string): T | undefined => one(`SELECT * FROM ${table} WHERE id = ?`, id),
    hasId: (id: string): boolean =>
      Boolean(db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id)),
    count: (): number => countRows(table),
    one,
    all,
  };
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
  build_compile_command: string | null;
  build_test_command: string | null;
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
    buildCompileCommand: r.build_compile_command ?? null,
    buildTestCommand: r.build_test_command ?? null,
    defaultBranch: r.default_branch,
    sourceBranches: parseStringArrayJson(r.source_branches_json),
    registeredAt: r.registered_at,
  };
}

const projectsTable = defineTable<ProjectRow, Project>({
  table: 'projects',
  fromRow: rowToProject,
  toRow: (p) => ({
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
    build_compile_command: p.buildCompileCommand ?? null,
    build_test_command: p.buildTestCommand ?? null,
    default_branch: p.defaultBranch,
    source_branches_json: p.sourceBranches ? JSON.stringify(p.sourceBranches) : null,
    registered_at: p.registeredAt,
  }),
});

const projects: MapLike<Project> & {
  findByName(name: string): Project | undefined;
  delete(id: string): void;
} = {
  set: (_id, p) => projectsTable.upsert(p),
  get: (id) => projectsTable.byId(id),
  has: (id) => projectsTable.hasId(id),
  values: () => projectsTable.all('SELECT * FROM projects'),
  get size() {
    return projectsTable.count();
  },
  findByName: (name) => projectsTable.one('SELECT * FROM projects WHERE name = ?', name),
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
  /** V2 W2-1: NOT NULL DEFAULT 'feature.standard' — see db.ts migration. */
  flow_id: string;
  /** V2 W2-4: nullable — null means "start from flow's first stage". */
  start_stage: string | null;
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
    flowId: r.flow_id as WorkflowRun['flowId'],
    startStage: (r.start_stage ?? null) as WorkflowRun['startStage'],
    configSnapshotId: r.config_snapshot_id,
    sourceBranch: r.source_branch ?? '',
    branch: r.branch,
    workspacePath: r.workspace_path,
    title: r.title,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const workflowRunsTable = defineTable<WorkflowRunRow, WorkflowRun>({
  table: 'workflow_runs',
  fromRow: rowToWorkflowRun,
  toRow: (run) => ({
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
    flow_id: run.flowId,
    start_stage: run.startStage,
    created_at: run.createdAt,
    updated_at: run.updatedAt,
  }),
});

const workflowRuns: MapLike<WorkflowRun> & {
  byProject(projectId: string): WorkflowRun[];
} = {
  set: (_id, run) => workflowRunsTable.upsert(run),
  get: (id) => workflowRunsTable.byId(id),
  has: (id) => workflowRunsTable.hasId(id),
  values: () => workflowRunsTable.all('SELECT * FROM workflow_runs ORDER BY created_at ASC'),
  get size() {
    return workflowRunsTable.count();
  },
  byProject: (projectId) =>
    workflowRunsTable.all(
      'SELECT * FROM workflow_runs WHERE project_id = ? ORDER BY created_at ASC',
      projectId,
    ),
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
  flow_id: string | null;
  start_stage: string | null;
  kind: string | null;
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
    flowId: r.flow_id as WorkflowRequest['flowId'],
    startStage: r.start_stage as WorkflowRequest['startStage'],
    kind: r.kind as WorkflowRequest['kind'],
  };
}

const workflowRequestsTable = defineTable<WorkflowRequestRow, WorkflowRequest>({
  table: 'workflow_requests',
  fromRow: rowToWorkflowRequest,
  toRow: (req) => ({
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
    flow_id: req.flowId,
    start_stage: req.startStage,
    kind: req.kind,
  }),
});

const workflowRequests = {
  set(_id: string, req: WorkflowRequest): void {
    workflowRequestsTable.upsert(req);
  },
  get: (id: string): WorkflowRequest | undefined => workflowRequestsTable.byId(id),
  values: (): WorkflowRequest[] =>
    workflowRequestsTable.all('SELECT * FROM workflow_requests ORDER BY created_at ASC'),
  byStatus: (status: WorkflowRequest['status']): WorkflowRequest[] =>
    workflowRequestsTable.all(
      'SELECT * FROM workflow_requests WHERE status = ? ORDER BY created_at ASC',
      status,
    ),
  pending(): WorkflowRequest[] {
    return this.byStatus('pending');
  },
  updateStatus(id: string, status: WorkflowRequest['status']): WorkflowRequest | undefined {
    const current = this.get(id);
    if (!current) return undefined;
    const next: WorkflowRequest = { ...current, status, updatedAt: nowIso() };
    this.set(id, next);
    return next;
  },
  // -- Atomic state transitions (TOCTOU fix, task 06-12) ---------------------
  // Each folds the old "read, check status, write back" two-step into a single
  // UPDATE with the status precondition in the WHERE clause; `changes` decides
  // success. SQLite's single-writer lock then guarantees that concurrent
  // callers cannot both pass the check. These are persistence primitives only:
  // decisions and audit stay in workflow-engine (the sole state writer).
  /**
   * Claim a pending request: UPDATE ... WHERE id = ? AND status = 'pending'.
   * Returns the post-update entity, or null when the row is missing or not
   * pending (exactly one of N concurrent claimers wins).
   */
  claimIfPending(params: {
    id: string;
    runnerId: string;
    updatedAt: string;
  }): WorkflowRequest | null {
    const res = db
      .prepare(
        `UPDATE workflow_requests
            SET status = 'claimed', claimed_by = ?, updated_at = ?
          WHERE id = ? AND status = 'pending'`,
      )
      .run(params.runnerId, params.updatedAt, params.id);
    if (res.changes === 0) return null;
    return workflowRequestsTable.byId(params.id) ?? null;
  },
  /**
   * Attach the workflow run id to a claimed request (status stays 'claimed'):
   * UPDATE ... WHERE id = ? AND status = 'claimed'. Returns null when the row
   * is missing or not claimed.
   */
  markRunStartedIfClaimed(params: {
    id: string;
    workflowRunId: string;
    updatedAt: string;
  }): WorkflowRequest | null {
    const res = db
      .prepare(
        `UPDATE workflow_requests
            SET workflow_run_id = ?, updated_at = ?
          WHERE id = ? AND status = 'claimed'`,
      )
      .run(params.workflowRunId, params.updatedAt, params.id);
    if (res.changes === 0) return null;
    return workflowRequestsTable.byId(params.id) ?? null;
  },
  /**
   * Terminal transition: UPDATE ... WHERE id = ? (existence is the only
   * precondition, matching the engine's historical behaviour). A null
   * workflowRunId keeps the existing value (COALESCE); error is always
   * overwritten. Returns null when the row is missing.
   */
  complete(params: {
    id: string;
    status: 'completed' | 'failed';
    workflowRunId: string | null;
    error: string | null;
    updatedAt: string;
  }): WorkflowRequest | null {
    const res = db
      .prepare(
        `UPDATE workflow_requests
            SET status = ?,
                workflow_run_id = COALESCE(?, workflow_run_id),
                error = ?,
                updated_at = ?
          WHERE id = ?`,
      )
      .run(params.status, params.workflowRunId, params.error, params.updatedAt, params.id);
    if (res.changes === 0) return null;
    return workflowRequestsTable.byId(params.id) ?? null;
  },
  get size(): number {
    return workflowRequestsTable.count();
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

const stepRunsTable = defineTable<StepRunRow, StepRun>({
  table: 'step_runs',
  fromRow: rowToStepRun,
  toRow: (s) => ({
    id: s.id,
    workflow_run_id: s.workflowRunId,
    stage: s.stage,
    name: s.name,
    status: s.status,
    started_at: s.startedAt,
    completed_at: s.completedAt,
  }),
});

const stepRuns: MapLike<StepRun> & {
  byWorkflow(workflowRunId: string): StepRun[];
} = {
  set: (_id, s) => stepRunsTable.upsert(s),
  get: (id) => stepRunsTable.byId(id),
  has: (id) => stepRunsTable.hasId(id),
  values: () => stepRunsTable.all('SELECT * FROM step_runs'),
  get size() {
    return stepRunsTable.count();
  },
  byWorkflow: (workflowRunId) =>
    stepRunsTable.all(
      'SELECT * FROM step_runs WHERE workflow_run_id = ? ORDER BY COALESCE(started_at, "") ASC',
      workflowRunId,
    ),
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
  stdout_sha256: string | null;
  stderr_sha256: string | null;
  combined_sha256: string | null;
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
    stdoutSha256: r.stdout_sha256,
    stderrSha256: r.stderr_sha256,
    combinedSha256: r.combined_sha256,
    timedOut: unbool(r.timed_out),
    truncated: unbool(r.truncated),
  };
}

const commandRunsTable = defineTable<CommandRunRow, CommandRun>({
  table: 'command_runs',
  fromRow: rowToCommandRun,
  toRow: (c) => ({
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
    stdout_sha256: c.stdoutSha256 ?? null,
    stderr_sha256: c.stderrSha256 ?? null,
    combined_sha256: c.combinedSha256 ?? null,
    timed_out: bool(c.timedOut),
    truncated: bool(c.truncated),
  }),
});

const commandRuns: MapLike<CommandRun> & {
  byWorkflow(workflowRunId: string): CommandRun[];
  byStep(stepRunId: string): CommandRun[];
} = {
  set: (_id, c) => commandRunsTable.upsert(c),
  get: (id) => commandRunsTable.byId(id),
  has: (id) => commandRunsTable.hasId(id),
  values: () => commandRunsTable.all('SELECT * FROM command_runs'),
  get size() {
    return commandRunsTable.count();
  },
  byWorkflow: (workflowRunId) =>
    commandRunsTable.all(
      'SELECT * FROM command_runs WHERE workflow_run_id = ? ORDER BY started_at ASC',
      workflowRunId,
    ),
  byStep: (stepRunId) =>
    commandRunsTable.all(
      'SELECT * FROM command_runs WHERE step_run_id = ? ORDER BY started_at ASC',
      stepRunId,
    ),
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

const gateRunsTable = defineTable<GateRunRow, GateRun>({
  table: 'gate_runs',
  fromRow: rowToGateRun,
  toRow: (g) => ({
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
  }),
});

const gateRuns = {
  insert: (g: GateRun): void => gateRunsTable.insert(g),
  get: (id: string): GateRun | undefined => gateRunsTable.byId(id),
  byWorkflow: (workflowRunId: string): GateRun[] =>
    gateRunsTable.all(
      'SELECT * FROM gate_runs WHERE workflow_run_id = ? ORDER BY decided_at ASC',
      workflowRunId,
    ),
  latestForGate: (workflowRunId: string, gateId: GateRun['gateId']): GateRun | undefined =>
    gateRunsTable.one(
      'SELECT * FROM gate_runs WHERE workflow_run_id = ? AND gate_id = ? ORDER BY decided_at DESC LIMIT 1',
      workflowRunId,
      gateId,
    ),
  get size(): number {
    return gateRunsTable.count();
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
  sha256: string | null;
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
    sha256: r.sha256,
    createdAt: r.created_at,
    metadata: JSON.parse(r.metadata_json) as Record<string, unknown>,
  };
}

const artifactsTable = defineTable<ArtifactRow, Artifact>({
  table: 'artifacts',
  fromRow: rowToArtifact,
  toRow: (a) => ({
    id: a.id,
    kind: a.kind,
    uri: a.uri,
    workflow_run_id: a.workflowRunId,
    step_run_id: a.stepRunId,
    size: a.size,
    content_type: a.contentType,
    sha256: a.sha256 ?? null,
    created_at: a.createdAt,
    metadata_json: JSON.stringify(a.metadata),
  }),
});

const artifacts = {
  insert: (a: Artifact): void => artifactsTable.insert(a),
  get: (id: string): Artifact | undefined => artifactsTable.byId(id),
  byWorkflow: (workflowRunId: string): Artifact[] =>
    artifactsTable.all(
      'SELECT * FROM artifacts WHERE workflow_run_id = ? ORDER BY created_at ASC',
      workflowRunId,
    ),
  byKind: (workflowRunId: string, kind: Artifact['kind']): Artifact[] =>
    artifactsTable.all(
      'SELECT * FROM artifacts WHERE workflow_run_id = ? AND kind = ? ORDER BY created_at ASC',
      workflowRunId,
      kind,
    ),
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
  const kind = r.kind as KnowledgeArtifactKind;
  const status = r.status as KnowledgeArtifactStatus;
  const metadata = JSON.parse(r.metadata_json) as Record<string, unknown>;
  return {
    id: r.id,
    kind,
    uri: r.uri,
    projectId: r.project_id,
    size: r.size,
    contentType: r.content_type,
    status,
    version: r.version,
    entityId: r.entity_id,
    derivedFromArtifactId: r.derived_from_artifact_id,
    subtype: r.subtype,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    metadata: {
      ...metadata,
      ...normalizeMemoryLifecycleMetadata(metadata, { knowledgeKind: kind, status }),
    },
  };
}

const knowledgeArtifactsTable = defineTable<KnowledgeArtifactRow, KnowledgeArtifact>({
  table: 'knowledge_artifacts',
  fromRow: rowToKnowledgeArtifact,
  toRow: (a) => ({
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
  }),
});

const knowledgeArtifacts = {
  insert: (a: KnowledgeArtifact): void => knowledgeArtifactsTable.insert(a),
  get: (id: string): KnowledgeArtifact | undefined => knowledgeArtifactsTable.byId(id),
  byProject: (projectId: string): KnowledgeArtifact[] =>
    knowledgeArtifactsTable.all(
      'SELECT * FROM knowledge_artifacts WHERE project_id = ? ORDER BY created_at ASC',
      projectId,
    ),
  byKind: (projectId: string, kind: KnowledgeArtifactKind): KnowledgeArtifact[] =>
    knowledgeArtifactsTable.all(
      'SELECT * FROM knowledge_artifacts WHERE project_id = ? AND kind = ? ORDER BY created_at ASC',
      projectId,
      kind,
    ),
  byEntityId: (projectId: string, entityId: string): KnowledgeArtifact[] =>
    knowledgeArtifactsTable.all(
      'SELECT * FROM knowledge_artifacts WHERE project_id = ? AND entity_id = ? ORDER BY version ASC',
      projectId,
      entityId,
    ),
  /** Highest-version row for an entity_id (the "current" record). */
  latestByEntityId: (projectId: string, entityId: string): KnowledgeArtifact | undefined =>
    knowledgeArtifactsTable.one(
      'SELECT * FROM knowledge_artifacts WHERE project_id = ? AND entity_id = ? ORDER BY version DESC LIMIT 1',
      projectId,
      entityId,
    ),
  updateStatus(
    id: string,
    status: KnowledgeArtifactStatus,
    updatedAt: string,
    metadata?: Record<string, unknown>,
    currentStatus?: KnowledgeArtifactStatus,
  ): boolean {
    // R1.5: Add WHERE status = ? precondition for state transition guard
    const whereClause = currentStatus !== undefined ? 'WHERE id = ? AND status = ?' : 'WHERE id = ?';
    const params = currentStatus !== undefined ? [id, currentStatus] : [id];

    if (metadata === undefined) {
      const stmt = db.prepare(
        `UPDATE knowledge_artifacts SET status = ?, updated_at = ? ${whereClause}`,
      );
      const result = stmt.run(status, updatedAt, ...params);
      return result.changes > 0;
    }
    const stmt = db.prepare(
      `UPDATE knowledge_artifacts SET status = ?, metadata_json = ?, updated_at = ? ${whereClause}`,
    );
    const result = stmt.run(status, JSON.stringify(metadata), updatedAt, ...params);
    return result.changes > 0;
  },
  updateMetadata(id: string, metadata: Record<string, unknown>, updatedAt: string): void {
    db.prepare(
      'UPDATE knowledge_artifacts SET metadata_json = ?, updated_at = ? WHERE id = ?',
    ).run(JSON.stringify(metadata), updatedAt, id);
  },
};

// ---- tool_invocations ------------------------------------------------------

interface ToolInvocationRow {
  id: string;
  workflow_run_id: string;
  step_run_id: string | null;
  tool_id: string;
  tool_name: string;
  schema_version: string;
  status: string;
  side_effect: string;
  permission_tier: string;
  permission_decision: string;
  arguments_digest: string;
  result_refs_json: string;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  error: string | null;
  metadata_json: string;
}

function rowToToolInvocation(r: ToolInvocationRow): ToolInvocation {
  return {
    id: r.id,
    workflowRunId: r.workflow_run_id,
    stepRunId: r.step_run_id,
    toolId: r.tool_id as ToolInvocation['toolId'],
    toolName: r.tool_name,
    schemaVersion: r.schema_version,
    status: r.status as ToolInvocation['status'],
    sideEffect: r.side_effect as ToolInvocation['sideEffect'],
    permissionTier: r.permission_tier as ToolInvocation['permissionTier'],
    permissionDecision: r.permission_decision as ToolInvocation['permissionDecision'],
    argumentsDigest: r.arguments_digest,
    resultRefs: JSON.parse(r.result_refs_json),
    startedAt: r.started_at,
    completedAt: r.completed_at,
    durationMs: r.duration_ms,
    error: r.error,
    metadata: JSON.parse(r.metadata_json) as Record<string, unknown>,
  };
}

const toolInvocationsTable = defineTable<ToolInvocationRow, ToolInvocation>({
  table: 'tool_invocations',
  fromRow: rowToToolInvocation,
  toRow: (t) => ({
    id: t.id,
    workflow_run_id: t.workflowRunId,
    step_run_id: t.stepRunId,
    tool_id: t.toolId,
    tool_name: t.toolName,
    schema_version: t.schemaVersion,
    status: t.status,
    side_effect: t.sideEffect,
    permission_tier: t.permissionTier,
    permission_decision: t.permissionDecision,
    arguments_digest: t.argumentsDigest,
    result_refs_json: JSON.stringify(t.resultRefs),
    started_at: t.startedAt,
    completed_at: t.completedAt,
    duration_ms: t.durationMs,
    error: t.error,
    metadata_json: JSON.stringify(t.metadata),
  }),
});

const toolInvocations = {
  insert: (t: ToolInvocation): void => toolInvocationsTable.insert(t),
  get: (id: string): ToolInvocation | undefined => toolInvocationsTable.byId(id),
  byWorkflow: (workflowRunId: string): ToolInvocation[] =>
    toolInvocationsTable.all(
      'SELECT * FROM tool_invocations WHERE workflow_run_id = ? ORDER BY started_at ASC',
      workflowRunId,
    ),
  get size(): number {
    return toolInvocationsTable.count();
  },
};

// ---- handoffs --------------------------------------------------------------

interface HandoffRow {
  id: string;
  workflow_run_id: string;
  step_run_id: string | null;
  parent_session_id: string | null;
  child_session_id: string | null;
  from_role: string;
  to_role: string;
  reason: string;
  input_artifact_ids_json: string;
  expected_output_json: string;
  stop_condition: string;
  status: string;
  adoption_decision: string;
  output_artifact_ids_json: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  metadata_json: string;
}

function rowToHandoff(r: HandoffRow): HandoffRecord {
  return {
    id: r.id,
    workflowRunId: r.workflow_run_id,
    stepRunId: r.step_run_id,
    parentSessionId: r.parent_session_id,
    childSessionId: r.child_session_id,
    fromRole: r.from_role as HandoffRecord['fromRole'],
    toRole: r.to_role as HandoffRecord['toRole'],
    reason: r.reason,
    inputArtifactIds: JSON.parse(r.input_artifact_ids_json),
    expectedOutput: JSON.parse(r.expected_output_json),
    stopCondition: r.stop_condition,
    status: r.status as HandoffRecord['status'],
    adoptionDecision: r.adoption_decision as HandoffRecord['adoptionDecision'],
    outputArtifactIds: JSON.parse(r.output_artifact_ids_json),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at,
    metadata: JSON.parse(r.metadata_json) as Record<string, unknown>,
  };
}

const handoffsTable = defineTable<HandoffRow, HandoffRecord>({
  table: 'handoffs',
  fromRow: rowToHandoff,
  toRow: (h) => ({
    id: h.id,
    workflow_run_id: h.workflowRunId,
    step_run_id: h.stepRunId,
    parent_session_id: h.parentSessionId,
    child_session_id: h.childSessionId,
    from_role: h.fromRole,
    to_role: h.toRole,
    reason: h.reason,
    input_artifact_ids_json: JSON.stringify(h.inputArtifactIds),
    expected_output_json: JSON.stringify(h.expectedOutput),
    stop_condition: h.stopCondition,
    status: h.status,
    adoption_decision: h.adoptionDecision,
    output_artifact_ids_json: JSON.stringify(h.outputArtifactIds),
    created_at: h.createdAt,
    updated_at: h.updatedAt,
    completed_at: h.completedAt,
    metadata_json: JSON.stringify(h.metadata),
  }),
});

const handoffs = {
  insert: (h: HandoffRecord): void => handoffsTable.insert(h),
  upsert: (h: HandoffRecord): void => handoffsTable.upsert(h),
  get: (id: string): HandoffRecord | undefined => handoffsTable.byId(id),
  byWorkflow: (workflowRunId: string): HandoffRecord[] =>
    handoffsTable.all(
      'SELECT * FROM handoffs WHERE workflow_run_id = ? ORDER BY created_at ASC',
      workflowRunId,
    ),
  get size(): number {
    return handoffsTable.count();
  },
};

// ---- step_checkpoints ------------------------------------------------------

interface StepCheckpointRow {
  id: string;
  workflow_run_id: string;
  step_run_id: string;
  stage: string;
  status: string;
  input_artifact_ids_json: string;
  output_artifact_ids_json: string;
  context_pack_id: string | null;
  agent_session_ids_json: string;
  tool_invocation_ids_json: string;
  gate_run_ids_json: string;
  retry_index: number;
  resume_cursor: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
  metadata_json: string;
}

function rowToStepCheckpoint(r: StepCheckpointRow): StepCheckpoint {
  return {
    id: r.id,
    workflowRunId: r.workflow_run_id,
    stepRunId: r.step_run_id,
    stage: r.stage as StepCheckpoint['stage'],
    status: r.status as StepCheckpoint['status'],
    inputArtifactIds: JSON.parse(r.input_artifact_ids_json),
    outputArtifactIds: JSON.parse(r.output_artifact_ids_json),
    contextPackId: r.context_pack_id,
    agentSessionIds: JSON.parse(r.agent_session_ids_json),
    toolInvocationIds: JSON.parse(r.tool_invocation_ids_json),
    gateRunIds: JSON.parse(r.gate_run_ids_json),
    retryIndex: r.retry_index,
    resumeCursor: r.resume_cursor,
    failureReason: r.failure_reason,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    metadata: JSON.parse(r.metadata_json) as Record<string, unknown>,
  };
}

const stepCheckpointsTable = defineTable<StepCheckpointRow, StepCheckpoint>({
  table: 'step_checkpoints',
  fromRow: rowToStepCheckpoint,
  toRow: (s) => ({
    id: s.id,
    workflow_run_id: s.workflowRunId,
    step_run_id: s.stepRunId,
    stage: s.stage,
    status: s.status,
    input_artifact_ids_json: JSON.stringify(s.inputArtifactIds),
    output_artifact_ids_json: JSON.stringify(s.outputArtifactIds),
    context_pack_id: s.contextPackId,
    agent_session_ids_json: JSON.stringify(s.agentSessionIds),
    tool_invocation_ids_json: JSON.stringify(s.toolInvocationIds),
    gate_run_ids_json: JSON.stringify(s.gateRunIds),
    retry_index: s.retryIndex,
    resume_cursor: s.resumeCursor,
    failure_reason: s.failureReason,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
    metadata_json: JSON.stringify(s.metadata),
  }),
});

const stepCheckpoints = {
  upsert: (s: StepCheckpoint): void => stepCheckpointsTable.upsert(s),
  get: (id: string): StepCheckpoint | undefined => stepCheckpointsTable.byId(id),
  byStep: (stepRunId: string): StepCheckpoint | undefined =>
    stepCheckpointsTable.one(
      'SELECT * FROM step_checkpoints WHERE step_run_id = ?',
      stepRunId,
    ),
  byWorkflow: (workflowRunId: string): StepCheckpoint[] =>
    stepCheckpointsTable.all(
      'SELECT * FROM step_checkpoints WHERE workflow_run_id = ? ORDER BY created_at ASC',
      workflowRunId,
    ),
  get size(): number {
    return stepCheckpointsTable.count();
  },
};

// ---- graph runtime ledger --------------------------------------------------

interface GraphDefinitionRow {
  id: string;
  schema_version: string;
  version: string;
  source_flow_id: string | null;
  description: string;
  nodes_json: string;
  edges_json: string;
  entry_node_ids_json: string;
  created_at: string;
  metadata_json: string;
}

function rowToGraphDefinition(r: GraphDefinitionRow): GraphDefinition {
  return {
    id: r.id,
    schemaVersion: r.schema_version as GraphDefinition['schemaVersion'],
    version: r.version,
    sourceFlowId: r.source_flow_id as GraphDefinition['sourceFlowId'],
    description: r.description,
    nodes: JSON.parse(r.nodes_json),
    edges: JSON.parse(r.edges_json),
    entryNodeIds: JSON.parse(r.entry_node_ids_json),
    createdAt: r.created_at,
    metadata: JSON.parse(r.metadata_json) as Record<string, unknown>,
  };
}

const graphDefinitionsTable = defineTable<GraphDefinitionRow, GraphDefinition>({
  table: 'graph_definitions',
  fromRow: rowToGraphDefinition,
  toRow: (g) => ({
    id: g.id,
    schema_version: g.schemaVersion,
    version: g.version,
    source_flow_id: g.sourceFlowId,
    description: g.description,
    nodes_json: JSON.stringify(g.nodes),
    edges_json: JSON.stringify(g.edges),
    entry_node_ids_json: JSON.stringify(g.entryNodeIds),
    created_at: g.createdAt,
    metadata_json: JSON.stringify(g.metadata),
  }),
});

const graphDefinitions = {
  upsert: (g: GraphDefinition): void => graphDefinitionsTable.upsert(g),
  get: (id: string): GraphDefinition | undefined => graphDefinitionsTable.byId(id),
  bySourceFlow: (sourceFlowId: string): GraphDefinition[] =>
    graphDefinitionsTable.all(
      'SELECT * FROM graph_definitions WHERE source_flow_id = ? ORDER BY created_at DESC',
      sourceFlowId,
    ),
  get size(): number {
    return graphDefinitionsTable.count();
  },
};

interface GraphRunRow {
  id: string;
  workflow_run_id: string;
  graph_definition_id: string;
  graph_version: string;
  status: string;
  active_node_ids_json: string;
  interrupted_reason: string | null;
  created_at: string;
  updated_at: string;
  metadata_json: string;
}

function rowToGraphRun(r: GraphRunRow): GraphRun {
  return {
    id: r.id,
    workflowRunId: r.workflow_run_id,
    graphDefinitionId: r.graph_definition_id,
    graphVersion: r.graph_version,
    status: r.status as GraphRun['status'],
    activeNodeIds: JSON.parse(r.active_node_ids_json),
    interruptedReason: r.interrupted_reason,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    metadata: JSON.parse(r.metadata_json) as Record<string, unknown>,
  };
}

const graphRunsTable = defineTable<GraphRunRow, GraphRun>({
  table: 'graph_runs',
  fromRow: rowToGraphRun,
  toRow: (g) => ({
    id: g.id,
    workflow_run_id: g.workflowRunId,
    graph_definition_id: g.graphDefinitionId,
    graph_version: g.graphVersion,
    status: g.status,
    active_node_ids_json: JSON.stringify(g.activeNodeIds),
    interrupted_reason: g.interruptedReason,
    created_at: g.createdAt,
    updated_at: g.updatedAt,
    metadata_json: JSON.stringify(g.metadata),
  }),
});

const graphRuns = {
  upsert: (g: GraphRun): void => graphRunsTable.upsert(g),
  get: (id: string): GraphRun | undefined => graphRunsTable.byId(id),
  byWorkflow: (workflowRunId: string): GraphRun[] =>
    graphRunsTable.all(
      'SELECT * FROM graph_runs WHERE workflow_run_id = ? ORDER BY created_at DESC',
      workflowRunId,
    ),
  currentByWorkflow: (workflowRunId: string): GraphRun | null =>
    graphRunsTable.one(
      'SELECT * FROM graph_runs WHERE workflow_run_id = ? ORDER BY created_at DESC LIMIT 1',
      workflowRunId,
    ) ?? null,
  get size(): number {
    return graphRunsTable.count();
  },
};

interface GraphNodeRunRow {
  id: string;
  graph_run_id: string;
  workflow_run_id: string;
  node_id: string;
  attempt: number;
  status: string;
  step_run_id: string | null;
  step_checkpoint_id: string | null;
  resume_cursor: string | null;
  idempotency_key: string;
  dependency_state_json: string;
  started_at: string | null;
  completed_at: string | null;
  metadata_json: string;
}

function rowToGraphNodeRun(r: GraphNodeRunRow): GraphNodeRun {
  return {
    id: r.id,
    graphRunId: r.graph_run_id,
    workflowRunId: r.workflow_run_id,
    nodeId: r.node_id,
    attempt: r.attempt,
    status: r.status as GraphNodeRun['status'],
    stepRunId: r.step_run_id,
    stepCheckpointId: r.step_checkpoint_id,
    resumeCursor: r.resume_cursor,
    idempotencyKey: r.idempotency_key,
    dependencyState: JSON.parse(r.dependency_state_json) as GraphNodeRun['dependencyState'],
    startedAt: r.started_at,
    completedAt: r.completed_at,
    metadata: JSON.parse(r.metadata_json) as Record<string, unknown>,
  };
}

const graphNodeRunsTable = defineTable<GraphNodeRunRow, GraphNodeRun>({
  table: 'graph_node_runs',
  fromRow: rowToGraphNodeRun,
  toRow: (g) => ({
    id: g.id,
    graph_run_id: g.graphRunId,
    workflow_run_id: g.workflowRunId,
    node_id: g.nodeId,
    attempt: g.attempt,
    status: g.status,
    step_run_id: g.stepRunId,
    step_checkpoint_id: g.stepCheckpointId,
    resume_cursor: g.resumeCursor,
    idempotency_key: g.idempotencyKey,
    dependency_state_json: JSON.stringify(g.dependencyState),
    started_at: g.startedAt,
    completed_at: g.completedAt,
    metadata_json: JSON.stringify(g.metadata),
  }),
});

function validateGraphNodeRunLinks(g: GraphNodeRun): void {
  const graphRun = graphRunsTable.byId(g.graphRunId);
  if (!graphRun) throw new Error('graphRunId does not exist');
  if (graphRun.workflowRunId !== g.workflowRunId) {
    throw new Error('graphRunId does not belong to workflowRunId');
  }
  const step = g.stepRunId ? stepRunsTable.byId(g.stepRunId) : undefined;
  if (g.stepRunId && !step) throw new Error('stepRunId does not exist');
  if (step && step.workflowRunId !== g.workflowRunId) {
    throw new Error('stepRunId does not belong to workflowRunId');
  }
  const checkpoint = g.stepCheckpointId
    ? stepCheckpointsTable.byId(g.stepCheckpointId)
    : undefined;
  if (g.stepCheckpointId && !checkpoint) throw new Error('stepCheckpointId does not exist');
  if (checkpoint && checkpoint.workflowRunId !== g.workflowRunId) {
    throw new Error('stepCheckpointId does not belong to workflowRunId');
  }
  if (checkpoint && step && checkpoint.stepRunId !== step.id) {
    throw new Error('stepCheckpointId does not belong to stepRunId');
  }
}

const graphNodeRuns = {
  upsert(g: GraphNodeRun): void {
    validateGraphNodeRunLinks(g);
    graphNodeRunsTable.upsert(g);
  },
  get: (id: string): GraphNodeRun | undefined => graphNodeRunsTable.byId(id),
  byGraphRun: (graphRunId: string): GraphNodeRun[] =>
    graphNodeRunsTable.all(
      'SELECT * FROM graph_node_runs WHERE graph_run_id = ? ORDER BY attempt ASC, id ASC',
      graphRunId,
    ),
  byWorkflow: (workflowRunId: string): GraphNodeRun[] =>
    graphNodeRunsTable.all(
      'SELECT * FROM graph_node_runs WHERE workflow_run_id = ? ORDER BY node_id ASC, attempt ASC',
      workflowRunId,
    ),
  byNode: (graphRunId: string, nodeId: string): GraphNodeRun[] =>
    graphNodeRunsTable.all(
      'SELECT * FROM graph_node_runs WHERE graph_run_id = ? AND node_id = ? ORDER BY attempt ASC',
      graphRunId,
      nodeId,
    ),
  get size(): number {
    return graphNodeRunsTable.count();
  },
};

interface GraphEventRow {
  id: string;
  graph_run_id: string;
  workflow_run_id: string;
  node_id: string | null;
  type: string;
  created_at: string;
  payload_json: string;
}

function rowToGraphEvent(r: GraphEventRow): GraphEvent {
  return {
    id: r.id,
    graphRunId: r.graph_run_id,
    workflowRunId: r.workflow_run_id,
    nodeId: r.node_id,
    type: r.type as GraphEvent['type'],
    createdAt: r.created_at,
    payload: JSON.parse(r.payload_json) as Record<string, unknown>,
  };
}

const graphEventsTable = defineTable<GraphEventRow, GraphEvent>({
  table: 'graph_events',
  fromRow: rowToGraphEvent,
  toRow: (e) => ({
    id: e.id,
    graph_run_id: e.graphRunId,
    workflow_run_id: e.workflowRunId,
    node_id: e.nodeId,
    type: e.type,
    created_at: e.createdAt,
    payload_json: JSON.stringify(e.payload),
  }),
});

function validateGraphEventLinks(e: GraphEvent): void {
  const graphRun = graphRunsTable.byId(e.graphRunId);
  if (!graphRun) throw new Error('graphRunId does not exist');
  if (graphRun.workflowRunId !== e.workflowRunId) {
    throw new Error('graphRunId does not belong to workflowRunId');
  }
}

const graphEvents = {
  insert(e: GraphEvent): void {
    validateGraphEventLinks(e);
    graphEventsTable.insert(e);
  },
  get: (id: string): GraphEvent | undefined => graphEventsTable.byId(id),
  byGraphRun: (graphRunId: string): GraphEvent[] =>
    graphEventsTable.all(
      'SELECT * FROM graph_events WHERE graph_run_id = ? ORDER BY created_at ASC',
      graphRunId,
    ),
  byWorkflow: (workflowRunId: string): GraphEvent[] =>
    graphEventsTable.all(
      'SELECT * FROM graph_events WHERE workflow_run_id = ? ORDER BY created_at ASC',
      workflowRunId,
    ),
  get size(): number {
    return graphEventsTable.count();
  },
};

const emptyGraphRuntime = {
  graphDefinition: null,
  graphRun: null,
  nodeRuns: [],
  events: [],
};

const graphRuntime = {
  byWorkflow(workflowRunId: string): {
    graphDefinition: GraphDefinition | null;
    graphRun: GraphRun | null;
    nodeRuns: GraphNodeRun[];
    events: GraphEvent[];
  } {
    const graphRun = graphRuns.currentByWorkflow(workflowRunId);
    if (!graphRun) return emptyGraphRuntime;
    return {
      graphDefinition: graphDefinitions.get(graphRun.graphDefinitionId) ?? null,
      graphRun,
      nodeRuns: graphNodeRuns.byGraphRun(graphRun.id),
      events: graphEvents.byGraphRun(graphRun.id),
    };
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

const requirementEntitiesTable = defineTable<RequirementEntityRow, RequirementEntity>({
  table: 'requirements',
  fromRow: rowToRequirementEntity,
  toRow: (e) => ({
    id: e.id,
    project_id: e.projectId,
    status: e.status,
    current_version: e.currentVersion,
    current_artifact_id: e.currentArtifactId,
    created_at: e.createdAt,
    updated_at: e.updatedAt,
  }),
});

const requirementEntities = {
  insert: (e: RequirementEntity): void => requirementEntitiesTable.insert(e),
  get: (projectId: string, id: string): RequirementEntity | undefined =>
    requirementEntitiesTable.one(
      'SELECT * FROM requirements WHERE project_id = ? AND id = ?',
      projectId,
      id,
    ),
  byProject: (projectId: string): RequirementEntity[] =>
    requirementEntitiesTable.all(
      'SELECT * FROM requirements WHERE project_id = ? ORDER BY id ASC',
      projectId,
    ),
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
       ON CONFLICT(project_id, id) DO UPDATE SET
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
      .prepare('SELECT * FROM requirements WHERE project_id = ? AND id = ?')
      .get(input.projectId, input.id) as RequirementEntityRow;
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

const designEntitiesTable = defineTable<DesignEntityRow, DesignEntity>({
  table: 'designs',
  fromRow: rowToDesignEntity,
  toRow: (e) => ({
    id: e.id,
    project_id: e.projectId,
    status: e.status,
    current_version: e.currentVersion,
    current_artifact_id: e.currentArtifactId,
    ref_req: e.refReq,
    created_at: e.createdAt,
    updated_at: e.updatedAt,
  }),
});

const designEntities = {
  insert: (e: DesignEntity): void => designEntitiesTable.insert(e),
  get: (projectId: string, id: string): DesignEntity | undefined =>
    designEntitiesTable.one(
      'SELECT * FROM designs WHERE project_id = ? AND id = ?',
      projectId,
      id,
    ),
  byProject: (projectId: string): DesignEntity[] =>
    designEntitiesTable.all(
      'SELECT * FROM designs WHERE project_id = ? ORDER BY id ASC',
      projectId,
    ),
  byRefReq: (projectId: string, refReq: string): DesignEntity[] =>
    designEntitiesTable.all(
      'SELECT * FROM designs WHERE project_id = ? AND ref_req = ? ORDER BY id ASC',
      projectId,
      refReq,
    ),
  /**
   * INSERT or UPDATE the design entity head. `ref_req` is preserved across
   * UPDATEs (it should not change for a given DSN-### — if a design moves
   * to reference a different REQ that is a new entity).
   */
  upsertHead(input: DesignEntityHeadInput): DesignEntity {
    db.prepare(
      `INSERT INTO designs (id, project_id, status, current_version, current_artifact_id, ref_req, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, id) DO UPDATE SET
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
      .prepare('SELECT * FROM designs WHERE project_id = ? AND id = ?')
      .get(input.projectId, input.id) as DesignEntityRow;
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

const buildRunsTable = defineTable<BuildRunRow, BuildRun>({
  table: 'build_runs',
  fromRow: rowToBuildRun,
  toRow: (b) => ({
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
  }),
});

const buildRuns = {
  insert: (b: BuildRun): void => buildRunsTable.insert(b),
  byWorkflow: (workflowRunId: string): BuildRun[] =>
    buildRunsTable.all(
      'SELECT * FROM build_runs WHERE workflow_run_id = ? ORDER BY started_at ASC',
      workflowRunId,
    ),
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

const testRunsTable = defineTable<TestRunRow, TestRun>({
  table: 'test_runs',
  fromRow: rowToTestRun,
  toRow: (t) => ({
    id: t.id,
    build_run_id: t.buildRunId,
    framework: t.framework,
    total: t.total,
    passed: t.passed,
    failed: t.failed,
    skipped: t.skipped,
    errors: t.errors,
    report_artifact_ids_json: JSON.stringify(t.reportArtifactIds),
  }),
});

const testRuns = {
  insert: (t: TestRun): void => testRunsTable.insert(t),
  byBuild: (buildRunId: string): TestRun[] =>
    testRunsTable.all('SELECT * FROM test_runs WHERE build_run_id = ?', buildRunId),
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

const agentTasksTable = defineTable<AgentTaskRow, AgentTask>({
  table: 'agent_tasks',
  fromRow: rowToAgentTask,
  toRow: (t) => ({
    id: t.id,
    workflow_run_id: t.workflowRunId,
    step_run_id: t.stepRunId,
    kind: t.kind,
    backend: t.backend,
    prompt: t.prompt,
    input_artifact_ids_json: JSON.stringify(t.inputArtifactIds),
    created_at: t.createdAt,
  }),
});

const agentTasks = {
  insert: (t: AgentTask): void => agentTasksTable.insert(t),
  get: (id: string): AgentTask | undefined => agentTasksTable.byId(id),
  byWorkflow: (workflowRunId: string): AgentTask[] =>
    agentTasksTable.all(
      'SELECT * FROM agent_tasks WHERE workflow_run_id = ? ORDER BY created_at ASC',
      workflowRunId,
    ),
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

const agentResultsTable = defineTable<AgentResultRow, AgentResult>({
  table: 'agent_results',
  fromRow: rowToAgentResult,
  toRow: (r) => ({
    id: r.id,
    task_id: r.taskId,
    status: r.status,
    summary: r.summary,
    output_artifact_ids_json: JSON.stringify(r.outputArtifactIds),
    started_at: r.startedAt,
    completed_at: r.completedAt,
  }),
});

const agentResults = {
  insert: (r: AgentResult): void => agentResultsTable.insert(r),
  get: (id: string): AgentResult | undefined => agentResultsTable.byId(id),
  byTask: (taskId: string): AgentResult | undefined =>
    agentResultsTable.one('SELECT * FROM agent_results WHERE task_id = ?', taskId),
  byWorkflow: (workflowRunId: string): AgentResult[] =>
    agentResultsTable.all(
      `SELECT ar.*
         FROM agent_results ar
         JOIN agent_tasks at ON at.id = ar.task_id
        WHERE at.workflow_run_id = ?
        ORDER BY ar.started_at ASC`,
      workflowRunId,
    ),
};

interface AgentSessionRow {
  id: string;
  workflow_run_id: string;
  step_run_id: string | null;
  agent_task_id: string;
  agent_result_id: string | null;
  backend: string;
  stage: string;
  skill_id: string;
  skill_version: string;
  context_pack_id: string;
  parent_session_id: string | null;
  retry_index: number;
  status: string;
  started_at: string;
  completed_at: string | null;
  metadata_json: string;
}

function rowToAgentSession(r: AgentSessionRow): AgentSession {
  return {
    id: r.id,
    workflowRunId: r.workflow_run_id,
    stepRunId: r.step_run_id,
    agentTaskId: r.agent_task_id,
    agentResultId: r.agent_result_id,
    backend: r.backend as AgentSession['backend'],
    stage: r.stage as AgentSession['stage'],
    skillId: r.skill_id,
    skillVersion: r.skill_version,
    contextPackId: r.context_pack_id,
    parentSessionId: r.parent_session_id,
    retryIndex: r.retry_index,
    status: r.status as AgentSession['status'],
    startedAt: r.started_at,
    completedAt: r.completed_at,
    metadata: JSON.parse(r.metadata_json) as Record<string, unknown>,
  };
}

const agentSessionsTable = defineTable<AgentSessionRow, AgentSession>({
  table: 'agent_sessions',
  fromRow: rowToAgentSession,
  toRow: (s) => ({
    id: s.id,
    workflow_run_id: s.workflowRunId,
    step_run_id: s.stepRunId,
    agent_task_id: s.agentTaskId,
    agent_result_id: s.agentResultId,
    backend: s.backend,
    stage: s.stage,
    skill_id: s.skillId,
    skill_version: s.skillVersion,
    context_pack_id: s.contextPackId,
    parent_session_id: s.parentSessionId,
    retry_index: s.retryIndex,
    status: s.status,
    started_at: s.startedAt,
    completed_at: s.completedAt,
    metadata_json: JSON.stringify(s.metadata),
  }),
});

const agentSessions = {
  insert: (s: AgentSession): void => agentSessionsTable.insert(s),
  upsert: (s: AgentSession): void => agentSessionsTable.upsert(s),
  get: (id: string): AgentSession | undefined => agentSessionsTable.byId(id),
  byWorkflow: (workflowRunId: string): AgentSession[] =>
    agentSessionsTable.all(
      'SELECT * FROM agent_sessions WHERE workflow_run_id = ? ORDER BY started_at ASC',
      workflowRunId,
    ),
};

// ---- agent stream events ---------------------------------------------------

interface AgentEventRow {
  id: string;
  workflow_run_id: string | null;
  workflow_request_id: string | null;
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
    workflowRequestId: r.workflow_request_id,
    stepRunId: r.step_run_id,
    agentKind: r.agent_kind as AgentStreamEvent['agentKind'],
    sequence: r.sequence,
    type: r.type as AgentStreamEvent['type'],
    payload: JSON.parse(r.payload_json) as Record<string, unknown>,
    text: r.text,
    ts: r.ts,
  };
}

const agentEventsTable = defineTable<AgentEventRow, AgentStreamEvent>({
  table: 'agent_events',
  fromRow: rowToAgentEvent,
  toRow: (e) => ({
    id: e.id,
    workflow_run_id: e.workflowRunId,
    workflow_request_id: e.workflowRequestId ?? null,
    step_run_id: e.stepRunId,
    agent_kind: e.agentKind,
    sequence: e.sequence,
    type: e.type,
    payload_json: JSON.stringify(e.payload),
    text: e.text,
    ts: e.ts,
  }),
});

const agentEvents = {
  insert: (e: AgentStreamEvent): void => agentEventsTable.insert(e),
  byWorkflow: (workflowRunId: string, sinceSeq = -1): AgentStreamEvent[] =>
    agentEventsTable.all(
      'SELECT * FROM agent_events WHERE workflow_run_id = ? AND sequence > ? ORDER BY sequence ASC',
      workflowRunId,
      sinceSeq,
    ),
  byRequest: (workflowRequestId: string, sinceSeq = -1): AgentStreamEvent[] =>
    agentEventsTable.all(
      'SELECT * FROM agent_events WHERE workflow_request_id = ? AND sequence > ? ORDER BY sequence ASC',
      workflowRequestId,
      sinceSeq,
    ),
  /**
   * Next monotonic sequence for a stream channel. The `run` and `request`
   * channels have independent sequences (a request's events do NOT advance
   * the sequence of any later workflow run derived from that request).
   */
  nextSequence(channel: { kind: 'run' | 'request'; id: string }): number {
    const column = channel.kind === 'run' ? 'workflow_run_id' : 'workflow_request_id';
    const r = db
      .prepare(
        `SELECT COALESCE(MAX(sequence), -1) AS m FROM agent_events WHERE ${column} = ?`,
      )
      .get(channel.id) as { m: number };
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

const workflowActionsTable = defineTable<WorkflowActionRow, WorkflowAction>({
  table: 'workflow_actions',
  fromRow: rowToWorkflowAction,
  toRow: (action) => ({
    id: action.id,
    workflow_run_id: action.workflowRunId,
    kind: action.kind,
    target_id: action.targetId,
    action: action.action,
    actor: action.actor,
    payload_json: JSON.stringify(action.payload),
    created_at: action.createdAt,
  }),
});

const workflowActions = {
  insert: (action: WorkflowAction): void => workflowActionsTable.insert(action),
  byWorkflow: (workflowRunId: string): WorkflowAction[] =>
    workflowActionsTable.all(
      'SELECT * FROM workflow_actions WHERE workflow_run_id = ? ORDER BY created_at ASC',
      workflowRunId,
    ),
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

const approvalsTable = defineTable<ApprovalRow, Approval>({
  table: 'approvals',
  fromRow: rowToApproval,
  toRow: (a) => ({
    id: a.id,
    workflow_run_id: a.workflowRunId,
    gate_run_id: a.gateRunId,
    gate_id: a.gateId,
    decision: a.decision,
    actor: a.actor,
    comment: a.comment,
    decided_at: a.decidedAt,
  }),
});

const approvals = {
  insert: (a: Approval): void => approvalsTable.insert(a),
  byWorkflow: (workflowRunId: string): Approval[] =>
    approvalsTable.all(
      'SELECT * FROM approvals WHERE workflow_run_id = ? ORDER BY decided_at ASC',
      workflowRunId,
    ),
  latestForGate: (workflowRunId: string, gateId: string): Approval | undefined =>
    approvalsTable.one(
      'SELECT * FROM approvals WHERE workflow_run_id = ? AND gate_id = ? ORDER BY decided_at DESC LIMIT 1',
      workflowRunId,
      gateId,
    ),
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

const auditLogTable = defineTable<AuditRow, AuditEntry>({
  table: 'audit_log',
  fromRow: rowToAudit,
  toRow: (e) => ({
    id: e.id,
    workflow_run_id: e.workflowRunId,
    kind: e.kind,
    payload_json: JSON.stringify(e.payload),
    at: e.at,
  }),
});

const auditLog = {
  insert: (e: AuditEntry): void => auditLogTable.insert(e),
  byWorkflow: (workflowRunId: string): AuditEntry[] =>
    auditLogTable.all(
      'SELECT * FROM audit_log WHERE workflow_run_id = ? ORDER BY at ASC',
      workflowRunId,
    ),
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

const runnersTable = defineTable<RunnerRow, RunnerRecord>({
  table: 'runners',
  fromRow: rowToRunner,
  toRow: (r) => ({
    id: r.id,
    host: r.host,
    version: r.version,
    jdk_version: r.jdkVersion,
    maven_version: r.mavenVersion,
    git_version: r.gitVersion,
    last_seen_at: r.lastSeenAt,
    status: r.status,
  }),
});

const runners = {
  upsert: (r: RunnerRecord): void => runnersTable.upsert(r),
  list: (): RunnerRecord[] =>
    runnersTable.all('SELECT * FROM runners ORDER BY last_seen_at DESC'),
};

// ---- coordinator_decisions + workflow_request_messages (Phase B) ----------

interface CoordinatorDecisionRow {
  id: string;
  workflow_request_id: string;
  workflow_run_id: string | null;
  source: string;
  decision_json: string;
  confidence: number;
  rules_fired_json: string;
  decided_at: string;
}

function rowToCoordinatorDecision(r: CoordinatorDecisionRow): CoordinatorDecision {
  return {
    id: r.id,
    workflowRequestId: r.workflow_request_id,
    workflowRunId: r.workflow_run_id,
    source: r.source as CoordinatorDecision['source'],
    decision: JSON.parse(r.decision_json) as CoordinatorDecision['decision'],
    confidence: r.confidence,
    rulesFired: JSON.parse(r.rules_fired_json) as string[],
    decidedAt: r.decided_at,
  };
}

const coordinatorDecisionsTable = defineTable<CoordinatorDecisionRow, CoordinatorDecision>({
  table: 'coordinator_decisions',
  fromRow: rowToCoordinatorDecision,
  toRow: (d) => ({
    id: d.id,
    workflow_request_id: d.workflowRequestId,
    workflow_run_id: d.workflowRunId,
    source: d.source,
    decision_json: JSON.stringify(d.decision),
    confidence: d.confidence,
    rules_fired_json: JSON.stringify(d.rulesFired),
    decided_at: d.decidedAt,
  }),
});

const coordinatorDecisions = {
  insert: (d: CoordinatorDecision): void => coordinatorDecisionsTable.insert(d),
  latestForRequest: (workflowRequestId: string): CoordinatorDecision | null =>
    coordinatorDecisionsTable.one(
      `SELECT * FROM coordinator_decisions
       WHERE workflow_request_id = ?
       ORDER BY decided_at DESC LIMIT 1`,
      workflowRequestId,
    ) ?? null,
};

interface RequestMessageRow {
  id: string;
  workflow_request_id: string;
  role: string;
  content: string;
  coordinator_decision_id: string | null;
  created_at: string;
}

function rowToRequestMessage(r: RequestMessageRow): RequestMessage {
  return {
    id: r.id,
    workflowRequestId: r.workflow_request_id,
    role: r.role as RequestMessage['role'],
    content: r.content,
    coordinatorDecisionId: r.coordinator_decision_id,
    createdAt: r.created_at,
  };
}

const requestMessagesTable = defineTable<RequestMessageRow, RequestMessage>({
  table: 'workflow_request_messages',
  fromRow: rowToRequestMessage,
  toRow: (m) => ({
    id: m.id,
    workflow_request_id: m.workflowRequestId,
    role: m.role,
    content: m.content,
    coordinator_decision_id: m.coordinatorDecisionId,
    created_at: m.createdAt,
  }),
});

const requestMessages = {
  insert: (m: RequestMessage): void => requestMessagesTable.insert(m),
  listForRequest: (workflowRequestId: string): RequestMessage[] =>
    requestMessagesTable.all(
      `SELECT * FROM workflow_request_messages
       WHERE workflow_request_id = ?
       ORDER BY created_at ASC`,
      workflowRequestId,
    ),
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

const configOverridesTable = defineTable<ConfigOverrideRow, ConfigOverride>({
  table: 'config_overrides',
  fromRow: rowToConfigOverride,
  toRow: (o) => ({
    key: o.key,
    scope: o.scope,
    value_json: o.valueJson,
    updated_at: o.updatedAt,
    updated_by: o.updatedBy,
  }),
});

const configOverrides = {
  get: (key: string): ConfigOverride | undefined =>
    configOverridesTable.one('SELECT * FROM config_overrides WHERE key = ?', key),
  getAll(): Record<string, ConfigOverride> {
    const out: Record<string, ConfigOverride> = {};
    for (const o of configOverridesTable.all('SELECT * FROM config_overrides ORDER BY key ASC')) {
      out[o.key] = o;
    }
    return out;
  },
  set: (o: ConfigOverride): void => configOverridesTable.upsert(o),
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
    const msg = errorMessage(err);
    console.warn('[config-audit] mirror failed:', msg);
  }
}

const configAuditTable = defineTable<ConfigAuditRow, ConfigAuditEntry>({
  table: 'config_audit',
  fromRow: rowToConfigAudit,
  toRow: (e) => ({
    id: e.id,
    key: e.key,
    old_value_json: e.oldValueJson,
    new_value_json: e.newValueJson,
    changed_at: e.changedAt,
    changed_by: e.changedBy,
  }),
});

const configAudit = {
  insert(e: ConfigAuditEntry): void {
    configAuditTable.insert(e);
    mirrorConfigAuditEntry(e);
  },
  listByKey: (key: string, limit = 20): ConfigAuditEntry[] =>
    configAuditTable.all(
      'SELECT * FROM config_audit WHERE key = ? ORDER BY changed_at DESC LIMIT ?',
      key,
      limit,
    ),
  listAll: (limit = 20): ConfigAuditEntry[] =>
    configAuditTable.all(
      'SELECT * FROM config_audit ORDER BY changed_at DESC LIMIT ?',
      limit,
    ),
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
  agentSessions,
  toolInvocations,
  handoffs,
  stepCheckpoints,
  graphDefinitions,
  graphRuns,
  graphNodeRuns,
  graphEvents,
  graphRuntime,
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
