const CODE_INDENT = '  ';

export type CodeIndentDirection = 'indent' | 'dedent';

export type CodeIndentResult = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
};

export function applyCodeIndentation(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  direction: CodeIndentDirection
): CodeIndentResult {
  const start = clampSelectionOffset(value, selectionStart);
  const end = clampSelectionOffset(value, selectionEnd);
  if (direction === 'indent' && start === end) {
    return {
      value: `${value.slice(0, start)}${CODE_INDENT}${value.slice(end)}`,
      selectionStart: start + CODE_INDENT.length,
      selectionEnd: start + CODE_INDENT.length,
    };
  }
  const lineStarts = collectSelectedLineStarts(value, start, end);
  return direction === 'indent'
    ? indentSelectedLines(value, start, end, lineStarts)
    : dedentSelectedLines(value, start, end, lineStarts);
}

function indentSelectedLines(value: string, selectionStart: number, selectionEnd: number, lineStarts: number[]): CodeIndentResult {
  let nextValue = value;
  let offset = 0;
  let nextSelectionStart = selectionStart;
  let nextSelectionEnd = selectionEnd;
  for (const lineStart of lineStarts) {
    const insertionStart = lineStart + offset;
    nextValue = `${nextValue.slice(0, insertionStart)}${CODE_INDENT}${nextValue.slice(insertionStart)}`;
    offset += CODE_INDENT.length;
    if (selectionStart > lineStart) {
      nextSelectionStart += CODE_INDENT.length;
    }
    if (selectionEnd > lineStart) {
      nextSelectionEnd += CODE_INDENT.length;
    }
  }
  return {
    value: nextValue,
    selectionStart: nextSelectionStart,
    selectionEnd: nextSelectionEnd,
  };
}

function dedentSelectedLines(value: string, selectionStart: number, selectionEnd: number, lineStarts: number[]): CodeIndentResult {
  let nextValue = value;
  let offset = 0;
  let nextSelectionStart = selectionStart;
  let nextSelectionEnd = selectionEnd;
  for (const lineStart of lineStarts) {
    const removalStart = lineStart + offset;
    const removalLength = getDedentLength(nextValue, removalStart);
    if (removalLength === 0) {
      continue;
    }
    nextValue = `${nextValue.slice(0, removalStart)}${nextValue.slice(removalStart + removalLength)}`;
    offset -= removalLength;
    nextSelectionStart -= getSelectionDedentAdjustment(selectionStart, lineStart, removalLength);
    nextSelectionEnd -= getSelectionDedentAdjustment(selectionEnd, lineStart, removalLength);
  }
  return {
    value: nextValue,
    selectionStart: Math.max(0, nextSelectionStart),
    selectionEnd: Math.max(0, nextSelectionEnd),
  };
}

function collectSelectedLineStarts(value: string, selectionStart: number, selectionEnd: number): number[] {
  const starts: number[] = [];
  const effectiveEnd = selectionEnd > selectionStart && value[selectionEnd - 1] === '\n' ? selectionEnd - 1 : selectionEnd;
  let lineStart = getLineStart(value, selectionStart);
  while (lineStart <= effectiveEnd) {
    starts.push(lineStart);
    const nextNewline = value.indexOf('\n', lineStart);
    if (nextNewline === -1) {
      break;
    }
    lineStart = nextNewline + 1;
  }
  return starts;
}

function getLineStart(value: string, offset: number): number {
  return value.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
}

function getDedentLength(value: string, lineStart: number): number {
  if (value.startsWith(CODE_INDENT, lineStart)) {
    return CODE_INDENT.length;
  }
  if (value[lineStart] === ' ' || value[lineStart] === '\t') {
    return 1;
  }
  return 0;
}

function getSelectionDedentAdjustment(selectionOffset: number, lineStart: number, removalLength: number): number {
  if (selectionOffset <= lineStart) {
    return 0;
  }
  return Math.min(removalLength, selectionOffset - lineStart);
}

function clampSelectionOffset(value: string, offset: number): number {
  return Math.min(Math.max(offset, 0), value.length);
}
