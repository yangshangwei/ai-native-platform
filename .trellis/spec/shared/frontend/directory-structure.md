# Directory Structure — `shared` package

> **Not applicable.** `packages/shared/` has no frontend layer. This file is
> intentionally a redirect.

---

## Why

`packages/shared/` is a zero-runtime types and pure-utility package (no UI, no I/O). There is no UI code in this package, so
component / hook / state / type-safety / structure / quality conventions
for the UI don't apply here.

The trellis-init scaffolding creates `frontend/` for every package by
convention; we keep this file as a placeholder so the spec structure stays
uniform across packages.

---

## Real reference

The project's only real frontend lives at `apps/web/`. The matching
convention doc is:

- [`.trellis/spec/web/frontend/directory-structure.md`](../../web/frontend/directory-structure.md)

Open that file for the actual rules.

---

## Future expansion

If a small UI surface ever ships inside this package — for example a
runner TUI written with Ink, or an api operator panel served at
`/admin` — document its conventions here at that time. Until then this
file remains a redirect.

---

## Forbidden in `packages/shared/`

- React / Vue / Svelte / JSX imports.
- DOM API usage.
- Anything that requires a browser runtime to evaluate.
