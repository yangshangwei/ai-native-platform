import { Hono } from 'hono';
import type { CommandRun, WorkflowStage, ArtifactKind, GateRun } from '@ainp/shared';
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
  type MavenBuildEvent,
} from '../workflow-engine';
import {
  runArtifactPresenceGate,
  runDiffScopeGate,
  runSensitiveChangeGate,
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
      const a = store.artifacts.byKind(body.workflowRunId, 'requirement_draft').at(-1) ?? null;
      gate = runArtifactPresenceGate({
        workflowRunId: body.workflowRunId,
        stepRunId: body.stepRunId,
        gateId: 'requirement_gate',
        artifact: a,
        ruleId: 'requirement.draft_present',
        description: 'requirement_draft artifact',
      });
      break;
    }
    case 'design_gate': {
      const a = store.artifacts.byKind(body.workflowRunId, 'design_doc').at(-1) ?? null;
      gate = runArtifactPresenceGate({
        workflowRunId: body.workflowRunId,
        stepRunId: body.stepRunId,
        gateId: 'design_gate',
        artifact: a,
        ruleId: 'design.doc_present',
        description: 'design_doc artifact',
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
    default:
      return c.json(
        { error: `gate ${body.gateId} not supported via /run-gate (manual gates use /approvals)` },
        400,
      );
  }
  return c.json({ ok: true, gate });
});
