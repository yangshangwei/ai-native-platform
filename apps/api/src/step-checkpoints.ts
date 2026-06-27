import {
  newId,
  nowIso,
  type AgentSession,
  type AgentTask,
  type GateRun,
  type StepCheckpoint,
  type StepCheckpointStatus,
  type StepRun,
  type ToolInvocation,
  type WorkflowStage,
} from '@ainp/shared';
import { store } from './store/store';
import { audit } from './audit';

interface StepCheckpointPatch {
  workflowRunId: string;
  stepRunId: string;
  stage?: WorkflowStage;
  status?: StepCheckpointStatus;
  inputArtifactIds?: string[];
  outputArtifactIds?: string[];
  contextPackId?: string | null;
  agentSessionIds?: string[];
  toolInvocationIds?: string[];
  gateRunIds?: string[];
  retryIndex?: number;
  resumeCursor?: string | null;
  failureReason?: string | null;
  metadata?: Record<string, unknown>;
}

export function initializeStepCheckpoint(step: StepRun): StepCheckpoint {
  return mergeStepCheckpoint({
    workflowRunId: step.workflowRunId,
    stepRunId: step.id,
    stage: step.stage,
    status: step.status,
  });
}

export function mergeStepCheckpoint(patch: StepCheckpointPatch): StepCheckpoint {
  const step = store.stepRuns.get(patch.stepRunId);
  if (step && step.workflowRunId !== patch.workflowRunId) {
    throw new Error('stepRunId does not belong to workflowRunId');
  }
  const existing = store.stepCheckpoints.byStep(patch.stepRunId);
  const ts = nowIso();
  const checkpoint: StepCheckpoint = {
    id: existing?.id ?? newId('scp'),
    workflowRunId: patch.workflowRunId,
    stepRunId: patch.stepRunId,
    stage: patch.stage ?? existing?.stage ?? step?.stage ?? 'init',
    status: patch.status ?? existing?.status ?? 'running',
    inputArtifactIds: mergeStrings(existing?.inputArtifactIds ?? [], patch.inputArtifactIds ?? []),
    outputArtifactIds: mergeStrings(existing?.outputArtifactIds ?? [], patch.outputArtifactIds ?? []),
    contextPackId: patch.contextPackId ?? existing?.contextPackId ?? null,
    agentSessionIds: mergeStrings(existing?.agentSessionIds ?? [], patch.agentSessionIds ?? []),
    toolInvocationIds: mergeStrings(existing?.toolInvocationIds ?? [], patch.toolInvocationIds ?? []),
    gateRunIds: mergeStrings(existing?.gateRunIds ?? [], patch.gateRunIds ?? []),
    retryIndex: Math.max(existing?.retryIndex ?? 0, patch.retryIndex ?? 0),
    resumeCursor: patch.resumeCursor ?? existing?.resumeCursor ?? null,
    failureReason: patch.failureReason ?? existing?.failureReason ?? null,
    createdAt: existing?.createdAt ?? ts,
    updatedAt: ts,
    metadata: {
      ...(existing?.metadata ?? {}),
      ...(patch.metadata ?? {}),
    },
  };
  store.stepCheckpoints.upsert(checkpoint);
  audit(patch.workflowRunId, 'step_checkpoint.updated', {
    stepRunId: patch.stepRunId,
    checkpointId: checkpoint.id,
    status: checkpoint.status,
  });
  return checkpoint;
}

export function checkpointAgentTask(task: AgentTask): void {
  if (!task.stepRunId) return;
  if (!store.stepRuns.get(task.stepRunId)) return;
  mergeStepCheckpoint({
    workflowRunId: task.workflowRunId,
    stepRunId: task.stepRunId,
    inputArtifactIds: task.inputArtifactIds,
    metadata: { lastAgentTaskId: task.id },
  });
}

export function checkpointAgentSession(session: AgentSession): void {
  if (!session.stepRunId) return;
  if (!store.stepRuns.get(session.stepRunId)) return;
  mergeStepCheckpoint({
    workflowRunId: session.workflowRunId,
    stepRunId: session.stepRunId,
    stage: session.stage,
    contextPackId: session.contextPackId,
    agentSessionIds: [session.id],
    retryIndex: session.retryIndex,
    status: session.status === 'failed' ? 'failed' : undefined,
    failureReason: session.status === 'failed' ? stringMetadata(session.metadata, 'error') : undefined,
    metadata: {
      lastAgentSessionStatus: session.status,
      lastAgentSessionId: session.id,
    },
  });
}

export function checkpointAgentResult(
  workflowRunId: string,
  stepRunId: string | null,
  outputArtifactIds: string[],
  failureReason: string | null,
): void {
  if (!stepRunId) return;
  if (!store.stepRuns.get(stepRunId)) return;
  mergeStepCheckpoint({
    workflowRunId,
    stepRunId,
    outputArtifactIds,
    failureReason,
  });
}

export function checkpointToolInvocation(invocation: ToolInvocation): void {
  if (!invocation.stepRunId) return;
  if (!store.stepRuns.get(invocation.stepRunId)) return;
  mergeStepCheckpoint({
    workflowRunId: invocation.workflowRunId,
    stepRunId: invocation.stepRunId,
    toolInvocationIds: [invocation.id],
    failureReason: invocation.status === 'failed' || invocation.status === 'denied'
      ? invocation.error
      : undefined,
  });
}

export function checkpointGateRun(gate: GateRun): void {
  if (!gate.stepRunId) return;
  if (!store.stepRuns.get(gate.stepRunId)) return;
  mergeStepCheckpoint({
    workflowRunId: gate.workflowRunId,
    stepRunId: gate.stepRunId,
    gateRunIds: [gate.id],
    failureReason: gate.status === 'fail'
      ? `${gate.gateId} failed`
      : undefined,
  });
}

function mergeStrings(existing: string[], next: string[]): string[] {
  return [...new Set([...existing, ...next].filter((item) => item.trim().length > 0))];
}

function stringMetadata(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}
