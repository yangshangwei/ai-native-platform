import { Hono } from 'hono';
import { projects } from './routes/projects';
import { workflowRuns } from './routes/workflow-runs';
import { workflowRequests } from './routes/workflow-requests';
import { runnerEvents } from './routes/runner-events';
import { approvals } from './routes/approvals';
import { runners } from './routes/runners';
import { artifacts } from './routes/artifacts';
import { commandRuns } from './routes/command-runs';
import { runnerControl } from './routes/runner-control';
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
