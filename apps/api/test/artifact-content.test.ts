import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { Artifact } from '@ainp/shared';
import { readArtifactContent } from '../src/artifact-content';

test('reads local file artifact content for UI rendering', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ainp-artifact-content-'));
  const path = join(dir, 'requirement.md');
  writeFileSync(path, '# Requirement\n\n- AC-001: Works\n', 'utf8');
  const artifact: Artifact = {
    id: 'art_content',
    kind: 'requirement_draft',
    uri: `file://${path}`,
    workflowRunId: 'run_content',
    stepRunId: 'step_content',
    size: 1,
    contentType: 'text/markdown',
    sha256: sha256('# Requirement\n\n- AC-001: Works\n'),
    createdAt: new Date().toISOString(),
    metadata: {},
  };

  const content = readArtifactContent(artifact);

  expect(content.text).toContain('AC-001');
  expect(content.contentType).toBe('text/markdown');
  expect(content.filename).toBe('requirement.md');
  expect(content.digest.verified).toBe(true);
});

test('detects local file artifact digest mismatch', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ainp-artifact-digest-'));
  const path = join(dir, 'report.md');
  writeFileSync(path, 'original\n', 'utf8');
  const artifact: Artifact = {
    id: 'art_digest',
    kind: 'completion_report',
    uri: `file://${path}`,
    workflowRunId: 'run_digest',
    stepRunId: null,
    size: 9,
    contentType: 'text/markdown',
    sha256: sha256('original\n'),
    createdAt: new Date().toISOString(),
    metadata: {},
  };

  writeFileSync(path, 'tampered\n', 'utf8');

  const content = readArtifactContent(artifact);
  expect(content.digest).toMatchObject({
    expected: sha256('original\n'),
    actual: sha256('tampered\n'),
    verified: false,
  });
});

test('rejects non-file artifacts for content reads', () => {
  const artifact: Artifact = {
    id: 'art_remote',
    kind: 'other',
    uri: 'https://example.test/artifact.md',
    workflowRunId: 'run_content',
    stepRunId: null,
    size: 1,
    contentType: 'text/markdown',
    sha256: null,
    createdAt: new Date().toISOString(),
    metadata: {},
  };

  expect(() => readArtifactContent(artifact)).toThrow(/Only file artifacts/);
});

test('rejects file artifacts outside allowed local roots', () => {
  const artifact: Artifact = {
    id: 'art_forbidden',
    kind: 'other',
    uri: 'file:///etc/hosts',
    workflowRunId: 'run_content',
    stepRunId: null,
    size: 1,
    contentType: 'text/plain',
    sha256: null,
    createdAt: new Date().toISOString(),
    metadata: {},
  };

  expect(() => readArtifactContent(artifact)).toThrow(/outside the allowed local artifact roots/);
});

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
