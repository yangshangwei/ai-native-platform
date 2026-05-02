import type { Iso8601, ProjectId } from './ids';

export type ProjectLanguage = 'java' | 'unknown';
export type ProjectBuildTool = 'maven' | 'unknown';
export type ProjectSourceKind = 'local' | 'github' | 'gitee' | 'git' | 'gitlab';
export type ProjectSourceAuthKind = 'none' | 'ssh' | 'token' | 'basic';
export type ProjectStatus = 'active' | 'archived';

export interface Project {
  id: ProjectId;
  name: string;
  /**
   * Runner-local source repository path.
   * - local projects: user-provided source git repo path.
   * - remote projects: managed clone path prepared by the runner.
   */
  localPath: string;
  /** Source provider selected at registration. Defaults to local for legacy rows. */
  sourceKind?: ProjectSourceKind;
  /** Remote Git URL for github/gitee/git/gitlab projects; null for local projects. */
  sourceUrl?: string | null;
  /** How the runner should authenticate when probing/fetching the source. */
  sourceAuthKind?: ProjectSourceAuthKind;
  /** Username for basic auth, or optional token username when a provider requires it. */
  sourceUsername?: string | null;
  /** Runner-only credential. API list/register responses redact this field. */
  sourceCredential?: string | null;
  /** Active projects can receive new work; archived projects keep history but reject new work. */
  status?: ProjectStatus;
  archivedAt?: Iso8601 | null;
  language: ProjectLanguage;
  buildTool: ProjectBuildTool;
  defaultBranch: string;
  /** Cached source branches discovered during project detection/refresh. */
  sourceBranches?: string[];
  registeredAt: Iso8601;
}
