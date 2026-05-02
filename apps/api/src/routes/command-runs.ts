import { Hono } from 'hono';
import { store } from '../store/store';
import { readFileUriContent } from '../artifact-content';

export const commandRuns = new Hono();

commandRuns.get('/:id/logs', (c) => {
  const id = c.req.param('id');
  const commandRun = store.commandRuns.get(id);
  if (!commandRun) return c.json({ error: 'not found' }, 404);
  try {
    return c.json({
      commandRun,
      stdout: readFileUriContent(commandRun.stdoutRef, 'text/plain'),
      stderr: readFileUriContent(commandRun.stderrRef, 'text/plain'),
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});
