import { basename } from 'node:path';
import { readFileSync } from 'node:fs';
import type { Artifact } from '@ainp/shared';

export interface ArtifactContent {
  text: string;
  contentType: string;
  filename: string;
}

export function readArtifactContent(artifact: Artifact): ArtifactContent {
  return readFileUriContent(artifact.uri, artifact.contentType);
}

export function readFileUriContent(uri: string, contentType = 'text/plain'): ArtifactContent {
  if (!uri.startsWith('file://')) {
    throw new Error(`Only file artifacts can be read by the local API: ${uri}`);
  }
  const path = uri.slice('file://'.length);
  return {
    text: readFileSync(path, 'utf8'),
    contentType,
    filename: basename(path),
  };
}
