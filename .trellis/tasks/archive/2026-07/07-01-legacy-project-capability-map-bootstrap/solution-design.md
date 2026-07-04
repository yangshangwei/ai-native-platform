# Legacy Project Capability Map Bootstrap - Solution Design

## Summary

Enhance the existing profile bootstrap inventory into a deterministic
capability-oriented evidence package. The runner still performs a safe read-only
scan, but the output now gives the profile agent a map of:

- system entrypoints,
- relevant symbols,
- domain/entity hints,
- test surfaces,
- churn and complexity hotspots,
- inferred capabilities with source refs.

The architecture remains:

```text
profile.bootstrap
  inventory (engine, read-only)
    -> project-inventory.json
  profile (agent)
    -> project-profile.md
    -> project-profile.json
  completion
  knowledge
```

No new flow or API endpoint is needed for the MVP.

## Data Contract

`ProjectInventoryEnvelope` remains the inventory artifact envelope. Additive
fields:

```ts
interface ProjectInventoryEnvelope {
  schemaVersion: 'ainp.project_inventory.v1';
  // existing fields...
  entrypoints: InventoryEntrypoint[];
  symbols: InventorySymbol[];
  domainEntities: InventoryDomainEntity[];
  testSurfaces: InventoryTestSurface[];
  hotspots: InventoryHotspot[];
  capabilities: InventoryCapability[];
}
```

### Entrypoints

```ts
interface InventoryEntrypoint {
  id: string;
  kind: 'http_route' | 'cli_script' | 'job' | 'queue' | 'app_bootstrap';
  label: string;
  path: string;
  method?: string;
  route?: string;
  handler?: string;
  sourceRefs: string[];
  confidence: number;
}
```

Detection examples:

- HTTP route patterns: `app.get('/x', handler)`, `router.post('/x', ...)`,
  decorators such as `@Get('/x')`, Java/Spring annotations such as
  `@GetMapping`, `@PostMapping`, `@RequestMapping`.
- CLI scripts: package scripts already extracted from `package.json`.
- Jobs/queues: file/path/name hints such as `job`, `worker`, `queue`,
  `consumer`, `cron`, `schedule`.
- Bootstrap: files such as `main.ts`, `index.ts`, `server.ts`, `app.ts`,
  `Application.java`, `cmd/*/main.go`.

### Symbols

```ts
interface InventorySymbol {
  id: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'const' | 'method';
  name: string;
  path: string;
  exported: boolean;
  line: number;
  signature: string;
  sourceRefs: string[];
}
```

MVP extraction is dependency-free and heuristic:

- TypeScript/JavaScript: `export function`, `function`, `class`, `interface`,
  `type`, `const name =`.
- Java/Kotlin/C#/Go/Python/Ruby: shallow regex patterns for classes/functions
  where reliable enough.
- Always keep signatures compact and never include large source bodies.

### Domain Entities

```ts
interface InventoryDomainEntity {
  id: string;
  name: string;
  kind: 'model' | 'entity' | 'schema' | 'table' | 'dto' | 'unknown';
  path: string;
  sourceRefs: string[];
  confidence: number;
}
```

Detection examples:

- paths containing `model`, `models`, `entity`, `entities`, `schema`, `dto`,
  `database`, `store`;
- class/interface/type names ending in `Model`, `Entity`, `Dto`, `DTO`,
  `Schema`, `Record`;
- SQL/table-like config files may be detected later; MVP can focus on source
  and path/name hints.

### Test Surfaces

```ts
interface InventoryTestSurface {
  id: string;
  path: string;
  frameworkHint: string | null;
  targetHints: string[];
  sourceRefs: string[];
}
```

Detection examples:

- paths matching `*.test.*`, `*.spec.*`, `__tests__`, `test/`, `tests/`;
- framework hints from file names/configs: Vitest, Jest, Playwright, JUnit,
  Pytest, Go test.

### Hotspots

```ts
interface InventoryHotspot {
  id: string;
  path: string;
  reason: 'git_churn' | 'large_file' | 'symbol_dense' | 'entrypoint_dense';
  score: number;
  sourceRefs: string[];
}
```

Inputs:

- existing Git churn summary,
- source file byte size,
- symbol count per file,
- entrypoint count per file.

### Capabilities

```ts
interface InventoryCapability {
  id: string;
  label: string;
  kind: 'api' | 'cli' | 'job' | 'module' | 'test' | 'unknown';
  entrypointRefs: string[];
  moduleRefs: string[];
  symbolRefs: string[];
  testRefs: string[];
  hotspotRefs: string[];
  sourceRefs: string[];
  confidence: number;
  openQuestions: string[];
}
```

MVP grouping rules:

- HTTP route entrypoint -> API capability.
- CLI script -> CLI capability.
- job/queue/scheduler entrypoint -> job capability.
- module with test + symbols but no entrypoint -> module capability.

Each capability is deliberately conservative. If the scanner cannot prove
business semantics, it labels from route/script/module names and records open
questions.

## Scanner Pipeline

1. Enumerate files with existing filtering and budgets.
2. Read only files that passed sensitivity/binary/size/generated filters.
3. Build existing docs/config/CI/test sources and package commands.
4. Extract source candidates from all safe source files, not only files selected
   for document/config sources.
5. Generate symbol, entrypoint, domain, and test maps.
6. Build modules from paths.
7. Build hotspots from git churn and scanner-derived metrics.
8. Group capabilities from entrypoints/modules/tests/hotspots.
9. Return stable sorted arrays.

## Safety

- Do not execute project files.
- Do not parse or emit sensitive excluded paths.
- Do not include full source bodies in symbol/capability sections.
- Keep source refs path-based and line-based where possible:
  `file:<path>#L<line>`.
- Record warnings when budgets prevent complete capability extraction.

## Profile Agent Prompt Update

The `project-profile-bootstrap` skill should instruct the agent to:

- treat `capabilities` as the main navigation layer;
- cite `sourceRefs` for every load-bearing claim;
- use `entrypoints`, `symbols`, `domainEntities`, `testSurfaces`, and
  `hotspots` to populate architecture map, commands, test strategy, risk areas,
  domain vocabulary, and open questions;
- avoid claiming unsupported business meaning from heuristic names alone.

## Alternatives Considered

### A. Full RAG Index

Rejected for MVP. It introduces embedding storage, chunking policy, lifecycle,
and retrieval evaluation. Better as a later task after a deterministic
capability contract exists.

### B. Tree-sitter Parser Dependency

Rejected for MVP. It improves symbol quality but adds dependency and packaging
surface. The current project has a no-new-dependency default unless explicitly
needed. The contract should allow a parser-backed implementation later.

### C. Separate `project-capability-map.json` Artifact

Rejected for MVP. It would require additional artifact selection and profile
prompt plumbing. Additive fields inside `project-inventory.json` preserve the
existing flow and keep the profile stage simple.

## Rollout

This is additive. Existing profile bootstrap flows receive more evidence in the
same inventory artifact. If the scanner produces poor hints for a language, the
profile can still fall back to existing docs/config/git evidence.

## Risks

| Risk | Mitigation |
| --- | --- |
| Regex extraction misidentifies code symbols. | Use conservative confidence, compact signatures, source refs, and tests. |
| Capability labels imply business semantics not proven by code. | Include open questions and prompt agent to avoid unsupported claims. |
| Large repos exceed budget before important files are scanned. | Keep exclusions and add warning; future work can add priority walking. |
| New fields break strict consumers. | Existing TS code owns the interface; tests verify backward fields remain. |
| Security leak through source snippets. | No full source bodies in symbols/capabilities; reuse existing sensitive filtering. |
