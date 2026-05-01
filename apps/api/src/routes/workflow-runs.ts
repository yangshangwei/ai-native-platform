import { Hono } from 'hono';
import type { WorkflowRunType } from '@ainp/shared';
import { store } from '../store/store';
import { createWorkflowRun } from '../workflow-engine';
import { generateCompletionReport, generateKnowledgeCandidate } from '../reports';

export const workflowRuns = new Hono();

workflowRuns.get('/', (c) => {
  const projectId = c.req.query('projectId');
  const items = projectId
    ? store.workflowRunsByProject(projectId)
    : [...store.workflowRuns.values()];
  return c.json({ items });
});

workflowRuns.post('/', async (c) => {
  const body = (await c.req.json()) as {
    projectId?: string;
    projectName?: string;
    type?: WorkflowRunType;
    title?: string;
  };

  let projectId = body.projectId;
  if (!projectId && body.projectName) {
    projectId = store.projectByName(body.projectName)?.id;
  }
  if (!projectId) return c.json({ error: 'projectId or projectName required' }, 400);
  if (!store.projects.has(projectId)) {
    return c.json({ error: `project ${projectId} not registered` }, 404);
  }
  if (!body.title) return c.json({ error: 'title required' }, 400);

  const run = createWorkflowRun({
    projectId,
    type: body.type ?? 'smoke',
    title: body.title,
  });
  return c.json(run, 201);
});

workflowRuns.get('/:id', (c) => {
  const id = c.req.param('id');
  const run = store.workflowRuns.get(id);
  if (!run) return c.json({ error: 'not found' }, 404);
  const steps = store.stepRuns.byWorkflow(id);
  const commands = store.commandRunsByWorkflow(id);
  const gates = store.gateRuns.byWorkflow(id);
  const artifacts = store.artifacts.byWorkflow(id);
  const builds = store.buildRuns.byWorkflow(id);
  const tests = builds.flatMap((b) => store.testRuns.byBuild(b.id));
  const approvals = store.approvals.byWorkflow(id);
  const audit = store.auditLog.byWorkflow(id);
  return c.json({ run, steps, commands, gates, artifacts, builds, tests, approvals, audit });
});

workflowRuns.post('/:id/completion-report', async (c) => {
  const id = c.req.param('id');
  if (!store.workflowRuns.has(id)) return c.json({ error: 'not found' }, 404);
  const artifact = await generateCompletionReport(id);
  return c.json({ ok: true, artifact }, 201);
});

workflowRuns.post('/:id/knowledge-candidate', async (c) => {
  const id = c.req.param('id');
  if (!store.workflowRuns.has(id)) return c.json({ error: 'not found' }, 404);
  const artifact = await generateKnowledgeCandidate(id);
  return c.json({ ok: true, artifact }, 201);
});
