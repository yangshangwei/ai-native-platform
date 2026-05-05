# Frontend Development Guidelines — `api` package

> This package has **no frontend layer**. This entire `frontend/` directory
> is a redirect to the project's only real frontend, which lives at
> `apps/web/` and is documented in [`.trellis/spec/web/frontend/`](../../web/frontend/).

---

## Why this directory exists

`apps/api/` is a Hono HTTP server (backend only). The trellis-init scaffolding generates a
`frontend/` spec layer for every package by convention — we keep it so the
structure stays uniform across packages and so that, *if* a small UI
surface ever ships alongside this package (e.g. a runner TUI, an api
admin panel), conventions can land here without restructuring.

Until that happens, every file in this directory is intentionally a
one-line redirect.

---

## Real reference

All current frontend conventions live at:
- [`.trellis/spec/web/frontend/index.md`](../../web/frontend/index.md)

| File in this directory | Status |
|---|---|
| [Directory Structure](./directory-structure.md) | Not applicable — see [`web/frontend/directory-structure.md`](../../web/frontend/directory-structure.md) |
| [Component Guidelines](./component-guidelines.md) | Not applicable — see [`web/frontend/component-guidelines.md`](../../web/frontend/component-guidelines.md) |
| [Hook Guidelines](./hook-guidelines.md) | Not applicable — see [`web/frontend/hook-guidelines.md`](../../web/frontend/hook-guidelines.md) |
| [Quality Guidelines](./quality-guidelines.md) | Not applicable — see [`web/frontend/quality-guidelines.md`](../../web/frontend/quality-guidelines.md) |
| [State Management](./state-management.md) | Not applicable — see [`web/frontend/state-management.md`](../../web/frontend/state-management.md) |
| [Type Safety](./type-safety.md) | Not applicable — see [`web/frontend/type-safety.md`](../../web/frontend/type-safety.md) |

---

## Pre-Development Checklist

If you are about to write **frontend code**, you should be in
`apps/web/src/`. The conventions there are real and reflect what the
codebase actually does (vanilla TypeScript SPA, Vite, projection-style
rendering — no React, no Vue).

Read [`.trellis/spec/web/frontend/index.md`](../../web/frontend/index.md)
and follow the checklist there.

---

## Forbidden in `apps/api/`

- React / Vue / Svelte imports. This package has no UI runtime.
- DOM API usage (`document.*`, `window.*`).
- Browser-only globals (`fetch` is fine on the server side, but anything
  that assumes a browser environment is wrong here).

---

**Language**: All documentation is written in **English**.
