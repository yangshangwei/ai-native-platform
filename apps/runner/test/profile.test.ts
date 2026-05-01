import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const TMP = mkdtempSync(join(tmpdir(), 'ainp-profile-'));
process.env.AINP_PROJECTS_DIR = TMP;
process.env.AINP_HOME = TMP;

const SAMPLE_PATH = resolve(__dirname, '..', '..', '..', 'examples', 'java-maven-sample');

describe('generateProjectProfile', () => {
  it('extracts pom + java packages + tests for the sample project', async () => {
    const { generateProjectProfile, loadProjectProfile } = await import('../src/profile');

    const result = await generateProjectProfile({
      projectId: 'proj_test_1',
      name: 'java-sample-test',
      localPath: SAMPLE_PATH,
    });

    expect(result.profile.buildTool).toBe('maven');
    expect(result.profile.language).toBe('java');
    expect(result.profile.pom).not.toBeNull();
    expect(result.profile.pom?.artifactId).toBeTruthy();
    expect(result.profile.topLevelPackages).toContain('sample');
    expect(result.profile.testFiles.length).toBeGreaterThan(0);
    expect(result.profile.readmePreview === null || typeof result.profile.readmePreview === 'string').toBe(true);
    expect(result.markdown).toContain('# Project Profile');
    expect(result.markdown).toContain('Top-level Java packages');

    const cached = await loadProjectProfile('proj_test_1');
    expect(cached?.projectId).toBe('proj_test_1');
    expect(cached?.topLevelPackages).toContain('sample');
  });

  it('reuses the cached profile when reuseIfPresent is true', async () => {
    const { generateProjectProfile } = await import('../src/profile');
    const r1 = await generateProjectProfile({
      projectId: 'proj_test_2',
      name: 'reuse',
      localPath: SAMPLE_PATH,
    });
    // bump time to differentiate generatedAt if it would re-scan
    await new Promise((res) => setTimeout(res, 10));
    const r2 = await generateProjectProfile({
      projectId: 'proj_test_2',
      name: 'reuse',
      localPath: SAMPLE_PATH,
      reuseIfPresent: true,
    });
    expect(r2.profile.generatedAt).toBe(r1.profile.generatedAt);
  });

  it('returns a usable profile even for a non-Maven directory', async () => {
    const { generateProjectProfile } = await import('../src/profile');
    const empty = mkdtempSync(join(tmpdir(), 'ainp-profile-empty-'));
    const result = await generateProjectProfile({
      projectId: 'proj_test_3',
      name: 'empty',
      localPath: empty,
    });
    expect(result.profile.buildTool).toBe('unknown');
    expect(result.profile.language).toBe('unknown');
    expect(result.profile.pom).toBeNull();
    expect(result.profile.topLevelPackages).toEqual([]);
  });
});
