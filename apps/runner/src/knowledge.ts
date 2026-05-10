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
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { profileDirFor } from './profile';

export interface KnowledgePromotionAction {
  targetId: string | null;
  action: string;
  payload: Record<string, unknown>;
}

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
  actions?: KnowledgePromotionAction[];
}): Promise<string | null> {
  if (!opts.candidateUri.startsWith('file://')) return null;
  const src = opts.candidateUri.slice('file://'.length);
  if (!existsSync(src)) return null;
  const destDir = join(profileDirFor(opts.projectId), 'knowledge');
  await mkdir(destDir, { recursive: true });
  const dest = join(destDir, `${opts.runId}.md`);
  if (opts.actions && opts.actions.length > 0) {
    await writeFile(dest, renderCuratedKnowledge(opts.runId, opts.actions), 'utf8');
  } else {
    await copyFile(src, dest);
  }
  return dest;
}

function renderCuratedKnowledge(runId: string, actions: KnowledgePromotionAction[]): string {
  const latestByTarget = new Map<string, KnowledgePromotionAction>();
  actions.forEach((action, index) => {
    latestByTarget.set(action.targetId ?? `__untargeted_${index}`, action);
  });

  const promoted = [...latestByTarget.entries()]
    .filter(([, action]) => action.action === 'accepted' || action.action === 'edited')
    .map(([targetId, action]) => {
      const kind = typeof action.payload.kind === 'string' ? action.payload.kind : 'Lesson';
      const text = typeof action.payload.text === 'string' ? action.payload.text.trim() : '';
      const evidence =
        typeof action.payload.evidence === 'string' ? action.payload.evidence.trim() : '';
      const originalText =
        typeof action.payload.originalText === 'string' ? action.payload.originalText.trim() : '';
      return {
        targetId,
        action: action.action,
        kind,
        text,
        evidence,
        originalText,
      };
    })
    .filter((item) => item.text.length > 0);

  const reviewSignals = [...latestByTarget.entries()]
    .filter(([, action]) => isKnowledgeReviewAction(action.action))
    .map(([targetId, action]) => {
      const reason =
        typeof action.payload.reason === 'string' ? action.payload.reason.trim() : '';
      const evidence =
        typeof action.payload.evidence === 'string' ? action.payload.evidence.trim() : '';
      const targetKnowledgeId =
        typeof action.payload.targetKnowledgeId === 'string'
          ? action.payload.targetKnowledgeId.trim()
          : '';
      const text = typeof action.payload.text === 'string' ? action.payload.text.trim() : '';
      return {
        targetId,
        action: action.action,
        reason,
        evidence,
        targetKnowledgeId,
        text,
      };
    });

  const lines = [
    '# Accepted Knowledge',
    '',
    `- **From workflow run:** \`${runId}\``,
    `- **Promotion mode:** curated human decisions`,
    '',
    '## Promoted entries',
  ];

  if (promoted.length === 0) {
    lines.push('', '_No knowledge entries were accepted or edited for promotion._');
  } else {
    for (const item of promoted) {
      lines.push(
        '',
        `### ${item.targetId}`,
        '',
        `- **Kind:** ${item.kind}`,
        `- **Decision:** ${item.action}`,
        `- **Text:** ${item.text}`,
      );
      if (item.evidence) lines.push(`- **Evidence:** ${item.evidence}`);
      if (item.originalText && item.originalText !== item.text) {
        lines.push(`- **Edited from:** ${item.originalText}`);
      }
    }
  }

  lines.push('', '## Knowledge review signals');

  if (reviewSignals.length === 0) {
    lines.push('', '_No upgrade/downgrade/supersede/stale review signals were recorded._');
  } else {
    for (const signal of reviewSignals) {
      lines.push(
        '',
        `### ${signal.targetId}`,
        '',
        `- **Action:** ${signal.action}`,
      );
      if (signal.targetKnowledgeId) lines.push(`- **Target knowledge:** ${signal.targetKnowledgeId}`);
      if (signal.reason) lines.push(`- **Reason:** ${signal.reason}`);
      if (signal.evidence) lines.push(`- **Evidence:** ${signal.evidence}`);
      if (signal.text) lines.push(`- **Review note:** ${signal.text}`);
      lines.push('- **Effect:** review signal only; no destructive overwrite was applied by the runner.');
    }
  }

  return `${lines.join('\n')}\n`;
}

function isKnowledgeReviewAction(action: string): boolean {
  return action === 'upgrade'
    || action === 'downgrade'
    || action === 'supersede'
    || action === 'mark_stale'
    || action === 'needs_review'
    || action === 'upgrade_candidate'
    || action === 'downgrade_candidate';
}
