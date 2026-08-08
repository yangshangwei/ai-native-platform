# Thinking Guides

> **Purpose**: Expand your thinking to catch things you might not have considered.

---

## Why Thinking Guides?

**Most bugs and tech debt come from "didn't think of that"**, not from lack of skill:

- Didn't think about what happens at layer boundaries → cross-layer bugs
- Didn't think about code patterns repeating → duplicated code everywhere
- Didn't think about edge cases → runtime errors
- Didn't think about future maintainers → unreadable code

These guides help you **ask the right questions before coding**.

---

## Available Guides

| Guide | Purpose | When to Use |
|-------|---------|-------------|
| [Code Reuse Thinking Guide](./code-reuse-thinking-guide.md) | Identify patterns and reduce duplication | When you notice repeated patterns |
| [Cross-Layer Thinking Guide](./cross-layer-thinking-guide.md) | Think through data flow across layers | Features spanning multiple layers |

---

## Quick Reference: Thinking Triggers

### When to Think About Cross-Layer Issues

- [ ] Feature touches 3+ layers (API, Service, Component, Database)
- [ ] Data format changes between layers
- [ ] Multiple consumers need the same data
- [ ] You're not sure where to put some logic

→ Read [Cross-Layer Thinking Guide](./cross-layer-thinking-guide.md)

### When to Think About Code Reuse

- [ ] You're writing similar code to something that exists
- [ ] You see the same pattern repeated 3+ times
- [ ] You're adding a new field to multiple places
- [ ] **You're modifying any constant or config**
- [ ] **You're creating a new utility/helper function** ← Search first!

→ Read [Code Reuse Thinking Guide](./code-reuse-thinking-guide.md)

### When Reading a Field Another Module Wrote

- [ ] The field lives in an untyped bag (`metadata`, `payload`,
      `Record<string, unknown>`) — the compiler will NOT catch a wrong key
- [ ] You're about to write a test fixture for that field

→ **Copy the key from the real writer, never from your own expectation.**

```bash
# Find who actually writes it, then read that line
grep -rn "metadata: {" apps/runner/src/orchestrator.ts
```

A fixture built from the reader's assumption makes the test verify your
guess instead of the cross-module contract — it goes green while production
silently returns null forever. This happened in task
`08-08-p0-1-graph-live-view-graphrun-web`: the reader looked for
`metadata.failureReason`, the runner writes `metadata.error`, and a fully
green test suite hid it.

Related: when a field's writer set is small, also check whether it has ANY
writer. Three of the seven declared `GRAPH_EVENT_TYPES` had zero production
writers, so a fallback branch reading them was dead on arrival.

### When a Stage Starts Producing a Second Artifact of the Same Kind

- [ ] A skill gains a new output while an existing one keeps the same
      `kind` (both `kind: 'other'`, both `'report'`, …)
- [ ] Any reader of that kind selects with "latest of kind"

→ **Every existing "latest of kind" reader now silently points at the new
artifact.** Selection must key on something that distinguishes them —
`metadata.output` or `metadata.schemaVersion`.

```ts
// Wrong once a second `other` artifact exists: returns whichever was written last
const reviewText = artifactText(detail, 'other');

// Right: pin the selection to the output you actually mean
const reviewText = artifactTextBy(detail, 'other', (a) =>
  a.metadata?.output === REVIEW_MARKDOWN_OUTPUT_NAME);
```

Task `08-08-p0-2-typed-reviewerverdict-gate` added `review-verdict.json`
alongside `review.md`. Because `skill.review` declares the markdown first,
the verdict was always the newer artifact, and 「查看 Review 原文」 started
rendering raw JSON at users. Nothing failed — the panel still had content,
just the wrong content. Grep every reader of the kind before adding the
output, and add a regression test that asserts the *other* artifact is not
what shows up.

---

## Pre-Modification Rule (CRITICAL)

> **Before changing ANY value, ALWAYS search first!**

```bash
# Search for the value you're about to change
grep -r "value_to_change" .
```

This single habit prevents most "forgot to update X" bugs.

---

## How to Use This Directory

1. **Before coding**: Skim the relevant thinking guide
2. **During coding**: If something feels repetitive or complex, check the guides
3. **After bugs**: Add new insights to the relevant guide (learn from mistakes)

---

## Contributing

Found a new "didn't think of that" moment? Add it to the relevant guide.

---

**Core Principle**: 30 minutes of thinking saves 3 hours of debugging.
