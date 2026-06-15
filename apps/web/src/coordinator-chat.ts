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
// Step-by-step Q&A state (T06-15)
const coordinatorCurrentQuestionIndex = new Map<string, number>();
const coordinatorAnswerDrafts = new Map<string, Map<number, string>>();
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

// Step-by-step Q&A state helpers (T06-15)
function getCurrentQuestionIndex(requestId: string): number {
  return coordinatorCurrentQuestionIndex.get(requestId) ?? 0;
}

function setCurrentQuestionIndex(requestId: string, index: number): void {
  coordinatorCurrentQuestionIndex.set(requestId, index);
}

function resetQuestionState(requestId: string): void {
  coordinatorCurrentQuestionIndex.set(requestId, 0);
  coordinatorAnswerDrafts.delete(requestId);
}

function getAnswerDraft(requestId: string, questionIndex: number): string {
  return coordinatorAnswerDrafts.get(requestId)?.get(questionIndex) ?? '';
}

function setAnswerDraft(requestId: string, questionIndex: number, value: string): void {
  let drafts = coordinatorAnswerDrafts.get(requestId);
  if (!drafts) {
    drafts = new Map<number, string>();
    coordinatorAnswerDrafts.set(requestId, drafts);
  }
  if (value.length > 0) drafts.set(questionIndex, value);
  else drafts.delete(questionIndex);
}

export function clearCoordinatorReplyComposerState(requestId: string): void {
  coordinatorReplyDrafts.delete(requestId);
  coordinatorOptionSelections.delete(requestId);
  coordinatorAutoReplyBlocks.delete(requestId);
  coordinatorCurrentQuestionIndex.delete(requestId);
  coordinatorAnswerDrafts.delete(requestId);
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
    const previousDecision = coordinatorChats.get(requestId)?.decision;
    coordinatorChats.set(requestId, state);

    // Reset question state if we got a new set of questions
    const newDecision = state.decision;
    if (newDecision?.decision.action === 'pause_for_human') {
      const previousQuestions = previousDecision?.decision.action === 'pause_for_human'
        ? previousDecision.decision.questions
        : [];
      const newQuestions = newDecision.decision.questions;

      // If questions array changed, reset to first question
      if (JSON.stringify(previousQuestions) !== JSON.stringify(newQuestions)) {
        resetQuestionState(requestId);
      }
    }

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

async function sendCoordinatorReply(requestId: string, content: string): Promise<void> {
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
    await loadCoordinatorChat(requestId);
  } catch (err) {
    ui.lastError = errorMessage(err);
    render();
    throw err;
  }
}

// T06-15: Submit all answers from step-by-step Q&A
async function submitAllAnswers(requestId: string, questions: string[]): Promise<void> {
  const drafts = coordinatorAnswerDrafts.get(requestId) ?? new Map();
  const allAnswers = questions.map((q, i) => {
    const answer = drafts.get(i) ?? '';
    return `Q${i + 1}: ${q}\nA${i + 1}: ${answer || '(未回答)'}`;
  }).join('\n\n');

  await sendCoordinatorReply(requestId, allAnswers);
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

function renderCoordinatorActionPanel(
  requestId: string,
  questions: string[],
  reason: string | null,
): HTMLElement {
  if (questions.length === 0) {
    return el('section', {
      class: 'coordinator-action',
      children: [
        el('p', { class: 'muted compact', text: 'Coordinator 正在整理需要你确认的问题。' }),
      ],
    });
  }

  // Step-by-step Q&A state (T06-15)
  const currentIndex = getCurrentQuestionIndex(requestId);
  const totalQuestions = questions.length;

  // Safety: if index is out of bounds, reset to 0
  if (currentIndex >= totalQuestions || currentIndex < 0) {
    setCurrentQuestionIndex(requestId, 0);
    queueMicrotask(() => render());
    return el('div', { class: 'muted compact', text: '正在重置问题索引...' });
  }

  const currentQuestion = questions[currentIndex];
  if (!currentQuestion) {
    // Should never happen after bounds check, but satisfy TypeScript
    return el('div', { class: 'muted compact', text: '问题加载中...' });
  }

  const isLastQuestion = currentIndex === totalQuestions - 1;
  const parsed = parseCoordinatorQuestion(currentQuestion);
  const questionKey = coordinatorQuestionKey(parsed, currentIndex);
  const selectedLabels = coordinatorSelectedOptionLabels(requestId, questionKey);

  // Create textarea for current question
  const replyArea = el('textarea', {
    class: 'chat-input',
    attrs: {
      rows: '3',
      placeholder: '回答当前问题…',
      'data-coordinator-reply-request-id': requestId,
      'data-coordinator-question-index': String(currentIndex),
    },
  }) as HTMLTextAreaElement;

  // Load draft for current question
  replyArea.value = getAnswerDraft(requestId, currentIndex);

  // Update send button state
  const updateSendState = (): void => {
    const hasAnswer = replyArea.value.trim().length > 0;
    if (isLastQuestion) {
      submitBtn.disabled = !hasAnswer;
    } else {
      nextBtn.disabled = !hasAnswer;
    }
  };

  // Skip button
  const skipBtn = button('跳过', 'button secondary small');
  skipBtn.onclick = () => {
    setAnswerDraft(requestId, currentIndex, '(跳过)');
    if (currentIndex < totalQuestions - 1) {
      setCurrentQuestionIndex(requestId, currentIndex + 1);
      queueMicrotask(() => render());
    } else {
      void submitAllAnswers(requestId, questions);
    }
  };

  // Next button (for non-last questions)
  const nextBtn = button('下一个 →', 'button primary small');
  nextBtn.disabled = replyArea.value.trim().length === 0;
  nextBtn.onclick = () => {
    setAnswerDraft(requestId, currentIndex, replyArea.value.trim());
    setCurrentQuestionIndex(requestId, currentIndex + 1);
    queueMicrotask(() => render());
  };

  // Submit button (for last question)
  const submitBtn = button('提交回复', 'button primary');
  submitBtn.disabled = replyArea.value.trim().length === 0;
  submitBtn.onclick = () => {
    setAnswerDraft(requestId, currentIndex, replyArea.value.trim());
    void submitAllAnswers(requestId, questions);
  };

  // Handle textarea input
  replyArea.oninput = () => {
    setAnswerDraft(requestId, currentIndex, replyArea.value);
    updateSendState();
  };

  // IME composition guard
  replyArea.addEventListener('compositionstart', () => {
    ui.coordinatorReplyComposing = { requestId };
  });
  replyArea.addEventListener('compositionend', () => {
    ui.coordinatorReplyComposing = null;
    setAnswerDraft(requestId, currentIndex, replyArea.value);
    updateSendState();
    if (ui.coordinatorReplyRenderDeferred) {
      ui.coordinatorReplyRenderDeferred = false;
      queueMicrotask(() => render());
    }
  });
  replyArea.onblur = () => {
    setAnswerDraft(requestId, currentIndex, replyArea.value);
    if (!ui.isReplacingAppRootForRender) {
      if (ui.coordinatorReplyComposing?.requestId === requestId) {
        ui.coordinatorReplyComposing = null;
        if (ui.coordinatorReplyRenderDeferred) {
          ui.coordinatorReplyRenderDeferred = false;
          queueMicrotask(() => render());
        }
      }
    }
  };

  // Handle option button clicks (for multiple choice questions)
  const handleOptionClick = (option: CoordinatorQuestionOption): void => {
    setCoordinatorSelectedOptionLabel(requestId, questionKey, option.label, parsed.multiple);
    syncCoordinatorOptionButtonState(requestId, questionKey);

    // Build auto-reply from selected options
    const requestSelections = coordinatorOptionSelections.get(requestId);
    if (requestSelections) {
      const selected = requestSelections.get(questionKey);
      if (selected && selected.size > 0) {
        const selectedOptions = parsed.options.filter(opt => selected.has(opt.label));
        const autoReply = selectedOptions.map(opt => opt.label).join(', ');
        replyArea.value = autoReply;
        setAnswerDraft(requestId, currentIndex, autoReply);
        updateSendState();
      }
    }
  };

  return el('section', {
    class: 'coordinator-action',
    children: [
      el('div', {
        class: 'coordinator-action-head',
        children: [
          el('div', {
            children: [
              el('strong', { text: '等待你回复' }),
              el('p', { text: reason || '回答后系统会继续判断任务类型和执行路径。' }),
            ],
          }),
          pill(`问题 ${currentIndex + 1}/${totalQuestions}`, 'warn'),
        ],
      }),
      el('article', {
        class: 'coordinator-question-card coordinator-question-single',
        children: [
          el('span', { class: 'coordinator-question-badge', text: String(currentIndex + 1) }),
          el('div', {
            class: 'coordinator-question-body',
            children: [
              el('p', { class: 'coordinator-question-text', text: parsed.prompt }),
              parsed.options.length > 0
                ? el('div', {
                    class: 'coordinator-question-mode-hint',
                    children: [
                      el('small', { text: parsed.multiple ? '可多选，点击选项后会自动填入答案' : '单选，点击选项后会自动填入答案' }),
                    ],
                  })
                : null,
              parsed.options.length > 0
                ? el('ul', {
                    class: 'coordinator-option-list',
                    children: parsed.options.map((option) => {
                      const selected = selectedLabels.has(option.label);
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
                      optionButton.onclick = () => handleOptionClick(option);
                      return el('li', { children: [optionButton] });
                    }),
                  })
                : null,
            ],
          }),
        ],
      }),
      el('div', { class: 'chat-composer', children: [replyArea] }),
      el('div', {
        class: 'coordinator-action-buttons',
        children: [
          skipBtn,
          isLastQuestion ? submitBtn : nextBtn,
        ],
      }),
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

  // T06-15: Use step-by-step action panel when there are questions
  const actionPanel = canReply && pendingQuestions.length > 0
    ? renderCoordinatorActionPanel(
        requestId,
        pendingQuestions,
        state?.decision?.decision.action === 'pause_for_human' ? state.decision.decision.reason : null,
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
        ? el('details', {
            class: 'coordinator-history-details',
            children: [
              el('summary', { text: '查看沟通记录 ▼' }),
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
