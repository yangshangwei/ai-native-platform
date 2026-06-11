import { newId, nowIso } from '@ainp/shared';
import { store, type AuditEntry } from './store/store';

/**
 * Append-only audit log writer. Shared by workflow-engine (the sole state
 * writer) and gate-engine (which records `gate.recorded` entries without
 * depending on workflow-engine).
 */
export function audit(
  workflowRunId: string | null,
  kind: string,
  payload: Record<string, unknown>,
): AuditEntry {
  const e: AuditEntry = {
    id: newId('audit'),
    workflowRunId,
    kind,
    payload,
    at: nowIso(),
  };
  store.auditLog.insert(e);
  return e;
}
