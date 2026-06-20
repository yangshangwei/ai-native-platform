# Research: Modern SaaS / DevTools Landing Page Patterns

> **Task**: `06-14-design-landing-page`
> **Scope**: Landing page design patterns for an **AI software delivery workbench** (AI Native Platform).
> **Method**: Internal codebase/spec review + established design-pattern knowledge of reference tools (Linear, Vercel, Cursor, v0.dev, GitHub Copilot).
> **Note**: External web search (`mcp__exa__*`) was unavailable in this environment and Jina reader was blocked by network reputation. External references below are documented from established, well-known public landing-page structures of these tools as of 2024–2025. Treat as directional, not freshly scraped.

---

## 0. Project Context (internal — what we are selling)

From `README.md` and `.trellis/spec/**`:

- **Product**: "AI Native Platform (MVP) — AI 软件交付工作台" (AI software delivery workbench).
- **Core promise (one-liner)**: 从一句话需求到验收报告的闭环 — *"From a one-sentence requirement to an acceptance report, a closed loop."*
- **The 9-stage closed loop**: `init → context_pack → requirement → design → implementation → build_test → review → completion → knowledge`.
- **Key differentiators / trust signals** (these are the *real* selling points; they map directly to landing-page "why us" content):
  1. **Workflow Engine is the sole state writer** — agents cannot self-declare success.
  2. **Agents cannot declare a Gate passed** — every `GateRun` is decided by the gate-engine; agent can attach a note only.
  3. **Build/Test must come from real commands** — Runner actually spawns `mvn`; `CommandRun` carries `stdoutRef/stderrRef/exitCode`; `TestRun` is parsed from real Surefire XML, **not** LLM self-report.
  4. **Real local env + Git worktree per run** — isolated worktree, real JDK/Maven/Git.
  5. **Every delivery produces a Completion Report** — auto-assembled from SQLite, references every Artifact / Gate / CommandRun.
  6. **Experience becomes a Knowledge Candidate** gated by a human Knowledge Gate.
- **Backends**: Real CLI agents — **Claude Code** or **Codex** (user picks per project). Cross-platform CLI resolution.
- **Architecture**: `apps/api` (Hono on Bun + SQLite + Workflow/Gate engines + Reports), `apps/runner` (local worktree, compile/test, agent backends, orchestrator), `apps/web` (Vite-less TS delivery workbench).

**Implication for the landing page**: the messaging spine should be **"verifiable AI delivery"** — evidence over vibes. The strongest differentiator versus generic "AI coding" tools is that *nothing is trusted without real commands, real gates, real reports*. This is the angle that should dominate hero + social-proof copy.

### Existing design system (reuse, don't reinvent)

The Web app already ships a design system in `apps/web/public/`:

- `design-tokens.css` / `design-tokens-dark.css` — CSS custom properties for color/spacing.
- `components.css`, `utilities.css`, `animations.css`.
- `index.html` defines an inline token set (light + dark via `[data-theme="dark"]`):
  - `--bg #f8fafc`, `--surface #ffffff`, `--primary #2563eb` (blue), `--orange #f97316`, status colors `good/bad/warn/info`.
  - Fonts: **Fira Sans** (UI), **Fira Code** (mono/code/command chips).
  - `--radius: 18px`, soft shadow `--shadow`.
  - Patterns already present: `hero-card`, `panel`, `pill`, `button(.primary/.secondary/.ghost)`, `stage-board` (9-column stage cards with done/active/blocked/failed states), toast, skeleton.
- **"Sub2API Style"** is referenced as the design-system lineage (`<!-- Design System - Sub2API Style -->`).

A landing page should reuse these tokens (blue primary, Fira fonts, 18px radius, dark-mode support, the existing `stage-board` visual language for the 9-stage loop) so the marketing surface and the product feel like one brand.

---

## 1. Common Sections & Structure (the canonical DevTools landing page)

Modern SaaS/DevTools landing pages converge on a predictable vertical narrative. Recommended section order:

| # | Section | Purpose | Notes for this product |
|---|---------|---------|------------------------|
| 1 | **Nav / Top bar** | Logo, primary nav (Product, How it works, Docs, Pricing), GitHub link, CTA button | Keep slim, sticky, blurred bg. Add a GitHub star pill (devtool convention). |
| 2 | **Hero** | One-line value prop + sub-headline + 2 CTAs + visual | Headline = the closed-loop promise. Primary CTA "Get started / Quickstart", secondary "View a sample report" or "Read docs". |
| 3 | **Logo / proof bar** | "Trusted by" or "Works with" strip | If no customer logos yet, use **tech logos**: Claude Code, Codex, Maven/JDK, Git, SQLite. Honest and credible for a devtool. |
| 4 | **Problem / "before"** | Name the pain | "AI writes code, but did it actually compile? Did the tests really pass? Who approved it?" — the trust gap. |
| 5 | **How it works** | The 9-stage pipeline visualized | This is the centerpiece. Use the existing `stage-board` visual: requirement → design → implementation → build_test → review → completion → knowledge. Animated/stepped diagram. |
| 6 | **Features / value grid** | 3–6 differentiators | Map to the 6 operating principles: sole state writer, no self-declared gates, real commands, worktree isolation, completion report, knowledge gate. |
| 7 | **Evidence / "see it"** | Screenshots of real artifacts | Show a real Completion Report, a Surefire-parsed TestRun, a gate decision. "Evidence over self-report" made visible. |
| 8 | **Backends / integrations** | Claude Code & Codex selection | "Bring your own agent CLI." |
| 9 | **Social proof / testimonials** | Quotes, metrics, case study | Optional for MVP; can be a single "operating principles" trust block instead. |
| 10 | **Final CTA** | Repeat primary action | "Start your first closed-loop delivery." + quickstart commands. |
| 11 | **Footer** | Docs, GitHub, links, license | Standard. |

### Structural conventions observed across the category
- **Single-column scroll narrative** with full-bleed alternating background bands (light → tinted → light).
- **F-pattern hero**: copy left, product visual right (or centered copy with visual below).
- **Section eyebrows** (small uppercase label above each section heading) — already in the app as `.eyebrow`.
- **Sticky nav** with backdrop blur (already used in `.topbar`).
- **Two CTAs in hero**: one high-commitment (Get started), one low-commitment (Docs / Demo / GitHub).
- **Code blocks as hero/feature elements** — devtools show real terminal commands (the README's quickstart `bun run dev:api` etc. is perfect raw material).

---

## 2. Visual Design Patterns for Developer Tools

DevTool landing pages share a recognizable visual language:

### 2.1 Aesthetic
- **Clean, technical, high-contrast, generous whitespace.** Restrained palette: 1 brand accent (here: blue `#2563eb`) + neutrals + status colors.
- **Dark mode is table stakes** for devtools (Vercel, Linear, Cursor all default-dark or offer it). This app already has `[data-theme="dark"]` tokens — consider a **dark hero** even on a light site, as devtools often do.
- **Monospace as a design accent** (Fira Code here) — used for commands, code chips, stage keys. Signals "for engineers."
- **Subtle gradients & glows** — Linear/Vercel use soft radial gradients and faint grid backgrounds behind heroes rather than photography.

### 2.2 Diagram-heavy / "show the system"
This product is **pipeline/architecture-centric**, so diagrams are the hero asset, not stock imagery:
- **Pipeline diagram** of the 9 stages with state coloring (reuse `stage-card` done/active/blocked/failed semantics).
- **Architecture diagram**: API (Workflow Engine = sole state writer) ↔ Runner (worktree, real `mvn`) ↔ Agent CLI ↔ Web workbench. Emphasize the "agents have no state-write path" boundary visually.
- **Annotated screenshot** of the actual workbench (the `apps/web` UI) — shows the product is real.
- **"Evidence" callouts**: a CommandRun with exit code, a parsed Surefire test count, a gate badge — small UI snippets that prove "real commands, not LLM self-report."

### 2.3 Motion / interaction
- Scroll-triggered reveals, stepped pipeline animation (highlight each stage in sequence), subtle hover lifts on cards (`transform: translateY(-1px)` already in the app).
- Keep motion subtle; honor `prefers-reduced-motion` (already handled in `index.html`).
- Animated terminal / typing effect for the "one-sentence requirement → report" demo is a strong, on-brand hero device.

### 2.4 Component patterns to reuse
- `hero-card`, `panel`, `pill`/badges, `stage-board`, `button.primary/.secondary`, `command-chip`, toast, status colors — all already exist and give brand continuity between marketing site and product.

---

## 3. Copy / Messaging Frameworks for AI Dev Tools

### 3.1 Headline frameworks (proven patterns)
DevTool heroes typically use one of these shapes:

1. **Outcome-first / promise**: *"Ship verifiable software with AI — from one sentence to an acceptance report."*
2. **Category + speed**: *"The AI software delivery workbench. Requirement → design → build → tests → report, in one closed loop."*
3. **Contrarian / trust angle** (strongest here): *"AI that can't fake the result. Real commands. Real gates. Real reports."*
4. **"For X" positioning**: *"The delivery workbench for teams who don't trust AI on its word."*

**Recommendation**: lead with the **trust/verifiability** angle (differentiator #3), because generic "AI writes your code" is a crowded message; "AI you can *prove*" is not.

### 3.2 Messaging spine / hierarchy
- **H1 (value prop)**: the closed-loop, verifiable-delivery promise.
- **Sub-headline (1–2 sentences)**: how — Workflow Engine owns state, agents propose, real `mvn`/Surefire produce evidence, every run ends in a Completion Report.
- **Section headings as benefits, not features**: "Agents can't grade their own homework" > "Gate Engine"; "Your tests really ran" > "Surefire parser."

### 3.3 Common copy frameworks in the category
- **PAS (Problem–Agitate–Solve)**: Problem (AI claims success it can't prove) → Agitate (you re-check everything by hand) → Solve (gated, evidence-backed pipeline).
- **Before / After**: "Before: 'the AI said it passed.' After: exit code 0, 12 tests parsed from Surefire, gate approved."
- **Feature → Benefit → Proof** triplets for the feature grid (state the principle, the user win, and the concrete artifact that proves it).
- **Jobs-to-be-done framing**: "When I hand a requirement to an AI, I want verifiable, reviewable delivery — not a wall of unverified diffs."

### 3.4 Tone for engineer audience
- Precise, low-hype, concrete. Engineers distrust marketing fluff.
- **Use real artifacts as copy**: real command lines, real exit codes, real report excerpts. Specificity = credibility.
- Bilingual consideration: the product/README is **zh-CN primary** (`<html lang="zh-CN">`, README in Chinese). The landing page should likely be **Chinese-first** (or bilingual) to match the existing product surface and memory note about realtime CLI streaming UX expectations.

---

## 4. Reference Examples (similar tools)

> Documented from established public landing-page structures of these tools (2024–2025). External live-scrape was unavailable; use as directional patterns.

### Linear (`linear.app`)
- **Aesthetic**: dark-first, ultra-clean, premium. Soft gradients/glows behind a centered hero. Heavy whitespace, single accent.
- **Hero**: short outcome headline ("Linear is a purpose-built tool for planning and building products"), one primary CTA + secondary, product screenshot directly below.
- **Structure**: hero → product screenshot → feature sections each pairing a benefit headline with a focused UI visual → customer logos → CTA.
- **Takeaway**: let the product UI *be* the visual; benefit-led headlines; restraint.

### Vercel (`vercel.com`)
- **Aesthetic**: dark, monochrome+gradient, geometric, "frontend cloud" technical polish.
- **Hero**: command-line / deploy framing, `git push` → live, with real code/terminal snippets as hero elements.
- **Structure**: hero → framework/integration logo grid → feature bands with diagrams → metrics → enterprise proof → CTA.
- **Takeaway**: terminal commands and integration logos as first-class hero content; metrics as proof.

### Cursor (`cursor.com`)
- **Aesthetic**: dark, code-editor screenshots front and center, minimal nav.
- **Hero**: "The AI Code Editor" — extremely short headline, download CTA, editor screenshot/video.
- **Structure**: hero with product video → short feature highlights (tab completion, codebase chat) each with an inline editor demo → testimonials from known engineers → download CTA.
- **Takeaway**: for an AI dev tool, *show the tool doing the work* (video/animated demo) above the fold; short copy.

### v0.dev (Vercel)
- **Aesthetic**: minimal, prompt-box-as-hero ("generative UI"). The input field IS the hero.
- **Hero**: a literal prompt input inviting you to type, then shows generated output.
- **Takeaway**: an **interactive "type your requirement" hero** maps perfectly to this product's "one-sentence requirement → report" promise. A faux/real input that kicks off the pipeline demo is the most on-brand hero device available.

### GitHub Copilot (`github.com/features/copilot`)
- **Aesthetic**: GitHub's clean dark/light system, code-editor demos, trust + scale messaging.
- **Hero**: outcome headline ("Your AI pair programmer" → later "The world's most widely adopted AI developer tool"), animated code-completion demo.
- **Structure**: hero → animated demos per capability → enterprise/security trust section → stats ("X% faster") → pricing tiers → CTA.
- **Takeaway**: pair an animated capability demo with strong trust/security messaging and concrete adoption stats; useful precedent for the **trust/gate** section.

### Cross-tool synthesis (what to copy)
1. **Above the fold**: short benefit headline + animated/interactive product demo (lean into v0's prompt-hero + Cursor's "show the tool").
2. **Trust block**: Copilot-style security/verifiability section — but here it's the *core* differentiator, so elevate it.
3. **Diagram bands**: Vercel-style technical diagrams + integration/backend logos (Claude Code, Codex, Maven, Git).
4. **Restraint & dark option**: Linear-level whitespace and a single accent; dark mode available.
5. **Real artifacts as proof**: real commands, exit codes, report excerpts (specificity beats stock imagery for engineers).

---

## 5. Recommended Section Blueprint for THIS Product (synthesis)

```
┌ Nav ─ logo · How it works · Architecture · Docs · GitHub★ · [Get started]
├ Hero ─ H1: verifiable AI delivery, one sentence → acceptance report
│        interactive "type a requirement" prompt box (v0/Cursor style)
│        CTAs: [Quickstart]  [See a real report]
├ Proof bar ─ Works with: Claude Code · Codex · Maven/JDK · Git · SQLite
├ Problem ─ "The AI said it passed. Did it?" (the trust gap)
├ How it works ─ 9-stage pipeline diagram (reuse stage-board visual + state colors)
├ Features grid ─ 6 operating principles as benefit→proof cards
│        · Agents can't grade their own homework (Gate Engine)
│        · Your tests really ran (real mvn + Surefire, exit codes)
│        · One sole state writer (Workflow Engine)
│        · Isolated by default (Git worktree per run)
│        · Every delivery ships a report (Completion Report)
│        · Lessons become knowledge (human Knowledge Gate)
├ Evidence ─ real screenshots: Completion Report, TestRun, gate badge, workbench UI
├ Backends ─ "Bring your own agent CLI": Claude Code or Codex per project
├ Final CTA ─ quickstart commands (bun install / dev:api / dev:web) + [Get started]
└ Footer ─ Docs · GitHub · principles · license
```

**Visual/brand reuse**: blue `#2563eb` accent, Fira Sans/Fira Code, 18px radius, soft shadows, dark-mode tokens, and the existing `stage-board` + `pill` + `button` components — so the marketing page and the workbench are visibly one product.

---

## Files Found (internal)

| Path | Relevance |
|------|-----------|
| `README.md` | Product positioning, 9-stage loop, operating principles, quickstart commands (primary copy source) |
| `apps/web/index.html` | Existing design tokens, fonts, components (`hero-card`, `stage-board`, `pill`, `button`, dark mode) — reuse for brand continuity |
| `apps/web/public/design-tokens.css` / `design-tokens-dark.css` | Color/spacing tokens (light + dark) |
| `apps/web/public/components.css` / `utilities.css` / `animations.css` | Existing component + animation library |
| `apps/web/src/main.ts`, `apps/web/src/projection.ts` | Workbench UI + projection helpers (source of real screenshots) |
| `.trellis/spec/web/frontend/index.md`, `directory-structure.md`, `agent-backend-ui.md` | Web frontend conventions |
| `.trellis/spec/runner/backend/agent-backend-runtime.md` | Claude Code / Codex backend behavior (backends section copy) |
| `.trellis/spec/shared/backend/agent-backend-contract.md` | Agent backend contract (`AINP_CLAUDE_BIN` / `AINP_CODEX_BIN`) |
| `docs/2026-05-01-ai-native-platform-handoff.md` | Deeper product handoff narrative |

## External References (directional — see note in §0/§4)
- Linear — `linear.app` (dark, restraint, product-as-visual)
- Vercel — `vercel.com` (terminal commands, integration logos, diagrams, metrics)
- Cursor — `cursor.com` (show-the-tool video hero, short copy)
- v0.dev — `v0.dev` (interactive prompt-as-hero)
- GitHub Copilot — `github.com/features/copilot` (animated demos + trust/security + adoption stats)

---

## Method Limitations
- `mcp__exa__web_search_exa` / `mcp__exa__get_code_context_exa` were **not available** in this environment (tool not found).
- `r.jina.ai` reader was **blocked** (network reputation / 401) so live page scraping of the reference sites was not possible.
- General web (e.g. Wikipedia) was reachable, but the reference-tool sections in §4 are documented from **established public landing-page structures**, not a fresh scrape. If freshly verified competitor copy is required, re-run with working external search tools.
