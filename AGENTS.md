# Repository Guidelines

## Project Structure & Module Organization
This repository is a Bun workspace monorepo for an AI-native delivery MVP.

- `apps/api/`: Hono + Bun backend, workflow engine, gate engine, SQLite persistence.
- `apps/runner/`: local CLI runner (`ainp-runner`) for register/run/orchestrate flows.
- `apps/web/`: lightweight TypeScript web UI (served by `serve.ts`).
- `packages/shared/`: shared types and utilities (`types/*`, `utils/*`).
- `scripts/`: smoke and end-to-end scripts (`smoke.ts`, `e2e.ts`).
- `docs/`: design notes, handoff docs, and architecture context.
- `examples/java-maven-sample/`: sample project used by runner workflows.

## Build, Test, and Development Commands
Run from repository root:

- `bun install`: install all workspace dependencies.
- `bun run dev:api`: start API server on `:8787`.
- `bun run dev:web`: start web UI on `:5173` (proxies `/api/*`).
- `bun run runner -- doctor`: verify JDK/Maven/git prerequisites.
- `bun run runner -- register --path ./examples/java-maven-sample --name java-sample`: register sample project.
- `bun run smoke`: quick command-run smoke (`mvn -B test`).
- `bun run e2e`: full 9-stage lifecycle smoke with auto-approvals.
- `bun test`: run Vitest tests.
- `bun run typecheck`: run TypeScript checks across workspaces.

## Coding Style & Naming Conventions
- Language: TypeScript (ESM) across apps/packages.
- Indentation: 2 spaces; keep files ASCII unless existing file uses Unicode.
- Prefer small, focused modules and explicit types in `packages/shared/src/types`.
- Naming: kebab-case for files (`workflow-engine.ts`), camelCase for variables/functions, PascalCase for types/interfaces.
- Reuse shared utilities before adding new abstractions or dependencies.

## Testing Guidelines
- Framework: Vitest (`vitest.config.ts`).
- Test location: `packages/shared/test/*.test.ts` (extend same pattern per module).
- Test naming: `<unit>.test.ts`; keep tests deterministic and behavior-focused.
- Before PR: run `bun test`, `bun run typecheck`, and relevant smoke/e2e flows for workflow changes.

## Commit & Pull Request Guidelines
- Follow Lore-style commit messages: intent-first subject plus structured trailers when relevant (`Constraint`, `Rejected`, `Confidence`, `Tested`, `Not-tested`).
- Keep diffs small and reversible; prefer deletion over addition.
- PRs should include: purpose, key changes, verification evidence (commands + results), and risk notes.
- For UI changes, attach screenshots or short recordings from `apps/web`.
