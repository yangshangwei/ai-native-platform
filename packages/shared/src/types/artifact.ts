import type { Iso8601, ArtifactId, WorkflowRunId, StepRunId } from './ids';

export type ArtifactKind =
  | 'project_profile'
  | 'context_pack'
  | 'requirement_draft'
  | 'design_doc'
  | 'traceability'
  | 'diff'
  | 'command_log'
  | 'surefire_report'
  | 'failsafe_report'
  | 'completion_report'
  | 'knowledge_candidate'
  | 'other';

export interface ArtifactRef {
  id: ArtifactId;
  kind: ArtifactKind;
  /** URI: file://, mem:// or http(s):// */
  uri: string;
}

export interface Artifact extends ArtifactRef {
  workflowRunId: WorkflowRunId;
  stepRunId: StepRunId | null;
  size: number;
  contentType: string;
  createdAt: Iso8601;
  /** Free-form metadata, e.g. {testTotal: 3} */
  metadata: Record<string, unknown>;
}

/**
 * Pointer used by Gate / Report to cite a piece of evidence.
 * Anything load-bearing in a GateRun must have at least one evidenceRef.
 */
export interface EvidenceRef {
  artifactId: ArtifactId;
  /** What this artifact proves. e.g. "mvn test exit=0" */
  claim: string;
}
