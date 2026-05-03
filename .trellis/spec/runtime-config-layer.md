# Runtime Config Layer

> **Status**: Current (PR1 scaffolding landed; PR2 will migrate runner call sites)
>
> Captures the contracts for the runtime configuration layer introduced by
> task `05-03-expose-internal-prompts-rules-and-configs-to-ui-for-live-edit`.
> Read this before adding new tunable knobs, changing override semantics, or
> wiring `getConfig()` into a new code path.

---

## What this layer does

Lets the platform owner edit prompts, rules, and runtime numbers in the 5173
web UI and have the runner pick up new values **on the next workflow stage**
(≤2s latency), without restarting the runner or recompiling.

**Out of scope (do not extend without re-discussion):**

* Multi-user RBAC — single platform owner only.
* Project-scoped or per-run override layering — `scope` column reserved for
  future, only `'global'` supported today.
* Draft / publish workflow — direct apply only (audit + delete-as-revert is
  the rollback story).
* Restructuring `SkillSpec.inputs` / `outputs` / `requiredGates` /
  `toolPolicy` — those are the **structural contract** that PR2/PR3 do **not**
  expose; only `instructions` is editable.
* Gate rule logic in `apps/api/src/gate-engine.ts` — code, not data.

---

## Two-layer model: code default + DB override

```
                           ┌─────────────────────────────┐
                           │  packages/shared/src/config │
                           │  defaults.ts  +  registry.ts│
                           │   (compile-time, in code)   │
                           └──────────┬──────────────────┘
                                      │   default
                                      ▼
   override (UI)  ──HTTP PUT──►  api/.../config_overrides  ──fetch──►  runner
                                  (SQLite, scope='global')        getConfig(key)
                                            │
                                            └──audit──►  config_audit
```

* **Defaults** live as TypeScript constants in
  `packages/shared/src/config/defaults.ts`. They are byte-for-byte transcribed
  from runner sources (the cited `source` field in each registry entry tells
  you which file:line the default came from).
* **Overrides** live in SQLite (`config_overrides` table). One row per key,
  keyed by the registry key string. Stored as `value_json TEXT`.
* **Resolution** at the runner: `getConfig(key)` returns override if present
  *and well-formed*, else compile-time default.

---

## Adding a new tunable

**Required**, in this order:

1. Add the constant to `packages/shared/src/config/defaults.ts`. Cite the
   source file:line in a JSDoc comment. The constant name must follow
   SCREAMING_SNAKE_CASE and end in `_DEFAULT`.
2. Register the key in `packages/shared/src/config/registry.ts`'s
   `CONFIG_REGISTRY` map. Required fields: `type`, `default`, `description`,
   `category`, `source`. For `number` types: `min` and `max`.
3. Bump `CONFIG_REGISTRY_KEY_COUNT` to match the new total.
4. Update the matching test expectation in
   `apps/api/test/config-routes.test.ts` (`expect(body.keys).toHaveLength(N)`).
5. **PR2 / future**: replace the original hardcoded read site in the runner
   with `await getConfig('your.new.key')`. The site must already be in async
   context.

**Forbidden:**

* Adding a key in the UI — the UI never creates new keys.
* Importing from `apps/runner` or `apps/api` into `packages/shared` — `shared`
  is upstream, must have no app-direction dependencies.
* Storing a default value in two places (e.g. duplicating a value between
  `defaults.ts` and `registry.ts` literally) — `defaults.ts` is the single
  source; `registry.ts` references it.

---

## Cache + failure semantics (runner side)

Implemented in `apps/runner/src/config-client.ts`:

* **TTL = 1500ms** by default (`RUNNER_CONFIG_CACHE_TTL_MS_DEFAULT`),
  intentionally shorter than the watch poll cycle (2000ms) so a stage-by-stage
  workflow run picks up fresh values within ≤2s.
* **Stale-while-revalidate** on fetch failure: if the next refresh attempt
  fails (network, API down), the cache stays at last-known-good. The runner
  never falls from a *fresh override* back to *default* just because the API
  is momentarily unreachable.
* **Cold-start failure**: if the very first fetch fails (and there is no
  cached value yet), `getConfig()` returns the registry default and emits one
  warn-log. Subsequent failed-fetch calls do not re-warn.
* **Malformed override (defense-in-depth)**: the API validates type at write
  time, but the runner re-validates at read time via `validateConfigValue()`.
  If a row is corrupt (e.g. someone hand-edited the SQLite file), `getConfig`
  falls back to the registry default + warns once per malformed key.

**Test hooks** (apps/runner/src/config-client.ts):

* `invalidateConfigCache()` — drops cache + warn flags between tests.
* `__setCacheTtlForTest(ms)` — temporarily shortens TTL (e.g. to 0) so the
  next call refetches.
* `__cacheStateForTest()` — reads internal cache flags for assertions.

---

## API contract

Mounted at `/config/*` (see `apps/api/src/routes/config.ts`).

| Method | Path | Purpose | Body / Query |
|---|---|---|---|
| `GET` | `/config/registry` | Schema (24 keys + types + defaults + descriptions) | none |
| `GET` | `/config/overrides` | All current override rows keyed by config key | none |
| `PUT` | `/config/overrides/:key` | Upsert override; writes audit | `{ value: <json>, updatedBy?: string }` |
| `DELETE` | `/config/overrides/:key` | Reset to default; writes tombstone audit | `?actor=<name>` (optional) |
| `GET` | `/config/audit` | Audit log | `?key=<configKey>&limit=N` (default 20, clamped to 200) |

**Status codes:**

* `200` — success (PUT echoes the new override, DELETE returns `{ deleted: boolean }`)
* `400` — unknown key, type mismatch, out-of-range number, non-string in array
* No `409` — the model is idempotent; PUT same-value-twice succeeds.

---

## Validation (`validateConfigValue`)

Lives in `packages/shared/src/config/registry.ts` and is the **single
source** of truth for "is this value acceptable for this key". Used both at
the API write-side and the runner read-side. Rules:

* `type === 'number'` → must be finite, must satisfy `min`/`max` if declared.
* `type === 'string'` → must be a string. (No length cap in v1; SQLite
  TEXT handles multi-KB markdown fine.)
* `type === 'string_array'` → must be array, every element must be a string.
* Returns `null` on valid, an error message string on invalid.

**Forbidden:**

* Adding ad-hoc validation in API routes — extend `validateConfigValue`
  instead so the runner side validates the same way.

---

## Override semantics

* **Replace whole** for arrays. `coordinator.bug_keywords` override stores the
  *complete* new array; runtime does NOT merge with the registry default. UI
  helps avoid mistakes by pre-filling the editor with the current effective
  value and offering a "copy default into editor" button.
* **Replace whole** for scalars. (Trivially the same as above.)
* **Delete = reset**. `DELETE /config/overrides/:key` removes the row; next
  `getConfig()` returns the registry default. Audit row records the old value
  with `new_value_json = null` (tombstone marker).

---

## Audit semantics

Every `PUT` and `DELETE` writes a `config_audit` row:

* `id` — `cfgaud_<rand>`
* `key` — the config key
* `old_value_json` — null for first-time PUT
* `new_value_json` — null for DELETE (tombstone)
* `changed_at` — ISO timestamp
* `changed_by` — actor string (≤64 chars; `'system'` if not provided)

Querying: `GET /config/audit?key=...&limit=N` returns most-recent-first.

---

## Reserved future fields

Already in the SQLite schema, **not yet** consumed:

* `config_overrides.scope TEXT NOT NULL DEFAULT 'global'` — when project /
  per-run scope lands, the runner-side `getConfig()` will accept a scope
  parameter and the API will accept `?scope=project:<id>` etc. Migration
  path is non-breaking: existing rows already say `'global'`.

Things **not** in the schema yet (when needed, add migration first):

* Draft / published two-state — would add `draft_value_json` /
  `published_value_json` columns. **Don't add until D2 decision is revisited.**
* Project / run scope — would add foreign keys `project_id` / `workflow_run_id`.

---

## Common mistakes

* **Forgetting to update the registry test count when adding a key.**
  `expect(body.keys).toHaveLength(24)` will fail loudly. Update
  `CONFIG_REGISTRY_KEY_COUNT` in lockstep.
* **Importing the runner constant directly from app code instead of via
  `getConfig()`.** Bypasses the override layer; the user's UI edit will
  silently have no effect.
* **Putting the default in `registry.ts` as a literal instead of via
  `defaults.ts`.** Violates the single-source rule; spec drift becomes
  invisible.
* **Calling `getConfig` from non-async code.** It is async on purpose so cache
  refresh can `await fetch()`. If the call site is synchronous, refactor it
  before migrating; do not introduce sync wrappers that block.

---

## How to remove a key

1. Replace the call site with the appropriate hardcoded value (or remove the
   feature).
2. Delete the entry from `CONFIG_REGISTRY` in `registry.ts`.
3. Delete the constant from `defaults.ts`.
4. Decrement `CONFIG_REGISTRY_KEY_COUNT`.
5. Update the test expectation.
6. **Do NOT delete existing override rows from SQLite** — leaving stale rows
   is harmless (a row whose key isn't in the registry is silently ignored by
   the runner). A future migration can clean them up if needed.
