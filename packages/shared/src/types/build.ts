import type {
  BuildRunId,
  TestRunId,
  WorkflowRunId,
  StepRunId,
  CommandRunId,
  Iso8601,
  ArtifactId,
} from './ids';

export interface BuildRun {
  id: BuildRunId;
  workflowRunId: WorkflowRunId;
  stepRunId: StepRunId | null;
  language: 'java';
  buildTool: 'maven';
  jdkVersion: string;
  mavenCommand: string;
  status: 'running' | 'passed' | 'failed' | 'timeout' | 'cancelled';
  startedAt: Iso8601;
  completedAt: Iso8601 | null;
  commandRunIds: CommandRunId[];
  /** Artifact ids of collected reports / logs. */
  artifactIds: ArtifactId[];
}

export interface TestRun {
  id: TestRunId;
  buildRunId: BuildRunId;
  framework: 'maven-surefire' | 'maven-failsafe';
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  errors: number;
  reportArtifactIds: ArtifactId[];
}
