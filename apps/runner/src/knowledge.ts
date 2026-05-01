/**
 * Knowledge feedback loop:
 *   - `persistKnowledgeCandidate` copies the just-approved candidate markdown
 *     into the per-project knowledge directory.
 *   - `collectAcceptedKnowledge` reads everything that has been promoted so
 *     the next Context Pack run can quote prior decisions.
 *
 * Storage layout: `~/.ai-native/projects/{projectId}/knowledge/{runId}.md`.
 * Designed to be testable without spinning up the full orchestrator.
 */

import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { profileDirFor } from './profile';

export async function collectAcceptedKnowledge(projectId: string): Promise<string> {
  const dir = join(profileDirFor(projectId), 'knowledge');
  if (!existsSync(dir)) return '';
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return '';
  }
  const mdFiles = entries.filter((f) => f.endsWith('.md')).sort();
  if (mdFiles.length === 0) return '';
  const parts: string[] = [];
  for (const f of mdFiles) {
    try {
      const text = await readFile(join(dir, f), 'utf8');
      parts.push(`### From \`${f}\`\n\n${text.trim()}`);
    } catch {
      // skip unreadable
    }
  }
  return parts.join('\n\n---\n\n');
}

export async function persistKnowledgeCandidate(opts: {
  projectId: string;
  runId: string;
  candidateUri: string;
}): Promise<string | null> {
  if (!opts.candidateUri.startsWith('file://')) return null;
  const src = opts.candidateUri.slice('file://'.length);
  if (!existsSync(src)) return null;
  const destDir = join(profileDirFor(opts.projectId), 'knowledge');
  await mkdir(destDir, { recursive: true });
  const dest = join(destDir, `${opts.runId}.md`);
  await copyFile(src, dest);
  return dest;
}
