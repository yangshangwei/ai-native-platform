/**
 * Polling logic helpers — render fingerprinting and detail reload decision.
 *
 * Extracted from main.ts to isolate polling-specific logic.
 */

import type { RunDetail, WorkflowRunDto } from './projection';
import type { WorkflowRequestDto, RunnerDto, RunnerControlStatusDto } from './types';

interface PollingFingerprintInput {
  requests: WorkflowRequestDto[];
  runs: WorkflowRunDto[];
  runners: RunnerDto[];
  runnerControl: RunnerControlStatusDto | null;
  projectCount: number;
  activeRunId?: string | null;
  activeDetailRunId?: string | null;
}

export function buildPollingRenderFingerprint(input: PollingFingerprintInput): string {
  const parts: string[] = [
    `r${input.requests.length}`,
    `runs${input.runs.length}`,
    `runners${input.runners.length}`,
    `rc${input.runnerControl?.running ? 'y' : 'n'}`,
    `p${input.projectCount}`,
  ];

  if (input.activeRunId) {
    parts.push(`active:${input.activeRunId}`);
  }

  if (input.activeDetailRunId) {
    parts.push(`detail:${input.activeDetailRunId}`);
  }

  // Include request statuses for quick change detection
  const requestStatuses = input.requests.map(r => `${r.id}:${r.status}`).join(',');
  if (requestStatuses) {
    parts.push(`req[${requestStatuses}]`);
  }

  // Include run statuses for quick change detection
  const runStatuses = input.runs.map(r => `${r.id}:${r.status}`).join(',');
  if (runStatuses) {
    parts.push(`run[${runStatuses}]`);
  }

  return parts.join('|');
}

interface ShouldReloadDetailInput {
  activeRunId: string;
  latestRunSnapshot: WorkflowRunDto | undefined;
  currentDetail: RunDetail | null;
}

export function shouldReloadActiveRunDetail(input: ShouldReloadDetailInput): boolean {
  const { activeRunId, latestRunSnapshot, currentDetail } = input;

  // If no snapshot in the runs list, don't reload (run might be very new)
  if (!latestRunSnapshot) {
    return false;
  }

  // If no current detail loaded, reload
  if (!currentDetail) {
    return true;
  }

  // If the detail is for a different run, reload
  if (currentDetail.run.id !== activeRunId) {
    return true;
  }

  // Reload if status or currentStage changed
  if (
    currentDetail.run.status !== latestRunSnapshot.status ||
    currentDetail.run.currentStage !== latestRunSnapshot.currentStage
  ) {
    return true;
  }

  // Otherwise, keep current detail (avoid unnecessary reload)
  return false;
}
