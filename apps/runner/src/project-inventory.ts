import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { Node, SourceFile } from 'typescript';
import { sh } from './sh';
import {
  sourceChunkIndexEmbeddingForText,
  type SourceChunkIndexEmbedding,
  type SourceChunkIndexEmbeddingProvider,
} from './source-chunk-embedding';

export interface ProjectInventoryEnvelope {
  schemaVersion: 'ainp.project_inventory.v1';
  projectId: string;
  workflowRunId: string;
  generatedAt: string;
  repo: InventoryRepoSnapshot;
  scan: InventoryScanSummary;
  sources: InventorySource[];
  commands: InventoryCommand[];
  modules: InventoryModule[];
  entrypoints: InventoryEntrypoint[];
  symbols: InventorySymbol[];
  imports: InventoryImport[];
  exports: InventoryExport[];
  symbolGraph: InventorySymbolGraph;
  sourceChunks: InventorySourceChunk[];
  sourceChunkIndex: InventorySourceChunkIndex;
  domainEntities: InventoryDomainEntity[];
  testSurfaces: InventoryTestSurface[];
  hotspots: InventoryHotspot[];
  capabilities: InventoryCapability[];
  git: InventoryGitSummary | null;
  exclusions: InventoryExclusion[];
  warnings: InventoryWarning[];
}

export interface InventoryRepoSnapshot {
  root: string;
  branch: string | null;
  commit: string | null;
  dirty: boolean | null;
}

export interface InventoryScanSummary {
  fileCountSeen: number;
  fileCountCaptured: number;
  totalBytesCaptured: number;
  durationMs: number;
  limits: InventoryLimits;
}

export interface InventoryLimits {
  maxFiles: number;
  maxCapturedFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxGitCommits: number;
  maxChurnPaths: number;
}

export interface InventorySource {
  id: string;
  kind: 'doc' | 'config' | 'ci' | 'test' | 'source_tree' | 'git';
  path?: string;
  ref: string;
  title: string;
  summary: string;
  contentExcerpt?: string;
  sha256?: string;
}

export interface InventoryCommand {
  id: string;
  name: string;
  command: string;
  sourceRefs: string[];
  confidence: number;
}

export interface InventoryEntrypoint {
  id: string;
  kind: 'http_route' | 'cli_script' | 'job' | 'queue' | 'app_bootstrap';
  label: string;
  path: string;
  method?: string;
  route?: string;
  handler?: string;
  sourceRefs: string[];
  sourceChunkRefs?: string[];
  confidence: number;
}

export interface InventorySymbol {
  id: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'const' | 'method';
  name: string;
  path: string;
  exported: boolean;
  line: number;
  signature: string;
  sourceRefs: string[];
  sourceChunkRefs?: string[];
}

export interface InventoryImport {
  id: string;
  path: string;
  specifier: string;
  targetPath?: string;
  targetPaths?: string[];
  importedNames: string[];
  namedImports?: InventoryNamedImport[];
  defaultImport?: string;
  namespaceImport?: string;
  sourceRefs: string[];
  confidence: number;
}

export interface InventoryNamedImport {
  imported: string;
  local: string;
}

export interface InventoryExport {
  id: string;
  path: string;
  name: string;
  kind: InventorySymbol['kind'] | 'default' | 're_export';
  symbolRef?: string;
  specifier?: string;
  exportedAs?: string;
  sourceRefs: string[];
  confidence: number;
}

export interface InventorySymbolGraph {
  parser: 'typescript_ast' | 'typescript_ast+heuristic' | 'heuristic';
  nodes: InventorySymbolGraphNode[];
  edges: InventorySymbolGraphEdge[];
}

export interface InventorySymbolGraphNode {
  id: string;
  kind: 'entrypoint' | 'symbol';
  ref: string;
  label: string;
  path: string;
  sourceRefs: string[];
  sourceChunkRefs?: string[];
}

export interface InventorySymbolGraphEdge {
  id: string;
  kind: 'route_handler' | 'symbol_reference';
  from: string;
  to: string;
  label: string;
  sourceRefs: string[];
  sourceChunkRefs?: string[];
  confidence: number;
}

export interface InventorySourceChunk {
  id: string;
  path: string;
  language: string | null;
  startLine: number;
  endLine: number;
  snippet: string;
  contentSha256: string;
  sourceRefs: string[];
  entrypointRefs: string[];
  symbolRefs: string[];
  domainEntityRefs: string[];
  graphEdgeRefs: string[];
  testRefs: string[];
  hotspotRefs: string[];
  capabilityRefs: string[];
  sha256: string;
  confidence: number;
}

export interface InventorySourceChunkIndex {
  schemaVersion: 'ainp.source_chunk_index.v1';
  generatedAt: string;
  source: 'project_inventory.sourceChunks';
  chunkCount: number;
  maxEntries: number;
  entries: InventorySourceChunkIndexEntry[];
}

export interface InventorySourceChunkIndexEntry {
  id: string;
  sourceChunkRef: string;
  contentSha256: string;
  path: string;
  language: string | null;
  startLine: number;
  endLine: number;
  lexicalTokens: string[];
  searchText: string;
  embedding?: SourceChunkIndexEmbedding;
  linkedRecordRefs: string[];
  sourceRefs: string[];
  entrypointRefs: string[];
  symbolRefs: string[];
  domainEntityRefs: string[];
  graphEdgeRefs: string[];
  testRefs: string[];
  hotspotRefs: string[];
  capabilityRefs: string[];
}

export interface InventoryDomainEntity {
  id: string;
  name: string;
  kind: 'model' | 'entity' | 'schema' | 'table' | 'view' | 'routine' | 'dto' | 'unknown';
  path: string;
  schemaName?: string;
  sourceRefs: string[];
  referenceSourceRefs?: string[];
  relationships?: InventoryDomainEntityRelationship[];
  sourceChunkRefs?: string[];
  confidence: number;
}

export interface InventoryDomainEntityRelationship {
  kind: 'foreign_key' | 'join' | 'view_dependency' | 'routine_dependency';
  direction: 'references' | 'referenced_by' | 'joins' | 'depends_on' | 'depended_on_by';
  domainEntityRef: string;
  name: string;
  sourceRefs: string[];
  confidence: number;
}

export interface InventoryTestSurface {
  id: string;
  path: string;
  frameworkHint: string | null;
  targetHints: string[];
  sourceRefs: string[];
  sourceChunkRefs?: string[];
}

export interface InventoryHotspot {
  id: string;
  path: string;
  reason: 'git_churn' | 'large_file' | 'symbol_dense' | 'entrypoint_dense';
  score: number;
  sourceRefs: string[];
  sourceChunkRefs?: string[];
}

export interface InventoryCapability {
  id: string;
  label: string;
  kind: 'api' | 'cli' | 'job' | 'module' | 'test' | 'unknown';
  entrypointRefs: string[];
  moduleRefs: string[];
  symbolRefs: string[];
  domainEntityRefs: string[];
  testRefs: string[];
  hotspotRefs: string[];
  sourceRefs: string[];
  sourceChunkRefs?: string[];
  confidence: number;
  openQuestions: string[];
}

export interface InventoryModule {
  id: string;
  path: string;
  label: string;
  evidenceRefs: string[];
}

export interface InventoryGitSummary {
  recentCommits: Array<{
    hash: string;
    date: string;
    subject: string;
  }>;
  churnHotspots: Array<{
    path: string;
    commitCount: number;
  }>;
}

export interface InventoryExclusion {
  path: string;
  reason: 'sensitive' | 'binary' | 'generated' | 'too_large' | 'ignored' | 'budget';
}

export interface InventoryWarning {
  code: string;
  message: string;
  sourceRefs: string[];
}

export interface BuildProjectInventoryInput {
  projectId: string;
  workflowRunId: string;
  repoRoot: string;
  generatedAt?: string;
  limits?: Partial<InventoryLimits>;
  git?: boolean;
  sourceChunkEmbeddingProvider?: SourceChunkIndexEmbeddingProvider | null;
}

interface ScannedInventoryFile {
  path: string;
  content: string;
  size: number;
  sha256: string;
}

type TypeScriptApi = typeof import('typescript');

interface ParserEvidence {
  symbols: InventorySymbol[];
  imports: InventoryImport[];
  exports: InventoryExport[];
  references: InventorySymbolReference[];
  constructedReceivers: InventoryConstructedReceiver[];
  parsedPaths: Set<string>;
}

interface InventoryConstructedReceiver {
  path: string;
  ownerName?: string;
  variableName: string;
  targetName: string;
  targetPath?: string;
  sourceRefs: string[];
}

interface InventorySymbolReference {
  fromSymbolId: string;
  targetName: string;
  targetPath?: string;
  declaredTypeName?: string;
  path: string;
  label: string;
  sourceRefs: string[];
  confidence: number;
}

interface LocalIdentifierAlias {
  targetName: string;
  sourceRefs: string[];
}

interface ConstructedTypeEvidence {
  targetName: string;
  targetPath?: string;
  declaredTypeName?: string;
  sourceRefs: string[];
}

interface ConstructorParameterEvidence {
  typeName: string;
  sourceRefs: string[];
}

interface RegisteredImplementationEvidence {
  serviceName: string;
  implementationName: string;
  implementationPath: string;
  sourceRefs: string[];
}

type AddInventorySymbol = (
  node: Node,
  kind: InventorySymbol['kind'],
  name: string,
  exported: boolean,
  signatureNode?: Node,
  signaturePrefix?: string,
) => InventorySymbol;

const DEFAULT_LIMITS: InventoryLimits = {
  maxFiles: 5000,
  maxCapturedFiles: 120,
  maxFileBytes: 64 * 1024,
  maxTotalBytes: 1536 * 1024,
  maxGitCommits: 50,
  maxChurnPaths: 30,
};

const GENERATED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'target',
  '.turbo',
  'coverage',
  '.next',
  '.nuxt',
  'out',
]);

const CONFIG_BASENAMES = new Set([
  'package.json',
  'bunfig.toml',
  'pyproject.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'Makefile',
  'vitest.config.ts',
  'vitest.config.js',
  'vite.config.ts',
  'vite.config.js',
  'tsconfig.json',
]);

const LOCAL_RE_EXPORT_MAX_DEPTH = 2;
const PYTHON_STAR_IMPORT_MAX_NAMES = 64;
const PHP_USE_STATEMENT_MAX_LINES = 24;

const KOA_ROUTER_SPECIFIERS = new Set(['koa-router', '@koa/router']);
const KOA_ROUTER_SPECIFIER_PATTERN = String.raw`(?:koa-router|@koa\/router)`;
const HONO_SPECIFIER = 'hono';

const EXPRESS_ROUTE_RECEIVERS = new Set([
  'app',
  'router',
  'server',
  'fastify',
  'route',
  'routes',
  'r',
  'mux',
  'api',
  'engine',
]);

export async function buildProjectInventory(
  input: BuildProjectInventoryInput,
): Promise<ProjectInventoryEnvelope> {
  const started = Date.now();
  const limits = { ...DEFAULT_LIMITS, ...input.limits };
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const repoRoot = input.repoRoot;
  const warnings: InventoryWarning[] = [];
  const exclusions: InventoryExclusion[] = [];
  const sources: InventorySource[] = [];
  const commands: InventoryCommand[] = [];
  const modules: InventoryModule[] = [];
  const scannedFiles: ScannedInventoryFile[] = [];
  const seenPaths: string[] = [];
  const capturedPaths = new Set<string>();
  let totalBytesCaptured = 0;

  const repo = input.git === false
    ? { root: repoRoot, branch: null, commit: null, dirty: null }
    : await collectRepoSnapshot(repoRoot, warnings);
  const git = input.git === false ? null : await collectGitSummary(repoRoot, limits, warnings);

  const files = await enumerateFiles(repoRoot, limits, exclusions, warnings);
  for (const file of files) {
    seenPaths.push(file.path);
    if (capturedPaths.size >= limits.maxCapturedFiles) {
      exclusions.push({ path: file.path, reason: 'budget' });
      continue;
    }
    if (totalBytesCaptured + file.size > limits.maxTotalBytes) {
      exclusions.push({ path: file.path, reason: 'budget' });
      continue;
    }

    const content = await readFile(file.absolute, 'utf8');
    const sha256 = createHash('sha256').update(content).digest('hex');
    const source = sourceFromFile(file.path, content, sha256);
    const shouldAnalyze = Boolean(source)
      || isCodeIntelligenceCandidate(file.path)
      || isRouteConfigPath(file.path)
      || isWcfServiceModelConfigFile(file.path, content);
    if (!shouldAnalyze) continue;

    capturedPaths.add(file.path);
    totalBytesCaptured += Buffer.byteLength(content, 'utf8');
    scannedFiles.push({ path: file.path, content, size: file.size, sha256 });

    if (source) sources.push(source);

    if (file.path === 'package.json' && source) {
      commands.push(...commandsFromPackageJson(content, source.ref, warnings));
    }
  }

  modules.push(...modulesFromPaths(seenPaths));
  for (const module of modules) {
    sources.push({
      id: `src_${slugify(module.path)}`,
      kind: 'source_tree',
      path: module.path,
      ref: `path:${module.path}`,
      title: module.label,
      summary: `Detected module directory ${module.path}.`,
    });
  }

  if (git) {
    for (const commit of git.recentCommits) {
      sources.push({
        id: `git_${commit.hash}`,
        kind: 'git',
        ref: `git:${commit.hash}`,
        title: commit.subject,
      summary: `${commit.date} ${commit.subject}`,
      });
    }
  }

  const parserEvidence = await extractParserEvidence(scannedFiles, warnings);
  const heuristicSymbols = extractHeuristicSymbols(
    scannedFiles.filter((file) => !parserEvidence.parsedPaths.has(file.path)),
  );
  const heuristicImports = extractHeuristicImports(
    scannedFiles.filter((file) => !parserEvidence.parsedPaths.has(file.path)),
  );
  const symbols = dedupeById([...parserEvidence.symbols, ...heuristicSymbols]);
  const configuredReceiversByPath = mergeConstructedReceiversByPath(
    springXmlConfiguredReceiversByPath(scannedFiles, symbols),
    goConstructorInjectedReceiversByPath(scannedFiles, symbols, heuristicImports),
  );
  const registeredImplementations = csharpRegisteredImplementationsForFiles(scannedFiles, symbols, heuristicImports);
  const heuristicSymbolEvidence = extractHeuristicSymbolEvidence(
    scannedFiles.filter((file) => !parserEvidence.parsedPaths.has(file.path)),
    heuristicSymbols,
    symbols,
    heuristicImports,
    configuredReceiversByPath,
    registeredImplementations,
  );
  const imports = dedupeById([...parserEvidence.imports, ...heuristicImports]);
  const exports = parserEvidence.exports;
  const entrypoints = extractEntrypoints(scannedFiles, commands, { imports, exports, symbols });
  const symbolGraph = buildSymbolGraph({
    entrypoints,
    symbols,
    imports,
    exports,
    references: dedupeSymbolReferences([...parserEvidence.references, ...heuristicSymbolEvidence.references]),
    constructedReceivers: dedupeConstructedReceivers([
      ...parserEvidence.constructedReceivers,
      ...heuristicSymbolEvidence.constructedReceivers,
    ]),
    parsedPathCount: parserEvidence.parsedPaths.size,
    heuristicSymbolCount: heuristicSymbols.length,
  });
  const domainEntities = attachSqlRoutineDependencyRelationships(
    attachSqlViewDependencyRelationships(
      attachSqlJoinRelationships(
        attachSqlForeignKeyRelationships(
          attachTableReferenceSourceRefs(
            extractDomainEntities(scannedFiles, symbols),
            scannedFiles,
          ),
          scannedFiles,
        ),
        scannedFiles,
      ),
      scannedFiles,
    ),
    scannedFiles,
  );
  const testSurfaces = extractTestSurfaces(scannedFiles);
  const hotspots = buildHotspots(scannedFiles, symbols, entrypoints, git, limits);
  const capabilities = buildCapabilities({
    entrypoints,
    modules,
    symbols,
    domainEntities,
    symbolGraph,
    testSurfaces,
    hotspots,
  });
  const sourceChunks = buildSourceChunks({
    files: scannedFiles,
    entrypoints,
    symbols,
    domainEntities,
    symbolGraph,
    testSurfaces,
    hotspots,
    capabilities,
  });
  const sourceChunkIndex = await buildSourceChunkIndex(
    sourceChunks,
    generatedAt,
    input.sourceChunkEmbeddingProvider ?? null,
  );
  const sourceChunkRefsByRecordId = sourceChunkRefsByInventoryRecordId(sourceChunks);
  const entrypointsWithSourceChunks = attachSourceChunkRefs(entrypoints, sourceChunkRefsByRecordId);
  const symbolsWithSourceChunks = attachSourceChunkRefs(symbols, sourceChunkRefsByRecordId);
  const domainEntitiesWithSourceChunks = attachSourceChunkRefs(domainEntities, sourceChunkRefsByRecordId);
  const testSurfacesWithSourceChunks = attachSourceChunkRefs(testSurfaces, sourceChunkRefsByRecordId);
  const hotspotsWithSourceChunks = attachSourceChunkRefs(hotspots, sourceChunkRefsByRecordId);
  const capabilitiesWithSourceChunks = attachSourceChunkRefs(capabilities, sourceChunkRefsByRecordId);
  const symbolGraphWithSourceChunks: InventorySymbolGraph = {
    ...symbolGraph,
    nodes: symbolGraph.nodes.map((node) => attachSourceChunkRefsToNode(node, sourceChunkRefsByRecordId)),
    edges: attachSourceChunkRefs(symbolGraph.edges, sourceChunkRefsByRecordId),
  };

  return {
    schemaVersion: 'ainp.project_inventory.v1',
    projectId: input.projectId,
    workflowRunId: input.workflowRunId,
    generatedAt,
    repo,
    scan: {
      fileCountSeen: seenPaths.length,
      fileCountCaptured: capturedPaths.size,
      totalBytesCaptured,
      durationMs: Date.now() - started,
      limits,
    },
    sources: sortById(sources),
    commands: sortById(commands),
    modules: sortById(modules),
    entrypoints: sortById(entrypointsWithSourceChunks),
    symbols: sortById(symbolsWithSourceChunks),
    imports: sortById(imports),
    exports: sortById(exports),
    symbolGraph: symbolGraphWithSourceChunks,
    sourceChunks: sortById(sourceChunks),
    sourceChunkIndex,
    domainEntities: sortById(domainEntitiesWithSourceChunks),
    testSurfaces: sortById(testSurfacesWithSourceChunks),
    hotspots: sortById(hotspotsWithSourceChunks),
    capabilities: sortById(capabilitiesWithSourceChunks),
    git,
    exclusions: sortExclusions(exclusions),
    warnings,
  };
}

async function enumerateFiles(
  repoRoot: string,
  limits: InventoryLimits,
  exclusions: InventoryExclusion[],
  warnings: InventoryWarning[],
): Promise<Array<{ path: string; absolute: string; size: number }>> {
  const results: Array<{ path: string; absolute: string; size: number }> = [];

  async function walk(dir: string): Promise<void> {
    if (results.length >= limits.maxFiles) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      warnings.push({
        code: 'inventory.read_dir_failed',
        message: `Could not read directory ${normalizePath(relative(repoRoot, dir)) || '.'}: ${err instanceof Error ? err.message : String(err)}`,
        sourceRefs: [],
      });
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = join(dir, entry.name);
      const rel = normalizePath(relative(repoRoot, absolute));
      const excluded = exclusionReason(rel, entry.isDirectory());
      if (excluded) {
        exclusions.push({ path: rel, reason: excluded });
        continue;
      }
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const info = await stat(absolute);
      if (info.size > limits.maxFileBytes) {
        exclusions.push({ path: rel, reason: 'too_large' });
        continue;
      }
      const buffer = await readFile(absolute);
      if (isBinary(buffer)) {
        exclusions.push({ path: rel, reason: 'binary' });
        continue;
      }
      results.push({ path: rel, absolute, size: info.size });
      if (results.length >= limits.maxFiles) break;
    }
  }

  await walk(repoRoot);
  return results.sort((a, b) => a.path.localeCompare(b.path));
}

function sourceFromFile(path: string, content: string, sha256: string): InventorySource | null {
  const base = basename(path);
  if (isMarkdownDoc(path)) {
    const headings = markdownHeadings(content);
    return {
      id: `doc_${slugify(path)}`,
      kind: 'doc',
      path,
      ref: `file:${path}`,
      title: headings[0] ?? base,
      summary: headings.length ? `Headings: ${headings.slice(0, 6).join(' > ')}` : excerpt(content, 160),
      contentExcerpt: excerpt(content, 1200),
      sha256,
    };
  }
  if (isCiPath(path)) {
    return {
      id: `ci_${slugify(path)}`,
      kind: 'ci',
      path,
      ref: `file:${path}`,
      title: base,
      summary: excerpt(content, 240),
      contentExcerpt: excerpt(content, 1200),
      sha256,
    };
  }
  if (isTestConfig(path)) {
    return {
      id: `test_${slugify(path)}`,
      kind: 'test',
      path,
      ref: `file:${path}`,
      title: base,
      summary: excerpt(content, 240),
      contentExcerpt: excerpt(content, 1200),
      sha256,
    };
  }
  if (isRouteConfigPath(path)) {
    return {
      id: `config_${slugify(path)}`,
      kind: 'config',
      path,
      ref: `file:${path}`,
      title: base,
      summary: configSummary(path, content),
      contentExcerpt: excerpt(content, 1200),
      sha256,
    };
  }
  if (CONFIG_BASENAMES.has(base)) {
    return {
      id: `config_${slugify(path)}`,
      kind: 'config',
      path,
      ref: `file:${path}`,
      title: base,
      summary: configSummary(path, content),
      contentExcerpt: excerpt(content, 1200),
      sha256,
    };
  }
  return null;
}

function commandsFromPackageJson(
  content: string,
  sourceRef: string,
  warnings: InventoryWarning[],
): InventoryCommand[] {
  try {
    const parsed = JSON.parse(content) as { scripts?: Record<string, unknown> };
    return Object.entries(parsed.scripts ?? {})
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, command]) => ({
        id: `cmd_${slugify(name)}`,
        name,
        command,
        sourceRefs: [sourceRef],
        confidence: 0.95,
      }));
  } catch (err) {
    warnings.push({
      code: 'inventory.package_json_parse_failed',
      message: `Could not parse package.json: ${err instanceof Error ? err.message : String(err)}`,
      sourceRefs: [sourceRef],
    });
    return [];
  }
}

function modulesFromPaths(paths: string[]): InventoryModule[] {
  const dirs = new Set<string>();
  for (const path of paths) {
    const parts = path.split('/');
    if (parts.length <= 1) continue;
    if (parts[0] === 'apps' || parts[0] === 'packages') {
      if (parts[1]) dirs.add(`${parts[0]}/${parts[1]}`);
      continue;
    }
    if (isSourceLikePath(path) && parts[0] && !parts[0].startsWith('.')) {
      dirs.add(parts[0]);
    }
  }
  return [...dirs]
    .sort((a, b) => a.localeCompare(b))
    .map((path) => ({
      id: `mod_${slugify(path)}`,
      path,
      label: moduleLabel(path),
      evidenceRefs: [`path:${path}`],
    }));
}

async function extractParserEvidence(
  files: ScannedInventoryFile[],
  warnings: InventoryWarning[],
): Promise<ParserEvidence> {
  const evidence: ParserEvidence = {
    symbols: [],
    imports: [],
    exports: [],
    references: [],
    constructedReceivers: [],
    parsedPaths: new Set(),
  };
  const astFiles = files.filter((file) => isTypeScriptAstCandidate(file.path));
  if (astFiles.length === 0) return evidence;

  const ts = await loadTypeScript(warnings);
  if (!ts) return evidence;

  for (const file of astFiles) {
    collectTypeScriptAstEvidence(ts, file, evidence);
    evidence.parsedPaths.add(file.path);
  }
  evidence.symbols = dedupeById(evidence.symbols);
  evidence.imports = dedupeById(evidence.imports);
  evidence.exports = dedupeById(evidence.exports);
  evidence.references = dedupeSymbolReferences(evidence.references);
  evidence.constructedReceivers = dedupeConstructedReceivers(evidence.constructedReceivers);
  return evidence;
}

async function loadTypeScript(warnings: InventoryWarning[]): Promise<TypeScriptApi | null> {
  try {
    return await import('typescript');
  } catch (err) {
    warnings.push({
      code: 'inventory.typescript_ast_unavailable',
      message: `TypeScript parser unavailable; falling back to heuristic symbol extraction: ${err instanceof Error ? err.message : String(err)}`,
      sourceRefs: [],
    });
    return null;
  }
}

function collectTypeScriptAstEvidence(
  ts: TypeScriptApi,
  file: ScannedInventoryFile,
  evidence: ParserEvidence,
): void {
  const sourceFile = ts.createSourceFile(
    file.path,
    file.content,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForPath(ts, file.path),
  );
  const exportedSymbols: InventorySymbol[] = [];
  const defaultExportedSymbolIds = new Set<string>();
  const localNamedExportAliases = localNamedExportAliasesForSourceFile(ts, sourceFile);
  const localNamedExportNames = new Set(localNamedExportAliases.keys());
  const commonJsExportedLocalNames = commonJsExportedLocalNamesForSourceFile(ts, sourceFile);
  const localIdentifierAliases = new Map<string, LocalIdentifierAlias>();

  const addSymbol: AddInventorySymbol = (
    node: Node,
    kind: InventorySymbol['kind'],
    name: string,
    exported: boolean,
    signatureNode: Node = node,
    signaturePrefix?: string,
  ): InventorySymbol => {
    const line = lineForNode(sourceFile, node);
    const symbol: InventorySymbol = {
      id: symbolId(file.path, name, line),
      kind,
      name,
      path: file.path,
      exported,
      line,
      signature: signatureForNode(sourceFile, signatureNode, signaturePrefix),
      sourceRefs: [fileRef(file.path, line)],
    };
    evidence.symbols.push(symbol);
    if (exported) exportedSymbols.push(symbol);
    return symbol;
  };
  const markLocalNamedExport = (symbol: InventorySymbol): void => {
    if (localNamedExportNames.has(symbol.name)) symbol.exported = true;
  };
  const localSymbolForName = (name: string): InventorySymbol | null => evidence.symbols
    .filter((symbol) => symbol.path === file.path && symbol.name === name)
    .sort(compareImportedHandlerSymbols)
    .at(0) ?? null;

  const visit = (node: Node): void => {
    if (ts.isImportDeclaration(node)) {
      const importItem = importFromDeclaration(ts, sourceFile, file.path, node);
      if (importItem) evidence.imports.push(importItem);
    }

    if (ts.isFunctionDeclaration(node) && (node.name || isDefaultExportedNode(sourceFile, node))) {
      const symbol = addSymbol(
        node,
        'function',
        node.name?.text ?? 'default',
        isExportedNode(sourceFile, node),
      );
      markLocalNamedExport(symbol);
      if (isDefaultExportedNode(sourceFile, node)) defaultExportedSymbolIds.add(symbol.id);
      if (node.body) collectSymbolReferences(ts, sourceFile, node.body, symbol, evidence);
    } else if (ts.isClassDeclaration(node) && (node.name || isDefaultExportedNode(sourceFile, node))) {
      const exported = isExportedNode(sourceFile, node);
      const className = node.name?.text ?? 'default';
      const classSymbol = addSymbol(node, 'class', className, exported);
      markLocalNamedExport(classSymbol);
      if (isDefaultExportedNode(sourceFile, node)) defaultExportedSymbolIds.add(classSymbol.id);
      const classMemberConstructedTypes = collectClassMemberConstructedTypes(
        ts,
        sourceFile,
        node,
        file.path,
      );
      for (const member of node.members) {
        if (!ts.isMethodDeclaration(member) || !member.name || !ts.isIdentifier(member.name)) continue;
        const methodSymbol = addSymbol(
          member.name,
          'method',
          member.name.text,
          exported || isExportedNode(sourceFile, member),
          member,
          `${className}.`,
        );
        if (member.body) {
          collectSymbolReferences(ts, sourceFile, member.body, methodSymbol, evidence, classMemberConstructedTypes);
        }
      }
      if (node.members.length > 0) {
        collectSymbolReferences(ts, sourceFile, node, classSymbol, evidence);
      }
    } else if (ts.isInterfaceDeclaration(node)) {
      markLocalNamedExport(addSymbol(node, 'interface', node.name.text, isExportedNode(sourceFile, node)));
    } else if (ts.isTypeAliasDeclaration(node)) {
      markLocalNamedExport(addSymbol(node, 'type', node.name.text, isExportedNode(sourceFile, node)));
    } else if (ts.isVariableStatement(node)) {
      const exported = isExportedNode(sourceFile, node);
      for (const declaration of node.declarationList.declarations) {
        if (node.parent === sourceFile) {
          const importItem = commonJsImportFromVariableDeclaration(ts, sourceFile, file.path, declaration);
          if (importItem) evidence.imports.push(importItem);
        }
        if (!ts.isIdentifier(declaration.name)) continue;
        if (node.parent === sourceFile && declaration.initializer && ts.isNewExpression(declaration.initializer)) {
          const constructed = expressionQualifiedName(ts, declaration.initializer.expression);
          if (constructed) {
            evidence.constructedReceivers.push({
              path: file.path,
              variableName: declaration.name.text,
              targetName: constructed,
              sourceRefs: [fileRef(file.path, lineForNode(sourceFile, declaration.initializer))],
            });
          }
        }
        const symbol = addSymbol(declaration, 'const', declaration.name.text, exported, node);
        const localNamedExported = localNamedExportNames.has(declaration.name.text);
        const commonJsExportedLocalObject = commonJsExportedLocalNames.has(declaration.name.text)
          && declaration.initializer
          && ts.isObjectLiteralExpression(declaration.initializer);
        if (localNamedExported) symbol.exported = true;
        if (commonJsExportedLocalObject) symbol.exported = true;
        const aliasExportNames = uniqueInOrder([
          ...(exported ? [declaration.name.text] : []),
          ...(localNamedExportAliases.get(declaration.name.text) ?? []),
        ]);
        const aliasInitializer = declaration.initializer;
        if (node.parent === sourceFile && aliasInitializer && ts.isIdentifier(aliasInitializer)) {
          localIdentifierAliases.set(declaration.name.text, {
            targetName: aliasInitializer.text,
            sourceRefs: [fileRef(file.path, lineForNode(sourceFile, declaration))],
          });
        }
        const aliasExports = aliasInitializer
          ? aliasExportNames
            .map((exportedAs) => exportAliasFromVariableInitializer(
              ts,
              sourceFile,
              file.path,
              exportedAs,
              declaration,
              aliasInitializer,
              evidence.imports,
              localIdentifierAliases,
            ))
            .filter((exportItem): exportItem is InventoryExport => Boolean(exportItem))
          : [];
        evidence.exports.push(...aliasExports);
        if ((exported || localNamedExported || commonJsExportedLocalObject)
          && declaration.initializer
          && ts.isObjectLiteralExpression(declaration.initializer)
        ) {
          collectObjectLiteralMethodSymbols(
            ts,
            sourceFile,
            declaration.name.text,
            declaration.initializer,
            addSymbol,
            evidence,
          );
        }
        if (declaration.initializer && (
          ts.isArrowFunction(declaration.initializer)
          || ts.isFunctionExpression(declaration.initializer)
        )) {
          collectSymbolReferences(ts, sourceFile, declaration.initializer.body, symbol, evidence);
        }
      }
    } else if (ts.isExportDeclaration(node)) {
      evidence.exports.push(...exportsFromDeclaration(
        ts,
        sourceFile,
        file.path,
        node,
        localSymbolForName,
        evidence.imports,
      ));
    } else if (ts.isExportAssignment(node)) {
      const exportItem = exportFromAssignment(
        ts,
        sourceFile,
        file.path,
        node,
        evidence.imports,
        localIdentifierAliases,
      );
      if (exportItem) evidence.exports.push(exportItem);
    } else if (ts.isExpressionStatement(node) && node.parent === sourceFile) {
      const exportItems = commonJsExportsFromExpressionStatement(
        ts,
        sourceFile,
        file.path,
        node,
        localSymbolForName,
        addSymbol,
        evidence,
      );
      evidence.exports.push(...exportItems);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  for (const symbol of exportedSymbols) {
    evidence.exports.push({
      id: `export_${slugify(symbol.path)}_${slugify(symbol.name)}_${symbol.line}`,
      path: symbol.path,
      name: symbol.name,
      kind: symbol.kind,
      symbolRef: symbol.id,
      sourceRefs: symbol.sourceRefs,
      confidence: 0.95,
    });
    if (defaultExportedSymbolIds.has(symbol.id)) {
      evidence.exports.push({
        id: `export_${slugify(symbol.path)}_default_${symbol.line}`,
        path: symbol.path,
        name: 'default',
        kind: 'default',
        symbolRef: symbol.id,
        exportedAs: 'default',
        sourceRefs: symbol.sourceRefs,
        confidence: 0.95,
      });
    }
  }
}

function localNamedExportAliasesForSourceFile(
  ts: TypeScriptApi,
  sourceFile: SourceFile,
): Map<string, string[]> {
  const aliases = new Map<string, string[]>();
  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier) continue;
    const clause = statement.exportClause;
    if (!clause || !ts.isNamedExports(clause)) continue;
    for (const element of clause.elements) {
      const localName = element.propertyName?.text ?? element.name.text;
      const exportedAs = element.name.text;
      aliases.set(localName, uniqueInOrder([...(aliases.get(localName) ?? []), exportedAs]));
    }
  }
  return aliases;
}

function commonJsExportedLocalNamesForSourceFile(
  ts: TypeScriptApi,
  sourceFile: SourceFile,
): Set<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isExpressionStatement(statement)) continue;
    const expression = statement.expression;
    if (!ts.isBinaryExpression(expression)) continue;
    if (expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) continue;
    const exportTarget = commonJsExportTarget(ts, expression.left);
    if (!exportTarget) continue;
    if (ts.isIdentifier(expression.right)) {
      names.add(expression.right.text);
      continue;
    }
    if (exportTarget.defaultExport && ts.isObjectLiteralExpression(expression.right)) {
      addCommonJsObjectLiteralExportedLocalNames(ts, expression.right, names);
    }
  }
  return names;
}

function addCommonJsObjectLiteralExportedLocalNames(
  ts: TypeScriptApi,
  node: import('typescript').ObjectLiteralExpression,
  names: Set<string>,
): void {
  for (const property of node.properties) {
    if (ts.isShorthandPropertyAssignment(property)) {
      names.add(property.name.text);
      continue;
    }

    if (!ts.isPropertyAssignment(property)) continue;
    const targetName = expressionIdentifierName(ts, property.initializer);
    if (targetName) names.add(targetName);
  }
}

function collectObjectLiteralMethodSymbols(
  ts: TypeScriptApi,
  sourceFile: SourceFile,
  objectName: string,
  node: import('typescript').ObjectLiteralExpression,
  addSymbol: AddInventorySymbol,
  evidence: ParserEvidence,
): void {
  for (const property of node.properties) {
    if (ts.isMethodDeclaration(property)) {
      const name = bindingPropertyNameText(ts, property.name);
      if (!name || RESERVED_SYMBOL_NAMES.has(name)) continue;
      const symbol = addSymbol(property, 'method', name, false, property, `${objectName}.`);
      if (property.body) collectSymbolReferences(ts, sourceFile, property.body, symbol, evidence);
      continue;
    }

    if (!ts.isPropertyAssignment(property)) continue;
    const name = bindingPropertyNameText(ts, property.name);
    if (!name || RESERVED_SYMBOL_NAMES.has(name)) continue;
    const initializer = property.initializer;
    if (!ts.isFunctionExpression(initializer) && !ts.isArrowFunction(initializer)) continue;
    const symbol = addSymbol(property, 'method', name, false, property, `${objectName}.`);
    collectSymbolReferences(ts, sourceFile, initializer.body, symbol, evidence);
  }
}

function extractHeuristicSymbols(files: ScannedInventoryFile[]): InventorySymbol[] {
  const symbols: InventorySymbol[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    if (!isSourceLikePath(file.path)) continue;
    const lines = file.content.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
      const lineNo = index + 1;
      const matches = symbolMatchesForLine(trimmed);
      for (const match of matches) {
        const id = symbolId(file.path, match.name, lineNo);
        if (seen.has(id)) continue;
        seen.add(id);
        symbols.push({
          id,
          kind: match.kind,
          name: match.name,
          path: file.path,
          exported: match.exported,
          line: lineNo,
          signature: excerpt(trimmed, 180),
          sourceRefs: [fileRef(file.path, lineNo)],
        });
      }
    }
  }
  return symbols;
}

function extractHeuristicSymbolEvidence(
  files: ScannedInventoryFile[],
  symbols: InventorySymbol[],
  allSymbols: InventorySymbol[],
  imports: readonly InventoryImport[] = [],
  configuredReceiversByPath: ReadonlyMap<string, readonly InventoryConstructedReceiver[]> = new Map(),
  registeredImplementations: ReadonlyMap<string, RegisteredImplementationEvidence> = new Map(),
): Pick<ParserEvidence, 'references' | 'constructedReceivers'> {
  const evidence: Pick<ParserEvidence, 'references' | 'constructedReceivers'> = {
    references: [],
    constructedReceivers: [],
  };
  const symbolsByPath = new Map<string, InventorySymbol[]>();
  for (const symbol of symbols) {
    symbolsByPath.set(symbol.path, [...(symbolsByPath.get(symbol.path) ?? []), symbol]);
  }

  for (const file of files) {
    if (!isHeuristicReceiverReferencePath(file.path)) continue;
    collectHeuristicReceiverReferences(
      file,
      symbolsByPath.get(file.path) ?? [],
      allSymbols,
      evidence,
      imports,
      configuredReceiversByPath.get(file.path) ?? [],
      registeredImplementations,
    );
  }

  return {
    references: dedupeSymbolReferences(evidence.references),
    constructedReceivers: dedupeConstructedReceivers(evidence.constructedReceivers),
  };
}

function extractHeuristicImports(files: ScannedInventoryFile[]): InventoryImport[] {
  const pythonFiles = files.filter((file) => file.path.endsWith('.py'));
  const pythonPaths = new Set(pythonFiles.map((file) => file.path));
  const pythonContentByPath = new Map(pythonFiles.map((file) => [file.path, file.content] as const));
  const goPaths = new Set(files.filter((file) => file.path.endsWith('.go')).map((file) => file.path));
  const phpPaths = new Set(files.filter((file) => isPhpSourceLikePath(file.path)).map((file) => file.path));
  const rubyPaths = new Set(files.filter((file) => file.path.endsWith('.rb')).map((file) => file.path));
  const javaPaths = new Set(files.filter((file) => file.path.endsWith('.java')).map((file) => file.path));
  const csharpPaths = new Set(files.filter((file) => file.path.endsWith('.cs')).map((file) => file.path));
  if (
    pythonPaths.size === 0
    && goPaths.size === 0
    && phpPaths.size === 0
    && rubyPaths.size === 0
    && javaPaths.size === 0
    && csharpPaths.size === 0
  ) return [];
  return dedupeById(files.flatMap((file) => (
    [
      ...(file.path.endsWith('.py')
        ? pythonImportEvidenceForContent(file.content, file.path, pythonPaths, pythonContentByPath)
        : []),
      ...(file.path.endsWith('.go') ? goImportEvidenceForContent(file.content, file.path, goPaths) : []),
      ...(isPhpSourceLikePath(file.path) ? phpImportEvidenceForContent(file.content, file.path, phpPaths) : []),
      ...(file.path.endsWith('.rb') ? rubyImportEvidenceForContent(file.content, file.path, rubyPaths) : []),
      ...(file.path.endsWith('.java') ? javaImportEvidenceForContent(file.content, file.path, javaPaths) : []),
      ...(file.path.endsWith('.cs') ? csharpUsingEvidenceForContent(file.content, file.path, csharpPaths) : []),
    ]
  )));
}

function pythonImportEvidenceForContent(
  content: string,
  path: string,
  pythonPaths: ReadonlySet<string>,
  pythonContentByPath: ReadonlyMap<string, string>,
): InventoryImport[] {
  const imports: InventoryImport[] = [];
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const lineNo = index + 1;
    const fromMatch = /^\s*from\s+([.\w]+)\s+import\s+(.+?)\s*$/.exec(line);
    if (fromMatch?.[1] && fromMatch[2]) {
      const moduleName = fromMatch[1];
      const targetPath = pythonImportModuleTargetPath(fromMatch[1], path, pythonPaths);
      if (isPythonStarImportClause(fromMatch[2])) {
        const expansion = targetPath && targetPath !== path
          ? pythonStaticStarImportExpansion({
            targetPath,
            pythonPaths,
            pythonContentByPath,
            depth: 0,
          })
          : { importedNames: [], namespaceImports: [] };
        if (targetPath && targetPath !== path && expansion.importedNames.length > 0) {
          imports.push({
            id: `import_${slugify(path)}_${slugify(fromMatch[1])}_${lineNo}_star`,
            path,
            specifier: fromMatch[1],
            targetPath,
            importedNames: expansion.importedNames,
            namedImports: expansion.importedNames.map((name) => ({ imported: name, local: name })),
            sourceRefs: [fileRef(path, lineNo)],
            confidence: 0.62,
          });
        }
        if (targetPath && targetPath !== path) {
          for (const namespaceImport of expansion.namespaceImports) {
            imports.push({
              id: `import_${slugify(path)}_${slugify(fromMatch[1])}_${lineNo}_star_${slugify(namespaceImport.localName)}`,
              path,
              specifier: pythonImportMemberModuleName(fromMatch[1], namespaceImport.localName),
              targetPath: namespaceImport.targetPath,
              importedNames: [namespaceImport.localName],
              namedImports: [{ imported: namespaceImport.localName, local: namespaceImport.localName }],
              namespaceImport: namespaceImport.localName,
              sourceRefs: uniqueSorted([fileRef(path, lineNo), ...namespaceImport.sourceRefs]),
              confidence: 0.6,
            });
          }
        }
        continue;
      }
      if (fromMatch[2].includes('*')) continue;
      const namedImports: InventoryNamedImport[] = [];
      const importedNames: string[] = [];
      for (const item of splitTopLevelCommaArgs(fromMatch[2].replace(/^\((.*)\)$/, '$1'))) {
        const importMatch = /^\s*([A-Za-z_][\w]*)(?:\s+as\s+([A-Za-z_][\w]*))?\s*$/.exec(item);
        const imported = importMatch?.[1];
        const local = importMatch?.[2] ?? imported;
        if (!imported || !local) continue;

        const memberModuleName = pythonImportMemberModuleName(moduleName, imported);
        const memberTargetPath = pythonImportModuleTargetPath(memberModuleName, path, pythonPaths);
        if (memberTargetPath && memberTargetPath !== path) {
          imports.push({
            id: `import_${slugify(path)}_${slugify(memberModuleName)}_${lineNo}_${slugify(local)}`,
            path,
            specifier: memberModuleName,
            targetPath: memberTargetPath,
            importedNames: [local],
            namespaceImport: local,
            sourceRefs: [fileRef(path, lineNo)],
            confidence: 0.73,
          });
          continue;
        }

        if (!targetPath || targetPath === path) continue;
        importedNames.push(local);
        namedImports.push({ imported, local });
      }
      if (targetPath && targetPath !== path && importedNames.length > 0) {
        imports.push({
          id: `import_${slugify(path)}_${slugify(fromMatch[1])}_${lineNo}`,
          path,
          specifier: fromMatch[1],
          targetPath,
          importedNames: uniqueSorted(importedNames),
          namedImports: namedImports.sort((a, b) => a.local.localeCompare(b.local) || a.imported.localeCompare(b.imported)),
          sourceRefs: [fileRef(path, lineNo)],
          confidence: 0.75,
        });
      }
    }

    const plainImportMatch = /^\s*import\s+(.+?)\s*$/.exec(line);
    if (!plainImportMatch?.[1]) continue;
    for (const item of splitTopLevelCommaArgs(plainImportMatch[1])) {
      const importMatch = /^\s*([.\w]+)(?:\s+as\s+([A-Za-z_][\w]*))?\s*$/.exec(item);
      const moduleName = importMatch?.[1];
      if (!moduleName || moduleName.startsWith('.')) continue;
      const targetPath = pythonImportModuleTargetPath(moduleName, path, pythonPaths);
      if (!targetPath || targetPath === path) continue;
      const local = importMatch?.[2] ?? moduleName.split('.').filter(Boolean)[0];
      if (!local || RESERVED_SYMBOL_NAMES.has(local)) continue;
      imports.push({
        id: `import_${slugify(path)}_${slugify(moduleName)}_${lineNo}`,
        path,
        specifier: moduleName,
        targetPath,
        importedNames: [local],
        namespaceImport: local,
        sourceRefs: [fileRef(path, lineNo)],
        confidence: 0.72,
      });
    }
  }
  return imports;
}

function isPythonStarImportClause(value: string): boolean {
  return splitTopLevelCommaArgs(value.replace(/^\((.*)\)$/, '$1')).some((item) => item.trim() === '*');
}

interface PythonStarImportExpansion {
  importedNames: string[];
  namespaceImports: Array<{ localName: string; targetPath: string; sourceRefs: string[] }>;
}

function pythonStaticStarImportExpansion(input: {
  targetPath: string;
  pythonPaths: ReadonlySet<string>;
  pythonContentByPath: ReadonlyMap<string, string>;
  depth: number;
}): PythonStarImportExpansion {
  if (input.depth > LOCAL_RE_EXPORT_MAX_DEPTH) return { importedNames: [], namespaceImports: [] };
  const content = input.pythonContentByPath.get(input.targetPath);
  if (!content) return { importedNames: [], namespaceImports: [] };

  const explicitAllNames = pythonStaticAllNames(content);
  const names: string[] = [];
  const namespaceImports: PythonStarImportExpansion['namespaceImports'] = [];
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const lineRef = fileRef(input.targetPath, index + 1);
    const declaration = /^(?:class|def)\s+([A-Za-z_][\w]*)\b/.exec(line);
    if (
      declaration?.[1]
      && isPythonPublicImportName(declaration[1])
      && pythonStarImportNameAllowed(declaration[1], explicitAllNames)
    ) {
      names.push(declaration[1]);
    }

    const fromMatch = /^\s*from\s+([.\w]+)\s+import\s+(.+?)\s*$/.exec(line);
    if (!fromMatch?.[1] || !fromMatch[2]) continue;
    const moduleName = fromMatch[1];
    const targetPath = pythonImportModuleTargetPath(moduleName, input.targetPath, input.pythonPaths);

    if (isPythonStarImportClause(fromMatch[2])) {
      if (targetPath && targetPath !== input.targetPath) {
        const nested = pythonStaticStarImportExpansion({
          targetPath,
          pythonPaths: input.pythonPaths,
          pythonContentByPath: input.pythonContentByPath,
          depth: input.depth + 1,
        });
        names.push(...nested.importedNames.filter((name) => pythonStarImportNameAllowed(name, explicitAllNames)));
        namespaceImports.push(...nested.namespaceImports.map((item) => ({
          ...item,
          sourceRefs: uniqueSorted([lineRef, ...item.sourceRefs]),
        })).filter((item) => pythonStarImportNameAllowed(item.localName, explicitAllNames)));
      }
      continue;
    }

    for (const item of splitTopLevelCommaArgs(fromMatch[2].replace(/^\((.*)\)$/, '$1'))) {
      const importMatch = /^\s*([A-Za-z_][\w]*)(?:\s+as\s+([A-Za-z_][\w]*))?\s*$/.exec(item);
      const imported = importMatch?.[1];
      const local = importMatch?.[2] ?? imported;
      if (!imported || !local || !isPythonPublicImportName(local)) continue;
      if (!pythonStarImportNameAllowed(local, explicitAllNames)) continue;
      const memberModuleName = pythonImportMemberModuleName(moduleName, imported);
      const memberTargetPath = pythonImportModuleTargetPath(memberModuleName, input.targetPath, input.pythonPaths);
      if (memberTargetPath && memberTargetPath !== input.targetPath) {
        namespaceImports.push({
          localName: local,
          targetPath: memberTargetPath,
          sourceRefs: [lineRef],
        });
        continue;
      }
      if (targetPath && targetPath !== input.targetPath) names.push(local);
    }
  }

  const uniqueNames = uniqueSorted(names);
  const uniqueNamespaceImports = uniqueNamespaceImportsByLocalName(namespaceImports);
  return uniqueNames.length + uniqueNamespaceImports.length <= PYTHON_STAR_IMPORT_MAX_NAMES
    ? { importedNames: uniqueNames, namespaceImports: uniqueNamespaceImports }
    : { importedNames: [], namespaceImports: [] };
}

function isPythonPublicImportName(name: string): boolean {
  return /^[A-Za-z_][\w]*$/.test(name)
    && !name.startsWith('_')
    && !RESERVED_SYMBOL_NAMES.has(name);
}

function pythonStarImportNameAllowed(name: string, explicitAllNames: ReadonlySet<string> | null): boolean {
  return !explicitAllNames || explicitAllNames.has(name);
}

function pythonStaticAllNames(content: string): Set<string> | null {
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^\s*__all__\s*=\s*([\s\S]*)$/.exec(lines[index] ?? '');
    if (!match?.[1]) continue;

    const expressionLines = [match[1]];
    const opener = match[1].trimStart().at(0);
    const closer = opener === '[' ? ']' : opener === '(' ? ')' : null;
    if (!closer) return null;

    for (let offset = index + 1; offset < lines.length && !expressionLines.join('\n').includes(closer); offset += 1) {
      expressionLines.push(lines[offset] ?? '');
    }

    const expression = expressionLines
      .join('\n')
      .split('\n')
      .map((line) => line.replace(/\s+#.*$/, ''))
      .join('\n');
    if (!expression.includes(closer)) return null;

    const literals = [...expression.matchAll(/(['"])([^'"\\]*(?:\\.[^'"\\]*)*)\1/g)]
      .map((literal) => literal[2])
      .filter((name): name is string => Boolean(name && /^[A-Za-z_][\w]*$/.test(name)));
    const withoutStringLiterals = expression.replace(/(['"])([^'"\\]*(?:\\.[^'"\\]*)*)\1/g, '');
    const structuralRemainder = withoutStringLiterals.replace(/[\s,()[\]]/g, '');
    if (structuralRemainder.length > 0) return null;
    return new Set(uniqueSorted(literals));
  }
  return null;
}

function uniqueNamespaceImportsByLocalName(
  imports: PythonStarImportExpansion['namespaceImports'],
): PythonStarImportExpansion['namespaceImports'] {
  const byLocalName = new Map<string, { localName: string; targetPath: string; sourceRefs: string[] }>();
  for (const item of imports) {
    const existing = byLocalName.get(item.localName);
    if (existing && existing.targetPath !== item.targetPath) {
      byLocalName.delete(item.localName);
      continue;
    }
    byLocalName.set(item.localName, existing
      ? { ...existing, sourceRefs: uniqueSorted([...existing.sourceRefs, ...item.sourceRefs]) }
      : item);
  }
  return [...byLocalName.values()].sort((a, b) => a.localName.localeCompare(b.localName));
}

function goImportEvidenceForContent(
  content: string,
  path: string,
  goPaths: ReadonlySet<string>,
): InventoryImport[] {
  const imports: InventoryImport[] = [];
  const lines = content.split('\n');
  let inBlock = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const trimmed = line.trim();
    if (!inBlock && /^import\s*\(\s*$/.test(trimmed)) {
      inBlock = true;
      continue;
    }
    if (inBlock && trimmed === ')') {
      inBlock = false;
      continue;
    }

    const match = inBlock
      ? /^\s*(?:(\.|_|[A-Za-z_][\w]*)\s+)?["`]([^"`]+)["`]/.exec(line)
      : /^\s*import\s+(?:(\.|_|[A-Za-z_][\w]*)\s+)?["`]([^"`]+)["`]/.exec(line);
    if (!match?.[2] || match[1] === '.' || match[1] === '_') continue;

    const targetPaths = goImportPackageTargetPaths(match[2], path, goPaths);
    if (targetPaths.length === 0) continue;
    const localName = match[1] ?? goImportDefaultLocalName(match[2]);
    if (!localName || RESERVED_SYMBOL_NAMES.has(localName)) continue;

    const lineNo = index + 1;
    imports.push({
      id: `import_${slugify(path)}_${slugify(match[2])}_${lineNo}`,
      path,
      specifier: match[2],
      targetPaths,
      importedNames: [localName],
      namespaceImport: localName,
      sourceRefs: [fileRef(path, lineNo)],
      confidence: 0.72,
    });
  }
  return imports;
}

function goImportDefaultLocalName(specifier: string): string | null {
  return specifier.split('/').filter(Boolean).at(-1) ?? null;
}

function goImportPackageTargetPaths(
  specifier: string,
  importingPath: string,
  goPaths: ReadonlySet<string>,
): string[] {
  const normalizedSpecifier = specifier.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalizedSpecifier) return [];
  const packageDirs = uniqueSorted([...goPaths].map(parentPath).filter(Boolean));
  const exactDir = normalizedSpecifier.startsWith('.')
    ? resolveRelativeModulePath(importingPath, normalizedSpecifier)
    : normalizedSpecifier;
  const exactMatches = packageDirs.filter((dir) => dir === exactDir);
  const targetDir = exactMatches.length === 1
    ? exactMatches[0]!
    : (() => {
        const suffixMatches = packageDirs.filter((dir) => normalizedSpecifier.endsWith(`/${dir}`));
        return suffixMatches.length === 1 ? suffixMatches[0]! : null;
      })();
  if (!targetDir || targetDir === parentPath(importingPath)) return [];
  return uniqueSorted([...goPaths].filter((path) => parentPath(path) === targetDir));
}

function phpImportEvidenceForContent(
  content: string,
  path: string,
  phpPaths: ReadonlySet<string>,
): InventoryImport[] {
  const imports: InventoryImport[] = [];
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const statement = phpUseStatementAt(lines, index);
    if (!statement) continue;
    index = statement.endIndex;
    for (const item of phpUseImportItems(statement.body)) {
      const fqcn = item.fqcn;
      const targetPath = phpImportTargetPath(fqcn, phpPaths);
      if (!targetPath || targetPath === path) continue;
      const imported = phpClassBaseName(fqcn);
      const local = item.local ?? imported;
      if (!imported || !local || RESERVED_SYMBOL_NAMES.has(local)) continue;
      const lineNo = statement.lineNo;
      imports.push({
        id: `import_${slugify(path)}_${slugify(fqcn)}_${lineNo}`,
        path,
        specifier: fqcn,
        targetPath,
        importedNames: [local],
        namedImports: [{ imported, local }],
        sourceRefs: [fileRef(path, lineNo)],
        confidence: 0.74,
      });
    }
  }
  return imports;
}

function phpUseStatementAt(lines: readonly string[], index: number): { body: string; lineNo: number; endIndex: number } | null {
  const firstLine = lines[index] ?? '';
  const start = /^\s*use\s+(?!function\b|const\b)(.*)$/.exec(firstLine);
  if (!start?.[1]) return null;

  const parts = [start[1]];
  let endIndex = index;
  for (
    let offset = index + 1;
    !parts.join('\n').includes(';') && offset < lines.length && offset - index < PHP_USE_STATEMENT_MAX_LINES;
    offset += 1
  ) {
    parts.push(lines[offset] ?? '');
    endIndex = offset;
  }

  const text = parts.join('\n');
  const semicolonIndex = text.indexOf(';');
  if (semicolonIndex < 0) return null;
  const body = text.slice(0, semicolonIndex).trim();
  return body ? { body, lineNo: index + 1, endIndex } : null;
}

function phpUseImportItems(value: string): Array<{ fqcn: string; local: string | null }> {
  const imports: Array<{ fqcn: string; local: string | null }> = [];
  for (const item of splitTopLevelCommaArgs(value)) {
    const group = phpGroupUseImport(item);
    if (group) {
      imports.push(...group);
      continue;
    }

    const importMatch = /^\s*\\?([A-Za-z_][\w]*(?:\\[A-Za-z_][\w]*)*)(?:\s+as\s+([A-Za-z_][\w]*))?\s*$/i.exec(item);
    const fqcn = importMatch?.[1];
    if (!fqcn) continue;
    imports.push({ fqcn, local: importMatch?.[2] ?? null });
  }
  return imports;
}

function phpGroupUseImport(item: string): Array<{ fqcn: string; local: string | null }> | null {
  const trimmed = item.trim();
  const openBrace = trimmed.indexOf('{');
  if (openBrace <= 0 || !trimmed.endsWith('}')) return null;

  const prefix = trimmed.slice(0, openBrace).replace(/\\+$/, '').replace(/^\\+/, '');
  if (!/^[A-Za-z_][\w]*(?:\\[A-Za-z_][\w]*)*$/.test(prefix)) return null;
  const inner = trimmed.slice(openBrace + 1, -1);
  const imports: Array<{ fqcn: string; local: string | null }> = [];
  for (const member of splitTopLevelCommaArgs(inner)) {
    if (/^\s*(?:function|const)\b/i.test(member)) continue;
    const memberMatch = /^\s*([A-Za-z_][\w]*(?:\\[A-Za-z_][\w]*)*)(?:\s+as\s+([A-Za-z_][\w]*))?\s*$/i.exec(member);
    const imported = memberMatch?.[1];
    if (!imported) continue;
    imports.push({
      fqcn: `${prefix}\\${imported}`,
      local: memberMatch?.[2] ?? null,
    });
  }
  return imports;
}

function phpImportTargetPath(
  fqcn: string,
  phpPaths: ReadonlySet<string>,
): string | null {
  const normalized = fqcn.replace(/^\\+/, '').split('\\').filter(Boolean).join('/');
  if (!normalized) return null;
  const candidates = phpImportPathCandidates(normalized);
  for (const candidate of candidates) {
    if (phpPaths.has(candidate)) return candidate;
  }
  const suffixMatches = [...phpPaths].filter((path) => (
    candidates.some((candidate) => path.endsWith(`/${candidate}`))
  ));
  return suffixMatches.length === 1 ? suffixMatches[0]! : null;
}

function phpImportPathCandidates(normalizedFqcn: string): string[] {
  const candidates = [`${normalizedFqcn}.php`, `src/${normalizedFqcn}.php`];
  if (normalizedFqcn.startsWith('App/')) {
    const appRelative = normalizedFqcn.slice('App/'.length);
    candidates.push(`app/${appRelative}.php`, `src/${appRelative}.php`);
  }
  return uniqueInOrder(candidates);
}

function rubyImportEvidenceForContent(
  content: string,
  path: string,
  rubyPaths: ReadonlySet<string>,
): InventoryImport[] {
  const imports: InventoryImport[] = [];
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const match = /^\s*(require_relative|require_dependency|require)\s+['"]([^'"]+)['"]/.exec(line);
    if (!match?.[1] || !match[2]) continue;
    const targetPath = rubyRequireTargetPath(
      match[2],
      path,
      rubyPaths,
      match[1] === 'require_relative',
      match[1] === 'require_dependency',
    );
    if (!targetPath || targetPath === path) continue;
    const className = rubyClassNameForRequirePath(targetPath);
    if (!className) continue;
    const lineNo = index + 1;
    imports.push({
      id: `import_${slugify(path)}_${slugify(match[2])}_${lineNo}`,
      path,
      specifier: match[2],
      targetPath,
      importedNames: [className],
      namedImports: [{ imported: className, local: className }],
      sourceRefs: [fileRef(path, lineNo)],
      confidence: 0.7,
    });
  }
  return imports;
}

function rubyRequireTargetPath(
  specifier: string,
  importingPath: string,
  rubyPaths: ReadonlySet<string>,
  relative: boolean,
  railsDependency = false,
): string | null {
  const normalizedSpecifier = specifier.replace(/\\/g, '/').replace(/\.rb$/i, '');
  if (!normalizedSpecifier) return null;
  const isRelative = relative || normalizedSpecifier.startsWith('.');
  const candidates = isRelative
    ? [`${resolveRelativeModulePath(importingPath, normalizedSpecifier)}.rb`]
    : rubyRequireCandidates(normalizedSpecifier, railsDependency);
  const exactMatches = candidates.filter((candidate) => rubyPaths.has(candidate));
  if (exactMatches.length === 1) return exactMatches[0]!;
  if (exactMatches.length > 1) return null;
  if (isRelative) return null;

  const suffixMatches = [...rubyPaths].filter((path) => (
    candidates.some((candidate) => path.endsWith(`/${candidate}`))
    && (!railsDependency || isRailsRubyLoadPath(path))
  ));
  return suffixMatches.length === 1 ? suffixMatches[0]! : null;
}

function rubyRequireCandidates(normalizedSpecifier: string, railsDependency: boolean): string[] {
  const candidates = [`${normalizedSpecifier}.rb`];
  if (railsDependency) {
    candidates.push(`app/${normalizedSpecifier}.rb`, `lib/${normalizedSpecifier}.rb`);
    if (!normalizedSpecifier.includes('/')) {
      for (const root of ['controllers', 'models', 'services', 'repositories', 'jobs', 'mailers']) {
        candidates.push(`app/${root}/${normalizedSpecifier}.rb`);
      }
    }
  }
  return uniqueInOrder(candidates);
}

function isRailsRubyLoadPath(path: string): boolean {
  return path.startsWith('app/')
    || path.startsWith('lib/')
    || path.includes('/app/')
    || path.includes('/lib/');
}

function rubyClassNameForRequirePath(path: string): string | null {
  const parts = basenameWithoutExt(path).split('_').filter(Boolean);
  if (parts.length === 0) return null;
  return parts.map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join('');
}

function javaImportEvidenceForContent(
  content: string,
  path: string,
  javaPaths: ReadonlySet<string>,
): InventoryImport[] {
  const imports: InventoryImport[] = [];
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const lineNo = index + 1;

    const packageMatch = /^\s*package\s+([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)\s*;/.exec(line);
    if (packageMatch?.[1]) {
      const targetPaths = javaPackageTargetPaths(packageMatch[1], javaPaths);
      const importedNames = classNamesForPaths(targetPaths);
      if (importedNames.length > 0) {
        imports.push({
          id: `import_${slugify(path)}_${slugify(packageMatch[1])}_${lineNo}_package`,
          path,
          specifier: packageMatch[1],
          targetPaths,
          importedNames,
          namedImports: importedNames.map((name) => ({ imported: name, local: name })),
          sourceRefs: [fileRef(path, lineNo)],
          confidence: 0.73,
        });
      }
      continue;
    }

    const wildcardMatch = /^\s*import\s+(?!static\b)([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)\.\*\s*;/.exec(line);
    if (wildcardMatch?.[1]) {
      const targetPaths = javaPackageTargetPaths(wildcardMatch[1], javaPaths);
      const importedNames = classNamesForPaths(targetPaths);
      if (importedNames.length > 0) {
        imports.push({
          id: `import_${slugify(path)}_${slugify(wildcardMatch[1])}_${lineNo}_wildcard`,
          path,
          specifier: `${wildcardMatch[1]}.*`,
          targetPaths,
          importedNames,
          namedImports: importedNames.map((name) => ({ imported: name, local: name })),
          sourceRefs: [fileRef(path, lineNo)],
          confidence: 0.69,
        });
      }
      continue;
    }

    const importMatch = /^\s*import\s+(?!static\b)([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)+)\s*;/.exec(line);
    if (!importMatch?.[1]) continue;
    const targetPath = javaTypeTargetPath(importMatch[1], javaPaths);
    if (!targetPath || targetPath === path) continue;
    const imported = namespaceLeafName(importMatch[1]);
    if (!imported || RESERVED_SYMBOL_NAMES.has(imported)) continue;
    imports.push({
      id: `import_${slugify(path)}_${slugify(importMatch[1])}_${lineNo}`,
      path,
      specifier: importMatch[1],
      targetPath,
      importedNames: [imported],
      namedImports: [{ imported, local: imported }],
      sourceRefs: [fileRef(path, lineNo)],
      confidence: 0.75,
    });
  }
  return imports;
}

function csharpUsingEvidenceForContent(
  content: string,
  path: string,
  csharpPaths: ReadonlySet<string>,
): InventoryImport[] {
  const imports: InventoryImport[] = [];
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const lineNo = index + 1;

    const namespaceMatch = /^\s*namespace\s+([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)\s*(?:[;{]|$)/.exec(line);
    if (namespaceMatch?.[1]) {
      const targetPaths = csharpNamespaceTargetPaths(namespaceMatch[1], csharpPaths);
      const importedNames = classNamesForPaths(targetPaths);
      if (importedNames.length > 0) {
        imports.push({
          id: `import_${slugify(path)}_${slugify(namespaceMatch[1])}_${lineNo}_namespace`,
          path,
          specifier: namespaceMatch[1],
          targetPaths,
          importedNames,
          namedImports: importedNames.map((name) => ({ imported: name, local: name })),
          sourceRefs: [fileRef(path, lineNo)],
          confidence: 0.72,
        });
      }
      continue;
    }

    const aliasMatch = /^\s*using\s+([A-Za-z_][\w]*)\s*=\s*([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)+)\s*;/.exec(line);
    if (aliasMatch?.[1] && aliasMatch[2]) {
      const targetPath = csharpTypeTargetPath(aliasMatch[2], csharpPaths);
      const imported = namespaceLeafName(aliasMatch[2]);
      if (!targetPath || targetPath === path || !imported || RESERVED_SYMBOL_NAMES.has(aliasMatch[1])) continue;
      imports.push({
        id: `import_${slugify(path)}_${slugify(aliasMatch[2])}_${lineNo}_alias`,
        path,
        specifier: aliasMatch[2],
        targetPath,
        importedNames: [aliasMatch[1]],
        namedImports: [{ imported, local: aliasMatch[1] }],
        sourceRefs: [fileRef(path, lineNo)],
        confidence: 0.74,
      });
      continue;
    }

    const usingMatch = /^\s*using\s+(?!static\b)([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)\s*;/.exec(line);
    if (!usingMatch?.[1]) continue;
    const targetPaths = csharpNamespaceTargetPaths(usingMatch[1], csharpPaths);
    const importedNames = classNamesForPaths(targetPaths);
    if (importedNames.length === 0) continue;
    imports.push({
      id: `import_${slugify(path)}_${slugify(usingMatch[1])}_${lineNo}`,
      path,
      specifier: usingMatch[1],
      targetPaths,
      importedNames,
      namedImports: importedNames.map((name) => ({ imported: name, local: name })),
      sourceRefs: [fileRef(path, lineNo)],
      confidence: 0.7,
    });
  }
  return imports;
}

function javaTypeTargetPath(
  namespaceName: string,
  javaPaths: ReadonlySet<string>,
): string | null {
  const normalized = namespaceName.split('.').filter(Boolean).join('/');
  if (!normalized) return null;
  const candidate = `${normalized}.java`;
  if (javaPaths.has(candidate)) return candidate;
  const suffixMatches = [...javaPaths].filter((path) => path.endsWith(`/${candidate}`));
  return suffixMatches.length === 1 ? suffixMatches[0]! : null;
}

function csharpTypeTargetPath(
  namespaceName: string,
  csharpPaths: ReadonlySet<string>,
): string | null {
  const normalized = namespaceName.split('.').filter(Boolean).join('/');
  if (!normalized) return null;
  const candidate = `${normalized}.cs`;
  if (csharpPaths.has(candidate)) return candidate;
  const suffixMatches = [...csharpPaths].filter((path) => path.endsWith(`/${candidate}`));
  return suffixMatches.length === 1 ? suffixMatches[0]! : null;
}

function javaPackageTargetPaths(
  packageName: string,
  javaPaths: ReadonlySet<string>,
): string[] {
  const normalized = packageName.split('.').filter(Boolean).join('/');
  if (!normalized) return [];
  return namespaceDirectoryTargetPaths([normalized], javaPaths);
}

function csharpNamespaceTargetPaths(
  namespaceName: string,
  csharpPaths: ReadonlySet<string>,
): string[] {
  const parts = namespaceName.split('.').filter(Boolean);
  const candidates: string[] = [];
  for (let start = 0; start <= parts.length - 2; start += 1) {
    candidates.push(parts.slice(start).join('/'));
  }
  return namespaceDirectoryTargetPaths(candidates, csharpPaths);
}

function namespaceDirectoryTargetPaths(
  candidateDirs: readonly string[],
  paths: ReadonlySet<string>,
): string[] {
  const directories = uniqueSorted([...paths].map(parentPath).filter(Boolean));
  for (const candidateDir of candidateDirs) {
    const matchingDirs = directories.filter((dir) => dir === candidateDir || dir.endsWith(`/${candidateDir}`));
    if (matchingDirs.length !== 1) continue;
    return uniqueSorted([...paths].filter((path) => parentPath(path) === matchingDirs[0]));
  }
  return [];
}

function classNamesForPaths(paths: readonly string[]): string[] {
  return uniqueSorted(paths.map(basenameWithoutExt).filter((name) => /^[A-Z][\w$]*$/.test(name)));
}

function namespaceLeafName(namespaceName: string): string | null {
  return namespaceName.split('.').filter(Boolean).at(-1) ?? null;
}

function collectHeuristicReceiverReferences(
  file: ScannedInventoryFile,
  symbols: readonly InventorySymbol[],
  allSymbols: readonly InventorySymbol[],
  evidence: Pick<ParserEvidence, 'references' | 'constructedReceivers'>,
  imports: readonly InventoryImport[] = [],
  configuredReceivers: readonly InventoryConstructedReceiver[] = [],
  registeredImplementations: ReadonlyMap<string, RegisteredImplementationEvidence> = new Map(),
): void {
  const classSymbolsByLine = symbolsByLine(symbols.filter((symbol) => symbol.kind === 'class'));
  const methodSymbolsByLine = symbolsByLine(
    symbols.filter((symbol) => symbol.kind === 'method' || symbol.kind === 'function'),
  );
  if (methodSymbolsByLine.size === 0) return;

  const importsForFile = imports
    .filter((item) => item.path === file.path)
    .sort((a, b) => a.id.localeCompare(b.id));
  const knownPaths = new Set([
    ...allSymbols.map((symbol) => symbol.path),
    ...imports.flatMap((item) => [
      item.targetPath ?? '',
      ...(item.targetPaths ?? []),
    ]).filter(Boolean),
  ]);
  let classScope: { symbol: InventorySymbol; constructedTypes: Map<string, ConstructedTypeEvidence>; braceDepth: number; opened: boolean } | null = null;
  let methodScope: {
    symbol: InventorySymbol;
    constructedTypes: Map<string, ConstructedTypeEvidence>;
    constructorParams: Map<string, ConstructorParameterEvidence>;
    braceDepth: number;
    opened: boolean;
  } | null = null;
  const lines = file.content.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const lineNo = index + 1;
    const trimmed = line.trim();

    const classSymbol = classSymbolsByLine.get(lineNo)?.at(0);
    if (classSymbol) {
      classScope = { symbol: classSymbol, constructedTypes: new Map(), braceDepth: 0, opened: false };
      for (const receiver of configuredReceivers) {
        if (receiver.ownerName && receiver.ownerName !== classSymbol.name) continue;
        recordConstructedReceiver(classScope.constructedTypes, receiver);
        evidence.constructedReceivers.push(receiver);
      }
    }

    const methodSymbol = methodSymbolsByLine.get(lineNo)?.at(0);
    if (methodSymbol) {
      const methodConstructedTypes = new Map<string, ConstructedTypeEvidence>();
      const goOwnerName = goMethodReceiverType(methodSymbol.signature);
      if (goOwnerName) {
        for (const receiver of configuredReceivers) {
          if (receiver.ownerName !== goOwnerName) continue;
          recordConstructedReceiver(methodConstructedTypes, receiver);
          evidence.constructedReceivers.push(receiver);
        }
      }
      methodScope = {
        symbol: methodSymbol,
        constructedTypes: methodConstructedTypes,
        constructorParams: classScope && isConstructorMethodSymbol(file.path, classScope.symbol.name, methodSymbol.name)
          ? constructorParameterEvidenceForLine(file.path, line, lineNo)
          : new Map(),
        braceDepth: 0,
        opened: false,
      };
    }

    if (trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('*')) {
      const constructed = constructedReceiversForLine(file.path, line, lineNo);
      if (constructed.length > 0) {
        const targetMap = methodScope?.constructedTypes ?? classScope?.constructedTypes;
        if (targetMap) {
          for (const receiver of constructed) {
            const normalizedReceiver = normalizeConstructedReceiverTarget({
              receiver,
              imports: importsForFile,
              allImports: imports,
              symbols: allSymbols,
              knownPaths,
            });
            recordConstructedReceiver(targetMap, normalizedReceiver);
            evidence.constructedReceivers.push(normalizedReceiver);
          }
        }
      }

      const factoryAssigned = factoryAssignedReceiversForLine({
        path: file.path,
        line,
        lineNo,
        symbols: allSymbols,
      });
      if (factoryAssigned.length > 0) {
        const targetMap = methodScope?.constructedTypes ?? classScope?.constructedTypes;
        if (targetMap) {
          for (const receiver of factoryAssigned) {
            recordConstructedReceiver(targetMap, receiver);
            evidence.constructedReceivers.push(receiver);
          }
        }
      }

      if (classScope && methodScope?.constructorParams.size) {
        const injected = injectedReceiversForLine({
          path: file.path,
          line,
          lineNo,
          constructorParams: methodScope.constructorParams,
          symbols: allSymbols,
          imports: importsForFile,
          allImports: imports,
          knownPaths,
          registeredImplementations,
        });
        for (const receiver of injected) {
          recordConstructedReceiver(classScope.constructedTypes, receiver);
          evidence.constructedReceivers.push(receiver);
        }
      }

      if (methodScope) {
        const availableReceivers = new Map([
          ...(classScope?.constructedTypes.entries() ?? []),
          ...methodScope.constructedTypes.entries(),
        ]);
        for (const call of receiverCallsForLine(line)) {
          const constructedReceiver = availableReceivers.get(call.receiverName);
          if (!constructedReceiver) continue;
          const sourceRefs = uniqueSorted([
            ...constructedReceiver.sourceRefs,
            fileRef(file.path, lineNo),
          ]);
          evidence.references.push({
            fromSymbolId: methodScope.symbol.id,
            targetName: constructedReceiver.targetName,
            targetPath: constructedReceiver.targetPath,
            path: file.path,
            label: `uses ${constructedReceiver.targetName}`,
            sourceRefs,
            confidence: 0.68,
          });
          evidence.references.push({
            fromSymbolId: methodScope.symbol.id,
            targetName: `${constructedReceiver.targetName}.${call.methodName}`,
            targetPath: constructedReceiver.targetPath,
            path: file.path,
            label: `calls ${constructedReceiver.targetName}.${call.methodName}`,
            sourceRefs,
            confidence: 0.7,
          });
        }
      }
    }

    const delta = braceDeltaForLine(line);
    if (methodScope) {
      methodScope.braceDepth += delta;
      methodScope.opened = methodScope.opened || line.includes('{');
      if ((methodScope.opened && methodScope.braceDepth <= 0) || (!methodScope.opened && /=>/.test(line))) {
        methodScope = null;
      }
    }
    if (classScope) {
      classScope.braceDepth += delta;
      classScope.opened = classScope.opened || line.includes('{');
      if (classScope.opened && classScope.braceDepth <= 0) {
        classScope = null;
      }
    }
  }
}

function isConstructorMethodSymbol(path: string, className: string, methodName: string): boolean {
  return methodName === className
    || (isPhpSourceLikePath(path) && methodName === '__construct')
    || (/\.py$/i.test(path) && methodName === '__init__');
}

function mergeConstructedReceiversByPath(
  ...maps: Array<ReadonlyMap<string, readonly InventoryConstructedReceiver[]>>
): Map<string, InventoryConstructedReceiver[]> {
  const merged = new Map<string, InventoryConstructedReceiver[]>();
  for (const map of maps) {
    for (const [path, receivers] of map.entries()) {
      merged.set(path, [...(merged.get(path) ?? []), ...receivers]);
    }
  }
  for (const [path, receivers] of merged.entries()) {
    merged.set(path, dedupeConstructedReceivers([...receivers]));
  }
  return merged;
}

function normalizeConstructedReceiverTarget(input: {
  receiver: InventoryConstructedReceiver;
  imports: readonly InventoryImport[];
  allImports?: readonly InventoryImport[];
  symbols: readonly InventorySymbol[];
  knownPaths: ReadonlySet<string>;
}): InventoryConstructedReceiver {
  if (input.receiver.targetPath) return input.receiver;
  const phpFullyQualified = phpFullyQualifiedClassSymbolForTargetName({
    targetName: input.receiver.targetName,
    symbols: input.symbols,
    knownPaths: input.knownPaths,
  });
  if (phpFullyQualified) {
    return {
      ...input.receiver,
      targetName: phpFullyQualified.symbol.name,
      targetPath: phpFullyQualified.symbol.path,
      sourceRefs: uniqueSorted([
        ...input.receiver.sourceRefs,
        ...phpFullyQualified.sourceRefs,
      ]),
    };
  }
  const imported = importedClassLikeSymbolForLocalName({
    localName: input.receiver.targetName,
    imports: input.imports,
    allImports: input.allImports ?? input.imports,
    symbols: input.symbols,
    knownPaths: input.knownPaths,
  });
  if (!imported) return input.receiver;
  return {
    ...input.receiver,
    targetName: imported.symbol.name,
    targetPath: imported.symbol.path,
    sourceRefs: uniqueSorted([
      ...input.receiver.sourceRefs,
      ...imported.sourceRefs,
      ...imported.symbol.sourceRefs,
    ]),
  };
}

function phpFullyQualifiedClassSymbolForTargetName(input: {
  targetName: string;
  symbols: readonly InventorySymbol[];
  knownPaths: ReadonlySet<string>;
}): SymbolResolution | null {
  if (!input.targetName.includes('\\')) return null;
  const className = phpClassBaseName(input.targetName);
  if (!className) return null;
  const targetPath = phpImportTargetPath(input.targetName, input.knownPaths);
  if (!targetPath) return null;
  const symbol = bestSymbolInPaths(input.symbols, className, new Set([targetPath]));
  return symbol && isClassLikeSymbol(symbol)
    ? { symbol, sourceRefs: symbol.sourceRefs }
    : null;
}

function importedClassLikeSymbolForLocalName(input: {
  localName: string;
  imports: readonly InventoryImport[];
  allImports?: readonly InventoryImport[];
  symbols: readonly InventorySymbol[];
  knownPaths: ReadonlySet<string>;
}): SymbolResolution | null {
  const allImports = input.allImports ?? input.imports;
  const namespaceClass = namespaceClassReference(input.localName);
  if (namespaceClass) {
    const namespaceImports = input.imports
      .filter((item) => (
        item.namespaceImport === namespaceClass.namespaceExpression
        || item.specifier === namespaceClass.namespaceExpression
      ))
      .sort((a, b) => a.id.localeCompare(b.id));
    for (const item of namespaceImports) {
      const targetPaths = importTargetPaths(item, input.knownPaths);
      if (targetPaths.size === 0) continue;
      if (!canResolveDirectSymbolsFromImport(item)) continue;

      const resolved = resolveClassLikeSymbolFromImport({
        item,
        importedName: namespaceClass.className,
        allImports,
        symbols: input.symbols,
        knownPaths: input.knownPaths,
        depth: 0,
      });
      if (resolved) return resolved;
    }
  }

  const namespaceMember = namespaceMemberHandler(input.localName);
  if (namespaceMember) {
    const namespaceImports = input.imports
      .filter((item) => item.namespaceImport === namespaceMember.namespaceName)
      .sort((a, b) => a.id.localeCompare(b.id));
    for (const item of namespaceImports) {
      const targetPaths = importTargetPaths(item, input.knownPaths);
      if (targetPaths.size === 0) continue;
      if (!canResolveDirectSymbolsFromImport(item)) continue;

      const resolved = resolveClassLikeSymbolFromImport({
        item,
        importedName: namespaceMember.memberName,
        allImports,
        symbols: input.symbols,
        knownPaths: input.knownPaths,
        depth: 0,
      });
      if (resolved) return resolved;
    }
  }

  const imports = input.imports
    .filter((item) => importIncludesLocalName(item, input.localName))
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const item of imports) {
    const importedName = importedNameForLocalName(item, input.localName) ?? input.localName;
    const targetPaths = importTargetPaths(item, input.knownPaths);
    if (targetPaths.size === 0) continue;
    if (!canResolveDirectSymbolsFromImport(item)) continue;

    const resolved = resolveClassLikeSymbolFromImport({
      item,
      importedName,
      allImports,
      symbols: input.symbols,
      knownPaths: input.knownPaths,
      depth: 0,
    });
    if (resolved) return resolved;
  }

  return null;
}

function resolveClassLikeSymbolFromImport(input: {
  item: InventoryImport;
  importedName: string;
  allImports: readonly InventoryImport[];
  symbols: readonly InventorySymbol[];
  knownPaths: ReadonlySet<string>;
  depth: number;
}): SymbolResolution | null {
  const targetPaths = importTargetPaths(input.item, input.knownPaths);
  if (targetPaths.size === 0) return null;
  if (!canResolveDirectSymbolsFromImport(input.item)) return null;

  const directSymbol = bestSymbolInPaths(input.symbols, input.importedName, targetPaths);
  if (directSymbol && isClassLikeSymbol(directSymbol)) {
    return {
      symbol: directSymbol,
      sourceRefs: uniqueSorted([...input.item.sourceRefs, ...directSymbol.sourceRefs]),
    };
  }

  if (input.depth >= LOCAL_RE_EXPORT_MAX_DEPTH) return null;
  const reExportImports = input.allImports
    .filter((item) => (
      targetPaths.has(item.path)
      && item.path.endsWith('.py')
      && importIncludesLocalName(item, input.importedName)
    ))
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const reExportImport of reExportImports) {
    const reExportedName = importedNameForLocalName(reExportImport, input.importedName) ?? input.importedName;
    const resolved = resolveClassLikeSymbolFromImport({
      item: reExportImport,
      importedName: reExportedName,
      allImports: input.allImports,
      symbols: input.symbols,
      knownPaths: input.knownPaths,
      depth: input.depth + 1,
    });
    if (resolved) {
      return {
        symbol: resolved.symbol,
        sourceRefs: uniqueSorted([...input.item.sourceRefs, ...resolved.sourceRefs]),
      };
    }
  }

  return null;
}

function namespaceClassReference(value: string): { namespaceExpression: string; className: string } | null {
  const parts = value.split('.').filter(Boolean);
  if (parts.length < 2) return null;
  const className = parts.at(-1);
  if (!className || !/^[A-Z][\w]*$/.test(className)) return null;
  const namespaceExpression = parts.slice(0, -1).join('.');
  if (!/^[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*$/.test(namespaceExpression)) return null;
  return { namespaceExpression, className };
}

function symbolsByLine(symbols: readonly InventorySymbol[]): Map<number, InventorySymbol[]> {
  const byLine = new Map<number, InventorySymbol[]>();
  for (const symbol of symbols) {
    byLine.set(symbol.line, [...(byLine.get(symbol.line) ?? []), symbol]);
  }
  for (const values of byLine.values()) {
    values.sort(compareImportedHandlerSymbols);
  }
  return byLine;
}

function constructorParameterEvidenceForLine(
  path: string,
  line: string,
  lineNo: number,
): Map<string, ConstructorParameterEvidence> {
  const params = new Map<string, ConstructorParameterEvidence>();
  const args = /\(([^)]*)\)/.exec(line)?.[1];
  if (!args) return params;
  for (const item of splitTopLevelCommaArgs(args)) {
    if (/\.py$/i.test(path)) {
      const pythonParam = pythonConstructorParameterEvidenceForItem(path, item);
      if (pythonParam) {
        params.set(pythonParam.variableName, {
          typeName: pythonParam.typeName,
          sourceRefs: [fileRef(path, lineNo)],
        });
      }
      continue;
    }

    const cleaned = item
      .replace(/@\w+(?:\([^)]*\))?\s*/g, '')
      .replace(/\b(?:final|readonly|params|ref|out|in)\b\s*/g, '')
      .trim();
    const match = /^(.+?)\s+([A-Za-z_$][\w$]*)$/.exec(cleaned);
    const typeName = baseTypeName(match?.[1] ?? '');
    const variableName = normalizeConstructorParameterName(path, match?.[2]);
    if (!typeName || !variableName || RESERVED_SYMBOL_NAMES.has(variableName)) continue;
    params.set(variableName, {
      typeName,
      sourceRefs: [fileRef(path, lineNo)],
    });
  }
  return params;
}

function pythonConstructorParameterEvidenceForItem(
  path: string,
  item: string,
): { variableName: string; typeName: string } | null {
  if (!/\.py$/i.test(path)) return null;
  const cleaned = item
    .replace(/=.*/, '')
    .trim();
  const match = /^([A-Za-z_][\w]*)\s*:\s*([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)$/.exec(cleaned);
  const variableName = match?.[1];
  const typeName = match?.[2];
  if (
    !variableName
    || !typeName
    || variableName === 'self'
    || variableName === 'cls'
    || RESERVED_SYMBOL_NAMES.has(variableName)
  ) {
    return null;
  }
  return { variableName, typeName };
}

function normalizeConstructorParameterName(path: string, value: string | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  return isPhpSourceLikePath(path) ? normalized.replace(/^\$/, '') : normalized;
}

function injectedReceiversForLine(input: {
  path: string;
  line: string;
  lineNo: number;
  constructorParams: ReadonlyMap<string, ConstructorParameterEvidence>;
  symbols: readonly InventorySymbol[];
  imports: readonly InventoryImport[];
  allImports: readonly InventoryImport[];
  knownPaths: ReadonlySet<string>;
  registeredImplementations: ReadonlyMap<string, RegisteredImplementationEvidence>;
}): InventoryConstructedReceiver[] {
  const receivers: InventoryConstructedReceiver[] = [];
  for (const assignment of injectedReceiverAssignmentsForLine(input.path, input.line)) {
    if (RESERVED_SYMBOL_NAMES.has(assignment.variableName)) continue;
    const param = input.constructorParams.get(assignment.paramName);
    if (!param) continue;
    const explicitClass = explicitClassSymbolForInjectedReceiverType({
      path: input.path,
      typeName: param.typeName,
      symbols: input.symbols,
      imports: input.imports,
      allImports: input.allImports,
      knownPaths: input.knownPaths,
    });
    if (explicitClass) {
      receivers.push({
        path: input.path,
        variableName: assignment.variableName,
        targetName: explicitClass.symbol.name,
        targetPath: explicitClass.symbol.path,
        sourceRefs: uniqueSorted([
          ...param.sourceRefs,
          fileRef(input.path, input.lineNo),
          ...explicitClass.sourceRefs,
        ]),
      });
      continue;
    }

    const registered = registeredImplementationForServiceType(param.typeName, input.registeredImplementations);
    const implementation = registered
      ? input.symbols.find((symbol) => (
        symbol.kind === 'class'
        && symbol.name === registered.implementationName
        && symbol.path === registered.implementationPath
      )) ?? null
      : uniqueImplementationForInterfaceType(param.typeName, input.symbols);
    if (!implementation) continue;
    receivers.push({
      path: input.path,
      variableName: assignment.variableName,
      targetName: implementation.name,
      targetPath: implementation.path,
      sourceRefs: uniqueSorted([
        ...param.sourceRefs,
        fileRef(input.path, input.lineNo),
        ...(registered?.sourceRefs ?? []),
      ]),
    });
  }
  return receivers;
}

function explicitClassSymbolForInjectedReceiverType(input: {
  path: string;
  typeName: string;
  symbols: readonly InventorySymbol[];
  imports: readonly InventoryImport[];
  allImports: readonly InventoryImport[];
  knownPaths: ReadonlySet<string>;
}): SymbolResolution | null {
  const normalizedTypeName = input.typeName.trim();
  if (!normalizedTypeName) return null;

  const imported = importedClassLikeSymbolForLocalName({
    localName: normalizedTypeName,
    imports: input.imports,
    allImports: input.allImports,
    symbols: input.symbols,
    knownPaths: input.knownPaths,
  });
  if (imported) return imported;

  if (/\.py$/i.test(input.path)) return null;

  const direct = classSymbolForExplicitReceiverType(baseTypeName(normalizedTypeName), input.path, input.symbols);
  return direct ? { symbol: direct, sourceRefs: direct.sourceRefs } : null;
}

function injectedReceiverAssignmentsForLine(
  path: string,
  line: string,
): Array<{ variableName: string; paramName: string }> {
  const assignments: Array<{ variableName: string; paramName: string }> = [];
  const assignment = /(?:^|[^\w$])(?:this\.)?([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;/g;
  for (const match of line.matchAll(assignment)) {
    const variableName = match[1];
    const paramName = match[2];
    if (!variableName || !paramName) continue;
    assignments.push({ variableName, paramName });
  }

  if (/\.py$/i.test(path)) {
    const pythonAssignment = /\bself\s*\.\s*([A-Za-z_][\w]*)\s*=\s*([A-Za-z_][\w]*)\s*(?:#.*)?$/g;
    for (const match of line.matchAll(pythonAssignment)) {
      const variableName = match[1];
      const paramName = match[2];
      if (!variableName || !paramName) continue;
      assignments.push({ variableName: `self.${variableName}`, paramName });
    }
    return assignments;
  }

  if (!isPhpSourceLikePath(path)) return assignments;
  const phpAssignment = /(\$this\s*->\s*[A-Za-z_][\w]*|\$[A-Za-z_][\w]*)\s*=\s*(\$[A-Za-z_][\w]*)\s*;/g;
  for (const match of line.matchAll(phpAssignment)) {
    const variableName = normalizePhpReceiverName(match[1]);
    const paramName = normalizeConstructorParameterName(path, match[2]);
    if (!variableName || !paramName) continue;
    assignments.push({ variableName, paramName });
  }
  return assignments;
}

function registeredImplementationForServiceType(
  typeName: string,
  registeredImplementations: ReadonlyMap<string, RegisteredImplementationEvidence>,
): RegisteredImplementationEvidence | null {
  const serviceName = baseTypeName(typeName);
  if (!serviceName) return null;
  return registeredImplementations.get(serviceName) ?? null;
}

function csharpRegisteredImplementationsForFiles(
  files: readonly ScannedInventoryFile[],
  symbols: readonly InventorySymbol[],
  imports: readonly InventoryImport[],
): Map<string, RegisteredImplementationEvidence> {
  const csharpSymbols = symbols.filter((symbol) => symbol.path.endsWith('.cs'));
  if (csharpSymbols.length === 0) return new Map();

  const csharpPaths = new Set(csharpSymbols.map((symbol) => symbol.path));
  const knownPaths = new Set(csharpSymbols.map((symbol) => symbol.path));
  const registrationsByService = new Map<string, RegisteredImplementationEvidence[]>();

  for (const file of files) {
    if (!file.path.endsWith('.cs')) continue;
    const lines = file.content.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const lineNo = index + 1;
      for (const registration of csharpServiceRegistrationTypePairsForLine(line)) {
        const serviceName = baseTypeName(registration.serviceType);
        const implementationName = baseTypeName(registration.implementationType);
        if (!serviceName || !implementationName) continue;

        const implementation = csharpRegisteredImplementationSymbol({
          implementationType: registration.implementationType,
          serviceName,
          registrationPath: file.path,
          symbols: csharpSymbols,
          imports,
          csharpPaths,
          knownPaths,
        });
        if (!implementation) continue;

        registrationsByService.set(serviceName, [
          ...(registrationsByService.get(serviceName) ?? []),
          {
            serviceName,
            implementationName: implementation.name,
            implementationPath: implementation.path,
            sourceRefs: uniqueSorted([fileRef(file.path, lineNo), ...implementation.sourceRefs]),
          },
        ]);
      }
    }
  }

  const registrations = new Map<string, RegisteredImplementationEvidence>();
  for (const [serviceName, candidates] of registrationsByService.entries()) {
    const byImplementation = new Map<string, RegisteredImplementationEvidence>();
    for (const candidate of candidates) {
      const key = `${candidate.implementationName}:${candidate.implementationPath}`;
      const existing = byImplementation.get(key);
      byImplementation.set(key, existing
        ? { ...existing, sourceRefs: uniqueSorted([...existing.sourceRefs, ...candidate.sourceRefs]) }
        : candidate);
    }
    if (byImplementation.size === 1) {
      registrations.set(serviceName, [...byImplementation.values()][0]!);
    }
  }

  return registrations;
}

function csharpServiceRegistrationTypePairsForLine(
  line: string,
): Array<{ serviceType: string; implementationType: string }> {
  const registrations: Array<{ serviceType: string; implementationType: string }> = [];

  const genericRegistration = /\.\s*Add(?:Scoped|Transient|Singleton)\s*<\s*([^>]+?)\s*>\s*\(/g;
  for (const match of line.matchAll(genericRegistration)) {
    const typeArgs = splitTopLevelCommaArgs(match[1] ?? '');
    if (typeArgs.length !== 2) continue;
    const serviceType = typeArgs[0]?.trim();
    const implementationType = typeArgs[1]?.trim();
    if (serviceType && implementationType) {
      registrations.push({ serviceType, implementationType });
    }
  }

  const typeofRegistration = /\.\s*Add(?:Scoped|Transient|Singleton)\s*\(\s*typeof\s*\(\s*([^)]+?)\s*\)\s*,\s*typeof\s*\(\s*([^)]+?)\s*\)\s*\)/g;
  for (const match of line.matchAll(typeofRegistration)) {
    const serviceType = match[1]?.trim();
    const implementationType = match[2]?.trim();
    if (serviceType && implementationType) {
      registrations.push({ serviceType, implementationType });
    }
  }

  return registrations;
}

function csharpRegisteredImplementationSymbol(input: {
  implementationType: string;
  serviceName: string;
  registrationPath: string;
  symbols: readonly InventorySymbol[];
  imports: readonly InventoryImport[];
  csharpPaths: ReadonlySet<string>;
  knownPaths: ReadonlySet<string>;
}): InventorySymbol | null {
  const implementationType = input.implementationType.replace(/^global::/, '').trim();
  const implementationName = baseTypeName(implementationType);
  if (!implementationName) return null;

  const qualifiedTargetPath = implementationType.includes('.')
    ? csharpTypeTargetPath(implementationType, input.csharpPaths)
    : null;
  if (qualifiedTargetPath) {
    const qualifiedSymbol = input.symbols
      .filter((symbol) => (
        symbol.kind === 'class'
        && symbol.name === implementationName
        && symbol.path === qualifiedTargetPath
        && classSignatureImplementsInterface(symbol.signature, input.serviceName)
      ))
      .sort(compareImportedHandlerSymbols)
      .at(0);
    if (qualifiedSymbol) return qualifiedSymbol;
  }

  const importedCandidates: InventorySymbol[] = [];
  for (const item of input.imports) {
    if (item.path !== input.registrationPath) continue;
    const targetPaths = importTargetPaths(item, input.knownPaths);
    if (targetPaths.size === 0) continue;

    const candidateNames = uniqueInOrder([
      ...(item.importedNames.includes(implementationName) ? [implementationName] : []),
      ...(item.namedImports ?? [])
        .filter((named) => named.local === implementationName)
        .map((named) => named.imported),
    ]);
    for (const candidateName of candidateNames) {
      const candidate = bestSymbolInPaths(input.symbols, candidateName, targetPaths);
      if (
        candidate?.kind === 'class'
        && classSignatureImplementsInterface(candidate.signature, input.serviceName)
      ) {
        importedCandidates.push(candidate);
      }
    }
  }

  const importedUnique = dedupeById(importedCandidates);
  if (importedUnique.length === 1) return importedUnique[0]!;

  const directCandidates = input.symbols
    .filter((symbol) => (
      symbol.kind === 'class'
      && symbol.name === implementationName
      && classSignatureImplementsInterface(symbol.signature, input.serviceName)
    ))
    .sort((a, b) => (
      explicitTypeCandidateRank(a, input.registrationPath) - explicitTypeCandidateRank(b, input.registrationPath)
      || a.path.localeCompare(b.path)
      || a.line - b.line
    ));
  return directCandidates.length === 1 ? directCandidates[0]! : null;
}

function factoryAssignedReceiversForLine(input: {
  path: string;
  line: string;
  lineNo: number;
  symbols: readonly InventorySymbol[];
}): InventoryConstructedReceiver[] {
  const receivers: InventoryConstructedReceiver[] = [];
  const assignment = /\b(?:(?:private|protected|public|internal)\s+)?(?:(?:static|final|readonly)\s+)*(?!var\b)([A-ZI][\w$]*(?:\s*<[^=;()]+>)?(?:\s*\[\])?)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Z][\w$.]*Factory)\s*\.\s*[A-Za-z_$][\w$]*\s*\(/g;
  for (const match of input.line.matchAll(assignment)) {
    const typeName = baseTypeName(match[1] ?? '');
    const variableName = match[2];
    if (!typeName || !variableName || RESERVED_SYMBOL_NAMES.has(variableName)) continue;
    const target = classSymbolForExplicitReceiverType(typeName, input.path, input.symbols);
    if (!target) continue;
    receivers.push({
      path: input.path,
      variableName,
      targetName: target.name,
      targetPath: target.path,
      sourceRefs: [fileRef(input.path, input.lineNo), ...target.sourceRefs],
    });
  }
  return receivers;
}

function classSymbolForExplicitReceiverType(
  typeName: string,
  referencePath: string,
  symbols: readonly InventorySymbol[],
): InventorySymbol | null {
  const implementation = uniqueImplementationForInterfaceType(typeName, symbols);
  if (implementation) return implementation;

  const candidates = symbols
    .filter((symbol) => isClassLikeSymbol(symbol) && symbol.name === typeName)
    .sort((a, b) => (
      explicitTypeCandidateRank(a, referencePath) - explicitTypeCandidateRank(b, referencePath)
      || a.path.localeCompare(b.path)
      || a.line - b.line
    ));
  if (candidates.length === 0) return null;
  const topRank = explicitTypeCandidateRank(candidates[0]!, referencePath);
  const topCandidates = candidates.filter((candidate) => explicitTypeCandidateRank(candidate, referencePath) === topRank);
  return topCandidates.length === 1 ? topCandidates[0]! : null;
}

interface GoConstructorParameterEvidence {
  variableName: string;
  targetName: string;
  targetPath: string;
  sourceRefs: string[];
}

function goConstructorInjectedReceiversByPath(
  files: readonly ScannedInventoryFile[],
  symbols: readonly InventorySymbol[],
  imports: readonly InventoryImport[],
): Map<string, InventoryConstructedReceiver[]> {
  const goSymbols = symbols.filter((symbol) => symbol.path.endsWith('.go'));
  if (goSymbols.length === 0) return new Map();

  const goPaths = new Set(goSymbols.map((symbol) => symbol.path));
  const constructorsByOwner = new Map<string, InventoryConstructedReceiver[]>();

  for (const file of files) {
    if (!file.path.endsWith('.go')) continue;
    const importsForFile = imports.filter((item) => item.path === file.path);
    const lines = file.content.split('\n');
    let constructor: {
      ownerName: string;
      params: Map<string, GoConstructorParameterEvidence>;
      braceDepth: number;
      opened: boolean;
      compositeBraceDepth: number;
    } | null = null;

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const lineNo = index + 1;

      if (!constructor) {
        const start = goConstructorFunctionForLine(line);
        if (start) {
          constructor = {
            ownerName: start.ownerName,
            params: goConstructorParametersForArgs({
              args: start.args,
              path: file.path,
              lineNo,
              symbols: goSymbols,
              imports: importsForFile,
              goPaths,
            }),
            braceDepth: 0,
            opened: false,
            compositeBraceDepth: 0,
          };
        }
      }

      if (constructor) {
        const startsComposite = goStructCompositeLiteralLine(line, constructor.ownerName);
        if (startsComposite) {
          constructor.compositeBraceDepth += braceDeltaForLine(line);
        }
        if (startsComposite || constructor.compositeBraceDepth > 0) {
          for (const assignment of goStructFieldAssignmentsForLine(line)) {
            const param = constructor.params.get(assignment.paramName);
            if (!param) continue;
            const ownerKey = goConstructorOwnerKey(file.path, constructor.ownerName);
            constructorsByOwner.set(ownerKey, [
              ...(constructorsByOwner.get(ownerKey) ?? []),
              {
                path: file.path,
                ownerName: constructor.ownerName,
                variableName: assignment.fieldName,
                targetName: param.targetName,
                targetPath: param.targetPath,
                sourceRefs: uniqueSorted([
                  ...param.sourceRefs,
                  fileRef(file.path, lineNo),
                ]),
              },
            ]);
          }
          if (!startsComposite) {
            constructor.compositeBraceDepth += braceDeltaForLine(line);
          }
          if (constructor.compositeBraceDepth < 0) constructor.compositeBraceDepth = 0;
        }

        constructor.braceDepth += braceDeltaForLine(line);
        constructor.opened = constructor.opened || line.includes('{');
        if (constructor.opened && constructor.braceDepth <= 0) {
          constructor = null;
        }
      }
    }
  }

  const receiversByPath = new Map<string, InventoryConstructedReceiver[]>();
  for (const method of goSymbols.filter((symbol) => symbol.kind === 'method')) {
    const ownerName = goMethodReceiverType(method.signature);
    if (!ownerName) continue;
    for (const receiver of constructorsByOwner.get(goConstructorOwnerKey(method.path, ownerName)) ?? []) {
      receiversByPath.set(method.path, [
        ...(receiversByPath.get(method.path) ?? []),
        { ...receiver, path: method.path },
      ]);
    }
  }

  for (const [path, receivers] of receiversByPath.entries()) {
    receiversByPath.set(path, dedupeConstructedReceivers(receivers));
  }
  return receiversByPath;
}

function goConstructorOwnerKey(path: string, ownerName: string): string {
  return `${parentPath(path)}\0${ownerName}`;
}

function goConstructorFunctionForLine(
  line: string,
): { ownerName: string; args: string } | null {
  const match = /^\s*func\s+New([A-Z][\w]*)\s*\(([^)]*)\)\s+\*?([A-Z][\w]*)\s*\{/.exec(line);
  if (!match?.[1] || !match[2] || !match[3] || match[1] !== match[3]) return null;
  return { ownerName: match[1], args: match[2] };
}

function goConstructorParametersForArgs(input: {
  args: string;
  path: string;
  lineNo: number;
  symbols: readonly InventorySymbol[];
  imports: readonly InventoryImport[];
  goPaths: ReadonlySet<string>;
}): Map<string, GoConstructorParameterEvidence> {
  const params = new Map<string, GoConstructorParameterEvidence>();
  for (const item of splitTopLevelCommaArgs(input.args)) {
    const match = /^\s*([A-Za-z_][\w]*)\s+\*?(?:(?:([A-Za-z_][\w]*)\s*\.\s*)?([A-Z][\w]*))\s*$/.exec(item);
    const variableName = match?.[1];
    const namespaceName = match?.[2];
    const typeName = match?.[3];
    if (!variableName || !typeName || RESERVED_SYMBOL_NAMES.has(variableName)) continue;
    const target = goTypeSymbolForConstructorParameter({
      namespaceName,
      typeName,
      path: input.path,
      symbols: input.symbols,
      imports: input.imports,
      goPaths: input.goPaths,
    });
    if (!target) continue;
    params.set(variableName, {
      variableName,
      targetName: target.symbol.name,
      targetPath: target.symbol.path,
      sourceRefs: uniqueSorted([fileRef(input.path, input.lineNo), ...target.sourceRefs]),
    });
  }
  return params;
}

function goTypeSymbolForConstructorParameter(input: {
  namespaceName?: string;
  typeName: string;
  path: string;
  symbols: readonly InventorySymbol[];
  imports: readonly InventoryImport[];
  goPaths: ReadonlySet<string>;
}): SymbolResolution | null {
  if (input.namespaceName) {
    const importItem = input.imports
      .filter((item) => item.namespaceImport === input.namespaceName)
      .sort((a, b) => a.id.localeCompare(b.id))
      .at(0);
    if (!importItem) return null;
    const targetPaths = importTargetPaths(importItem, input.goPaths);
    if (targetPaths.size === 0) return null;
    const symbol = bestSymbolInPaths(input.symbols, input.typeName, targetPaths);
    return symbol && isClassLikeSymbol(symbol)
      ? { symbol, sourceRefs: uniqueSorted([...importItem.sourceRefs, ...symbol.sourceRefs]) }
      : null;
  }

  const samePackageCandidates = input.symbols
    .filter((symbol) => (
      isClassLikeSymbol(symbol)
      && symbol.name === input.typeName
      && parentPath(symbol.path) === parentPath(input.path)
    ))
    .sort(compareImportedHandlerSymbols);
  return samePackageCandidates.length === 1
    ? { symbol: samePackageCandidates[0]!, sourceRefs: samePackageCandidates[0]!.sourceRefs }
    : null;
}

function goStructCompositeLiteralLine(line: string, ownerName: string): boolean {
  return new RegExp(`(?:^|[^\\w.])&?${escapeRegExp(ownerName)}\\s*\\{`).test(line);
}

function goStructFieldAssignmentsForLine(
  line: string,
): Array<{ fieldName: string; paramName: string }> {
  const assignments: Array<{ fieldName: string; paramName: string }> = [];
  const fieldAssignment = /\b([A-Za-z_][\w]*)\s*:\s*([A-Za-z_][\w]*)\b/g;
  for (const match of line.matchAll(fieldAssignment)) {
    const fieldName = match[1];
    const paramName = match[2];
    if (!fieldName || !paramName || RESERVED_SYMBOL_NAMES.has(fieldName)) continue;
    assignments.push({ fieldName, paramName });
  }
  return assignments;
}

function explicitTypeCandidateRank(symbol: InventorySymbol, referencePath: string): number {
  if (symbol.path === referencePath) return 0;
  if (parentPath(symbol.path) === parentPath(referencePath)) return 1;
  return 2;
}

function uniqueImplementationForInterfaceType(
  interfaceName: string,
  symbols: readonly InventorySymbol[],
): InventorySymbol | null {
  const candidates = symbols
    .filter((symbol) => symbol.kind === 'class' && classSignatureImplementsInterface(symbol.signature, interfaceName))
    .sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
  return candidates.length === 1 ? candidates[0]! : null;
}

function classSignatureImplementsInterface(signature: string, interfaceName: string): boolean {
  const implemented = implementedTypeNamesForSignature(signature);
  return implemented.some((name) => name === interfaceName || namespaceLeafName(name) === interfaceName);
}

function implementedTypeNamesForSignature(signature: string): string[] {
  const javaImplements = /\bimplements\s+([^{]+)/.exec(signature)?.[1];
  if (javaImplements) {
    return splitTopLevelCommaArgs(javaImplements).map(baseTypeName).filter(Boolean);
  }
  const csharpBaseList = /:\s*([^{]+)/.exec(signature)?.[1];
  if (csharpBaseList) {
    return splitTopLevelCommaArgs(csharpBaseList).map(baseTypeName).filter(Boolean);
  }
  return [];
}

function baseTypeName(typeName: string): string {
  const cleaned = typeName
    .replace(/<.*>/g, '')
    .replace(/\[\]/g, '')
    .replace(/\?/g, '')
    .trim();
  return cleaned.split(/\s+/).at(-1)?.split(/[.\\]/).filter(Boolean).at(-1) ?? '';
}

function constructedReceiversForLine(
  path: string,
  line: string,
  lineNo: number,
): InventoryConstructedReceiver[] {
  const receivers: InventoryConstructedReceiver[] = [];
  const declaration = /\b(?:(?:private|protected|public|internal)\s+)?(?:(?:static|final|readonly)\s+)*(?:var|[A-Z][\w$]*(?:\s*<[^=;()]+>)?(?:\s*\[\])?)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+([A-Z][\w$]*(?:\.[A-Z][\w$]*)*)\s*(?:<[^>]+>)?\s*\(/g;
  for (const match of line.matchAll(declaration)) {
    const variableName = match[1];
    const targetName = match[2];
    if (!variableName || !targetName || RESERVED_SYMBOL_NAMES.has(variableName)) continue;
    receivers.push({
      path,
      variableName,
      targetName,
      sourceRefs: [fileRef(path, lineNo)],
    });
  }
  const phpDeclaration = /(\$[A-Za-z_][\w]*|\$this\s*->\s*[A-Za-z_][\w]*)\s*=\s*new\s+(\\?[A-Z][\w\\]*)\s*\(/g;
  for (const match of line.matchAll(phpDeclaration)) {
    const variableName = normalizePhpReceiverName(match[1]);
    const targetName = phpConstructedReceiverTargetName(match[2]);
    if (!variableName || !targetName || RESERVED_SYMBOL_NAMES.has(variableName)) continue;
    receivers.push({
      path,
      variableName,
      targetName,
      sourceRefs: [fileRef(path, lineNo)],
    });
  }
  for (const receiver of phpServiceLocatorReceiversForLine(path, line, lineNo)) {
    receivers.push(receiver);
  }
  for (const receiver of phpStaticFactoryReceiversForLine(path, line, lineNo)) {
    receivers.push(receiver);
  }
  const rubyDeclaration = /(?:^|[^\w@])(@?[a-z_][\w]*)\s*=\s*(::)?([A-Z][\w:]*)\.new\b/g;
  for (const match of line.matchAll(rubyDeclaration)) {
    const variableName = normalizeRubyReceiverName(match[1]);
    const targetName = rubyClassBaseName(match[3]);
    if (!variableName || !targetName || RESERVED_SYMBOL_NAMES.has(variableName)) continue;
    receivers.push({
      path,
      variableName,
      targetName,
      sourceRefs: [fileRef(path, lineNo)],
    });
  }
  if (/\.py$/i.test(path)) {
    const pythonDeclaration = /(?:^|[^\w.])((?:self|cls)\.[A-Za-z_][\w]*|[a-z_][\w]*)\s*=\s*((?:[A-Za-z_][\w]*\.)*[A-Z][\w]*)\s*\(/g;
    for (const match of line.matchAll(pythonDeclaration)) {
      const variableName = normalizePythonReceiverName(match[1]);
      const targetName = pythonConstructedReceiverTargetName(match[2]);
      if (!variableName || !targetName || RESERVED_SYMBOL_NAMES.has(variableName)) continue;
      receivers.push({
        path,
        variableName,
        targetName,
        sourceRefs: [fileRef(path, lineNo)],
      });
    }
  }
  if (/\.go$/i.test(path)) {
    const goFactoryDeclaration = /(?:^|[^\w.])([A-Za-z_][\w]*)\s*:?\=\s*(?:([A-Za-z_][\w]*)\.)?New([A-Z][\w]*)\s*\(/g;
    for (const match of line.matchAll(goFactoryDeclaration)) {
      const variableName = match[1];
      const namespaceName = match[2];
      const className = match[3];
      const targetName = namespaceName && className ? `${namespaceName}.${className}` : className;
      if (!variableName || !targetName || RESERVED_SYMBOL_NAMES.has(variableName)) continue;
      receivers.push({
        path,
        variableName,
        targetName,
        sourceRefs: [fileRef(path, lineNo)],
      });
    }

    const goCompositeDeclaration = /(?:^|[^\w.])([A-Za-z_][\w]*)\s*:?\=\s*&?\s*(?:([A-Za-z_][\w]*)\.)?([A-Z][\w]*)\s*\{/g;
    for (const match of line.matchAll(goCompositeDeclaration)) {
      const variableName = match[1];
      const namespaceName = match[2];
      const className = match[3];
      const targetName = namespaceName && className ? `${namespaceName}.${className}` : className;
      if (!variableName || !targetName || RESERVED_SYMBOL_NAMES.has(variableName)) continue;
      receivers.push({
        path,
        variableName,
        targetName,
        sourceRefs: [fileRef(path, lineNo)],
      });
    }
  }
  return receivers;
}

const PHP_STATIC_FACTORY_METHODS = new Set([
  'build',
  'create',
  'factory',
  'getInstance',
  'instance',
  'make',
]);

function phpStaticFactoryReceiversForLine(
  path: string,
  line: string,
  lineNo: number,
): InventoryConstructedReceiver[] {
  const receivers: InventoryConstructedReceiver[] = [];
  const staticFactory = /(\$[A-Za-z_][\w]*|\$this\s*->\s*[A-Za-z_][\w]*)\s*=\s*(\\?[A-Z][\w\\]*)\s*::\s*([A-Za-z_][\w]*)\s*\(/g;
  for (const match of line.matchAll(staticFactory)) {
    const variableName = normalizePhpReceiverName(match[1]);
    const targetName = phpConstructedReceiverTargetName(match[2]);
    const methodName = match[3];
    if (!variableName || !targetName || !methodName || RESERVED_SYMBOL_NAMES.has(variableName)) continue;
    if (phpClassBaseName(targetName) === 'App') continue;
    if (!PHP_STATIC_FACTORY_METHODS.has(methodName)) continue;
    receivers.push({
      path,
      variableName,
      targetName,
      sourceRefs: [fileRef(path, lineNo)],
    });
  }
  return receivers;
}

function phpServiceLocatorReceiversForLine(
  path: string,
  line: string,
  lineNo: number,
): InventoryConstructedReceiver[] {
  const receivers: InventoryConstructedReceiver[] = [];
  const patterns = [
    /(\$[A-Za-z_][\w]*|\$this\s*->\s*[A-Za-z_][\w]*)\s*=\s*(?:app|resolve)\s*\(\s*(\\?[A-Z][\w\\]*)\s*::\s*class(?=\s*(?:,|\)))/g,
    /(\$[A-Za-z_][\w]*|\$this\s*->\s*[A-Za-z_][\w]*)\s*=\s*\\?App\s*::\s*(?:make|get)\s*\(\s*(\\?[A-Z][\w\\]*)\s*::\s*class(?=\s*(?:,|\)))/g,
    /(\$[A-Za-z_][\w]*|\$this\s*->\s*[A-Za-z_][\w]*)\s*=\s*(?:app\s*\(\s*\)|\$this\s*->\s*app|\$app)\s*->\s*(?:make|get)\s*\(\s*(\\?[A-Z][\w\\]*)\s*::\s*class(?=\s*(?:,|\)))/g,
  ];

  for (const pattern of patterns) {
    for (const match of line.matchAll(pattern)) {
      const variableName = normalizePhpReceiverName(match[1]);
      const targetName = phpConstructedReceiverTargetName(match[2]);
      if (!variableName || !targetName || RESERVED_SYMBOL_NAMES.has(variableName)) continue;
      receivers.push({
        path,
        variableName,
        targetName,
        sourceRefs: [fileRef(path, lineNo)],
      });
    }
  }

  return receivers;
}

function phpConstructedReceiverTargetName(value: string | undefined): string | null {
  const cleaned = value?.replace(/^\\+/, '').trim();
  if (!cleaned) return null;
  return cleaned.includes('\\') ? cleaned : phpClassBaseName(cleaned);
}

function recordConstructedReceiver(
  constructedTypes: Map<string, ConstructedTypeEvidence>,
  receiver: InventoryConstructedReceiver,
): void {
  constructedTypes.set(receiver.variableName, {
    targetName: receiver.targetName,
    targetPath: receiver.targetPath,
    sourceRefs: receiver.sourceRefs,
  });
  constructedTypes.set(`this.${receiver.variableName}`, {
    targetName: receiver.targetName,
    targetPath: receiver.targetPath,
    sourceRefs: receiver.sourceRefs,
  });
}

function receiverCallsForLine(line: string): Array<{ receiverName: string; methodName: string }> {
  const calls: Array<{ receiverName: string; methodName: string }> = [];
  const call = /\b((?:this\.)?[A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g;
  for (const match of line.matchAll(call)) {
    const receiverName = match[1];
    const methodName = match[2];
    if (!receiverName || !methodName || RESERVED_SYMBOL_NAMES.has(methodName)) continue;
    calls.push({ receiverName, methodName });
  }
  const phpCall = /(\$[A-Za-z_][\w]*|\$this\s*->\s*[A-Za-z_][\w]*)\s*->\s*([A-Za-z_][\w]*)\s*\(/g;
  for (const match of line.matchAll(phpCall)) {
    const receiverName = normalizePhpReceiverName(match[1]);
    const methodName = match[2];
    if (!receiverName || !methodName || RESERVED_SYMBOL_NAMES.has(methodName)) continue;
    calls.push({ receiverName, methodName });
  }
  const rubyCall = /(?:^|[^\w@.])(@?[a-z_][\w]*)\s*\.\s*([A-Za-z_][\w]*[!?=]?)\s*(?:\(|\b)/g;
  for (const match of line.matchAll(rubyCall)) {
    const receiverName = normalizeRubyReceiverName(match[1]);
    const methodName = match[2];
    if (!receiverName || !methodName || RESERVED_SYMBOL_NAMES.has(methodName)) continue;
    calls.push({ receiverName, methodName });
  }
  const pythonCall = /(?:^|[^\w.])((?:self|cls)\.[A-Za-z_][\w]*|[a-z_][\w]*)\s*\.\s*([A-Za-z_][\w]*)\s*\(/g;
  for (const match of line.matchAll(pythonCall)) {
    const receiverName = normalizePythonReceiverName(match[1]);
    const methodName = match[2];
    if (!receiverName || !methodName || RESERVED_SYMBOL_NAMES.has(methodName)) continue;
    calls.push({ receiverName, methodName });
  }
  return calls;
}

function normalizePhpReceiverName(value: string | undefined): string | null {
  const normalized = value?.replace(/\s+/g, '').trim();
  return normalized || null;
}

function phpClassBaseName(value: string | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  return normalized.split('\\').filter(Boolean).at(-1) ?? null;
}

function normalizeRubyReceiverName(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

function rubyClassBaseName(value: string | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  return normalized.split('::').filter(Boolean).at(-1) ?? null;
}

function normalizePythonReceiverName(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

function pythonClassBaseName(value: string | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  return normalized.split('.').filter(Boolean).at(-1) ?? null;
}

function pythonConstructedReceiverTargetName(value: string | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  const parts = normalized.split('.').filter(Boolean);
  const className = parts.at(-1);
  if (!className || !/^[A-Z][\w]*$/.test(className)) return null;
  return normalized;
}

function braceDeltaForLine(line: string): number {
  const withoutStrings = line.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '');
  const opens = withoutStrings.match(/{/g)?.length ?? 0;
  const closes = withoutStrings.match(/}/g)?.length ?? 0;
  return opens - closes;
}

function isHeuristicReceiverReferencePath(path: string): boolean {
  return /\.(java|cs|rb|py|go)$/i.test(path) || isPhpSourceLikePath(path);
}

function importFromDeclaration(
  ts: TypeScriptApi,
  sourceFile: SourceFile,
  path: string,
  node: import('typescript').ImportDeclaration,
): InventoryImport | null {
  if (!ts.isStringLiteral(node.moduleSpecifier)) return null;
  const clause = node.importClause;
  const importedNames: string[] = [];
  const namedImports: InventoryNamedImport[] = [];
  let defaultImport: string | undefined;
  let namespaceImport: string | undefined;

  if (clause?.name) {
    defaultImport = clause.name.text;
    importedNames.push(defaultImport);
  }
  const bindings = clause?.namedBindings;
  if (bindings && ts.isNamespaceImport(bindings)) {
    namespaceImport = bindings.name.text;
    importedNames.push(namespaceImport);
  } else if (bindings && ts.isNamedImports(bindings)) {
    for (const element of bindings.elements) {
      importedNames.push(element.name.text);
      namedImports.push({
        imported: element.propertyName?.text ?? element.name.text,
        local: element.name.text,
      });
    }
  }

  const line = lineForNode(sourceFile, node);
  return {
    id: `import_${slugify(path)}_${slugify(node.moduleSpecifier.text)}_${line}`,
    path,
    specifier: node.moduleSpecifier.text,
    importedNames: uniqueSorted(importedNames),
    namedImports: namedImports.length
      ? namedImports.sort((a, b) => a.local.localeCompare(b.local) || a.imported.localeCompare(b.imported))
      : undefined,
    defaultImport,
    namespaceImport,
    sourceRefs: [fileRef(path, line)],
    confidence: 0.95,
  };
}

function exportsFromDeclaration(
  ts: TypeScriptApi,
  sourceFile: SourceFile,
  path: string,
  node: import('typescript').ExportDeclaration,
  localSymbolForName?: (name: string) => InventorySymbol | null,
  imports: readonly InventoryImport[] = [],
): InventoryExport[] {
  const line = lineForNode(sourceFile, node);
  const specifier = node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
    ? node.moduleSpecifier.text
    : undefined;
  const exports: InventoryExport[] = [];
  const clause = node.exportClause;
  if (clause && ts.isNamedExports(clause)) {
    for (const element of clause.elements) {
      const localName = element.propertyName?.text ?? element.name.text;
      const exportedAs = element.name.text;
      const localSymbol = specifier ? null : localSymbolForName?.(localName) ?? null;
      if (localSymbol) {
        exports.push({
          id: `export_${slugify(path)}_${slugify(exportedAs)}_${line}`,
          path,
          name: localName,
          kind: localSymbol.kind,
          symbolRef: localSymbol.id,
          exportedAs,
          sourceRefs: uniqueSorted([fileRef(path, line), ...localSymbol.sourceRefs]),
          confidence: 0.9,
        });
        continue;
      }
      const importedExport = specifier
        ? null
        : importBackedExportForLocalName({
          path,
          line,
          localName,
          exportedAs,
          imports,
        });
      if (importedExport) {
        exports.push(importedExport);
        continue;
      }
      exports.push({
        id: `export_${slugify(path)}_${slugify(element.name.text)}_${line}`,
        path,
        name: localName,
        kind: 're_export',
        specifier,
        exportedAs,
        sourceRefs: [fileRef(path, line)],
        confidence: 0.85,
      });
    }
  } else if (specifier) {
    exports.push({
      id: `export_${slugify(path)}_${slugify(specifier)}_${line}`,
      path,
      name: '*',
      kind: 're_export',
      specifier,
      sourceRefs: [fileRef(path, line)],
      confidence: 0.75,
    });
  }
  return exports;
}

function importBackedExportForLocalName(input: {
  path: string;
  line: number;
  localName: string;
  exportedAs: string;
  imports: readonly InventoryImport[];
}): InventoryExport | null {
  const importItem = input.imports
    .filter((item) => (
      item.path === input.path
      && importIncludesLocalName(item, input.localName)
      && (item.namespaceImport !== input.localName || item.defaultImport === input.localName)
    ))
    .sort((a, b) => a.id.localeCompare(b.id))
    .at(0);
  if (!importItem) return null;

  return {
    id: `export_${slugify(input.path)}_${slugify(input.exportedAs)}_${input.line}`,
    path: input.path,
    name: importedNameForLocalName(importItem, input.localName) ?? input.localName,
    kind: 're_export',
    specifier: importItem.specifier,
    exportedAs: input.exportedAs,
    sourceRefs: uniqueInOrder([fileRef(input.path, input.line), ...importItem.sourceRefs]),
    confidence: 0.85,
  };
}

function exportAliasFromVariableInitializer(
  ts: TypeScriptApi,
  sourceFile: SourceFile,
  path: string,
  exportedAs: string,
  declaration: import('typescript').VariableDeclaration,
  initializer: Node,
  imports: readonly InventoryImport[],
  localIdentifierAliases: ReadonlyMap<string, LocalIdentifierAlias>,
): InventoryExport | null {
  if (!ts.isIdentifier(initializer)) return null;
  const alias = localIdentifierAliases.get(initializer.text);
  const targetName = alias?.targetName ?? initializer.text;
  const importItem = imports
    .filter((item) => (
      item.path === path
      && importIncludesLocalName(item, targetName)
      && (item.namespaceImport !== targetName || item.defaultImport === targetName)
    ))
    .sort((a, b) => a.id.localeCompare(b.id))
    .at(0);
  if (!importItem) return null;

  const importedName = importedNameForLocalName(importItem, targetName) ?? targetName;
  const line = lineForNode(sourceFile, declaration);
  return {
    id: `export_${slugify(path)}_${slugify(exportedAs)}_alias_${line}`,
    path,
    name: importedName,
    kind: 're_export',
    specifier: importItem.specifier,
    exportedAs,
    sourceRefs: uniqueInOrder([fileRef(path, line), ...(alias?.sourceRefs ?? []), ...importItem.sourceRefs]),
    confidence: 0.85,
  };
}

function exportFromAssignment(
  ts: TypeScriptApi,
  sourceFile: SourceFile,
  path: string,
  node: import('typescript').ExportAssignment,
  imports: readonly InventoryImport[] = [],
  localIdentifierAliases: ReadonlyMap<string, LocalIdentifierAlias> = new Map(),
): InventoryExport | null {
  const targetName = expressionIdentifierName(ts, node.expression);
  if (!targetName) return null;
  const line = lineForNode(sourceFile, node);
  const alias = localIdentifierAliases.get(targetName);
  const importBackedExport = importBackedExportForLocalName({
    path,
    line,
    localName: alias?.targetName ?? targetName,
    exportedAs: 'default',
    imports,
  });
  if (importBackedExport) {
    return {
      ...importBackedExport,
      id: `export_${slugify(path)}_default_${line}`,
      sourceRefs: uniqueInOrder([...importBackedExport.sourceRefs, ...(alias?.sourceRefs ?? [])]),
    };
  }
  return {
    id: `export_${slugify(path)}_default_${line}`,
    path,
    name: targetName,
    kind: 'default',
    exportedAs: 'default',
    sourceRefs: [fileRef(path, line)],
    confidence: 0.85,
  };
}

function commonJsImportFromVariableDeclaration(
  ts: TypeScriptApi,
  sourceFile: SourceFile,
  path: string,
  node: import('typescript').VariableDeclaration,
): InventoryImport | null {
  if (!node.initializer || !ts.isCallExpression(node.initializer)) return null;
  if (!ts.isIdentifier(node.initializer.expression) || node.initializer.expression.text !== 'require') return null;
  const specifierArg = node.initializer.arguments[0];
  if (!specifierArg || !ts.isStringLiteralLike(specifierArg)) return null;

  const importedNames: string[] = [];
  const namedImports: InventoryNamedImport[] = [];
  let defaultImport: string | undefined;
  let namespaceImport: string | undefined;

  if (ts.isIdentifier(node.name)) {
    defaultImport = node.name.text;
    namespaceImport = node.name.text;
    importedNames.push(node.name.text);
  } else if (ts.isObjectBindingPattern(node.name)) {
    for (const element of node.name.elements) {
      if (!ts.isIdentifier(element.name)) continue;
      const imported = bindingPropertyNameText(ts, element.propertyName) ?? element.name.text;
      const local = element.name.text;
      importedNames.push(local);
      namedImports.push({ imported, local });
    }
  } else {
    return null;
  }

  if (importedNames.length === 0) return null;
  const line = lineForNode(sourceFile, node);
  return {
    id: `import_${slugify(path)}_${slugify(specifierArg.text)}_${line}`,
    path,
    specifier: specifierArg.text,
    importedNames: uniqueSorted(importedNames),
    namedImports: namedImports.length
      ? namedImports.sort((a, b) => a.local.localeCompare(b.local) || a.imported.localeCompare(b.imported))
      : undefined,
    defaultImport,
    namespaceImport,
    sourceRefs: [fileRef(path, line)],
    confidence: 0.85,
  };
}

function commonJsExportsFromExpressionStatement(
  ts: TypeScriptApi,
  sourceFile: SourceFile,
  path: string,
  node: import('typescript').ExpressionStatement,
  localSymbolForName: (name: string) => InventorySymbol | null,
  addSymbol: AddInventorySymbol,
  evidence: ParserEvidence,
): InventoryExport[] {
  if (!ts.isBinaryExpression(node.expression)) return [];
  if (node.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return [];

  const exportTarget = commonJsExportTarget(ts, node.expression.left);
  if (!exportTarget) return [];
  const line = lineForNode(sourceFile, node);

  if (exportTarget.defaultExport && ts.isObjectLiteralExpression(node.expression.right)) {
    return commonJsExportsFromObjectLiteral(
      ts,
      sourceFile,
      path,
      node.expression.right,
      line,
      localSymbolForName,
      addSymbol,
      evidence,
    );
  }

  const inlineSymbol = commonJsInlineExportedSymbolForAssignment(
    ts,
    sourceFile,
    node.expression.right,
    exportTarget,
    addSymbol,
    evidence,
  );
  if (inlineSymbol) {
    return [commonJsExportForSymbol({
      path,
      line: inlineSymbol.line,
      symbol: inlineSymbol,
      name: inlineSymbol.name,
      exportedAs: exportTarget.defaultExport ? 'default' : exportTarget.name,
      defaultExport: exportTarget.defaultExport,
    })];
  }

  const reExport = commonJsReExportFromExpression(
    ts,
    path,
    node.expression.right,
    line,
    exportTarget.defaultExport ? 'default' : exportTarget.name,
  );
  if (reExport) return [reExport];

  const targetName = expressionIdentifierName(ts, node.expression.right);
  if (!targetName) {
    if (exportTarget.defaultExport && isExpressRouterFactoryCall(ts, node.expression.right)) {
      return [{
        id: `export_${slugify(path)}_default_${line}`,
        path,
        name: 'module.exports',
        kind: 'default',
        exportedAs: 'default',
        sourceRefs: [fileRef(path, line)],
        confidence: 0.75,
      }];
    }
    return [];
  }

  const importBackedExport = importBackedExportForLocalName({
    path,
    line,
    localName: targetName,
    exportedAs: exportTarget.defaultExport ? 'default' : exportTarget.name,
    imports: evidence.imports,
  });
  if (importBackedExport) return [importBackedExport];

  const symbol = localSymbolForName(targetName);
  if (!symbol) return [];
  return [commonJsExportForSymbol({
    path,
    line,
    symbol,
    name: targetName,
    exportedAs: exportTarget.defaultExport ? 'default' : exportTarget.name,
    defaultExport: exportTarget.defaultExport,
  })];
}

function commonJsExportsFromObjectLiteral(
  ts: TypeScriptApi,
  sourceFile: SourceFile,
  path: string,
  node: import('typescript').ObjectLiteralExpression,
  line: number,
  localSymbolForName: (name: string) => InventorySymbol | null,
  addSymbol: AddInventorySymbol,
  evidence: ParserEvidence,
): InventoryExport[] {
  const exports: InventoryExport[] = [];
  for (const property of node.properties) {
    const inlineSymbol = commonJsInlineExportedSymbolForObjectProperty(
      ts,
      sourceFile,
      property,
      addSymbol,
      evidence,
    );
    if (inlineSymbol) {
      exports.push(commonJsExportForSymbol({
        path,
        line: inlineSymbol.line,
        symbol: inlineSymbol,
        name: inlineSymbol.name,
        exportedAs: inlineSymbol.name,
        defaultExport: inlineSymbol.name === 'default',
      }));
      continue;
    }

    let exportedAs: string | null = null;
    let targetName: string | null = null;

    if (ts.isShorthandPropertyAssignment(property)) {
      exportedAs = property.name.text;
      targetName = property.name.text;
    } else if (ts.isPropertyAssignment(property)) {
      exportedAs = bindingPropertyNameText(ts, property.name);
      targetName = expressionIdentifierName(ts, property.initializer);
      const reExport = exportedAs
        ? commonJsReExportFromExpression(ts, path, property.initializer, line, exportedAs)
        : null;
      if (reExport) {
        exports.push(reExport);
        continue;
      }
    }

    if (!exportedAs || !targetName) continue;
    const symbol = localSymbolForName(targetName);
    if (!symbol) continue;
    exports.push(commonJsExportForSymbol({
      path,
      line,
      symbol,
      name: targetName,
      exportedAs,
      defaultExport: exportedAs === 'default',
    }));
  }
  return exports;
}

function commonJsInlineExportedSymbolForAssignment(
  ts: TypeScriptApi,
  sourceFile: SourceFile,
  initializer: Node,
  exportTarget: { name: string; defaultExport: boolean },
  addSymbol: AddInventorySymbol,
  evidence: ParserEvidence,
): InventorySymbol | null {
  if (!ts.isFunctionExpression(initializer) && !ts.isArrowFunction(initializer)) return null;
  const name = ts.isFunctionExpression(initializer) && initializer.name
    ? initializer.name.text
    : exportTarget.name;
  const symbol = addSymbol(initializer, 'function', name, true, initializer);
  collectSymbolReferences(ts, sourceFile, initializer.body, symbol, evidence);
  return symbol;
}

function commonJsInlineExportedSymbolForObjectProperty(
  ts: TypeScriptApi,
  sourceFile: SourceFile,
  property: import('typescript').ObjectLiteralElementLike,
  addSymbol: AddInventorySymbol,
  evidence: ParserEvidence,
): InventorySymbol | null {
  if (ts.isMethodDeclaration(property)) {
    const name = bindingPropertyNameText(ts, property.name);
    if (!name) return null;
    const symbol = addSymbol(property, 'function', name, true, property);
    if (property.body) collectSymbolReferences(ts, sourceFile, property.body, symbol, evidence);
    return symbol;
  }

  if (!ts.isPropertyAssignment(property)) return null;
  const name = bindingPropertyNameText(ts, property.name);
  if (!name) return null;
  const initializer = property.initializer;
  if (!ts.isFunctionExpression(initializer) && !ts.isArrowFunction(initializer)) return null;
  const symbol = addSymbol(property, 'function', name, true, property);
  collectSymbolReferences(ts, sourceFile, initializer.body, symbol, evidence);
  return symbol;
}

function commonJsReExportFromExpression(
  ts: TypeScriptApi,
  path: string,
  node: Node,
  line: number,
  exportedAs: string,
): InventoryExport | null {
  const target = commonJsRequireTargetFromExpression(ts, node);
  if (!target) return null;
  return {
    id: `export_${slugify(path)}_${slugify(exportedAs)}_${line}`,
    path,
    name: target.exportName,
    kind: 're_export',
    specifier: target.specifier,
    exportedAs,
    sourceRefs: [fileRef(path, line)],
    confidence: 0.8,
  };
}

function commonJsRequireTargetFromExpression(
  ts: TypeScriptApi,
  node: Node,
): { specifier: string; exportName: string } | null {
  if (ts.isCallExpression(node)) {
    const specifier = commonJsRequireSpecifier(ts, node);
    return specifier ? { specifier, exportName: 'default' } : null;
  }

  if (ts.isPropertyAccessExpression(node)) {
    const specifier = ts.isCallExpression(node.expression)
      ? commonJsRequireSpecifier(ts, node.expression)
      : null;
    return specifier ? { specifier, exportName: node.name.text } : null;
  }

  if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression)) {
    const specifier = ts.isCallExpression(node.expression)
      ? commonJsRequireSpecifier(ts, node.expression)
      : null;
    return specifier ? { specifier, exportName: node.argumentExpression.text } : null;
  }

  return null;
}

function commonJsRequireSpecifier(
  ts: TypeScriptApi,
  node: import('typescript').CallExpression,
): string | null {
  if (!ts.isIdentifier(node.expression) || node.expression.text !== 'require') return null;
  const specifierArg = node.arguments[0];
  return specifierArg && ts.isStringLiteralLike(specifierArg) ? specifierArg.text : null;
}

function commonJsExportForSymbol(input: {
  path: string;
  line: number;
  symbol: InventorySymbol;
  name: string;
  exportedAs: string;
  defaultExport: boolean;
}): InventoryExport {
  return {
    id: `export_${slugify(input.path)}_${slugify(input.defaultExport ? 'default' : input.exportedAs)}_${input.line}`,
    path: input.path,
    name: input.name,
    kind: input.defaultExport ? 'default' : input.symbol.kind,
    symbolRef: input.symbol.id,
    exportedAs: input.exportedAs,
    sourceRefs: uniqueSorted([fileRef(input.path, input.line), ...input.symbol.sourceRefs]),
    confidence: 0.85,
  };
}

function isExpressRouterFactoryCall(
  ts: TypeScriptApi,
  node: Node,
): boolean {
  if (!ts.isCallExpression(node)) return false;
  if (ts.isIdentifier(node.expression)) return node.expression.text === 'Router';
  return ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === 'Router'
    && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === 'express';
}

function commonJsExportTarget(
  ts: TypeScriptApi,
  node: Node,
): { name: string; defaultExport: boolean } | null {
  if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return null;

  const name = propertyAccessNameText(ts, node);
  if (!name) return null;

  if (ts.isPropertyAccessExpression(node.expression)
    && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === 'module'
    && node.expression.name.text === 'exports'
  ) {
    return { name, defaultExport: false };
  }

  if (ts.isIdentifier(node.expression) && node.expression.text === 'exports') {
    return { name, defaultExport: false };
  }

  if (ts.isPropertyAccessExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === 'module'
    && node.name.text === 'exports'
  ) {
    return { name: 'default', defaultExport: true };
  }

  return null;
}

function bindingPropertyNameText(
  ts: TypeScriptApi,
  node: import('typescript').PropertyName | undefined,
): string | null {
  if (!node) return null;
  if (ts.isIdentifier(node)
    || ts.isPrivateIdentifier(node)
    || ts.isStringLiteral(node)
    || ts.isNumericLiteral(node)
  ) {
    return node.text;
  }
  return null;
}

function propertyAccessNameText(
  ts: TypeScriptApi,
  node: import('typescript').PropertyAccessExpression | import('typescript').ElementAccessExpression,
): string | null {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  const argument = node.argumentExpression;
  if (argument && ts.isStringLiteralLike(argument)) return argument.text;
  return null;
}

function collectSymbolReferences(
  ts: TypeScriptApi,
  sourceFile: SourceFile,
  root: Node,
  fromSymbol: InventorySymbol,
  evidence: ParserEvidence,
  initialConstructedTypes: ReadonlyMap<string, ConstructedTypeEvidence> = new Map(),
): void {
  const constructedTypes = new Map(initialConstructedTypes);

  const addReference = (
    node: Node,
    targetName: string,
    label: string,
    confidence: number,
    extraSourceRefs: string[] = [],
    targetPath?: string,
    declaredTypeName?: string,
  ): void => {
    if (!targetName || RESERVED_SYMBOL_NAMES.has(targetName)) return;
    evidence.references.push({
      fromSymbolId: fromSymbol.id,
      targetName,
      targetPath,
      declaredTypeName,
      path: fromSymbol.path,
      label,
      sourceRefs: uniqueSorted([...extraSourceRefs, fileRef(fromSymbol.path, lineForNode(sourceFile, node))]),
      confidence,
    });
  };

  const visit = (node: Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isNewExpression(node.initializer)) {
      const constructed = expressionQualifiedName(ts, node.initializer.expression);
      if (constructed) {
        constructedTypes.set(node.name.text, {
          targetName: constructed,
          sourceRefs: [fileRef(fromSymbol.path, lineForNode(sourceFile, node.initializer))],
        });
        addReference(node.initializer, constructed, `constructs ${constructed}`, 0.75);
      }
    }

    if (ts.isNewExpression(node)) {
      const constructed = expressionQualifiedName(ts, node.expression);
      if (constructed) addReference(node, constructed, `constructs ${constructed}`, 0.75);
    }

    if (ts.isCallExpression(node)) {
      const target = callTargetName(ts, node.expression);
      const constructedReceiver = target.receiver ? constructedTypes.get(target.receiver) : null;
      if (target.receiver && target.name && !constructedReceiver) {
        const namespaceTarget = `${target.receiver}.${target.name}`;
        addReference(node, namespaceTarget, `calls ${namespaceTarget}`, 0.65);
      } else if (target.name && !constructedReceiver) {
        addReference(node, target.name, `calls ${target.name}`, 0.65);
      }
      if (constructedReceiver) {
        addReference(
          node,
          constructedReceiver.targetName,
          `uses ${constructedReceiver.targetName}`,
          0.7,
          constructedReceiver.sourceRefs,
          constructedReceiver.targetPath,
          constructedReceiver.declaredTypeName,
        );
        if (target.name) {
          addReference(
            node,
            `${constructedReceiver.targetName}.${target.name}`,
            `calls ${constructedReceiver.targetName}.${target.name}`,
            0.72,
            constructedReceiver.sourceRefs,
            constructedReceiver.targetPath,
            constructedReceiver.declaredTypeName,
          );
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(root);
}

function collectClassMemberConstructedTypes(
  ts: TypeScriptApi,
  sourceFile: SourceFile,
  classNode: import('typescript').ClassDeclaration,
  path: string,
): Map<string, ConstructedTypeEvidence> {
  const constructedTypes = new Map<string, ConstructedTypeEvidence>();

  const addConstructedMember = (memberName: string, initializer: import('typescript').NewExpression): void => {
    const targetName = expressionQualifiedName(ts, initializer.expression);
    if (!targetName) return;
    constructedTypes.set(`this.${memberName}`, {
      targetName,
      sourceRefs: [fileRef(path, lineForNode(sourceFile, initializer))],
    });
  };

  const visitConstructor = (node: Node): void => {
    if (ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isNewExpression(node.right)
    ) {
      const memberName = thisMemberPropertyName(ts, node.left);
      if (memberName) addConstructedMember(memberName, node.right);
    }
    ts.forEachChild(node, visitConstructor);
  };

  for (const member of classNode.members) {
    if (ts.isPropertyDeclaration(member)
      && member.initializer
      && ts.isNewExpression(member.initializer)
    ) {
      const memberName = bindingPropertyNameText(ts, member.name);
      if (memberName) addConstructedMember(memberName, member.initializer);
      continue;
    }

    if (ts.isConstructorDeclaration(member)) {
      for (const parameter of member.parameters) {
        const parameterProperty = typeScriptParameterPropertyConstructedType(ts, sourceFile, path, parameter);
        if (!parameterProperty) continue;
        constructedTypes.set(`this.${parameterProperty.memberName}`, parameterProperty.receiver);
      }
      if (member.body) visitConstructor(member.body);
    }
  }

  return constructedTypes;
}

function typeScriptParameterPropertyConstructedType(
  ts: TypeScriptApi,
  sourceFile: SourceFile,
  path: string,
  parameter: import('typescript').ParameterDeclaration,
): { memberName: string; receiver: ConstructedTypeEvidence } | null {
  if (!isTypeScriptParameterProperty(ts, parameter)) return null;
  if (!ts.isIdentifier(parameter.name)) return null;
  const targetName = typeScriptReceiverTargetNameForType(ts, sourceFile, parameter.type);
  if (!targetName || RESERVED_SYMBOL_NAMES.has(parameter.name.text)) return null;
  return {
    memberName: parameter.name.text,
    receiver: {
      targetName,
      declaredTypeName: targetName,
      sourceRefs: [fileRef(path, lineForNode(sourceFile, parameter))],
    },
  };
}

function isTypeScriptParameterProperty(
  ts: TypeScriptApi,
  parameter: import('typescript').ParameterDeclaration,
): boolean {
  const flags = ts.getCombinedModifierFlags(parameter);
  return Boolean(flags & (
    ts.ModifierFlags.Public
    | ts.ModifierFlags.Private
    | ts.ModifierFlags.Protected
    | ts.ModifierFlags.Readonly
  ));
}

function typeScriptReceiverTargetNameForType(
  ts: TypeScriptApi,
  sourceFile: SourceFile,
  typeNode: import('typescript').TypeNode | undefined,
): string | null {
  if (!typeNode) return null;
  const text = typeNode.getText(sourceFile).trim();
  if (!text || /[|&{}[\]]/.test(text)) return null;
  const withoutGeneric = text.replace(/<.*>$/, '').trim();
  if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(withoutGeneric)) return null;
  return withoutGeneric;
}

function symbolMatchesForLine(line: string): Array<{
  kind: InventorySymbol['kind'];
  name: string;
  exported: boolean;
}> {
  if (/^(?:return|throw|yield|await)\b/.test(line)) return [];
  const patterns: Array<{
    kind: InventorySymbol['kind'];
    regex: RegExp;
    nameIndex: number;
    exportedIndex?: number;
  }> = [
    { kind: 'function', regex: /^(export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/, nameIndex: 2, exportedIndex: 1 },
    { kind: 'class', regex: /^(export\s+)?(?:abstract\s+)?(?:partial\s+)?class\s+([A-Za-z_$][\w$]*)(?!::)\b/, nameIndex: 2, exportedIndex: 1 },
    { kind: 'interface', regex: /^(export\s+)?interface\s+([A-Za-z_$][\w$]*)\b/, nameIndex: 2, exportedIndex: 1 },
    { kind: 'interface', regex: /^(?:(?:public|private|protected|internal)\s+)?interface\s+([A-Za-z_$][\w$]*)\b/, nameIndex: 1 },
    { kind: 'type', regex: /^(export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/, nameIndex: 2, exportedIndex: 1 },
    { kind: 'const', regex: /^(export\s+)?const\s+([A-Za-z_$][\w$]*)\s*[:=]/, nameIndex: 2, exportedIndex: 1 },
    { kind: 'method', regex: /^(?:public\s+|private\s+|protected\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*[:{]/, nameIndex: 1 },
    { kind: 'method', regex: /^(?:public|private|protected|internal)\s+([A-Z][A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?:[:{]|$)/, nameIndex: 1 },
    { kind: 'method', regex: /^(?:public\s+|private\s+|protected\s+)?function\s+([A-Za-z_][\w]*)\s*\(/, nameIndex: 1 },
    { kind: 'class', regex: /^(?:public\s+)?(?:partial\s+)?(?:final\s+)?class\s+([A-Za-z_$][\w$]*)(?!::)\b/, nameIndex: 1 },
    { kind: 'function', regex: /^def\s+([A-Za-z_][\w]*)\s*\(/, nameIndex: 1 },
    { kind: 'function', regex: /^def\s+([A-Za-z_][\w]*[!?=]?)\b/, nameIndex: 1 },
    { kind: 'class', regex: /^class\s+(?:[A-Z][\w]*::)+([A-Z][\w]*)\b/, nameIndex: 1 },
    { kind: 'class', regex: /^class\s+([A-Za-z_][\w]*)(?!::)\b/, nameIndex: 1 },
    { kind: 'method', regex: /^func\s+\([^)]+\)\s*([A-Za-z_][\w]*)\s*\(/, nameIndex: 1 },
    { kind: 'function', regex: /^func\s+(?:\([^)]+\)\s*)?([A-Za-z_][\w]*)\s*\(/, nameIndex: 1 },
    { kind: 'method', regex: /^(?:(?:public|private|protected)\s+)?(?:static\s+)?(?:final\s+)?(?:[\w$<>\[\].?,]+\s+)+([A-Za-z_$][\w$]*)\s*\(/, nameIndex: 1 },
    { kind: 'type', regex: /^type\s+([A-Za-z_][\w]*)\s+struct\b/, nameIndex: 1 },
  ];
  const matches: Array<{ kind: InventorySymbol['kind']; name: string; exported: boolean }> = [];
  for (const pattern of patterns) {
    const match = pattern.regex.exec(line);
    if (!match) continue;
    const name = match[pattern.nameIndex];
    if (!name || RESERVED_SYMBOL_NAMES.has(name)) continue;
    matches.push({
      kind: pattern.kind,
      name,
      exported: Boolean(pattern.exportedIndex && match[pattern.exportedIndex]),
    });
  }
  return matches.slice(0, 2);
}

function buildSymbolGraph(input: {
  entrypoints: InventoryEntrypoint[];
  symbols: InventorySymbol[];
  imports: InventoryImport[];
  exports: InventoryExport[];
  references: InventorySymbolReference[];
  constructedReceivers: InventoryConstructedReceiver[];
  parsedPathCount: number;
  heuristicSymbolCount: number;
}): InventorySymbolGraph {
  const nodes: InventorySymbolGraphNode[] = [
    ...input.entrypoints.map((entrypoint) => ({
      id: `node_entrypoint_${entrypoint.id}`,
      kind: 'entrypoint' as const,
      ref: entrypoint.id,
      label: entrypoint.label,
      path: entrypoint.path,
      sourceRefs: entrypoint.sourceRefs,
    })),
    ...input.symbols.map((symbol) => ({
      id: `node_symbol_${symbol.id}`,
      kind: 'symbol' as const,
      ref: symbol.id,
      label: symbol.name,
      path: symbol.path,
      sourceRefs: symbol.sourceRefs,
    })),
  ];
  const symbolById = new Map(input.symbols.map((symbol) => [symbol.id, symbol]));
  const symbolByName = symbolsByName(input.symbols);
  const knownAstPaths = new Set([
    ...input.symbols.map((symbol) => symbol.path),
    ...input.exports.map((item) => item.path),
  ]);
  const routeHandlerEdges: InventorySymbolGraphEdge[] = [];

  for (const entrypoint of input.entrypoints) {
    if (entrypoint.kind !== 'http_route' || !entrypoint.handler) continue;
    const handler = resolveEntrypointHandlerSymbol({
      entrypoint,
      symbols: input.symbols,
      imports: input.imports,
      exports: input.exports,
      constructedReceivers: input.constructedReceivers,
      symbolById,
      symbolByName,
      knownAstPaths,
    });
    if (!handler) continue;
    routeHandlerEdges.push({
      id: `edge_route_handler_${entrypoint.id}_${handler.symbol.id}`,
      kind: 'route_handler',
      from: `node_entrypoint_${entrypoint.id}`,
      to: `node_symbol_${handler.symbol.id}`,
      label: `route handler ${entrypoint.handler}`,
      sourceRefs: uniqueSorted([
        ...entrypoint.sourceRefs,
        ...handler.sourceRefs,
        ...handler.symbol.sourceRefs,
      ]),
      confidence: Math.min(entrypoint.confidence, 0.9),
    });
  }

  const referenceEdges: InventorySymbolGraphEdge[] = [];
  for (const reference of input.references) {
    const source = symbolById.get(reference.fromSymbolId);
    if (!source) continue;
    const target = resolveSymbolReferenceTarget({
      reference,
      symbols: input.symbols,
      imports: input.imports,
      exports: input.exports,
      symbolById,
      symbolByName,
      knownAstPaths,
    });
    if (!target || target.symbol.id === source.id) continue;
    const label = target.label ?? reference.label;
    referenceEdges.push({
      id: `edge_symbol_reference_${source.id}_${target.symbol.id}_${slugify(label)}`,
      kind: 'symbol_reference',
      from: `node_symbol_${source.id}`,
      to: `node_symbol_${target.symbol.id}`,
      label,
      sourceRefs: uniqueSorted([...reference.sourceRefs, ...target.sourceRefs, ...target.symbol.sourceRefs]),
      confidence: reference.confidence,
    });
  }

  const parser: InventorySymbolGraph['parser'] =
    input.parsedPathCount > 0 && input.heuristicSymbolCount > 0 ? 'typescript_ast+heuristic'
      : input.parsedPathCount > 0 ? 'typescript_ast'
        : 'heuristic';
  return {
    parser,
    nodes: sortById(dedupeById(nodes)),
    edges: sortById(dedupeById([...routeHandlerEdges, ...referenceEdges])),
  };
}

interface SymbolResolution {
  symbol: InventorySymbol;
  sourceRefs: string[];
  label?: string;
}

function resolveEntrypointHandlerSymbol(input: {
  entrypoint: InventoryEntrypoint;
  symbols: InventorySymbol[];
  imports: InventoryImport[];
  exports: InventoryExport[];
  constructedReceivers: InventoryConstructedReceiver[];
  symbolById: ReadonlyMap<string, InventorySymbol>;
  symbolByName: ReadonlyMap<string, InventorySymbol[]>;
  knownAstPaths: ReadonlySet<string>;
}): SymbolResolution | null {
  const handler = input.entrypoint.handler;
  if (!handler) return null;

  const laravelAction = laravelControllerActionHandler(handler);
  if (laravelAction) {
    const action = laravelControllerActionSymbol({
      controllerName: laravelAction.controllerName,
      controllerPath: laravelAction.controllerPath,
      actionName: laravelAction.actionName,
      symbols: input.symbols,
    });
    if (action) return action;
  }

  const codeIgniterAction = codeIgniterControllerActionHandler(handler, input.entrypoint.path);
  if (codeIgniterAction) {
    const action = codeIgniterControllerActionSymbol({
      controllerName: codeIgniterAction.controllerName,
      controllerPath: codeIgniterAction.controllerPath,
      actionName: codeIgniterAction.actionName,
      symbols: input.symbols,
    });
    if (action) return action;
  }

  const cakePhpAction = cakePhpControllerActionHandler(handler, input.entrypoint.path);
  if (cakePhpAction) {
    const action = cakePhpControllerActionSymbol({
      controllerName: cakePhpAction.controllerName,
      controllerPaths: cakePhpAction.controllerPaths,
      actionName: cakePhpAction.actionName,
      symbols: input.symbols,
    });
    if (action) return action;
  }

  const yiiAction = yiiControllerActionHandler(handler, input.entrypoint.path);
  if (yiiAction) {
    const action = yiiControllerActionSymbol({
      controllerName: yiiAction.controllerName,
      controllerPaths: yiiAction.controllerPaths,
      actionName: yiiAction.actionName,
      symbols: input.symbols,
    });
    if (action) return action;
  }

  const zendAction = zendFrameworkControllerActionHandler(handler, input.entrypoint.path);
  if (zendAction) {
    const action = zendFrameworkControllerActionSymbol({
      controllerName: zendAction.controllerName,
      controllerPaths: zendAction.controllerPaths,
      actionName: zendAction.actionName,
      symbols: input.symbols,
    });
    if (action) return action;
  }

  const drupalCallback = drupalHookMenuCallbackHandler(handler);
  if (drupalCallback) {
    const callback = drupalHookMenuCallbackSymbol({
      functionName: drupalCallback.functionName,
      modulePath: input.entrypoint.path,
      symbols: input.symbols,
    });
    if (callback) return callback;
  }

  const wordPressCallback = wordPressActionHookCallbackHandler(handler);
  if (wordPressCallback) {
    if (wordPressCallback.functionName) {
      const callback = wordPressActionHookCallbackSymbol({
        functionName: wordPressCallback.functionName,
        path: input.entrypoint.path,
        symbols: input.symbols,
      });
      if (callback) return callback;
    }
    if (wordPressCallback.className && wordPressCallback.methodName) {
      const callback = wordPressClassCallbackSymbol({
        className: wordPressCallback.className,
        methodName: wordPressCallback.methodName,
        symbols: input.symbols,
      });
      if (callback) return callback;
    }
  }

  const symfonyAction = symfonyControllerActionHandler(handler);
  if (symfonyAction) {
    const action = symfonyControllerActionSymbol({
      controllerName: symfonyAction.controllerName,
      actionName: symfonyAction.actionName,
      symbols: input.symbols,
    });
    if (action) return action;
  }

  const slimAction = slimControllerActionHandler(handler);
  if (slimAction) {
    const action = slimControllerActionSymbol({
      controllerName: slimAction.controllerName,
      actionName: slimAction.actionName,
      symbols: input.symbols,
    });
    if (action) return action;
  }

  const railsAction = railsControllerActionHandler(handler);
  if (railsAction) {
    const action = railsControllerActionSymbol({
      controllerName: railsAction.controllerName,
      controllerPath: railsAction.controllerPath,
      actionName: railsAction.actionName,
      symbols: input.symbols,
    });
    if (action) return action;
  }

  const javaClassMethod = javaClassMethodHandlerSymbol({
    handler,
    symbols: input.symbols,
    symbolByName: input.symbolByName,
  });
  if (javaClassMethod) return javaClassMethod;

  const wcfServiceHost = wcfServiceHostHandlerSymbol({
    handler,
    symbolByName: input.symbolByName,
  });
  if (wcfServiceHost) return wcfServiceHost;

  const djangoClassView = djangoClassBasedViewHandlerSymbol({
    handler,
    routePath: input.entrypoint.path,
    symbols: input.symbols,
  });
  if (djangoClassView) return djangoClassView;

  const djangoDirectView = djangoDirectViewHandlerSymbol({
    handler,
    routePath: input.entrypoint.path,
    symbols: input.symbols,
  });
  if (djangoDirectView) return djangoDirectView;

  const classMethod = localClassMethodHandlerSymbol({
    handler,
    routePath: input.entrypoint.path,
    symbols: input.symbols,
    symbolByName: input.symbolByName,
  });
  if (classMethod) return classMethod;

  const namespaceMember = namespaceMemberHandler(handler);
  if (namespaceMember) {
    const djangoView = djangoViewHandlerSymbol({
      namespaceName: namespaceMember.namespaceName,
      viewName: namespaceMember.memberName,
      routePath: input.entrypoint.path,
      symbols: input.symbols,
    });
    if (djangoView) return djangoView;

    const objectMember = objectMemberSymbolForReference({
      objectName: namespaceMember.namespaceName,
      memberName: namespaceMember.memberName,
      referencePath: input.entrypoint.path,
      symbols: input.symbols,
      imports: input.imports,
      exports: input.exports,
      symbolById: input.symbolById,
      symbolByName: input.symbolByName,
      knownAstPaths: input.knownAstPaths,
    });
    if (objectMember) return objectMember;

    const importedMember = importedSymbolForNamespaceMember({
      namespaceName: namespaceMember.namespaceName,
      memberName: namespaceMember.memberName,
      importingPath: input.entrypoint.path,
      symbols: input.symbols,
      imports: input.imports,
      exports: input.exports,
      symbolById: input.symbolById,
      knownAstPaths: input.knownAstPaths,
    });
    if (importedMember) return importedMember;

    const constructedMember = constructedReceiverMemberSymbol({
      receiverName: namespaceMember.namespaceName,
      memberName: namespaceMember.memberName,
      referencePath: input.entrypoint.path,
      symbols: input.symbols,
      imports: input.imports,
      exports: input.exports,
      constructedReceivers: input.constructedReceivers,
      symbolById: input.symbolById,
      symbolByName: input.symbolByName,
      knownAstPaths: input.knownAstPaths,
    });
    if (constructedMember) return constructedMember;
  }

  const exportedFromEntrypointFile = exportedSymbolForPath({
    exportName: handler,
    path: input.entrypoint.path,
    symbols: input.symbols,
    exports: input.exports,
    symbolById: input.symbolById,
    knownAstPaths: input.knownAstPaths,
  });
  if (exportedFromEntrypointFile) return exportedFromEntrypointFile;

  const imported = importedSymbolForLocalName({
    localName: handler,
    importingPath: input.entrypoint.path,
    symbols: input.symbols,
    imports: input.imports,
    exports: input.exports,
    symbolById: input.symbolById,
    knownAstPaths: input.knownAstPaths,
  });
  if (imported) return imported;

  const local = bestSymbolMatch(input.symbolByName, handler, input.entrypoint.path);
  return local ? { symbol: local, sourceRefs: [] } : null;
}

function laravelControllerActionHandler(
  handler: string,
): { controllerName: string; controllerPath: string; actionName: string } | null {
  const match = /^([A-Za-z_][\w\\]*Controller)@([A-Za-z_][\w]*)$/.exec(handler);
  if (!match?.[1] || !match[2]) return null;
  const controllerParts = match[1].split('\\').filter(Boolean);
  const controllerName = controllerParts.at(-1);
  if (!controllerName) return null;
  const relativeControllerParts = controllerParts[0] === 'App'
    && controllerParts[1] === 'Http'
    && controllerParts[2] === 'Controllers'
    ? controllerParts.slice(3)
    : controllerParts;
  if (relativeControllerParts.length === 0) return null;
  return {
    controllerName,
    controllerPath: `app/Http/Controllers/${relativeControllerParts.join('/')}.php`,
    actionName: match[2],
  };
}

function laravelControllerActionSymbol(input: {
  controllerName: string;
  controllerPath: string;
  actionName: string;
  symbols: readonly InventorySymbol[];
}): SymbolResolution | null {
  const controllerSymbol = input.symbols.find((symbol) => (
    symbol.kind === 'class'
    && symbol.name === input.controllerName
    && symbol.path === input.controllerPath
  ));
  if (!controllerSymbol) return null;

  const actionSymbol = input.symbols
    .filter((symbol) => (
      symbol.path === input.controllerPath
      && symbol.name === input.actionName
      && (symbol.kind === 'function' || symbol.kind === 'method')
      && symbol.line > controllerSymbol.line
    ))
    .sort(compareImportedHandlerSymbols)
    .at(0);
  return actionSymbol
    ? { symbol: actionSymbol, sourceRefs: uniqueSorted([...controllerSymbol.sourceRefs, ...actionSymbol.sourceRefs]) }
    : null;
}

function codeIgniterControllerActionHandler(
  handler: string,
  routeConfigPath: string,
): { controllerName: string; controllerPath: string; actionName: string } | null {
  const match = /^([A-Za-z_][\w]*(?:\/[A-Za-z_][\w]*)*)@([A-Za-z_][\w]*)$/.exec(handler);
  if (!match?.[1] || !match[2]) return null;
  const applicationPath = codeIgniterApplicationPathForRouteConfig(routeConfigPath);
  if (!applicationPath) return null;
  const controllerParts = match[1].split('/').filter(Boolean);
  const controllerName = controllerParts.at(-1);
  if (!controllerName) return null;
  const controllerSubdirs = controllerParts.slice(0, -1);
  return {
    controllerName,
    controllerPath: [
      applicationPath,
      'controllers',
      ...controllerSubdirs,
      `${controllerName}.php`,
    ].join('/'),
    actionName: match[2],
  };
}

function codeIgniterApplicationPathForRouteConfig(path: string): string | null {
  const normalized = path.replace(/\\/g, '/');
  const lower = normalized.toLowerCase();
  const suffix = 'application/config/routes.php';
  if (lower === suffix) return 'application';
  const nestedSuffix = `/${suffix}`;
  if (!lower.endsWith(nestedSuffix)) return null;
  return `${normalized.slice(0, -nestedSuffix.length)}/application`;
}

function codeIgniterControllerActionSymbol(input: {
  controllerName: string;
  controllerPath: string;
  actionName: string;
  symbols: readonly InventorySymbol[];
}): SymbolResolution | null {
  const controllerSymbol = input.symbols.find((symbol) => (
    symbol.kind === 'class'
    && symbol.name === input.controllerName
    && symbol.path === input.controllerPath
  ));
  if (!controllerSymbol) return null;

  const actionSymbol = input.symbols
    .filter((symbol) => (
      symbol.path === input.controllerPath
      && symbol.name === input.actionName
      && (symbol.kind === 'function' || symbol.kind === 'method')
      && symbol.line > controllerSymbol.line
    ))
    .sort(compareImportedHandlerSymbols)
    .at(0);
  return actionSymbol
    ? { symbol: actionSymbol, sourceRefs: uniqueSorted([...controllerSymbol.sourceRefs, ...actionSymbol.sourceRefs]) }
    : null;
}

function cakePhpControllerActionHandler(
  handler: string,
  routeConfigPath: string,
): { controllerName: string; controllerPaths: string[]; actionName: string } | null {
  const match = /^CakePHP:([A-Za-z_][\w]*Controller)@([A-Za-z_][\w]*)$/.exec(handler);
  if (!match?.[1] || !match[2]) return null;
  return {
    controllerName: match[1],
    controllerPaths: cakePhpControllerPathsForRouteConfig(routeConfigPath, match[1]),
    actionName: match[2],
  };
}

function cakePhpControllerPathsForRouteConfig(path: string, controllerName: string): string[] {
  const normalized = path.replace(/\\/g, '/');
  const lower = normalized.toLowerCase();
  const appSuffix = 'app/config/routes.php';
  if (lower === appSuffix) return [`app/Controller/${controllerName}.php`];
  const nestedAppSuffix = `/${appSuffix}`;
  if (lower.endsWith(nestedAppSuffix)) {
    return [`${normalized.slice(0, -nestedAppSuffix.length)}/app/Controller/${controllerName}.php`];
  }

  const configSuffix = 'config/routes.php';
  if (lower === configSuffix) return [`src/Controller/${controllerName}.php`];
  const nestedConfigSuffix = `/${configSuffix}`;
  if (lower.endsWith(nestedConfigSuffix)) {
    return [`${normalized.slice(0, -nestedConfigSuffix.length)}/src/Controller/${controllerName}.php`];
  }
  return [];
}

function cakePhpControllerActionSymbol(input: {
  controllerName: string;
  controllerPaths: readonly string[];
  actionName: string;
  symbols: readonly InventorySymbol[];
}): SymbolResolution | null {
  const controllerSymbol = input.symbols.find((symbol) => (
    symbol.kind === 'class'
    && symbol.name === input.controllerName
    && input.controllerPaths.includes(symbol.path)
  ));
  if (!controllerSymbol) return null;

  const actionSymbol = input.symbols
    .filter((symbol) => (
      symbol.path === controllerSymbol.path
      && symbol.name === input.actionName
      && (symbol.kind === 'function' || symbol.kind === 'method')
      && symbol.line > controllerSymbol.line
    ))
    .sort(compareImportedHandlerSymbols)
    .at(0);
  return actionSymbol
    ? { symbol: actionSymbol, sourceRefs: uniqueSorted([...controllerSymbol.sourceRefs, ...actionSymbol.sourceRefs]) }
    : null;
}

function yiiControllerActionHandler(
  handler: string,
  routeConfigPath: string,
): { controllerName: string; controllerPaths: string[]; actionName: string } | null {
  const match = /^Yii:([A-Za-z_][\w]*Controller)@([A-Za-z_][\w]*)$/.exec(handler);
  if (!match?.[1] || !match[2]) return null;
  return {
    controllerName: match[1],
    controllerPaths: yiiControllerPathsForRouteConfig(routeConfigPath, match[1]),
    actionName: match[2],
  };
}

function yiiControllerPathsForRouteConfig(path: string, controllerName: string): string[] {
  const appRoot = yiiApplicationRootForRouteConfig(path);
  if (appRoot === null) return [];
  return [appRoot ? `${appRoot}/controllers/${controllerName}.php` : `controllers/${controllerName}.php`];
}

function yiiApplicationRootForRouteConfig(path: string): string | null {
  if (!isYiiRouteConfigPath(path)) return null;
  const normalized = path.replace(/\\/g, '/');
  const configDir = parentPath(normalized);
  if (!configDir) return '';
  return configDir.endsWith('/config')
    ? configDir.slice(0, -'/config'.length)
    : configDir === 'config'
      ? ''
      : null;
}

function yiiControllerActionSymbol(input: {
  controllerName: string;
  controllerPaths: readonly string[];
  actionName: string;
  symbols: readonly InventorySymbol[];
}): SymbolResolution | null {
  const controllerSymbol = input.symbols.find((symbol) => (
    symbol.kind === 'class'
    && symbol.name === input.controllerName
    && input.controllerPaths.includes(symbol.path)
  ));
  if (!controllerSymbol) return null;

  const actionSymbol = input.symbols
    .filter((symbol) => (
      symbol.path === controllerSymbol.path
      && symbol.name === input.actionName
      && (symbol.kind === 'function' || symbol.kind === 'method')
      && symbol.line > controllerSymbol.line
    ))
    .sort(compareImportedHandlerSymbols)
    .at(0);
  return actionSymbol
    ? { symbol: actionSymbol, sourceRefs: uniqueSorted([...controllerSymbol.sourceRefs, ...actionSymbol.sourceRefs]) }
    : null;
}

function zendFrameworkControllerActionHandler(
  handler: string,
  routeConfigPath: string,
): { controllerName: string; controllerPaths: string[]; actionName: string } | null {
  const match = /^Zend:([A-Za-z_][\w]*Controller)@([A-Za-z_][\w]*)$/.exec(handler);
  if (!match?.[1] || !match[2]) return null;
  return {
    controllerName: match[1],
    controllerPaths: zendFrameworkControllerPathsForRouteConfig(routeConfigPath, match[1]),
    actionName: match[2],
  };
}

function zendFrameworkControllerPathsForRouteConfig(path: string, controllerName: string): string[] {
  const appRoot = zendFrameworkApplicationRootForRouteConfig(path);
  if (appRoot === null) return [];
  const moduleMatch = /^([A-Z][A-Za-z0-9]*)_([A-Za-z_][\w]*Controller)$/.exec(controllerName);
  if (moduleMatch?.[1] && moduleMatch[2]) {
    return [joinPathParts([
      appRoot,
      'modules',
      moduleMatch[1].toLowerCase(),
      'controllers',
      `${moduleMatch[2]}.php`,
    ])];
  }
  return [joinPathParts([appRoot, 'controllers', `${controllerName}.php`])];
}

function zendFrameworkApplicationRootForRouteConfig(path: string): string | null {
  if (!isZendFrameworkIniRouteConfigPath(path)) return null;
  const normalized = path.replace(/\\/g, '/');
  const lower = normalized.toLowerCase();
  const suffixes = [
    'application/configs/application.ini',
    'application/config/application.ini',
    'config/application.ini',
    'configs/application.ini',
  ];
  for (const suffix of suffixes) {
    if (lower === suffix) {
      return suffix.startsWith('application/') ? 'application' : '';
    }
    const nestedSuffix = `/${suffix}`;
    if (!lower.endsWith(nestedSuffix)) continue;
    const rootPrefix = normalized.slice(0, -nestedSuffix.length);
    return suffix.startsWith('application/') ? `${rootPrefix}/application` : rootPrefix;
  }
  return null;
}

function zendFrameworkControllerActionSymbol(input: {
  controllerName: string;
  controllerPaths: readonly string[];
  actionName: string;
  symbols: readonly InventorySymbol[];
}): SymbolResolution | null {
  const controllerSymbol = input.symbols.find((symbol) => (
    symbol.kind === 'class'
    && symbol.name === input.controllerName
    && input.controllerPaths.includes(symbol.path)
  ));
  if (!controllerSymbol) return null;

  const actionSymbol = input.symbols
    .filter((symbol) => (
      symbol.path === controllerSymbol.path
      && symbol.name === input.actionName
      && (symbol.kind === 'function' || symbol.kind === 'method')
      && symbol.line > controllerSymbol.line
    ))
    .sort(compareImportedHandlerSymbols)
    .at(0);
  return actionSymbol
    ? { symbol: actionSymbol, sourceRefs: uniqueSorted([...controllerSymbol.sourceRefs, ...actionSymbol.sourceRefs]) }
    : null;
}

function drupalHookMenuCallbackHandler(
  handler: string,
): { functionName: string } | null {
  const match = /^Drupal:([A-Za-z_][\w]*)$/.exec(handler);
  if (!match?.[1]) return null;
  return { functionName: match[1] };
}

function drupalHookMenuCallbackSymbol(input: {
  functionName: string;
  modulePath: string;
  symbols: readonly InventorySymbol[];
}): SymbolResolution | null {
  if (!isDrupalModulePath(input.modulePath)) return null;
  const callbackSymbol = input.symbols.find((symbol) => (
    symbol.kind === 'function'
    && symbol.name === input.functionName
    && symbol.path === input.modulePath
  ));
  return callbackSymbol
    ? { symbol: callbackSymbol, sourceRefs: callbackSymbol.sourceRefs }
    : null;
}

function wordPressActionHookCallbackHandler(
  handler: string,
): { functionName: string; className?: never; methodName?: never } | { functionName?: never; className: string; methodName: string } | null {
  const functionMatch = /^WordPress:([A-Za-z_][\w]*)$/.exec(handler);
  if (functionMatch?.[1]) return { functionName: functionMatch[1] };

  const classMatch = /^WordPress:([A-Za-z_][\w]*)@([A-Za-z_][\w]*)$/.exec(handler);
  if (!classMatch?.[1] || !classMatch[2]) return null;
  return { className: classMatch[1], methodName: classMatch[2] };
}

function wordPressActionHookCallbackSymbol(input: {
  functionName: string;
  path: string;
  symbols: readonly InventorySymbol[];
}): SymbolResolution | null {
  if (!isPhpSourceLikePath(input.path)) return null;
  const callbackSymbol = input.symbols.find((symbol) => (
    symbol.kind === 'function'
    && symbol.name === input.functionName
    && symbol.path === input.path
  ));
  return callbackSymbol
    ? { symbol: callbackSymbol, sourceRefs: callbackSymbol.sourceRefs }
    : null;
}

function wordPressClassCallbackSymbol(input: {
  className: string;
  methodName: string;
  symbols: readonly InventorySymbol[];
}): SymbolResolution | null {
  const classCandidates = input.symbols
    .filter((symbol) => symbol.kind === 'class' && symbol.name === input.className)
    .sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
  if (classCandidates.length !== 1) return null;
  const classSymbol = classCandidates[0]!;

  const methodSymbol = input.symbols
    .filter((symbol) => (
      symbol.path === classSymbol.path
      && symbol.name === input.methodName
      && symbol.kind === 'method'
      && symbol.line > classSymbol.line
    ))
    .sort(compareImportedHandlerSymbols)
    .at(0);
  return methodSymbol
    ? { symbol: methodSymbol, sourceRefs: uniqueSorted([...classSymbol.sourceRefs, ...methodSymbol.sourceRefs]) }
    : null;
}

function symfonyControllerActionHandler(
  handler: string,
): { controllerName: string; actionName: string } | null {
  const match = /^Symfony:([A-Za-z_][\w]*Controller)@([A-Za-z_][\w]*)$/.exec(handler);
  if (!match?.[1] || !match[2]) return null;
  return {
    controllerName: match[1],
    actionName: match[2],
  };
}

function symfonyControllerActionSymbol(input: {
  controllerName: string;
  actionName: string;
  symbols: readonly InventorySymbol[];
}): SymbolResolution | null {
  const controllerCandidates = input.symbols
    .filter((symbol) => symbol.kind === 'class' && symbol.name === input.controllerName)
    .sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
  if (controllerCandidates.length !== 1) return null;
  const controllerSymbol = controllerCandidates[0]!;

  const actionSymbol = input.symbols
    .filter((symbol) => (
      symbol.path === controllerSymbol.path
      && symbol.name === input.actionName
      && (symbol.kind === 'function' || symbol.kind === 'method')
      && symbol.line > controllerSymbol.line
    ))
    .sort(compareImportedHandlerSymbols)
    .at(0);
  return actionSymbol
    ? { symbol: actionSymbol, sourceRefs: uniqueSorted([...controllerSymbol.sourceRefs, ...actionSymbol.sourceRefs]) }
    : null;
}

function slimControllerActionHandler(
  handler: string,
): { controllerName: string; actionName: string } | null {
  const match = /^Slim:([A-Za-z_][\w]*Controller)@([A-Za-z_][\w]*)$/.exec(handler);
  if (!match?.[1] || !match[2]) return null;
  return {
    controllerName: match[1],
    actionName: match[2],
  };
}

function slimControllerActionSymbol(input: {
  controllerName: string;
  actionName: string;
  symbols: readonly InventorySymbol[];
}): SymbolResolution | null {
  const controllerCandidates = input.symbols
    .filter((symbol) => symbol.kind === 'class' && symbol.name === input.controllerName)
    .sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
  const controllerPathCandidates = controllerCandidates
    .filter((symbol) => /(?:^|\/)(?:src\/)?controllers?\//i.test(symbol.path));
  const controllerSymbol = controllerCandidates.length === 1
    ? controllerCandidates[0]!
    : controllerPathCandidates.length === 1
      ? controllerPathCandidates[0]!
      : null;
  if (!controllerSymbol) return null;

  const actionSymbol = input.symbols
    .filter((symbol) => (
      symbol.path === controllerSymbol.path
      && symbol.name === input.actionName
      && (symbol.kind === 'function' || symbol.kind === 'method')
      && symbol.line > controllerSymbol.line
    ))
    .sort(compareImportedHandlerSymbols)
    .at(0);
  return actionSymbol
    ? { symbol: actionSymbol, sourceRefs: uniqueSorted([...controllerSymbol.sourceRefs, ...actionSymbol.sourceRefs]) }
    : null;
}

function exportedSymbolForPath(input: {
  exportName: string;
  path: string;
  symbols: InventorySymbol[];
  exports: InventoryExport[];
  symbolById: ReadonlyMap<string, InventorySymbol>;
  knownAstPaths: ReadonlySet<string>;
}): SymbolResolution | null {
  return resolveExportedHandlerSymbol({
    exportName: input.exportName,
    targetPaths: new Set([input.path]),
    symbols: input.symbols,
    exports: input.exports,
    symbolById: input.symbolById,
    knownAstPaths: input.knownAstPaths,
    depth: 0,
  });
}

function resolveSymbolReferenceTarget(input: {
  reference: InventorySymbolReference;
  symbols: InventorySymbol[];
  imports: InventoryImport[];
  exports: InventoryExport[];
  symbolById: ReadonlyMap<string, InventorySymbol>;
  symbolByName: ReadonlyMap<string, InventorySymbol[]>;
  knownAstPaths: ReadonlySet<string>;
}): SymbolResolution | null {
  const targetPathSymbol = symbolReferenceForTargetPath(input.reference, input.symbols);
  if (targetPathSymbol) return targetPathSymbol;

  const declaredTypeTarget = declaredTypeReferenceTarget({
    reference: input.reference,
    symbols: input.symbols,
    imports: input.imports,
    exports: input.exports,
    symbolById: input.symbolById,
    symbolByName: input.symbolByName,
    knownAstPaths: input.knownAstPaths,
  });
  if (declaredTypeTarget.handled) return declaredTypeTarget.symbol;

  const qualifiedClassMethod = qualifiedClassMethodReference(input.reference.targetName);
  if (qualifiedClassMethod) {
    const importedClass = importedSymbolForNamespaceMember({
      namespaceName: qualifiedClassMethod.namespaceName,
      memberName: qualifiedClassMethod.className,
      importingPath: input.reference.path,
      symbols: input.symbols,
      imports: input.imports,
      exports: input.exports,
      symbolById: input.symbolById,
      knownAstPaths: input.knownAstPaths,
    });
    if (importedClass && isClassLikeSymbol(importedClass.symbol)) {
      const method = methodSymbolForResolvedClassSymbol(
        input.symbols,
        importedClass.symbol,
        qualifiedClassMethod.methodName,
      );
      if (method) {
        return {
          symbol: method,
          sourceRefs: uniqueSorted([...importedClass.sourceRefs, ...method.sourceRefs]),
        };
      }
    }
  }

  const namespaceMember = namespaceMemberHandler(input.reference.targetName);
  if (namespaceMember) {
    const objectMember = objectMemberSymbolForReference({
      objectName: namespaceMember.namespaceName,
      memberName: namespaceMember.memberName,
      referencePath: input.reference.path,
      symbols: input.symbols,
      imports: input.imports,
      exports: input.exports,
      symbolById: input.symbolById,
      symbolByName: input.symbolByName,
      knownAstPaths: input.knownAstPaths,
    });
    if (objectMember) return objectMember;

    const importedMember = importedSymbolForNamespaceMember({
      namespaceName: namespaceMember.namespaceName,
      memberName: namespaceMember.memberName,
      importingPath: input.reference.path,
      symbols: input.symbols,
      imports: input.imports,
      exports: input.exports,
      symbolById: input.symbolById,
      knownAstPaths: input.knownAstPaths,
    });
    if (importedMember) return importedMember;

    const classMethod = classMethodSymbolForReference({
      className: namespaceMember.namespaceName,
      methodName: namespaceMember.memberName,
      referencePath: input.reference.path,
      symbols: input.symbols,
      imports: input.imports,
      exports: input.exports,
      symbolById: input.symbolById,
      symbolByName: input.symbolByName,
      knownAstPaths: input.knownAstPaths,
    });
    if (classMethod) return classMethod;

    const heuristicClassMethod = heuristicClassMethodSymbolForReference({
      className: namespaceMember.namespaceName,
      methodName: namespaceMember.memberName,
      referencePath: input.reference.path,
      symbols: input.symbols,
    });
    if (heuristicClassMethod) return heuristicClassMethod;
  }

  const imported = importedSymbolForLocalName({
    localName: input.reference.targetName,
    importingPath: input.reference.path,
    symbols: input.symbols,
    imports: input.imports,
    exports: input.exports,
    symbolById: input.symbolById,
    knownAstPaths: input.knownAstPaths,
  });
  if (imported) return imported;

  const local = bestSymbolMatch(input.symbolByName, input.reference.targetName, input.reference.path);
  return local ? { symbol: local, sourceRefs: [] } : null;
}

function declaredTypeReferenceTarget(input: {
  reference: InventorySymbolReference;
  symbols: InventorySymbol[];
  imports: InventoryImport[];
  exports: InventoryExport[];
  symbolById: ReadonlyMap<string, InventorySymbol>;
  symbolByName: ReadonlyMap<string, InventorySymbol[]>;
  knownAstPaths: ReadonlySet<string>;
}): { handled: boolean; symbol: SymbolResolution | null } {
  const declaredTypeName = input.reference.declaredTypeName;
  if (!declaredTypeName) return { handled: false, symbol: null };

  const target = declaredTypeReferenceName(input.reference.targetName, declaredTypeName);
  if (!target) return { handled: false, symbol: null };

  const interfaceSymbol = interfaceSymbolForDeclaredType({
    declaredTypeName,
    referencePath: input.reference.path,
    symbols: input.symbols,
    imports: input.imports,
    exports: input.exports,
    symbolById: input.symbolById,
    symbolByName: input.symbolByName,
    knownAstPaths: input.knownAstPaths,
  });
  if (!interfaceSymbol) return { handled: false, symbol: null };

  const interfaceName = namespaceLeafName(declaredTypeName) ?? declaredTypeName;
  const implementation = uniqueImplementationForInterfaceType(interfaceName, input.symbols);
  if (!implementation) return { handled: true, symbol: null };

  const baseSourceRefs = uniqueSorted([
    ...interfaceSymbol.sourceRefs,
    ...implementation.sourceRefs,
  ]);
  if (!target.methodName) {
    return {
      handled: true,
      symbol: {
        symbol: implementation,
        sourceRefs: baseSourceRefs,
        label: `uses ${implementation.name}`,
      },
    };
  }

  const method = methodSymbolForResolvedClassSymbol(input.symbols, implementation, target.methodName);
  return {
    handled: true,
    symbol: method
      ? {
        symbol: method,
        sourceRefs: uniqueSorted([...baseSourceRefs, ...method.sourceRefs]),
        label: `calls ${implementation.name}.${target.methodName}`,
      }
      : null,
  };
}

function declaredTypeReferenceName(
  targetName: string,
  declaredTypeName: string,
): { methodName?: string } | null {
  const candidateNames = uniqueInOrder([
    declaredTypeName,
    namespaceLeafName(declaredTypeName) ?? declaredTypeName,
  ]);
  for (const candidateName of candidateNames) {
    if (targetName === candidateName) return {};
    const prefix = `${candidateName}.`;
    if (!targetName.startsWith(prefix)) continue;
    const methodName = targetName.slice(prefix.length);
    if (/^[A-Za-z_$][\w$]*$/.test(methodName)) return { methodName };
  }
  return null;
}

function interfaceSymbolForDeclaredType(input: {
  declaredTypeName: string;
  referencePath: string;
  symbols: InventorySymbol[];
  imports: InventoryImport[];
  exports: InventoryExport[];
  symbolById: ReadonlyMap<string, InventorySymbol>;
  symbolByName: ReadonlyMap<string, InventorySymbol[]>;
  knownAstPaths: ReadonlySet<string>;
}): SymbolResolution | null {
  const namespaceMember = namespaceMemberHandler(input.declaredTypeName);
  if (namespaceMember) {
    const imported = importedSymbolForNamespaceMember({
      namespaceName: namespaceMember.namespaceName,
      memberName: namespaceMember.memberName,
      importingPath: input.referencePath,
      symbols: input.symbols,
      imports: input.imports,
      exports: input.exports,
      symbolById: input.symbolById,
      knownAstPaths: input.knownAstPaths,
    });
    if (imported?.symbol.kind === 'interface') return imported;
  }

  const imported = importedSymbolForLocalName({
    localName: input.declaredTypeName,
    importingPath: input.referencePath,
    symbols: input.symbols,
    imports: input.imports,
    exports: input.exports,
    symbolById: input.symbolById,
    knownAstPaths: input.knownAstPaths,
  });
  if (imported?.symbol.kind === 'interface') return imported;

  const local = (input.symbolByName.get(input.declaredTypeName) ?? [])
    .filter((symbol) => symbol.kind === 'interface' && symbol.path === input.referencePath)
    .sort(compareImportedHandlerSymbols)
    .at(0);
  return local
    ? { symbol: local, sourceRefs: local.sourceRefs }
    : null;
}

function symbolReferenceForTargetPath(
  reference: InventorySymbolReference,
  symbols: readonly InventorySymbol[],
): SymbolResolution | null {
  if (!reference.targetPath) return null;
  const targetPaths = new Set([reference.targetPath]);
  const namespaceMember = namespaceMemberHandler(reference.targetName);
  if (namespaceMember) {
    const classSymbol = symbols
      .filter((symbol) => targetPaths.has(symbol.path) && symbol.name === namespaceMember.namespaceName && isClassLikeSymbol(symbol))
      .sort(compareImportedHandlerSymbols)
      .at(0);
    if (!classSymbol) return null;
    const method = methodSymbolForResolvedClassSymbol(symbols, classSymbol, namespaceMember.memberName);
    return method
      ? { symbol: method, sourceRefs: uniqueSorted([...classSymbol.sourceRefs, ...method.sourceRefs]) }
      : null;
  }

  const directSymbol = bestSymbolInPaths(symbols, reference.targetName, targetPaths);
  return directSymbol ? { symbol: directSymbol, sourceRefs: directSymbol.sourceRefs } : null;
}

function classMethodSymbolForReference(input: {
  className: string;
  methodName: string;
  referencePath: string;
  symbols: InventorySymbol[];
  imports: InventoryImport[];
  exports: InventoryExport[];
  symbolById: ReadonlyMap<string, InventorySymbol>;
  symbolByName: ReadonlyMap<string, InventorySymbol[]>;
  knownAstPaths: ReadonlySet<string>;
}): SymbolResolution | null {
  const importedClass = importedSymbolForLocalName({
    localName: input.className,
    importingPath: input.referencePath,
    symbols: input.symbols,
    imports: input.imports,
    exports: input.exports,
    symbolById: input.symbolById,
    knownAstPaths: input.knownAstPaths,
  });
  if (importedClass && isClassLikeSymbol(importedClass.symbol)) {
    const method = methodSymbolForResolvedClassSymbol(input.symbols, importedClass.symbol, input.methodName);
    return method
      ? { symbol: method, sourceRefs: uniqueSorted([...importedClass.sourceRefs, ...method.sourceRefs]) }
      : null;
  }

  const localClass = localClassSymbol(input.symbolByName, input.className, input.referencePath);
  if (!localClass) return null;
  const method = methodSymbolForResolvedClassSymbol(input.symbols, localClass, input.methodName);
  return method
    ? { symbol: method, sourceRefs: uniqueSorted([...localClass.sourceRefs, ...method.sourceRefs]) }
    : null;
}

function heuristicClassMethodSymbolForReference(input: {
  className: string;
  methodName: string;
  referencePath: string;
  symbols: InventorySymbol[];
}): SymbolResolution | null {
  const classCandidates = input.symbols
    .filter((symbol) => (symbol.kind === 'class' || symbol.kind === 'type') && symbol.name === input.className)
    .sort((a, b) => (
      heuristicClassCandidateRank(a, input.referencePath) - heuristicClassCandidateRank(b, input.referencePath)
      || a.path.localeCompare(b.path)
      || a.line - b.line
    ));

  for (const classSymbol of classCandidates) {
    const method = heuristicMethodSymbolForClassSymbol(input.symbols, classSymbol, input.methodName);
    if (method) {
      return {
        symbol: method,
        sourceRefs: uniqueSorted([...classSymbol.sourceRefs, ...method.sourceRefs]),
      };
    }
  }
  return null;
}

function heuristicClassCandidateRank(symbol: InventorySymbol, referencePath: string): number {
  if (symbol.path === referencePath) return 0;
  if (parentPath(symbol.path) === parentPath(referencePath)) return 1;
  if (basenameWithoutExt(symbol.path) === symbol.name) return 2;
  return 3;
}

function heuristicMethodSymbolForClassSymbol(
  symbols: readonly InventorySymbol[],
  classSymbol: InventorySymbol,
  methodName: string,
): InventorySymbol | null {
  const nextClassLine = symbols
    .filter((symbol) => symbol.kind === 'class' && symbol.path === classSymbol.path && symbol.line > classSymbol.line)
    .map((symbol) => symbol.line)
    .sort((a, b) => a - b)
    .at(0);
  return symbols
    .filter((symbol) => (
      (symbol.kind === 'method' || symbol.kind === 'function')
      && symbol.path === classSymbol.path
      && symbol.name === methodName
      && symbol.line > classSymbol.line
      && (!nextClassLine || symbol.line < nextClassLine)
    ))
    .sort(compareImportedHandlerSymbols)
    .at(0) ?? null;
}

function objectMemberSymbolForReference(input: {
  objectName: string;
  memberName: string;
  referencePath: string;
  symbols: InventorySymbol[];
  imports: InventoryImport[];
  exports: InventoryExport[];
  symbolById: ReadonlyMap<string, InventorySymbol>;
  symbolByName: ReadonlyMap<string, InventorySymbol[]>;
  knownAstPaths: ReadonlySet<string>;
}): SymbolResolution | null {
  const importedObject = importedSymbolForLocalName({
    localName: input.objectName,
    importingPath: input.referencePath,
    symbols: input.symbols,
    imports: input.imports,
    exports: input.exports,
    symbolById: input.symbolById,
    knownAstPaths: input.knownAstPaths,
  });
  if (importedObject?.symbol.kind === 'const') {
    const method = methodSymbolForObjectSymbol(input.symbols, importedObject.symbol, input.memberName);
    if (method) {
      return {
        symbol: method,
        sourceRefs: uniqueSorted([...importedObject.sourceRefs, ...method.sourceRefs]),
      };
    }
  }

  const localObject = localObjectSymbol(input.symbolByName, input.objectName, input.referencePath);
  if (!localObject) return null;
  const method = methodSymbolForObjectSymbol(input.symbols, localObject, input.memberName);
  return method
    ? { symbol: method, sourceRefs: uniqueSorted([...localObject.sourceRefs, ...method.sourceRefs]) }
    : null;
}

function constructedReceiverMemberSymbol(input: {
  receiverName: string;
  memberName: string;
  referencePath: string;
  symbols: InventorySymbol[];
  imports: InventoryImport[];
  exports: InventoryExport[];
  constructedReceivers: InventoryConstructedReceiver[];
  symbolById: ReadonlyMap<string, InventorySymbol>;
  symbolByName: ReadonlyMap<string, InventorySymbol[]>;
  knownAstPaths: ReadonlySet<string>;
}): SymbolResolution | null {
  const constructions = input.constructedReceivers
    .filter((item) => item.path === input.referencePath && item.variableName === input.receiverName)
    .sort((a, b) => a.sourceRefs.join('|').localeCompare(b.sourceRefs.join('|')));

  for (const construction of constructions) {
    const classSymbol = classSymbolForConstructedTarget({
      targetName: construction.targetName,
      referencePath: input.referencePath,
      symbols: input.symbols,
      imports: input.imports,
      exports: input.exports,
      symbolById: input.symbolById,
      symbolByName: input.symbolByName,
      knownAstPaths: input.knownAstPaths,
    });
    if (!classSymbol) continue;

    const method = methodSymbolForResolvedClassSymbol(input.symbols, classSymbol.symbol, input.memberName);
    if (!method) continue;

    return {
      symbol: method,
      sourceRefs: uniqueSorted([
        ...construction.sourceRefs,
        ...classSymbol.sourceRefs,
        ...method.sourceRefs,
      ]),
    };
  }

  return null;
}

function classSymbolForConstructedTarget(input: {
  targetName: string;
  referencePath: string;
  symbols: InventorySymbol[];
  imports: InventoryImport[];
  exports: InventoryExport[];
  symbolById: ReadonlyMap<string, InventorySymbol>;
  symbolByName: ReadonlyMap<string, InventorySymbol[]>;
  knownAstPaths: ReadonlySet<string>;
}): SymbolResolution | null {
  const namespaceMember = namespaceMemberHandler(input.targetName);
  if (namespaceMember) {
    const importedClass = importedSymbolForNamespaceMember({
      namespaceName: namespaceMember.namespaceName,
      memberName: namespaceMember.memberName,
      importingPath: input.referencePath,
      symbols: input.symbols,
      imports: input.imports,
      exports: input.exports,
      symbolById: input.symbolById,
      knownAstPaths: input.knownAstPaths,
    });
    return importedClass && isClassLikeSymbol(importedClass.symbol) ? importedClass : null;
  }

  const importedClass = importedSymbolForLocalName({
    localName: input.targetName,
    importingPath: input.referencePath,
    symbols: input.symbols,
    imports: input.imports,
    exports: input.exports,
    symbolById: input.symbolById,
    knownAstPaths: input.knownAstPaths,
  });
  if (importedClass && isClassLikeSymbol(importedClass.symbol)) return importedClass;

  const localClass = localClassSymbol(input.symbolByName, input.targetName, input.referencePath);
  return localClass ? { symbol: localClass, sourceRefs: localClass.sourceRefs } : null;
}

function localClassSymbol(
  symbolByName: ReadonlyMap<string, InventorySymbol[]>,
  className: string,
  path: string,
): InventorySymbol | null {
  return (symbolByName.get(className) ?? [])
    .filter((symbol) => (symbol.kind === 'class' || symbol.kind === 'type') && symbol.path === path)
    .sort(compareImportedHandlerSymbols)
    .at(0) ?? null;
}

function isClassLikeSymbol(symbol: InventorySymbol): boolean {
  return symbol.kind === 'class' || symbol.kind === 'type';
}

function localObjectSymbol(
  symbolByName: ReadonlyMap<string, InventorySymbol[]>,
  objectName: string,
  path: string,
): InventorySymbol | null {
  return (symbolByName.get(objectName) ?? [])
    .filter((symbol) => symbol.kind === 'const' && symbol.path === path)
    .sort(compareImportedHandlerSymbols)
    .at(0) ?? null;
}

function methodSymbolForClassSymbol(
  symbols: readonly InventorySymbol[],
  classSymbol: InventorySymbol,
  methodName: string,
): InventorySymbol | null {
  const signaturePrefix = `${classSymbol.name}.`;
  return symbols
    .filter((symbol) => (
      symbol.kind === 'method'
      && symbol.path === classSymbol.path
      && symbol.name === methodName
      && (symbol.signature.startsWith(signaturePrefix) || goMethodReceiverType(symbol.signature) === classSymbol.name)
    ))
    .sort(compareImportedHandlerSymbols)
    .at(0) ?? null;
}

function methodSymbolForResolvedClassSymbol(
  symbols: readonly InventorySymbol[],
  classSymbol: InventorySymbol,
  methodName: string,
): InventorySymbol | null {
  return methodSymbolForClassSymbol(symbols, classSymbol, methodName)
    ?? heuristicMethodSymbolForClassSymbol(symbols, classSymbol, methodName);
}

function goMethodReceiverType(signature: string | undefined): string | null {
  const match = /^func\s+\(\s*[A-Za-z_][\w]*\s+\*?([A-Za-z_][\w]*)\s*\)\s+[A-Za-z_][\w]*\s*\(/.exec(signature ?? '');
  return match?.[1] ?? null;
}

function railsControllerActionHandler(
  handler: string,
): { controllerName: string; controllerPath: string; actionName: string } | null {
  const match = /^(?:(?:([A-Za-z_][\w]*(?:\/[A-Za-z_][\w]*)*)\/)?([A-Za-z_][\w]*Controller))#([A-Za-z_][\w]*[!?=]?)$/.exec(handler);
  if (!match?.[2] || !match[3]) return null;
  const controllerPrefix = match[1];
  const controllerName = match[2];
  return {
    controllerName,
    controllerPath: [controllerPrefix, camelToSnake(controllerName)].filter(Boolean).join('/'),
    actionName: match[3],
  };
}

function railsControllerActionSymbol(input: {
  controllerName: string;
  controllerPath: string;
  actionName: string;
  symbols: readonly InventorySymbol[];
}): SymbolResolution | null {
  const controllerPath = `app/controllers/${input.controllerPath}.rb`;
  const controllerSymbol = input.symbols.find((symbol) => (
    symbol.kind === 'class'
    && symbol.name === input.controllerName
    && symbol.path === controllerPath
  ));
  if (!controllerSymbol) return null;

  const actionSymbol = input.symbols
    .filter((symbol) => (
      symbol.path === controllerPath
      && symbol.name === input.actionName
      && (symbol.kind === 'function' || symbol.kind === 'method')
      && symbol.line > controllerSymbol.line
    ))
    .sort(compareImportedHandlerSymbols)
    .at(0);
  return actionSymbol
    ? { symbol: actionSymbol, sourceRefs: uniqueSorted([...controllerSymbol.sourceRefs, ...actionSymbol.sourceRefs]) }
    : null;
}

function javaClassMethodHandlerSymbol(input: {
  handler: string;
  symbols: readonly InventorySymbol[];
  symbolByName: ReadonlyMap<string, InventorySymbol[]>;
}): SymbolResolution | null {
  const match = /^([A-Za-z_$][\w$]*)#([A-Za-z_$][\w$]*)$/.exec(input.handler);
  if (!match?.[1] || !match[2]) return null;
  const className = match[1];
  const methodName = match[2];
  const actionClasses = (input.symbolByName.get(className) ?? [])
    .filter((symbol) => symbol.kind === 'class' || symbol.kind === 'interface')
    .sort(compareImportedHandlerSymbols);

  for (const actionClass of actionClasses) {
    const method = input.symbols
      .filter((symbol) => (
        symbol.kind === 'method'
        && symbol.path === actionClass.path
        && symbol.name === methodName
        && symbol.line > actionClass.line
      ))
      .sort(compareImportedHandlerSymbols)
      .at(0);
    if (method) {
      return {
        symbol: method,
        sourceRefs: uniqueSorted([...actionClass.sourceRefs, ...method.sourceRefs]),
      };
    }
  }

  const actionClass = actionClasses.at(0);
  return actionClass ? { symbol: actionClass, sourceRefs: actionClass.sourceRefs } : null;
}

function wcfServiceHostHandlerSymbol(input: {
  handler: string;
  symbolByName: ReadonlyMap<string, InventorySymbol[]>;
}): SymbolResolution | null {
  const match = /^WCF:([A-Za-z_][\w]*)$/.exec(input.handler);
  if (!match?.[1]) return null;
  const serviceClasses = (input.symbolByName.get(match[1]) ?? [])
    .filter((symbol) => symbol.kind === 'class')
    .sort(compareImportedHandlerSymbols);
  if (serviceClasses.length !== 1) return null;
  const serviceClass = serviceClasses[0]!;
  return serviceClass ? { symbol: serviceClass, sourceRefs: serviceClass.sourceRefs } : null;
}

function djangoClassBasedViewHandlerSymbol(input: {
  handler: string;
  routePath: string;
  symbols: readonly InventorySymbol[];
}): SymbolResolution | null {
  if (!input.routePath.endsWith('urls.py')) return null;
  const match = /^(?:views\.)?([A-Za-z_][\w]*)\.as_view$/.exec(input.handler);
  if (!match?.[1]) return null;

  const viewPath = siblingPath(input.routePath, 'views.py');
  const viewClass = input.symbols
    .filter((symbol) => (
      symbol.path === viewPath
      && symbol.name === match[1]
      && symbol.kind === 'class'
    ))
    .sort(compareImportedHandlerSymbols)
    .at(0);
  return viewClass ? { symbol: viewClass, sourceRefs: viewClass.sourceRefs } : null;
}

function djangoDirectViewHandlerSymbol(input: {
  handler: string;
  routePath: string;
  symbols: readonly InventorySymbol[];
}): SymbolResolution | null {
  if (!input.routePath.endsWith('urls.py')) return null;
  if (!/^[A-Za-z_][\w]*$/.test(input.handler)) return null;

  const viewPath = siblingPath(input.routePath, 'views.py');
  const viewSymbol = input.symbols
    .filter((symbol) => (
      symbol.path === viewPath
      && symbol.name === input.handler
      && symbol.kind === 'function'
    ))
    .sort(compareImportedHandlerSymbols)
    .at(0);
  return viewSymbol ? { symbol: viewSymbol, sourceRefs: viewSymbol.sourceRefs } : null;
}

function localClassMethodHandlerSymbol(input: {
  handler: string;
  routePath: string;
  symbols: readonly InventorySymbol[];
  symbolByName: ReadonlyMap<string, InventorySymbol[]>;
}): SymbolResolution | null {
  const match = /^([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)$/.exec(input.handler);
  if (!match?.[1] || !match[2]) return null;
  const classSymbol = localClassSymbol(input.symbolByName, match[1], input.routePath);
  if (!classSymbol) return null;
  const methodSymbol = methodSymbolForResolvedClassSymbol(input.symbols, classSymbol, match[2]);
  return methodSymbol
    ? { symbol: methodSymbol, sourceRefs: uniqueSorted([...classSymbol.sourceRefs, ...methodSymbol.sourceRefs]) }
    : null;
}

function djangoViewHandlerSymbol(input: {
  namespaceName: string;
  viewName: string;
  routePath: string;
  symbols: readonly InventorySymbol[];
}): SymbolResolution | null {
  if (input.namespaceName !== 'views') return null;
  if (!input.routePath.endsWith('urls.py')) return null;

  const viewPath = siblingPath(input.routePath, 'views.py');
  const viewSymbol = input.symbols
    .filter((symbol) => (
      symbol.path === viewPath
      && symbol.name === input.viewName
      && symbol.kind === 'function'
    ))
    .sort(compareImportedHandlerSymbols)
    .at(0);
  return viewSymbol ? { symbol: viewSymbol, sourceRefs: viewSymbol.sourceRefs } : null;
}

function methodSymbolForObjectSymbol(
  symbols: readonly InventorySymbol[],
  objectSymbol: InventorySymbol,
  methodName: string,
): InventorySymbol | null {
  const signaturePrefix = `${objectSymbol.name}.`;
  return symbols
    .filter((symbol) => (
      symbol.kind === 'method'
      && symbol.path === objectSymbol.path
      && symbol.name === methodName
      && symbol.signature.startsWith(signaturePrefix)
    ))
    .sort(compareImportedHandlerSymbols)
    .at(0) ?? null;
}

function importedSymbolForLocalName(input: {
  localName: string;
  importingPath: string;
  symbols: InventorySymbol[];
  imports: InventoryImport[];
  exports: InventoryExport[];
  symbolById: ReadonlyMap<string, InventorySymbol>;
  knownAstPaths: ReadonlySet<string>;
}): SymbolResolution | null {
  const imports = input.imports
    .filter((item) => item.path === input.importingPath && importIncludesLocalName(item, input.localName))
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const item of imports) {
    const importedName = importedNameForLocalName(item, input.localName) ?? input.localName;
    const targetPaths = importTargetPaths(item, input.knownAstPaths);
    if (targetPaths.size === 0) continue;

    const exportedSymbol = resolveExportedHandlerSymbol({
      exportName: importedName,
      targetPaths,
      symbols: input.symbols,
      exports: input.exports,
      symbolById: input.symbolById,
      knownAstPaths: input.knownAstPaths,
      depth: 0,
    });
    if (exportedSymbol) {
      return {
        symbol: exportedSymbol.symbol,
        sourceRefs: uniqueSorted([...item.sourceRefs, ...exportedSymbol.sourceRefs]),
      };
    }

    if (canResolveDirectSymbolsFromImport(item)) {
      const directSymbol = bestSymbolInPaths(input.symbols, importedName, targetPaths);
      if (directSymbol) {
        return {
          symbol: directSymbol,
          sourceRefs: uniqueSorted([...item.sourceRefs, ...directSymbol.sourceRefs]),
        };
      }
    }
  }

  return null;
}

function canResolveDirectSymbolsFromImport(item: InventoryImport): boolean {
  const targetPaths = [...(item.targetPath ? [item.targetPath] : []), ...(item.targetPaths ?? [])];
  return targetPaths.some((targetPath) => /\.(?:php|py|rb|java|cs)$/i.test(targetPath));
}

function importedSymbolForNamespaceMember(input: {
  namespaceName: string;
  memberName: string;
  importingPath: string;
  symbols: InventorySymbol[];
  imports: InventoryImport[];
  exports: InventoryExport[];
  symbolById: ReadonlyMap<string, InventorySymbol>;
  knownAstPaths: ReadonlySet<string>;
}): SymbolResolution | null {
  const imports = input.imports
    .filter((item) => item.path === input.importingPath && item.namespaceImport === input.namespaceName)
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const item of imports) {
    const targetPaths = importTargetPaths(item, input.knownAstPaths);
    if (targetPaths.size === 0) continue;

    const exportedSymbol = resolveExportedHandlerSymbol({
      exportName: input.memberName,
      targetPaths,
      symbols: input.symbols,
      exports: input.exports,
      symbolById: input.symbolById,
      knownAstPaths: input.knownAstPaths,
      depth: 0,
    });
    if (exportedSymbol) {
      return {
        symbol: exportedSymbol.symbol,
        sourceRefs: uniqueSorted([...item.sourceRefs, ...exportedSymbol.sourceRefs]),
      };
    }

    if (item.targetPaths?.some((targetPath) => targetPath.endsWith('.go'))) {
      const directSymbol = bestSymbolInPaths(input.symbols, input.memberName, targetPaths);
      if (directSymbol) {
        return {
          symbol: directSymbol,
          sourceRefs: uniqueSorted([...item.sourceRefs, ...directSymbol.sourceRefs]),
        };
      }
    }
  }

  return null;
}

function resolveExportedHandlerSymbol(input: {
  exportName: string;
  targetPaths: ReadonlySet<string>;
  symbols: InventorySymbol[];
  exports: InventoryExport[];
  symbolById: ReadonlyMap<string, InventorySymbol>;
  knownAstPaths: ReadonlySet<string>;
  depth: number;
}): SymbolResolution | null {
  const exported = input.exports
    .filter((candidate) => (
      input.targetPaths.has(candidate.path)
      && (candidate.name === '*' || candidate.name === input.exportName || candidate.exportedAs === input.exportName)
    ))
    .sort((a, b) => a.id.localeCompare(b.id));

  const resolved = exported
    .map((exportItem) => resolveExportItemHandlerSymbol(exportItem, input))
    .filter((symbol): symbol is SymbolResolution => Boolean(symbol))
    .sort((a, b) => compareImportedHandlerSymbols(a.symbol, b.symbol));

  return resolved.at(0) ?? null;
}

function resolveExportItemHandlerSymbol(
  exportItem: InventoryExport,
  input: {
    exportName: string;
    targetPaths: ReadonlySet<string>;
    symbols: InventorySymbol[];
    exports: InventoryExport[];
    symbolById: ReadonlyMap<string, InventorySymbol>;
    knownAstPaths: ReadonlySet<string>;
    depth: number;
  },
): SymbolResolution | null {
  if (exportItem.symbolRef) {
    const symbol = input.symbolById.get(exportItem.symbolRef);
    return symbol ? { symbol, sourceRefs: exportItem.sourceRefs } : null;
  }

  if (exportItem.kind === 're_export' && exportItem.specifier && input.depth < LOCAL_RE_EXPORT_MAX_DEPTH) {
    const reExportTargetPaths = moduleTargetPaths(exportItem.path, exportItem.specifier, input.knownAstPaths);
    if (reExportTargetPaths.size > 0) {
      const reExportName = exportItem.name === '*' ? input.exportName : exportItem.name;
      const symbol = resolveExportedHandlerSymbol({
        exportName: reExportName,
        targetPaths: reExportTargetPaths,
        symbols: input.symbols,
        exports: input.exports,
        symbolById: input.symbolById,
        knownAstPaths: input.knownAstPaths,
        depth: input.depth + 1,
      });
      return symbol
        ? { symbol: symbol.symbol, sourceRefs: uniqueSorted([...exportItem.sourceRefs, ...symbol.sourceRefs]) }
        : null;
    }
  }

  const symbol = bestSymbolInPaths(input.symbols, exportItem.name, input.targetPaths);
  return symbol ? { symbol, sourceRefs: exportItem.sourceRefs } : null;
}

function importIncludesLocalName(item: InventoryImport, name: string): boolean {
  return item.importedNames.includes(name)
    || item.defaultImport === name
    || item.namespaceImport === name;
}

function importedNameForLocalName(item: InventoryImport, localName: string): string | null {
  const named = item.namedImports?.find((candidate) => candidate.local === localName);
  if (named) return named.imported;
  if (item.defaultImport === localName) return 'default';
  if (item.namespaceImport === localName) return localName;
  return item.importedNames.includes(localName) ? localName : null;
}

function namespaceMemberHandler(handler: string): { namespaceName: string; memberName: string } | null {
  const match = /^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.exec(handler);
  if (!match) return null;
  return { namespaceName: match[1]!, memberName: match[2]! };
}

function qualifiedClassMethodReference(
  handler: string,
): { namespaceName: string; className: string; methodName: string } | null {
  const match = /^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.exec(handler);
  if (!match) return null;
  return { namespaceName: match[1]!, className: match[2]!, methodName: match[3]! };
}

function importTargetPaths(
  item: InventoryImport,
  knownPaths: ReadonlySet<string>,
): Set<string> {
  if (item.targetPaths?.length) {
    return new Set(item.targetPaths.filter((targetPath) => knownPaths.has(targetPath)));
  }
  if (item.targetPath && knownPaths.has(item.targetPath)) return new Set([item.targetPath]);
  return moduleTargetPaths(item.path, item.specifier, knownPaths);
}

function moduleTargetPaths(
  importingPath: string,
  specifier: string,
  knownPaths: ReadonlySet<string>,
): Set<string> {
  if (!specifier.startsWith('.')) return new Set();
  const base = resolveRelativeModulePath(importingPath, specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mts`,
    `${base}.cts`,
    `${base}.mjs`,
    `${base}.cjs`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
    `${base}/index.jsx`,
    `${base}/index.mts`,
    `${base}/index.cts`,
    `${base}/index.mjs`,
    `${base}/index.cjs`,
  ];
  return new Set(candidates.filter((candidate) => knownPaths.has(candidate)));
}

function resolveRelativeModulePath(importingPath: string, specifier: string): string {
  const parts = importingPath.split('/').slice(0, -1);
  for (const part of specifier.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join('/');
}

function bestSymbolInPaths(
  symbols: readonly InventorySymbol[],
  name: string,
  paths: ReadonlySet<string>,
): InventorySymbol | null {
  return symbols
    .filter((symbol) => paths.has(symbol.path) && symbol.name === name)
    .sort(compareImportedHandlerSymbols)
    .at(0) ?? null;
}

function compareImportedHandlerSymbols(a: InventorySymbol, b: InventorySymbol): number {
  const exported = Number(b.exported) - Number(a.exported);
  if (exported !== 0) return exported;
  const kind = importedHandlerKindRank(a.kind) - importedHandlerKindRank(b.kind);
  if (kind !== 0) return kind;
  return a.line - b.line || a.id.localeCompare(b.id);
}

function importedHandlerKindRank(kind: InventorySymbol['kind']): number {
  switch (kind) {
    case 'function':
    case 'const':
      return 0;
    case 'class':
      return 1;
    case 'method':
      return 2;
    default:
      return 3;
  }
}

function symbolsByName(symbols: InventorySymbol[]): Map<string, InventorySymbol[]> {
  const byName = new Map<string, InventorySymbol[]>();
  for (const symbol of symbols) {
    byName.set(symbol.name, [...(byName.get(symbol.name) ?? []), symbol]);
  }
  return byName;
}

function bestSymbolMatch(
  byName: ReadonlyMap<string, InventorySymbol[]>,
  name: string,
  preferredPath: string,
): InventorySymbol | null {
  const matches = byName.get(name) ?? [];
  return matches.find((symbol) => symbol.path === preferredPath)
    ?? matches.find((symbol) => basenameWithoutExt(symbol.path).toLowerCase().includes(name.toLowerCase()))
    ?? matches[0]
    ?? null;
}

function isTypeScriptAstCandidate(path: string): boolean {
  return /\.[cm]?[jt]sx?$/.test(path) || /\.(mjs|cjs)$/i.test(path);
}

function scriptKindForPath(
  ts: TypeScriptApi,
  path: string,
): import('typescript').ScriptKind {
  if (/\.tsx$/i.test(path)) return ts.ScriptKind.TSX;
  if (/\.jsx$/i.test(path)) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$|\.mjs$|\.cjs$/i.test(path)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function lineForNode(sourceFile: SourceFile, node: Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function signatureForNode(sourceFile: SourceFile, node: Node, prefix = ''): string {
  const firstLine = node.getText(sourceFile).split('\n')[0]?.trim() ?? '';
  return excerpt(`${prefix}${firstLine}`, 180);
}

function isExportedNode(sourceFile: SourceFile, node: Node): boolean {
  return /\bexport\b/.test(node.getFullText(sourceFile).slice(0, 120));
}

function isDefaultExportedNode(sourceFile: SourceFile, node: Node): boolean {
  return /\bexport\s+default\b/.test(node.getFullText(sourceFile).slice(0, 160));
}

function expressionIdentifierName(ts: TypeScriptApi, node: Node): string | null {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  return null;
}

function expressionQualifiedName(ts: TypeScriptApi, node: Node): string | null {
  if (ts.isIdentifier(node)) return node.text;
  if (!ts.isPropertyAccessExpression(node)) return null;
  const receiver = expressionQualifiedName(ts, node.expression);
  return receiver ? `${receiver}.${node.name.text}` : null;
}

function callTargetName(
  ts: TypeScriptApi,
  node: Node,
): { name: string | null; receiver: string | null } {
  if (ts.isIdentifier(node)) return { name: node.text, receiver: null };
  if (ts.isPropertyAccessExpression(node)) {
    return {
      name: node.name.text,
      receiver: ts.isIdentifier(node.expression)
        ? node.expression.text
        : thisMemberReceiverName(ts, node.expression),
    };
  }
  return { name: null, receiver: null };
}

function thisMemberReceiverName(ts: TypeScriptApi, node: Node): string | null {
  const memberName = thisMemberPropertyName(ts, node);
  return memberName ? `this.${memberName}` : null;
}

function thisMemberPropertyName(ts: TypeScriptApi, node: Node): string | null {
  return ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword
    ? bindingPropertyNameText(ts, node.name)
    : null;
}

function symbolId(path: string, name: string, line: number): string {
  return `sym_${slugify(path)}_${slugify(name)}_${line}`;
}

function dedupeSymbolReferences(references: InventorySymbolReference[]): InventorySymbolReference[] {
  const seen = new Set<string>();
  const result: InventorySymbolReference[] = [];
  for (const reference of references) {
    const key = `${reference.fromSymbolId}:${reference.targetName}:${reference.targetPath ?? ''}:${reference.declaredTypeName ?? ''}:${reference.label}:${reference.sourceRefs.join('|')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(reference);
  }
  return result;
}

function dedupeConstructedReceivers(receivers: InventoryConstructedReceiver[]): InventoryConstructedReceiver[] {
  const seen = new Set<string>();
  const result: InventoryConstructedReceiver[] = [];
  for (const receiver of receivers) {
    const key = `${receiver.path}:${receiver.ownerName ?? ''}:${receiver.variableName}:${receiver.targetName}:${receiver.targetPath ?? ''}:${receiver.sourceRefs.join('|')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(receiver);
  }
  return result;
}

function extractEntrypoints(
  files: ScannedInventoryFile[],
  commands: InventoryCommand[],
  parserEvidence: Pick<ParserEvidence, 'imports' | 'exports'> & { symbols?: InventorySymbol[] } = {
    imports: [],
    exports: [],
    symbols: [],
  },
): InventoryEntrypoint[] {
  const entrypoints: InventoryEntrypoint[] = [];
  for (const command of commands) {
    if (!isCapabilityScript(command.name)) continue;
    const sourcePath = sourcePathFromRef(command.sourceRefs[0]) ?? 'package.json';
    entrypoints.push({
      id: `entry_cli_${slugify(command.name)}`,
      kind: 'cli_script',
      label: `Script: ${command.name}`,
      path: sourcePath,
      handler: command.command,
      sourceRefs: command.sourceRefs,
      confidence: command.name === 'start' || command.name === 'dev' ? 0.85 : 0.75,
    });
  }

  const crossFileExpressRouterMounts = crossFileExpressRouterMountsForFiles(
    files,
    parserEvidence.imports,
    parserEvidence.exports,
  );
  const crossFileFastifyRegisterMounts = crossFileFastifyRegisterMountsForFiles(
    files,
    parserEvidence.imports,
    parserEvidence.exports,
    parserEvidence.symbols ?? [],
  );
  const crossFilePythonRouterPrefixes = crossFilePythonRouterPrefixesForFiles(files);
  const djangoUrlIncludeMounts = djangoUrlIncludeMountsForFiles(files);
  const javaApplicationPathPrefix = javaApplicationPathPrefixForFiles(files);
  const wcfServiceImplementations = wcfServiceImplementationsForFiles(files);
  const wcfServiceContractOperationsByType = wcfServiceContractOperationsByTypeForFiles(files);
  for (const file of files) {
    if (isWcfServiceModelConfigPath(file.path)) {
      for (const route of wcfServiceModelConfigRouteMatchesForFile(
        file,
        wcfServiceContractOperationsByType,
        wcfServiceImplementations,
      )) {
        entrypoints.push({
          id: `entry_route_${slugify(file.path)}_${slugify(route.method)}_${slugify(route.route)}_${route.lineNo}`,
          kind: 'http_route',
          label: `${route.method.toUpperCase()} ${route.route}`,
          path: file.path,
          method: route.method.toUpperCase(),
          route: route.route,
          handler: route.handler,
          sourceRefs: route.sourceRefs,
          confidence: route.confidence,
        });
      }
      continue;
    }
    if (isWebXmlConfigPath(file.path)) {
      for (const route of webXmlServletRouteMatchesForContent(file.content, file.path, files)) {
        entrypoints.push({
          id: `entry_route_${slugify(file.path)}_${slugify(route.method)}_${slugify(route.route)}_${route.lineNo}`,
          kind: 'http_route',
          label: `${route.method.toUpperCase()} ${route.route}`,
          path: file.path,
          method: route.method.toUpperCase(),
          route: route.route,
          handler: route.handler,
          sourceRefs: route.sourceRefs,
          confidence: 0.82,
        });
      }
      continue;
    }
    if (isStrutsConfigPath(file.path)) {
      for (const route of strutsRouteMatchesForContent(file.content)) {
        entrypoints.push({
          id: `entry_route_${slugify(file.path)}_${slugify(route.method)}_${slugify(route.route)}_${route.lineNo}`,
          kind: 'http_route',
          label: `${route.method.toUpperCase()} ${route.route}`,
          path: file.path,
          method: route.method.toUpperCase(),
          route: route.route,
          handler: route.handler,
          sourceRefs: lineSourceRefs(file.path, route.sourceLineNos),
          confidence: 0.82,
        });
      }
      continue;
    }
    if (isSpringMvcXmlConfigPath(file.path)) {
      for (const route of springMvcXmlRouteMatchesForContent(file.content)) {
        entrypoints.push({
          id: `entry_route_${slugify(file.path)}_${slugify(route.method)}_${slugify(route.route)}_${route.lineNo}`,
          kind: 'http_route',
          label: `${route.method.toUpperCase()} ${route.route}`,
          path: file.path,
          method: route.method.toUpperCase(),
          route: route.route,
          handler: route.handler,
          sourceRefs: lineSourceRefs(file.path, route.sourceLineNos),
          confidence: 0.8,
        });
      }
      continue;
    }
    if (isPlayRoutesConfigPath(file.path)) {
      for (const route of playFrameworkRouteMatchesForContent(file.content)) {
        entrypoints.push({
          id: `entry_route_${slugify(file.path)}_${slugify(route.method)}_${slugify(route.route)}_${route.lineNo}`,
          kind: 'http_route',
          label: `${route.method.toUpperCase()} ${route.route}`,
          path: file.path,
          method: route.method.toUpperCase(),
          route: route.route,
          handler: route.handler,
          sourceRefs: lineSourceRefs(file.path, [route.lineNo]),
          confidence: 0.8,
        });
      }
      continue;
    }
    if (isAspNetWebFormsPagePath(file.path)) {
      for (const route of aspNetWebFormsRouteMatchesForFile(file)) {
        entrypoints.push({
          id: `entry_route_${slugify(file.path)}_${slugify(route.method)}_${slugify(route.route)}_${route.lineNo}`,
          kind: 'http_route',
          label: `${route.method.toUpperCase()} ${route.route}`,
          path: file.path,
          method: route.method.toUpperCase(),
          route: route.route,
          handler: route.handler,
          sourceRefs: lineSourceRefs(file.path, route.sourceLineNos),
          confidence: 0.78,
        });
      }
      continue;
    }
    if (isWcfServiceHostPath(file.path)) {
      for (const route of wcfServiceHostRouteMatchesForFile(file)) {
        entrypoints.push({
          id: `entry_route_${slugify(file.path)}_${slugify(route.method)}_${slugify(route.route)}_${route.lineNo}`,
          kind: 'http_route',
          label: `${route.method.toUpperCase()} ${route.route}`,
          path: file.path,
          method: route.method.toUpperCase(),
          route: route.route,
          handler: route.handler,
          sourceRefs: lineSourceRefs(file.path, route.sourceLineNos),
          confidence: 0.78,
        });
      }
      continue;
    }
    if (isJspPagePath(file.path)) {
      for (const route of jspPageRouteMatchesForFile(file)) {
        entrypoints.push({
          id: `entry_route_${slugify(file.path)}_${slugify(route.method)}_${slugify(route.route)}_${route.lineNo}`,
          kind: 'http_route',
          label: `${route.method.toUpperCase()} ${route.route}`,
          path: file.path,
          method: route.method.toUpperCase(),
          route: route.route,
          handler: route.handler,
          sourceRefs: lineSourceRefs(file.path, route.sourceLineNos),
          confidence: 0.72,
        });
      }
      continue;
    }
    if (isClassicAspPagePath(file.path)) {
      for (const route of classicAspPageRouteMatchesForFile(file)) {
        entrypoints.push({
          id: `entry_route_${slugify(file.path)}_${slugify(route.method)}_${slugify(route.route)}_${route.lineNo}`,
          kind: 'http_route',
          label: `${route.method.toUpperCase()} ${route.route}`,
          path: file.path,
          method: route.method.toUpperCase(),
          route: route.route,
          handler: route.handler,
          sourceRefs: lineSourceRefs(file.path, route.sourceLineNos),
          confidence: 0.72,
        });
      }
      continue;
    }
    if (isColdFusionPagePath(file.path)) {
      for (const route of coldFusionPageRouteMatchesForFile(file)) {
        entrypoints.push({
          id: `entry_route_${slugify(file.path)}_${slugify(route.method)}_${slugify(route.route)}_${route.lineNo}`,
          kind: 'http_route',
          label: `${route.method.toUpperCase()} ${route.route}`,
          path: file.path,
          method: route.method.toUpperCase(),
          route: route.route,
          handler: route.handler,
          sourceRefs: lineSourceRefs(file.path, route.sourceLineNos),
          confidence: 0.72,
        });
      }
      continue;
    }
    if (
      !isSourceLikePath(file.path)
      && !isSymfonyYamlRouteConfigPath(file.path)
      && !isSymfonyXmlRouteConfigPath(file.path)
      && !isYiiRouteConfigPath(file.path)
      && !isZendFrameworkIniRouteConfigPath(file.path)
    ) continue;
    if (isSymfonyYamlRouteConfigPath(file.path)) {
      for (const route of symfonyYamlRouteMatchesForContent(file.content)) {
        entrypoints.push({
          id: `entry_route_${slugify(file.path)}_${slugify(route.method)}_${slugify(route.route)}_${route.lineNo}`,
          kind: 'http_route',
          label: `${route.method.toUpperCase()} ${route.route}`,
          path: file.path,
          method: route.method.toUpperCase(),
          route: route.route,
          handler: route.handler,
          sourceRefs: lineSourceRefs(file.path, route.sourceLineNos),
          confidence: 0.78,
        });
      }
    }
    if (isSymfonyXmlRouteConfigPath(file.path)) {
      for (const route of symfonyXmlRouteMatchesForContent(file.content)) {
        entrypoints.push({
          id: `entry_route_${slugify(file.path)}_${slugify(route.method)}_${slugify(route.route)}_${route.lineNo}`,
          kind: 'http_route',
          label: `${route.method.toUpperCase()} ${route.route}`,
          path: file.path,
          method: route.method.toUpperCase(),
          route: route.route,
          handler: route.handler,
          sourceRefs: lineSourceRefs(file.path, route.sourceLineNos),
          confidence: 0.78,
        });
      }
    }
    if (isCodeIgniterRouteConfigPath(file.path)) {
      for (const route of codeIgniterRouteMatchesForContent(file.content)) {
        entrypoints.push({
          id: `entry_route_${slugify(file.path)}_${slugify(route.method)}_${slugify(route.route)}_${route.lineNo}`,
          kind: 'http_route',
          label: `${route.method.toUpperCase()} ${route.route}`,
          path: file.path,
          method: route.method.toUpperCase(),
          route: route.route,
          handler: route.handler,
          sourceRefs: lineSourceRefs(file.path, route.sourceLineNos),
          confidence: 0.78,
        });
      }
    }
    if (isCakePhpRouteConfigPath(file.path)) {
      for (const route of cakePhpRouteMatchesForContent(file.content)) {
        entrypoints.push({
          id: `entry_route_${slugify(file.path)}_${slugify(route.method)}_${slugify(route.route)}_${route.lineNo}`,
          kind: 'http_route',
          label: `${route.method.toUpperCase()} ${route.route}`,
          path: file.path,
          method: route.method.toUpperCase(),
          route: route.route,
          handler: route.handler,
          sourceRefs: lineSourceRefs(file.path, route.sourceLineNos),
          confidence: 0.78,
        });
      }
    }
    if (isYiiRouteConfigPath(file.path)) {
      for (const route of yiiRouteMatchesForContent(file.content)) {
        entrypoints.push({
          id: `entry_route_${slugify(file.path)}_${slugify(route.method)}_${slugify(route.route)}_${route.lineNo}`,
          kind: 'http_route',
          label: `${route.method.toUpperCase()} ${route.route}`,
          path: file.path,
          method: route.method.toUpperCase(),
          route: route.route,
          handler: route.handler,
          sourceRefs: lineSourceRefs(file.path, route.sourceLineNos),
          confidence: 0.78,
        });
      }
    }
    if (isZendFrameworkIniRouteConfigPath(file.path)) {
      for (const route of zendFrameworkIniRouteMatchesForContent(file.content)) {
        entrypoints.push({
          id: `entry_route_${slugify(file.path)}_${slugify(route.method)}_${slugify(route.route)}_${route.lineNo}`,
          kind: 'http_route',
          label: `${route.method.toUpperCase()} ${route.route}`,
          path: file.path,
          method: route.method.toUpperCase(),
          route: route.route,
          handler: route.handler,
          sourceRefs: lineSourceRefs(file.path, route.sourceLineNos),
          confidence: 0.78,
        });
      }
    }
    if (isDrupalModulePath(file.path)) {
      for (const route of drupalHookMenuRouteMatchesForContent(file.content)) {
        entrypoints.push({
          id: `entry_route_${slugify(file.path)}_${slugify(route.method)}_${slugify(route.route)}_${route.lineNo}`,
          kind: 'http_route',
          label: `${route.method.toUpperCase()} ${route.route}`,
          path: file.path,
          method: route.method.toUpperCase(),
          route: route.route,
          handler: route.handler,
          sourceRefs: lineSourceRefs(file.path, route.sourceLineNos),
          confidence: 0.78,
        });
      }
    }
    if (isPhpSourceLikePath(file.path)) {
      for (const route of wordPressActionHookRouteMatchesForContent(file.content)) {
        entrypoints.push({
          id: `entry_route_${slugify(file.path)}_${slugify(route.method)}_${slugify(route.route)}_${route.lineNo}`,
          kind: 'http_route',
          label: `${route.method.toUpperCase()} ${route.route}`,
          path: file.path,
          method: route.method.toUpperCase(),
          route: route.route,
          handler: route.handler,
          sourceRefs: lineSourceRefs(file.path, route.sourceLineNos),
          confidence: 0.78,
        });
      }
      for (const route of wordPressRestRouteMatchesForContent(file.content)) {
        entrypoints.push({
          id: `entry_route_${slugify(file.path)}_${slugify(route.method)}_${slugify(route.route)}_${route.lineNo}`,
          kind: 'http_route',
          label: `${route.method.toUpperCase()} ${route.route}`,
          path: file.path,
          method: route.method.toUpperCase(),
          route: route.route,
          handler: route.handler,
          sourceRefs: lineSourceRefs(file.path, route.sourceLineNos),
          confidence: 0.78,
        });
      }
    }
    const expressRouterMounts = mergeExpressRouterMountMaps(
      expressRouterMountsForContent(file.content, file.path),
      crossFileExpressRouterMounts.get(file.path),
    );
    const koaRouterMounts = koaRouterMountsForContent(file.content, file.path, parserEvidence.imports);
    const honoRouteMounts = honoRouteMountsForContent(file.content, file.path, parserEvidence.imports);
    const restifyRouteReceivers = restifyRouteReceiversForContent(file.content);
    const blockedLineRouteReceivers = new Set([
      ...blockedLineRouteReceiversForContent(file.content, koaRouterMounts, honoRouteMounts),
      ...restifyRouteReceivers.keys(),
      ...rejectedCreateServerRouteReceiversForContent(file.content, restifyRouteReceivers),
    ]);
    const djangoMounts = djangoUrlIncludeMounts.get(file.path) ?? [];
    const laravelRouteGroupMountsByLine = laravelRouteGroupMountsForContent(file.content, file.path);
    const railsRouteScopeMountsByLine = railsRouteScopeMountsForContent(file.content, file.path);
    const lines = file.content.split('\n');
    const sinatraRouteMatches = sinatraRouteMatchesForContent(file.content, file.path);
    const sinatraRouteLines = sinatraRouteCandidateLineNosForContent(file.content, file.path);
    for (const route of sinatraRouteMatches) {
      entrypoints.push({
        id: `entry_route_${slugify(file.path)}_${slugify(route.method)}_${slugify(route.route)}_${route.lineNo}`,
        kind: 'http_route',
        label: `${route.method.toUpperCase()} ${route.route}`,
        path: file.path,
        method: route.method.toUpperCase(),
        route: route.route,
        handler: route.handler,
        sourceRefs: lineSourceRefs(file.path, route.sourceLineNos),
        confidence: 0.76,
      });
    }
    const registeredFastifyPluginRoutes = fastifyRegisteredPluginRouteMatchesForContent(
      file.content,
      file.path,
      crossFileFastifyRegisterMounts.get(file.path),
    );
    const registeredFastifyPluginRouteLines = new Set(registeredFastifyPluginRoutes.map((route) => route.lineNo));
    const decoratedPythonRoutes = decoratedPythonRouteMatchesForContent(
      file.content,
      file.path,
      crossFilePythonRouterPrefixes.get(file.path),
    );
    const flaskAddUrlRuleRoutes = flaskAddUrlRuleRouteMatchesForContent(file.content, file.path);
    const decoratedPythonRouteLines = new Set(decoratedPythonRoutes.map((route) => route.lineNo));
    for (const route of [...decoratedPythonRoutes, ...flaskAddUrlRuleRoutes]) {
      entrypoints.push({
        id: `entry_route_${slugify(file.path)}_${slugify(route.method)}_${slugify(route.route)}_${route.lineNo}`,
        kind: 'http_route',
        label: `${route.method.toUpperCase()} ${route.route}`,
        path: file.path,
        method: route.method.toUpperCase(),
        route: route.route,
        handler: route.handler,
        sourceRefs: route.sourceRefs ?? lineSourceRefs(file.path, [route.lineNo, ...(route.prefixLineNos ?? [])]),
        confidence: 0.9,
      });
    }
    const decoratedTypeScriptRoutes = isTypeScriptAstCandidate(file.path)
      ? decoratedTypeScriptRouteMatchesForContent(file.content)
      : [];
    const decoratedTypeScriptRouteLines = new Set(decoratedTypeScriptRoutes.map((route) => route.lineNo));
    for (const route of decoratedTypeScriptRoutes) {
      entrypoints.push({
        id: `entry_route_${slugify(file.path)}_${slugify(route.method)}_${slugify(route.route)}_${route.lineNo}`,
        kind: 'http_route',
        label: `${route.method.toUpperCase()} ${route.route}`,
        path: file.path,
        method: route.method.toUpperCase(),
        route: route.route,
        handler: route.handler,
        sourceRefs: lineSourceRefs(file.path, [route.lineNo, ...(route.prefixLineNos ?? [])]),
        confidence: 0.9,
      });
    }
    const decoratedJavaRoutes = decoratedJavaRouteMatchesForContent(file.content, javaApplicationPathPrefix);
    const decoratedJavaRouteLines = new Set(decoratedJavaRoutes.map((route) => route.lineNo));
    for (const route of decoratedJavaRoutes) {
      entrypoints.push({
        id: `entry_route_${slugify(file.path)}_${slugify(route.method)}_${slugify(route.route)}_${route.lineNo}`,
        kind: 'http_route',
        label: `${route.method.toUpperCase()} ${route.route}`,
        path: file.path,
        method: route.method.toUpperCase(),
        route: route.route,
        handler: route.handler,
        sourceRefs: uniqueInOrder([
          ...lineSourceRefs(file.path, uniqueInOrder([
            route.lineNo,
            ...(route.prefixLineNos ?? []),
            ...(route.sourceLineNos ?? []),
          ])),
          ...(route.prefixSourceRefs ?? []),
        ]),
        confidence: 0.9,
      });
    }
    for (const route of jaxWsServiceRouteMatchesForContent(file.content)) {
      entrypoints.push({
        id: `entry_route_${slugify(file.path)}_${slugify(route.method)}_${slugify(route.route)}_${route.lineNo}`,
        kind: 'http_route',
        label: `${route.method.toUpperCase()} ${route.route}`,
        path: file.path,
        method: route.method.toUpperCase(),
        route: route.route,
        handler: route.handler,
        sourceRefs: lineSourceRefs(file.path, uniqueInOrder([
          route.lineNo,
          ...route.prefixLineNos,
          ...route.sourceLineNos,
        ])),
        confidence: 0.84,
      });
    }
    for (const route of wcfServiceRouteMatchesForContent(file.content, file.path, wcfServiceImplementations)) {
      entrypoints.push({
        id: `entry_route_${slugify(file.path)}_${slugify(route.method)}_${slugify(route.route)}_${route.lineNo}`,
        kind: 'http_route',
        label: `${route.method.toUpperCase()} ${route.route}`,
        path: file.path,
        method: route.method.toUpperCase(),
        route: route.route,
        handler: route.handler,
        sourceRefs: route.sourceRefs,
        confidence: 0.82,
      });
    }
    for (const route of asmxWebServiceRouteMatchesForContent(file.content, file.path)) {
      entrypoints.push({
        id: `entry_route_${slugify(file.path)}_${slugify(route.method)}_${slugify(route.route)}_${route.lineNo}`,
        kind: 'http_route',
        label: `${route.method.toUpperCase()} ${route.route}`,
        path: file.path,
        method: route.method.toUpperCase(),
        route: route.route,
        handler: route.handler,
        sourceRefs: route.sourceRefs,
        confidence: 0.82,
      });
    }
    for (const route of aspNetRouteTableRouteMatchesForContent(file.content)) {
      entrypoints.push({
        id: `entry_route_${slugify(file.path)}_${slugify(route.method)}_${slugify(route.route)}_${route.lineNo}`,
        kind: 'http_route',
        label: `${route.method.toUpperCase()} ${route.route}`,
        path: file.path,
        method: route.method.toUpperCase(),
        route: route.route,
        handler: route.handler,
        sourceRefs: lineSourceRefs(file.path, route.sourceLineNos),
        confidence: 0.8,
      });
    }
    for (const route of servletRouteMatchesForContent(file.content)) {
      entrypoints.push({
        id: `entry_route_${slugify(file.path)}_${slugify(route.method)}_${slugify(route.route)}_${route.lineNo}`,
        kind: 'http_route',
        label: `${route.method.toUpperCase()} ${route.route}`,
        path: file.path,
        method: route.method.toUpperCase(),
        route: route.route,
        handler: route.handler,
        sourceRefs: lineSourceRefs(file.path, uniqueInOrder([route.lineNo, ...route.prefixLineNos])),
        confidence: 0.85,
      });
    }
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const lineNo = index + 1;
      if (
        !decoratedPythonRouteLines.has(lineNo)
        && !decoratedTypeScriptRouteLines.has(lineNo)
        && !decoratedJavaRouteLines.has(lineNo)
        && !registeredFastifyPluginRouteLines.has(lineNo)
        && !sinatraRouteLines.has(lineNo)
      ) {
        for (const route of routeMatchesForLine(
          line,
          expressRouterMounts,
          koaRouterMounts,
          honoRouteMounts,
          blockedLineRouteReceivers,
          djangoMounts,
          laravelRouteGroupMountsByLine.get(lineNo) ?? [],
          railsRouteScopeMountsByLine.get(lineNo) ?? [],
        )) {
          entrypoints.push({
            id: `entry_route_${slugify(file.path)}_${slugify(route.method)}_${slugify(route.route)}_${lineNo}`,
            kind: 'http_route',
            label: `${route.method.toUpperCase()} ${route.route}`,
            path: file.path,
            method: route.method.toUpperCase(),
            route: route.route,
            handler: route.handler,
            sourceRefs: routeLineSourceRefs(file.path, lineNo, route.mount),
            confidence: 0.9,
          });
        }
      }
      const job = jobEntrypointForLine(file.path, line, lineNo);
      if (job) entrypoints.push(job);
    }
    for (const route of registeredFastifyPluginRoutes) {
      entrypoints.push({
        id: `entry_route_${slugify(file.path)}_${slugify(route.method)}_${slugify(route.route)}_${route.lineNo}`,
        kind: 'http_route',
        label: `${route.method.toUpperCase()} ${route.route}`,
        path: file.path,
        method: route.method.toUpperCase(),
        route: route.route,
        handler: route.handler,
        sourceRefs: route.sourceRefs,
        confidence: 0.88,
      });
    }
    for (const route of fastifyRouteMatchesForContent(file.content)) {
      if (registeredFastifyPluginRouteLines.has(route.lineNo)) continue;
      entrypoints.push({
        id: `entry_route_${slugify(file.path)}_${slugify(route.method)}_${slugify(route.route)}_${route.lineNo}`,
        kind: 'http_route',
        label: `${route.method.toUpperCase()} ${route.route}`,
        path: file.path,
        method: route.method.toUpperCase(),
        route: route.route,
        handler: route.handler,
        sourceRefs: [fileRef(file.path, route.lineNo)],
        confidence: 0.9,
      });
    }
    for (const route of hapiRouteMatchesForContent(file.content)) {
      entrypoints.push({
        id: `entry_route_${slugify(file.path)}_${slugify(route.method)}_${slugify(route.route)}_${route.lineNo}`,
        kind: 'http_route',
        label: `${route.method.toUpperCase()} ${route.route}`,
        path: file.path,
        method: route.method.toUpperCase(),
        route: route.route,
        handler: route.handler,
        sourceRefs: [fileRef(file.path, route.lineNo)],
        confidence: 0.86,
      });
    }
    for (const route of restifyRouteMatchesForContent(file.content, restifyRouteReceivers)) {
      entrypoints.push({
        id: `entry_route_${slugify(file.path)}_${slugify(route.method)}_${slugify(route.route)}_${route.lineNo}`,
        kind: 'http_route',
        label: `${route.method.toUpperCase()} ${route.route}`,
        path: file.path,
        method: route.method.toUpperCase(),
        route: route.route,
        handler: route.handler,
        sourceRefs: lineSourceRefs(file.path, uniqueInOrder([...route.receiverLineNos, route.lineNo])),
        confidence: 0.88,
      });
    }
    for (const route of expressRouteChainMatchesForContent(file.content, file.path, expressRouterMounts)) {
      entrypoints.push({
        id: `entry_route_${slugify(file.path)}_${slugify(route.method)}_${slugify(route.route)}_${route.lineNo}`,
        kind: 'http_route',
        label: `${route.method.toUpperCase()} ${route.route}`,
        path: file.path,
        method: route.method.toUpperCase(),
        route: route.route,
        handler: route.handler,
        sourceRefs: route.sourceRefs,
        confidence: 0.9,
      });
    }

    entrypoints.push(...fileEntrypointsForFile(file, parserEvidence.exports));
    entrypoints.push(...aspNetEntrypointsForFile(file));
    const bootstrap = bootstrapEntrypointForFile(file);
    if (bootstrap) entrypoints.push(bootstrap);
  }

  return dedupeById(entrypoints);
}

interface RouteMount {
  prefix: string;
  path: string;
  lineNo: number;
  sourceRefs?: string[];
}

interface ExpressRouterMount extends RouteMount {
}

interface DjangoUrlIncludeMount extends RouteMount {
}

interface LaravelRouteGroupMount extends RouteMount {
  startLine: number;
  endLine: number;
  controller?: string;
}

interface RailsRouteScopeMount extends RouteMount {
  startLine: number;
  endLine: number;
}

interface LineRouteMatch {
  method: string;
  route: string;
  handler?: string;
  mount?: RouteMount;
}

interface SinatraRouteMatch {
  method: string;
  route: string;
  handler?: string;
  lineNo: number;
  sourceLineNos: number[];
}

interface CodeIgniterRouteMatch {
  method: string;
  route: string;
  handler: string;
  lineNo: number;
  sourceLineNos: number[];
}

interface CakePhpRouteMatch {
  method: string;
  route: string;
  handler: string;
  lineNo: number;
  sourceLineNos: number[];
}

interface YiiRouteMatch {
  method: string;
  route: string;
  handler: string;
  lineNo: number;
  sourceLineNos: number[];
}

interface ZendFrameworkRouteMatch {
  method: string;
  route: string;
  handler: string;
  lineNo: number;
  sourceLineNos: number[];
}

interface DrupalRouteMatch {
  method: string;
  route: string;
  handler: string;
  lineNo: number;
  sourceLineNos: number[];
}

interface WordPressRouteMatch {
  method: string;
  route: string;
  handler: string;
  lineNo: number;
  sourceLineNos: number[];
}

interface SymfonyRouteMatch {
  method: string;
  route: string;
  handler: string;
  lineNo: number;
  sourceLineNos: number[];
}

function djangoUrlIncludeMountsForFiles(files: ScannedInventoryFile[]): Map<string, DjangoUrlIncludeMount[]> {
  const pythonPaths = new Set(files.filter((file) => file.path.endsWith('.py')).map((file) => file.path));
  const mounts = new Map<string, DjangoUrlIncludeMount[]>();
  for (const file of files) {
    if (!file.path.endsWith('.py')) continue;
    const lines = file.content.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const lineNo = index + 1;
      for (const include of djangoUrlIncludeMatchesForLine(line)) {
        const targetPath = djangoUrlIncludeTargetPath(include.moduleName, pythonPaths);
        if (!targetPath) continue;
        mounts.set(targetPath, [
          ...(mounts.get(targetPath) ?? []),
          { prefix: include.prefix, path: file.path, lineNo },
        ]);
      }
    }
  }
  return mounts;
}

function djangoUrlIncludeMatchesForLine(line: string): Array<{ prefix: string; moduleName: string }> {
  const matches: Array<{ prefix: string; moduleName: string }> = [];
  const include = /\b(?:path|re_path)\s*\(\s*r?(['"`])([^'"`]+)\1\s*,\s*include\s*\(\s*(?:r?(['"`])([^'"`]+)\3|\(\s*r?(['"`])([^'"`]+)\5\s*,\s*r?(['"`])([^'"`]+)\7\s*\))/g;
  for (const match of line.matchAll(include)) {
    const moduleName = match[4] ?? match[6];
    if (!match[2] || !moduleName) continue;
    matches.push({
      prefix: normalizeRoutePath(match[2]),
      moduleName,
    });
  }
  return matches;
}

function djangoUrlIncludeTargetPath(moduleName: string, knownPythonPaths: ReadonlySet<string>): string | null {
  if (!/^[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*$/.test(moduleName)) return null;
  const candidate = `${moduleName.replace(/\./g, '/')}.py`;
  return knownPythonPaths.has(candidate) ? candidate : null;
}

function laravelRouteGroupMountsForContent(content: string, path: string): Map<number, LaravelRouteGroupMount[]> {
  const groups = laravelRouteGroupBlocksForContent(content, path);
  const mountsByLine = new Map<number, LaravelRouteGroupMount[]>();
  if (groups.length === 0) return mountsByLine;
  const lineCount = content.split('\n').length;

  for (let lineNo = 1; lineNo <= lineCount; lineNo += 1) {
    const active = groups
      .filter((group) => group.startLine < lineNo && lineNo <= group.endLine)
      .sort((a, b) => a.startLine - b.startLine || a.lineNo - b.lineNo);
    if (active.length === 0) continue;
    const prefix = active.reduce((current, group) => (
      current === '/' ? normalizeRoutePath(group.prefix) : combineExpressRoutes(current, group.prefix)
    ), '/');
    mountsByLine.set(lineNo, [{
      prefix,
      path,
      lineNo: active[0]?.lineNo ?? lineNo,
      startLine: active[0]?.startLine ?? lineNo,
      endLine: active.at(-1)?.endLine ?? lineNo,
      controller: laravelActiveRouteGroupController(active),
      sourceRefs: uniqueInOrder(active.flatMap((group) => group.sourceRefs ?? [fileRef(group.path, group.lineNo)])),
    }]);
  }

  return mountsByLine;
}

function laravelRouteGroupBlocksForContent(content: string, path: string): LaravelRouteGroupMount[] {
  const groups: LaravelRouteGroupMount[] = [];
  const chainedGroup = /\bRoute::[A-Za-z_][\w]*\s*\([^;{}]*?\)(?:\s*->\s*[A-Za-z_][\w]*\s*\([^;{}]*?\))*\s*->\s*group\s*\(/g;
  for (const match of content.matchAll(chainedGroup)) {
    const prefix = laravelChainedGroupPrefixArg(match[0]);
    const controller = laravelChainedGroupControllerArg(match[0]);
    if (!prefix && !controller) continue;
    const group = laravelRouteGroupBlockFromOffset(content, path, match.index ?? 0, prefix ?? '/', controller);
    if (group) groups.push(group);
  }

  const groupCall = /\bRoute::group\s*\(/g;
  for (const match of content.matchAll(groupCall)) {
    const openParenOffset = (match.index ?? 0) + match[0].lastIndexOf('(');
    const closeParenOffset = matchingParenOffset(content, openParenOffset);
    if (closeParenOffset === -1) continue;
    const args = content.slice(openParenOffset + 1, closeParenOffset);
    const prefix = laravelArrayGroupPrefixArg(args);
    const controller = laravelArrayGroupControllerArg(args);
    if (prefix === null && !controller) continue;
    const group = laravelRouteGroupBlockFromOffset(content, path, match.index ?? 0, prefix ?? '/', controller);
    if (group) groups.push(group);
  }

  return groups.sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
}

function laravelActiveRouteGroupController(groups: readonly LaravelRouteGroupMount[]): string | undefined {
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const controller = groups[index]?.controller;
    if (controller) return controller;
  }
  return undefined;
}

function laravelChainedGroupPrefixArg(chain: string): string | null {
  const match = /(?:Route::|->)\s*prefix\s*\(\s*(['"`])([^'"`]+)\1\s*\)/.exec(chain);
  return match?.[2] ? normalizeRoutePath(match[2]) : null;
}

function laravelChainedGroupControllerArg(chain: string): string | null {
  const match = /(?:Route::|->)\s*controller\s*\(\s*\\?([A-Za-z_][\w\\]*Controller)(?:::class)?\s*\)/.exec(chain);
  return match?.[1] ?? null;
}

function laravelRouteGroupBlockFromOffset(
  content: string,
  path: string,
  offset: number,
  prefix: string,
  controller: string | null,
): LaravelRouteGroupMount | null {
  const openBraceOffset = content.indexOf('{', offset);
  if (openBraceOffset === -1) return null;
  const closeBraceOffset = matchingBraceOffset(content, openBraceOffset);
  if (closeBraceOffset === -1) return null;
  return {
    prefix: normalizeRoutePath(prefix),
    path,
    lineNo: lineNumberAtOffset(content, offset),
    startLine: lineNumberAtOffset(content, openBraceOffset),
    endLine: lineNumberAtOffset(content, closeBraceOffset),
    controller: controller ?? undefined,
    sourceRefs: [fileRef(path, lineNumberAtOffset(content, offset))],
  };
}

function laravelArrayGroupPrefixArg(args: string): string | null {
  const match = /['"`]prefix['"`]\s*=>\s*(['"`])([^'"`]+)\1/i.exec(args);
  return match?.[2] ? normalizeRoutePath(match[2]) : null;
}

function laravelArrayGroupControllerArg(args: string): string | null {
  const match = /['"`]controller['"`]\s*=>\s*\\?([A-Za-z_][\w\\]*Controller)(?:::class)?/i.exec(args);
  return match?.[1] ?? null;
}

function railsRouteScopeMountsForContent(content: string, path: string): Map<number, RailsRouteScopeMount[]> {
  const scopes = railsRouteScopeBlocksForContent(content, path);
  const mountsByLine = new Map<number, RailsRouteScopeMount[]>();
  if (scopes.length === 0) return mountsByLine;
  const lineCount = content.split('\n').length;

  for (let lineNo = 1; lineNo <= lineCount; lineNo += 1) {
    const active = scopes
      .filter((scope) => scope.startLine < lineNo && lineNo < scope.endLine)
      .sort((a, b) => a.startLine - b.startLine || a.lineNo - b.lineNo);
    if (active.length === 0) continue;
    const prefix = active.reduce((current, scope) => (
      current === '/' ? normalizeRoutePath(scope.prefix) : combineExpressRoutes(current, scope.prefix)
    ), '/');
    mountsByLine.set(lineNo, [{
      prefix,
      path,
      lineNo: active[0]?.lineNo ?? lineNo,
      startLine: active[0]?.startLine ?? lineNo,
      endLine: active.at(-1)?.endLine ?? lineNo,
      sourceRefs: uniqueInOrder(active.flatMap((scope) => scope.sourceRefs ?? [fileRef(scope.path, scope.lineNo)])),
    }]);
  }

  return mountsByLine;
}

function railsRouteScopeBlocksForContent(content: string, path: string): RailsRouteScopeMount[] {
  const lines = content.split('\n');
  const scopes: RailsRouteScopeMount[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const match = /^\s*scope\s+(['"`])([^'"`]+)\1(?=\s|,|\)|$).*\bdo\b/.exec(line);
    const namespaceMatch = /^\s*namespace\s+(?::([A-Za-z_][\w]*)|(['"`])([^'"`]+)\2)(?=\s|,|\)|$).*\bdo\b/.exec(line);
    const prefix = match?.[2] ?? namespaceMatch?.[1] ?? namespaceMatch?.[3];
    if (!prefix) continue;
    const endLine = rubyBlockEndLine(lines, index);
    if (!endLine) continue;
    scopes.push({
      prefix: normalizeRoutePath(prefix),
      path,
      lineNo: index + 1,
      startLine: index + 1,
      endLine,
      sourceRefs: [fileRef(path, index + 1)],
    });
  }
  return scopes;
}

function railsMatchRouteMatchesForLine(
  line: string,
  railsRouteScopeMounts: readonly RailsRouteScopeMount[],
): LineRouteMatch[] {
  const match = /^\s*match\s+(['"`])([^'"`]+)\1\s*(?:,|=>)([\s\S]*)$/i.exec(line);
  if (!match?.[2] || !match[3]) return [];
  if (!isStaticRailsMatchRoutePath(match[2])) return [];

  const handler = railsRouteHandlerForLine(line);
  const methods = railsViaMethodsFromOptions(match[3]);
  if (!handler || methods.length === 0) return [];

  const matches: LineRouteMatch[] = [];
  for (const method of methods) {
    for (const route of mountedRailsRouteVariants(match[2], railsRouteScopeMounts)) {
      matches.push({
        method,
        route: route.route,
        handler,
        mount: route.mount,
      });
    }
  }
  return matches;
}

function railsRootRouteMatchesForLine(
  line: string,
  railsRouteScopeMounts: readonly RailsRouteScopeMount[],
): LineRouteMatch[] {
  const handler = railsRootRouteHandlerForLine(line);
  if (!handler) return [];

  return mountedRailsRouteVariants('/', railsRouteScopeMounts).map((route) => ({
    method: 'GET',
    route: route.route,
    handler,
    mount: route.mount,
  }));
}

function railsRootRouteHandlerForLine(line: string): string | undefined {
  if (!/^\s*root\b/.test(line)) return undefined;

  const toHandler = railsRouteHandlerForLine(line);
  if (toHandler) return toHandler;

  const directTarget = /^\s*root(?:\s+|\s*\(\s*)(['"`])([A-Za-z_][\w]*(?:\/[A-Za-z_][\w]*)*)#([A-Za-z_][\w]*[!?=]?)\1/.exec(line);
  if (!directTarget?.[2] || !directTarget[3]) return undefined;
  return railsRouteHandlerFromTarget(directTarget[2], directTarget[3]);
}

function isStaticRailsMatchRoutePath(routePath: string): boolean {
  return routePath.startsWith('/')
    && routePath.length > 1
    && !routePath.includes('#{')
    && !routePath.includes('$')
    && !routePath.includes('*')
    && !routePath.includes('..');
}

function railsViaMethodsFromOptions(options: string): string[] {
  const methods = railsViaMethodTokensFromOptions(options).map(railsHttpMethodFromToken);
  return uniqueInOrder(methods.filter((method): method is string => Boolean(method)));
}

function railsViaMethodTokensFromOptions(options: string): string[] {
  const percentList = /\bvia:\s*%i\[([^\]]+)\]/.exec(options);
  if (percentList?.[1]) return percentList[1].split(/\s+/).filter(Boolean);

  const arrayList = /\bvia:\s*\[([^\]]+)\]/.exec(options);
  if (arrayList?.[1]) {
    return [...arrayList[1].matchAll(/:?['"`]?([A-Za-z_]\w*)['"`]?/g)]
      .map((match) => match[1])
      .filter((item): item is string => Boolean(item));
  }

  const symbol = /\bvia:\s*:([A-Za-z_]\w*)/.exec(options);
  if (symbol?.[1]) return [symbol[1]];

  const string = /\bvia:\s*(['"`])([A-Za-z_]\w*)\1/.exec(options);
  if (string?.[2]) return [string[2]];

  return [];
}

function railsHttpMethodFromToken(token: string): string | null {
  const normalized = token.toUpperCase();
  if (normalized === 'ALL') return 'ANY';
  return isHttpMethodName(normalized) ? normalized : null;
}

function rubyBlockEndLine(lines: readonly string[], startIndex: number): number | null {
  let depth = 0;
  for (let index = startIndex; index < lines.length; index += 1) {
    const withoutStrings = lines[index]!.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '');
    depth += withoutStrings.match(/\bdo\b/g)?.length ?? 0;
    depth -= withoutStrings.match(/\bend\b/g)?.length ?? 0;
    if (depth <= 0 && index > startIndex) return index + 1;
  }
  return null;
}

function routeMatchesForLine(
  line: string,
  expressRouterMounts: ReadonlyMap<string, readonly ExpressRouterMount[]> = new Map(),
  koaRouterMounts: ReadonlyMap<string, readonly RouteMount[]> = new Map(),
  honoRouteMounts: ReadonlyMap<string, readonly RouteMount[]> = new Map(),
  blockedLineRouteReceivers: ReadonlySet<string> = new Set(),
  djangoUrlIncludeMounts: readonly DjangoUrlIncludeMount[] = [],
  laravelRouteGroupMounts: readonly LaravelRouteGroupMount[] = [],
  railsRouteScopeMounts: readonly RailsRouteScopeMount[] = [],
): LineRouteMatch[] {
  const matches: LineRouteMatch[] = [];
  const express = /\b([A-Za-z_$][\w$]*)\s*\.\s*(get|post|put|patch|delete|options|head)\s*\(\s*['"`]([^'"`]+)['"`]([^;]*)/gi;
  for (const match of line.matchAll(express)) {
    const receiver = match[1]!;
    if (honoRouteMounts.has(receiver)) {
      for (const route of mountedRouteVariants(receiver, match[3]!, honoRouteMounts)) {
        matches.push({
          method: match[2]!,
          route: route.route,
          handler: handlerFromMiddlewareChainArgs(match[4]),
          mount: route.mount,
        });
      }
      continue;
    }
    if (koaRouterMounts.has(receiver)) {
      for (const route of mountedRouteVariants(receiver, match[3]!, koaRouterMounts)) {
        matches.push({
          method: match[2]!,
          route: route.route,
          handler: handlerFromMiddlewareChainArgs(match[4]),
          mount: route.mount,
        });
      }
      continue;
    }
    if (blockedLineRouteReceivers.has(receiver)) continue;
    if (!EXPRESS_ROUTE_RECEIVERS.has(receiver) && !expressRouterMounts.has(receiver)) continue;
    for (const route of mountedRouteVariants(receiver, match[3]!, expressRouterMounts)) {
      matches.push({
        method: match[2]!,
        route: route.route,
        handler: handlerFromMiddlewareChainArgs(match[4]),
        mount: route.mount,
      });
    }
  }
  const commonJsExportedExpress = /\bmodule\s*\.\s*exports\s*\.\s*(get|post|put|patch|delete|options|head)\s*\(\s*['"`]([^'"`]+)['"`]([^;]*)/gi;
  for (const match of line.matchAll(commonJsExportedExpress)) {
    const receiver = 'module.exports';
    if (!expressRouterMounts.has(receiver)) continue;
    for (const route of mountedRouteVariants(receiver, match[2]!, expressRouterMounts)) {
      matches.push({
        method: match[1]!,
        route: route.route,
        handler: handlerFromMiddlewareChainArgs(match[3]),
        mount: route.mount,
      });
    }
  }
  const fastifyRoute = /\bfastify\s*\.\s*route\s*\(\s*\{([^}]*)\}/gi;
  for (const match of line.matchAll(fastifyRoute)) {
    const route = fastifyRouteFromObjectLiteral(match[1]);
    if (route) matches.push(route);
  }
  const flaskRoute = /@(?:app|router|blueprint|bp)\s*\.\s*route\s*\(([^)]*)\)/gi;
  for (const match of line.matchAll(flaskRoute)) {
    const args = match[1] ?? '';
    const route = routeFromDecoratorArgs(args);
    const methods = methodsFromList(args);
    for (const method of methods.length ? methods : ['GET']) {
      matches.push({ method, route });
    }
  }
  const goHandleFunc = /\bhttp\s*\.\s*HandleFunc\s*\(\s*['"`]([^'"`]+)['"`]\s*,?\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)?/gi;
  for (const match of line.matchAll(goHandleFunc)) {
    matches.push({ method: 'GET', route: match[1]!, handler: match[2] });
  }
  const goMuxHandleFunc = /\b(?!http\b)([A-Za-z_$][\w$]*)\s*\.\s*HandleFunc\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*\)\s*\.\s*Methods\s*\(([^)]*)\)/gi;
  for (const match of line.matchAll(goMuxHandleFunc)) {
    const methods = goHttpMethodsFromArgs(match[4]);
    for (const method of methods.length ? methods : ['ANY']) {
      matches.push({ method, route: normalizeRoutePath(match[2]!), handler: match[3] });
    }
  }
  const railsRoute = /^\s*(get|post|put|patch|delete)\s+['"`]([^'"`]+)['"`]/gi;
  for (const match of line.matchAll(railsRoute)) {
    for (const route of mountedRailsRouteVariants(match[2]!, railsRouteScopeMounts)) {
      matches.push({
        method: match[1]!,
        route: route.route,
        handler: railsRouteHandlerForLine(line),
        mount: route.mount,
      });
    }
  }
  matches.push(...railsRootRouteMatchesForLine(line, railsRouteScopeMounts));
  matches.push(...railsMatchRouteMatchesForLine(line, railsRouteScopeMounts));
  matches.push(...railsSingularResourceRouteMatchesForLine(line, railsRouteScopeMounts));
  matches.push(...railsResourceRouteMatchesForLine(line, railsRouteScopeMounts));
  const laravelRoute = /\bRoute::(get|post|put|patch|delete|options|any)\s*\(\s*['"`]([^'"`]+)['"`]\s*,?\s*([^)]*)\)/gi;
  for (const match of line.matchAll(laravelRoute)) {
    for (const route of mountedLaravelRouteVariants(match[2]!, laravelRouteGroupMounts)) {
      matches.push({
        method: match[1]!.toUpperCase(),
        route: route.route,
        handler: laravelHandlerFromRouteArgs(match[3], route.mount),
        mount: route.mount,
      });
    }
  }
  const laravelMatchRoute = /\bRoute::match\s*\(\s*\[([^\]]+)\]\s*,\s*['"`]([^'"`]+)['"`]\s*,?\s*([^)]*)\)/gi;
  for (const match of line.matchAll(laravelMatchRoute)) {
    const methods = methodsFromList(match[1]);
    for (const method of methods.length ? methods : ['ANY']) {
      for (const route of mountedLaravelRouteVariants(match[2]!, laravelRouteGroupMounts)) {
        matches.push({
          method,
          route: route.route,
          handler: laravelHandlerFromRouteArgs(match[3], route.mount),
          mount: route.mount,
        });
      }
    }
  }
  matches.push(...laravelResourceRouteMatchesForLine(line, laravelRouteGroupMounts));
  matches.push(...slimRouteMatchesForLine(line));
  const djangoRoute = /\b(?:path|re_path)\s*\(\s*r?['"`]([^'"`]+)['"`]\s*,\s*([A-Za-z_][\w.]*)?/gi;
  for (const match of line.matchAll(djangoRoute)) {
    const handler = match[2];
    if (handler === 'include' && /\binclude\s*\(/.test(line.slice(match.index ?? 0))) continue;
    const route = normalizeRoutePath(match[1]!);
    if (djangoUrlIncludeMounts.length > 0) {
      for (const mount of djangoUrlIncludeMounts) {
        matches.push({
          method: 'ANY',
          route: combineExpressRoutes(mount.prefix, route),
          handler,
          mount,
        });
      }
      continue;
    }
    matches.push({ method: 'ANY', route, handler });
  }
  const decorator = /@(Get|Post|Put|Patch|Delete|RequestMapping|GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping)\s*\(([^)]*)\)/gi;
  for (const match of line.matchAll(decorator)) {
    const rawMethod = match[1]!;
    const args = match[2] ?? '';
    const route = normalizeRoutePath(routeFromDecoratorArgs(args));
    matches.push({ method: methodFromDecorator(rawMethod, args), route });
  }
  return matches;
}

function decoratedTypeScriptRouteMatchesForContent(
  content: string,
): Array<{ method: string; route: string; handler: string; lineNo: number; prefixLineNos?: number[] }> {
  const matches: Array<{ method: string; route: string; handler: string; lineNo: number; prefixLineNos?: number[] }> = [];
  const pendingRoutes: Array<{ method: string; route: string; lineNo: number; prefixLineNos?: number[] }> = [];
  const lines = content.split('\n');
  let pendingController: { prefix: string; lineNos: number[] } | null = null;
  let classScope: { prefix: string; prefixLineNos: number[]; braceDepth: number; opened: boolean } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const lineNo = index + 1;
    const controller = nestControllerDecoratorForLine(line, lineNo);
    if (controller) {
      pendingController = controller;
      continue;
    }

    const routes = classScope ? nestRouteDecoratorsForLine(line, lineNo, classScope) : [];
    if (routes.length > 0) {
      pendingRoutes.push(...routes);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      updateTypeScriptClassScope(line, classScope);
      continue;
    }
    if (trimmed.startsWith('@')) {
      updateTypeScriptClassScope(line, classScope);
      continue;
    }

    if (/\bclass\s+[A-Za-z_$][\w$]*/.test(trimmed)) {
      if (pendingController) {
        classScope = {
          prefix: pendingController.prefix,
          prefixLineNos: pendingController.lineNos,
          braceDepth: 0,
          opened: false,
        };
      }
      pendingController = null;
    }

    const methodName = classScope ? typeScriptClassMethodNameForLine(trimmed) : null;
    if (methodName && pendingRoutes.length > 0) {
      for (const route of pendingRoutes) {
        matches.push({ ...route, handler: methodName });
      }
      pendingRoutes.length = 0;
    } else if (!methodName) {
      pendingRoutes.length = 0;
    }

    classScope = updateTypeScriptClassScope(line, classScope);
  }

  return matches;
}

function nestControllerDecoratorForLine(
  line: string,
  lineNo: number,
): { prefix: string; lineNos: number[] } | null {
  const match = /^\s*@Controller\s*\(([^)]*)\)/.exec(line);
  if (!match) return null;
  return {
    prefix: normalizeRoutePath(routeFromDecoratorArgs(match[1] ?? '')),
    lineNos: [lineNo],
  };
}

function nestRouteDecoratorsForLine(
  line: string,
  lineNo: number,
  classScope: { prefix: string; prefixLineNos: number[] },
): Array<{ method: string; route: string; lineNo: number; prefixLineNos?: number[] }> {
  const matches: Array<{ method: string; route: string; lineNo: number; prefixLineNos?: number[] }> = [];
  const decorator = /^\s*@(Get|Post|Put|Patch|Delete|Options|Head|All)\s*\(([^)]*)\)/i;
  const match = decorator.exec(line);
  if (!match?.[1]) return matches;
  matches.push({
    method: methodFromNestDecorator(match[1]),
    route: combineExpressRoutes(classScope.prefix, routeFromDecoratorArgs(match[2] ?? '')),
    lineNo,
    prefixLineNos: classScope.prefixLineNos,
  });
  return matches;
}

function methodFromNestDecorator(name: string): string {
  const normalized = name.toLowerCase();
  if (normalized === 'all') return 'ANY';
  return normalized.toUpperCase();
}

function typeScriptClassMethodNameForLine(line: string): string | null {
  const match = /^(?:(?:public|private|protected|static|async|override|readonly)\s+)*([A-Za-z_$][\w$]*)\s*\(/.exec(line);
  const name = match?.[1] ?? null;
  return name && name !== 'constructor' ? name : null;
}

function updateTypeScriptClassScope<T extends { braceDepth: number; opened: boolean }>(
  line: string,
  scope: T | null,
): T | null {
  if (!scope) return null;
  scope.braceDepth += braceDeltaForLine(line);
  scope.opened = scope.opened || line.includes('{');
  return scope.opened && scope.braceDepth <= 0 ? null : scope;
}

function decoratedPythonRouteMatchesForContent(
  content: string,
  path?: string,
  externalRouterPrefixes: ReadonlyMap<string, PythonRouterPrefix> = new Map(),
): Array<{
  method: string;
  route: string;
  handler: string;
  lineNo: number;
  prefixLineNos?: number[];
  sourceRefs?: string[];
}> {
  const matches: Array<{
    method: string;
    route: string;
    handler: string;
    lineNo: number;
    prefixLineNos?: number[];
    sourceRefs?: string[];
  }> = [];
  const pendingRoutes: Array<{
    method: string;
    route: string;
    lineNo: number;
    prefixLineNos?: number[];
    sourceRefs?: string[];
  }> = [];
  const routerPrefixes = mergePythonRouterPrefixMaps(
    pythonRouterPrefixesForContent(content, path),
    externalRouterPrefixes,
  );
  const lines = content.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const lineNo = index + 1;
    const routes = pythonRouteDecoratorsForLine(line, lineNo, routerPrefixes);
    if (routes.length > 0) {
      pendingRoutes.push(...routes);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('@')) continue;

    const functionMatch = /^def\s+([A-Za-z_][\w]*)\s*\(/.exec(trimmed);
    if (functionMatch?.[1] && pendingRoutes.length > 0) {
      for (const route of pendingRoutes) {
        matches.push({
          ...route,
          handler: functionMatch[1],
          sourceRefs: path
            ? uniqueInOrder([
              fileRef(path, route.lineNo),
              ...(route.sourceRefs ?? []),
            ])
            : route.sourceRefs,
        });
      }
    }
    pendingRoutes.length = 0;
  }

  return matches;
}

function decoratedJavaRouteMatchesForContent(
  content: string,
  applicationPathPrefix: JavaApplicationPathPrefix | null = null,
): Array<{
  method: string;
  route: string;
  handler: string;
  lineNo: number;
  prefixLineNos?: number[];
  prefixSourceRefs?: string[];
  sourceLineNos?: number[];
}> {
  const matches: Array<{
    method: string;
    route: string;
    handler: string;
    lineNo: number;
    prefixLineNos?: number[];
    prefixSourceRefs?: string[];
    sourceLineNos?: number[];
  }> = [];
  const pendingRoutes: JavaRouteDecorator[] = [];
  const lines = content.split('\n');
  let classRoutePrefix = '/';
  let classRoutePrefixLineNos: number[] = [];
  let classRoutePrefixSourceRefs: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const lineNo = index + 1;
    const routes = javaRouteDecoratorsForLine(line, lineNo);
    if (routes.length > 0) {
      pendingRoutes.push(...routes);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('@')) continue;

    if (javaClassNameForLine(trimmed)) {
      const classRoute = javaClassRouteFromDecorators(pendingRoutes, applicationPathPrefix);
      if (classRoute) {
        classRoutePrefix = classRoute.route;
        classRoutePrefixLineNos = classRoute.lineNos;
        classRoutePrefixSourceRefs = classRoute.sourceRefs;
      }
      pendingRoutes.length = 0;
      continue;
    }

    const methodName = javaMethodNameForLine(trimmed);
    if (methodName && pendingRoutes.length > 0) {
      for (const route of javaMethodRoutesFromDecorators(pendingRoutes)) {
        matches.push({
          ...route,
          route: combineExpressRoutes(classRoutePrefix, route.route),
          handler: methodName,
          prefixLineNos: classRoutePrefixLineNos,
          prefixSourceRefs: classRoutePrefixSourceRefs,
        });
      }
    }
    pendingRoutes.length = 0;
  }

  return matches;
}

interface JavaRouteDecorator {
  method: string;
  route: string;
  lineNo: number;
  kind: 'spring_mapping' | 'jax_rs_http' | 'jax_rs_path';
}

interface JavaMethodRoute {
  method: string;
  route: string;
  lineNo: number;
  sourceLineNos: number[];
}

interface JavaApplicationPathPrefix {
  prefix: string;
  sourceRefs: string[];
}

function javaRouteDecoratorsForLine(
  line: string,
  lineNo: number,
): JavaRouteDecorator[] {
  const matches: JavaRouteDecorator[] = [];
  const decorator = /@(Get|Post|Put|Patch|Delete|RequestMapping|GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping)\s*\(([^)]*)\)/gi;
  for (const match of line.matchAll(decorator)) {
    const rawMethod = match[1]!;
    const args = match[2] ?? '';
    matches.push({
      method: methodFromDecorator(rawMethod, args),
      route: normalizeRoutePath(routeFromDecoratorArgs(args)),
      lineNo,
      kind: 'spring_mapping',
    });
  }
  const jaxRsHttpDecorator = /@(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g;
  for (const match of line.matchAll(jaxRsHttpDecorator)) {
    matches.push({
      method: match[1]!,
      route: '/',
      lineNo,
      kind: 'jax_rs_http',
    });
  }
  const jaxRsPathDecorator = /@Path\s*\(([^)]*)\)/g;
  for (const match of line.matchAll(jaxRsPathDecorator)) {
    matches.push({
      method: 'ANY',
      route: normalizeRoutePath(routeFromDecoratorArgs(match[1] ?? '')),
      lineNo,
      kind: 'jax_rs_path',
    });
  }
  return matches;
}

function javaApplicationPathPrefixForFiles(files: readonly ScannedInventoryFile[]): JavaApplicationPathPrefix | null {
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    if (!file.path.endsWith('.java')) continue;
    const lines = file.content.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const match = /@ApplicationPath\s*\(([^)]*)\)/.exec(line);
      if (!match?.[1]) continue;
      const prefix = normalizeRoutePath(routeFromDecoratorArgs(match[1]));
      if (!prefix || prefix === '/') continue;
      return {
        prefix,
        sourceRefs: [fileRef(file.path, index + 1)],
      };
    }
  }
  return null;
}

function javaClassRouteFromDecorators(
  decorators: readonly JavaRouteDecorator[],
  applicationPathPrefix: JavaApplicationPathPrefix | null = null,
): { route: string; lineNos: number[]; sourceRefs: string[] } | null {
  for (let index = decorators.length - 1; index >= 0; index -= 1) {
    const decorator = decorators[index]!;
    if (
      (decorator.kind === 'spring_mapping' || decorator.kind === 'jax_rs_path')
      && decorator.method === 'ANY'
      && decorator.route
      && decorator.route !== '/'
    ) {
      const useApplicationPrefix = decorator.kind === 'jax_rs_path' && applicationPathPrefix;
      return {
        route: useApplicationPrefix
          ? combineExpressRoutes(useApplicationPrefix.prefix, decorator.route)
          : decorator.route,
        lineNos: [decorator.lineNo],
        sourceRefs: useApplicationPrefix ? useApplicationPrefix.sourceRefs : [],
      };
    }
  }
  return null;
}

function javaMethodRoutesFromDecorators(decorators: readonly JavaRouteDecorator[]): JavaMethodRoute[] {
  const springRoutes = decorators.filter((decorator) => decorator.kind === 'spring_mapping');
  if (springRoutes.length > 0) {
    return springRoutes.map((decorator) => ({
      method: decorator.method,
      route: decorator.route,
      lineNo: decorator.lineNo,
      sourceLineNos: [decorator.lineNo],
    }));
  }

  const httpDecorators = decorators.filter((decorator) => decorator.kind === 'jax_rs_http');
  if (httpDecorators.length === 0) return [];

  const pathDecorator = lastJavaRouteDecoratorOfKind(decorators, 'jax_rs_path');
  const route = pathDecorator?.route ?? '/';
  const pathLineNos = pathDecorator ? [pathDecorator.lineNo] : [];
  return httpDecorators.map((decorator) => ({
    method: decorator.method,
    route,
    lineNo: pathDecorator?.lineNo ?? decorator.lineNo,
    sourceLineNos: uniqueInOrder([decorator.lineNo, ...pathLineNos]),
  }));
}

function lastJavaRouteDecoratorOfKind(
  decorators: readonly JavaRouteDecorator[],
  kind: JavaRouteDecorator['kind'],
): JavaRouteDecorator | null {
  for (let index = decorators.length - 1; index >= 0; index -= 1) {
    const decorator = decorators[index]!;
    if (decorator.kind === kind) return decorator;
  }
  return null;
}

function jaxWsServiceRouteMatchesForContent(
  content: string,
): Array<{
  method: string;
  route: string;
  handler: string;
  lineNo: number;
  prefixLineNos: number[];
  sourceLineNos: number[];
}> {
  const matches: Array<{
    method: string;
    route: string;
    handler: string;
    lineNo: number;
    prefixLineNos: number[];
    sourceLineNos: number[];
  }> = [];
  const lines = content.split('\n');
  let pendingService: { serviceName: string | null; lineNos: number[] } | null = null;
  const pendingMethods: Array<{ operationName: string | null; lineNo: number }> = [];
  let classScope: {
    className: string;
    serviceName: string;
    lineNos: number[];
    braceDepth: number;
    opened: boolean;
  } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const lineNo = index + 1;
    const service = jaxWsWebServiceForLine(line);
    if (service) {
      pendingService = { serviceName: service.serviceName, lineNos: [lineNo] };
      classScope = updateTypeScriptClassScope(line, classScope);
      continue;
    }

    const webMethod = classScope ? jaxWsWebMethodForLine(line) : null;
    if (webMethod) {
      if (!webMethod.exclude) {
        pendingMethods.push({ operationName: webMethod.operationName, lineNo });
      }
      classScope = updateTypeScriptClassScope(line, classScope);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      classScope = updateTypeScriptClassScope(line, classScope);
      continue;
    }
    if (trimmed.startsWith('@')) {
      classScope = updateTypeScriptClassScope(line, classScope);
      continue;
    }

    const className = javaClassNameForLine(trimmed);
    if (className) {
      if (pendingService) {
        classScope = {
          className,
          serviceName: pendingService.serviceName ?? className,
          lineNos: pendingService.lineNos,
          braceDepth: 0,
          opened: false,
        };
      }
      pendingService = null;
      pendingMethods.length = 0;
    }

    const methodName = classScope ? javaMethodNameForLine(trimmed) : null;
    if (methodName && pendingMethods.length > 0 && classScope) {
      for (const method of pendingMethods) {
        const operationName = method.operationName ?? methodName;
        matches.push({
          method: 'ANY',
          route: jaxWsOperationRoute(classScope.serviceName, operationName),
          handler: `${classScope.className}#${methodName}`,
          lineNo: method.lineNo,
          prefixLineNos: classScope.lineNos,
          sourceLineNos: [lineNo],
        });
      }
      pendingMethods.length = 0;
    } else if (!methodName) {
      pendingMethods.length = 0;
    }

    classScope = updateTypeScriptClassScope(line, classScope);
  }

  return matches;
}

function jaxWsWebServiceForLine(line: string): { serviceName: string | null } | null {
  const match = /@(?:[A-Za-z_$][\w$]*\.)*WebService\b(?:\s*\(([\s\S]*)\))?/.exec(line);
  if (!match) return null;
  const args = match[1] ?? '';
  return {
    serviceName: staticAnnotationStringAttribute(args, 'serviceName')
      ?? staticAnnotationStringAttribute(args, 'name'),
  };
}

function jaxWsWebMethodForLine(line: string): { operationName: string | null; exclude: boolean } | null {
  const match = /@(?:[A-Za-z_$][\w$]*\.)*WebMethod\b(?:\s*\(([\s\S]*)\))?/.exec(line);
  if (!match) return null;
  const args = match[1] ?? '';
  return {
    operationName: staticAnnotationStringAttribute(args, 'operationName'),
    exclude: /\bexclude\s*=\s*true\b/i.test(args),
  };
}

function staticAnnotationStringAttribute(args: string, name: string): string | null {
  const match = new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*(["'])([^"']*)\\1`).exec(args);
  return match?.[2]?.trim() || null;
}

function jaxWsOperationRoute(serviceName: string, operationName: string): string {
  return normalizeRoutePath([
    'soap',
    javaIdentifierRouteSegment(serviceName),
    javaIdentifierRouteSegment(operationName),
  ].join('/'));
}

interface WcfServiceImplementation {
  className: string;
  path: string;
  lineNo: number;
  implementedContracts: string[];
  methodLines: Map<string, number[]>;
}

interface WcfServiceContractOperation {
  contractKind: 'class' | 'interface';
  contractTypeName: string;
  contractQualifiedName?: string;
  serviceName: string;
  operationName: string;
  methodName: string;
  lineNo: number;
  sourceRefs: string[];
}

interface CSharpTypeDeclaration {
  kind: 'class' | 'interface';
  name: string;
  implementedTypes: string[];
}

function wcfServiceRouteMatchesForContent(
  content: string,
  path: string,
  implementationsByContract: ReadonlyMap<string, readonly WcfServiceImplementation[]>,
): Array<{
  method: string;
  route: string;
  handler: string;
  lineNo: number;
  sourceRefs: string[];
}> {
  const matches: Array<{
    method: string;
    route: string;
    handler: string;
    lineNo: number;
    sourceRefs: string[];
  }> = [];

  for (const operation of wcfServiceContractOperationsForContent(content, path)) {
    const handler = wcfOperationHandler(
      {
        kind: operation.contractKind,
        typeName: operation.contractTypeName,
      },
      operation.methodName,
      implementationsByContract,
    );
    matches.push({
      method: 'ANY',
      route: wcfOperationRoute(operation.serviceName, operation.operationName),
      handler: handler.handler,
      lineNo: operation.lineNo,
      sourceRefs: uniqueSorted([
        ...operation.sourceRefs,
        ...handler.sourceRefs,
      ]),
    });
  }

  return matches;
}

function wcfServiceContractOperationsForContent(
  content: string,
  path: string,
): WcfServiceContractOperation[] {
  const operations: WcfServiceContractOperation[] = [];
  const lines = content.split('\n');
  let currentNamespace: string | null = null;
  let pendingService: { serviceName: string | null; lineNos: number[] } | null = null;
  const pendingOperations: Array<{ operationName: string | null; lineNo: number }> = [];
  let typeScope: {
    kind: 'class' | 'interface';
    typeName: string;
    qualifiedName?: string;
    serviceName: string;
    lineNos: number[];
    braceDepth: number;
    opened: boolean;
  } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const lineNo = index + 1;
    const namespaceMatch = /^\s*namespace\s+([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)\s*(?:[;{]|$)/.exec(line);
    if (namespaceMatch?.[1]) {
      currentNamespace = namespaceMatch[1];
    }
    const service = wcfServiceContractForLine(line);
    if (service) {
      pendingService = { serviceName: service.serviceName, lineNos: [lineNo] };
      typeScope = updateTypeScriptClassScope(line, typeScope);
      continue;
    }

    const operation = typeScope ? wcfOperationContractForLine(line) : null;
    if (operation) {
      pendingOperations.push({ operationName: operation.operationName, lineNo });
      typeScope = updateTypeScriptClassScope(line, typeScope);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      typeScope = updateTypeScriptClassScope(line, typeScope);
      continue;
    }
    if (trimmed.startsWith('[')) {
      typeScope = updateTypeScriptClassScope(line, typeScope);
      continue;
    }

    const typeDeclaration = csharpTypeDeclarationForLine(trimmed);
    if (typeDeclaration) {
      if (pendingService) {
        typeScope = {
          kind: typeDeclaration.kind,
          typeName: typeDeclaration.name,
          ...(currentNamespace ? { qualifiedName: `${currentNamespace}.${typeDeclaration.name}` } : {}),
          serviceName: pendingService.serviceName
            ?? csharpContractRouteName(typeDeclaration.name, typeDeclaration.kind),
          lineNos: pendingService.lineNos,
          braceDepth: 0,
          opened: false,
        };
      }
      pendingService = null;
      pendingOperations.length = 0;
    }

    const methodName = typeScope ? csharpMethodNameForLine(trimmed) : null;
    if (methodName && pendingOperations.length > 0 && typeScope) {
      for (const operation of pendingOperations) {
        const operationName = operation.operationName ?? methodName;
        operations.push({
          contractKind: typeScope.kind,
          contractTypeName: typeScope.typeName,
          ...(typeScope.qualifiedName ? { contractQualifiedName: typeScope.qualifiedName } : {}),
          serviceName: typeScope.serviceName,
          operationName,
          methodName,
          lineNo: operation.lineNo,
          sourceRefs: uniqueSorted([
            ...typeScope.lineNos.map((lineNumber) => fileRef(path, lineNumber)),
            fileRef(path, operation.lineNo),
            fileRef(path, lineNo),
          ]),
        });
      }
      pendingOperations.length = 0;
    } else if (!methodName) {
      pendingOperations.length = 0;
    }

    typeScope = updateTypeScriptClassScope(line, typeScope);
  }

  return operations;
}

function wcfServiceContractOperationsByTypeForFiles(
  files: readonly ScannedInventoryFile[],
): Map<string, WcfServiceContractOperation[]> {
  const operationsByType = new Map<string, WcfServiceContractOperation[]>();
  for (const file of files) {
    if (!/\.cs$/i.test(file.path)) continue;
    for (const operation of wcfServiceContractOperationsForContent(file.content, file.path)) {
      for (const key of uniqueInOrder([
        operation.contractQualifiedName,
        operation.contractTypeName,
      ].filter((value): value is string => Boolean(value)))) {
        operationsByType.set(key, [
          ...(operationsByType.get(key) ?? []),
          operation,
        ]);
      }
    }
  }
  return operationsByType;
}

function wcfServiceContractForLine(line: string): { serviceName: string | null } | null {
  const match = /\[(?:[A-Za-z_][\w]*\.)*ServiceContract\b(?:\s*\(([\s\S]*?)\))?\]/.exec(line);
  if (!match) return null;
  const args = match[1] ?? '';
  return {
    serviceName: staticAnnotationStringAttribute(args, 'Name')
      ?? staticAnnotationStringAttribute(args, 'name'),
  };
}

function wcfOperationContractForLine(line: string): { operationName: string | null } | null {
  const match = /\[(?:[A-Za-z_][\w]*\.)*OperationContract\b(?:\s*\(([\s\S]*?)\))?\]/.exec(line);
  if (!match) return null;
  const args = match[1] ?? '';
  return {
    operationName: staticAnnotationStringAttribute(args, 'Name')
      ?? staticAnnotationStringAttribute(args, 'name'),
  };
}

function wcfOperationRoute(serviceName: string, operationName: string): string {
  return normalizeRoutePath([
    'wcf',
    javaIdentifierRouteSegment(serviceName),
    javaIdentifierRouteSegment(operationName),
  ].join('/'));
}

function wcfOperationHandler(
  typeScope: {
    kind: 'class' | 'interface';
    typeName: string;
  },
  methodName: string,
  implementationsByContract: ReadonlyMap<string, readonly WcfServiceImplementation[]>,
): { handler: string; sourceRefs: string[] } {
  if (typeScope.kind === 'class') {
    return { handler: `${typeScope.typeName}#${methodName}`, sourceRefs: [] };
  }

  const implementations = (implementationsByContract.get(typeScope.typeName) ?? [])
    .filter((implementation) => implementation.methodLines.has(methodName));
  if (implementations.length !== 1) {
    return { handler: `${typeScope.typeName}#${methodName}`, sourceRefs: [] };
  }

  const implementation = implementations[0]!;
  const methodLine = implementation.methodLines.get(methodName)?.at(0);
  return {
    handler: `${implementation.className}#${methodName}`,
    sourceRefs: uniqueSorted([
      fileRef(implementation.path, implementation.lineNo),
      methodLine ? fileRef(implementation.path, methodLine) : '',
    ].filter(Boolean)),
  };
}

function wcfServiceImplementationsForFiles(
  files: readonly ScannedInventoryFile[],
): Map<string, WcfServiceImplementation[]> {
  const implementationsByContract = new Map<string, WcfServiceImplementation[]>();
  for (const file of files) {
    if (!/\.cs$/i.test(file.path)) continue;
    const lines = file.content.split('\n');
    let classScope: {
      implementation: WcfServiceImplementation;
      braceDepth: number;
      opened: boolean;
    } | null = null;

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const lineNo = index + 1;
      const trimmed = line.trim();
      const typeDeclaration = csharpTypeDeclarationForLine(trimmed);
      if (typeDeclaration?.kind === 'class') {
        const implementation: WcfServiceImplementation = {
          className: typeDeclaration.name,
          path: file.path,
          lineNo,
          implementedContracts: typeDeclaration.implementedTypes,
          methodLines: new Map(),
        };
        classScope = { implementation, braceDepth: 0, opened: false };
        for (const contract of implementation.implementedContracts) {
          implementationsByContract.set(contract, [
            ...(implementationsByContract.get(contract) ?? []),
            implementation,
          ]);
        }
      } else if (classScope) {
        const methodName = csharpMethodNameForLine(trimmed);
        if (methodName) {
          classScope.implementation.methodLines.set(methodName, [
            ...(classScope.implementation.methodLines.get(methodName) ?? []),
            lineNo,
          ]);
        }
      }

      classScope = updateTypeScriptClassScope(line, classScope);
    }
  }
  return implementationsByContract;
}

function wcfServiceModelConfigRouteMatchesForFile(
  file: ScannedInventoryFile,
  operationsByContract: ReadonlyMap<string, readonly WcfServiceContractOperation[]>,
  implementationsByContract: ReadonlyMap<string, readonly WcfServiceImplementation[]>,
): Array<{
  method: string;
  route: string;
  handler: string;
  lineNo: number;
  sourceRefs: string[];
  confidence: number;
}> {
  const matches: Array<{
    method: string;
    route: string;
    handler: string;
    lineNo: number;
    sourceRefs: string[];
    confidence: number;
  }> = [];
  const serviceModelBlock = /<system\.serviceModel\b[^>]*>([\s\S]*?)<\/system\.serviceModel>/gi;
  for (const systemMatch of file.content.matchAll(serviceModelBlock)) {
    const systemBody = systemMatch[1] ?? '';
    const systemBodyOffset = (systemMatch.index ?? 0) + systemMatch[0].indexOf(systemBody);
    const serviceBlock = /<service\b([^>]*)>([\s\S]*?)<\/service>/gi;
    for (const serviceMatch of systemBody.matchAll(serviceBlock)) {
      const serviceAttrs = serviceMatch[1] ?? '';
      const serviceBody = serviceMatch[2] ?? '';
      const serviceOffset = systemBodyOffset + (serviceMatch.index ?? 0);
      const serviceName = xmlAttributeValue(serviceAttrs, 'name');
      if (!isStaticWcfConfigLiteral(serviceName)) continue;

      const serviceClassName = dotNetTypeBaseName(serviceName);
      if (!serviceClassName || !/^[A-Za-z_$][\w$]*$/.test(serviceClassName)) continue;

      const serviceLineNo = lineNumberAtOffset(file.content, serviceOffset);
      const serviceBodyOffset = serviceOffset + serviceMatch[0].indexOf(serviceBody);
      const endpointTag = /<endpoint\b([^>]*?)(?:\/>|>[\s\S]*?<\/endpoint>)/gi;
      for (const endpointMatch of serviceBody.matchAll(endpointTag)) {
        const endpointAttrs = endpointMatch[1] ?? '';
        const endpointOffset = serviceBodyOffset + (endpointMatch.index ?? 0);
        const endpointLineNo = lineNumberAtOffset(file.content, endpointOffset);
        const address = xmlAttributeValue(endpointAttrs, 'address');
        if (!isStaticWcfConfigOptionalAddress(address)) continue;

        const contract = xmlAttributeValue(endpointAttrs, 'contract');
        if (!isStaticWcfConfigLiteral(contract)) continue;
        const operations = wcfConfigContractLookup(contract, operationsByContract);
        if (!operations) continue;

        const configSourceRefs = lineSourceRefs(file.path, [serviceLineNo, endpointLineNo]);
        const endpointRoute = wcfConfigEndpointRouteForAddress(address);
        if (endpointRoute) {
          matches.push({
            method: 'ANY',
            route: endpointRoute,
            handler: `WCF:${serviceClassName}`,
            lineNo: endpointLineNo,
            sourceRefs: configSourceRefs,
            confidence: 0.76,
          });
        }

        for (const operation of operations) {
          const handler = wcfConfigOperationHandler(
            operation,
            serviceClassName,
            implementationsByContract,
          );
          matches.push({
            method: 'ANY',
            route: wcfOperationRoute(operation.serviceName, operation.operationName),
            handler: handler.handler,
            lineNo: endpointLineNo,
            sourceRefs: uniqueSorted([
              ...configSourceRefs,
              ...operation.sourceRefs,
              ...handler.sourceRefs,
            ]),
            confidence: 0.8,
          });
        }
      }
    }
  }
  return matches;
}

function wcfConfigOperationHandler(
  operation: WcfServiceContractOperation,
  serviceClassName: string,
  implementationsByContract: ReadonlyMap<string, readonly WcfServiceImplementation[]>,
): { handler: string; sourceRefs: string[] } {
  if (operation.contractKind === 'class') {
    return { handler: `${operation.contractTypeName}#${operation.methodName}`, sourceRefs: [] };
  }

  const implementations = (implementationsByContract.get(operation.contractTypeName) ?? [])
    .filter((implementation) => (
      implementation.className === serviceClassName
      && implementation.methodLines.has(operation.methodName)
    ));
  if (implementations.length !== 1) {
    return { handler: `${operation.contractTypeName}#${operation.methodName}`, sourceRefs: [] };
  }

  const implementation = implementations[0]!;
  const methodLine = implementation.methodLines.get(operation.methodName)?.at(0);
  return {
    handler: `${implementation.className}#${operation.methodName}`,
    sourceRefs: uniqueSorted([
      fileRef(implementation.path, implementation.lineNo),
      methodLine ? fileRef(implementation.path, methodLine) : '',
    ].filter(Boolean)),
  };
}

function wcfConfigContractLookup(
  contract: string,
  operationsByContract: ReadonlyMap<string, readonly WcfServiceContractOperation[]>,
): readonly WcfServiceContractOperation[] | null {
  const normalizedContract = contract.split(',').at(0)?.trim();
  const contractTypeName = dotNetTypeBaseName(contract);
  if (!normalizedContract || !contractTypeName || !/^[A-Za-z_$][\w$]*$/.test(contractTypeName)) {
    return null;
  }

  const isQualified = normalizedContract.includes('.');
  if (isQualified) {
    const qualifiedOperations = operationsByContract.get(normalizedContract);
    if (qualifiedOperations && qualifiedOperations.length > 0) {
      return qualifiedOperations;
    }

    const leafOperations = operationsByContract.get(contractTypeName) ?? [];
    if (
      leafOperations.length > 0
      && leafOperations.every((operation) => !operation.contractQualifiedName)
    ) {
      return leafOperations;
    }
    return null;
  }

  const operations = operationsByContract.get(contractTypeName);
  return operations && operations.length > 0 ? operations : null;
}

function isStaticWcfConfigLiteral(value: string | null | undefined): value is string {
  const trimmed = value?.trim();
  return Boolean(trimmed) && !/[*${}]/.test(trimmed!);
}

function isStaticWcfConfigOptionalAddress(value: string | null | undefined): boolean {
  return value == null || !/[*${}]/.test(value.trim());
}

function wcfConfigEndpointRouteForAddress(value: string | null | undefined): string | null {
  const address = value?.trim();
  if (!address || /[*${}]/.test(address) || address.includes('..')) return null;

  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(address)) {
    try {
      const parsed = new URL(address);
      return parsed.pathname && parsed.pathname !== '/' ? normalizeRoutePath(parsed.pathname) : null;
    } catch {
      return null;
    }
  }

  return normalizeRoutePath(address);
}

function csharpTypeDeclarationForLine(line: string): CSharpTypeDeclaration | null {
  const match = /^(?:(?:public|private|protected|internal)\s+)?(?:(?:sealed|abstract|partial|static)\s+)*(class|interface)\s+([A-Za-z_][\w]*)(?:\s*:\s*([^{]+))?/.exec(line);
  if (!match?.[1] || !match[2]) return null;
  return {
    kind: match[1] as CSharpTypeDeclaration['kind'],
    name: match[2],
    implementedTypes: csharpImplementedTypeNames(match[3] ?? ''),
  };
}

function csharpImplementedTypeNames(value: string): string[] {
  return uniqueInOrder(value.split(/\bwhere\b/i)[0]!
    .split(',')
    .map((item) => item.trim().replace(/<[^>]*>/g, ''))
    .map((item) => item.split('.').filter(Boolean).at(-1)?.trim() ?? '')
    .filter(Boolean));
}

function csharpMethodNameForLine(line: string): string | null {
  const match = /^(?:(?:public|private|protected|internal)\s+)?(?:(?:static|virtual|override|abstract|async|sealed|new|partial)\s+)*(?:[\w<>,\s\[\].?]+\s+)+([A-Za-z_][\w]*)\s*\(/.exec(line);
  return match?.[1] ?? null;
}

function csharpContractRouteName(typeName: string, kind: 'class' | 'interface'): string {
  if (kind === 'interface' && /^I[A-Z]/.test(typeName)) return typeName.slice(1);
  return typeName;
}

function asmxWebServiceRouteMatchesForContent(
  content: string,
  path: string,
): Array<{
  method: string;
  route: string;
  handler: string;
  lineNo: number;
  sourceRefs: string[];
}> {
  const matches: Array<{
    method: string;
    route: string;
    handler: string;
    lineNo: number;
    sourceRefs: string[];
  }> = [];
  const lines = content.split('\n');
  let pendingService: { serviceName: string | null; lineNos: number[] } | null = null;
  const pendingMethods: Array<{ operationName: string | null; lineNo: number }> = [];
  let classScope: {
    className: string;
    serviceName: string;
    lineNos: number[];
    braceDepth: number;
    opened: boolean;
  } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const lineNo = index + 1;
    const service = asmxWebServiceForLine(line);
    if (service) {
      pendingService = { serviceName: service.serviceName, lineNos: [lineNo] };
      classScope = updateTypeScriptClassScope(line, classScope);
      continue;
    }

    const webMethod = classScope ? asmxWebMethodForLine(line) : null;
    if (webMethod) {
      pendingMethods.push({ operationName: webMethod.operationName, lineNo });
      classScope = updateTypeScriptClassScope(line, classScope);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      classScope = updateTypeScriptClassScope(line, classScope);
      continue;
    }
    if (trimmed.startsWith('[')) {
      classScope = updateTypeScriptClassScope(line, classScope);
      continue;
    }

    const typeDeclaration = csharpTypeDeclarationForLine(trimmed);
    if (typeDeclaration?.kind === 'class') {
      if (pendingService) {
        classScope = {
          className: typeDeclaration.name,
          serviceName: pendingService.serviceName ?? typeDeclaration.name,
          lineNos: pendingService.lineNos,
          braceDepth: 0,
          opened: false,
        };
      }
      pendingService = null;
      pendingMethods.length = 0;
    }

    const methodName = classScope ? csharpMethodNameForLine(trimmed) : null;
    if (methodName && pendingMethods.length > 0 && classScope) {
      for (const method of pendingMethods) {
        const operationName = method.operationName ?? methodName;
        matches.push({
          method: 'ANY',
          route: asmxOperationRoute(classScope.serviceName, operationName),
          handler: `${classScope.className}#${methodName}`,
          lineNo: method.lineNo,
          sourceRefs: uniqueSorted([
            ...classScope.lineNos.map((lineNumber) => fileRef(path, lineNumber)),
            fileRef(path, method.lineNo),
            fileRef(path, lineNo),
          ]),
        });
      }
      pendingMethods.length = 0;
    } else if (!methodName) {
      pendingMethods.length = 0;
    }

    classScope = updateTypeScriptClassScope(line, classScope);
  }

  return matches;
}

function asmxWebServiceForLine(line: string): { serviceName: string | null } | null {
  const match = /\[(?:[A-Za-z_][\w]*\.)*WebService\b(?:\s*\(([\s\S]*?)\))?\]/.exec(line);
  if (!match) return null;
  const args = match[1] ?? '';
  return {
    serviceName: staticAnnotationStringAttribute(args, 'Name')
      ?? staticAnnotationStringAttribute(args, 'name'),
  };
}

function asmxWebMethodForLine(line: string): { operationName: string | null } | null {
  const match = /\[(?:[A-Za-z_][\w]*\.)*WebMethod\b(?:\s*\(([\s\S]*?)\))?\]/.exec(line);
  if (!match) return null;
  const args = match[1] ?? '';
  return {
    operationName: staticAnnotationStringAttribute(args, 'MessageName')
      ?? staticAnnotationStringAttribute(args, 'messageName')
      ?? staticAnnotationStringAttribute(args, 'Name')
      ?? staticAnnotationStringAttribute(args, 'name'),
  };
}

function asmxOperationRoute(serviceName: string, operationName: string): string {
  return normalizeRoutePath([
    'asmx',
    javaIdentifierRouteSegment(serviceName),
    javaIdentifierRouteSegment(operationName),
  ].join('/'));
}

function javaIdentifierRouteSegment(value: string): string {
  return camelToSnake(value)
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
    || 'unknown';
}

function servletRouteMatchesForContent(
  content: string,
): Array<{ method: string; route: string; handler: string; lineNo: number; prefixLineNos: number[] }> {
  const matches: Array<{ method: string; route: string; handler: string; lineNo: number; prefixLineNos: number[] }> = [];
  const lines = content.split('\n');
  let pendingServlet: { routes: string[]; lineNos: number[] } | null = null;
  let classScope: { routes: string[]; lineNos: number[]; braceDepth: number; opened: boolean } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const lineNo = index + 1;
    const servletRoutes = servletRoutesForLine(line);
    if (servletRoutes.length > 0) {
      pendingServlet = { routes: servletRoutes, lineNos: [lineNo] };
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      classScope = updateTypeScriptClassScope(line, classScope);
      continue;
    }
    if (trimmed.startsWith('@')) {
      classScope = updateTypeScriptClassScope(line, classScope);
      continue;
    }

    if (javaClassNameForLine(trimmed)) {
      if (pendingServlet) {
        classScope = {
          routes: pendingServlet.routes,
          lineNos: pendingServlet.lineNos,
          braceDepth: 0,
          opened: false,
        };
      }
      pendingServlet = null;
    }

    const methodName = classScope ? javaMethodNameForLine(trimmed) : null;
    const method = methodFromServletHandler(methodName);
    if (method && classScope) {
      for (const route of classScope.routes) {
        matches.push({
          method,
          route,
          handler: methodName!,
          lineNo,
          prefixLineNos: classScope.lineNos,
        });
      }
    }

    classScope = updateTypeScriptClassScope(line, classScope);
  }

  return matches;
}

function servletRoutesForLine(line: string): string[] {
  const match = /@WebServlet\s*\(([\s\S]*)\)/.exec(line);
  if (!match?.[1]) return [];
  const args = match[1];
  const routes: string[] = [];
  const direct = staticStringLiteralArg(args);
  if (direct !== null) routes.push(direct);

  const named = /\b(?:value|urlPatterns)\s*=\s*(\{[^}]*\}|(['"`])[^'"`]*\2)/.exec(args);
  const namedValue = named?.[1];
  if (namedValue) {
    if (namedValue.trim().startsWith('{')) {
      for (const item of splitTopLevelCommaArgs(namedValue.trim().slice(1, -1))) {
        const route = staticStringLiteralArg(item);
        if (route !== null) routes.push(route);
      }
    } else {
      const route = staticStringLiteralArg(namedValue);
      if (route !== null) routes.push(route);
    }
  }

  return uniqueInOrder(routes.map(normalizeRoutePath));
}

function webXmlServletRouteMatchesForContent(
  content: string,
  path: string,
  files: readonly ScannedInventoryFile[],
): Array<{ method: string; route: string; handler: string; lineNo: number; sourceRefs: string[] }> {
  const definitions = webXmlServletDefinitionsForContent(content);
  const mappings = webXmlServletMappingsForContent(content);
  const matches: Array<{ method: string; route: string; handler: string; lineNo: number; sourceRefs: string[] }> = [];

  for (const mapping of mappings) {
    const definition = definitions.get(mapping.name);
    if (!definition) continue;
    const className = definition.className.split('.').filter(Boolean).at(-1);
    if (!className || !/^[A-Za-z_$][\w$]*$/.test(className)) continue;

    const classFile = javaFileForFullyQualifiedClass(definition.className, files);
    const handlers = classFile ? servletHandlersForClassFile(classFile) : [];
    const sourceRefs = lineSourceRefs(path, uniqueInOrder([definition.lineNo, mapping.lineNo]));

    if (handlers.length === 0) {
      matches.push({
        method: 'ANY',
        route: mapping.route,
        handler: className,
        lineNo: mapping.lineNo,
        sourceRefs,
      });
      continue;
    }

    for (const handler of handlers) {
      matches.push({
        method: handler.method,
        route: mapping.route,
        handler: `${className}#${handler.name}`,
        lineNo: mapping.lineNo,
        sourceRefs: uniqueInOrder([...sourceRefs, ...handler.sourceRefs]),
      });
    }
  }

  return matches;
}

function webXmlServletDefinitionsForContent(content: string): Map<string, { className: string; lineNo: number }> {
  const definitions = new Map<string, { className: string; lineNo: number }>();
  const servletBlock = /<servlet\b[^>]*>([\s\S]*?)<\/servlet>/gi;
  for (const match of content.matchAll(servletBlock)) {
    const body = match[1] ?? '';
    const offset = (match.index ?? 0) + match[0].indexOf(body);
    const name = xmlTagText(body, 'servlet-name');
    const className = xmlTagText(body, 'servlet-class');
    if (!name || !className || /[*${}]/.test(name) || /[*${}]/.test(className)) continue;
    definitions.set(name, {
      className,
      lineNo: xmlTagLineNo(body, 'servlet-class', content, offset) ?? lineNumberAtOffset(content, match.index ?? 0),
    });
  }
  return definitions;
}

function webXmlServletMappingsForContent(content: string): Array<{ name: string; route: string; lineNo: number }> {
  const mappings: Array<{ name: string; route: string; lineNo: number }> = [];
  const mappingBlock = /<servlet-mapping\b[^>]*>([\s\S]*?)<\/servlet-mapping>/gi;
  for (const match of content.matchAll(mappingBlock)) {
    const body = match[1] ?? '';
    const offset = (match.index ?? 0) + match[0].indexOf(body);
    const name = xmlTagText(body, 'servlet-name');
    if (!name || /[*${}]/.test(name)) continue;

    for (const pattern of xmlTagTexts(body, 'url-pattern')) {
      if (!pattern || /[*${}]/.test(pattern)) continue;
      mappings.push({
        name,
        route: normalizeRoutePath(pattern),
        lineNo: xmlTagLineNo(body, 'url-pattern', content, offset) ?? lineNumberAtOffset(content, match.index ?? 0),
      });
    }
  }
  return mappings;
}

function servletHandlersForClassFile(file: ScannedInventoryFile): Array<{ name: string; method: string; sourceRefs: string[] }> {
  const handlers: Array<{ name: string; method: string; sourceRefs: string[] }> = [];
  const lines = file.content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const methodName = javaMethodNameForLine(lines[index]!.trim());
    const method = methodFromServletHandler(methodName);
    if (!method || !methodName) continue;
    handlers.push({
      name: methodName,
      method,
      sourceRefs: [fileRef(file.path, index + 1)],
    });
  }
  return handlers;
}

function javaFileForFullyQualifiedClass(
  className: string,
  files: readonly ScannedInventoryFile[],
): ScannedInventoryFile | null {
  const classPath = `${className.replace(/\./g, '/')}.java`;
  const shortName = className.split('.').filter(Boolean).at(-1);
  return files.find((file) => file.path.endsWith(classPath))
    ?? files.find((file) => shortName && basename(file.path) === `${shortName}.java`)
    ?? null;
}

function strutsRouteMatchesForContent(
  content: string,
): Array<{ method: string; route: string; handler: string; lineNo: number; sourceLineNos: number[] }> {
  const matches: Array<{ method: string; route: string; handler: string; lineNo: number; sourceLineNos: number[] }> = [];
  const handledOffsets = new Set<number>();
  const packageBlock = /<package\b([^>]*)>([\s\S]*?)<\/package>/gi;

  for (const packageMatch of content.matchAll(packageBlock)) {
    const packageAttrs = packageMatch[1] ?? '';
    const packageBody = packageMatch[2] ?? '';
    const packageOffset = packageMatch.index ?? 0;
    const bodyOffset = packageOffset + packageMatch[0].indexOf(packageBody);
    const namespace = normalizeRoutePath(xmlAttributeValue(packageAttrs, 'namespace') ?? '/');
    const packageLineNo = lineNumberAtOffset(content, packageOffset);

    for (const action of strutsActionElementsForContent(packageBody, bodyOffset, content)) {
      handledOffsets.add(action.offset);
      const route = strutsActionRoute(action.attrs, namespace);
      const handler = strutsActionHandler(action.attrs);
      if (!route || !handler) continue;
      matches.push({
        method: 'ANY',
        route,
        handler,
        lineNo: action.lineNo,
        sourceLineNos: uniqueInOrder([packageLineNo, action.lineNo]),
      });
    }
  }

  for (const action of strutsActionElementsForContent(content, 0, content)) {
    if (handledOffsets.has(action.offset)) continue;
    const route = strutsActionRoute(action.attrs, '/');
    const handler = strutsActionHandler(action.attrs);
    if (!route || !handler) continue;
    matches.push({
      method: 'ANY',
      route,
      handler,
      lineNo: action.lineNo,
      sourceLineNos: [action.lineNo],
    });
  }

  return matches;
}

function strutsActionElementsForContent(
  content: string,
  offsetBase: number,
  fullContent: string,
): Array<{ attrs: string; offset: number; lineNo: number }> {
  const actions: Array<{ attrs: string; offset: number; lineNo: number }> = [];
  const actionTag = /<action\b([^>]*)\/?>/gi;
  for (const match of content.matchAll(actionTag)) {
    const offset = offsetBase + (match.index ?? 0);
    actions.push({
      attrs: match[1] ?? '',
      offset,
      lineNo: lineNumberAtOffset(fullContent, offset),
    });
  }
  return actions;
}

function strutsActionRoute(attrs: string, namespace: string): string | null {
  const explicitPath = xmlAttributeValue(attrs, 'path');
  if (explicitPath) return normalizeRoutePath(explicitPath);

  const name = xmlAttributeValue(attrs, 'name');
  if (!name || /[*${}]/.test(name)) return null;
  return combineExpressRoutes(namespace, name);
}

function strutsActionHandler(attrs: string): string | null {
  const className = xmlAttributeValue(attrs, 'class') ?? xmlAttributeValue(attrs, 'type');
  if (!className || /[*${}]/.test(className)) return null;
  const shortClassName = className.split('.').filter(Boolean).at(-1);
  if (!shortClassName || !/^[A-Za-z_$][\w$]*Action$/.test(shortClassName)) return null;

  const method = xmlAttributeValue(attrs, 'method') ?? 'execute';
  if (!/^[A-Za-z_$][\w$]*$/.test(method)) return null;
  return `${shortClassName}#${method}`;
}

interface SpringXmlBeanDefinition {
  id: string;
  className: string;
  lineNo: number;
  isUrlName: boolean;
}

interface SpringXmlBeanPropertyRef {
  beanClassName: string;
  beanLineNo: number;
  variableName: string;
  refId: string;
  lineNo: number;
}

interface SpringMvcXmlRouteMatch {
  method: string;
  route: string;
  handler: string;
  lineNo: number;
  sourceLineNos: number[];
}

function springXmlConfiguredReceiversByPath(
  files: readonly ScannedInventoryFile[],
  symbols: readonly InventorySymbol[],
): Map<string, InventoryConstructedReceiver[]> {
  const receiversByPath = new Map<string, InventoryConstructedReceiver[]>();
  const javaSymbols = symbols.filter((symbol) => symbol.path.endsWith('.java'));
  if (javaSymbols.length === 0) return receiversByPath;

  const javaPaths = new Set(javaSymbols.map((symbol) => symbol.path));

  for (const file of files) {
    if (!isSpringMvcXmlConfigPath(file.path)) continue;
    const beanDefinitionsById = springXmlBeanDefinitionsById(springXmlBeanDefinitionsForContent(file.content));
    for (const propertyRef of springXmlBeanPropertyRefsForContent(file.content)) {
      const targetBean = uniqueSpringXmlBeanDefinitionForId(beanDefinitionsById, propertyRef.refId);
      if (!targetBean) continue;

      const ownerSymbol = springXmlClassSymbolForBeanClassName(propertyRef.beanClassName, javaSymbols, javaPaths);
      const targetSymbol = springXmlClassSymbolForBeanClassName(targetBean.className, javaSymbols, javaPaths);
      if (!ownerSymbol || !targetSymbol) continue;

      const receiver: InventoryConstructedReceiver = {
        path: ownerSymbol.path,
        ownerName: ownerSymbol.name,
        variableName: propertyRef.variableName,
        targetName: targetSymbol.name,
        targetPath: targetSymbol.path,
        sourceRefs: uniqueSorted([
          fileRef(file.path, propertyRef.beanLineNo),
          fileRef(file.path, propertyRef.lineNo),
          fileRef(file.path, targetBean.lineNo),
          ...targetSymbol.sourceRefs,
        ]),
      };
      receiversByPath.set(ownerSymbol.path, [...(receiversByPath.get(ownerSymbol.path) ?? []), receiver]);
    }
  }

  for (const [path, receivers] of receiversByPath.entries()) {
    receiversByPath.set(path, dedupeConstructedReceivers(receivers));
  }

  return receiversByPath;
}

function springXmlBeanDefinitionsById(
  beans: readonly SpringXmlBeanDefinition[],
): Map<string, SpringXmlBeanDefinition[]> {
  const byId = new Map<string, SpringXmlBeanDefinition[]>();
  for (const bean of beans) {
    byId.set(bean.id, [...(byId.get(bean.id) ?? []), bean]);
  }
  return byId;
}

function uniqueSpringXmlBeanDefinitionForId(
  beansById: ReadonlyMap<string, readonly SpringXmlBeanDefinition[]>,
  id: string,
): SpringXmlBeanDefinition | null {
  const beans = beansById.get(id) ?? [];
  return beans.length === 1 ? beans[0]! : null;
}

function springXmlClassSymbolForBeanClassName(
  className: string,
  javaSymbols: readonly InventorySymbol[],
  javaPaths: ReadonlySet<string>,
): InventorySymbol | null {
  const shortClassName = javaClassBaseName(className);
  if (!shortClassName || !/^[A-Za-z_$][\w$]*$/.test(shortClassName)) return null;

  const targetPath = className.includes('.') ? javaTypeTargetPath(className, javaPaths) : null;
  const candidates = javaSymbols
    .filter((symbol) => (
      symbol.kind === 'class'
      && symbol.name === shortClassName
      && (!targetPath || symbol.path === targetPath)
    ))
    .sort(compareImportedHandlerSymbols);
  return candidates.length === 1 ? candidates[0]! : null;
}

function springMvcXmlRouteMatchesForContent(content: string): SpringMvcXmlRouteMatch[] {
  const beans = springXmlBeanDefinitionsForContent(content);
  const beanById = new Map(beans.map((bean) => [bean.id, bean]));
  const matches: SpringMvcXmlRouteMatch[] = [];

  for (const block of springSimpleUrlHandlerMappingBlocks(content)) {
    for (const mapping of springUrlMappingsForBlock(block.body, content, block.bodyOffset)) {
      const bean = beanById.get(mapping.beanId);
      if (!bean) continue;
      const shortClassName = javaClassBaseName(bean.className);
      if (!shortClassName || !/^[A-Za-z_$][\w$]*$/.test(shortClassName)) continue;
      matches.push({
        method: 'ANY',
        route: mapping.route,
        handler: `${shortClassName}#handleRequest`,
        lineNo: mapping.lineNo,
        sourceLineNos: uniqueInOrder([block.lineNo, mapping.lineNo, bean.lineNo]),
      });
    }
  }

  for (const bean of beans) {
    if (!bean.isUrlName) continue;
    const shortClassName = javaClassBaseName(bean.className);
    if (!shortClassName || !/^[A-Za-z_$][\w$]*$/.test(shortClassName)) continue;
    matches.push({
      method: 'ANY',
      route: normalizeRoutePath(bean.id),
      handler: `${shortClassName}#handleRequest`,
      lineNo: bean.lineNo,
      sourceLineNos: [bean.lineNo],
    });
  }

  return uniqueSpringMvcXmlRouteMatches(matches);
}

function springXmlBeanDefinitionsForContent(content: string): SpringXmlBeanDefinition[] {
  const beans: SpringXmlBeanDefinition[] = [];
  const beanTag = /<bean\b([^>]*)>/gi;
  for (const match of content.matchAll(beanTag)) {
    const attrs = match[1] ?? '';
    const className = xmlAttributeValue(attrs, 'class');
    if (!className || /[*${}]/.test(className)) continue;
    const ids = uniqueInOrder([
      xmlAttributeValue(attrs, 'id') ?? '',
      ...((xmlAttributeValue(attrs, 'name') ?? '').split(/[,\s]+/)),
    ].filter(Boolean));
    for (const id of ids) {
      const isUrlName = isStaticSpringRoute(id);
      if (!isUrlName && (!/^[A-Za-z_$][\w$.-]*$/.test(id) || /[*${}]/.test(id))) continue;
      beans.push({
        id,
        className,
        lineNo: lineNumberAtOffset(content, match.index ?? 0),
        isUrlName,
      });
    }
  }
  return beans;
}

function springXmlBeanPropertyRefsForContent(content: string): SpringXmlBeanPropertyRef[] {
  const refs: SpringXmlBeanPropertyRef[] = [];
  const beanBlock = /<bean\b([^>]*)>([\s\S]*?)<\/bean>/gi;
  for (const beanMatch of content.matchAll(beanBlock)) {
    const beanAttrs = beanMatch[1] ?? '';
    const beanClassName = xmlAttributeValue(beanAttrs, 'class');
    if (!beanClassName || /[*${}]/.test(beanClassName)) continue;

    const body = beanMatch[2] ?? '';
    const beanOffset = beanMatch.index ?? 0;
    const bodyOffset = beanOffset + beanMatch[0].indexOf(body);
    const beanLineNo = lineNumberAtOffset(content, beanOffset);

    const addConfiguredRef = (attrs: string, bodyContent: string | null, offset: number): void => {
      const variableName = xmlAttributeValue(attrs, 'name');
      if (!variableName || !/^[A-Za-z_$][\w$]*$/.test(variableName)) return;

      const refId = xmlAttributeValue(attrs, 'ref')
        ?? xmlAttributeValue(attrs, 'value-ref')
        ?? springXmlNestedRefId(bodyContent);
      if (!refId || !/^[A-Za-z_$][\w$.-]*$/.test(refId) || /[*${}]/.test(refId)) return;

      refs.push({
        beanClassName,
        beanLineNo,
        variableName,
        refId,
        lineNo: lineNumberAtOffset(content, bodyOffset + offset),
      });
    };

    const selfClosingProperty = /<property\b([^>]*?)\/>/gi;
    for (const propertyMatch of body.matchAll(selfClosingProperty)) {
      addConfiguredRef(propertyMatch[1] ?? '', null, propertyMatch.index ?? 0);
    }

    const propertyBlock = /<property\b([^>]*)>([\s\S]*?)<\/property>/gi;
    for (const propertyMatch of body.matchAll(propertyBlock)) {
      addConfiguredRef(propertyMatch[1] ?? '', propertyMatch[2] ?? '', propertyMatch.index ?? 0);
    }

    const selfClosingConstructorArg = /<constructor-arg\b([^>]*?)\/>/gi;
    for (const argMatch of body.matchAll(selfClosingConstructorArg)) {
      addConfiguredRef(argMatch[1] ?? '', null, argMatch.index ?? 0);
    }

    const constructorArgBlock = /<constructor-arg\b([^>]*)>([\s\S]*?)<\/constructor-arg>/gi;
    for (const argMatch of body.matchAll(constructorArgBlock)) {
      addConfiguredRef(argMatch[1] ?? '', argMatch[2] ?? '', argMatch.index ?? 0);
    }
  }
  return refs;
}

function springXmlNestedRefId(bodyContent: string | null): string | null {
  if (!bodyContent) return null;
  const refMatch = /<ref\b([^>]*?)\/?>/i.exec(bodyContent);
  if (!refMatch) return null;
  const attrs = refMatch[1] ?? '';
  return xmlAttributeValue(attrs, 'bean')
    ?? xmlAttributeValue(attrs, 'local')
    ?? xmlAttributeValue(attrs, 'parent');
}

function uniqueSpringMvcXmlRouteMatches(matches: SpringMvcXmlRouteMatch[]): SpringMvcXmlRouteMatch[] {
  const seen = new Set<string>();
  return matches.filter((match) => {
    const key = `${match.method}\0${match.route}\0${match.handler}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function springSimpleUrlHandlerMappingBlocks(
  content: string,
): Array<{ body: string; bodyOffset: number; lineNo: number }> {
  const blocks: Array<{ body: string; bodyOffset: number; lineNo: number }> = [];
  const beanBlock = /<bean\b([^>]*)>([\s\S]*?)<\/bean>/gi;
  for (const match of content.matchAll(beanBlock)) {
    const attrs = match[1] ?? '';
    const body = match[2] ?? '';
    const className = xmlAttributeValue(attrs, 'class') ?? '';
    if (!/SimpleUrlHandlerMapping\b/.test(className)) continue;
    blocks.push({
      body,
      bodyOffset: (match.index ?? 0) + match[0].indexOf(body),
      lineNo: lineNumberAtOffset(content, match.index ?? 0),
    });
  }
  return blocks;
}

function springUrlMappingsForBlock(
  blockContent: string,
  fullContent: string,
  offsetBase: number,
): Array<{ route: string; beanId: string; lineNo: number }> {
  const mappings: Array<{ route: string; beanId: string; lineNo: number }> = [];
  const propMapping = /<prop\b([^>]*)>([\s\S]*?)<\/prop>/gi;
  for (const match of blockContent.matchAll(propMapping)) {
    const attrs = match[1] ?? '';
    const route = xmlAttributeValue(attrs, 'key');
    const beanId = match[2]?.trim();
    if (!isStaticSpringRoute(route) || !beanId || /[*${}]/.test(beanId)) continue;
    mappings.push({
      route: normalizeRoutePath(route!),
      beanId,
      lineNo: lineNumberAtOffset(fullContent, offsetBase + (match.index ?? 0)),
    });
  }

  const entryMapping = /<entry\b([^>]*?)\/?>/gi;
  for (const match of blockContent.matchAll(entryMapping)) {
    const attrs = match[1] ?? '';
    const route = xmlAttributeValue(attrs, 'key');
    const beanId = xmlAttributeValue(attrs, 'value-ref') ?? xmlAttributeValue(attrs, 'value');
    if (!isStaticSpringRoute(route) || !beanId || /[*${}]/.test(beanId)) continue;
    mappings.push({
      route: normalizeRoutePath(route!),
      beanId,
      lineNo: lineNumberAtOffset(fullContent, offsetBase + (match.index ?? 0)),
    });
  }
  return mappings;
}

function isStaticSpringRoute(route: string | null): route is string {
  if (!route) return false;
  return route.startsWith('/')
    && !/[*${}]/.test(route)
    && !route.includes('..');
}

interface AspNetWebFormsPageRouteMatch {
  method: string;
  route: string;
  handler: string;
  lineNo: number;
  sourceLineNos: number[];
}

function aspNetWebFormsRouteMatchesForFile(file: ScannedInventoryFile): AspNetWebFormsPageRouteMatch[] {
  const matches: AspNetWebFormsPageRouteMatch[] = [];
  const pageDirective = /<%@\s*Page\b([\s\S]*?)%>/gi;
  for (const match of file.content.matchAll(pageDirective)) {
    const attrs = match[1] ?? '';
    const inherits = xmlAttributeValue(attrs, 'Inherits');
    const className = javaClassBaseName(inherits ?? undefined);
    if (!className || /[*${}]/.test(className) || !/^[A-Za-z_$][\w$]*$/.test(className)) continue;
    const lineNo = lineNumberAtOffset(file.content, match.index ?? 0);
    matches.push({
      method: 'ANY',
      route: aspNetWebFormsRouteForPath(file.path),
      handler: `${className}#Page_Load`,
      lineNo,
      sourceLineNos: [lineNo],
    });
  }
  return matches;
}

function aspNetWebFormsRouteForPath(path: string): string {
  return webRootRelativeRouteForPath(path);
}

interface WcfServiceHostRouteMatch {
  method: string;
  route: string;
  handler: string;
  lineNo: number;
  sourceLineNos: number[];
}

function wcfServiceHostRouteMatchesForFile(file: ScannedInventoryFile): WcfServiceHostRouteMatch[] {
  const matches: WcfServiceHostRouteMatch[] = [];
  const serviceHostDirective = /<%@\s*ServiceHost\b([\s\S]*?)%>/gi;
  for (const match of file.content.matchAll(serviceHostDirective)) {
    const attrs = match[1] ?? '';
    const service = xmlAttributeValue(attrs, 'Service');
    const className = dotNetTypeBaseName(service ?? undefined);
    if (!className || /[*${}]/.test(className) || !/^[A-Za-z_$][\w$]*$/.test(className)) continue;
    const lineNo = lineNumberAtOffset(file.content, match.index ?? 0);
    matches.push({
      method: 'ANY',
      route: wcfServiceHostRouteForPath(file.path),
      handler: `WCF:${className}`,
      lineNo,
      sourceLineNos: [lineNo],
    });
  }
  return matches;
}

function wcfServiceHostRouteForPath(path: string): string {
  return webRootRelativeRouteForPath(path);
}

interface JspPageRouteMatch {
  method: string;
  route: string;
  handler: string;
  lineNo: number;
  sourceLineNos: number[];
}

function jspPageRouteMatchesForFile(file: ScannedInventoryFile): JspPageRouteMatch[] {
  return [{
    method: 'ANY',
    route: webRootRelativeRouteForPath(file.path),
    handler: file.path,
    lineNo: 1,
    sourceLineNos: [1],
  }];
}

interface ClassicAspPageRouteMatch {
  method: string;
  route: string;
  handler: string;
  lineNo: number;
  sourceLineNos: number[];
}

function classicAspPageRouteMatchesForFile(file: ScannedInventoryFile): ClassicAspPageRouteMatch[] {
  return [{
    method: 'ANY',
    route: webRootRelativeRouteForPath(file.path),
    handler: file.path,
    lineNo: 1,
    sourceLineNos: [1],
  }];
}

interface ColdFusionPageRouteMatch {
  method: string;
  route: string;
  handler: string;
  lineNo: number;
  sourceLineNos: number[];
}

function coldFusionPageRouteMatchesForFile(file: ScannedInventoryFile): ColdFusionPageRouteMatch[] {
  return [{
    method: 'ANY',
    route: webRootRelativeRouteForPath(file.path),
    handler: file.path,
    lineNo: 1,
    sourceLineNos: [1],
  }];
}

function webRootRelativeRouteForPath(path: string): string {
  const parts = path.split('/');
  const lowerParts = parts.map((part) => part.toLowerCase());
  const webRootIndex = lowerParts.findIndex((part, index) => (
    part === 'web'
    || part === 'webroot'
    || part === 'wwwroot'
    || (part === 'webapp' && lowerParts[index - 1] === 'main')
  ));
  const routeParts = webRootIndex >= 0 ? parts.slice(webRootIndex + 1) : parts;
  return normalizeRoutePath(routeParts.join('/'));
}

function javaClassBaseName(value: string | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  return normalized.split('.').filter(Boolean).at(-1) ?? null;
}

function dotNetTypeBaseName(value: string | undefined): string | null {
  const typeName = value?.split(',').at(0)?.trim();
  return javaClassBaseName(typeName);
}

function xmlAttributeValue(attrs: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(['"])([^'"]*)\\1`, 'i').exec(attrs);
  return match?.[2] ?? null;
}

function xmlTagText(content: string, tagName: string): string | null {
  return xmlTagTexts(content, tagName).at(0) ?? null;
}

function xmlTagTexts(content: string, tagName: string): string[] {
  const values: string[] = [];
  const tag = escapeRegExp(tagName);
  const regex = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  for (const match of content.matchAll(regex)) {
    const value = match[1]?.trim();
    if (value) values.push(value);
  }
  return values;
}

function xmlTagLineNo(
  content: string,
  tagName: string,
  fullContent: string,
  offsetBase: number,
): number | null {
  const regex = new RegExp(`<${escapeRegExp(tagName)}\\b`, 'i');
  const match = regex.exec(content);
  return match ? lineNumberAtOffset(fullContent, offsetBase + match.index) : null;
}

function methodFromServletHandler(methodName: string | null): string | null {
  const match = /^do(Get|Post|Put|Delete|Head|Options|Trace|Patch)$/.exec(methodName ?? '');
  return match?.[1]?.toUpperCase() ?? null;
}

function javaClassNameForLine(line: string): string | null {
  const match = /^(?:public\s+)?(?:final\s+)?class\s+([A-Za-z_$][\w$]*)\b/.exec(line);
  return match?.[1] ?? null;
}

function javaMethodNameForLine(line: string): string | null {
  const match = /^(?:(?:public|private|protected)\s+)?(?:static\s+)?(?:final\s+)?(?:[\w$<>\[\].?,]+\s+)+([A-Za-z_$][\w$]*)\s*\(/.exec(line);
  return match?.[1] ?? null;
}

function flaskAddUrlRuleRouteMatchesForContent(
  content: string,
  path: string,
): Array<{ method: string; route: string; handler: string; lineNo: number; prefixLineNos?: number[]; sourceRefs: string[] }> {
  const matches: Array<{ method: string; route: string; handler: string; lineNo: number; prefixLineNos?: number[]; sourceRefs: string[] }> = [];
  const callPattern = /\b([A-Za-z_][\w]*)\s*\.\s*add_url_rule\s*\(/g;
  for (const match of content.matchAll(callPattern)) {
    const receiver = match[1];
    if (!receiver || !pythonRouteDecoratorReceiver(receiver)) continue;
    const openParenOffset = (match.index ?? 0) + match[0].lastIndexOf('(');
    const closeParenOffset = matchingParenOffset(content, openParenOffset);
    if (closeParenOffset === -1) continue;

    const args = splitTopLevelCommaArgs(content.slice(openParenOffset + 1, closeParenOffset));
    const route = flaskAddUrlRuleRouteArg(args);
    const viewClassName = flaskAddUrlRuleMethodViewClass(args);
    const functionViewHandler = flaskAddUrlRuleFunctionViewHandler(args);
    if (!route || (!viewClassName && !functionViewHandler)) continue;

    const lineNo = lineNumberAtOffset(content, match.index ?? 0);
    const sourceRefs = [fileRef(path, lineNo)];
    for (const method of flaskAddUrlRuleMethods(args)) {
      matches.push({
        method,
        route: normalizeRoutePath(route),
        handler: viewClassName ? `${viewClassName}.${method.toLowerCase()}` : functionViewHandler ?? '',
        lineNo,
        sourceRefs,
      });
    }
  }
  return matches;
}

function flaskAddUrlRuleRouteArg(args: readonly string[]): string | null {
  const namedRule = pythonNamedArgValue(args, 'rule');
  const routeArg = namedRule ?? args.find((arg) => staticStringLiteralArg(arg) !== null);
  return staticStringLiteralArg(routeArg ?? undefined);
}

function flaskAddUrlRuleMethodViewClass(args: readonly string[]): string | null {
  const viewFunc = pythonNamedArgValue(args, 'view_func');
  const match = /^\s*([A-Za-z_][\w]*)\s*\.\s*as_view\s*\(/.exec(viewFunc ?? '');
  return match?.[1] ?? null;
}

function flaskAddUrlRuleFunctionViewHandler(args: readonly string[]): string | null {
  const viewFunc = pythonNamedArgValue(args, 'view_func') ?? args[2];
  const match = /^\s*([A-Za-z_][\w]*)\s*$/.exec(viewFunc ?? '');
  return match?.[1] ?? null;
}

function flaskAddUrlRuleMethods(args: readonly string[]): string[] {
  const methodsArg = pythonNamedArgValue(args, 'methods');
  const methods = methodsFromList(methodsArg ?? undefined)
    .filter((method) => FLASK_ADD_URL_RULE_HTTP_METHODS.has(method));
  return uniqueInOrder(methods.length > 0 ? methods : ['GET']);
}

const FLASK_ADD_URL_RULE_HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);

function pythonNamedArgValue(args: readonly string[], name: string): string | null {
  for (const arg of args) {
    const match = /^\s*([A-Za-z_][\w]*)\s*=\s*([\s\S]*)$/.exec(arg);
    if (match?.[1] === name) return match[2]?.trim() ?? '';
  }
  return null;
}

function pythonRouteDecoratorsForLine(
  line: string,
  lineNo: number,
  routerPrefixes: ReadonlyMap<string, PythonRouterPrefix> = new Map(),
): Array<{ method: string; route: string; lineNo: number; prefixLineNos?: number[]; sourceRefs?: string[] }> {
  const matches: Array<{
    method: string;
    route: string;
    lineNo: number;
    prefixLineNos?: number[];
    sourceRefs?: string[];
  }> = [];
  const routeDecorator = /^\s*@([A-Za-z_][\w]*)\s*\.\s*route\s*\(([^)]*)\)/.exec(line);
  const routeReceiver = routeDecorator?.[1];
  if (routeReceiver && pythonRouteDecoratorReceiver(routeReceiver, routerPrefixes)) {
    const args = routeDecorator[2] ?? '';
    const route = routeFromDecoratorArgs(args);
    const routerPrefix = routerPrefixes.get(routeReceiver);
    const methods = methodsFromList(args);
    for (const method of methods.length ? methods : ['GET']) {
      matches.push({
        method,
        route: combinePythonRouterRoute(routerPrefix?.prefix, route),
        lineNo,
        prefixLineNos: routerPrefix?.lineNos,
        sourceRefs: routerPrefix?.sourceRefs,
      });
    }
    return matches;
  }

  const methodDecorator = /^\s*@([A-Za-z_][\w]*)\s*\.\s*(get|post|put|patch|delete|options|head)\s*\(([^)]*)\)/i.exec(line);
  const methodReceiver = methodDecorator?.[1];
  if (methodReceiver && methodDecorator[2] && pythonRouteDecoratorReceiver(methodReceiver, routerPrefixes)) {
    const routerPrefix = routerPrefixes.get(methodReceiver);
    matches.push({
      method: methodDecorator[2].toUpperCase(),
      route: combinePythonRouterRoute(routerPrefix?.prefix, routeFromDecoratorArgs(methodDecorator[3] ?? '')),
      lineNo,
      prefixLineNos: routerPrefix?.lineNos,
      sourceRefs: routerPrefix?.sourceRefs,
    });
  }
  return matches;
}

function pythonRouteDecoratorReceiver(
  receiver: string,
  routerPrefixes: ReadonlyMap<string, PythonRouterPrefix> = new Map(),
): boolean {
  if (routerPrefixes.has(receiver)) return true;
  const normalized = receiver.toLowerCase();
  return normalized === 'app'
    || normalized === 'application'
    || normalized === 'server'
    || normalized === 'api'
    || normalized === 'router'
    || normalized === 'blueprint'
    || normalized === 'bp'
    || /(?:^|_)(?:app|api|router|blueprint|bp)$/.test(normalized);
}

interface PythonRouterPrefix {
  prefix: string;
  lineNos: number[];
  sourceRefs?: string[];
}

interface PythonRouterObjectImport {
  localName: string;
  importedName: string;
  targetPath: string;
  sourceRefs: string[];
}

function pythonRouterPrefixesForContent(content: string, path?: string): Map<string, PythonRouterPrefix> {
  const prefixes = new Map<string, PythonRouterPrefix>();
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const match = /^\s*([A-Za-z_][\w]*)\s*=\s*Blueprint\s*\((.*)\)\s*$/.exec(line);
    const apiRouterMatch = /^\s*([A-Za-z_][\w]*)\s*=\s*APIRouter\s*\((.*)\)\s*$/.exec(line);
    const receiver = match?.[1] ?? apiRouterMatch?.[1];
    if (!receiver) continue;
    prefixes.set(receiver, {
      prefix: pythonStaticRoutePrefixArg(match?.[2] ?? apiRouterMatch?.[2] ?? ''),
      lineNos: [index + 1],
      sourceRefs: path ? [fileRef(path, index + 1)] : undefined,
    });
  }
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const include = /\b[A-Za-z_][\w]*\s*\.\s*include_router\s*\((.*)\)\s*$/.exec(line);
    if (!include?.[1]) continue;
    const args = splitTopLevelCommaArgs(include[1]);
    const routerName = directIdentifierArg(args[0]);
    if (!routerName) continue;
    const prefix = pythonIncludeRouterPrefixArg(args);
    if (prefix === null) continue;
    const existing = prefixes.get(routerName);
    prefixes.set(routerName, {
      prefix: combinePythonRouterRoute(prefix, existing?.prefix ?? '/'),
      lineNos: uniqueInOrder([...(existing?.lineNos ?? []), index + 1]),
      sourceRefs: path
        ? uniqueInOrder([...(existing?.sourceRefs ?? []), fileRef(path, index + 1)])
        : existing?.sourceRefs,
    });
  }
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const register = /\b[A-Za-z_][\w]*\s*\.\s*register_blueprint\s*\((.*)\)\s*$/.exec(line);
    if (!register?.[1]) continue;
    const args = splitTopLevelCommaArgs(register[1]);
    const blueprintName = directIdentifierArg(args[0]);
    if (!blueprintName) continue;
    const prefix = pythonRegisterBlueprintPrefixArg(args);
    if (prefix === null) continue;
    const existing = prefixes.get(blueprintName);
    prefixes.set(blueprintName, {
      prefix,
      lineNos: uniqueInOrder([...(existing?.lineNos ?? []), index + 1]),
      sourceRefs: path
        ? uniqueInOrder([...(existing?.sourceRefs ?? []), fileRef(path, index + 1)])
        : existing?.sourceRefs,
    });
  }
  return prefixes;
}

function mergePythonRouterPrefixMaps(
  localPrefixes: Map<string, PythonRouterPrefix>,
  externalPrefixes: ReadonlyMap<string, PythonRouterPrefix>,
): Map<string, PythonRouterPrefix> {
  const merged = new Map(localPrefixes);
  for (const [name, prefix] of externalPrefixes.entries()) {
    merged.set(name, prefix);
  }
  return merged;
}

function crossFilePythonRouterPrefixesForFiles(
  files: readonly ScannedInventoryFile[],
): Map<string, Map<string, PythonRouterPrefix>> {
  const pythonFiles = files.filter((file) => file.path.endsWith('.py'));
  const filesByPath = new Map(pythonFiles.map((file) => [file.path, file]));
  const pythonPaths = new Set(filesByPath.keys());
  const prefixesByPath = new Map<string, Map<string, PythonRouterPrefix>>();

  const addPrefix = (targetPath: string, importedName: string, prefix: PythonRouterPrefix): void => {
    const existingMap = prefixesByPath.get(targetPath) ?? new Map<string, PythonRouterPrefix>();
    const existing = existingMap.get(importedName);
    if (existing && existing.prefix !== prefix.prefix) return;
    existingMap.set(importedName, existing ? {
      prefix: existing.prefix,
      lineNos: uniqueInOrder([...existing.lineNos, ...prefix.lineNos]),
      sourceRefs: uniqueInOrder([...(existing.sourceRefs ?? []), ...(prefix.sourceRefs ?? [])]),
    } : prefix);
    prefixesByPath.set(targetPath, existingMap);
  };

  for (const file of pythonFiles) {
    const imports = pythonRouterObjectImportsForContent(file.content, file.path, pythonPaths);
    if (imports.size === 0) continue;
    const lines = file.content.split('\n');

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const lineNo = index + 1;
      const include = /\b[A-Za-z_][\w]*\s*\.\s*include_router\s*\((.*)\)\s*$/.exec(line);
      const register = /\b[A-Za-z_][\w]*\s*\.\s*register_blueprint\s*\((.*)\)\s*$/.exec(line);
      const argsText = include?.[1] ?? register?.[1];
      if (!argsText) continue;

      const args = splitTopLevelCommaArgs(argsText);
      const localName = directIdentifierArg(args[0]);
      if (!localName) continue;
      const imported = imports.get(localName);
      if (!imported) continue;

      const mountPrefix = include
        ? pythonIncludeRouterPrefixArg(args)
        : pythonRegisterBlueprintPrefixArg(args);
      if (mountPrefix === null) continue;

      const targetFile = filesByPath.get(imported.targetPath);
      if (!targetFile || targetFile.path === file.path) continue;
      const targetPrefixes = pythonRouterPrefixesForContent(targetFile.content, targetFile.path);
      const targetPrefix = targetPrefixes.get(imported.importedName);
      if (!targetPrefix) continue;

      addPrefix(targetFile.path, imported.importedName, {
        prefix: include ? combinePythonRouterRoute(mountPrefix, targetPrefix.prefix) : mountPrefix,
        lineNos: targetPrefix.lineNos,
        sourceRefs: uniqueInOrder([
          ...(targetPrefix.sourceRefs ?? lineSourceRefs(targetFile.path, targetPrefix.lineNos)),
          ...imported.sourceRefs,
          fileRef(file.path, lineNo),
        ]),
      });
    }
  }

  return prefixesByPath;
}

function pythonRouterObjectImportsForContent(
  content: string,
  path: string,
  pythonPaths: ReadonlySet<string>,
): Map<string, PythonRouterObjectImport> {
  const imports = new Map<string, PythonRouterObjectImport>();
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const match = /^\s*from\s+([.\w]+)\s+import\s+(.+?)\s*$/.exec(line);
    if (!match?.[1] || !match[2] || match[2].includes('*')) continue;
    const targetPath = pythonImportModuleTargetPath(match[1], path, pythonPaths);
    if (!targetPath || targetPath === path) continue;

    for (const item of splitTopLevelCommaArgs(match[2].replace(/^\((.*)\)$/, '$1'))) {
      const importMatch = /^\s*([A-Za-z_][\w]*)(?:\s+as\s+([A-Za-z_][\w]*))?\s*$/.exec(item);
      const importedName = importMatch?.[1];
      const localName = importMatch?.[2] ?? importedName;
      if (!importedName || !localName) continue;
      imports.set(localName, {
        localName,
        importedName,
        targetPath,
        sourceRefs: [fileRef(path, index + 1)],
      });
    }
  }
  return imports;
}

function pythonImportModuleTargetPath(
  moduleName: string,
  importingPath: string,
  pythonPaths: ReadonlySet<string>,
): string | null {
  const candidates = pythonImportModulePathCandidates(moduleName, importingPath);
  for (const candidate of candidates) {
    if (pythonPaths.has(candidate)) return candidate;
  }

  const suffixMatches = [...pythonPaths].filter((path) => (
    candidates.some((candidate) => path.endsWith(`/${candidate}`))
  ));
  return suffixMatches.length === 1 ? suffixMatches[0]! : null;
}

function pythonImportMemberModuleName(moduleName: string, importedName: string): string {
  return moduleName.endsWith('.')
    ? `${moduleName}${importedName}`
    : `${moduleName}.${importedName}`;
}

function pythonImportModulePathCandidates(moduleName: string, importingPath: string): string[] {
  const relativeMatch = /^(\.+)(.*)$/.exec(moduleName);
  let basePath = '';
  let modulePath = moduleName;
  if (relativeMatch) {
    const dots = relativeMatch[1]?.length ?? 0;
    modulePath = relativeMatch[2] ?? '';
    basePath = parentPath(importingPath);
    for (let index = 1; index < dots; index += 1) {
      basePath = parentPath(basePath);
    }
  }

  const normalizedModule = modulePath.split('.').filter(Boolean).join('/');
  const prefix = [basePath, normalizedModule].filter(Boolean).join('/');
  const packageRelativePrefix = relativeMatch || !parentPath(importingPath)
    ? null
    : [parentPath(importingPath), normalizedModule].filter(Boolean).join('/');
  return uniqueInOrder([
    `${prefix}.py`,
    `${prefix}/__init__.py`,
    ...(packageRelativePrefix
      ? [`${packageRelativePrefix}.py`, `${packageRelativePrefix}/__init__.py`]
      : []),
  ].filter((candidate) => candidate !== '.py' && candidate !== '/__init__.py'));
}

function pythonStaticRoutePrefixArg(args: string): string {
  const match = /\b(?:url_prefix|prefix)\s*=\s*(['"`])([^'"`]+)\1/.exec(args);
  return normalizeRoutePath(match?.[2] ?? '/');
}

function pythonIncludeRouterPrefixArg(args: readonly string[]): string | null {
  for (const arg of args.slice(1)) {
    const namedPrefix = /^\s*prefix\s*=\s*([\s\S]+)$/.exec(arg)?.[1];
    const prefix = staticStringLiteralArg(namedPrefix ?? arg);
    if (prefix !== null) return normalizeRoutePath(prefix);
  }
  return null;
}

function pythonRegisterBlueprintPrefixArg(args: readonly string[]): string | null {
  for (const arg of args.slice(1)) {
    const namedPrefix = /^\s*url_prefix\s*=\s*([\s\S]+)$/.exec(arg)?.[1];
    if (namedPrefix === undefined) continue;
    const prefix = staticStringLiteralArg(namedPrefix);
    if (prefix !== null) return normalizeRoutePath(prefix);
  }
  return null;
}

function combinePythonRouterRoute(prefix: string | undefined, route: string): string {
  return prefix ? combineExpressRoutes(prefix, route) : route;
}

function honoRouteMountsForContent(
  content: string,
  path: string,
  imports: readonly InventoryImport[],
): Map<string, RouteMount[]> {
  const constructors = honoConstructorImportsForContent(content, path, imports);
  const mounts = new Map<string, RouteMount[]>();
  if (constructors.size === 0) return mounts;

  const declaration = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+([A-Za-z_$][\w$]*)\s*\(\s*\)(?:\s*\.\s*basePath\s*\(\s*(['"`])([^'"`${}]*)\3\s*\))?/g;
  for (const match of content.matchAll(declaration)) {
    const appName = match[1];
    const constructorName = match[2];
    if (!appName || !constructorName || !constructors.has(constructorName)) continue;

    const lineNo = lineNumberAtOffset(content, match.index ?? 0);
    const prefix = normalizeRoutePath(match[4] ?? '/');
    const sourceRefs = uniqueInOrder([
      ...(constructors.get(constructorName) ?? []),
      fileRef(path, lineNo),
    ]);

    mounts.set(appName, [
      ...(mounts.get(appName) ?? []),
      { prefix, path, lineNo, sourceRefs },
    ]);
  }

  for (const mountCall of honoRouteMountCallsForContent(content)) {
    const childMounts = mounts.get(mountCall.child);
    if (!childMounts) continue;
    const parentMounts = mounts.get(mountCall.parent) ?? [{ prefix: '/', path, lineNo: mountCall.lineNo }];
    for (const parentMount of parentMounts) {
      for (const childMount of childMounts) {
        mounts.set(mountCall.child, [
          ...(mounts.get(mountCall.child) ?? []),
          {
            prefix: combineExpressRoutes(
              combineExpressRoutes(parentMount.prefix, mountCall.prefix),
              childMount.prefix,
            ),
            path,
            lineNo: mountCall.lineNo,
            sourceRefs: uniqueInOrder([
              ...(parentMount.sourceRefs ?? [fileRef(parentMount.path, parentMount.lineNo)]),
              ...(childMount.sourceRefs ?? [fileRef(childMount.path, childMount.lineNo)]),
              fileRef(path, mountCall.lineNo),
            ]),
          },
        ]);
      }
    }
  }

  return mounts;
}

function honoConstructorImportsForContent(
  content: string,
  path: string,
  imports: readonly InventoryImport[],
): Map<string, string[]> {
  const constructors = new Map<string, string[]>();
  const addConstructor = (name: string | undefined, sourceRefs: string[]): void => {
    if (!name) return;
    constructors.set(name, uniqueInOrder([...(constructors.get(name) ?? []), ...sourceRefs]));
  };

  for (const item of imports) {
    if (item.path !== path || item.specifier !== HONO_SPECIFIER) continue;
    addConstructor(item.defaultImport, item.sourceRefs);
    for (const named of item.namedImports ?? []) {
      if (named.imported === 'Hono' || named.imported === 'default') {
        addConstructor(named.local, item.sourceRefs);
      }
    }
  }

  const defaultImport = /\bimport\s+(?!type\b)([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s*from\s*['"`]hono['"`]/g;
  for (const match of content.matchAll(defaultImport)) {
    addConstructor(match[1], [fileRef(path, lineNumberAtOffset(content, match.index ?? 0))]);
  }

  const namedImport = /\bimport\s+\{([^}]*)\}\s+from\s*['"`]hono['"`]/g;
  for (const match of content.matchAll(namedImport)) {
    const sourceRefs = [fileRef(path, lineNumberAtOffset(content, match.index ?? 0))];
    for (const localName of honoLocalNamesFromBindingList(match[1] ?? '')) {
      addConstructor(localName, sourceRefs);
    }
  }

  const namedRequire = /\b(?:const|let|var)\s+\{([^}]*)\}\s*=\s*require\s*\(\s*['"`]hono['"`]\s*\)/g;
  for (const match of content.matchAll(namedRequire)) {
    const sourceRefs = [fileRef(path, lineNumberAtOffset(content, match.index ?? 0))];
    for (const localName of honoLocalNamesFromBindingList(match[1] ?? '')) {
      addConstructor(localName, sourceRefs);
    }
  }

  return constructors;
}

function honoLocalNamesFromBindingList(value: string): string[] {
  const names: string[] = [];
  for (const part of splitTopLevelCommaArgs(value)) {
    const match = /^\s*([A-Za-z_$][\w$]*)(?:\s+(?:as)\s+([A-Za-z_$][\w$]*)|\s*:\s*([A-Za-z_$][\w$]*))?\s*$/.exec(part);
    if (!match) continue;
    const imported = match[1];
    if (imported !== 'Hono' && imported !== 'default') continue;
    names.push(match[2] ?? match[3] ?? imported);
  }
  return uniqueInOrder(names);
}

function honoRouteMountCallsForContent(
  content: string,
): Array<{ parent: string; child: string; prefix: string; lineNo: number }> {
  const calls: Array<{ parent: string; child: string; prefix: string; lineNo: number }> = [];
  const routeMount = /\b([A-Za-z_$][\w$]*)\s*\.\s*route\s*\(\s*(['"`])([^'"`${}]*)\2\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g;
  for (const match of content.matchAll(routeMount)) {
    const parent = match[1];
    const prefix = match[3];
    const child = match[4];
    if (!parent || prefix === undefined || !child) continue;
    calls.push({
      parent,
      child,
      prefix: normalizeRoutePath(prefix),
      lineNo: lineNumberAtOffset(content, match.index ?? 0),
    });
  }
  return calls;
}

function koaRouterMountsForContent(
  content: string,
  path: string,
  imports: readonly InventoryImport[],
): Map<string, RouteMount[]> {
  const constructors = koaRouterConstructorImportsForContent(content, path, imports);
  const mounts = new Map<string, RouteMount[]>();
  if (constructors.size === 0) return mounts;

  const declaration = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:new\s+)?([A-Za-z_$][\w$]*)\s*\(/g;
  for (const match of content.matchAll(declaration)) {
    const routerName = match[1];
    const constructorName = match[2];
    if (!routerName || !constructorName || !constructors.has(constructorName)) continue;

    const openParenOffset = (match.index ?? 0) + match[0].lastIndexOf('(');
    const closeParenOffset = matchingParenOffset(content, openParenOffset);
    if (closeParenOffset === -1) continue;

    const args = content.slice(openParenOffset + 1, closeParenOffset);
    const lineNo = lineNumberAtOffset(content, match.index ?? 0);
    const prefix = koaRouterPrefixFromConstructorArgs(args) ?? '/';
    const sourceRefs = uniqueInOrder([
      ...(constructors.get(constructorName) ?? []),
      fileRef(path, lineNo),
    ]);

    mounts.set(routerName, [
      ...(mounts.get(routerName) ?? []),
      { prefix, path, lineNo, sourceRefs },
    ]);
  }

  return mounts;
}

function koaRouterConstructorImportsForContent(
  content: string,
  path: string,
  imports: readonly InventoryImport[],
): Map<string, string[]> {
  const constructors = new Map<string, string[]>();
  const addConstructor = (name: string | undefined, sourceRefs: string[]): void => {
    if (!name) return;
    constructors.set(name, uniqueInOrder([...(constructors.get(name) ?? []), ...sourceRefs]));
  };

  for (const item of imports) {
    if (item.path !== path || !KOA_ROUTER_SPECIFIERS.has(item.specifier)) continue;
    addConstructor(item.defaultImport, item.sourceRefs);
    for (const named of item.namedImports ?? []) {
      if (named.imported === 'Router' || named.imported === 'default') {
        addConstructor(named.local, item.sourceRefs);
      }
    }
  }

  const specifier = KOA_ROUTER_SPECIFIER_PATTERN;
  const defaultImport = new RegExp(`\\bimport\\s+(?!type\\b)([A-Za-z_$][\\w$]*)\\s*(?:,\\s*\\{[^}]*\\})?\\s*from\\s*['"\`]${specifier}['"\`]`, 'g');
  for (const match of content.matchAll(defaultImport)) {
    addConstructor(match[1], [fileRef(path, lineNumberAtOffset(content, match.index ?? 0))]);
  }

  const namedImport = new RegExp(`\\bimport\\s+\\{([^}]*)\\}\\s+from\\s*['"\`]${specifier}['"\`]`, 'g');
  for (const match of content.matchAll(namedImport)) {
    const sourceRefs = [fileRef(path, lineNumberAtOffset(content, match.index ?? 0))];
    for (const localName of koaRouterLocalNamesFromBindingList(match[1] ?? '')) {
      addConstructor(localName, sourceRefs);
    }
  }

  const defaultRequire = new RegExp(`\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*require\\s*\\(\\s*['"\`]${specifier}['"\`]\\s*\\)`, 'g');
  for (const match of content.matchAll(defaultRequire)) {
    addConstructor(match[1], [fileRef(path, lineNumberAtOffset(content, match.index ?? 0))]);
  }

  const namedRequire = new RegExp(`\\b(?:const|let|var)\\s+\\{([^}]*)\\}\\s*=\\s*require\\s*\\(\\s*['"\`]${specifier}['"\`]\\s*\\)`, 'g');
  for (const match of content.matchAll(namedRequire)) {
    const sourceRefs = [fileRef(path, lineNumberAtOffset(content, match.index ?? 0))];
    for (const localName of koaRouterLocalNamesFromBindingList(match[1] ?? '')) {
      addConstructor(localName, sourceRefs);
    }
  }

  return constructors;
}

function koaRouterLocalNamesFromBindingList(value: string): string[] {
  const names: string[] = [];
  for (const part of splitTopLevelCommaArgs(value)) {
    const match = /^\s*([A-Za-z_$][\w$]*)(?:\s+(?:as)\s+([A-Za-z_$][\w$]*)|\s*:\s*([A-Za-z_$][\w$]*))?\s*$/.exec(part);
    if (!match) continue;
    const imported = match[1];
    if (imported !== 'Router' && imported !== 'default') continue;
    names.push(match[2] ?? match[3] ?? imported);
  }
  return uniqueInOrder(names);
}

function koaRouterPrefixFromConstructorArgs(args: string): string | null {
  const options = splitTopLevelCommaArgs(args).find((arg) => arg.trim().startsWith('{'));
  if (!options) return null;
  const prefix = propertyStringValue(options, 'prefix');
  return prefix === null ? null : normalizeRoutePath(prefix);
}

function blockedLineRouteReceiversForContent(
  content: string,
  koaRouterMounts: ReadonlyMap<string, readonly RouteMount[]>,
  honoRouteMounts: ReadonlyMap<string, readonly RouteMount[]> = new Map(),
): Set<string> {
  const blocked = new Set<string>();
  const objectLiteralRouter = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\{/g;
  for (const match of content.matchAll(objectLiteralRouter)) {
    const name = match[1];
    if (name && EXPRESS_ROUTE_RECEIVERS.has(name) && !koaRouterMounts.has(name) && !honoRouteMounts.has(name)) {
      blocked.add(name);
    }
  }

  const hasLocalRouterFactory = hasNonFrameworkLocalRouterFactory(content);
  if (!hasLocalRouterFactory) return blocked;

  const localRouterInstance = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:new\s+)?Router\s*\(/g;
  for (const match of content.matchAll(localRouterInstance)) {
    const name = match[1];
    if (name && !koaRouterMounts.has(name) && !honoRouteMounts.has(name)) blocked.add(name);
  }
  return blocked;
}

function hasNonFrameworkLocalRouterFactory(content: string): boolean {
  const localRouterFactory = /\b(?:const|let|var)\s+Router\s*=\s*([^;\n]+)/g;
  for (const match of content.matchAll(localRouterFactory)) {
    if (!isFrameworkRouterFactoryAliasInitializer(match[1] ?? '')) return true;
  }
  return false;
}

function isFrameworkRouterFactoryAliasInitializer(value: string): boolean {
  const trimmed = value.trim();
  return /^(?:express\s*\.\s*Router|require\s*\(\s*['"`]express['"`]\s*\)(?:\s*\.\s*Router)?|require\s*\(\s*['"`](?:koa-router|@koa\/router)['"`]\s*\)|require\s*\(\s*['"`]hono['"`]\s*\)\s*\.\s*Hono)\b/.test(trimmed);
}

function expressRouterMountsForContent(content: string, path: string): Map<string, ExpressRouterMount[]> {
  const routerVariables = expressRouterVariablesForContent(content);
  const appVariables = expressAppVariablesForContent(content);
  const mounts = new Map<string, ExpressRouterMount[]>();
  if (routerVariables.size === 0) return mounts;

  for (const useCall of expressUseCallsForContent(content)) {
    if (!isExpressUseReceiver(useCall.receiver, routerVariables, appVariables)) continue;
    const args = useCall.args;
    const prefix = staticStringLiteralArg(args[0]);
    if (prefix === null) continue;

    for (const arg of args.slice(1)) {
      const routerName = directIdentifierArg(arg);
      if (!routerName || !routerVariables.has(routerName)) continue;
      addExpressRouterMount(mounts, routerName, { prefix, path, lineNo: useCall.lineNo });
    }
  }

  return mounts;
}

function expressUseCallsForContent(content: string): Array<{ receiver: string; args: string[]; lineNo: number }> {
  const calls: Array<{ receiver: string; args: string[]; lineNo: number }> = [];
  const useCall = /\b([A-Za-z_$][\w$]*)\s*\.\s*use\s*\(/gi;
  for (const match of content.matchAll(useCall)) {
    const openParenOffset = (match.index ?? 0) + match[0].lastIndexOf('(');
    const closeParenOffset = matchingParenOffset(content, openParenOffset);
    if (closeParenOffset === -1) continue;
    calls.push({
      receiver: match[1]!,
      args: splitTopLevelCommaArgs(content.slice(openParenOffset + 1, closeParenOffset)),
      lineNo: lineNumberAtOffset(content, match.index ?? 0),
    });
  }
  return calls;
}

function expressRouterVariablesForContent(content: string): Set<string> {
  const variables = new Set<string>();
  const factoryAliases = expressRouterFactoryAliasesForContent(content);
  const declaration = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:express\s*\.\s*)?([A-Za-z_$][\w$]*)\s*\(/g;
  for (const match of content.matchAll(declaration)) {
    const variableName = match[1];
    const factoryName = match[2];
    if (variableName && factoryName && factoryAliases.has(factoryName)) variables.add(variableName);
  }
  if (/\bmodule\s*\.\s*exports\s*=\s*(?:express\s*\.\s*)?Router\s*\(/.test(content)) {
    variables.add('module.exports');
  }
  return variables;
}

function expressRouterFactoryAliasesForContent(content: string): Set<string> {
  const aliases = new Set<string>(['Router']);
  const directAlias = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:express\s*\.\s*Router|require\s*\(\s*['"`]express['"`]\s*\)\s*\.\s*Router)\b/g;
  for (const match of content.matchAll(directAlias)) {
    if (match[1]) aliases.add(match[1]);
  }

  const namedImport = /\bimport\s+\{([^}]*)\}\s+from\s*['"`]express['"`]/g;
  for (const match of content.matchAll(namedImport)) {
    for (const localName of expressRouterLocalNamesFromBindingList(match[1] ?? '')) {
      aliases.add(localName);
    }
  }

  const namedRequire = /\b(?:const|let|var)\s+\{([^}]*)\}\s*=\s*require\s*\(\s*['"`]express['"`]\s*\)/g;
  for (const match of content.matchAll(namedRequire)) {
    for (const localName of expressRouterLocalNamesFromBindingList(match[1] ?? '')) {
      aliases.add(localName);
    }
  }

  return aliases;
}

function expressRouterLocalNamesFromBindingList(value: string): string[] {
  const names: string[] = [];
  for (const part of splitTopLevelCommaArgs(value)) {
    const match = /^\s*([A-Za-z_$][\w$]*)(?:\s+(?:as)\s+([A-Za-z_$][\w$]*)|\s*:\s*([A-Za-z_$][\w$]*))?\s*$/.exec(part);
    if (!match || match[1] !== 'Router') continue;
    names.push(match[2] ?? match[3] ?? match[1]);
  }
  return uniqueInOrder(names);
}

function expressAppVariablesForContent(content: string): Set<string> {
  const variables = new Set<string>();
  const declaration = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*express\s*\(/g;
  for (const match of content.matchAll(declaration)) {
    if (match[1]) variables.add(match[1]);
  }
  return variables;
}

function isExpressUseReceiver(
  receiver: string,
  routerVariables: ReadonlySet<string>,
  appVariables: ReadonlySet<string>,
): boolean {
  return routerVariables.has(receiver)
    || appVariables.has(receiver)
    || EXPRESS_ROUTE_RECEIVERS.has(receiver);
}

function crossFileExpressRouterMountsForFiles(
  files: ScannedInventoryFile[],
  imports: InventoryImport[],
  exports: InventoryExport[],
): Map<string, Map<string, ExpressRouterMount[]>> {
  const knownPaths = new Set(files.filter((file) => isTypeScriptAstCandidate(file.path)).map((file) => file.path));
  const routerVariablesByPath = new Map<string, Set<string>>();
  for (const file of files) {
    const routerVariables = expressRouterVariablesForContent(file.content);
    if (routerVariables.size > 0) routerVariablesByPath.set(file.path, routerVariables);
  }

  const mountsByTargetPath = new Map<string, Map<string, ExpressRouterMount[]>>();
  for (const file of files) {
    const fileImports = imports.filter((item) => item.path === file.path);
    if (fileImports.length === 0) continue;
    const routerVariables = expressRouterVariablesForContent(file.content);
    const appVariables = expressAppVariablesForContent(file.content);

    for (const useCall of expressUseCallsForContent(file.content)) {
      if (!isExpressUseReceiver(useCall.receiver, routerVariables, appVariables)) continue;
      const prefix = staticStringLiteralArg(useCall.args[0]);
      if (prefix === null) continue;

      for (const arg of useCall.args.slice(1)) {
        const localName = directIdentifierArg(arg);
        if (!localName) continue;
        const resolved = importedExpressRouterVariableForLocalName({
          localName,
          importingPath: file.path,
          imports: fileImports,
          exports,
          knownPaths,
          routerVariablesByPath,
        });
        if (!resolved) continue;

        const targetMounts = mountsByTargetPath.get(resolved.path) ?? new Map<string, ExpressRouterMount[]>();
        addExpressRouterMount(targetMounts, resolved.routerName, {
          prefix,
          path: file.path,
          lineNo: useCall.lineNo,
        });
        mountsByTargetPath.set(resolved.path, targetMounts);
      }
    }
  }

  return mountsByTargetPath;
}

interface ResolvedExpressRouterVariable {
  path: string;
  routerName: string;
}

function importedExpressRouterVariableForLocalName(input: {
  localName: string;
  importingPath: string;
  imports: InventoryImport[];
  exports: InventoryExport[];
  knownPaths: ReadonlySet<string>;
  routerVariablesByPath: ReadonlyMap<string, ReadonlySet<string>>;
}): ResolvedExpressRouterVariable | null {
  const imports = input.imports
    .filter((item) => item.path === input.importingPath && importIncludesLocalName(item, input.localName))
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const item of imports) {
    const exportName = importedNameForLocalName(item, input.localName) ?? input.localName;
    const targetPaths = importTargetPaths(item, input.knownPaths);
    if (targetPaths.size === 0) continue;
    const resolved = resolveExportedExpressRouterVariable({
      exportName,
      targetPaths,
      exports: input.exports,
      knownPaths: input.knownPaths,
      routerVariablesByPath: input.routerVariablesByPath,
      depth: 0,
    });
    if (resolved) return resolved;
  }

  return null;
}

function resolveExportedExpressRouterVariable(input: {
  exportName: string;
  targetPaths: ReadonlySet<string>;
  exports: InventoryExport[];
  knownPaths: ReadonlySet<string>;
  routerVariablesByPath: ReadonlyMap<string, ReadonlySet<string>>;
  depth: number;
}): ResolvedExpressRouterVariable | null {
  const exported = input.exports
    .filter((candidate) => (
      input.targetPaths.has(candidate.path)
      && exportMatchesExpressRouterVariable(candidate, input.exportName)
    ))
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const exportItem of exported) {
    const resolved = resolveExportItemExpressRouterVariable(exportItem, input);
    if (resolved) return resolved;
  }

  return null;
}

function resolveExportItemExpressRouterVariable(
  exportItem: InventoryExport,
  input: {
    exportName: string;
    targetPaths: ReadonlySet<string>;
    exports: InventoryExport[];
    knownPaths: ReadonlySet<string>;
    routerVariablesByPath: ReadonlyMap<string, ReadonlySet<string>>;
    depth: number;
  },
): ResolvedExpressRouterVariable | null {
  if (exportItem.kind === 're_export' && exportItem.specifier && input.depth < LOCAL_RE_EXPORT_MAX_DEPTH) {
    const reExportTargetPaths = moduleTargetPaths(exportItem.path, exportItem.specifier, input.knownPaths);
    if (reExportTargetPaths.size > 0) {
      const reExportName = exportItem.name === '*' ? input.exportName : exportItem.name;
      return resolveExportedExpressRouterVariable({
        exportName: reExportName,
        targetPaths: reExportTargetPaths,
        exports: input.exports,
        knownPaths: input.knownPaths,
        routerVariablesByPath: input.routerVariablesByPath,
        depth: input.depth + 1,
      });
    }
  }

  const routerVariables = input.routerVariablesByPath.get(exportItem.path);
  if (!routerVariables) return null;
  const routerName = expressRouterCandidateNamesForExport(exportItem, input.exportName)
    .find((name) => routerVariables.has(name));
  return routerName ? { path: exportItem.path, routerName } : null;
}

function exportMatchesExpressRouterVariable(exportItem: InventoryExport, exportName: string): boolean {
  if (exportName === 'default') {
    return exportItem.kind === 'default'
      || exportItem.name === 'default'
      || exportItem.exportedAs === 'default';
  }
  return exportItem.name === exportName
    || exportItem.exportedAs === exportName
    || exportItem.name === '*';
}

function expressRouterCandidateNamesForExport(exportItem: InventoryExport, exportName: string): string[] {
  return uniqueInOrder([
    exportItem.name,
    exportItem.exportedAs,
    exportName,
  ].filter((name): name is string => Boolean(name && name !== '*' && name !== 'default')));
}

function mergeExpressRouterMountMaps(
  ...maps: Array<ReadonlyMap<string, readonly ExpressRouterMount[]> | undefined>
): Map<string, ExpressRouterMount[]> {
  const merged = new Map<string, ExpressRouterMount[]>();
  for (const map of maps) {
    for (const [routerName, mounts] of map?.entries() ?? []) {
      for (const mount of mounts) addExpressRouterMount(merged, routerName, mount);
    }
  }
  return merged;
}

function addExpressRouterMount(
  mounts: Map<string, ExpressRouterMount[]>,
  routerName: string,
  mount: ExpressRouterMount,
): void {
  mounts.set(routerName, [...(mounts.get(routerName) ?? []), mount]);
}

function mountedRouteVariants(
  receiver: string,
  route: string,
  mounts: ReadonlyMap<string, readonly RouteMount[]>,
): Array<{ route: string; mount?: RouteMount }> {
  const receiverMounts = mounts.get(receiver) ?? [];
  if (receiverMounts.length === 0) return [{ route }];
  return receiverMounts.map((mount) => ({
    route: combineExpressRoutes(mount.prefix, route),
    mount,
  }));
}

function mountedLaravelRouteVariants(
  route: string,
  mounts: readonly LaravelRouteGroupMount[],
): Array<{ route: string; mount?: LaravelRouteGroupMount }> {
  if (mounts.length === 0) return [{ route: normalizeRoutePath(route) }];
  return mounts.map((mount) => ({
    route: combineExpressRoutes(mount.prefix, route),
    mount,
  }));
}

const LARAVEL_RESOURCE_ACTIONS = ['index', 'create', 'store', 'show', 'edit', 'update', 'destroy'] as const;
const LARAVEL_API_RESOURCE_ACTIONS = ['index', 'store', 'show', 'update', 'destroy'] as const;

type LaravelResourceAction = typeof LARAVEL_RESOURCE_ACTIONS[number];

function laravelResourceRouteMatchesForLine(
  line: string,
  mounts: readonly LaravelRouteGroupMount[],
): LineRouteMatch[] {
  const resource = /\bRoute::(apiResource|resource)\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*([^)]*Controller(?:::class)?[^)]*)\)(.*)/g;
  const matches: LineRouteMatch[] = [];
  for (const match of line.matchAll(resource)) {
    const resourceName = match[2];
    const controllerName = laravelResourceControllerName(match[3]);
    if (!resourceName || !controllerName) continue;

    const actions = laravelResourceActionsForOptions(match[4] ?? '', match[1] === 'apiResource');
    for (const action of actions) {
      for (const route of laravelResourceRoutesForAction(resourceName, action)) {
        for (const mounted of mountedLaravelRouteVariants(route.route, mounts)) {
          matches.push({
            method: route.method,
            route: mounted.route,
            handler: `${controllerName}@${action}`,
            mount: mounted.mount,
          });
        }
      }
    }
  }
  return matches;
}

function laravelResourceControllerName(value: string | undefined): string | null {
  const classConstant = /([A-Za-z_][\w\\]*Controller)::class/.exec(value ?? '');
  if (classConstant?.[1]) return classConstant[1];
  const stringName = /['"`]([A-Za-z_][\w\\]*Controller)['"`]/.exec(value ?? '');
  return stringName?.[1] ?? null;
}

function laravelResourceActionsForOptions(options: string, apiResource: boolean): LaravelResourceAction[] {
  const baseActions = apiResource
    ? [...LARAVEL_API_RESOURCE_ACTIONS]
    : [...LARAVEL_RESOURCE_ACTIONS];
  const only = laravelActionListCallOption(options, 'only');
  const except = new Set(laravelActionListCallOption(options, 'except') ?? []);
  const actions = only ?? baseActions;
  return actions.filter((action) => baseActions.includes(action) && !except.has(action));
}

function laravelActionListCallOption(options: string, optionName: 'only' | 'except'): LaravelResourceAction[] | null {
  const match = new RegExp(`->\\s*${optionName}\\s*\\(\\s*(\\[[^\\]]*\\]|['"\`][^'"\`]+['"\`])\\s*\\)`).exec(options);
  if (!match?.[1]) return null;
  const validActions = railsActionOptionItems(match[1]).filter((action): action is LaravelResourceAction => (
    (LARAVEL_RESOURCE_ACTIONS as readonly string[]).includes(action)
  ));
  return uniqueInOrder(validActions);
}

function laravelResourceRoutesForAction(
  resourceName: string,
  action: LaravelResourceAction,
): Array<{ method: string; route: string }> {
  const baseRoute = normalizeRoutePath(resourceName);
  const parameter = `{${singularResourceSegment(resourceName)}}`;
  switch (action) {
    case 'index':
      return [{ method: 'GET', route: baseRoute }];
    case 'create':
      return [{ method: 'GET', route: combineExpressRoutes(baseRoute, '/create') }];
    case 'store':
      return [{ method: 'POST', route: baseRoute }];
    case 'show':
      return [{ method: 'GET', route: combineExpressRoutes(baseRoute, parameter) }];
    case 'edit':
      return [{ method: 'GET', route: combineExpressRoutes(combineExpressRoutes(baseRoute, parameter), '/edit') }];
    case 'update':
      return [
        { method: 'PUT', route: combineExpressRoutes(baseRoute, parameter) },
        { method: 'PATCH', route: combineExpressRoutes(baseRoute, parameter) },
      ];
    case 'destroy':
      return [{ method: 'DELETE', route: combineExpressRoutes(baseRoute, parameter) }];
  }
}

function singularResourceSegment(resourceName: string): string {
  const segment = resourceName.split(/[/.]/).filter(Boolean).at(-1) ?? resourceName;
  if (segment.endsWith('ies') && segment.length > 3) return `${segment.slice(0, -3)}y`;
  if (segment.endsWith('ses') && segment.length > 3) return segment.slice(0, -2);
  if (segment.endsWith('s') && !segment.endsWith('ss') && segment.length > 1) return segment.slice(0, -1);
  return segment;
}

function mountedRailsRouteVariants(
  route: string,
  mounts: readonly RailsRouteScopeMount[],
): Array<{ route: string; mount?: RailsRouteScopeMount }> {
  if (mounts.length === 0) return [{ route: normalizeRoutePath(route) }];
  return mounts.map((mount) => ({
    route: combineExpressRoutes(mount.prefix, route),
    mount,
  }));
}

const RAILS_RESOURCE_ACTIONS = ['index', 'create', 'new', 'show', 'edit', 'update', 'destroy'] as const;

type RailsResourceAction = typeof RAILS_RESOURCE_ACTIONS[number];

const RAILS_RESOURCE_ROUTES: Record<RailsResourceAction, Array<{ method: string; route: string }>> = {
  index: [{ method: 'GET', route: '' }],
  create: [{ method: 'POST', route: '' }],
  new: [{ method: 'GET', route: '/new' }],
  show: [{ method: 'GET', route: '/:id' }],
  edit: [{ method: 'GET', route: '/:id/edit' }],
  update: [
    { method: 'PATCH', route: '/:id' },
    { method: 'PUT', route: '/:id' },
  ],
  destroy: [{ method: 'DELETE', route: '/:id' }],
};

const RAILS_SINGULAR_RESOURCE_ACTIONS = ['create', 'new', 'show', 'edit', 'update', 'destroy'] as const;

type RailsSingularResourceAction = typeof RAILS_SINGULAR_RESOURCE_ACTIONS[number];

const RAILS_SINGULAR_RESOURCE_ROUTES: Record<RailsSingularResourceAction, Array<{ method: string; route: string }>> = {
  create: [{ method: 'POST', route: '' }],
  new: [{ method: 'GET', route: '/new' }],
  show: [{ method: 'GET', route: '' }],
  edit: [{ method: 'GET', route: '/edit' }],
  update: [
    { method: 'PATCH', route: '' },
    { method: 'PUT', route: '' },
  ],
  destroy: [{ method: 'DELETE', route: '' }],
};

function railsResourceRouteMatchesForLine(
  line: string,
  mounts: readonly RailsRouteScopeMount[],
): LineRouteMatch[] {
  const match = /^\s*resources\s+(?::([A-Za-z_]\w*)|(['"`])([A-Za-z_][\w/]*)\2)(.*)$/.exec(line);
  const resourceName = match?.[1] ?? match?.[3];
  if (!resourceName) return [];

  const actions = railsResourceActionsForOptions(match?.[4] ?? '');
  const matches: LineRouteMatch[] = [];
  for (const action of actions) {
    for (const route of RAILS_RESOURCE_ROUTES[action]) {
      const resourceRoute = combineExpressRoutes(`/${resourceName}`, route.route);
      for (const mounted of mountedRailsRouteVariants(resourceRoute, mounts)) {
        matches.push({
          method: route.method,
          route: mounted.route,
          handler: `${railsControllerClassName(resourceName)}#${action}`,
          mount: mounted.mount,
        });
      }
    }
  }
  return matches;
}

function railsSingularResourceRouteMatchesForLine(
  line: string,
  mounts: readonly RailsRouteScopeMount[],
): LineRouteMatch[] {
  const match = /^\s*resource\s+(?::([A-Za-z_]\w*)|(['"`])([A-Za-z_][\w/]*)\2)(.*)$/.exec(line);
  const resourceName = match?.[1] ?? match?.[3];
  if (!resourceName) return [];

  const actions = railsSingularResourceActionsForOptions(match?.[4] ?? '');
  const controller = railsSingularResourceControllerHandlerPath(resourceName);
  const matches: LineRouteMatch[] = [];
  for (const action of actions) {
    for (const route of RAILS_SINGULAR_RESOURCE_ROUTES[action]) {
      const resourceRoute = combineExpressRoutes(`/${resourceName}`, route.route);
      for (const mounted of mountedRailsRouteVariants(resourceRoute, mounts)) {
        matches.push({
          method: route.method,
          route: mounted.route,
          handler: `${controller}#${action}`,
          mount: mounted.mount,
        });
      }
    }
  }
  return matches;
}

function railsResourceActionsForOptions(options: string): RailsResourceAction[] {
  const only = railsActionListOption(options, 'only');
  const except = new Set(railsActionListOption(options, 'except') ?? []);
  const actions = only ?? [...RAILS_RESOURCE_ACTIONS];
  return actions.filter((action) => !except.has(action));
}

function railsSingularResourceActionsForOptions(options: string): RailsSingularResourceAction[] {
  const only = railsActionListOption(options, 'only')?.filter(railsIsSingularResourceAction);
  const except = new Set((railsActionListOption(options, 'except') ?? []).filter(railsIsSingularResourceAction));
  const actions = only ?? [...RAILS_SINGULAR_RESOURCE_ACTIONS];
  return actions.filter((action) => !except.has(action));
}

function railsIsSingularResourceAction(action: RailsResourceAction): action is RailsSingularResourceAction {
  return (RAILS_SINGULAR_RESOURCE_ACTIONS as readonly string[]).includes(action);
}

function railsActionListOption(options: string, optionName: 'only' | 'except'): RailsResourceAction[] | null {
  const match = new RegExp(`\\b${optionName}\\s*:\\s*(\\[[^\\]]*\\]|%i\\[[^\\]]*\\]|:[A-Za-z_]\\w*|['"\`][^'"\`]+['"\`])`).exec(options);
  if (!match?.[1]) return null;
  const rawActions = railsActionOptionItems(match[1]);
  const validActions = rawActions.filter((action): action is RailsResourceAction => (
    (RAILS_RESOURCE_ACTIONS as readonly string[]).includes(action)
  ));
  return uniqueInOrder(validActions);
}

function railsActionOptionItems(value: string): string[] {
  if (value.startsWith('%i[') && value.endsWith(']')) {
    return value.slice(3, -1).split(/\s+/).filter(Boolean);
  }
  if (value.startsWith('[') && value.endsWith(']')) {
    const items: string[] = [];
    for (const match of value.slice(1, -1).matchAll(/:?['"`]?([A-Za-z_]\w*)['"`]?/g)) {
      if (match[1]) items.push(match[1]);
    }
    return items;
  }
  if (value.startsWith(':')) return [value.slice(1)];
  const quoted = /^(['"`])([A-Za-z_]\w*)\1$/.exec(value);
  return quoted?.[2] ? [quoted[2]] : [];
}

function railsSingularResourceControllerHandlerPath(resourceName: string): string {
  const segments = resourceName.split('/').filter(Boolean);
  const leaf = segments.pop() ?? resourceName;
  return railsControllerHandlerPath([...segments, pluralResourceSegment(leaf)].join('/'));
}

function pluralResourceSegment(resourceName: string): string {
  const segment = resourceName.split(/[/.]/).filter(Boolean).at(-1) ?? resourceName;
  if (/[bcdfghjklmnpqrstvwxyz]y$/i.test(segment)) return `${segment.slice(0, -1)}ies`;
  if (/(?:s|x|z|ch|sh)$/i.test(segment)) return `${segment}es`;
  return `${segment}s`;
}

function combineExpressRoutes(prefix: string, route: string): string {
  const normalizedPrefix = normalizeRoutePath(prefix);
  const normalizedRoute = normalizeRoutePath(route);
  if (normalizedPrefix === '/') return normalizedRoute;
  if (normalizedRoute === '/') return normalizedPrefix;
  return `${normalizedPrefix.replace(/\/+$/, '')}/${normalizedRoute.replace(/^\/+/, '')}`;
}

function staticStringLiteralArg(value: string | undefined): string | null {
  const match = /^\s*(['"`])([\s\S]*)\1\s*$/.exec(value ?? '');
  if (!match) return null;
  if (match[1] === '`' && match[2]?.includes('${')) return null;
  return match[2] ?? '';
}

function directIdentifierArg(value: string | undefined): string | null {
  const match = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(value ?? '');
  return match?.[1] ?? null;
}

function routeLineSourceRefs(path: string, lineNo: number, mount: RouteMount | undefined): string[] {
  return uniqueInOrder([
    fileRef(path, lineNo),
    ...(mount?.sourceRefs ?? (mount ? [fileRef(mount.path, mount.lineNo)] : [])),
  ]);
}

function lineSourceRefs(path: string, lineNos: Array<number | undefined>): string[] {
  const refs: string[] = [];
  const seen = new Set<number>();
  for (const lineNo of lineNos) {
    if (!lineNo || seen.has(lineNo)) continue;
    seen.add(lineNo);
    refs.push(fileRef(path, lineNo));
  }
  return refs;
}

function jobEntrypointForLine(path: string, line: string, lineNo: number): InventoryEntrypoint | null {
  if (!/(cron\.schedule|@scheduled|queue\.process|worker\.process|consumer\.subscribe|schedule\s*\(|job\s*\()/i.test(line)) {
    return null;
  }
  const queueLike = /(queue|consumer|worker\.process)/i.test(line);
  return {
    id: `entry_${queueLike ? 'queue' : 'job'}_${slugify(path)}_${lineNo}`,
    kind: queueLike ? 'queue' : 'job',
    label: queueLike ? `Queue/consumer: ${basename(path)}` : `Job/schedule: ${basename(path)}`,
    path,
    handler: excerpt(line.trim(), 120),
    sourceRefs: [fileRef(path, lineNo)],
    confidence: 0.65,
  };
}

function fileEntrypointsForFile(
  file: ScannedInventoryFile,
  exports: readonly InventoryExport[] = [],
): InventoryEntrypoint[] {
  const nextRoute = nextRoutePath(file.path);
  const nextPagesRoute = nextPagesApiRoutePath(file.path);
  if (!nextRoute && !nextPagesRoute) return [];
  const entrypoints: InventoryEntrypoint[] = [];
  if (nextRoute) {
    const lines = file.content.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const methods = nextRouteMethodExportMatches(line);
      for (const method of methods) {
        entrypoints.push({
          id: `entry_route_${slugify(file.path)}_${slugify(method)}_${index + 1}`,
          kind: 'http_route',
          label: `${method} ${nextRoute}`,
          path: file.path,
          method,
          route: nextRoute,
          handler: method,
          sourceRefs: [fileRef(file.path, index + 1)],
          confidence: 0.88,
        });
      }
    }
    for (const exportItem of exports.filter((item) => item.path === file.path)) {
      const method = nextRouteMethodForExport(exportItem);
      if (!method) continue;
      const lineNo = lineFromSourceRef(exportItem.sourceRefs[0]) ?? 1;
      entrypoints.push({
        id: `entry_route_${slugify(file.path)}_${slugify(method)}_${lineNo}`,
        kind: 'http_route',
        label: `${method} ${nextRoute}`,
        path: file.path,
        method,
        route: nextRoute,
        handler: method,
        sourceRefs: exportItem.sourceRefs.length > 0 ? exportItem.sourceRefs : [fileRef(file.path, lineNo)],
        confidence: 0.88,
      });
    }
  }

  if (nextPagesRoute) {
    const methodEvidence = nextPagesApiMethodEvidence(file);
    const methods = methodEvidence.length > 0
      ? methodEvidence
      : [{ method: 'ANY', sourceRefs: [] }];
    for (const exportItem of exports.filter((item) => item.path === file.path && isDefaultExportItem(item))) {
      const lineNo = lineFromSourceRef(exportItem.sourceRefs[0]) ?? 1;
      for (const method of methods) {
        const sourceRefs = uniqueInOrder([
          ...(exportItem.sourceRefs.length > 0 ? exportItem.sourceRefs : [fileRef(file.path, lineNo)]),
          ...method.sourceRefs,
        ]);
        entrypoints.push({
          id: `entry_route_${slugify(file.path)}_${slugify(method.method)}_${lineNo}`,
          kind: 'http_route',
          label: `${method.method} ${nextPagesRoute}`,
          path: file.path,
          method: method.method,
          route: nextPagesRoute,
          handler: 'default',
          sourceRefs,
          confidence: method.method === 'ANY' ? 0.82 : 0.86,
        });
      }
    }
  }
  return entrypoints;
}

function nextPagesApiMethodEvidence(file: ScannedInventoryFile): Array<{ method: string; sourceRefs: string[] }> {
  const methods = new Map<string, string[]>();
  const lines = file.content.split('\n');
  const addMethod = (method: string, lineNo: number): void => {
    if (!isHttpMethodName(method)) return;
    methods.set(method, uniqueInOrder([...(methods.get(method) ?? []), fileRef(file.path, lineNo)]));
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    for (const regex of [
      /\b[A-Za-z_$][\w$]*\.method\s*={2,3}\s*['"`](GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)['"`]/g,
      /['"`](GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)['"`]\s*={2,3}\s*[A-Za-z_$][\w$]*\.method\b/g,
    ]) {
      for (const match of line.matchAll(regex)) {
        if (match[1]) addMethod(match[1], index + 1);
      }
    }
  }

  if (/switch\s*\(\s*[A-Za-z_$][\w$]*\.method\s*\)/.test(file.content)) {
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      for (const match of line.matchAll(/\bcase\s+['"`](GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)['"`]\s*:/g)) {
        if (match[1]) addMethod(match[1], index + 1);
      }
    }
  }

  return [...methods.entries()]
    .map(([method, sourceRefs]) => ({ method, sourceRefs }))
    .sort((a, b) => a.method.localeCompare(b.method));
}

function isDefaultExportItem(exportItem: InventoryExport): boolean {
  return exportItem.kind === 'default'
    || exportItem.name === 'default'
    || exportItem.exportedAs === 'default';
}

function nextPagesApiRoutePath(path: string): string | null {
  if (!/\.[cm]?[jt]sx?$/.test(path) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)) return null;
  const parts = path.split('/');
  const pagesIndex = parts.findIndex((part, index) => part === 'pages' && parts[index + 1] === 'api');
  if (pagesIndex === -1) return null;
  const fileName = parts.at(-1);
  if (!fileName) return null;
  const fileSegment = basenameWithoutExt(fileName);
  const routeParts = parts.slice(pagesIndex + 1, -1);
  if (fileSegment !== 'index') routeParts.push(fileSegment);
  if (routeParts.length === 0) return null;
  return `/${routeParts.join('/')}`;
}

function nextRouteMethodForExport(exportItem: InventoryExport): string | null {
  const method = exportItem.exportedAs ?? exportItem.name;
  return isHttpMethodName(method) ? method : null;
}

function isHttpMethodName(value: string): boolean {
  return /^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)$/.test(value);
}

function nextRouteMethodExportMatches(line: string): string[] {
  const functionMatch = /^\s*export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s*\(/.exec(line);
  if (functionMatch?.[1]) return [functionMatch[1]];
  const constMatch = /^\s*export\s+const\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/.exec(line);
  if (constMatch?.[1]) return [constMatch[1]];
  const namedReExportMatch = /^\s*export\s*\{\s*([^}]*)\}\s*from\s*['"`][^'"`]+['"`]/.exec(line);
  if (!namedReExportMatch?.[1]) return [];
  const methods = namedReExportMatch[1].split(',')
    .map((part) => /\bas\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/.exec(part)?.[1]
      ?? /\b(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/.exec(part)?.[1])
    .filter((method): method is string => Boolean(method));
  return uniqueInOrder(methods);
}

interface AspNetRouteAttribute {
  method: string;
  route: string | null;
  sourceLine: number;
}

function aspNetEntrypointsForFile(file: ScannedInventoryFile): InventoryEntrypoint[] {
  if (!/\.cs$/i.test(file.path)) return [];
  const entrypoints: InventoryEntrypoint[] = [];
  const lines = file.content.split('\n');
  let controllerPrefix: string | null = null;
  let pendingAttributes: AspNetRouteAttribute[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const lineNo = index + 1;
    const attributes = aspNetRouteAttributesForLine(line, lineNo);
    if (attributes.length > 0) {
      pendingAttributes = [...pendingAttributes, ...attributes];
      if (/^\s*(?:public\s+)?(?:class|partial\s+class)\s+/.test(line)) {
        // Attribute and class declaration on one line.
      } else if (!/\b(?:public|private|protected|internal)\s+/.test(line)) {
        continue;
      }
    }

    const classMatch = /\b(?:public\s+)?(?:partial\s+)?class\s+([A-Za-z_][\w]*)\b/.exec(line);
    if (classMatch) {
      const routeAttribute = pendingAttributes.find((attribute) => attribute.method === 'ANY' && attribute.route);
      controllerPrefix = routeAttribute?.route
        ? aspNetRouteWithControllerToken(routeAttribute.route, classMatch[1]!)
        : null;
      pendingAttributes = [];
      continue;
    }

    const methodMatch = /\b(?:public|private|protected|internal)\s+(?:async\s+)?[\w<>,\s?]+\s+([A-Za-z_][\w]*)\s*\(/.exec(line);
    if (!methodMatch) {
      if (line.trim() && !line.trim().startsWith('[')) pendingAttributes = [];
      continue;
    }

    for (const attribute of pendingAttributes) {
      const route = combineAspNetRoutes(controllerPrefix, attribute.route);
      if (!route) continue;
      entrypoints.push({
        id: `entry_route_${slugify(file.path)}_${slugify(attribute.method)}_${slugify(route)}_${attribute.sourceLine}`,
        kind: 'http_route',
        label: `${attribute.method} ${route}`,
        path: file.path,
        method: attribute.method,
        route,
        handler: methodMatch[1],
        sourceRefs: [fileRef(file.path, attribute.sourceLine)],
        confidence: 0.88,
      });
    }
    pendingAttributes = [];
  }

  return entrypoints;
}

interface PlayFrameworkRouteMatch {
  method: string;
  route: string;
  handler: string;
  lineNo: number;
}

function playFrameworkRouteMatchesForContent(content: string): PlayFrameworkRouteMatch[] {
  const matches: PlayFrameworkRouteMatch[] = [];
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;

    const match = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)\s+(@?controllers\.[A-Za-z_$][\w$.]*\.[A-Za-z_$][\w$]*)\s*(?:\(|$)/.exec(trimmed);
    if (!match?.[1] || !match[2] || !match[3]) continue;
    if (!isConservativePlayRoutePath(match[2])) continue;

    const handler = playFrameworkHandler(match[3]);
    if (!handler) continue;

    matches.push({
      method: match[1],
      route: normalizeRoutePath(match[2]),
      handler,
      lineNo: index + 1,
    });
  }
  return matches;
}

function playFrameworkHandler(target: string): string | null {
  const normalized = target.replace(/^@/, '');
  const parts = normalized.split('.').filter(Boolean);
  if (parts.length < 3 || parts[0] !== 'controllers') return null;
  const methodName = parts.at(-1);
  const className = parts.at(-2);
  if (!methodName || !className) return null;
  if (className === 'Assets') return null;
  if (!/^[A-Za-z_$][\w$]*$/.test(className) || !/^[A-Za-z_$][\w$]*$/.test(methodName)) return null;
  return `${className}#${methodName}`;
}

function isConservativePlayRoutePath(route: string): boolean {
  const normalized = route.trim();
  return normalized.startsWith('/')
    && normalized.length > 1
    && !normalized.includes('${')
    && !normalized.includes('..')
    && !normalized.includes('*');
}

interface AspNetRouteTableRouteMatch {
  method: string;
  route: string;
  handler: string;
  lineNo: number;
  sourceLineNos: number[];
}

function aspNetRouteTableRouteMatchesForContent(content: string): AspNetRouteTableRouteMatch[] {
  const matches: AspNetRouteTableRouteMatch[] = [];
  const mapRouteCall = /\bMap(?:Http)?Route\s*\(/gi;

  for (const match of content.matchAll(mapRouteCall)) {
    const callOffset = match.index ?? 0;
    const openParenOffset = callOffset + match[0].lastIndexOf('(');
    const closeParenOffset = matchingParenOffset(content, openParenOffset);
    if (closeParenOffset === -1) continue;

    const argsOffset = openParenOffset + 1;
    const argsText = content.slice(argsOffset, closeParenOffset);
    const parsed = aspNetRouteTableRouteFromArgs(argsText, content, callOffset, argsOffset);
    if (parsed) matches.push(parsed);
  }

  return matches;
}

function aspNetRouteTableRouteFromArgs(
  argsText: string,
  content: string,
  callOffset: number,
  argsOffset: number,
): AspNetRouteTableRouteMatch | null {
  const args = splitTopLevelCommaArgs(argsText);
  const namedArgs = new Map<string, string>();
  for (const arg of args) {
    const named = /^([A-Za-z_][\w]*)\s*:\s*([\s\S]+)$/.exec(arg);
    if (named?.[1] && named[2]) namedArgs.set(named[1].toLowerCase(), named[2].trim());
  }

  const routeArg = namedArgs.get('url')
    ?? namedArgs.get('routetemplate')
    ?? args[1];
  const defaultsArg = namedArgs.get('defaults') ?? args[2];
  const route = staticStringLiteralArg(routeArg);
  const controller = csharpObjectInitializerStringValue(defaultsArg, 'controller');
  const action = csharpObjectInitializerStringValue(defaultsArg, 'action');
  if (!route || !controller || !action) return null;
  if (!isConservativeAspNetRouteTablePath(route)) return null;

  const controllerName = controller.endsWith('Controller') ? controller : `${controller}Controller`;
  if (!/^[A-Za-z_][\w]*Controller$/.test(controllerName) || !/^[A-Za-z_][\w]*$/.test(action)) return null;

  return {
    method: 'ANY',
    route: normalizeRoutePath(route),
    handler: `${controllerName}#${action}`,
    lineNo: lineNumberAtOffset(content, callOffset),
    sourceLineNos: uniqueInOrder([
      lineNumberAtOffset(content, callOffset),
      lineNumberForArgText(content, argsText, argsOffset, routeArg),
      lineNumberForArgText(content, argsText, argsOffset, defaultsArg),
    ].filter((lineNo): lineNo is number => typeof lineNo === 'number')),
  };
}

function csharpObjectInitializerStringValue(value: string | undefined, property: string): string | null {
  const match = new RegExp(`\\b${property}\\s*=\\s*(['"])([^'"]+)\\1`, 'i').exec(value ?? '');
  return match?.[2]?.trim() || null;
}

function isConservativeAspNetRouteTablePath(route: string): boolean {
  const normalized = route.trim();
  return normalized.length > 0
    && !normalized.includes('${')
    && !normalized.includes('..')
    && !normalized.includes('*')
    && !/\{(?:controller|action)\}/i.test(normalized);
}

function lineNumberForArgText(
  content: string,
  argsText: string,
  argsOffset: number,
  argText: string | undefined,
): number | undefined {
  if (!argText) return undefined;
  const argOffset = argsText.indexOf(argText);
  return argOffset >= 0 ? lineNumberAtOffset(content, argsOffset + argOffset) : undefined;
}

function bootstrapEntrypointForFile(file: ScannedInventoryFile): InventoryEntrypoint | null {
  const base = basename(file.path);
  if (!/^(index|main|server|app)\.(ts|tsx|js|jsx|mjs|cjs|go|py|rb)$/i.test(base) && !/Application\.java$/.test(base)) {
    return null;
  }
  const lower = file.content.toLowerCase();
  if (!/(listen\s*\(|bootstrap|createapp|springapplication\.run|http\.listen|serve\()/i.test(lower)) return null;
  return {
    id: `entry_bootstrap_${slugify(file.path)}`,
    kind: 'app_bootstrap',
    label: `Application bootstrap: ${file.path}`,
    path: file.path,
    sourceRefs: [fileRef(file.path)],
    confidence: 0.7,
  };
}

function extractDomainEntities(
  files: ScannedInventoryFile[],
  symbols: InventorySymbol[],
): InventoryDomainEntity[] {
  const entities: InventoryDomainEntity[] = [];
  const seen = new Set<string>();
  for (const symbol of symbols) {
    const kind = domainKindFor(symbol.name, symbol.path);
    if (!kind) continue;
    const id = `domain_${slugify(symbol.path)}_${slugify(symbol.name)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    entities.push({
      id,
      name: symbol.name,
      kind,
      path: symbol.path,
      sourceRefs: symbol.sourceRefs,
      confidence: domainConfidence(symbol.name, symbol.path),
    });
  }

  for (const file of files) {
    if (isSqlSchemaPath(file.path)) {
      for (const entity of [
        ...sqlTableDomainEntitiesForFile(file),
        ...sqlViewDomainEntitiesForFile(file),
        ...sqlRoutineDomainEntitiesForFile(file),
      ]) {
        if (seen.has(entity.id)) continue;
        seen.add(entity.id);
        entities.push(entity);
      }
      continue;
    }
    const kind = domainKindFor(basenameWithoutExt(file.path), file.path);
    if (!kind) continue;
    const name = titleFromPath(file.path);
    if (entities.some((entity) => entity.path === file.path && entity.name === name)) continue;
    const id = `domain_${slugify(file.path)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    entities.push({
      id,
      name,
      kind,
      path: file.path,
      sourceRefs: [fileRef(file.path)],
      confidence: 0.6,
    });
  }
  return entities;
}

const SQL_IDENTIFIER_PATTERN = '(?:"[^"]+"|`[^`]+`|\\[[^\\]]+\\]|[A-Za-z_][\\w$]*)(?:\\s*\\.\\s*(?:"[^"]+"|`[^`]+`|\\[[^\\]]+\\]|[A-Za-z_][\\w$]*))?';

function sqlCreateViewPattern(): RegExp {
  return new RegExp(`\\bcreate\\s+(?:or\\s+(?:replace|alter)\\s+)?(?:materialized\\s+)?view\\s+(?:if\\s+not\\s+exists\\s+)?(${SQL_IDENTIFIER_PATTERN})`, 'gi');
}

function sqlCreateRoutinePattern(): RegExp {
  return new RegExp(`\\bcreate\\s+(?:or\\s+replace\\s+)?(?:procedure|proc|function)\\s+(${SQL_IDENTIFIER_PATTERN})`, 'gi');
}

function sqlTableDomainEntitiesForFile(file: ScannedInventoryFile): InventoryDomainEntity[] {
  const entities: InventoryDomainEntity[] = [];
  const tablePattern = /\bcreate\s+(?:temporary\s+|temp\s+)?table\s+(?:if\s+not\s+exists\s+)?((?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][\w$]*))?)/gi;
  for (const match of file.content.matchAll(tablePattern)) {
    const rawName = match[1];
    if (!rawName) continue;
    const tableIdentifier = sqlTableIdentifier(rawName);
    if (!tableIdentifier) continue;
    const lineNo = lineNumberAtOffset(file.content, match.index ?? 0);
    entities.push({
      id: `domain_table_${slugify(file.path)}_${slugify(tableIdentifier.tableName)}_${lineNo}`,
      name: tableIdentifier.tableName,
      kind: 'table',
      path: file.path,
      ...(tableIdentifier.schemaName ? { schemaName: tableIdentifier.schemaName } : {}),
      sourceRefs: [fileRef(file.path, lineNo)],
      confidence: 0.88,
    });
  }
  return dedupeById(entities);
}

function sqlViewDomainEntitiesForFile(file: ScannedInventoryFile): InventoryDomainEntity[] {
  const entities: InventoryDomainEntity[] = [];
  for (const match of file.content.matchAll(sqlCreateViewPattern())) {
    const rawName = match[1];
    if (!rawName) continue;
    const viewIdentifier = sqlTableIdentifier(rawName);
    if (!viewIdentifier) continue;
    const lineNo = lineNumberAtOffset(file.content, match.index ?? 0);
    entities.push({
      id: `domain_view_${slugify(file.path)}_${slugify(viewIdentifier.tableName)}_${lineNo}`,
      name: viewIdentifier.tableName,
      kind: 'view',
      path: file.path,
      ...(viewIdentifier.schemaName ? { schemaName: viewIdentifier.schemaName } : {}),
      sourceRefs: [fileRef(file.path, lineNo)],
      confidence: 0.84,
    });
  }
  return dedupeById(entities);
}

function sqlRoutineDomainEntitiesForFile(file: ScannedInventoryFile): InventoryDomainEntity[] {
  const entities: InventoryDomainEntity[] = [];
  for (const match of file.content.matchAll(sqlCreateRoutinePattern())) {
    const rawName = match[1];
    if (!rawName) continue;
    const routineIdentifier = sqlTableIdentifier(rawName);
    if (!routineIdentifier) continue;
    const lineNo = lineNumberAtOffset(file.content, match.index ?? 0);
    entities.push({
      id: `domain_routine_${slugify(file.path)}_${slugify(routineIdentifier.tableName)}_${lineNo}`,
      name: routineIdentifier.tableName,
      kind: 'routine',
      path: file.path,
      ...(routineIdentifier.schemaName ? { schemaName: routineIdentifier.schemaName } : {}),
      sourceRefs: [fileRef(file.path, lineNo)],
      confidence: 0.82,
    });
  }
  return dedupeById(entities);
}

function sqlTableName(rawName: string): string | null {
  return sqlTableIdentifier(rawName)?.tableName ?? null;
}

function sqlTableIdentifier(rawName: string): { schemaName?: string; tableName: string } | null {
  const parts = rawName.split(/\s*\.\s*/);
  if (parts.length === 0 || parts.length > 2 || parts.some((part) => part.trim() === '')) return null;
  const normalizedParts = parts.map((part) => sqlIdentifierPart(part));
  if (normalizedParts.some((part) => !part)) return null;
  const leaf = normalizedParts.at(-1);
  if (!leaf) return null;
  const schemaName = normalizedParts.length > 1 ? normalizedParts.at(-2) : undefined;
  return {
    ...(schemaName ? { schemaName } : {}),
    tableName: leaf,
  };
}

function sqlIdentifierPart(rawPart: string): string | null {
  const normalized = rawPart
    .trim()
    .replace(/^["`\[]/, '')
    .replace(/["`\]]$/, '');
  return /^[A-Za-z_][A-Za-z0-9_$]*$/.test(normalized) ? normalized : null;
}

function attachTableReferenceSourceRefs(
  entities: InventoryDomainEntity[],
  files: readonly ScannedInventoryFile[],
): InventoryDomainEntity[] {
  const hasTableEntities = entities.some((entity) => entity.kind === 'table');
  if (!hasTableEntities) return entities;

  return entities.map((entity) => {
    if (entity.kind !== 'table') return entity;
    const referenceSourceRefs = tableReferenceSourceRefs(entity, files);
    return referenceSourceRefs.length > 0 ? { ...entity, referenceSourceRefs } : entity;
  });
}

function tableReferenceSourceRefs(
  entity: InventoryDomainEntity,
  files: readonly ScannedInventoryFile[],
): string[] {
  const refs: string[] = [];
  for (const file of files) {
    if (file.path === entity.path) continue;
    if (!isSourceLikePath(file.path) || isTestFilePath(file.path)) continue;
    const lines = file.content.replace(/\r\n/g, '\n').split('\n');
    for (const [index, line] of lines.entries()) {
      if (!lineHasStaticTableReference(line, entity.name)) continue;
      refs.push(fileRef(file.path, index + 1));
    }
  }
  return uniqueSorted(refs);
}

function attachSqlForeignKeyRelationships(
  entities: InventoryDomainEntity[],
  files: readonly ScannedInventoryFile[],
): InventoryDomainEntity[] {
  const tableEntities = entities.filter((entity) => entity.kind === 'table');
  if (tableEntities.length < 2) return entities;

  const relationshipsByEntityId = new Map<string, InventoryDomainEntityRelationship[]>();
  for (const file of files) {
    if (!isSqlSchemaPath(file.path)) continue;
    for (const relationship of sqlForeignKeyRelationshipsForFile(file, tableEntities)) {
      relationshipsByEntityId.set(relationship.from.id, [
        ...(relationshipsByEntityId.get(relationship.from.id) ?? []),
        {
          kind: 'foreign_key',
          direction: 'references',
          domainEntityRef: relationship.to.id,
          name: relationship.to.name,
          sourceRefs: relationship.sourceRefs,
          confidence: 0.9,
        },
      ]);
      relationshipsByEntityId.set(relationship.to.id, [
        ...(relationshipsByEntityId.get(relationship.to.id) ?? []),
        {
          kind: 'foreign_key',
          direction: 'referenced_by',
          domainEntityRef: relationship.from.id,
          name: relationship.from.name,
          sourceRefs: relationship.sourceRefs,
          confidence: 0.9,
        },
      ]);
    }
  }

  if (relationshipsByEntityId.size === 0) return entities;
  return entities.map((entity) => {
    const relationships = dedupeDomainEntityRelationships(relationshipsByEntityId.get(entity.id) ?? []);
    return relationships.length > 0 ? { ...entity, relationships } : entity;
  });
}

function attachSqlJoinRelationships(
  entities: InventoryDomainEntity[],
  files: readonly ScannedInventoryFile[],
): InventoryDomainEntity[] {
  const tableEntities = entities.filter((entity) => entity.kind === 'table');
  if (tableEntities.length < 2) return entities;

  const relationshipsByEntityId = new Map<string, InventoryDomainEntityRelationship[]>();
  for (const file of files) {
    if (!isSqlJoinRelationshipCandidatePath(file.path)) continue;
    for (const relationship of sqlJoinRelationshipsForFile(file, tableEntities)) {
      relationshipsByEntityId.set(relationship.left.id, [
        ...(relationshipsByEntityId.get(relationship.left.id) ?? []),
        {
          kind: 'join',
          direction: 'joins',
          domainEntityRef: relationship.right.id,
          name: relationship.right.name,
          sourceRefs: relationship.sourceRefs,
          confidence: 0.82,
        },
      ]);
      relationshipsByEntityId.set(relationship.right.id, [
        ...(relationshipsByEntityId.get(relationship.right.id) ?? []),
        {
          kind: 'join',
          direction: 'joins',
          domainEntityRef: relationship.left.id,
          name: relationship.left.name,
          sourceRefs: relationship.sourceRefs,
          confidence: 0.82,
        },
      ]);
    }
  }

  if (relationshipsByEntityId.size === 0) return entities;
  return entities.map((entity) => {
    const relationships = dedupeDomainEntityRelationships([
      ...(entity.relationships ?? []),
      ...(relationshipsByEntityId.get(entity.id) ?? []),
    ]);
    return relationships.length > 0 ? { ...entity, relationships } : entity;
  });
}

function attachSqlViewDependencyRelationships(
  entities: InventoryDomainEntity[],
  files: readonly ScannedInventoryFile[],
): InventoryDomainEntity[] {
  const viewEntities = entities.filter((entity) => entity.kind === 'view');
  const tableEntities = entities.filter((entity) => entity.kind === 'table');
  if (viewEntities.length === 0 || tableEntities.length === 0) return entities;

  const relationshipsByEntityId = new Map<string, InventoryDomainEntityRelationship[]>();
  for (const file of files) {
    if (!isSqlSchemaPath(file.path)) continue;
    for (const relationship of sqlViewDependencyRelationshipsForFile(file, viewEntities, tableEntities)) {
      relationshipsByEntityId.set(relationship.view.id, [
        ...(relationshipsByEntityId.get(relationship.view.id) ?? []),
        {
          kind: 'view_dependency',
          direction: 'depends_on',
          domainEntityRef: relationship.table.id,
          name: relationship.table.name,
          sourceRefs: relationship.sourceRefs,
          confidence: 0.86,
        },
      ]);
      relationshipsByEntityId.set(relationship.table.id, [
        ...(relationshipsByEntityId.get(relationship.table.id) ?? []),
        {
          kind: 'view_dependency',
          direction: 'depended_on_by',
          domainEntityRef: relationship.view.id,
          name: relationship.view.name,
          sourceRefs: relationship.sourceRefs,
          confidence: 0.86,
        },
      ]);
    }
  }

  if (relationshipsByEntityId.size === 0) return entities;
  return entities.map((entity) => {
    const relationships = dedupeDomainEntityRelationships([
      ...(entity.relationships ?? []),
      ...(relationshipsByEntityId.get(entity.id) ?? []),
    ]);
    return relationships.length > 0 ? { ...entity, relationships } : entity;
  });
}

function attachSqlRoutineDependencyRelationships(
  entities: InventoryDomainEntity[],
  files: readonly ScannedInventoryFile[],
): InventoryDomainEntity[] {
  const routineEntities = entities.filter((entity) => entity.kind === 'routine');
  const tableEntities = entities.filter((entity) => entity.kind === 'table');
  if (routineEntities.length === 0 || tableEntities.length === 0) return entities;

  const relationshipsByEntityId = new Map<string, InventoryDomainEntityRelationship[]>();
  for (const file of files) {
    if (!isSqlSchemaPath(file.path)) continue;
    for (const relationship of sqlRoutineDependencyRelationshipsForFile(file, routineEntities, tableEntities)) {
      relationshipsByEntityId.set(relationship.routine.id, [
        ...(relationshipsByEntityId.get(relationship.routine.id) ?? []),
        {
          kind: 'routine_dependency',
          direction: 'depends_on',
          domainEntityRef: relationship.table.id,
          name: relationship.table.name,
          sourceRefs: relationship.sourceRefs,
          confidence: 0.84,
        },
      ]);
      relationshipsByEntityId.set(relationship.table.id, [
        ...(relationshipsByEntityId.get(relationship.table.id) ?? []),
        {
          kind: 'routine_dependency',
          direction: 'depended_on_by',
          domainEntityRef: relationship.routine.id,
          name: relationship.routine.name,
          sourceRefs: relationship.sourceRefs,
          confidence: 0.84,
        },
      ]);
    }
  }

  if (relationshipsByEntityId.size === 0) return entities;
  return entities.map((entity) => {
    const relationships = dedupeDomainEntityRelationships([
      ...(entity.relationships ?? []),
      ...(relationshipsByEntityId.get(entity.id) ?? []),
    ]);
    return relationships.length > 0 ? { ...entity, relationships } : entity;
  });
}

function sqlForeignKeyRelationshipsForFile(
  file: ScannedInventoryFile,
  tableEntities: readonly InventoryDomainEntity[],
): Array<{ from: InventoryDomainEntity; to: InventoryDomainEntity; sourceRefs: string[] }> {
  const relationships: Array<{ from: InventoryDomainEntity; to: InventoryDomainEntity; sourceRefs: string[] }> = [];
  const tablePattern = /\bcreate\s+(?:temporary\s+|temp\s+)?table\s+(?:if\s+not\s+exists\s+)?((?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][\w$]*))?)/gi;
  const referencePattern = /\breferences\s+((?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][\w$]*))?)\s*\(/gi;

  for (const match of file.content.matchAll(tablePattern)) {
    const rawName = match[1];
    const fromIdentifier = rawName ? sqlTableIdentifier(rawName) : null;
    if (!fromIdentifier) continue;
    const createOffset = match.index ?? 0;
    const createLine = lineNumberAtOffset(file.content, createOffset);
    const fromEntity = tableEntities.find((entity) => (
      entity.path === file.path
      && entity.name === fromIdentifier.tableName
      && stringArrayIncludes(entity.sourceRefs, fileRef(file.path, createLine))
    ));
    if (!fromEntity) continue;

    const statementEnd = file.content.indexOf(';', createOffset);
    if (statementEnd === -1) continue;
    const statement = file.content.slice(createOffset, statementEnd + 1);
    for (const referenceMatch of statement.matchAll(referencePattern)) {
      const rawReference = referenceMatch[1];
      const toIdentifier = rawReference ? sqlTableIdentifier(rawReference) : null;
      if (!toIdentifier) continue;
      const toEntity = resolveSqlTableEntity(toIdentifier, tableEntities, fromIdentifier.schemaName);
      if (!toEntity || toEntity.id === fromEntity.id) continue;
      const sourceRef = fileRef(file.path, lineNumberAtOffset(file.content, createOffset + (referenceMatch.index ?? 0)));
      relationships.push({ from: fromEntity, to: toEntity, sourceRefs: [sourceRef] });
    }
  }

  return relationships;
}

function sqlViewDependencyRelationshipsForFile(
  file: ScannedInventoryFile,
  viewEntities: readonly InventoryDomainEntity[],
  tableEntities: readonly InventoryDomainEntity[],
): Array<{ view: InventoryDomainEntity; table: InventoryDomainEntity; sourceRefs: string[] }> {
  const relationships: Array<{ view: InventoryDomainEntity; table: InventoryDomainEntity; sourceRefs: string[] }> = [];
  const normalizedContent = file.content.replace(/\r\n/g, '\n');

  for (const match of normalizedContent.matchAll(sqlCreateViewPattern())) {
    const rawName = match[1];
    const viewIdentifier = rawName ? sqlTableIdentifier(rawName) : null;
    if (!viewIdentifier) continue;
    const createOffset = match.index ?? 0;
    const createLine = lineNumberAtOffset(normalizedContent, createOffset);
    const viewEntity = viewEntities.find((entity) => (
      entity.path === file.path
      && entity.name === viewIdentifier.tableName
      && stringArrayIncludes(entity.sourceRefs, fileRef(file.path, createLine))
    ));
    if (!viewEntity) continue;

    const statementEnd = normalizedContent.indexOf(';', createOffset);
    const statementEndOffset = statementEnd === -1 ? normalizedContent.length : statementEnd + 1;
    const statement = normalizedContent.slice(createOffset, statementEndOffset);
    const defaultSchemaName = viewIdentifier.schemaName ?? viewEntity.schemaName;
    for (const tableReference of sqlTableReferencesInStatement(statement)) {
      const tableEntity = resolveSqlTableEntity(tableReference.identifier, tableEntities, defaultSchemaName);
      if (!tableEntity) continue;
      const sourceRef = fileRef(file.path, lineNumberAtOffset(normalizedContent, createOffset + tableReference.offset));
      relationships.push({ view: viewEntity, table: tableEntity, sourceRefs: [sourceRef] });
    }
  }

  return relationships;
}

function sqlRoutineDependencyRelationshipsForFile(
  file: ScannedInventoryFile,
  routineEntities: readonly InventoryDomainEntity[],
  tableEntities: readonly InventoryDomainEntity[],
): Array<{ routine: InventoryDomainEntity; table: InventoryDomainEntity; sourceRefs: string[] }> {
  const relationships: Array<{ routine: InventoryDomainEntity; table: InventoryDomainEntity; sourceRefs: string[] }> = [];
  const normalizedContent = file.content.replace(/\r\n/g, '\n');

  for (const match of normalizedContent.matchAll(sqlCreateRoutinePattern())) {
    const rawName = match[1];
    const routineIdentifier = rawName ? sqlTableIdentifier(rawName) : null;
    if (!routineIdentifier) continue;
    const createOffset = match.index ?? 0;
    const createLine = lineNumberAtOffset(normalizedContent, createOffset);
    const routineEntity = routineEntities.find((entity) => (
      entity.path === file.path
      && entity.name === routineIdentifier.tableName
      && stringArrayIncludes(entity.sourceRefs, fileRef(file.path, createLine))
    ));
    if (!routineEntity) continue;

    const routineEndOffset = sqlRoutineBodyEndOffset(normalizedContent, createOffset);
    const routineBody = normalizedContent.slice(createOffset, routineEndOffset);
    const defaultSchemaName = routineIdentifier.schemaName ?? routineEntity.schemaName;
    for (const tableReference of sqlRoutineTableReferencesInBody(routineBody)) {
      const tableEntity = resolveSqlTableEntity(tableReference.identifier, tableEntities, defaultSchemaName);
      if (!tableEntity) continue;
      const sourceRef = fileRef(file.path, lineNumberAtOffset(normalizedContent, createOffset + tableReference.offset));
      relationships.push({ routine: routineEntity, table: tableEntity, sourceRefs: [sourceRef] });
    }
  }

  return relationships;
}

function sqlJoinRelationshipsForFile(
  file: ScannedInventoryFile,
  tableEntities: readonly InventoryDomainEntity[],
): Array<{ left: InventoryDomainEntity; right: InventoryDomainEntity; sourceRefs: string[] }> {
  const relationships: Array<{ left: InventoryDomainEntity; right: InventoryDomainEntity; sourceRefs: string[] }> = [];
  const fromPattern = new RegExp(`\\bfrom\\s+(${SQL_IDENTIFIER_PATTERN})`, 'i');
  const joinPattern = new RegExp(`\\bjoin\\s+(${SQL_IDENTIFIER_PATTERN})`, 'gi');
  const normalizedContent = file.content.replace(/\r\n/g, '\n');
  const statementPattern = /[^;]+/g;

  for (const statementMatch of normalizedContent.matchAll(statementPattern)) {
    const statement = statementMatch[0];
    if (!/\bfrom\b/i.test(statement) || !/\bjoin\b/i.test(statement)) continue;
    const fromMatch = fromPattern.exec(statement);
    const rawFrom = fromMatch?.[1];
    const fromIdentifier = rawFrom ? sqlTableIdentifier(rawFrom) : null;
    if (!fromIdentifier) continue;
    const fromEntity = resolveSqlTableEntity(fromIdentifier, tableEntities);
    if (!fromEntity) continue;

    const defaultSchemaName = fromIdentifier.schemaName ?? fromEntity.schemaName;
    const statementOffset = statementMatch.index ?? 0;
    for (const joinMatch of statement.matchAll(joinPattern)) {
      const rawJoin = joinMatch[1];
      const joinIdentifier = rawJoin ? sqlTableIdentifier(rawJoin) : null;
      if (!joinIdentifier) continue;
      const joinEntity = resolveSqlTableEntity(joinIdentifier, tableEntities, defaultSchemaName);
      if (!joinEntity || joinEntity.id === fromEntity.id) continue;
      const sourceRef = fileRef(file.path, lineNumberAtOffset(normalizedContent, statementOffset + (joinMatch.index ?? 0)));
      relationships.push({ left: fromEntity, right: joinEntity, sourceRefs: [sourceRef] });
    }
  }

  return relationships;
}

function sqlRoutineBodyEndOffset(content: string, createOffset: number): number {
  const nextRoutinePattern = sqlCreateRoutinePattern();
  nextRoutinePattern.lastIndex = createOffset + 1;
  const nextRoutine = nextRoutinePattern.exec(content);
  return nextRoutine?.index ?? content.length;
}

function sqlRoutineTableReferencesInBody(
  body: string,
): Array<{ identifier: { schemaName?: string; tableName: string }; offset: number }> {
  const references: Array<{ identifier: { schemaName?: string; tableName: string }; offset: number }> = [];
  const maskedBody = maskSqlSingleQuotedLiterals(body);
  const tableReferencePattern = new RegExp(`\\b(?:from|join|update|insert\\s+into|delete\\s+from|merge\\s+into)\\s+(${SQL_IDENTIFIER_PATTERN})`, 'gi');
  for (const match of maskedBody.matchAll(tableReferencePattern)) {
    const rawName = match[1];
    const identifier = rawName ? sqlTableIdentifier(rawName) : null;
    if (!identifier) continue;
    references.push({
      identifier,
      offset: match.index ?? 0,
    });
  }
  return references;
}

function maskSqlSingleQuotedLiterals(content: string): string {
  let masked = '';
  let inString = false;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]!;
    const next = content[index + 1];
    if (inString) {
      if (char === "'" && next === "'") {
        masked += '  ';
        index += 1;
        continue;
      }
      if (char === "'") {
        inString = false;
        masked += ' ';
        continue;
      }
      masked += char === '\n' ? '\n' : ' ';
      continue;
    }
    if (char === "'") {
      inString = true;
      masked += ' ';
      continue;
    }
    masked += char;
  }
  return masked;
}

function sqlTableReferencesInStatement(
  statement: string,
): Array<{ identifier: { schemaName?: string; tableName: string }; offset: number }> {
  const references: Array<{ identifier: { schemaName?: string; tableName: string }; offset: number }> = [];
  const tableReferencePattern = new RegExp(`\\b(?:from|join)\\s+(${SQL_IDENTIFIER_PATTERN})`, 'gi');
  for (const match of statement.matchAll(tableReferencePattern)) {
    const rawName = match[1];
    const identifier = rawName ? sqlTableIdentifier(rawName) : null;
    if (!identifier) continue;
    references.push({
      identifier,
      offset: match.index ?? 0,
    });
  }
  return references;
}

function resolveSqlTableEntity(
  identifier: { schemaName?: string; tableName: string },
  tableEntities: readonly InventoryDomainEntity[],
  defaultSchemaName?: string,
): InventoryDomainEntity | null {
  const nameMatches = tableEntities.filter((entity) => equalsIgnoreCase(entity.name, identifier.tableName));
  if (nameMatches.length === 0) return null;
  if (identifier.schemaName) {
    const schemaMatches = nameMatches.filter((entity) => equalsIgnoreCase(entity.schemaName, identifier.schemaName));
    if (schemaMatches.length === 1) return schemaMatches[0]!;
    return null;
  }
  if (defaultSchemaName) {
    const sameSchemaMatches = nameMatches.filter((entity) => equalsIgnoreCase(entity.schemaName, defaultSchemaName));
    if (sameSchemaMatches.length === 1) return sameSchemaMatches[0]!;
  }
  return nameMatches.length === 1 ? nameMatches[0]! : null;
}

function dedupeDomainEntityRelationships(
  relationships: readonly InventoryDomainEntityRelationship[],
): InventoryDomainEntityRelationship[] {
  const byKey = new Map<string, InventoryDomainEntityRelationship>();
  for (const relationship of relationships) {
    const key = [
      relationship.kind,
      relationship.direction,
      relationship.domainEntityRef,
      relationship.sourceRefs.join('|'),
    ].join(':');
    if (!byKey.has(key)) byKey.set(key, relationship);
  }
  return [...byKey.values()].sort((a, b) => (
    a.direction.localeCompare(b.direction)
    || a.name.localeCompare(b.name)
    || a.domainEntityRef.localeCompare(b.domainEntityRef)
    || a.sourceRefs.join('|').localeCompare(b.sourceRefs.join('|'))
  ));
}

function equalsIgnoreCase(left: string | undefined, right: string | undefined): boolean {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function stringArrayIncludes(values: readonly string[], value: string): boolean {
  return values.some((item) => item === value);
}

function isSqlJoinRelationshipCandidatePath(path: string): boolean {
  if (isTestFilePath(path)) return false;
  return isSqlSchemaPath(path) || isSourceLikePath(path);
}

function lineHasStaticTableReference(line: string, tableName: string): boolean {
  const escapedTableName = escapeRegExp(tableName);
  const tableBoundary = new RegExp(`(^|[^A-Za-z0-9_$])${escapedTableName}(?=$|[^A-Za-z0-9_$])`, 'i');
  if (!tableBoundary.test(line)) return false;
  const tableSegment = `(?:"${escapedTableName}"|\`${escapedTableName}\`|\\[${escapedTableName}\\]|${escapedTableName})`;
  const schemaSegment = '(?:"[A-Za-z_][A-Za-z0-9_$]*"|`[A-Za-z_][A-Za-z0-9_$]*`|\\[[A-Za-z_][A-Za-z0-9_$]*\\]|[A-Za-z_][A-Za-z0-9_$]*)';
  const qualifiedTableReference = new RegExp(
    `(^|[^A-Za-z0-9_$])${schemaSegment}\\s*\\.\\s*${tableSegment}(?=$|[^A-Za-z0-9_$])`,
    'i',
  );
  const quotedLiteral = new RegExp(`["'\`]${escapedTableName}["'\`]`, 'i');
  if (quotedLiteral.test(line)) return true;
  const sqlReference = new RegExp(
    `\\b(?:from|join|into|update|table|truncate\\s+table|delete\\s+from)\\s+(?:${tableSegment}|${schemaSegment}\\s*\\.\\s*${tableSegment})(?=$|[^A-Za-z0-9_$])`,
    'i',
  );
  if (sqlReference.test(line)) return true;
  return /["'\`]/.test(line) && qualifiedTableReference.test(line);
}

function domainEntityEvidenceSourceRefs(entity: InventoryDomainEntity): string[] {
  return [
    ...entity.sourceRefs,
    ...(entity.referenceSourceRefs ?? []),
    ...(entity.relationships ?? []).flatMap((relationship) => relationship.sourceRefs),
  ];
}

function domainEntityReferenceRecords(
  entities: readonly InventoryDomainEntity[],
): Array<{ id: string; path: string; sourceRefs: string[] }> {
  return entities.flatMap((entity) => [
    ...(entity.referenceSourceRefs ?? []),
    ...(entity.relationships ?? []).flatMap((relationship) => relationship.sourceRefs),
  ]
    .map((sourceRef) => {
      const path = sourcePathFromRef(sourceRef);
      return path ? { id: entity.id, path, sourceRefs: [sourceRef] } : null;
    })
    .filter((record): record is { id: string; path: string; sourceRefs: string[] } => Boolean(record)));
}

function extractTestSurfaces(files: ScannedInventoryFile[]): InventoryTestSurface[] {
  const tests: InventoryTestSurface[] = [];
  for (const file of files) {
    if (!isTestFilePath(file.path)) continue;
    tests.push({
      id: `test_surface_${slugify(file.path)}`,
      path: file.path,
      frameworkHint: frameworkHint(file.path, file.content),
      targetHints: targetHintsForTestPath(file.path),
      sourceRefs: [fileRef(file.path)],
    });
  }
  return tests;
}

function buildHotspots(
  files: ScannedInventoryFile[],
  symbols: InventorySymbol[],
  entrypoints: InventoryEntrypoint[],
  git: InventoryGitSummary | null,
  limits: InventoryLimits,
): InventoryHotspot[] {
  const hotspots: InventoryHotspot[] = [];
  const symbolCounts = countByPath(symbols);
  const entrypointCounts = countByPath(entrypoints);

  for (const hotspot of git?.churnHotspots ?? []) {
    hotspots.push({
      id: `hot_git_churn_${slugify(hotspot.path)}`,
      path: hotspot.path,
      reason: 'git_churn',
      score: Math.min(1, hotspot.commitCount / 5),
      sourceRefs: [`git:churn:${hotspot.path}`],
    });
  }

  for (const file of files) {
    if (file.size >= Math.max(4096, limits.maxFileBytes * 0.75)) {
      hotspots.push({
        id: `hot_large_file_${slugify(file.path)}`,
        path: file.path,
        reason: 'large_file',
        score: Math.min(1, file.size / limits.maxFileBytes),
        sourceRefs: [fileRef(file.path)],
      });
    }
    const symbolCount = symbolCounts.get(file.path) ?? 0;
    if (symbolCount >= 5) {
      hotspots.push({
        id: `hot_symbol_dense_${slugify(file.path)}`,
        path: file.path,
        reason: 'symbol_dense',
        score: Math.min(1, symbolCount / 10),
        sourceRefs: [fileRef(file.path)],
      });
    }
    const entrypointCount = entrypointCounts.get(file.path) ?? 0;
    if (entrypointCount >= 2) {
      hotspots.push({
        id: `hot_entrypoint_dense_${slugify(file.path)}`,
        path: file.path,
        reason: 'entrypoint_dense',
        score: Math.min(1, entrypointCount / 5),
        sourceRefs: [fileRef(file.path)],
      });
    }
  }
  return dedupeById(hotspots);
}

function buildCapabilities(input: {
  entrypoints: InventoryEntrypoint[];
  modules: InventoryModule[];
  symbols: InventorySymbol[];
  domainEntities: InventoryDomainEntity[];
  symbolGraph: InventorySymbolGraph;
  testSurfaces: InventoryTestSurface[];
  hotspots: InventoryHotspot[];
}): InventoryCapability[] {
  const groups = new Map<string, InventoryEntrypoint[]>();
  for (const entrypoint of input.entrypoints) {
    const key = capabilityKeyForEntrypoint(entrypoint);
    groups.set(key, [...(groups.get(key) ?? []), entrypoint]);
  }

  const capabilities: InventoryCapability[] = [];
  for (const [key, entrypoints] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const token = key.split(':').at(-1) ?? key;
    const entrypointPaths = new Set(entrypoints.map((entrypoint) => entrypoint.path));
    const graphEvidence = symbolGraphEvidenceForEntrypoints(input.symbolGraph, entrypoints);
    const graphSymbolPaths = new Set(input.symbols
      .filter((symbol) => graphEvidence.symbolRefs.has(symbol.id))
      .map((symbol) => symbol.path));
    const modules = input.modules.filter((module) => [...entrypointPaths].some((path) => path.startsWith(module.path)));
    const symbols = input.symbols.filter((symbol) =>
      graphEvidence.symbolRefs.has(symbol.id)
      || entrypointHandlerMatchesSymbol(entrypoints, symbol)
      || includesToken(symbol.name, token)
      || includesToken(symbol.signature, token)
    );
    const domainEntities = input.domainEntities.filter((entity) =>
      graphSymbolPaths.has(entity.path)
      || includesToken(entity.name, token)
      || includesToken(entity.path, token)
    );
    const tests = input.testSurfaces.filter((test) =>
      includesToken(test.path, token) || test.targetHints.some((hint) => includesToken(hint, token))
    );
    const hotspots = input.hotspots.filter((hotspot) =>
      entrypointPaths.has(hotspot.path) || includesToken(hotspot.path, token)
    );
    const sourceRefs = uniqueSorted([
      ...entrypoints.flatMap((entrypoint) => entrypoint.sourceRefs),
      ...graphEvidence.sourceRefs,
      ...modules.flatMap((module) => module.evidenceRefs),
      ...symbols.flatMap((symbol) => symbol.sourceRefs),
      ...domainEntities.flatMap(domainEntityEvidenceSourceRefs),
      ...tests.flatMap((test) => test.sourceRefs),
      ...hotspots.flatMap((hotspot) => hotspot.sourceRefs),
    ]);
    const openQuestions: string[] = [];
    if (tests.length === 0) openQuestions.push(`No direct test surface detected for ${humanizeToken(token)}.`);
    if (entrypoints.some((entrypoint) => entrypoint.confidence < 0.75)) {
      openQuestions.push('Entrypoint was inferred from path/name heuristics and should be reviewed.');
    }
    capabilities.push({
      id: `cap_${slugify(key)}`,
      label: capabilityLabel(key, entrypoints),
      kind: capabilityKind(entrypoints),
      entrypointRefs: entrypoints.map((entrypoint) => entrypoint.id).sort(),
      moduleRefs: modules.map((module) => module.id).sort(),
      symbolRefs: symbols.map((symbol) => symbol.id).sort(),
      domainEntityRefs: domainEntities.map((entity) => entity.id).sort(),
      testRefs: tests.map((test) => test.id).sort(),
      hotspotRefs: hotspots.map((hotspot) => hotspot.id).sort(),
      sourceRefs,
      confidence: capabilityConfidence(entrypoints, symbols, tests),
      openQuestions,
    });
  }

  return capabilities;
}

function entrypointHandlerMatchesSymbol(
  entrypoints: readonly InventoryEntrypoint[],
  symbol: InventorySymbol,
): boolean {
  return entrypoints.some((entrypoint) => {
    if (entrypoint.path !== symbol.path || !entrypoint.handler) return false;
    const handlerName = entrypoint.handler.split('#').at(-1) ?? entrypoint.handler;
    return handlerName === symbol.name;
  });
}

const CAPABILITY_GRAPH_MAX_DEPTH = 4;
const CAPABILITY_GRAPH_MAX_SYMBOLS = 24;

function symbolGraphEvidenceForEntrypoints(
  symbolGraph: InventorySymbolGraph,
  entrypoints: readonly InventoryEntrypoint[],
): { symbolRefs: Set<string>; sourceRefs: string[] } {
  const nodesById = new Map(symbolGraph.nodes.map((node) => [node.id, node]));
  const edgesByFrom = new Map<string, InventorySymbolGraphEdge[]>();
  for (const edge of symbolGraph.edges) {
    if (edge.kind !== 'route_handler' && edge.kind !== 'symbol_reference') continue;
    edgesByFrom.set(edge.from, [...(edgesByFrom.get(edge.from) ?? []), edge]);
  }
  for (const edges of edgesByFrom.values()) {
    edges.sort((a, b) => a.kind.localeCompare(b.kind) || a.to.localeCompare(b.to) || a.id.localeCompare(b.id));
  }

  const symbolRefs = new Set<string>();
  const sourceRefs: string[] = [];
  const queue = entrypoints
    .map((entrypoint) => `node_entrypoint_${entrypoint.id}`)
    .filter((nodeId) => nodesById.has(nodeId))
    .sort((a, b) => a.localeCompare(b))
    .map((nodeId) => ({ nodeId, depth: 0 }));
  const visited = new Set(queue.map((item) => item.nodeId));

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]!;
    if (current.depth >= CAPABILITY_GRAPH_MAX_DEPTH) continue;

    for (const edge of edgesByFrom.get(current.nodeId) ?? []) {
      const target = nodesById.get(edge.to);
      if (!target) continue;
      const isNewSymbol = target.kind === 'symbol' && !symbolRefs.has(target.ref);
      if (isNewSymbol && symbolRefs.size >= CAPABILITY_GRAPH_MAX_SYMBOLS) continue;
      sourceRefs.push(...edge.sourceRefs);
      if (target.kind === 'symbol' && target.sourceRefs.length > 0) {
        symbolRefs.add(target.ref);
        sourceRefs.push(...target.sourceRefs);
      }
      if (visited.has(edge.to)) continue;
      visited.add(edge.to);
      queue.push({ nodeId: edge.to, depth: current.depth + 1 });
    }
  }

  return { symbolRefs, sourceRefs: uniqueSorted(sourceRefs) };
}

const SOURCE_CHUNK_CONTEXT_LINES = 8;
const SOURCE_CHUNK_MAX_LINES = 24;
const SOURCE_CHUNK_MAX_CHARS = 1600;
const SOURCE_CHUNK_MAX_PER_FILE = 4;
const SOURCE_CHUNK_MAX_TOTAL = 120;
const SOURCE_CHUNK_INDEX_MAX_LEXICAL_TOKENS = 80;
const SOURCE_CHUNK_INDEX_MAX_SEARCH_TEXT_CHARS = 512;
const SOURCE_CHUNK_INDEX_LEXICAL_STOP_WORDS = new Set([
  'and',
  'any',
  'async',
  'await',
  'boolean',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'default',
  'else',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'from',
  'function',
  'if',
  'import',
  'implements',
  'interface',
  'let',
  'new',
  'null',
  'number',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'string',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'type',
  'undefined',
  'using',
  'var',
  'void',
  'while',
]);

function buildSourceChunks(input: {
  files: ScannedInventoryFile[];
  entrypoints: InventoryEntrypoint[];
  symbols: InventorySymbol[];
  domainEntities: InventoryDomainEntity[];
  symbolGraph: InventorySymbolGraph;
  testSurfaces: InventoryTestSurface[];
  hotspots: InventoryHotspot[];
  capabilities: InventoryCapability[];
}): InventorySourceChunk[] {
  const chunks: InventorySourceChunk[] = [];
  const entrypointsByPath = groupRecordsByPath(input.entrypoints);
  const symbolsByPath = groupRecordsByPath(input.symbols);
  const domainEntitiesByPath = groupRecordsByPath(input.domainEntities);
  const domainEntityReferencesByPath = groupRecordsByPath(domainEntityReferenceRecords(input.domainEntities));
  const graphEdgesByPath = groupGraphEdgesBySourcePath(input.symbolGraph.edges);
  const testsByPath = groupRecordsByPath(input.testSurfaces);
  const hotspotsByPath = groupRecordsByPath(input.hotspots);

  for (const file of input.files) {
    if (!isCodeIntelligenceCandidate(file.path)) continue;
    const lines = file.content.replace(/\r\n/g, '\n').split('\n');
    const recordAnchors = uniqueSorted([
      ...lineAnchorsForRecords(entrypointsByPath.get(file.path) ?? []),
      ...lineAnchorsForRecords(symbolsByPath.get(file.path) ?? []),
      ...lineAnchorsForRecords(domainEntitiesByPath.get(file.path) ?? []),
      ...lineAnchorsForRecords(domainEntityReferencesByPath.get(file.path) ?? []),
      ...lineAnchorsForRecords(graphEdgesByPath.get(file.path) ?? []),
      ...lineAnchorsForRecords(testsByPath.get(file.path) ?? []),
      ...lineAnchorsForRecords(hotspotsByPath.get(file.path) ?? []),
    ].map(String)).map(Number).filter((line) => Number.isFinite(line) && line > 0);
    const anchors = recordAnchors.length > 0 ? recordAnchors : [1];
    const windows = sourceChunkWindows(anchors, lines.length).slice(0, SOURCE_CHUNK_MAX_PER_FILE);

    for (const window of windows) {
      if (chunks.length >= SOURCE_CHUNK_MAX_TOTAL) return dedupeById(chunks);
      const entrypointRefs = recordsInWindow(entrypointsByPath.get(file.path) ?? [], window).map((record) => record.id).sort();
      const symbolRefs = recordsInWindow(symbolsByPath.get(file.path) ?? [], window).map((record) => record.id).sort();
      const domainEntityRefs = uniqueSorted([
        ...recordsInWindow(domainEntitiesByPath.get(file.path) ?? [], window).map((record) => record.id),
        ...recordsInWindow(domainEntityReferencesByPath.get(file.path) ?? [], window).map((record) => record.id),
      ]);
      const graphEdges = recordsInWindow(graphEdgesByPath.get(file.path) ?? [], window);
      const graphEdgeRefs = graphEdges.map((record) => record.id).sort();
      const testRefs = recordsInWindow(testsByPath.get(file.path) ?? [], window).map((record) => record.id).sort();
      const hotspotRefs = recordsInWindow(hotspotsByPath.get(file.path) ?? [], window).map((record) => record.id).sort();
      const relatedRefs = new Set([
        ...entrypointRefs,
        ...symbolRefs,
        ...domainEntityRefs,
        ...graphEdges.flatMap(graphEdgeInventoryRefs),
        ...testRefs,
        ...hotspotRefs,
      ]);
      const capabilityRefs = input.capabilities
        .filter((capability) => [
          ...capability.entrypointRefs,
          ...capability.symbolRefs,
          ...capability.domainEntityRefs,
          ...capability.testRefs,
          ...capability.hotspotRefs,
        ].some((ref) => relatedRefs.has(ref)))
        .map((capability) => capability.id)
        .sort();
      const recordSourceRefs = sourceRefsForWindow([
        ...(entrypointsByPath.get(file.path) ?? []),
        ...(symbolsByPath.get(file.path) ?? []),
        ...(domainEntitiesByPath.get(file.path) ?? []),
        ...(domainEntityReferencesByPath.get(file.path) ?? []),
        ...(graphEdgesByPath.get(file.path) ?? []),
        ...(testsByPath.get(file.path) ?? []),
        ...(hotspotsByPath.get(file.path) ?? []),
      ], window);
      const snippet = sourceChunkSnippet(lines, window);
      const content = sourceChunkContent(lines, window);
      if (!snippet.trim() || !content.trim()) continue;

      chunks.push({
        id: `src_chunk_${slugify(file.path)}_${window.startLine}_${window.endLine}`,
        path: file.path,
        language: languageHintForPath(file.path),
        startLine: window.startLine,
        endLine: window.endLine,
        snippet,
        contentSha256: createHash('sha256').update(content).digest('hex'),
        sourceRefs: uniqueSorted([
          fileRef(file.path, window.startLine),
          fileRef(file.path, window.endLine),
          ...recordSourceRefs,
        ]),
        entrypointRefs,
        symbolRefs,
        domainEntityRefs,
        graphEdgeRefs,
        testRefs,
        hotspotRefs,
        capabilityRefs,
        sha256: createHash('sha256').update(snippet).digest('hex'),
        confidence: relatedRefs.size > 0 ? 0.75 : 0.55,
      });
    }
  }

  return dedupeById(chunks);
}

async function buildSourceChunkIndex(
  chunks: readonly InventorySourceChunk[],
  generatedAt: string,
  provider: SourceChunkIndexEmbeddingProvider | null,
): Promise<InventorySourceChunkIndex> {
  const entries = (await Promise.all(chunks.map(async (chunk): Promise<InventorySourceChunkIndexEntry> => {
    const lexicalTokens = sourceChunkIndexLexicalTokens(chunk);
    const searchText = sourceChunkIndexSearchText(lexicalTokens);
    return {
      id: `src_chunk_idx_${chunk.contentSha256.slice(0, 16)}_${slugify(chunk.path)}_${chunk.startLine}_${chunk.endLine}`,
      sourceChunkRef: chunk.id,
      contentSha256: chunk.contentSha256,
      path: chunk.path,
      language: chunk.language,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      lexicalTokens,
      searchText,
      embedding: await sourceChunkIndexEmbeddingForText(
        sourceChunkIndexEmbeddingText(lexicalTokens, searchText),
        { kind: 'source_chunk_index', provider },
      ),
      linkedRecordRefs: sourceChunkLinkedRecordRefs(chunk),
      sourceRefs: uniqueSorted(chunk.sourceRefs),
      entrypointRefs: uniqueSorted(chunk.entrypointRefs),
      symbolRefs: uniqueSorted(chunk.symbolRefs),
      domainEntityRefs: uniqueSorted(chunk.domainEntityRefs),
      graphEdgeRefs: uniqueSorted(chunk.graphEdgeRefs),
      testRefs: uniqueSorted(chunk.testRefs),
      hotspotRefs: uniqueSorted(chunk.hotspotRefs),
      capabilityRefs: uniqueSorted(chunk.capabilityRefs),
    };
  }))).sort((a, b) => (
    a.contentSha256.localeCompare(b.contentSha256)
    || a.path.localeCompare(b.path)
    || a.startLine - b.startLine
    || a.endLine - b.endLine
    || a.sourceChunkRef.localeCompare(b.sourceChunkRef)
  ));

  return {
    schemaVersion: 'ainp.source_chunk_index.v1',
    generatedAt,
    source: 'project_inventory.sourceChunks',
    chunkCount: chunks.length,
    maxEntries: SOURCE_CHUNK_MAX_TOTAL,
    entries,
  };
}

function sourceChunkIndexLexicalTokens(chunk: InventorySourceChunk): string[] {
  const normalized = [
    chunk.path,
    sourceChunkLineLabelFreeSnippet(chunk.snippet),
  ].join('\n')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return [];

  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const token of normalized.split(' ')) {
    if (tokens.length >= SOURCE_CHUNK_INDEX_MAX_LEXICAL_TOKENS) break;
    if (token.length < 3) continue;
    if (/^\d+$/.test(token)) continue;
    if (SOURCE_CHUNK_INDEX_LEXICAL_STOP_WORDS.has(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }
  return tokens;
}

function sourceChunkLineLabelFreeSnippet(snippet: string): string {
  return snippet
    .split('\n')
    .map((line) => /^L\d+:\s*(.*)$/.exec(line)?.[1] ?? line)
    .join('\n');
}

function sourceChunkIndexSearchText(tokens: readonly string[]): string {
  const selected: string[] = [];
  let length = 0;
  for (const token of tokens) {
    const nextLength = length + (selected.length > 0 ? 1 : 0) + token.length;
    if (nextLength > SOURCE_CHUNK_INDEX_MAX_SEARCH_TEXT_CHARS) break;
    selected.push(token);
    length = nextLength;
  }
  return selected.join(' ');
}

function sourceChunkIndexEmbeddingText(tokens: readonly string[], searchText: string): string {
  return [searchText, ...tokens].filter(Boolean).join(' ');
}

function sourceChunkLinkedRecordRefs(chunk: InventorySourceChunk): string[] {
  return uniqueSorted([
    ...chunk.entrypointRefs,
    ...chunk.symbolRefs,
    ...chunk.domainEntityRefs,
    ...chunk.graphEdgeRefs,
    ...chunk.testRefs,
    ...chunk.hotspotRefs,
    ...chunk.capabilityRefs,
  ]);
}

function sourceChunkRefsByInventoryRecordId(
  chunks: readonly InventorySourceChunk[],
): Map<string, string[]> {
  const refsByRecordId = new Map<string, string[]>();
  for (const chunk of chunks) {
    for (const recordId of [
      ...chunk.entrypointRefs,
      ...chunk.symbolRefs,
      ...chunk.domainEntityRefs,
      ...chunk.graphEdgeRefs,
      ...chunk.testRefs,
      ...chunk.hotspotRefs,
      ...chunk.capabilityRefs,
    ]) {
      refsByRecordId.set(recordId, [...(refsByRecordId.get(recordId) ?? []), chunk.id]);
    }
  }
  return new Map([...refsByRecordId.entries()].map(([recordId, refs]) => [
    recordId,
    uniqueSorted(refs),
  ]));
}

function attachSourceChunkRefs<T extends { id: string }>(
  records: readonly T[],
  refsByRecordId: ReadonlyMap<string, string[]>,
): T[] {
  return records.map((record) => {
    const sourceChunkRefs = refsByRecordId.get(record.id);
    return sourceChunkRefs?.length ? { ...record, sourceChunkRefs } : record;
  });
}

function attachSourceChunkRefsToNode(
  node: InventorySymbolGraphNode,
  refsByRecordId: ReadonlyMap<string, string[]>,
): InventorySymbolGraphNode {
  const sourceChunkRefs = refsByRecordId.get(node.ref);
  return sourceChunkRefs?.length ? { ...node, sourceChunkRefs } : node;
}

function groupRecordsByPath<T extends { path: string }>(records: readonly T[]): Map<string, T[]> {
  const byPath = new Map<string, T[]>();
  for (const record of records) {
    byPath.set(record.path, [...(byPath.get(record.path) ?? []), record]);
  }
  return byPath;
}

function groupGraphEdgesBySourcePath(
  edges: readonly InventorySymbolGraphEdge[],
): Map<string, Array<InventorySymbolGraphEdge & { path: string }>> {
  const byPath = new Map<string, Array<InventorySymbolGraphEdge & { path: string }>>();
  for (const edge of edges) {
    const refsByPath = new Map<string, string[]>();
    for (const sourceRef of edge.sourceRefs) {
      const path = sourcePathFromRef(sourceRef);
      if (!path) continue;
      refsByPath.set(path, [...(refsByPath.get(path) ?? []), sourceRef]);
    }
    for (const [path, sourceRefs] of refsByPath.entries()) {
      byPath.set(path, [...(byPath.get(path) ?? []), { ...edge, path, sourceRefs }]);
    }
  }
  return byPath;
}

function graphEdgeInventoryRefs(edge: InventorySymbolGraphEdge): string[] {
  return [edge.from, edge.to].map((nodeRef) => (
    nodeRef.startsWith('node_entrypoint_')
      ? nodeRef.slice('node_entrypoint_'.length)
      : nodeRef.startsWith('node_symbol_')
        ? nodeRef.slice('node_symbol_'.length)
        : ''
  )).filter(Boolean);
}

function lineAnchorsForRecords(records: readonly { sourceRefs: string[]; line?: number }[]): number[] {
  return records.flatMap((record) => [
    typeof record.line === 'number' ? record.line : null,
    ...record.sourceRefs.map(lineFromSourceRef),
  ]).filter((line): line is number => typeof line === 'number' && Number.isFinite(line));
}

function sourceChunkWindows(
  anchors: readonly number[],
  lineCount: number,
): Array<{ startLine: number; endLine: number }> {
  if (lineCount <= 0) return [];
  const sortedAnchors = [...new Set(anchors)].sort((a, b) => a - b);
  const windows: Array<{ startLine: number; endLine: number }> = [];
  for (const anchor of sortedAnchors) {
    const startLine = Math.max(1, anchor - SOURCE_CHUNK_CONTEXT_LINES);
    const endLine = Math.min(lineCount, startLine + SOURCE_CHUNK_MAX_LINES - 1);
    const window = { startLine, endLine };
    const previous = windows.at(-1);
    if (previous && window.startLine <= previous.endLine + 2) {
      const mergedEndLine = Math.min(lineCount, Math.max(previous.endLine, window.endLine));
      if (mergedEndLine - previous.startLine + 1 <= SOURCE_CHUNK_MAX_LINES) {
        previous.endLine = mergedEndLine;
        continue;
      }
    }
    windows.push(window);
  }
  return windows;
}

function recordsInWindow<T extends { sourceRefs: string[]; line?: number }>(
  records: readonly T[],
  window: { startLine: number; endLine: number },
): T[] {
  return records.filter((record) => (
    recordLines(record).some((line) => line >= window.startLine && line <= window.endLine)
  ));
}

function sourceRefsForWindow(
  records: readonly { sourceRefs: string[]; line?: number }[],
  window: { startLine: number; endLine: number },
): string[] {
  return recordsInWindow(records, window).flatMap((record) => record.sourceRefs);
}

function recordLines(record: { sourceRefs: string[]; line?: number }): number[] {
  return [
    typeof record.line === 'number' ? record.line : null,
    ...record.sourceRefs.map(lineFromSourceRef),
  ].filter((line): line is number => typeof line === 'number' && Number.isFinite(line));
}

function sourceChunkSnippet(
  lines: readonly string[],
  window: { startLine: number; endLine: number },
): string {
  const snippet = lines
    .slice(window.startLine - 1, window.endLine)
    .map((line, index) => `L${window.startLine + index}: ${line}`)
    .join('\n')
    .trim();
  return excerpt(snippet, SOURCE_CHUNK_MAX_CHARS);
}

function sourceChunkContent(
  lines: readonly string[],
  window: { startLine: number; endLine: number },
): string {
  const content = lines
    .slice(window.startLine - 1, window.endLine)
    .join('\n')
    .trim();
  return excerpt(content, SOURCE_CHUNK_MAX_CHARS);
}

function languageHintForPath(path: string): string | null {
  const extension = path.split('.').at(-1)?.toLowerCase();
  switch (extension) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'typescript/javascript';
    case 'py':
      return 'python';
    case 'go':
      return 'go';
    case 'rb':
      return 'ruby';
    case 'php':
    case 'module':
      return 'php';
    case 'java':
    case 'kt':
      return 'jvm';
    case 'cs':
      return 'csharp';
    case 'asp':
      return 'classic-asp';
    case 'cfm':
    case 'cfml':
      return 'coldfusion';
    case 'aspx':
      return 'aspnet-webforms';
    case 'jsp':
      return 'jsp';
    case 'yml':
    case 'yaml':
      return 'yaml';
    case 'sql':
      return 'sql';
    case 'c':
    case 'h':
    case 'cpp':
      return 'cpp';
    default:
      return null;
  }
}

function isSourceLikePath(path: string): boolean {
  return /\.(ts|tsx|js|jsx|mjs|cjs|java|kt|go|rs|py|rb|cs|cpp|c|h)$/i.test(path)
    || isPhpSourceLikePath(path);
}

function isPhpSourceLikePath(path: string): boolean {
  return /\.(php|module)$/i.test(path);
}

function isDrupalModulePath(path: string): boolean {
  return /\.module$/i.test(path);
}

function isRouteConfigPath(path: string): boolean {
  return isStrutsConfigPath(path)
    || isWebXmlConfigPath(path)
    || isSpringMvcXmlConfigPath(path)
    || isPlayRoutesConfigPath(path)
    || isSymfonyYamlRouteConfigPath(path)
    || isSymfonyXmlRouteConfigPath(path);
}

function isStrutsConfigPath(path: string): boolean {
  const base = basename(path).toLowerCase();
  return base === 'struts.xml'
    || base === 'struts2.xml'
    || base === 'struts-config.xml'
    || /^struts-[a-z0-9_.-]+\.xml$/.test(base);
}

function isWebXmlConfigPath(path: string): boolean {
  return basename(path).toLowerCase() === 'web.xml';
}

function isSpringMvcXmlConfigPath(path: string): boolean {
  const lower = path.toLowerCase();
  const base = basename(lower);
  return /\.xml$/.test(lower)
    && (
      base === 'applicationcontext.xml'
      || /(?:^|[-_.])servlet\.xml$/.test(base)
      || lower.includes('/spring/')
      || lower.includes('/web-inf/')
    );
}

function isPlayRoutesConfigPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').toLowerCase();
  return normalized === 'conf/routes'
    || normalized.endsWith('/conf/routes');
}

function isCodeIgniterRouteConfigPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').toLowerCase();
  return normalized === 'application/config/routes.php'
    || normalized.endsWith('/application/config/routes.php');
}

function isCakePhpRouteConfigPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').toLowerCase();
  return normalized === 'app/config/routes.php'
    || normalized.endsWith('/app/config/routes.php')
    || normalized === 'config/routes.php'
    || normalized.endsWith('/config/routes.php');
}

function isYiiRouteConfigPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').toLowerCase();
  const suffixes = [
    'config/web.php',
    'config/main.php',
    'common/config/main.php',
    'frontend/config/main.php',
    'backend/config/main.php',
    'protected/config/main.php',
  ];
  return suffixes.some((suffix) => normalized === suffix || normalized.endsWith(`/${suffix}`));
}

function isZendFrameworkIniRouteConfigPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').toLowerCase();
  const suffixes = [
    'application/configs/application.ini',
    'application/config/application.ini',
    'config/application.ini',
    'configs/application.ini',
  ];
  return suffixes.some((suffix) => normalized === suffix || normalized.endsWith(`/${suffix}`));
}

function isSymfonyYamlRouteConfigPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').toLowerCase();
  return normalized === 'app/config/routing.yml'
    || normalized.endsWith('/app/config/routing.yml')
    || normalized === 'app/config/routing.yaml'
    || normalized.endsWith('/app/config/routing.yaml')
    || normalized === 'config/routes.yaml'
    || normalized.endsWith('/config/routes.yaml')
    || normalized === 'config/routes.yml'
    || normalized.endsWith('/config/routes.yml');
}

function isSymfonyXmlRouteConfigPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').toLowerCase();
  return normalized === 'app/config/routing.xml'
    || normalized.endsWith('/app/config/routing.xml')
    || normalized === 'config/routes.xml'
    || normalized.endsWith('/config/routes.xml');
}

function isCodeIntelligenceCandidate(path: string): boolean {
  return isSourceLikePath(path)
    || isSqlSchemaPath(path)
    || isYiiRouteConfigPath(path)
    || isZendFrameworkIniRouteConfigPath(path)
    || isSymfonyYamlRouteConfigPath(path)
    || isSymfonyXmlRouteConfigPath(path)
    || isTestFilePath(path)
    || isAspNetWebFormsPagePath(path)
    || isWcfServiceHostPath(path)
    || isJspPagePath(path)
    || isClassicAspPagePath(path)
    || isColdFusionPagePath(path);
}

function isSqlSchemaPath(path: string): boolean {
  return /\.sql$/i.test(path);
}

function isAspNetWebFormsPagePath(path: string): boolean {
  return /\.aspx$/i.test(path);
}

function isWcfServiceHostPath(path: string): boolean {
  return /\.svc$/i.test(path);
}

function isWcfServiceModelConfigPath(path: string): boolean {
  const base = basename(path).toLowerCase();
  return base === 'web.config' || base === 'app.config' || base.endsWith('.config');
}

function isWcfServiceModelConfigFile(path: string, content: string): boolean {
  return isWcfServiceModelConfigPath(path) && /<system\.serviceModel\b/i.test(content);
}

function isJspPagePath(path: string): boolean {
  return /\.jsp$/i.test(path);
}

function isClassicAspPagePath(path: string): boolean {
  return /\.asp$/i.test(path);
}

function isColdFusionPagePath(path: string): boolean {
  return /\.(cfm|cfml)$/i.test(path);
}

const RESERVED_SYMBOL_NAMES = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'describe',
  'it',
  'test',
]);

function fileRef(path: string, line?: number): string {
  return line ? `file:${path}#L${line}` : `file:${path}`;
}

function sourcePathFromRef(ref: string | undefined): string | null {
  if (!ref?.startsWith('file:')) return null;
  return ref.slice('file:'.length).split('#L')[0] || null;
}

function lineFromSourceRef(ref: string | null | undefined): number | null {
  const text = ref ?? '';
  const match = /#L(\d+)\b/.exec(text);
  if (!match?.[1]) return text.startsWith('file:') ? 1 : null;
  const line = Number(match[1]);
  return Number.isFinite(line) ? line : null;
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result;
}

const NON_CAPABILITY_SCRIPTS = new Set([
  'build',
  'check',
  'ci',
  'format',
  'lint',
  'test',
  'typecheck',
]);

const CAPABILITY_SCRIPT_NAMES = /^(start|dev|serve|server|worker|watch|migrate|migration|seed|import|export|sync|ingest|index|crawl)(:|$)/i;

function isCapabilityScript(name: string): boolean {
  const normalized = name.toLowerCase();
  if (NON_CAPABILITY_SCRIPTS.has(normalized)) return false;
  return CAPABILITY_SCRIPT_NAMES.test(normalized);
}

function methodFromDecorator(name: string, args = ''): string {
  const normalized = name.toLowerCase().replace('mapping', '');
  if (normalized === 'request') return requestMethodFromDecoratorArgs(args) ?? 'ANY';
  return normalized.toUpperCase();
}

function routeFromDecoratorArgs(args: string): string {
  const valueMatch = /(?:value|path)\s*=\s*['"`]([^'"`]+)['"`]/i.exec(args);
  if (valueMatch?.[1]) return valueMatch[1];
  const firstString = /['"`]([^'"`]+)['"`]/.exec(args);
  return firstString?.[1]?.trim() || '/';
}

function requestMethodFromDecoratorArgs(args: string): string | null {
  const requestMethod = /RequestMethod\.([A-Z]+)/.exec(args);
  if (requestMethod?.[1]) return requestMethod[1];
  const methodString = /method\s*=\s*['"`]([A-Za-z]+)['"`]/i.exec(args);
  if (methodString?.[1]) return methodString[1].toUpperCase();
  return null;
}

function methodsFromList(value: string | undefined): string[] {
  if (!value) return [];
  return [...value.matchAll(/['"`]([A-Za-z]+)['"`]/g)].map((match) => match[1]!.toUpperCase());
}

function goHttpMethodsFromArgs(value: string | undefined): string[] {
  if (!value) return [];
  return uniqueInOrder([
    ...methodsFromList(value),
    ...[...value.matchAll(/\bhttp\s*\.\s*Method(Get|Post|Put|Patch|Delete|Options|Head)\b/g)]
      .map((match) => match[1]!.toUpperCase()),
  ]);
}

interface FastifyRegisteredPluginRouteMatch {
  method: string;
  route: string;
  handler?: string;
  lineNo: number;
  sourceRefs: string[];
}

interface FastifyRegisterMount {
  pluginName: string;
  prefix: string;
  lineNo: number;
  sourceRefs: string[];
}

interface FastifyPluginBlock {
  receiverName: string;
  bodyOffset: number;
  closeBraceOffset: number;
  lineNo: number;
  sourceRefs: string[];
}

function fastifyRouteFromObjectLiteral(
  value: string | undefined,
): { method: string; route: string; handler?: string } | null {
  if (!value) return null;
  const method = propertyStringValue(value, 'method');
  const route = propertyStringValue(value, 'url');
  if (!method || !route) return null;
  return {
    method,
    route,
    handler: propertyIdentifierValue(value, 'handler'),
  };
}

function fastifyRouteMatchesForContent(
  content: string,
): Array<{ method: string; route: string; handler?: string; lineNo: number }> {
  const matches: Array<{ method: string; route: string; handler?: string; lineNo: number }> = [];
  const fastifyReceivers = fastifyRouteReceiversForContent(content);
  const fastifyRoute = /\b([A-Za-z_$][\w$]*)\s*\.\s*route\s*\(\s*\{([\s\S]*?)\}\s*\)/gi;
  for (const match of content.matchAll(fastifyRoute)) {
    const receiver = match[1];
    if (!receiver || !fastifyReceivers.has(receiver)) continue;
    const route = fastifyRouteFromObjectLiteral(match[2]);
    if (!route) continue;
    matches.push({
      ...route,
      lineNo: lineNumberAtOffset(content, match.index ?? 0),
    });
  }
  return matches;
}

function fastifyRegisteredPluginRouteMatchesForContent(
  content: string,
  path: string,
  externalMounts: readonly FastifyRegisterMount[] = [],
): FastifyRegisteredPluginRouteMatch[] {
  const matches: FastifyRegisteredPluginRouteMatch[] = [];
  const receiverNames = fastifyRouteReceiversForContent(content);
  const registers = [
    ...fastifyRegisterMountsForContent(content, path, receiverNames),
    ...externalMounts,
  ];
  const blockCache = new Map<string, FastifyPluginBlock | null>();

  for (const register of registers) {
    const block = blockCache.has(register.pluginName)
      ? blockCache.get(register.pluginName)
      : fastifyPluginBlockForContent(content, path, register.pluginName);
    blockCache.set(register.pluginName, block ?? null);
    if (!block) continue;

    for (const route of fastifyRoutesInPluginBlock(content, path, block)) {
      matches.push({
        ...route,
        route: combineExpressRoutes(register.prefix, route.route),
        sourceRefs: uniqueInOrder([
          ...register.sourceRefs,
          ...block.sourceRefs,
          ...route.sourceRefs,
        ]),
      });
    }
  }

  return uniqueFastifyRegisteredPluginRoutes(matches);
}

function fastifyRegisterMountsForContent(
  content: string,
  path: string,
  receiverNames: ReadonlySet<string>,
): FastifyRegisterMount[] {
  const mounts: FastifyRegisterMount[] = [];
  const registerCall = /\b([A-Za-z_$][\w$]*)\s*\.\s*register\s*\(/g;
  for (const match of content.matchAll(registerCall)) {
    const receiver = match[1];
    if (!receiver || !receiverNames.has(receiver)) continue;
    const openParenOffset = (match.index ?? 0) + match[0].lastIndexOf('(');
    const closeParenOffset = matchingParenOffset(content, openParenOffset);
    if (closeParenOffset === -1) continue;
    const args = content.slice(openParenOffset + 1, closeParenOffset);
    const pluginName = fastifyRegisterPluginName(args);
    const prefix = propertyStringValue(args, 'prefix');
    if (!pluginName || !prefix) continue;
    mounts.push({
      pluginName,
      prefix: normalizeRoutePath(prefix),
      lineNo: lineNumberAtOffset(content, match.index ?? 0),
      sourceRefs: [fileRef(path, lineNumberAtOffset(content, match.index ?? 0))],
    });
  }
  return mounts;
}

function fastifyRegisterPluginName(args: string): string | null {
  const match = /^\s*([A-Za-z_$][\w$]*)\b/.exec(args);
  return match?.[1] ?? null;
}

function fastifyPluginBlockForContent(content: string, path: string, pluginName: string): FastifyPluginBlock | null {
  const escaped = escapeRegExp(pluginName);
  const patterns = [
    new RegExp(`\\b(?:async\\s+)?function\\s+${escaped}\\s*\\(\\s*([A-Za-z_$][\\w$]*)`, 'g'),
    new RegExp(`\\b(?:const|let|var)\\s+${escaped}\\s*=\\s*(?:async\\s+)?function\\s*\\(\\s*([A-Za-z_$][\\w$]*)`, 'g'),
    new RegExp(`\\b(?:const|let|var)\\s+${escaped}\\s*=\\s*(?:async\\s*)?\\(?\\s*([A-Za-z_$][\\w$]*)\\s*\\)?\\s*=>\\s*\\{`, 'g'),
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const receiverName = match[1];
      if (!receiverName) continue;
      const openBraceOffset = content.indexOf('{', match.index ?? 0);
      if (openBraceOffset === -1) continue;
      const closeBraceOffset = matchingBraceOffset(content, openBraceOffset);
      if (closeBraceOffset === -1) continue;
      return {
        receiverName,
        bodyOffset: openBraceOffset + 1,
        closeBraceOffset,
        lineNo: lineNumberAtOffset(content, match.index ?? 0),
        sourceRefs: [fileRef(path, lineNumberAtOffset(content, match.index ?? 0))],
      };
    }
  }

  return null;
}

function fastifyRoutesInPluginBlock(
  content: string,
  path: string,
  block: FastifyPluginBlock,
): FastifyRegisteredPluginRouteMatch[] {
  const matches: FastifyRegisteredPluginRouteMatch[] = [];
  const body = content.slice(block.bodyOffset, block.closeBraceOffset);
  const receiver = escapeRegExp(block.receiverName);
  const shorthandRoute = new RegExp(
    `\\b${receiver}\\s*\\.\\s*(get|post|put|patch|delete|options|head)\\s*\\(\\s*['"\`]([^'"\`]+)['"\`]\\s*,?\\s*([^)]*)\\)`,
    'gi',
  );
  for (const match of body.matchAll(shorthandRoute)) {
    const method = match[1];
    const route = match[2];
    if (!method || !route) continue;
    const lineNo = lineNumberAtOffset(content, block.bodyOffset + (match.index ?? 0));
    matches.push({
      method: method.toUpperCase(),
      route: normalizeRoutePath(route),
      handler: handlerFromRouteArgs(match[3]),
      lineNo,
      sourceRefs: [fileRef(path, lineNo)],
    });
  }

  const objectRoute = new RegExp(`\\b${receiver}\\s*\\.\\s*route\\s*\\(\\s*\\{([\\s\\S]*?)\\}\\s*\\)`, 'gi');
  for (const match of body.matchAll(objectRoute)) {
    const route = fastifyRouteFromObjectLiteral(match[1]);
    if (!route) continue;
    const lineNo = lineNumberAtOffset(content, block.bodyOffset + (match.index ?? 0));
    matches.push({
      ...route,
      method: route.method.toUpperCase(),
      route: normalizeRoutePath(route.route),
      lineNo,
      sourceRefs: [fileRef(path, lineNo)],
    });
  }

  return matches;
}

function uniqueFastifyRegisteredPluginRoutes(
  matches: FastifyRegisteredPluginRouteMatch[],
): FastifyRegisteredPluginRouteMatch[] {
  const seen = new Set<string>();
  const result: FastifyRegisteredPluginRouteMatch[] = [];
  for (const match of matches) {
    const key = `${match.method}:${match.route}:${match.handler ?? ''}:${match.lineNo}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      ...match,
      sourceRefs: uniqueInOrder(match.sourceRefs),
    });
  }
  return result;
}

function crossFileFastifyRegisterMountsForFiles(
  files: ScannedInventoryFile[],
  imports: InventoryImport[],
  exports: InventoryExport[],
  symbols: InventorySymbol[],
): Map<string, FastifyRegisterMount[]> {
  const knownPaths = new Set(files.filter((file) => isTypeScriptAstCandidate(file.path)).map((file) => file.path));
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const symbolById = new Map(symbols.map((symbol) => [symbol.id, symbol]));
  const mountsByTargetPath = new Map<string, FastifyRegisterMount[]>();

  for (const file of files) {
    const fileImports = imports.filter((item) => item.path === file.path);
    if (fileImports.length === 0) continue;
    const receiverNames = fastifyRouteReceiversForContent(file.content);
    const mounts = fastifyRegisterMountsForContent(file.content, file.path, receiverNames);

    for (const mount of mounts) {
      const resolved = importedFastifyPluginForLocalName({
        localName: mount.pluginName,
        importingPath: file.path,
        imports: fileImports,
        exports,
        knownPaths,
        filesByPath,
        symbolById,
      });
      if (!resolved) continue;

      mountsByTargetPath.set(resolved.path, [
        ...(mountsByTargetPath.get(resolved.path) ?? []),
        {
          pluginName: resolved.pluginName,
          prefix: mount.prefix,
          lineNo: mount.lineNo,
          sourceRefs: uniqueInOrder([...resolved.sourceRefs, ...mount.sourceRefs]),
        },
      ]);
    }
  }

  return mountsByTargetPath;
}

interface ResolvedFastifyPlugin {
  path: string;
  pluginName: string;
  sourceRefs: string[];
}

function importedFastifyPluginForLocalName(input: {
  localName: string;
  importingPath: string;
  imports: InventoryImport[];
  exports: InventoryExport[];
  knownPaths: ReadonlySet<string>;
  filesByPath: ReadonlyMap<string, ScannedInventoryFile>;
  symbolById: ReadonlyMap<string, InventorySymbol>;
}): ResolvedFastifyPlugin | null {
  const imports = input.imports
    .filter((item) => item.path === input.importingPath && importIncludesLocalName(item, input.localName))
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const item of imports) {
    const exportName = importedNameForLocalName(item, input.localName) ?? input.localName;
    const targetPaths = importTargetPaths(item, input.knownPaths);
    if (targetPaths.size === 0) continue;
    const resolved = resolveExportedFastifyPlugin({
      exportName,
      targetPaths,
      exports: input.exports,
      knownPaths: input.knownPaths,
      filesByPath: input.filesByPath,
      symbolById: input.symbolById,
      depth: 0,
    });
    if (resolved) {
      return {
        ...resolved,
        sourceRefs: uniqueInOrder([...item.sourceRefs, ...resolved.sourceRefs]),
      };
    }
  }

  return null;
}

function resolveExportedFastifyPlugin(input: {
  exportName: string;
  targetPaths: ReadonlySet<string>;
  exports: InventoryExport[];
  knownPaths: ReadonlySet<string>;
  filesByPath: ReadonlyMap<string, ScannedInventoryFile>;
  symbolById: ReadonlyMap<string, InventorySymbol>;
  depth: number;
}): ResolvedFastifyPlugin | null {
  const exported = input.exports
    .filter((candidate) => (
      input.targetPaths.has(candidate.path)
      && exportMatchesFastifyPlugin(candidate, input.exportName)
    ))
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const exportItem of exported) {
    const resolved = resolveExportItemFastifyPlugin(exportItem, input);
    if (resolved) return resolved;
  }

  return null;
}

function resolveExportItemFastifyPlugin(
  exportItem: InventoryExport,
  input: {
    exportName: string;
    targetPaths: ReadonlySet<string>;
    exports: InventoryExport[];
    knownPaths: ReadonlySet<string>;
    filesByPath: ReadonlyMap<string, ScannedInventoryFile>;
    symbolById: ReadonlyMap<string, InventorySymbol>;
    depth: number;
  },
): ResolvedFastifyPlugin | null {
  if (exportItem.kind === 're_export' && exportItem.specifier && input.depth < LOCAL_RE_EXPORT_MAX_DEPTH) {
    const reExportTargetPaths = moduleTargetPaths(exportItem.path, exportItem.specifier, input.knownPaths);
    if (reExportTargetPaths.size > 0) {
      const reExportName = exportItem.name === '*' ? input.exportName : exportItem.name;
      return resolveExportedFastifyPlugin({
        exportName: reExportName,
        targetPaths: reExportTargetPaths,
        exports: input.exports,
        knownPaths: input.knownPaths,
        filesByPath: input.filesByPath,
        symbolById: input.symbolById,
        depth: input.depth + 1,
      });
    }
  }

  const file = input.filesByPath.get(exportItem.path);
  if (!file) return null;
  const symbol = exportItem.symbolRef ? input.symbolById.get(exportItem.symbolRef) : null;
  const pluginName = fastifyPluginCandidateNamesForExport(exportItem, input.exportName, symbol)
    .find((name) => Boolean(fastifyPluginBlockForContent(file.content, file.path, name)));
  return pluginName
    ? { path: file.path, pluginName, sourceRefs: exportItem.sourceRefs }
    : null;
}

function exportMatchesFastifyPlugin(exportItem: InventoryExport, exportName: string): boolean {
  if (exportName === 'default') {
    return exportItem.kind === 'default'
      || exportItem.name === 'default'
      || exportItem.exportedAs === 'default';
  }
  return exportItem.name === exportName
    || exportItem.exportedAs === exportName
    || exportItem.name === '*';
}

function fastifyPluginCandidateNamesForExport(
  exportItem: InventoryExport,
  exportName: string,
  symbol?: InventorySymbol | null,
): string[] {
  return uniqueInOrder([
    symbol?.name,
    exportItem.name,
    exportItem.exportedAs,
    exportName,
  ].filter((name): name is string => Boolean(name && name !== '*' && name !== 'default')));
}

function fastifyRouteReceiversForContent(content: string): Set<string> {
  const receivers = new Set(['fastify']);
  const factoryNames = fastifyFactoryNamesForContent(content);
  const directFactory = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*\(/g;
  for (const match of content.matchAll(directFactory)) {
    const receiver = match[1];
    const factoryName = match[2];
    if (receiver && factoryName && factoryNames.has(factoryName)) receivers.add(receiver);
  }

  const requireFactory = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*['"`]fastify['"`]\s*\)\s*\(/g;
  for (const match of content.matchAll(requireFactory)) {
    if (match[1]) receivers.add(match[1]);
  }
  return receivers;
}

function fastifyFactoryNamesForContent(content: string): Set<string> {
  const factories = new Set(['fastify', 'Fastify']);
  const defaultImport = /\bimport\s+(?!type\b)([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s*from\s*['"`]fastify['"`]/g;
  for (const match of content.matchAll(defaultImport)) {
    if (match[1]) factories.add(match[1]);
  }

  const namedImport = /\bimport\s+(?!type\b)\{([^}]*)\}\s*from\s*['"`]fastify['"`]/g;
  for (const match of content.matchAll(namedImport)) {
    const specifiers = (match[1] ?? '').split(',');
    for (const specifier of specifiers) {
      const normalized = specifier.trim().replace(/^type\s+/, '');
      const aliased = /^(?:fastify|Fastify)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(normalized);
      if (aliased?.[1]) factories.add(aliased[1]);
      if (normalized === 'fastify' || normalized === 'Fastify') factories.add(normalized);
    }
  }

  const requireAlias = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*['"`]fastify['"`]\s*\)(?!\s*\()/g;
  for (const match of content.matchAll(requireAlias)) {
    if (match[1]) factories.add(match[1]);
  }
  return factories;
}

function hapiRouteFromObjectLiteral(
  value: string | undefined,
): { method: string; route: string; handler?: string } | null {
  if (!value) return null;
  if (hasTopLevelObjectSpread(value)) return null;
  const method = propertyStringValue(value, 'method');
  const route = propertyStringValue(value, 'path');
  if (!method || !route) return null;
  return {
    method,
    route,
    handler: propertyIdentifierValue(value, 'handler'),
  };
}

function hasTopLevelObjectSpread(value: string): boolean {
  let quote: string | null = null;
  let depth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    const previous = value[index - 1];

    if (quote) {
      if (char === quote && previous !== '\\') quote = null;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }

    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
      continue;
    }

    if (char === ')' || char === ']' || char === '}') {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (depth === 0 && char === '.' && value[index + 1] === '.' && value[index + 2] === '.') {
      return true;
    }
  }

  return false;
}

interface HapiRouteObjectLiteral {
  value: string;
  offset: number;
}

interface HapiRouteMatch {
  method: string;
  route: string;
  handler?: string;
  lineNo: number;
}

function hapiRouteMatchesForContent(
  content: string,
): HapiRouteMatch[] {
  const matches: HapiRouteMatch[] = [];
  const hapiReceivers = hapiRouteReceiversForContent(content);
  const hapiRoute = /\b([A-Za-z_$][\w$]*)\s*\.\s*route\s*\(/gi;
  for (const match of content.matchAll(hapiRoute)) {
    const receiver = match[1];
    if (!receiver || !hapiReceivers.has(receiver)) continue;
    const openParenOffset = (match.index ?? 0) + match[0].lastIndexOf('(');
    const closeParenOffset = matchingParenOffset(content, openParenOffset);
    if (closeParenOffset === -1) continue;
    const argumentStart = skipWhitespace(content, openParenOffset + 1);
    for (const objectLiteral of hapiRouteObjectLiteralsForArgument(content, argumentStart, closeParenOffset)) {
      const route = hapiRouteFromObjectLiteral(objectLiteral.value);
      if (!route) continue;
      matches.push({
        ...route,
        lineNo: lineNumberAtOffset(content, objectLiteral.offset),
      });
    }
  }
  return matches;
}

function hapiRouteObjectLiteralsForArgument(
  content: string,
  argumentStart: number,
  argumentEnd: number,
): HapiRouteObjectLiteral[] {
  if (content[argumentStart] === '{') {
    const closeBraceOffset = matchingBraceOffset(content, argumentStart);
    if (closeBraceOffset === -1 || closeBraceOffset > argumentEnd) return [];
    return [{ value: content.slice(argumentStart + 1, closeBraceOffset), offset: argumentStart }];
  }

  if (content[argumentStart] !== '[') return [];
  const closeBracketOffset = matchingBracketOffset(content, argumentStart);
  if (closeBracketOffset === -1 || closeBracketOffset > argumentEnd) return [];

  const arrayBodyStart = argumentStart + 1;
  return splitTopLevelCommaArgsWithOffsets(content.slice(arrayBodyStart, closeBracketOffset))
    .map((item) => {
      const offset = arrayBodyStart + item.offset;
      const trimmed = item.value.trim();
      if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
      const closeBraceOffset = matchingBraceOffset(content, offset);
      if (closeBraceOffset !== offset + trimmed.length - 1) return null;
      return {
        value: content.slice(offset + 1, closeBraceOffset),
        offset,
      };
    })
    .filter((item): item is HapiRouteObjectLiteral => Boolean(item));
}

function hapiRouteReceiversForContent(content: string): Set<string> {
  const receivers = new Set<string>();
  const factoryNames = hapiFactoryNamesForContent(content);
  const factoryServer = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*\.\s*server\s*\(/g;
  for (const match of content.matchAll(factoryServer)) {
    const receiver = match[1];
    const factoryName = match[2];
    if (receiver && factoryName && factoryNames.has(factoryName)) receivers.add(receiver);
  }

  const newServer = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+([A-Za-z_$][\w$]*)\s*\.\s*Server\s*\(/g;
  for (const match of content.matchAll(newServer)) {
    const receiver = match[1];
    const factoryName = match[2];
    if (receiver && factoryName && factoryNames.has(factoryName)) receivers.add(receiver);
  }

  const requireServer = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*['"`](?:@hapi\/hapi|hapi)['"`]\s*\)\s*\.\s*server\s*\(/g;
  for (const match of content.matchAll(requireServer)) {
    if (match[1]) receivers.add(match[1]);
  }
  return receivers;
}

function hapiFactoryNamesForContent(content: string): Set<string> {
  const factories = new Set<string>();
  const defaultImport = /\bimport\s+(?!type\b)([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s*from\s*['"`](?:@hapi\/hapi|hapi)['"`]/g;
  for (const match of content.matchAll(defaultImport)) {
    if (match[1]) factories.add(match[1]);
  }

  const namespaceImport = /\bimport\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*['"`](?:@hapi\/hapi|hapi)['"`]/g;
  for (const match of content.matchAll(namespaceImport)) {
    if (match[1]) factories.add(match[1]);
  }

  const requireAlias = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*['"`](?:@hapi\/hapi|hapi)['"`]\s*\)(?!\s*\.\s*server\s*\()/g;
  for (const match of content.matchAll(requireAlias)) {
    if (match[1]) factories.add(match[1]);
  }
  return factories;
}

interface RestifyRouteMatch {
  method: string;
  route: string;
  handler?: string;
  lineNo: number;
  receiverLineNos: number[];
}

function restifyRouteMatchesForContent(
  content: string,
  restifyReceivers: ReadonlyMap<string, readonly number[]> = restifyRouteReceiversForContent(content),
): RestifyRouteMatch[] {
  const matches: RestifyRouteMatch[] = [];
  const routeCall = /\b([A-Za-z_$][\w$]*)\s*\.\s*(get|post|put|patch|del|delete)\s*\(/gi;
  for (const match of content.matchAll(routeCall)) {
    const receiver = match[1];
    const method = restifyHttpMethod(match[2]);
    if (!receiver || !method || !restifyReceivers.has(receiver)) continue;
    const openParenOffset = (match.index ?? 0) + match[0].lastIndexOf('(');
    const closeParenOffset = matchingParenOffset(content, openParenOffset);
    if (closeParenOffset === -1) continue;
    const args = splitTopLevelCommaArgs(content.slice(openParenOffset + 1, closeParenOffset));
    const route = staticStringLiteralArg(args[0]);
    if (!route) continue;
    matches.push({
      method,
      route: normalizeRoutePath(route),
      handler: handlerFromMiddlewareChainArgs(args.slice(1).join(', ')),
      lineNo: lineNumberAtOffset(content, match.index ?? 0),
      receiverLineNos: [...(restifyReceivers.get(receiver) ?? [])],
    });
  }
  return matches;
}

function restifyHttpMethod(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.toLowerCase();
  return normalized === 'del' || normalized === 'delete' ? 'DELETE' : normalized.toUpperCase();
}

function restifyRouteReceiversForContent(content: string): Map<string, number[]> {
  const receivers = new Map<string, number[]>();
  const factoryNames = restifyFactoryNamesForContent(content);
  const factoryServer = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*\.\s*createServer\s*\(/g;
  for (const match of content.matchAll(factoryServer)) {
    const receiver = match[1];
    const factoryName = match[2];
    if (!receiver || !factoryName || !factoryNames.has(factoryName)) continue;
    receivers.set(receiver, [lineNumberAtOffset(content, match.index ?? 0)]);
  }

  const requireServer = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*['"`]restify['"`]\s*\)\s*\.\s*createServer\s*\(/g;
  for (const match of content.matchAll(requireServer)) {
    if (match[1]) receivers.set(match[1], [lineNumberAtOffset(content, match.index ?? 0)]);
  }
  return receivers;
}

function rejectedCreateServerRouteReceiversForContent(
  content: string,
  acceptedReceivers: ReadonlyMap<string, readonly number[]>,
): Set<string> {
  const rejected = new Set<string>();
  const factoryNames = restifyFactoryNamesForContent(content);
  const factoryServer = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*\.\s*createServer\s*\(/g;
  for (const match of content.matchAll(factoryServer)) {
    const receiver = match[1];
    const factoryName = match[2];
    if (
      receiver
      && factoryName
      && /restify/i.test(factoryName)
      && !factoryNames.has(factoryName)
      && !acceptedReceivers.has(receiver)
    ) {
      rejected.add(receiver);
    }
  }
  return rejected;
}

function restifyFactoryNamesForContent(content: string): Set<string> {
  const factories = new Set<string>();
  const defaultImport = /\bimport\s+(?!type\b)([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s*from\s*['"`]restify['"`]/g;
  for (const match of content.matchAll(defaultImport)) {
    if (match[1]) factories.add(match[1]);
  }

  const namespaceImport = /\bimport\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*['"`]restify['"`]/g;
  for (const match of content.matchAll(namespaceImport)) {
    if (match[1]) factories.add(match[1]);
  }

  const requireAlias = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*['"`]restify['"`]\s*\)(?!\s*\.\s*createServer\s*\()/g;
  for (const match of content.matchAll(requireAlias)) {
    if (match[1]) factories.add(match[1]);
  }
  return factories;
}

function expressRouteChainMatchesForContent(
  content: string,
  path: string,
  expressRouterMounts: ReadonlyMap<string, readonly ExpressRouterMount[]> = new Map(),
): Array<{ method: string; route: string; handler?: string; lineNo: number; sourceRefs: string[] }> {
  const matches: Array<{ method: string; route: string; handler?: string; lineNo: number; sourceRefs: string[] }> = [];
  const routeCall = /\b([A-Za-z_$][\w$]*)\s*\.\s*route\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/gi;
  const expressRouterVariables = expressRouterVariablesForContent(content);
  const expressAppVariables = expressAppVariablesForContent(content);

  for (const match of content.matchAll(routeCall)) {
    let offset = (match.index ?? 0) + match[0].length;
    const receiver = match[1]!;
    const route = match[2];
    if (!route) continue;
    if (
      !expressRouterVariables.has(receiver)
      && !expressAppVariables.has(receiver)
      && !expressRouterMounts.has(receiver)
    ) continue;
    const routeLineNo = lineNumberAtOffset(content, match.index ?? 0);

    while (offset < content.length) {
      offset = skipWhitespace(content, offset);
      if (content[offset] !== '.') break;

      const methodMatch = /^\.\s*(get|post|put|patch|delete|options|head)\s*\(/i.exec(content.slice(offset));
      if (!methodMatch) break;

      const openParenOffset = offset + methodMatch[0].lastIndexOf('(');
      const closeParenOffset = matchingParenOffset(content, openParenOffset);
      if (closeParenOffset === -1) break;

      const method = methodMatch[1]!;
      const lineNo = lineNumberAtOffset(content, offset);
      const sourceRefs = routeLineNo === lineNo
        ? [fileRef(path, lineNo)]
        : [fileRef(path, routeLineNo), fileRef(path, lineNo)];
      for (const variant of mountedRouteVariants(receiver, route, expressRouterMounts)) {
        matches.push({
          method,
          route: variant.route,
          handler: handlerFromMiddlewareChainArgs(content.slice(openParenOffset + 1, closeParenOffset)),
          lineNo,
          sourceRefs: uniqueInOrder([
            ...sourceRefs,
            variant.mount ? fileRef(variant.mount.path, variant.mount.lineNo) : '',
          ]),
        });
      }
      offset = closeParenOffset + 1;
    }
  }

  return matches;
}

function lineNumberAtOffset(content: string, offset: number): number {
  return content.slice(0, Math.max(0, offset)).split('\n').length;
}

function skipWhitespace(value: string, offset: number): number {
  let index = offset;
  while (index < value.length && /\s/.test(value[index]!)) index += 1;
  return index;
}

function matchingParenOffset(value: string, openParenOffset: number): number {
  let quote: string | null = null;
  let depth = 0;

  for (let index = openParenOffset; index < value.length; index += 1) {
    const char = value[index]!;
    const previous = value[index - 1];

    if (quote) {
      if (char === quote && previous !== '\\') quote = null;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }

    if (char === '(') {
      depth += 1;
      continue;
    }

    if (char === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function matchingBracketOffset(value: string, openBracketOffset: number): number {
  let quote: string | null = null;
  let depth = 0;

  for (let index = openBracketOffset; index < value.length; index += 1) {
    const char = value[index]!;
    const previous = value[index - 1];

    if (quote) {
      if (char === quote && previous !== '\\') quote = null;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }

    if (char === '[') {
      depth += 1;
      continue;
    }

    if (char === ']') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function matchingBraceOffset(value: string, openBraceOffset: number): number {
  let quote: string | null = null;
  let depth = 0;

  for (let index = openBraceOffset; index < value.length; index += 1) {
    const char = value[index]!;
    const previous = value[index - 1];

    if (quote) {
      if (char === quote && previous !== '\\') quote = null;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }

    if (char === '{') {
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function propertyStringValue(value: string, property: string): string | null {
  const match = new RegExp(`\\b${property}\\s*:\\s*['"\`]([^'"\`]+)['"\`]`, 'i').exec(value);
  return match?.[1] ?? null;
}

function propertyIdentifierValue(value: string, property: string): string | undefined {
  const match = new RegExp(`\\b${property}\\s*:\\s*([A-Za-z_$][\\w$]*(?:\\s*\\.\\s*[A-Za-z_$][\\w$]*)?)\\b`, 'i').exec(value);
  return normalizeHandlerName(match?.[1]);
}

function handlerFromRouteArgs(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const controllerMethod = /['"`]([A-Za-z_][\w\\]*Controller@[A-Za-z_][\w]*)['"`]/.exec(value);
  if (controllerMethod?.[1]) return controllerMethod[1];
  const arrayMethod = /\[\s*([A-Za-z_][\w\\]*Controller)::class\s*,\s*['"`]([A-Za-z_][\w]*)['"`]\s*\]/.exec(value);
  if (arrayMethod?.[1] && arrayMethod[2]) return `${arrayMethod[1]}@${arrayMethod[2]}`;
  const invokableController = /^\s*([A-Za-z_][\w\\]*Controller)::class\b/.exec(value);
  if (invokableController?.[1]) return `${invokableController[1]}@__invoke`;
  const bareHandler = /^\s*([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)?)\b/.exec(value);
  return normalizeHandlerName(bareHandler?.[1]);
}

function laravelHandlerFromRouteArgs(
  value: string | undefined,
  mount: LaravelRouteGroupMount | undefined,
): string | undefined {
  const groupAction = laravelControllerGroupActionArg(value);
  if (groupAction && mount?.controller) return `${mount.controller}@${groupAction}`;
  return handlerFromRouteArgs(value);
}

function laravelControllerGroupActionArg(value: string | undefined): string | null {
  const match = /^\s*['"`]([A-Za-z_][\w]*)['"`]\s*$/.exec(value ?? '');
  return match?.[1] ?? null;
}

function slimRouteMatchesForLine(line: string): LineRouteMatch[] {
  const matches: LineRouteMatch[] = [];
  const slimRoute = /(?:^|[^\w$])\$([A-Za-z_][\w]*)\s*->\s*(get|post|put|patch|delete|options|head|any)\s*\(\s*(['"`])([^'"`]+)\3\s*,\s*([\s\S]*)/gi;
  for (const match of line.matchAll(slimRoute)) {
    const receiver = match[1];
    const method = match[2];
    const route = match[4];
    if (!receiver || !method || !route || !SLIM_ROUTE_RECEIVERS.has(receiver)) continue;
    if (!isConservativeSlimRoutePath(route)) continue;
    const handler = slimHandlerFromRouteArgs(match[5]);
    if (!handler) continue;
    matches.push({
      method: method.toUpperCase(),
      route: normalizeRoutePath(route),
      handler,
    });
  }
  return matches;
}

const SLIM_ROUTE_RECEIVERS = new Set(['app', 'router', 'routes']);

function slimHandlerFromRouteArgs(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const arrayMethod = /\[\s*(\\?[A-Za-z_][\w\\]*Controller)::class\s*,\s*['"`]([A-Za-z_][\w]*)['"`]\s*\]/.exec(value);
  if (arrayMethod?.[1] && arrayMethod[2]) {
    const controllerName = phpClassBaseName(arrayMethod[1]);
    return controllerName ? `Slim:${controllerName}@${arrayMethod[2]}` : undefined;
  }

  const stringMethod = /['"`](\\?[A-Za-z_][\w\\]*Controller)(?::|@)([A-Za-z_][\w]*)['"`]/.exec(value);
  if (stringMethod?.[1] && stringMethod[2]) {
    const controllerName = phpClassBaseName(stringMethod[1]);
    return controllerName ? `Slim:${controllerName}@${stringMethod[2]}` : undefined;
  }

  return undefined;
}

function isConservativeSlimRoutePath(route: string): boolean {
  const normalized = route.trim();
  return normalized.startsWith('/')
    && normalized.length > 1
    && !normalized.includes('${')
    && !normalized.includes('..')
    && !normalized.includes('*');
}

function railsRouteHandlerForLine(line: string): string | undefined {
  const match = /(?:\bto:|=>)\s*['"`]([A-Za-z_][\w]*(?:\/[A-Za-z_][\w]*)*)#([A-Za-z_][\w]*[!?=]?)['"`]/.exec(line);
  if (match?.[1] && match[2]) return railsRouteHandlerFromTarget(match[1], match[2]);

  const controller = railsRouteOptionValue(line, 'controller', /[A-Za-z_][\w]*(?:\/[A-Za-z_][\w]*)*/);
  const action = railsRouteOptionValue(line, 'action', /[A-Za-z_][\w]*[!?=]?/);
  if (!controller || !action) return undefined;
  return railsRouteHandlerFromTarget(controller, action);
}

function railsRouteHandlerFromTarget(controller: string, action: string): string {
  return `${railsControllerHandlerPath(controller)}#${action}`;
}

function railsRouteOptionValue(line: string, optionName: 'controller' | 'action', valuePattern: RegExp): string | undefined {
  const source = valuePattern.source;
  const modern = new RegExp(`\\b${optionName}:\\s*(?::(${source})|(['"\`])(${source})\\2)`).exec(line);
  if (modern?.[1]) return modern[1];
  if (modern?.[3]) return modern[3];

  const hashrocket = new RegExp(`:${optionName}\\s*=>\\s*(?::(${source})|(['"\`])(${source})\\2)`).exec(line);
  if (hashrocket?.[1]) return hashrocket[1];
  return hashrocket?.[3];
}

function sinatraRouteMatchesForContent(content: string, path: string): SinatraRouteMatch[] {
  if (!path.endsWith('.rb') || !isSinatraLikeRubyContent(content)) return [];

  const lines = content.split('\n');
  const matches: SinatraRouteMatch[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const match = /^\s*(get|post|put|patch|delete|options|head)\s+(['"`])([^'"`]+)\2(?=\s|,|$)([\s\S]*)$/i.exec(line);
    if (!match?.[1] || !match[3]) continue;
    const routePath = match[3].trim();
    if (!isStaticSinatraRoutePath(routePath)) continue;
    if (!/\bdo\b/.test(match[4] ?? '')) continue;

    const lineNo = index + 1;
    const endLine = rubyBlockEndLine(lines, index) ?? lineNo;
    matches.push({
      method: match[1].toUpperCase(),
      route: normalizeRoutePath(routePath),
      handler: sinatraRouteHandlerForLine(line),
      lineNo,
      sourceLineNos: boundedLineRange(lineNo, endLine, 12),
    });
  }
  return uniqueSinatraRouteMatches(matches);
}

function sinatraRouteCandidateLineNosForContent(content: string, path: string): Set<number> {
  const lineNos = new Set<number>();
  if (!path.endsWith('.rb') || !isSinatraLikeRubyContent(content)) return lineNos;

  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (/^\s*(?:get|post|put|patch|delete|options|head)\s+/i.test(line)) {
      lineNos.add(index + 1);
    }
  }
  return lineNos;
}

function isSinatraLikeRubyContent(content: string): boolean {
  return /require\s+['"]sinatra(?:\/base)?['"]/.test(content)
    || /<\s*Sinatra::Base\b/.test(content)
    || /\bSinatra::Application\b/.test(content)
    || /\bregister\s+Sinatra\b/.test(content);
}

function isStaticSinatraRoutePath(routePath: string): boolean {
  return routePath.startsWith('/')
    && routePath.length > 1
    && !routePath.includes('#{')
    && !routePath.includes('$')
    && !routePath.includes('*')
    && !routePath.includes('..')
    && /^[A-Za-z0-9_./:()?-]+$/.test(routePath);
}

function sinatraRouteHandlerForLine(line: string): string | undefined {
  const handler = railsRouteHandlerForLine(line);
  return handler ? `Sinatra:${handler}` : undefined;
}

function boundedLineRange(startLine: number, endLine: number, maxLines: number): number[] {
  const result: number[] = [];
  const lastLine = Math.max(startLine, Math.min(endLine, startLine + maxLines - 1));
  for (let lineNo = startLine; lineNo <= lastLine; lineNo += 1) result.push(lineNo);
  return result;
}

function uniqueSinatraRouteMatches(matches: SinatraRouteMatch[]): SinatraRouteMatch[] {
  const seen = new Set<string>();
  const result: SinatraRouteMatch[] = [];
  for (const match of matches) {
    const key = `${match.method}\0${match.route}\0${match.lineNo}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(match);
  }
  return result;
}

function railsControllerHandlerPath(controller: string): string {
  const segments = controller.split('/').filter(Boolean);
  const controllerName = segments.pop();
  if (!controllerName) return railsControllerClassName(controller);
  return [...segments, railsControllerClassName(controllerName)].join('/');
}

function railsControllerClassName(controller: string): string {
  const name = controller
    .split('_')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join('');
  return `${name}Controller`;
}

function handlerFromMiddlewareChainArgs(value: string | undefined): string | undefined {
  const args = middlewareChainArgs(value);
  return handlerExpressionNameFromMiddlewareArg(args.at(-1));
}

function middlewareChainArgs(value: string | undefined): string[] {
  if (!value) return [];
  const trimmed = value
    .trim()
    .replace(/^\s*,\s*/, '')
    .replace(/\)\s*;?\s*$/, '')
    .trim();
  if (!trimmed) return [];
  return splitTopLevelCommaArgs(trimmed);
}

function splitTopLevelCommaArgs(value: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: string | null = null;
  let depth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    const previous = value[index - 1];

    if (quote) {
      current += char;
      if (char === quote && previous !== '\\') quote = null;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      current += char;
      continue;
    }

    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
      current += char;
      continue;
    }

    if (char === ')' || char === ']' || char === '}') {
      depth = Math.max(0, depth - 1);
      current += char;
      continue;
    }

    if (char === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) args.push(current.trim());
  return args;
}

function splitTopLevelCommaArgsWithOffsets(value: string): Array<{ value: string; offset: number }> {
  const args: Array<{ value: string; offset: number }> = [];
  let current = '';
  let currentOffset = 0;
  let quote: string | null = null;
  let depth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    const previous = value[index - 1];

    if (quote) {
      current += char;
      if (char === quote && previous !== '\\') quote = null;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      current += char;
      continue;
    }

    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
      current += char;
      continue;
    }

    if (char === ')' || char === ']' || char === '}') {
      depth = Math.max(0, depth - 1);
      current += char;
      continue;
    }

    if (char === ',' && depth === 0) {
      const leadingWhitespace = current.match(/^\s*/)?.[0].length ?? 0;
      if (current.trim()) args.push({ value: current.trim(), offset: currentOffset + leadingWhitespace });
      current = '';
      currentOffset = index + 1;
      continue;
    }

    current += char;
  }

  const leadingWhitespace = current.match(/^\s*/)?.[0].length ?? 0;
  if (current.trim()) args.push({ value: current.trim(), offset: currentOffset + leadingWhitespace });
  return args;
}

function handlerExpressionNameFromMiddlewareArg(value: string | undefined): string | undefined {
  const directHandler = handlerExpressionName(value);
  if (directHandler) return directHandler;
  const arrayItems = arrayLiteralItems(value);
  return handlerExpressionName(arrayItems.at(-1));
}

function arrayLiteralItems(value: string | undefined): string[] {
  const trimmed = value?.trim();
  if (!trimmed?.startsWith('[') || !trimmed.endsWith(']')) return [];
  return splitTopLevelCommaArgs(trimmed.slice(1, -1));
}

function handlerExpressionName(value: string | undefined): string | undefined {
  const match = /^\s*([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)?)\s*$/.exec(value ?? '');
  const directHandler = normalizeHandlerName(match?.[1]);
  if (directHandler) return directHandler;
  const boundHandler = /^\s*([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)?)\s*\.\s*bind\s*\(/.exec(value ?? '');
  return normalizeHandlerName(boundHandler?.[1]);
}

function normalizeHandlerName(value: string | undefined): string | undefined {
  return value?.replace(/\s*\.\s*/g, '.');
}

function normalizeRoutePath(route: string): string {
  const cleaned = route
    .trim()
    .replace(/^\^+/, '')
    .replace(/\$+$/, '')
    .replace(/^~\//, '/');
  if (!cleaned) return '/';
  return cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
}

function symfonyYamlRouteMatchesForContent(content: string): SymfonyRouteMatch[] {
  const matches: SymfonyRouteMatch[] = [];
  const lines = content.split('\n');
  let block: {
    path: string | null;
    pathLineNo: number | null;
    controller: string | null;
    controllerLineNo: number | null;
  } | null = null;

  const finishBlock = (): void => {
    if (!block?.path || !block.pathLineNo || !block.controller || !block.controllerLineNo) {
      block = null;
      return;
    }
    if (!isStaticSymfonyRoutePath(block.path)) {
      block = null;
      return;
    }
    const handler = symfonyHandlerFromControllerTarget(block.controller);
    if (!handler) {
      block = null;
      return;
    }
    matches.push({
      method: 'ANY',
      route: normalizeRoutePath(block.path),
      handler,
      lineNo: block.pathLineNo,
      sourceLineNos: [...new Set([block.pathLineNo, block.controllerLineNo])].sort((a, b) => a - b),
    });
    block = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const lineNo = index + 1;
    if (/^\S[^:#]*:\s*(?:#.*)?$/.test(line)) {
      finishBlock();
      block = { path: null, pathLineNo: null, controller: null, controllerLineNo: null };
      continue;
    }
    if (!block) continue;

    const routePath = symfonyYamlRoutePathForLine(line);
    if (routePath) {
      block.path = routePath;
      block.pathLineNo = lineNo;
    }

    const controller = symfonyYamlControllerForLine(line);
    if (controller) {
      block.controller = controller;
      block.controllerLineNo = lineNo;
    }
  }
  finishBlock();
  return matches;
}

function symfonyXmlRouteMatchesForContent(content: string): SymfonyRouteMatch[] {
  const matches: SymfonyRouteMatch[] = [];
  const blockRoute = /<route\b([^>]*?)>([\s\S]*?)<\/route>/gi;

  for (const match of content.matchAll(blockRoute)) {
    const body = match[2] ?? '';
    const route = symfonyXmlRouteMatchFromParts({
      attrs: match[1] ?? '',
      body,
      routeOffset: match.index ?? 0,
      bodyOffset: (match.index ?? 0) + match[0].indexOf(body),
      content,
    });
    if (route) matches.push(route);
  }

  const selfClosingRoute = /<route\b([^>]*?)\/>/gi;
  for (const match of content.matchAll(selfClosingRoute)) {
    const route = symfonyXmlRouteMatchFromParts({
      attrs: match[1] ?? '',
      body: '',
      routeOffset: match.index ?? 0,
      bodyOffset: match.index ?? 0,
      content,
    });
    if (route) matches.push(route);
  }

  return matches;
}

function symfonyXmlRouteMatchFromParts(input: {
  attrs: string;
  body: string;
  routeOffset: number;
  bodyOffset: number;
  content: string;
}): SymfonyRouteMatch | null {
  const routePath = symfonyXmlRoutePathForAttrs(input.attrs);
  if (!routePath || !isStaticSymfonyRoutePath(routePath)) return null;

  const routeLineNo = lineNumberAtOffset(input.content, input.routeOffset);
  const controller = symfonyXmlControllerForRoute({ ...input, routeLineNo });
  if (!controller) return null;

  const handler = symfonyHandlerFromControllerTarget(controller.target);
  if (!handler) return null;

  return {
    method: 'ANY',
    route: normalizeRoutePath(routePath),
    handler,
    lineNo: routeLineNo,
    sourceLineNos: uniqueInOrder([routeLineNo, controller.lineNo]),
  };
}

function symfonyXmlRoutePathForAttrs(attrs: string): string | null {
  return symfonyXmlLiteralValue(xmlAttributeValue(attrs, 'path') ?? xmlAttributeValue(attrs, 'pattern'));
}

function symfonyXmlControllerForRoute(input: {
  attrs: string;
  body: string;
  bodyOffset: number;
  content: string;
  routeLineNo: number;
}): { target: string; lineNo: number } | null {
  const attrController = symfonyXmlLiteralValue(
    xmlAttributeValue(input.attrs, 'controller') ?? xmlAttributeValue(input.attrs, '_controller'),
  );
  if (attrController) {
    return {
      target: attrController,
      lineNo: input.routeLineNo,
    };
  }

  const defaultBlock = /<default\b([^>]*)>([\s\S]*?)<\/default>/gi;
  for (const match of input.body.matchAll(defaultBlock)) {
    const key = xmlAttributeValue(match[1] ?? '', 'key');
    if (key !== '_controller' && key !== 'controller') continue;
    const controller = symfonyXmlLiteralValue(match[2]);
    if (!controller) continue;
    return {
      target: controller,
      lineNo: lineNumberAtOffset(input.content, input.bodyOffset + (match.index ?? 0)),
    };
  }

  return null;
}

function symfonyXmlLiteralValue(value: string | undefined | null): string | null {
  const literal = value?.trim();
  if (!literal || /[%$]/.test(literal) || /&[#A-Za-z0-9]+;/.test(literal)) return null;
  return literal;
}

function symfonyYamlRoutePathForLine(line: string): string | null {
  const match = /^\s+(?:path|pattern)\s*:\s*(.+?)\s*$/.exec(line);
  return symfonyYamlLiteralValue(match?.[1]);
}

function symfonyYamlControllerForLine(line: string): string | null {
  const controllerMatch = /^\s+controller\s*:\s*(.+?)\s*$/.exec(line);
  const controller = symfonyYamlLiteralValue(controllerMatch?.[1]);
  if (controller) return controller;

  const defaultsMatch = /(?:^|[{,\s])_controller\s*:\s*([^,}#]+)/.exec(line);
  return symfonyYamlLiteralValue(defaultsMatch?.[1]);
}

function symfonyYamlLiteralValue(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const quoted = /^(['"])(.*)\1$/.exec(trimmed);
  const literal = quoted?.[2] ?? trimmed.replace(/\s+#.*$/, '').trim();
  if (!literal || /[%$]/.test(literal)) return null;
  return literal;
}

function isStaticSymfonyRoutePath(routePath: string): boolean {
  if (routePath.includes('{') || routePath.includes('}') || routePath.includes(':') || routePath.includes('*')) {
    return false;
  }
  return routePath === '/' || /^[A-Za-z0-9_./-]+$/.test(routePath);
}

function symfonyHandlerFromControllerTarget(target: string): string | null {
  const normalized = target.trim();
  if (!normalized || normalized.includes('@') || /[%${}\[\]]/.test(normalized)) return null;

  const bundleTarget = /^([A-Za-z_][\w]*Bundle):([A-Za-z_][\w]*):([A-Za-z_][\w]*)$/.exec(normalized);
  if (bundleTarget?.[2] && bundleTarget[3]) {
    return `Symfony:${bundleTarget[2]}Controller@${bundleTarget[3]}Action`;
  }

  const classTarget = /^([A-Za-z_][\w\\]*Controller)::([A-Za-z_][\w]*)$/.exec(normalized);
  if (!classTarget?.[1] || !classTarget[2]) return null;
  const controllerName = phpClassBaseName(classTarget[1]);
  if (!controllerName) return null;
  return `Symfony:${controllerName}@${classTarget[2]}`;
}

function codeIgniterRouteMatchesForContent(content: string): CodeIgniterRouteMatch[] {
  const matches: CodeIgniterRouteMatch[] = [];
  const lines = content.split('\n');
  const assignment = /^\s*\$route\s*\[\s*(['"])([^'"]+)\1\s*\]\s*=\s*(['"])([^'"]+)\3\s*;/;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const match = assignment.exec(line);
    if (!match?.[2] || !match[4]) continue;
    const routePath = match[2].trim();
    const target = match[4].trim();
    if (!isStaticCodeIgniterRoutePath(routePath)) continue;
    const handler = codeIgniterHandlerFromRouteTarget(target);
    if (!handler) continue;
    matches.push({
      method: 'ANY',
      route: normalizeRoutePath(routePath),
      handler,
      lineNo: index + 1,
      sourceLineNos: [index + 1],
    });
  }

  return matches;
}

function isStaticCodeIgniterRoutePath(routePath: string): boolean {
  const lower = routePath.toLowerCase();
  if (
    lower === 'default_controller'
    || lower === '404_override'
    || lower === 'translate_uri_dashes'
  ) {
    return false;
  }
  if (routePath.includes('(:') || routePath.includes('$') || routePath.includes('*')) return false;
  return /^[A-Za-z0-9_/-]+$/.test(routePath);
}

function codeIgniterHandlerFromRouteTarget(target: string): string | null {
  if (target.includes('(:') || target.includes('$') || target.includes('*')) return null;
  const parts = target
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean);
  if (parts.length < 2 || !parts.every((part) => /^[A-Za-z_][\w]*$/.test(part))) return null;
  const methodName = parts.at(-1);
  const controllerSegment = parts.at(-2);
  if (!methodName || !controllerSegment) return null;
  const subdirs = parts.slice(0, -2);
  const controllerName = codeIgniterControllerClassName(controllerSegment);
  return `${[...subdirs, controllerName].join('/')}@${methodName}`;
}

function codeIgniterControllerClassName(segment: string): string {
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

function cakePhpRouteMatchesForContent(content: string): CakePhpRouteMatch[] {
  const matches: CakePhpRouteMatch[] = [];
  const routeCall = /\bRouter::connect\s*\(/g;

  for (const match of content.matchAll(routeCall)) {
    const openParenOffset = (match.index ?? 0) + match[0].lastIndexOf('(');
    const closeParenOffset = matchingParenOffset(content, openParenOffset);
    if (closeParenOffset === -1) continue;

    const args = splitTopLevelCommaArgs(content.slice(openParenOffset + 1, closeParenOffset));
    const routePath = phpStringLiteralArg(args[0]);
    if (!routePath || !isStaticCakePhpRoutePath(routePath)) continue;

    const target = args[1] ?? '';
    const controller = phpArrayStringValue(target, 'controller');
    const action = phpArrayStringValue(target, 'action');
    if (!controller || !action || !/^[A-Za-z_][\w]*$/.test(action)) continue;

    matches.push({
      method: 'ANY',
      route: normalizeRoutePath(routePath),
      handler: `CakePHP:${cakePhpControllerClassName(controller)}@${action}`,
      lineNo: lineNumberAtOffset(content, match.index ?? 0),
      sourceLineNos: [lineNumberAtOffset(content, match.index ?? 0)],
    });
  }

  return matches;
}

function phpStringLiteralArg(value: string | undefined): string | null {
  const match = /^\s*(['"])([^'"]+)\1\s*$/.exec(value ?? '');
  return match?.[2]?.trim() || null;
}

function phpArrayStringValue(value: string, key: string): string | null {
  const match = new RegExp(`['"]${key}['"]\\s*=>\\s*(['"])([^'"]+)\\1`, 'i').exec(value);
  return match?.[2]?.trim() || null;
}

function isStaticCakePhpRoutePath(routePath: string): boolean {
  if (routePath.includes(':') || routePath.includes('*') || routePath.includes('$')) return false;
  return /^[A-Za-z0-9_./-]+$/.test(routePath);
}

function cakePhpControllerClassName(controller: string): string {
  const name = controller
    .split('_')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join('');
  return name.endsWith('Controller') ? name : `${name}Controller`;
}

function yiiRouteMatchesForContent(content: string): YiiRouteMatch[] {
  if (!/['"]urlManager['"]\s*=>/i.test(content)) return [];

  const matches: YiiRouteMatch[] = [];
  for (const urlManagerBlock of phpArrayBlocksForKey(content, 'urlManager')) {
    for (const rulesBlock of phpArrayBlocksForKey(urlManagerBlock.body, 'rules', urlManagerBlock.offset)) {
      for (const item of splitTopLevelCommaArgsWithOffsets(rulesBlock.body)) {
        const itemOffset = rulesBlock.offset + item.offset;
        const stringMap = /^\s*(['"])([^'"]+)\1\s*=>\s*(['"])([^'"]+)\3\s*$/s.exec(item.value);
        if (stringMap?.[2] && stringMap[4]) {
          matches.push(...yiiRouteMatchesForRule({
            content,
            pattern: stringMap[2],
            routeTarget: stringMap[4],
            ruleValue: item.value,
            lineNo: lineNumberAtOffset(content, itemOffset),
            sourceLineNos: [lineNumberAtOffset(content, itemOffset)],
          }));
          continue;
        }

        const pattern = phpArrayStringValue(item.value, 'pattern');
        const routeTarget = phpArrayStringValue(item.value, 'route');
        if (!pattern || !routeTarget) continue;
        matches.push(...yiiRouteMatchesForRule({
          content,
          pattern,
          routeTarget,
          ruleValue: item.value,
          lineNo: lineNumberAtOffset(content, itemOffset + (phpArrayKeyOffset(item.value, 'pattern') ?? 0)),
          sourceLineNos: yiiRuleSourceLineNos(content, item.value, itemOffset),
        }));
      }
    }
  }

  return matches;
}

function yiiRouteMatchesForRule(input: {
  content: string;
  pattern: string;
  routeTarget: string;
  ruleValue: string;
  lineNo: number;
  sourceLineNos: number[];
}): YiiRouteMatch[] {
  const routePattern = yiiRoutePatternFromLiteral(input.pattern);
  if (!routePattern) return [];
  const handler = yiiHandlerFromRouteTarget(input.routeTarget);
  if (!handler) return [];

  const methods = yiiRouteMethodsForPattern(input.pattern) ?? yiiRouteMethodsForRule(input.ruleValue);
  return (methods.length > 0 ? methods : ['ANY']).map((method) => ({
    method,
    route: normalizeRoutePath(routePattern),
    handler,
    lineNo: input.lineNo,
    sourceLineNos: input.sourceLineNos,
  }));
}

function phpArrayBlocksForKey(
  content: string,
  key: string,
  baseOffset = 0,
): Array<{ body: string; offset: number }> {
  const blocks: Array<{ body: string; offset: number }> = [];
  const keyPattern = new RegExp(`['"]${key}['"]\\s*=>\\s*(\\[|array\\s*\\()`, 'gi');
  for (const match of content.matchAll(keyPattern)) {
    const openToken = match[1];
    if (!openToken) continue;
    const matchOffset = match.index ?? 0;
    const openOffset = matchOffset + match[0].lastIndexOf(openToken.startsWith('[') ? '[' : '(');
    const closeOffset = openToken.startsWith('[')
      ? matchingBracketOffset(content, openOffset)
      : matchingParenOffset(content, openOffset);
    if (closeOffset === -1) continue;
    blocks.push({
      body: content.slice(openOffset + 1, closeOffset),
      offset: baseOffset + openOffset + 1,
    });
  }
  return blocks;
}

function yiiRoutePatternFromLiteral(pattern: string): string | null {
  const withoutMethod = pattern.trim().replace(/^(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+/i, '').trim();
  if (!isStaticYiiRoutePattern(withoutMethod)) return null;
  return withoutMethod;
}

function yiiRouteMethodsForPattern(pattern: string): string[] | null {
  const match = /^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+/i.exec(pattern.trim());
  const method = yiiHttpMethod(match?.[1]);
  return method ? [method] : null;
}

function yiiRouteMethodsForRule(ruleValue: string): string[] {
  const verbValue = phpArrayValueForKey(ruleValue, 'verb') ?? phpArrayValueForKey(ruleValue, 'verbs');
  if (!verbValue) return [];
  const literal = phpStringLiteralArg(verbValue);
  if (literal) {
    const method = yiiHttpMethod(literal);
    return method ? [method] : [];
  }

  const arrayBody = phpArrayLiteralBody(verbValue);
  if (!arrayBody) return [];
  return uniqueInOrder(splitTopLevelCommaArgs(arrayBody)
    .map((item) => phpStringLiteralArg(item))
    .map((item) => yiiHttpMethod(item))
    .filter((item): item is string => item !== null));
}

function yiiHttpMethod(value: string | undefined | null): string | null {
  const method = value?.trim().toUpperCase();
  return method && /^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)$/.test(method) ? method : null;
}

function phpArrayValueForKey(value: string, key: string): string | null {
  const keyMatch = new RegExp(`['"]${key}['"]\\s*=>\\s*`, 'i').exec(value);
  if (!keyMatch) return null;
  const valueOffset = skipWhitespace(value, (keyMatch.index ?? 0) + keyMatch[0].length);
  const quote = value[valueOffset];
  if (quote === '"' || quote === "'") {
    for (let index = valueOffset + 1; index < value.length; index += 1) {
      if (value[index] === quote && value[index - 1] !== '\\') {
        return value.slice(valueOffset, index + 1);
      }
    }
    return null;
  }
  if (value[valueOffset] === '[') {
    const closeOffset = matchingBracketOffset(value, valueOffset);
    return closeOffset === -1 ? null : value.slice(valueOffset, closeOffset + 1);
  }
  const arrayMatch = /^array\s*\(/i.exec(value.slice(valueOffset));
  if (arrayMatch) {
    const openOffset = valueOffset + arrayMatch[0].lastIndexOf('(');
    const closeOffset = matchingParenOffset(value, openOffset);
    return closeOffset === -1 ? null : value.slice(valueOffset, closeOffset + 1);
  }
  return null;
}

function phpArrayLiteralBody(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return trimmed.slice(1, -1);
  const arrayMatch = /^array\s*\(([\s\S]*)\)$/i.exec(trimmed);
  return arrayMatch?.[1] ?? null;
}

function phpArrayLiteralBodyWithOffset(value: string): { body: string; offset: number } | null {
  const leadingWhitespace = value.match(/^\s*/)?.[0].length ?? 0;
  const trimmed = value.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return { body: trimmed.slice(1, -1), offset: leadingWhitespace + 1 };
  }
  const arrayMatch = /^array\s*\(/i.exec(trimmed);
  if (!arrayMatch || !trimmed.endsWith(')')) return null;
  const openParenOffset = trimmed.indexOf('(');
  return {
    body: trimmed.slice(openParenOffset + 1, -1),
    offset: leadingWhitespace + openParenOffset + 1,
  };
}

function phpArrayEntryForKey(value: string, key: string): { value: string; offset: number } | null {
  const body = phpArrayLiteralBodyWithOffset(value);
  if (!body) return null;
  const keyPattern = new RegExp(`^\\s*['"]${escapeRegExp(key)}['"]\\s*=>\\s*`, 'i');
  for (const item of splitTopLevelCommaArgsWithOffsets(body.body)) {
    const match = keyPattern.exec(item.value);
    if (!match) continue;
    const rawValue = item.value.slice(match[0].length);
    const leadingWhitespace = rawValue.match(/^\s*/)?.[0].length ?? 0;
    return {
      value: rawValue.trim(),
      offset: body.offset + item.offset + match[0].length + leadingWhitespace,
    };
  }
  return null;
}

function phpArrayKeyOffset(value: string, key: string): number | null {
  const match = new RegExp(`['"]${key}['"]\\s*=>`, 'i').exec(value);
  return typeof match?.index === 'number' ? match.index : null;
}

function yiiRuleSourceLineNos(content: string, ruleValue: string, ruleOffset: number): number[] {
  return uniqueInOrder([
    phpArrayKeyOffset(ruleValue, 'pattern'),
    phpArrayKeyOffset(ruleValue, 'route'),
    phpArrayKeyOffset(ruleValue, 'verb'),
    phpArrayKeyOffset(ruleValue, 'verbs'),
  ]
    .filter((offset): offset is number => offset !== null)
    .map((offset) => lineNumberAtOffset(content, ruleOffset + offset)));
}

function isStaticYiiRoutePattern(routePath: string): boolean {
  if (routePath.includes('$') || routePath.includes('{') || routePath.includes('}') || routePath.includes('*')) {
    return false;
  }
  return routePath === '/' || /^[A-Za-z0-9_./<>:\\+-]+$/.test(routePath);
}

function yiiHandlerFromRouteTarget(target: string): string | null {
  if (target.includes('$') || target.includes('{') || target.includes('}') || target.includes('*')) return null;
  const parts = target
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean);
  if (parts.length < 2 || !parts.every((part) => /^[A-Za-z_][\w-]*$/.test(part))) return null;
  const actionSegment = parts.at(-1);
  if (!actionSegment) return null;
  const controllerSegments = parts.slice(0, -1);
  const controllerName = `${pascalCaseRouteSegments(controllerSegments)}Controller`;
  const actionName = `action${pascalCaseRouteSegments([actionSegment])}`;
  return controllerName === 'Controller' || actionName === 'action' ? null : `Yii:${controllerName}@${actionName}`;
}

function zendFrameworkIniRouteMatchesForContent(content: string): ZendFrameworkRouteMatch[] {
  if (!/(?:^|\.)resources\.router\.routes\./im.test(content)) return [];

  const routes = new Map<string, {
    route?: string;
    routeLineNo?: number;
    controller?: string;
    controllerLineNo?: number;
    action?: string;
    actionLineNo?: number;
    module?: string;
    method?: string;
    methodLineNo?: number;
  }>();
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const parsed = zendFrameworkIniRouteAssignment(lines[index]!, index + 1);
    if (!parsed) continue;
    const record = routes.get(parsed.routeName) ?? {};
    if (parsed.key === 'route') {
      record.route = parsed.value;
      record.routeLineNo = parsed.lineNo;
    } else if (parsed.key === 'defaults.controller') {
      record.controller = parsed.value;
      record.controllerLineNo = parsed.lineNo;
    } else if (parsed.key === 'defaults.action') {
      record.action = parsed.value;
      record.actionLineNo = parsed.lineNo;
    } else if (parsed.key === 'defaults.module') {
      record.module = parsed.value;
    } else if (parsed.key === 'reqs.method' || parsed.key === 'reqs._method') {
      record.method = parsed.value;
      record.methodLineNo = parsed.lineNo;
    }
    routes.set(parsed.routeName, record);
  }

  const matches: ZendFrameworkRouteMatch[] = [];
  for (const record of routes.values()) {
    if (!record.route || !record.routeLineNo || !record.controller || !record.controllerLineNo || !record.action || !record.actionLineNo) {
      continue;
    }
    if (!isStaticZendFrameworkRoutePath(record.route)) continue;
    const handler = zendFrameworkHandlerFromRouteTarget({
      controller: record.controller,
      action: record.action,
      module: record.module,
    });
    if (!handler) continue;
    const method = zendFrameworkRouteMethod(record.method);
    matches.push({
      method: method ?? 'ANY',
      route: normalizeRoutePath(record.route),
      handler,
      lineNo: record.routeLineNo,
      sourceLineNos: uniqueInOrder([
        record.routeLineNo,
        record.controllerLineNo,
        record.actionLineNo,
        record.methodLineNo ?? 0,
      ].filter((lineNo) => lineNo > 0)),
    });
  }
  return matches;
}

function zendFrameworkIniRouteAssignment(
  line: string,
  lineNo: number,
): { routeName: string; key: string; value: string; lineNo: number } | null {
  const withoutComment = line.replace(/\s+[;#].*$/, '').trim();
  const match = /(?:^|\.)(?:resources\.router\.routes\.)([A-Za-z0-9_-]+)\.(route|defaults\.controller|defaults\.action|defaults\.module|reqs\.(?:_?method))\s*=\s*(.+)$/.exec(withoutComment);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  const value = iniLiteralValue(match[3]);
  if (!value) return null;
  return {
    routeName: match[1],
    key: match[2],
    value,
    lineNo,
  };
}

function iniLiteralValue(value: string): string | null {
  const trimmed = value.trim();
  const quoted = /^(['"])(.*)\1$/.exec(trimmed);
  const literal = quoted?.[2] ?? trimmed;
  if (!literal || /[$%{}[\]*]/.test(literal)) return null;
  return literal.trim();
}

function isStaticZendFrameworkRoutePath(routePath: string): boolean {
  if (routePath.includes('$') || routePath.includes('{') || routePath.includes('}') || routePath.includes('*')) {
    return false;
  }
  return routePath === '/' || /^[A-Za-z0-9_./:\+-]+$/.test(routePath);
}

function zendFrameworkHandlerFromRouteTarget(input: {
  controller: string;
  action: string;
  module?: string;
}): string | null {
  if (!isZendFrameworkControllerOrActionSegment(input.controller) || !isZendFrameworkControllerOrActionSegment(input.action)) {
    return null;
  }
  const controllerName = `${pascalCaseRouteSegments([input.controller])}Controller`;
  const actionBaseName = lowerCamelCaseRouteSegments([input.action]);
  const actionName = actionBaseName ? `${actionBaseName}Action` : 'Action';
  if (controllerName === 'Controller' || actionName === 'Action') return null;
  const module = input.module?.trim();
  if (module && module.toLowerCase() !== 'default') {
    if (!isZendFrameworkControllerOrActionSegment(module)) return null;
    return `Zend:${pascalCaseRouteSegments([module])}_${controllerName}@${actionName}`;
  }
  return `Zend:${controllerName}@${actionName}`;
}

function isZendFrameworkControllerOrActionSegment(value: string): boolean {
  return /^[A-Za-z_][\w-]*$/.test(value);
}

function zendFrameworkRouteMethod(value: string | undefined): string | null {
  const method = value?.trim().toUpperCase();
  return method && /^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)$/.test(method) ? method : null;
}

function drupalHookMenuRouteMatchesForContent(content: string): DrupalRouteMatch[] {
  if (!/\bfunction\s+[A-Za-z_][\w]*_menu\s*\(/.test(content)) return [];

  const matches: DrupalRouteMatch[] = [];
  const hookMenu = /\bfunction\s+[A-Za-z_][\w]*_menu\s*\([^)]*\)\s*\{/g;
  for (const hookMatch of content.matchAll(hookMenu)) {
    const openBraceOffset = (hookMatch.index ?? 0) + hookMatch[0].lastIndexOf('{');
    const closeBraceOffset = matchingBraceOffset(content, openBraceOffset);
    if (closeBraceOffset === -1) continue;
    const body = content.slice(openBraceOffset + 1, closeBraceOffset);
    const bodyOffset = openBraceOffset + 1;
    matches.push(...drupalHookMenuItemRouteMatchesForBody(content, body, bodyOffset));
  }

  return uniqueDrupalRouteMatches(matches);
}

function drupalHookMenuItemRouteMatchesForBody(
  content: string,
  body: string,
  bodyOffset: number,
): DrupalRouteMatch[] {
  const matches: DrupalRouteMatch[] = [];
  const itemAssignment = /\$items\s*\[\s*(['"])([^'"]+)\1\s*\]\s*=\s*(array\s*\(|\[)/gi;
  for (const itemMatch of body.matchAll(itemAssignment)) {
    const routePath = itemMatch[2]?.trim();
    const openToken = itemMatch[3];
    if (!routePath || !openToken || !isStaticDrupalMenuPath(routePath)) continue;

    const matchOffset = bodyOffset + (itemMatch.index ?? 0);
    const openOffset = matchOffset + itemMatch[0].lastIndexOf(openToken.startsWith('[') ? '[' : '(');
    const closeOffset = openToken.startsWith('[')
      ? matchingBracketOffset(content, openOffset)
      : matchingParenOffset(content, openOffset);
    if (closeOffset === -1) continue;

    const itemValue = content.slice(openOffset, closeOffset + 1);
    const handler = drupalHookMenuHandlerFromItemValue(itemValue);
    if (!handler) continue;

    matches.push({
      method: 'ANY',
      route: normalizeRoutePath(routePath),
      handler: handler.handler,
      lineNo: lineNumberAtOffset(content, matchOffset),
      sourceLineNos: uniqueInOrder([
        lineNumberAtOffset(content, matchOffset),
        ...handler.sourceOffsets.map((offset) => lineNumberAtOffset(content, openOffset + offset)),
      ].filter((lineNo) => lineNo > 0)),
    });
  }
  return matches;
}

function drupalHookMenuHandlerFromItemValue(
  itemValue: string,
): { handler: string; sourceOffsets: number[] } | null {
  const callback = phpArrayStringValue(itemValue, 'page callback');
  const callbackOffset = phpArrayKeyOffset(itemValue, 'page callback');
  if (!callback || !isDrupalPageCallback(callback) || callbackOffset === null) return null;

  if (callback.toLowerCase() !== 'drupal_get_form') {
    return {
      handler: `Drupal:${callback}`,
      sourceOffsets: [callbackOffset],
    };
  }

  const pageArguments = phpArrayValueForKey(itemValue, 'page arguments');
  const pageArgumentsOffset = phpArrayKeyOffset(itemValue, 'page arguments');
  const formCallback = drupalGetFormCallbackFromPageArguments(pageArguments);
  if (!formCallback || pageArgumentsOffset === null) return null;
  return {
    handler: `Drupal:${formCallback}`,
    sourceOffsets: [callbackOffset, pageArgumentsOffset],
  };
}

function drupalGetFormCallbackFromPageArguments(value: string | null): string | null {
  if (!value) return null;
  const body = phpArrayLiteralBody(value);
  if (!body) return null;
  const firstArgument = splitTopLevelCommaArgs(body).at(0);
  const formCallback = phpStringLiteralArg(firstArgument);
  return formCallback && isDrupalPageCallback(formCallback) ? formCallback : null;
}

function isStaticDrupalMenuPath(routePath: string): boolean {
  if (!routePath || routePath.includes('$') || routePath.includes('{') || routePath.includes('}') || routePath.includes('*')) {
    return false;
  }
  return /^[A-Za-z0-9_./%:-]+$/.test(routePath);
}

function isDrupalPageCallback(value: string): boolean {
  return /^[A-Za-z_][\w]*$/.test(value);
}

function uniqueDrupalRouteMatches(matches: DrupalRouteMatch[]): DrupalRouteMatch[] {
  const seen = new Set<string>();
  const result: DrupalRouteMatch[] = [];
  for (const match of matches) {
    const key = `${match.method}\0${match.route}\0${match.handler}\0${match.lineNo}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(match);
  }
  return result;
}

function wordPressActionHookRouteMatchesForContent(content: string): WordPressRouteMatch[] {
  if (!/\badd_action\s*\(/.test(content)) return [];

  const matches: WordPressRouteMatch[] = [];
  const addActionCall = /\badd_action\s*\(/g;
  for (const callMatch of content.matchAll(addActionCall)) {
    const openParenOffset = (callMatch.index ?? 0) + callMatch[0].lastIndexOf('(');
    const closeParenOffset = matchingParenOffset(content, openParenOffset);
    if (closeParenOffset === -1) continue;
    const args = splitTopLevelCommaArgs(content.slice(openParenOffset + 1, closeParenOffset));
    const hookName = phpStringLiteralArg(args[0]);
    const callback = wordPressCallbackHandlerFromValue(args[1]);
    if (!hookName || !callback) continue;
    const route = wordPressActionHookRoute(hookName);
    if (!route) continue;
    const lineNo = lineNumberAtOffset(content, callMatch.index ?? 0);
    matches.push({
      method: 'ANY',
      route,
      handler: callback,
      lineNo,
      sourceLineNos: [lineNo],
    });
  }
  return uniqueWordPressRouteMatches(matches);
}

function wordPressActionHookRoute(hookName: string): string | null {
  const normalized = hookName.trim();
  const adminPost = /^admin_post_(?:nopriv_)?([A-Za-z0-9_-]+)$/.exec(normalized);
  if (adminPost?.[1]) {
    return `/wp-admin/admin-post.php?action=${adminPost[1]}`;
  }
  const ajax = /^wp_ajax_(?:nopriv_)?([A-Za-z0-9_-]+)$/.exec(normalized);
  if (ajax?.[1]) {
    return `/wp-admin/admin-ajax.php?action=${ajax[1]}`;
  }
  return null;
}

function wordPressRestRouteMatchesForContent(content: string): WordPressRouteMatch[] {
  if (!/\bregister_rest_route\s*\(/.test(content)) return [];

  const matches: WordPressRouteMatch[] = [];
  const registerRestRouteCall = /\bregister_rest_route\s*\(/g;
  for (const callMatch of content.matchAll(registerRestRouteCall)) {
    const openParenOffset = (callMatch.index ?? 0) + callMatch[0].lastIndexOf('(');
    const closeParenOffset = matchingParenOffset(content, openParenOffset);
    if (closeParenOffset === -1) continue;

    const argsText = content.slice(openParenOffset + 1, closeParenOffset);
    const args = splitTopLevelCommaArgsWithOffsets(argsText);
    const namespaceArg = args[0];
    const routeArg = args[1];
    const endpointArgsArg = args[2];
    const namespace = phpStringLiteralArg(namespaceArg?.value);
    const routePath = phpStringLiteralArg(routeArg?.value);
    if (!namespace || !routePath || !endpointArgsArg) continue;
    if (!isStaticWordPressRestNamespace(namespace) || !isStaticWordPressRestRoutePath(routePath)) continue;

    const route = wordPressRestRoutePath(namespace, routePath);
    if (!route) continue;

    const endpointArgsOffset = openParenOffset + 1 + endpointArgsArg.offset;
    for (const endpointArgs of wordPressRestEndpointArgs(endpointArgsArg.value)) {
      const callback = phpArrayEntryForKey(endpointArgs.value, 'callback');
      const callbackHandler = wordPressCallbackHandlerFromValue(callback?.value);
      if (!callbackHandler) continue;

      const methodEntry = phpArrayEntryForKey(endpointArgs.value, 'methods');
      const methods = wordPressRestMethodsFromValue(methodEntry?.value);
      const sourceLineNos = uniqueInOrder([
        lineNumberAtOffset(content, callMatch.index ?? 0),
        lineNumberAtOffset(content, openParenOffset + 1 + (namespaceArg?.offset ?? 0)),
        lineNumberAtOffset(content, openParenOffset + 1 + (routeArg?.offset ?? 0)),
        callback ? lineNumberAtOffset(content, endpointArgsOffset + endpointArgs.offset + callback.offset) : 0,
        methodEntry ? lineNumberAtOffset(content, endpointArgsOffset + endpointArgs.offset + methodEntry.offset) : 0,
      ].filter((lineNo) => lineNo > 0)).sort((a, b) => a - b);

      for (const method of methods.length ? methods : ['ANY']) {
        matches.push({
          method,
          route,
          handler: callbackHandler,
          lineNo: lineNumberAtOffset(content, callMatch.index ?? 0),
          sourceLineNos,
        });
      }
    }
  }

  return uniqueWordPressRouteMatches(matches);
}

function wordPressRestEndpointArgs(value: string): Array<{ value: string; offset: number }> {
  if (phpArrayEntryForKey(value, 'callback')) return [{ value, offset: 0 }];

  const body = phpArrayLiteralBodyWithOffset(value);
  if (!body) return [];
  return splitTopLevelCommaArgsWithOffsets(body.body)
    .filter((item) => phpArrayEntryForKey(item.value, 'callback') !== null)
    .map((item) => ({
      value: item.value,
      offset: body.offset + item.offset,
    }));
}

function wordPressRestRoutePath(namespace: string, routePath: string): string | null {
  const normalizedNamespace = namespace.trim().replace(/^\/+|\/+$/g, '');
  if (!normalizedNamespace) return null;
  return combineExpressRoutes(`/wp-json/${normalizedNamespace}`, routePath);
}

function isStaticWordPressRestNamespace(namespace: string): boolean {
  if (!namespace || /[$%{}[\]*]/.test(namespace)) return false;
  return /^[A-Za-z0-9_./-]+$/.test(namespace);
}

function isStaticWordPressRestRoutePath(routePath: string): boolean {
  if (!routePath || /[$%{}]/.test(routePath)) return false;
  return /^\/?[A-Za-z0-9_./<>()?+\\[\]:|-]+$/.test(routePath);
}

function wordPressRestMethodsFromValue(value: string | undefined): string[] {
  if (!value) return [];
  const literal = phpStringLiteralArg(value);
  if (literal) return wordPressRestMethodsFromString(literal);

  const body = phpArrayLiteralBody(value);
  if (body) {
    return uniqueInOrder(splitTopLevelCommaArgs(body)
      .flatMap((item) => wordPressRestMethodsFromValue(item)));
  }

  const normalized = value.trim().replace(/^\\+/, '');
  if (/^WP_REST_Server::READABLE$/i.test(normalized)) return ['GET'];
  if (/^WP_REST_Server::CREATABLE$/i.test(normalized)) return ['POST'];
  if (/^WP_REST_Server::EDITABLE$/i.test(normalized)) return ['POST', 'PUT', 'PATCH'];
  if (/^WP_REST_Server::DELETABLE$/i.test(normalized)) return ['DELETE'];
  if (/^WP_REST_Server::ALLMETHODS$/i.test(normalized)) return ['ANY'];
  return [];
}

function wordPressRestMethodsFromString(value: string): string[] {
  const methods = value
    .split(/[,\s|]+/)
    .map((method) => method.trim().toUpperCase())
    .filter((method) => /^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)$/.test(method));
  return uniqueInOrder(methods);
}

function wordPressCallbackHandlerFromValue(value: string | undefined): string | null {
  const functionName = phpStringLiteralArg(value);
  if (functionName && isWordPressActionCallback(functionName)) return `WordPress:${functionName}`;

  const body = value ? phpArrayLiteralBody(value) : null;
  if (!body) return null;
  const args = splitTopLevelCommaArgs(body);
  const className = wordPressCallbackClassNameFromArg(args[0]);
  const methodName = phpStringLiteralArg(args[1]);
  if (!className || !methodName || !isWordPressActionCallback(methodName)) return null;
  return `WordPress:${className}@${methodName}`;
}

function wordPressCallbackClassNameFromArg(value: string | undefined): string | null {
  const literal = phpStringLiteralArg(value);
  if (literal) return wordPressCallbackClassName(literal);

  const classConstant = /^\s*\\?([A-Za-z_][\w\\]*)(?:::class)\s*$/i.exec(value ?? '');
  return wordPressCallbackClassName(classConstant?.[1]);
}

function wordPressCallbackClassName(value: string | undefined): string | null {
  if (!value || !/^\\?[A-Za-z_][\w\\]*$/.test(value)) return null;
  const className = phpClassBaseName(value);
  return className && /^[A-Za-z_][\w]*$/.test(className) ? className : null;
}

function isWordPressActionCallback(value: string): boolean {
  return /^[A-Za-z_][\w]*$/.test(value);
}

function uniqueWordPressRouteMatches(matches: WordPressRouteMatch[]): WordPressRouteMatch[] {
  const seen = new Set<string>();
  const result: WordPressRouteMatch[] = [];
  for (const match of matches) {
    const key = `${match.method}\0${match.route}\0${match.handler}\0${match.lineNo}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(match);
  }
  return result;
}

function pascalCaseRouteSegments(segments: readonly string[]): string {
  return segments
    .flatMap((segment) => segment.split(/[-_]/).filter(Boolean))
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join('');
}

function lowerCamelCaseRouteSegments(segments: readonly string[]): string {
  const pascal = pascalCaseRouteSegments(segments);
  return pascal ? `${pascal.charAt(0).toLowerCase()}${pascal.slice(1)}` : '';
}

function aspNetRouteAttributesForLine(line: string, lineNo: number): AspNetRouteAttribute[] {
  const attributes: AspNetRouteAttribute[] = [];
  const routeAttribute = /\[(HttpGet|HttpPost|HttpPut|HttpPatch|HttpDelete|HttpOptions|Route)(?:\s*\(([^)]*)\))?\]/gi;
  for (const match of line.matchAll(routeAttribute)) {
    const name = match[1]!;
    const args = match[2] ?? '';
    attributes.push({
      method: methodFromAspNetAttribute(name),
      route: routeFromAspNetAttributeArgs(args),
      sourceLine: lineNo,
    });
  }
  return attributes;
}

function methodFromAspNetAttribute(name: string): string {
  const method = name.replace(/^Http/i, '').toUpperCase();
  return method === 'ROUTE' ? 'ANY' : method;
}

function routeFromAspNetAttributeArgs(args: string): string | null {
  const route = /['"`]([^'"`]+)['"`]/.exec(args)?.[1]?.trim();
  return route || null;
}

function aspNetRouteWithControllerToken(route: string, className: string): string {
  const controller = className.replace(/Controller$/i, '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  return normalizeRoutePath(route.replace(/\[controller\]/gi, controller));
}

function combineAspNetRoutes(prefix: string | null, route: string | null): string | null {
  if (!prefix && !route) return null;
  if (!prefix) return normalizeRoutePath(route!);
  if (!route || route === '/') return normalizeRoutePath(prefix);
  if (route.startsWith('/') || route.startsWith('~/')) return normalizeRoutePath(route);
  return normalizeRoutePath(`${prefix}/${route}`);
}

function domainKindFor(name: string, path: string): InventoryDomainEntity['kind'] | null {
  const lowerName = name.toLowerCase();
  const lowerPath = path.toLowerCase();
  if (lowerName.endsWith('dto')) return 'dto';
  if (lowerName.endsWith('entity')) return 'entity';
  if (lowerName.endsWith('schema')) return 'schema';
  if (lowerName.endsWith('model')) return 'model';
  if (lowerName.endsWith('table') || lowerName.endsWith('record')) return 'table';
  if (/\bdtos?\b|\.dto\.|dto$/.test(lowerPath)) return 'dto';
  if (/\bentities?\b|\.entity\.|entity$/.test(lowerPath)) return 'entity';
  if (/\bschemas?\b|\.schema\.|schema$/.test(lowerPath)) return 'schema';
  if (/\bmodels?\b|\.model\.|model$/.test(lowerPath)) return 'model';
  if (/\btables?\b|\.table\.|table$/.test(lowerPath)) return 'table';
  return null;
}

function domainConfidence(name: string, path: string): number {
  const lowerName = name.toLowerCase();
  const lowerPath = path.toLowerCase();
  const nameSignal = /(model|entity|dto|schema|table|record)$/.test(lowerName);
  const pathSignal = /(models?|entities?|dtos?|schemas?|tables?|database|store)/.test(lowerPath);
  if (nameSignal && pathSignal) return 0.85;
  if (nameSignal) return 0.75;
  return 0.65;
}

function isTestFilePath(path: string): boolean {
  const lower = path.toLowerCase();
  return /(^|\/)(__tests__|tests?|spec)\//.test(lower)
    || /\.(test|spec)\.[cm]?[jt]sx?$/.test(lower)
    || /test\.java$/.test(lower)
    || /_test\.go$/.test(lower)
    || /(^|\/)test_[^/]+\.py$/.test(lower);
}

function frameworkHint(path: string, content: string): string | null {
  const lower = `${path}\n${content}`.toLowerCase();
  if (lower.includes('vitest')) return 'vitest';
  if (lower.includes('jest')) return 'jest';
  if (lower.includes('playwright')) return 'playwright';
  if (lower.includes('@test') || path.endsWith('Test.java')) return 'junit';
  if (path.endsWith('_test.go')) return 'go test';
  if (/(^|\/)test_[^/]+\.py$/.test(path) || lower.includes('pytest')) return 'pytest';
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(path)) return 'javascript-test';
  return null;
}

function targetHintsForTestPath(path: string): string[] {
  const base = basenameWithoutExt(path)
    .replace(/\.(test|spec)$/i, '')
    .replace(/Test$/i, '')
    .replace(/^test_/i, '');
  const parts = path.split('/').filter((part) => !['test', 'tests', '__tests__', 'spec'].includes(part.toLowerCase()));
  return uniqueSorted([
    base,
    ...parts.slice(Math.max(0, parts.length - 3), -1).map((part) => basenameWithoutExt(part)),
  ].filter(Boolean));
}

function countByPath(items: Array<{ path: string }>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.path, (counts.get(item.path) ?? 0) + 1);
  return counts;
}

function capabilityKeyForEntrypoint(entrypoint: InventoryEntrypoint): string {
  if (entrypoint.kind === 'http_route') {
    const wcfHostService = /^WCF:([A-Za-z_][\w]*)$/.exec(entrypoint.handler ?? '')?.[1];
    if (wcfHostService) return `api:${javaIdentifierRouteSegment(wcfHostService)}`;
    const segment = firstMeaningfulRouteSegment(entrypoint.route);
    return `api:${segment || basenameWithoutExt(entrypoint.path)}`;
  }
  if (entrypoint.kind === 'cli_script') return `cli:${entrypoint.label.replace(/^Script:\s*/, '')}`;
  if (entrypoint.kind === 'job' || entrypoint.kind === 'queue') return `job:${basenameWithoutExt(entrypoint.path)}`;
  if (entrypoint.kind === 'app_bootstrap') return `module:${moduleishPath(entrypoint.path)}`;
  return `unknown:${basenameWithoutExt(entrypoint.path)}`;
}

function firstMeaningfulRouteSegment(route: string | undefined): string | null {
  const actionMatch = /[?&]action=([A-Za-z0-9_-]+)/.exec(route ?? '');
  const actionSegment = firstMeaningfulActionSegment(actionMatch?.[1]);
  if (actionSegment) return actionSegment;

  const ignored = new Set(['api', 'v1', 'v2', 'v3', 'rest', 'soap', 'wcf', 'asmx', 'wp-json']);
  for (const part of route?.split('/') ?? []) {
    const normalized = part.trim();
    if (!normalized || normalized.startsWith(':') || normalized.startsWith('{') || /^\[.+\]$/.test(normalized)) continue;
    if (ignored.has(normalized.toLowerCase()) || /^v\d+$/i.test(normalized)) continue;
    return normalized;
  }
  return null;
}

function firstMeaningfulActionSegment(action: string | undefined): string | null {
  const ignored = new Set(['action', 'admin', 'ajax', 'post', 'save', 'submit', 'handle']);
  for (const part of action?.split(/[-_]/) ?? []) {
    const normalized = part.trim();
    if (!normalized || ignored.has(normalized.toLowerCase()) || /^v\d+$/i.test(normalized)) continue;
    return normalized;
  }
  return null;
}

function nextRoutePath(path: string): string | null {
  const parts = path.split('/');
  const routeFile = parts.at(-1);
  if (!routeFile || !/^route\.[cm]?[jt]sx?$/.test(routeFile)) return null;
  const appIndex = parts.indexOf('app');
  if (appIndex === -1 || parts[appIndex + 1] !== 'api') return null;
  const routeParts = parts.slice(appIndex + 1, -1);
  if (routeParts.length === 0) return null;
  return `/${routeParts.join('/')}`;
}

function capabilityKind(entrypoints: InventoryEntrypoint[]): InventoryCapability['kind'] {
  if (entrypoints.some((entrypoint) => entrypoint.kind === 'http_route')) return 'api';
  if (entrypoints.some((entrypoint) => entrypoint.kind === 'cli_script')) return 'cli';
  if (entrypoints.some((entrypoint) => entrypoint.kind === 'job' || entrypoint.kind === 'queue')) return 'job';
  if (entrypoints.some((entrypoint) => entrypoint.kind === 'app_bootstrap')) return 'module';
  return 'unknown';
}

function capabilityLabel(key: string, entrypoints: InventoryEntrypoint[]): string {
  const [kind = 'unknown', raw = 'unknown'] = key.split(':');
  if (kind === 'api') return `${humanizeToken(raw)} API`;
  if (kind === 'cli') return `CLI script: ${raw}`;
  if (kind === 'job') return `Background capability: ${humanizeToken(raw)}`;
  if (kind === 'module') return `Module capability: ${raw}`;
  return entrypoints[0]?.label ?? humanizeToken(raw);
}

function capabilityConfidence(
  entrypoints: InventoryEntrypoint[],
  symbols: InventorySymbol[],
  tests: InventoryTestSurface[],
): number {
  const entrypointSignal = entrypoints.length ? Math.max(...entrypoints.map((entrypoint) => entrypoint.confidence)) : 0.45;
  const support = (symbols.length ? 0.05 : 0) + (tests.length ? 0.08 : 0);
  return Math.min(0.95, Number((entrypointSignal + support).toFixed(2)));
}

function includesToken(value: string, token: string): boolean {
  if (!token) return false;
  const normalizedValue = slugify(value);
  const normalizedToken = slugify(token);
  const singularToken = normalizedToken.replace(/s$/, '');
  return normalizedValue.includes(normalizedToken)
    || (singularToken.length >= 3 && normalizedValue.includes(singularToken));
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function uniqueInOrder<T extends string | number>(values: T[]): T[] {
  const seen = new Set<T>();
  const result: T[] = [];
  for (const value of values) {
    if ((typeof value === 'string' && value.length === 0) || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function humanizeToken(token: string): string {
  return token
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (value) => value.toUpperCase())
    .trim() || 'Unknown';
}

function moduleishPath(path: string): string {
  const parts = path.split('/');
  if ((parts[0] === 'apps' || parts[0] === 'packages') && parts[1]) return `${parts[0]}/${parts[1]}`;
  return parts[0] || path;
}

function basenameWithoutExt(path: string): string {
  return basename(path).replace(/\.[^.]+$/, '');
}

function parentPath(path: string): string {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/');
}

function joinPathParts(parts: readonly string[]): string {
  return parts.filter(Boolean).join('/');
}

function siblingPath(path: string, siblingName: string): string {
  const parts = path.split('/');
  parts.pop();
  return [...parts, siblingName].filter(Boolean).join('/');
}

function titleFromPath(path: string): string {
  return humanizeToken(basenameWithoutExt(path));
}

async function collectRepoSnapshot(
  repoRoot: string,
  warnings: InventoryWarning[],
): Promise<InventoryRepoSnapshot> {
  const branch = await gitLine(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'], warnings, 'git.branch_unavailable');
  const commit = await gitLine(repoRoot, ['rev-parse', 'HEAD'], warnings, 'git.commit_unavailable');
  const status = await gitLine(repoRoot, ['status', '--porcelain'], warnings, 'git.status_unavailable', true);
  return {
    root: repoRoot,
    branch,
    commit,
    dirty: status === null ? null : status.length > 0,
  };
}

async function collectGitSummary(
  repoRoot: string,
  limits: InventoryLimits,
  warnings: InventoryWarning[],
): Promise<InventoryGitSummary | null> {
  const log = await gitLine(
    repoRoot,
    ['log', `-${limits.maxGitCommits}`, '--date=short', '--pretty=format:%H%x09%ad%x09%s'],
    warnings,
    'git.log_unavailable',
    true,
  );
  if (log === null) return null;
  const recentCommits = log
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [hash = '', date = '', ...subjectParts] = line.split('\t');
      return { hash: hash.slice(0, 12), date, subject: subjectParts.join('\t') };
    })
    .filter((commit) => commit.hash && commit.subject);

  const files = await gitLine(
    repoRoot,
    ['log', `-${limits.maxGitCommits}`, '--name-only', '--pretty=format:'],
    warnings,
    'git.churn_unavailable',
    true,
  );
  const counts = new Map<string, number>();
  for (const line of (files ?? '').split('\n')) {
    const path = normalizePath(line.trim());
    if (!path) continue;
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  const churnHotspots = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limits.maxChurnPaths)
    .map(([path, commitCount]) => ({ path, commitCount }));

  return { recentCommits, churnHotspots };
}

async function gitLine(
  cwd: string,
  args: string[],
  warnings: InventoryWarning[],
  code: string,
  allowEmpty = false,
): Promise<string | null> {
  try {
    const result = await sh('git', args, { cwd, timeoutMs: 5000 });
    if (result.exitCode !== 0) {
      warnings.push({ code, message: result.stderr.trim() || `git ${args[0]} failed`, sourceRefs: [] });
      return null;
    }
    const value = result.stdout.trim();
    return value || allowEmpty ? value : null;
  } catch (err) {
    warnings.push({
      code,
      message: err instanceof Error ? err.message : String(err),
      sourceRefs: [],
    });
    return null;
  }
}

function exclusionReason(path: string, isDirectory: boolean): InventoryExclusion['reason'] | null {
  const parts = path.split('/');
  const lower = path.toLowerCase();
  const base = basename(path).toLowerCase();
  if (parts.some((part) => GENERATED_DIRS.has(part))) return 'generated';
  if (base === '.env' || base.startsWith('.env.')) return 'sensitive';
  if (/(^|\/)(secrets?|credentials?|private-key|id_rsa|id_ed25519)(\/|$)/i.test(path)) return 'sensitive';
  if (/\.(pem|key|p12|pfx|sqlite|sqlite3|db)$/i.test(path)) return 'sensitive';
  if (lower.includes('credential') || lower.includes('secret')) return 'sensitive';
  if (isDirectory && base.endsWith('.db')) return 'sensitive';
  return null;
}

function isBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  if (sample.includes(0)) return true;
  let suspicious = 0;
  for (const byte of sample) {
    if (byte < 7 || (byte > 14 && byte < 32)) suspicious += 1;
  }
  return suspicious / sample.length > 0.3;
}

function isMarkdownDoc(path: string): boolean {
  const base = basename(path);
  return /^readme/i.test(base) || path.startsWith('docs/') && /\.mdx?$/i.test(path) || /\.md$/i.test(path);
}

function isCiPath(path: string): boolean {
  return path.startsWith('.github/workflows/') || path.startsWith('.gitlab-ci') || path === 'Jenkinsfile';
}

function isTestConfig(path: string): boolean {
  const base = basename(path).toLowerCase();
  return base.includes('vitest.config') || base.includes('jest.config') || base.includes('playwright.config');
}

function markdownHeadings(content: string): string[] {
  return content
    .split('\n')
    .map((line) => /^#{1,6}\s+(.+?)\s*$/.exec(line)?.[1]?.trim())
    .filter((heading): heading is string => Boolean(heading));
}

function configSummary(path: string, content: string): string {
  if (path === 'package.json') {
    try {
      const parsed = JSON.parse(content) as { name?: unknown; scripts?: Record<string, unknown>; dependencies?: object; devDependencies?: object };
      const scripts = Object.keys(parsed.scripts ?? {}).sort();
      const deps = Object.keys(parsed.dependencies ?? {}).length + Object.keys(parsed.devDependencies ?? {}).length;
      return [
        typeof parsed.name === 'string' ? `package ${parsed.name}` : 'package.json',
        scripts.length ? `scripts: ${scripts.join(', ')}` : null,
        deps ? `dependencies: ${deps}` : null,
      ].filter(Boolean).join('; ');
    } catch {
      return excerpt(content, 240);
    }
  }
  return excerpt(content, 240);
}

function excerpt(content: string, max: number): string {
  const normalized = content.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}

function normalizePath(path: string): string {
  return path.split(sep).join('/').replace(/^\.\//, '');
}

function basename(path: string): string {
  return path.split('/').at(-1) ?? path;
}

function moduleLabel(path: string): string {
  const parts = path.split('/');
  if (parts[0] === 'apps' && parts[1]) return `App: ${parts[1]}`;
  if (parts[0] === 'packages' && parts[1]) return `Package: ${parts[1]}`;
  return `Directory: ${path}`;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'root';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function camelToSnake(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

function sortById<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
}

function sortExclusions(items: InventoryExclusion[]): InventoryExclusion[] {
  return [...items].sort((a, b) => a.path.localeCompare(b.path) || a.reason.localeCompare(b.reason));
}
