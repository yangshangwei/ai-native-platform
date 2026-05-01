import type {
  Iso8601,
  GateRunId,
  WorkflowRunId,
  StepRunId,
  CommandRunId,
} from './ids';
import type { EvidenceRef } from './artifact';

export type GateId =
  | 'requirement_gate'
  | 'design_gate'
  | 'diff_scope_gate'
  | 'sensitive_change_gate'
  | 'compile_gate'
  | 'test_gate'
  | 'acceptance_gate'
  | 'knowledge_gate';

export type GateStatus = 'pass' | 'warn' | 'fail';

export type RuleStatus = 'pass' | 'warn' | 'fail' | 'skipped';

/**
 * One declarative rule outcome. The Gate Engine produces these,
 * Agents may not.
 */
export interface RuleResult {
  ruleId: string;
  status: RuleStatus;
  message: string;
  evidenceRefs: EvidenceRef[];
}

export interface GateRun {
  id: GateRunId;
  gateId: GateId;
  workflowRunId: WorkflowRunId;
  stepRunId: StepRunId | null;
  status: GateStatus;
  ruleResults: RuleResult[];
  evidenceRefs: EvidenceRef[];
  /** CommandRuns that the rules were derived from. */
  commandRunIds: CommandRunId[];
  decidedAt: Iso8601;
  /** Free-form note for Agent-side explanation. Never used to override status. */
  agentNote: string | null;
}
