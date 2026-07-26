# Rename Status Label to System Status

## Goal

Rename the top-right global status label from `状态` to `系统状态` and explain the current normal-status logic.

## Requirements

* Change only the display label in the topbar global status summary.
* Preserve the existing health/readiness calculation.
* Update shell rendering coverage.

## Acceptance Criteria

* [x] The top-right status summary shows `系统状态`.
* [x] Existing status value such as `正常` still renders.
* [x] The shell rendering test covers the new label.
* [x] Targeted test and Web typecheck pass.

## Technical Notes

* Label is rendered in `apps/web/src/shell.ts`.
* Health/readiness value comes from `workbenchEnvironmentSummary()` in `apps/web/src/page-workbench.ts`.
