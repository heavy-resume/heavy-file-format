import type { CanvasTextItem, CanvasTextSizeRange } from './canvas-drawing-format';

// Mixed font sizes within one text item. The item stores its plain `text`, a
// base `size`, and optional `sizes` ranges (UTF-16 offsets into `text`) that
// override the base size. Editing works on runs: consecutive characters that
// share a size.

export interface CanvasTextRun {
  text: string;
  size: number;
}

export function textItemRuns(item: Pick<CanvasTextItem, 'text' | 'size' | 'sizes'>): CanvasTextRun[] {
  const runs: CanvasTextRun[] = [];
  let offset = 0;
  for (const range of item.sizes ?? []) {
    if (range.start > offset) runs.push({ text: item.text.slice(offset, range.start), size: item.size });
    runs.push({ text: item.text.slice(range.start, range.end), size: range.size });
    offset = range.end;
  }
  if (offset < item.text.length) runs.push({ text: item.text.slice(offset), size: item.size });
  return mergeRuns(runs);
}

// The stored fields for a list of runs: the base size is the size of the most
// characters, and only runs that differ from it become ranges.
export function runsToTextFields(runs: CanvasTextRun[]): { text: string; size: number; sizes?: CanvasTextSizeRange[] } {
  const merged = mergeRuns(runs);
  const text = merged.map((run) => run.text).join('');
  const counts = new Map<number, number>();
  for (const run of merged) counts.set(run.size, (counts.get(run.size) ?? 0) + run.text.length);
  let size = merged[0]?.size ?? 24;
  for (const [candidate, count] of counts) {
    if (count > (counts.get(size) ?? 0)) size = candidate;
  }
  const sizes: CanvasTextSizeRange[] = [];
  let offset = 0;
  for (const run of merged) {
    if (run.size !== size) sizes.push({ start: offset, end: offset + run.text.length, size: run.size });
    offset += run.text.length;
  }
  return { text, size, ...(sizes.length > 0 ? { sizes } : {}) };
}

// Sets the size of characters [start, end) across the runs.
export function applySizeToRuns(runs: CanvasTextRun[], start: number, end: number, size: number): CanvasTextRun[] {
  const next: CanvasTextRun[] = [];
  let offset = 0;
  for (const run of runs) {
    const runStart = offset;
    const runEnd = offset + run.text.length;
    offset = runEnd;
    const from = Math.max(start, runStart);
    const to = Math.min(end, runEnd);
    if (from >= to) {
      next.push(run);
      continue;
    }
    if (from > runStart) next.push({ text: run.text.slice(0, from - runStart), size: run.size });
    next.push({ text: run.text.slice(from - runStart, to - runStart), size });
    if (to < runEnd) next.push({ text: run.text.slice(to - runStart), size: run.size });
  }
  return mergeRuns(next);
}

// Splits runs into lines at newlines, keeping each piece's size.
export function runsToLines(runs: CanvasTextRun[]): CanvasTextRun[][] {
  const lines: CanvasTextRun[][] = [[]];
  for (const run of runs) {
    const parts = run.text.split('\n');
    parts.forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part) lines[lines.length - 1]!.push({ text: part, size: run.size });
    });
  }
  return lines;
}

export function sizeAtOffset(runs: CanvasTextRun[], offset: number, fallback: number): number {
  let position = 0;
  for (const run of runs) {
    if (offset < position + run.text.length || (offset === position + run.text.length && run === runs[runs.length - 1])) return run.size;
    position += run.text.length;
  }
  return runs[0]?.size ?? fallback;
}

function mergeRuns(runs: CanvasTextRun[]): CanvasTextRun[] {
  const merged: CanvasTextRun[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const last = merged[merged.length - 1];
    if (last && last.size === run.size) last.text += run.text;
    else merged.push({ ...run });
  }
  return merged;
}
