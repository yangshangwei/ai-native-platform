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
    createdAt: new Date().toISOString(),
    metadata: {},
  };

  const content = readArtifactContent(artifact);

  expect(content.text).toContain('AC-001');
  expect(content.contentType).toBe('text/markdown');
  expect(content.filename).toBe('requirement.md');
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
    createdAt: new Date().toISOString(),
    metadata: {},
  };

  expect(() => readArtifactContent(artifact)).toThrow(/Only file artifacts/);
});
