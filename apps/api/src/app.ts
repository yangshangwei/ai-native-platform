import { Hono } from 'hono';
import { projects } from './routes/projects';
import { workflowRuns } from './routes/workflow-runs';
import { workflowRequests } from './routes/workflow-requests';
import { workflowRequestChat } from './routes/workflow-request-chat';
import { runnerEvents } from './routes/runner-events';
import { approvals } from './routes/approvals';
import { runners } from './routes/runners';
import { artifacts } from './routes/artifacts';
import { commandRuns } from './routes/command-runs';
import { runnerControl } from './routes/runner-control';
import { config } from './routes/config';
import { store } from './store/store';

export const app = new Hono();

app.get('/health', (c) =>
  c.json({
    ok: true,
    service: 'ainp-api',
    counts: {
      projects: store.projects.size,
      workflowRequests: store.workflowRequests.size,
      workflowRuns: store.workflowRuns.size,
      stepRuns: store.stepRuns.size,
      commandRuns: store.commandRuns.size,
      gateRuns: store.gateRuns.size,
    },
  }),
);

app.route('/projects', projects);
app.route('/workflow-requests', workflowRequests);
app.route('/workflow-runs', workflowRuns);
app.route('/artifacts', artifacts);
app.route('/command-runs', commandRuns);
app.route('/runner/events', runnerEvents);
app.route('/runner/control', runnerControl);
app.route('/runners', runners);
app.route('/approvals', approvals);
app.route('/config', config);
// Coordinator chat thread + decision persistence (Phase B). Mounted at root
// because its routes already include the full /workflow-requests/:id/messages
// path so they sit alongside the existing workflow-requests endpoints without
// route shadowing.
app.route('/', workflowRequestChat);
