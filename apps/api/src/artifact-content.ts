import { basename, dirname, resolve, sep } from 'node:path';
import { readFileSync, realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { fileUriToPath, normalizePathForComparison, type Artifact } from '@ainp/shared';
import { verifyFileSha256, type DigestVerification } from '@ainp/shared/node';

export interface ArtifactContent {
  text: string;
  contentType: string;
  filename: string;
  digest: DigestVerification;
}

const allowedArtifactRoots = [
  process.env.AINP_ARTIFACTS_DIR,
  process.env.AINP_REPORTS_DIR,
  process.env.AINP_HOME,
  resolve(homedir(), '.ai-native'),
  process.env.NODE_ENV === 'test' || process.env.VITEST ? tmpdir() : null,
].filter((root): root is string => Boolean(root));

export function readArtifactContent(artifact: Artifact): ArtifactContent {
  return readFileUriContent(artifact.uri, artifact.contentType, artifact.sha256 ?? null);
}

export function readFileUriContent(
  uri: string,
  contentType = 'text/plain',
  expectedSha256: string | null = null,
): ArtifactContent {
  const path = resolveReadableFileUri(uri);
  return {
    text: readFileSync(path, 'utf8'),
    contentType,
    filename: basename(path),
    digest: verifyFileSha256(path, expectedSha256),
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
  const path = fileUriToPath(uri);
  const realPath = realpathSync(path);
  const realDir = realpathSync(dirname(realPath));
  if (!allowedArtifactRoots.some((root) => isWithinResolvedRoot(realDir, root))) {
    throw new Error('File artifact path is outside the allowed local artifact roots');
  }
  return realPath;
}

export function resolvedReadableFileUriForDigest(uri: string): string {
  return resolveReadableFileUri(uri);
}

function isWithinResolvedRoot(path: string, root: string): boolean {
  try {
    const realRoot = realpathSync(root);
    const normalizedPath = normalizePathForComparison(path);
    const normalizedRoot = normalizePathForComparison(realRoot);
    return normalizedPath === normalizedRoot || normalizedPath.startsWith(normalizedRoot + '/');
  } catch {
    return false;
  }
}
