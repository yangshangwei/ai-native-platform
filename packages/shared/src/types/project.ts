import type { Iso8601, ProjectId } from './ids';

export type ProjectLanguage = 'java' | 'unknown';
export type ProjectBuildTool = 'maven' | 'unknown';

export interface Project {
  id: ProjectId;
  name: string;
  /** Absolute local path of the source git repo on the runner host. */
  localPath: string;
  language: ProjectLanguage;
  buildTool: ProjectBuildTool;
  defaultBranch: string;
  registeredAt: Iso8601;
}
