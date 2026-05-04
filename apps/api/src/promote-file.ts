import type {
  DualWriteEntityKind,
  EntityFileFrontmatter,
  RenderEntityInput,
} from '@ainp/shared';

// ---------------------------------------------------------------------------
// V2 P1-1 / PR1: pure rendering of dual-write entity files.
//
// `renderEntityMarkdown` is a pure function — no IO, no clock, no
// randomness. PR2 builds the IO layer (stage / finalize / cleanup) on
// top of this; PR3 wires it into `promoteDraftInTransaction`.
//
// Frontmatter schema is fixed (R15 / R16); the body is `draftText` from
// PromoteRequest, emitted verbatim per R17 / R18 (no parsing, no
// merging with the user's own frontmatter).
//
// See `.trellis/tasks/05-04-v2-dual-write-pipeline/prd.md` ADR-lite Q6.
// ---------------------------------------------------------------------------

/**
 * Maps a {@link DualWriteEntityKind} to the plural directory name used
 * under `<projectRoot>/codestable/`. Keep in sync with PRD R5 / R6.
 *
 *   requirement → 'requirements'
 *   design      → 'designs'
 */
export const ENTITY_KIND_DIR: Record<DualWriteEntityKind, string> = {
  requirement: 'requirements',
  design: 'designs',
};

/**
 * Path-safety guard. Entity IDs that go onto disk MUST match this regex.
 * Rejects directory traversal, weird whitespace, mixed case, and any
 * character that could be misinterpreted by a filesystem.
 *
 *   REQ-001  → match
 *   DSN-042  → match
 *   ../REQ-001 → reject
 *   REQ-001/foo → reject
 *   req-001  → reject (case sensitive)
 */
export const ENTITY_ID_PATTERN: RegExp = /^(REQ|DSN)-\d{1,6}$/;

/**
 * Returns true iff `entityId` is safe to use as a filesystem path
 * component for dual-write.
 */
export function isPathSafeEntityId(entityId: string): boolean {
  return ENTITY_ID_PATTERN.test(entityId);
}

/**
 * Render a single frontmatter line for the typed YAML output. Values
 * containing colons (notably ISO-8601 timestamps) are single-quoted to
 * avoid YAML mis-parsing them as nested mappings.
 */
function renderFrontmatterLine(key: string, value: string | number): string {
  if (typeof value === 'number') return `${key}: ${value}`;
  // Strings: only quote when the value contains characters that YAML
  // would otherwise treat specially (`:` is the common case for ISO
  // timestamps). The set of values we emit is small and known, so a
  // conservative quote-when-needed rule is fine.
  if (/[:#\n]/.test(value)) {
    // Escape any single quotes by doubling them, per YAML 1.2.
    return `${key}: '${value.replace(/'/g, "''")}'`;
  }
  return `${key}: ${value}`;
}

/**
 * Serialize the typed core frontmatter to a YAML block delimited by
 * `---` lines. Field order is stable (entity_id first, then kind,
 * status, version, updated_at, knowledge_artifact_id, optional
 * ref_req) so output is deterministic across calls.
 */
export function renderFrontmatterBlock(fm: EntityFileFrontmatter): string {
  const lines: string[] = ['---'];
  lines.push(renderFrontmatterLine('entity_id', fm.entity_id));
  lines.push(renderFrontmatterLine('kind', fm.kind));
  lines.push(renderFrontmatterLine('status', fm.status));
  lines.push(renderFrontmatterLine('version', fm.version));
  lines.push(renderFrontmatterLine('updated_at', fm.updated_at));
  lines.push(renderFrontmatterLine('knowledge_artifact_id', fm.knowledge_artifact_id));
  if (fm.kind === 'design') {
    lines.push(renderFrontmatterLine('ref_req', fm.ref_req));
  }
  lines.push('---');
  return lines.join('\n');
}

/**
 * Render a complete entity markdown file: typed frontmatter block,
 * blank line, then the verbatim body text.
 *
 * - Always ends with exactly one trailing newline (R17).
 * - Body is appended as-is — no parsing, no merging with any
 *   frontmatter the body itself may contain (R18).
 *
 * Pure function: no IO, no clock, no randomness. Given the same input,
 * always produces the same output.
 */
export function renderEntityMarkdown(input: RenderEntityInput): string {
  const fmBlock = renderFrontmatterBlock(input.frontmatter);
  // Body might already end with a newline; collapse trailing whitespace
  // to a single \n for deterministic output.
  const trimmedBody = input.body.replace(/\s+$/u, '');
  return `${fmBlock}\n\n${trimmedBody}\n`;
}
