export interface HvyTextDiffSelection {
  removed: boolean[];
  added: boolean[];
}

const MAX_LCS_CELLS = 4_000_000;

/** Mark graphemes that do not belong to a longest common subsequence. */
export function diffTextGraphemes(before: readonly string[], after: readonly string[]): HvyTextDiffSelection {
  const removed = Array<boolean>(before.length).fill(false);
  const added = Array<boolean>(after.length).fill(false);
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix += 1;
  }

  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (beforeEnd > prefix && afterEnd > prefix && before[beforeEnd - 1] === after[afterEnd - 1]) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }

  const beforeLength = beforeEnd - prefix;
  const afterLength = afterEnd - prefix;
  if (beforeLength === 0) {
    for (let index = prefix; index < afterEnd; index += 1) added[index] = true;
    return { removed, added };
  }
  if (afterLength === 0) {
    for (let index = prefix; index < beforeEnd; index += 1) removed[index] = true;
    return { removed, added };
  }

  if (beforeLength * afterLength > MAX_LCS_CELLS) {
    for (let index = prefix; index < beforeEnd; index += 1) removed[index] = true;
    for (let index = prefix; index < afterEnd; index += 1) added[index] = true;
    return { removed, added };
  }

  const rows = Array.from({ length: beforeLength + 1 }, () => new Uint32Array(afterLength + 1));
  for (let beforeIndex = 1; beforeIndex <= beforeLength; beforeIndex += 1) {
    for (let afterIndex = 1; afterIndex <= afterLength; afterIndex += 1) {
      rows[beforeIndex]![afterIndex] = before[prefix + beforeIndex - 1] === after[prefix + afterIndex - 1]
        ? rows[beforeIndex - 1]![afterIndex - 1]! + 1
        : Math.max(rows[beforeIndex - 1]![afterIndex]!, rows[beforeIndex]![afterIndex - 1]!);
    }
  }

  let beforeIndex = beforeLength;
  let afterIndex = afterLength;
  while (beforeIndex > 0 || afterIndex > 0) {
    if (
      beforeIndex > 0
      && afterIndex > 0
      && before[prefix + beforeIndex - 1] === after[prefix + afterIndex - 1]
    ) {
      beforeIndex -= 1;
      afterIndex -= 1;
    } else if (afterIndex > 0 && (beforeIndex === 0 || rows[beforeIndex]![afterIndex - 1]! >= rows[beforeIndex - 1]![afterIndex]!)) {
      added[prefix + afterIndex - 1] = true;
      afterIndex -= 1;
    } else {
      removed[prefix + beforeIndex - 1] = true;
      beforeIndex -= 1;
    }
  }

  return { removed, added };
}

export function segmentTextGraphemes(text: string): Array<{ segment: string; start: number; end: number }> {
  if (typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(text), ({ segment, index }) => ({
      segment,
      start: index,
      end: index + segment.length,
    }));
  }
  let offset = 0;
  return Array.from(text, (segment) => {
    const start = offset;
    offset += segment.length;
    return { segment, start, end: offset };
  });
}
