import {
  newId,
  nowIso,
  type ContextRequest,
  type WorkflowStage,
} from '@ainp/shared';

export const CONTEXT_REQUEST_SCHEMA_VERSION = 'ainp.context_request.v1';

export interface ContextRequestSource {
  name: string;
  text: string;
}

export interface ParseContextRequestInput {
  workflowRunId: string;
  stepRunId?: string | null;
  stage: WorkflowStage;
  sources: readonly ContextRequestSource[];
  now?: string;
  idFactory?: () => string;
}

export interface ParsedContextRequest {
  request: ContextRequest;
  sourceName: string;
}

export function parseContextRequestFromAgentOutput(
  input: ParseContextRequestInput,
): ParsedContextRequest | null {
  for (const source of input.sources) {
    const payloads = structuredPayloadsFromSource(source);
    for (const payload of payloads) {
      const request = contextRequestFromPayload(payload, {
        workflowRunId: input.workflowRunId,
        stepRunId: input.stepRunId ?? null,
        stage: input.stage,
        now: input.now ?? nowIso(),
        idFactory: input.idFactory ?? (() => newId('ctxreq')),
      });
      if (request) return { request, sourceName: source.name };
    }
  }
  return null;
}

function structuredPayloadsFromSource(source: ContextRequestSource): unknown[] {
  const text = source.text.trim();
  if (!text) return [];

  const payloads: unknown[] = [];
  if (isJsonArtifact(source.name)) {
    const parsed = safeJsonParse(text);
    if (parsed !== null) payloads.push(parsed);
  }

  for (const block of fencedBlocks(text)) {
    if (block.lang === 'json' || block.lang === 'context_request') {
      const parsed = safeJsonParse(block.body.trim());
      if (parsed !== null) payloads.push(parsed);
    } else if (block.lang === 'yaml' || block.lang === 'yml') {
      const parsed = parseSimpleContextRequestYaml(block.body);
      if (parsed !== null) payloads.push(parsed);
    }
  }

  return payloads;
}

function contextRequestFromPayload(
  payload: unknown,
  context: {
    workflowRunId: string;
    stepRunId: string | null;
    stage: WorkflowStage;
    now: string;
    idFactory: () => string;
  },
): ContextRequest | null {
  const obj = asRecord(payload);
  if (!obj) return null;
  const candidate = asRecord(obj.context_request)
    ?? asRecord(obj.contextRequest)
    ?? (
      obj.type === 'context_request' || obj.kind === 'context_request'
        ? obj
        : null
    );
  if (!candidate) return null;

  const reason = stringField(candidate, 'reason');
  const requestedRefs = collectStringArrayFields(
    candidate,
    ['requestedRefs', 'requested_refs', 'refs'],
  );
  const questions = collectStringArrayFields(candidate, ['questions']);
  if (!requestedRefs.ok || !questions.ok) return null;
  if (!reason || (requestedRefs.value.length === 0 && questions.value.length === 0)) return null;

  const priority = priorityField(candidate);
  if (priority === null) return null;

  return {
    id: context.idFactory(),
    workflowRunId: context.workflowRunId,
    stepRunId: context.stepRunId,
    stage: context.stage,
    reason: boundedString(reason, 1_000),
    requestedRefs: uniqueStrings(requestedRefs.value).map((ref) => boundedString(ref, 240)).slice(0, 8),
    questions: uniqueStrings(questions.value).map((question) => boundedString(question, 500)).slice(0, 8),
    priority,
    status: 'open',
    createdAt: context.now,
  };
}

function fencedBlocks(text: string): Array<{ lang: string; body: string }> {
  const blocks: Array<{ lang: string; body: string }> = [];
  const re = /```([a-zA-Z0-9_-]*)\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    blocks.push({
      lang: (match[1] ?? '').trim().toLowerCase(),
      body: match[2] ?? '',
    });
  }
  return blocks;
}

function parseSimpleContextRequestYaml(text: string): Record<string, unknown> | null {
  const lines = text
    .split('\n')
    .map((line) => line.replace(/\s+#.*$/, ''))
    .filter((line) => line.trim().length > 0);
  const root: Record<string, unknown> = {};
  const hasContextRequestRoot = lines.some((line) => line.trim() === 'context_request:');
  if (!hasContextRequestRoot) return null;
  const target: Record<string, unknown> = {};
  root.context_request = target;

  let currentArray: 'requestedRefs' | 'requested_refs' | 'refs' | 'questions' | null = null;
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (trimmed === 'context_request:') {
      currentArray = null;
      continue;
    }
    if (!/^\s+/.test(raw)) return null;
    if (trimmed.startsWith('- ')) {
      if (!currentArray) return null;
      const list = (target[currentArray] ?? []) as string[];
      list.push(unquote(trimmed.slice(2).trim()));
      target[currentArray] = list;
      continue;
    }
    const match = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(trimmed);
    if (!match) return null;
    const key = match[1] as string;
    const value = match[2] ?? '';
    if (key === 'requestedRefs' || key === 'requested_refs' || key === 'refs' || key === 'questions') {
      if (!value) {
        target[key] = [];
        currentArray = key;
      } else {
        target[key] = parseInlineStringArray(value);
        currentArray = null;
      }
    } else {
      target[key] = key === 'priority' ? Number(value) : unquote(value);
      currentArray = null;
    }
  }
  return root;
}

function parseInlineStringArray(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return [unquote(trimmed)];
  return trimmed
    .slice(1, -1)
    .split(',')
    .map((item) => unquote(item.trim()))
    .filter(Boolean);
}

function isJsonArtifact(name: string): boolean {
  return /\.json$/i.test(name);
}

function safeJsonParse(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringField(obj: Record<string, unknown>, key: string): string | null {
  const value = obj[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function collectStringArrayFields(
  obj: Record<string, unknown>,
  keys: readonly string[],
): { ok: true; value: string[] } | { ok: false } {
  const values: string[] = [];
  for (const key of keys) {
    if (!(key in obj)) continue;
    const parsed = stringArrayField(obj, key);
    if (parsed === null) return { ok: false };
    values.push(...parsed);
  }
  return { ok: true, value: values };
}

function stringArrayField(obj: Record<string, unknown>, key: string): string[] | null {
  const value = obj[key];
  if (!Array.isArray(value)) return null;
  if (!value.every((item) => typeof item === 'string')) return null;
  const strings = value
    .map((item) => item.trim())
    .filter(Boolean);
  return strings;
}

function priorityField(obj: Record<string, unknown>): 1 | 2 | 3 | null {
  if (!('priority' in obj)) return 2;
  const value = obj.priority;
  return value === 1 || value === 2 || value === 3 ? value : null;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function boundedString(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
