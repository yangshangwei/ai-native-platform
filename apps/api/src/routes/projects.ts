import { Hono } from 'hono';
import { newId, nowIso, type Project } from '@ainp/shared';
import { store } from '../store/store';

export const projects = new Hono();

projects.get('/', (c) => c.json({ items: [...store.projects.values()] }));

projects.post('/', async (c) => {
  const body = (await c.req.json()) as Partial<Project> & { name: string; localPath: string };
  if (!body.name || !body.localPath) {
    return c.json({ error: 'name and localPath are required' }, 400);
  }
  const existing = store.projectByName(body.name);
  if (existing) {
    return c.json(existing, 200);
  }
  const project: Project = {
    id: newId('proj'),
    name: body.name,
    localPath: body.localPath,
    language: body.language ?? 'java',
    buildTool: body.buildTool ?? 'maven',
    defaultBranch: body.defaultBranch ?? 'main',
    registeredAt: nowIso(),
  };
  store.projects.set(project.id, project);
  return c.json(project, 201);
});

projects.get('/:id', (c) => {
  const id = c.req.param('id');
  const project = store.projects.get(id) ?? store.projectByName(id);
  if (!project) return c.json({ error: 'not found' }, 404);
  return c.json(project);
});
