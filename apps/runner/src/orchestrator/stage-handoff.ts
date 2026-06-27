import type { ArtifactKind, StageHandoffMetadata } from '@ainp/shared';
import {
  REQUIREMENT_DESIGN_STAGE_HANDOFF_INPUT,
  STAGE_HANDOFF_SCHEMA_VERSION,
} from '@ainp/shared';

const SUMMARY_MAX_CHARS = 600;

interface MarkdownSection {
  heading: string;
  body: string[];
}

export function buildRequirementDesignStageHandoff(input: {
  workflowRunId: string;
  requirementArtifactId: string;
  requirementArtifactKind: ArtifactKind;
  requirementMarkdown: string;
  createdAt: string;
}): StageHandoffMetadata {
  const sections = markdownSections(input.requirementMarkdown);
  return {
    schemaVersion: STAGE_HANDOFF_SCHEMA_VERSION,
    workflowRunId: input.workflowRunId,
    fromStage: 'requirement',
    toStage: 'design',
    summary: extractRequirementSummary(input.requirementMarkdown),
    decisions: bulletsFromSections(sections, isDecisionHeading),
    risks: bulletsFromSections(sections, isRiskHeading),
    openQuestions: bulletsFromSections(sections, isOpenQuestionHeading),
    producedArtifacts: [{
      key: 'requirement.md',
      artifactId: input.requirementArtifactId,
      kind: input.requirementArtifactKind,
      injectionPreference: 'summary',
    }],
    createdAt: input.createdAt,
  };
}

export function renderStageHandoffMarkdown(handoff: StageHandoffMetadata): string {
  return [
    `# Stage Handoff: ${handoff.fromStage} -> ${handoff.toStage}`,
    '',
    '## Summary',
    handoff.summary || 'No summary extracted from upstream stage artifact.',
    '',
    '## Decisions',
    renderBulletList(handoff.decisions),
    '',
    '## Risks',
    renderBulletList(handoff.risks),
    '',
    '## Open Questions',
    renderBulletList(handoff.openQuestions),
    '',
    '## Produced Artifacts',
    ...handoff.producedArtifacts.map((artifact) => (
      `- ${artifact.key}: artifact://${artifact.key}/${artifact.artifactId} (${artifact.injectionPreference}; kind=${artifact.kind})`
    )),
    '',
  ].join('\n');
}

function extractRequirementSummary(markdown: string): string {
  const frontmatterPitch = frontmatterField(markdown, 'pitch');
  if (frontmatterPitch) return truncate(frontmatterPitch, SUMMARY_MAX_CHARS);

  const body = stripFrontmatter(markdown);
  const lines = body.split(/\r?\n/);
  const paragraph: string[] = [];
  let inFence = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !line || /^#{1,6}\s+/.test(line)) {
      if (paragraph.length > 0) break;
      continue;
    }
    if (/^[-*+]\s+/.test(line) || /^\d+[.)]\s+/.test(line)) {
      if (paragraph.length === 0) paragraph.push(line.replace(/^([-*+]|\d+[.)])\s+/, ''));
      break;
    }
    paragraph.push(line);
  }
  const summary = paragraph.join(' ').trim();
  return truncate(summary || 'No textual summary extracted from requirement.md.', SUMMARY_MAX_CHARS);
}

function markdownSections(markdown: string): MarkdownSection[] {
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection | null = null;
  for (const rawLine of stripFrontmatter(markdown).split(/\r?\n/)) {
    const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(rawLine)?.[1]?.trim();
    if (heading) {
      current = { heading, body: [] };
      sections.push(current);
      continue;
    }
    current?.body.push(rawLine);
  }
  return sections;
}

function bulletsFromSections(
  sections: readonly MarkdownSection[],
  matchesHeading: (heading: string) => boolean,
): string[] {
  const bullets = sections
    .filter((section) => matchesHeading(section.heading))
    .flatMap((section) => section.body)
    .map((line) => /^\s*(?:[-*+]\s+|\d+[.)]\s+)(.+?)\s*$/.exec(line)?.[1]?.trim() ?? null)
    .filter((line): line is string => Boolean(line));
  return unique(bullets.map((line) => truncate(line, SUMMARY_MAX_CHARS)));
}

function isDecisionHeading(heading: string): boolean {
  return /decisions?|confirmed|constraints?|acceptance|已确认|约束|验收|边界|范围|目标/i.test(heading);
}

function isRiskHeading(heading: string): boolean {
  return /risks?|风险/i.test(heading);
}

function isOpenQuestionHeading(heading: string): boolean {
  return /open\s*questions?|questions?|未决|待确认|疑问/i.test(heading);
}

function frontmatterField(markdown: string, key: string): string | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (!match) return null;
  const field = new RegExp(`^${escapeRegExp(key)}:\\s*(.+)$`, 'im').exec(match[1] ?? '');
  const value = field?.[1]?.trim().replace(/^['"]|['"]$/g, '');
  return value && value.length > 0 ? value : null;
}

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

function renderBulletList(items: readonly string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : '- (none detected)';
}

function truncate(value: string, maxChars: number): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length <= maxChars ? compact : `${compact.slice(0, maxChars - 3).trimEnd()}...`;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
