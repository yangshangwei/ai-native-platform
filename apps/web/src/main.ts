/**
 * Application entry — bootstrap only.
 *
 * Everything renderable lives in the page modules (`page-*.ts`,
 * `coordinator-chat.ts`, `shell.ts`) on top of the base layer
 * (api/dom/state/router/render-core/data-loading/stream). This file only:
 *   1. wires the injection points (render-core needs the shell renderer and
 *      the composer capture/restore hooks; data-loading needs the SSE
 *      stream controller entry points — both injected to keep the base
 *      layer free of feature-module imports);
 *   2. owns `maybeAutoStartRunnerForActiveTask` (a bootstrap-level policy:
 *      try to auto-start the runner once per pending/claimed request);
 *   3. runs the bootstrap sequence: hashchange/beforeunload/keydown
 *      listeners, initial `parseHash()` + `loadData()`, and the global
 *      3-second polling loop.
 */

import {
  activeTaskRequest,
  data,
  runnerAutoStartAttemptedForRequest,
  ui,
} from './state';
import { parseHash } from './router';
import { render, setRenderHooks } from './render-core';
import {
  ensureRunnerStarted,
  loadData,
  loadRunDetail,
  setStreamHooks,
} from './data-loading';
import {
  attachRunStream,
  closeExpandedStream,
  detachStream,
  expandedStreamRunId,
  syncActiveStreamSubscription,
} from './stream';
import {
  captureCoordinatorReplyComposerState,
  restoreCoordinatorReplyComposerFocus,
} from './coordinator-chat';
import { captureNewTaskFormState, restoreNewTaskFormFocus } from './page-new-task';
import { renderShell } from './shell';
import { initTheme } from './theme';

function maybeAutoStartRunnerForActiveTask(): void {
  const request = activeTaskRequest();
  if (!request || !['pending', 'claimed'].includes(request.status)) return;
  const project = data.projects.find((p) => p.id === request.projectId);
  if (!project?.agentBackend) return;
  if (data.runnerControl?.running || ui.runnerStartInFlight) return;
  if (runnerAutoStartAttemptedForRequest.has(request.id)) return;
  runnerAutoStartAttemptedForRequest.add(request.id);
  void ensureRunnerStarted();
}

// Wire the extracted core modules together: render-core needs the shell
// renderer (shell.ts) + composer capture/restore (coordinator-chat.ts /
// page-new-task.ts), data-loading needs the SSE stream controller entry
// points (stream.ts; registered here to keep data-loading independent of
// feature modules). Both must be registered before the first
// loadData()/render() below.
setRenderHooks({
  renderShell,
  captureCoordinatorReplyComposerState,
  captureNewTaskFormState,
  restoreCoordinatorReplyComposerFocus,
  restoreNewTaskFormFocus,
});
setStreamHooks({
  syncActiveStreamSubscription,
  attachRunStream,
});

window.addEventListener('hashchange', async () => {
  parseHash();
  await loadData({ render: false, keepDetail: false });
  const task = activeTaskRequest();
  if (task?.workflowRunId) await loadRunDetail(task.workflowRunId, false);
  else if (ui.activeRunId && ui.activePage !== 'task') await loadRunDetail(ui.activeRunId, false);
  syncActiveStreamSubscription();
  render();
  maybeAutoStartRunnerForActiveTask();
});
window.addEventListener('beforeunload', detachStream);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && expandedStreamRunId) closeExpandedStream();
});

// Initialize theme system
initTheme();

parseHash();
await loadData({ render: true });
maybeAutoStartRunnerForActiveTask();
setInterval(() => {
  if (ui.activePage === 'new-task' || ui.activePage === 'projects') {
    void loadData({ render: false, keepDetail: true });
    return;
  }
  void loadData({ render: true, keepDetail: true });
  if (ui.activeRunId) void loadRunDetail(ui.activeRunId, true);
  maybeAutoStartRunnerForActiveTask();
}, 3000);
