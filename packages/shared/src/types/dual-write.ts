import type { ArtifactId, ProjectId } from './ids';

// ---------------------------------------------------------------------------
// Dual-write contract types (V2 P1-1)
//
// V2 § 3.1 sets file-as-source-of-truth, DB-as-index. The promote
// transaction (apps/api/src/promote.ts) renders an entity markdown file
// alongside the DB writes; runtime and disk shapes share the same TS
// contract defined here.
//
// The PRD lives at
// `.trellis/tasks/05-04-v2-dual-write-pipeline/prd.md` (ADR-lite Q2 / Q6).
// ---------------------------------------------------------------------------

/**
 * Entity kinds eligible for dual-write in this task. Subset of
 * {@link KnowledgeArtifactKind} corresponding to entity tables built in
 * V2 P0-2 (`requirements` / `designs`). Other knowledge kinds
 * (architecture / roadmap / decision / lesson / ...) are out of scope
 * for P1-1 — they get added in P0-2.5 / P1-1.5.
 */
export type DualWriteEntityKind = 'requirement' | 'design';

/**
 * Lifecycle status carried in entity-file frontmatter. P1-1 only writes
 * `accepted` rows — drafts and archived entities live in DB only.
 */
export type EntityFileStatus = 'accepted';

/**
 * Strongly-typed core frontmatter every entity file carries. Snake_case
 * field names are intentional: this dictionary maps directly to the YAML
 * key names that appear on disk (R15 / R16).
 *
 * `ref_req` is required for `kind === 'design'` and absent for
 * `kind === 'requirement'`. Enforced at the type level via the
 * {@link EntityFileFrontmatter} discriminated union.
 */
export interface EntityFileFrontmatterCore {
  entity_id: string;
  kind: DualWriteEntityKind;
  status: EntityFileStatus;
  version: number;
  updated_at: string;
  knowledge_artifact_id: ArtifactId;
}

/**
 * Frontmatter for a `requirement` entity file.
 */
export interface RequirementFileFrontmatter extends EntityFileFrontmatterCore {
  kind: 'requirement';
}

/**
 * Frontmatter for a `design` entity file. `ref_req` is the requirement
 * (`requirements.id`) this design realizes — same value the
 * `designs.ref_req` strong FK column carries.
 */
export interface DesignFileFrontmatter extends EntityFileFrontmatterCore {
  kind: 'design';
  ref_req: string;
}

/**
 * Discriminated union of all entity-file frontmatter shapes. Used by
 * the render function as its single input (apart from the body text).
 */
export type EntityFileFrontmatter =
  | RequirementFileFrontmatter
  | DesignFileFrontmatter;

/**
 * Inputs for the pure render function `renderEntityMarkdown(input)`
 * — bundles frontmatter and the raw markdown body that should follow.
 *
 * The `body` is the original `draftText` from `PromoteRequest`. Per R17 /
 * R18 it is **not** parsed, normalized, or merged with the user's
 * existing frontmatter — the renderer just emits the typed core
 * frontmatter, a blank line, then `body` verbatim.
 */
export interface RenderEntityInput {
  frontmatter: EntityFileFrontmatter;
  body: string;
}

/**
 * Inputs for the IO-layer staging function `stageEntityFile(input)`
 * (PR2 of this task — declared here so PR1 / PR2 share the contract).
 *
 * `projectLocalPath` corresponds to `Project.localPath` (the project's
 * git working tree root). The staged tmp file is written under
 * `<projectLocalPath>/codestable/<kind-plural>/`.
 */
export interface StageEntityFileInput {
  projectLocalPath: string;
  projectId: ProjectId;
  entityKind: DualWriteEntityKind;
  /** The frontmatter + body to render onto disk. */
  contents: RenderEntityInput;
  /**
   * Best-effort entity_id guess for tmp file name disambiguation. The
   * authoritative entity_id is decided inside the DB transaction; the
   * IO layer's `finalize(finalEntityId, finalKnowledgeArtifactId)` call
   * re-renders frontmatter + renames to the final filename.
   */
  entityIdHint: string;
}
