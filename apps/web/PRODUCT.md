# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary users:** Enterprise development teams and their project managers.

- **Developers** use the platform to orchestrate AI-driven delivery from requirement to acceptance, monitor execution, and access generated artifacts (requirements, designs, code changes, test results, completion reports).
- **Project managers** review progress, approve gates (requirement, design, acceptance), and ensure quality standards are met before each stage advances.

Teams operate within established workflows and quality standards; the platform manages the lifecycle rather than just offering code suggestions.

## Product Purpose

An AI-powered software delivery workbench that orchestrates the complete lifecycle from a single-sentence requirement to validated, knowledge-captured delivery. The platform coordinates:

1. Requirement capture and approval
2. Design generation and review
3. AI-driven implementation in isolated worktrees
4. Local build and test execution (Maven/Gradle, real commands)
5. Structured acceptance and human approval
6. Completion report generation
7. Knowledge candidate creation and approval

Success means a developer or PM can initiate work with a brief description, the platform handles orchestration and quality gates, and the team receives validated deliverables with full traceability and evidence.

## Positioning

Unlike IDE code assistants (Cursor, GitHub Copilot) that suggest code, this platform **enforces a gated software lifecycle**: AI agents cannot advance workflow state on their own; every stage must pass automated rules (Gate Engine) and human approvals before proceeding. The platform integrates real local tooling (Git worktree, Maven, JUnit) and produces traceable artifacts at every step, not just code suggestions. The Workflow Engine is the single source of truth for state; agents execute tasks and attach evidence, but cannot declare gates passed.

## Operating Context

**Environment:** Local development machines with Git, JDK/Maven/Gradle, and either Claude Code or Codex CLI installed. The Web UI (browser-based) connects to a local API server; the API manages a local Runner process that creates isolated worktrees per workflow run.

**Workflows:** Teams register projects (local directories or Git repos), create workflow requests via the Web UI, and monitor execution. The Runner spawns agent tasks (via Claude Code or Codex), captures command output, parses test results (Surefire XML), and stores all artifacts in SQLite. Human approvals happen in the Web UI at requirement, design, and acceptance gates.

**Materials:** Source code repositories, existing test suites, build manifests (pom.xml, build.gradle). The platform preserves the project's existing toolchain and does not require Docker or cloud runners for the MVP.

## Capabilities and Constraints

**Capabilities:**
- Workflow orchestration across 8 stages: context_pack → requirement → design → implementation → build_test → review → completion → knowledge
- Support for three workflow types: `feature.standard`, `issue.standard`, `refactor.standard` (additional fast-forward variants exist)
- Local worktree isolation: each WorkflowRun gets its own Git worktree
- Real build/test execution: spawns `mvn -B test` and parses Surefire XML; CommandRun records stdout/stderr/exitCode
- Gate Engine with automated rules: diff scope validation, sensitive change detection, test integrity (no test weakening), compile/test exit code checks
- Human approval gates at requirement, design, and acceptance stages
- Completion report assembly (markdown artifact referencing all evidence)
- Knowledge candidate generation with manual approval gate
- Agent backend flexibility: projects choose Claude Code or Codex; the Runner adapts

**Constraints:**
- MVP targets Java/Maven projects; multi-language support is future work
- Local execution only; no Docker/Kubernetes/microVM sandboxing in v1
- No IDE plugin yet; all interaction via Web UI
- No deep PR/CI integration yet; workflow runs produce artifacts and reports locally

**Terminology:**
- **WorkflowRun:** a single execution instance from requirement to completion
- **StepRun:** a stage within a WorkflowRun (e.g., `requirement`, `implementation`)
- **GateRun:** an automated or manual validation checkpoint; agents attach notes but cannot override gate status
- **Artifact:** any output document (requirement.md, design.md, diff, report, knowledge candidate)
- **CommandRun:** a record of a real shell command execution (stdout/stderr/exitCode)
- **BuildRun / TestRun:** parsed results from Maven compile/test runs

## Brand Commitments

**Name:** "Octopus" is a temporary development codename. The final product name is undecided.

**Visual identity:** The current interface uses an octopus icon as a placeholder mark. This is not a locked brand asset; the final identity is open.

**Voice:** Technical and operational. The platform speaks to developers and project managers who understand software delivery workflows; copy is direct and evidence-focused (e.g., "Gate passed: no sensitive paths modified" or "Waiting for acceptance approval").

## Evidence on Hand

**Real content:**
- Working Web UI with project onboarding, task queue, run detail views, reports, knowledge browser, and settings
- API implementation in Hono + Bun, SQLite persistence, Workflow Engine, Gate Engine
- Local Runner CLI with worktree management, agent backend adapters (Claude Code / Codex), and Maven execution
- Sample Java/Maven project (`examples/java-maven-sample`) with passing JUnit tests
- Design system: CSS tokens, components, utilities, dark theme support

**Assets:**
- Octopus icon implemented as inline SVG
- CSS design system (`design-tokens.css`, `design-tokens-dark.css`, `components.css`, `utilities.css`, `animations.css`)
- Landing page (`landing.html`, `landing.css`, `landing.js`) — exists but its strategic role is unclear

**Absences:**
- No confirmed product name or logo
- No marketing copy, testimonials, or customer case studies
- No pricing or licensing information
- No external deployment URL; runs locally only

## Product Principles

1. **The Workflow Engine is the single authority for state.** Agents execute and report; they never write workflow status directly. This ensures auditability and prevents agents from bypassing quality gates.

2. **Agents propose; gates decide.** Every stage must pass its gate rules before advancing. Agents attach `agentNote` fields to GateRuns, but gate status is determined by the Gate Engine or human approval, never by the agent.

3. **Real execution over self-reported results.** Build and test outcomes come from actual command execution (`mvn -B test` spawned locally, Surefire XML parsed). This produces verifiable evidence and prevents agents from claiming success without proof.

4. **Traceable artifacts at every stage.** Each workflow stage produces durable artifacts (markdown documents, diffs, test results, reports) stored in SQLite and referenced in the completion report. Teams can inspect exactly what was generated and approved.

5. **Local-first, trust-based execution.** The MVP uses local Git worktrees and the developer's own toolchain (JDK, Maven, Git) rather than cloud sandboxes. This prioritizes speed and integration with existing environments; stronger isolation is future work.

## Accessibility & Inclusion

The Web UI must support keyboard navigation and screen readers. No project-specific accessibility requirements have been established beyond standard WCAG 2.1 AA compliance.
