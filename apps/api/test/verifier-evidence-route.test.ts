import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, expect, test } from 'vitest';
import {
  VERIFIER_AC_MATRIX_SCHEMA_VERSION,
  VERIFIER_MEDIA_SCHEMA_VERSION,
  newId,
  nowIso,
  type Artifact,
  type GateRun,
  type Project,
} from '@ainp/shared';

process.env.AINP_DB_PATH = join(mkdtempSync(join(tmpdir(), 'ainp-verifier-route-')), 'ainp.sqlite');

let app: Awaited<typeof import('../src/app')>['app'];
let workflow: typeof import('../src/workflow-engine');
let storeMod: typeof import('../src/store/store');

beforeAll(async () => {
  ({ app } = await import('../src/app'));
  workflow = await import('../src/workflow-engine');
  storeMod = await import('../src/store/store');
});

test('runner artifact path persists verifier screenshots and matrix for Evidence Gate', async () => {
  const project: Project = {
    id: newId('proj'),
    name: `verifier-route-${Date.now()}`,
    localPath: tmpdir(),
    language: 'java',
    buildTool: 'maven',
    defaultBranch: 'main',
    registeredAt: nowIso(),
  };
  storeMod.store.projects.set(project.id, project);
  const run = workflow.createWorkflowRun({
    projectId: project.id,
    type: 'feature',
    title: 'Update web UI checkout form',
  });

  const dir = mkdtempSync(join(tmpdir(), 'ainp-verifier-route-files-'));
  const beforePath = join(dir, 'AC-001-before.png');
  const afterPath = join(dir, 'AC-001-after.png');
  const matrixPath = join(dir, 'verifier-ac-matrix.json');
  writeFileSync(beforePath, 'before screenshot bytes');
  writeFileSync(afterPath, 'after screenshot bytes');

  const before = await postVerifierArtifact({
    workflowRunId: run.id,
    uri: `file://${beforePath}`,
    size: 23,
    contentType: 'image/png',
    metadata: {
      schemaVersion: VERIFIER_MEDIA_SCHEMA_VERSION,
      reportKind: 'verifier_media',
      verifierArtifactType: 'screenshot_before',
      verifierRequired: true,
    },
  });
  const after = await postVerifierArtifact({
    workflowRunId: run.id,
    uri: `file://${afterPath}`,
    size: 22,
    contentType: 'image/png',
    metadata: {
      schemaVersion: VERIFIER_MEDIA_SCHEMA_VERSION,
      reportKind: 'verifier_media',
      verifierArtifactType: 'screenshot_after',
      verifierRequired: true,
    },
  });
  expect(before.sha256).toBeTruthy();
  expect(after.sha256).toBeTruthy();

  writeFileSync(
    matrixPath,
    `${JSON.stringify({
      schemaVersion: VERIFIER_AC_MATRIX_SCHEMA_VERSION,
      workflowRunId: run.id,
      stepRunId: null,
      verifierRequired: true,
      verifierStatus: 'pass',
      acceptanceCriteria: [
        {
          id: 'AC-001',
          status: 'pass',
          evidenceRefs: [
            { artifactId: before.id, role: 'screenshot_before', claim: 'before screenshot' },
            { artifactId: after.id, role: 'screenshot_after', claim: 'after screenshot' },
          ],
        },
      ],
      createdAt: nowIso(),
    }, null, 2)}\n`,
  );
  const matrix = await postVerifierArtifact({
    workflowRunId: run.id,
    uri: `file://${matrixPath}`,
    size: 1,
    contentType: 'application/json',
    metadata: {
      schemaVersion: VERIFIER_AC_MATRIX_SCHEMA_VERSION,
      reportKind: 'verifier_ac_matrix',
      verifierArtifactType: 'ac_matrix',
      verifierRequired: true,
    },
  });
  expect(matrix.sha256).toBeTruthy();

  const gateRes = await app.request('/runner/events/run-gate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowRunId: run.id,
      stepRunId: null,
      gateId: 'evidence_gate',
    }),
  });

  expect(gateRes.status).toBe(200);
  const body = (await gateRes.json()) as { gate: GateRun };
  expect(body.gate.status).toBe('pass');
  const ruleById = Object.fromEntries(body.gate.ruleResults.map((rule) => [rule.ruleId, rule]));
  expect(ruleById['evidence.ui_verifier_media_refs_present'].status).toBe('pass');
  expect(ruleById['evidence.ui_verifier_artifact_digests_present'].status).toBe('pass');
});

async function postVerifierArtifact(input: {
  workflowRunId: string;
  uri: string;
  size: number;
  contentType: string;
  metadata: Record<string, unknown>;
}): Promise<Artifact> {
  const res = await app.request('/runner/events/artifact', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowRunId: input.workflowRunId,
      stepRunId: null,
      kind: 'other',
      uri: input.uri,
      size: input.size,
      contentType: input.contentType,
      metadata: input.metadata,
    }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { artifact: Artifact }).artifact;
}
