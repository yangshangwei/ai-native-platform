# OSS Codebase Understanding Patterns

## Source

GitHub repository search and prior project inspection for tools that help LLMs
understand existing codebases quickly.

## Representative Patterns

### Repository Digest

Examples: `gitingest/gitingest`, `yamadashy/repomix`,
`kamilstanuch/codebase-digest`.

Common shape:

- Apply ignore/safety filters.
- Pack selected repository files into a token-budgeted text or XML/Markdown
  bundle.
- Preserve file paths and source boundaries so an LLM can cite or navigate.

Strength: fast and simple.

Weakness: still file-centric; it often tells the LLM "what files exist" rather
than "what capabilities the system exposes."

### Repository Map / Symbol Map

Examples: Aider's repo map concept, `sirmews/repo-map`,
`dotcommander/repomap`.

Common shape:

- Parse or heuristically extract classes, functions, exported symbols, and
  important declarations.
- Rank by relevance, centrality, path importance, and token budget.
- Emit a compact outline rather than full source.

Strength: high signal for navigation and change planning.

Weakness: language support and parser dependencies can become expensive.

### RAG / Semantic Code Search

Examples: Continue, Sourcegraph Cody-style systems, `ai-code-pilot`,
`CodeMap`, `CodeBase_RAG`.

Common shape:

- Chunk source and docs.
- Build vector and keyword indexes.
- Retrieve relevant chunks per question/task.

Strength: useful after onboarding for task-specific lookup.

Weakness: not enough by itself for durable onboarding; embeddings can retrieve
nearby text without exposing system boundaries, entrypoints, or evidence
quality.

### Static Analysis / Knowledge Graph

Examples: `gitgalaxy`, `repolens`.

Common shape:

- Extract routes, dependencies, tech stack, modules, call/dependency graph, and
  security/supply-chain signals.
- Keep deterministic facts separate from optional LLM enrichment.

Strength: better evidence quality for legacy modernization.

Weakness: full graph construction is larger than this MVP.

### Multi-Agent Documentation

Examples: `divar-ir/ai-doc-gen`, `RepoCrawler`.

Common shape:

- Split repository understanding across agents.
- Generate onboarding documentation and summaries.

Strength: rich documents.

Weakness: without deterministic source refs and review gates, generated docs can
look authoritative while mixing facts, inferences, and guesses.

## Takeaways For AINP

- Keep the current read-only inventory as the first evidence layer.
- Add deterministic code intelligence before LLM synthesis:
  entrypoints, symbol map, domain/entity hints, test surfaces, and hotspots.
- Produce a capability-oriented map, not only file summaries.
- Use RAG/context retrieval later for task-specific lookup; do not make
  embeddings the sole project profile source.
- Preserve `sourceRefs`, confidence, warnings, and Knowledge Gate review before
  anything becomes durable project knowledge.
