import { Hono } from 'hono';
import type {
  CommandRun,
  WorkflowStage,
  ArtifactKind,
  GateRun,
  AgentStreamEventInput,
  AgentBackendKind,
  AgentTaskKind,
} from '@ainp/shared';
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
