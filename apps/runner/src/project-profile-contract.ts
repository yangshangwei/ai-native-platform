export const PROJECT_PROFILE_SCHEMA_VERSION = 'ainp.project_profile.v1';

export const PROJECT_PROFILE_SCHEMA_VERSION_FIELD = 'schemaVersion';

export const PROJECT_PROFILE_PROVENANCE_FIELDS = [
  'projectId',
  'workflowRunId',
  'inventoryArtifactId',
] as const;

export const PROJECT_PROFILE_REQUIRED_TOP_LEVEL_FIELDS = [
  PROJECT_PROFILE_SCHEMA_VERSION_FIELD,
  ...PROJECT_PROFILE_PROVENANCE_FIELDS,
  'generatedAt',
  'repo',
  'summary',
  'architecture',
  'commands',
  'modules',
  'businessFlows',
  'riskAreas',
  'conventions',
  'domainVocabulary',
  'openQuestions',
  'knowledgeCandidates',
] as const;

export interface ProjectProfileJsonValidationExpected {
  projectId: string;
  workflowRunId: string;
  inventoryArtifactId: string | null;
}

export function validateProjectProfileJson(
  text: string,
  expected: ProjectProfileJsonValidationExpected,
): string {
  const parsed = parseProjectProfileJson(text);
  if (!parsed) {
    throw new Error(`profile: project-profile.json must use schemaVersion ${PROJECT_PROFILE_SCHEMA_VERSION}`);
  }
  const schemaVersion = profileSchemaVersion(parsed);
  if (schemaVersion !== PROJECT_PROFILE_SCHEMA_VERSION) {
    throw new Error(`profile: project-profile.json must use schemaVersion ${PROJECT_PROFILE_SCHEMA_VERSION}`);
  }

  const missing = PROJECT_PROFILE_REQUIRED_TOP_LEVEL_FIELDS.filter((field) =>
    !Object.prototype.hasOwnProperty.call(parsed, field)
  );
  if (missing.length > 0) {
    throw new Error(`profile: project-profile.json missing required top-level field(s): ${missing.join(', ')}`);
  }

  if (parsed.projectId !== expected.projectId) {
    throw new Error(
      `profile: project-profile.json projectId must match current project (expected ${expected.projectId}, got ${profileValueForError(parsed.projectId)})`,
    );
  }
  if (parsed.workflowRunId !== expected.workflowRunId) {
    throw new Error(
      `profile: project-profile.json workflowRunId must match current run (expected ${expected.workflowRunId}, got ${profileValueForError(parsed.workflowRunId)})`,
    );
  }
  if (expected.inventoryArtifactId && parsed.inventoryArtifactId !== expected.inventoryArtifactId) {
    throw new Error(
      `profile: project-profile.json inventoryArtifactId must match project-inventory.json artifact id (expected ${expected.inventoryArtifactId}, got ${profileValueForError(parsed.inventoryArtifactId)})`,
    );
  }

  return schemaVersion;
}

function parseProjectProfileJson(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function profileSchemaVersion(parsed: Record<string, unknown>): string | null {
  return typeof parsed.schemaVersion === 'string' ? parsed.schemaVersion : null;
}

function profileValueForError(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
