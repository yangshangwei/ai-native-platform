import { createHash } from 'node:crypto';

export const SOURCE_CHUNK_INDEX_LOCAL_EMBEDDING_MODEL = 'ainp-local-source-chunk-lexical-v1';
export const SOURCE_CHUNK_INDEX_LOCAL_EMBEDDING_DIMENSIONS = 32;
export const SOURCE_CHUNK_INDEX_LOCAL_EMBEDDING_MAX_INPUT_CHARS = 4096;
export const SOURCE_CHUNK_INDEX_MAX_EMBEDDING_DIMENSIONS = 4096;
export const SOURCE_CHUNK_INDEX_EMBEDDING_URL_ENV = 'AINP_SOURCE_CHUNK_EMBEDDING_URL';
export const SOURCE_CHUNK_INDEX_EMBEDDING_MODEL_ENV = 'AINP_SOURCE_CHUNK_EMBEDDING_MODEL';
export const SOURCE_CHUNK_INDEX_EMBEDDING_API_KEY_ENV = 'AINP_SOURCE_CHUNK_EMBEDDING_API_KEY';
export const SOURCE_CHUNK_INDEX_EMBEDDING_TIMEOUT_MS_ENV = 'AINP_SOURCE_CHUNK_EMBEDDING_TIMEOUT_MS';

const EMBEDDING_TOKEN_LIMIT = 160;
const CONFIGURED_PROVIDER_DEFAULT_TIMEOUT_MS = 10_000;

export type SourceChunkIndexEmbeddingKind = 'source_chunk_index' | 'catalog_query';

export interface SourceChunkIndexEmbedding {
  model: string;
  dimensions: number;
  vector: number[];
}

export interface SourceChunkIndexLocalEmbedding extends SourceChunkIndexEmbedding {
  model: typeof SOURCE_CHUNK_INDEX_LOCAL_EMBEDDING_MODEL;
  dimensions: typeof SOURCE_CHUNK_INDEX_LOCAL_EMBEDDING_DIMENSIONS;
}

export interface SourceChunkIndexEmbeddingProviderInput {
  kind: SourceChunkIndexEmbeddingKind;
  text: string;
}

export interface SourceChunkIndexEmbeddingProvider {
  embed(input: SourceChunkIndexEmbeddingProviderInput):
    | SourceChunkIndexEmbedding
    | null
    | undefined
    | Promise<SourceChunkIndexEmbedding | null | undefined>;
}

type EmbeddingProviderEnv = Record<string, string | undefined>;
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export function sourceChunkIndexConfiguredEmbeddingProvider(
  env: EmbeddingProviderEnv = process.env,
  fetchImpl: FetchLike | undefined = globalThis.fetch?.bind(globalThis),
): SourceChunkIndexEmbeddingProvider | null {
  if (env.VITEST && env.AINP_SOURCE_CHUNK_EMBEDDING_ALLOW_TEST_NETWORK !== '1') return null;
  if (!fetchImpl) return null;

  const endpoint = sourceChunkIndexEmbeddingProviderUrl(env[SOURCE_CHUNK_INDEX_EMBEDDING_URL_ENV]);
  if (!endpoint) return null;

  const configuredModel = boundedConfigString(env[SOURCE_CHUNK_INDEX_EMBEDDING_MODEL_ENV], 120);
  const apiKey = boundedConfigString(env[SOURCE_CHUNK_INDEX_EMBEDDING_API_KEY_ENV], 4096);
  const timeoutMs = configuredProviderTimeoutMs(env[SOURCE_CHUNK_INDEX_EMBEDDING_TIMEOUT_MS_ENV]);

  return {
    async embed(input) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const headers: Record<string, string> = {
          'content-type': 'application/json',
          accept: 'application/json',
        };
        if (apiKey) headers.authorization = `Bearer ${apiKey}`;
        const res = await fetchImpl(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(sourceChunkIndexEmbeddingRequestBody(input, configuredModel)),
          signal: controller.signal,
        });
        if (!res.ok) return null;
        return sourceChunkIndexEmbeddingFromProviderResponse(await res.json(), configuredModel);
      } catch {
        return null;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export function sourceChunkIndexLocalEmbeddingForText(value: string): SourceChunkIndexLocalEmbedding {
  return {
    model: SOURCE_CHUNK_INDEX_LOCAL_EMBEDDING_MODEL,
    dimensions: SOURCE_CHUNK_INDEX_LOCAL_EMBEDDING_DIMENSIONS,
    vector: sourceChunkIndexLocalEmbeddingVectorForText(value),
  };
}

export async function sourceChunkIndexEmbeddingForText(
  value: string,
  options: {
    kind: SourceChunkIndexEmbeddingKind;
    provider?: SourceChunkIndexEmbeddingProvider | null;
  },
): Promise<SourceChunkIndexEmbedding> {
  const text = sourceChunkIndexProviderInputText(value);
  if (options.provider) {
    try {
      const embedding = await options.provider.embed({ kind: options.kind, text });
      const normalized = normalizeSourceChunkIndexEmbedding(embedding);
      if (normalized) return normalized;
    } catch {
      // Provider failures must not block deterministic source-ref backed retrieval.
    }
  }
  return sourceChunkIndexLocalEmbeddingForText(text);
}

export function sourceChunkIndexLocalEmbeddingVectorForText(value: string): number[] {
  const tokens = sourceChunkIndexEmbeddingTokens(value);
  const vector = Array.from({ length: SOURCE_CHUNK_INDEX_LOCAL_EMBEDDING_DIMENSIONS }, () => 0);
  for (const token of tokens) {
    const digest = createHash('sha256')
      .update(SOURCE_CHUNK_INDEX_LOCAL_EMBEDDING_MODEL)
      .update('\0')
      .update(token)
      .digest();
    const index = digest[0]! % SOURCE_CHUNK_INDEX_LOCAL_EMBEDDING_DIMENSIONS;
    const sign = (digest[1]! & 1) === 0 ? 1 : -1;
    const weight = 1 + (digest[2]! % 7) / 10;
    vector[index] = (vector[index] ?? 0) + sign * weight;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0));
  if (!Number.isFinite(magnitude) || magnitude <= 0) {
    vector[0] = 1;
    return vector;
  }
  return vector.map((item) => {
    const normalized = item / magnitude;
    return Number(normalized.toFixed(6));
  });
}

function sourceChunkIndexEmbeddingTokens(value: string): string[] {
  const normalized = value
    .slice(0, SOURCE_CHUNK_INDEX_LOCAL_EMBEDDING_MAX_INPUT_CHARS)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return ['empty'];
  return normalized.split(' ')
    .filter((token) => token.length > 0)
    .slice(0, EMBEDDING_TOKEN_LIMIT);
}

function sourceChunkIndexProviderInputText(value: string): string {
  return sourceChunkIndexEmbeddingTokens(value).join(' ');
}

function normalizeSourceChunkIndexEmbedding(value: unknown): SourceChunkIndexEmbedding | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const model = typeof record.model === 'string' ? record.model.trim() : '';
  if (!model || model.length > 120) return null;
  const vectorValue = record.vector;
  if (!Array.isArray(vectorValue)) return null;
  if (vectorValue.length < 1 || vectorValue.length > SOURCE_CHUNK_INDEX_MAX_EMBEDDING_DIMENSIONS) {
    return null;
  }

  const vector: number[] = [];
  let norm = 0;
  for (const item of vectorValue) {
    if (typeof item !== 'number' || !Number.isFinite(item)) return null;
    vector.push(item);
    norm += item * item;
  }
  if (norm <= 0) return null;

  const dimensions = typeof record.dimensions === 'number' && Number.isInteger(record.dimensions)
    ? record.dimensions
    : vector.length;
  if (dimensions !== vector.length) return null;
  return { model, dimensions, vector };
}

function sourceChunkIndexEmbeddingProviderUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function boundedConfigString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

function configuredProviderTimeoutMs(value: unknown): number {
  if (typeof value !== 'string' || !value.trim()) return CONFIGURED_PROVIDER_DEFAULT_TIMEOUT_MS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return CONFIGURED_PROVIDER_DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(Math.trunc(parsed), 100), 60_000);
}

function sourceChunkIndexEmbeddingRequestBody(
  input: SourceChunkIndexEmbeddingProviderInput,
  configuredModel: string | null,
): Record<string, unknown> {
  if (configuredModel) {
    return {
      model: configuredModel,
      input: input.text,
      kind: input.kind,
    };
  }
  return {
    kind: input.kind,
    text: input.text,
  };
}

function sourceChunkIndexEmbeddingFromProviderResponse(
  value: unknown,
  configuredModel: string | null,
): SourceChunkIndexEmbedding | null {
  const record = isRecord(value) ? value : null;
  if (!record) return null;

  const nested = isRecord(record.embedding) ? record.embedding : null;
  const openAiData = Array.isArray(record.data) && isRecord(record.data[0])
    ? record.data[0]
    : null;
  const candidate = nested ?? openAiData ?? record;
  const vectorValue = candidate.vector ?? candidate.embedding;
  if (!Array.isArray(vectorValue)) return null;
  const model = typeof candidate.model === 'string'
    ? candidate.model
    : typeof record.model === 'string'
      ? record.model
      : configuredModel;
  const dimensions = typeof candidate.dimensions === 'number'
    ? candidate.dimensions
    : typeof candidate.embeddingDimensions === 'number'
      ? candidate.embeddingDimensions
      : vectorValue.length;
  return {
    model: model ?? '',
    dimensions,
    vector: vectorValue as number[],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
