# GitHub Codebase Understanding Patterns

Date: 2026-07-04

## Scope

This note captures public GitHub evidence for how mainstream AI coding and code-search tools help an AI quickly understand an existing codebase, especially old or weakly documented projects.

GitHub REST code search requires authentication, so this pass used public repository metadata plus raw README/source files that are available without credentials. It is enough for architectural direction, not a line-by-line implementation audit of each project.

## Repositories Checked

| Project | GitHub evidence | Relevant pattern |
| --- | --- | --- |
| Aider (`Aider-AI/aider`, 47k stars) | README says it "maps your codebase"; `aider/repomap.py` uses tree-sitter via `grep_ast`, tag extraction, ranking, caching, and token budgeting. | Build a compact repo map from symbols and references before asking the LLM to reason. |
| Continue (`continuedev/continue`, 34k stars) | README describes an open-source coding agent, but also says the repo is read-only / no longer actively maintained. | Agent UX and context plumbing are useful references, but not the best source for current indexing architecture. |
| Sourcegraph Cody public snapshot (`sourcegraph/cody-public-snapshot`, 3.8k stars; Sourcegraph public snapshot 10k stars) | README says Cody uses advanced search, semantic search, APIs, symbols, usage patterns, local and remote codebase context. | Combine keyword/code search, semantic search, and symbol-aware context at repository scale. |
| Tabby (`TabbyML/tabby`, 33k stars) | README describes self-hosted AI coding assistant, repo-context for completion, RAG-based code completion, documentation ingestion, and locally relevant snippets from LSP/recent code. | Enterprise/self-hosted path: indexed repo context, docs, LSP snippets, and local control. |
| Bloop (`BloopAI/bloop`, 9.5k stars, archived) | README describes conversational/regex/symbol search, Tree-sitter navigation, Tantivy, Qdrant, and on-device embeddings. | Hybrid retrieval stack: lexical index + vector index + symbol/navigation index. |
| PocketFlow Tutorial Codebase Knowledge (`The-Pocket/PocketFlow-Tutorial-Codebase-Knowledge`, 12k stars) | README says it crawls repos, identifies core abstractions and interactions, then generates tutorials/visualizations. | Useful second-stage artifact: produce human-readable onboarding/tutorial output from the evidence graph. |

## Common Architecture Pattern

The stronger systems do not rely on a single LLM prompt over raw files. They layer:

1. File discovery and filtering: include/exclude rules, file size limits, generated/vendor/noise exclusion.
2. Structural index: symbols, definitions, references, imports, routes, tests, config, build commands.
3. Lexical retrieval: fast keyword/path/search index for exact names, routes, errors, table names.
4. Semantic retrieval: embeddings over source chunks and docs for fuzzy intent matching.
5. Graph ranking: connect entrypoints -> handlers -> services -> repositories -> data/tests.
6. Context assembly: choose small, source-ref backed sections under a token budget.
7. Explanation artifact: project map/tutorial/profile with facts, inferences, open questions, and confidence.
8. Feedback loop: user corrections become retrieval/capability corrections instead of one-off chat memory.

## Implication For This Project

The current MVP is aligned with the structural-index and context-assembly parts: `project-inventory.json` is the evidence authority, capabilities are the primary navigation layer, and source chunks are already hashable/indexable. The main missing production capability is durable cross-run retrieval:

- persist source chunks and inventory records across runs;
- add lexical + vector lookup over those records;
- make scanner confidence and user corrections influence future context selection;
- generate a stable project profile/tutorial artifact from the same evidence graph.

## Recommended Evolution

1. Keep `project-inventory.json` as the canonical evidence graph. Do not replace it with opaque embeddings.
2. Add a durable `source_chunk_index` store keyed by `contentSha256`, repo identity, commit, path, and line range.
3. Add hybrid retrieval: BM25/path/token matching first, vector similarity second, graph expansion third.
4. Materialize a `project-profile.md/json` onboarding artifact after scan, with source refs and confidence.
5. Add correction feedback: when a capability/domain match is wrong, store that correction and suppress it in future packs.
6. Expand framework coverage by eval-driven corpus increments, not by broad unmeasured heuristics.

## Risks

- Embeddings can improve recall but make hallucination easier if used as authority. Keep source refs and graph links as acceptance gates.
- Static framework scanners miss runtime registration, reflection, dependency injection, and dynamic routing. Treat runtime probing as an optional later layer.
- Generated tutorials are useful for onboarding but should be regenerated from evidence, not hand-maintained as truth.
