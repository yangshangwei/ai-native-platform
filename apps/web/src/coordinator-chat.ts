/**
 * Coordinator conversational clarification (Phase B) — chat panel + state.
 *
 * Owns the coordinator* state family (moved out of `main.ts`, T2.3 page
 * split; only the task-detail page renders this panel, but the new-task
 * page also calls `loadCoordinatorChat` right after creating a request):
 *   - `coordinatorChats` / `coordinatorPolling`: per-request chat transcript
 *     + triage decision cache and its 1.5s catch-up polling guard;
 *   - `coordinatorReplyDrafts` / `coordinatorOptionSelections` /
 *     `coordinatorAutoReplyBlocks`: user-owned reply drafts keyed by
 *     requestId (state-management spec: drafts survive polling renders);
 *   - `coordinatorReplyFocus`: one-shot focus/caret restore marker for the
 *     reply textarea.
 * The IME composition guard intentionally stays in `state.ts`
 * (`ui.coordinatorReplyComposing` / `ui.coordinatorReplyRenderDeferred`)
 * because `render()` in render-core must check it before any rebuild —
 * same precedent as `ui.knowledgeEditComposing` (T2.2). This module only
 * reads/writes those flags through `ui`. `captureCoordinatorReplyComposerState`
 * / `restoreCoordinatorReplyComposerFocus` are registered as render hooks
 * by main.ts. Moved verbatim out of `main.ts` (T2.3 page split).
 */

import { errorMessage } from '@ainp/shared/browser';
import {
  buildCoordinatorChoiceReply,
  coordinatorQuestionKey,
  mergeCoordinatorAutoReply,
  parseCoordinatorQuestion,
  type CoordinatorQuestionOption,
  type ParsedCoordinatorQuestion,
} from './coordinator-clarification';
import {
  streamChannelKey,
  type StreamChannel,
} from './stream-rendering';
import type { WorkflowRequestDto } from './types';
import { api } from './api';
import { button, el, fmtTime, normalizeSelectionDirection, panelHeader, pill } from './dom';
import { ui } from './state';
import { render } from './render-core';
import {
  attachRequestStream,
  attachRunStream,
  buildAgentStreamView,
  renderAgentStreamBody,
  renderStreamStatus,
  renderStreamSummary,
  shouldSubscribeRequestStream,
  type AgentStreamViewModel,
} from './stream';

// ---- Coordinator conversational intake (Phase B) -------------------------

interface CoordinatorChatMessage {
  id: string;
  role: 'user' | 'coordinator';
  content: string;
  createdAt: string;
}

interface CoordinatorChatState {
  messages: CoordinatorChatMessage[];
  decision: {
    decision:
      | { action: 'proceed'; routeCase: string; runType: string; reason: string }
      | { action: 'pause_for_human'; questions: string[]; reason: string }
      | { action: 'abort'; reason: string };
    confidence: number;
    source: string;
  } | null;
  status: string;
}

export const coordinatorChats = new Map<string, CoordinatorChatState>();
const coordinatorPolling = new Set<string>();
const coordinatorReplyDrafts = new Map<string, string>();
const coordinatorOptionSelections = new Map<string, Map<string, Set<string>>>();
const coordinatorAutoReplyBlocks = new Map<string, string>();
const COORDINATOR_REPLY_SELECTOR = 'textarea[data-coordinator-reply-request-id]';

let coordinatorReplyFocus: {
  requestId: string;
  selectionStart: number;
  selectionEnd: number;
  selectionDirection: 'forward' | 'backward' | 'none';
} | null = null;

// `ui.coordinatorReplyComposing` / `ui.coordinatorReplyRenderDeferred` /
// `ui.isReplacingAppRootForRender` moved to state.ts (see the IME-deferral
// comment there); the composer capture/restore logic below still owns them.

export function captureCoordinatorReplyComposerState(root: HTMLElement): void {
  const replyArea = root.querySelector<HTMLTextAreaElement>(COORDINATOR_REPLY_SELECTOR);
  if (!replyArea) {
    coordinatorReplyFocus = null;
    return;
  }
  const requestId = replyArea.dataset.coordinatorReplyRequestId;
  if (!requestId) {
    coordinatorReplyFocus = null;
    return;
  }
  setCoordinatorReplyDraft(requestId, replyArea.value);
  if (document.activeElement === replyArea) {
    coordinatorReplyFocus = {
      requestId,
      selectionStart: replyArea.selectionStart,
      selectionEnd: replyArea.selectionEnd,
      selectionDirection: normalizeSelectionDirection(replyArea.selectionDirection),
    };
  } else if (coordinatorReplyFocus?.requestId === requestId) {
    coordinatorReplyFocus = null;
  }
}

export function restoreCoordinatorReplyComposerFocus(root: HTMLElement): void {
  if (!coordinatorReplyFocus) return;
  const focus = coordinatorReplyFocus;
  const replyArea = Array.from(root.querySelectorAll<HTMLTextAreaElement>(COORDINATOR_REPLY_SELECTOR))
    .find((candidate) => candidate.dataset.coordinatorReplyRequestId === focus.requestId);
  if (!replyArea) {
    coordinatorReplyFocus = null;
    return;
  }
  replyArea.focus({ preventScroll: true });
  const selectionStart = Math.min(focus.selectionStart, replyArea.value.length);
  const selectionEnd = Math.min(focus.selectionEnd, replyArea.value.length);
  replyArea.setSelectionRange(selectionStart, selectionEnd, focus.selectionDirection);
  coordinatorReplyFocus = null;
}

function setCoordinatorReplyDraft(requestId: string, value: string): void {
  if (value.length > 0) coordinatorReplyDrafts.set(requestId, value);
  else coordinatorReplyDrafts.delete(requestId);
}

export function clearCoordinatorReplyComposerState(requestId: string): void {
  coordinatorReplyDrafts.delete(requestId);
  coordinatorOptionSelections.delete(requestId);
  coordinatorAutoReplyBlocks.delete(requestId);
  if (coordinatorReplyFocus?.requestId === requestId) coordinatorReplyFocus = null;
  if (ui.coordinatorReplyComposing?.requestId === requestId) {
    ui.coordinatorReplyComposing = null;
    // No other composing textareas exist in this SPA; reset the pending flag
    // so a stale defer does not survive request-state transitions.
    ui.coordinatorReplyRenderDeferred = false;
  }
}

export async function loadCoordinatorChat(requestId: string): Promise<void> {
  try {
    const state = await api<CoordinatorChatState>(
      `/workflow-requests/${encodeURIComponent(requestId)}/messages`,
    );
    coordinatorChats.set(requestId, state);
    if (state.status !== 'awaiting_clarification') clearCoordinatorReplyComposerState(requestId);
    if (ui.activeTaskRequestId === requestId) render();
    // While the request is still pending or awaiting clarification, keep polling
    // so the UI surfaces the Coordinator's questions as soon as they land.
    if (
      (state.status === 'pending' || state.status === 'awaiting_clarification') &&
      !coordinatorPolling.has(requestId)
    ) {
      coordinatorPolling.add(requestId);
      setTimeout(() => {
        coordinatorPolling.delete(requestId);
        void loadCoordinatorChat(requestId);
      }, 1500);
    }
  } catch {
    /* network or 404; just stop polling */
  }
}

async function sendCoordinatorReply(requestId: string, textArea: HTMLTextAreaElement): Promise<void> {
  const content = textArea.value.trim();
  if (!content) return;
  const wasDisabled = textArea.disabled;
  textArea.disabled = true;
  try {
    await api(`/workflow-requests/${encodeURIComponent(requestId)}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'user', content }),
    });
    // Bounce status back to pending so the runner re-triages with the new turn.
    await api(`/workflow-requests/${encodeURIComponent(requestId)}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'pending' }),
    });
    clearCoordinatorReplyComposerState(requestId);
    textArea.value = '';
    await loadCoordinatorChat(requestId);
  } catch (err) {
    ui.lastError = errorMessage(err);
    render();
    // Only restore disabled state if the textarea is still in the DOM
    if (document.body.contains(textArea)) {
      textArea.disabled = wasDisabled;
    }
  }
}

function coordinatorStreamChannelForRequest(request: WorkflowRequestDto): StreamChannel {
  return request.workflowRunId
    ? { kind: 'run', id: request.workflowRunId }
    : { kind: 'request', id: request.id };
}

function ensureCoordinatorStreamSubscription(request: WorkflowRequestDto): void {
  if (ui.activePage !== 'task' || ui.activeTaskRequestId !== request.id) return;
  if (request.workflowRunId) attachRunStream(request.workflowRunId);
  else if (shouldSubscribeRequestStream(request)) attachRequestStream(request.id);
}

function coordinatorPendingQuestions(state: CoordinatorChatState | undefined): string[] {
  const decision = state?.decision?.decision;
  return decision?.action === 'pause_for_human' ? decision.questions : [];
}

function coordinatorSelectedOptionLabels(requestId: string, questionKey: string): Set<string> {
  return coordinatorOptionSelections.get(requestId)?.get(questionKey) ?? new Set<string>();
}

function setCoordinatorSelectedOptionLabel(
  requestId: string,
  questionKey: string,
  optionLabel: string,
  multiple: boolean,
): void {
  let requestSelections = coordinatorOptionSelections.get(requestId);
  if (!requestSelections) {
    requestSelections = new Map<string, Set<string>>();
    coordinatorOptionSelections.set(requestId, requestSelections);
  }

  if (!multiple) {
    requestSelections.set(questionKey, new Set([optionLabel]));
    return;
  }

  const selected = new Set(requestSelections.get(questionKey) ?? []);
  if (selected.has(optionLabel)) selected.delete(optionLabel);
  else selected.add(optionLabel);
  if (selected.size > 0) requestSelections.set(questionKey, selected);
  else requestSelections.delete(questionKey);
}

function syncCoordinatorOptionButtonState(requestId: string, questionKey: string): void {
  const selectedLabels = coordinatorSelectedOptionLabels(requestId, questionKey);
  document.querySelectorAll<HTMLButtonElement>('[data-coordinator-option-request-id][data-coordinator-question-key]')
    .forEach((candidate) => {
      if (
        candidate.dataset.coordinatorOptionRequestId !== requestId ||
        candidate.dataset.coordinatorQuestionKey !== questionKey
      ) {
        return;
      }
      const isSelected = selectedLabels.has(candidate.dataset.coordinatorOptionLabel ?? '');
      candidate.classList.toggle('is-selected', isSelected);
      candidate.setAttribute('aria-pressed', String(isSelected));
    });
}

function coordinatorChoiceReplySelections(
  requestId: string,
  questions: string[],
): Array<{ prompt: string; selectedOptions: CoordinatorQuestionOption[] }> {
  const requestSelections = coordinatorOptionSelections.get(requestId);
  if (!requestSelections) return [];
  return questions.flatMap((question, index) => {
    const parsed = parseCoordinatorQuestion(question);
    const selectedLabels = requestSelections.get(coordinatorQuestionKey(parsed, index));
    if (!selectedLabels || selectedLabels.size === 0) return [];
    const selectedOptions = parsed.options.filter((option) => selectedLabels.has(option.label));
    return selectedOptions.length > 0 ? [{ prompt: parsed.prompt, selectedOptions }] : [];
  });
}

function updateCoordinatorReplyFromSelectedOptions(
  requestId: string,
  questions: string[],
  replyArea: HTMLTextAreaElement,
  updateSendState: () => void,
): void {
  const nextAutoReply = buildCoordinatorChoiceReply(coordinatorChoiceReplySelections(requestId, questions));
  const previousAutoReply = coordinatorAutoReplyBlocks.get(requestId) ?? '';
  const nextReply = mergeCoordinatorAutoReply(replyArea.value, previousAutoReply, nextAutoReply);
  if (nextAutoReply) coordinatorAutoReplyBlocks.set(requestId, nextAutoReply);
  else coordinatorAutoReplyBlocks.delete(requestId);
  replyArea.value = nextReply;
  setCoordinatorReplyDraft(requestId, replyArea.value);
  updateSendState();
}

function renderCoordinatorQuestionCard(
  requestId: string,
  question: string,
  index: number,
  questions: string[],
  replyArea: HTMLTextAreaElement,
  updateSendState: () => void,
): HTMLElement {
  const parsed = parseCoordinatorQuestion(question);
  const questionKey = coordinatorQuestionKey(parsed, index);
  const selectedLabels = coordinatorSelectedOptionLabels(requestId, questionKey);
  return el('article', {
    class: 'coordinator-question-card',
    children: [
      el('span', { class: 'coordinator-question-index', text: String(index + 1) }),
      el('div', {
        class: 'coordinator-question-body',
        children: [
          el('div', {
            class: 'coordinator-question-title-row',
            children: [
              el('p', { class: 'coordinator-question-text', text: parsed.prompt }),
              parsed.options.length > 0
                ? el('span', {
                    class: 'coordinator-question-mode',
                    text: parsed.multiple ? '可多选' : '单选',
                  })
                : null,
            ],
          }),
          parsed.options.length > 0
            ? el('ul', {
                class: 'coordinator-option-list',
                children: parsed.options.map((option) =>
                  el('li', {
                    children: [
                      renderCoordinatorOptionButton(
                        requestId,
                        questionKey,
                        option,
                        parsed,
                        selectedLabels.has(option.label),
                        questions,
                        replyArea,
                        updateSendState,
                      ),
                    ],
                  }),
                ),
              })
            : null,
        ],
      }),
    ],
  });
}

function renderCoordinatorOptionButton(
  requestId: string,
  questionKey: string,
  option: CoordinatorQuestionOption,
  parsed: ParsedCoordinatorQuestion,
  selected: boolean,
  questions: string[],
  replyArea: HTMLTextAreaElement,
  updateSendState: () => void,
): HTMLButtonElement {
  const optionButton = el('button', {
    class: `coordinator-option${selected ? ' is-selected' : ''}`,
    attrs: {
      type: 'button',
      'aria-pressed': String(selected),
      'data-coordinator-option-request-id': requestId,
      'data-coordinator-question-key': questionKey,
      'data-coordinator-option-label': option.label,
    },
    children: [
      el('span', { class: 'coordinator-option-key', text: option.label }),
      el('span', { class: 'coordinator-option-text', text: option.text }),
    ],
  }) as HTMLButtonElement;
  optionButton.onclick = () => {
    setCoordinatorSelectedOptionLabel(requestId, questionKey, option.label, parsed.multiple);
    syncCoordinatorOptionButtonState(requestId, questionKey);
    updateCoordinatorReplyFromSelectedOptions(requestId, questions, replyArea, updateSendState);
  };
  return optionButton;
}

function renderCoordinatorActionPanel(
  requestId: string,
  questions: string[],
  reason: string | null,
  replyArea: HTMLTextAreaElement,
  sendBtn: HTMLButtonElement,
  updateSendState: () => void,
): HTMLElement {
  return el('section', {
    class: 'coordinator-action',
    children: [
      el('div', {
        class: 'coordinator-action-head',
        children: [
          el('div', {
            children: [
              el('strong', { text: '等待你回复' }),
              el('p', { text: '回答后系统会继续判断任务类型和执行路径。' }),
            ],
          }),
          pill(`${questions.length || 1} 个问题`, 'warn'),
        ],
      }),
      reason ? el('p', { class: 'coordinator-action-reason', text: reason }) : null,
      el('div', {
        class: 'coordinator-question-list',
        children: questions.length > 0
          ? questions.map((question, index) =>
              renderCoordinatorQuestionCard(requestId, question, index, questions, replyArea, updateSendState),
            )
          : [el('p', { class: 'muted compact', text: 'Coordinator 正在整理需要你确认的问题。' })],
      }),
      el('div', { class: 'chat-composer', children: [replyArea, sendBtn] }),
    ],
  });
}

export function renderCoordinatorChatPanel(request: WorkflowRequestDto): HTMLElement | null {
  const requestId = request.id;
  const streamChannel = coordinatorStreamChannelForRequest(request);
  ensureCoordinatorStreamSubscription(request);
  const state = coordinatorChats.get(requestId);
  if (!state) {
    void loadCoordinatorChat(requestId);
  }
  const streamView = buildAgentStreamView(streamChannel);
  const canReply = request.status === 'awaiting_clarification' && state?.status === 'awaiting_clarification';
  if (!canReply) clearCoordinatorReplyComposerState(requestId);
  if (!state && streamView.events.length === 0 && request.status !== 'pending' && request.status !== 'claimed') return null;
  const pendingQuestions = coordinatorPendingQuestions(state);

  const thread = (state?.messages ?? []).map((m) =>
    el('article', {
      class: `chat-message chat-message-${m.role}`,
      children: [
        el('div', {
          class: 'chat-message-meta',
          children: [
            el('span', { class: 'chat-role', text: m.role === 'user' ? '你' : 'Coordinator' }),
            el('span', { text: fmtTime(m.createdAt) }),
          ],
        }),
        el('p', { class: 'chat-content', text: m.content }),
      ],
    }),
  );

  const replyArea = canReply ? el('textarea', {
    class: 'chat-input',
    attrs: {
      rows: '3',
      placeholder: '可一次回答多个问题，也可以补充约束、例子或验收方式…',
      'data-coordinator-reply-request-id': requestId,
    },
  }) as HTMLTextAreaElement : null;
  const sendBtn = replyArea ? button('提交回复', 'button primary small') : null;
  let updateCoordinatorReplySendState = (): void => {};

  if (replyArea && sendBtn) {
    updateCoordinatorReplySendState = () => {
      sendBtn.disabled = replyArea.value.trim().length === 0;
    };
    replyArea.value = coordinatorReplyDrafts.get(requestId) ?? '';
    updateCoordinatorReplySendState();
    replyArea.oninput = () => {
      setCoordinatorReplyDraft(requestId, replyArea.value);
      updateCoordinatorReplySendState();
    };
    replyArea.addEventListener('compositionstart', () => {
      ui.coordinatorReplyComposing = { requestId };
    });
    replyArea.addEventListener('compositionend', () => {
      ui.coordinatorReplyComposing = null;
      // Flush whatever the IME just committed into the draft so a follow-up
      // render (deferred or otherwise) rehydrates the final characters.
      setCoordinatorReplyDraft(requestId, replyArea.value);
      updateCoordinatorReplySendState();
      if (ui.coordinatorReplyRenderDeferred) {
        ui.coordinatorReplyRenderDeferred = false;
        queueMicrotask(() => render());
      }
    });
    replyArea.onblur = () => {
      setCoordinatorReplyDraft(requestId, replyArea.value);
      if (!ui.isReplacingAppRootForRender) {
        // A genuine blur (not render replacement) ends any composition this
        // textarea may have been carrying; `compositionend` would otherwise
        // never fire once the node is detached.
        if (ui.coordinatorReplyComposing?.requestId === requestId) {
          ui.coordinatorReplyComposing = null;
          if (ui.coordinatorReplyRenderDeferred) {
            ui.coordinatorReplyRenderDeferred = false;
            queueMicrotask(() => render());
          }
        }
        if (coordinatorReplyFocus?.requestId === requestId) {
          coordinatorReplyFocus = null;
        }
      }
    };
    sendBtn.onclick = () => void sendCoordinatorReply(requestId, replyArea);
  }

  const decisionLine = state?.decision
    ? el('div', {
        class: 'chat-decision',
        text:
          state.decision.decision.action === 'proceed'
            ? `已分诊 → ${state.decision.decision.routeCase} (${state.decision.source}, ${state.decision.confidence.toFixed(2)})`
            : state.decision.decision.action === 'pause_for_human'
              ? `等待你回复 (${state.decision.decision.questions.length} 个问题)`
              : `已取消：${state.decision.decision.reason}`,
      })
    : null;
  const waitingLine = !state || ((state.messages.length === 0 && !state.decision))
    ? el('p', {
        class: 'muted compact',
        text: request.workflowRunId
          ? 'Coordinator 记录加载中；开发者日志会继续显示在下方折叠区。'
          : 'Coordinator 正在接收请求；开发者日志会先显示在下方折叠区。',
      })
    : null;
  const requestHistoryView = request.workflowRunId
    ? buildAgentStreamView({ kind: 'request', id: request.id })
    : null;
  const streamDetails = [
    requestHistoryView && requestHistoryView.events.length > 0
      ? renderCoordinatorStreamDetails(request, requestHistoryView, 'history')
      : null,
    renderCoordinatorStreamDetails(request, streamView, 'live'),
  ];
  const actionPanel = replyArea && sendBtn
    ? renderCoordinatorActionPanel(
        requestId,
        pendingQuestions,
        state?.decision?.decision.action === 'pause_for_human' ? state.decision.decision.reason : null,
        replyArea,
        sendBtn,
        updateCoordinatorReplySendState,
      )
    : null;

  return el('section', {
    class: 'panel coordinator-chat',
    children: [
      panelHeader('需求澄清', '回答后系统会继续判断任务类型和执行路径'),
      actionPanel,
      actionPanel ? null : decisionLine,
      waitingLine,
      thread.length > 0
        ? el('section', {
            class: 'chat-thread-section',
            children: [
              el('h3', { class: 'chat-section-title', text: '沟通记录' }),
              el('div', { class: 'chat-thread', children: thread }),
            ],
          })
        : null,
      ...streamDetails,
    ],
  });
}

function renderCoordinatorStreamDetails(
  request: WorkflowRequestDto,
  view: AgentStreamViewModel,
  mode: 'live' | 'history',
): HTMLElement {
  const channelKey = view.channel ? streamChannelKey(view.channel) : 'none';
  return el('details', {
    class: 'coordinator-stream-details',
    attrs: {
      'data-details-key': `coordinator-stream:${request.id}:${mode}:${channelKey}`,
    },
    children: [
      el('summary', {
        children: [
          el('span', { text: mode === 'history' ? '开发者日志（Coordinator 阶段已缓存）' : '开发者日志' }),
          renderStreamStatus(view),
          renderStreamSummary(view),
        ],
      }),
      renderAgentStreamBody(view, { scrollKeyPrefix: 'coordinator-stream' }),
    ],
  });
}
