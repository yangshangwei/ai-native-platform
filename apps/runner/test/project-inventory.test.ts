import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { buildProjectInventory } from '../src/project-inventory';
import {
  SOURCE_CHUNK_INDEX_LOCAL_EMBEDDING_DIMENSIONS,
  SOURCE_CHUNK_INDEX_LOCAL_EMBEDDING_MAX_INPUT_CHARS,
  SOURCE_CHUNK_INDEX_LOCAL_EMBEDDING_MODEL,
  sourceChunkIndexLocalEmbeddingForText,
} from '../src/source-chunk-embedding';

function expectLexicalTokensToContain(
  tokens: readonly string[] | undefined,
  expectedTokens: readonly string[],
) {
  expect(tokens).toBeDefined();
  for (const token of expectedTokens) {
    expect(tokens).toContain(token);
  }
}

describe('buildProjectInventory', () => {
  test('captures stable docs, package commands, modules, safe exclusions, and source chunk index metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-'));
    await mkdir(join(root, 'apps/api/src'), { recursive: true });
    await mkdir(join(root, 'apps/api/src/models'), { recursive: true });
    await mkdir(join(root, 'apps/api/test'), { recursive: true });
    await mkdir(join(root, 'db'), { recursive: true });
    await mkdir(join(root, 'docs'), { recursive: true });
    await mkdir(join(root, '.github/workflows'), { recursive: true });
    await mkdir(join(root, 'node_modules'), { recursive: true });

    await writeFile(join(root, 'README.md'), '# Fixture Project\n\n## Run\nUse package scripts.\n', 'utf8');
    await writeFile(join(root, 'docs/architecture.md'), '# Architecture\n\nLayered app.\n', 'utf8');
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        scripts: {
          start: 'node apps/api/src/index.js',
          test: 'vitest run',
          typecheck: 'tsc --noEmit',
          dev: 'vite',
        },
        dependencies: { '@example/runtime': '1.0.0' },
      }, null, 2),
      'utf8',
    );
    await writeFile(join(root, '.github/workflows/ci.yml'), 'name: ci\n', 'utf8');
    await writeFile(
      join(root, 'apps/api/src/index.ts'),
      'import { app } from "./users-route";\nexport const ok = true;\napp.listen(3000);\n',
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/users-route.ts'),
      [
        'import { Router } from "express";',
        'export const router = Router();',
        'export class UserService {',
        '  findUser() { return { id: "u1" }; }',
        '}',
        'export function getUser() { const table = "user_audit_records"; const service = new UserService(); return service.findUser(); }',
        'export function createUser() {}',
        'router.get("/users/:id", getUser);',
        'router.post("/users", createUser);',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/models/UserEntity.ts'),
      'export interface UserDto { id: string }\nexport class UserEntity {}\n',
      'utf8',
    );
    await writeFile(
      join(root, 'db/schema.sql'),
      'CREATE TABLE user_audit_records (\n  id uuid PRIMARY KEY,\n  user_id uuid NOT NULL\n);\n',
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/user-worker.ts'),
      'export async function userWorkerMain() {}\nqueue.process("user.created", userWorkerMain);\n',
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/test/users-route.test.ts'),
      'import { describe, it, expect } from "vitest";\ndescribe("users route", () => { it("works", () => expect(true).toBe(true)); });\n',
      'utf8',
    );
    await writeFile(join(root, '.env'), 'SECRET_TOKEN=do-not-capture\n', 'utf8');
    await writeFile(join(root, 'node_modules/generated.js'), 'throw new Error("ignore");\n', 'utf8');
    await writeFile(join(root, 'large-file.txt'), 'x'.repeat(2048), 'utf8');
    await writeFile(join(root, 'binary.bin'), Buffer.from([0, 1, 2, 3, 0, 4]));

    const inventory = await buildProjectInventory({
      projectId: 'proj_fixture',
      workflowRunId: 'run_fixture',
      repoRoot: root,
      generatedAt: '2026-06-30T00:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 1024,
        maxTotalBytes: 4096,
        maxCapturedFiles: 20,
      },
    });

    expect(inventory.schemaVersion).toBe('ainp.project_inventory.v1');
    expect(inventory.generatedAt).toBe('2026-06-30T00:00:00.000Z');
    expect(inventory.git).toBeNull();
    expect(inventory.repo).toMatchObject({
      root,
      branch: null,
      commit: null,
      dirty: null,
    });

    expect(inventory.sources.map((source) => source.ref)).toEqual([
      'file:.github/workflows/ci.yml',
      'file:package.json',
      'file:docs/architecture.md',
      'file:README.md',
      'path:apps/api',
    ]);
    expect(inventory.sources.find((source) => source.path === 'README.md')).toMatchObject({
      kind: 'doc',
      title: 'Fixture Project',
      summary: 'Headings: Fixture Project > Run',
    });
    expect(inventory.commands.map((command) => [command.name, command.command])).toEqual([
      ['dev', 'vite'],
      ['start', 'node apps/api/src/index.js'],
      ['test', 'vitest run'],
      ['typecheck', 'tsc --noEmit'],
    ]);
    expect(inventory.commands.every((command) => command.sourceRefs.includes('file:package.json'))).toBe(true);
    expect(inventory.modules.map((module) => [module.path, module.label])).toEqual([
      ['apps/api', 'App: api'],
    ]);
    expect(inventory.entrypoints.map((entrypoint) => [entrypoint.kind, entrypoint.method ?? null, entrypoint.route ?? null])).toEqual(expect.arrayContaining([
      ['app_bootstrap', null, null],
      ['cli_script', null, null],
      ['http_route', 'GET', '/users/:id'],
      ['http_route', 'POST', '/users'],
      ['queue', null, null],
    ]));
    expect(inventory.symbols.map((symbol) => [symbol.kind, symbol.name, symbol.path])).toEqual(expect.arrayContaining([
      ['class', 'UserService', 'apps/api/src/users-route.ts'],
      ['method', 'findUser', 'apps/api/src/users-route.ts'],
      ['function', 'getUser', 'apps/api/src/users-route.ts'],
      ['function', 'createUser', 'apps/api/src/users-route.ts'],
      ['interface', 'UserDto', 'apps/api/src/models/UserEntity.ts'],
      ['class', 'UserEntity', 'apps/api/src/models/UserEntity.ts'],
    ]));
    expect(inventory.imports).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'apps/api/src/users-route.ts',
        specifier: 'express',
        importedNames: ['Router'],
        sourceRefs: ['file:apps/api/src/users-route.ts#L1'],
      }),
    ]));
    expect(inventory.exports).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'apps/api/src/users-route.ts',
        name: 'UserService',
        kind: 'class',
      }),
      expect.objectContaining({
        path: 'apps/api/src/users-route.ts',
        name: 'getUser',
        kind: 'function',
      }),
    ]));
    const getUserSymbol = inventory.symbols.find((symbol) => symbol.name === 'getUser' && symbol.path === 'apps/api/src/users-route.ts');
    const userServiceSymbol = inventory.symbols.find((symbol) => symbol.name === 'UserService' && symbol.path === 'apps/api/src/users-route.ts');
    const getUserRoute = inventory.entrypoints.find((entrypoint) => entrypoint.kind === 'http_route' && entrypoint.route === '/users/:id');
    expect(inventory.symbolGraph.parser).toBe('typescript_ast');
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${getUserRoute?.id}`,
        to: `node_symbol_${getUserSymbol?.id}`,
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${getUserSymbol?.id}`,
        to: `node_symbol_${userServiceSymbol?.id}`,
        label: 'uses UserService',
      }),
    ]));
    expect(inventory.domainEntities.map((entity) => [entity.kind, entity.name, entity.path])).toEqual(expect.arrayContaining([
      ['dto', 'UserDto', 'apps/api/src/models/UserEntity.ts'],
      ['entity', 'UserEntity', 'apps/api/src/models/UserEntity.ts'],
      ['table', 'user_audit_records', 'db/schema.sql'],
    ]));
    expect(inventory.domainEntities.find((entity) => entity.name === 'user_audit_records')).toMatchObject({
      id: 'domain_table_db_schema_sql_user_audit_records_1',
      sourceRefs: ['file:db/schema.sql#L1'],
      referenceSourceRefs: ['file:apps/api/src/users-route.ts#L6'],
      confidence: 0.88,
    });
    expect(inventory.testSurfaces[0]).toMatchObject({
      id: 'test_surface_apps_api_test_users_route_test_ts',
      path: 'apps/api/test/users-route.test.ts',
      frameworkHint: 'vitest',
      sourceRefs: ['file:apps/api/test/users-route.test.ts'],
    });
    expect(inventory.testSurfaces[0]?.targetHints).toEqual(expect.arrayContaining(['api', 'users-route']));
    expect(inventory.hotspots.map((hotspot) => [hotspot.reason, hotspot.path])).toContainEqual([
      'entrypoint_dense',
      'apps/api/src/users-route.ts',
    ]);
    const usersCapability = inventory.capabilities.find((capability) => capability.id === 'cap_api_users');
    expect(usersCapability).toMatchObject({
      label: 'Users API',
      kind: 'api',
      confidence: 0.95,
    });
    expect(usersCapability?.domainEntityRefs).toContain('domain_table_db_schema_sql_user_audit_records_1');
    expect(usersCapability?.sourceRefs).toEqual(expect.arrayContaining([
      'file:apps/api/src/users-route.ts#L6',
      'file:apps/api/src/users-route.ts#L7',
      'file:db/schema.sql#L1',
      'file:apps/api/test/users-route.test.ts',
    ]));
    const usersRouteChunk = inventory.sourceChunks.find((chunk) => (
      chunk.path === 'apps/api/src/users-route.ts' && chunk.snippet.includes('getUser')
    ));
    expect(usersRouteChunk).toMatchObject({
      language: 'typescript/javascript',
      startLine: 1,
      confidence: 0.75,
    });
    expect(usersRouteChunk?.endLine).toBeGreaterThanOrEqual(8);
    expect(usersRouteChunk?.snippet).toContain('L6: export function getUser');
    expect(usersRouteChunk?.sourceRefs).toEqual(expect.arrayContaining([
      'file:apps/api/src/users-route.ts#L1',
      'file:apps/api/src/users-route.ts#L8',
    ]));
    expect(usersRouteChunk?.entrypointRefs).toContain(getUserRoute?.id);
    expect(usersRouteChunk?.symbolRefs).toEqual(expect.arrayContaining([
      getUserSymbol?.id,
      userServiceSymbol?.id,
    ]));
    expect(usersRouteChunk?.domainEntityRefs).toContain('domain_table_db_schema_sql_user_audit_records_1');
    expect(usersRouteChunk?.capabilityRefs).toContain(usersCapability?.id);
    expect(usersRouteChunk?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(usersRouteChunk?.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    const userTableChunk = inventory.sourceChunks.find((chunk) => chunk.path === 'db/schema.sql');
    expect(userTableChunk).toMatchObject({
      language: 'sql',
      startLine: 1,
      domainEntityRefs: ['domain_table_db_schema_sql_user_audit_records_1'],
      capabilityRefs: expect.arrayContaining([usersCapability?.id]),
    });
    expect(inventory.sourceChunkIndex).toMatchObject({
      schemaVersion: 'ainp.source_chunk_index.v1',
      generatedAt: '2026-06-30T00:00:00.000Z',
      source: 'project_inventory.sourceChunks',
      chunkCount: inventory.sourceChunks.length,
      maxEntries: 120,
    });
    const usersRouteChunkIndex = inventory.sourceChunkIndex.entries.find((entry) => (
      entry.sourceChunkRef === usersRouteChunk?.id
    ));
    expect(usersRouteChunkIndex).toMatchObject({
      contentSha256: usersRouteChunk?.contentSha256,
      path: 'apps/api/src/users-route.ts',
      language: 'typescript/javascript',
      startLine: usersRouteChunk?.startLine,
      endLine: usersRouteChunk?.endLine,
      linkedRecordRefs: expect.arrayContaining([
        getUserRoute?.id,
        getUserSymbol?.id,
        userServiceSymbol?.id,
        'domain_table_db_schema_sql_user_audit_records_1',
        usersCapability?.id,
      ]),
      sourceRefs: expect.arrayContaining([
        'file:apps/api/src/users-route.ts#L1',
        'file:apps/api/src/users-route.ts#L8',
      ]),
      entrypointRefs: expect.arrayContaining([getUserRoute?.id]),
      symbolRefs: expect.arrayContaining([
        getUserSymbol?.id,
        userServiceSymbol?.id,
      ]),
      domainEntityRefs: expect.arrayContaining(['domain_table_db_schema_sql_user_audit_records_1']),
      capabilityRefs: expect.arrayContaining([usersCapability?.id]),
    });
    expectLexicalTokensToContain(usersRouteChunkIndex?.lexicalTokens, [
      'api',
      'users',
      'route',
      'get',
      'user',
      'service',
      'audit',
      'records',
    ]);
    expect(usersRouteChunkIndex?.searchText).toContain('user service');
    expect(usersRouteChunkIndex?.searchText).toContain('audit records');
    expect(usersRouteChunkIndex?.searchText.length).toBeLessThanOrEqual(512);
    expect(usersRouteChunkIndex?.lexicalTokens.length).toBeLessThanOrEqual(80);
    expect(usersRouteChunkIndex?.lexicalTokens).not.toContain('function');
    expect(usersRouteChunkIndex?.searchText).not.toContain('L6');
    expect(usersRouteChunkIndex?.embedding).toMatchObject({
      model: SOURCE_CHUNK_INDEX_LOCAL_EMBEDDING_MODEL,
      dimensions: SOURCE_CHUNK_INDEX_LOCAL_EMBEDDING_DIMENSIONS,
      vector: sourceChunkIndexLocalEmbeddingForText([
        usersRouteChunkIndex?.searchText,
        ...(usersRouteChunkIndex?.lexicalTokens ?? []),
      ].filter(Boolean).join(' ')).vector,
    });
    expect(usersRouteChunkIndex?.embedding?.vector).toHaveLength(SOURCE_CHUNK_INDEX_LOCAL_EMBEDDING_DIMENSIONS);
    expect(usersRouteChunkIndex?.embedding?.vector.every((value) => Number.isFinite(value))).toBe(true);
    expect(usersRouteChunkIndex?.embedding?.vector.some((value) => value !== 0)).toBe(true);
    const overflowEmbeddingPrefix = 'billing '.repeat(
      Math.ceil(SOURCE_CHUNK_INDEX_LOCAL_EMBEDDING_MAX_INPUT_CHARS / 'billing '.length) + 4,
    );
    expect(sourceChunkIndexLocalEmbeddingForText(`${overflowEmbeddingPrefix}overflow one`).vector)
      .toEqual(sourceChunkIndexLocalEmbeddingForText(`${overflowEmbeddingPrefix}overflow two`).vector);
    expect(JSON.stringify(usersRouteChunkIndex)).not.toContain('export function getUser');
    expect(getUserRoute?.sourceChunkRefs).toContain(usersRouteChunk?.id);
    expect(getUserSymbol?.sourceChunkRefs).toContain(usersRouteChunk?.id);
    expect(inventory.domainEntities.find((entity) => entity.name === 'user_audit_records')?.sourceChunkRefs)
      .toEqual(expect.arrayContaining([usersRouteChunk?.id, userTableChunk?.id]));
    expect(usersCapability?.sourceChunkRefs).toContain(usersRouteChunk?.id);
    expect(inventory.symbolGraph.nodes.find((node) => node.ref === getUserSymbol?.id)?.sourceChunkRefs)
      .toContain(usersRouteChunk?.id);

    expect(inventory.exclusions).toEqual([
      { path: '.env', reason: 'sensitive' },
      { path: 'binary.bin', reason: 'binary' },
      { path: 'large-file.txt', reason: 'too_large' },
      { path: 'node_modules', reason: 'generated' },
    ]);
    expect(JSON.stringify(inventory)).not.toContain('SECRET_TOKEN');
    expect(inventory.scan.fileCountCaptured).toBe(10);
    expect(inventory.scan.totalBytesCaptured).toBeGreaterThan(0);
  });

  test('uses injected source chunk embedding provider over bounded lexical text', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-provider-'));
    await mkdir(join(root, 'apps/api/src'), { recursive: true });
    await writeFile(
      join(root, 'apps/api/src/refunds.ts'),
      [
        'export function approveRefund() {',
        '  const refundLedgerSearch = "refund ledger approval";',
        '  return refundLedgerSearch;',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );
    const providerInputs: Array<{ kind: string; text: string }> = [];
    const provider = {
      embed: vi.fn(async (input: { kind: string; text: string }) => {
        providerInputs.push(input);
        return {
          model: 'fixture-external-source-chunk-v1',
          dimensions: 3,
          vector: [0.2, 0.3, 0.4],
        };
      }),
    };

    const inventory = await buildProjectInventory({
      projectId: 'proj_provider',
      workflowRunId: 'run_provider',
      repoRoot: root,
      generatedAt: '2026-07-04T00:00:00.000Z',
      git: false,
      sourceChunkEmbeddingProvider: provider,
    });

    const entry = inventory.sourceChunkIndex.entries.find((item) => item.path === 'apps/api/src/refunds.ts');
    expect(entry?.embedding).toEqual({
      model: 'fixture-external-source-chunk-v1',
      dimensions: 3,
      vector: [0.2, 0.3, 0.4],
    });
    expect(provider.embed).toHaveBeenCalled();
    expect(providerInputs.every((input) => input.kind === 'source_chunk_index')).toBe(true);
    expect(providerInputs.some((input) => input.text.includes('refund'))).toBe(true);
    expect(providerInputs.every((input) => input.text.length <= SOURCE_CHUNK_INDEX_LOCAL_EMBEDDING_MAX_INPUT_CHARS))
      .toBe(true);
    expect(JSON.stringify(providerInputs)).not.toContain('export function approveRefund');
    expect(JSON.stringify(providerInputs)).not.toContain('L1:');
    expect(JSON.stringify(providerInputs)).not.toContain('"schemaVersion"');
  });

  test('falls back to local source chunk embeddings when injected provider fails or returns invalid data', async () => {
    async function inventoryWithProvider(
      provider: Parameters<typeof buildProjectInventory>[0]['sourceChunkEmbeddingProvider'],
      tempPrefix: string,
    ) {
      const root = await mkdtemp(join(tmpdir(), tempPrefix));
      await mkdir(join(root, 'apps/api/src'), { recursive: true });
      await writeFile(
        join(root, 'apps/api/src/orders.ts'),
        'export function cancelOrder() { return "cancel order"; }\n',
        'utf8',
      );
      return buildProjectInventory({
        projectId: 'proj_provider_fallback',
        workflowRunId: 'run_provider_fallback',
        repoRoot: root,
        generatedAt: '2026-07-04T00:00:00.000Z',
        git: false,
        sourceChunkEmbeddingProvider: provider,
      });
    }

    const failingProvider = {
      embed: vi.fn(async () => {
        throw new Error('provider offline');
      }),
    };
    const failedInventory = await inventoryWithProvider(failingProvider, 'ainp-inventory-provider-fail-');
    expect(failedInventory.sourceChunkIndex.entries[0]?.embedding?.model)
      .toBe(SOURCE_CHUNK_INDEX_LOCAL_EMBEDDING_MODEL);
    expect(failedInventory.sourceChunkIndex.entries[0]?.embedding?.dimensions)
      .toBe(SOURCE_CHUNK_INDEX_LOCAL_EMBEDDING_DIMENSIONS);

    const invalidProvider = {
      embed: vi.fn(async () => ({
        model: 'fixture-invalid-source-chunk-v1',
        dimensions: 2,
        vector: [0, 0],
      })),
    };
    const invalidInventory = await inventoryWithProvider(invalidProvider, 'ainp-inventory-provider-invalid-');
    expect(invalidInventory.sourceChunkIndex.entries[0]?.embedding?.model)
      .toBe(SOURCE_CHUNK_INDEX_LOCAL_EMBEDDING_MODEL);
    expect(invalidInventory.sourceChunkIndex.entries[0]?.embedding?.dimensions)
      .toBe(SOURCE_CHUNK_INDEX_LOCAL_EMBEDDING_DIMENSIONS);
  });

  test('source chunk content hashes stay stable when identical code shifts line numbers', async () => {
    async function buildInventoryWithSingleSource(content: string, tempPrefix: string) {
      const root = await mkdtemp(join(tmpdir(), tempPrefix));
      await mkdir(join(root, 'apps/api/src'), { recursive: true });
      await writeFile(join(root, 'apps/api/src/domain.ts'), content, 'utf8');
      return buildProjectInventory({
        projectId: 'proj_chunk_hash',
        workflowRunId: 'run_chunk_hash',
        repoRoot: root,
        generatedAt: '2026-07-03T00:00:00.000Z',
        git: false,
      });
    }

    const baseContent = [
      '// filler 01',
      '// filler 02',
      '// filler 03',
      '// filler 04',
      '// filler 05',
      '// filler 06',
      '// filler 07',
      '// filler 08',
      '// filler 09',
      '// filler 10',
      '// filler 11',
      '// filler 12',
      'export class BillingService {',
      '  reconcile() { return "ok"; }',
      '}',
      'export function reconcileBilling() {',
      '  const service = new BillingService();',
      '  return service.reconcile();',
      '}',
      '',
    ].join('\n');
    const shiftedContent = `// inserted banner\n${baseContent}`;
    const [baseInventory, shiftedInventory] = await Promise.all([
      buildInventoryWithSingleSource(baseContent, 'ainp-inventory-chunk-hash-base-'),
      buildInventoryWithSingleSource(shiftedContent, 'ainp-inventory-chunk-hash-shifted-'),
    ]);
    const baseChunk = baseInventory.sourceChunks.find((chunk) => (
      chunk.path === 'apps/api/src/domain.ts'
      && chunk.snippet.includes('reconcileBilling')
    ));
    const shiftedChunk = shiftedInventory.sourceChunks.find((chunk) => (
      chunk.path === 'apps/api/src/domain.ts'
      && chunk.snippet.includes('reconcileBilling')
    ));

    expect(baseChunk).toBeDefined();
    expect(shiftedChunk).toBeDefined();
    expect(baseChunk?.startLine).not.toBe(shiftedChunk?.startLine);
    expect(baseChunk?.sha256).not.toBe(shiftedChunk?.sha256);
    expect(baseChunk?.contentSha256).toBe(shiftedChunk?.contentSha256);
    const baseIndexEntry = baseInventory.sourceChunkIndex.entries.find((entry) => (
      entry.sourceChunkRef === baseChunk?.id
    ));
    const shiftedIndexEntry = shiftedInventory.sourceChunkIndex.entries.find((entry) => (
      entry.sourceChunkRef === shiftedChunk?.id
    ));
    expect(baseIndexEntry).toMatchObject({
      contentSha256: baseChunk?.contentSha256,
      path: 'apps/api/src/domain.ts',
      language: 'typescript/javascript',
      startLine: baseChunk?.startLine,
      endLine: baseChunk?.endLine,
    });
    expect(shiftedIndexEntry).toMatchObject({
      contentSha256: shiftedChunk?.contentSha256,
      path: 'apps/api/src/domain.ts',
      language: 'typescript/javascript',
      startLine: shiftedChunk?.startLine,
      endLine: shiftedChunk?.endLine,
    });
    expectLexicalTokensToContain(baseIndexEntry?.lexicalTokens, [
      'api',
      'src',
      'domain',
      'billing',
      'service',
      'reconcile',
    ]);
    expectLexicalTokensToContain(shiftedIndexEntry?.lexicalTokens, [
      'api',
      'src',
      'domain',
      'billing',
      'service',
      'reconcile',
    ]);
    expect(baseIndexEntry?.lexicalTokens).toEqual(shiftedIndexEntry?.lexicalTokens);
    expect(baseIndexEntry?.searchText).toBe(shiftedIndexEntry?.searchText);
    expect(baseIndexEntry?.searchText).not.toContain(String(baseChunk?.startLine));
    expect(shiftedIndexEntry?.searchText).not.toContain(String(shiftedChunk?.startLine));
  });

  test('links schema-qualified static SQL table references to scanned table entities', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-qualified-table-'));
    await mkdir(join(root, 'apps/api/src'), { recursive: true });
    await mkdir(join(root, 'apps/api/test'), { recursive: true });
    await mkdir(join(root, 'db/billing'), { recursive: true });

    await writeFile(
      join(root, 'db/billing/schema.sql'),
      'CREATE TABLE billing.refund_ledger_entries (\n  id uuid PRIMARY KEY\n);\n',
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/billing-repository.ts'),
      [
        'export class BillingRefundRepository {',
        '  listLedger() {',
        '    return sql`select * from billing.refund_ledger_entries where retained_at is null`;',
        '  }',
        '  joinPublicLedger() {',
        '    return sql`select r.id from refunds r join public.refund_ledger_entries l on l.refund_id = r.id`;',
        '  }',
        '  quotedLedger() {',
        '    return \'select * from "billing"."refund_ledger_entries"\';',
        '  }',
        '  bracketLedger() {',
        '    return "select * from [billing].[refund_ledger_entries]";',
        '  }',
        '  literalLedgerName() {',
        '    return "billing.refund_ledger_entries";',
        '  }',
        '  archiveLedger() {',
        '    return "archive_refund_ledger_entries";',
        '  }',
        '  dynamicLedger(schema: string) {',
        '    return sql`select * from ${schema}.refund_ledger_entries`;',
        '  }',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/test/billing-repository.test.ts'),
      'test("fixture", () => "billing.refund_ledger_entries");\n',
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_qualified_table',
      workflowRunId: 'run_qualified_table',
      repoRoot: root,
      generatedAt: '2026-07-03T00:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 20,
      },
    });

    const table = inventory.domainEntities.find((entity) => entity.name === 'refund_ledger_entries');
    expect(table).toMatchObject({
      kind: 'table',
      path: 'db/billing/schema.sql',
      sourceRefs: ['file:db/billing/schema.sql#L1'],
    });
    expect(table?.referenceSourceRefs).toEqual([
      'file:apps/api/src/billing-repository.ts#L12',
      'file:apps/api/src/billing-repository.ts#L15',
      'file:apps/api/src/billing-repository.ts#L3',
      'file:apps/api/src/billing-repository.ts#L6',
      'file:apps/api/src/billing-repository.ts#L9',
    ]);

    const repositoryChunk = inventory.sourceChunks.find((chunk) => (
      chunk.path === 'apps/api/src/billing-repository.ts'
      && chunk.domainEntityRefs.includes(table?.id ?? '')
    ));
    expect(repositoryChunk).toBeTruthy();
    expect(inventory.sourceChunkIndex.entries.find((entry) => entry.sourceChunkRef === repositoryChunk?.id))
      .toMatchObject({
        domainEntityRefs: expect.arrayContaining([table?.id]),
      });
  });

  test('links static SQL foreign keys between scanned table entities', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-sql-fk-'));
    await mkdir(join(root, 'db/billing'), { recursive: true });

    await writeFile(
      join(root, 'db/billing/schema.sql'),
      [
        'CREATE TABLE billing.refund_ledger_entries (',
        '  id uuid PRIMARY KEY',
        ');',
        '',
        'CREATE TABLE billing.refund_ledger_adjustments (',
        '  id uuid PRIMARY KEY,',
        '  ledger_entry_id uuid NOT NULL,',
        '  FOREIGN KEY (ledger_entry_id) REFERENCES billing.refund_ledger_entries(id)',
        ');',
        '',
        'CREATE TABLE billing.refund_audit_notes (',
        '  id uuid PRIMARY KEY,',
        '  ledger_entry_id uuid REFERENCES refund_ledger_entries(id)',
        ');',
        '',
        'CREATE TABLE customer.customer_profiles (',
        '  id uuid PRIMARY KEY',
        ');',
        '',
        'CREATE TABLE billing.refund_cross_schema_notes (',
        '  id uuid PRIMARY KEY,',
        '  ledger_entry_id uuid REFERENCES customer.refund_ledger_entries(id)',
        ');',
        '',
        'CREATE TABLE billing.refund_invalid_schema_notes (',
        '  id uuid PRIMARY KEY,',
        '  ledger_entry_id uuid REFERENCES "bad-schema".refund_ledger_entries(id)',
        ');',
        '',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_sql_fk',
      workflowRunId: 'run_sql_fk',
      repoRoot: root,
      generatedAt: '2026-07-03T00:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 20,
      },
    });

    const ledger = inventory.domainEntities.find((entity) => entity.name === 'refund_ledger_entries');
    const adjustments = inventory.domainEntities.find((entity) => entity.name === 'refund_ledger_adjustments');
    const auditNotes = inventory.domainEntities.find((entity) => entity.name === 'refund_audit_notes');
    const customerProfiles = inventory.domainEntities.find((entity) => entity.name === 'customer_profiles');
    const crossSchemaNotes = inventory.domainEntities.find((entity) => entity.name === 'refund_cross_schema_notes');
    const invalidSchemaNotes = inventory.domainEntities.find((entity) => entity.name === 'refund_invalid_schema_notes');

    expect(ledger).toMatchObject({
      id: 'domain_table_db_billing_schema_sql_refund_ledger_entries_1',
      kind: 'table',
      schemaName: 'billing',
      sourceRefs: ['file:db/billing/schema.sql#L1'],
    });
    expect(adjustments).toMatchObject({
      id: 'domain_table_db_billing_schema_sql_refund_ledger_adjustments_5',
      schemaName: 'billing',
      relationships: expect.arrayContaining([
        expect.objectContaining({
          kind: 'foreign_key',
          direction: 'references',
          domainEntityRef: ledger?.id,
          name: 'refund_ledger_entries',
          sourceRefs: ['file:db/billing/schema.sql#L8'],
        }),
      ]),
    });
    expect(auditNotes?.relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'foreign_key',
        direction: 'references',
        domainEntityRef: ledger?.id,
        name: 'refund_ledger_entries',
        sourceRefs: ['file:db/billing/schema.sql#L13'],
      }),
    ]));
    expect(ledger?.relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({
        direction: 'referenced_by',
        domainEntityRef: adjustments?.id,
        name: 'refund_ledger_adjustments',
        sourceRefs: ['file:db/billing/schema.sql#L8'],
      }),
      expect.objectContaining({
        direction: 'referenced_by',
        domainEntityRef: auditNotes?.id,
        name: 'refund_audit_notes',
        sourceRefs: ['file:db/billing/schema.sql#L13'],
      }),
    ]));
    expect(customerProfiles?.relationships).toBeUndefined();
    expect(crossSchemaNotes?.relationships).toBeUndefined();
    expect(invalidSchemaNotes?.relationships).toBeUndefined();
    expect(ledger?.relationships?.some((relationship) => (
      relationship.domainEntityRef === crossSchemaNotes?.id
      || relationship.domainEntityRef === invalidSchemaNotes?.id
    ))).toBe(false);

    const foreignKeyChunk = inventory.sourceChunks.find((chunk) => (
      chunk.path === 'db/billing/schema.sql'
      && chunk.snippet.includes('FOREIGN KEY (ledger_entry_id)')
    ));
    expect(foreignKeyChunk).toBeTruthy();
    expect(foreignKeyChunk?.domainEntityRefs).toEqual(expect.arrayContaining([
      ledger?.id,
      adjustments?.id,
    ]));
    expect(inventory.sourceChunkIndex.entries.find((entry) => entry.sourceChunkRef === foreignKeyChunk?.id))
      .toMatchObject({
        domainEntityRefs: expect.arrayContaining([
          ledger?.id,
          adjustments?.id,
        ]),
      });
  });

  test('links static SQL joins between scanned table entities', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-sql-join-'));
    await mkdir(join(root, 'db/billing'), { recursive: true });
    await mkdir(join(root, 'apps/api/src'), { recursive: true });

    await writeFile(
      join(root, 'db/billing/schema.sql'),
      [
        'CREATE TABLE billing.refund_ledger_entries (',
        '  id uuid PRIMARY KEY',
        ');',
        '',
        'CREATE TABLE billing.refund_audit_notes (',
        '  id uuid PRIMARY KEY,',
        '  ledger_entry_id uuid NOT NULL',
        ');',
        '',
        'CREATE TABLE customer.customer_profiles (',
        '  id uuid PRIMARY KEY',
        ');',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'db/billing/reporting.sql'),
      [
        'SELECT r.id, n.note',
        'FROM "billing"."refund_ledger_entries" r',
        'LEFT JOIN [billing].[refund_audit_notes] n ON n.ledger_entry_id = r.id',
        ';',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/billing-repository.ts'),
      [
        'export function loadRefundLedgerJoin() {',
        '  return `',
        '    SELECT r.id, n.note',
        '    FROM billing.refund_ledger_entries r',
        '    JOIN billing.refund_audit_notes n ON n.ledger_entry_id = r.id',
        '  `;',
        '}',
        '',
        'export function dynamicSchemaJoin(schema: string) {',
        '  return `SELECT * FROM ${schema}.refund_ledger_entries r JOIN billing.refund_audit_notes n ON n.ledger_entry_id = r.id`;',
        '}',
        '',
        'export function suffixOnlyJoin() {',
        '  return "SELECT * FROM archive_refund_ledger_entries r JOIN billing.refund_audit_notes n ON n.ledger_entry_id = r.id";',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/billing-repository.test.ts'),
      [
        'test("join fixture", () => {',
        '  const sql = "SELECT * FROM billing.refund_ledger_entries r JOIN billing.refund_audit_notes n ON n.ledger_entry_id = r.id";',
        '  expect(sql).toContain("JOIN");',
        '});',
        '',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_sql_join',
      workflowRunId: 'run_sql_join',
      repoRoot: root,
      generatedAt: '2026-07-03T00:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 12288,
        maxCapturedFiles: 20,
      },
    });

    const ledger = inventory.domainEntities.find((entity) => entity.name === 'refund_ledger_entries');
    const auditNotes = inventory.domainEntities.find((entity) => entity.name === 'refund_audit_notes');
    const customerProfiles = inventory.domainEntities.find((entity) => entity.name === 'customer_profiles');

    expect(ledger?.relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'join',
        direction: 'joins',
        domainEntityRef: auditNotes?.id,
        name: 'refund_audit_notes',
        sourceRefs: ['file:apps/api/src/billing-repository.ts#L5'],
      }),
      expect.objectContaining({
        kind: 'join',
        direction: 'joins',
        domainEntityRef: auditNotes?.id,
        name: 'refund_audit_notes',
        sourceRefs: ['file:db/billing/reporting.sql#L3'],
      }),
    ]));
    expect(auditNotes?.relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'join',
        direction: 'joins',
        domainEntityRef: ledger?.id,
        name: 'refund_ledger_entries',
        sourceRefs: ['file:apps/api/src/billing-repository.ts#L5'],
      }),
      expect.objectContaining({
        kind: 'join',
        direction: 'joins',
        domainEntityRef: ledger?.id,
        name: 'refund_ledger_entries',
        sourceRefs: ['file:db/billing/reporting.sql#L3'],
      }),
    ]));
    expect(customerProfiles?.relationships).toBeUndefined();
    expect(JSON.stringify([ledger?.relationships, auditNotes?.relationships])).not.toContain('billing-repository.test.ts');
    expect(JSON.stringify([ledger?.relationships, auditNotes?.relationships])).not.toContain('#L10');
    expect(JSON.stringify([ledger?.relationships, auditNotes?.relationships])).not.toContain('#L14');

    const joinChunk = inventory.sourceChunks.find((chunk) => (
      chunk.path === 'apps/api/src/billing-repository.ts'
      && chunk.snippet.includes('JOIN billing.refund_audit_notes')
    ));
    expect(joinChunk).toBeTruthy();
    expect(joinChunk?.domainEntityRefs).toEqual(expect.arrayContaining([
      ledger?.id,
      auditNotes?.id,
    ]));
    expect(inventory.sourceChunkIndex.entries.find((entry) => entry.sourceChunkRef === joinChunk?.id))
      .toMatchObject({
        domainEntityRefs: expect.arrayContaining([
          ledger?.id,
          auditNotes?.id,
        ]),
      });

    const sqlJoinChunk = inventory.sourceChunks.find((chunk) => (
      chunk.path === 'db/billing/reporting.sql'
      && chunk.snippet.includes('LEFT JOIN [billing].[refund_audit_notes]')
    ));
    expect(sqlJoinChunk).toBeTruthy();
    expect(sqlJoinChunk?.domainEntityRefs).toEqual(expect.arrayContaining([
      ledger?.id,
      auditNotes?.id,
    ]));
    expect(inventory.sourceChunkIndex.entries.find((entry) => entry.sourceChunkRef === sqlJoinChunk?.id))
      .toMatchObject({
        domainEntityRefs: expect.arrayContaining([
          ledger?.id,
          auditNotes?.id,
        ]),
      });
  });

  test('links static SQL views to scanned table dependencies', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-sql-view-'));
    await mkdir(join(root, 'db/billing'), { recursive: true });

    await writeFile(
      join(root, 'db/billing/schema.sql'),
      [
        'CREATE TABLE billing.refund_ledger_entries (',
        '  id uuid PRIMARY KEY',
        ');',
        '',
        'CREATE TABLE billing.refund_audit_notes (',
        '  id uuid PRIMARY KEY',
        ');',
        '',
        'CREATE TABLE customer.customer_profiles (',
        '  id uuid PRIMARY KEY',
        ');',
        '',
        'CREATE OR REPLACE VIEW billing.refund_retention_view AS',
        'SELECT r.id, n.note',
        'FROM billing.refund_ledger_entries r',
        'JOIN "billing"."refund_audit_notes" n ON n.ledger_entry_id = r.id',
        ';',
        '',
        'CREATE VIEW billing.refund_dynamic_view AS',
        'SELECT * FROM ${schema}.refund_ledger_entries;',
        '',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_sql_view',
      workflowRunId: 'run_sql_view',
      repoRoot: root,
      generatedAt: '2026-07-03T00:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 10,
      },
    });

    const view = inventory.domainEntities.find((entity) => entity.name === 'refund_retention_view');
    const dynamicView = inventory.domainEntities.find((entity) => entity.name === 'refund_dynamic_view');
    const ledger = inventory.domainEntities.find((entity) => entity.name === 'refund_ledger_entries');
    const auditNotes = inventory.domainEntities.find((entity) => entity.name === 'refund_audit_notes');
    const customerProfiles = inventory.domainEntities.find((entity) => entity.name === 'customer_profiles');

    expect(view).toMatchObject({
      id: 'domain_view_db_billing_schema_sql_refund_retention_view_13',
      name: 'refund_retention_view',
      kind: 'view',
      schemaName: 'billing',
      sourceRefs: ['file:db/billing/schema.sql#L13'],
    });
    expect(view?.relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'view_dependency',
        direction: 'depends_on',
        domainEntityRef: ledger?.id,
        name: 'refund_ledger_entries',
        sourceRefs: ['file:db/billing/schema.sql#L15'],
      }),
      expect.objectContaining({
        kind: 'view_dependency',
        direction: 'depends_on',
        domainEntityRef: auditNotes?.id,
        name: 'refund_audit_notes',
        sourceRefs: ['file:db/billing/schema.sql#L16'],
      }),
    ]));
    expect(ledger?.relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'view_dependency',
        direction: 'depended_on_by',
        domainEntityRef: view?.id,
        name: 'refund_retention_view',
        sourceRefs: ['file:db/billing/schema.sql#L15'],
      }),
    ]));
    expect(auditNotes?.relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'view_dependency',
        direction: 'depended_on_by',
        domainEntityRef: view?.id,
        name: 'refund_retention_view',
        sourceRefs: ['file:db/billing/schema.sql#L16'],
      }),
    ]));
    expect(dynamicView).toMatchObject({
      kind: 'view',
      sourceRefs: ['file:db/billing/schema.sql#L19'],
    });
    expect(dynamicView?.relationships).toBeUndefined();
    expect(customerProfiles?.relationships).toBeUndefined();

    const viewChunk = inventory.sourceChunks.find((chunk) => (
      chunk.path === 'db/billing/schema.sql'
      && chunk.snippet.includes('CREATE OR REPLACE VIEW billing.refund_retention_view')
    ));
    expect(viewChunk).toBeTruthy();
    expect(viewChunk?.domainEntityRefs).toEqual(expect.arrayContaining([
      view?.id,
      ledger?.id,
      auditNotes?.id,
    ]));
    expect(inventory.sourceChunkIndex.entries.find((entry) => entry.sourceChunkRef === viewChunk?.id))
      .toMatchObject({
        domainEntityRefs: expect.arrayContaining([
          view?.id,
          ledger?.id,
          auditNotes?.id,
        ]),
      });
  });

  test('links static SQL routines to scanned table dependencies', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-sql-routine-'));
    await mkdir(join(root, 'db/billing'), { recursive: true });

    await writeFile(
      join(root, 'db/billing/schema.sql'),
      [
        'CREATE TABLE billing.refund_ledger_entries (',
        '  id uuid PRIMARY KEY,',
        '  retained_at timestamptz',
        ');',
        '',
        'CREATE TABLE billing.refund_audit_notes (',
        '  id uuid PRIMARY KEY,',
        '  ledger_entry_id uuid NOT NULL',
        ');',
        '',
        'CREATE TABLE billing.refund_summary (',
        '  ledger_entry_id uuid PRIMARY KEY',
        ');',
        '',
        'CREATE TABLE customer.customer_profiles (',
        '  id uuid PRIMARY KEY',
        ');',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'db/billing/routines.sql'),
      [
        'CREATE OR REPLACE PROCEDURE billing.apply_refund_retention()',
        'LANGUAGE plpgsql',
        'AS $$',
        'BEGIN',
        '  UPDATE billing.refund_ledger_entries',
        '  SET retained_at = now()',
        '  WHERE retained_at IS NULL;',
        '',
        '  INSERT INTO billing.refund_audit_notes (ledger_entry_id, note)',
        "  SELECT r.id, 'retained'",
        '  FROM billing.refund_ledger_entries r',
        '  JOIN billing.refund_audit_notes n ON n.ledger_entry_id = r.id;',
        'END;',
        '$$;',
        '',
        'CREATE PROC billing.merge_refund_summary',
        'AS',
        'BEGIN',
        '  MERGE INTO billing.refund_summary AS target',
        '  USING billing.refund_ledger_entries AS source',
        '  ON target.ledger_entry_id = source.id;',
        '  DELETE FROM billing.refund_audit_notes WHERE archived = 1;',
        'END;',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'db/billing/dynamic-routines.sql'),
      [
        'CREATE FUNCTION billing.dynamic_customer_lookup(schema_name text)',
        'RETURNS void',
        'LANGUAGE plpgsql',
        'AS $$',
        'BEGIN',
        "  EXECUTE 'SELECT * FROM ' || schema_name || '.customer_profiles';",
        'END;',
        '$$;',
        '',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_sql_routine',
      workflowRunId: 'run_sql_routine',
      repoRoot: root,
      generatedAt: '2026-07-03T00:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 12288,
        maxCapturedFiles: 20,
      },
    });

    const applyRoutine = inventory.domainEntities.find((entity) => entity.name === 'apply_refund_retention');
    const mergeRoutine = inventory.domainEntities.find((entity) => entity.name === 'merge_refund_summary');
    const dynamicRoutine = inventory.domainEntities.find((entity) => entity.name === 'dynamic_customer_lookup');
    const ledger = inventory.domainEntities.find((entity) => entity.name === 'refund_ledger_entries');
    const auditNotes = inventory.domainEntities.find((entity) => entity.name === 'refund_audit_notes');
    const summary = inventory.domainEntities.find((entity) => entity.name === 'refund_summary');
    const customerProfiles = inventory.domainEntities.find((entity) => entity.name === 'customer_profiles');

    expect(applyRoutine).toMatchObject({
      id: 'domain_routine_db_billing_routines_sql_apply_refund_retention_1',
      name: 'apply_refund_retention',
      kind: 'routine',
      schemaName: 'billing',
      sourceRefs: ['file:db/billing/routines.sql#L1'],
    });
    expect(mergeRoutine).toMatchObject({
      id: 'domain_routine_db_billing_routines_sql_merge_refund_summary_16',
      name: 'merge_refund_summary',
      kind: 'routine',
      schemaName: 'billing',
      sourceRefs: ['file:db/billing/routines.sql#L16'],
    });
    expect(dynamicRoutine).toMatchObject({
      id: 'domain_routine_db_billing_dynamic_routines_sql_dynamic_customer_lookup_1',
      name: 'dynamic_customer_lookup',
      kind: 'routine',
      schemaName: 'billing',
      sourceRefs: ['file:db/billing/dynamic-routines.sql#L1'],
    });

    expect(applyRoutine?.relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'routine_dependency',
        direction: 'depends_on',
        domainEntityRef: ledger?.id,
        name: 'refund_ledger_entries',
        sourceRefs: ['file:db/billing/routines.sql#L5'],
      }),
      expect.objectContaining({
        kind: 'routine_dependency',
        direction: 'depends_on',
        domainEntityRef: auditNotes?.id,
        name: 'refund_audit_notes',
        sourceRefs: ['file:db/billing/routines.sql#L9'],
      }),
      expect.objectContaining({
        kind: 'routine_dependency',
        direction: 'depends_on',
        domainEntityRef: ledger?.id,
        name: 'refund_ledger_entries',
        sourceRefs: ['file:db/billing/routines.sql#L11'],
      }),
      expect.objectContaining({
        kind: 'routine_dependency',
        direction: 'depends_on',
        domainEntityRef: auditNotes?.id,
        name: 'refund_audit_notes',
        sourceRefs: ['file:db/billing/routines.sql#L12'],
      }),
    ]));
    expect(mergeRoutine?.relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'routine_dependency',
        direction: 'depends_on',
        domainEntityRef: summary?.id,
        name: 'refund_summary',
        sourceRefs: ['file:db/billing/routines.sql#L19'],
      }),
      expect.objectContaining({
        kind: 'routine_dependency',
        direction: 'depends_on',
        domainEntityRef: auditNotes?.id,
        name: 'refund_audit_notes',
        sourceRefs: ['file:db/billing/routines.sql#L22'],
      }),
    ]));
    expect(ledger?.relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'routine_dependency',
        direction: 'depended_on_by',
        domainEntityRef: applyRoutine?.id,
        name: 'apply_refund_retention',
        sourceRefs: ['file:db/billing/routines.sql#L5'],
      }),
    ]));
    expect(auditNotes?.relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'routine_dependency',
        direction: 'depended_on_by',
        domainEntityRef: applyRoutine?.id,
        name: 'apply_refund_retention',
        sourceRefs: ['file:db/billing/routines.sql#L9'],
      }),
      expect.objectContaining({
        kind: 'routine_dependency',
        direction: 'depended_on_by',
        domainEntityRef: mergeRoutine?.id,
        name: 'merge_refund_summary',
        sourceRefs: ['file:db/billing/routines.sql#L22'],
      }),
    ]));
    expect(summary?.relationships).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'routine_dependency',
        direction: 'depended_on_by',
        domainEntityRef: mergeRoutine?.id,
        name: 'merge_refund_summary',
        sourceRefs: ['file:db/billing/routines.sql#L19'],
      }),
    ]));
    expect(dynamicRoutine?.relationships).toBeUndefined();
    expect(customerProfiles?.relationships).toBeUndefined();

    const routineChunk = inventory.sourceChunks.find((chunk) => (
      chunk.path === 'db/billing/routines.sql'
      && chunk.snippet.includes('CREATE OR REPLACE PROCEDURE billing.apply_refund_retention')
    ));
    expect(routineChunk).toBeTruthy();
    expect(routineChunk?.domainEntityRefs).toEqual(expect.arrayContaining([
      applyRoutine?.id,
      mergeRoutine?.id,
      ledger?.id,
      auditNotes?.id,
      summary?.id,
    ]));
    expect(inventory.sourceChunkIndex.entries.find((entry) => entry.sourceChunkRef === routineChunk?.id))
      .toMatchObject({
        domainEntityRefs: expect.arrayContaining([
          applyRoutine?.id,
          mergeRoutine?.id,
          ledger?.id,
          auditNotes?.id,
          summary?.id,
        ]),
      });

    const dynamicChunk = inventory.sourceChunks.find((chunk) => (
      chunk.path === 'db/billing/dynamic-routines.sql'
      && chunk.snippet.includes('dynamic_customer_lookup')
    ));
    expect(dynamicChunk?.domainEntityRefs).toEqual([dynamicRoutine?.id]);
  });

  test('calibrates route patterns and suppresses noisy capabilities', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-frameworks-'));
    await mkdir(join(root, 'app/api/orders/[id]'), { recursive: true });
    await mkdir(join(root, 'app/controllers'), { recursive: true });
    await mkdir(join(root, 'src'), { recursive: true });
    await mkdir(join(root, 'config'), { recursive: true });
    await mkdir(join(root, 'routes'), { recursive: true });

    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'framework-fixture',
        scripts: {
          start: 'node server.js',
          build: 'tsc -p tsconfig.json',
          lint: 'eslint .',
          typecheck: 'tsc --noEmit',
          migrate: 'node scripts/migrate.js',
          export: 'node scripts/export.js',
        },
      }, null, 2),
      'utf8',
    );
    await writeFile(
      join(root, 'src/server.ts'),
      [
        'fastify.route({ method: "PATCH", url: "/api/accounts/:id", handler: updateAccount });',
        'fastify.get("/api/reports", listReports);',
        'export function updateAccount() {}',
        'fastify.route({',
        '  method: "GET",',
        '  url: "/api/accounts/:id/statement",',
        '  handler: getAccountStatement,',
        '});',
        'export function getAccountStatement() {}',
        'const server = require("fastify")();',
        'server.route({ method: "DELETE", url: "/api/accounts/:id", handler: deleteAccount });',
        'export function deleteAccount() {}',
        'const fake = { route() {} };',
        'fake.route({ method: "POST", url: "/api/accounts/ghost", handler: ghostAccount });',
        'export function ghostAccount() {}',
        'import createFastify from "fastify";',
        'const importedServer = createFastify();',
        'importedServer.route({ method: "PUT", url: "/api/accounts/:id/preferences", handler: updateAccountPreferences });',
        'export function updateAccountPreferences() {}',
        'const requiredFastify = require("fastify");',
        'const requiredServer = requiredFastify();',
        'requiredServer.route({ method: "POST", url: "/api/accounts/import", handler: importAccount });',
        'export function importAccount() {}',
        'const arbitraryServer = makeServer();',
        'arbitraryServer.route({ method: "GET", url: "/api/accounts/arbitrary", handler: arbitraryAccount });',
        'function makeServer() { return { route() {} }; }',
        'export function arbitraryAccount() {}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/hapi-server.ts'),
      [
        'const Hapi = require("@hapi/hapi");',
        'const hapiServer = Hapi.server({ port: 3000 });',
        'hapiServer.route({',
        '  method: "GET",',
        '  path: "/api/hapi/billing/{invoiceId}",',
        '  handler: showHapiBilling,',
        '});',
        'export function showHapiBilling() {}',
        'const directServer = require("hapi").server({ port: 3001 });',
        'directServer.route({ method: "POST", path: "/api/hapi/billing/reconcile", handler: reconcileHapiBilling });',
        'export function reconcileHapiBilling() {}',
        'const fakeHapi = { route() {} };',
        'fakeHapi.route({ method: "GET", path: "/api/hapi/ghost", handler: ghostHapiBilling });',
        'export function ghostHapiBilling() {}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/not-hapi-server.ts'),
      [
        'const Hapi = makeLocalFactory();',
        'const localServer = Hapi.server({ port: 3002 });',
        'localServer.route({ method: "GET", path: "/api/hapi/local-ghost", handler: localGhostHapiBilling });',
        'function makeLocalFactory() { return { server() { return { route() {} }; } }; }',
        'export function localGhostHapiBilling() {}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/nest-orders.controller.ts'),
      [
        'import { Controller, Get, Post } from "@nestjs/common";',
        '@Controller("/api/v1/nest-orders")',
        'export class NestOrdersController {',
        '  @Get(":orderId")',
        '  showOrder() {',
        '    return {};',
        '  }',
        '',
        '  @Post()',
        '  createOrder() {',
        '    return {};',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/app.py'),
      [
        'from flask import Blueprint',
        'billing = Blueprint("billing", __name__, url_prefix="/api/v3/billing")',
        '@billing.post("/invoices/<invoice_id>/reconcile")',
        'def blueprint_reconcile(invoice_id):',
        '    pass',
        'support = Blueprint("support", __name__)',
        'app.register_blueprint(support, url_prefix="/api/v3/support")',
        '@support.get("/tickets/<ticket_id>")',
        'def support_ticket(ticket_id):',
        '    pass',
        '@app.route("/api/payments", methods=["GET", "POST"])',
        'def payments():',
        '    pass',
        '@router.get("/api/refunds/{id}")',
        'def refund():',
        '    pass',
        'from fastapi import APIRouter, FastAPI',
        'orders_router = APIRouter(prefix="/api/v4/orders")',
        '@orders_router.get("/{order_id}")',
        'def fastapi_order(order_id):',
        '    pass',
        'app_v2 = FastAPI()',
        'legacy_router = APIRouter(prefix="/orders")',
        'app_v2.include_router(legacy_router, prefix="/api/v5")',
        '@legacy_router.get("/{order_id}/history")',
        'def included_router_order_history(order_id):',
        '    pass',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main.go'),
      [
        'router.GET("/api/orders/:id", getOrder)',
        'http.HandleFunc("/api/health", health)',
        'mux.HandleFunc("/api/orders/{id}/audit", auditOrder).Methods("GET", http.MethodPost)',
        'func getOrder() {}',
        'func health() {}',
        'func auditOrder() {}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'config/routes.rb'),
      [
        'Rails.application.routes.draw do',
        '  scope "/api" do',
        '    get "/subscriptions", to: "subscriptions#index"',
        '    post "/subscriptions", to: "subscriptions#create"',
        '  end',
        '  namespace :admin do',
        '    get "/subscriptions", to: "subscriptions#index"',
        '  end',
        'end',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/controllers/subscriptions_controller.rb'),
      [
        'class SubscriptionsController < ApplicationController',
        '  def index',
        '    render json: []',
        '  end',
        '',
        '  def create',
        '    head :created',
        '  end',
        'end',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'routes/web.php'),
      [
        "<?php",
        "Route::get('/api/v2/customers/{customer}', [CustomerController::class, 'show']);",
        "Route::post('/api/customers', 'CustomerController@store');",
        "Route::patch('/api/customers/{customer}', [App\\Http\\Controllers\\CustomerController::class, 'update']);",
        "Route::prefix('/api/v3/admin')->group(function () {",
        "  Route::get('customers/{customer}', [CustomerController::class, 'adminShow']);",
        "});",
        "Route::get('/api/health-check', HealthCheckController::class);",
        "Route::middleware('auth')->prefix('/api/v4/ops')->group(function () {",
        "  Route::get('customers/{customer}', [CustomerController::class, 'adminShow']);",
        "});",
      ].join('\n'),
      'utf8',
    );
    await mkdir(join(root, 'app/Http/Controllers'), { recursive: true });
    await writeFile(
      join(root, 'app/Http/Controllers/CustomerController.php'),
      [
        '<?php',
        'class CustomerController extends Controller',
        '{',
        '  public function show($customer) {',
        '    return response()->json($customer);',
        '  }',
        '',
        '  public function store() {',
        '    return response()->json([], 201);',
        '  }',
        '',
        '  public function update($customer) {',
        '    return response()->json($customer);',
        '  }',
        '',
        '  public function adminShow($customer) {',
        '    return response()->json($customer);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/Http/Controllers/HealthCheckController.php'),
      [
        '<?php',
        'class HealthCheckController extends Controller',
        '{',
        '  public function __invoke() {',
        '    return response()->json(["ok" => true]);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/urls.py'),
      [
        'from django.urls import path, re_path',
        'from . import views',
        'urlpatterns = [',
        '    path("api/shipments/<int:shipment_id>/", views.shipment_detail, name="shipment-detail"),',
        '    re_path(r"^api/audit-events/(?P<event_id>\\\\d+)/$", views.audit_event),',
        ']',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/views.py'),
      [
        'def shipment_detail(request, shipment_id):',
        '    pass',
        '',
        'def audit_event(request, event_id):',
        '    pass',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/project_urls.py'),
      [
        'from django.urls import include, path',
        'urlpatterns = [',
        '    path("api/v6/billing/", include("billing.urls")),',
        ']',
      ].join('\n'),
      'utf8',
    );
    await mkdir(join(root, 'billing'), { recursive: true });
    await writeFile(
      join(root, 'billing/urls.py'),
      [
        'from django.urls import path',
        'from . import views',
        'urlpatterns = [',
        '    path("invoices/<int:invoice_id>/reconcile/", views.reconcile_invoice),',
        ']',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'billing/views.py'),
      [
        'def reconcile_invoice(request, invoice_id):',
        '    pass',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/ProductsController.cs'),
      [
        '[ApiController]',
        '[Route("api/[controller]")]',
        'public class ProductsController : ControllerBase',
        '{',
        '  [HttpGet("{id}")]',
        '  public IActionResult Show(int id) => Ok();',
        '  [HttpPost]',
        '  public IActionResult Create() => Ok();',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/BillingController.java'),
      [
        '@RequestMapping(value = "/api/billing", method = RequestMethod.GET)',
        'public class BillingController {}',
        '@PostMapping("/api/invoices")',
        'public void createInvoice() {}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/BillingReconciliationController.java'),
      [
        '@RestController',
        '@RequestMapping("/api/v1/billing")',
        'public class BillingReconciliationController {',
        '  @PostMapping("/invoices/{invoiceId}/reconcile")',
        '  public ResponseEntity<?> reconcileInvoice(String invoiceId) {',
        '    return ResponseEntity.ok(invoiceId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/api/orders/[id]/route.ts'),
      [
        'export async function GET() {}',
        'export const DELETE = async () => {};',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/order-worker.ts'),
      [
        'export async function helperOnly() {}',
        'queue.process("order.created", processOrder);',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_frameworks',
      workflowRunId: 'run_frameworks',
      repoRoot: root,
      generatedAt: '2026-07-01T00:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 16384,
        maxCapturedFiles: 50,
      },
    });

    const routes = inventory.entrypoints
      .filter((entrypoint) => entrypoint.kind === 'http_route')
      .map((entrypoint) => `${entrypoint.method} ${entrypoint.route}`)
      .sort();
    expect(routes).toEqual(expect.arrayContaining([
      'DELETE /api/orders/[id]',
      'GET /api/billing',
      'GET /api/products/{id}',
      'GET /api/health',
      'GET /api/health-check',
      'GET /api/hapi/billing/{invoiceId}',
      'GET /api/orders/:id',
      'GET /api/orders/{id}/audit',
      'GET /api/orders/[id]',
      'GET /api/payments',
      'GET /admin/subscriptions',
      'GET /api/v1/nest-orders/:orderId',
      'GET /api/refunds/{id}',
      'GET /api/reports',
      'GET /api/v3/support/tickets/<ticket_id>',
      'GET /api/v4/orders/{order_id}',
      'GET /api/v5/orders/{order_id}/history',
      'POST /api/v1/billing/invoices/{invoiceId}/reconcile',
      'POST /api/v3/billing/invoices/<invoice_id>/reconcile',
      'GET /api/v2/customers/{customer}',
      'GET /api/v3/admin/customers/{customer}',
      'GET /api/v4/ops/customers/{customer}',
      'ANY /api/v6/billing/invoices/<int:invoice_id>/reconcile/',
      'GET /api/accounts/:id/statement',
      'DELETE /api/accounts/:id',
      'ANY /api/audit-events/(?P<event_id>\\\\d+)/',
      'ANY /api/shipments/<int:shipment_id>/',
      'PATCH /api/accounts/:id',
      'POST /api/accounts/import',
      'PATCH /api/customers/{customer}',
      'POST /api/customers',
      'POST /api/hapi/billing/reconcile',
      'POST /api/invoices',
      'POST /api/orders/{id}/audit',
      'POST /api/v1/nest-orders',
      'POST /api/payments',
      'POST /api/products',
      'POST /api/subscriptions',
      'PUT /api/accounts/:id/preferences',
    ]));
    expect(routes).not.toContain('GET /api/accounts/arbitrary');
    expect(routes).not.toContain('POST /api/accounts/ghost');
    expect(routes).not.toContain('GET /api/hapi/ghost');
    expect(routes).not.toContain('GET /api/hapi/local-ghost');
    expect(routes).not.toContain('ANY /api/v6/billing/');
    const accountsRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route' && entrypoint.route === '/api/accounts/:id' && entrypoint.method === 'PATCH'
    ));
    const updateAccountSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'updateAccount' && symbol.path === 'src/server.ts'
    ));
    const statementRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route' && entrypoint.route === '/api/accounts/:id/statement'
    ));
    const statementSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'getAccountStatement' && symbol.path === 'src/server.ts'
    ));
    const deleteAccountRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route' && entrypoint.route === '/api/accounts/:id' && entrypoint.method === 'DELETE'
    ));
    const deleteAccountSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'deleteAccount' && symbol.path === 'src/server.ts'
    ));
    const updateAccountPreferencesRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.route === '/api/accounts/:id/preferences'
      && entrypoint.method === 'PUT'
    ));
    const updateAccountPreferencesSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'updateAccountPreferences' && symbol.path === 'src/server.ts'
    ));
    const importAccountRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.route === '/api/accounts/import'
      && entrypoint.method === 'POST'
    ));
    const importAccountSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'importAccount' && symbol.path === 'src/server.ts'
    ));
    const hapiBillingRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/hapi/billing/{invoiceId}'
    ));
    const hapiBillingSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'showHapiBilling' && symbol.path === 'src/hapi-server.ts'
    ));
    const hapiReconcileRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/hapi/billing/reconcile'
    ));
    const hapiReconcileSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'reconcileHapiBilling' && symbol.path === 'src/hapi-server.ts'
    ));
    const nextGetRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/orders/[id]'
    ));
    const nextGetSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'GET' && symbol.path === 'app/api/orders/[id]/route.ts'
    ));
    const nextDeleteRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'DELETE'
      && entrypoint.route === '/api/orders/[id]'
    ));
    const nextDeleteSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'DELETE' && symbol.path === 'app/api/orders/[id]/route.ts'
    ));
    const nestGetRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/v1/nest-orders/:orderId'
    ));
    const nestPostRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v1/nest-orders'
    ));
    const nestShowSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'showOrder' && symbol.path === 'src/nest-orders.controller.ts'
    ));
    const nestCreateSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'createOrder' && symbol.path === 'src/nest-orders.controller.ts'
    ));
    const paymentsGetRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/payments'
    ));
    const paymentsPostRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/payments'
    ));
    const paymentsSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'payments' && symbol.path === 'src/app.py'
    ));
    const refundRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/refunds/{id}'
    ));
    const refundSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'refund' && symbol.path === 'src/app.py'
    ));
    const blueprintBillingRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v3/billing/invoices/<invoice_id>/reconcile'
    ));
    const blueprintBillingSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'blueprint_reconcile' && symbol.path === 'src/app.py'
    ));
    const registeredBlueprintRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/v3/support/tickets/<ticket_id>'
    ));
    const registeredBlueprintSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'support_ticket' && symbol.path === 'src/app.py'
    ));
    const fastApiRouterRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/v4/orders/{order_id}'
    ));
    const fastApiRouterSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'fastapi_order' && symbol.path === 'src/app.py'
    ));
    const includedFastApiRouterRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/v5/orders/{order_id}/history'
    ));
    const includedFastApiRouterSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'included_router_order_history' && symbol.path === 'src/app.py'
    ));
    const subscriptionsGetRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/subscriptions'
    ));
    const subscriptionsPostRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/subscriptions'
    ));
    const adminSubscriptionsRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/admin/subscriptions'
    ));
    const subscriptionsIndexSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'index' && symbol.path === 'app/controllers/subscriptions_controller.rb'
    ));
    const subscriptionsCreateSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'create' && symbol.path === 'app/controllers/subscriptions_controller.rb'
    ));
    const productsGetRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/products/{id}'
    ));
    const productsPostRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/products'
    ));
    const productsShowSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'Show' && symbol.path === 'src/ProductsController.cs'
    ));
    const productsCreateSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'Create' && symbol.path === 'src/ProductsController.cs'
    ));
    const billingReconcileRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v1/billing/invoices/{invoiceId}/reconcile'
    ));
    const billingReconcileSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'reconcileInvoice' && symbol.path === 'src/BillingReconciliationController.java'
    ));
    const customersGetRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/v2/customers/{customer}'
    ));
    const customersPostRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/customers'
    ));
    const customersPatchRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'PATCH'
      && entrypoint.route === '/api/customers/{customer}'
    ));
    const customersAdminRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/v3/admin/customers/{customer}'
    ));
    const healthCheckRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/health-check'
    ));
    const goAuditGetRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/orders/{id}/audit'
    ));
    const goAuditPostRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/orders/{id}/audit'
    ));
    const opsCustomerRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/v4/ops/customers/{customer}'
    ));
    const customerShowSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'show' && symbol.path === 'app/Http/Controllers/CustomerController.php'
    ));
    const customerStoreSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'store' && symbol.path === 'app/Http/Controllers/CustomerController.php'
    ));
    const customerUpdateSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'update' && symbol.path === 'app/Http/Controllers/CustomerController.php'
    ));
    const customerAdminShowSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'adminShow' && symbol.path === 'app/Http/Controllers/CustomerController.php'
    ));
    const healthCheckInvokeSymbol = inventory.symbols.find((symbol) => (
      symbol.name === '__invoke' && symbol.path === 'app/Http/Controllers/HealthCheckController.php'
    ));
    const goAuditSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'auditOrder' && symbol.path === 'src/main.go'
    ));
    const shipmentRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'ANY'
      && entrypoint.route === '/api/shipments/<int:shipment_id>/'
    ));
    const shipmentSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'shipment_detail' && symbol.path === 'src/views.py'
    ));
    const auditRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'ANY'
      && entrypoint.route === '/api/audit-events/(?P<event_id>\\\\d+)/'
    ));
    const auditSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'audit_event' && symbol.path === 'src/views.py'
    ));
    const includedDjangoRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'ANY'
      && entrypoint.route === '/api/v6/billing/invoices/<int:invoice_id>/reconcile/'
    ));
    const includedDjangoSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'reconcile_invoice' && symbol.path === 'billing/views.py'
    ));
    expect(accountsRoute).toMatchObject({ handler: 'updateAccount' });
    expect(updateAccountSymbol).toBeDefined();
    expect(statementRoute).toMatchObject({ handler: 'getAccountStatement' });
    expect(statementSymbol).toBeDefined();
    expect(deleteAccountRoute).toMatchObject({ handler: 'deleteAccount' });
    expect(deleteAccountSymbol).toBeDefined();
    expect(hapiBillingRoute).toMatchObject({
      handler: 'showHapiBilling',
      sourceRefs: ['file:src/hapi-server.ts#L3'],
    });
    expect(hapiBillingSymbol).toBeDefined();
    expect(hapiReconcileRoute).toMatchObject({
      handler: 'reconcileHapiBilling',
      sourceRefs: ['file:src/hapi-server.ts#L10'],
    });
    expect(hapiReconcileSymbol).toBeDefined();
    expect(nextGetRoute).toMatchObject({ handler: 'GET' });
    expect(nextGetSymbol).toBeDefined();
    expect(nextDeleteRoute).toMatchObject({ handler: 'DELETE' });
    expect(nextDeleteSymbol).toBeDefined();
    expect(nestGetRoute).toMatchObject({
      handler: 'showOrder',
      sourceRefs: expect.arrayContaining([
        'file:src/nest-orders.controller.ts#L2',
        'file:src/nest-orders.controller.ts#L4',
      ]),
    });
    expect(nestPostRoute).toMatchObject({
      handler: 'createOrder',
      sourceRefs: expect.arrayContaining([
        'file:src/nest-orders.controller.ts#L2',
        'file:src/nest-orders.controller.ts#L9',
      ]),
    });
    expect(nestShowSymbol).toBeDefined();
    expect(nestCreateSymbol).toBeDefined();
    expect(paymentsGetRoute).toMatchObject({ handler: 'payments' });
    expect(paymentsPostRoute).toMatchObject({ handler: 'payments' });
    expect(paymentsSymbol).toBeDefined();
    expect(refundRoute).toMatchObject({ handler: 'refund' });
    expect(refundSymbol).toBeDefined();
    expect(goAuditGetRoute).toMatchObject({
      handler: 'auditOrder',
      sourceRefs: expect.arrayContaining([
        'file:src/main.go#L3',
      ]),
    });
    expect(goAuditPostRoute).toMatchObject({
      handler: 'auditOrder',
      sourceRefs: expect.arrayContaining([
        'file:src/main.go#L3',
      ]),
    });
    expect(goAuditSymbol).toBeDefined();
    expect(blueprintBillingRoute).toMatchObject({
      handler: 'blueprint_reconcile',
      sourceRefs: expect.arrayContaining([
        'file:src/app.py#L2',
        'file:src/app.py#L3',
      ]),
    });
    expect(blueprintBillingSymbol).toBeDefined();
    expect(registeredBlueprintRoute).toMatchObject({
      handler: 'support_ticket',
      sourceRefs: expect.arrayContaining([
        'file:src/app.py#L6',
        'file:src/app.py#L7',
        'file:src/app.py#L8',
      ]),
    });
    expect(registeredBlueprintSymbol).toBeDefined();
    expect(fastApiRouterRoute).toMatchObject({
      handler: 'fastapi_order',
      sourceRefs: expect.arrayContaining([
        'file:src/app.py#L18',
        'file:src/app.py#L19',
      ]),
    });
    expect(fastApiRouterSymbol).toBeDefined();
    expect(includedFastApiRouterRoute).toMatchObject({
      handler: 'included_router_order_history',
      sourceRefs: expect.arrayContaining([
        'file:src/app.py#L23',
        'file:src/app.py#L24',
        'file:src/app.py#L25',
      ]),
    });
    expect(includedFastApiRouterSymbol).toBeDefined();
    expect(subscriptionsGetRoute).toMatchObject({ handler: 'SubscriptionsController#index' });
    expect(subscriptionsPostRoute).toMatchObject({ handler: 'SubscriptionsController#create' });
    expect(adminSubscriptionsRoute).toMatchObject({
      handler: 'SubscriptionsController#index',
      sourceRefs: expect.arrayContaining([
        'file:config/routes.rb#L6',
        'file:config/routes.rb#L7',
      ]),
    });
    expect(subscriptionsIndexSymbol).toBeDefined();
    expect(subscriptionsCreateSymbol).toBeDefined();
    expect(productsGetRoute).toMatchObject({ handler: 'Show' });
    expect(productsPostRoute).toMatchObject({ handler: 'Create' });
    expect(productsShowSymbol).toBeDefined();
    expect(productsCreateSymbol).toBeDefined();
    expect(billingReconcileRoute).toMatchObject({ handler: 'reconcileInvoice' });
    expect(billingReconcileSymbol).toBeDefined();
    expect(customersGetRoute).toMatchObject({ handler: 'CustomerController@show' });
    expect(customersPostRoute).toMatchObject({ handler: 'CustomerController@store' });
    expect(customersPatchRoute).toMatchObject({ handler: 'App\\Http\\Controllers\\CustomerController@update' });
    expect(customersAdminRoute).toMatchObject({
      handler: 'CustomerController@adminShow',
      sourceRefs: expect.arrayContaining([
        'file:routes/web.php#L5',
        'file:routes/web.php#L6',
      ]),
    });
    expect(healthCheckRoute).toMatchObject({
      handler: 'HealthCheckController@__invoke',
      sourceRefs: expect.arrayContaining([
        'file:routes/web.php#L8',
      ]),
    });
    expect(opsCustomerRoute).toMatchObject({
      handler: 'CustomerController@adminShow',
      sourceRefs: expect.arrayContaining([
        'file:routes/web.php#L9',
        'file:routes/web.php#L10',
      ]),
    });
    expect(customerShowSymbol).toBeDefined();
    expect(customerStoreSymbol).toBeDefined();
    expect(customerUpdateSymbol).toBeDefined();
    expect(customerAdminShowSymbol).toBeDefined();
    expect(healthCheckInvokeSymbol).toBeDefined();
    expect(shipmentRoute).toMatchObject({ handler: 'views.shipment_detail' });
    expect(shipmentSymbol).toBeDefined();
    expect(auditRoute).toMatchObject({ handler: 'views.audit_event' });
    expect(auditSymbol).toBeDefined();
    expect(includedDjangoRoute).toMatchObject({
      handler: 'views.reconcile_invoice',
      sourceRefs: expect.arrayContaining([
        'file:src/project_urls.py#L3',
        'file:billing/urls.py#L4',
      ]),
    });
    expect(includedDjangoSymbol).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${accountsRoute?.id}`,
        to: `node_symbol_${updateAccountSymbol?.id}`,
        sourceRefs: expect.arrayContaining([
          'file:src/server.ts#L1',
          'file:src/server.ts#L3',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${statementRoute?.id}`,
        to: `node_symbol_${statementSymbol?.id}`,
        sourceRefs: expect.arrayContaining([
          'file:src/server.ts#L4',
          'file:src/server.ts#L9',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${deleteAccountRoute?.id}`,
        to: `node_symbol_${deleteAccountSymbol?.id}`,
        label: 'route handler deleteAccount',
        sourceRefs: expect.arrayContaining([
          'file:src/server.ts#L11',
          'file:src/server.ts#L12',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${updateAccountPreferencesRoute?.id}`,
        to: `node_symbol_${updateAccountPreferencesSymbol?.id}`,
        label: 'route handler updateAccountPreferences',
        sourceRefs: expect.arrayContaining([
          'file:src/server.ts#L18',
          'file:src/server.ts#L19',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${importAccountRoute?.id}`,
        to: `node_symbol_${importAccountSymbol?.id}`,
        label: 'route handler importAccount',
        sourceRefs: expect.arrayContaining([
          'file:src/server.ts#L22',
          'file:src/server.ts#L23',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${hapiBillingRoute?.id}`,
        to: `node_symbol_${hapiBillingSymbol?.id}`,
        label: 'route handler showHapiBilling',
        sourceRefs: expect.arrayContaining([
          'file:src/hapi-server.ts#L3',
          'file:src/hapi-server.ts#L8',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${hapiReconcileRoute?.id}`,
        to: `node_symbol_${hapiReconcileSymbol?.id}`,
        label: 'route handler reconcileHapiBilling',
        sourceRefs: expect.arrayContaining([
          'file:src/hapi-server.ts#L10',
          'file:src/hapi-server.ts#L11',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${nextGetRoute?.id}`,
        to: `node_symbol_${nextGetSymbol?.id}`,
        label: 'route handler GET',
        sourceRefs: expect.arrayContaining([
          'file:app/api/orders/[id]/route.ts#L1',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${nextDeleteRoute?.id}`,
        to: `node_symbol_${nextDeleteSymbol?.id}`,
        label: 'route handler DELETE',
        sourceRefs: expect.arrayContaining([
          'file:app/api/orders/[id]/route.ts#L2',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${goAuditGetRoute?.id}`,
        to: `node_symbol_${goAuditSymbol?.id}`,
        label: 'route handler auditOrder',
        sourceRefs: expect.arrayContaining([
          'file:src/main.go#L3',
          'file:src/main.go#L6',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${goAuditPostRoute?.id}`,
        to: `node_symbol_${goAuditSymbol?.id}`,
        label: 'route handler auditOrder',
        sourceRefs: expect.arrayContaining([
          'file:src/main.go#L3',
          'file:src/main.go#L6',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${nestGetRoute?.id}`,
        to: `node_symbol_${nestShowSymbol?.id}`,
        label: 'route handler showOrder',
        sourceRefs: expect.arrayContaining([
          'file:src/nest-orders.controller.ts#L2',
          'file:src/nest-orders.controller.ts#L4',
          'file:src/nest-orders.controller.ts#L5',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${nestPostRoute?.id}`,
        to: `node_symbol_${nestCreateSymbol?.id}`,
        label: 'route handler createOrder',
        sourceRefs: expect.arrayContaining([
          'file:src/nest-orders.controller.ts#L2',
          'file:src/nest-orders.controller.ts#L9',
          'file:src/nest-orders.controller.ts#L10',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${paymentsGetRoute?.id}`,
        to: `node_symbol_${paymentsSymbol?.id}`,
        label: 'route handler payments',
        sourceRefs: expect.arrayContaining([
          'file:src/app.py#L11',
          'file:src/app.py#L12',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${refundRoute?.id}`,
        to: `node_symbol_${refundSymbol?.id}`,
        label: 'route handler refund',
        sourceRefs: expect.arrayContaining([
          'file:src/app.py#L14',
          'file:src/app.py#L15',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${includedDjangoRoute?.id}`,
        to: `node_symbol_${includedDjangoSymbol?.id}`,
        label: 'route handler views.reconcile_invoice',
        sourceRefs: expect.arrayContaining([
          'file:src/project_urls.py#L3',
          'file:billing/urls.py#L4',
          'file:billing/views.py#L1',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${healthCheckRoute?.id}`,
        to: `node_symbol_${healthCheckInvokeSymbol?.id}`,
        label: 'route handler HealthCheckController@__invoke',
        sourceRefs: expect.arrayContaining([
          'file:routes/web.php#L8',
          'file:app/Http/Controllers/HealthCheckController.php#L2',
          'file:app/Http/Controllers/HealthCheckController.php#L4',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${opsCustomerRoute?.id}`,
        to: `node_symbol_${customerAdminShowSymbol?.id}`,
        label: 'route handler CustomerController@adminShow',
        sourceRefs: expect.arrayContaining([
          'file:routes/web.php#L9',
          'file:routes/web.php#L10',
          'file:app/Http/Controllers/CustomerController.php#L2',
          'file:app/Http/Controllers/CustomerController.php#L16',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${blueprintBillingRoute?.id}`,
        to: `node_symbol_${blueprintBillingSymbol?.id}`,
        label: 'route handler blueprint_reconcile',
        sourceRefs: expect.arrayContaining([
          'file:src/app.py#L2',
          'file:src/app.py#L3',
          'file:src/app.py#L4',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${registeredBlueprintRoute?.id}`,
        to: `node_symbol_${registeredBlueprintSymbol?.id}`,
        label: 'route handler support_ticket',
        sourceRefs: expect.arrayContaining([
          'file:src/app.py#L6',
          'file:src/app.py#L7',
          'file:src/app.py#L8',
          'file:src/app.py#L9',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${fastApiRouterRoute?.id}`,
        to: `node_symbol_${fastApiRouterSymbol?.id}`,
        label: 'route handler fastapi_order',
        sourceRefs: expect.arrayContaining([
          'file:src/app.py#L18',
          'file:src/app.py#L19',
          'file:src/app.py#L20',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${includedFastApiRouterRoute?.id}`,
        to: `node_symbol_${includedFastApiRouterSymbol?.id}`,
        label: 'route handler included_router_order_history',
        sourceRefs: expect.arrayContaining([
          'file:src/app.py#L23',
          'file:src/app.py#L24',
          'file:src/app.py#L25',
          'file:src/app.py#L26',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${subscriptionsGetRoute?.id}`,
        to: `node_symbol_${subscriptionsIndexSymbol?.id}`,
        label: 'route handler SubscriptionsController#index',
        sourceRefs: expect.arrayContaining([
          'file:config/routes.rb#L2',
          'file:config/routes.rb#L3',
          'file:app/controllers/subscriptions_controller.rb#L1',
          'file:app/controllers/subscriptions_controller.rb#L2',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${adminSubscriptionsRoute?.id}`,
        to: `node_symbol_${subscriptionsIndexSymbol?.id}`,
        label: 'route handler SubscriptionsController#index',
        sourceRefs: expect.arrayContaining([
          'file:config/routes.rb#L6',
          'file:config/routes.rb#L7',
          'file:app/controllers/subscriptions_controller.rb#L1',
          'file:app/controllers/subscriptions_controller.rb#L2',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${subscriptionsPostRoute?.id}`,
        to: `node_symbol_${subscriptionsCreateSymbol?.id}`,
        label: 'route handler SubscriptionsController#create',
        sourceRefs: expect.arrayContaining([
          'file:config/routes.rb#L2',
          'file:config/routes.rb#L4',
          'file:app/controllers/subscriptions_controller.rb#L1',
          'file:app/controllers/subscriptions_controller.rb#L6',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${billingReconcileRoute?.id}`,
        to: `node_symbol_${billingReconcileSymbol?.id}`,
        label: 'route handler reconcileInvoice',
        sourceRefs: expect.arrayContaining([
          'file:src/BillingReconciliationController.java#L4',
          'file:src/BillingReconciliationController.java#L5',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${productsGetRoute?.id}`,
        to: `node_symbol_${productsShowSymbol?.id}`,
        label: 'route handler Show',
        sourceRefs: expect.arrayContaining([
          'file:src/ProductsController.cs#L5',
          'file:src/ProductsController.cs#L6',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${productsPostRoute?.id}`,
        to: `node_symbol_${productsCreateSymbol?.id}`,
        label: 'route handler Create',
        sourceRefs: expect.arrayContaining([
          'file:src/ProductsController.cs#L7',
          'file:src/ProductsController.cs#L8',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${customersGetRoute?.id}`,
        to: `node_symbol_${customerShowSymbol?.id}`,
        label: 'route handler CustomerController@show',
        sourceRefs: expect.arrayContaining([
          'file:routes/web.php#L2',
          'file:app/Http/Controllers/CustomerController.php#L2',
          'file:app/Http/Controllers/CustomerController.php#L4',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${customersPostRoute?.id}`,
        to: `node_symbol_${customerStoreSymbol?.id}`,
        label: 'route handler CustomerController@store',
        sourceRefs: expect.arrayContaining([
          'file:routes/web.php#L3',
          'file:app/Http/Controllers/CustomerController.php#L2',
          'file:app/Http/Controllers/CustomerController.php#L8',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${customersPatchRoute?.id}`,
        to: `node_symbol_${customerUpdateSymbol?.id}`,
        label: 'route handler App\\Http\\Controllers\\CustomerController@update',
        sourceRefs: expect.arrayContaining([
          'file:routes/web.php#L4',
          'file:app/Http/Controllers/CustomerController.php#L2',
          'file:app/Http/Controllers/CustomerController.php#L12',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${customersAdminRoute?.id}`,
        to: `node_symbol_${customerAdminShowSymbol?.id}`,
        label: 'route handler CustomerController@adminShow',
        sourceRefs: expect.arrayContaining([
          'file:routes/web.php#L5',
          'file:routes/web.php#L6',
          'file:app/Http/Controllers/CustomerController.php#L2',
          'file:app/Http/Controllers/CustomerController.php#L16',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${shipmentRoute?.id}`,
        to: `node_symbol_${shipmentSymbol?.id}`,
        label: 'route handler views.shipment_detail',
        sourceRefs: expect.arrayContaining([
          'file:src/urls.py#L4',
          'file:src/views.py#L1',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${auditRoute?.id}`,
        to: `node_symbol_${auditSymbol?.id}`,
        label: 'route handler views.audit_event',
        sourceRefs: expect.arrayContaining([
          'file:src/urls.py#L5',
          'file:src/views.py#L4',
        ]),
      }),
    ]));

    expect(inventory.commands.map((command) => command.name)).toEqual([
      'build',
      'export',
      'lint',
      'migrate',
      'start',
      'typecheck',
    ]);
    expect(inventory.entrypoints.filter((entrypoint) => entrypoint.kind === 'cli_script').map((entrypoint) => entrypoint.label)).toEqual([
      'Script: export',
      'Script: migrate',
      'Script: start',
    ]);

    expect(inventory.entrypoints.filter((entrypoint) => entrypoint.kind === 'queue')).toHaveLength(1);
    expect(inventory.entrypoints.find((entrypoint) => entrypoint.kind === 'queue')).toMatchObject({
      path: 'src/order-worker.ts',
      sourceRefs: ['file:src/order-worker.ts#L2'],
    });

    expect(inventory.capabilities.map((capability) => capability.label)).toEqual(expect.arrayContaining([
      'Accounts API',
      'Billing API',
      'Customers API',
      'Health API',
      'Invoices API',
      'Orders API',
      'Payments API',
      'Products API',
      'Reports API',
      'Shipments API',
      'Subscriptions API',
    ]));
    expect(inventory.capabilities.map((capability) => capability.label)).not.toContain('Api API');
    expect(inventory.capabilities.map((capability) => capability.label)).not.toContain('V2 API');
  });

  test('detects static JAX-WS SOAP service operations with graph evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-jaxws-'));
    await mkdir(join(root, 'src/main/java/com/example/soap'), { recursive: true });

    await writeFile(
      join(root, 'src/main/java/com/example/soap/BillingStatementService.java'),
      [
        'package com.example.soap;',
        'import javax.jws.WebMethod;',
        'import javax.jws.WebService;',
        '',
        '@WebService(serviceName = "BillingStatementService")',
        'public class BillingStatementService {',
        '  private final BillingStatementManager manager = new BillingStatementManager();',
        '',
        '  @WebMethod(operationName = "ReconcileInvoice")',
        '  public String reconcileInvoice(String invoiceId) {',
        '    return manager.reconcile(invoiceId);',
        '  }',
        '',
        '  @WebMethod(exclude = true)',
        '  public void internalWarmup() {}',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/java/com/example/soap/BillingStatementManager.java'),
      [
        'package com.example.soap;',
        'public class BillingStatementManager {',
        '  private final BillingStatementRepository repository = new BillingStatementRepository();',
        '',
        '  public String reconcile(String invoiceId) {',
        '    return repository.markReconciled(invoiceId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/java/com/example/soap/BillingStatementRepository.java'),
      [
        'package com.example.soap;',
        'public class BillingStatementRepository {',
        '  public String markReconciled(String invoiceId) {',
        '    return invoiceId;',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/java/com/example/soap/CustomerProfileService.java'),
      [
        'package com.example.soap;',
        'import javax.jws.WebMethod;',
        'import javax.jws.WebService;',
        '',
        '@WebService(name = "CustomerProfileService")',
        'public class CustomerProfileService {',
        '  @WebMethod(operationName = "LoadProfile")',
        '  public String loadProfile(String customerId) {',
        '    return customerId;',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_jaxws',
      workflowRunId: 'run_jaxws',
      repoRoot: root,
      generatedAt: '2026-07-02T00:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 16384,
        maxCapturedFiles: 20,
      },
    });

    const routes = inventory.entrypoints
      .filter((entrypoint) => entrypoint.kind === 'http_route')
      .map((entrypoint) => `${entrypoint.method} ${entrypoint.route}`)
      .sort();
    expect(routes).toEqual(expect.arrayContaining([
      'ANY /soap/billing_statement_service/reconcile_invoice',
      'ANY /soap/customer_profile_service/load_profile',
    ]));
    expect(routes).not.toContain('ANY /soap/billing_statement_service/internal_warmup');

    const billingRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.route === '/soap/billing_statement_service/reconcile_invoice'
    ));
    const customerRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.route === '/soap/customer_profile_service/load_profile'
    ));
    const reconcileSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'reconcileInvoice'
      && symbol.path === 'src/main/java/com/example/soap/BillingStatementService.java'
    ));
    const managerSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'BillingStatementManager'
      && symbol.path === 'src/main/java/com/example/soap/BillingStatementManager.java'
    ));
    const managerMethod = inventory.symbols.find((symbol) => (
      symbol.name === 'reconcile'
      && symbol.path === 'src/main/java/com/example/soap/BillingStatementManager.java'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.name === 'markReconciled'
      && symbol.path === 'src/main/java/com/example/soap/BillingStatementRepository.java'
    ));

    expect(billingRoute).toMatchObject({
      method: 'ANY',
      handler: 'BillingStatementService#reconcileInvoice',
      sourceRefs: expect.arrayContaining([
        'file:src/main/java/com/example/soap/BillingStatementService.java#L5',
        'file:src/main/java/com/example/soap/BillingStatementService.java#L9',
        'file:src/main/java/com/example/soap/BillingStatementService.java#L10',
      ]),
    });
    expect(customerRoute).toMatchObject({ handler: 'CustomerProfileService#loadProfile' });
    expect(reconcileSymbol).toBeDefined();
    expect(managerSymbol).toBeDefined();
    expect(managerMethod).toBeDefined();
    expect(repositoryMethod).toBeDefined();

    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${billingRoute?.id}`,
        to: `node_symbol_${reconcileSymbol?.id}`,
        label: 'route handler BillingStatementService#reconcileInvoice',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${reconcileSymbol?.id}`,
        to: `node_symbol_${managerSymbol?.id}`,
        label: 'uses BillingStatementManager',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${reconcileSymbol?.id}`,
        to: `node_symbol_${managerMethod?.id}`,
        label: 'calls BillingStatementManager.reconcile',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingStatementRepository.markReconciled',
      }),
    ]));

    const billingCapability = inventory.capabilities.find((capability) => capability.id === 'cap_api_billing_statement_service');
    expect(billingCapability).toMatchObject({
      label: 'Billing Statement Service API',
      entrypointRefs: [billingRoute?.id],
    });
    expect(billingCapability?.symbolRefs).toEqual(expect.arrayContaining([
      reconcileSymbol?.id,
      managerSymbol?.id,
      managerMethod?.id,
    ]));
  });

  test('links imported TypeScript route handlers to exported controller symbols', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-imported-handler-'));
    await mkdir(join(root, 'apps/api/src'), { recursive: true });
    await mkdir(join(root, 'apps/api/src/services'), { recursive: true });
    await mkdir(join(root, 'apps/api/test'), { recursive: true });

    await writeFile(
      join(root, 'apps/api/src/orders-route.ts'),
      [
        'import { Router } from "express";',
        'import { deleteOrder } from "./orders-controller";',
        'export const router = Router();',
        'router.delete("/api/orders/:id", deleteOrder);',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/orders-controller.ts'),
      [
        'import { OrderService as ImportedOrderService } from "./services";',
        'class ImportedOrderService { remove() { return false; } }',
        'export function deleteOrder() {',
        '  const service = new ImportedOrderService();',
        '  return service.remove();',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/services/index.ts'),
      'export { OrderService } from "./order-service";\n',
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/services/order-service.ts'),
      [
        'export class OrderService {',
        '  remove() { return true; }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/test/orders-route.test.ts'),
      'import { describe, it, expect } from "vitest";\ndescribe("orders route", () => { it("deletes", () => expect(true).toBe(true)); });\n',
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_imported_handler',
      workflowRunId: 'run_imported_handler',
      repoRoot: root,
      generatedAt: '2026-07-01T01:30:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 20,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route' && entrypoint.route === '/api/orders/:id'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'deleteOrder'
      && symbol.path === 'apps/api/src/orders-controller.ts'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.name === 'OrderService' && symbol.path === 'apps/api/src/services/order-service.ts'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'remove'
      && symbol.path === 'apps/api/src/services/order-service.ts'
    ));
    const localServiceFallback = inventory.symbols.find((symbol) => (
      symbol.name === 'ImportedOrderService' && symbol.path === 'apps/api/src/orders-controller.ts'
    ));

    expect(inventory.imports).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'apps/api/src/orders-route.ts',
        specifier: './orders-controller',
        importedNames: ['deleteOrder'],
        sourceRefs: ['file:apps/api/src/orders-route.ts#L2'],
      }),
      expect.objectContaining({
        path: 'apps/api/src/orders-controller.ts',
        specifier: './services',
        importedNames: ['ImportedOrderService'],
        namedImports: [{ imported: 'OrderService', local: 'ImportedOrderService' }],
        sourceRefs: ['file:apps/api/src/orders-controller.ts#L1'],
      }),
    ]));
    expect(route).toBeDefined();
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(serviceMethod).toBeDefined();
    expect(localServiceFallback).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/orders-route.ts#L2',
          'file:apps/api/src/orders-route.ts#L4',
          'file:apps/api/src/orders-controller.ts#L3',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses ImportedOrderService',
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/orders-controller.ts#L1',
          'file:apps/api/src/orders-controller.ts#L5',
          'file:apps/api/src/services/index.ts#L1',
          'file:apps/api/src/services/order-service.ts#L1',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls ImportedOrderService.remove',
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/orders-controller.ts#L1',
          'file:apps/api/src/orders-controller.ts#L4',
          'file:apps/api/src/orders-controller.ts#L5',
          'file:apps/api/src/services/index.ts#L1',
          'file:apps/api/src/services/order-service.ts#L1',
          'file:apps/api/src/services/order-service.ts#L2',
        ]),
      }),
    ]));
    expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${localServiceFallback?.id}`,
      }),
    ]));

    const ordersCapability = inventory.capabilities.find((capability) => capability.id === 'cap_api_orders');
    expect(ordersCapability).toMatchObject({ label: 'Orders API' });
    expect(ordersCapability?.symbolRefs).toEqual(expect.arrayContaining([
      handler?.id,
      service?.id,
    ]));
    expect(ordersCapability?.sourceRefs).toEqual(expect.arrayContaining([
      'file:apps/api/src/orders-route.ts#L4',
      'file:apps/api/src/orders-controller.ts#L3',
      'file:apps/api/src/services/order-service.ts#L1',
      'file:apps/api/test/orders-route.test.ts',
    ]));
  });

  test('detects Restify routes only from static createServer evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-restify-routes-'));
    await mkdir(join(root, 'apps/api/src/controllers'), { recursive: true });

    await writeFile(
      join(root, 'apps/api/src/restify-routes.ts'),
      [
        'import restify from "restify";',
        'import * as restifyNamespace from "restify";',
        'import { showBilling } from "./controllers/billing-controller";',
        'import removeBilling from "./controllers/remove-billing";',
        'const billingServer = restify.createServer();',
        'billingServer.get("/billing/:id", showBilling);',
        'const namespaceServer = restifyNamespace.createServer();',
        'namespaceServer.del("/billing/:id", removeBilling);',
        'const legacyRestify = require("restify");',
        'const legacyServer = legacyRestify.createServer();',
        'legacyServer.post("/billing", createBilling);',
        'export function createBilling() {}',
        'const directServer = require("restify").createServer();',
        'directServer.put("/billing/:id", updateBilling);',
        'export function updateBilling() {}',
        'directServer.delete("/billing/:id/audit", auditBilling);',
        'export function auditBilling() {}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/controllers/billing-controller.ts'),
      'export function showBilling() { return true; }\n',
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/controllers/remove-billing.ts'),
      'export default function removeBilling() { return true; }\n',
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/not-restify.ts'),
      [
        'const restify = makeFactory();',
        'const server = restify.createServer();',
        'server.get("/billing/ghost", ghostBilling);',
        'const arbitraryRoutes = { get() {} };',
        'arbitraryRoutes.get("/billing/local", ghostBilling);',
        'export function ghostBilling() {}',
        'function makeFactory() { return { createServer() { return { get() {} }; } }; }',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_restify_routes',
      workflowRunId: 'run_restify_routes',
      repoRoot: root,
      generatedAt: '2026-07-02T00:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 20,
      },
    });

    const routes = inventory.entrypoints
      .filter((entrypoint) => entrypoint.kind === 'http_route')
      .map((entrypoint) => `${entrypoint.method} ${entrypoint.route}`)
      .sort();
    expect(routes).toEqual(expect.arrayContaining([
      'DELETE /billing/:id',
      'DELETE /billing/:id/audit',
      'GET /billing/:id',
      'POST /billing',
      'PUT /billing/:id',
    ]));
    expect(routes).not.toContain('GET /billing/ghost');
    expect(routes).not.toContain('GET /billing/local');

    const getRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/billing/:id'
    ));
    const deleteRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'DELETE'
      && entrypoint.route === '/billing/:id'
    ));
    const postRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/billing'
    ));
    const putRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'PUT'
      && entrypoint.route === '/billing/:id'
    ));
    const showBilling = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'showBilling'
      && symbol.path === 'apps/api/src/controllers/billing-controller.ts'
    ));
    const removeBilling = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'removeBilling'
      && symbol.path === 'apps/api/src/controllers/remove-billing.ts'
    ));
    const createBilling = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'createBilling'
      && symbol.path === 'apps/api/src/restify-routes.ts'
    ));
    const updateBilling = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'updateBilling'
      && symbol.path === 'apps/api/src/restify-routes.ts'
    ));

    expect(getRoute).toMatchObject({
      handler: 'showBilling',
      sourceRefs: expect.arrayContaining([
        'file:apps/api/src/restify-routes.ts#L5',
        'file:apps/api/src/restify-routes.ts#L6',
      ]),
    });
    expect(deleteRoute).toMatchObject({
      handler: 'removeBilling',
      sourceRefs: expect.arrayContaining([
        'file:apps/api/src/restify-routes.ts#L7',
        'file:apps/api/src/restify-routes.ts#L8',
      ]),
    });
    expect(postRoute).toMatchObject({
      handler: 'createBilling',
      sourceRefs: expect.arrayContaining([
        'file:apps/api/src/restify-routes.ts#L10',
        'file:apps/api/src/restify-routes.ts#L11',
      ]),
    });
    expect(putRoute).toMatchObject({
      handler: 'updateBilling',
      sourceRefs: expect.arrayContaining([
        'file:apps/api/src/restify-routes.ts#L13',
        'file:apps/api/src/restify-routes.ts#L14',
      ]),
    });
    expect(showBilling).toBeDefined();
    expect(removeBilling).toBeDefined();
    expect(createBilling).toBeDefined();
    expect(updateBilling).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${getRoute?.id}`,
        to: `node_symbol_${showBilling?.id}`,
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/restify-routes.ts#L3',
          'file:apps/api/src/restify-routes.ts#L5',
          'file:apps/api/src/restify-routes.ts#L6',
          'file:apps/api/src/controllers/billing-controller.ts#L1',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${deleteRoute?.id}`,
        to: `node_symbol_${removeBilling?.id}`,
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/restify-routes.ts#L4',
          'file:apps/api/src/restify-routes.ts#L7',
          'file:apps/api/src/restify-routes.ts#L8',
          'file:apps/api/src/controllers/remove-billing.ts#L1',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${postRoute?.id}`,
        to: `node_symbol_${createBilling?.id}`,
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/restify-routes.ts#L10',
          'file:apps/api/src/restify-routes.ts#L11',
          'file:apps/api/src/restify-routes.ts#L12',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${putRoute?.id}`,
        to: `node_symbol_${updateBilling?.id}`,
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/restify-routes.ts#L13',
          'file:apps/api/src/restify-routes.ts#L14',
          'file:apps/api/src/restify-routes.ts#L15',
        ]),
      }),
    ]));
  });

  test('detects static Hapi route arrays with handler graph evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-hapi-route-arrays-'));
    await mkdir(join(root, 'apps/api/src/controllers'), { recursive: true });

    await writeFile(
      join(root, 'apps/api/src/hapi-routes.ts'),
      [
        'import Hapi from "@hapi/hapi";',
        'import { showBilling, reconcileBilling } from "./controllers/billing-controller";',
        'const server = Hapi.server({ port: 3000 });',
        'server.route([',
        '  { method: "GET", path: "/api/billing/{invoiceId}", handler: showBilling },',
        '  {',
        '    method: "POST",',
        '    path: "/api/billing/reconcile",',
        '    handler: reconcileBilling,',
        '  },',
        '  { ...{ method: "DELETE" }, path: "/api/billing/spread", handler: ghostBilling },',
        ']);',
        'const fake = { route() {} };',
        'fake.route([{ method: "GET", path: "/api/billing/ghost", handler: ghostBilling }]);',
        'export function ghostBilling() { return true; }',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/controllers/billing-controller.ts'),
      [
        'export function showBilling() { return true; }',
        'export function reconcileBilling() { return true; }',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_hapi_route_arrays',
      workflowRunId: 'run_hapi_route_arrays',
      repoRoot: root,
      generatedAt: '2026-07-03T00:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 20,
      },
    });

    const showRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/billing/{invoiceId}'
    ));
    const reconcileRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/billing/reconcile'
    ));
    const showHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'showBilling'
      && symbol.path === 'apps/api/src/controllers/billing-controller.ts'
    ));
    const reconcileHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'reconcileBilling'
      && symbol.path === 'apps/api/src/controllers/billing-controller.ts'
    ));

    expect(showRoute).toMatchObject({
      handler: 'showBilling',
      sourceRefs: ['file:apps/api/src/hapi-routes.ts#L5'],
    });
    expect(reconcileRoute).toMatchObject({
      handler: 'reconcileBilling',
      sourceRefs: ['file:apps/api/src/hapi-routes.ts#L6'],
    });
    expect(inventory.entrypoints).not.toContainEqual(expect.objectContaining({
      kind: 'http_route',
      route: '/api/billing/ghost',
    }));
    expect(inventory.entrypoints).not.toContainEqual(expect.objectContaining({
      kind: 'http_route',
      route: '/api/billing/spread',
    }));
    expect(showHandler).toBeDefined();
    expect(reconcileHandler).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${showRoute?.id}`,
        to: `node_symbol_${showHandler?.id}`,
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/hapi-routes.ts#L2',
          'file:apps/api/src/hapi-routes.ts#L5',
          'file:apps/api/src/controllers/billing-controller.ts#L1',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${reconcileRoute?.id}`,
        to: `node_symbol_${reconcileHandler?.id}`,
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/hapi-routes.ts#L2',
          'file:apps/api/src/hapi-routes.ts#L6',
          'file:apps/api/src/controllers/billing-controller.ts#L2',
        ]),
      }),
    ]));
  });

  test('links default-imported TypeScript route handlers to default exports', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-default-handler-'));
    await mkdir(join(root, 'apps/api/src/controllers'), { recursive: true });

    await writeFile(
      join(root, 'apps/api/src/orders-route.ts'),
      [
        'import { Router } from "express";',
        'import removeOrder from "./controllers/delete-order";',
        'import createOrder from "./controllers/create-order";',
        'export const router = Router();',
        'router.delete("/api/orders/:id", removeOrder);',
        'router.post("/api/orders", createOrder);',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/controllers/delete-order.ts'),
      'export default function deleteOrder() { return true; }\n',
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/controllers/create-order.ts'),
      [
        'const createOrder = () => true;',
        'export default createOrder;',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_default_handler',
      workflowRunId: 'run_default_handler',
      repoRoot: root,
      generatedAt: '2026-07-01T03:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 20,
      },
    });

    const deleteRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route' && entrypoint.route === '/api/orders/:id'
    ));
    const createRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route' && entrypoint.route === '/api/orders'
    ));
    const deleteHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'deleteOrder'
      && symbol.path === 'apps/api/src/controllers/delete-order.ts'
    ));
    const createHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'const'
      && symbol.name === 'createOrder'
      && symbol.path === 'apps/api/src/controllers/create-order.ts'
    ));

    expect(inventory.imports).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'apps/api/src/orders-route.ts',
        specifier: './controllers/delete-order',
        importedNames: ['removeOrder'],
        defaultImport: 'removeOrder',
        sourceRefs: ['file:apps/api/src/orders-route.ts#L2'],
      }),
      expect.objectContaining({
        path: 'apps/api/src/orders-route.ts',
        specifier: './controllers/create-order',
        importedNames: ['createOrder'],
        defaultImport: 'createOrder',
        sourceRefs: ['file:apps/api/src/orders-route.ts#L3'],
      }),
    ]));
    expect(inventory.exports).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'apps/api/src/controllers/delete-order.ts',
        name: 'default',
        kind: 'default',
        symbolRef: deleteHandler?.id,
      }),
      expect.objectContaining({
        path: 'apps/api/src/controllers/create-order.ts',
        name: 'createOrder',
        kind: 'default',
        exportedAs: 'default',
      }),
    ]));
    expect(deleteRoute).toBeDefined();
    expect(createRoute).toBeDefined();
    expect(deleteHandler).toBeDefined();
    expect(createHandler).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${deleteRoute?.id}`,
        to: `node_symbol_${deleteHandler?.id}`,
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/orders-route.ts#L2',
          'file:apps/api/src/orders-route.ts#L5',
          'file:apps/api/src/controllers/delete-order.ts#L1',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${createRoute?.id}`,
        to: `node_symbol_${createHandler?.id}`,
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/orders-route.ts#L3',
          'file:apps/api/src/orders-route.ts#L6',
          'file:apps/api/src/controllers/create-order.ts#L1',
          'file:apps/api/src/controllers/create-order.ts#L2',
        ]),
      }),
    ]));
  });

  test('links namespace-constructed TypeScript service method calls from route handlers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-namespace-constructed-service-'));
    await mkdir(join(root, 'apps/api/src/services'), { recursive: true });

    await writeFile(
      join(root, 'apps/api/src/orders-route.ts'),
      [
        'import { Router } from "express";',
        'import * as OrdersController from "./orders-controller";',
        'export const router = Router();',
        'router.get("/api/orders", OrdersController.index);',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/orders-controller.ts'),
      [
        'import * as Services from "./services";',
        'export function index() {',
        '  const service = new Services.OrderService();',
        '  return service.listOrders();',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/services/index.ts'),
      'export { OrderService } from "./order-service";\n',
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/services/order-service.ts'),
      [
        'export class OrderService {',
        '  listOrders() { return []; }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_namespace_constructed_service',
      workflowRunId: 'run_namespace_constructed_service',
      repoRoot: root,
      generatedAt: '2026-07-01T15:30:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 12,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route' && entrypoint.route === '/api/orders'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'index'
      && symbol.path === 'apps/api/src/orders-controller.ts'
    ));
    const serviceClass = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'OrderService'
      && symbol.path === 'apps/api/src/services/order-service.ts'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'listOrders'
      && symbol.path === 'apps/api/src/services/order-service.ts'
    ));

    expect(route).toMatchObject({
      handler: 'OrdersController.index',
      path: 'apps/api/src/orders-route.ts',
    });
    expect(handler).toBeDefined();
    expect(serviceClass).toBeDefined();
    expect(serviceMethod).toBeDefined();
    expect(inventory.imports).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'apps/api/src/orders-controller.ts',
        specifier: './services',
        importedNames: ['Services'],
        namespaceImport: 'Services',
      }),
    ]));
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${serviceClass?.id}`,
        label: 'uses Services.OrderService',
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/orders-controller.ts#L1',
          'file:apps/api/src/orders-controller.ts#L4',
          'file:apps/api/src/services/index.ts#L1',
          'file:apps/api/src/services/order-service.ts#L1',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls Services.OrderService.listOrders',
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/orders-controller.ts#L1',
          'file:apps/api/src/orders-controller.ts#L3',
          'file:apps/api/src/orders-controller.ts#L4',
          'file:apps/api/src/services/index.ts#L1',
          'file:apps/api/src/services/order-service.ts#L1',
          'file:apps/api/src/services/order-service.ts#L2',
        ]),
      }),
    ]));
  });

  test('links NestJS parameter-property interface receivers to unique implementation methods', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-nest-parameter-property-'));
    await mkdir(join(root, 'apps/api/src'), { recursive: true });

    await writeFile(
      join(root, 'apps/api/src/billing.controller.ts'),
      [
        'import { Controller, Post } from "@nestjs/common";',
        'import { BillingWorkflow } from "./billing.workflow";',
        '@Controller("/api/v1/billing")',
        'export class BillingController {',
        '  constructor(private readonly workflow: BillingWorkflow) {}',
        '',
        '  @Post(":id/approve")',
        '  approve(id: string) {',
        '    return this.workflow.approve(id);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/billing.workflow.ts'),
      [
        'export interface BillingWorkflow {',
        '  approve(id: string): string;',
        '}',
        'export class DatabaseBillingWorkflow implements BillingWorkflow {',
        '  approve(id: string) {',
        '    return id;',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_nest_parameter_property',
      workflowRunId: 'run_nest_parameter_property',
      repoRoot: root,
      generatedAt: '2026-07-03T18:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 10,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v1/billing/:id/approve'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'approve'
      && symbol.path === 'apps/api/src/billing.controller.ts'
    ));
    const workflowInterface = inventory.symbols.find((symbol) => (
      symbol.kind === 'interface'
      && symbol.name === 'BillingWorkflow'
      && symbol.path === 'apps/api/src/billing.workflow.ts'
    ));
    const workflow = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'DatabaseBillingWorkflow'
      && symbol.path === 'apps/api/src/billing.workflow.ts'
    ));
    const workflowMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'approve'
      && symbol.path === 'apps/api/src/billing.workflow.ts'
    ));

    expect(route).toBeDefined();
    expect(handler).toBeDefined();
    expect(workflowInterface).toBeDefined();
    expect(workflow).toBeDefined();
    expect(workflowMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/billing.controller.ts#L3',
          'file:apps/api/src/billing.controller.ts#L7',
          'file:apps/api/src/billing.controller.ts#L8',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${workflow?.id}`,
        label: 'uses DatabaseBillingWorkflow',
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/billing.controller.ts#L2',
          'file:apps/api/src/billing.controller.ts#L5',
          'file:apps/api/src/billing.controller.ts#L9',
          'file:apps/api/src/billing.workflow.ts#L1',
          'file:apps/api/src/billing.workflow.ts#L4',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${workflowMethod?.id}`,
        label: 'calls DatabaseBillingWorkflow.approve',
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/billing.controller.ts#L2',
          'file:apps/api/src/billing.controller.ts#L5',
          'file:apps/api/src/billing.controller.ts#L9',
          'file:apps/api/src/billing.workflow.ts#L1',
          'file:apps/api/src/billing.workflow.ts#L4',
          'file:apps/api/src/billing.workflow.ts#L5',
        ]),
      }),
    ]));
  });

  test('links NestJS parameter-property concrete class receivers to service methods', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-nest-parameter-property-concrete-'));
    await mkdir(join(root, 'apps/api/src'), { recursive: true });

    await writeFile(
      join(root, 'apps/api/src/billing.controller.ts'),
      [
        'import { Controller, Post } from "@nestjs/common";',
        'import { BillingService } from "./billing.service";',
        '@Controller("/api/v1/billing")',
        'export class BillingController {',
        '  constructor(private billingService: BillingService) {}',
        '',
        '  @Post(":id/cancel")',
        '  cancel(id: string) {',
        '    return this.billingService.cancel(id);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/billing.service.ts'),
      [
        'export class BillingService {',
        '  cancel(id: string) {',
        '    return id;',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_nest_parameter_property_concrete',
      workflowRunId: 'run_nest_parameter_property_concrete',
      repoRoot: root,
      generatedAt: '2026-07-03T18:10:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 10,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v1/billing/:id/cancel'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'cancel'
      && symbol.path === 'apps/api/src/billing.controller.ts'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingService'
      && symbol.path === 'apps/api/src/billing.service.ts'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'cancel'
      && symbol.path === 'apps/api/src/billing.service.ts'
    ));

    expect(route).toBeDefined();
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(serviceMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses BillingService',
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/billing.controller.ts#L2',
          'file:apps/api/src/billing.controller.ts#L5',
          'file:apps/api/src/billing.controller.ts#L9',
          'file:apps/api/src/billing.service.ts#L1',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls BillingService.cancel',
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/billing.controller.ts#L2',
          'file:apps/api/src/billing.controller.ts#L5',
          'file:apps/api/src/billing.controller.ts#L9',
          'file:apps/api/src/billing.service.ts#L1',
          'file:apps/api/src/billing.service.ts#L2',
        ]),
      }),
    ]));
  });

  test('does not link NestJS parameter-property interfaces with ambiguous implementations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-nest-parameter-property-ambiguous-'));
    await mkdir(join(root, 'apps/api/src'), { recursive: true });

    await writeFile(
      join(root, 'apps/api/src/billing.controller.ts'),
      [
        'import { Controller, Post } from "@nestjs/common";',
        'import { BillingWorkflow } from "./billing.workflow";',
        '@Controller("/api/v1/billing")',
        'export class BillingController {',
        '  constructor(private workflow: BillingWorkflow) {}',
        '',
        '  @Post(":id/reconcile")',
        '  reconcile(id: string) {',
        '    return this.workflow.reconcile(id);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/billing.module.ts'),
      [
        'import { Module } from "@nestjs/common";',
        'import { BillingWorkflow, DatabaseBillingWorkflow } from "./billing.workflow";',
        '@Module({',
        '  providers: [{ provide: BillingWorkflow, useClass: DatabaseBillingWorkflow }],',
        '})',
        'export class BillingModule {}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/billing.workflow.ts'),
      [
        'export interface BillingWorkflow {',
        '  reconcile(id: string): string;',
        '}',
        'export class DatabaseBillingWorkflow implements BillingWorkflow {',
        '  reconcile(id: string) {',
        '    return id;',
        '  }',
        '}',
        'export class QueuedBillingWorkflow implements BillingWorkflow {',
        '  reconcile(id: string) {',
        '    return id;',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_nest_parameter_property_ambiguous',
      workflowRunId: 'run_nest_parameter_property_ambiguous',
      repoRoot: root,
      generatedAt: '2026-07-03T18:15:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 10,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v1/billing/:id/reconcile'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'reconcile'
      && symbol.path === 'apps/api/src/billing.controller.ts'
    ));
    const workflowTargets = inventory.symbols.filter((symbol) => (
      symbol.path === 'apps/api/src/billing.workflow.ts'
      && ['DatabaseBillingWorkflow', 'QueuedBillingWorkflow', 'reconcile'].includes(symbol.name)
    ));

    expect(route).toBeDefined();
    expect(handler).toBeDefined();
    expect(workflowTargets.length).toBeGreaterThanOrEqual(4);
    for (const target of workflowTargets) {
      expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: 'symbol_reference',
          from: `node_symbol_${handler?.id}`,
          to: `node_symbol_${target.id}`,
        }),
      ]));
    }
  });

  test('links object-literal TypeScript controller and service methods through route graph', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-object-literal-service-'));
    await mkdir(join(root, 'apps/api/src'), { recursive: true });

    await writeFile(
      join(root, 'apps/api/src/orders-route.ts'),
      [
        'import { Router } from "express";',
        'import { OrdersController } from "./orders-controller";',
        'export const router = Router();',
        'router.get("/api/orders", OrdersController.index);',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/orders-controller.ts'),
      [
        'import { OrdersService } from "./orders-service";',
        'export const OrdersController = {',
        '  index() {',
        '    return OrdersService.listOrders();',
        '  },',
        '};',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/orders-service.ts'),
      [
        'export const OrdersService = {',
        '  listOrders() { return []; },',
        '};',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_object_literal_service',
      workflowRunId: 'run_object_literal_service',
      repoRoot: root,
      generatedAt: '2026-07-01T16:30:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 12,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route' && entrypoint.route === '/api/orders'
    ));
    const controllerObject = inventory.symbols.find((symbol) => (
      symbol.kind === 'const'
      && symbol.name === 'OrdersController'
      && symbol.path === 'apps/api/src/orders-controller.ts'
    ));
    const controllerMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'index'
      && symbol.path === 'apps/api/src/orders-controller.ts'
      && symbol.signature.startsWith('OrdersController.')
    ));
    const serviceObject = inventory.symbols.find((symbol) => (
      symbol.kind === 'const'
      && symbol.name === 'OrdersService'
      && symbol.path === 'apps/api/src/orders-service.ts'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'listOrders'
      && symbol.path === 'apps/api/src/orders-service.ts'
      && symbol.signature.startsWith('OrdersService.')
    ));

    expect(route).toMatchObject({
      handler: 'OrdersController.index',
      path: 'apps/api/src/orders-route.ts',
    });
    expect(controllerObject).toBeDefined();
    expect(controllerMethod).toBeDefined();
    expect(serviceObject).toBeDefined();
    expect(serviceMethod).toBeDefined();
    expect(inventory.exports).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'apps/api/src/orders-controller.ts',
        name: 'OrdersController',
        symbolRef: controllerObject?.id,
      }),
      expect.objectContaining({
        path: 'apps/api/src/orders-service.ts',
        name: 'OrdersService',
        symbolRef: serviceObject?.id,
      }),
    ]));
    expect(inventory.exports).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'apps/api/src/orders-controller.ts',
        name: 'index',
      }),
      expect.objectContaining({
        path: 'apps/api/src/orders-service.ts',
        name: 'listOrders',
      }),
    ]));
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${controllerMethod?.id}`,
        label: 'route handler OrdersController.index',
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/orders-route.ts#L2',
          'file:apps/api/src/orders-route.ts#L4',
          'file:apps/api/src/orders-controller.ts#L2',
          'file:apps/api/src/orders-controller.ts#L3',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${controllerMethod?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls OrdersService.listOrders',
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/orders-controller.ts#L1',
          'file:apps/api/src/orders-controller.ts#L4',
          'file:apps/api/src/orders-service.ts#L1',
          'file:apps/api/src/orders-service.ts#L2',
        ]),
      }),
    ]));
  });

  test('links object-literal TypeScript controller and service methods through named export route graph', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-object-literal-named-export-'));
    await mkdir(join(root, 'apps/api/src'), { recursive: true });

    await writeFile(
      join(root, 'apps/api/src/orders-route.ts'),
      [
        'import { Router } from "express";',
        'import { OrdersController } from "./orders-controller";',
        'const router = Router();',
        'router.get("/api/orders", OrdersController.index);',
        'export { router };',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/orders-controller.ts'),
      [
        'import { OrdersService } from "./orders-service";',
        'const OrdersController = {',
        '  index() {',
        '    return OrdersService.listOrders();',
        '  },',
        '};',
        'export { OrdersController };',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/orders-service.ts'),
      [
        'const OrdersService = {',
        '  listOrders() { return []; },',
        '};',
        'export { OrdersService };',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_object_literal_named_export',
      workflowRunId: 'run_object_literal_named_export',
      repoRoot: root,
      generatedAt: '2026-07-01T20:30:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 12,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route' && entrypoint.route === '/api/orders'
    ));
    const controllerObject = inventory.symbols.find((symbol) => (
      symbol.kind === 'const'
      && symbol.name === 'OrdersController'
      && symbol.path === 'apps/api/src/orders-controller.ts'
    ));
    const controllerMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'index'
      && symbol.path === 'apps/api/src/orders-controller.ts'
      && symbol.signature.startsWith('OrdersController.')
    ));
    const serviceObject = inventory.symbols.find((symbol) => (
      symbol.kind === 'const'
      && symbol.name === 'OrdersService'
      && symbol.path === 'apps/api/src/orders-service.ts'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'listOrders'
      && symbol.path === 'apps/api/src/orders-service.ts'
      && symbol.signature.startsWith('OrdersService.')
    ));

    expect(route).toMatchObject({
      handler: 'OrdersController.index',
      path: 'apps/api/src/orders-route.ts',
    });
    expect(controllerObject).toMatchObject({ exported: true });
    expect(serviceObject).toMatchObject({ exported: true });
    expect(controllerMethod).toMatchObject({ exported: false });
    expect(serviceMethod).toMatchObject({ exported: false });
    expect(inventory.exports).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'apps/api/src/orders-controller.ts',
        name: 'OrdersController',
        symbolRef: controllerObject?.id,
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/orders-controller.ts#L2',
          'file:apps/api/src/orders-controller.ts#L7',
        ]),
      }),
      expect.objectContaining({
        path: 'apps/api/src/orders-service.ts',
        name: 'OrdersService',
        symbolRef: serviceObject?.id,
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/orders-service.ts#L1',
          'file:apps/api/src/orders-service.ts#L4',
        ]),
      }),
    ]));
    expect(inventory.exports).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'apps/api/src/orders-controller.ts',
        name: 'index',
      }),
      expect.objectContaining({
        path: 'apps/api/src/orders-service.ts',
        name: 'listOrders',
      }),
    ]));
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${controllerMethod?.id}`,
        label: 'route handler OrdersController.index',
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/orders-route.ts#L2',
          'file:apps/api/src/orders-route.ts#L4',
          'file:apps/api/src/orders-controller.ts#L2',
          'file:apps/api/src/orders-controller.ts#L3',
          'file:apps/api/src/orders-controller.ts#L7',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${controllerMethod?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls OrdersService.listOrders',
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/orders-controller.ts#L1',
          'file:apps/api/src/orders-controller.ts#L4',
          'file:apps/api/src/orders-service.ts#L1',
          'file:apps/api/src/orders-service.ts#L2',
          'file:apps/api/src/orders-service.ts#L4',
        ]),
      }),
    ]));
  });

  test('links namespace-imported TypeScript route handlers to exported controller symbols', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-namespace-handler-'));
    await mkdir(join(root, 'apps/api/src'), { recursive: true });

    await writeFile(
      join(root, 'apps/api/src/orders-route.ts'),
      [
        'import { Router } from "express";',
        'import * as OrdersController from "./orders-controller";',
        'export const router = Router();',
        'function show() { return false; }',
        'router.get("/api/orders/:id", OrdersController.show);',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/orders-controller.ts'),
      [
        'export function show() { return true; }',
        'export function index() { return []; }',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_namespace_handler',
      workflowRunId: 'run_namespace_handler',
      repoRoot: root,
      generatedAt: '2026-07-01T04:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 20,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route' && entrypoint.route === '/api/orders/:id'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'show'
      && symbol.path === 'apps/api/src/orders-controller.ts'
    ));
    const localFallback = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'show'
      && symbol.path === 'apps/api/src/orders-route.ts'
    ));

    expect(route).toMatchObject({ handler: 'OrdersController.show' });
    expect(handler).toBeDefined();
    expect(localFallback).toBeDefined();
    expect(inventory.imports).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'apps/api/src/orders-route.ts',
        specifier: './orders-controller',
        importedNames: ['OrdersController'],
        namespaceImport: 'OrdersController',
        sourceRefs: ['file:apps/api/src/orders-route.ts#L2'],
      }),
    ]));
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
        label: 'route handler OrdersController.show',
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/orders-route.ts#L2',
          'file:apps/api/src/orders-route.ts#L5',
          'file:apps/api/src/orders-controller.ts#L1',
        ]),
      }),
    ]));
    expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${localFallback?.id}`,
      }),
    ]));
  });

  test('normalizes bound TypeScript route handlers before linking controller symbols', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-bound-handler-'));
    await mkdir(join(root, 'apps/api/src'), { recursive: true });

    await writeFile(
      join(root, 'apps/api/src/orders-route.ts'),
      [
        'import { Router } from "express";',
        'import * as OrdersController from "./orders-controller";',
        'export const router = Router();',
        'export function auth() { return true; }',
        'router.get("/api/orders", auth, OrdersController.index.bind(OrdersController));',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/orders-controller.ts'),
      [
        'export function index() { return []; }',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_bound_handler',
      workflowRunId: 'run_bound_handler',
      repoRoot: root,
      generatedAt: '2026-07-01T16:30:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 12,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route' && entrypoint.route === '/api/orders'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'index'
      && symbol.path === 'apps/api/src/orders-controller.ts'
    ));
    const authMiddleware = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'auth'
      && symbol.path === 'apps/api/src/orders-route.ts'
    ));

    expect(route).toMatchObject({
      handler: 'OrdersController.index',
      path: 'apps/api/src/orders-route.ts',
    });
    expect(handler).toBeDefined();
    expect(authMiddleware).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
        label: 'route handler OrdersController.index',
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/orders-route.ts#L2',
          'file:apps/api/src/orders-route.ts#L5',
          'file:apps/api/src/orders-controller.ts#L1',
        ]),
      }),
    ]));
    expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${authMiddleware?.id}`,
      }),
    ]));
  });

  test('links constructed controller instance route handlers to class methods', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-constructed-controller-handler-'));
    await mkdir(join(root, 'apps/api/src'), { recursive: true });

    await writeFile(
      join(root, 'apps/api/src/orders-route.ts'),
      [
        'import { Router } from "express";',
        'import { OrdersController } from "./orders-controller";',
        'export const router = Router();',
        'const controller = new OrdersController();',
        'router.get("/api/orders", controller.index.bind(controller));',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/orders-controller.ts'),
      [
        'export class OrdersController {',
        '  index() { return []; }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_constructed_controller_handler',
      workflowRunId: 'run_constructed_controller_handler',
      repoRoot: root,
      generatedAt: '2026-07-01T17:30:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 12,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route' && entrypoint.route === '/api/orders'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'index'
      && symbol.path === 'apps/api/src/orders-controller.ts'
    ));
    const controllerClass = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'OrdersController'
      && symbol.path === 'apps/api/src/orders-controller.ts'
    ));

    expect(route).toMatchObject({
      handler: 'controller.index',
      path: 'apps/api/src/orders-route.ts',
    });
    expect(handler).toBeDefined();
    expect(controllerClass).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
        label: 'route handler controller.index',
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/orders-route.ts#L2',
          'file:apps/api/src/orders-route.ts#L4',
          'file:apps/api/src/orders-route.ts#L5',
          'file:apps/api/src/orders-controller.ts#L1',
          'file:apps/api/src/orders-controller.ts#L2',
        ]),
      }),
    ]));
    expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${controllerClass?.id}`,
      }),
    ]));
  });

  test('links re-exported Next App Router handlers to source symbols', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-next-reexport-handler-'));
    await mkdir(join(root, 'app/api/orders'), { recursive: true });

    await writeFile(
      join(root, 'app/api/orders/route.ts'),
      'export { listOrders as GET } from "./orders-handler";\n',
      'utf8',
    );
    await writeFile(
      join(root, 'app/api/orders/orders-handler.ts'),
      'export async function listOrders() { return Response.json([]); }\n',
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_next_reexport_handler',
      workflowRunId: 'run_next_reexport_handler',
      repoRoot: root,
      generatedAt: '2026-07-01T18:30:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 12,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/orders'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'listOrders'
      && symbol.path === 'app/api/orders/orders-handler.ts'
    ));

    expect(route).toMatchObject({
      handler: 'GET',
      path: 'app/api/orders/route.ts',
    });
    expect(handler).toBeDefined();
    expect(inventory.exports).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'app/api/orders/route.ts',
        name: 'listOrders',
        exportedAs: 'GET',
        specifier: './orders-handler',
      }),
    ]));
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
        label: 'route handler GET',
        sourceRefs: expect.arrayContaining([
          'file:app/api/orders/route.ts#L1',
          'file:app/api/orders/orders-handler.ts#L1',
        ]),
      }),
    ]));
  });

  test('links exported const Next App Router handler aliases to imported source symbols', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-next-export-const-alias-handler-'));
    await mkdir(join(root, 'app/api/orders'), { recursive: true });

    await writeFile(
      join(root, 'app/api/orders/route.ts'),
      [
        'import { listOrders } from "./orders-handler";',
        'export const GET = listOrders;',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/api/orders/orders-handler.ts'),
      'export async function listOrders() { return Response.json([]); }\n',
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_next_export_const_alias_handler',
      workflowRunId: 'run_next_export_const_alias_handler',
      repoRoot: root,
      generatedAt: '2026-07-02T09:30:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 12,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/orders'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'listOrders'
      && symbol.path === 'app/api/orders/orders-handler.ts'
    ));
    const routeConst = inventory.symbols.find((symbol) => (
      symbol.kind === 'const'
      && symbol.name === 'GET'
      && symbol.path === 'app/api/orders/route.ts'
    ));

    expect(route).toMatchObject({
      handler: 'GET',
      path: 'app/api/orders/route.ts',
    });
    expect(handler).toBeDefined();
    expect(routeConst).toBeDefined();
    expect(inventory.exports).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'app/api/orders/route.ts',
        name: 'listOrders',
        exportedAs: 'GET',
        specifier: './orders-handler',
      }),
    ]));
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
        label: 'route handler GET',
        sourceRefs: expect.arrayContaining([
          'file:app/api/orders/route.ts#L1',
          'file:app/api/orders/route.ts#L2',
          'file:app/api/orders/orders-handler.ts#L1',
        ]),
      }),
    ]));
    expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${routeConst?.id}`,
      }),
    ]));
  });

  test('links local exports of imported Next App Router handlers to source symbols', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-next-local-import-export-handler-'));
    await mkdir(join(root, 'app/api/orders'), { recursive: true });

    await writeFile(
      join(root, 'app/api/orders/route.ts'),
      [
        'import { listOrders } from "./orders-handler";',
        'export { listOrders as GET };',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/api/orders/orders-handler.ts'),
      'export async function listOrders() { return Response.json([]); }\n',
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_next_local_import_export_handler',
      workflowRunId: 'run_next_local_import_export_handler',
      repoRoot: root,
      generatedAt: '2026-07-02T12:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 12,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/orders'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'listOrders'
      && symbol.path === 'app/api/orders/orders-handler.ts'
    ));

    expect(route).toMatchObject({
      handler: 'GET',
      path: 'app/api/orders/route.ts',
    });
    expect(handler).toBeDefined();
    expect(inventory.exports).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'app/api/orders/route.ts',
        name: 'listOrders',
        exportedAs: 'GET',
        specifier: './orders-handler',
      }),
    ]));
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
        label: 'route handler GET',
        sourceRefs: expect.arrayContaining([
          'file:app/api/orders/route.ts#L1',
          'file:app/api/orders/route.ts#L2',
          'file:app/api/orders/orders-handler.ts#L1',
        ]),
      }),
    ]));
  });

  test('links local alias-exported Next App Router handlers to source symbols', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-next-local-alias-export-handler-'));
    await mkdir(join(root, 'app/api/orders'), { recursive: true });

    await writeFile(
      join(root, 'app/api/orders/route.ts'),
      [
        'async function listOrders() { return Response.json([]); }',
        'export { listOrders as GET };',
        '',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_next_local_alias_export_handler',
      workflowRunId: 'run_next_local_alias_export_handler',
      repoRoot: root,
      generatedAt: '2026-07-02T10:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 12,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/orders'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'listOrders'
      && symbol.path === 'app/api/orders/route.ts'
    ));

    expect(route).toMatchObject({
      handler: 'GET',
      path: 'app/api/orders/route.ts',
      sourceRefs: expect.arrayContaining([
        'file:app/api/orders/route.ts#L1',
        'file:app/api/orders/route.ts#L2',
      ]),
    });
    expect(handler).toBeDefined();
    expect(inventory.exports).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'app/api/orders/route.ts',
        name: 'listOrders',
        exportedAs: 'GET',
        symbolRef: handler?.id,
      }),
    ]));
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
        label: 'route handler GET',
        sourceRefs: expect.arrayContaining([
          'file:app/api/orders/route.ts#L1',
          'file:app/api/orders/route.ts#L2',
        ]),
      }),
    ]));
  });

  test('links locally exported const Next App Router handler aliases to imported source symbols', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-next-local-exported-const-alias-handler-'));
    await mkdir(join(root, 'app/api/orders'), { recursive: true });

    await writeFile(
      join(root, 'app/api/orders/route.ts'),
      [
        'import { listOrders } from "./orders-handler";',
        'const GET = listOrders;',
        'export { GET };',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/api/orders/orders-handler.ts'),
      'export async function listOrders() { return Response.json([]); }\n',
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_next_local_exported_const_alias_handler',
      workflowRunId: 'run_next_local_exported_const_alias_handler',
      repoRoot: root,
      generatedAt: '2026-07-02T10:30:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 12,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/orders'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'listOrders'
      && symbol.path === 'app/api/orders/orders-handler.ts'
    ));
    const routeConst = inventory.symbols.find((symbol) => (
      symbol.kind === 'const'
      && symbol.name === 'GET'
      && symbol.path === 'app/api/orders/route.ts'
    ));

    expect(route).toMatchObject({
      handler: 'GET',
      path: 'app/api/orders/route.ts',
    });
    expect(handler).toBeDefined();
    expect(routeConst).toBeDefined();
    expect(inventory.exports).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'app/api/orders/route.ts',
        name: 'listOrders',
        exportedAs: 'GET',
        specifier: './orders-handler',
      }),
    ]));
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
        label: 'route handler GET',
        sourceRefs: expect.arrayContaining([
          'file:app/api/orders/route.ts#L1',
          'file:app/api/orders/route.ts#L2',
          'file:app/api/orders/orders-handler.ts#L1',
        ]),
      }),
    ]));
    expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${routeConst?.id}`,
      }),
    ]));
  });

  test('links renamed local const Next App Router handler exports to imported source symbols', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-next-renamed-local-const-export-handler-'));
    await mkdir(join(root, 'app/api/orders'), { recursive: true });

    await writeFile(
      join(root, 'app/api/orders/route.ts'),
      [
        'import { listOrders } from "./orders-handler";',
        'const handler = listOrders;',
        'export { handler as GET };',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/api/orders/orders-handler.ts'),
      'export async function listOrders() { return Response.json([]); }\n',
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_next_renamed_local_const_export_handler',
      workflowRunId: 'run_next_renamed_local_const_export_handler',
      repoRoot: root,
      generatedAt: '2026-07-02T11:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 12,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/orders'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'listOrders'
      && symbol.path === 'app/api/orders/orders-handler.ts'
    ));
    const routeConst = inventory.symbols.find((symbol) => (
      symbol.kind === 'const'
      && symbol.name === 'handler'
      && symbol.path === 'app/api/orders/route.ts'
    ));

    expect(route).toMatchObject({
      handler: 'GET',
      path: 'app/api/orders/route.ts',
    });
    expect(handler).toBeDefined();
    expect(routeConst).toBeDefined();
    expect(inventory.exports).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'app/api/orders/route.ts',
        name: 'listOrders',
        exportedAs: 'GET',
        specifier: './orders-handler',
      }),
    ]));
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
        label: 'route handler GET',
        sourceRefs: expect.arrayContaining([
          'file:app/api/orders/route.ts#L1',
          'file:app/api/orders/route.ts#L2',
          'file:app/api/orders/orders-handler.ts#L1',
        ]),
      }),
    ]));
    expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${routeConst?.id}`,
      }),
    ]));
  });

  test('links exported const Next App Router handler aliases through local const aliases', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-next-export-const-local-alias-chain-handler-'));
    await mkdir(join(root, 'app/api/orders'), { recursive: true });

    await writeFile(
      join(root, 'app/api/orders/route.ts'),
      [
        'import { listOrders } from "./orders-handler";',
        'const handler = listOrders;',
        'export const GET = handler;',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/api/orders/orders-handler.ts'),
      'export async function listOrders() { return Response.json([]); }\n',
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_next_export_const_local_alias_chain_handler',
      workflowRunId: 'run_next_export_const_local_alias_chain_handler',
      repoRoot: root,
      generatedAt: '2026-07-02T11:30:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 12,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/orders'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'listOrders'
      && symbol.path === 'app/api/orders/orders-handler.ts'
    ));
    const routeConst = inventory.symbols.find((symbol) => (
      symbol.kind === 'const'
      && symbol.name === 'GET'
      && symbol.path === 'app/api/orders/route.ts'
    ));

    expect(route).toMatchObject({
      handler: 'GET',
      path: 'app/api/orders/route.ts',
    });
    expect(handler).toBeDefined();
    expect(routeConst).toBeDefined();
    expect(inventory.exports).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'app/api/orders/route.ts',
        name: 'listOrders',
        exportedAs: 'GET',
        specifier: './orders-handler',
      }),
    ]));
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
        label: 'route handler GET',
        sourceRefs: expect.arrayContaining([
          'file:app/api/orders/route.ts#L1',
          'file:app/api/orders/route.ts#L2',
          'file:app/api/orders/route.ts#L3',
          'file:app/api/orders/orders-handler.ts#L1',
        ]),
      }),
    ]));
    expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${routeConst?.id}`,
      }),
    ]));
  });

  test('links no-alias re-exported Next App Router handlers to source symbols', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-next-no-alias-reexport-handler-'));
    await mkdir(join(root, 'app/api/orders'), { recursive: true });

    await writeFile(
      join(root, 'app/api/orders/route.ts'),
      'export { GET, POST } from "./orders-handler";\n',
      'utf8',
    );
    await writeFile(
      join(root, 'app/api/orders/orders-handler.ts'),
      [
        'export async function GET() { return Response.json([]); }',
        'export async function POST() { return Response.json({ ok: true }); }',
        '',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_next_no_alias_reexport_handler',
      workflowRunId: 'run_next_no_alias_reexport_handler',
      repoRoot: root,
      generatedAt: '2026-07-01T19:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 12,
      },
    });

    const getRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/orders'
    ));
    const postRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/orders'
    ));
    const getHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'GET'
      && symbol.path === 'app/api/orders/orders-handler.ts'
    ));
    const postHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'POST'
      && symbol.path === 'app/api/orders/orders-handler.ts'
    ));

    expect(getRoute).toMatchObject({ handler: 'GET', path: 'app/api/orders/route.ts' });
    expect(postRoute).toMatchObject({ handler: 'POST', path: 'app/api/orders/route.ts' });
    expect(getHandler).toBeDefined();
    expect(postHandler).toBeDefined();
    expect(inventory.exports).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'app/api/orders/route.ts',
        name: 'GET',
        exportedAs: 'GET',
        specifier: './orders-handler',
      }),
      expect.objectContaining({
        path: 'app/api/orders/route.ts',
        name: 'POST',
        exportedAs: 'POST',
        specifier: './orders-handler',
      }),
    ]));
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${getRoute?.id}`,
        to: `node_symbol_${getHandler?.id}`,
        label: 'route handler GET',
        sourceRefs: expect.arrayContaining([
          'file:app/api/orders/route.ts#L1',
          'file:app/api/orders/orders-handler.ts#L1',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${postRoute?.id}`,
        to: `node_symbol_${postHandler?.id}`,
        label: 'route handler POST',
        sourceRefs: expect.arrayContaining([
          'file:app/api/orders/route.ts#L1',
          'file:app/api/orders/orders-handler.ts#L2',
        ]),
      }),
    ]));
  });

  test('links multiline no-alias re-exported Next App Router handlers to source symbols', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-next-multiline-reexport-handler-'));
    await mkdir(join(root, 'app/api/orders'), { recursive: true });

    await writeFile(
      join(root, 'app/api/orders/route.ts'),
      [
        'export {',
        '  GET,',
        '  POST,',
        '} from "./orders-handler";',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/api/orders/orders-handler.ts'),
      [
        'export async function GET() { return Response.json([]); }',
        'export async function POST() { return Response.json({ ok: true }); }',
        '',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_next_multiline_reexport_handler',
      workflowRunId: 'run_next_multiline_reexport_handler',
      repoRoot: root,
      generatedAt: '2026-07-01T19:15:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 12,
      },
    });

    const getRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/orders'
    ));
    const postRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/orders'
    ));
    const getHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'GET'
      && symbol.path === 'app/api/orders/orders-handler.ts'
    ));
    const postHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'POST'
      && symbol.path === 'app/api/orders/orders-handler.ts'
    ));

    expect(getRoute).toMatchObject({
      handler: 'GET',
      path: 'app/api/orders/route.ts',
      sourceRefs: ['file:app/api/orders/route.ts#L1'],
    });
    expect(postRoute).toMatchObject({
      handler: 'POST',
      path: 'app/api/orders/route.ts',
      sourceRefs: ['file:app/api/orders/route.ts#L1'],
    });
    expect(getHandler).toBeDefined();
    expect(postHandler).toBeDefined();
    expect(inventory.exports).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'app/api/orders/route.ts',
        name: 'GET',
        exportedAs: 'GET',
        specifier: './orders-handler',
        sourceRefs: ['file:app/api/orders/route.ts#L1'],
      }),
      expect.objectContaining({
        path: 'app/api/orders/route.ts',
        name: 'POST',
        exportedAs: 'POST',
        specifier: './orders-handler',
        sourceRefs: ['file:app/api/orders/route.ts#L1'],
      }),
    ]));
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${getRoute?.id}`,
        to: `node_symbol_${getHandler?.id}`,
        label: 'route handler GET',
        sourceRefs: expect.arrayContaining([
          'file:app/api/orders/route.ts#L1',
          'file:app/api/orders/orders-handler.ts#L1',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${postRoute?.id}`,
        to: `node_symbol_${postHandler?.id}`,
        label: 'route handler POST',
        sourceRefs: expect.arrayContaining([
          'file:app/api/orders/route.ts#L1',
          'file:app/api/orders/orders-handler.ts#L2',
        ]),
      }),
    ]));
  });

  test('detects Next Pages API routes and links default handlers to service symbols', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-next-pages-api-route-'));
    await mkdir(join(root, 'pages/api/orders'), { recursive: true });
    await mkdir(join(root, 'pages/api/services'), { recursive: true });

    await writeFile(
      join(root, 'pages/api/orders/[id].ts'),
      [
        'import { loadOrder } from "../services/orders-service";',
        'export default function handler(req, res) {',
        '  return loadOrder(req.query.id);',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'pages/api/services/orders-service.ts'),
      'export function loadOrder(orderId) { return { orderId }; }\n',
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_next_pages_api_route',
      workflowRunId: 'run_next_pages_api_route',
      repoRoot: root,
      generatedAt: '2026-07-02T12:30:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 12,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'ANY'
      && entrypoint.route === '/api/orders/[id]'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'handler'
      && symbol.path === 'pages/api/orders/[id].ts'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'loadOrder'
      && symbol.path === 'pages/api/services/orders-service.ts'
    ));

    expect(route).toMatchObject({
      handler: 'default',
      path: 'pages/api/orders/[id].ts',
      sourceRefs: expect.arrayContaining(['file:pages/api/orders/[id].ts#L2']),
    });
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
        label: 'route handler default',
        sourceRefs: expect.arrayContaining([
          'file:pages/api/orders/[id].ts#L2',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'calls loadOrder',
        sourceRefs: expect.arrayContaining([
          'file:pages/api/orders/[id].ts#L1',
          'file:pages/api/orders/[id].ts#L3',
          'file:pages/api/services/orders-service.ts#L1',
        ]),
      }),
    ]));
  });

  test('detects Next Pages API routes with default handler aliases', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-next-pages-api-default-alias-'));
    await mkdir(join(root, 'pages/api/orders'), { recursive: true });
    await mkdir(join(root, 'pages/api/services'), { recursive: true });

    await writeFile(
      join(root, 'pages/api/orders/[id].ts'),
      [
        'import { loadOrder } from "../services/orders-service";',
        'function handler(req, res) {',
        '  return loadOrder(req.query.id);',
        '}',
        'export default handler;',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'pages/api/services/orders-service.ts'),
      'export function loadOrder(orderId) { return { orderId }; }\n',
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_next_pages_api_default_alias',
      workflowRunId: 'run_next_pages_api_default_alias',
      repoRoot: root,
      generatedAt: '2026-07-03T00:55:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 12,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'ANY'
      && entrypoint.route === '/api/orders/[id]'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'handler'
      && symbol.path === 'pages/api/orders/[id].ts'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'loadOrder'
      && symbol.path === 'pages/api/services/orders-service.ts'
    ));

    expect(route).toMatchObject({
      handler: 'default',
      path: 'pages/api/orders/[id].ts',
      sourceRefs: expect.arrayContaining(['file:pages/api/orders/[id].ts#L5']),
    });
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
        label: 'route handler default',
        sourceRefs: expect.arrayContaining([
          'file:pages/api/orders/[id].ts#L2',
          'file:pages/api/orders/[id].ts#L5',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'calls loadOrder',
        sourceRefs: expect.arrayContaining([
          'file:pages/api/orders/[id].ts#L1',
          'file:pages/api/orders/[id].ts#L3',
          'file:pages/api/services/orders-service.ts#L1',
        ]),
      }),
    ]));
  });

  test('detects Next Pages API routes with imported default handlers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-next-pages-api-imported-default-'));
    await mkdir(join(root, 'pages/api/invoices'), { recursive: true });
    await mkdir(join(root, 'src/api-handlers'), { recursive: true });
    await mkdir(join(root, 'src/services'), { recursive: true });

    await writeFile(
      join(root, 'pages/api/invoices/[id].ts'),
      [
        'import handler from "../../../src/api-handlers/invoice-handler";',
        'export default handler;',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/api-handlers/invoice-handler.ts'),
      [
        'import { loadInvoice } from "../services/invoice-service";',
        'export default function invoiceHandler(req, res) {',
        '  return loadInvoice(req.query.id);',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/services/invoice-service.ts'),
      'export function loadInvoice(invoiceId) { return { invoiceId }; }\n',
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_next_pages_api_imported_default',
      workflowRunId: 'run_next_pages_api_imported_default',
      repoRoot: root,
      generatedAt: '2026-07-03T01:45:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 12,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'ANY'
      && entrypoint.route === '/api/invoices/[id]'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'invoiceHandler'
      && symbol.path === 'src/api-handlers/invoice-handler.ts'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'loadInvoice'
      && symbol.path === 'src/services/invoice-service.ts'
    ));

    expect(route).toMatchObject({
      handler: 'default',
      path: 'pages/api/invoices/[id].ts',
      sourceRefs: expect.arrayContaining(['file:pages/api/invoices/[id].ts#L2']),
    });
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
        label: 'route handler default',
        sourceRefs: expect.arrayContaining([
          'file:pages/api/invoices/[id].ts#L1',
          'file:pages/api/invoices/[id].ts#L2',
          'file:src/api-handlers/invoice-handler.ts#L2',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'calls loadInvoice',
        sourceRefs: expect.arrayContaining([
          'file:src/api-handlers/invoice-handler.ts#L1',
          'file:src/api-handlers/invoice-handler.ts#L3',
          'file:src/services/invoice-service.ts#L1',
        ]),
      }),
    ]));
  });

  test('detects Next Pages API routes with CommonJS default handlers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-next-pages-api-commonjs-default-'));
    await mkdir(join(root, 'pages/api/usage'), { recursive: true });
    await mkdir(join(root, 'src/api-handlers'), { recursive: true });
    await mkdir(join(root, 'src/services'), { recursive: true });

    await writeFile(
      join(root, 'pages/api/usage/[id].js'),
      [
        'const handler = require("../../../src/api-handlers/usage-handler");',
        'module.exports = handler;',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/api-handlers/usage-handler.js'),
      [
        'const { loadUsage } = require("../services/usage-service");',
        'module.exports = function usageHandler(req, res) {',
        '  return loadUsage(req.query.id);',
        '};',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/services/usage-service.js'),
      'exports.loadUsage = function loadUsage(usageId) { return { usageId }; };\n',
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_next_pages_api_commonjs_default',
      workflowRunId: 'run_next_pages_api_commonjs_default',
      repoRoot: root,
      generatedAt: '2026-07-03T02:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 12,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'ANY'
      && entrypoint.route === '/api/usage/[id]'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'usageHandler'
      && symbol.path === 'src/api-handlers/usage-handler.js'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'loadUsage'
      && symbol.path === 'src/services/usage-service.js'
    ));

    expect(route).toMatchObject({
      handler: 'default',
      path: 'pages/api/usage/[id].js',
      sourceRefs: expect.arrayContaining(['file:pages/api/usage/[id].js#L2']),
    });
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
        label: 'route handler default',
        sourceRefs: expect.arrayContaining([
          'file:pages/api/usage/[id].js#L1',
          'file:pages/api/usage/[id].js#L2',
          'file:src/api-handlers/usage-handler.js#L2',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'calls loadUsage',
        sourceRefs: expect.arrayContaining([
          'file:src/api-handlers/usage-handler.js#L1',
          'file:src/api-handlers/usage-handler.js#L3',
          'file:src/services/usage-service.js#L1',
        ]),
      }),
    ]));
  });

  test('detects Next Pages API routes with re-exported default handlers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-next-pages-api-default-reexport-'));
    await mkdir(join(root, 'pages/api/subscriptions'), { recursive: true });
    await mkdir(join(root, 'pages/api/handlers'), { recursive: true });
    await mkdir(join(root, 'pages/api/services'), { recursive: true });

    await writeFile(
      join(root, 'pages/api/subscriptions/[id].ts'),
      'export { showSubscription as default } from "../handlers/subscription-handler";\n',
      'utf8',
    );
    await writeFile(
      join(root, 'pages/api/handlers/subscription-handler.ts'),
      [
        'import { loadSubscription } from "../services/subscription-service";',
        'export function showSubscription(req, res) {',
        '  return loadSubscription(req.query.id);',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'pages/api/services/subscription-service.ts'),
      'export function loadSubscription(subscriptionId) { return { subscriptionId }; }\n',
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_next_pages_api_default_reexport',
      workflowRunId: 'run_next_pages_api_default_reexport',
      repoRoot: root,
      generatedAt: '2026-07-03T01:20:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 12,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'ANY'
      && entrypoint.route === '/api/subscriptions/[id]'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'showSubscription'
      && symbol.path === 'pages/api/handlers/subscription-handler.ts'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'loadSubscription'
      && symbol.path === 'pages/api/services/subscription-service.ts'
    ));

    expect(route).toMatchObject({
      handler: 'default',
      path: 'pages/api/subscriptions/[id].ts',
      sourceRefs: expect.arrayContaining(['file:pages/api/subscriptions/[id].ts#L1']),
    });
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
        label: 'route handler default',
        sourceRefs: expect.arrayContaining([
          'file:pages/api/subscriptions/[id].ts#L1',
          'file:pages/api/handlers/subscription-handler.ts#L2',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'calls loadSubscription',
        sourceRefs: expect.arrayContaining([
          'file:pages/api/handlers/subscription-handler.ts#L1',
          'file:pages/api/handlers/subscription-handler.ts#L3',
          'file:pages/api/services/subscription-service.ts#L1',
        ]),
      }),
    ]));
  });

  test('detects static Next Pages API req.method branches', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-next-pages-api-method-branches-'));
    await mkdir(join(root, 'pages/api/orders'), { recursive: true });
    await mkdir(join(root, 'pages/api/services'), { recursive: true });

    await writeFile(
      join(root, 'pages/api/orders/[id].ts'),
      [
        'import { loadOrder, updateOrder } from "../services/orders-service";',
        'export default function handler(req, res) {',
        '  switch (req.method) {',
        '    case "GET":',
        '      return loadOrder(req.query.id);',
        '    case "PATCH":',
        '      return updateOrder(req.query.id);',
        '    default:',
        '      return res.status(405).end();',
        '  }',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'pages/api/services/orders-service.ts'),
      [
        'export function loadOrder(orderId) { return { orderId }; }',
        'export function updateOrder(orderId) { return { orderId }; }',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_next_pages_api_method_branches',
      workflowRunId: 'run_next_pages_api_method_branches',
      repoRoot: root,
      generatedAt: '2026-07-03T01:35:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 12,
      },
    });

    const route = (method: string) => inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === method
      && entrypoint.route === '/api/orders/[id]'
    ));
    const anyRoute = route('ANY');
    const getRoute = route('GET');
    const patchRoute = route('PATCH');
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'handler'
      && symbol.path === 'pages/api/orders/[id].ts'
    ));
    const loadService = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'loadOrder'
      && symbol.path === 'pages/api/services/orders-service.ts'
    ));
    const updateService = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'updateOrder'
      && symbol.path === 'pages/api/services/orders-service.ts'
    ));

    expect(anyRoute).toBeUndefined();
    expect(getRoute).toMatchObject({
      label: 'GET /api/orders/[id]',
      handler: 'default',
      path: 'pages/api/orders/[id].ts',
      sourceRefs: expect.arrayContaining([
        'file:pages/api/orders/[id].ts#L2',
        'file:pages/api/orders/[id].ts#L4',
      ]),
    });
    expect(patchRoute).toMatchObject({
      label: 'PATCH /api/orders/[id]',
      handler: 'default',
      path: 'pages/api/orders/[id].ts',
      sourceRefs: expect.arrayContaining([
        'file:pages/api/orders/[id].ts#L2',
        'file:pages/api/orders/[id].ts#L6',
      ]),
    });
    expect(handler).toBeDefined();
    expect(loadService).toBeDefined();
    expect(updateService).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${getRoute?.id}`,
        to: `node_symbol_${handler?.id}`,
        label: 'route handler default',
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${patchRoute?.id}`,
        to: `node_symbol_${handler?.id}`,
        label: 'route handler default',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${loadService?.id}`,
        label: 'calls loadOrder',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${updateService?.id}`,
        label: 'calls updateOrder',
      }),
    ]));
  });

  test('applies same-file static mount prefixes for Express router variables', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-mounted-router-'));
    await mkdir(join(root, 'apps/api/src'), { recursive: true });

    await writeFile(
      join(root, 'apps/api/src/routes.ts'),
      [
        'import express, { Router } from "express";',
        'import * as OrdersController from "./orders-controller";',
        'import { createUser } from "./admin-controller";',
        'export const app = express();',
        'export const router = Router();',
        'const ordersRouter = Router();',
        'const adminRouter = express.Router();',
        'export function requireAdmin() { return false; }',
        'export function validateUser() { return false; }',
        'ordersRouter.get("/orders", OrdersController.index);',
        'adminRouter.post("/users", requireAdmin, validateUser, createUser);',
        'app.use("/api", ordersRouter);',
        'router.use("/api/admin", requireAdmin, adminRouter);',
        'const dynamicPrefix = "/api/dynamic";',
        'const dynamicRouter = Router();',
        'dynamicRouter.get("/items", createUser);',
        'app.use(dynamicPrefix, dynamicRouter);',
        'const catalogRouter = Router();',
        'catalogRouter.route("/catalog").get(OrdersController.index);',
        'app.use("/api/store", catalogRouter);',
        'const sdk = { route() { return { get() {} }; } };',
        'sdk.route("/sdk/orders").get(OrdersController.index);',
        'const fakeMount = { use() {} };',
        'fakeMount.use("/fake", ordersRouter);',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/orders-controller.ts'),
      [
        'export function index() { return []; }',
        'export function show() { return {}; }',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/admin-controller.ts'),
      'export function createUser() { return true; }\n',
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_mounted_router',
      workflowRunId: 'run_mounted_router',
      repoRoot: root,
      generatedAt: '2026-07-01T06:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 20,
      },
    });

    const ordersRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/orders'
    ));
    const adminRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/admin/users'
    ));
    const catalogRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/store/catalog'
    ));
    const ordersHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'index'
      && symbol.path === 'apps/api/src/orders-controller.ts'
    ));
    const adminHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'createUser'
      && symbol.path === 'apps/api/src/admin-controller.ts'
    ));
    const requireAdmin = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'requireAdmin'
      && symbol.path === 'apps/api/src/routes.ts'
    ));
    const validateUser = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'validateUser'
      && symbol.path === 'apps/api/src/routes.ts'
    ));

    expect(ordersRoute).toMatchObject({
      handler: 'OrdersController.index',
      sourceRefs: expect.arrayContaining([
        'file:apps/api/src/routes.ts#L10',
        'file:apps/api/src/routes.ts#L12',
      ]),
    });
    expect(adminRoute).toMatchObject({
      handler: 'createUser',
      sourceRefs: expect.arrayContaining([
        'file:apps/api/src/routes.ts#L11',
        'file:apps/api/src/routes.ts#L13',
      ]),
    });
    expect(inventory.entrypoints).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'http_route',
        route: '/api/dynamic/items',
      }),
      expect.objectContaining({
        kind: 'http_route',
        route: '/sdk/orders',
      }),
      expect.objectContaining({
        kind: 'http_route',
        route: '/fake/orders',
      }),
    ]));
    expect(catalogRoute).toMatchObject({
      handler: 'OrdersController.index',
      sourceRefs: expect.arrayContaining([
        'file:apps/api/src/routes.ts#L19',
        'file:apps/api/src/routes.ts#L20',
      ]),
    });
    expect(ordersHandler).toBeDefined();
    expect(adminHandler).toBeDefined();
    expect(requireAdmin).toBeDefined();
    expect(validateUser).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${ordersRoute?.id}`,
        to: `node_symbol_${ordersHandler?.id}`,
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/routes.ts#L2',
          'file:apps/api/src/routes.ts#L10',
          'file:apps/api/src/routes.ts#L12',
          'file:apps/api/src/orders-controller.ts#L1',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${adminRoute?.id}`,
        to: `node_symbol_${adminHandler?.id}`,
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/routes.ts#L3',
          'file:apps/api/src/routes.ts#L11',
          'file:apps/api/src/routes.ts#L13',
          'file:apps/api/src/admin-controller.ts#L1',
        ]),
      }),
    ]));
    expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${adminRoute?.id}`,
        to: `node_symbol_${requireAdmin?.id}`,
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${adminRoute?.id}`,
        to: `node_symbol_${validateUser?.id}`,
      }),
    ]));
  });

  test('combines same-file Fastify register prefixes with plugin routes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-fastify-register-prefix-'));
    await mkdir(join(root, 'apps/api/src'), { recursive: true });

    await writeFile(
      join(root, 'apps/api/src/server.ts'),
      [
        'import createFastify from "fastify";',
        'import { createBilling, showBilling } from "./billing-controller";',
        'const app = createFastify();',
        'async function billingRoutes(fastify) {',
        '  fastify.get("/statements/:id", showBilling);',
        '  fastify.route({',
        '    method: "POST",',
        '    url: "/statements",',
        '    handler: createBilling,',
        '  });',
        '}',
        'app.register(billingRoutes, { prefix: "/api/billing" });',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/billing-controller.ts'),
      [
        'export function showBilling() { return true; }',
        'export function createBilling() { return true; }',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_fastify_register_prefix',
      workflowRunId: 'run_fastify_register_prefix',
      repoRoot: root,
      generatedAt: '2026-07-01T06:30:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 20,
      },
    });

    const showRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/billing/statements/:id'
    ));
    const createRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/billing/statements'
    ));
    const showHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'showBilling'
      && symbol.path === 'apps/api/src/billing-controller.ts'
    ));
    const createHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'createBilling'
      && symbol.path === 'apps/api/src/billing-controller.ts'
    ));

    expect(showRoute).toMatchObject({
      handler: 'showBilling',
      sourceRefs: expect.arrayContaining([
        'file:apps/api/src/server.ts#L4',
        'file:apps/api/src/server.ts#L5',
        'file:apps/api/src/server.ts#L12',
      ]),
    });
    expect(createRoute).toMatchObject({
      handler: 'createBilling',
      sourceRefs: expect.arrayContaining([
        'file:apps/api/src/server.ts#L4',
        'file:apps/api/src/server.ts#L6',
        'file:apps/api/src/server.ts#L12',
      ]),
    });
    expect(inventory.entrypoints).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'http_route', route: '/statements/:id' }),
      expect.objectContaining({ kind: 'http_route', route: '/statements' }),
    ]));
    expect(showHandler).toBeDefined();
    expect(createHandler).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${showRoute?.id}`,
        to: `node_symbol_${showHandler?.id}`,
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/server.ts#L2',
          'file:apps/api/src/server.ts#L5',
          'file:apps/api/src/server.ts#L12',
          'file:apps/api/src/billing-controller.ts#L1',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${createRoute?.id}`,
        to: `node_symbol_${createHandler?.id}`,
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/server.ts#L2',
          'file:apps/api/src/server.ts#L6',
          'file:apps/api/src/server.ts#L12',
          'file:apps/api/src/billing-controller.ts#L2',
        ]),
      }),
    ]));
  });

  test('combines cross-file imported Fastify register prefixes with plugin routes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-fastify-cross-file-register-prefix-'));
    await mkdir(join(root, 'apps/api/src'), { recursive: true });

    await writeFile(
      join(root, 'apps/api/src/server.ts'),
      [
        'import createFastify from "fastify";',
        'import billingRoutes from "./billing-routes";',
        'import { customerRoutes } from "./customer-routes";',
        'const app = createFastify();',
        'app.register(billingRoutes, { prefix: "/api/billing" });',
        'app.register(customerRoutes, { prefix: "/api/customers" });',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/billing-routes.ts'),
      [
        'import { showBilling } from "./billing-controller";',
        'export default async function billingRoutes(fastify) {',
        '  fastify.get("/statements/:id", showBilling);',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/customer-routes.ts'),
      [
        'import { showCustomer } from "./customer-controller";',
        'export function customerRoutes(fastify) {',
        '  fastify.get("/:customerId", showCustomer);',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/billing-controller.ts'),
      'export function showBilling() { return true; }\n',
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/customer-controller.ts'),
      'export function showCustomer() { return true; }\n',
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_fastify_cross_file_register_prefix',
      workflowRunId: 'run_fastify_cross_file_register_prefix',
      repoRoot: root,
      generatedAt: '2026-07-01T06:45:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 20,
      },
    });

    const billingRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/billing/statements/:id'
    ));
    const customerRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/customers/:customerId'
    ));
    const billingHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'showBilling'
      && symbol.path === 'apps/api/src/billing-controller.ts'
    ));
    const customerHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'showCustomer'
      && symbol.path === 'apps/api/src/customer-controller.ts'
    ));

    expect(billingRoute).toMatchObject({
      path: 'apps/api/src/billing-routes.ts',
      handler: 'showBilling',
      sourceRefs: expect.arrayContaining([
        'file:apps/api/src/server.ts#L2',
        'file:apps/api/src/server.ts#L5',
        'file:apps/api/src/billing-routes.ts#L2',
        'file:apps/api/src/billing-routes.ts#L3',
      ]),
    });
    expect(customerRoute).toMatchObject({
      path: 'apps/api/src/customer-routes.ts',
      handler: 'showCustomer',
      sourceRefs: expect.arrayContaining([
        'file:apps/api/src/server.ts#L3',
        'file:apps/api/src/server.ts#L6',
        'file:apps/api/src/customer-routes.ts#L2',
        'file:apps/api/src/customer-routes.ts#L3',
      ]),
    });
    expect(inventory.entrypoints).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'http_route', route: '/statements/:id' }),
      expect.objectContaining({ kind: 'http_route', route: '/:customerId' }),
    ]));
    expect(billingHandler).toBeDefined();
    expect(customerHandler).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${billingRoute?.id}`,
        to: `node_symbol_${billingHandler?.id}`,
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/server.ts#L2',
          'file:apps/api/src/server.ts#L5',
          'file:apps/api/src/billing-routes.ts#L1',
          'file:apps/api/src/billing-routes.ts#L3',
          'file:apps/api/src/billing-controller.ts#L1',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${customerRoute?.id}`,
        to: `node_symbol_${customerHandler?.id}`,
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/server.ts#L3',
          'file:apps/api/src/server.ts#L6',
          'file:apps/api/src/customer-routes.ts#L1',
          'file:apps/api/src/customer-routes.ts#L3',
          'file:apps/api/src/customer-controller.ts#L1',
        ]),
      }),
    ]));
  });

  test('does not accept arbitrary object route chains as Express router routes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-non-express-route-chain-'));
    await mkdir(join(root, 'apps/api/src'), { recursive: true });

    await writeFile(
      join(root, 'apps/api/src/routes.ts'),
      [
        'import { Router } from "express";',
        'export function fakeHandler() { return true; }',
        'const router = { route() { return { get() {}, post() {} }; } };',
        'router.route("/not-express").get(fakeHandler);',
        'const app = { route() { return { get() {} }; } };',
        'app.route("/also-not-express").get(fakeHandler);',
        'const realRouter = Router();',
        'realRouter.route("/express").get(fakeHandler);',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_non_express_route_chain',
      workflowRunId: 'run_non_express_route_chain',
      repoRoot: root,
      generatedAt: '2026-07-01T06:15:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 20,
      },
    });

    expect(inventory.entrypoints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'http_route',
        method: 'GET',
        route: '/express',
      }),
    ]));
    expect(inventory.entrypoints).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'http_route', route: '/not-express' }),
      expect.objectContaining({ kind: 'http_route', route: '/also-not-express' }),
    ]));
  });

  test('detects Hono routes from static Hono constructor and route mounts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-hono-routes-'));
    await mkdir(join(root, 'apps/api/src'), { recursive: true });

    await writeFile(
      join(root, 'apps/api/src/routes.ts'),
      [
        'import { Hono } from "hono";',
        'import { showBilling, createBilling } from "./billing-controller";',
        'const app = new Hono().basePath("/api");',
        'app.get("/health", showHealth);',
        'const billing = new Hono().basePath("/billing");',
        'billing.get("/statements/:id", showBilling);',
        'billing.post("/statements", createBilling);',
        'app.route("/v1", billing);',
        'function showHealth() { return true; }',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/billing-controller.ts'),
      [
        'export function showBilling() { return true; }',
        'export function createBilling() { return true; }',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/lookalike.ts'),
      [
        'const Hono = makeLocalHono();',
        'const app = new Hono().basePath("/fake");',
        'app.get("/ghost", ghostBilling);',
        'function ghostBilling() { return true; }',
        'function makeLocalHono() { return function LocalHono() { return { basePath() { return this; }, get() {} }; }; }',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_hono_routes',
      workflowRunId: 'run_hono_routes',
      repoRoot: root,
      generatedAt: '2026-07-02T01:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 20,
      },
    });

    const findRoute = (method: string, routePath: string) => inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === method
      && entrypoint.route === routePath
    ));
    const healthRoute = findRoute('GET', '/api/health');
    const showRoute = findRoute('GET', '/api/v1/billing/statements/:id');
    const createRoute = findRoute('POST', '/api/v1/billing/statements');
    const showHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'showBilling'
      && symbol.path === 'apps/api/src/billing-controller.ts'
    ));

    expect(healthRoute).toMatchObject({
      handler: 'showHealth',
      sourceRefs: expect.arrayContaining([
        'file:apps/api/src/routes.ts#L1',
        'file:apps/api/src/routes.ts#L3',
        'file:apps/api/src/routes.ts#L4',
      ]),
    });
    expect(showRoute).toMatchObject({
      handler: 'showBilling',
      sourceRefs: expect.arrayContaining([
        'file:apps/api/src/routes.ts#L1',
        'file:apps/api/src/routes.ts#L5',
        'file:apps/api/src/routes.ts#L6',
        'file:apps/api/src/routes.ts#L8',
      ]),
    });
    expect(createRoute).toMatchObject({ handler: 'createBilling' });
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${showRoute?.id}`,
        to: `node_symbol_${showHandler?.id}`,
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/routes.ts#L1',
          'file:apps/api/src/routes.ts#L2',
          'file:apps/api/src/routes.ts#L5',
          'file:apps/api/src/routes.ts#L6',
          'file:apps/api/src/routes.ts#L8',
          'file:apps/api/src/billing-controller.ts#L1',
        ]),
      }),
    ]));
    expect(inventory.entrypoints).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'http_route', route: '/fake/ghost' }),
      expect.objectContaining({ kind: 'http_route', route: '/ghost' }),
    ]));
  });

  test('detects Koa Router routes with import evidence and static prefixes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-koa-router-'));
    await mkdir(join(root, 'apps/api/src'), { recursive: true });

    await writeFile(
      join(root, 'apps/api/src/routes.ts'),
      [
        'import Router from "@koa/router";',
        'import { showBilling } from "./billing-controller";',
        'const router = new Router({ prefix: "/api" });',
        'router.get("/billing/:id", showBilling);',
        'const KoaRouter = require("koa-router");',
        'function retryBilling() { return true; }',
        'const adminRouter = new KoaRouter({ prefix: "/internal" });',
        'adminRouter.post("/billing/retry", retryBilling);',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/billing-controller.ts'),
      'export function showBilling() { return true; }\n',
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_koa_router',
      workflowRunId: 'run_koa_router',
      repoRoot: root,
      generatedAt: '2026-07-02T00:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 20,
      },
    });

    const billingRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/billing/:id'
    ));
    const retryRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/internal/billing/retry'
    ));
    const billingHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'showBilling'
      && symbol.path === 'apps/api/src/billing-controller.ts'
    ));
    const retryHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'retryBilling'
      && symbol.path === 'apps/api/src/routes.ts'
    ));

    expect(billingRoute).toMatchObject({
      handler: 'showBilling',
      sourceRefs: expect.arrayContaining([
        'file:apps/api/src/routes.ts#L1',
        'file:apps/api/src/routes.ts#L3',
        'file:apps/api/src/routes.ts#L4',
      ]),
    });
    expect(retryRoute).toMatchObject({
      handler: 'retryBilling',
      sourceRefs: expect.arrayContaining([
        'file:apps/api/src/routes.ts#L5',
        'file:apps/api/src/routes.ts#L7',
        'file:apps/api/src/routes.ts#L8',
      ]),
    });
    expect(billingHandler).toBeDefined();
    expect(retryHandler).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${billingRoute?.id}`,
        to: `node_symbol_${billingHandler?.id}`,
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/routes.ts#L1',
          'file:apps/api/src/routes.ts#L2',
          'file:apps/api/src/routes.ts#L3',
          'file:apps/api/src/routes.ts#L4',
          'file:apps/api/src/billing-controller.ts#L1',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${retryRoute?.id}`,
        to: `node_symbol_${retryHandler?.id}`,
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/routes.ts#L5',
          'file:apps/api/src/routes.ts#L6',
          'file:apps/api/src/routes.ts#L7',
          'file:apps/api/src/routes.ts#L8',
        ]),
      }),
    ]));
  });

  test('does not accept Koa Router lookalikes without koa-router imports', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-koa-lookalike-'));
    await mkdir(join(root, 'apps/api/src'), { recursive: true });

    await writeFile(
      join(root, 'apps/api/src/routes.ts'),
      [
        'const Router = makeLocalRouter();',
        'const router = Router({ prefix: "/api" });',
        'router.get("/billing/:id", fakeHandler);',
        'const app = { get() {} };',
        'app.get("/local-object", fakeHandler);',
        'function fakeHandler() { return true; }',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_koa_lookalike',
      workflowRunId: 'run_koa_lookalike',
      repoRoot: root,
      generatedAt: '2026-07-02T00:05:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 20,
      },
    });

    expect(inventory.entrypoints).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'http_route', route: '/billing/:id' }),
      expect.objectContaining({ kind: 'http_route', route: '/api/billing/:id' }),
      expect.objectContaining({ kind: 'http_route', route: '/local-object' }),
    ]));
  });

  test('keeps valid Express Router factory aliases while blocking local Router lookalikes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-express-router-alias-'));
    await mkdir(join(root, 'apps/api/src'), { recursive: true });

    await writeFile(
      join(root, 'apps/api/src/routes.ts'),
      [
        'import express, { Router as createRouter } from "express";',
        'export function listOrders() { return []; }',
        'const Router = express.Router;',
        'const router = Router();',
        'router.get("/orders", listOrders);',
        'const api = createRouter();',
        'api.post("/admin/users", listOrders);',
        'const makeReportsRouter = express.Router;',
        'const routes = makeReportsRouter();',
        'routes.get("/reports/daily", listOrders);',
        'const LocalRouter = makeLocalRouter();',
        'const localRouter = LocalRouter();',
        'localRouter.get("/fake", listOrders);',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_express_router_alias',
      workflowRunId: 'run_express_router_alias',
      repoRoot: root,
      generatedAt: '2026-07-02T00:10:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 20,
      },
    });

    expect(inventory.entrypoints).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'http_route', method: 'GET', route: '/orders' }),
      expect.objectContaining({ kind: 'http_route', method: 'POST', route: '/admin/users' }),
      expect.objectContaining({ kind: 'http_route', method: 'GET', route: '/reports/daily' }),
    ]));
    expect(inventory.entrypoints).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'http_route', route: '/fake' }),
    ]));
  });

  test('applies cross-file static mount prefixes for imported Express router variables', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-cross-file-mounted-router-'));
    await mkdir(join(root, 'apps/api/src'), { recursive: true });

    await writeFile(
      join(root, 'apps/api/src/app.ts'),
      [
        'import express from "express";',
        'import { ordersRouter } from "./orders-routes";',
        'import adminRouter from "./admin-routes";',
        'import { catalogRouter } from "./catalog-routes";',
        'import { router as dynamicRouter } from "./dynamic-routes";',
        'import unresolvedRouter from "@example/unresolved";',
        'import { notRouter } from "./not-router-routes";',
        'const app = express();',
        'const dynamicPrefix = "/api/dynamic";',
        'export function requirePlatformAdmin() { return false; }',
        'app.use("/api", ordersRouter);',
        'app.use("/api/admin", requirePlatformAdmin, adminRouter);',
        'app.use("/api/store", catalogRouter);',
        'app.use(dynamicPrefix, dynamicRouter);',
        'app.use("/api/missing", unresolvedRouter);',
        'app.use("/api/nope", notRouter);',
        'const fakeMount = { use() {} };',
        'fakeMount.use("/fake", ordersRouter);',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/orders-routes.ts'),
      [
        'import { Router } from "express";',
        'import * as OrdersController from "./orders-controller";',
        'export const ordersRouter = Router();',
        'export function requireOrderAuth() { return false; }',
        'ordersRouter.get("/orders", requireOrderAuth, OrdersController.index);',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/admin-routes.ts'),
      [
        'import express from "express";',
        'import { createUser } from "./admin-controller";',
        'const adminRouter = express.Router();',
        'export function requireAdmin() { return false; }',
        'adminRouter.post("/users", requireAdmin, createUser);',
        'export default adminRouter;',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/catalog-routes.ts'),
      [
        'import { Router } from "express";',
        'import * as CatalogController from "./catalog-controller";',
        'export const catalogRouter = Router();',
        'export function requireStore() { return false; }',
        'catalogRouter.route("/catalog")',
        '  .get(requireStore, CatalogController.index);',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/dynamic-routes.ts'),
      [
        'import { Router } from "express";',
        'import { createUser } from "./admin-controller";',
        'export const router = Router();',
        'router.get("/dynamic-orders", createUser);',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/not-router-routes.ts'),
      [
        'import { Router } from "express";',
        'import { createUser } from "./admin-controller";',
        'export const notRouter = {};',
        'export const router = Router();',
        'router.get("/public", createUser);',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/orders-controller.ts'),
      'export function index() { return []; }\n',
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/admin-controller.ts'),
      'export function createUser() { return true; }\n',
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/catalog-controller.ts'),
      'export function index() { return []; }\n',
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_cross_file_mounted_router',
      workflowRunId: 'run_cross_file_mounted_router',
      repoRoot: root,
      generatedAt: '2026-07-01T06:30:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 16384,
        maxCapturedFiles: 20,
      },
    });

    const route = (method: string, routePath: string) => inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === method
      && entrypoint.route === routePath
    ));
    const ordersRoute = route('GET', '/api/orders');
    const adminRoute = route('POST', '/api/admin/users');
    const catalogRoute = route('GET', '/api/store/catalog');
    const dynamicRoute = route('GET', '/dynamic-orders');
    const publicRoute = route('GET', '/public');
    const ordersHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'index'
      && symbol.path === 'apps/api/src/orders-controller.ts'
    ));
    const adminHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'createUser'
      && symbol.path === 'apps/api/src/admin-controller.ts'
    ));
    const catalogHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'index'
      && symbol.path === 'apps/api/src/catalog-controller.ts'
    ));
    const orderMiddleware = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'requireOrderAuth'
      && symbol.path === 'apps/api/src/orders-routes.ts'
    ));
    const adminMiddleware = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'requireAdmin'
      && symbol.path === 'apps/api/src/admin-routes.ts'
    ));
    const platformMiddleware = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'requirePlatformAdmin'
      && symbol.path === 'apps/api/src/app.ts'
    ));
    const catalogMiddleware = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'requireStore'
      && symbol.path === 'apps/api/src/catalog-routes.ts'
    ));

    expect(ordersRoute).toMatchObject({
      handler: 'OrdersController.index',
      path: 'apps/api/src/orders-routes.ts',
      sourceRefs: expect.arrayContaining([
        'file:apps/api/src/orders-routes.ts#L5',
        'file:apps/api/src/app.ts#L11',
      ]),
    });
    expect(adminRoute).toMatchObject({
      handler: 'createUser',
      path: 'apps/api/src/admin-routes.ts',
      sourceRefs: expect.arrayContaining([
        'file:apps/api/src/admin-routes.ts#L5',
        'file:apps/api/src/app.ts#L12',
      ]),
    });
    expect(catalogRoute).toMatchObject({
      handler: 'CatalogController.index',
      path: 'apps/api/src/catalog-routes.ts',
      sourceRefs: expect.arrayContaining([
        'file:apps/api/src/catalog-routes.ts#L5',
        'file:apps/api/src/catalog-routes.ts#L6',
        'file:apps/api/src/app.ts#L13',
      ]),
    });
    expect(dynamicRoute).toBeDefined();
    expect(publicRoute).toBeDefined();
    expect(inventory.entrypoints).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'http_route', route: '/api/dynamic/dynamic-orders' }),
      expect.objectContaining({ kind: 'http_route', route: '/api/missing/orders' }),
      expect.objectContaining({ kind: 'http_route', route: '/api/nope/public' }),
      expect.objectContaining({ kind: 'http_route', route: '/fake/orders' }),
    ]));
    expect(ordersHandler).toBeDefined();
    expect(adminHandler).toBeDefined();
    expect(catalogHandler).toBeDefined();
    expect(orderMiddleware).toBeDefined();
    expect(adminMiddleware).toBeDefined();
    expect(platformMiddleware).toBeDefined();
    expect(catalogMiddleware).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${ordersRoute?.id}`,
        to: `node_symbol_${ordersHandler?.id}`,
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/orders-routes.ts#L2',
          'file:apps/api/src/orders-routes.ts#L5',
          'file:apps/api/src/app.ts#L11',
          'file:apps/api/src/orders-controller.ts#L1',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${adminRoute?.id}`,
        to: `node_symbol_${adminHandler?.id}`,
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/admin-routes.ts#L2',
          'file:apps/api/src/admin-routes.ts#L5',
          'file:apps/api/src/app.ts#L12',
          'file:apps/api/src/admin-controller.ts#L1',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${catalogRoute?.id}`,
        to: `node_symbol_${catalogHandler?.id}`,
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/catalog-routes.ts#L2',
          'file:apps/api/src/catalog-routes.ts#L5',
          'file:apps/api/src/catalog-routes.ts#L6',
          'file:apps/api/src/app.ts#L13',
          'file:apps/api/src/catalog-controller.ts#L1',
        ]),
      }),
    ]));
    expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${ordersRoute?.id}`,
        to: `node_symbol_${orderMiddleware?.id}`,
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${adminRoute?.id}`,
        to: `node_symbol_${adminMiddleware?.id}`,
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${adminRoute?.id}`,
        to: `node_symbol_${platformMiddleware?.id}`,
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${catalogRoute?.id}`,
        to: `node_symbol_${catalogMiddleware?.id}`,
      }),
    ]));
  });

  test('applies cross-file static mount prefixes for CommonJS Express router exports', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-commonjs-mounted-router-'));
    await mkdir(join(root, 'apps/api/src'), { recursive: true });

    await writeFile(
      join(root, 'apps/api/src/app.cjs'),
      [
        'const express = require("express");',
        'const ordersRouter = require("./orders-routes");',
        'const { adminRouter } = require("./admin-routes");',
        'const { catalogRouter } = require("./catalog-routes");',
        'const { dynamicRouter } = require("./dynamic-routes");',
        'const { ghostRouter } = require("./ghost-routes");',
        'const badHandlerRouter = require("./bad-handler-routes");',
        'const unresolvedRouter = require("@example/unresolved");',
        'const { notRouter } = require("./not-router-routes");',
        'const app = express();',
        'const dynamicPrefix = "/api/dynamic";',
        'function requirePlatformAdmin() { return false; }',
        'app.use("/api", ordersRouter);',
        'app.use("/api/admin", requirePlatformAdmin, adminRouter);',
        'app.use("/api/store", catalogRouter);',
        'app.use(dynamicPrefix, dynamicRouter);',
        'app.use("/api/ghost", ghostRouter);',
        'app.use("/api/bad", badHandlerRouter);',
        'app.use("/api/missing", unresolvedRouter);',
        'app.use("/api/nope", notRouter);',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/orders-routes.cjs'),
      [
        'const express = require("express");',
        'const OrdersController = require("./orders-controller");',
        'const ordersRouter = express.Router();',
        'function requireOrderAuth() { return false; }',
        'ordersRouter.get("/orders", requireOrderAuth, OrdersController.index);',
        'module.exports = ordersRouter;',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/admin-routes.js'),
      [
        'const { Router } = require("express");',
        'const { createUser } = require("./admin-controller");',
        'const adminRouter = Router();',
        'function requireAdmin() { return false; }',
        'adminRouter.post("/users", requireAdmin, createUser);',
        'exports.adminRouter = adminRouter;',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/catalog-routes.cjs'),
      [
        'const { Router } = require("express");',
        'const CatalogController = require("./catalog-controller");',
        'const catalogRouter = Router();',
        'function requireStore() { return false; }',
        'catalogRouter.route("/catalog")',
        '  .get(requireStore, CatalogController.index);',
        'const sdk = { route() { return { get() {} }; } };',
        'sdk.route("/sdk/orders").get(CatalogController.index);',
        'module.exports.catalogRouter = catalogRouter;',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/ghost-routes.cjs'),
      [
        'const { Router } = require("express");',
        'const { createUser } = require("./admin-controller");',
        'const ghostRouter = Router();',
        'ghostRouter.get("/ghost", createUser);',
        'exports.ghostRouter = missingRouter;',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/bad-handler-routes.cjs'),
      [
        'const { Router } = require("express");',
        'const BadController = require("./bad-controller");',
        'const badHandlerRouter = Router();',
        'badHandlerRouter.get("/bad", BadController.index);',
        'module.exports = badHandlerRouter;',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/dynamic-routes.cjs'),
      [
        'const { Router } = require("express");',
        'const { createUser } = require("./admin-controller");',
        'const router = Router();',
        'router.get("/dynamic-orders", createUser);',
        'exports.dynamicRouter = router;',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/not-router-routes.cjs'),
      [
        'const { Router } = require("express");',
        'const { createUser } = require("./admin-controller");',
        'const notRouter = {};',
        'const router = Router();',
        'router.get("/public", createUser);',
        'exports.notRouter = notRouter;',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/orders-controller.cjs'),
      [
        'function index() { return []; }',
        'module.exports.index = index;',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/bad-controller.cjs'),
      [
        'function index() { return []; }',
        'module.exports.index = missingIndex;',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/admin-controller.js'),
      [
        'function createUser() { return true; }',
        'exports.createUser = createUser;',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/catalog-controller.cjs'),
      [
        'function index() { return []; }',
        'module.exports.index = index;',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_commonjs_mounted_router',
      workflowRunId: 'run_commonjs_mounted_router',
      repoRoot: root,
      generatedAt: '2026-07-01T07:30:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 16384,
        maxCapturedFiles: 20,
      },
    });

    const route = (method: string, routePath: string) => inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === method
      && entrypoint.route === routePath
    ));
    const ordersRoute = route('GET', '/api/orders');
    const adminRoute = route('POST', '/api/admin/users');
    const catalogRoute = route('GET', '/api/store/catalog');
    const dynamicRoute = route('GET', '/dynamic-orders');
    const publicRoute = route('GET', '/public');
    const badHandlerRoute = route('GET', '/api/bad/bad');
    const ordersHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'index'
      && symbol.path === 'apps/api/src/orders-controller.cjs'
    ));
    const adminHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'createUser'
      && symbol.path === 'apps/api/src/admin-controller.js'
    ));
    const catalogHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'index'
      && symbol.path === 'apps/api/src/catalog-controller.cjs'
    ));
    const badHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'index'
      && symbol.path === 'apps/api/src/bad-controller.cjs'
    ));
    const orderMiddleware = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'requireOrderAuth'
      && symbol.path === 'apps/api/src/orders-routes.cjs'
    ));
    const adminMiddleware = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'requireAdmin'
      && symbol.path === 'apps/api/src/admin-routes.js'
    ));
    const platformMiddleware = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'requirePlatformAdmin'
      && symbol.path === 'apps/api/src/app.cjs'
    ));
    const catalogMiddleware = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'requireStore'
      && symbol.path === 'apps/api/src/catalog-routes.cjs'
    ));

    expect(inventory.imports).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'apps/api/src/app.cjs',
        specifier: './orders-routes',
        importedNames: ['ordersRouter'],
        defaultImport: 'ordersRouter',
      }),
      expect.objectContaining({
        path: 'apps/api/src/app.cjs',
        specifier: './admin-routes',
        importedNames: ['adminRouter'],
        namedImports: [{ imported: 'adminRouter', local: 'adminRouter' }],
      }),
      expect.objectContaining({
        path: 'apps/api/src/orders-routes.cjs',
        specifier: './orders-controller',
        importedNames: ['OrdersController'],
        namespaceImport: 'OrdersController',
      }),
    ]));
    expect(inventory.exports).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'apps/api/src/orders-routes.cjs',
        name: 'ordersRouter',
        kind: 'default',
        exportedAs: 'default',
      }),
      expect.objectContaining({
        path: 'apps/api/src/admin-routes.js',
        name: 'adminRouter',
      }),
      expect.objectContaining({
        path: 'apps/api/src/catalog-routes.cjs',
        name: 'catalogRouter',
      }),
    ]));
    expect(ordersRoute).toMatchObject({
      handler: 'OrdersController.index',
      path: 'apps/api/src/orders-routes.cjs',
      sourceRefs: expect.arrayContaining([
        'file:apps/api/src/orders-routes.cjs#L5',
        'file:apps/api/src/app.cjs#L13',
      ]),
    });
    expect(adminRoute).toMatchObject({
      handler: 'createUser',
      path: 'apps/api/src/admin-routes.js',
      sourceRefs: expect.arrayContaining([
        'file:apps/api/src/admin-routes.js#L5',
        'file:apps/api/src/app.cjs#L14',
      ]),
    });
    expect(catalogRoute).toMatchObject({
      handler: 'CatalogController.index',
      path: 'apps/api/src/catalog-routes.cjs',
      sourceRefs: expect.arrayContaining([
        'file:apps/api/src/catalog-routes.cjs#L5',
        'file:apps/api/src/catalog-routes.cjs#L6',
        'file:apps/api/src/app.cjs#L15',
      ]),
    });
    expect(dynamicRoute).toBeDefined();
    expect(publicRoute).toBeDefined();
    expect(inventory.entrypoints).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'http_route', route: '/api/dynamic/dynamic-orders' }),
      expect.objectContaining({ kind: 'http_route', route: '/api/missing/orders' }),
      expect.objectContaining({ kind: 'http_route', route: '/api/nope/public' }),
      expect.objectContaining({ kind: 'http_route', route: '/sdk/orders' }),
      expect.objectContaining({ kind: 'http_route', route: '/api/store/sdk/orders' }),
      expect.objectContaining({ kind: 'http_route', route: '/api/ghost/ghost' }),
    ]));
    expect(ordersHandler).toBeDefined();
    expect(adminHandler).toBeDefined();
    expect(catalogHandler).toBeDefined();
    expect(badHandlerRoute).toBeDefined();
    expect(badHandler).toBeDefined();
    expect(orderMiddleware).toBeDefined();
    expect(adminMiddleware).toBeDefined();
    expect(platformMiddleware).toBeDefined();
    expect(catalogMiddleware).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${ordersRoute?.id}`,
        to: `node_symbol_${ordersHandler?.id}`,
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/orders-routes.cjs#L2',
          'file:apps/api/src/orders-routes.cjs#L5',
          'file:apps/api/src/app.cjs#L13',
          'file:apps/api/src/orders-controller.cjs#L1',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${adminRoute?.id}`,
        to: `node_symbol_${adminHandler?.id}`,
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/admin-routes.js#L2',
          'file:apps/api/src/admin-routes.js#L5',
          'file:apps/api/src/app.cjs#L14',
          'file:apps/api/src/admin-controller.js#L1',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${catalogRoute?.id}`,
        to: `node_symbol_${catalogHandler?.id}`,
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/catalog-routes.cjs#L2',
          'file:apps/api/src/catalog-routes.cjs#L5',
          'file:apps/api/src/catalog-routes.cjs#L6',
          'file:apps/api/src/app.cjs#L15',
          'file:apps/api/src/catalog-controller.cjs#L1',
        ]),
      }),
    ]));
    expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${ordersRoute?.id}`,
        to: `node_symbol_${orderMiddleware?.id}`,
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${adminRoute?.id}`,
        to: `node_symbol_${adminMiddleware?.id}`,
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${adminRoute?.id}`,
        to: `node_symbol_${platformMiddleware?.id}`,
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${catalogRoute?.id}`,
        to: `node_symbol_${catalogMiddleware?.id}`,
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${badHandlerRoute?.id}`,
        to: `node_symbol_${badHandler?.id}`,
      }),
    ]));
  });

  test('applies static mount prefixes for CommonJS object and inline router exports', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-commonjs-object-mounted-router-'));
    await mkdir(join(root, 'apps/api/src'), { recursive: true });

    await writeFile(
      join(root, 'apps/api/src/app.cjs'),
      [
        'const express = require("express");',
        'const { reportsRouter } = require("./reports-routes");',
        'const inlineRouter = require("./inline-routes");',
        'const { ghostRouter } = require("./ghost-routes");',
        'const app = express();',
        'app.use("/api/reports", reportsRouter);',
        'app.use("/api/inline", inlineRouter);',
        'app.use("/api/ghost", ghostRouter);',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/reports-routes.cjs'),
      [
        'const { Router } = require("express");',
        'const { listReports } = require("./reports-controller");',
        'const reportsRouter = Router();',
        'reportsRouter.get("/daily", listReports);',
        'module.exports = { reportsRouter, missingRouter };',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/inline-routes.cjs'),
      [
        'const { Router } = require("express");',
        'const { createUser } = require("./admin-controller");',
        'module.exports = Router();',
        'module.exports.get("/users", createUser);',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/ghost-routes.cjs'),
      [
        'const { Router } = require("express");',
        'const ghostRouter = Router();',
        'ghostRouter.get("/ghost", missingHandler);',
        'module.exports = { ghostRouter: missingRouter };',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/reports-controller.cjs'),
      [
        'function listReports() { return []; }',
        'module.exports.listReports = listReports;',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/admin-controller.js'),
      [
        'function createUser() { return true; }',
        'exports.createUser = createUser;',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_commonjs_object_mounted_router',
      workflowRunId: 'run_commonjs_object_mounted_router',
      repoRoot: root,
      generatedAt: '2026-07-01T09:30:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 16384,
        maxCapturedFiles: 12,
      },
    });

    const route = (method: string, routePath: string) => inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === method
      && entrypoint.route === routePath
    ));
    const reportsRoute = route('GET', '/api/reports/daily');
    const inlineRoute = route('GET', '/api/inline/users');
    const reportsHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'listReports'
      && symbol.path === 'apps/api/src/reports-controller.cjs'
    ));
    const inlineHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'createUser'
      && symbol.path === 'apps/api/src/admin-controller.js'
    ));

    expect(inventory.exports).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'apps/api/src/reports-routes.cjs',
        name: 'reportsRouter',
        exportedAs: 'reportsRouter',
      }),
      expect.objectContaining({
        path: 'apps/api/src/inline-routes.cjs',
        name: 'module.exports',
        kind: 'default',
        exportedAs: 'default',
      }),
    ]));
    expect(inventory.exports).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'apps/api/src/reports-routes.cjs',
        name: 'missingRouter',
      }),
      expect.objectContaining({
        path: 'apps/api/src/ghost-routes.cjs',
        name: 'ghostRouter',
      }),
    ]));
    expect(reportsRoute).toMatchObject({
      handler: 'listReports',
      path: 'apps/api/src/reports-routes.cjs',
      sourceRefs: expect.arrayContaining([
        'file:apps/api/src/reports-routes.cjs#L4',
        'file:apps/api/src/app.cjs#L6',
      ]),
    });
    expect(inlineRoute).toMatchObject({
      handler: 'createUser',
      path: 'apps/api/src/inline-routes.cjs',
      sourceRefs: expect.arrayContaining([
        'file:apps/api/src/inline-routes.cjs#L4',
        'file:apps/api/src/app.cjs#L7',
      ]),
    });
    expect(inventory.entrypoints).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'http_route', route: '/api/ghost/ghost' }),
    ]));
    expect(reportsHandler).toBeDefined();
    expect(inlineHandler).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${reportsRoute?.id}`,
        to: `node_symbol_${reportsHandler?.id}`,
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${inlineRoute?.id}`,
        to: `node_symbol_${inlineHandler?.id}`,
      }),
    ]));
  });

  test('follows static CommonJS re-export barrels for mounted routers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-commonjs-barrel-mounted-router-'));
    await mkdir(join(root, 'apps/api/src'), { recursive: true });

    await writeFile(
      join(root, 'apps/api/src/app.cjs'),
      [
        'const express = require("express");',
        'const reportsRouter = require("./reports-barrel");',
        'const { adminRouter } = require("./admin-barrel");',
        'const { userRouter } = require("./user-barrel");',
        'const { ghostRouter } = require("./ghost-barrel");',
        'const app = express();',
        'app.use("/api/reports", reportsRouter);',
        'app.use("/api/admin", adminRouter);',
        'app.use("/api/users", userRouter);',
        'app.use("/api/ghost", ghostRouter);',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/reports-barrel.cjs'),
      'module.exports = require("./reports-routes");',
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/admin-barrel.cjs'),
      'exports.adminRouter = require("./admin-routes").adminRouter;',
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/user-barrel.cjs'),
      'module.exports.userRouter = require("./user-routes");',
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/ghost-barrel.cjs'),
      'exports.ghostRouter = require("./ghost-routes").missingRouter;',
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/reports-routes.cjs'),
      [
        'const { Router } = require("express");',
        'const ReportsController = require("./reports-controller");',
        'const reportsRouter = Router();',
        'reportsRouter.get("/daily", ReportsController.listReports);',
        'module.exports = reportsRouter;',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/admin-routes.cjs'),
      [
        'const { Router } = require("express");',
        'const { createUser } = require("./admin-controller");',
        'const adminRouter = Router();',
        'adminRouter.post("/users", createUser);',
        'exports.adminRouter = adminRouter;',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/user-routes.cjs'),
      [
        'const { Router } = require("express");',
        'const { showUser } = require("./user-controller");',
        'const userRouter = Router();',
        'userRouter.get("/:id", showUser);',
        'module.exports = userRouter;',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/ghost-routes.cjs'),
      [
        'const { Router } = require("express");',
        'const ghostRouter = Router();',
        'ghostRouter.get("/ghost", missingHandler);',
        'module.exports = ghostRouter;',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/reports-controller.cjs'),
      [
        'function listReports() { return []; }',
        'module.exports.listReports = listReports;',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/admin-controller.cjs'),
      [
        'function createUser() { return true; }',
        'exports.createUser = createUser;',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/user-controller.cjs'),
      [
        'function showUser() { return true; }',
        'exports.showUser = showUser;',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_commonjs_barrel_mounted_router',
      workflowRunId: 'run_commonjs_barrel_mounted_router',
      repoRoot: root,
      generatedAt: '2026-07-01T10:30:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 24576,
        maxCapturedFiles: 20,
      },
    });

    const route = (method: string, routePath: string) => inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === method
      && entrypoint.route === routePath
    ));
    const reportsRoute = route('GET', '/api/reports/daily');
    const adminRoute = route('POST', '/api/admin/users');
    const userRoute = route('GET', '/api/users/:id');
    const reportsHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'listReports'
      && symbol.path === 'apps/api/src/reports-controller.cjs'
    ));
    const adminHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'createUser'
      && symbol.path === 'apps/api/src/admin-controller.cjs'
    ));
    const userHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'showUser'
      && symbol.path === 'apps/api/src/user-controller.cjs'
    ));

    expect(inventory.exports).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'apps/api/src/reports-barrel.cjs',
        kind: 're_export',
        name: 'default',
        exportedAs: 'default',
        specifier: './reports-routes',
      }),
      expect.objectContaining({
        path: 'apps/api/src/admin-barrel.cjs',
        kind: 're_export',
        name: 'adminRouter',
        exportedAs: 'adminRouter',
        specifier: './admin-routes',
      }),
      expect.objectContaining({
        path: 'apps/api/src/user-barrel.cjs',
        kind: 're_export',
        name: 'default',
        exportedAs: 'userRouter',
        specifier: './user-routes',
      }),
    ]));
    expect(reportsRoute).toMatchObject({
      handler: 'ReportsController.listReports',
      path: 'apps/api/src/reports-routes.cjs',
      sourceRefs: expect.arrayContaining([
        'file:apps/api/src/reports-routes.cjs#L4',
        'file:apps/api/src/app.cjs#L7',
      ]),
    });
    expect(adminRoute).toMatchObject({
      handler: 'createUser',
      path: 'apps/api/src/admin-routes.cjs',
      sourceRefs: expect.arrayContaining([
        'file:apps/api/src/admin-routes.cjs#L4',
        'file:apps/api/src/app.cjs#L8',
      ]),
    });
    expect(userRoute).toMatchObject({
      handler: 'showUser',
      path: 'apps/api/src/user-routes.cjs',
      sourceRefs: expect.arrayContaining([
        'file:apps/api/src/user-routes.cjs#L4',
        'file:apps/api/src/app.cjs#L9',
      ]),
    });
    expect(inventory.entrypoints).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'http_route', route: '/api/ghost/ghost' }),
    ]));
    expect(reportsHandler).toBeDefined();
    expect(adminHandler).toBeDefined();
    expect(userHandler).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${reportsRoute?.id}`,
        to: `node_symbol_${reportsHandler?.id}`,
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${adminRoute?.id}`,
        to: `node_symbol_${adminHandler?.id}`,
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${userRoute?.id}`,
        to: `node_symbol_${userHandler?.id}`,
      }),
    ]));
  });

  test('follows bounded two-hop CommonJS re-export chains for mounted routers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-commonjs-two-hop-barrel-router-'));
    await mkdir(join(root, 'apps/api/src'), { recursive: true });

    await writeFile(
      join(root, 'apps/api/src/app.cjs'),
      [
        'const express = require("express");',
        'const reportsRouter = require("./routes-index");',
        'const tooDeepRouter = require("./too-deep-a");',
        'const app = express();',
        'app.use("/api/reports", reportsRouter);',
        'app.use("/api/deep", tooDeepRouter);',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/routes-index.cjs'),
      'module.exports = require("./routes-feature");',
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/routes-feature.cjs'),
      'module.exports = require("./reports-routes");',
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/reports-routes.cjs'),
      [
        'const { Router } = require("express");',
        'const ReportsController = require("./reports-controller");',
        'const reportsRouter = Router();',
        'reportsRouter.get("/daily", ReportsController.listReports);',
        'module.exports = reportsRouter;',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/too-deep-a.cjs'),
      'module.exports = require("./too-deep-b");',
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/too-deep-b.cjs'),
      'module.exports = require("./too-deep-c");',
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/too-deep-c.cjs'),
      'module.exports = require("./too-deep-routes");',
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/too-deep-routes.cjs'),
      [
        'const { Router } = require("express");',
        'const { listReports } = require("./reports-controller");',
        'const tooDeepRouter = Router();',
        'tooDeepRouter.get("/hidden", listReports);',
        'module.exports = tooDeepRouter;',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/reports-controller.cjs'),
      [
        'function listReports() { return []; }',
        'module.exports.listReports = listReports;',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_commonjs_two_hop_barrel_router',
      workflowRunId: 'run_commonjs_two_hop_barrel_router',
      repoRoot: root,
      generatedAt: '2026-07-01T11:30:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 24576,
        maxCapturedFiles: 20,
      },
    });

    const route = (method: string, routePath: string) => inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === method
      && entrypoint.route === routePath
    ));
    const reportsRoute = route('GET', '/api/reports/daily');
    const reportsHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'listReports'
      && symbol.path === 'apps/api/src/reports-controller.cjs'
    ));

    expect(reportsRoute).toMatchObject({
      handler: 'ReportsController.listReports',
      path: 'apps/api/src/reports-routes.cjs',
      sourceRefs: expect.arrayContaining([
        'file:apps/api/src/reports-routes.cjs#L4',
        'file:apps/api/src/app.cjs#L5',
      ]),
    });
    expect(inventory.entrypoints).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'http_route', route: '/api/deep/hidden' }),
    ]));
    expect(reportsHandler).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${reportsRoute?.id}`,
        to: `node_symbol_${reportsHandler?.id}`,
      }),
    ]));
  });

  test('links CommonJS namespace service calls from route handlers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-commonjs-service-reference-'));
    await mkdir(join(root, 'apps/api/src'), { recursive: true });

    await writeFile(
      join(root, 'apps/api/src/app.cjs'),
      [
        'const express = require("express");',
        'const ordersRouter = require("./orders-routes");',
        'const app = express();',
        'app.use("/api", ordersRouter);',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/orders-routes.cjs'),
      [
        'const { Router } = require("express");',
        'const OrdersController = require("./orders-controller");',
        'const ordersRouter = Router();',
        'ordersRouter.get("/orders", OrdersController.index);',
        'module.exports = ordersRouter;',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/orders-controller.cjs'),
      [
        'const OrdersService = require("./orders-service");',
        'function index() {',
        '  return OrdersService.listOrders();',
        '}',
        'module.exports.index = index;',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/orders-service.cjs'),
      [
        'function listOrders() { return []; }',
        'module.exports.listOrders = listOrders;',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_commonjs_service_reference',
      workflowRunId: 'run_commonjs_service_reference',
      repoRoot: root,
      generatedAt: '2026-07-01T12:30:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 16384,
        maxCapturedFiles: 12,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/orders'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'index'
      && symbol.path === 'apps/api/src/orders-controller.cjs'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'listOrders'
      && symbol.path === 'apps/api/src/orders-service.cjs'
    ));

    expect(route).toMatchObject({
      handler: 'OrdersController.index',
      path: 'apps/api/src/orders-routes.cjs',
    });
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(inventory.imports).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'apps/api/src/orders-controller.cjs',
        specifier: './orders-service',
        importedNames: ['OrdersService'],
        namespaceImport: 'OrdersService',
      }),
    ]));
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'calls OrdersService.listOrders',
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/orders-controller.cjs#L1',
          'file:apps/api/src/orders-controller.cjs#L3',
          'file:apps/api/src/orders-service.cjs#L1',
          'file:apps/api/src/orders-service.cjs#L2',
        ]),
      }),
    ]));
  });

  test('links CommonJS inline object service exports from route handlers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-commonjs-inline-service-export-'));
    await mkdir(join(root, 'apps/api/src'), { recursive: true });

    await writeFile(
      join(root, 'apps/api/src/app.cjs'),
      [
        'const express = require("express");',
        'const ordersRouter = require("./orders-routes");',
        'const app = express();',
        'app.use("/api", ordersRouter);',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/orders-routes.cjs'),
      [
        'const { Router } = require("express");',
        'const OrdersController = require("./orders-controller");',
        'const ordersRouter = Router();',
        'ordersRouter.get("/orders", OrdersController.index);',
        'module.exports = ordersRouter;',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/orders-controller.cjs'),
      [
        'const OrdersService = require("./orders-service");',
        'function index() {',
        '  return OrdersService.listOrders();',
        '}',
        'module.exports.index = index;',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/orders-service.cjs'),
      [
        'module.exports = {',
        '  listOrders() { return []; },',
        '  missing: missingHandler,',
        '};',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_commonjs_inline_service_export',
      workflowRunId: 'run_commonjs_inline_service_export',
      repoRoot: root,
      generatedAt: '2026-07-01T13:30:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 16384,
        maxCapturedFiles: 12,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/orders'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'index'
      && symbol.path === 'apps/api/src/orders-controller.cjs'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'listOrders'
      && symbol.path === 'apps/api/src/orders-service.cjs'
    ));

    expect(route).toMatchObject({
      handler: 'OrdersController.index',
      path: 'apps/api/src/orders-routes.cjs',
    });
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(inventory.exports).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'apps/api/src/orders-service.cjs',
        name: 'listOrders',
        exportedAs: 'listOrders',
        symbolRef: service?.id,
      }),
    ]));
    expect(inventory.exports).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'apps/api/src/orders-service.cjs',
        name: 'missing',
      }),
    ]));
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'calls OrdersService.listOrders',
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/orders-controller.cjs#L1',
          'file:apps/api/src/orders-controller.cjs#L3',
          'file:apps/api/src/orders-service.cjs#L2',
        ]),
      }),
    ]));
  });

  test('links CommonJS property-assigned service function exports from route handlers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-commonjs-property-service-export-'));
    await mkdir(join(root, 'apps/api/src'), { recursive: true });

    await writeFile(
      join(root, 'apps/api/src/app.cjs'),
      [
        'const express = require("express");',
        'const ordersRouter = require("./orders-routes");',
        'const app = express();',
        'app.use("/api", ordersRouter);',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/orders-routes.cjs'),
      [
        'const { Router } = require("express");',
        'const OrdersController = require("./orders-controller");',
        'const ordersRouter = Router();',
        'ordersRouter.get("/orders", OrdersController.index);',
        'module.exports = ordersRouter;',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/orders-controller.cjs'),
      [
        'const OrdersService = require("./orders-service");',
        'function index() {',
        '  return OrdersService.listOrders();',
        '}',
        'module.exports.index = index;',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/orders-service.cjs'),
      [
        'exports.listOrders = function () { return []; };',
        'module.exports.countOrders = () => 0;',
        'exports.missing = missingHandler;',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_commonjs_property_service_export',
      workflowRunId: 'run_commonjs_property_service_export',
      repoRoot: root,
      generatedAt: '2026-07-01T14:30:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 16384,
        maxCapturedFiles: 12,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/orders'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'index'
      && symbol.path === 'apps/api/src/orders-controller.cjs'
    ));
    const listService = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'listOrders'
      && symbol.path === 'apps/api/src/orders-service.cjs'
    ));
    const countService = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'countOrders'
      && symbol.path === 'apps/api/src/orders-service.cjs'
    ));

    expect(route).toMatchObject({
      handler: 'OrdersController.index',
      path: 'apps/api/src/orders-routes.cjs',
    });
    expect(handler).toBeDefined();
    expect(listService).toBeDefined();
    expect(countService).toBeDefined();
    expect(inventory.exports).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'apps/api/src/orders-service.cjs',
        name: 'listOrders',
        exportedAs: 'listOrders',
        symbolRef: listService?.id,
      }),
      expect.objectContaining({
        path: 'apps/api/src/orders-service.cjs',
        name: 'countOrders',
        exportedAs: 'countOrders',
        symbolRef: countService?.id,
      }),
    ]));
    expect(inventory.exports).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'apps/api/src/orders-service.cjs',
        name: 'missing',
      }),
    ]));
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${listService?.id}`,
        label: 'calls OrdersService.listOrders',
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/orders-controller.cjs#L1',
          'file:apps/api/src/orders-controller.cjs#L3',
          'file:apps/api/src/orders-service.cjs#L1',
        ]),
      }),
    ]));
  });

  test('links CommonJS local object-literal controller and service method exports', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-commonjs-object-surface-'));
    await mkdir(join(root, 'apps/api/src'), { recursive: true });

    await writeFile(
      join(root, 'apps/api/src/app.cjs'),
      [
        'const express = require("express");',
        'const ordersRouter = require("./orders-routes");',
        'const app = express();',
        'app.use("/api", ordersRouter);',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/orders-routes.cjs'),
      [
        'const { Router } = require("express");',
        'const OrdersController = require("./orders-controller");',
        'const { InvoicesController } = require("./invoices-controller");',
        'const ordersRouter = Router();',
        'ordersRouter.get("/orders", OrdersController.index);',
        'ordersRouter.get("/invoices", InvoicesController.index);',
        'module.exports = ordersRouter;',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/orders-controller.cjs'),
      [
        'const { OrdersService } = require("./orders-service");',
        'const OrdersController = {',
        '  index() {',
        '    return OrdersService.listOrders();',
        '  },',
        '};',
        'module.exports = OrdersController;',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/invoices-controller.cjs'),
      [
        'const { OrdersService } = require("./orders-service");',
        'const InvoicesController = {',
        '  index() {',
        '    return OrdersService.listOrders();',
        '  },',
        '};',
        'exports.InvoicesController = InvoicesController;',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/orders-service.cjs'),
      [
        'const OrdersService = {',
        '  listOrders() { return []; },',
        '};',
        'module.exports.OrdersService = OrdersService;',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_commonjs_object_surface',
      workflowRunId: 'run_commonjs_object_surface',
      repoRoot: root,
      generatedAt: '2026-07-01T21:30:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 16384,
        maxCapturedFiles: 12,
      },
    });

    const ordersRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/orders'
    ));
    const invoicesRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/invoices'
    ));
    const controllerObject = inventory.symbols.find((symbol) => (
      symbol.kind === 'const'
      && symbol.name === 'OrdersController'
      && symbol.path === 'apps/api/src/orders-controller.cjs'
    ));
    const controllerMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'index'
      && symbol.path === 'apps/api/src/orders-controller.cjs'
      && symbol.signature.startsWith('OrdersController.')
    ));
    const namedControllerObject = inventory.symbols.find((symbol) => (
      symbol.kind === 'const'
      && symbol.name === 'InvoicesController'
      && symbol.path === 'apps/api/src/invoices-controller.cjs'
    ));
    const namedControllerMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'index'
      && symbol.path === 'apps/api/src/invoices-controller.cjs'
      && symbol.signature.startsWith('InvoicesController.')
    ));
    const serviceObject = inventory.symbols.find((symbol) => (
      symbol.kind === 'const'
      && symbol.name === 'OrdersService'
      && symbol.path === 'apps/api/src/orders-service.cjs'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'listOrders'
      && symbol.path === 'apps/api/src/orders-service.cjs'
      && symbol.signature.startsWith('OrdersService.')
    ));

    expect(ordersRoute).toMatchObject({
      handler: 'OrdersController.index',
      path: 'apps/api/src/orders-routes.cjs',
    });
    expect(invoicesRoute).toMatchObject({
      handler: 'InvoicesController.index',
      path: 'apps/api/src/orders-routes.cjs',
    });
    expect(controllerObject).toMatchObject({ exported: true });
    expect(namedControllerObject).toMatchObject({ exported: true });
    expect(serviceObject).toMatchObject({ exported: true });
    expect(controllerMethod).toMatchObject({ exported: false });
    expect(namedControllerMethod).toMatchObject({ exported: false });
    expect(serviceMethod).toMatchObject({ exported: false });
    expect(inventory.exports).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'apps/api/src/orders-controller.cjs',
        name: 'OrdersController',
        kind: 'default',
        exportedAs: 'default',
        symbolRef: controllerObject?.id,
      }),
      expect.objectContaining({
        path: 'apps/api/src/invoices-controller.cjs',
        name: 'InvoicesController',
        kind: 'const',
        exportedAs: 'InvoicesController',
        symbolRef: namedControllerObject?.id,
      }),
      expect.objectContaining({
        path: 'apps/api/src/orders-service.cjs',
        name: 'OrdersService',
        kind: 'const',
        exportedAs: 'OrdersService',
        symbolRef: serviceObject?.id,
      }),
    ]));
    expect(inventory.exports).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'apps/api/src/orders-controller.cjs',
        name: 'index',
      }),
      expect.objectContaining({
        path: 'apps/api/src/invoices-controller.cjs',
        name: 'index',
      }),
      expect.objectContaining({
        path: 'apps/api/src/orders-service.cjs',
        name: 'listOrders',
      }),
    ]));
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${ordersRoute?.id}`,
        to: `node_symbol_${controllerMethod?.id}`,
        label: 'route handler OrdersController.index',
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/orders-routes.cjs#L2',
          'file:apps/api/src/orders-routes.cjs#L5',
          'file:apps/api/src/orders-controller.cjs#L2',
          'file:apps/api/src/orders-controller.cjs#L3',
          'file:apps/api/src/orders-controller.cjs#L7',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${invoicesRoute?.id}`,
        to: `node_symbol_${namedControllerMethod?.id}`,
        label: 'route handler InvoicesController.index',
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/orders-routes.cjs#L3',
          'file:apps/api/src/orders-routes.cjs#L6',
          'file:apps/api/src/invoices-controller.cjs#L2',
          'file:apps/api/src/invoices-controller.cjs#L3',
          'file:apps/api/src/invoices-controller.cjs#L7',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${controllerMethod?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls OrdersService.listOrders',
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/orders-controller.cjs#L1',
          'file:apps/api/src/orders-controller.cjs#L4',
          'file:apps/api/src/orders-service.cjs#L1',
          'file:apps/api/src/orders-service.cjs#L2',
          'file:apps/api/src/orders-service.cjs#L4',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${namedControllerMethod?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls OrdersService.listOrders',
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/invoices-controller.cjs#L1',
          'file:apps/api/src/invoices-controller.cjs#L4',
          'file:apps/api/src/orders-service.cjs#L1',
          'file:apps/api/src/orders-service.cjs#L2',
          'file:apps/api/src/orders-service.cjs#L4',
        ]),
      }),
    ]));
  });

  test('links CommonJS default object-literal service and repository method exports', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-commonjs-object-barrel-chain-'));
    await mkdir(join(root, 'apps/api/src'), { recursive: true });

    await writeFile(
      join(root, 'apps/api/src/app.cjs'),
      [
        'const express = require("express");',
        'const { ordersRouter } = require("./orders-routes");',
        'const app = express();',
        'app.use("/api", ordersRouter);',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/orders-routes.cjs'),
      [
        'const { Router } = require("express");',
        'const { OrdersController } = require("./orders-controller");',
        'const ordersRouter = Router();',
        'ordersRouter.get("/orders", OrdersController.index);',
        'module.exports = { ordersRouter };',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/orders-controller.cjs'),
      [
        'const { orders: OrdersService } = require("./orders-service");',
        'const OrdersController = {',
        '  index() {',
        '    return OrdersService.listOrders();',
        '  },',
        '};',
        'module.exports = { OrdersController };',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/orders-service.cjs'),
      [
        'const { OrdersRepository } = require("./orders-repository");',
        'const OrdersService = {',
        '  listOrders() {',
        '    return OrdersRepository.findAll();',
        '  },',
        '};',
        'module.exports = { orders: OrdersService };',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/orders-repository.cjs'),
      [
        'const OrdersRepository = {',
        '  findAll() { return []; },',
        '};',
        'module.exports = { OrdersRepository };',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_commonjs_object_barrel_chain',
      workflowRunId: 'run_commonjs_object_barrel_chain',
      repoRoot: root,
      generatedAt: '2026-07-01T22:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 16384,
        maxCapturedFiles: 12,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/orders'
    ));
    const controllerObject = inventory.symbols.find((symbol) => (
      symbol.kind === 'const'
      && symbol.name === 'OrdersController'
      && symbol.path === 'apps/api/src/orders-controller.cjs'
    ));
    const controllerMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'index'
      && symbol.path === 'apps/api/src/orders-controller.cjs'
      && symbol.signature.startsWith('OrdersController.')
    ));
    const serviceObject = inventory.symbols.find((symbol) => (
      symbol.kind === 'const'
      && symbol.name === 'OrdersService'
      && symbol.path === 'apps/api/src/orders-service.cjs'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'listOrders'
      && symbol.path === 'apps/api/src/orders-service.cjs'
      && symbol.signature.startsWith('OrdersService.')
    ));
    const repositoryObject = inventory.symbols.find((symbol) => (
      symbol.kind === 'const'
      && symbol.name === 'OrdersRepository'
      && symbol.path === 'apps/api/src/orders-repository.cjs'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'findAll'
      && symbol.path === 'apps/api/src/orders-repository.cjs'
      && symbol.signature.startsWith('OrdersRepository.')
    ));

    expect(route).toMatchObject({
      handler: 'OrdersController.index',
      path: 'apps/api/src/orders-routes.cjs',
    });
    expect(controllerObject).toMatchObject({ exported: true });
    expect(serviceObject).toMatchObject({ exported: true });
    expect(repositoryObject).toMatchObject({ exported: true });
    expect(controllerMethod).toMatchObject({ exported: false });
    expect(serviceMethod).toMatchObject({ exported: false });
    expect(repositoryMethod).toMatchObject({ exported: false });
    expect(inventory.exports).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'apps/api/src/orders-controller.cjs',
        name: 'OrdersController',
        exportedAs: 'OrdersController',
        symbolRef: controllerObject?.id,
      }),
      expect.objectContaining({
        path: 'apps/api/src/orders-service.cjs',
        name: 'OrdersService',
        exportedAs: 'orders',
        symbolRef: serviceObject?.id,
      }),
      expect.objectContaining({
        path: 'apps/api/src/orders-repository.cjs',
        name: 'OrdersRepository',
        exportedAs: 'OrdersRepository',
        symbolRef: repositoryObject?.id,
      }),
    ]));
    expect(inventory.exports).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'apps/api/src/orders-service.cjs',
        name: 'listOrders',
      }),
      expect.objectContaining({
        path: 'apps/api/src/orders-repository.cjs',
        name: 'findAll',
      }),
    ]));
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${controllerMethod?.id}`,
        label: 'route handler OrdersController.index',
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/orders-routes.cjs#L2',
          'file:apps/api/src/orders-routes.cjs#L4',
          'file:apps/api/src/orders-controller.cjs#L2',
          'file:apps/api/src/orders-controller.cjs#L3',
          'file:apps/api/src/orders-controller.cjs#L7',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${controllerMethod?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls OrdersService.listOrders',
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/orders-controller.cjs#L1',
          'file:apps/api/src/orders-controller.cjs#L4',
          'file:apps/api/src/orders-service.cjs#L2',
          'file:apps/api/src/orders-service.cjs#L3',
          'file:apps/api/src/orders-service.cjs#L7',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls OrdersRepository.findAll',
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/orders-service.cjs#L1',
          'file:apps/api/src/orders-service.cjs#L4',
          'file:apps/api/src/orders-repository.cjs#L1',
          'file:apps/api/src/orders-repository.cjs#L2',
          'file:apps/api/src/orders-repository.cjs#L4',
        ]),
      }),
    ]));
  });

  test('uses the final middleware-chain route argument as the handler', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-middleware-chain-handler-'));
    await mkdir(join(root, 'apps/api/src'), { recursive: true });

    await writeFile(
      join(root, 'apps/api/src/orders-route.ts'),
      [
        'import { Router } from "express";',
        'import { createOrder } from "./orders-controller";',
        'import * as OrdersController from "./orders-controller";',
        'export const router = Router();',
        'export function auth() { return false; }',
        'export function validate() { return false; }',
        'router.get("/api/orders/:id", auth, OrdersController.show);',
        'router.post("/api/orders", validate, createOrder);',
        'router.patch("/api/orders/:id", auth, (req, res) => OrdersController.update(req, res));',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/orders-controller.ts'),
      [
        'export function show() { return true; }',
        'export function createOrder() { return true; }',
        'export function update() { return true; }',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_middleware_chain_handler',
      workflowRunId: 'run_middleware_chain_handler',
      repoRoot: root,
      generatedAt: '2026-07-01T05:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 20,
      },
    });

    const showRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route' && entrypoint.route === '/api/orders/:id'
    ));
    const createRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route' && entrypoint.route === '/api/orders'
    ));
    const complexCallbackRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'PATCH'
      && entrypoint.route === '/api/orders/:id'
    ));
    const showHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'show'
      && symbol.path === 'apps/api/src/orders-controller.ts'
    ));
    const createHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'createOrder'
      && symbol.path === 'apps/api/src/orders-controller.ts'
    ));
    const authMiddleware = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'auth'
      && symbol.path === 'apps/api/src/orders-route.ts'
    ));
    const validateMiddleware = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'validate'
      && symbol.path === 'apps/api/src/orders-route.ts'
    ));

    expect(showRoute).toMatchObject({ handler: 'OrdersController.show' });
    expect(createRoute).toMatchObject({ handler: 'createOrder' });
    expect(complexCallbackRoute).toBeDefined();
    expect(complexCallbackRoute?.handler).not.toBe('auth');
    expect(showHandler).toBeDefined();
    expect(createHandler).toBeDefined();
    expect(authMiddleware).toBeDefined();
    expect(validateMiddleware).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${showRoute?.id}`,
        to: `node_symbol_${showHandler?.id}`,
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/orders-route.ts#L3',
          'file:apps/api/src/orders-route.ts#L7',
          'file:apps/api/src/orders-controller.ts#L1',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${createRoute?.id}`,
        to: `node_symbol_${createHandler?.id}`,
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/orders-route.ts#L2',
          'file:apps/api/src/orders-route.ts#L8',
          'file:apps/api/src/orders-controller.ts#L2',
        ]),
      }),
    ]));
    expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${showRoute?.id}`,
        to: `node_symbol_${authMiddleware?.id}`,
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${createRoute?.id}`,
        to: `node_symbol_${validateMiddleware?.id}`,
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${complexCallbackRoute?.id}`,
        to: `node_symbol_${authMiddleware?.id}`,
      }),
    ]));
  });

  test('uses the final callback inside array middleware route arguments', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-array-middleware-handler-'));
    await mkdir(join(root, 'apps/api/src'), { recursive: true });

    await writeFile(
      join(root, 'apps/api/src/orders-route.ts'),
      [
        'import { Router } from "express";',
        'import { createOrder } from "./orders-controller";',
        'import * as OrdersController from "./orders-controller";',
        'export const router = Router();',
        'export function auth() { return false; }',
        'export function validate() { return false; }',
        'router.get("/api/orders", [auth, validate, OrdersController.index]);',
        'router.post("/api/orders", [auth, createOrder]);',
        'router.put("/api/orders/:id", [auth, validate, (req, res) => OrdersController.replace(req, res)]);',
        'router.route("/api/orders/:id")',
        '  .patch([auth, validate, OrdersController.update])',
        '  .delete([auth, validate, (req, res) => OrdersController.deleteOrder(req, res)]);',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/orders-controller.ts'),
      [
        'export function index() { return true; }',
        'export function createOrder() { return true; }',
        'export function replace() { return true; }',
        'export function update() { return true; }',
        'export function deleteOrder() { return true; }',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_array_middleware_handler',
      workflowRunId: 'run_array_middleware_handler',
      repoRoot: root,
      generatedAt: '2026-07-01T05:15:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 20,
      },
    });

    const route = (method: string, routePath: string) => inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === method
      && entrypoint.route === routePath
    ));
    const indexRoute = route('GET', '/api/orders');
    const createRoute = route('POST', '/api/orders');
    const complexArrayRoute = route('PUT', '/api/orders/:id');
    const patchRoute = route('PATCH', '/api/orders/:id');
    const inlineChainRoute = route('DELETE', '/api/orders/:id');
    const indexHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'index'
      && symbol.path === 'apps/api/src/orders-controller.ts'
    ));
    const createHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'createOrder'
      && symbol.path === 'apps/api/src/orders-controller.ts'
    ));
    const updateHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'update'
      && symbol.path === 'apps/api/src/orders-controller.ts'
    ));
    const authMiddleware = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'auth'
      && symbol.path === 'apps/api/src/orders-route.ts'
    ));
    const validateMiddleware = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'validate'
      && symbol.path === 'apps/api/src/orders-route.ts'
    ));

    expect(indexRoute).toMatchObject({ handler: 'OrdersController.index' });
    expect(createRoute).toMatchObject({ handler: 'createOrder' });
    expect(patchRoute).toMatchObject({ handler: 'OrdersController.update' });
    expect(complexArrayRoute).toBeDefined();
    expect(complexArrayRoute?.handler).toBeUndefined();
    expect(inlineChainRoute).toBeDefined();
    expect(inlineChainRoute?.handler).toBeUndefined();
    expect(indexHandler).toBeDefined();
    expect(createHandler).toBeDefined();
    expect(updateHandler).toBeDefined();
    expect(authMiddleware).toBeDefined();
    expect(validateMiddleware).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${indexRoute?.id}`,
        to: `node_symbol_${indexHandler?.id}`,
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${createRoute?.id}`,
        to: `node_symbol_${createHandler?.id}`,
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${patchRoute?.id}`,
        to: `node_symbol_${updateHandler?.id}`,
      }),
    ]));
    const routeHandlerEdges = inventory.symbolGraph.edges.filter((edge) => edge.kind === 'route_handler');
    expect(routeHandlerEdges).not.toContainEqual(
      expect.objectContaining({
        from: `node_entrypoint_${indexRoute?.id}`,
        to: `node_symbol_${authMiddleware?.id}`,
      }),
    );
    expect(routeHandlerEdges).not.toContainEqual(
      expect.objectContaining({
        from: `node_entrypoint_${createRoute?.id}`,
        to: `node_symbol_${authMiddleware?.id}`,
      }),
    );
    expect(routeHandlerEdges).not.toContainEqual(
      expect.objectContaining({
        from: `node_entrypoint_${patchRoute?.id}`,
        to: `node_symbol_${validateMiddleware?.id}`,
      }),
    );
    expect(routeHandlerEdges).not.toContainEqual(
      expect.objectContaining({
        from: `node_entrypoint_${complexArrayRoute?.id}`,
      }),
    );
    expect(routeHandlerEdges).not.toContainEqual(
      expect.objectContaining({
        from: `node_entrypoint_${inlineChainRoute?.id}`,
      }),
    );
  });

  test('detects Express route chains and links final callback handlers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-express-route-chain-'));
    await mkdir(join(root, 'apps/api/src'), { recursive: true });

    await writeFile(
      join(root, 'apps/api/src/orders-route.ts'),
      [
        'import { Router } from "express";',
        'import { deleteOrder } from "./orders-controller";',
        'import * as OrdersController from "./orders-controller";',
        'export const router = Router();',
        'export function auth() { return false; }',
        'export function validate() { return false; }',
        'router.route("/api/orders/:id")',
        '  .get(auth, OrdersController.show)',
        '  .patch(auth, OrdersController.update)',
        '  .delete(validate, deleteOrder);',
        'router.route("/api/orders/:id/inline")',
        '  .post(auth, (req, res) => OrdersController.create(req, res));',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/orders-controller.ts'),
      [
        'export function show() { return true; }',
        'export function update() { return true; }',
        'export function deleteOrder() { return true; }',
        'export function create() { return true; }',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_express_route_chain',
      workflowRunId: 'run_express_route_chain',
      repoRoot: root,
      generatedAt: '2026-07-01T05:30:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 20,
      },
    });

    const chainedRoute = (method: string, route = '/api/orders/:id') => inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === method
      && entrypoint.route === route
    ));
    const getRoute = chainedRoute('GET');
    const patchRoute = chainedRoute('PATCH');
    const deleteRoute = chainedRoute('DELETE');
    const inlineRoute = chainedRoute('POST', '/api/orders/:id/inline');
    const showHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'show'
      && symbol.path === 'apps/api/src/orders-controller.ts'
    ));
    const updateHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'update'
      && symbol.path === 'apps/api/src/orders-controller.ts'
    ));
    const deleteHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'deleteOrder'
      && symbol.path === 'apps/api/src/orders-controller.ts'
    ));
    const authMiddleware = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'auth'
      && symbol.path === 'apps/api/src/orders-route.ts'
    ));
    const validateMiddleware = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'validate'
      && symbol.path === 'apps/api/src/orders-route.ts'
    ));

    expect(getRoute).toMatchObject({
      handler: 'OrdersController.show',
      sourceRefs: ['file:apps/api/src/orders-route.ts#L7', 'file:apps/api/src/orders-route.ts#L8'],
    });
    expect(patchRoute).toMatchObject({ handler: 'OrdersController.update' });
    expect(deleteRoute).toMatchObject({ handler: 'deleteOrder' });
    expect(inlineRoute).toBeDefined();
    expect(inlineRoute?.handler).toBeUndefined();
    expect(showHandler).toBeDefined();
    expect(updateHandler).toBeDefined();
    expect(deleteHandler).toBeDefined();
    expect(authMiddleware).toBeDefined();
    expect(validateMiddleware).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${getRoute?.id}`,
        to: `node_symbol_${showHandler?.id}`,
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/orders-route.ts#L3',
          'file:apps/api/src/orders-route.ts#L7',
          'file:apps/api/src/orders-route.ts#L8',
          'file:apps/api/src/orders-controller.ts#L1',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${patchRoute?.id}`,
        to: `node_symbol_${updateHandler?.id}`,
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${deleteRoute?.id}`,
        to: `node_symbol_${deleteHandler?.id}`,
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/orders-route.ts#L2',
          'file:apps/api/src/orders-route.ts#L10',
          'file:apps/api/src/orders-controller.ts#L3',
        ]),
      }),
    ]));
    expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${getRoute?.id}`,
        to: `node_symbol_${authMiddleware?.id}`,
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${deleteRoute?.id}`,
        to: `node_symbol_${validateMiddleware?.id}`,
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${inlineRoute?.id}`,
        to: `node_symbol_${authMiddleware?.id}`,
      }),
    ]));
  });

  test('attaches graph-reachable service and repository symbols to route capabilities', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-graph-capability-'));
    await mkdir(join(root, 'apps/api/src/data'), { recursive: true });
    await mkdir(join(root, 'apps/api/src/domain'), { recursive: true });
    await mkdir(join(root, 'apps/api/test'), { recursive: true });

    await writeFile(
      join(root, 'apps/api/src/customer-route.ts'),
      [
        'import { Router } from "express";',
        'import { showCustomer } from "./customer-controller";',
        'export const router = Router();',
        'router.get("/api/customers/:id", showCustomer);',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/customer-controller.ts'),
      [
        'import { ProfileDirectory } from "./domain/profile-directory";',
        'export function showCustomer() {',
        '  const directory = new ProfileDirectory();',
        '  return directory.load();',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/domain/profile-directory.ts'),
      [
        'import { RecordStore } from "../data/record-store";',
        'export class ProfileDirectory {',
        '  load() {',
        '    const store = new RecordStore();',
        '    return store.find();',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/data/record-store.ts'),
      [
        'export class RecordStore {',
        '  find() { return { id: "c1" }; }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/test/customer-route.test.ts'),
      'import { describe, it, expect } from "vitest";\ndescribe("customer route", () => { it("loads", () => expect(true).toBe(true)); });\n',
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_graph_capability',
      workflowRunId: 'run_graph_capability',
      repoRoot: root,
      generatedAt: '2026-07-01T02:30:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 20,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route' && entrypoint.route === '/api/customers/:id'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.name === 'showCustomer' && symbol.path === 'apps/api/src/customer-controller.ts'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.name === 'ProfileDirectory' && symbol.path === 'apps/api/src/domain/profile-directory.ts'
    ));
    const repository = inventory.symbols.find((symbol) => (
      symbol.name === 'RecordStore' && symbol.path === 'apps/api/src/data/record-store.ts'
    ));

    expect(route).toBeDefined();
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(repository).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${service?.id}`,
        to: `node_symbol_${repository?.id}`,
      }),
    ]));
    const serviceToRepositoryEdge = inventory.symbolGraph.edges.find((edge) => (
      edge.kind === 'symbol_reference'
      && edge.from === `node_symbol_${service?.id}`
      && edge.to === `node_symbol_${repository?.id}`
    ));
    expect(serviceToRepositoryEdge).toBeDefined();

    const customersCapability = inventory.capabilities.find((capability) => capability.id === 'cap_api_customers');
    expect(customersCapability).toMatchObject({ label: 'Customers API' });
    expect(customersCapability?.symbolRefs).toEqual(expect.arrayContaining([
      handler?.id,
      service?.id,
      repository?.id,
    ]));
    expect(customersCapability?.sourceRefs).toEqual(expect.arrayContaining([
      'file:apps/api/src/customer-route.ts#L4',
      'file:apps/api/src/customer-controller.ts#L2',
      'file:apps/api/src/domain/profile-directory.ts#L2',
      'file:apps/api/src/data/record-store.ts#L1',
      'file:apps/api/test/customer-route.test.ts',
    ]));

    const serviceChunk = inventory.sourceChunks.find((chunk) => chunk.path === 'apps/api/src/domain/profile-directory.ts');
    const repositoryChunk = inventory.sourceChunks.find((chunk) => chunk.path === 'apps/api/src/data/record-store.ts');
    expect(serviceChunk?.capabilityRefs).toContain(customersCapability?.id);
    expect(repositoryChunk?.capabilityRefs).toContain(customersCapability?.id);
    expect(serviceChunk?.graphEdgeRefs).toContain(serviceToRepositoryEdge?.id);
    expect(repositoryChunk?.graphEdgeRefs).toContain(serviceToRepositoryEdge?.id);
    expect(service?.sourceChunkRefs).toContain(serviceChunk?.id);
    expect(repository?.sourceChunkRefs).toContain(repositoryChunk?.id);
    expect(customersCapability?.sourceChunkRefs).toEqual(expect.arrayContaining([
      serviceChunk?.id,
      repositoryChunk?.id,
    ]));
    expect(serviceToRepositoryEdge?.sourceChunkRefs).toEqual(expect.arrayContaining([
      serviceChunk?.id,
      repositoryChunk?.id,
    ]));
    expect(serviceChunk?.sourceRefs).toEqual(expect.arrayContaining([
      'file:apps/api/src/domain/profile-directory.ts#L4',
    ]));
    expect(serviceChunk?.sourceRefs).not.toContain('file:apps/api/src/data/record-store.ts#L1');
    expect(repositoryChunk?.sourceRefs).toContain('file:apps/api/src/data/record-store.ts#L1');
  });

  test('links static this-member constructed receivers to repository symbols', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-this-member-graph-'));
    await mkdir(join(root, 'apps/api/src/data'), { recursive: true });
    await mkdir(join(root, 'apps/api/src/domain'), { recursive: true });

    await writeFile(
      join(root, 'apps/api/src/domain/profile-directory.ts'),
      [
        'import { RecordStore } from "../data/record-store";',
        'export class ProfileDirectory {',
        '  private store = new RecordStore();',
        '  load() {',
        '    return this.store.find();',
        '  }',
        '}',
        'export class AuditDirectory {',
        '  private store: RecordStore;',
        '  constructor() {',
        '    this.store = new RecordStore();',
        '  }',
        '  loadAudit() {',
        '    return this.store.findAudit();',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/data/record-store.ts'),
      [
        'export class RecordStore {',
        '  find() { return { id: "c1" }; }',
        '  findAudit() { return [{ id: "a1" }]; }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_this_member_graph',
      workflowRunId: 'run_this_member_graph',
      repoRoot: root,
      generatedAt: '2026-07-01T03:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 10,
      },
    });

    const load = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'load'
      && symbol.path === 'apps/api/src/domain/profile-directory.ts'
    ));
    const loadAudit = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'loadAudit'
      && symbol.path === 'apps/api/src/domain/profile-directory.ts'
    ));
    const repository = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'RecordStore'
      && symbol.path === 'apps/api/src/data/record-store.ts'
    ));
    const find = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'find'
      && symbol.path === 'apps/api/src/data/record-store.ts'
    ));
    const findAudit = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'findAudit'
      && symbol.path === 'apps/api/src/data/record-store.ts'
    ));

    expect(load).toBeDefined();
    expect(loadAudit).toBeDefined();
    expect(repository).toBeDefined();
    expect(find).toBeDefined();
    expect(findAudit).toBeDefined();

    const loadToRepositoryClassEdge = inventory.symbolGraph.edges.find((edge) => (
      edge.kind === 'symbol_reference'
      && edge.from === `node_symbol_${load?.id}`
      && edge.to === `node_symbol_${repository?.id}`
      && edge.label === 'uses RecordStore'
    ));
    const loadToRepositoryMethodEdge = inventory.symbolGraph.edges.find((edge) => (
      edge.kind === 'symbol_reference'
      && edge.from === `node_symbol_${load?.id}`
      && edge.to === `node_symbol_${find?.id}`
      && edge.label === 'calls RecordStore.find'
    ));
    const auditToRepositoryClassEdge = inventory.symbolGraph.edges.find((edge) => (
      edge.kind === 'symbol_reference'
      && edge.from === `node_symbol_${loadAudit?.id}`
      && edge.to === `node_symbol_${repository?.id}`
      && edge.label === 'uses RecordStore'
    ));
    const auditToRepositoryMethodEdge = inventory.symbolGraph.edges.find((edge) => (
      edge.kind === 'symbol_reference'
      && edge.from === `node_symbol_${loadAudit?.id}`
      && edge.to === `node_symbol_${findAudit?.id}`
      && edge.label === 'calls RecordStore.findAudit'
    ));

    expect(loadToRepositoryClassEdge?.sourceRefs).toEqual(expect.arrayContaining([
      'file:apps/api/src/domain/profile-directory.ts#L1',
      'file:apps/api/src/domain/profile-directory.ts#L3',
      'file:apps/api/src/domain/profile-directory.ts#L5',
      'file:apps/api/src/data/record-store.ts#L1',
    ]));
    expect(loadToRepositoryMethodEdge?.sourceRefs).toEqual(expect.arrayContaining([
      'file:apps/api/src/domain/profile-directory.ts#L1',
      'file:apps/api/src/domain/profile-directory.ts#L3',
      'file:apps/api/src/domain/profile-directory.ts#L5',
      'file:apps/api/src/data/record-store.ts#L1',
      'file:apps/api/src/data/record-store.ts#L2',
    ]));
    expect(auditToRepositoryClassEdge?.sourceRefs).toEqual(expect.arrayContaining([
      'file:apps/api/src/domain/profile-directory.ts#L1',
      'file:apps/api/src/domain/profile-directory.ts#L11',
      'file:apps/api/src/domain/profile-directory.ts#L14',
      'file:apps/api/src/data/record-store.ts#L1',
    ]));
    expect(auditToRepositoryMethodEdge?.sourceRefs).toEqual(expect.arrayContaining([
      'file:apps/api/src/domain/profile-directory.ts#L1',
      'file:apps/api/src/domain/profile-directory.ts#L11',
      'file:apps/api/src/domain/profile-directory.ts#L14',
      'file:apps/api/src/data/record-store.ts#L1',
      'file:apps/api/src/data/record-store.ts#L3',
    ]));
  });

  test('links private class field constructed receivers to repository symbols', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-private-field-graph-'));
    await mkdir(join(root, 'apps/api/src/data'), { recursive: true });
    await mkdir(join(root, 'apps/api/src/domain'), { recursive: true });

    await writeFile(
      join(root, 'apps/api/src/domain/private-profile-directory.ts'),
      [
        'import { RecordStore } from "../data/record-store";',
        'export class PrivateProfileDirectory {',
        '  #store = new RecordStore();',
        '  loadPrivate() {',
        '    return this.#store.find();',
        '  }',
        '}',
        'export class PrivateAuditDirectory {',
        '  #store: RecordStore;',
        '  constructor() {',
        '    this.#store = new RecordStore();',
        '  }',
        '  loadPrivateAudit() {',
        '    return this.#store.findAudit();',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/data/record-store.ts'),
      [
        'export class RecordStore {',
        '  find() { return { id: "c1" }; }',
        '  findAudit() { return [{ id: "a1" }]; }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_private_field_graph',
      workflowRunId: 'run_private_field_graph',
      repoRoot: root,
      generatedAt: '2026-07-01T03:30:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 10,
      },
    });

    const loadPrivate = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'loadPrivate'
      && symbol.path === 'apps/api/src/domain/private-profile-directory.ts'
    ));
    const loadPrivateAudit = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'loadPrivateAudit'
      && symbol.path === 'apps/api/src/domain/private-profile-directory.ts'
    ));
    const repository = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'RecordStore'
      && symbol.path === 'apps/api/src/data/record-store.ts'
    ));
    const find = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'find'
      && symbol.path === 'apps/api/src/data/record-store.ts'
    ));
    const findAudit = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'findAudit'
      && symbol.path === 'apps/api/src/data/record-store.ts'
    ));

    expect(loadPrivate).toBeDefined();
    expect(loadPrivateAudit).toBeDefined();
    expect(repository).toBeDefined();
    expect(find).toBeDefined();
    expect(findAudit).toBeDefined();

    const loadToRepositoryClassEdge = inventory.symbolGraph.edges.find((edge) => (
      edge.kind === 'symbol_reference'
      && edge.from === `node_symbol_${loadPrivate?.id}`
      && edge.to === `node_symbol_${repository?.id}`
      && edge.label === 'uses RecordStore'
    ));
    const loadToRepositoryMethodEdge = inventory.symbolGraph.edges.find((edge) => (
      edge.kind === 'symbol_reference'
      && edge.from === `node_symbol_${loadPrivate?.id}`
      && edge.to === `node_symbol_${find?.id}`
      && edge.label === 'calls RecordStore.find'
    ));
    const auditToRepositoryClassEdge = inventory.symbolGraph.edges.find((edge) => (
      edge.kind === 'symbol_reference'
      && edge.from === `node_symbol_${loadPrivateAudit?.id}`
      && edge.to === `node_symbol_${repository?.id}`
      && edge.label === 'uses RecordStore'
    ));
    const auditToRepositoryMethodEdge = inventory.symbolGraph.edges.find((edge) => (
      edge.kind === 'symbol_reference'
      && edge.from === `node_symbol_${loadPrivateAudit?.id}`
      && edge.to === `node_symbol_${findAudit?.id}`
      && edge.label === 'calls RecordStore.findAudit'
    ));

    expect(loadToRepositoryClassEdge?.sourceRefs).toEqual(expect.arrayContaining([
      'file:apps/api/src/domain/private-profile-directory.ts#L1',
      'file:apps/api/src/domain/private-profile-directory.ts#L3',
      'file:apps/api/src/domain/private-profile-directory.ts#L5',
      'file:apps/api/src/data/record-store.ts#L1',
    ]));
    expect(loadToRepositoryMethodEdge?.sourceRefs).toEqual(expect.arrayContaining([
      'file:apps/api/src/domain/private-profile-directory.ts#L1',
      'file:apps/api/src/domain/private-profile-directory.ts#L3',
      'file:apps/api/src/domain/private-profile-directory.ts#L5',
      'file:apps/api/src/data/record-store.ts#L1',
      'file:apps/api/src/data/record-store.ts#L2',
    ]));
    expect(auditToRepositoryClassEdge?.sourceRefs).toEqual(expect.arrayContaining([
      'file:apps/api/src/domain/private-profile-directory.ts#L1',
      'file:apps/api/src/domain/private-profile-directory.ts#L11',
      'file:apps/api/src/domain/private-profile-directory.ts#L14',
      'file:apps/api/src/data/record-store.ts#L1',
    ]));
    expect(auditToRepositoryMethodEdge?.sourceRefs).toEqual(expect.arrayContaining([
      'file:apps/api/src/domain/private-profile-directory.ts#L1',
      'file:apps/api/src/domain/private-profile-directory.ts#L11',
      'file:apps/api/src/domain/private-profile-directory.ts#L14',
      'file:apps/api/src/data/record-store.ts#L1',
      'file:apps/api/src/data/record-store.ts#L3',
    ]));
  });

  test('links aliased barrel-imported route handlers to original controller symbols', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-aliased-handler-'));
    await mkdir(join(root, 'apps/api/src/controllers'), { recursive: true });

    await writeFile(
      join(root, 'apps/api/src/orders-route.ts'),
      [
        'import { Router } from "express";',
        'import { deleteOrder as removeOrder } from "./controllers";',
        'export const router = Router();',
        'function removeOrder() { return false; }',
        'router.delete("/api/orders/:id", removeOrder);',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/orders-wildcard-route.ts'),
      [
        'import { Router } from "express";',
        'import { deleteOrder as removeWildcardOrder } from "./controllers/all";',
        'export const router = Router();',
        'function removeWildcardOrder() { return false; }',
        'router.delete("/api/orders/wildcard/:id", removeWildcardOrder);',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/controllers/index.ts'),
      'export { deleteOrder } from "./orders-controller";\n',
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/controllers/all.ts'),
      'export * from "./orders-controller";\n',
      'utf8',
    );
    await writeFile(
      join(root, 'apps/api/src/controllers/orders-controller.ts'),
      'export function deleteOrder() { return true; }\n',
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_aliased_handler',
      workflowRunId: 'run_aliased_handler',
      repoRoot: root,
      generatedAt: '2026-07-01T02:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 20,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route' && entrypoint.route === '/api/orders/:id'
    ));
    const controllerHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'deleteOrder'
      && symbol.path === 'apps/api/src/controllers/orders-controller.ts'
    ));
    const localFallback = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'removeOrder'
      && symbol.path === 'apps/api/src/orders-route.ts'
    ));
    const wildcardRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route' && entrypoint.route === '/api/orders/wildcard/:id'
    ));
    const wildcardLocalFallback = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'removeWildcardOrder'
      && symbol.path === 'apps/api/src/orders-wildcard-route.ts'
    ));

    expect(route).toBeDefined();
    expect(wildcardRoute).toBeDefined();
    expect(controllerHandler).toBeDefined();
    expect(localFallback).toBeDefined();
    expect(wildcardLocalFallback).toBeDefined();
    expect(inventory.imports).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'apps/api/src/orders-route.ts',
        specifier: './controllers',
        importedNames: ['removeOrder'],
        namedImports: [{ imported: 'deleteOrder', local: 'removeOrder' }],
        sourceRefs: ['file:apps/api/src/orders-route.ts#L2'],
      }),
    ]));
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${controllerHandler?.id}`,
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/orders-route.ts#L2',
          'file:apps/api/src/orders-route.ts#L5',
          'file:apps/api/src/controllers/index.ts#L1',
          'file:apps/api/src/controllers/orders-controller.ts#L1',
        ]),
      }),
    ]));
    expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${localFallback?.id}`,
      }),
    ]));
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${wildcardRoute?.id}`,
        to: `node_symbol_${controllerHandler?.id}`,
        sourceRefs: expect.arrayContaining([
          'file:apps/api/src/orders-wildcard-route.ts#L2',
          'file:apps/api/src/orders-wildcard-route.ts#L5',
          'file:apps/api/src/controllers/all.ts#L1',
          'file:apps/api/src/controllers/orders-controller.ts#L1',
        ]),
      }),
    ]));
    expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${wildcardRoute?.id}`,
        to: `node_symbol_${wildcardLocalFallback?.id}`,
      }),
    ]));
  });

  test('links Spring controller handlers to constructed service and repository methods', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-spring-service-graph-'));
    await mkdir(join(root, 'aaa_shadow/billing'), { recursive: true });
    await mkdir(join(root, 'src/main/java/com/acme/legacy/billing'), { recursive: true });

    await writeFile(
      join(root, 'aaa_shadow/billing/BillingService.java'),
      [
        'package aaa.shadow.billing;',
        '',
        'public class BillingService {',
        '  public ShadowResult reconcile(String invoiceId) {',
        '    return new ShadowResult(invoiceId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/billing/BillingController.java'),
      [
        'package com.acme.legacy.billing;',
        '',
        '@RestController',
        '@RequestMapping("/api/v1/billing")',
        'public class BillingController {',
        '  private final BillingService billingService = new BillingService();',
        '',
        '  @PostMapping("/invoices/{invoiceId}/reconcile")',
        '  public ResponseEntity<?> reconcileInvoice(String invoiceId) {',
        '    return ResponseEntity.ok(billingService.reconcile(invoiceId));',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/billing/BillingService.java'),
      [
        'package com.acme.legacy.billing;',
        '',
        'public class BillingService {',
        '  private final BillingRepository billingRepository = new BillingRepository();',
        '',
        '  public ReconciliationResult reconcile(String invoiceId) {',
        '    return billingRepository.markReconciled(invoiceId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/billing/BillingRepository.java'),
      [
        'package com.acme.legacy.billing;',
        '',
        'public class BillingRepository {',
        '  public ReconciliationResult markReconciled(String invoiceId) {',
        '    return new ReconciliationResult(invoiceId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_spring_service_graph',
      workflowRunId: 'run_spring_service_graph',
      repoRoot: root,
      generatedAt: '2026-07-01T04:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 10,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v1/billing/invoices/{invoiceId}/reconcile'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'reconcileInvoice'
      && symbol.path === 'src/main/java/com/acme/legacy/billing/BillingController.java'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingService'
      && symbol.path === 'src/main/java/com/acme/legacy/billing/BillingService.java'
    ));
    const shadowService = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingService'
      && symbol.path === 'aaa_shadow/billing/BillingService.java'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'reconcile'
      && symbol.path === 'src/main/java/com/acme/legacy/billing/BillingService.java'
    ));
    const repository = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingRepository'
      && symbol.path === 'src/main/java/com/acme/legacy/billing/BillingRepository.java'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'markReconciled'
      && symbol.path === 'src/main/java/com/acme/legacy/billing/BillingRepository.java'
    ));

    expect(route).toBeDefined();
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(shadowService).toBeDefined();
    expect(serviceMethod).toBeDefined();
    expect(repository).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses BillingService',
        sourceRefs: expect.arrayContaining([
          'file:src/main/java/com/acme/legacy/billing/BillingController.java#L1',
          'file:src/main/java/com/acme/legacy/billing/BillingController.java#L6',
          'file:src/main/java/com/acme/legacy/billing/BillingController.java#L10',
          'file:src/main/java/com/acme/legacy/billing/BillingService.java#L3',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls BillingService.reconcile',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repository?.id}`,
        label: 'uses BillingRepository',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingRepository.markReconciled',
      }),
    ]));
    expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${shadowService?.id}`,
      }),
    ]));
  });

  test('links Spring constructor-injected interface fields to unique implementation methods', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-spring-interface-injection-'));
    await mkdir(join(root, 'aaa_shadow/billing'), { recursive: true });
    await mkdir(join(root, 'src/main/java/com/acme/legacy/billing'), { recursive: true });

    await writeFile(
      join(root, 'aaa_shadow/billing/JdbcBillingWorkflow.java'),
      [
        'package aaa.shadow.billing;',
        '',
        'public class JdbcBillingWorkflow {',
        '  public ShadowResult reconcile(String invoiceId) {',
        '    return new ShadowResult(invoiceId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/billing/BillingController.java'),
      [
        'package com.acme.legacy.billing;',
        '',
        '@RestController',
        '@RequestMapping("/api/v1/billing")',
        'public class BillingController {',
        '  private final BillingWorkflow billingWorkflow;',
        '',
        '  public BillingController(BillingWorkflow billingWorkflow) {',
        '    this.billingWorkflow = billingWorkflow;',
        '  }',
        '',
        '  @PostMapping("/invoices/{invoiceId}/reconcile")',
        '  public ResponseEntity<?> reconcileInvoice(String invoiceId) {',
        '    return ResponseEntity.ok(billingWorkflow.reconcile(invoiceId));',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/billing/BillingWorkflow.java'),
      [
        'package com.acme.legacy.billing;',
        '',
        'public interface BillingWorkflow {',
        '  ReconciliationResult reconcile(String invoiceId);',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/billing/JdbcBillingWorkflow.java'),
      [
        'package com.acme.legacy.billing;',
        '',
        'public class JdbcBillingWorkflow implements BillingWorkflow {',
        '  private final BillingRepository billingRepository = new BillingRepository();',
        '',
        '  public ReconciliationResult reconcile(String invoiceId) {',
        '    return billingRepository.markReconciled(invoiceId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/billing/BillingRepository.java'),
      [
        'package com.acme.legacy.billing;',
        '',
        'public class BillingRepository {',
        '  public ReconciliationResult markReconciled(String invoiceId) {',
        '    return new ReconciliationResult(invoiceId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_spring_interface_injection',
      workflowRunId: 'run_spring_interface_injection',
      repoRoot: root,
      generatedAt: '2026-07-01T04:20:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 12288,
        maxCapturedFiles: 10,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v1/billing/invoices/{invoiceId}/reconcile'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'reconcileInvoice'
      && symbol.path === 'src/main/java/com/acme/legacy/billing/BillingController.java'
    ));
    const workflow = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'JdbcBillingWorkflow'
      && symbol.path === 'src/main/java/com/acme/legacy/billing/JdbcBillingWorkflow.java'
    ));
    const shadowWorkflow = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'JdbcBillingWorkflow'
      && symbol.path === 'aaa_shadow/billing/JdbcBillingWorkflow.java'
    ));
    const workflowMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'reconcile'
      && symbol.path === 'src/main/java/com/acme/legacy/billing/JdbcBillingWorkflow.java'
    ));
    const repository = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingRepository'
      && symbol.path === 'src/main/java/com/acme/legacy/billing/BillingRepository.java'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'markReconciled'
      && symbol.path === 'src/main/java/com/acme/legacy/billing/BillingRepository.java'
    ));

    expect(route).toBeDefined();
    expect(handler).toBeDefined();
    expect(workflow).toBeDefined();
    expect(shadowWorkflow).toBeDefined();
    expect(workflowMethod).toBeDefined();
    expect(repository).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${workflow?.id}`,
        label: 'uses JdbcBillingWorkflow',
        sourceRefs: expect.arrayContaining([
          'file:src/main/java/com/acme/legacy/billing/BillingController.java#L8',
          'file:src/main/java/com/acme/legacy/billing/BillingController.java#L9',
          'file:src/main/java/com/acme/legacy/billing/BillingController.java#L14',
          'file:src/main/java/com/acme/legacy/billing/JdbcBillingWorkflow.java#L3',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${workflowMethod?.id}`,
        label: 'calls JdbcBillingWorkflow.reconcile',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${workflowMethod?.id}`,
        to: `node_symbol_${repository?.id}`,
        label: 'uses BillingRepository',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${workflowMethod?.id}`,
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingRepository.markReconciled',
      }),
    ]));
    expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${shadowWorkflow?.id}`,
      }),
    ]));
  });

  test('links Spring factory-assigned interface fields to unique implementation methods', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-spring-factory-interface-'));
    await mkdir(join(root, 'aaa_shadow/billing'), { recursive: true });
    await mkdir(join(root, 'src/main/java/com/acme/legacy/billing'), { recursive: true });

    await writeFile(
      join(root, 'aaa_shadow/billing/JdbcBillingWorkflow.java'),
      [
        'package aaa.shadow.billing;',
        '',
        'public class JdbcBillingWorkflow {',
        '  public ShadowResult reconcile(String invoiceId) {',
        '    return new ShadowResult(invoiceId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/billing/BillingController.java'),
      [
        'package com.acme.legacy.billing;',
        '',
        '@RestController',
        '@RequestMapping("/api/v1/billing")',
        'public class BillingController {',
        '  private final BillingWorkflow billingWorkflow = BillingWorkflowFactory.create();',
        '',
        '  @PostMapping("/invoices/{invoiceId}/reconcile")',
        '  public ResponseEntity<?> reconcileInvoice(String invoiceId) {',
        '    return ResponseEntity.ok(billingWorkflow.reconcile(invoiceId));',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/billing/BillingWorkflow.java'),
      [
        'package com.acme.legacy.billing;',
        '',
        'public interface BillingWorkflow {',
        '  ReconciliationResult reconcile(String invoiceId);',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/billing/BillingWorkflowFactory.java'),
      [
        'package com.acme.legacy.billing;',
        '',
        'public class BillingWorkflowFactory {',
        '  public static BillingWorkflow create() {',
        '    return new JdbcBillingWorkflow();',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/billing/JdbcBillingWorkflow.java'),
      [
        'package com.acme.legacy.billing;',
        '',
        'public class JdbcBillingWorkflow implements BillingWorkflow {',
        '  private final BillingRepository billingRepository = new BillingRepository();',
        '',
        '  public ReconciliationResult reconcile(String invoiceId) {',
        '    return billingRepository.markReconciled(invoiceId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/billing/BillingRepository.java'),
      [
        'package com.acme.legacy.billing;',
        '',
        'public class BillingRepository {',
        '  public ReconciliationResult markReconciled(String invoiceId) {',
        '    return new ReconciliationResult(invoiceId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_spring_factory_interface',
      workflowRunId: 'run_spring_factory_interface',
      repoRoot: root,
      generatedAt: '2026-07-01T04:40:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 16384,
        maxCapturedFiles: 12,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v1/billing/invoices/{invoiceId}/reconcile'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'reconcileInvoice'
      && symbol.path === 'src/main/java/com/acme/legacy/billing/BillingController.java'
    ));
    const workflow = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'JdbcBillingWorkflow'
      && symbol.path === 'src/main/java/com/acme/legacy/billing/JdbcBillingWorkflow.java'
    ));
    const shadowWorkflow = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'JdbcBillingWorkflow'
      && symbol.path === 'aaa_shadow/billing/JdbcBillingWorkflow.java'
    ));
    const workflowMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'reconcile'
      && symbol.path === 'src/main/java/com/acme/legacy/billing/JdbcBillingWorkflow.java'
    ));
    const repository = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingRepository'
      && symbol.path === 'src/main/java/com/acme/legacy/billing/BillingRepository.java'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'markReconciled'
      && symbol.path === 'src/main/java/com/acme/legacy/billing/BillingRepository.java'
    ));

    expect(route).toBeDefined();
    expect(handler).toBeDefined();
    expect(workflow).toBeDefined();
    expect(shadowWorkflow).toBeDefined();
    expect(workflowMethod).toBeDefined();
    expect(repository).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${workflow?.id}`,
        label: 'uses JdbcBillingWorkflow',
        sourceRefs: expect.arrayContaining([
          'file:src/main/java/com/acme/legacy/billing/BillingController.java#L6',
          'file:src/main/java/com/acme/legacy/billing/BillingController.java#L10',
          'file:src/main/java/com/acme/legacy/billing/JdbcBillingWorkflow.java#L3',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${workflowMethod?.id}`,
        label: 'calls JdbcBillingWorkflow.reconcile',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${workflowMethod?.id}`,
        to: `node_symbol_${repository?.id}`,
        label: 'uses BillingRepository',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${workflowMethod?.id}`,
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingRepository.markReconciled',
      }),
    ]));
    expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${shadowWorkflow?.id}`,
      }),
    ]));
  });

  test('detects Play Framework routes with controller graph evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-play-routes-'));
    await mkdir(join(root, 'conf'), { recursive: true });
    await mkdir(join(root, 'app/controllers'), { recursive: true });
    await mkdir(join(root, 'app/services'), { recursive: true });
    await mkdir(join(root, 'app/repositories'), { recursive: true });

    await writeFile(
      join(root, 'conf/routes'),
      [
        '# Billing routes',
        'POST   /billing/refunds/:refundId/approve   controllers.BillingController.approveRefund(refundId: String)',
        'GET    /customers/:customerId/profile       controllers.CustomerController.profile(customerId: String)',
        'GET    /assets/*file                        controllers.Assets.versioned(path="/public", file: Asset)',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/controllers/BillingController.java'),
      [
        'package controllers;',
        '',
        'public class BillingController extends Controller {',
        '  private final BillingService billingService = new BillingService();',
        '',
        '  public Result approveRefund(String refundId) {',
        '    return ok(billingService.approveRefund(refundId));',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/controllers/CustomerController.java'),
      [
        'package controllers;',
        '',
        'public class CustomerController extends Controller {',
        '  public Result profile(String customerId) {',
        '    return ok(customerId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/services/BillingService.java'),
      [
        'package services;',
        '',
        'public class BillingService {',
        '  private final BillingRepository billingRepository = new BillingRepository();',
        '',
        '  public RefundApproval approveRefund(String refundId) {',
        '    return billingRepository.approveRefund(refundId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/repositories/BillingRepository.java'),
      [
        'package repositories;',
        '',
        'public class BillingRepository {',
        '  public RefundApproval approveRefund(String refundId) {',
        '    return new RefundApproval(refundId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_play_routes',
      workflowRunId: 'run_play_routes',
      repoRoot: root,
      generatedAt: '2026-07-03T18:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 16384,
        maxCapturedFiles: 10,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/billing/refunds/:refundId/approve'
    ));
    const assetsRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.route === '/assets/*file'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'approveRefund'
      && symbol.path === 'app/controllers/BillingController.java'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingService'
      && symbol.path === 'app/services/BillingService.java'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'approveRefund'
      && symbol.path === 'app/services/BillingService.java'
    ));
    const repository = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingRepository'
      && symbol.path === 'app/repositories/BillingRepository.java'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'approveRefund'
      && symbol.path === 'app/repositories/BillingRepository.java'
    ));

    expect(route).toMatchObject({
      handler: 'BillingController#approveRefund',
      sourceRefs: ['file:conf/routes#L2'],
    });
    expect(assetsRoute).toBeUndefined();
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(serviceMethod).toBeDefined();
    expect(repository).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
        label: 'route handler BillingController#approveRefund',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses BillingService',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls BillingService.approveRefund',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repository?.id}`,
        label: 'uses BillingRepository',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingRepository.approveRefund',
      }),
    ]));
  });

  test('detects Spring XML MVC handler mappings with graph evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-spring-xml-'));
    await mkdir(join(root, 'src/main/webapp/WEB-INF/spring'), { recursive: true });
    await mkdir(join(root, 'src/main/java/com/acme/legacy/billing'), { recursive: true });
    await mkdir(join(root, 'src/main/java/com/acme/legacy/customers'), { recursive: true });

    await writeFile(
      join(root, 'src/main/webapp/WEB-INF/spring/billing-servlet.xml'),
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<beans>',
        '  <bean id="urlMapping" class="org.springframework.web.servlet.handler.SimpleUrlHandlerMapping">',
        '    <property name="mappings">',
        '      <props>',
        '        <prop key="/billing/invoices/reconcile.htm">billingController</prop>',
        '        <prop key="/customers/profile.htm">customerController</prop>',
        '      </props>',
        '    </property>',
        '  </bean>',
        '  <bean id="billingController" class="com.acme.legacy.billing.BillingController" />',
        '  <bean id="customerController" class="com.acme.legacy.customers.CustomerController" />',
        '</beans>',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/billing/BillingController.java'),
      [
        'package com.acme.legacy.billing;',
        '',
        'public class BillingController {',
        '  private final BillingService billingService = new BillingService();',
        '',
        '  public ModelAndView handleRequest(HttpServletRequest request, HttpServletResponse response) {',
        '    return new ModelAndView("billing", "result", billingService.reconcile(request.getParameter("invoiceId")));',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/billing/BillingService.java'),
      [
        'package com.acme.legacy.billing;',
        '',
        'public class BillingService {',
        '  private final BillingRepository billingRepository = new BillingRepository();',
        '',
        '  public ReconciliationResult reconcile(String invoiceId) {',
        '    return billingRepository.markReconciled(invoiceId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/billing/BillingRepository.java'),
      [
        'package com.acme.legacy.billing;',
        '',
        'public class BillingRepository {',
        '  public ReconciliationResult markReconciled(String invoiceId) {',
        '    return new ReconciliationResult(invoiceId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/customers/CustomerController.java'),
      [
        'package com.acme.legacy.customers;',
        '',
        'public class CustomerController {',
        '  public ModelAndView handleRequest(HttpServletRequest request, HttpServletResponse response) {',
        '    return new ModelAndView("customer");',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_spring_xml',
      workflowRunId: 'run_spring_xml',
      repoRoot: root,
      generatedAt: '2026-07-02T03:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 32768,
        maxCapturedFiles: 20,
      },
    });

    const routes = inventory.entrypoints
      .filter((entrypoint) => entrypoint.kind === 'http_route')
      .map((entrypoint) => `${entrypoint.method} ${entrypoint.route}`)
      .sort();
    expect(routes).toEqual(expect.arrayContaining([
      'ANY /billing/invoices/reconcile.htm',
      'ANY /customers/profile.htm',
    ]));

    const billingRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.route === '/billing/invoices/reconcile.htm'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'handleRequest'
      && symbol.path === 'src/main/java/com/acme/legacy/billing/BillingController.java'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingService'
      && symbol.path === 'src/main/java/com/acme/legacy/billing/BillingService.java'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'reconcile'
      && symbol.path === 'src/main/java/com/acme/legacy/billing/BillingService.java'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'markReconciled'
      && symbol.path === 'src/main/java/com/acme/legacy/billing/BillingRepository.java'
    ));

    expect(billingRoute).toMatchObject({
      method: 'ANY',
      handler: 'BillingController#handleRequest',
      sourceRefs: expect.arrayContaining([
        'file:src/main/webapp/WEB-INF/spring/billing-servlet.xml#L3',
        'file:src/main/webapp/WEB-INF/spring/billing-servlet.xml#L6',
        'file:src/main/webapp/WEB-INF/spring/billing-servlet.xml#L11',
      ]),
    });
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(serviceMethod).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${billingRoute?.id}`,
        to: `node_symbol_${handler?.id}`,
        label: 'route handler BillingController#handleRequest',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses BillingService',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls BillingService.reconcile',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingRepository.markReconciled',
      }),
    ]));

    const billingCapability = inventory.capabilities.find((capability) => capability.id === 'cap_api_billing');
    expect(billingCapability).toMatchObject({
      label: 'Billing API',
      entrypointRefs: [billingRoute?.id],
    });
  });

  test('links Spring XML property-injected controller beans to configured service methods', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-spring-xml-property-injection-'));
    await mkdir(join(root, 'src/main/webapp/WEB-INF/spring'), { recursive: true });
    await mkdir(join(root, 'src/main/java/com/acme/legacy/billing'), { recursive: true });
    await mkdir(join(root, 'src/main/java/com/acme/legacy/shadow'), { recursive: true });

    await writeFile(
      join(root, 'src/main/webapp/WEB-INF/spring/billing-servlet.xml'),
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<beans>',
        '  <bean id="urlMapping" class="org.springframework.web.servlet.handler.SimpleUrlHandlerMapping">',
        '    <property name="mappings">',
        '      <props>',
        '        <prop key="/billing/invoices/reconcile.htm">billingController</prop>',
        '      </props>',
        '    </property>',
        '  </bean>',
        '  <bean id="billingController" class="com.acme.legacy.billing.BillingController">',
        '    <property name="billingWorkflow" ref="billingWorkflow" />',
        '  </bean>',
        '  <bean id="billingWorkflow" class="com.acme.legacy.billing.JdbcBillingWorkflow" />',
        '  <bean id="shadowWorkflow" class="com.acme.legacy.shadow.JdbcBillingWorkflow" />',
        '</beans>',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/billing/BillingController.java'),
      [
        'package com.acme.legacy.billing;',
        '',
        'public class BillingController {',
        '  private BillingWorkflow billingWorkflow;',
        '',
        '  public ModelAndView handleRequest(HttpServletRequest request, HttpServletResponse response) {',
        '    return new ModelAndView("billing", "result", billingWorkflow.reconcile(request.getParameter("invoiceId")));',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/billing/BillingWorkflow.java'),
      [
        'package com.acme.legacy.billing;',
        '',
        'public interface BillingWorkflow {',
        '  ReconciliationResult reconcile(String invoiceId);',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/billing/JdbcBillingWorkflow.java'),
      [
        'package com.acme.legacy.billing;',
        '',
        'public class JdbcBillingWorkflow implements BillingWorkflow {',
        '  private final BillingRepository billingRepository = new BillingRepository();',
        '',
        '  public ReconciliationResult reconcile(String invoiceId) {',
        '    return billingRepository.markReconciled(invoiceId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/billing/BillingRepository.java'),
      [
        'package com.acme.legacy.billing;',
        '',
        'public class BillingRepository {',
        '  public ReconciliationResult markReconciled(String invoiceId) {',
        '    return new ReconciliationResult(invoiceId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/shadow/JdbcBillingWorkflow.java'),
      [
        'package com.acme.legacy.shadow;',
        '',
        'public class JdbcBillingWorkflow {',
        '  public ReconciliationResult reconcile(String invoiceId) {',
        '    return new ReconciliationResult(invoiceId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_spring_xml_property_injection',
      workflowRunId: 'run_spring_xml_property_injection',
      repoRoot: root,
      generatedAt: '2026-07-02T03:30:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 32768,
        maxCapturedFiles: 20,
      },
    });

    const billingRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.route === '/billing/invoices/reconcile.htm'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'handleRequest'
      && symbol.path === 'src/main/java/com/acme/legacy/billing/BillingController.java'
    ));
    const workflow = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'JdbcBillingWorkflow'
      && symbol.path === 'src/main/java/com/acme/legacy/billing/JdbcBillingWorkflow.java'
    ));
    const workflowMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'reconcile'
      && symbol.path === 'src/main/java/com/acme/legacy/billing/JdbcBillingWorkflow.java'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'markReconciled'
      && symbol.path === 'src/main/java/com/acme/legacy/billing/BillingRepository.java'
    ));
    const shadowWorkflow = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'JdbcBillingWorkflow'
      && symbol.path === 'src/main/java/com/acme/legacy/shadow/JdbcBillingWorkflow.java'
    ));

    expect(billingRoute).toMatchObject({
      method: 'ANY',
      handler: 'BillingController#handleRequest',
    });
    expect(handler).toBeDefined();
    expect(workflow).toBeDefined();
    expect(workflowMethod).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(shadowWorkflow).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${billingRoute?.id}`,
        to: `node_symbol_${handler?.id}`,
        label: 'route handler BillingController#handleRequest',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${workflow?.id}`,
        label: 'uses JdbcBillingWorkflow',
        sourceRefs: expect.arrayContaining([
          'file:src/main/webapp/WEB-INF/spring/billing-servlet.xml#L10',
          'file:src/main/webapp/WEB-INF/spring/billing-servlet.xml#L11',
          'file:src/main/webapp/WEB-INF/spring/billing-servlet.xml#L13',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${workflowMethod?.id}`,
        label: 'calls JdbcBillingWorkflow.reconcile',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingRepository.markReconciled',
      }),
    ]));
    expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${shadowWorkflow?.id}`,
      }),
    ]));
  });

  test('links Spring XML constructor-injected controller beans to configured service methods', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-spring-xml-constructor-injection-'));
    await mkdir(join(root, 'src/main/webapp/WEB-INF/spring'), { recursive: true });
    await mkdir(join(root, 'src/main/java/com/acme/legacy/billing'), { recursive: true });

    await writeFile(
      join(root, 'src/main/webapp/WEB-INF/spring/billing-servlet.xml'),
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<beans>',
        '  <bean id="urlMapping" class="org.springframework.web.servlet.handler.SimpleUrlHandlerMapping">',
        '    <property name="mappings">',
        '      <props>',
        '        <prop key="/billing/invoices/reconcile.htm">billingController</prop>',
        '      </props>',
        '    </property>',
        '  </bean>',
        '  <bean id="billingController" class="com.acme.legacy.billing.BillingController">',
        '    <constructor-arg name="billingWorkflow" ref="billingWorkflow" />',
        '  </bean>',
        '  <bean id="billingWorkflow" class="com.acme.legacy.billing.JdbcBillingWorkflow" />',
        '  <bean id="alternateWorkflow" class="com.acme.legacy.billing.InMemoryBillingWorkflow" />',
        '</beans>',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/billing/BillingController.java'),
      [
        'package com.acme.legacy.billing;',
        '',
        'public class BillingController {',
        '  private final BillingWorkflow billingWorkflow;',
        '',
        '  public BillingController(BillingWorkflow billingWorkflow) {',
        '    this.billingWorkflow = billingWorkflow;',
        '  }',
        '',
        '  public ModelAndView handleRequest(HttpServletRequest request, HttpServletResponse response) {',
        '    return new ModelAndView("billing", "result", billingWorkflow.reconcile(request.getParameter("invoiceId")));',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/billing/BillingWorkflow.java'),
      [
        'package com.acme.legacy.billing;',
        '',
        'public interface BillingWorkflow {',
        '  ReconciliationResult reconcile(String invoiceId);',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/billing/JdbcBillingWorkflow.java'),
      [
        'package com.acme.legacy.billing;',
        '',
        'public class JdbcBillingWorkflow implements BillingWorkflow {',
        '  private final BillingRepository billingRepository = new BillingRepository();',
        '',
        '  public ReconciliationResult reconcile(String invoiceId) {',
        '    return billingRepository.markReconciled(invoiceId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/billing/InMemoryBillingWorkflow.java'),
      [
        'package com.acme.legacy.billing;',
        '',
        'public class InMemoryBillingWorkflow implements BillingWorkflow {',
        '  public ReconciliationResult reconcile(String invoiceId) {',
        '    return new ReconciliationResult(invoiceId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/billing/BillingRepository.java'),
      [
        'package com.acme.legacy.billing;',
        '',
        'public class BillingRepository {',
        '  public ReconciliationResult markReconciled(String invoiceId) {',
        '    return new ReconciliationResult(invoiceId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_spring_xml_constructor_injection',
      workflowRunId: 'run_spring_xml_constructor_injection',
      repoRoot: root,
      generatedAt: '2026-07-02T04:15:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 32768,
        maxCapturedFiles: 20,
      },
    });

    const billingRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.route === '/billing/invoices/reconcile.htm'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'handleRequest'
      && symbol.path === 'src/main/java/com/acme/legacy/billing/BillingController.java'
    ));
    const workflow = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'JdbcBillingWorkflow'
      && symbol.path === 'src/main/java/com/acme/legacy/billing/JdbcBillingWorkflow.java'
    ));
    const workflowMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'reconcile'
      && symbol.path === 'src/main/java/com/acme/legacy/billing/JdbcBillingWorkflow.java'
    ));
    const alternateWorkflow = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'InMemoryBillingWorkflow'
      && symbol.path === 'src/main/java/com/acme/legacy/billing/InMemoryBillingWorkflow.java'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'markReconciled'
      && symbol.path === 'src/main/java/com/acme/legacy/billing/BillingRepository.java'
    ));

    expect(billingRoute).toMatchObject({
      method: 'ANY',
      handler: 'BillingController#handleRequest',
    });
    expect(handler).toBeDefined();
    expect(workflow).toBeDefined();
    expect(workflowMethod).toBeDefined();
    expect(alternateWorkflow).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${billingRoute?.id}`,
        to: `node_symbol_${handler?.id}`,
        label: 'route handler BillingController#handleRequest',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${workflow?.id}`,
        label: 'uses JdbcBillingWorkflow',
        sourceRefs: expect.arrayContaining([
          'file:src/main/webapp/WEB-INF/spring/billing-servlet.xml#L10',
          'file:src/main/webapp/WEB-INF/spring/billing-servlet.xml#L11',
          'file:src/main/webapp/WEB-INF/spring/billing-servlet.xml#L13',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${workflowMethod?.id}`,
        label: 'calls JdbcBillingWorkflow.reconcile',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingRepository.markReconciled',
      }),
    ]));
    expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${alternateWorkflow?.id}`,
      }),
    ]));
  });

  test('detects Spring XML MVC bean-name URL mappings with graph evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-spring-bean-name-'));
    await mkdir(join(root, 'src/main/webapp/WEB-INF/spring'), { recursive: true });
    await mkdir(join(root, 'src/main/java/com/acme/legacy/billing'), { recursive: true });
    await mkdir(join(root, 'src/main/java/com/acme/legacy/customers'), { recursive: true });

    await writeFile(
      join(root, 'src/main/webapp/WEB-INF/spring/billing-servlet.xml'),
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<beans>',
        '  <bean class="org.springframework.web.servlet.handler.BeanNameUrlHandlerMapping" />',
        '  <bean name="/billing/statements.htm statementController" class="com.acme.legacy.billing.StatementController" />',
        '  <bean id="/customers/profile.htm" class="com.acme.legacy.customers.CustomerController" />',
        '  <bean name="${dynamic.path}" class="com.acme.legacy.billing.DynamicController" />',
        '</beans>',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/billing/StatementController.java'),
      [
        'package com.acme.legacy.billing;',
        '',
        'public class StatementController {',
        '  private final StatementService statementService = new StatementService();',
        '',
        '  public ModelAndView handleRequest(HttpServletRequest request, HttpServletResponse response) {',
        '    return new ModelAndView("statement", "result", statementService.generate(request.getParameter("accountId")));',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/billing/StatementService.java'),
      [
        'package com.acme.legacy.billing;',
        '',
        'public class StatementService {',
        '  private final StatementRepository statementRepository = new StatementRepository();',
        '',
        '  public Statement generate(String accountId) {',
        '    return statementRepository.loadStatement(accountId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/billing/StatementRepository.java'),
      [
        'package com.acme.legacy.billing;',
        '',
        'public class StatementRepository {',
        '  public Statement loadStatement(String accountId) {',
        '    return new Statement(accountId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/customers/CustomerController.java'),
      [
        'package com.acme.legacy.customers;',
        '',
        'public class CustomerController {',
        '  public ModelAndView handleRequest(HttpServletRequest request, HttpServletResponse response) {',
        '    return new ModelAndView("customer");',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_spring_bean_name',
      workflowRunId: 'run_spring_bean_name',
      repoRoot: root,
      generatedAt: '2026-07-02T04:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 32768,
        maxCapturedFiles: 20,
      },
    });

    const routes = inventory.entrypoints
      .filter((entrypoint) => entrypoint.kind === 'http_route')
      .map((entrypoint) => `${entrypoint.method} ${entrypoint.route}`)
      .sort();
    expect(routes).toEqual(expect.arrayContaining([
      'ANY /billing/statements.htm',
      'ANY /customers/profile.htm',
    ]));
    expect(routes).not.toContain('ANY ${dynamic.path}');

    const billingRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.route === '/billing/statements.htm'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'handleRequest'
      && symbol.path === 'src/main/java/com/acme/legacy/billing/StatementController.java'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'StatementService'
      && symbol.path === 'src/main/java/com/acme/legacy/billing/StatementService.java'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'generate'
      && symbol.path === 'src/main/java/com/acme/legacy/billing/StatementService.java'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'loadStatement'
      && symbol.path === 'src/main/java/com/acme/legacy/billing/StatementRepository.java'
    ));

    expect(billingRoute).toMatchObject({
      method: 'ANY',
      handler: 'StatementController#handleRequest',
      sourceRefs: expect.arrayContaining([
        'file:src/main/webapp/WEB-INF/spring/billing-servlet.xml#L4',
      ]),
    });
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(serviceMethod).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${billingRoute?.id}`,
        to: `node_symbol_${handler?.id}`,
        label: 'route handler StatementController#handleRequest',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses StatementService',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls StatementService.generate',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls StatementRepository.loadStatement',
      }),
    ]));

    const billingCapability = inventory.capabilities.find((capability) => capability.id === 'cap_api_billing');
    expect(billingCapability).toMatchObject({
      label: 'Billing API',
      entrypointRefs: [billingRoute?.id],
    });
  });

  test('detects JAX-RS resource routes with class Path prefixes and handler graph edges', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-jax-rs-routes-'));
    await mkdir(join(root, 'src/main/java/com/acme/legacy/invoices'), { recursive: true });

    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/invoices/LegacyApplication.java'),
      [
        'package com.acme.legacy.invoices;',
        '',
        '@ApplicationPath("/api")',
        'public class LegacyApplication extends Application {}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/invoices/InvoiceResource.java'),
      [
        'package com.acme.legacy.invoices;',
        '',
        '@Path("/v1/invoices")',
        'public class InvoiceResource {',
        '  private final InvoiceService invoiceService = new InvoiceService();',
        '',
        '  @GET',
        '  @Path("/{invoiceId}/status")',
        '  public Response status(String invoiceId) {',
        '    return Response.ok(invoiceService.status(invoiceId)).build();',
        '  }',
        '',
        '  @POST',
        '  @Path("/{invoiceId}/reconcile")',
        '  public Response reconcile(String invoiceId) {',
        '    return Response.ok(invoiceService.reconcile(invoiceId)).build();',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/invoices/InvoiceService.java'),
      [
        'package com.acme.legacy.invoices;',
        '',
        'public class InvoiceService {',
        '  private final InvoiceRepository invoiceRepository = new InvoiceRepository();',
        '',
        '  public InvoiceStatus status(String invoiceId) {',
        '    return invoiceRepository.status(invoiceId);',
        '  }',
        '',
        '  public ReconciliationResult reconcile(String invoiceId) {',
        '    return invoiceRepository.markReconciled(invoiceId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/invoices/InvoiceRepository.java'),
      [
        'package com.acme.legacy.invoices;',
        '',
        'public class InvoiceRepository {',
        '  public InvoiceStatus status(String invoiceId) {',
        '    return new InvoiceStatus(invoiceId);',
        '  }',
        '',
        '  public ReconciliationResult markReconciled(String invoiceId) {',
        '    return new ReconciliationResult(invoiceId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_jax_rs_routes',
      workflowRunId: 'run_jax_rs_routes',
      repoRoot: root,
      generatedAt: '2026-07-01T04:30:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 10,
      },
    });

    const statusRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/v1/invoices/{invoiceId}/status'
    ));
    const reconcileRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v1/invoices/{invoiceId}/reconcile'
    ));
    const statusHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'status'
      && symbol.path === 'src/main/java/com/acme/legacy/invoices/InvoiceResource.java'
    ));
    const reconcileHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'reconcile'
      && symbol.path === 'src/main/java/com/acme/legacy/invoices/InvoiceResource.java'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'InvoiceService'
      && symbol.path === 'src/main/java/com/acme/legacy/invoices/InvoiceService.java'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'markReconciled'
      && symbol.path === 'src/main/java/com/acme/legacy/invoices/InvoiceRepository.java'
    ));

    expect(statusRoute).toMatchObject({
      handler: 'status',
      sourceRefs: expect.arrayContaining([
        'file:src/main/java/com/acme/legacy/invoices/LegacyApplication.java#L3',
        'file:src/main/java/com/acme/legacy/invoices/InvoiceResource.java#L3',
        'file:src/main/java/com/acme/legacy/invoices/InvoiceResource.java#L7',
        'file:src/main/java/com/acme/legacy/invoices/InvoiceResource.java#L8',
      ]),
    });
    expect(reconcileRoute).toMatchObject({
      handler: 'reconcile',
      sourceRefs: expect.arrayContaining([
        'file:src/main/java/com/acme/legacy/invoices/LegacyApplication.java#L3',
        'file:src/main/java/com/acme/legacy/invoices/InvoiceResource.java#L3',
        'file:src/main/java/com/acme/legacy/invoices/InvoiceResource.java#L13',
        'file:src/main/java/com/acme/legacy/invoices/InvoiceResource.java#L14',
      ]),
    });
    expect(statusHandler).toBeDefined();
    expect(reconcileHandler).toBeDefined();
    expect(service).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${statusRoute?.id}`,
        to: `node_symbol_${statusHandler?.id}`,
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${reconcileRoute?.id}`,
        to: `node_symbol_${reconcileHandler?.id}`,
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${reconcileHandler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses InvoiceService',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls InvoiceRepository.markReconciled',
      }),
    ]));
  });

  test('detects Java Servlet routes and links handlers to service methods', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-servlet-routes-'));
    await mkdir(join(root, 'src/main/java/com/acme/legacy/billing'), { recursive: true });
    await mkdir(join(root, 'src/main/java/com/acme/legacy/customers'), { recursive: true });
    await mkdir(join(root, 'src/main/java/com/acme/legacy/reports'), { recursive: true });

    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/billing/BillingServlet.java'),
      [
        'package com.acme.legacy.billing;',
        '',
        '@WebServlet(urlPatterns = {"/api/v1/billing/invoices/reconcile"})',
        'public class BillingServlet extends HttpServlet {',
        '  private final BillingService billingService = new BillingService();',
        '',
        '  protected void doPost(HttpServletRequest req, HttpServletResponse resp) {',
        '    billingService.reconcile(req.getParameter("invoiceId"));',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/customers/CustomerServlet.java'),
      [
        'package com.acme.legacy.customers;',
        '',
        '@WebServlet(urlPatterns = "/api/v1/customers/profile")',
        'public class CustomerServlet extends HttpServlet {',
        '  protected void doGet(HttpServletRequest req, HttpServletResponse resp) {',
        '    resp.getWriter().write(req.getParameter("customerId"));',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/reports/ReportServlet.java'),
      [
        'package com.acme.legacy.reports;',
        '',
        '@WebServlet("/api/v1/reports/daily")',
        'public class ReportServlet extends HttpServlet {',
        '  protected void doGet(HttpServletRequest req, HttpServletResponse resp) {',
        '    resp.getWriter().write("daily");',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/billing/BillingService.java'),
      [
        'package com.acme.legacy.billing;',
        '',
        'public class BillingService {',
        '  public ReconciliationResult reconcile(String invoiceId) {',
        '    return new ReconciliationResult(invoiceId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_servlet_routes',
      workflowRunId: 'run_servlet_routes',
      repoRoot: root,
      generatedAt: '2026-07-01T04:40:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 10,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v1/billing/invoices/reconcile'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'doPost'
      && symbol.path === 'src/main/java/com/acme/legacy/billing/BillingServlet.java'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingService'
      && symbol.path === 'src/main/java/com/acme/legacy/billing/BillingService.java'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'reconcile'
      && symbol.path === 'src/main/java/com/acme/legacy/billing/BillingService.java'
    ));
    const customerHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'doGet'
      && symbol.path === 'src/main/java/com/acme/legacy/customers/CustomerServlet.java'
    ));
    const reportHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'doGet'
      && symbol.path === 'src/main/java/com/acme/legacy/reports/ReportServlet.java'
    ));
    const customerCapability = inventory.capabilities.find((capability) => capability.id === 'cap_api_customers');
    const reportCapability = inventory.capabilities.find((capability) => capability.id === 'cap_api_reports');

    expect(route).toMatchObject({
      handler: 'doPost',
      sourceRefs: expect.arrayContaining([
        'file:src/main/java/com/acme/legacy/billing/BillingServlet.java#L3',
        'file:src/main/java/com/acme/legacy/billing/BillingServlet.java#L7',
      ]),
    });
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(serviceMethod).toBeDefined();
    expect(customerHandler).toBeDefined();
    expect(reportHandler).toBeDefined();
    expect(customerCapability?.symbolRefs).toContain(customerHandler?.id);
    expect(customerCapability?.symbolRefs).not.toContain(reportHandler?.id);
    expect(reportCapability?.symbolRefs).toContain(reportHandler?.id);
    expect(reportCapability?.symbolRefs).not.toContain(customerHandler?.id);
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
        label: 'route handler doPost',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses BillingService',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls BillingService.reconcile',
      }),
    ]));
  });

  test('detects web.xml Servlet mappings and links handlers to service methods', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-web-xml-servlet-routes-'));
    await mkdir(join(root, 'src/main/webapp/WEB-INF'), { recursive: true });
    await mkdir(join(root, 'src/main/java/com/acme/legacy/billing'), { recursive: true });

    await writeFile(
      join(root, 'src/main/webapp/WEB-INF/web.xml'),
      [
        '<web-app>',
        '  <servlet>',
        '    <servlet-name>billingServlet</servlet-name>',
        '    <servlet-class>com.acme.legacy.billing.BillingServlet</servlet-class>',
        '  </servlet>',
        '  <servlet-mapping>',
        '    <servlet-name>billingServlet</servlet-name>',
        '    <url-pattern>/api/v1/billing/invoices/reconcile</url-pattern>',
        '  </servlet-mapping>',
        '</web-app>',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/billing/BillingServlet.java'),
      [
        'package com.acme.legacy.billing;',
        '',
        'public class BillingServlet extends HttpServlet {',
        '  private final BillingService billingService = new BillingService();',
        '',
        '  protected void doPost(HttpServletRequest req, HttpServletResponse resp) {',
        '    billingService.reconcile(req.getParameter("invoiceId"));',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/billing/BillingService.java'),
      [
        'package com.acme.legacy.billing;',
        '',
        'public class BillingService {',
        '  public ReconciliationResult reconcile(String invoiceId) {',
        '    return new ReconciliationResult(invoiceId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_web_xml_servlet_routes',
      workflowRunId: 'run_web_xml_servlet_routes',
      repoRoot: root,
      generatedAt: '2026-07-01T05:30:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 10,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v1/billing/invoices/reconcile'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'doPost'
      && symbol.path === 'src/main/java/com/acme/legacy/billing/BillingServlet.java'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingService'
      && symbol.path === 'src/main/java/com/acme/legacy/billing/BillingService.java'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'reconcile'
      && symbol.path === 'src/main/java/com/acme/legacy/billing/BillingService.java'
    ));

    expect(route).toMatchObject({
      handler: 'BillingServlet#doPost',
      sourceRefs: expect.arrayContaining([
        'file:src/main/webapp/WEB-INF/web.xml#L4',
        'file:src/main/webapp/WEB-INF/web.xml#L8',
        'file:src/main/java/com/acme/legacy/billing/BillingServlet.java#L6',
      ]),
    });
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(serviceMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
        label: 'route handler BillingServlet#doPost',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses BillingService',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls BillingService.reconcile',
      }),
    ]));
  });

  test('detects Struts XML action routes and links actions to service methods', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-struts-routes-'));
    await mkdir(join(root, 'src/main/resources'), { recursive: true });
    await mkdir(join(root, 'src/main/webapp/WEB-INF'), { recursive: true });
    await mkdir(join(root, 'src/main/java/com/acme/legacy/billing'), { recursive: true });
    await mkdir(join(root, 'src/main/java/com/acme/legacy/customers'), { recursive: true });

    await writeFile(
      join(root, 'src/main/resources/struts.xml'),
      [
        '<!DOCTYPE struts PUBLIC "-//Apache Software Foundation//DTD Struts Configuration 2.5//EN" "struts-2.5.dtd">',
        '<struts>',
        '  <package name="billing" namespace="/api/v1/billing" extends="struts-default">',
        '    <action name="invoices/reconcile" class="com.acme.legacy.billing.ReconcileInvoiceAction" method="execute">',
        '      <result>/WEB-INF/jsp/billing.jsp</result>',
        '    </action>',
        '  </package>',
        '</struts>',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/webapp/WEB-INF/struts-config.xml'),
      [
        '<struts-config>',
        '  <action-mappings>',
        '    <action path="/api/v1/customers/profile" type="com.acme.legacy.customers.CustomerProfileAction" />',
        '  </action-mappings>',
        '</struts-config>',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/billing/ReconcileInvoiceAction.java'),
      [
        'package com.acme.legacy.billing;',
        '',
        'public class ReconcileInvoiceAction extends ActionSupport {',
        '  private final BillingService billingService = new BillingService();',
        '',
        '  public String execute() {',
        '    billingService.reconcile(invoiceId);',
        '    return SUCCESS;',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/billing/BillingService.java'),
      [
        'package com.acme.legacy.billing;',
        '',
        'public class BillingService {',
        '  public ReconciliationResult reconcile(String invoiceId) {',
        '    return new ReconciliationResult(invoiceId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/java/com/acme/legacy/customers/CustomerProfileAction.java'),
      [
        'package com.acme.legacy.customers;',
        '',
        'public class CustomerProfileAction extends Action {',
        '  public ActionForward execute() {',
        '    return mapping.findForward("profile");',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_struts_routes',
      workflowRunId: 'run_struts_routes',
      repoRoot: root,
      generatedAt: '2026-07-01T05:10:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 16384,
        maxCapturedFiles: 12,
      },
    });

    const billingRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'ANY'
      && entrypoint.route === '/api/v1/billing/invoices/reconcile'
    ));
    const customerRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'ANY'
      && entrypoint.route === '/api/v1/customers/profile'
    ));
    const billingAction = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'execute'
      && symbol.path === 'src/main/java/com/acme/legacy/billing/ReconcileInvoiceAction.java'
    ));
    const customerAction = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'execute'
      && symbol.path === 'src/main/java/com/acme/legacy/customers/CustomerProfileAction.java'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingService'
      && symbol.path === 'src/main/java/com/acme/legacy/billing/BillingService.java'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'reconcile'
      && symbol.path === 'src/main/java/com/acme/legacy/billing/BillingService.java'
    ));

    expect(billingRoute).toMatchObject({
      handler: 'ReconcileInvoiceAction#execute',
      sourceRefs: expect.arrayContaining([
        'file:src/main/resources/struts.xml#L3',
        'file:src/main/resources/struts.xml#L4',
      ]),
    });
    expect(customerRoute).toMatchObject({
      handler: 'CustomerProfileAction#execute',
      sourceRefs: ['file:src/main/webapp/WEB-INF/struts-config.xml#L3'],
    });
    expect(billingAction).toBeDefined();
    expect(customerAction).toBeDefined();
    expect(service).toBeDefined();
    expect(serviceMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${billingRoute?.id}`,
        to: `node_symbol_${billingAction?.id}`,
        label: 'route handler ReconcileInvoiceAction#execute',
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${customerRoute?.id}`,
        to: `node_symbol_${customerAction?.id}`,
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${billingAction?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses BillingService',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${billingAction?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls BillingService.reconcile',
      }),
    ]));
  });

  test('links ASP.NET action handlers to constructed service and repository methods', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-aspnet-service-graph-'));
    await mkdir(join(root, 'aaa_shadow/Billing'), { recursive: true });
    await mkdir(join(root, 'src/Legacy/Billing'), { recursive: true });

    await writeFile(
      join(root, 'aaa_shadow/Billing/BillingService.cs'),
      [
        'namespace Acme.Legacy.Shadow;',
        '',
        'public class BillingService',
        '{',
        '  public string ReconcileInvoice(string invoiceId)',
        '  {',
        '    return $"shadow:{invoiceId}";',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    await writeFile(
      join(root, 'src/Legacy/Billing/BillingController.cs'),
      [
        'namespace Acme.Legacy.Billing;',
        '',
        '[ApiController]',
        '[Route("api/v1/billing")]',
        'public class BillingController : ControllerBase',
        '{',
        '  private readonly BillingService _billingService = new BillingService();',
        '',
        '  [HttpPost("invoices/{invoiceId}/reconcile")]',
        '  public IActionResult ReconcileInvoice(string invoiceId)',
        '  {',
        '    return Ok(_billingService.ReconcileInvoice(invoiceId));',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Legacy/Billing/BillingService.cs'),
      [
        'namespace Acme.Legacy.Billing;',
        '',
        'public class BillingService',
        '{',
        '  private readonly BillingRepository _billingRepository = new BillingRepository();',
        '',
        '  public string ReconcileInvoice(string invoiceId)',
        '  {',
        '    return _billingRepository.MarkReconciled(invoiceId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Legacy/Billing/BillingRepository.cs'),
      [
        'namespace Acme.Legacy.Billing;',
        '',
        'public class BillingRepository',
        '{',
        '  public string MarkReconciled(string invoiceId)',
        '  {',
        '    return invoiceId;',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_aspnet_service_graph',
      workflowRunId: 'run_aspnet_service_graph',
      repoRoot: root,
      generatedAt: '2026-07-01T04:10:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 10,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v1/billing/invoices/{invoiceId}/reconcile'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'ReconcileInvoice'
      && symbol.path === 'src/Legacy/Billing/BillingController.cs'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingService'
      && symbol.path === 'src/Legacy/Billing/BillingService.cs'
    ));
    const shadowService = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingService'
      && symbol.path === 'aaa_shadow/Billing/BillingService.cs'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'ReconcileInvoice'
      && symbol.path === 'src/Legacy/Billing/BillingService.cs'
    ));
    const repository = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingRepository'
      && symbol.path === 'src/Legacy/Billing/BillingRepository.cs'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'MarkReconciled'
      && symbol.path === 'src/Legacy/Billing/BillingRepository.cs'
    ));

    expect(route).toBeDefined();
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(shadowService).toBeDefined();
    expect(serviceMethod).toBeDefined();
    expect(repository).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses BillingService',
        sourceRefs: expect.arrayContaining([
          'file:src/Legacy/Billing/BillingController.cs#L1',
          'file:src/Legacy/Billing/BillingController.cs#L7',
          'file:src/Legacy/Billing/BillingController.cs#L12',
          'file:src/Legacy/Billing/BillingService.cs#L3',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls BillingService.ReconcileInvoice',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repository?.id}`,
        label: 'uses BillingRepository',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingRepository.MarkReconciled',
      }),
    ]));
    expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${shadowService?.id}`,
      }),
    ]));
  });

  test('links ASP.NET constructor-injected interface fields to unique implementation methods', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-aspnet-interface-injection-'));
    await mkdir(join(root, 'aaa_shadow/Billing'), { recursive: true });
    await mkdir(join(root, 'src/Legacy/Billing'), { recursive: true });

    await writeFile(
      join(root, 'aaa_shadow/Billing/EfBillingWorkflow.cs'),
      [
        'namespace Acme.Legacy.Shadow;',
        '',
        'public class EfBillingWorkflow',
        '{',
        '  public string ReconcileInvoice(string invoiceId)',
        '  {',
        '    return $"shadow:{invoiceId}";',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    await writeFile(
      join(root, 'src/Legacy/Billing/BillingController.cs'),
      [
        'namespace Acme.Legacy.Billing;',
        '',
        '[ApiController]',
        '[Route("api/v1/billing")]',
        'public class BillingController : ControllerBase',
        '{',
        '  private readonly IBillingWorkflow _billingWorkflow;',
        '',
        '  public BillingController(IBillingWorkflow billingWorkflow)',
        '  {',
        '    _billingWorkflow = billingWorkflow;',
        '  }',
        '',
        '  [HttpPost("invoices/{invoiceId}/reconcile")]',
        '  public IActionResult ReconcileInvoice(string invoiceId)',
        '  {',
        '    return Ok(_billingWorkflow.ReconcileInvoice(invoiceId));',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Legacy/Billing/IBillingWorkflow.cs'),
      [
        'namespace Acme.Legacy.Billing;',
        '',
        'public interface IBillingWorkflow',
        '{',
        '  string ReconcileInvoice(string invoiceId);',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Legacy/Billing/EfBillingWorkflow.cs'),
      [
        'namespace Acme.Legacy.Billing;',
        '',
        'public class EfBillingWorkflow : IBillingWorkflow',
        '{',
        '  private readonly BillingRepository _billingRepository = new BillingRepository();',
        '',
        '  public string ReconcileInvoice(string invoiceId)',
        '  {',
        '    return _billingRepository.MarkReconciled(invoiceId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Legacy/Billing/BillingRepository.cs'),
      [
        'namespace Acme.Legacy.Billing;',
        '',
        'public class BillingRepository',
        '{',
        '  public string MarkReconciled(string invoiceId)',
        '  {',
        '    return invoiceId;',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_aspnet_interface_injection',
      workflowRunId: 'run_aspnet_interface_injection',
      repoRoot: root,
      generatedAt: '2026-07-01T04:30:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 12288,
        maxCapturedFiles: 10,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v1/billing/invoices/{invoiceId}/reconcile'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'ReconcileInvoice'
      && symbol.path === 'src/Legacy/Billing/BillingController.cs'
    ));
    const workflow = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'EfBillingWorkflow'
      && symbol.path === 'src/Legacy/Billing/EfBillingWorkflow.cs'
    ));
    const shadowWorkflow = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'EfBillingWorkflow'
      && symbol.path === 'aaa_shadow/Billing/EfBillingWorkflow.cs'
    ));
    const workflowMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'ReconcileInvoice'
      && symbol.path === 'src/Legacy/Billing/EfBillingWorkflow.cs'
    ));
    const repository = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingRepository'
      && symbol.path === 'src/Legacy/Billing/BillingRepository.cs'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'MarkReconciled'
      && symbol.path === 'src/Legacy/Billing/BillingRepository.cs'
    ));

    expect(route).toBeDefined();
    expect(handler).toBeDefined();
    expect(workflow).toBeDefined();
    expect(shadowWorkflow).toBeDefined();
    expect(workflowMethod).toBeDefined();
    expect(repository).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${workflow?.id}`,
        label: 'uses EfBillingWorkflow',
        sourceRefs: expect.arrayContaining([
          'file:src/Legacy/Billing/BillingController.cs#L9',
          'file:src/Legacy/Billing/BillingController.cs#L11',
          'file:src/Legacy/Billing/BillingController.cs#L17',
          'file:src/Legacy/Billing/EfBillingWorkflow.cs#L3',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${workflowMethod?.id}`,
        label: 'calls EfBillingWorkflow.ReconcileInvoice',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${workflowMethod?.id}`,
        to: `node_symbol_${repository?.id}`,
        label: 'uses BillingRepository',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${workflowMethod?.id}`,
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingRepository.MarkReconciled',
      }),
    ]));
    expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${shadowWorkflow?.id}`,
      }),
    ]));
  });

  test('links ASP.NET service-registered interface fields to configured implementation methods', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-aspnet-service-registration-'));
    await mkdir(join(root, 'src/Legacy/Billing'), { recursive: true });

    await writeFile(
      join(root, 'src/Legacy/Startup.cs'),
      [
        'using Acme.Legacy.Billing;',
        '',
        'namespace Acme.Legacy;',
        '',
        'public class Startup',
        '{',
        '  public void ConfigureServices(IServiceCollection services)',
        '  {',
        '    services.AddScoped<IBillingWorkflow, EfBillingWorkflow>();',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Legacy/Billing/BillingController.cs'),
      [
        'namespace Acme.Legacy.Billing;',
        '',
        '[ApiController]',
        '[Route("api/v1/billing")]',
        'public class BillingController : ControllerBase',
        '{',
        '  private readonly IBillingWorkflow _billingWorkflow;',
        '',
        '  public BillingController(IBillingWorkflow billingWorkflow)',
        '  {',
        '    _billingWorkflow = billingWorkflow;',
        '  }',
        '',
        '  [HttpPost("invoices/{invoiceId}/reconcile")]',
        '  public IActionResult ReconcileInvoice(string invoiceId)',
        '  {',
        '    return Ok(_billingWorkflow.ReconcileInvoice(invoiceId));',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Legacy/Billing/IBillingWorkflow.cs'),
      [
        'namespace Acme.Legacy.Billing;',
        '',
        'public interface IBillingWorkflow',
        '{',
        '  string ReconcileInvoice(string invoiceId);',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Legacy/Billing/EfBillingWorkflow.cs'),
      [
        'namespace Acme.Legacy.Billing;',
        '',
        'public class EfBillingWorkflow : IBillingWorkflow',
        '{',
        '  private readonly BillingRepository _billingRepository = new BillingRepository();',
        '',
        '  public string ReconcileInvoice(string invoiceId)',
        '  {',
        '    return _billingRepository.MarkReconciled(invoiceId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Legacy/Billing/InMemoryBillingWorkflow.cs'),
      [
        'namespace Acme.Legacy.Billing;',
        '',
        'public class InMemoryBillingWorkflow : IBillingWorkflow',
        '{',
        '  public string ReconcileInvoice(string invoiceId)',
        '  {',
        '    return $"memory:{invoiceId}";',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Legacy/Billing/BillingRepository.cs'),
      [
        'namespace Acme.Legacy.Billing;',
        '',
        'public class BillingRepository',
        '{',
        '  public string MarkReconciled(string invoiceId)',
        '  {',
        '    return invoiceId;',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_aspnet_service_registration',
      workflowRunId: 'run_aspnet_service_registration',
      repoRoot: root,
      generatedAt: '2026-07-02T12:10:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 16384,
        maxCapturedFiles: 12,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v1/billing/invoices/{invoiceId}/reconcile'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'ReconcileInvoice'
      && symbol.path === 'src/Legacy/Billing/BillingController.cs'
    ));
    const workflow = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'EfBillingWorkflow'
      && symbol.path === 'src/Legacy/Billing/EfBillingWorkflow.cs'
    ));
    const workflowMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'ReconcileInvoice'
      && symbol.path === 'src/Legacy/Billing/EfBillingWorkflow.cs'
    ));
    const alternateWorkflow = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'InMemoryBillingWorkflow'
      && symbol.path === 'src/Legacy/Billing/InMemoryBillingWorkflow.cs'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'MarkReconciled'
      && symbol.path === 'src/Legacy/Billing/BillingRepository.cs'
    ));

    expect(route).toBeDefined();
    expect(handler).toBeDefined();
    expect(workflow).toBeDefined();
    expect(workflowMethod).toBeDefined();
    expect(alternateWorkflow).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${workflow?.id}`,
        label: 'uses EfBillingWorkflow',
        sourceRefs: expect.arrayContaining([
          'file:src/Legacy/Startup.cs#L9',
          'file:src/Legacy/Billing/BillingController.cs#L9',
          'file:src/Legacy/Billing/BillingController.cs#L11',
          'file:src/Legacy/Billing/BillingController.cs#L17',
          'file:src/Legacy/Billing/EfBillingWorkflow.cs#L3',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${workflowMethod?.id}`,
        label: 'calls EfBillingWorkflow.ReconcileInvoice',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingRepository.MarkReconciled',
      }),
    ]));
    expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${alternateWorkflow?.id}`,
      }),
    ]));
  });

  test('links ASP.NET typeof service registrations to configured implementation methods', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-aspnet-typeof-registration-'));
    await mkdir(join(root, 'src/Legacy/Billing'), { recursive: true });

    await writeFile(
      join(root, 'src/Legacy/Startup.cs'),
      [
        'using Acme.Legacy.Billing;',
        '',
        'namespace Acme.Legacy;',
        '',
        'public class Startup',
        '{',
        '  public void ConfigureServices(IServiceCollection services)',
        '  {',
        '    services.AddTransient(typeof(IBillingWorkflow), typeof(EfBillingWorkflow));',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Legacy/Billing/BillingController.cs'),
      [
        'namespace Acme.Legacy.Billing;',
        '',
        '[ApiController]',
        '[Route("api/v1/billing")]',
        'public class BillingController : ControllerBase',
        '{',
        '  private readonly IBillingWorkflow _billingWorkflow;',
        '',
        '  public BillingController(IBillingWorkflow billingWorkflow)',
        '  {',
        '    _billingWorkflow = billingWorkflow;',
        '  }',
        '',
        '  [HttpPost("invoices/{invoiceId}/reconcile")]',
        '  public IActionResult ReconcileInvoice(string invoiceId)',
        '  {',
        '    return Ok(_billingWorkflow.ReconcileInvoice(invoiceId));',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Legacy/Billing/IBillingWorkflow.cs'),
      [
        'namespace Acme.Legacy.Billing;',
        '',
        'public interface IBillingWorkflow',
        '{',
        '  string ReconcileInvoice(string invoiceId);',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Legacy/Billing/EfBillingWorkflow.cs'),
      [
        'namespace Acme.Legacy.Billing;',
        '',
        'public class EfBillingWorkflow : IBillingWorkflow',
        '{',
        '  private readonly BillingRepository _billingRepository = new BillingRepository();',
        '',
        '  public string ReconcileInvoice(string invoiceId)',
        '  {',
        '    return _billingRepository.MarkReconciled(invoiceId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Legacy/Billing/InMemoryBillingWorkflow.cs'),
      [
        'namespace Acme.Legacy.Billing;',
        '',
        'public class InMemoryBillingWorkflow : IBillingWorkflow',
        '{',
        '  public string ReconcileInvoice(string invoiceId)',
        '  {',
        '    return $"memory:{invoiceId}";',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Legacy/Billing/BillingRepository.cs'),
      [
        'namespace Acme.Legacy.Billing;',
        '',
        'public class BillingRepository',
        '{',
        '  public string MarkReconciled(string invoiceId)',
        '  {',
        '    return invoiceId;',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_aspnet_typeof_registration',
      workflowRunId: 'run_aspnet_typeof_registration',
      repoRoot: root,
      generatedAt: '2026-07-02T12:30:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 16384,
        maxCapturedFiles: 12,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v1/billing/invoices/{invoiceId}/reconcile'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'ReconcileInvoice'
      && symbol.path === 'src/Legacy/Billing/BillingController.cs'
    ));
    const workflow = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'EfBillingWorkflow'
      && symbol.path === 'src/Legacy/Billing/EfBillingWorkflow.cs'
    ));
    const workflowMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'ReconcileInvoice'
      && symbol.path === 'src/Legacy/Billing/EfBillingWorkflow.cs'
    ));
    const alternateWorkflow = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'InMemoryBillingWorkflow'
      && symbol.path === 'src/Legacy/Billing/InMemoryBillingWorkflow.cs'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'MarkReconciled'
      && symbol.path === 'src/Legacy/Billing/BillingRepository.cs'
    ));

    expect(route).toBeDefined();
    expect(handler).toBeDefined();
    expect(workflow).toBeDefined();
    expect(workflowMethod).toBeDefined();
    expect(alternateWorkflow).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${workflow?.id}`,
        label: 'uses EfBillingWorkflow',
        sourceRefs: expect.arrayContaining([
          'file:src/Legacy/Startup.cs#L9',
          'file:src/Legacy/Billing/BillingController.cs#L9',
          'file:src/Legacy/Billing/BillingController.cs#L11',
          'file:src/Legacy/Billing/BillingController.cs#L17',
          'file:src/Legacy/Billing/EfBillingWorkflow.cs#L3',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${workflowMethod?.id}`,
        label: 'calls EfBillingWorkflow.ReconcileInvoice',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingRepository.MarkReconciled',
      }),
    ]));
    expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${alternateWorkflow?.id}`,
      }),
    ]));
  });

  test('links ASP.NET factory-assigned interface fields to unique implementation methods', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-aspnet-factory-interface-'));
    await mkdir(join(root, 'aaa_shadow/Billing'), { recursive: true });
    await mkdir(join(root, 'src/Legacy/Billing'), { recursive: true });

    await writeFile(
      join(root, 'aaa_shadow/Billing/EfBillingWorkflow.cs'),
      [
        'namespace Acme.Legacy.Shadow;',
        '',
        'public class EfBillingWorkflow',
        '{',
        '  public string ReconcileInvoice(string invoiceId)',
        '  {',
        '    return $"shadow:{invoiceId}";',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    await writeFile(
      join(root, 'src/Legacy/Billing/BillingController.cs'),
      [
        'namespace Acme.Legacy.Billing;',
        '',
        '[ApiController]',
        '[Route("api/v1/billing")]',
        'public class BillingController : ControllerBase',
        '{',
        '  private readonly IBillingWorkflow _billingWorkflow = BillingWorkflowFactory.Create();',
        '',
        '  [HttpPost("invoices/{invoiceId}/reconcile")]',
        '  public IActionResult ReconcileInvoice(string invoiceId)',
        '  {',
        '    return Ok(_billingWorkflow.ReconcileInvoice(invoiceId));',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Legacy/Billing/IBillingWorkflow.cs'),
      [
        'namespace Acme.Legacy.Billing;',
        '',
        'public interface IBillingWorkflow',
        '{',
        '  string ReconcileInvoice(string invoiceId);',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Legacy/Billing/BillingWorkflowFactory.cs'),
      [
        'namespace Acme.Legacy.Billing;',
        '',
        'public class BillingWorkflowFactory',
        '{',
        '  public static IBillingWorkflow Create()',
        '  {',
        '    return new EfBillingWorkflow();',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Legacy/Billing/EfBillingWorkflow.cs'),
      [
        'namespace Acme.Legacy.Billing;',
        '',
        'public class EfBillingWorkflow : IBillingWorkflow',
        '{',
        '  private readonly BillingRepository _billingRepository = new BillingRepository();',
        '',
        '  public string ReconcileInvoice(string invoiceId)',
        '  {',
        '    return _billingRepository.MarkReconciled(invoiceId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Legacy/Billing/BillingRepository.cs'),
      [
        'namespace Acme.Legacy.Billing;',
        '',
        'public class BillingRepository',
        '{',
        '  public string MarkReconciled(string invoiceId)',
        '  {',
        '    return invoiceId;',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_aspnet_factory_interface',
      workflowRunId: 'run_aspnet_factory_interface',
      repoRoot: root,
      generatedAt: '2026-07-01T04:50:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 16384,
        maxCapturedFiles: 12,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v1/billing/invoices/{invoiceId}/reconcile'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'ReconcileInvoice'
      && symbol.path === 'src/Legacy/Billing/BillingController.cs'
    ));
    const workflow = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'EfBillingWorkflow'
      && symbol.path === 'src/Legacy/Billing/EfBillingWorkflow.cs'
    ));
    const shadowWorkflow = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'EfBillingWorkflow'
      && symbol.path === 'aaa_shadow/Billing/EfBillingWorkflow.cs'
    ));
    const workflowMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'ReconcileInvoice'
      && symbol.path === 'src/Legacy/Billing/EfBillingWorkflow.cs'
    ));
    const repository = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingRepository'
      && symbol.path === 'src/Legacy/Billing/BillingRepository.cs'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'MarkReconciled'
      && symbol.path === 'src/Legacy/Billing/BillingRepository.cs'
    ));

    expect(route).toBeDefined();
    expect(handler).toBeDefined();
    expect(workflow).toBeDefined();
    expect(shadowWorkflow).toBeDefined();
    expect(workflowMethod).toBeDefined();
    expect(repository).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${workflow?.id}`,
        label: 'uses EfBillingWorkflow',
        sourceRefs: expect.arrayContaining([
          'file:src/Legacy/Billing/BillingController.cs#L7',
          'file:src/Legacy/Billing/BillingController.cs#L12',
          'file:src/Legacy/Billing/EfBillingWorkflow.cs#L3',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${workflowMethod?.id}`,
        label: 'calls EfBillingWorkflow.ReconcileInvoice',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${workflowMethod?.id}`,
        to: `node_symbol_${repository?.id}`,
        label: 'uses BillingRepository',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${workflowMethod?.id}`,
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingRepository.MarkReconciled',
      }),
    ]));
    expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${shadowWorkflow?.id}`,
      }),
    ]));
  });

  test('detects old ASP.NET route table routes with static defaults', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-aspnet-routetable-'));
    await mkdir(join(root, 'App_Start'), { recursive: true });
    await mkdir(join(root, 'Controllers'), { recursive: true });
    await mkdir(join(root, 'Services'), { recursive: true });
    await mkdir(join(root, 'Repositories'), { recursive: true });

    await writeFile(
      join(root, 'App_Start/RouteConfig.cs'),
      [
        'public class RouteConfig',
        '{',
        '  public static void RegisterRoutes(RouteCollection routes)',
        '  {',
        '    routes.MapRoute(',
        '      name: "BillingStatement",',
        '      url: "billing/statements/{statementId}",',
        '      defaults: new { controller = "Billing", action = "Statement" }',
        '    );',
        '    routes.MapRoute(',
        '      name: "Default",',
        '      url: "{controller}/{action}/{id}",',
        '      defaults: new { controller = "Home", action = "Index", id = UrlParameter.Optional }',
        '    );',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'App_Start/WebApiConfig.cs'),
      [
        'public static class WebApiConfig',
        '{',
        '  public static void Register(HttpConfiguration config)',
        '  {',
        '    config.Routes.MapHttpRoute(',
        '      name: "BillingReconcileApi",',
        '      routeTemplate: "api/billing/reconcile/{invoiceId}",',
        '      defaults: new { controller = "Billing", action = "Reconcile" }',
        '    );',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'Controllers/BillingController.cs'),
      [
        'public class BillingController : Controller',
        '{',
        '  private readonly BillingService _billingService = new BillingService();',
        '',
        '  public ActionResult Statement(string statementId)',
        '  {',
        '    return View(_billingService.LoadStatement(statementId));',
        '  }',
        '',
        '  public IHttpActionResult Reconcile(string invoiceId)',
        '  {',
        '    return Ok(_billingService.ReconcileInvoice(invoiceId));',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'Services/BillingService.cs'),
      [
        'public class BillingService',
        '{',
        '  private readonly BillingRepository _billingRepository = new BillingRepository();',
        '',
        '  public string LoadStatement(string statementId)',
        '  {',
        '    return _billingRepository.LoadStatement(statementId);',
        '  }',
        '',
        '  public string ReconcileInvoice(string invoiceId)',
        '  {',
        '    return _billingRepository.MarkReconciled(invoiceId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'Repositories/BillingRepository.cs'),
      [
        'public class BillingRepository',
        '{',
        '  public string LoadStatement(string statementId)',
        '  {',
        '    return statementId;',
        '  }',
        '',
        '  public string MarkReconciled(string invoiceId)',
        '  {',
        '    return invoiceId;',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_aspnet_route_table',
      workflowRunId: 'run_aspnet_route_table',
      repoRoot: root,
      generatedAt: '2026-07-02T06:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 32768,
        maxCapturedFiles: 20,
      },
    });

    const routes = inventory.entrypoints
      .filter((entrypoint) => entrypoint.kind === 'http_route')
      .map((entrypoint) => `${entrypoint.method} ${entrypoint.route}`)
      .sort();
    expect(routes).toEqual([
      'ANY /api/billing/reconcile/{invoiceId}',
      'ANY /billing/statements/{statementId}',
    ]);

    const statementRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.route === '/billing/statements/{statementId}'
    ));
    const statementHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'Statement'
      && symbol.path === 'Controllers/BillingController.cs'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingService'
      && symbol.path === 'Services/BillingService.cs'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'LoadStatement'
      && symbol.path === 'Services/BillingService.cs'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'LoadStatement'
      && symbol.path === 'Repositories/BillingRepository.cs'
    ));

    expect(statementRoute).toMatchObject({
      method: 'ANY',
      handler: 'BillingController#Statement',
      sourceRefs: expect.arrayContaining([
        'file:App_Start/RouteConfig.cs#L5',
        'file:App_Start/RouteConfig.cs#L7',
        'file:App_Start/RouteConfig.cs#L8',
      ]),
    });
    expect(statementHandler).toBeDefined();
    expect(service).toBeDefined();
    expect(serviceMethod).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${statementRoute?.id}`,
        to: `node_symbol_${statementHandler?.id}`,
        label: 'route handler BillingController#Statement',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${statementHandler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses BillingService',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${statementHandler?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls BillingService.LoadStatement',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingRepository.LoadStatement',
      }),
    ]));
  });

  test('detects ASP.NET Web Forms pages with Page_Load graph evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-webforms-page-'));
    await mkdir(join(root, 'Billing'), { recursive: true });
    await mkdir(join(root, 'Customers'), { recursive: true });

    await writeFile(
      join(root, 'Billing/Statement.aspx'),
      [
        '<%@ Page Language="C#" AutoEventWireup="true" CodeBehind="Statement.aspx.cs" Inherits="Acme.Legacy.Billing.StatementPage" %>',
        '<html><body>statement</body></html>',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'Billing/Statement.aspx.cs'),
      [
        'namespace Acme.Legacy.Billing;',
        '',
        'public partial class StatementPage : System.Web.UI.Page',
        '{',
        '  private readonly StatementService _statementService = new StatementService();',
        '',
        '  protected void Page_Load(object sender, EventArgs e)',
        '  {',
        '    _statementService.Generate(Request.QueryString["accountId"]);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'Billing/StatementService.cs'),
      [
        'namespace Acme.Legacy.Billing;',
        '',
        'public class StatementService',
        '{',
        '  private readonly StatementRepository _statementRepository = new StatementRepository();',
        '',
        '  public string Generate(string accountId)',
        '  {',
        '    return _statementRepository.LoadStatement(accountId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'Billing/StatementRepository.cs'),
      [
        'namespace Acme.Legacy.Billing;',
        '',
        'public class StatementRepository',
        '{',
        '  public string LoadStatement(string accountId)',
        '  {',
        '    return accountId;',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'Customers/Profile.aspx'),
      [
        '<%@ Page Language="C#" CodeBehind="Profile.aspx.cs" Inherits="Acme.Legacy.Customers.ProfilePage" %>',
        '<html><body>profile</body></html>',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'Customers/Profile.aspx.cs'),
      [
        'namespace Acme.Legacy.Customers;',
        '',
        'public partial class ProfilePage : System.Web.UI.Page',
        '{',
        '  protected void Page_Load(object sender, EventArgs e) {}',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_webforms_page',
      workflowRunId: 'run_webforms_page',
      repoRoot: root,
      generatedAt: '2026-07-02T05:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 32768,
        maxCapturedFiles: 20,
      },
    });

    const routes = inventory.entrypoints
      .filter((entrypoint) => entrypoint.kind === 'http_route')
      .map((entrypoint) => `${entrypoint.method} ${entrypoint.route}`)
      .sort();
    expect(routes).toEqual(expect.arrayContaining([
      'ANY /Billing/Statement.aspx',
      'ANY /Customers/Profile.aspx',
    ]));

    const statementRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.route === '/Billing/Statement.aspx'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'Page_Load'
      && symbol.path === 'Billing/Statement.aspx.cs'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'StatementService'
      && symbol.path === 'Billing/StatementService.cs'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'Generate'
      && symbol.path === 'Billing/StatementService.cs'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'LoadStatement'
      && symbol.path === 'Billing/StatementRepository.cs'
    ));

    expect(statementRoute).toMatchObject({
      method: 'ANY',
      handler: 'StatementPage#Page_Load',
      sourceRefs: ['file:Billing/Statement.aspx#L1'],
    });
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(serviceMethod).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${statementRoute?.id}`,
        to: `node_symbol_${handler?.id}`,
        label: 'route handler StatementPage#Page_Load',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses StatementService',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls StatementService.Generate',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls StatementRepository.LoadStatement',
      }),
    ]));

    const billingCapability = inventory.capabilities.find((capability) => capability.id === 'cap_api_billing');
    expect(billingCapability).toMatchObject({
      label: 'Billing API',
      entrypointRefs: [statementRoute?.id],
    });
  });

  test('detects legacy JSP pages as static page routes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-jsp-page-'));
    await mkdir(join(root, 'src/main/webapp/Billing'), { recursive: true });
    await mkdir(join(root, 'src/main/webapp/Customers'), { recursive: true });

    await writeFile(
      join(root, 'src/main/webapp/Billing/Statement.jsp'),
      [
        '<%@ page import="com.example.billing.BillingService" %>',
        '<%',
        '  BillingService service = new BillingService();',
        '  String statement = service.loadStatement(request.getParameter("statementId"));',
        '%>',
        '<html><body><%= statement %></body></html>',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/main/webapp/Customers/Profile.jsp'),
      [
        '<%@ page import="com.example.customers.CustomerService" %>',
        '<html><body>profile</body></html>',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_jsp_page',
      workflowRunId: 'run_jsp_page',
      repoRoot: root,
      generatedAt: '2026-07-02T06:30:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 10,
      },
    });

    const routes = inventory.entrypoints
      .filter((entrypoint) => entrypoint.kind === 'http_route')
      .map((entrypoint) => `${entrypoint.method} ${entrypoint.route}`)
      .sort();
    expect(routes).toEqual([
      'ANY /Billing/Statement.jsp',
      'ANY /Customers/Profile.jsp',
    ]);

    const statementRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.route === '/Billing/Statement.jsp'
    ));
    expect(statementRoute).toMatchObject({
      method: 'ANY',
      handler: 'src/main/webapp/Billing/Statement.jsp',
      sourceRefs: ['file:src/main/webapp/Billing/Statement.jsp#L1'],
    });
    expect(inventory.sourceChunks.some((chunk) => (
      chunk.path === 'src/main/webapp/Billing/Statement.jsp'
      && chunk.language === 'jsp'
      && chunk.entrypointRefs.includes(statementRoute?.id ?? '')
    ))).toBe(true);
  });

  test('detects Classic ASP pages as static page routes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-classic-asp-page-'));
    await mkdir(join(root, 'web/Billing'), { recursive: true });
    await mkdir(join(root, 'web/Customers'), { recursive: true });

    await writeFile(
      join(root, 'web/Billing/Statement.asp'),
      [
        '<%@ Language="VBScript" %>',
        '<%',
        'Set service = Server.CreateObject("Billing.StatementService")',
        'statement = service.LoadStatement(Request.QueryString("statementId"))',
        '%>',
        '<html><body><%= statement %></body></html>',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'web/Customers/Profile.asp'),
      [
        '<%@ Language="VBScript" %>',
        '<html><body>profile</body></html>',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_classic_asp_page',
      workflowRunId: 'run_classic_asp_page',
      repoRoot: root,
      generatedAt: '2026-07-02T09:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 10,
      },
    });

    const routes = inventory.entrypoints
      .filter((entrypoint) => entrypoint.kind === 'http_route')
      .map((entrypoint) => `${entrypoint.method} ${entrypoint.route}`)
      .sort();
    expect(routes).toEqual([
      'ANY /Billing/Statement.asp',
      'ANY /Customers/Profile.asp',
    ]);

    const statementRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.route === '/Billing/Statement.asp'
    ));
    expect(statementRoute).toMatchObject({
      method: 'ANY',
      handler: 'web/Billing/Statement.asp',
      sourceRefs: ['file:web/Billing/Statement.asp#L1'],
    });
    expect(inventory.sourceChunks.some((chunk) => (
      chunk.path === 'web/Billing/Statement.asp'
      && chunk.language === 'classic-asp'
      && chunk.entrypointRefs.includes(statementRoute?.id ?? '')
    ))).toBe(true);
    expect(inventory.symbolGraph.edges.some((edge) => edge.from === `node_entrypoint_${statementRoute?.id}`)).toBe(false);
  });

  test('detects ColdFusion pages as static page routes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-coldfusion-page-'));
    await mkdir(join(root, 'wwwroot/Billing'), { recursive: true });
    await mkdir(join(root, 'wwwroot/Customers'), { recursive: true });

    await writeFile(
      join(root, 'wwwroot/Billing/Statement.cfm'),
      [
        '<cfsetting showdebugoutput="false">',
        '<cfset service = createObject("component", "billing.StatementService")>',
        '<cfset statement = service.loadStatement(url.statementId)>',
        '<cfoutput>#statement#</cfoutput>',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'wwwroot/Customers/Profile.cfm'),
      [
        '<cfsetting showdebugoutput="false">',
        '<cfoutput>profile</cfoutput>',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_coldfusion_page',
      workflowRunId: 'run_coldfusion_page',
      repoRoot: root,
      generatedAt: '2026-07-02T10:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 10,
      },
    });

    const routes = inventory.entrypoints
      .filter((entrypoint) => entrypoint.kind === 'http_route')
      .map((entrypoint) => `${entrypoint.method} ${entrypoint.route}`)
      .sort();
    expect(routes).toEqual([
      'ANY /Billing/Statement.cfm',
      'ANY /Customers/Profile.cfm',
    ]);

    const statementRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.route === '/Billing/Statement.cfm'
    ));
    expect(statementRoute).toMatchObject({
      method: 'ANY',
      handler: 'wwwroot/Billing/Statement.cfm',
      sourceRefs: ['file:wwwroot/Billing/Statement.cfm#L1'],
    });
    expect(inventory.sourceChunks.some((chunk) => (
      chunk.path === 'wwwroot/Billing/Statement.cfm'
      && chunk.language === 'coldfusion'
      && chunk.entrypointRefs.includes(statementRoute?.id ?? '')
    ))).toBe(true);
    expect(inventory.symbolGraph.edges.some((edge) => edge.from === `node_entrypoint_${statementRoute?.id}`)).toBe(false);
  });

  test('detects WCF service contract operations and links implementation graph evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-wcf-'));
    await mkdir(join(root, 'src/Legacy/Billing'), { recursive: true });
    await mkdir(join(root, 'src/Legacy/Customers'), { recursive: true });
    await mkdir(join(root, 'src/Legacy/Ambiguous'), { recursive: true });
    await mkdir(join(root, 'Services'), { recursive: true });

    await writeFile(
      join(root, 'Services/BillingStatementService.svc'),
      '<%@ ServiceHost Language="C#" Service="Acme.Legacy.Billing.BillingStatementService, Acme.Legacy" %>\n',
      'utf8',
    );
    await writeFile(
      join(root, 'Services/DynamicBillingService.svc'),
      '<%@ ServiceHost Language="C#" Service="${ConfiguredBillingService}" %>\n',
      'utf8',
    );
    await writeFile(
      join(root, 'Services/AmbiguousBillingService.svc'),
      '<%@ ServiceHost Language="C#" Service="Acme.Legacy.Ambiguous.DuplicateBillingService" %>\n',
      'utf8',
    );
    await writeFile(
      join(root, 'src/Legacy/Billing/IBillingStatementContract.cs'),
      [
        'using System.ServiceModel;',
        '',
        'namespace Acme.Legacy.Billing;',
        '',
        '[ServiceContract(Name = "BillingStatementService")]',
        'public interface IBillingStatementContract',
        '{',
        '  [OperationContract(Name = "ReconcileInvoice")]',
        '  string ReconcileInvoice(string invoiceId);',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Legacy/Billing/BillingStatementService.cs'),
      [
        'namespace Acme.Legacy.Billing;',
        '',
        'public class BillingStatementService : IBillingStatementContract',
        '{',
        '  private readonly BillingStatementManager _manager = new BillingStatementManager();',
        '',
        '  public string ReconcileInvoice(string invoiceId)',
        '  {',
        '    return _manager.Reconcile(invoiceId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Legacy/Billing/BillingStatementManager.cs'),
      [
        'namespace Acme.Legacy.Billing;',
        '',
        'public class BillingStatementManager',
        '{',
        '  private readonly BillingStatementRepository _repository = new BillingStatementRepository();',
        '',
        '  public string Reconcile(string invoiceId)',
        '  {',
        '    return _repository.MarkReconciled(invoiceId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Legacy/Billing/BillingStatementRepository.cs'),
      [
        'namespace Acme.Legacy.Billing;',
        '',
        'public class BillingStatementRepository',
        '{',
        '  public string MarkReconciled(string invoiceId)',
        '  {',
        '    return invoiceId;',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Legacy/Ambiguous/DuplicateBillingService.cs'),
      [
        'namespace Acme.Legacy.Ambiguous;',
        '',
        'public class DuplicateBillingService',
        '{',
        '  public string Ping()',
        '  {',
        '    return "first";',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Legacy/Customers/DuplicateBillingService.cs'),
      [
        'namespace Acme.Legacy.Customers;',
        '',
        'public class DuplicateBillingService',
        '{',
        '  public string Ping()',
        '  {',
        '    return "second";',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Legacy/Customers/ICustomerProfileContract.cs'),
      [
        'using System.ServiceModel;',
        '',
        'namespace Acme.Legacy.Customers;',
        '',
        '[ServiceContract(Name = "CustomerProfileService")]',
        'public interface ICustomerProfileContract',
        '{',
        '  [OperationContract(Name = "LoadProfile")]',
        '  string LoadProfile(string customerId);',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Legacy/Customers/CustomerProfileService.cs'),
      [
        'namespace Acme.Legacy.Customers;',
        '',
        'public class CustomerProfileService : ICustomerProfileContract',
        '{',
        '  public string LoadProfile(string customerId)',
        '  {',
        '    return customerId;',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'Services/CustomerProfileService.svc'),
      '<%@ ServiceHost Language="C#" Service="Acme.Legacy.Customers.CustomerProfileService" %>\n',
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_wcf',
      workflowRunId: 'run_wcf',
      repoRoot: root,
      generatedAt: '2026-07-02T01:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 32768,
        maxCapturedFiles: 24,
      },
    });

    const routes = inventory.entrypoints
      .filter((entrypoint) => entrypoint.kind === 'http_route')
      .map((entrypoint) => `${entrypoint.method} ${entrypoint.route}`)
      .sort();
    expect(routes).toEqual(expect.arrayContaining([
      'ANY /Services/AmbiguousBillingService.svc',
      'ANY /Services/BillingStatementService.svc',
      'ANY /Services/CustomerProfileService.svc',
      'ANY /wcf/billing_statement_service/reconcile_invoice',
      'ANY /wcf/customer_profile_service/load_profile',
    ]));
    expect(routes).not.toContain('ANY /Services/DynamicBillingService.svc');

    const billingRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.route === '/wcf/billing_statement_service/reconcile_invoice'
    ));
    const customerRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.route === '/wcf/customer_profile_service/load_profile'
    ));
    const billingHostRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.route === '/Services/BillingStatementService.svc'
    ));
    const ambiguousHostRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.route === '/Services/AmbiguousBillingService.svc'
    ));
    const serviceClass = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingStatementService'
      && symbol.path === 'src/Legacy/Billing/BillingStatementService.cs'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'ReconcileInvoice'
      && symbol.path === 'src/Legacy/Billing/BillingStatementService.cs'
    ));
    const manager = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingStatementManager'
      && symbol.path === 'src/Legacy/Billing/BillingStatementManager.cs'
    ));
    const managerMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'Reconcile'
      && symbol.path === 'src/Legacy/Billing/BillingStatementManager.cs'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'MarkReconciled'
      && symbol.path === 'src/Legacy/Billing/BillingStatementRepository.cs'
    ));

    expect(billingRoute).toMatchObject({
      method: 'ANY',
      handler: 'BillingStatementService#ReconcileInvoice',
      sourceRefs: expect.arrayContaining([
        'file:src/Legacy/Billing/IBillingStatementContract.cs#L5',
        'file:src/Legacy/Billing/IBillingStatementContract.cs#L8',
        'file:src/Legacy/Billing/IBillingStatementContract.cs#L9',
        'file:src/Legacy/Billing/BillingStatementService.cs#L3',
        'file:src/Legacy/Billing/BillingStatementService.cs#L7',
      ]),
    });
    expect(customerRoute).toMatchObject({ handler: 'CustomerProfileService#LoadProfile' });
    expect(billingHostRoute).toMatchObject({
      method: 'ANY',
      handler: 'WCF:BillingStatementService',
      sourceRefs: ['file:Services/BillingStatementService.svc#L1'],
    });
    expect(ambiguousHostRoute).toMatchObject({
      method: 'ANY',
      handler: 'WCF:DuplicateBillingService',
      sourceRefs: ['file:Services/AmbiguousBillingService.svc#L1'],
    });
    expect(serviceClass).toBeDefined();
    expect(handler).toBeDefined();
    expect(manager).toBeDefined();
    expect(managerMethod).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${billingRoute?.id}`,
        to: `node_symbol_${handler?.id}`,
        label: 'route handler BillingStatementService#ReconcileInvoice',
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${billingHostRoute?.id}`,
        to: `node_symbol_${serviceClass?.id}`,
        label: 'route handler WCF:BillingStatementService',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${manager?.id}`,
        label: 'uses BillingStatementManager',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${managerMethod?.id}`,
        label: 'calls BillingStatementManager.Reconcile',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingStatementRepository.MarkReconciled',
      }),
    ]));
    expect(inventory.symbolGraph.edges.some((edge) => (
      edge.kind === 'route_handler'
      && edge.from === `node_entrypoint_${ambiguousHostRoute?.id}`
    ))).toBe(false);

    const billingCapability = inventory.capabilities.find((capability) => capability.id === 'cap_api_billing_statement_service');
    expect(billingCapability).toMatchObject({
      label: 'Billing Statement Service API',
      entrypointRefs: expect.arrayContaining([billingHostRoute?.id, billingRoute?.id]),
    });
    expect(inventory.capabilities.map((capability) => capability.label)).not.toContain('Wcf API');
    expect(inventory.sourceChunks.some((chunk) => (
      chunk.path === 'Services/BillingStatementService.svc'
      && chunk.language === null
      && chunk.entrypointRefs.includes(billingHostRoute?.id ?? '')
    ))).toBe(true);
  });

  test('detects static WCF endpoints from service model config without inferring dynamic or ambiguous services', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-wcf-config-'));
    await mkdir(join(root, 'src/Legacy/Billing'), { recursive: true });
    await mkdir(join(root, 'src/Legacy/Customers'), { recursive: true });
    await mkdir(join(root, 'src/Legacy/AmbiguousOne'), { recursive: true });
    await mkdir(join(root, 'src/Legacy/AmbiguousTwo'), { recursive: true });

    await writeFile(
      join(root, 'web.config'),
      [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<configuration>',
        '  <system.serviceModel>',
        '    <services>',
        '      <service name="Acme.Legacy.Billing.BillingStatementService">',
        '        <endpoint address="Services/BillingStatementService.svc" binding="basicHttpBinding" contract="Acme.Legacy.Billing.IBillingStatementContract" />',
        '        <endpoint address="${DynamicBillingAddress}" binding="basicHttpBinding" contract="Acme.Legacy.Billing.IBillingStatementContract" />',
        '      </service>',
        '      <service name="${ConfiguredService}">',
        '        <endpoint address="Services/DynamicService.svc" binding="basicHttpBinding" contract="Acme.Legacy.Billing.IBillingStatementContract" />',
        '      </service>',
        '      <service name="Acme.Legacy.Ambiguous.DuplicateBillingService">',
        '        <endpoint address="Services/AmbiguousBillingService.svc" binding="basicHttpBinding" contract="Acme.Legacy.Ambiguous.IAmbiguousBillingContract" />',
        '      </service>',
        '    </services>',
        '  </system.serviceModel>',
        '</configuration>',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Legacy/Billing/IBillingStatementContract.cs'),
      [
        'using System.ServiceModel;',
        '',
        'namespace Acme.Legacy.Billing;',
        '',
        '[ServiceContract(Name = "BillingStatementService")]',
        'public interface IBillingStatementContract',
        '{',
        '  [OperationContract(Name = "ReconcileInvoice")]',
        '  string ReconcileInvoice(string invoiceId);',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Legacy/Billing/BillingStatementService.cs'),
      [
        'namespace Acme.Legacy.Billing;',
        '',
        'public class BillingStatementService : IBillingStatementContract',
        '{',
        '  public string ReconcileInvoice(string invoiceId)',
        '  {',
        '    return invoiceId;',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Legacy/Customers/IBillingStatementContract.cs'),
      [
        'using System.ServiceModel;',
        '',
        'namespace Acme.Legacy.Customers;',
        '',
        '[ServiceContract(Name = "CustomerStatementService")]',
        'public interface IBillingStatementContract',
        '{',
        '  [OperationContract(Name = "LoadCustomerStatement")]',
        '  string LoadCustomerStatement(string customerId);',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Legacy/AmbiguousOne/IAmbiguousBillingContract.cs'),
      [
        'using System.ServiceModel;',
        '',
        'namespace Acme.Legacy.Ambiguous;',
        '',
        '[ServiceContract(Name = "AmbiguousBillingService")]',
        'public interface IAmbiguousBillingContract',
        '{',
        '  [OperationContract(Name = "Ping")]',
        '  string Ping();',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Legacy/AmbiguousOne/DuplicateBillingService.cs'),
      [
        'namespace Acme.Legacy.AmbiguousOne;',
        '',
        'public class DuplicateBillingService : IAmbiguousBillingContract',
        '{',
        '  public string Ping()',
        '  {',
        '    return "one";',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Legacy/AmbiguousTwo/DuplicateBillingService.cs'),
      [
        'namespace Acme.Legacy.AmbiguousTwo;',
        '',
        'public class DuplicateBillingService : IAmbiguousBillingContract',
        '{',
        '  public string Ping()',
        '  {',
        '    return "two";',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_wcf_config',
      workflowRunId: 'run_wcf_config',
      repoRoot: root,
      generatedAt: '2026-07-04T01:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 32768,
        maxCapturedFiles: 12,
      },
    });

    const routes = inventory.entrypoints
      .filter((entrypoint) => entrypoint.kind === 'http_route')
      .map((entrypoint) => `${entrypoint.method} ${entrypoint.route}`)
      .sort();
    expect(routes).toEqual(expect.arrayContaining([
      'ANY /Services/AmbiguousBillingService.svc',
      'ANY /Services/BillingStatementService.svc',
      'ANY /wcf/ambiguous_billing_service/ping',
      'ANY /wcf/billing_statement_service/reconcile_invoice',
    ]));
    expect(inventory.entrypoints.some((entrypoint) => (
      entrypoint.path === 'web.config'
      && entrypoint.route === '/wcf/customer_statement_service/load_customer_statement'
    ))).toBe(false);
    expect(inventory.entrypoints.some((entrypoint) => (
      entrypoint.path === 'web.config'
      && entrypoint.sourceRefs.some((ref) => ref === 'file:web.config#L7' || ref === 'file:web.config#L9' || ref === 'file:web.config#L10')
    ))).toBe(false);
    expect(routes).not.toContain('ANY /Services/DynamicService.svc');

    const billingEndpointRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.path === 'web.config'
      && entrypoint.route === '/Services/BillingStatementService.svc'
    ));
    const billingOperationRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.path === 'web.config'
      && entrypoint.route === '/wcf/billing_statement_service/reconcile_invoice'
    ));
    const ambiguousOperationRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.path === 'web.config'
      && entrypoint.route === '/wcf/ambiguous_billing_service/ping'
    ));
    const billingServiceClass = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingStatementService'
      && symbol.path === 'src/Legacy/Billing/BillingStatementService.cs'
    ));
    const billingHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'ReconcileInvoice'
      && symbol.path === 'src/Legacy/Billing/BillingStatementService.cs'
    ));
    const ambiguousContractMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'Ping'
      && symbol.path === 'src/Legacy/AmbiguousOne/IAmbiguousBillingContract.cs'
    ));
    const duplicateServiceClasses = inventory.symbols.filter((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'DuplicateBillingService'
    ));

    expect(billingEndpointRoute).toMatchObject({
      method: 'ANY',
      handler: 'WCF:BillingStatementService',
      sourceRefs: ['file:web.config#L5', 'file:web.config#L6'],
    });
    expect(billingOperationRoute).toMatchObject({
      method: 'ANY',
      handler: 'BillingStatementService#ReconcileInvoice',
      sourceRefs: expect.arrayContaining([
        'file:web.config#L5',
        'file:web.config#L6',
        'file:src/Legacy/Billing/IBillingStatementContract.cs#L5',
        'file:src/Legacy/Billing/IBillingStatementContract.cs#L8',
        'file:src/Legacy/Billing/IBillingStatementContract.cs#L9',
        'file:src/Legacy/Billing/BillingStatementService.cs#L3',
        'file:src/Legacy/Billing/BillingStatementService.cs#L5',
      ]),
    });
    expect(ambiguousOperationRoute).toMatchObject({
      method: 'ANY',
      handler: 'IAmbiguousBillingContract#Ping',
      sourceRefs: expect.arrayContaining([
        'file:web.config#L12',
        'file:web.config#L13',
        'file:src/Legacy/AmbiguousOne/IAmbiguousBillingContract.cs#L5',
        'file:src/Legacy/AmbiguousOne/IAmbiguousBillingContract.cs#L8',
        'file:src/Legacy/AmbiguousOne/IAmbiguousBillingContract.cs#L9',
      ]),
    });
    expect(duplicateServiceClasses).toHaveLength(2);
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${billingEndpointRoute?.id}`,
        to: `node_symbol_${billingServiceClass?.id}`,
        label: 'route handler WCF:BillingStatementService',
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${billingOperationRoute?.id}`,
        to: `node_symbol_${billingHandler?.id}`,
        label: 'route handler BillingStatementService#ReconcileInvoice',
        sourceRefs: expect.arrayContaining([
          'file:web.config#L5',
          'file:web.config#L6',
          'file:src/Legacy/Billing/IBillingStatementContract.cs#L5',
          'file:src/Legacy/Billing/IBillingStatementContract.cs#L8',
          'file:src/Legacy/Billing/IBillingStatementContract.cs#L9',
          'file:src/Legacy/Billing/BillingStatementService.cs#L3',
          'file:src/Legacy/Billing/BillingStatementService.cs#L5',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${ambiguousOperationRoute?.id}`,
        to: `node_symbol_${ambiguousContractMethod?.id}`,
        label: 'route handler IAmbiguousBillingContract#Ping',
      }),
    ]));
    for (const duplicateServiceClass of duplicateServiceClasses) {
      expect(inventory.symbolGraph.edges.some((edge) => (
        edge.kind === 'route_handler'
        && edge.from === `node_entrypoint_${ambiguousOperationRoute?.id}`
        && edge.to === `node_symbol_${duplicateServiceClass.id}`
      ))).toBe(false);
    }
    expect(inventory.sourceChunks.some((chunk) => chunk.path === 'web.config')).toBe(false);
  });

  test('detects ASMX WebService operations with graph evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-asmx-'));
    await mkdir(join(root, 'src/Legacy/Billing'), { recursive: true });
    await mkdir(join(root, 'src/Legacy/Customers'), { recursive: true });

    await writeFile(
      join(root, 'src/Legacy/Billing/BillingStatementService.cs'),
      [
        'using System.Web.Services;',
        '',
        'namespace Acme.Legacy.Billing;',
        '',
        '[WebService(Name = "BillingStatementService", Namespace = "http://legacy.example/billing")]',
        'public class BillingStatementService : WebService',
        '{',
        '  private readonly BillingStatementManager _manager = new BillingStatementManager();',
        '',
        '  [WebMethod(MessageName = "ReconcileInvoice")]',
        '  public string ReconcileInvoice(string invoiceId)',
        '  {',
        '    return _manager.Reconcile(invoiceId);',
        '  }',
        '',
        '  public void InternalWarmup() {}',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Legacy/Billing/BillingStatementManager.cs'),
      [
        'namespace Acme.Legacy.Billing;',
        '',
        'public class BillingStatementManager',
        '{',
        '  private readonly BillingStatementRepository _repository = new BillingStatementRepository();',
        '',
        '  public string Reconcile(string invoiceId)',
        '  {',
        '    return _repository.MarkReconciled(invoiceId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Legacy/Billing/BillingStatementRepository.cs'),
      [
        'namespace Acme.Legacy.Billing;',
        '',
        'public class BillingStatementRepository',
        '{',
        '  public string MarkReconciled(string invoiceId)',
        '  {',
        '    return invoiceId;',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Legacy/Customers/CustomerProfileService.cs'),
      [
        'using System.Web.Services;',
        '',
        'namespace Acme.Legacy.Customers;',
        '',
        '[WebService(Name = "CustomerProfileService")]',
        'public class CustomerProfileService : WebService',
        '{',
        '  [WebMethod(MessageName = "LoadProfile")]',
        '  public string LoadProfile(string customerId)',
        '  {',
        '    return customerId;',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_asmx',
      workflowRunId: 'run_asmx',
      repoRoot: root,
      generatedAt: '2026-07-02T02:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 32768,
        maxCapturedFiles: 20,
      },
    });

    const routes = inventory.entrypoints
      .filter((entrypoint) => entrypoint.kind === 'http_route')
      .map((entrypoint) => `${entrypoint.method} ${entrypoint.route}`)
      .sort();
    expect(routes).toEqual(expect.arrayContaining([
      'ANY /asmx/billing_statement_service/reconcile_invoice',
      'ANY /asmx/customer_profile_service/load_profile',
    ]));
    expect(routes).not.toContain('ANY /asmx/billing_statement_service/internal_warmup');

    const billingRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.route === '/asmx/billing_statement_service/reconcile_invoice'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'ReconcileInvoice'
      && symbol.path === 'src/Legacy/Billing/BillingStatementService.cs'
    ));
    const manager = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingStatementManager'
      && symbol.path === 'src/Legacy/Billing/BillingStatementManager.cs'
    ));
    const managerMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'Reconcile'
      && symbol.path === 'src/Legacy/Billing/BillingStatementManager.cs'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'MarkReconciled'
      && symbol.path === 'src/Legacy/Billing/BillingStatementRepository.cs'
    ));

    expect(billingRoute).toMatchObject({
      method: 'ANY',
      handler: 'BillingStatementService#ReconcileInvoice',
      sourceRefs: expect.arrayContaining([
        'file:src/Legacy/Billing/BillingStatementService.cs#L5',
        'file:src/Legacy/Billing/BillingStatementService.cs#L10',
        'file:src/Legacy/Billing/BillingStatementService.cs#L11',
      ]),
    });
    expect(handler).toBeDefined();
    expect(manager).toBeDefined();
    expect(managerMethod).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${billingRoute?.id}`,
        to: `node_symbol_${handler?.id}`,
        label: 'route handler BillingStatementService#ReconcileInvoice',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${manager?.id}`,
        label: 'uses BillingStatementManager',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${managerMethod?.id}`,
        label: 'calls BillingStatementManager.Reconcile',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingStatementRepository.MarkReconciled',
      }),
    ]));

    const billingCapability = inventory.capabilities.find((capability) => capability.id === 'cap_api_billing_statement_service');
    expect(billingCapability).toMatchObject({
      label: 'Billing Statement Service API',
      entrypointRefs: [billingRoute?.id],
    });
    expect(inventory.capabilities.map((capability) => capability.label)).not.toContain('Asmx API');
  });

  test('links Go route handlers to constructed service and repository methods', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-go-service-graph-'));
    await mkdir(join(root, 'aaa_shadow/billing'), { recursive: true });
    await mkdir(join(root, 'cmd/server'), { recursive: true });
    await mkdir(join(root, 'internal/billing'), { recursive: true });

    await writeFile(
      join(root, 'aaa_shadow/billing/service.go'),
      [
        'package billing',
        '',
        'type BillingService struct {}',
        '',
        'func (s *BillingService) ReconcileInvoice(invoiceID string) string {',
        '  return "wrong service"',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'cmd/server/routes.go'),
      [
        'package main',
        '',
        'import billing "legacy/internal/billing"',
        '',
        'func RegisterRoutes() {',
        '  http.HandleFunc("/api/v1/billing/reconcile", reconcileInvoice)',
        '}',
        '',
        'func reconcileInvoice() {',
        '  service := billing.NewBillingService()',
        '  service.ReconcileInvoice("inv_1")',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'internal/billing/service.go'),
      [
        'package billing',
        '',
        'type BillingService struct {}',
        '',
        'func NewBillingService() *BillingService { return &BillingService{} }',
        '',
        'func (s *BillingService) ReconcileInvoice(invoiceID string) string {',
        '  repo := &BillingRepository{}',
        '  return repo.MarkReconciled(invoiceID)',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'internal/billing/repository.go'),
      [
        'package billing',
        '',
        'type BillingRepository struct {}',
        '',
        'func (r *BillingRepository) MarkReconciled(invoiceID string) string {',
        '  return invoiceID',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_go_service_graph',
      workflowRunId: 'run_go_service_graph',
      repoRoot: root,
      generatedAt: '2026-07-02T03:30:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 10,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/v1/billing/reconcile'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'reconcileInvoice'
      && symbol.path === 'cmd/server/routes.go'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'type'
      && symbol.name === 'BillingService'
      && symbol.path === 'internal/billing/service.go'
    ));
    const shadowService = inventory.symbols.find((symbol) => (
      symbol.kind === 'type'
      && symbol.name === 'BillingService'
      && symbol.path === 'aaa_shadow/billing/service.go'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'ReconcileInvoice'
      && symbol.path === 'internal/billing/service.go'
    ));
    const repository = inventory.symbols.find((symbol) => (
      symbol.kind === 'type'
      && symbol.name === 'BillingRepository'
      && symbol.path === 'internal/billing/repository.go'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'MarkReconciled'
      && symbol.path === 'internal/billing/repository.go'
    ));

    expect(route).toMatchObject({ handler: 'reconcileInvoice' });
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(shadowService).toBeDefined();
    expect(serviceMethod).toBeDefined();
    expect(repository).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses billing.BillingService',
        sourceRefs: expect.arrayContaining([
          'file:cmd/server/routes.go#L3',
          'file:cmd/server/routes.go#L10',
          'file:cmd/server/routes.go#L11',
          'file:internal/billing/service.go#L3',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls billing.BillingService.ReconcileInvoice',
        sourceRefs: expect.arrayContaining([
          'file:cmd/server/routes.go#L3',
          'file:cmd/server/routes.go#L10',
          'file:cmd/server/routes.go#L11',
          'file:internal/billing/service.go#L3',
          'file:internal/billing/service.go#L7',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repository?.id}`,
        label: 'uses BillingRepository',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingRepository.MarkReconciled',
        sourceRefs: expect.arrayContaining([
          'file:internal/billing/service.go#L8',
          'file:internal/billing/service.go#L9',
          'file:internal/billing/repository.go#L3',
          'file:internal/billing/repository.go#L5',
        ]),
      }),
    ]));
    expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${shadowService?.id}`,
      }),
    ]));
  });

  test('links Go constructor-injected handler fields to workflow and repository methods', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-go-constructor-injected-fields-'));
    await mkdir(join(root, 'aaa_shadow/billing'), { recursive: true });
    await mkdir(join(root, 'cmd/server'), { recursive: true });
    await mkdir(join(root, 'internal/billing'), { recursive: true });

    await writeFile(
      join(root, 'aaa_shadow/billing/workflow.go'),
      [
        'package billing',
        '',
        'type BillingWorkflow struct {}',
        '',
        'func (w *BillingWorkflow) ApproveRefund(refundID string) string {',
        '  return "wrong workflow"',
        '}',
        '',
        'type BillingHandler struct {',
        '  Workflow *BillingWorkflow',
        '}',
        '',
        'func (h *BillingHandler) Approve() string {',
        '  return h.Workflow.ApproveRefund("shadow")',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'cmd/server/routes.go'),
      [
        'package main',
        '',
        'import (',
        '  "net/http"',
        '  billing "legacy/internal/billing"',
        ')',
        '',
        'func RegisterRoutes() {',
        '  handler := billing.NewBillingHandler(billing.NewBillingWorkflow(billing.NewBillingRepository()))',
        '  http.HandleFunc("/api/v1/billing/refunds/approve", handler.Approve)',
        '  dynamic := billing.NewDynamicBillingHandler(billing.NewBillingWorkflow(billing.NewBillingRepository()))',
        '  http.HandleFunc("/api/v1/billing/refunds/dynamic", dynamic.Dynamic)',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'internal/billing/handler.go'),
      [
        'package billing',
        '',
        'type BillingHandler struct {',
        '  Workflow *BillingWorkflow',
        '}',
        '',
        'func NewBillingHandler(workflow *BillingWorkflow) *BillingHandler {',
        '  return &BillingHandler{Workflow: workflow}',
        '}',
        '',
        'func (h *BillingHandler) Approve() string {',
        '  return h.Workflow.ApproveRefund("refund_1")',
        '}',
        '',
        'type DynamicBillingHandler struct {',
        '  workflow any',
        '}',
        '',
        'func NewDynamicBillingHandler(workflow any) *DynamicBillingHandler {',
        '  return &DynamicBillingHandler{workflow: workflow}',
        '}',
        '',
        'func (h *DynamicBillingHandler) Dynamic() string {',
        '  return h.workflow.ApproveRefund("refund_2")',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'internal/billing/workflow.go'),
      [
        'package billing',
        '',
        'type BillingWorkflow struct {',
        '  repository *BillingRepository',
        '}',
        '',
        'func NewBillingWorkflow(repository *BillingRepository) *BillingWorkflow {',
        '  return &BillingWorkflow{repository: repository}',
        '}',
        '',
        'func (w *BillingWorkflow) ApproveRefund(refundID string) string {',
        '  return w.repository.SaveApproval(refundID)',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'internal/billing/repository.go'),
      [
        'package billing',
        '',
        'type BillingRepository struct {}',
        '',
        'func NewBillingRepository() *BillingRepository { return &BillingRepository{} }',
        '',
        'func (r *BillingRepository) SaveApproval(refundID string) string {',
        '  return refundID',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_go_constructor_injected_fields',
      workflowRunId: 'run_go_constructor_injected_fields',
      repoRoot: root,
      generatedAt: '2026-07-04T10:15:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 10,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/v1/billing/refunds/approve'
    ));
    const dynamicRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/v1/billing/refunds/dynamic'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'Approve'
      && symbol.path === 'internal/billing/handler.go'
    ));
    const dynamicHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'Dynamic'
      && symbol.path === 'internal/billing/handler.go'
    ));
    const shadowHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'Approve'
      && symbol.path === 'aaa_shadow/billing/workflow.go'
    ));
    const workflow = inventory.symbols.find((symbol) => (
      symbol.kind === 'type'
      && symbol.name === 'BillingWorkflow'
      && symbol.path === 'internal/billing/workflow.go'
    ));
    const shadowWorkflow = inventory.symbols.find((symbol) => (
      symbol.kind === 'type'
      && symbol.name === 'BillingWorkflow'
      && symbol.path === 'aaa_shadow/billing/workflow.go'
    ));
    const workflowMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'ApproveRefund'
      && symbol.path === 'internal/billing/workflow.go'
    ));
    const repository = inventory.symbols.find((symbol) => (
      symbol.kind === 'type'
      && symbol.name === 'BillingRepository'
      && symbol.path === 'internal/billing/repository.go'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'SaveApproval'
      && symbol.path === 'internal/billing/repository.go'
    ));

    expect(route).toMatchObject({ handler: 'handler.Approve' });
    expect(dynamicRoute).toMatchObject({ handler: 'dynamic.Dynamic' });
    expect(handler).toBeDefined();
    expect(dynamicHandler).toBeDefined();
    expect(shadowHandler).toBeDefined();
    expect(workflow).toBeDefined();
    expect(shadowWorkflow).toBeDefined();
    expect(workflowMethod).toBeDefined();
    expect(repository).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
        label: 'route handler handler.Approve',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${workflow?.id}`,
        label: 'uses BillingWorkflow',
        sourceRefs: expect.arrayContaining([
          'file:internal/billing/handler.go#L7',
          'file:internal/billing/handler.go#L8',
          'file:internal/billing/handler.go#L12',
          'file:internal/billing/workflow.go#L3',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${workflowMethod?.id}`,
        label: 'calls BillingWorkflow.ApproveRefund',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${workflowMethod?.id}`,
        to: `node_symbol_${repository?.id}`,
        label: 'uses BillingRepository',
        sourceRefs: expect.arrayContaining([
          'file:internal/billing/workflow.go#L7',
          'file:internal/billing/workflow.go#L8',
          'file:internal/billing/workflow.go#L12',
          'file:internal/billing/repository.go#L3',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${workflowMethod?.id}`,
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingRepository.SaveApproval',
      }),
    ]));
    expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${shadowWorkflow?.id}`,
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${dynamicHandler?.id}`,
        to: `node_symbol_${workflow?.id}`,
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${dynamicHandler?.id}`,
        to: `node_symbol_${workflowMethod?.id}`,
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${shadowHandler?.id}`,
        to: `node_symbol_${workflow?.id}`,
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${shadowHandler?.id}`,
        to: `node_symbol_${workflowMethod?.id}`,
      }),
    ]));
  });

  test('detects static Laravel apiResource controller routes inside prefix groups', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-laravel-resource-routes-'));
    await mkdir(join(root, 'app/Http/Controllers'), { recursive: true });
    await mkdir(join(root, 'routes'), { recursive: true });

    await writeFile(
      join(root, 'routes/web.php'),
      [
        '<?php',
        "Route::prefix('/api/v1')->group(function () {",
        "  Route::apiResource('customers', CustomerController::class)->only(['index', 'show']);",
        '});',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/Http/Controllers/CustomerController.php'),
      [
        '<?php',
        'class CustomerController extends Controller',
        '{',
        '  public function index() {',
        '    return response()->json([]);',
        '  }',
        '',
        '  public function show($customer) {',
        '    return response()->json($customer);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_laravel_resource_routes',
      workflowRunId: 'run_laravel_resource_routes',
      repoRoot: root,
      generatedAt: '2026-07-02T03:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 10,
      },
    });

    const indexRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/v1/customers'
    ));
    const showRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/v1/customers/{customer}'
    ));
    const storeRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v1/customers'
    ));
    const indexSymbol = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'index'
      && symbol.path === 'app/Http/Controllers/CustomerController.php'
    ));
    const showSymbol = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'show'
      && symbol.path === 'app/Http/Controllers/CustomerController.php'
    ));

    expect(indexRoute).toMatchObject({
      handler: 'CustomerController@index',
      sourceRefs: expect.arrayContaining([
        'file:routes/web.php#L2',
        'file:routes/web.php#L3',
      ]),
    });
    expect(showRoute).toMatchObject({
      handler: 'CustomerController@show',
      sourceRefs: expect.arrayContaining([
        'file:routes/web.php#L2',
        'file:routes/web.php#L3',
      ]),
    });
    expect(storeRoute).toBeUndefined();
    expect(indexSymbol).toBeDefined();
    expect(showSymbol).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${indexRoute?.id}`,
        to: `node_symbol_${indexSymbol?.id}`,
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${showRoute?.id}`,
        to: `node_symbol_${showSymbol?.id}`,
      }),
    ]));
    expect(inventory.capabilities.find((capability) => capability.id === 'cap_api_customers')).toMatchObject({
      label: 'Customers API',
    });
  });

  test('links Laravel controller actions to constructed service and repository methods', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-laravel-service-graph-'));
    await mkdir(join(root, 'aaa_shadow/Services'), { recursive: true });
    await mkdir(join(root, 'app/Http/Controllers'), { recursive: true });
    await mkdir(join(root, 'app/Services'), { recursive: true });
    await mkdir(join(root, 'app/Repositories'), { recursive: true });
    await mkdir(join(root, 'routes'), { recursive: true });

    await writeFile(
      join(root, 'routes/web.php'),
      [
        '<?php',
        "Route::post('/api/v1/billing/invoices/{invoice}/reconcile', [BillingController::class, 'reconcileInvoice']);",
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'aaa_shadow/Services/BillingService.php'),
      [
        '<?php',
        'class BillingService',
        '{',
        '  public function reconcile($invoice) {',
        "    return 'wrong service';",
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/Http/Controllers/BillingController.php'),
      [
        '<?php',
        'class BillingController extends Controller',
        '{',
        '  public function reconcileInvoice($invoice) {',
        '    $service = new \\App\\Services\\BillingService();',
        '    return response()->json($service->reconcile($invoice));',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/Services/BillingService.php'),
      [
        '<?php',
        'namespace App\\Services;',
        'use App\\Repositories\\{',
        '  BillingRepository as BillingRepo',
        '};',
        'class BillingService',
        '{',
        '  public function reconcile($invoice) {',
        '    $repository = new BillingRepo();',
        '    return $repository->markReconciled($invoice);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/Repositories/BillingRepository.php'),
      [
        '<?php',
        'namespace App\\Repositories;',
        'class BillingRepository',
        '{',
        '  public function markReconciled($invoice) {',
        '    return $invoice;',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_laravel_service_graph',
      workflowRunId: 'run_laravel_service_graph',
      repoRoot: root,
      generatedAt: '2026-07-01T04:20:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 10,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v1/billing/invoices/{invoice}/reconcile'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'reconcileInvoice'
      && symbol.path === 'app/Http/Controllers/BillingController.php'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingService'
      && symbol.path === 'app/Services/BillingService.php'
    ));
    const shadowService = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingService'
      && symbol.path === 'aaa_shadow/Services/BillingService.php'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'reconcile'
      && symbol.path === 'app/Services/BillingService.php'
    ));
    const repository = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingRepository'
      && symbol.path === 'app/Repositories/BillingRepository.php'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'markReconciled'
      && symbol.path === 'app/Repositories/BillingRepository.php'
    ));

    expect(route).toBeDefined();
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(shadowService).toBeDefined();
    expect(serviceMethod).toBeDefined();
    expect(repository).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses BillingService',
        sourceRefs: expect.arrayContaining([
          'file:app/Http/Controllers/BillingController.php#L5',
          'file:app/Http/Controllers/BillingController.php#L6',
          'file:app/Services/BillingService.php#L6',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls BillingService.reconcile',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repository?.id}`,
        label: 'uses BillingRepository',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingRepository.markReconciled',
      }),
    ]));
    expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${shadowService?.id}`,
      }),
    ]));
  });

  test('links Laravel controller-group string actions to controller methods', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-laravel-controller-group-'));
    await mkdir(join(root, 'app/Http/Controllers'), { recursive: true });
    await mkdir(join(root, 'app/Services'), { recursive: true });
    await mkdir(join(root, 'app/Repositories'), { recursive: true });
    await mkdir(join(root, 'routes'), { recursive: true });

    await writeFile(
      join(root, 'routes/web.php'),
      [
        '<?php',
        "Route::controller(BillingController::class)->prefix('/api/v1/billing')->group(function () {",
        "  Route::post('refunds/{refund}/approve', 'approveRefund');",
        '});',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/Http/Controllers/BillingController.php'),
      [
        '<?php',
        'class BillingController extends Controller',
        '{',
        '  public function approveRefund($refund) {',
        '    $service = new \\App\\Services\\BillingService();',
        '    return response()->json($service->approveRefund($refund));',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/Services/BillingService.php'),
      [
        '<?php',
        'namespace App\\Services;',
        'use App\\Repositories\\BillingRepository;',
        'class BillingService',
        '{',
        '  public function approveRefund($refund) {',
        '    $repository = new BillingRepository();',
        '    return $repository->approveRefund($refund);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/Repositories/BillingRepository.php'),
      [
        '<?php',
        'namespace App\\Repositories;',
        'class BillingRepository',
        '{',
        '  public function approveRefund($refund) {',
        '    return $refund;',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_laravel_controller_group',
      workflowRunId: 'run_laravel_controller_group',
      repoRoot: root,
      generatedAt: '2026-07-03T15:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 10,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v1/billing/refunds/{refund}/approve'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'approveRefund'
      && symbol.path === 'app/Http/Controllers/BillingController.php'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingService'
      && symbol.path === 'app/Services/BillingService.php'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'approveRefund'
      && symbol.path === 'app/Services/BillingService.php'
    ));
    const repository = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingRepository'
      && symbol.path === 'app/Repositories/BillingRepository.php'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'approveRefund'
      && symbol.path === 'app/Repositories/BillingRepository.php'
    ));

    expect(route).toMatchObject({
      handler: 'BillingController@approveRefund',
      sourceRefs: expect.arrayContaining([
        'file:routes/web.php#L2',
        'file:routes/web.php#L3',
      ]),
    });
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(serviceMethod).toBeDefined();
    expect(repository).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
        label: 'route handler BillingController@approveRefund',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses BillingService',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls BillingService.approveRefund',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repository?.id}`,
        label: 'uses BillingRepository',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingRepository.approveRefund',
      }),
    ]));
  });

  test('links Laravel service-locator class literals to service and repository methods', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-laravel-service-locator-'));
    await mkdir(join(root, 'app/Http/Controllers'), { recursive: true });
    await mkdir(join(root, 'app/Services'), { recursive: true });
    await mkdir(join(root, 'app/Repositories'), { recursive: true });
    await mkdir(join(root, 'routes'), { recursive: true });

    await writeFile(
      join(root, 'routes/web.php'),
      [
        '<?php',
        "Route::post('/api/v1/billing/payments/{payment}/settle', [BillingController::class, 'settlePayment']);",
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/Http/Controllers/BillingController.php'),
      [
        '<?php',
        'class BillingController extends Controller',
        '{',
        '  public function settlePayment($payment) {',
        '    $service = app(\\App\\Services\\BillingService::class);',
        '    return response()->json($service->settle($payment));',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/Services/BillingService.php'),
      [
        '<?php',
        'namespace App\\Services;',
        'use App\\Repositories\\{',
        '  BillingRepository as BillingRepo',
        '};',
        'class BillingService',
        '{',
        '  public function settle($payment) {',
        '    $repository = \\App::make(BillingRepo::class);',
        '    return $repository->settlePayment($payment);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/Repositories/BillingRepository.php'),
      [
        '<?php',
        'namespace App\\Repositories;',
        'class BillingRepository',
        '{',
        '  public function settlePayment($payment) {',
        '    return $payment;',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_laravel_service_locator',
      workflowRunId: 'run_laravel_service_locator',
      repoRoot: root,
      generatedAt: '2026-07-03T08:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 10,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v1/billing/payments/{payment}/settle'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'settlePayment'
      && symbol.path === 'app/Http/Controllers/BillingController.php'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingService'
      && symbol.path === 'app/Services/BillingService.php'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'settle'
      && symbol.path === 'app/Services/BillingService.php'
    ));
    const repository = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingRepository'
      && symbol.path === 'app/Repositories/BillingRepository.php'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'settlePayment'
      && symbol.path === 'app/Repositories/BillingRepository.php'
    ));

    expect(route).toBeDefined();
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(serviceMethod).toBeDefined();
    expect(repository).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses BillingService',
        sourceRefs: expect.arrayContaining([
          'file:app/Http/Controllers/BillingController.php#L5',
          'file:app/Http/Controllers/BillingController.php#L6',
          'file:app/Services/BillingService.php#L6',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls BillingService.settle',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repository?.id}`,
        label: 'uses BillingRepository',
        sourceRefs: expect.arrayContaining([
          'file:app/Services/BillingService.php#L3',
          'file:app/Services/BillingService.php#L9',
          'file:app/Services/BillingService.php#L10',
          'file:app/Repositories/BillingRepository.php#L3',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingRepository.settlePayment',
      }),
    ]));
  });

  test('links Laravel constructor-injected interface fields to unique implementation methods', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-laravel-interface-injection-'));
    await mkdir(join(root, 'aaa_shadow/Services'), { recursive: true });
    await mkdir(join(root, 'app/Contracts'), { recursive: true });
    await mkdir(join(root, 'app/Http/Controllers'), { recursive: true });
    await mkdir(join(root, 'app/Repositories'), { recursive: true });
    await mkdir(join(root, 'app/Services'), { recursive: true });
    await mkdir(join(root, 'routes'), { recursive: true });

    await writeFile(
      join(root, 'routes/web.php'),
      [
        '<?php',
        "Route::post('/api/v1/billing/{id}/approve', [BillingController::class, 'approve']);",
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'aaa_shadow/Services/DatabaseBillingWorkflow.php'),
      [
        '<?php',
        'class DatabaseBillingWorkflow',
        '{',
        '  public function approve($id) {',
        "    return 'wrong workflow';",
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/Http/Controllers/BillingController.php'),
      [
        '<?php',
        'use App\\Contracts\\BillingWorkflow;',
        'class BillingController extends Controller',
        '{',
        '  private $workflow;',
        '',
        '  public function __construct(BillingWorkflow $workflow) {',
        '    $this->workflow = $workflow;',
        '  }',
        '',
        '  public function approve($id) {',
        '    return response()->json($this->workflow->approve($id));',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/Contracts/BillingWorkflow.php'),
      [
        '<?php',
        'namespace App\\Contracts;',
        'interface BillingWorkflow',
        '{',
        '  public function approve($id);',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/Services/DatabaseBillingWorkflow.php'),
      [
        '<?php',
        'namespace App\\Services;',
        'use App\\Contracts\\BillingWorkflow;',
        'use App\\Repositories\\BillingRepository;',
        'class DatabaseBillingWorkflow implements BillingWorkflow',
        '{',
        '  public function approve($id) {',
        '    $repository = new BillingRepository();',
        '    return $repository->approve($id);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/Repositories/BillingRepository.php'),
      [
        '<?php',
        'namespace App\\Repositories;',
        'class BillingRepository',
        '{',
        '  public function approve($id) {',
        '    return $id;',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_laravel_interface_injection',
      workflowRunId: 'run_laravel_interface_injection',
      repoRoot: root,
      generatedAt: '2026-07-03T16:40:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 12288,
        maxCapturedFiles: 10,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v1/billing/{id}/approve'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'approve'
      && symbol.path === 'app/Http/Controllers/BillingController.php'
    ));
    const workflow = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'DatabaseBillingWorkflow'
      && symbol.path === 'app/Services/DatabaseBillingWorkflow.php'
    ));
    const shadowWorkflow = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'DatabaseBillingWorkflow'
      && symbol.path === 'aaa_shadow/Services/DatabaseBillingWorkflow.php'
    ));
    const workflowMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'approve'
      && symbol.path === 'app/Services/DatabaseBillingWorkflow.php'
    ));
    const repository = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingRepository'
      && symbol.path === 'app/Repositories/BillingRepository.php'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'approve'
      && symbol.path === 'app/Repositories/BillingRepository.php'
    ));

    expect(route).toBeDefined();
    expect(handler).toBeDefined();
    expect(workflow).toBeDefined();
    expect(shadowWorkflow).toBeDefined();
    expect(workflowMethod).toBeDefined();
    expect(repository).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${workflow?.id}`,
        label: 'uses DatabaseBillingWorkflow',
        sourceRefs: expect.arrayContaining([
          'file:app/Http/Controllers/BillingController.php#L7',
          'file:app/Http/Controllers/BillingController.php#L8',
          'file:app/Http/Controllers/BillingController.php#L12',
          'file:app/Services/DatabaseBillingWorkflow.php#L5',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${workflowMethod?.id}`,
        label: 'calls DatabaseBillingWorkflow.approve',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${workflowMethod?.id}`,
        to: `node_symbol_${repository?.id}`,
        label: 'uses BillingRepository',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${workflowMethod?.id}`,
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingRepository.approve',
      }),
    ]));
    expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${shadowWorkflow?.id}`,
      }),
    ]));
  });

  test('does not link Laravel constructor-injected interface fields through ambiguous container bindings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-laravel-interface-injection-ambiguous-'));
    await mkdir(join(root, 'app/Contracts'), { recursive: true });
    await mkdir(join(root, 'app/Http/Controllers'), { recursive: true });
    await mkdir(join(root, 'app/Providers'), { recursive: true });
    await mkdir(join(root, 'app/Services'), { recursive: true });
    await mkdir(join(root, 'routes'), { recursive: true });

    await writeFile(
      join(root, 'routes/web.php'),
      [
        '<?php',
        "Route::post('/api/v1/billing/{id}/approve', [BillingController::class, 'approve']);",
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/Providers/AppServiceProvider.php'),
      [
        '<?php',
        'use App\\Contracts\\BillingWorkflow;',
        'use App\\Services\\DatabaseBillingWorkflow;',
        'class AppServiceProvider',
        '{',
        '  public function register() {',
        '    $this->app->bind(BillingWorkflow::class, DatabaseBillingWorkflow::class);',
        "    $this->app->bind('billing.workflow', DatabaseBillingWorkflow::class);",
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/Http/Controllers/BillingController.php'),
      [
        '<?php',
        'use App\\Contracts\\BillingWorkflow;',
        'class BillingController extends Controller',
        '{',
        '  private $workflow;',
        '',
        '  public function __construct(BillingWorkflow $workflow) {',
        '    $this->workflow = $workflow;',
        '  }',
        '',
        '  public function approve($id) {',
        '    return response()->json($this->workflow->approve($id));',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/Contracts/BillingWorkflow.php'),
      [
        '<?php',
        'namespace App\\Contracts;',
        'interface BillingWorkflow',
        '{',
        '  public function approve($id);',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/Services/DatabaseBillingWorkflow.php'),
      [
        '<?php',
        'namespace App\\Services;',
        'use App\\Contracts\\BillingWorkflow;',
        'class DatabaseBillingWorkflow implements BillingWorkflow',
        '{',
        '  public function approve($id) {',
        '    return $id;',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/Services/QueuedBillingWorkflow.php'),
      [
        '<?php',
        'namespace App\\Services;',
        'use App\\Contracts\\BillingWorkflow;',
        'class QueuedBillingWorkflow implements BillingWorkflow',
        '{',
        '  public function approve($id) {',
        '    return $id;',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_laravel_interface_injection_ambiguous',
      workflowRunId: 'run_laravel_interface_injection_ambiguous',
      repoRoot: root,
      generatedAt: '2026-07-03T17:20:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 12288,
        maxCapturedFiles: 10,
      },
    });

    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'approve'
      && symbol.path === 'app/Http/Controllers/BillingController.php'
    ));
    const databaseWorkflow = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'DatabaseBillingWorkflow'
      && symbol.path === 'app/Services/DatabaseBillingWorkflow.php'
    ));
    const databaseWorkflowMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'approve'
      && symbol.path === 'app/Services/DatabaseBillingWorkflow.php'
    ));
    const queuedWorkflow = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'QueuedBillingWorkflow'
      && symbol.path === 'app/Services/QueuedBillingWorkflow.php'
    ));
    const queuedWorkflowMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'approve'
      && symbol.path === 'app/Services/QueuedBillingWorkflow.php'
    ));

    expect(handler).toBeDefined();
    expect(databaseWorkflow).toBeDefined();
    expect(databaseWorkflowMethod).toBeDefined();
    expect(queuedWorkflow).toBeDefined();
    expect(queuedWorkflowMethod).toBeDefined();
    for (const target of [
      databaseWorkflow,
      databaseWorkflowMethod,
      queuedWorkflow,
      queuedWorkflowMethod,
    ]) {
      expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: 'symbol_reference',
          from: `node_symbol_${handler?.id}`,
          to: `node_symbol_${target?.id}`,
        }),
      ]));
    }
  });

  test('links Laravel static factory class calls to service and repository methods', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-laravel-static-factory-'));
    await mkdir(join(root, 'app/Http/Controllers'), { recursive: true });
    await mkdir(join(root, 'app/Services'), { recursive: true });
    await mkdir(join(root, 'app/Repositories'), { recursive: true });
    await mkdir(join(root, 'routes'), { recursive: true });

    await writeFile(
      join(root, 'routes/web.php'),
      [
        '<?php',
        "Route::post('/api/v1/billing/refunds/{refund}/approve', [BillingController::class, 'approveRefund']);",
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/Http/Controllers/BillingController.php'),
      [
        '<?php',
        'class BillingController extends Controller',
        '{',
        '  public function approveRefund($refund) {',
        '    $service = \\App\\Services\\BillingService::make();',
        '    return response()->json($service->approveRefund($refund));',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/Services/BillingService.php'),
      [
        '<?php',
        'namespace App\\Services;',
        'use App\\Repositories\\{',
        '  BillingRepository as BillingRepo',
        '};',
        'class BillingService',
        '{',
        '  public function approveRefund($refund) {',
        '    $repository = BillingRepo::instance();',
        '    return $repository->approveRefund($refund);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/Repositories/BillingRepository.php'),
      [
        '<?php',
        'namespace App\\Repositories;',
        'class BillingRepository',
        '{',
        '  public function approveRefund($refund) {',
        '    return $refund;',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_laravel_static_factory',
      workflowRunId: 'run_laravel_static_factory',
      repoRoot: root,
      generatedAt: '2026-07-03T09:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 10,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v1/billing/refunds/{refund}/approve'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'approveRefund'
      && symbol.path === 'app/Http/Controllers/BillingController.php'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingService'
      && symbol.path === 'app/Services/BillingService.php'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'approveRefund'
      && symbol.path === 'app/Services/BillingService.php'
    ));
    const repository = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingRepository'
      && symbol.path === 'app/Repositories/BillingRepository.php'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'approveRefund'
      && symbol.path === 'app/Repositories/BillingRepository.php'
    ));

    expect(route).toBeDefined();
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(serviceMethod).toBeDefined();
    expect(repository).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses BillingService',
        sourceRefs: expect.arrayContaining([
          'file:app/Http/Controllers/BillingController.php#L5',
          'file:app/Http/Controllers/BillingController.php#L6',
          'file:app/Services/BillingService.php#L6',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls BillingService.approveRefund',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repository?.id}`,
        label: 'uses BillingRepository',
        sourceRefs: expect.arrayContaining([
          'file:app/Services/BillingService.php#L3',
          'file:app/Services/BillingService.php#L9',
          'file:app/Services/BillingService.php#L10',
          'file:app/Repositories/BillingRepository.php#L3',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingRepository.approveRefund',
      }),
    ]));
  });

  test('detects static CodeIgniter routes and links controller services', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-codeigniter-routes-'));
    await mkdir(join(root, 'application/config'), { recursive: true });
    await mkdir(join(root, 'application/controllers'), { recursive: true });
    await mkdir(join(root, 'application/services'), { recursive: true });
    await mkdir(join(root, 'application/repositories'), { recursive: true });

    await writeFile(
      join(root, 'application/config/routes.php'),
      [
        '<?php',
        "$route['default_controller'] = 'welcome';",
        "$route['billing/statements'] = 'billing/statements';",
        "$route['customers/profile'] = 'customers/profile';",
        "$route['billing/(:num)'] = 'billing/show/$1';",
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'application/controllers/Billing.php'),
      [
        '<?php',
        'class Billing extends CI_Controller',
        '{',
        '  public function statements() {',
        '    $service = new BillingService();',
        '    return $service->statementList();',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'application/controllers/Customers.php'),
      [
        '<?php',
        'class Customers extends CI_Controller',
        '{',
        '  public function profile() {',
        '    return null;',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'application/services/BillingService.php'),
      [
        '<?php',
        'class BillingService',
        '{',
        '  public function statementList() {',
        '    $repository = new BillingRepository();',
        '    return $repository->fetchStatements();',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'application/repositories/BillingRepository.php'),
      [
        '<?php',
        'class BillingRepository',
        '{',
        '  public function fetchStatements() {',
        '    return [];',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_codeigniter_routes',
      workflowRunId: 'run_codeigniter_routes',
      repoRoot: root,
      generatedAt: '2026-07-02T08:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 16384,
        maxCapturedFiles: 20,
      },
    });

    const billingRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'ANY'
      && entrypoint.route === '/billing/statements'
    ));
    const customerRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'ANY'
      && entrypoint.route === '/customers/profile'
    ));
    const dynamicRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.route === '/billing/(:num)'
    ));
    const defaultRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.route === '/default_controller'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'statements'
      && symbol.path === 'application/controllers/Billing.php'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingService'
      && symbol.path === 'application/services/BillingService.php'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'statementList'
      && symbol.path === 'application/services/BillingService.php'
    ));
    const repository = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingRepository'
      && symbol.path === 'application/repositories/BillingRepository.php'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'fetchStatements'
      && symbol.path === 'application/repositories/BillingRepository.php'
    ));

    expect(billingRoute).toMatchObject({
      handler: 'Billing@statements',
      sourceRefs: ['file:application/config/routes.php#L3'],
    });
    expect(customerRoute).toMatchObject({
      handler: 'Customers@profile',
    });
    expect(dynamicRoute).toBeUndefined();
    expect(defaultRoute).toBeUndefined();
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(serviceMethod).toBeDefined();
    expect(repository).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${billingRoute?.id}`,
        to: `node_symbol_${handler?.id}`,
        sourceRefs: expect.arrayContaining([
          'file:application/config/routes.php#L3',
          'file:application/controllers/Billing.php#L2',
          'file:application/controllers/Billing.php#L4',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses BillingService',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls BillingService.statementList',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repository?.id}`,
        label: 'uses BillingRepository',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingRepository.fetchStatements',
      }),
    ]));
  });

  test('detects static Yii URL manager routes and links controller services', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-yii-routes-'));
    await mkdir(join(root, 'config'), { recursive: true });
    await mkdir(join(root, 'controllers'), { recursive: true });
    await mkdir(join(root, 'services'), { recursive: true });
    await mkdir(join(root, 'repositories'), { recursive: true });

    await writeFile(
      join(root, 'config/web.php'),
      [
        '<?php',
        'return [',
        "  'components' => [",
        "    'urlManager' => [",
        "      'rules' => [",
        "        'billing/statements' => 'billing/statement/index',",
        '        [',
        "          'pattern' => 'POST billing/refunds/<id:\\d+>',",
        "          'route' => 'billing/refund/approve',",
        '        ],',
        '        [',
        "          'pattern' => 'customers/profile',",
        "          'route' => 'customer/profile/view',",
        '        ],',
        '        [',
        "          'pattern' => 'billing/dynamic',",
        "          'route' => $dynamicRoute,",
        '        ],',
        '      ],',
        '    ],',
        '  ],',
        '];',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'controllers/BillingStatementController.php'),
      [
        '<?php',
        'class BillingStatementController extends \\yii\\web\\Controller',
        '{',
        '  public function actionIndex() {',
        '    return [];',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'controllers/BillingRefundController.php'),
      [
        '<?php',
        'class BillingRefundController extends \\yii\\web\\Controller',
        '{',
        '  public function actionApprove($id) {',
        '    $service = new BillingRefundService();',
        '    return $service->approveRefund($id);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'controllers/CustomerProfileController.php'),
      [
        '<?php',
        'class CustomerProfileController extends \\yii\\web\\Controller',
        '{',
        '  public function actionView() {',
        '    return null;',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'services/BillingRefundService.php'),
      [
        '<?php',
        'class BillingRefundService',
        '{',
        '  public function approveRefund($refundId) {',
        '    $repository = new BillingRefundRepository();',
        '    return $repository->approveRefund($refundId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'repositories/BillingRefundRepository.php'),
      [
        '<?php',
        'class BillingRefundRepository',
        '{',
        '  public function approveRefund($refundId) {',
        '    return $refundId;',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_yii_routes',
      workflowRunId: 'run_yii_routes',
      repoRoot: root,
      generatedAt: '2026-07-03T20:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 16384,
        maxCapturedFiles: 20,
      },
    });

    const statementRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'ANY'
      && entrypoint.route === '/billing/statements'
    ));
    const billingRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/billing/refunds/<id:\\d+>'
    ));
    const customerRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'ANY'
      && entrypoint.route === '/customers/profile'
    ));
    const dynamicRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.route === '/billing/dynamic'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'actionApprove'
      && symbol.path === 'controllers/BillingRefundController.php'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingRefundService'
      && symbol.path === 'services/BillingRefundService.php'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'approveRefund'
      && symbol.path === 'services/BillingRefundService.php'
    ));
    const repository = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingRefundRepository'
      && symbol.path === 'repositories/BillingRefundRepository.php'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'approveRefund'
      && symbol.path === 'repositories/BillingRefundRepository.php'
    ));

    expect(statementRoute).toMatchObject({
      handler: 'Yii:BillingStatementController@actionIndex',
      sourceRefs: ['file:config/web.php#L6'],
    });
    expect(billingRoute).toMatchObject({
      handler: 'Yii:BillingRefundController@actionApprove',
      sourceRefs: ['file:config/web.php#L8', 'file:config/web.php#L9'],
    });
    expect(customerRoute).toMatchObject({
      handler: 'Yii:CustomerProfileController@actionView',
    });
    expect(dynamicRoute).toBeUndefined();
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(serviceMethod).toBeDefined();
    expect(repository).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${billingRoute?.id}`,
        to: `node_symbol_${handler?.id}`,
        label: 'route handler Yii:BillingRefundController@actionApprove',
        sourceRefs: expect.arrayContaining([
          'file:config/web.php#L8',
          'file:config/web.php#L9',
          'file:controllers/BillingRefundController.php#L2',
          'file:controllers/BillingRefundController.php#L4',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses BillingRefundService',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls BillingRefundService.approveRefund',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repository?.id}`,
        label: 'uses BillingRefundRepository',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingRefundRepository.approveRefund',
      }),
    ]));
  });

  test('detects static Zend Framework INI routes and links controller services', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-zend-routes-'));
    await mkdir(join(root, 'application/configs'), { recursive: true });
    await mkdir(join(root, 'application/controllers'), { recursive: true });
    await mkdir(join(root, 'application/services'), { recursive: true });
    await mkdir(join(root, 'application/repositories'), { recursive: true });

    await writeFile(
      join(root, 'application/configs/application.ini'),
      [
        '[production]',
        'resources.router.routes.billing_refund.route = "/billing/refunds/:id/approve"',
        'resources.router.routes.billing_refund.defaults.controller = "billing-refund"',
        'resources.router.routes.billing_refund.defaults.action = "approve"',
        'resources.router.routes.billing_refund.reqs.method = "POST"',
        'resources.router.routes.customers_profile.route = "/customers/profile"',
        'resources.router.routes.customers_profile.defaults.controller = "customer-profile"',
        'resources.router.routes.customers_profile.defaults.action = "view"',
        'resources.router.routes.dynamic.route = $dynamicRoute',
        'resources.router.routes.dynamic.defaults.controller = "billing-refund"',
        'resources.router.routes.dynamic.defaults.action = "approve"',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'application/controllers/BillingRefundController.php'),
      [
        '<?php',
        'class BillingRefundController extends Zend_Controller_Action',
        '{',
        '  public function approveAction() {',
        '    $service = new BillingRefundService();',
        '    return $service->approveRefund($this->_getParam("id"));',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'application/controllers/CustomerProfileController.php'),
      [
        '<?php',
        'class CustomerProfileController extends Zend_Controller_Action',
        '{',
        '  public function viewAction() {',
        '    return null;',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'application/services/BillingRefundService.php'),
      [
        '<?php',
        'class BillingRefundService',
        '{',
        '  public function approveRefund($refundId) {',
        '    $repository = new BillingRefundRepository();',
        '    return $repository->approveRefund($refundId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'application/repositories/BillingRefundRepository.php'),
      [
        '<?php',
        'class BillingRefundRepository',
        '{',
        '  public function approveRefund($refundId) {',
        '    return $refundId;',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_zend_routes',
      workflowRunId: 'run_zend_routes',
      repoRoot: root,
      generatedAt: '2026-07-03T21:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 16384,
        maxCapturedFiles: 20,
      },
    });

    const billingRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/billing/refunds/:id/approve'
    ));
    const customerRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'ANY'
      && entrypoint.route === '/customers/profile'
    ));
    const dynamicRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.route === '/dynamic'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'approveAction'
      && symbol.path === 'application/controllers/BillingRefundController.php'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingRefundService'
      && symbol.path === 'application/services/BillingRefundService.php'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'approveRefund'
      && symbol.path === 'application/services/BillingRefundService.php'
    ));
    const repository = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingRefundRepository'
      && symbol.path === 'application/repositories/BillingRefundRepository.php'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'approveRefund'
      && symbol.path === 'application/repositories/BillingRefundRepository.php'
    ));

    expect(billingRoute).toMatchObject({
      handler: 'Zend:BillingRefundController@approveAction',
      sourceRefs: [
        'file:application/configs/application.ini#L2',
        'file:application/configs/application.ini#L3',
        'file:application/configs/application.ini#L4',
        'file:application/configs/application.ini#L5',
      ],
    });
    expect(customerRoute).toMatchObject({
      handler: 'Zend:CustomerProfileController@viewAction',
    });
    expect(dynamicRoute).toBeUndefined();
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(serviceMethod).toBeDefined();
    expect(repository).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${billingRoute?.id}`,
        to: `node_symbol_${handler?.id}`,
        label: 'route handler Zend:BillingRefundController@approveAction',
        sourceRefs: expect.arrayContaining([
          'file:application/configs/application.ini#L2',
          'file:application/configs/application.ini#L3',
          'file:application/configs/application.ini#L4',
          'file:application/controllers/BillingRefundController.php#L2',
          'file:application/controllers/BillingRefundController.php#L4',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses BillingRefundService',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls BillingRefundService.approveRefund',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repository?.id}`,
        label: 'uses BillingRefundRepository',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingRefundRepository.approveRefund',
      }),
    ]));
  });

  test('detects static Drupal hook_menu routes and links callback services', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-drupal-routes-'));
    await mkdir(join(root, 'sites/all/modules/billing/src'), { recursive: true });

    await writeFile(
      join(root, 'sites/all/modules/billing/billing.module'),
      [
        '<?php',
        'function billing_menu() {',
        "  $items['billing/refunds/%/approve'] = array(",
        "    'title' => 'Approve refund',",
        "    'page callback' => 'billing_refund_approve',",
        "    'page arguments' => array(2),",
        "    'access callback' => TRUE,",
        '  );',
        "  $items['customers/profile'] = array(",
        "    'page callback' => 'customer_profile_view',",
        "    'access callback' => TRUE,",
        '  );',
        "  $items['billing/dynamic'] = array(",
        "    'page callback' => $dynamicCallback,",
        "    'access callback' => TRUE,",
        '  );',
        '  return $items;',
        '}',
        '',
        'function billing_refund_approve($refund_id) {',
        '  $service = new BillingRefundService();',
        '  return $service->approveRefund($refund_id);',
        '}',
        '',
        'function customer_profile_view() {',
        '  return NULL;',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'sites/all/modules/billing/src/BillingRefundService.php'),
      [
        '<?php',
        'class BillingRefundService',
        '{',
        '  public function approveRefund($refundId) {',
        '    $repository = new BillingRefundRepository();',
        '    return $repository->approveRefund($refundId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'sites/all/modules/billing/src/BillingRefundRepository.php'),
      [
        '<?php',
        'class BillingRefundRepository',
        '{',
        '  public function approveRefund($refundId) {',
        '    return $refundId;',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_drupal_routes',
      workflowRunId: 'run_drupal_routes',
      repoRoot: root,
      generatedAt: '2026-07-03T22:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 16384,
        maxCapturedFiles: 20,
      },
    });

    const billingRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'ANY'
      && entrypoint.route === '/billing/refunds/%/approve'
    ));
    const customerRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'ANY'
      && entrypoint.route === '/customers/profile'
    ));
    const dynamicRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.route === '/billing/dynamic'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'billing_refund_approve'
      && symbol.path === 'sites/all/modules/billing/billing.module'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingRefundService'
      && symbol.path === 'sites/all/modules/billing/src/BillingRefundService.php'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'approveRefund'
      && symbol.path === 'sites/all/modules/billing/src/BillingRefundService.php'
    ));
    const repository = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingRefundRepository'
      && symbol.path === 'sites/all/modules/billing/src/BillingRefundRepository.php'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'approveRefund'
      && symbol.path === 'sites/all/modules/billing/src/BillingRefundRepository.php'
    ));

    expect(billingRoute).toMatchObject({
      handler: 'Drupal:billing_refund_approve',
      sourceRefs: [
        'file:sites/all/modules/billing/billing.module#L3',
        'file:sites/all/modules/billing/billing.module#L5',
      ],
    });
    expect(customerRoute).toMatchObject({
      handler: 'Drupal:customer_profile_view',
    });
    expect(dynamicRoute).toBeUndefined();
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(serviceMethod).toBeDefined();
    expect(repository).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${billingRoute?.id}`,
        to: `node_symbol_${handler?.id}`,
        label: 'route handler Drupal:billing_refund_approve',
        sourceRefs: expect.arrayContaining([
          'file:sites/all/modules/billing/billing.module#L3',
          'file:sites/all/modules/billing/billing.module#L5',
          'file:sites/all/modules/billing/billing.module#L20',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses BillingRefundService',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls BillingRefundService.approveRefund',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repository?.id}`,
        label: 'uses BillingRefundRepository',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingRefundRepository.approveRefund',
      }),
    ]));
  });

  test('detects Drupal hook_menu drupal_get_form routes and links form services', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-drupal-form-routes-'));
    await mkdir(join(root, 'sites/all/modules/billing/src'), { recursive: true });

    await writeFile(
      join(root, 'sites/all/modules/billing/billing.module'),
      [
        '<?php',
        'function billing_menu() {',
        "  $items['billing/refunds/%/approve-form'] = array(",
        "    'title' => 'Approve refund form',",
        "    'page callback' => 'drupal_get_form',",
        "    'page arguments' => array('billing_refund_approve_form', 2),",
        "    'access callback' => TRUE,",
        '  );',
        "  $items['customers/profile-form'] = array(",
        "    'page callback' => 'drupal_get_form',",
        "    'page arguments' => array('customer_profile_form'),",
        "    'access callback' => TRUE,",
        '  );',
        "  $items['billing/dynamic-form'] = array(",
        "    'page callback' => 'drupal_get_form',",
        "    'page arguments' => array($dynamic_form_id),",
        "    'access callback' => TRUE,",
        '  );',
        '  return $items;',
        '}',
        '',
        'function billing_refund_approve_form($form, &$form_state, $refund_id) {',
        '  $service = new BillingRefundService();',
        '  return $service->approveRefund($refund_id);',
        '}',
        '',
        'function customer_profile_form() {',
        '  return array();',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'sites/all/modules/billing/src/BillingRefundService.php'),
      [
        '<?php',
        'class BillingRefundService',
        '{',
        '  public function approveRefund($refundId) {',
        '    $repository = new BillingRefundRepository();',
        '    return $repository->approveRefund($refundId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'sites/all/modules/billing/src/BillingRefundRepository.php'),
      [
        '<?php',
        'class BillingRefundRepository',
        '{',
        '  public function approveRefund($refundId) {',
        '    return $refundId;',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_drupal_form_routes',
      workflowRunId: 'run_drupal_form_routes',
      repoRoot: root,
      generatedAt: '2026-07-03T22:20:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 16384,
        maxCapturedFiles: 20,
      },
    });

    const billingRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'ANY'
      && entrypoint.route === '/billing/refunds/%/approve-form'
    ));
    const customerRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'ANY'
      && entrypoint.route === '/customers/profile-form'
    ));
    const dynamicRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.route === '/billing/dynamic-form'
    ));
    const rawDrupalGetFormHandler = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.handler === 'Drupal:drupal_get_form'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'billing_refund_approve_form'
      && symbol.path === 'sites/all/modules/billing/billing.module'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingRefundService'
      && symbol.path === 'sites/all/modules/billing/src/BillingRefundService.php'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'approveRefund'
      && symbol.path === 'sites/all/modules/billing/src/BillingRefundService.php'
    ));
    const repository = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingRefundRepository'
      && symbol.path === 'sites/all/modules/billing/src/BillingRefundRepository.php'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'approveRefund'
      && symbol.path === 'sites/all/modules/billing/src/BillingRefundRepository.php'
    ));

    expect(billingRoute).toMatchObject({
      handler: 'Drupal:billing_refund_approve_form',
      sourceRefs: [
        'file:sites/all/modules/billing/billing.module#L3',
        'file:sites/all/modules/billing/billing.module#L5',
        'file:sites/all/modules/billing/billing.module#L6',
      ],
    });
    expect(customerRoute).toMatchObject({
      handler: 'Drupal:customer_profile_form',
    });
    expect(dynamicRoute).toBeUndefined();
    expect(rawDrupalGetFormHandler).toBeUndefined();
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(serviceMethod).toBeDefined();
    expect(repository).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${billingRoute?.id}`,
        to: `node_symbol_${handler?.id}`,
        label: 'route handler Drupal:billing_refund_approve_form',
        sourceRefs: expect.arrayContaining([
          'file:sites/all/modules/billing/billing.module#L3',
          'file:sites/all/modules/billing/billing.module#L5',
          'file:sites/all/modules/billing/billing.module#L6',
          'file:sites/all/modules/billing/billing.module#L22',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses BillingRefundService',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls BillingRefundService.approveRefund',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repository?.id}`,
        label: 'uses BillingRefundRepository',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingRefundRepository.approveRefund',
      }),
    ]));
  });

  test('detects WordPress admin_post and wp_ajax hooks and links callback services', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-wordpress-hooks-'));
    await mkdir(join(root, 'wp-content/plugins/billing-refunds/src'), { recursive: true });

    await writeFile(
      join(root, 'wp-content/plugins/billing-refunds/billing-refunds.php'),
      [
        '<?php',
        "add_action('admin_post_billing_refund_approve', 'billing_refund_approve_admin_post');",
        "add_action('wp_ajax_billing_refund_status', 'billing_refund_status_ajax');",
        "add_action('wp_ajax_billing_refund_class_status', [BillingRefundAjaxController::class, 'status']);",
        "add_action('wp_ajax_customer_profile', 'customer_profile_ajax');",
        "add_action('wp_ajax_billing_instance_status', [$controller, 'status']);",
        "add_action('wp_ajax_billing_dynamic', $dynamicCallback);",
        "add_action($dynamicHook, 'billing_refund_approve_admin_post');",
        '',
        'function billing_refund_approve_admin_post() {',
        '  $service = new BillingRefundService();',
        '  return $service->approveRefund($_POST["refund_id"]);',
        '}',
        '',
        'function billing_refund_status_ajax() {',
        '  return array("ok" => TRUE);',
        '}',
        '',
        'function customer_profile_ajax() {',
        '  return array();',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'wp-content/plugins/billing-refunds/src/BillingRefundAjaxController.php'),
      [
        '<?php',
        'class BillingRefundAjaxController',
        '{',
        '  public function status($request) {',
        '    $service = new BillingRefundService();',
        '    return $service->approveRefund($request["refund_id"]);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'wp-content/plugins/billing-refunds/src/BillingRefundService.php'),
      [
        '<?php',
        'class BillingRefundService',
        '{',
        '  public function approveRefund($refundId) {',
        '    $repository = new BillingRefundRepository();',
        '    return $repository->approveRefund($refundId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'wp-content/plugins/billing-refunds/src/BillingRefundRepository.php'),
      [
        '<?php',
        'class BillingRefundRepository',
        '{',
        '  public function approveRefund($refundId) {',
        '    return $refundId;',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_wordpress_hooks',
      workflowRunId: 'run_wordpress_hooks',
      repoRoot: root,
      generatedAt: '2026-07-03T22:40:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 16384,
        maxCapturedFiles: 20,
      },
    });

    const adminPostRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'ANY'
      && entrypoint.route === '/wp-admin/admin-post.php?action=billing_refund_approve'
    ));
    const ajaxRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'ANY'
      && entrypoint.route === '/wp-admin/admin-ajax.php?action=billing_refund_status'
    ));
    const classAjaxRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'ANY'
      && entrypoint.route === '/wp-admin/admin-ajax.php?action=billing_refund_class_status'
    ));
    const customerRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'ANY'
      && entrypoint.route === '/wp-admin/admin-ajax.php?action=customer_profile'
    ));
    const instanceRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.route === '/wp-admin/admin-ajax.php?action=billing_instance_status'
    ));
    const dynamicRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.route === '/wp-admin/admin-ajax.php?action=billing_dynamic'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'billing_refund_approve_admin_post'
      && symbol.path === 'wp-content/plugins/billing-refunds/billing-refunds.php'
    ));
    const classHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'status'
      && symbol.path === 'wp-content/plugins/billing-refunds/src/BillingRefundAjaxController.php'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingRefundService'
      && symbol.path === 'wp-content/plugins/billing-refunds/src/BillingRefundService.php'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'approveRefund'
      && symbol.path === 'wp-content/plugins/billing-refunds/src/BillingRefundService.php'
    ));
    const repository = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingRefundRepository'
      && symbol.path === 'wp-content/plugins/billing-refunds/src/BillingRefundRepository.php'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'approveRefund'
      && symbol.path === 'wp-content/plugins/billing-refunds/src/BillingRefundRepository.php'
    ));

    expect(adminPostRoute).toMatchObject({
      handler: 'WordPress:billing_refund_approve_admin_post',
      sourceRefs: ['file:wp-content/plugins/billing-refunds/billing-refunds.php#L2'],
    });
    expect(ajaxRoute).toMatchObject({
      handler: 'WordPress:billing_refund_status_ajax',
    });
    expect(classAjaxRoute).toMatchObject({
      handler: 'WordPress:BillingRefundAjaxController@status',
    });
    expect(customerRoute).toMatchObject({
      handler: 'WordPress:customer_profile_ajax',
    });
    expect(instanceRoute).toBeUndefined();
    expect(dynamicRoute).toBeUndefined();
    expect(inventory.capabilities.map((capability) => capability.label)).toEqual(expect.arrayContaining([
      'Billing API',
      'Customer API',
    ]));
    expect(handler).toBeDefined();
    expect(classHandler).toBeDefined();
    expect(service).toBeDefined();
    expect(serviceMethod).toBeDefined();
    expect(repository).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${adminPostRoute?.id}`,
        to: `node_symbol_${handler?.id}`,
        label: 'route handler WordPress:billing_refund_approve_admin_post',
        sourceRefs: expect.arrayContaining([
          'file:wp-content/plugins/billing-refunds/billing-refunds.php#L2',
          'file:wp-content/plugins/billing-refunds/billing-refunds.php#L10',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses BillingRefundService',
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${classAjaxRoute?.id}`,
        to: `node_symbol_${classHandler?.id}`,
        label: 'route handler WordPress:BillingRefundAjaxController@status',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${classHandler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses BillingRefundService',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls BillingRefundService.approveRefund',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repository?.id}`,
        label: 'uses BillingRefundRepository',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingRefundRepository.approveRefund',
      }),
    ]));
  });

  test('detects static WordPress REST routes and links callback services', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-wordpress-rest-'));
    await mkdir(join(root, 'wp-content/plugins/billing-refunds/src'), { recursive: true });

    await writeFile(
      join(root, 'wp-content/plugins/billing-refunds/billing-refunds.php'),
      [
        '<?php',
        "register_rest_route('billing/v1', '/refunds/(?P<id>\\d+)/approve', array(",
        "  'methods' => WP_REST_Server::EDITABLE,",
        "  'callback' => 'billing_refund_rest_approve',",
        "  'permission_callback' => '__return_true',",
        '));',
        "register_rest_route('customers/v1', '/profile', array(",
        "  'methods' => array('GET', 'POST'),",
        "  'callback' => 'customer_profile_rest',",
        '));',
        "register_rest_route('billing/v1', '/dynamic', array(",
        "  'methods' => 'POST',",
        "  'callback' => $dynamicCallback,",
        '));',
        "register_rest_route($dynamicNamespace, '/refunds', array(",
        "  'methods' => 'GET',",
        "  'callback' => 'billing_refund_rest_approve',",
        '));',
        '',
        'function billing_refund_rest_approve($request) {',
        '  $service = new BillingRefundService();',
        '  return $service->approveRefund($request["id"]);',
        '}',
        '',
        'function customer_profile_rest($request) {',
        '  return array();',
        '}',
        '',
        "register_rest_route('billing/v1', '/refunds/(?P<id>\\d+)/cancel', array(",
        "  'methods' => WP_REST_Server::DELETABLE,",
        "  'callback' => array(BillingRefundRestController::class, 'cancelRefund'),",
        '));',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'wp-content/plugins/billing-refunds/src/BillingRefundRestController.php'),
      [
        '<?php',
        'class BillingRefundRestController',
        '{',
        '  public function cancelRefund($request) {',
        '    $service = new BillingRefundService();',
        '    return $service->approveRefund($request["id"]);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'wp-content/plugins/billing-refunds/src/BillingRefundService.php'),
      [
        '<?php',
        'class BillingRefundService',
        '{',
        '  public function approveRefund($refundId) {',
        '    $repository = new BillingRefundRepository();',
        '    return $repository->approveRefund($refundId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'wp-content/plugins/billing-refunds/src/BillingRefundRepository.php'),
      [
        '<?php',
        'class BillingRefundRepository',
        '{',
        '  public function approveRefund($refundId) {',
        '    return $refundId;',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_wordpress_rest',
      workflowRunId: 'run_wordpress_rest',
      repoRoot: root,
      generatedAt: '2026-07-03T23:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 16384,
        maxCapturedFiles: 20,
      },
    });

    const postRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/wp-json/billing/v1/refunds/(?P<id>\\d+)/approve'
    ));
    const putRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'PUT'
      && entrypoint.route === '/wp-json/billing/v1/refunds/(?P<id>\\d+)/approve'
    ));
    const patchRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'PATCH'
      && entrypoint.route === '/wp-json/billing/v1/refunds/(?P<id>\\d+)/approve'
    ));
    const customerGetRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/wp-json/customers/v1/profile'
    ));
    const customerPostRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/wp-json/customers/v1/profile'
    ));
    const classRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'DELETE'
      && entrypoint.route === '/wp-json/billing/v1/refunds/(?P<id>\\d+)/cancel'
    ));
    const dynamicCallbackRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.route === '/wp-json/billing/v1/dynamic'
    ));
    const dynamicNamespaceRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.route === '/wp-json/billing/v1/refunds'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'billing_refund_rest_approve'
      && symbol.path === 'wp-content/plugins/billing-refunds/billing-refunds.php'
    ));
    const classHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'cancelRefund'
      && symbol.path === 'wp-content/plugins/billing-refunds/src/BillingRefundRestController.php'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingRefundService'
      && symbol.path === 'wp-content/plugins/billing-refunds/src/BillingRefundService.php'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'approveRefund'
      && symbol.path === 'wp-content/plugins/billing-refunds/src/BillingRefundService.php'
    ));
    const repository = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingRefundRepository'
      && symbol.path === 'wp-content/plugins/billing-refunds/src/BillingRefundRepository.php'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'approveRefund'
      && symbol.path === 'wp-content/plugins/billing-refunds/src/BillingRefundRepository.php'
    ));

    expect(postRoute).toMatchObject({
      handler: 'WordPress:billing_refund_rest_approve',
      sourceRefs: [
        'file:wp-content/plugins/billing-refunds/billing-refunds.php#L2',
        'file:wp-content/plugins/billing-refunds/billing-refunds.php#L3',
        'file:wp-content/plugins/billing-refunds/billing-refunds.php#L4',
      ],
    });
    expect(putRoute).toMatchObject({ handler: 'WordPress:billing_refund_rest_approve' });
    expect(patchRoute).toMatchObject({ handler: 'WordPress:billing_refund_rest_approve' });
    expect(customerGetRoute).toMatchObject({ handler: 'WordPress:customer_profile_rest' });
    expect(customerPostRoute).toMatchObject({ handler: 'WordPress:customer_profile_rest' });
    expect(classRoute).toMatchObject({
      handler: 'WordPress:BillingRefundRestController@cancelRefund',
      sourceRefs: [
        'file:wp-content/plugins/billing-refunds/billing-refunds.php#L29',
        'file:wp-content/plugins/billing-refunds/billing-refunds.php#L30',
        'file:wp-content/plugins/billing-refunds/billing-refunds.php#L31',
      ],
    });
    expect(dynamicCallbackRoute).toBeUndefined();
    expect(dynamicNamespaceRoute).toBeUndefined();
    expect(inventory.capabilities.map((capability) => capability.label)).toEqual(expect.arrayContaining([
      'Billing API',
      'Customers API',
    ]));
    expect(handler).toBeDefined();
    expect(classHandler).toBeDefined();
    expect(service).toBeDefined();
    expect(serviceMethod).toBeDefined();
    expect(repository).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${postRoute?.id}`,
        to: `node_symbol_${handler?.id}`,
        label: 'route handler WordPress:billing_refund_rest_approve',
        sourceRefs: expect.arrayContaining([
          'file:wp-content/plugins/billing-refunds/billing-refunds.php#L2',
          'file:wp-content/plugins/billing-refunds/billing-refunds.php#L3',
          'file:wp-content/plugins/billing-refunds/billing-refunds.php#L4',
          'file:wp-content/plugins/billing-refunds/billing-refunds.php#L20',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses BillingRefundService',
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${classRoute?.id}`,
        to: `node_symbol_${classHandler?.id}`,
        label: 'route handler WordPress:BillingRefundRestController@cancelRefund',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${classHandler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses BillingRefundService',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls BillingRefundService.approveRefund',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repository?.id}`,
        label: 'uses BillingRefundRepository',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingRefundRepository.approveRefund',
      }),
    ]));
  });

  test('detects static CakePHP routes and links controller services', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-cakephp-routes-'));
    await mkdir(join(root, 'app/Config'), { recursive: true });
    await mkdir(join(root, 'app/Controller'), { recursive: true });
    await mkdir(join(root, 'app/Service'), { recursive: true });
    await mkdir(join(root, 'app/Repository'), { recursive: true });

    await writeFile(
      join(root, 'app/Config/routes.php'),
      [
        '<?php',
        "Router::connect('/billing/statements', array('controller' => 'billing', 'action' => 'statements'));",
        "Router::connect('/customers/profile', array('controller' => 'customers', 'action' => 'profile'));",
        "Router::connect('/billing/:id', array('controller' => 'billing', 'action' => 'view'));",
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/Controller/BillingController.php'),
      [
        '<?php',
        'class BillingController extends AppController',
        '{',
        '  public function statements() {',
        '    $service = new BillingService();',
        '    return $service->statementList();',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/Controller/CustomersController.php'),
      [
        '<?php',
        'class CustomersController extends AppController',
        '{',
        '  public function profile() {',
        '    return null;',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/Service/BillingService.php'),
      [
        '<?php',
        'class BillingService',
        '{',
        '  public function statementList() {',
        '    $repository = new BillingRepository();',
        '    return $repository->fetchStatements();',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/Repository/BillingRepository.php'),
      [
        '<?php',
        'class BillingRepository',
        '{',
        '  public function fetchStatements() {',
        '    return [];',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_cakephp_routes',
      workflowRunId: 'run_cakephp_routes',
      repoRoot: root,
      generatedAt: '2026-07-02T11:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 16384,
        maxCapturedFiles: 20,
      },
    });

    const billingRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'ANY'
      && entrypoint.route === '/billing/statements'
    ));
    const customerRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'ANY'
      && entrypoint.route === '/customers/profile'
    ));
    const dynamicRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.route === '/billing/:id'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'statements'
      && symbol.path === 'app/Controller/BillingController.php'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingService'
      && symbol.path === 'app/Service/BillingService.php'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'statementList'
      && symbol.path === 'app/Service/BillingService.php'
    ));
    const repository = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingRepository'
      && symbol.path === 'app/Repository/BillingRepository.php'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'fetchStatements'
      && symbol.path === 'app/Repository/BillingRepository.php'
    ));

    expect(billingRoute).toMatchObject({
      handler: 'CakePHP:BillingController@statements',
      sourceRefs: ['file:app/Config/routes.php#L2'],
    });
    expect(customerRoute).toMatchObject({
      handler: 'CakePHP:CustomersController@profile',
    });
    expect(dynamicRoute).toBeUndefined();
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(serviceMethod).toBeDefined();
    expect(repository).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${billingRoute?.id}`,
        to: `node_symbol_${handler?.id}`,
        sourceRefs: expect.arrayContaining([
          'file:app/Config/routes.php#L2',
          'file:app/Controller/BillingController.php#L2',
          'file:app/Controller/BillingController.php#L4',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses BillingService',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls BillingService.statementList',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repository?.id}`,
        label: 'uses BillingRepository',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingRepository.fetchStatements',
      }),
    ]));
  });

  test('detects Slim-style PHP routes and links controller services', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-slim-routes-'));
    await mkdir(join(root, 'public'), { recursive: true });
    await mkdir(join(root, 'src/Controller'), { recursive: true });
    await mkdir(join(root, 'src/Service'), { recursive: true });
    await mkdir(join(root, 'src/Repository'), { recursive: true });

    await writeFile(
      join(root, 'public/index.php'),
      [
        '<?php',
        '$app->post("/billing/refunds/{refundId}/approve", [BillingController::class, "approveRefund"]);',
        '$app->get("/customers/{customerId}/profile", "CustomerController:profile");',
        '$client->post("/external/refunds", [BillingController::class, "approveRefund"]);',
        '$app->get("/health", function () { return "ok"; });',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Controller/BillingController.php'),
      [
        '<?php',
        'class BillingController',
        '{',
        '  public function approveRefund($request, $response, $args) {',
        '    $service = new BillingService();',
        '    return $service->approveRefund($args["refundId"]);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Controller/CustomerController.php'),
      [
        '<?php',
        'class CustomerController',
        '{',
        '  public function profile($request, $response, $args) {',
        '    return $args["customerId"];',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Service/BillingService.php'),
      [
        '<?php',
        'class BillingService',
        '{',
        '  public function approveRefund($refundId) {',
        '    $repository = new BillingRepository();',
        '    return $repository->approveRefund($refundId);',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Repository/BillingRepository.php'),
      [
        '<?php',
        'class BillingRepository',
        '{',
        '  public function approveRefund($refundId) {',
        '    return $refundId;',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_slim_routes',
      workflowRunId: 'run_slim_routes',
      repoRoot: root,
      generatedAt: '2026-07-03T19:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 16384,
        maxCapturedFiles: 20,
      },
    });

    const billingRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/billing/refunds/{refundId}/approve'
    ));
    const customerRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/customers/{customerId}/profile'
    ));
    const externalRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.route === '/external/refunds'
    ));
    const healthRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.route === '/health'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'approveRefund'
      && symbol.path === 'src/Controller/BillingController.php'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingService'
      && symbol.path === 'src/Service/BillingService.php'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'approveRefund'
      && symbol.path === 'src/Service/BillingService.php'
    ));
    const repository = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingRepository'
      && symbol.path === 'src/Repository/BillingRepository.php'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'method'
      && symbol.name === 'approveRefund'
      && symbol.path === 'src/Repository/BillingRepository.php'
    ));

    expect(billingRoute).toMatchObject({
      handler: 'Slim:BillingController@approveRefund',
      sourceRefs: ['file:public/index.php#L2'],
    });
    expect(customerRoute).toMatchObject({
      handler: 'Slim:CustomerController@profile',
    });
    expect(externalRoute).toBeUndefined();
    expect(healthRoute).toBeUndefined();
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(serviceMethod).toBeDefined();
    expect(repository).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${billingRoute?.id}`,
        to: `node_symbol_${handler?.id}`,
        label: 'route handler Slim:BillingController@approveRefund',
        sourceRefs: expect.arrayContaining([
          'file:public/index.php#L2',
          'file:src/Controller/BillingController.php#L2',
          'file:src/Controller/BillingController.php#L4',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses BillingService',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls BillingService.approveRefund',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repository?.id}`,
        label: 'uses BillingRepository',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingRepository.approveRefund',
      }),
    ]));
  });

  test('links Rails controller actions to constructed service and repository methods', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-rails-service-graph-'));
    await mkdir(join(root, 'aaa_shadow/services'), { recursive: true });
    await mkdir(join(root, 'app/controllers'), { recursive: true });
    await mkdir(join(root, 'app/services'), { recursive: true });
    await mkdir(join(root, 'app/repositories'), { recursive: true });
    await mkdir(join(root, 'config'), { recursive: true });

    await writeFile(
      join(root, 'config/routes.rb'),
      [
        'Rails.application.routes.draw do',
        '  post "/api/v1/billing/invoices/:invoice_id/reconcile", to: "billing#reconcile"',
        'end',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'aaa_shadow/services/billing_service.rb'),
      [
        'class BillingService',
        '  def reconcile(invoice_id)',
        '    "wrong service"',
        '  end',
        'end',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/controllers/billing_controller.rb'),
      [
        'require_relative "../services/billing_service"',
        'class BillingController < ApplicationController',
        '  def reconcile',
        '    service = BillingService.new',
        '    render json: service.reconcile(params[:invoice_id])',
        '  end',
        'end',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/services/billing_service.rb'),
      [
        'require_relative "../repositories/billing_repository"',
        'class BillingService',
        '  def reconcile(invoice_id)',
        '    repository = BillingRepository.new',
        '    repository.mark_reconciled(invoice_id)',
        '  end',
        'end',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/repositories/billing_repository.rb'),
      [
        'class BillingRepository',
        '  def mark_reconciled(invoice_id)',
        '    invoice_id',
        '  end',
        'end',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_rails_service_graph',
      workflowRunId: 'run_rails_service_graph',
      repoRoot: root,
      generatedAt: '2026-07-02T00:30:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 10,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v1/billing/invoices/:invoice_id/reconcile'
    ));
    const handler = inventory.symbols.find((symbol) => (
      (symbol.kind === 'function' || symbol.kind === 'method')
      && symbol.name === 'reconcile'
      && symbol.path === 'app/controllers/billing_controller.rb'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingService'
      && symbol.path === 'app/services/billing_service.rb'
    ));
    const shadowService = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingService'
      && symbol.path === 'aaa_shadow/services/billing_service.rb'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      (symbol.kind === 'function' || symbol.kind === 'method')
      && symbol.name === 'reconcile'
      && symbol.path === 'app/services/billing_service.rb'
    ));
    const repository = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingRepository'
      && symbol.path === 'app/repositories/billing_repository.rb'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      (symbol.kind === 'function' || symbol.kind === 'method')
      && symbol.name === 'mark_reconciled'
      && symbol.path === 'app/repositories/billing_repository.rb'
    ));

    expect(route).toBeDefined();
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(shadowService).toBeDefined();
    expect(serviceMethod).toBeDefined();
    expect(repository).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses BillingService',
        sourceRefs: expect.arrayContaining([
          'file:app/controllers/billing_controller.rb#L1',
          'file:app/controllers/billing_controller.rb#L4',
          'file:app/controllers/billing_controller.rb#L5',
          'file:app/services/billing_service.rb#L2',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls BillingService.reconcile',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repository?.id}`,
        label: 'uses BillingRepository',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingRepository.mark_reconciled',
      }),
    ]));
    expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${shadowService?.id}`,
      }),
    ]));

    const billingCapability = inventory.capabilities.find((capability) => capability.id === 'cap_api_billing');
    expect(billingCapability).toMatchObject({ label: 'Billing API' });
    expect(billingCapability?.symbolRefs).toEqual(expect.arrayContaining([
      handler?.id,
      service?.id,
      serviceMethod?.id,
      repository?.id,
      repositoryMethod?.id,
    ]));
  });

  test('links Rails require_dependency service receivers without choosing shadow classes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-rails-require-dependency-'));
    await mkdir(join(root, 'aaa_shadow/services'), { recursive: true });
    await mkdir(join(root, 'app/controllers'), { recursive: true });
    await mkdir(join(root, 'app/services'), { recursive: true });
    await mkdir(join(root, 'app/repositories'), { recursive: true });
    await mkdir(join(root, 'config'), { recursive: true });

    await writeFile(
      join(root, 'config/routes.rb'),
      [
        'Rails.application.routes.draw do',
        '  post "/api/v1/billing/refunds/:refund_id/approve", to: "billing#approve_refund"',
        'end',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'aaa_shadow/services/billing_service.rb'),
      [
        'class BillingService',
        '  def approve_refund(refund_id)',
        '    "wrong service"',
        '  end',
        'end',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/controllers/billing_controller.rb'),
      [
        'require_dependency "services/billing_service"',
        'class BillingController < ApplicationController',
        '  def approve_refund',
        '    service = BillingService.new',
        '    render json: service.approve_refund(params[:refund_id])',
        '  end',
        'end',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/services/billing_service.rb'),
      [
        'require_dependency "repositories/billing_repository"',
        'class BillingService',
        '  def approve_refund(refund_id)',
        '    repository = BillingRepository.new',
        '    repository.approve_refund(refund_id)',
        '  end',
        'end',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/repositories/billing_repository.rb'),
      [
        'class BillingRepository',
        '  def approve_refund(refund_id)',
        '    refund_id',
        '  end',
        'end',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_rails_require_dependency',
      workflowRunId: 'run_rails_require_dependency',
      repoRoot: root,
      generatedAt: '2026-07-03T12:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 10,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v1/billing/refunds/:refund_id/approve'
    ));
    const handler = inventory.symbols.find((symbol) => (
      (symbol.kind === 'function' || symbol.kind === 'method')
      && symbol.name === 'approve_refund'
      && symbol.path === 'app/controllers/billing_controller.rb'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingService'
      && symbol.path === 'app/services/billing_service.rb'
    ));
    const shadowService = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingService'
      && symbol.path === 'aaa_shadow/services/billing_service.rb'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      (symbol.kind === 'function' || symbol.kind === 'method')
      && symbol.name === 'approve_refund'
      && symbol.path === 'app/services/billing_service.rb'
    ));
    const repository = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingRepository'
      && symbol.path === 'app/repositories/billing_repository.rb'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      (symbol.kind === 'function' || symbol.kind === 'method')
      && symbol.name === 'approve_refund'
      && symbol.path === 'app/repositories/billing_repository.rb'
    ));

    expect(route).toBeDefined();
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(shadowService).toBeDefined();
    expect(serviceMethod).toBeDefined();
    expect(repository).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses BillingService',
        sourceRefs: expect.arrayContaining([
          'file:app/controllers/billing_controller.rb#L1',
          'file:app/controllers/billing_controller.rb#L4',
          'file:app/controllers/billing_controller.rb#L5',
          'file:app/services/billing_service.rb#L2',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls BillingService.approve_refund',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repository?.id}`,
        label: 'uses BillingRepository',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingRepository.approve_refund',
      }),
    ]));
    expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${shadowService?.id}`,
      }),
    ]));
  });

  test('links Rails namespaced service and repository class receivers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-rails-namespaced-receivers-'));
    await mkdir(join(root, 'aaa_shadow/services/billing'), { recursive: true });
    await mkdir(join(root, 'app/controllers'), { recursive: true });
    await mkdir(join(root, 'app/services/billing'), { recursive: true });
    await mkdir(join(root, 'app/repositories/billing'), { recursive: true });
    await mkdir(join(root, 'config'), { recursive: true });

    await writeFile(
      join(root, 'config/routes.rb'),
      [
        'Rails.application.routes.draw do',
        '  post "/api/v1/billing/refunds/:refund_id/approve", to: "billing#approve_refund"',
        'end',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'aaa_shadow/services/billing/refund_service.rb'),
      [
        'class Billing::RefundService',
        '  def approve_refund(refund_id)',
        '    "wrong service"',
        '  end',
        'end',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/controllers/billing_controller.rb'),
      [
        'require_dependency "billing/refund_service"',
        'class BillingController < ApplicationController',
        '  def approve_refund',
        '    service = Billing::RefundService.new',
        '    render json: service.approve_refund(params[:refund_id])',
        '  end',
        'end',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/services/billing/refund_service.rb'),
      [
        'require_dependency "billing/refund_repository"',
        'class Billing::RefundService',
        '  def approve_refund(refund_id)',
        '    repository = Billing::RefundRepository.new',
        '    repository.approve_refund(refund_id)',
        '  end',
        'end',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/repositories/billing/refund_repository.rb'),
      [
        'class Billing::RefundRepository',
        '  def approve_refund(refund_id)',
        '    refund_id',
        '  end',
        'end',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_rails_namespaced_receivers',
      workflowRunId: 'run_rails_namespaced_receivers',
      repoRoot: root,
      generatedAt: '2026-07-03T13:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 10,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v1/billing/refunds/:refund_id/approve'
    ));
    const handler = inventory.symbols.find((symbol) => (
      (symbol.kind === 'function' || symbol.kind === 'method')
      && symbol.name === 'approve_refund'
      && symbol.path === 'app/controllers/billing_controller.rb'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'RefundService'
      && symbol.path === 'app/services/billing/refund_service.rb'
    ));
    const shadowService = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'RefundService'
      && symbol.path === 'aaa_shadow/services/billing/refund_service.rb'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      (symbol.kind === 'function' || symbol.kind === 'method')
      && symbol.name === 'approve_refund'
      && symbol.path === 'app/services/billing/refund_service.rb'
    ));
    const repository = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'RefundRepository'
      && symbol.path === 'app/repositories/billing/refund_repository.rb'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      (symbol.kind === 'function' || symbol.kind === 'method')
      && symbol.name === 'approve_refund'
      && symbol.path === 'app/repositories/billing/refund_repository.rb'
    ));

    expect(route).toBeDefined();
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(shadowService).toBeDefined();
    expect(serviceMethod).toBeDefined();
    expect(repository).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses RefundService',
        sourceRefs: expect.arrayContaining([
          'file:app/controllers/billing_controller.rb#L1',
          'file:app/controllers/billing_controller.rb#L4',
          'file:app/controllers/billing_controller.rb#L5',
          'file:app/services/billing/refund_service.rb#L2',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls RefundService.approve_refund',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repository?.id}`,
        label: 'uses RefundRepository',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls RefundRepository.approve_refund',
      }),
    ]));
    expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${shadowService?.id}`,
      }),
    ]));
  });

  test('links Rails global-namespace namespaced service receivers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-rails-global-namespace-receivers-'));
    await mkdir(join(root, 'app/controllers'), { recursive: true });
    await mkdir(join(root, 'app/services/billing'), { recursive: true });
    await mkdir(join(root, 'app/repositories/billing'), { recursive: true });
    await mkdir(join(root, 'config'), { recursive: true });

    await writeFile(
      join(root, 'config/routes.rb'),
      [
        'Rails.application.routes.draw do',
        '  post "/api/v1/billing/refunds/:refund_id/approve", to: "billing#approve_refund"',
        'end',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/controllers/billing_controller.rb'),
      [
        'require_dependency "billing/refund_service"',
        'class BillingController < ApplicationController',
        '  def approve_refund',
        '    service = ::Billing::RefundService.new',
        '    render json: service.approve_refund(params[:refund_id])',
        '  end',
        'end',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/services/billing/refund_service.rb'),
      [
        'require_dependency "billing/refund_repository"',
        'class Billing::RefundService',
        '  def approve_refund(refund_id)',
        '    repository = ::Billing::RefundRepository.new',
        '    repository.approve_refund(refund_id)',
        '  end',
        'end',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/repositories/billing/refund_repository.rb'),
      [
        'class Billing::RefundRepository',
        '  def approve_refund(refund_id)',
        '    refund_id',
        '  end',
        'end',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_rails_global_namespace_receivers',
      workflowRunId: 'run_rails_global_namespace_receivers',
      repoRoot: root,
      generatedAt: '2026-07-03T13:30:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 10,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v1/billing/refunds/:refund_id/approve'
    ));
    const handler = inventory.symbols.find((symbol) => (
      (symbol.kind === 'function' || symbol.kind === 'method')
      && symbol.name === 'approve_refund'
      && symbol.path === 'app/controllers/billing_controller.rb'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'RefundService'
      && symbol.path === 'app/services/billing/refund_service.rb'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      (symbol.kind === 'function' || symbol.kind === 'method')
      && symbol.name === 'approve_refund'
      && symbol.path === 'app/services/billing/refund_service.rb'
    ));
    const repository = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'RefundRepository'
      && symbol.path === 'app/repositories/billing/refund_repository.rb'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      (symbol.kind === 'function' || symbol.kind === 'method')
      && symbol.name === 'approve_refund'
      && symbol.path === 'app/repositories/billing/refund_repository.rb'
    ));

    expect(route).toBeDefined();
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(serviceMethod).toBeDefined();
    expect(repository).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses RefundService',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls RefundService.approve_refund',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repository?.id}`,
        label: 'uses RefundRepository',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls RefundRepository.approve_refund',
      }),
    ]));
  });

  test('links Rails explicit controller-path routes to nested controller actions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-rails-controller-path-'));
    await mkdir(join(root, 'app/controllers/admin'), { recursive: true });
    await mkdir(join(root, 'app/services/billing'), { recursive: true });
    await mkdir(join(root, 'config'), { recursive: true });

    await writeFile(
      join(root, 'config/routes.rb'),
      [
        'Rails.application.routes.draw do',
        '  post "/api/v1/admin/billing/refunds/:refund_id/approve", to: "admin/billing#approve_refund"',
        'end',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/controllers/admin/billing_controller.rb'),
      [
        'require_dependency "billing/refund_service"',
        'class Admin::BillingController < ApplicationController',
        '  def approve_refund',
        '    service = Billing::RefundService.new',
        '    render json: service.approve_refund(params[:refund_id])',
        '  end',
        'end',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/services/billing/refund_service.rb'),
      [
        'class Billing::RefundService',
        '  def approve_refund(refund_id)',
        '    refund_id',
        '  end',
        'end',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_rails_controller_path',
      workflowRunId: 'run_rails_controller_path',
      repoRoot: root,
      generatedAt: '2026-07-03T14:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 10,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v1/admin/billing/refunds/:refund_id/approve'
    ));
    const handler = inventory.symbols.find((symbol) => (
      (symbol.kind === 'function' || symbol.kind === 'method')
      && symbol.name === 'approve_refund'
      && symbol.path === 'app/controllers/admin/billing_controller.rb'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'RefundService'
      && symbol.path === 'app/services/billing/refund_service.rb'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      (symbol.kind === 'function' || symbol.kind === 'method')
      && symbol.name === 'approve_refund'
      && symbol.path === 'app/services/billing/refund_service.rb'
    ));

    expect(route).toMatchObject({ handler: 'admin/BillingController#approve_refund' });
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(serviceMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
        label: 'route handler admin/BillingController#approve_refund',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses RefundService',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls RefundService.approve_refund',
      }),
    ]));
  });

  test('links Flask route handlers to constructed Python service and repository methods', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-flask-service-graph-'));
    await mkdir(join(root, 'aaa_shadow/services'), { recursive: true });
    await mkdir(join(root, 'legacy_billing/services'), { recursive: true });
    await mkdir(join(root, 'legacy_billing/repositories'), { recursive: true });

    await writeFile(
      join(root, 'aaa_shadow/services/billing_service.py'),
      [
        'class BillingService:',
        '    def reconcile(self, invoice_id):',
        '        return "wrong service"',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/app.py'),
      [
        'from flask import Flask',
        'from .services.billing_service import BillingService',
        'app = Flask(__name__)',
        '',
        '@app.route("/api/v1/billing/invoices/<invoice_id>/reconcile", methods=["POST"])',
        'def reconcile_invoice(invoice_id):',
        '    service = BillingService()',
        '    return service.reconcile(invoice_id)',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/services/billing_service.py'),
      [
        'from ..repositories.billing_repository import BillingRepository',
        '',
        'class BillingService:',
        '    def reconcile(self, invoice_id):',
        '        repository = BillingRepository()',
        '        return repository.mark_reconciled(invoice_id)',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/repositories/billing_repository.py'),
      [
        'class BillingRepository:',
        '    def mark_reconciled(self, invoice_id):',
        '        return invoice_id',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_flask_service_graph',
      workflowRunId: 'run_flask_service_graph',
      repoRoot: root,
      generatedAt: '2026-07-02T01:10:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 10,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v1/billing/invoices/<invoice_id>/reconcile'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'reconcile_invoice'
      && symbol.path === 'legacy_billing/app.py'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingService'
      && symbol.path === 'legacy_billing/services/billing_service.py'
    ));
    const shadowService = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingService'
      && symbol.path === 'aaa_shadow/services/billing_service.py'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'reconcile'
      && symbol.path === 'legacy_billing/services/billing_service.py'
    ));
    const repository = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingRepository'
      && symbol.path === 'legacy_billing/repositories/billing_repository.py'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'mark_reconciled'
      && symbol.path === 'legacy_billing/repositories/billing_repository.py'
    ));

    expect(route).toBeDefined();
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(shadowService).toBeDefined();
    expect(serviceMethod).toBeDefined();
    expect(repository).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses BillingService',
        sourceRefs: expect.arrayContaining([
          'file:legacy_billing/app.py#L2',
          'file:legacy_billing/app.py#L7',
          'file:legacy_billing/app.py#L8',
          'file:legacy_billing/services/billing_service.py#L3',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls BillingService.reconcile',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repository?.id}`,
        label: 'uses BillingRepository',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingRepository.mark_reconciled',
      }),
    ]));
    expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${shadowService?.id}`,
      }),
    ]));

    const billingCapability = inventory.capabilities.find((capability) => capability.id === 'cap_api_billing');
    expect(billingCapability).toMatchObject({ label: 'Billing API' });
    expect(billingCapability?.symbolRefs).toEqual(expect.arrayContaining([
      handler?.id,
      service?.id,
      serviceMethod?.id,
      repository?.id,
      repositoryMethod?.id,
    ]));
  });

  test('links Flask route handlers through relative Python module imports', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-flask-relative-module-graph-'));
    await mkdir(join(root, 'aaa_shadow/services'), { recursive: true });
    await mkdir(join(root, 'legacy_billing/services'), { recursive: true });
    await mkdir(join(root, 'legacy_billing/repositories'), { recursive: true });

    await writeFile(
      join(root, 'aaa_shadow/services/billing_service.py'),
      [
        'class BillingService:',
        '    def reconcile(self, invoice_id):',
        '        return "wrong service"',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/app.py'),
      [
        'from flask import Flask',
        'from .services import billing_service',
        'app = Flask(__name__)',
        '',
        '@app.post("/api/v1/billing/invoices/<invoice_id>/reconcile")',
        'def reconcile_invoice(invoice_id):',
        '    service = billing_service.BillingService()',
        '    return service.reconcile(invoice_id)',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/services/billing_service.py'),
      [
        'from ..repositories import billing_repository',
        '',
        'class BillingService:',
        '    def reconcile(self, invoice_id):',
        '        repository = billing_repository.BillingRepository()',
        '        return repository.mark_reconciled(invoice_id)',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/repositories/billing_repository.py'),
      [
        'class BillingRepository:',
        '    def mark_reconciled(self, invoice_id):',
        '        return invoice_id',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_flask_relative_module_graph',
      workflowRunId: 'run_flask_relative_module_graph',
      repoRoot: root,
      generatedAt: '2026-07-02T01:15:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 10,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v1/billing/invoices/<invoice_id>/reconcile'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'reconcile_invoice'
      && symbol.path === 'legacy_billing/app.py'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingService'
      && symbol.path === 'legacy_billing/services/billing_service.py'
    ));
    const shadowService = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingService'
      && symbol.path === 'aaa_shadow/services/billing_service.py'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'reconcile'
      && symbol.path === 'legacy_billing/services/billing_service.py'
    ));
    const repository = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingRepository'
      && symbol.path === 'legacy_billing/repositories/billing_repository.py'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'mark_reconciled'
      && symbol.path === 'legacy_billing/repositories/billing_repository.py'
    ));

    expect(route).toBeDefined();
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(shadowService).toBeDefined();
    expect(serviceMethod).toBeDefined();
    expect(repository).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses BillingService',
        sourceRefs: expect.arrayContaining([
          'file:legacy_billing/app.py#L2',
          'file:legacy_billing/app.py#L7',
          'file:legacy_billing/app.py#L8',
          'file:legacy_billing/services/billing_service.py#L3',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls BillingService.reconcile',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repository?.id}`,
        label: 'uses BillingRepository',
        sourceRefs: expect.arrayContaining([
          'file:legacy_billing/services/billing_service.py#L1',
          'file:legacy_billing/services/billing_service.py#L5',
          'file:legacy_billing/services/billing_service.py#L6',
          'file:legacy_billing/repositories/billing_repository.py#L1',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingRepository.mark_reconciled',
      }),
    ]));
    expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${shadowService?.id}`,
      }),
    ]));
  });

  test('links Flask route handlers through relative Python package re-exports', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-flask-relative-reexport-graph-'));
    await mkdir(join(root, 'aaa_shadow/services'), { recursive: true });
    await mkdir(join(root, 'legacy_billing/services'), { recursive: true });
    await mkdir(join(root, 'legacy_billing/repositories'), { recursive: true });

    await writeFile(
      join(root, 'aaa_shadow/services/billing_service.py'),
      [
        'class BillingService:',
        '    def reconcile(self, invoice_id):',
        '        return "wrong service"',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/app.py'),
      [
        'from flask import Flask',
        'from .services import BillingService',
        'app = Flask(__name__)',
        '',
        '@app.post("/api/v1/billing/invoices/<invoice_id>/reconcile")',
        'def reconcile_invoice(invoice_id):',
        '    service = BillingService()',
        '    return service.reconcile(invoice_id)',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/services/__init__.py'),
      [
        'from .billing_service import BillingService',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/services/billing_service.py'),
      [
        'from ..repositories import BillingRepository',
        '',
        'class BillingService:',
        '    def reconcile(self, invoice_id):',
        '        repository = BillingRepository()',
        '        return repository.mark_reconciled(invoice_id)',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/repositories/__init__.py'),
      [
        'from .billing_repository import BillingRepository',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/repositories/billing_repository.py'),
      [
        'class BillingRepository:',
        '    def mark_reconciled(self, invoice_id):',
        '        return invoice_id',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_flask_relative_reexport_graph',
      workflowRunId: 'run_flask_relative_reexport_graph',
      repoRoot: root,
      generatedAt: '2026-07-02T01:20:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 12,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v1/billing/invoices/<invoice_id>/reconcile'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'reconcile_invoice'
      && symbol.path === 'legacy_billing/app.py'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingService'
      && symbol.path === 'legacy_billing/services/billing_service.py'
    ));
    const shadowService = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingService'
      && symbol.path === 'aaa_shadow/services/billing_service.py'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'reconcile'
      && symbol.path === 'legacy_billing/services/billing_service.py'
    ));
    const repository = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingRepository'
      && symbol.path === 'legacy_billing/repositories/billing_repository.py'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'mark_reconciled'
      && symbol.path === 'legacy_billing/repositories/billing_repository.py'
    ));

    expect(route).toBeDefined();
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(shadowService).toBeDefined();
    expect(serviceMethod).toBeDefined();
    expect(repository).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses BillingService',
        sourceRefs: expect.arrayContaining([
          'file:legacy_billing/app.py#L2',
          'file:legacy_billing/app.py#L7',
          'file:legacy_billing/app.py#L8',
          'file:legacy_billing/services/__init__.py#L1',
          'file:legacy_billing/services/billing_service.py#L3',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls BillingService.reconcile',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repository?.id}`,
        label: 'uses BillingRepository',
        sourceRefs: expect.arrayContaining([
          'file:legacy_billing/services/billing_service.py#L1',
          'file:legacy_billing/services/billing_service.py#L5',
          'file:legacy_billing/services/billing_service.py#L6',
          'file:legacy_billing/repositories/__init__.py#L1',
          'file:legacy_billing/repositories/billing_repository.py#L1',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingRepository.mark_reconciled',
      }),
    ]));
    expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${shadowService?.id}`,
      }),
    ]));
  });

  test('links Flask route handlers through relative Python package namespace re-exports', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-flask-relative-package-reexport-'));
    await mkdir(join(root, 'aaa_shadow/services'), { recursive: true });
    await mkdir(join(root, 'legacy_billing/services'), { recursive: true });
    await mkdir(join(root, 'legacy_billing/repositories'), { recursive: true });

    await writeFile(
      join(root, 'aaa_shadow/services/billing_service.py'),
      [
        'class BillingService:',
        '    def reconcile(self, invoice_id):',
        '        return "wrong service"',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/app.py'),
      [
        'from flask import Flask',
        'from . import services',
        'app = Flask(__name__)',
        '',
        '@app.post("/api/v1/billing/invoices/<invoice_id>/reconcile")',
        'def reconcile_invoice(invoice_id):',
        '    service = services.BillingService()',
        '    return service.reconcile(invoice_id)',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/services/__init__.py'),
      [
        'from .billing_service import BillingService',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/services/billing_service.py'),
      [
        'from .. import repositories',
        '',
        'class BillingService:',
        '    def reconcile(self, invoice_id):',
        '        repository = repositories.BillingRepository()',
        '        return repository.mark_reconciled(invoice_id)',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/repositories/__init__.py'),
      [
        'from .billing_repository import BillingRepository',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/repositories/billing_repository.py'),
      [
        'class BillingRepository:',
        '    def mark_reconciled(self, invoice_id):',
        '        return invoice_id',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_flask_relative_package_reexport',
      workflowRunId: 'run_flask_relative_package_reexport',
      repoRoot: root,
      generatedAt: '2026-07-02T01:25:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 12,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v1/billing/invoices/<invoice_id>/reconcile'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'reconcile_invoice'
      && symbol.path === 'legacy_billing/app.py'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingService'
      && symbol.path === 'legacy_billing/services/billing_service.py'
    ));
    const shadowService = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingService'
      && symbol.path === 'aaa_shadow/services/billing_service.py'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'reconcile'
      && symbol.path === 'legacy_billing/services/billing_service.py'
    ));
    const repository = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingRepository'
      && symbol.path === 'legacy_billing/repositories/billing_repository.py'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'mark_reconciled'
      && symbol.path === 'legacy_billing/repositories/billing_repository.py'
    ));

    expect(route).toBeDefined();
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(shadowService).toBeDefined();
    expect(serviceMethod).toBeDefined();
    expect(repository).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses BillingService',
        sourceRefs: expect.arrayContaining([
          'file:legacy_billing/app.py#L2',
          'file:legacy_billing/app.py#L7',
          'file:legacy_billing/app.py#L8',
          'file:legacy_billing/services/__init__.py#L1',
          'file:legacy_billing/services/billing_service.py#L3',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls BillingService.reconcile',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repository?.id}`,
        label: 'uses BillingRepository',
        sourceRefs: expect.arrayContaining([
          'file:legacy_billing/services/billing_service.py#L1',
          'file:legacy_billing/services/billing_service.py#L5',
          'file:legacy_billing/services/billing_service.py#L6',
          'file:legacy_billing/repositories/__init__.py#L1',
          'file:legacy_billing/repositories/billing_repository.py#L1',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingRepository.mark_reconciled',
      }),
    ]));
    expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${shadowService?.id}`,
      }),
    ]));
  });

  test('links Flask route handlers through absolute Python package namespace re-exports', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-flask-absolute-package-reexport-'));
    await mkdir(join(root, 'aaa_shadow/services'), { recursive: true });
    await mkdir(join(root, 'legacy_billing/services'), { recursive: true });
    await mkdir(join(root, 'legacy_billing/repositories'), { recursive: true });

    await writeFile(
      join(root, 'aaa_shadow/services/billing_service.py'),
      [
        'class BillingService:',
        '    def reconcile(self, invoice_id):',
        '        return "wrong service"',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/app.py'),
      [
        'from flask import Flask',
        'from legacy_billing import services',
        'app = Flask(__name__)',
        '',
        '@app.post("/api/v1/billing/invoices/<invoice_id>/reconcile")',
        'def reconcile_invoice(invoice_id):',
        '    service = services.BillingService()',
        '    return service.reconcile(invoice_id)',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/services/__init__.py'),
      [
        'from .billing_service import BillingService',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/services/billing_service.py'),
      [
        'from legacy_billing import repositories',
        '',
        'class BillingService:',
        '    def reconcile(self, invoice_id):',
        '        repository = repositories.BillingRepository()',
        '        return repository.mark_reconciled(invoice_id)',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/repositories/__init__.py'),
      [
        'from .billing_repository import BillingRepository',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/repositories/billing_repository.py'),
      [
        'class BillingRepository:',
        '    def mark_reconciled(self, invoice_id):',
        '        return invoice_id',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_flask_absolute_package_reexport',
      workflowRunId: 'run_flask_absolute_package_reexport',
      repoRoot: root,
      generatedAt: '2026-07-02T01:30:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 12,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v1/billing/invoices/<invoice_id>/reconcile'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'reconcile_invoice'
      && symbol.path === 'legacy_billing/app.py'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingService'
      && symbol.path === 'legacy_billing/services/billing_service.py'
    ));
    const shadowService = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingService'
      && symbol.path === 'aaa_shadow/services/billing_service.py'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'reconcile'
      && symbol.path === 'legacy_billing/services/billing_service.py'
    ));
    const repository = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingRepository'
      && symbol.path === 'legacy_billing/repositories/billing_repository.py'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'mark_reconciled'
      && symbol.path === 'legacy_billing/repositories/billing_repository.py'
    ));

    expect(route).toBeDefined();
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(shadowService).toBeDefined();
    expect(serviceMethod).toBeDefined();
    expect(repository).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses BillingService',
        sourceRefs: expect.arrayContaining([
          'file:legacy_billing/app.py#L2',
          'file:legacy_billing/app.py#L7',
          'file:legacy_billing/app.py#L8',
          'file:legacy_billing/services/__init__.py#L1',
          'file:legacy_billing/services/billing_service.py#L3',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls BillingService.reconcile',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repository?.id}`,
        label: 'uses BillingRepository',
        sourceRefs: expect.arrayContaining([
          'file:legacy_billing/services/billing_service.py#L1',
          'file:legacy_billing/services/billing_service.py#L5',
          'file:legacy_billing/services/billing_service.py#L6',
          'file:legacy_billing/repositories/__init__.py#L1',
          'file:legacy_billing/repositories/billing_repository.py#L1',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingRepository.mark_reconciled',
      }),
    ]));
    expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${shadowService?.id}`,
      }),
    ]));
  });

  test('links Flask route handlers through conservative Python star imports from local packages', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-flask-star-import-reexport-'));
    await mkdir(join(root, 'aaa_shadow/services'), { recursive: true });
    await mkdir(join(root, 'legacy_billing/services'), { recursive: true });
    await mkdir(join(root, 'legacy_billing/repositories'), { recursive: true });

    await writeFile(
      join(root, 'aaa_shadow/services/billing_service.py'),
      [
        'class BillingService:',
        '    def reconcile(self, invoice_id):',
        '        return "wrong service"',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/app.py'),
      [
        'from flask import Flask',
        'from .services import *',
        'app = Flask(__name__)',
        '',
        '@app.post("/api/v1/billing/invoices/<invoice_id>/reconcile")',
        'def reconcile_invoice(invoice_id):',
        '    service = BillingService()',
        '    return service.reconcile(invoice_id)',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/services/__init__.py'),
      [
        'from .billing_service import BillingService',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/services/billing_service.py'),
      [
        'from ..repositories import *',
        '',
        'class BillingService:',
        '    def reconcile(self, invoice_id):',
        '        repository = BillingRepository()',
        '        return repository.mark_reconciled(invoice_id)',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/repositories/__init__.py'),
      [
        'from .billing_repository import BillingRepository',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/repositories/billing_repository.py'),
      [
        'class BillingRepository:',
        '    def mark_reconciled(self, invoice_id):',
        '        return invoice_id',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_flask_star_import_reexport',
      workflowRunId: 'run_flask_star_import_reexport',
      repoRoot: root,
      generatedAt: '2026-07-02T01:35:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 12,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v1/billing/invoices/<invoice_id>/reconcile'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'reconcile_invoice'
      && symbol.path === 'legacy_billing/app.py'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingService'
      && symbol.path === 'legacy_billing/services/billing_service.py'
    ));
    const shadowService = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingService'
      && symbol.path === 'aaa_shadow/services/billing_service.py'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'reconcile'
      && symbol.path === 'legacy_billing/services/billing_service.py'
    ));
    const repository = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingRepository'
      && symbol.path === 'legacy_billing/repositories/billing_repository.py'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'mark_reconciled'
      && symbol.path === 'legacy_billing/repositories/billing_repository.py'
    ));

    expect(route).toBeDefined();
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(shadowService).toBeDefined();
    expect(serviceMethod).toBeDefined();
    expect(repository).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses BillingService',
        sourceRefs: expect.arrayContaining([
          'file:legacy_billing/app.py#L2',
          'file:legacy_billing/app.py#L7',
          'file:legacy_billing/app.py#L8',
          'file:legacy_billing/services/__init__.py#L1',
          'file:legacy_billing/services/billing_service.py#L3',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls BillingService.reconcile',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repository?.id}`,
        label: 'uses BillingRepository',
        sourceRefs: expect.arrayContaining([
          'file:legacy_billing/services/billing_service.py#L1',
          'file:legacy_billing/services/billing_service.py#L5',
          'file:legacy_billing/services/billing_service.py#L6',
          'file:legacy_billing/repositories/__init__.py#L1',
          'file:legacy_billing/repositories/billing_repository.py#L1',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingRepository.mark_reconciled',
      }),
    ]));
    expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${shadowService?.id}`,
      }),
    ]));
  });

  test('links Flask route handlers through Python star-imported local module namespaces', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-flask-star-module-import-'));
    await mkdir(join(root, 'aaa_shadow/services'), { recursive: true });
    await mkdir(join(root, 'legacy_billing/services'), { recursive: true });
    await mkdir(join(root, 'legacy_billing/repositories'), { recursive: true });

    await writeFile(
      join(root, 'aaa_shadow/services/billing_service.py'),
      [
        'class BillingService:',
        '    def reconcile(self, invoice_id):',
        '        return "wrong service"',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/app.py'),
      [
        'from flask import Flask',
        'from .services import *',
        'app = Flask(__name__)',
        '',
        '@app.post("/api/v1/billing/invoices/<invoice_id>/reconcile")',
        'def reconcile_invoice(invoice_id):',
        '    service = billing_service.BillingService()',
        '    return service.reconcile(invoice_id)',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/services/__init__.py'),
      [
        'from . import billing_service',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/services/billing_service.py'),
      [
        'from ..repositories import *',
        '',
        'class BillingService:',
        '    def reconcile(self, invoice_id):',
        '        repository = billing_repository.BillingRepository()',
        '        return repository.mark_reconciled(invoice_id)',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/repositories/__init__.py'),
      [
        'from . import billing_repository',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/repositories/billing_repository.py'),
      [
        'class BillingRepository:',
        '    def mark_reconciled(self, invoice_id):',
        '        return invoice_id',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_flask_star_module_import',
      workflowRunId: 'run_flask_star_module_import',
      repoRoot: root,
      generatedAt: '2026-07-02T01:40:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 12,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v1/billing/invoices/<invoice_id>/reconcile'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'reconcile_invoice'
      && symbol.path === 'legacy_billing/app.py'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingService'
      && symbol.path === 'legacy_billing/services/billing_service.py'
    ));
    const shadowService = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingService'
      && symbol.path === 'aaa_shadow/services/billing_service.py'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'reconcile'
      && symbol.path === 'legacy_billing/services/billing_service.py'
    ));
    const repository = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingRepository'
      && symbol.path === 'legacy_billing/repositories/billing_repository.py'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'mark_reconciled'
      && symbol.path === 'legacy_billing/repositories/billing_repository.py'
    ));

    expect(route).toBeDefined();
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(shadowService).toBeDefined();
    expect(serviceMethod).toBeDefined();
    expect(repository).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses BillingService',
        sourceRefs: expect.arrayContaining([
          'file:legacy_billing/app.py#L2',
          'file:legacy_billing/app.py#L7',
          'file:legacy_billing/app.py#L8',
          'file:legacy_billing/services/__init__.py#L1',
          'file:legacy_billing/services/billing_service.py#L3',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls BillingService.reconcile',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repository?.id}`,
        label: 'uses BillingRepository',
        sourceRefs: expect.arrayContaining([
          'file:legacy_billing/services/billing_service.py#L1',
          'file:legacy_billing/services/billing_service.py#L5',
          'file:legacy_billing/services/billing_service.py#L6',
          'file:legacy_billing/repositories/__init__.py#L1',
          'file:legacy_billing/repositories/billing_repository.py#L1',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingRepository.mark_reconciled',
      }),
    ]));
    expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${shadowService?.id}`,
      }),
    ]));
  });

  test('links Flask add_url_rule MethodView routes to service and repository methods', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-flask-method-view-'));
    await mkdir(join(root, 'legacy_billing/services'), { recursive: true });
    await mkdir(join(root, 'legacy_billing/repositories'), { recursive: true });

    await writeFile(
      join(root, 'legacy_billing/app.py'),
      [
        'from flask import Flask',
        'from flask.views import MethodView',
        'from .services.billing_service import BillingService',
        'app = Flask(__name__)',
        '',
        'class BillingRefundView(MethodView):',
        '    def post(self, refund_id):',
        '        service = BillingService()',
        '        return service.approve_refund(refund_id)',
        '',
        'app.add_url_rule(',
        '    "/api/v1/billing/refunds/<refund_id>/approve",',
        '    view_func=BillingRefundView.as_view("billing_refund"),',
        '    methods=["POST"],',
        ')',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/services/billing_service.py'),
      [
        'from ..repositories.billing_repository import BillingRepository',
        '',
        'class BillingService:',
        '    def approve_refund(self, refund_id):',
        '        repository = BillingRepository()',
        '        return repository.approve_refund(refund_id)',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/repositories/billing_repository.py'),
      [
        'class BillingRepository:',
        '    def approve_refund(self, refund_id):',
        '        return refund_id',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_flask_method_view',
      workflowRunId: 'run_flask_method_view',
      repoRoot: root,
      generatedAt: '2026-07-03T16:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 10,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v1/billing/refunds/<refund_id>/approve'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'post'
      && symbol.path === 'legacy_billing/app.py'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingService'
      && symbol.path === 'legacy_billing/services/billing_service.py'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'approve_refund'
      && symbol.path === 'legacy_billing/services/billing_service.py'
    ));
    const repository = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingRepository'
      && symbol.path === 'legacy_billing/repositories/billing_repository.py'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'approve_refund'
      && symbol.path === 'legacy_billing/repositories/billing_repository.py'
    ));

    expect(route).toMatchObject({
      handler: 'BillingRefundView.post',
      sourceRefs: expect.arrayContaining(['file:legacy_billing/app.py#L11']),
    });
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(serviceMethod).toBeDefined();
    expect(repository).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
        label: 'route handler BillingRefundView.post',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses BillingService',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls BillingService.approve_refund',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repository?.id}`,
        label: 'uses BillingRepository',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingRepository.approve_refund',
      }),
    ]));
  });

  test('links Flask MethodView constructor-injected Python receivers through imported types', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-flask-method-view-injected-'));
    await mkdir(join(root, 'aaa_shadow'), { recursive: true });
    await mkdir(join(root, 'legacy_billing'), { recursive: true });

    await writeFile(
      join(root, 'aaa_shadow/workflows.py'),
      [
        'class BillingWorkflow:',
        '    def approve(self, invoice_id):',
        '        return "wrong workflow"',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/app.py'),
      [
        'from flask import Flask',
        'from flask.views import MethodView',
        'from .workflows import BillingWorkflow',
        'app = Flask(__name__)',
        '',
        'class BillingApprovalView(MethodView):',
        '    def __init__(self, workflow: BillingWorkflow):',
        '        self.workflow = workflow',
        '',
        '    def post(self, invoice_id):',
        '        return self.workflow.approve(invoice_id)',
        '',
        'app.add_url_rule(',
        '    "/api/v1/billing/invoices/<invoice_id>/approve",',
        '    view_func=BillingApprovalView.as_view("billing_approval"),',
        '    methods=["POST"],',
        ')',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/workflows.py'),
      [
        'from .repositories import BillingRepository',
        '',
        'class BillingWorkflow:',
        '    def __init__(self, repository: BillingRepository):',
        '        self.repository = repository',
        '',
        '    def approve(self, invoice_id):',
        '        return self.repository.persist_approval(invoice_id)',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/repositories.py'),
      [
        'class BillingRepository:',
        '    def persist_approval(self, invoice_id):',
        '        return invoice_id',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_flask_method_view_injected',
      workflowRunId: 'run_flask_method_view_injected',
      repoRoot: root,
      generatedAt: '2026-07-04T09:30:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 10,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v1/billing/invoices/<invoice_id>/approve'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'post'
      && symbol.path === 'legacy_billing/app.py'
    ));
    const workflow = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingWorkflow'
      && symbol.path === 'legacy_billing/workflows.py'
    ));
    const shadowWorkflow = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingWorkflow'
      && symbol.path === 'aaa_shadow/workflows.py'
    ));
    const workflowMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'approve'
      && symbol.path === 'legacy_billing/workflows.py'
    ));
    const repository = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingRepository'
      && symbol.path === 'legacy_billing/repositories.py'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'persist_approval'
      && symbol.path === 'legacy_billing/repositories.py'
    ));

    expect(route).toMatchObject({
      handler: 'BillingApprovalView.post',
      sourceRefs: expect.arrayContaining(['file:legacy_billing/app.py#L13']),
    });
    expect(handler).toBeDefined();
    expect(workflow).toBeDefined();
    expect(shadowWorkflow).toBeDefined();
    expect(workflowMethod).toBeDefined();
    expect(repository).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
        label: 'route handler BillingApprovalView.post',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${workflow?.id}`,
        label: 'uses BillingWorkflow',
        sourceRefs: expect.arrayContaining([
          'file:legacy_billing/app.py#L3',
          'file:legacy_billing/app.py#L7',
          'file:legacy_billing/app.py#L8',
          'file:legacy_billing/app.py#L11',
          'file:legacy_billing/workflows.py#L3',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${workflowMethod?.id}`,
        label: 'calls BillingWorkflow.approve',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${workflowMethod?.id}`,
        to: `node_symbol_${repository?.id}`,
        label: 'uses BillingRepository',
        sourceRefs: expect.arrayContaining([
          'file:legacy_billing/workflows.py#L1',
          'file:legacy_billing/workflows.py#L4',
          'file:legacy_billing/workflows.py#L5',
          'file:legacy_billing/workflows.py#L8',
          'file:legacy_billing/repositories.py#L1',
        ]),
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${workflowMethod?.id}`,
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingRepository.persist_approval',
      }),
    ]));
    expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${shadowWorkflow?.id}`,
      }),
    ]));
  });

  test('links Flask add_url_rule function views to imported handlers and service methods', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-flask-add-url-rule-function-'));
    await mkdir(join(root, 'legacy_billing/services'), { recursive: true });
    await mkdir(join(root, 'legacy_billing/repositories'), { recursive: true });

    await writeFile(
      join(root, 'legacy_billing/app.py'),
      [
        'from flask import Flask',
        'from .views import approve_refund',
        'app = Flask(__name__)',
        '',
        'app.add_url_rule(',
        '    "/api/v1/billing/refunds/<refund_id>/approve",',
        '    view_func=approve_refund,',
        '    methods=["POST"],',
        ')',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/views.py'),
      [
        'from .services.billing_service import BillingService',
        '',
        'def approve_refund(refund_id):',
        '    service = BillingService()',
        '    return service.approve_refund(refund_id)',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/services/billing_service.py'),
      [
        'from ..repositories.billing_repository import BillingRepository',
        '',
        'class BillingService:',
        '    def approve_refund(self, refund_id):',
        '        repository = BillingRepository()',
        '        return repository.approve_refund(refund_id)',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/repositories/billing_repository.py'),
      [
        'class BillingRepository:',
        '    def approve_refund(self, refund_id):',
        '        return refund_id',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_flask_add_url_rule_function',
      workflowRunId: 'run_flask_add_url_rule_function',
      repoRoot: root,
      generatedAt: '2026-07-03T17:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 10,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v1/billing/refunds/<refund_id>/approve'
    ));
    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'approve_refund'
      && symbol.path === 'legacy_billing/views.py'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingService'
      && symbol.path === 'legacy_billing/services/billing_service.py'
    ));
    const serviceMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'approve_refund'
      && symbol.path === 'legacy_billing/services/billing_service.py'
    ));
    const repository = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingRepository'
      && symbol.path === 'legacy_billing/repositories/billing_repository.py'
    ));
    const repositoryMethod = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'approve_refund'
      && symbol.path === 'legacy_billing/repositories/billing_repository.py'
    ));

    expect(route).toMatchObject({
      handler: 'approve_refund',
      sourceRefs: expect.arrayContaining(['file:legacy_billing/app.py#L5']),
    });
    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(serviceMethod).toBeDefined();
    expect(repository).toBeDefined();
    expect(repositoryMethod).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${handler?.id}`,
        label: 'route handler approve_refund',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses BillingService',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${serviceMethod?.id}`,
        label: 'calls BillingService.approve_refund',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repository?.id}`,
        label: 'uses BillingRepository',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${serviceMethod?.id}`,
        to: `node_symbol_${repositoryMethod?.id}`,
        label: 'calls BillingRepository.approve_refund',
      }),
    ]));
  });

  test('honors Python __all__ while expanding star-imported package namespaces', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-flask-star-all-filter-'));
    await mkdir(join(root, 'legacy_billing/services'), { recursive: true });

    await writeFile(
      join(root, 'legacy_billing/app.py'),
      [
        'from flask import Flask',
        'from .services import *',
        'app = Flask(__name__)',
        '',
        '@app.post("/api/v1/billing/invoices/<invoice_id>/reconcile")',
        'def reconcile_invoice(invoice_id):',
        '    service = billing_service.BillingService()',
        '    admin = admin_service.AdminService()',
        '    return service.reconcile(invoice_id)',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/services/__init__.py'),
      [
        'from . import billing_service',
        'from . import admin_service',
        '__all__ = ["billing_service"]',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/services/billing_service.py'),
      [
        'class BillingService:',
        '    def reconcile(self, invoice_id):',
        '        return invoice_id',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/services/admin_service.py'),
      [
        'class AdminService:',
        '    def purge(self):',
        '        return "admin"',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_flask_star_all_filter',
      workflowRunId: 'run_flask_star_all_filter',
      repoRoot: root,
      generatedAt: '2026-07-02T01:45:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 8,
      },
    });

    const handler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'reconcile_invoice'
      && symbol.path === 'legacy_billing/app.py'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingService'
      && symbol.path === 'legacy_billing/services/billing_service.py'
    ));
    const adminService = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'AdminService'
      && symbol.path === 'legacy_billing/services/admin_service.py'
    ));

    expect(handler).toBeDefined();
    expect(service).toBeDefined();
    expect(adminService).toBeDefined();
    expect(inventory.imports).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'legacy_billing/app.py',
        namespaceImport: 'billing_service',
        targetPath: 'legacy_billing/services/billing_service.py',
      }),
    ]));
    expect(inventory.imports).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'legacy_billing/app.py',
        namespaceImport: 'admin_service',
        targetPath: 'legacy_billing/services/admin_service.py',
      }),
    ]));
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses BillingService',
      }),
    ]));
    expect(inventory.symbolGraph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${handler?.id}`,
        to: `node_symbol_${adminService?.id}`,
      }),
    ]));
  });

  test('combines imported Flask Blueprint and FastAPI APIRouter mount prefixes with route graph evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-python-cross-file-mounts-'));
    await mkdir(join(root, 'legacy_billing/services'), { recursive: true });
    await mkdir(join(root, 'legacy_billing/repositories'), { recursive: true });
    await mkdir(join(root, 'legacy_orders'), { recursive: true });

    await writeFile(
      join(root, 'app.py'),
      [
        'from flask import Flask',
        'from legacy_billing.routes import billing_bp',
        'from legacy_orders.routes import orders_router',
        'app = Flask(__name__)',
        'app.register_blueprint(billing_bp, url_prefix="/legacy/billing")',
        'app.include_router(orders_router, prefix="/api/v2")',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/routes.py'),
      [
        'from flask import Blueprint',
        'from legacy_billing.services.billing_service import BillingService',
        'billing_bp = Blueprint("billing", __name__)',
        '@billing_bp.post("/statements/<statement_id>/reconcile")',
        'def reconcile_statement(statement_id):',
        '    service = BillingService()',
        '    return service.reconcile(statement_id)',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/services/billing_service.py'),
      [
        'from legacy_billing.repositories.billing_repository import BillingRepository',
        '',
        'class BillingService:',
        '    def reconcile(self, statement_id):',
        '        repository = BillingRepository()',
        '        return repository.mark_reconciled(statement_id)',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_billing/repositories/billing_repository.py'),
      [
        'class BillingRepository:',
        '    def mark_reconciled(self, statement_id):',
        '        return statement_id',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'legacy_orders/routes.py'),
      [
        'from fastapi import APIRouter',
        'orders_router = APIRouter(prefix="/orders")',
        '@orders_router.get("/{order_id}")',
        'def show_order(order_id):',
        '    return {"order_id": order_id}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_python_cross_file_mounts',
      workflowRunId: 'run_python_cross_file_mounts',
      repoRoot: root,
      generatedAt: '2026-07-02T02:20:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 16384,
        maxCapturedFiles: 20,
      },
    });

    const flaskRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/legacy/billing/statements/<statement_id>/reconcile'
    ));
    const fastApiRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/v2/orders/{order_id}'
    ));
    const flaskHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'reconcile_statement'
      && symbol.path === 'legacy_billing/routes.py'
    ));
    const fastApiHandler = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'show_order'
      && symbol.path === 'legacy_orders/routes.py'
    ));
    const service = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingService'
      && symbol.path === 'legacy_billing/services/billing_service.py'
    ));
    const repository = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'BillingRepository'
      && symbol.path === 'legacy_billing/repositories/billing_repository.py'
    ));

    expect(flaskRoute).toMatchObject({
      path: 'legacy_billing/routes.py',
      handler: 'reconcile_statement',
      sourceRefs: expect.arrayContaining([
        'file:legacy_billing/routes.py#L3',
        'file:legacy_billing/routes.py#L4',
        'file:app.py#L2',
        'file:app.py#L5',
      ]),
    });
    expect(fastApiRoute).toMatchObject({
      path: 'legacy_orders/routes.py',
      handler: 'show_order',
      sourceRefs: expect.arrayContaining([
        'file:legacy_orders/routes.py#L2',
        'file:legacy_orders/routes.py#L3',
        'file:app.py#L3',
        'file:app.py#L6',
      ]),
    });
    expect(inventory.entrypoints.map((entrypoint) => `${entrypoint.method} ${entrypoint.route}`)).not.toEqual(
      expect.arrayContaining([
        'POST /statements/<statement_id>/reconcile',
        'GET /orders/{order_id}',
      ]),
    );
    expect(flaskHandler).toBeDefined();
    expect(fastApiHandler).toBeDefined();
    expect(service).toBeDefined();
    expect(repository).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${flaskRoute?.id}`,
        to: `node_symbol_${flaskHandler?.id}`,
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${fastApiRoute?.id}`,
        to: `node_symbol_${fastApiHandler?.id}`,
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${flaskHandler?.id}`,
        to: `node_symbol_${service?.id}`,
        label: 'uses BillingService',
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        to: `node_symbol_${repository?.id}`,
        label: 'uses BillingRepository',
      }),
    ]));
  });

  test('links Django class-based view routes to sibling view classes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-django-class-view-'));
    await mkdir(join(root, 'shipments'), { recursive: true });

    await writeFile(
      join(root, 'shipments/urls.py'),
      [
        'from django.urls import path',
        'from . import views',
        'from .views import TrackShipmentView',
        '',
        'urlpatterns = [',
        '    path("shipments/<int:shipment_id>/track", TrackShipmentView.as_view()),',
        '    path("shipments/<int:shipment_id>/audit", views.ShipmentAuditView.as_view()),',
        ']',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'shipments/views.py'),
      [
        'class TrackShipmentView:',
        '    def get(self, request, shipment_id):',
        '        return None',
        '',
        'class ShipmentAuditView:',
        '    def get(self, request, shipment_id):',
        '        return None',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_django_class_view',
      workflowRunId: 'run_django_class_view',
      repoRoot: root,
      generatedAt: '2026-07-02T03:30:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 10,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'ANY'
      && entrypoint.route === '/shipments/<int:shipment_id>/track'
    ));
    const auditRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'ANY'
      && entrypoint.route === '/shipments/<int:shipment_id>/audit'
    ));
    const viewClass = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'TrackShipmentView'
      && symbol.path === 'shipments/views.py'
    ));
    const auditViewClass = inventory.symbols.find((symbol) => (
      symbol.kind === 'class'
      && symbol.name === 'ShipmentAuditView'
      && symbol.path === 'shipments/views.py'
    ));

    expect(route).toMatchObject({ handler: 'TrackShipmentView.as_view' });
    expect(auditRoute).toMatchObject({ handler: 'views.ShipmentAuditView.as_view' });
    expect(viewClass).toBeDefined();
    expect(auditViewClass).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${viewClass?.id}`,
        label: 'route handler TrackShipmentView.as_view',
        sourceRefs: expect.arrayContaining([
          'file:shipments/urls.py#L6',
          'file:shipments/views.py#L1',
        ]),
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${auditRoute?.id}`,
        to: `node_symbol_${auditViewClass?.id}`,
        label: 'route handler views.ShipmentAuditView.as_view',
        sourceRefs: expect.arrayContaining([
          'file:shipments/urls.py#L7',
          'file:shipments/views.py#L5',
        ]),
      }),
    ]));
  });

  test('links directly imported Django function routes to sibling views', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-django-direct-view-'));
    await mkdir(join(root, 'shipments'), { recursive: true });

    await writeFile(
      join(root, 'shipments/urls.py'),
      [
        'from django.urls import path',
        'from .views import shipment_status',
        '',
        'urlpatterns = [',
        '    path("shipments/<int:shipment_id>/status", shipment_status),',
        ']',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'shipments/views.py'),
      [
        'def shipment_status(request, shipment_id):',
        '    return None',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_django_direct_view',
      workflowRunId: 'run_django_direct_view',
      repoRoot: root,
      generatedAt: '2026-07-02T04:05:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 10,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'ANY'
      && entrypoint.route === '/shipments/<int:shipment_id>/status'
    ));
    const viewFunction = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'shipment_status'
      && symbol.path === 'shipments/views.py'
    ));

    expect(route).toMatchObject({ handler: 'shipment_status' });
    expect(viewFunction).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${viewFunction?.id}`,
        label: 'route handler shipment_status',
        sourceRefs: expect.arrayContaining([
          'file:shipments/urls.py#L5',
          'file:shipments/views.py#L1',
        ]),
      }),
    ]));
  });

  test('mounts static Django tuple include URLConfs to child view symbols', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-django-tuple-include-'));
    await mkdir(join(root, 'project'), { recursive: true });
    await mkdir(join(root, 'billing'), { recursive: true });
    await mkdir(join(root, 'customers'), { recursive: true });

    await writeFile(
      join(root, 'project/urls.py'),
      [
        'from django.urls import include, path',
        'customer_urls = "customers.urls"',
        'urlpatterns = [',
        '    path("api/v7/billing/", include((\'billing.urls\', \'billing\'), namespace=\'billing\')),',
        '    path("api/v7/customers/", include((customer_urls, \'customers\'), namespace=\'customers\')),',
        ']',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'billing/urls.py'),
      [
        'from django.urls import path',
        'from . import views',
        'urlpatterns = [',
        '    path("refunds/<int:refund_id>/approve/", views.approve_refund),',
        ']',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'billing/views.py'),
      [
        'def approve_refund(request, refund_id):',
        '    return None',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'customers/urls.py'),
      [
        'from django.urls import path',
        'from . import views',
        'urlpatterns = [',
        '    path("accounts/", views.customer_accounts),',
        ']',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'customers/views.py'),
      [
        'def customer_accounts(request):',
        '    return None',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_django_tuple_include',
      workflowRunId: 'run_django_tuple_include',
      repoRoot: root,
      generatedAt: '2026-07-03T01:15:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 10,
      },
    });

    const route = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'ANY'
      && entrypoint.route === '/api/v7/billing/refunds/<int:refund_id>/approve/'
    ));
    const dynamicRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.route === '/api/v7/customers/accounts/'
    ));
    const viewFunction = inventory.symbols.find((symbol) => (
      symbol.kind === 'function'
      && symbol.name === 'approve_refund'
      && symbol.path === 'billing/views.py'
    ));

    expect(route).toMatchObject({
      handler: 'views.approve_refund',
      sourceRefs: expect.arrayContaining([
        'file:project/urls.py#L4',
        'file:billing/urls.py#L4',
      ]),
    });
    expect(dynamicRoute).toBeUndefined();
    expect(viewFunction).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${route?.id}`,
        to: `node_symbol_${viewFunction?.id}`,
        label: 'route handler views.approve_refund',
        sourceRefs: expect.arrayContaining([
          'file:project/urls.py#L4',
          'file:billing/urls.py#L4',
          'file:billing/views.py#L1',
        ]),
      }),
    ]));
  });

  test('detects static Rails resources routes inside scope blocks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-rails-resources-'));
    await mkdir(join(root, 'app/controllers'), { recursive: true });
    await mkdir(join(root, 'config'), { recursive: true });

    await writeFile(
      join(root, 'config/routes.rb'),
      [
        'Rails.application.routes.draw do',
        '  scope "/api/v1" do',
        '    resources :reports, only: [:index, :show]',
        '  end',
        'end',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/controllers/reports_controller.rb'),
      [
        'class ReportsController < ApplicationController',
        '  def index',
        '    render json: []',
        '  end',
        '',
        '  def show',
        '    render json: params[:id]',
        '  end',
        'end',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_rails_resources',
      workflowRunId: 'run_rails_resources',
      repoRoot: root,
      generatedAt: '2026-07-02T02:30:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 10,
      },
    });

    const indexRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/v1/reports'
    ));
    const showRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/v1/reports/:id'
    ));
    const createRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v1/reports'
    ));
    const indexSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'index' && symbol.path === 'app/controllers/reports_controller.rb'
    ));
    const showSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'show' && symbol.path === 'app/controllers/reports_controller.rb'
    ));

    expect(indexRoute).toMatchObject({
      handler: 'ReportsController#index',
      sourceRefs: expect.arrayContaining([
        'file:config/routes.rb#L2',
        'file:config/routes.rb#L3',
      ]),
    });
    expect(showRoute).toMatchObject({
      handler: 'ReportsController#show',
      sourceRefs: expect.arrayContaining([
        'file:config/routes.rb#L2',
        'file:config/routes.rb#L3',
      ]),
    });
    expect(createRoute).toBeUndefined();
    expect(indexSymbol).toBeDefined();
    expect(showSymbol).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${indexRoute?.id}`,
        to: `node_symbol_${indexSymbol?.id}`,
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${showRoute?.id}`,
        to: `node_symbol_${showSymbol?.id}`,
      }),
    ]));
    expect(inventory.capabilities.find((capability) => capability.id === 'cap_api_reports')).toMatchObject({
      label: 'Reports API',
    });
  });

  test('detects static Rails singular resource routes inside scope blocks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-rails-singular-resource-'));
    await mkdir(join(root, 'app/controllers'), { recursive: true });
    await mkdir(join(root, 'config'), { recursive: true });

    await writeFile(
      join(root, 'config/routes.rb'),
      [
        'Rails.application.routes.draw do',
        '  scope "/billing" do',
        '    resource :account, only: [:show, :update]',
        '    resource dynamic_resource, only: [:show]',
        '  end',
        'end',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/controllers/accounts_controller.rb'),
      [
        'class AccountsController < ApplicationController',
        '  def show',
        '    render json: {}',
        '  end',
        '',
        '  def update',
        '    render json: {}',
        '  end',
        'end',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_rails_singular_resource',
      workflowRunId: 'run_rails_singular_resource',
      repoRoot: root,
      generatedAt: '2026-07-03T18:15:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 10,
      },
    });

    const showRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/billing/account'
    ));
    const patchRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'PATCH'
      && entrypoint.route === '/billing/account'
    ));
    const putRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'PUT'
      && entrypoint.route === '/billing/account'
    ));
    const idRoute = inventory.entrypoints.find((entrypoint) => entrypoint.route === '/billing/account/:id');
    const dynamicRoute = inventory.entrypoints.find((entrypoint) => entrypoint.route === '/billing/dynamic_resource');
    const showSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'show' && symbol.path === 'app/controllers/accounts_controller.rb'
    ));
    const updateSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'update' && symbol.path === 'app/controllers/accounts_controller.rb'
    ));

    expect(showRoute).toMatchObject({
      handler: 'AccountsController#show',
      sourceRefs: expect.arrayContaining([
        'file:config/routes.rb#L2',
        'file:config/routes.rb#L3',
      ]),
    });
    expect(patchRoute).toMatchObject({
      handler: 'AccountsController#update',
    });
    expect(putRoute).toMatchObject({
      handler: 'AccountsController#update',
    });
    expect(idRoute).toBeUndefined();
    expect(dynamicRoute).toBeUndefined();
    expect(showSymbol).toBeDefined();
    expect(updateSymbol).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${showRoute?.id}`,
        to: `node_symbol_${showSymbol?.id}`,
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${patchRoute?.id}`,
        to: `node_symbol_${updateSymbol?.id}`,
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${putRoute?.id}`,
        to: `node_symbol_${updateSymbol?.id}`,
      }),
    ]));
  });

  test('detects static Rails root routes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-rails-root-routes-'));
    await mkdir(join(root, 'app/controllers/admin'), { recursive: true });
    await mkdir(join(root, 'config'), { recursive: true });

    await writeFile(
      join(root, 'config/routes.rb'),
      [
        'Rails.application.routes.draw do',
        '  root to: "dashboard#index"',
        '  scope "/admin" do',
        '    root "admin/dashboard#show"',
        '    root redirect("/login")',
        '    root to: dynamic_home',
        '  end',
        'end',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/controllers/dashboard_controller.rb'),
      [
        'class DashboardController < ApplicationController',
        '  def index',
        '    render json: {}',
        '  end',
        'end',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/controllers/admin/dashboard_controller.rb'),
      [
        'class Admin::DashboardController < ApplicationController',
        '  def show',
        '    render json: {}',
        '  end',
        'end',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_rails_root_routes',
      workflowRunId: 'run_rails_root_routes',
      repoRoot: root,
      generatedAt: '2026-07-03T17:30:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 10,
      },
    });

    const rootRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/'
    ));
    const adminRootRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/admin'
    ));
    const rootSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'index' && symbol.path === 'app/controllers/dashboard_controller.rb'
    ));
    const adminRootSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'show' && symbol.path === 'app/controllers/admin/dashboard_controller.rb'
    ));

    expect(rootRoute).toMatchObject({
      handler: 'DashboardController#index',
      sourceRefs: ['file:config/routes.rb#L2'],
    });
    expect(adminRootRoute).toMatchObject({
      handler: 'admin/DashboardController#show',
      sourceRefs: expect.arrayContaining([
        'file:config/routes.rb#L3',
        'file:config/routes.rb#L4',
      ]),
    });
    expect(inventory.entrypoints.filter((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/admin'
    ))).toHaveLength(1);
    expect(rootSymbol).toBeDefined();
    expect(adminRootSymbol).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${rootRoute?.id}`,
        to: `node_symbol_${rootSymbol?.id}`,
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${adminRootRoute?.id}`,
        to: `node_symbol_${adminRootSymbol?.id}`,
      }),
    ]));
  });

  test('links static Rails hashrocket route targets to controller actions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-rails-hashrocket-routes-'));
    await mkdir(join(root, 'app/controllers'), { recursive: true });
    await mkdir(join(root, 'config'), { recursive: true });

    await writeFile(
      join(root, 'config/routes.rb'),
      [
        'Rails.application.routes.draw do',
        '  scope "/api/v1" do',
        '    get "/billing/refunds/:id" => "billing#show_refund"',
        '    match "/billing/refunds/:id/reopen" => "billing#reopen_refund", via: :post',
        '    match "/billing/refunds/:id/no-via" => "billing#show_refund"',
        '  end',
        'end',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/controllers/billing_controller.rb'),
      [
        'class BillingController < ApplicationController',
        '  def show_refund',
        '    render json: params[:id]',
        '  end',
        '',
        '  def reopen_refund',
        '    render json: params[:id]',
        '  end',
        'end',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_rails_hashrocket_routes',
      workflowRunId: 'run_rails_hashrocket_routes',
      repoRoot: root,
      generatedAt: '2026-07-03T19:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 10,
      },
    });

    const showRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/v1/billing/refunds/:id'
    ));
    const reopenRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v1/billing/refunds/:id/reopen'
    ));
    const noViaRoute = inventory.entrypoints.find((entrypoint) => entrypoint.route === '/api/v1/billing/refunds/:id/no-via');
    const showSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'show_refund' && symbol.path === 'app/controllers/billing_controller.rb'
    ));
    const reopenSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'reopen_refund' && symbol.path === 'app/controllers/billing_controller.rb'
    ));

    expect(showRoute).toMatchObject({
      handler: 'BillingController#show_refund',
      sourceRefs: expect.arrayContaining([
        'file:config/routes.rb#L2',
        'file:config/routes.rb#L3',
      ]),
    });
    expect(reopenRoute).toMatchObject({
      handler: 'BillingController#reopen_refund',
      sourceRefs: expect.arrayContaining([
        'file:config/routes.rb#L2',
        'file:config/routes.rb#L4',
      ]),
    });
    expect(noViaRoute).toBeUndefined();
    expect(showSymbol).toBeDefined();
    expect(reopenSymbol).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${showRoute?.id}`,
        to: `node_symbol_${showSymbol?.id}`,
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${reopenRoute?.id}`,
        to: `node_symbol_${reopenSymbol?.id}`,
      }),
    ]));
  });

  test('links static Rails controller/action route options to controller actions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-rails-controller-action-routes-'));
    await mkdir(join(root, 'app/controllers'), { recursive: true });
    await mkdir(join(root, 'config'), { recursive: true });

    await writeFile(
      join(root, 'config/routes.rb'),
      [
        'Rails.application.routes.draw do',
        '  scope "/api/v1" do',
        '    get "/billing/refunds/:id", controller: "billing", action: "show_refund"',
        '    patch "/billing/refunds/:id", :controller => "billing", :action => "update_refund"',
        '    match "/billing/refunds/:id/reopen", controller: "billing", action: "reopen_refund", via: :post',
        '    match "/billing/refunds/:id/no-via", controller: "billing", action: "show_refund"',
        '  end',
        'end',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/controllers/billing_controller.rb'),
      [
        'class BillingController < ApplicationController',
        '  def show_refund',
        '    render json: params[:id]',
        '  end',
        '',
        '  def update_refund',
        '    render json: params[:id]',
        '  end',
        '',
        '  def reopen_refund',
        '    render json: params[:id]',
        '  end',
        'end',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_rails_controller_action_routes',
      workflowRunId: 'run_rails_controller_action_routes',
      repoRoot: root,
      generatedAt: '2026-07-03T19:30:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 10,
      },
    });

    const showRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/v1/billing/refunds/:id'
    ));
    const updateRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'PATCH'
      && entrypoint.route === '/api/v1/billing/refunds/:id'
    ));
    const reopenRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v1/billing/refunds/:id/reopen'
    ));
    const noViaRoute = inventory.entrypoints.find((entrypoint) => entrypoint.route === '/api/v1/billing/refunds/:id/no-via');
    const showSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'show_refund' && symbol.path === 'app/controllers/billing_controller.rb'
    ));
    const updateSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'update_refund' && symbol.path === 'app/controllers/billing_controller.rb'
    ));
    const reopenSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'reopen_refund' && symbol.path === 'app/controllers/billing_controller.rb'
    ));

    expect(showRoute).toMatchObject({
      handler: 'BillingController#show_refund',
      sourceRefs: expect.arrayContaining([
        'file:config/routes.rb#L2',
        'file:config/routes.rb#L3',
      ]),
    });
    expect(updateRoute).toMatchObject({
      handler: 'BillingController#update_refund',
    });
    expect(reopenRoute).toMatchObject({
      handler: 'BillingController#reopen_refund',
    });
    expect(noViaRoute).toBeUndefined();
    expect(showSymbol).toBeDefined();
    expect(updateSymbol).toBeDefined();
    expect(reopenSymbol).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${showRoute?.id}`,
        to: `node_symbol_${showSymbol?.id}`,
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${updateRoute?.id}`,
        to: `node_symbol_${updateSymbol?.id}`,
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${reopenRoute?.id}`,
        to: `node_symbol_${reopenSymbol?.id}`,
      }),
    ]));
  });

  test('detects static Rails match routes with via methods', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-rails-match-routes-'));
    await mkdir(join(root, 'app/controllers'), { recursive: true });
    await mkdir(join(root, 'config'), { recursive: true });

    await writeFile(
      join(root, 'config/routes.rb'),
      [
        'Rails.application.routes.draw do',
        '  scope "/api/v1" do',
        '    match "/billing/refunds/:id/cancel", to: "billing#cancel_refund", via: :post',
        '    match "/billing/refunds/:id/preview", to: "billing#preview_refund", via: [:get, :post]',
        '    match "/billing/refunds/:id/all", to: "billing#preview_refund", via: :all',
        '    match "/billing/refunds/:id/no-via", to: "billing#cancel_refund"',
        '    match dynamic_path, to: "billing#cancel_refund", via: :post',
        '    match "/billing/*path", to: "billing#cancel_refund", via: :get',
        '  end',
        'end',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/controllers/billing_controller.rb'),
      [
        'class BillingController < ApplicationController',
        '  def cancel_refund',
        '    render json: params[:id]',
        '  end',
        '',
        '  def preview_refund',
        '    render json: params[:id]',
        '  end',
        'end',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_rails_match_routes',
      workflowRunId: 'run_rails_match_routes',
      repoRoot: root,
      generatedAt: '2026-07-03T11:15:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 10,
      },
    });

    const cancelRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v1/billing/refunds/:id/cancel'
    ));
    const previewGetRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/api/v1/billing/refunds/:id/preview'
    ));
    const previewPostRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/api/v1/billing/refunds/:id/preview'
    ));
    const allRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'ANY'
      && entrypoint.route === '/api/v1/billing/refunds/:id/all'
    ));
    const noViaRoute = inventory.entrypoints.find((entrypoint) => entrypoint.route === '/api/v1/billing/refunds/:id/no-via');
    const dynamicRoute = inventory.entrypoints.find((entrypoint) => entrypoint.route === '/api/v1/dynamic_path');
    const wildcardRoute = inventory.entrypoints.find((entrypoint) => entrypoint.route === '/api/v1/billing/*path');
    const cancelSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'cancel_refund' && symbol.path === 'app/controllers/billing_controller.rb'
    ));
    const previewSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'preview_refund' && symbol.path === 'app/controllers/billing_controller.rb'
    ));

    expect(cancelRoute).toMatchObject({
      handler: 'BillingController#cancel_refund',
      sourceRefs: expect.arrayContaining([
        'file:config/routes.rb#L2',
        'file:config/routes.rb#L3',
      ]),
    });
    expect(previewGetRoute).toMatchObject({
      handler: 'BillingController#preview_refund',
      sourceRefs: expect.arrayContaining([
        'file:config/routes.rb#L2',
        'file:config/routes.rb#L4',
      ]),
    });
    expect(previewPostRoute).toMatchObject({
      handler: 'BillingController#preview_refund',
    });
    expect(allRoute).toMatchObject({
      handler: 'BillingController#preview_refund',
    });
    expect(noViaRoute).toBeUndefined();
    expect(dynamicRoute).toBeUndefined();
    expect(wildcardRoute).toBeUndefined();
    expect(cancelSymbol).toBeDefined();
    expect(previewSymbol).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${cancelRoute?.id}`,
        to: `node_symbol_${cancelSymbol?.id}`,
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${previewGetRoute?.id}`,
        to: `node_symbol_${previewSymbol?.id}`,
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${previewPostRoute?.id}`,
        to: `node_symbol_${previewSymbol?.id}`,
      }),
    ]));
    expect(inventory.capabilities.find((capability) => capability.id === 'cap_api_billing')).toMatchObject({
      label: 'Billing API',
    });
  });

  test('detects static Sinatra block routes with bounded source evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-sinatra-routes-'));
    await mkdir(join(root, 'app/services'), { recursive: true });

    await writeFile(
      join(root, 'app.rb'),
      [
        'require "sinatra/base"',
        '',
        'class BillingApp < Sinatra::Base',
        '  post "/billing/refunds/:refund_id/cancel" do',
        '    service = BillingRefundService.new',
        '    service.cancel_refund(params[:refund_id])',
        '  end',
        '',
        '  get "/customers/profile" do',
        '    "ok"',
        '  end',
        '',
        '  get dynamic_path do',
        '    "dynamic"',
        '  end',
        '',
        '  get "/billing/*" do',
        '    "wildcard"',
        '  end',
        'end',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'app/services/billing_refund_service.rb'),
      [
        'class BillingRefundService',
        '  def cancel_refund(refund_id)',
        '    refund_id',
        '  end',
        'end',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_sinatra_routes',
      workflowRunId: 'run_sinatra_routes',
      repoRoot: root,
      generatedAt: '2026-07-03T09:20:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 4096,
        maxTotalBytes: 8192,
        maxCapturedFiles: 10,
      },
    });

    const billingRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'POST'
      && entrypoint.route === '/billing/refunds/:refund_id/cancel'
    ));
    const customerRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route'
      && entrypoint.method === 'GET'
      && entrypoint.route === '/customers/profile'
    ));

    expect(billingRoute).toMatchObject({
      handler: undefined,
      sourceRefs: expect.arrayContaining([
        'file:app.rb#L4',
        'file:app.rb#L5',
        'file:app.rb#L6',
        'file:app.rb#L7',
      ]),
    });
    expect(customerRoute).toMatchObject({
      handler: undefined,
      sourceRefs: expect.arrayContaining([
        'file:app.rb#L9',
        'file:app.rb#L10',
        'file:app.rb#L11',
      ]),
    });
    expect(inventory.entrypoints.find((entrypoint) => entrypoint.route === '/dynamic_path')).toBeUndefined();
    expect(inventory.entrypoints.find((entrypoint) => entrypoint.route === '/billing/*')).toBeUndefined();
    expect(inventory.capabilities.find((capability) => capability.id === 'cap_api_billing')).toMatchObject({
      label: 'Billing API',
    });
    expect(inventory.capabilities.find((capability) => capability.id === 'cap_api_customers')).toMatchObject({
      label: 'Customers API',
    });
  });

  test('detects static Symfony YAML routes with resolvable controller action evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-symfony-yaml-'));
    await mkdir(join(root, 'app/config'), { recursive: true });
    await mkdir(join(root, 'config'), { recursive: true });
    await mkdir(join(root, 'src/Acme/BillingBundle/Controller'), { recursive: true });
    await mkdir(join(root, 'src/Acme/BillingBundle/Service'), { recursive: true });
    await mkdir(join(root, 'src/Acme/BillingBundle/Repository'), { recursive: true });
    await mkdir(join(root, 'src/AppBundle/Controller'), { recursive: true });
    await mkdir(join(root, 'src/Controller'), { recursive: true });

    await writeFile(
      join(root, 'app/config/routing.yml'),
      [
        'billing_statement:',
        '  path: /billing/statements',
        '  defaults: { _controller: AcmeBillingBundle:Statement:show }',
        'customer_profile:',
        '  pattern: /customers/profile',
        '  defaults:',
        "    _controller: 'AppBundle\\Controller\\CustomerController::profileAction'",
        'billing_dynamic:',
        '  path: /billing/{id}',
        '  defaults: { _controller: AcmeBillingBundle:Statement:show }',
        'service_container_route:',
        '  path: /billing/callback',
        '  defaults: { _controller: billing.statement_controller:showAction }',
        'imported_bundle_routes:',
        '  resource: "@AcmeBillingBundle/Resources/config/routing.yml"',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'config/routes.yaml'),
      [
        'billing_ledger:',
        '  path: /billing/ledger',
        '  controller: App\\Controller\\LedgerController::showAction',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Acme/BillingBundle/Controller/StatementController.php'),
      [
        '<?php',
        'class StatementController',
        '{',
        '  public function showAction() {',
        '    $service = new BillingService();',
        '    return $service->statementList();',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Acme/BillingBundle/Service/BillingService.php'),
      [
        '<?php',
        'class BillingService',
        '{',
        '  public function statementList() {',
        '    $repository = new BillingRepository();',
        '    return $repository->fetchStatements();',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Acme/BillingBundle/Repository/BillingRepository.php'),
      [
        '<?php',
        'class BillingRepository',
        '{',
        '  public function fetchStatements() {',
        '    return [];',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/AppBundle/Controller/CustomerController.php'),
      [
        '<?php',
        'class CustomerController',
        '{',
        '  public function profileAction() {',
        '    return null;',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Controller/LedgerController.php'),
      [
        '<?php',
        'class LedgerController',
        '{',
        '  public function showAction() {',
        '    return null;',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_symfony_yaml',
      workflowRunId: 'run_symfony_yaml',
      repoRoot: root,
      generatedAt: '2026-07-02T00:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 8192,
        maxTotalBytes: 65536,
        maxCapturedFiles: 16,
      },
    });

    const routes = inventory.entrypoints
      .filter((entrypoint) => entrypoint.kind === 'http_route')
      .map((entrypoint) => `${entrypoint.method} ${entrypoint.route}`)
      .sort();
    expect(routes).toEqual([
      'ANY /billing/ledger',
      'ANY /billing/statements',
      'ANY /customers/profile',
    ]);

    const statementRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route' && entrypoint.route === '/billing/statements'
    ));
    const customerRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route' && entrypoint.route === '/customers/profile'
    ));
    const ledgerRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route' && entrypoint.route === '/billing/ledger'
    ));
    const statementSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'showAction' && symbol.path === 'src/Acme/BillingBundle/Controller/StatementController.php'
    ));
    const customerSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'profileAction' && symbol.path === 'src/AppBundle/Controller/CustomerController.php'
    ));
    const ledgerSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'showAction' && symbol.path === 'src/Controller/LedgerController.php'
    ));

    expect(statementRoute).toMatchObject({
      handler: 'Symfony:StatementController@showAction',
      sourceRefs: expect.arrayContaining([
        'file:app/config/routing.yml#L2',
        'file:app/config/routing.yml#L3',
      ]),
    });
    expect(customerRoute).toMatchObject({
      handler: 'Symfony:CustomerController@profileAction',
      sourceRefs: expect.arrayContaining([
        'file:app/config/routing.yml#L5',
        'file:app/config/routing.yml#L7',
      ]),
    });
    expect(ledgerRoute).toMatchObject({
      handler: 'Symfony:LedgerController@showAction',
      sourceRefs: expect.arrayContaining([
        'file:config/routes.yaml#L2',
        'file:config/routes.yaml#L3',
      ]),
    });
    expect(statementSymbol).toBeDefined();
    expect(customerSymbol).toBeDefined();
    expect(ledgerSymbol).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${statementRoute?.id}`,
        to: `node_symbol_${statementSymbol?.id}`,
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${customerRoute?.id}`,
        to: `node_symbol_${customerSymbol?.id}`,
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${ledgerRoute?.id}`,
        to: `node_symbol_${ledgerSymbol?.id}`,
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${statementSymbol?.id}`,
        label: 'uses BillingService',
      }),
    ]));
  });

  test('detects static Symfony XML routes with resolvable controller action evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ainp-inventory-symfony-xml-'));
    await mkdir(join(root, 'app/config'), { recursive: true });
    await mkdir(join(root, 'config'), { recursive: true });
    await mkdir(join(root, 'src/Acme/BillingBundle/Controller'), { recursive: true });
    await mkdir(join(root, 'src/Acme/BillingBundle/Service'), { recursive: true });
    await mkdir(join(root, 'src/Acme/BillingBundle/Repository'), { recursive: true });
    await mkdir(join(root, 'src/AppBundle/Controller'), { recursive: true });
    await mkdir(join(root, 'src/Controller'), { recursive: true });

    await writeFile(
      join(root, 'app/config/routing.xml'),
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<routes>',
        '  <route id="billing_statement" path="/billing/statements">',
        '    <default key="_controller">AcmeBillingBundle:Statement:show</default>',
        '  </route>',
        '  <route id="customer_profile" path="/customers/profile">',
        '    <default key="_controller">AppBundle\\Controller\\CustomerController::profileAction</default>',
        '  </route>',
        '  <route id="billing_dynamic" path="/billing/{id}">',
        '    <default key="_controller">AcmeBillingBundle:Statement:show</default>',
        '  </route>',
        '  <route id="service_container_route" path="/billing/callback">',
        '    <default key="_controller">billing.statement_controller:showAction</default>',
        '  </route>',
        '  <import resource="@AcmeBillingBundle/Resources/config/routing.xml" />',
        '</routes>',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'config/routes.xml'),
      [
        '<routes>',
        '  <route id="billing_ledger" path="/billing/ledger" controller="App\\Controller\\LedgerController::showAction" />',
        '</routes>',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Acme/BillingBundle/Controller/StatementController.php'),
      [
        '<?php',
        'class StatementController',
        '{',
        '  public function showAction() {',
        '    $service = new BillingService();',
        '    return $service->statementList();',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Acme/BillingBundle/Service/BillingService.php'),
      [
        '<?php',
        'class BillingService',
        '{',
        '  public function statementList() {',
        '    $repository = new BillingRepository();',
        '    return $repository->fetchStatements();',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Acme/BillingBundle/Repository/BillingRepository.php'),
      [
        '<?php',
        'class BillingRepository',
        '{',
        '  public function fetchStatements() {',
        '    return [];',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/AppBundle/Controller/CustomerController.php'),
      [
        '<?php',
        'class CustomerController',
        '{',
        '  public function profileAction() {',
        '    return null;',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      join(root, 'src/Controller/LedgerController.php'),
      [
        '<?php',
        'class LedgerController',
        '{',
        '  public function showAction() {',
        '    return null;',
        '  }',
        '}',
      ].join('\n'),
      'utf8',
    );

    const inventory = await buildProjectInventory({
      projectId: 'proj_symfony_xml',
      workflowRunId: 'run_symfony_xml',
      repoRoot: root,
      generatedAt: '2026-07-02T00:00:00.000Z',
      git: false,
      limits: {
        maxFileBytes: 8192,
        maxTotalBytes: 65536,
        maxCapturedFiles: 16,
      },
    });

    const routes = inventory.entrypoints
      .filter((entrypoint) => entrypoint.kind === 'http_route')
      .map((entrypoint) => `${entrypoint.method} ${entrypoint.route}`)
      .sort();
    expect(routes).toEqual([
      'ANY /billing/ledger',
      'ANY /billing/statements',
      'ANY /customers/profile',
    ]);

    const statementRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route' && entrypoint.route === '/billing/statements'
    ));
    const customerRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route' && entrypoint.route === '/customers/profile'
    ));
    const ledgerRoute = inventory.entrypoints.find((entrypoint) => (
      entrypoint.kind === 'http_route' && entrypoint.route === '/billing/ledger'
    ));
    const statementSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'showAction' && symbol.path === 'src/Acme/BillingBundle/Controller/StatementController.php'
    ));
    const customerSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'profileAction' && symbol.path === 'src/AppBundle/Controller/CustomerController.php'
    ));
    const ledgerSymbol = inventory.symbols.find((symbol) => (
      symbol.name === 'showAction' && symbol.path === 'src/Controller/LedgerController.php'
    ));

    expect(statementRoute).toMatchObject({
      handler: 'Symfony:StatementController@showAction',
      sourceRefs: expect.arrayContaining([
        'file:app/config/routing.xml#L3',
        'file:app/config/routing.xml#L4',
      ]),
    });
    expect(customerRoute).toMatchObject({
      handler: 'Symfony:CustomerController@profileAction',
      sourceRefs: expect.arrayContaining([
        'file:app/config/routing.xml#L6',
        'file:app/config/routing.xml#L7',
      ]),
    });
    expect(ledgerRoute).toMatchObject({
      handler: 'Symfony:LedgerController@showAction',
      sourceRefs: expect.arrayContaining([
        'file:config/routes.xml#L2',
      ]),
    });
    expect(statementSymbol).toBeDefined();
    expect(customerSymbol).toBeDefined();
    expect(ledgerSymbol).toBeDefined();
    expect(inventory.symbolGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${statementRoute?.id}`,
        to: `node_symbol_${statementSymbol?.id}`,
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${customerRoute?.id}`,
        to: `node_symbol_${customerSymbol?.id}`,
      }),
      expect.objectContaining({
        kind: 'route_handler',
        from: `node_entrypoint_${ledgerRoute?.id}`,
        to: `node_symbol_${ledgerSymbol?.id}`,
      }),
      expect.objectContaining({
        kind: 'symbol_reference',
        from: `node_symbol_${statementSymbol?.id}`,
        label: 'uses BillingService',
      }),
    ]));
  });
});
