import { join } from 'node:path';
import { copyFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { Artifact, VerifierMediaRole } from '@ainp/shared';
import { VERIFIER_MEDIA_SCHEMA_VERSION } from '@ainp/shared';
import { api } from '../api-client';
import type { RunCtx } from './types';

export interface PersistedVerifierMediaArtifact {
  artifact: Artifact;
  role: VerifierMediaRole;
}

export async function persistVerifierMediaArtifacts(
  c: RunCtx,
  stepRunId: string,
  verifierDir: string,
): Promise<PersistedVerifierMediaArtifact[]> {
  const sourceDir = join(c.workspace.path, '.ainp-verifier');
  if (!existsSync(sourceDir)) return [];

  const entries = await readdir(sourceDir, { withFileTypes: true });
  const persisted: PersistedVerifierMediaArtifact[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const contentType = verifierContentType(entry.name);
    const role = verifierRoleForFilename(entry.name, contentType);
    if (!contentType || !role) continue;

    const outputName = safeVerifierFilename(entry.name);
    const sourcePath = join(sourceDir, entry.name);
    const destPath = join(verifierDir, outputName);
    await copyFile(sourcePath, destPath);
    const info = await stat(destPath);
    const artifact = await api.postArtifact({
      workflowRunId: c.run.id,
      stepRunId,
      kind: 'other',
      uri: `file://${destPath}`,
      size: info.size,
      contentType,
      metadata: {
        schemaVersion: VERIFIER_MEDIA_SCHEMA_VERSION,
        reportKind: 'verifier_media',
        verifierArtifactType: role,
        verifierRole: role,
        capture: role === 'screenshot_before'
          ? 'before'
          : role === 'screenshot_after'
            ? 'after'
            : undefined,
        stage: 'review',
        subStage: 'verifier',
        output: outputName,
        source: `.ainp-verifier/${entry.name}`,
      },
    });
    persisted.push({ artifact, role });
  }
  return persisted;
}

export function shouldRequireUiVerifier(title: string): boolean {
  return /\b(ui|ux|frontend|front-end|web|browser|dom|css|html|page|screen|modal|button|form|visual|responsive)\b|前端|界面|页面|按钮|表单|截图|浏览器|样式/i
    .test(title);
}

export function acceptanceCriterionIdsFromInputs(inputs: Record<string, string>): string[] {
  const seen = new Set<string>();
  for (const text of Object.values(inputs)) {
    for (const match of text.matchAll(/\bAC-\d{3}\b/g)) {
      seen.add(match[0].toUpperCase());
    }
  }
  const ids = [...seen].sort().slice(0, 50);
  return ids.length > 0 ? ids : ['AC-UI-001'];
}

export function verifierMediaSatisfiesCoverage(
  mediaArtifacts: PersistedVerifierMediaArtifact[],
): boolean {
  const roles = new Set(mediaArtifacts.map((item) => item.role));
  return roles.has('video')
    || (roles.has('screenshot_before') && roles.has('screenshot_after'));
}

export function verifierRoleForFilename(
  filename: string,
  contentType: string | null,
): VerifierMediaRole | null {
  if (!contentType) return null;
  if (contentType.startsWith('video/')) return 'video';
  if (!contentType.startsWith('image/')) return null;
  const normalized = filename.toLowerCase();
  if (/\b(before|baseline|old|previous)\b|(^|[-_.])before([-_.]|$)/i.test(normalized)) {
    return 'screenshot_before';
  }
  if (/\b(after|actual|result|new|current)\b|(^|[-_.])after([-_.]|$)/i.test(normalized)) {
    return 'screenshot_after';
  }
  return null;
}

export function verifierContentType(filename: string): string | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  return null;
}

export function safeVerifierFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
}
