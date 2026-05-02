import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, expect, test } from 'vitest';
import { newId, nowIso, type Project } from '@ainp/shared';

process.env.AINP_DB_PATH = join(mkdtempSync(join(tmpdir(), 'ainp-report-sidecars-')), 'ainp.sqlite');
process.env.AINP_REPORTS_DIR = mkdtempSync(join(tmpdir(), 'ainp-reports-'));

let app: Awaited<typeof import('../src/app')>['app'];
let workflow: typeof import('../src/workflow-engine');
let storeMod: typeof import('../src/store/store');

beforeAll(async () => {
  ({ app } = await import('../src/app'));
  workflow = await import('../src/workflow-engine');
  storeMod = await import('../src/store/store');
});

function seedRun() {
  const project: Project = {
    id: newId('proj'),
    name: `report-sidecar-project-${Date.now()}`,
    localPath: '/tmp/report-sidecar-project',
    language: 'java',
    buildTool: 'maven',
    defaultBranch: 'main',
    registeredAt: nowIso(),
  };
  storeMod.store.projects.set(project.id, project);
  return workflow.createWorkflowRun({ projectId: project.id, type: 'feature', title: 'report sidecar test' });
}

test('completion report route emits markdown plus structured JSON sidecar artifacts', async () => {
  const run = seedRun();
  const res = await app.request(`/workflow-runs/${run.id}/completion-report`, { method: 'POST' });

  expect(res.status).toBe(201);
  const body = (await res.json()) as {
    artifact: { id: string; kind: string; contentType: string };
    sidecar: { id: string; kind: string; contentType: string; metadata: Record<string, unknown> };
  };
  expect(body.artifact).toMatchObject({ kind: 'completion_report', contentType: 'text/markdown' });
  expect(body.sidecar).toMatchObject({
    kind: 'completion_report',
    contentType: 'application/json',
    metadata: { structured: true, schemaVersion: 'ainp.completion_report.v1' },
  });

  const json = await app.request(`/artifacts/${body.sidecar.id}/content`);
  const parsed = JSON.parse(((await json.json()) as { text: string }).text) as { schemaVersion: string; sections: unknown[] };
  expect(parsed.schemaVersion).toBe('ainp.completion_report.v1');
  expect(parsed.sections.length).toBeGreaterThan(0);
});

test('knowledge candidate route emits markdown plus structured JSON sidecar artifacts', async () => {
  const run = seedRun();
  const res = await app.request(`/workflow-runs/${run.id}/knowledge-candidate`, { method: 'POST' });

  expect(res.status).toBe(201);
  const body = (await res.json()) as {
    artifact: { id: string; kind: string; contentType: string };
    sidecar: { id: string; kind: string; contentType: string; metadata: Record<string, unknown> };
  };
  expect(body.artifact).toMatchObject({ kind: 'knowledge_candidate', contentType: 'text/markdown' });
  expect(body.sidecar).toMatchObject({
    kind: 'knowledge_candidate',
    contentType: 'application/json',
    metadata: { structured: true, schemaVersion: 'ainp.knowledge_candidate.v1' },
  });

  const json = await app.request(`/artifacts/${body.sidecar.id}/content`);
  const parsed = JSON.parse(((await json.json()) as { text: string }).text) as { schemaVersion: string; suggestions: unknown[] };
  expect(parsed.schemaVersion).toBe('ainp.knowledge_candidate.v1');
  expect(parsed.suggestions.length).toBeGreaterThan(0);
});
