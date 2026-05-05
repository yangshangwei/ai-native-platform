# Update README to reflect API-managed runner

## Goal

Update the top-level README so local development instructions match the current API-managed local Runner behavior. The README should no longer imply that users must always start `bun run runner -- watch` manually for the normal Web UI flow.

## What I Already Know

- The current README still shows a three-terminal quickstart where Terminal C runs `bun run runner -- watch`.
- The API exposes `/runner/control/status`, `/runner/control/start`, and `/runner/control/stop`.
- `apps/api/src/routes/runner-control.ts` starts `apps/runner/src/index.ts watch --poll-ms 1000`.
- The Web UI calls `/runner/control/start` and describes command-line runner watch as a fallback.
- Runner is still a core execution component; only the user-facing startup flow changed.

## Requirements

- Clarify that normal UI usage only requires starting the API and Web dev servers.
- Explain that the UI/API can start and supervise the local Runner watch process automatically.
- Keep manual `bun run runner -- watch` instructions as a fallback/debugging option, not the primary path.
- Preserve the direct CLI examples for explicit runner workflows such as `register`, `orchestrate`, smoke, and e2e where they still apply.
- Avoid suggesting Runner is deprecated.

## Acceptance Criteria

- [x] README Quickstart reflects API-managed local Runner startup.
- [x] README explains the distinction between Runner as a core component and manual runner startup as fallback.
- [x] Existing command examples remain valid where still useful.
- [x] No code behavior changes are made.

## Out of Scope

- Changing API, Web, or Runner behavior.
- Updating deeper product docs beyond the top-level README.
- Running full application e2e flows.

## Technical Notes

- Relevant files inspected:
  - `README.md`
  - `apps/api/src/routes/runner-control.ts`
  - `apps/web/src/main.ts`
- Relevant specs:
  - `.trellis/spec/runner/backend/index.md`
  - `.trellis/spec/web/frontend/index.md`
