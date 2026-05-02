import { basename, dirname, resolve } from 'node:path';
import { readFileSync, realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import type { Artifact } from '@ainp/shared';

export interface ArtifactContent {
  text: string;
  contentType: string;
  filename: string;
}

const allowedArtifactRoots = [
  process.env.AINP_ARTIFACTS_DIR,
  process.env.AINP_REPORTS_DIR,
  process.env.AINP_HOME,
  resolve(homedir(), '.ai-native'),
  process.env.NODE_ENV === 'test' || process.env.VITEST ? tmpdir() : null,
].filter((root): root is string => Boolean(root));

export function readArtifactContent(artifact: Artifact): ArtifactContent {
  return readFileUriContent(artifact.uri, artifact.contentType);
}

export function readFileUriContent(uri: string, contentType = 'text/plain'): ArtifactContent {
  const path = resolveReadableFileUri(uri);
  return {
    text: readFileSync(path, 'utf8'),
    contentType,
    filename: basename(path),
  };
}

export function readFileUriText(uri: string): string {
  return readFileSync(resolveReadableFileUri(uri), 'utf8');
}

export function assertReadableFileUri(uri: string): void {
  resolveReadableFileUri(uri);
}

function resolveReadableFileUri(uri: string): string {
  if (!uri.startsWith('file://')) {
    throw new Error(`Only file artifacts can be read by the local API: ${uri}`);
  }
  const path = uri.slice('file://'.length);
  const realPath = realpathSync(path);
  const realDir = realpathSync(dirname(realPath));
  if (!allowedArtifactRoots.some((root) => isWithinResolvedRoot(realDir, root))) {
    throw new Error('File artifact path is outside the allowed local artifact roots');
  }
  return realPath;
}

function isWithinResolvedRoot(path: string, root: string): boolean {
  try {
    const realRoot = realpathSync(root);
    return path === realRoot || path.startsWith(`${realRoot}/`);
  } catch {
    return false;
  }
}
