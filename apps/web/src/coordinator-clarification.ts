export interface CoordinatorQuestionOption {
  label: string;
  text: string;
}

export interface ParsedCoordinatorQuestion {
  prompt: string;
  options: CoordinatorQuestionOption[];
  multiple: boolean;
}

export interface CoordinatorChoiceReplySelection {
  prompt: string;
  selectedOptions: CoordinatorQuestionOption[];
}

const OPTION_DELIMITER_PATTERN = String.raw`(?:\.(?!\d)|[)、:：])`;
const OPTION_LINE_PATTERN = new RegExp(`^([A-Da-d])${OPTION_DELIMITER_PATTERN}\\s*(.+)$`);
const OPTION_MARKER_PATTERN = new RegExp(`(^|[\\s，,；;:：？?！!。])([A-Da-d])${OPTION_DELIMITER_PATTERN}\\s*`, 'g');
const FALLBACK_PROMPT = '请选择一个选项';
const MULTI_SELECT_HINTS = [
  /多选/,
  /可多选/,
  /复选/,
  /多个/,
  /所有适用/,
  /选择所有/,
  /全部.*选择/,
  /选择.*全部/,
  /哪些/,
  /哪几/,
  /包括/,
  /multiple/i,
  /multi[-\s]?select/i,
  /select all/i,
  /all that apply/i,
] as const;

export function parseCoordinatorQuestion(question: string): ParsedCoordinatorQuestion {
  const normalized = normalizeCoordinatorQuestion(question);
  const markerResult = parseCoordinatorQuestionMarkers(normalized);
  if (markerResult) return withSelectionMode(markerResult);

  const lineResult = parseCoordinatorQuestionLines(normalized);
  if (lineResult) return withSelectionMode(lineResult);

  return withSelectionMode({ prompt: normalized, options: [] });
}

export function coordinatorQuestionKey(parsed: ParsedCoordinatorQuestion, index: number): string {
  return `${index}:${parsed.prompt}`;
}

export function buildCoordinatorChoiceReply(selections: CoordinatorChoiceReplySelection[]): string {
  return selections
    .filter((selection) => selection.selectedOptions.length > 0)
    .map((selection) => {
      const prompt = compactReplyText(selection.prompt) || FALLBACK_PROMPT;
      const selectedText = selection.selectedOptions
        .map((option) => compactReplyText(option.text))
        .filter(Boolean)
        .join('、');
      return `关于「${prompt}」，我选择：${selectedText}。`;
    })
    .join('\n');
}

export function mergeCoordinatorAutoReply(
  currentReply: string,
  previousAutoReply: string,
  nextAutoReply: string,
): string {
  const manualReply = removePreviousAutoReply(currentReply, previousAutoReply);
  return [nextAutoReply.trim(), manualReply].filter(Boolean).join('\n\n');
}

function normalizeCoordinatorQuestion(question: string): string {
  return question.replace(/\r\n?/g, '\n').trim();
}

function parseCoordinatorQuestionMarkers(
  normalized: string,
): { prompt: string; options: CoordinatorQuestionOption[] } | null {
  const markers: Array<{ index: number; promptEnd: number; contentStart: number; label: string }> = [];
  OPTION_MARKER_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = OPTION_MARKER_PATTERN.exec(normalized)) !== null) {
    const boundary = match[1] ?? '';
    const label = match[2];
    if (!label) continue;
    // Keep sentence-terminating punctuation (？?！!。) in the prompt when it is
    // the boundary character before an inline option marker.
    const keepBoundaryInPrompt = /[？?！!。]/.test(boundary);
    const promptEnd = keepBoundaryInPrompt ? match.index + boundary.length : match.index;
    markers.push({
      index: match.index,
      promptEnd,
      contentStart: match.index + (match[0]?.length ?? 0),
      label: label.toUpperCase(),
    });
  }

  if (markers.length < 2) return null;
  const firstMarker = markers[0];
  if (!firstMarker) return null;

  const options = markers
    .map((marker, index) => {
      const next = markers[index + 1];
      return {
        label: marker.label,
        text: cleanCoordinatorOptionText(normalized.slice(marker.contentStart, next ? next.index : undefined)),
      };
    })
    .filter((option) => option.text.length > 0);

  if (options.length < 2) return null;
  return {
    prompt: cleanCoordinatorPromptText(normalized.slice(0, firstMarker.promptEnd)) || FALLBACK_PROMPT,
    options,
  };
}

function parseCoordinatorQuestionLines(
  normalized: string,
): { prompt: string; options: CoordinatorQuestionOption[] } | null {
  const promptLines: string[] = [];
  const options: CoordinatorQuestionOption[] = [];

  for (const line of normalized.split('\n').map((part) => part.trim()).filter(Boolean)) {
    const match = line.match(OPTION_LINE_PATTERN);
    const label = match?.[1];
    const text = match?.[2];
    if (label && text) options.push({ label: label.toUpperCase(), text: cleanCoordinatorOptionText(text) });
    else promptLines.push(line);
  }

  if (options.length < 2) return null;
  return { prompt: cleanCoordinatorPromptText(promptLines.join('\n')) || FALLBACK_PROMPT, options };
}

function cleanCoordinatorPromptText(text: string): string {
  return text.trim().replace(/[\s，,；;:：]+$/, '').trim();
}

function cleanCoordinatorOptionText(text: string): string {
  return text.trim().replace(/^[\s，,；;:：]+/, '').replace(/[\s，,；;]+$/, '').trim();
}

function withSelectionMode(parsed: { prompt: string; options: CoordinatorQuestionOption[] }): ParsedCoordinatorQuestion {
  return {
    ...parsed,
    multiple: isCoordinatorMultiSelectQuestion(parsed.prompt),
  };
}

function isCoordinatorMultiSelectQuestion(prompt: string): boolean {
  return MULTI_SELECT_HINTS.some((pattern) => pattern.test(prompt));
}

function compactReplyText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().replace(/[。？?：:；;，,]+$/, '');
}

function removePreviousAutoReply(currentReply: string, previousAutoReply: string): string {
  const current = currentReply.trim();
  const previous = previousAutoReply.trim();
  if (!previous) return current;
  if (current === previous) return '';

  const leadingPatterns = [`${previous}\n\n`, `${previous}\n`];
  for (const pattern of leadingPatterns) {
    if (current.startsWith(pattern)) return current.slice(pattern.length).trimStart();
  }

  const index = current.indexOf(previous);
  if (index === -1) return current;
  return `${current.slice(0, index)}${current.slice(index + previous.length)}`.trim();
}
