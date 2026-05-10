import { Hono } from 'hono';
import type {
  CommandRun,
  WorkflowStage,
  ArtifactKind,
  GateRun,
  AgentStreamEventInput,
  AgentBackendKind,
  AgentTaskKind,
  ContextRequest,
} from '@ainp/shared';
import { isContextRequestStatus, isPerRunArtifactKind } from '@ainp/shared';
import {
  finishStep,
  recordCommandRun,
  setWorkspace,
  startStep,
  transitionStage,
  completeWorkflowRun,
  recordHeartbeat,
  recordMavenBuild,
  createArtifact,
  awaitHuman,
  recordAgentEvent,
  recordAgentTask,
  recordAgentResult,
  recordContextRequestAction,
  type MavenBuildEvent,
} from '../workflow-engine';
import {
  runDiffScopeGate,
  runSensitiveChangeGate,
  runRequirementGate,
  runDesignGate,
  runAcceptanceTraceabilityGate,
} from '../gate-engine';
import { store } from '../store/store';
import { assertReadableFileUri } from '../artifact-content';

/**
 * Runner-driven event ingress. The Runner is NOT a state writer — it tells
 * the Engine what happened and the Engine decides the new state.
 */
export const runnerEvents = new Hono();

runnerEvents.post('/workspace-prepared', async (c) => {
  const body = (await c.req.json()) as { workflowRunId: string; workspacePath: string };
  const run = setWorkspace(body.workflowRunId, body.workspacePath);
  return c.json({ ok: true, run });
});

runnerEvents.post('/step-started', async (c) => {
  const body = (await c.req.json()) as {
    workflowRunId: string;
    stage: WorkflowStage;
    name: string;
  };
  const step = startStep(body);
  return c.json({ ok: true, step });
});

runnerEvents.post('/step-finished', async (c) => {
  const body = (await c.req.json()) as {
    stepRunId: string;
    status: 'passed' | 'failed' | 'cancelled' | 'skipped';
  };
  const step = finishStep(body.stepRunId, body.status);
  return c.json({ ok: true, step });
});

runnerEvents.post('/command-run', async (c) => {
  const body = (await c.req.json()) as { commandRun: CommandRun };
  const cr = recordCommandRun(body.commandRun);
  return c.json({ ok: true, commandRun: cr });
});

runnerEvents.post('/stage-transition', async (c) => {
  const body = (await c.req.json()) as {
    workflowRunId: string;
    stage: WorkflowStage;
    status?: 'running' | 'awaiting_human';
  };
  const run = transitionStage(body.workflowRunId, body.stage, body.status ?? 'running');
  return c.json({ ok: true, run });
});

runnerEvents.post('/await-human', async (c) => {
  const body = (await c.req.json()) as { workflowRunId: string; stage: WorkflowStage };
  const run = awaitHuman(body.workflowRunId, body.stage);
  return c.json({ ok: true, run });
});

runnerEvents.post('/workflow-completed', async (c) => {
  const body = (await c.req.json()) as { workflowRunId: string; ok: boolean };
  const run = completeWorkflowRun(body.workflowRunId, body.ok);
  return c.json({ ok: true, run });
});

runnerEvents.post('/heartbeat', async (c) => {
  const body = (await c.req.json()) as {
    id: string;
    host: string;
    version: string;
    jdkVersion: string | null;
    mavenVersion: string | null;
    gitVersion: string | null;
  };
  const runner = recordHeartbeat(body);
  return c.json({ ok: true, runner });
});

/**
 * Live agent stream ingest — runner POSTs each parsed CC stream-json line
 * (or backend-meta) here. Body accepts a single event or a `events` array
 * for batched submission.
 */
runnerEvents.post('/agent-stream', async (c) => {
  const body = (await c.req.json()) as AgentStreamEventInput | { events: AgentStreamEventInput[] };
  const inputs = Array.isArray((body as { events?: unknown }).events)
    ? (body as { events: AgentStreamEventInput[] }).events
    : [body as AgentStreamEventInput];
  const stored = inputs.map((i) => recordAgentEvent(i));
  return c.json({ ok: true, count: stored.length, events: stored });
});

runnerEvents.post('/agent-task-started', async (c) => {
  const body = (await c.req.json()) as {
    workflowRunId: string;
    stepRunId: string | null;
    kind: AgentTaskKind;
    backend: AgentBackendKind;
    prompt: string;
    inputArtifactIds?: string[];
  };
  if (!body.workflowRunId || !body.kind || !body.backend) {
    return c.json({ error: 'workflowRunId, kind, backend required' }, 400);
  }
  const task = recordAgentTask({
    workflowRunId: body.workflowRunId,
    stepRunId: body.stepRunId ?? null,
    kind: body.kind,
    backend: body.backend,
    prompt: body.prompt ?? '',
    inputArtifactIds: body.inputArtifactIds ?? [],
  });
  return c.json({ ok: true, task }, 201);
});

runnerEvents.post('/agent-task-finished', async (c) => {
  const body = (await c.req.json()) as {
    taskId: string;
    status: 'success' | 'failed' | 'cancelled';
    summary: string;
    outputArtifactIds?: string[];
  };
  if (!body.taskId || !body.status) {
    return c.json({ error: 'taskId, status required' }, 400);
  }
  const result = recordAgentResult({
    taskId: body.taskId,
    status: body.status,
    summary: body.summary ?? '',
    outputArtifactIds: body.outputArtifactIds ?? [],
  });
  return c.json({ ok: true, result }, 201);
});

runnerEvents.post('/context-request', async (c) => {
  const body = (await c.req.json()) as {
    workflowRunId: string;
    request: ContextRequest;
    sourceName?: string;
    taskId?: string;
    baseContextPackId?: string;
    supplementContextPackId?: string;
    requestArtifactId?: string;
    supplementArtifactId?: string;
  };
  if (
    !body.workflowRunId
    || !body.request?.id
    || !body.taskId
    || !body.baseContextPackId
    || !body.supplementContextPackId
    || !body.requestArtifactId
    || !body.supplementArtifactId
  ) {
    return c.json({
      error: 'workflowRunId, request.id, taskId, baseContextPackId, supplementContextPackId, requestArtifactId, supplementArtifactId required',
    }, 400);
  }
  if (!store.workflowRuns.has(body.workflowRunId)) {
    return c.json({ error: `workflow run not found: ${body.workflowRunId}` }, 404);
  }
  const chainError = validateContextRequestChain(body.workflowRunId, {
    taskId: body.taskId,
    requestArtifactId: body.requestArtifactId,
    supplementArtifactId: body.supplementArtifactId,
  });
  if (chainError) return c.json({ error: chainError }, 400);
  const requestError = validateContextRequestPayload(body.workflowRunId, body.request);
  if (requestError) {
    return c.json({ error: requestError }, 400);
  }
  const action = recordContextRequestAction({
    workflowRunId: body.workflowRunId,
    request: body.request,
    sourceName: body.sourceName ?? 'unknown',
    taskId: body.taskId,
    baseContextPackId: body.baseContextPackId,
    supplementContextPackId: body.supplementContextPackId,
    requestArtifactId: body.requestArtifactId,
    supplementArtifactId: body.supplementArtifactId,
  });
  return c.json({ ok: true, action }, 201);
});

function validateContextRequestChain(
  workflowRunId: string,
  ids: {
    taskId: string;
    requestArtifactId: string;
    supplementArtifactId: string;
  },
): string | null {
  const task = store.agentTasks.get(ids.taskId);
  if (!task || task.workflowRunId !== workflowRunId) {
    return 'taskId must reference an agent task on this workflow run';
  }
  const requestArtifact = store.artifacts.get(ids.requestArtifactId);
  if (!requestArtifact || requestArtifact.workflowRunId !== workflowRunId) {
    return 'requestArtifactId must reference an artifact on this workflow run';
  }
  const supplementArtifact = store.artifacts.get(ids.supplementArtifactId);
  if (!supplementArtifact || supplementArtifact.workflowRunId !== workflowRunId) {
    return 'supplementArtifactId must reference an artifact on this workflow run';
  }
  return null;
}

function validateContextRequestPayload(
  workflowRunId: string,
  request: ContextRequest,
): string | null {
  if (request.workflowRunId !== workflowRunId) {
    return 'request.workflowRunId must match workflowRunId';
  }
  if (typeof request.reason !== 'string' || request.reason.trim().length === 0) {
    return 'request.reason required';
  }
  if (!isWorkflowStageValue(request.stage)) {
    return 'request.stage invalid';
  }
  if (!Array.isArray(request.requestedRefs) || !request.requestedRefs.every(isNonEmptyString)) {
    return 'request.requestedRefs must be an array of non-empty strings';
  }
  if (!Array.isArray(request.questions) || !request.questions.every(isNonEmptyString)) {
    return 'request.questions must be an array of non-empty strings';
  }
  if (request.requestedRefs.length === 0 && request.questions.length === 0) {
    return 'request must include requestedRefs or questions';
  }
  if (request.priority !== 1 && request.priority !== 2 && request.priority !== 3) {
    return 'request.priority must be 1, 2, or 3';
  }
  if (!isContextRequestStatus(request.status)) {
    return 'request.status invalid';
  }
  if (typeof request.createdAt !== 'string' || Number.isNaN(Date.parse(request.createdAt))) {
    return 'request.createdAt must be an ISO timestamp';
  }
  return null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

const WORKFLOW_STAGE_VALUES = [
  'init',
  'context_pack',
  'requirement',
  'design',
  'implementation',
  'build_test',
  'review',
  'completion',
  'knowledge',
  'report',
  'analyze',
  'scan',
  'plan',
] as const satisfies readonly WorkflowStage[];

function isWorkflowStageValue(value: unknown): value is WorkflowStage {
  return typeof value === 'string'
    && (WORKFLOW_STAGE_VALUES as readonly string[]).includes(value);
}

runnerEvents.post('/maven-build', async (c) => {
  const body = (await c.req.json()) as MavenBuildEvent;
  const result = recordMavenBuild(body);
  return c.json({ ok: true, ...result });
});

runnerEvents.post('/artifact', async (c) => {
  const body = (await c.req.json()) as {
    workflowRunId: string;
    stepRunId: string | null;
    kind: ArtifactKind;
    uri: string;
    size: number;
    contentType: string;
    metadata?: Record<string, unknown>;
  };
  try {
    // V2 P0-1: confused-tier protection. The /runner/events/artifact entrypoint
    // is for per-run artifacts only. Knowledge kinds must go through
    // POST /knowledge-artifacts/projects/:projectId.
    if (!isPerRunArtifactKind(body.kind)) {
      return c.json(
        {
          error: `kind '${String(body.kind)}' is not a PerRunArtifactKind. Use POST /knowledge-artifacts/projects/:projectId for knowledge artifacts.`,
        },
        400,
      );
    }
    if (body.uri.startsWith('file://')) assertReadableFileUri(body.uri);
    const a = createArtifact({
      workflowRunId: body.workflowRunId,
      stepRunId: body.stepRunId,
      kind: body.kind,
      uri: body.uri,
      size: body.size,
      contentType: body.contentType,
      metadata: body.metadata ?? {},
    });
    return c.json({ ok: true, artifact: a });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

runnerEvents.post('/run-gate', async (c) => {
  const body = (await c.req.json()) as {
    workflowRunId: string;
    stepRunId: string | null;
    gateId: GateRun['gateId'];
    params?: { changedFiles?: string[]; allowedPrefixes?: string[] };
  };
  let gate: GateRun;
  switch (body.gateId) {
    case 'requirement_gate': {
      const a = latestMarkdownArtifact(body.workflowRunId, 'requirement_draft');
      gate = runRequirementGate({
        workflowRunId: body.workflowRunId,
        stepRunId: body.stepRunId,
        artifact: a,
      });
      break;
    }
    case 'design_gate': {
      const a = latestMarkdownArtifact(body.workflowRunId, 'design_doc');
      gate = runDesignGate({
        workflowRunId: body.workflowRunId,
        stepRunId: body.stepRunId,
        artifact: a,
      });
      break;
    }
    case 'diff_scope_gate': {
      const diff = store.artifacts.byKind(body.workflowRunId, 'diff').at(-1) ?? null;
      gate = runDiffScopeGate({
        workflowRunId: body.workflowRunId,
        stepRunId: body.stepRunId,
        changedFiles: body.params?.changedFiles ?? [],
        allowedPrefixes: body.params?.allowedPrefixes ?? ['src/'],
        diffArtifact: diff,
      });
      break;
    }
    case 'sensitive_change_gate': {
      const diff = store.artifacts.byKind(body.workflowRunId, 'diff').at(-1) ?? null;
      gate = runSensitiveChangeGate({
        workflowRunId: body.workflowRunId,
        stepRunId: body.stepRunId,
        changedFiles: body.params?.changedFiles ?? [],
        diffArtifact: diff,
      });
      break;
    }
    case 'acceptance_gate': {
      gate = runAcceptanceTraceabilityGate({
        workflowRunId: body.workflowRunId,
        stepRunId: body.stepRunId,
      });
      break;
    }
    default:
      return c.json(
        { error: `gate ${body.gateId} not supported via /run-gate (manual gates use /approvals)` },
        400,
      );
  }
  return c.json({ ok: true, gate });
});

function latestMarkdownArtifact(workflowRunId: string, kind: ArtifactKind) {
  const artifacts = store.artifacts.byKind(workflowRunId, kind);
  return (
    artifacts
      .filter(
        (artifact) =>
          artifact.contentType.includes('markdown') ||
          (typeof artifact.metadata.output === 'string' && artifact.metadata.output.endsWith('.md')),
      )
      .at(-1) ??
    artifacts.at(-1) ??
    null
  );
}
