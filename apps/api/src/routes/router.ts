import { Hono } from 'hono';
import type { RouterInput, WorkflowRunType } from '@ainp/shared';
import { recommend } from '../router';
import { store } from '../store/store';

// ---------------------------------------------------------------------------
// V2 W2-4 / PR3 — Smart Router HTTP surface.
//
// `POST /router/recommend` is a pure read-only endpoint exposing the
// rule engine in `../router.ts` so the UI can dry-run a recommendation
// before creating a workflow run. The same `recommend()` is also called
// server-side from `createWorkflowRun()` when `body.flowId` is missing for
// audit/preview parity; ordinary run creation does not silently apply the
// preview's skip recommendation. User-supplied `body.flowId` always wins.
//
// Trust-boundary validation lives here: projectId must reference an
// existing project, and runType must be a known WorkflowRunType. Any
// other validation (FlowId restriction, etc.) lives downstream.
//
// PRD W2-4 R15 / R16 / R17 / R27 + AC-12 / AC-13 / AC-14 / AC-15.
// ---------------------------------------------------------------------------

const KNOWN_RUN_TYPES: readonly WorkflowRunType[] = [
  'feature',
  'bugfix',
  'smoke',
  'refactor',
];

function isWorkflowRunType(value: unknown): value is WorkflowRunType {
  return typeof value === 'string' && (KNOWN_RUN_TYPES as readonly string[]).includes(value);
}

export const router = new Hono();

router.post('/recommend', async (c) => {
  const body = (await c.req.json()) as Partial<RouterInput> & {
    runType?: unknown;
  };

  if (!body.projectId || typeof body.projectId !== 'string') {
    return c.json({ error: 'projectId required' }, 400);
  }
  if (!store.projects.has(body.projectId)) {
    return c.json({ error: `project ${body.projectId} not registered` }, 400);
  }
  if (!body.title || typeof body.title !== 'string') {
    return c.json({ error: 'title required' }, 400);
  }
  if (!isWorkflowRunType(body.runType)) {
    return c.json(
      {
        error: `unknown runType: ${String(body.runType)} (known: ${KNOWN_RUN_TYPES.join(', ')})`,
      },
      400,
    );
  }

  const recommendation = recommend({
    projectId: body.projectId,
    title: body.title,
    runType: body.runType,
    messageHistory: body.messageHistory,
  });
  return c.json(recommendation, 200);
});
