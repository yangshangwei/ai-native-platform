import { Hono } from 'hono';
import { projects } from './routes/projects';
import { workflowRuns } from './routes/workflow-runs';
import { runnerEvents } from './routes/runner-events';
import { approvals } from './routes/approvals';
import { runners } from './routes/runners';
import { store } from './store/store';

const app = new Hono();

app.get('/health', (c) =>
  c.json({
    ok: true,
    service: 'ainp-api',
    counts: {
      projects: store.projects.size,
      workflowRuns: store.workflowRuns.size,
      stepRuns: store.stepRuns.size,
      commandRuns: store.commandRuns.size,
      gateRuns: store.gateRuns.size,
    },
  }),
);

app.route('/projects', projects);
app.route('/workflow-runs', workflowRuns);
app.route('/runner/events', runnerEvents);
app.route('/runners', runners);
app.route('/approvals', approvals);

const port = Number(process.env.AINP_API_PORT ?? 8787);
const hostname = process.env.AINP_API_HOST ?? '127.0.0.1';

const server = Bun.serve({ port, hostname, fetch: app.fetch });
console.log(`[api] listening on http://${server.hostname}:${server.port}`);
