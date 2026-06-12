import { describe, expect, test } from 'vitest';
import type { Artifact } from '@ainp/shared';
import {
  acceptanceCriterionIdsFromInputs,
  safeVerifierFilename,
  shouldRequireUiVerifier,
  verifierContentType,
  verifierMediaSatisfiesCoverage,
  verifierRoleForFilename,
  type PersistedVerifierMediaArtifact,
} from '../src/orchestrator/verifier-media';

// ---------------------------------------------------------------------------
// T3.1 de-closure: these pure functions were file-private inside
// orchestrator.ts with no direct tests (the research report's "already
// exported + tested" premise only held after this refactor exported them).
// Now that they form the `orchestrator/verifier-media` module surface, pin
// their contracts directly.
// ---------------------------------------------------------------------------

function media(role: PersistedVerifierMediaArtifact['role']): PersistedVerifierMediaArtifact {
  return { artifact: { id: `art_${role}` } as unknown as Artifact, role };
}

describe('shouldRequireUiVerifier', () => {
  test.each([
    'Fix button alignment on the settings page',
    'Improve frontend responsiveness',
    '优化前端页面样式',
    '修复表单按钮交互',
  ])('UI-shaped title requires verifier: %s', (title) => {
    expect(shouldRequireUiVerifier(title)).toBe(true);
  });

  test.each([
    'Refactor gate engine internals',
    'Speed up Maven build caching',
  ])('non-UI title does not require verifier: %s', (title) => {
    expect(shouldRequireUiVerifier(title)).toBe(false);
  });
});

describe('verifierContentType', () => {
  test.each([
    ['shot.png', 'image/png'],
    ['shot.JPG', 'image/jpeg'],
    ['shot.jpeg', 'image/jpeg'],
    ['shot.webp', 'image/webp'],
    ['clip.webm', 'video/webm'],
    ['clip.mp4', 'video/mp4'],
    ['clip.mov', 'video/quicktime'],
    ['notes.txt', null],
  ] as const)('%s -> %s', (filename, expected) => {
    expect(verifierContentType(filename)).toBe(expected);
  });
});

describe('verifierRoleForFilename', () => {
  test('video content type always maps to video role', () => {
    expect(verifierRoleForFilename('anything.webm', 'video/webm')).toBe('video');
  });

  test('before/after keyword images map to screenshot roles', () => {
    expect(verifierRoleForFilename('before-login.png', 'image/png')).toBe('screenshot_before');
    expect(verifierRoleForFilename('login_after.png', 'image/png')).toBe('screenshot_after');
    expect(verifierRoleForFilename('baseline.png', 'image/png')).toBe('screenshot_before');
    expect(verifierRoleForFilename('result.png', 'image/png')).toBe('screenshot_after');
  });

  test('unrecognized image names and missing content type yield null', () => {
    expect(verifierRoleForFilename('screenshot.png', 'image/png')).toBeNull();
    expect(verifierRoleForFilename('before.png', null)).toBeNull();
    expect(verifierRoleForFilename('before.txt', 'text/plain')).toBeNull();
  });
});

describe('verifierMediaSatisfiesCoverage', () => {
  test('video alone satisfies coverage', () => {
    expect(verifierMediaSatisfiesCoverage([media('video')])).toBe(true);
  });

  test('before+after screenshot pair satisfies coverage', () => {
    expect(verifierMediaSatisfiesCoverage([
      media('screenshot_before'),
      media('screenshot_after'),
    ])).toBe(true);
  });

  test('before-only screenshot or empty set does not satisfy coverage', () => {
    expect(verifierMediaSatisfiesCoverage([media('screenshot_before')])).toBe(false);
    expect(verifierMediaSatisfiesCoverage([])).toBe(false);
  });
});

describe('acceptanceCriterionIdsFromInputs', () => {
  test('collects unique sorted AC ids across inputs, capped at 50', () => {
    expect(acceptanceCriterionIdsFromInputs({
      'requirement.md': 'AC-002 then AC-001 then AC-002 again',
      'design.md': 'covers AC-010',
    })).toEqual(['AC-001', 'AC-002', 'AC-010']);
  });

  test('falls back to AC-UI-001 when no ids are present', () => {
    expect(acceptanceCriterionIdsFromInputs({ 'notes.md': 'no criteria here' }))
      .toEqual(['AC-UI-001']);
  });
});

describe('safeVerifierFilename', () => {
  test('replaces unsafe characters and keeps safe ones', () => {
    expect(safeVerifierFilename('登录 before/after.png')).toBe('___before_after.png');
    expect(safeVerifierFilename('shot_after-v2.png')).toBe('shot_after-v2.png');
  });
});
