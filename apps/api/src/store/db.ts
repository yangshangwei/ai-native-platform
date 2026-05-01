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
     language TEXT NOT NULL,
     build_tool TEXT NOT NULL,
     default_branch TEXT NOT NULL,
     registered_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS workflow_runs (
     id TEXT PRIMARY KEY,
     project_id TEXT NOT NULL,
     type TEXT NOT NULL,
     status TEXT NOT NULL,
     current_stage TEXT NOT NULL,
     config_snapshot_id TEXT,
     branch TEXT NOT NULL,
     workspace_path TEXT,
     title TEXT NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_workflow_runs_project ON workflow_runs(project_id)`,
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
];

for (const sql of MIGRATIONS) runSql(sql);
