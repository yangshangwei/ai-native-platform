import { describe, expect, test, vi } from 'vitest';
import {
  SOURCE_CHUNK_INDEX_EMBEDDING_MODEL_ENV,
  SOURCE_CHUNK_INDEX_EMBEDDING_URL_ENV,
  sourceChunkIndexConfiguredEmbeddingProvider,
  sourceChunkIndexEmbeddingForText,
} from '../src/source-chunk-embedding';

describe('source chunk embedding provider configuration', () => {
  test('does not configure a network provider without an explicit valid URL', () => {
    expect(sourceChunkIndexConfiguredEmbeddingProvider({}, vi.fn())).toBeNull();
    expect(sourceChunkIndexConfiguredEmbeddingProvider({
      [SOURCE_CHUNK_INDEX_EMBEDDING_URL_ENV]: 'file:///tmp/embedding.sock',
    }, vi.fn())).toBeNull();
    expect(sourceChunkIndexConfiguredEmbeddingProvider({
      [SOURCE_CHUNK_INDEX_EMBEDDING_URL_ENV]: 'not a url',
    }, vi.fn())).toBeNull();
    expect(sourceChunkIndexConfiguredEmbeddingProvider({
      VITEST: 'true',
      [SOURCE_CHUNK_INDEX_EMBEDDING_URL_ENV]: 'https://embedding.example/v1/embeddings',
    }, vi.fn())).toBeNull();
  });

  test('posts bounded lexical text to a configured OpenAI-compatible provider', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL, _init?: RequestInit) => new Response(JSON.stringify({
      data: [{ embedding: [0.25, 0.5, 0.75] }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const provider = sourceChunkIndexConfiguredEmbeddingProvider({
      AINP_SOURCE_CHUNK_EMBEDDING_ALLOW_TEST_NETWORK: '1',
      [SOURCE_CHUNK_INDEX_EMBEDDING_URL_ENV]: 'https://embedding.example/v1/embeddings',
      [SOURCE_CHUNK_INDEX_EMBEDDING_MODEL_ENV]: 'fixture-openai-compatible-v1',
    }, fetchImpl);

    const embedding = await sourceChunkIndexEmbeddingForText(
      'L1: export function approveRefund() { return "refund ledger approval"; }\n{"schemaVersion":"ainp.source_chunk_index.v1"}',
      { kind: 'catalog_query', provider },
    );

    expect(embedding).toEqual({
      model: 'fixture-openai-compatible-v1',
      dimensions: 3,
      vector: [0.25, 0.5, 0.75],
    });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe('https://embedding.example/v1/embeddings');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toEqual({
      model: 'fixture-openai-compatible-v1',
      input: 'l1 export function approve refund return refund ledger approval schema version ainp source chunk index v1',
      kind: 'catalog_query',
    });
    expect(String(body.input)).not.toContain('L1:');
    expect(String(body.input)).not.toContain('"schemaVersion"');
  });
});
