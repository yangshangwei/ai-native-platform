import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const DB_PATH = process.env.AINP_DB_PATH ?? join(homedir(), '.ai-native', 'ainp.sqlite');
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);

function runSql(sql: string): void {
  db.prepare(sql).run();
}

runSql('PRAGMA journal_mode = WAL');
runSql('PRAGMA foreign_keys = ON');

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS projects (
     id TEXT PRIMARY KEY,
     name TEXT UNIQUE NOT NULL,
     local_path TEXT NOT NULL,
     source_kind TEXT NOT NULL DEFAULT 'local',
     source_url TEXT,
     source_auth_kind TEXT NOT NULL DEFAULT 'none',
     source_username TEXT,
     source_credential TEXT,
     status TEXT NOT NULL DEFAULT 'active',
     archived_at TEXT,
     agent_backend TEXT,
     language TEXT NOT NULL,
     build_tool TEXT NOT NULL,
     default_branch TEXT NOT NULL,
     source_branches_json TEXT,
     registered_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS workflow_runs (
     id TEXT PRIMARY KEY,
     project_id TEXT NOT NULL,
     type TEXT NOT NULL,
     status TEXT NOT NULL,
     current_stage TEXT NOT NULL,
     config_snapshot_id TEXT,
     source_branch TEXT,
     branch TEXT NOT NULL,
     workspace_path TEXT,
     title TEXT NOT NULL,
     flow_id TEXT NOT NULL DEFAULT 'feature.standard',
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
	  `CREATE INDEX IF NOT EXISTS idx_workflow_runs_project ON workflow_runs(project_id)`,
	  `CREATE TABLE IF NOT EXISTS workflow_requests (
	     id TEXT PRIMARY KEY,
	     project_id TEXT NOT NULL,
	     type TEXT NOT NULL,
	     title TEXT NOT NULL,
	     branch TEXT NOT NULL,
	     status TEXT NOT NULL,
	     claimed_by TEXT,
	     workflow_run_id TEXT,
	     error TEXT,
	     created_at TEXT NOT NULL,
	     updated_at TEXT NOT NULL
	   )`,
	  `CREATE INDEX IF NOT EXISTS idx_workflow_requests_status ON workflow_requests(status, created_at)`,
  `CREATE TABLE IF NOT EXISTS step_runs (
     id TEXT PRIMARY KEY,
     workflow_run_id TEXT NOT NULL,
     stage TEXT NOT NULL,
     name TEXT NOT NULL,
     status TEXT NOT NULL,
     started_at TEXT,
     completed_at TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_step_runs_workflow ON step_runs(workflow_run_id)`,
  `CREATE TABLE IF NOT EXISTS command_runs (
     id TEXT PRIMARY KEY,
     workflow_run_id TEXT NOT NULL,
     step_run_id TEXT,
     cwd TEXT NOT NULL,
     command TEXT NOT NULL,
     stage TEXT NOT NULL,
     status TEXT NOT NULL,
     exit_code INTEGER,
     started_at TEXT NOT NULL,
     finished_at TEXT,
     duration_ms INTEGER,
     stdout_ref TEXT NOT NULL,
     stderr_ref TEXT NOT NULL,
     stdout_bytes INTEGER NOT NULL,
     stderr_bytes INTEGER NOT NULL,
     timed_out INTEGER NOT NULL,
     truncated INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_command_runs_workflow ON command_runs(workflow_run_id)`,
  `CREATE TABLE IF NOT EXISTS gate_runs (
     id TEXT PRIMARY KEY,
     gate_id TEXT NOT NULL,
     workflow_run_id TEXT NOT NULL,
     step_run_id TEXT,
     status TEXT NOT NULL,
     rule_results_json TEXT NOT NULL,
     evidence_refs_json TEXT NOT NULL,
     command_run_ids_json TEXT NOT NULL,
     decided_at TEXT NOT NULL,
     agent_note TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_gate_runs_workflow ON gate_runs(workflow_run_id)`,
  `CREATE TABLE IF NOT EXISTS artifacts (
     id TEXT PRIMARY KEY,
     kind TEXT NOT NULL,
     uri TEXT NOT NULL,
     workflow_run_id TEXT NOT NULL,
     step_run_id TEXT,
     size INTEGER NOT NULL,
     content_type TEXT NOT NULL,
     created_at TEXT NOT NULL,
     metadata_json TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_artifacts_workflow ON artifacts(workflow_run_id)`,
  // V2 P0-1: knowledge_artifacts — project-scoped, long-lived, editable,
  // versioned. Distinct from `artifacts` (per-run, one-shot). See
  // `.trellis/tasks/05-04-v2-artifact-kind-expansion/prd.md` ADR Q1.
  `CREATE TABLE IF NOT EXISTS knowledge_artifacts (
     id TEXT PRIMARY KEY,
     kind TEXT NOT NULL,
     uri TEXT NOT NULL,
     project_id TEXT NOT NULL,
     size INTEGER NOT NULL,
     content_type TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'draft',
     version INTEGER NOT NULL DEFAULT 1,
     entity_id TEXT,
     derived_from_artifact_id TEXT,
     subtype TEXT,
     metadata_json TEXT NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_artifacts_project ON knowledge_artifacts(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_artifacts_entity ON knowledge_artifacts(project_id, entity_id)`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_artifacts_kind ON knowledge_artifacts(project_id, kind)`,
  // V2 P0-2: requirements / designs entity tables — head-pointer model.
  // Each row represents the current authoritative version of a REQ-### /
  // DSN-###; historical versions remain in `knowledge_artifacts` keyed by
  // (project_id, entity_id). `current_artifact_id` references a specific
  // accepted knowledge_artifacts row but is **NOT** declared as a DB FK
  // (Q3=3-B): referential integrity is upheld by the API promote
  // transaction (Q5=5-A). `designs.ref_req` IS a strong FK with
  // ON DELETE RESTRICT — the only FK introduced in P0-2, gating REQ↔DSN
  // traceability per V2 doc § 3.6. See
  // `.trellis/tasks/05-04-v2-entity-tables-bootstrap/prd.md` ADR Q1-Q5.
  `CREATE TABLE IF NOT EXISTS requirements (
     id TEXT NOT NULL,
     project_id TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'draft',
     current_version INTEGER NOT NULL,
     current_artifact_id TEXT NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     PRIMARY KEY (project_id, id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_requirements_project ON requirements(project_id)`,
  `CREATE TABLE IF NOT EXISTS designs (
     id TEXT NOT NULL,
     project_id TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'draft',
     current_version INTEGER NOT NULL,
     current_artifact_id TEXT NOT NULL,
     ref_req TEXT NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     PRIMARY KEY (project_id, id),
     FOREIGN KEY (project_id, ref_req) REFERENCES requirements(project_id, id) ON DELETE RESTRICT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_designs_project ON designs(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_designs_ref_req ON designs(project_id, ref_req)`,
  `CREATE TABLE IF NOT EXISTS build_runs (
     id TEXT PRIMARY KEY,
     workflow_run_id TEXT NOT NULL,
     step_run_id TEXT,
     language TEXT NOT NULL,
     build_tool TEXT NOT NULL,
     jdk_version TEXT NOT NULL,
     maven_command TEXT NOT NULL,
     status TEXT NOT NULL,
     started_at TEXT NOT NULL,
     completed_at TEXT,
     command_run_ids_json TEXT NOT NULL,
     artifact_ids_json TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_build_runs_workflow ON build_runs(workflow_run_id)`,
  `CREATE TABLE IF NOT EXISTS test_runs (
     id TEXT PRIMARY KEY,
     build_run_id TEXT NOT NULL,
     framework TEXT NOT NULL,
     total INTEGER NOT NULL,
     passed INTEGER NOT NULL,
     failed INTEGER NOT NULL,
     skipped INTEGER NOT NULL,
     errors INTEGER NOT NULL,
     report_artifact_ids_json TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_test_runs_build ON test_runs(build_run_id)`,
  `CREATE TABLE IF NOT EXISTS agent_tasks (
     id TEXT PRIMARY KEY,
     workflow_run_id TEXT NOT NULL,
     step_run_id TEXT,
     kind TEXT NOT NULL,
     backend TEXT NOT NULL,
     prompt TEXT NOT NULL,
     input_artifact_ids_json TEXT NOT NULL,
     created_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_tasks_workflow ON agent_tasks(workflow_run_id)`,
  `CREATE TABLE IF NOT EXISTS agent_results (
     id TEXT PRIMARY KEY,
     task_id TEXT NOT NULL,
     status TEXT NOT NULL,
     summary TEXT NOT NULL,
     output_artifact_ids_json TEXT NOT NULL,
     started_at TEXT NOT NULL,
     completed_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS approvals (
     id TEXT PRIMARY KEY,
     workflow_run_id TEXT NOT NULL,
     gate_run_id TEXT,
     gate_id TEXT NOT NULL,
     decision TEXT NOT NULL,
     actor TEXT NOT NULL,
     comment TEXT,
     decided_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_approvals_workflow ON approvals(workflow_run_id)`,
  `CREATE TABLE IF NOT EXISTS workflow_actions (
     id TEXT PRIMARY KEY,
     workflow_run_id TEXT NOT NULL,
     kind TEXT NOT NULL,
     target_id TEXT,
     action TEXT NOT NULL,
     actor TEXT NOT NULL,
     payload_json TEXT NOT NULL,
     created_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_workflow_actions_workflow ON workflow_actions(workflow_run_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS audit_log (
     id TEXT PRIMARY KEY,
     workflow_run_id TEXT,
     kind TEXT NOT NULL,
     payload_json TEXT NOT NULL,
     at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_audit_log_workflow ON audit_log(workflow_run_id)`,
  `CREATE TABLE IF NOT EXISTS runners (
     id TEXT PRIMARY KEY,
     host TEXT NOT NULL,
     version TEXT NOT NULL,
     jdk_version TEXT,
     maven_version TEXT,
     git_version TEXT,
     last_seen_at TEXT NOT NULL,
     status TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS agent_events (
     id TEXT PRIMARY KEY,
     workflow_run_id TEXT,
     step_run_id TEXT,
     agent_kind TEXT NOT NULL,
     sequence INTEGER NOT NULL,
     type TEXT NOT NULL,
     payload_json TEXT NOT NULL,
     text TEXT,
     ts TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_events_workflow ON agent_events(workflow_run_id, sequence)`,
  // Phase B: Coordinator triage decisions and conversational intake messages.
  // workflow_request_id may reference a request whose status is one of:
  //   pending | awaiting_clarification | claimed | completed | failed | cancelled
  `CREATE TABLE IF NOT EXISTS coordinator_decisions (
     id TEXT PRIMARY KEY,
     workflow_request_id TEXT NOT NULL,
     workflow_run_id TEXT,
     source TEXT NOT NULL,
     decision_json TEXT NOT NULL,
     confidence REAL NOT NULL,
     rules_fired_json TEXT NOT NULL,
     decided_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_coord_decisions_request ON coordinator_decisions(workflow_request_id, decided_at)`,
  `CREATE TABLE IF NOT EXISTS workflow_request_messages (
     id TEXT PRIMARY KEY,
     workflow_request_id TEXT NOT NULL,
     role TEXT NOT NULL,
     content TEXT NOT NULL,
     coordinator_decision_id TEXT,
     created_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_request_messages_request ON workflow_request_messages(workflow_request_id, created_at)`,
  // PR1 (runtime config layer): scoped overrides + audit log for the in-UI config editor.
  `CREATE TABLE IF NOT EXISTS config_overrides (
     key TEXT PRIMARY KEY,
     scope TEXT NOT NULL DEFAULT 'global',
     value_json TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     updated_by TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS config_audit (
     id TEXT PRIMARY KEY,
     key TEXT NOT NULL,
     old_value_json TEXT,
     new_value_json TEXT,
     changed_at TEXT NOT NULL,
     changed_by TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_config_audit_key ON config_audit(key, changed_at)`,
];


for (const sql of MIGRATIONS) runSql(sql);

function columnNames(table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name));
}

const projectColumns = columnNames('projects');
if (!projectColumns.has('source_kind')) {
  runSql(`ALTER TABLE projects ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'local'`);
}
if (!projectColumns.has('source_url')) {
  runSql(`ALTER TABLE projects ADD COLUMN source_url TEXT`);
}
if (!projectColumns.has('source_auth_kind')) {
  runSql(`ALTER TABLE projects ADD COLUMN source_auth_kind TEXT NOT NULL DEFAULT 'none'`);
}
if (!projectColumns.has('agent_backend')) {
  runSql(`ALTER TABLE projects ADD COLUMN agent_backend TEXT`);
}
if (!projectColumns.has('source_username')) {
  runSql(`ALTER TABLE projects ADD COLUMN source_username TEXT`);
}
if (!projectColumns.has('source_credential')) {
  runSql(`ALTER TABLE projects ADD COLUMN source_credential TEXT`);
}
if (!projectColumns.has('status')) {
  runSql(`ALTER TABLE projects ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`);
}
if (!projectColumns.has('archived_at')) {
  runSql(`ALTER TABLE projects ADD COLUMN archived_at TEXT`);
}
if (!projectColumns.has('source_branches_json')) {
  runSql(`ALTER TABLE projects ADD COLUMN source_branches_json TEXT`);
}

const workflowRunColumns = columnNames('workflow_runs');
if (!workflowRunColumns.has('source_branch')) {
  runSql(`ALTER TABLE workflow_runs ADD COLUMN source_branch TEXT`);
}
// V2 W2-1 / PR3: workflow_runs.flow_id — declarative pointer into
// FLOW_REGISTRY (apps/runner/src/flows/registry.ts). New rows get the
// column DEFAULT; historical rows are explicitly backfilled (PRD ADR Q2).
// Both the ALTER and the UPDATE are idempotent.
if (!workflowRunColumns.has('flow_id')) {
  runSql(
    `ALTER TABLE workflow_runs ADD COLUMN flow_id TEXT NOT NULL DEFAULT 'feature.standard'`,
  );
  // Defensive backfill: ALTER ... DEFAULT covers freshly-CREATEd rows,
  // but normalises any pre-existing row that may have been written with
  // an empty string via a different code path. Idempotent.
  runSql(`UPDATE workflow_runs SET flow_id = 'feature.standard' WHERE flow_id = ''`);
}
// V2 W2-4 / PR2: workflow_runs.start_stage — optional skip-prefix entry
// stage chosen by the smart-router (or UI override). NULL means "start
// from the flow's first stage" (V1-equivalent default). Idempotent.
if (!workflowRunColumns.has('start_stage')) {
  runSql(`ALTER TABLE workflow_runs ADD COLUMN start_stage TEXT`);
}

// 05-08 new-task-form-flow-startstage-override: workflow_requests.flow_id
// + start_stage — optional UI overrides carried from the New Task form's
// 高级覆盖 disclosure. NULL means "let Coordinator + Router decide" (the
// V1-equivalent default). Both columns are NULLABLE so historical rows
// stay valid without backfill. Idempotent.
const workflowRequestColumns = columnNames('workflow_requests');
if (!workflowRequestColumns.has('flow_id')) {
  runSql(`ALTER TABLE workflow_requests ADD COLUMN flow_id TEXT`);
}
if (!workflowRequestColumns.has('start_stage')) {
  runSql(`ALTER TABLE workflow_requests ADD COLUMN start_stage TEXT`);
}

// 05-10 coordinator-llm-web-sse PR1: agent_events stream channel extension.
// Coordinator triage (and any future pre-workflow-run agent stage) needs to
// emit stream events before a workflow_run exists. Add an optional
// workflow_request_id column + secondary index so events can be keyed on
// either channel. Mutual exclusion (exactly one of workflow_run_id /
// workflow_request_id non-null) is a runtime invariant enforced by
// recordAgentEvent — not declared as a DB CHECK to keep migrations
// straightforward across already-stored historical rows. Idempotent.
const agentEventColumns = columnNames('agent_events');
if (!agentEventColumns.has('workflow_request_id')) {
  runSql(`ALTER TABLE agent_events ADD COLUMN workflow_request_id TEXT`);
}
runSql(
  `CREATE INDEX IF NOT EXISTS idx_agent_events_request ON agent_events(workflow_request_id, sequence)`,
);

// Drop legacy NOT NULL constraint on agent_events.workflow_run_id for DBs
// created before PR1. SQLite cannot ALTER a column nullability in place;
// rebuild the table when the constraint is still present. Idempotent: on a
// fresh DB the CREATE TABLE above already declares the column as nullable.
{
  const info = db.prepare('PRAGMA table_info(agent_events)').all() as Array<{
    name: string;
    notnull: number;
  }>;
  const wfRunCol = info.find((c) => c.name === 'workflow_run_id');
  if (wfRunCol && wfRunCol.notnull === 1) {
    db.transaction(() => {
      runSql(`CREATE TABLE agent_events__rebuild (
         id TEXT PRIMARY KEY,
         workflow_run_id TEXT,
         workflow_request_id TEXT,
         step_run_id TEXT,
         agent_kind TEXT NOT NULL,
         sequence INTEGER NOT NULL,
         type TEXT NOT NULL,
         payload_json TEXT NOT NULL,
         text TEXT,
         ts TEXT NOT NULL
       )`);
      runSql(
        `INSERT INTO agent_events__rebuild
           (id, workflow_run_id, workflow_request_id, step_run_id, agent_kind, sequence, type, payload_json, text, ts)
         SELECT id, workflow_run_id, workflow_request_id, step_run_id, agent_kind, sequence, type, payload_json, text, ts
           FROM agent_events`,
      );
      runSql(`DROP TABLE agent_events`);
      runSql(`ALTER TABLE agent_events__rebuild RENAME TO agent_events`);
      runSql(
        `CREATE INDEX IF NOT EXISTS idx_agent_events_workflow ON agent_events(workflow_run_id, sequence)`,
      );
      runSql(
        `CREATE INDEX IF NOT EXISTS idx_agent_events_request ON agent_events(workflow_request_id, sequence)`,
      );
    })();
  }
}
