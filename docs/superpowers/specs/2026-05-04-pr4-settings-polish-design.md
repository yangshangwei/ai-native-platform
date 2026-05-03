# PR4 — Settings Polish & Audit Mirror Design

**Date**: 2026-05-04
**Parent task**: `.trellis/tasks/05-03-expose-internal-prompts-rules-and-configs-to-ui-for-live-edit/`
**Status**: Approved (brainstorm → ready for implementation plan)
**Predecessors**: PR1 (runtime config-override layer) · PR2 (runner call-site migration) · PR3 (Settings → Runtime Config UI)

## Goal

Polish PR3's Settings page along three axes and resolve the parent PRD's last open implementation question about audit log persistence:

1. **CSS** — Settings panel currently reuses generic `.panel/.stack/.config-grid`; introduce 4–6 named classes so it stops looking unstyled.
2. **Projection test** — Match the existing `apps/web/test/*-projection.test.ts` pattern by extracting a pure `buildSettingsViewModel()` function and unit-testing it.
3. **Audit mirror** — Persist `config_audit` rows to `.omc/audit/config-YYYY-MM-DD.jsonl` for grep-friendly post-hoc forensics (PRD Open Q3).
4. **Trellis-check follow-up (registered, not implemented)** — PR1/PR2 outside review is deferred until the sub-agent service is available.

## Decisions

### D-PR4.1 · Audit mirror = SQLite-as-truth + jsonl mirror, fail-open

- **Role**: SQLite `config_audit` table remains the single source of truth read by `/config/audit` API. The jsonl file is an append-only mirror only.
- **Trigger**: At the end of `configAudit.insert()` (`apps/api/src/store/store.ts:~1294`), after the SQLite `insertRow` succeeds.
- **Path**: `.omc/audit/config-YYYY-MM-DD.jsonl`, where `YYYY-MM-DD` is `entry.changedAt.slice(0, 10)`. Since `changedAt` is `nowIso()` = `new Date().toISOString()` (UTC, Z-suffixed), file rotation happens at UTC midnight. UTC-keyed filenames keep grep semantics consistent regardless of operator timezone.
- **Format**: One compact JSON object per line:
  ```json
  {"id":"...","key":"coordinator.system_prompt","oldValueJson":"...","newValueJson":"...","changedAt":"2026-05-04T02:11:12.345Z","changedBy":"web"}
  ```
- **Directory creation**: Lazy `mkdirSync(path.dirname(file), { recursive: true })` on first write of the process.
- **Failure mode**: `try/catch` around the mirror write. On error: `console.warn('[config-audit] mirror failed:', err.message)` and return normally. Mirror failure NEVER bubbles up — SQLite write is the source of truth, so the API contract holds.
- **Out of scope**: async queue, fsync, gzip, retention/rotation cleanup, file locking. (Single writer per app process; Node `fs.appendFileSync` already serializes per call.)

### D-PR4.2 · Settings projection test = extract pure function, vitest pattern

- **New file** `apps/web/src/settings-projection.ts` exporting:
  ```ts
  buildSettingsViewModel(input: {
    registry: ConfigRegistry;
    overrides: Record<string, ConfigOverrideDto>;
    audit: ConfigAuditEntry[];
    dirty: Record<string, unknown>; // staged-but-not-saved values keyed by config key
  }): SettingsViewModel;
  ```
  Returns:
  ```ts
  type SettingsViewModel = {
    tabs: Array<{ id: 'coordinator' | 'skill_prompts' | 'runtime'; title: string; rows: RowVM[] }>;
    summary: { totalKeys: number; overrideCount: number; dirtyCount: number };
    perKey: Map<string, RowVM>;
  };
  type RowVM = {
    key: string;
    label: string;
    type: 'string' | 'number' | 'boolean' | 'string-array' | 'json';
    defaultValue: unknown;
    effectiveValue: unknown;
    source: 'default' | 'override' | 'dirty';
    hasOverride: boolean;
    latestAuditAt: string | null; // most recent config_audit.changedAt for this key
  };
  ```
- **`apps/web/src/main.ts`** changes minimal: `renderConfigSection()` calls `buildSettingsViewModel(...)` to get a `SettingsViewModel`, then renders DOM from it. No DOM-shape change.
- **New test** `apps/web/test/settings-projection.test.ts` covering:
  1. Registry → 3 tabs grouping (14 / 5 / 5 = 24 keys total).
  2. Override application: array semantics (replace whole array per D4) + scalar override + default fallthrough; `source` tagged correctly.
  3. Dirty calculation: a key in `dirty` overlays both default and override; `source: 'dirty'` regardless of whether an override exists.
  4. Audit linkage: `latestAuditAt` picks the most-recent `changedAt` among `audit[]` entries matching `key`.
- **Out of scope**: DOM rendering tests, textarea autosize tests, network fetch tests. (DOM is a thin shell over the projection.)

### D-PR4.3 · CSS adornment-only, no structural refactor

**Reality check (during implementation)**: `apps/web/src/main.ts`'s existing `renderConfigSection() / renderConfigRow()` already references class names like `.config-row`, `.config-row-header`, `.config-tabs`, `.tab-button`, `.config-key`, `.config-meta`, `.config-description`, `.config-source`, `.config-actions`, `.config-list`, `.config-history`, `.config-history-row`. These names have **no CSS declarations** in `apps/web/index.html` (which is why the panel "looks 素"). The cleanest path is to style the existing class names rather than introduce a parallel `.settings-*` namespace. **No main.ts class-name changes required for axis C.**

**Theme** (verified from `apps/web/index.html` `:root`): light theme with vars `--surface (#fff)`, `--bg (#f8fafc)`, `--line (#dbe3ef)`, `--line-strong (#c4d0e1)`, `--text (#1e293b)`, `--muted (#64748b)`, `--primary (#2563eb)`, `--good (#15803d)`, `--bad (#b91c1c)`, `--warn (#a16207)`, `--info (#1d4ed8)`. **No `--accent` / `--accent-soft` / `--bg-card` / `--bg-input` exist** — use `--primary` / `--surface` etc. instead.

| Class (existing in main.ts) | Purpose | Key declarations |
|---|---|---|
| `.config-tabs` | Sticky tab bar | `position: sticky; top: 64px; display: flex; gap: 4px; padding: 8px 0; background: rgba(248,250,252,.92); backdrop-filter: blur(8px); border-bottom: 1px solid var(--line); z-index: 4` |
| `.tab-button` | Tab pill | `border: 0; background: transparent; padding: 8px 14px; border-radius: 10px; color: var(--muted); font-weight: 700; font-size: 13px; min-height: 36px; cursor: pointer`; `:hover { background: rgba(37,99,235,.06); color: var(--text) }`; `.active { background: var(--primary); color: #fff; box-shadow: var(--shadow) }` |
| `.config-list` | Row container | `display: grid; gap: 8px; margin-top: 12px` |
| `.config-row` | Per-key card | `border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px; background: var(--surface); display: grid; gap: 8px; transition: border-color .16s ease`; `&.overridden { border-color: var(--info); box-shadow: 0 0 0 1px rgba(29,78,216,.12) inset }`; `&.dirty { border-color: var(--warn); background: var(--warn-bg) }` |
| `.config-row-header` | Header row | `display: flex; flex-wrap: wrap; gap: 10px; align-items: center` |
| `.config-key` | Key name | `font-family: "Fira Code", ui-monospace, monospace; font-size: 13px; color: var(--text); font-weight: 800` |
| `.config-meta` | Type/min/max badge | `font-family: "Fira Code", ui-monospace, monospace; font-size: 11px; color: var(--muted); background: #eef4ff; border-radius: 999px; padding: 2px 8px` |
| `.config-description` | Description body | `margin: 0; font-size: 13px; color: var(--text); line-height: 1.5` |
| `.config-source` | Source citation | `margin: 0; font-family: "Fira Code", ui-monospace, monospace; font-size: 11px; color: var(--muted)` |
| `.config-actions` | Button row | `display: flex; flex-wrap: wrap; gap: 8px; padding-top: 4px; border-top: 1px dashed var(--line); margin-top: 4px` |
| `.config-history` | History panel | `border-top: 1px dashed var(--line); margin-top: 8px; padding-top: 8px; display: grid; gap: 6px` |
| `.config-history-row` | History entry | `display: grid; grid-template-columns: 110px 90px 1fr 1fr; gap: 10px; font-size: 12px; align-items: baseline` |
| `.config-history-time` / `.config-history-actor` | History meta cells | `color: var(--muted); font-family: "Fira Code", ui-monospace, monospace` |
| `.config-history-old` / `.config-history-new` | History value cells | `font-family: "Fira Code", ui-monospace, monospace; word-break: break-all` |
| `.error-banner` | Error band | `border: 1px solid var(--bad); background: var(--bad-bg); color: var(--bad); border-radius: 12px; padding: 8px 12px; font-size: 13px` |
| `.config-row textarea` | Autosize prompt editor | `width: 100%; font-family: "Fira Code", ui-monospace, monospace; font-size: 13px; line-height: 1.55; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--line-strong); resize: vertical`; `:focus { outline: 3px solid rgba(37,99,235,.32); outline-offset: 1px }` |

- **Bundle impact**: ~1.5 KB CSS uncompressed appended to existing `<style>` block. JS bundle untouched.
- **Mobile**: in the existing `@media (max-width: 780px)` block, add `.config-row-header { gap: 6px }` and `.config-history-row { grid-template-columns: 1fr }`.

### D-PR4.4 · Trellis-check follow-up registered, not implemented

Add an entry **F1** to the parent PRD's "Open Questions / Followups" section:

- **Trigger condition**: sub-agent service available again
- **Scope**: PR1 (runtime config layer) + PR2 (runner call-site migration)
- **Command**: `/trellis:check pr1` and `/trellis:check pr2`
- **Output target**: append run records to a new file `pr-followup-check.jsonl` in this task's directory (kept separate from the in-flight `check.jsonl`)
- **PR4 implementation does NOT touch this** — code-only change comes when conditions are met.

## Acceptance Criteria

- AC-PR4.1 — Editing any config override creates a new line in `.omc/audit/config-YYYY-MM-DD.jsonl` whose JSON parses and matches the corresponding SQLite row.
- AC-PR4.2 — Removing write permission on `.omc/audit/` does NOT break override save (fail-open verified).
- AC-PR4.3 — `apps/web/test/settings-projection.test.ts` runs green under `bun --filter=apps/web test`; covers the four cases above.
- AC-PR4.4 — `renderConfigSection()` produces visually identical DOM after the projection extraction (no regression in rendered output).
- AC-PR4.5 — Settings panel visibly distinguishes default / override / dirty states; sticky tab bar stays visible while scrolling key list.
- AC-PR4.6 — Parent PRD updated: Open Q3 marked RESOLVED with link to D-PR4.1; F1 followup section added.

## Risk & Rollback

- **Risk**: Mirror write may fail silently on read-only `.omc/audit/` filesystems → mitigated by `console.warn` and fail-open. Operator notices via warn log.
- **Risk**: Projection extraction subtly changes rendered DOM → mitigated by manual smoke + AC-PR4.4 visual diff.
- **Rollback**: Each axis is an independent commit; revert any single one without affecting the others.

## Files Touched

- `apps/api/src/store/store.ts` (mirror append in `configAudit.insert`)
- `apps/web/src/main.ts` (refactor `renderConfigSection()` to call projection)
- `apps/web/src/settings-projection.ts` (new)
- `apps/web/test/settings-projection.test.ts` (new)
- `apps/web/index.html` (append CSS to existing `<style>`)
- `.trellis/tasks/05-03-expose-internal-prompts-rules-and-configs-to-ui-for-live-edit/prd.md` (PR4 section + Q3 RESOLVED + F1 followup)

## Out of Scope (this PR)

- Audit log retention / rotation cleanup (file grows append-only).
- Code editor widget (CodeMirror/Monaco) — PRD D3 already chose textarea.
- Drag-to-reorder in `.settings-array` — YAGNI; current Up/Down buttons are sufficient.
- New design tokens / theming overhaul.
- Trellis-check actual run for PR1/PR2 (deferred per F1).
