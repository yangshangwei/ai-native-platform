// SQLite connection + explicit, versioned schema migrations.
//
// Task 06-12 (roadmap T4.3): this module used to build the entire schema as
// an import side effect (probe-style `PRAGMA table_info` + ALTER). It now
// exposes:
//
//   - `initDb(options?)`  — idempotent, explicit initialization (recommended
//     for tests: `initDb({ path })`).
//   - `db`                — lazy singleton proxy. First property access calls
//     `initDb()` with the env/default path, so existing consumers
//     (store.ts, workflow-engine.ts, promote.ts) and the legacy test
//     bootstrap ("set AINP_DB_PATH, then dynamic import") keep working
//     unchanged.
//   - `runMigrations(db)` — applies the numbered MIGRATIONS list to an
//     arbitrary connection, with bookkeeping in `schema_migrations`.
//
// Migration discipline (see .trellis/spec/api/backend/database.md):
// new schema changes MUST be appended as a new MIGRATIONS entry with the
// next version number. Never add probe-style ALTERs outside the list.
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

// ---------------------------------------------------------------------------
// Migration infrastructure
// ---------------------------------------------------------------------------

export interface Migration {
  version: number;
  name: string;
  /**
   * Baseline probe: does `database` already contain this migration's effect?
   * Used both for taking over legacy DBs (created before `schema_migrations`
   * existed) and for fresh DBs where the version-1 baseline DDL already
   * includes columns that were historically added by later ALTERs. When it
   * returns true the migration is recorded as applied without running `up`.
   */
  isApplied(database: Database): boolean;
  up(database: Database): void;
}

function run(database: Database, sql: string): void {
  database.prepare(sql).run();
}

function hasColumn(database: Database, table: string, column: string): boolean {
  const cols = database
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name: string }>;
  return cols.some((c) => c.name === column);
}

function hasTable(database: Database, table: string): boolean {
  return Boolean(
    database
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(table),
  );
}

/** Probe + ALTER pairs from the legacy module become one migration each. */
function addColumn(
  version: number,
  table: string,
  column: string,
  columnDdl: string,
): Migration {
  return {
    version,
    name: `${table}-add-${column}`,
    isApplied: (database) => hasColumn(database, table, column),
    up: (database) => run(database, `ALTER TABLE ${table} ADD COLUMN ${columnDdl}`),
  };
}

// ---------------------------------------------------------------------------
// Version 1 baseline DDL — verbatim the legacy CREATE TABLE/INDEX list.
// `IF NOT EXISTS` is kept so taking over a legacy DB is a no-op.
// ---------------------------------------------------------------------------

const BASELINE_DDL: string[] = [
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
     stdout_sha256 TEXT,
     stderr_sha256 TEXT,
     combined_sha256 TEXT,
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
     sha256 TEXT,
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
  `CREATE TABLE IF NOT EXISTS agent_sessions (
     id TEXT PRIMARY KEY,
     workflow_run_id TEXT NOT NULL,
     step_run_id TEXT,
     agent_task_id TEXT NOT NULL,
     agent_result_id TEXT,
     backend TEXT NOT NULL,
     stage TEXT NOT NULL,
     skill_id TEXT NOT NULL,
     skill_version TEXT NOT NULL,
     context_pack_id TEXT NOT NULL,
     parent_session_id TEXT,
     retry_index INTEGER NOT NULL DEFAULT 0,
     status TEXT NOT NULL,
     started_at TEXT NOT NULL,
     completed_at TEXT,
     metadata_json TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_sessions_workflow ON agent_sessions(workflow_run_id, started_at)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_sessions_task ON agent_sessions(agent_task_id)`,
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
  `CREATE TABLE IF NOT EXISTS tool_invocations (
     id TEXT PRIMARY KEY,
     workflow_run_id TEXT NOT NULL,
     step_run_id TEXT,
     tool_id TEXT NOT NULL,
     tool_name TEXT NOT NULL,
     schema_version TEXT NOT NULL,
     status TEXT NOT NULL,
     side_effect TEXT NOT NULL,
     permission_tier TEXT NOT NULL,
     permission_decision TEXT NOT NULL,
     arguments_digest TEXT NOT NULL,
     result_refs_json TEXT NOT NULL,
     started_at TEXT NOT NULL,
     completed_at TEXT,
     duration_ms INTEGER,
     error TEXT,
     metadata_json TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_tool_invocations_workflow ON tool_invocations(workflow_run_id, started_at)`,
  `CREATE TABLE IF NOT EXISTS handoffs (
     id TEXT PRIMARY KEY,
     workflow_run_id TEXT NOT NULL,
     step_run_id TEXT,
     parent_session_id TEXT,
     child_session_id TEXT,
     from_role TEXT NOT NULL,
     to_role TEXT NOT NULL,
     reason TEXT NOT NULL,
     input_artifact_ids_json TEXT NOT NULL,
     expected_output_json TEXT NOT NULL,
     stop_condition TEXT NOT NULL,
     status TEXT NOT NULL,
     adoption_decision TEXT NOT NULL,
     output_artifact_ids_json TEXT NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     completed_at TEXT,
     metadata_json TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_handoffs_workflow ON handoffs(workflow_run_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS step_checkpoints (
     id TEXT PRIMARY KEY,
     workflow_run_id TEXT NOT NULL,
     step_run_id TEXT NOT NULL UNIQUE,
     stage TEXT NOT NULL,
     status TEXT NOT NULL,
     input_artifact_ids_json TEXT NOT NULL,
     output_artifact_ids_json TEXT NOT NULL,
     context_pack_id TEXT,
     agent_session_ids_json TEXT NOT NULL,
     tool_invocation_ids_json TEXT NOT NULL,
     gate_run_ids_json TEXT NOT NULL,
     retry_index INTEGER NOT NULL DEFAULT 0,
     resume_cursor TEXT,
     failure_reason TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     metadata_json TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_step_checkpoints_workflow ON step_checkpoints(workflow_run_id, created_at)`,
];

// ---------------------------------------------------------------------------
// Numbered migrations — mechanical transcription of the legacy probe code.
// Versions 2..21 mirror the original top-to-bottom probe/ALTER order, so a
// legacy DB and a fresh DB both converge on the exact same schema (verified
// by apps/api/test/db-migrations.test.ts).
// ---------------------------------------------------------------------------

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'baseline-schema',
    // The DDL is `IF NOT EXISTS`-idempotent; always run it so partially
    // created legacy DBs are completed exactly like the legacy module did.
    isApplied: () => false,
    up: (database) => {
      for (const sql of BASELINE_DDL) run(database, sql);
    },
  },
  addColumn(2, 'projects', 'source_kind', `source_kind TEXT NOT NULL DEFAULT 'local'`),
  addColumn(3, 'projects', 'source_url', `source_url TEXT`),
  addColumn(4, 'projects', 'source_auth_kind', `source_auth_kind TEXT NOT NULL DEFAULT 'none'`),
  addColumn(5, 'projects', 'agent_backend', `agent_backend TEXT`),
  addColumn(6, 'projects', 'source_username', `source_username TEXT`),
  addColumn(7, 'projects', 'source_credential', `source_credential TEXT`),
  addColumn(8, 'projects', 'status', `status TEXT NOT NULL DEFAULT 'active'`),
  addColumn(9, 'projects', 'archived_at', `archived_at TEXT`),
  addColumn(10, 'projects', 'source_branches_json', `source_branches_json TEXT`),
  addColumn(11, 'workflow_runs', 'source_branch', `source_branch TEXT`),
  {
    // V2 W2-1 / PR3: workflow_runs.flow_id — declarative pointer into
    // FLOW_REGISTRY (apps/runner/src/flows/registry.ts). New rows get the
    // column DEFAULT; historical rows are explicitly backfilled (PRD ADR Q2).
    version: 12,
    name: 'workflow_runs-add-flow_id',
    isApplied: (database) => hasColumn(database, 'workflow_runs', 'flow_id'),
    up: (database) => {
      run(
        database,
        `ALTER TABLE workflow_runs ADD COLUMN flow_id TEXT NOT NULL DEFAULT 'feature.standard'`,
      );
      // Defensive backfill: ALTER ... DEFAULT covers freshly-CREATEd rows,
      // but normalises any pre-existing row that may have been written with
      // an empty string via a different code path.
      run(database, `UPDATE workflow_runs SET flow_id = 'feature.standard' WHERE flow_id = ''`);
    },
  },
  // V2 W2-4 / PR2: workflow_runs.start_stage — optional skip-prefix entry
  // stage chosen by the smart-router (or UI override). NULL means "start
  // from the flow's first stage" (V1-equivalent default).
  addColumn(13, 'workflow_runs', 'start_stage', `start_stage TEXT`),
  // 05-08 new-task-form-flow-startstage-override: workflow_requests.flow_id
  // + start_stage — optional UI overrides carried from the New Task form's
  // 高级覆盖 disclosure. NULL means "let Coordinator + Router decide".
  addColumn(14, 'workflow_requests', 'flow_id', `flow_id TEXT`),
  addColumn(15, 'workflow_requests', 'start_stage', `start_stage TEXT`),
  // 06-08 agent-harness-evidence: tamper-evident command/artifact records.
  // New rows store SHA-256 digests; historical rows stay valid with NULL.
  addColumn(16, 'command_runs', 'stdout_sha256', `stdout_sha256 TEXT`),
  addColumn(17, 'command_runs', 'stderr_sha256', `stderr_sha256 TEXT`),
  addColumn(18, 'command_runs', 'combined_sha256', `combined_sha256 TEXT`),
  addColumn(19, 'artifacts', 'sha256', `sha256 TEXT`),
  {
    // 05-10 coordinator-llm-web-sse PR1: agent_events stream channel
    // extension. Coordinator triage (and any future pre-workflow-run agent
    // stage) needs to emit stream events before a workflow_run exists. Add an
    // optional workflow_request_id column + secondary index so events can be
    // keyed on either channel. Mutual exclusion (exactly one of
    // workflow_run_id / workflow_request_id non-null) is a runtime invariant
    // enforced by recordAgentEvent — not a DB CHECK.
    version: 20,
    name: 'agent_events-add-workflow_request_id',
    isApplied: (database) => hasColumn(database, 'agent_events', 'workflow_request_id'),
    up: (database) => {
      run(database, `ALTER TABLE agent_events ADD COLUMN workflow_request_id TEXT`);
      run(
        database,
        `CREATE INDEX IF NOT EXISTS idx_agent_events_request ON agent_events(workflow_request_id, sequence)`,
      );
    },
  },
  {
    // Drop legacy NOT NULL constraint on agent_events.workflow_run_id for DBs
    // created before 05-10 PR1. SQLite cannot ALTER a column nullability in
    // place; rebuild the table when the constraint is still present. On a
    // fresh DB the baseline CREATE TABLE already declares the column as
    // nullable, so `isApplied` reports true and the rebuild is skipped.
    version: 21,
    name: 'agent_events-rebuild-nullable-workflow_run_id',
    isApplied: (database) => {
      const info = database.prepare('PRAGMA table_info(agent_events)').all() as Array<{
        name: string;
        notnull: number;
      }>;
      const wfRunCol = info.find((c) => c.name === 'workflow_run_id');
      return !wfRunCol || wfRunCol.notnull === 0;
    },
    up: (database) => {
      database.transaction(() => {
        run(database, `CREATE TABLE agent_events__rebuild (
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
        run(
          database,
          `INSERT INTO agent_events__rebuild
             (id, workflow_run_id, workflow_request_id, step_run_id, agent_kind, sequence, type, payload_json, text, ts)
           SELECT id, workflow_run_id, workflow_request_id, step_run_id, agent_kind, sequence, type, payload_json, text, ts
             FROM agent_events`,
        );
        run(database, `DROP TABLE agent_events`);
        run(database, `ALTER TABLE agent_events__rebuild RENAME TO agent_events`);
        run(
          database,
          `CREATE INDEX IF NOT EXISTS idx_agent_events_workflow ON agent_events(workflow_run_id, sequence)`,
        );
        run(
          database,
          `CREATE INDEX IF NOT EXISTS idx_agent_events_request ON agent_events(workflow_request_id, sequence)`,
        );
      })();
    },
  },
  // 06-12 build-command de-hardcoding (roadmap T3.2): optional project-level
  // custom compile/test commands. NULL means "use the runner's Maven
  // default". Validated at the API boundary (no shell metacharacters) and
  // allow-listed at execution time via the whitelist extraAllow mechanism.
  addColumn(22, 'projects', 'build_compile_command', `build_compile_command TEXT`),
  addColumn(23, 'projects', 'build_test_command', `build_test_command TEXT`),
  // 06-25 ask-flow: workflow_requests.kind — discriminator for read-only
  // question/answer requests that bypass the workflow run pipeline. NULL means
  // "normal task" (proceeds through runner watch → coordinator → flow execution).
  // 'ask' means "read-only Q&A" (stays in chat, never enters watch loop).
  addColumn(24, 'workflow_requests', 'kind', `kind TEXT CHECK (kind IN ('ask'))`),
  {
    version: 25,
    name: 'agent_sessions-create',
    isApplied: (database) => hasTable(database, 'agent_sessions'),
    up: (database) => {
      run(database, `CREATE TABLE agent_sessions (
         id TEXT PRIMARY KEY,
         workflow_run_id TEXT NOT NULL,
         step_run_id TEXT,
         agent_task_id TEXT NOT NULL,
         agent_result_id TEXT,
         backend TEXT NOT NULL,
         stage TEXT NOT NULL,
         skill_id TEXT NOT NULL,
         skill_version TEXT NOT NULL,
         context_pack_id TEXT NOT NULL,
         parent_session_id TEXT,
         retry_index INTEGER NOT NULL DEFAULT 0,
         status TEXT NOT NULL,
         started_at TEXT NOT NULL,
         completed_at TEXT,
         metadata_json TEXT NOT NULL
       )`);
      run(database, `CREATE INDEX IF NOT EXISTS idx_agent_sessions_workflow ON agent_sessions(workflow_run_id, started_at)`);
      run(database, `CREATE INDEX IF NOT EXISTS idx_agent_sessions_task ON agent_sessions(agent_task_id)`);
    },
  },
  {
    version: 26,
    name: 'tool_invocations-create-table',
    isApplied: (database) => hasTable(database, 'tool_invocations'),
    up: (database) => {
      run(database, `CREATE TABLE tool_invocations (
         id TEXT PRIMARY KEY,
         workflow_run_id TEXT NOT NULL,
         step_run_id TEXT,
         tool_id TEXT NOT NULL,
         tool_name TEXT NOT NULL,
         schema_version TEXT NOT NULL,
         status TEXT NOT NULL,
         side_effect TEXT NOT NULL,
         permission_tier TEXT NOT NULL,
         permission_decision TEXT NOT NULL,
         arguments_digest TEXT NOT NULL,
         result_refs_json TEXT NOT NULL,
         started_at TEXT NOT NULL,
         completed_at TEXT,
         duration_ms INTEGER,
         error TEXT,
         metadata_json TEXT NOT NULL
       )`);
      run(database, `CREATE INDEX IF NOT EXISTS idx_tool_invocations_workflow ON tool_invocations(workflow_run_id, started_at)`);
    },
  },
  {
    version: 27,
    name: 'handoffs-create-table',
    isApplied: (database) => hasTable(database, 'handoffs'),
    up: (database) => {
      run(database, `CREATE TABLE handoffs (
         id TEXT PRIMARY KEY,
         workflow_run_id TEXT NOT NULL,
         step_run_id TEXT,
         parent_session_id TEXT,
         child_session_id TEXT,
         from_role TEXT NOT NULL,
         to_role TEXT NOT NULL,
         reason TEXT NOT NULL,
         input_artifact_ids_json TEXT NOT NULL,
         expected_output_json TEXT NOT NULL,
         stop_condition TEXT NOT NULL,
         status TEXT NOT NULL,
         adoption_decision TEXT NOT NULL,
         output_artifact_ids_json TEXT NOT NULL,
         created_at TEXT NOT NULL,
         updated_at TEXT NOT NULL,
         completed_at TEXT,
         metadata_json TEXT NOT NULL
       )`);
      run(database, `CREATE INDEX IF NOT EXISTS idx_handoffs_workflow ON handoffs(workflow_run_id, created_at)`);
    },
  },
  {
    version: 28,
    name: 'step_checkpoints-create-table',
    isApplied: (database) => hasTable(database, 'step_checkpoints'),
    up: (database) => {
      run(database, `CREATE TABLE step_checkpoints (
         id TEXT PRIMARY KEY,
         workflow_run_id TEXT NOT NULL,
         step_run_id TEXT NOT NULL UNIQUE,
         stage TEXT NOT NULL,
         status TEXT NOT NULL,
         input_artifact_ids_json TEXT NOT NULL,
         output_artifact_ids_json TEXT NOT NULL,
         context_pack_id TEXT,
         agent_session_ids_json TEXT NOT NULL,
         tool_invocation_ids_json TEXT NOT NULL,
         gate_run_ids_json TEXT NOT NULL,
         retry_index INTEGER NOT NULL DEFAULT 0,
         resume_cursor TEXT,
         failure_reason TEXT,
         created_at TEXT NOT NULL,
         updated_at TEXT NOT NULL,
         metadata_json TEXT NOT NULL
       )`);
      run(database, `CREATE INDEX IF NOT EXISTS idx_step_checkpoints_workflow ON step_checkpoints(workflow_run_id, created_at)`);
    },
  },
];

// ---------------------------------------------------------------------------
// Migration runner
// ---------------------------------------------------------------------------

/**
 * Applies all pending MIGRATIONS to `database`, recording each in
 * `schema_migrations`. Safe to call repeatedly (idempotent).
 *
 * Baseline takeover: on a DB created by the legacy import-side-effect module
 * (no `schema_migrations` table), each migration's `isApplied` probe detects
 * the already-present schema, so migrations are recorded without re-running —
 * no duplicate-column ALTER errors. Fresh DBs run the full list in order.
 */
export function runMigrations(database: Database): void {
  run(
    database,
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version INTEGER PRIMARY KEY,
       name TEXT,
       applied_at TEXT
     )`,
  );
  const recorded = new Set(
    (database.prepare('SELECT version FROM schema_migrations').all() as Array<{
      version: number;
    }>).map((r) => r.version),
  );
  const ordered = [...MIGRATIONS].sort((a, b) => a.version - b.version);
  const record = database.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
  );
  for (const migration of ordered) {
    if (recorded.has(migration.version)) continue;
    if (!migration.isApplied(database)) migration.up(database);
    record.run(migration.version, migration.name, new Date().toISOString());
  }
}

// ---------------------------------------------------------------------------
// Connection lifecycle — explicit init + lazy singleton
// ---------------------------------------------------------------------------

export interface InitDbOptions {
  /** SQLite file path. Defaults to AINP_DB_PATH or ~/.ai-native/ainp.sqlite. */
  path?: string;
}

let instance: Database | null = null;
let instancePath: string | null = null;

/**
 * Opens (or returns) the process-wide connection and applies migrations.
 * Idempotent: repeated calls return the same instance. Tests should call
 * `initDb({ path })` before touching any store module.
 */
export function initDb(options: InitDbOptions = {}): Database {
  if (instance) {
    if (options.path && options.path !== instancePath) {
      throw new Error(
        `initDb: already initialized with ${instancePath}; refusing to switch to ${options.path}`,
      );
    }
    return instance;
  }
  const path = options.path ?? process.env.AINP_DB_PATH ?? join(homedir(), '.ai-native', 'ainp.sqlite');
  mkdirSync(dirname(path), { recursive: true });
  const database = new Database(path);
  run(database, 'PRAGMA journal_mode = WAL');
  run(database, 'PRAGMA foreign_keys = ON');
  runMigrations(database);
  instance = database;
  instancePath = path;
  return database;
}

/** Test helper: closes the singleton so a fresh `initDb` can run. */
export function closeDb(): void {
  if (instance) instance.close();
  instance = null;
  instancePath = null;
}

/**
 * Lazy singleton proxy. First property access triggers `initDb()` with the
 * env/default path — behaviorally equivalent to the legacy import side
 * effect for both production and the existing "set AINP_DB_PATH, then
 * dynamic import" test bootstrap, but without doing IO at import time.
 */
export const db: Database = new Proxy({} as Database, {
  get(_target, prop) {
    const real = initDb();
    const value = Reflect.get(real, prop, real);
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(real) : value;
  },
  set(_target, prop, value) {
    Reflect.set(initDb(), prop, value);
    return true;
  },
  has(_target, prop) {
    return Reflect.has(initDb(), prop);
  },
});
