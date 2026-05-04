import { randomBytes } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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

// ---------------------------------------------------------------------------
// V2 P1-1 / PR2: IO layer (Stage-then-Finalize)
//
// Two functions implement the dual-write filesystem side:
//
//   1. ensureCodestableDir(projectLocalPath, entityKind):
//      Pre-transaction step. Creates `<projectLocalPath>/codestable/
//      <kind-plural>/` if missing. Returns the absolute directory
//      path. Fail-fast: any disk / permission error surfaces here,
//      before the DB transaction starts.
//
//   2. writeEntityFile({ projectLocalPath, entityKind, entityId,
//      contents }):
//      Post-transaction step. Writes `contents` to
//      `<dir>/<entityId>.md` atomically via a tmp file + rename.
//      Path-safety guard rejects path-traversal entityIds before
//      touching the filesystem (R20).
//
// Failure semantics (R10 / R11 / R-Risk-1):
//
//   - ensureCodestableDir failure (mkdir / permission / disk full)
//     → propagate, DB transaction never starts.
//   - writeEntityFile failure → caller logs the error; DB is already
//     committed, no compensating rollback. Caller MUST capture the
//     `entityId` and `knowledgeArtifactId` in the log line so ops
//     can manually reconcile (R23 / future drift-scan task).
//
// See `.trellis/tasks/05-04-v2-dual-write-pipeline/prd.md` ADR-lite Q3.
// ---------------------------------------------------------------------------

/**
 * Top-level dual-write directory under a project's git working tree.
 * Kept in a constant so PR3 / spec doc / tests reference the same
 * literal — change here, ripple everywhere.
 */
export const CODESTABLE_DIR_NAME = 'codestable';

/**
 * Resolve the absolute directory path for a given project + entity
 * kind, without touching the filesystem.
 *
 *   resolveCodestableDir('/proj', 'requirement') → '/proj/codestable/requirements'
 *   resolveCodestableDir('/proj', 'design')      → '/proj/codestable/designs'
 */
export function resolveCodestableDir(
  projectLocalPath: string,
  entityKind: DualWriteEntityKind,
): string {
  return join(projectLocalPath, CODESTABLE_DIR_NAME, ENTITY_KIND_DIR[entityKind]);
}

/**
 * Resolve the absolute file path for a (project, kind, entity_id)
 * triple. Rejects path-unsafe entity_ids by throwing — call sites
 * must validate via `isPathSafeEntityId` first if they want to
 * surface the error as a typed validation failure (PR3 path).
 */
export function resolveEntityFilePath(
  projectLocalPath: string,
  entityKind: DualWriteEntityKind,
  entityId: string,
): string {
  if (!isPathSafeEntityId(entityId)) {
    throw new Error(
      `entity_id '${entityId}' fails path-safety check ${ENTITY_ID_PATTERN}`,
    );
  }
  return join(resolveCodestableDir(projectLocalPath, entityKind), `${entityId}.md`);
}

/**
 * Pre-transaction step. mkdir -p the entity-kind directory.
 * Fail-fast: any IO error propagates so the caller can abort before
 * the DB transaction starts.
 *
 * Returns the absolute directory path.
 */
export async function ensureCodestableDir(
  projectLocalPath: string,
  entityKind: DualWriteEntityKind,
): Promise<string> {
  const dir = resolveCodestableDir(projectLocalPath, entityKind);
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Post-transaction step. Atomic write of the entity markdown file
 * using a tmp file + rename. Overwrites any existing file at the
 * final path (the rename is the atomic swap).
 *
 * Returns the absolute final path written.
 *
 * Errors:
 *   - throws if `entityId` fails path-safety
 *   - propagates filesystem errors (caller logs + leaves DB committed)
 */
export async function writeEntityFile(input: {
  projectLocalPath: string;
  entityKind: DualWriteEntityKind;
  entityId: string;
  contents: string;
}): Promise<{ finalPath: string }> {
  const finalPath = resolveEntityFilePath(
    input.projectLocalPath,
    input.entityKind,
    input.entityId,
  );
  // Random suffix avoids tmp-file collision if two promotes race on
  // the same final path (the DB write lock will sort one to lose,
  // but both may have queued tmp writes before that resolved).
  const tmpSuffix = randomBytes(6).toString('hex');
  const tmpPath = `${finalPath}.tmp.${tmpSuffix}`;
  try {
    await writeFile(tmpPath, input.contents, 'utf8');
    await rename(tmpPath, finalPath);
    return { finalPath };
  } catch (err) {
    // Best-effort cleanup of the tmp file. Swallow cleanup errors —
    // the original error is what matters.
    await unlink(tmpPath).catch(() => undefined);
    throw err;
  }
}

/**
 * Compensating delete. Best-effort unlink of an entity file at its
 * canonical path. Used by PR3 callers that need to recover after a
 * post-write failure decided to roll back. Swallows ENOENT (file
 * already gone is a success).
 *
 * Returns `{ deleted: true }` if a file was removed, `{ deleted: false }`
 * if the file was already absent.
 */
export async function deleteEntityFile(input: {
  projectLocalPath: string;
  entityKind: DualWriteEntityKind;
  entityId: string;
}): Promise<{ deleted: boolean }> {
  const finalPath = resolveEntityFilePath(
    input.projectLocalPath,
    input.entityKind,
    input.entityId,
  );
  try {
    await unlink(finalPath);
    return { deleted: true };
  } catch (err) {
    // ENOENT — file already absent — is treated as success.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { deleted: false };
    }
    throw err;
  }
}
