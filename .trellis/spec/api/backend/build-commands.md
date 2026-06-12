# Project Build Commands (T3.2)

> Contract for the optional project-level custom build/test commands that
> replace the hardcoded Maven commands in the runner's `build_test` step.
> Established by task `06-12-abstract-build-and-test-commands-away-from-maven-hardcode`.

---

## Field Contract

`Project` (`packages/shared/src/types/project.ts`) carries two optional,
flat fields:

| Field | DB column (migrations 22/23) | Meaning |
|-------|------------------------------|---------|
| `buildCompileCommand?: string \| null` | `projects.build_compile_command TEXT` | Custom compile command. `null`/missing = runner's Maven default (`./mvnw`/`mvn -B -DskipTests compile`). |
| `buildTestCommand?: string \| null` | `projects.build_test_command TEXT` | Custom test command. `null`/missing = Maven default (`./mvnw`/`mvn -B test`). |

These are **intrinsic project registration attributes** — not runtime config,
and there is no build-tool auto-detection.

## API Validation (registration hygiene, NOT the security gate)

`POST /projects` and `PUT /projects/:id` (`apps/api/src/routes/projects.ts`,
`resolveBuildCommand`) normalize each field:

- non-empty string → trimmed and validated; **rejected with 400** when it
  contains shell metacharacters (`&&`, `||`, `;`, `|`, `>`, `<`, backtick,
  `$(`, `"`, `'`) or embedded control characters (newline, `\r`, tab, NUL —
  anything in `\u0000-\u001f` / `\u007f` surviving the trim) — see
  `customBuildCommandError` in `packages/shared/src/utils/whitelist.ts`;
- `null` or empty/whitespace string → cleared to `null`;
- **PUT merge semantics**: field omitted from the body = keep current value;
  explicit `null` or empty string = clear; non-empty string = set.

## Command Format Limitation (no shell)

The runner executes commands with `command.split(/\s+/)` → `spawn(program,
args)` and **no shell** (`apps/runner/src/command-runner.ts`). Therefore:

- command chaining (`&&`, `;`, `|`), redirection, env-var prefixes and
  substitution do not work and are rejected at registration;
- **quoted arguments are unsupported** (whitespace splitting) — e.g.
  `mvn -Dtest="Foo Bar" test` cannot be expressed. Known limitation; use a
  wrapper script inside the repository if needed.

## Whitelist `extraAllow` (the hard gate stays in the runner)

`isWhitelisted(command, extraAllow?)` accepts a second parameter of
project-level additions matched by **exact trimmed string equality** (never
regex/prefix). `executeBuildTest` passes the project's non-empty custom
commands as `extraAllow` to `runWhitelistedCommand`; the whitelist check at
spawn time remains the enforcement point — API validation is only front-line
hygiene. Projects without custom commands produce byte-for-byte the historical
Maven command strings, which still match the 8 static whitelist patterns.

## test_gate Conditional Degrade (the only semantic change)

`runTestGate` (`apps/api/src/gate-engine.ts`), rule `test.surefire_present`:

- when **(a)** the run's project has a non-empty `buildTestCommand` **and
  (b)** the `stage='test'` CommandRun exited 0, missing surefire aggregates
  degrade the rule to `warn` with message
  `no structured test report (custom test command)` (evidence: the test
  CommandRun);
- every other case (default Maven path, non-zero exit, missing project)
  keeps the hard `fail`.

The project lookup goes `workflowRunId → store.workflowRuns →
store.projects`; gate-engine must NOT import workflow-engine.

## Unchanged Shapes

`BuildRun`/`TestRun` literal fields stay as-is; `mavenCommand` records the
actual command string (`"<compile> && <test>"` — display-only, never
executed). `jdkVersion` reporting and `collectReports` keep running; custom
command projects typically yield `reports: []`, which the existing pipeline
already tolerates.

---

**Language**: All documentation should be written in **English**.
