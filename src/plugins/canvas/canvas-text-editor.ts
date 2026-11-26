import type { CanvasPoint } from './canvas-drawing-format';
import { CANVAS_TEXT_LINE_HEIGHT } from './canvas-shapes';
import { applySizeToRuns, sizeAtOffset, type CanvasTextRun } from './canvas-text-runs';

// A rich text box over the canvas for typing text with mixed font sizes.
// Typing never touches the drawing; the runs are handed back once, when the
// editor closes. Controls marked with KEEP_OPEN_ATTRIBUTE (the font size
// control) can be used without closing it.

export const CANVAS_TEXT_EDITOR_KEEP_OPEN_ATTRIBUTE = 'data-canvas-text-editor-keep-open';

export interface CanvasTextEditorSession {
  runs: CanvasTextRun[];
  // Size for typing into empty text.
  baseSize: number;
  // Text center in CSS pixels relative to the canvas frame.
  center: CanvasPoint;
  // CSS pixels per logical canvas unit.
  scale: number;
  color: string;
  font: string;
  // Reports the size at the caret or selection start, for the toolbar.
  onSelectionSize(size: number): void;
  onClose(runs: CanvasTextRun[]): void;
}

export interface CanvasTextEditor {
  open(session: CanvasTextEditorSession): void;
  // Closes and hands the runs back. Safe to call when already closed.
  close(): void;
  isOpen(): boolean;
  // Sets the size of the selected characters, or of all text when nothing is selected.
  applySize(size: number): void;
}

export function createCanvasTextEditor(frame: HTMLElement): CanvasTextEditor {
  let editor: HTMLDivElement | null = null;
  let session: CanvasTextEditorSession | null = null;
  let baseSize = 24;
  // Last selection inside the editor, as character offsets; kept while focus
  // is on the font size control.
  let savedSelection = { start: 0, end: 0 };

  const readRuns = (): CanvasTextRun[] => {
    if (!editor) return [];
    const runs: CanvasTextRun[] = [];
    const walk = (node: Node, size: number) => {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.textContent) runs.push({ text: node.textContent, size });
        return;
      }
      if (!(node instanceof HTMLElement)) return;
      if (node.tagName === 'BR') {
        runs.push({ text: '\n', size });
        return;
      }
      const own = Number(node.dataset.size);
      const childSize = Number.isFinite(own) && own > 0 ? own : size;
      node.childNodes.forEach((child) => walk(child, childSize));
    };
    editor.childNodes.forEach((child) => walk(child, baseSize));
    return runs;
  };

  const render = (runs: CanvasTextRun[]) => {
    if (!editor || !session) return;
    editor.replaceChildren(...runs.map((run) => {
      const span = document.createElement('span');
      span.dataset.size = String(run.size);
      span.style.fontSize = `${run.size * session!.scale}px`;
      span.textContent = run.text;
      return span;
    }));
    editor.style.fontSize = `${baseSize * session.scale}px`;
  };

  const characterOffset = (container: Node, offset: number): number => {
    if (!editor) return 0;
    let count = 0;
    let found: number | null = null;
    const walk = (node: Node): void => {
      if (found !== null) return;
      if (node === container && node.nodeType !== Node.TEXT_NODE) {
        for (let index = 0; index < offset; index += 1) count += textLength(node.childNodes[index]!);
        found = count;
        return;
      }
      if (node.nodeType === Node.TEXT_NODE) {
        if (node === container) {
          found = count + offset;
          return;
        }
        count += node.textContent?.length ?? 0;
        return;
      }
      if (node instanceof HTMLElement && node.tagName === 'BR') {
        count += 1;
        return;
      }
      node.childNodes.forEach(walk);
    };
    walk(editor);
    return found ?? count;
  };

  const restoreSelection = (start: number, end: number) => {
    if (!editor) return;
    const locate = (target: number): [Node, number] => {
      let remaining = target;
      const texts: Text[] = [];
      const collect = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) texts.push(node as Text);
        else node.childNodes.forEach(collect);
      };
      collect(editor!);
      for (const text of texts) {
        if (remaining <= text.length) return [text, remaining];
        remaining -= text.length;
      }
      return [editor!, editor!.childNodes.length];
    };
    const range = document.createRange();
    range.setStart(...locate(start));
    range.setEnd(...locate(end));
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  const onSelectionChange = () => {
    const selection = window.getSelection();
    if (!editor || !session || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return;
    savedSelection = { start: characterOffset(range.startContainer, range.startOffset), end: characterOffset(range.endContainer, range.endOffset) };
    session.onSelectionSize(sizeAtOffset(readRuns(), savedSelection.start, baseSize));
  };

  // Clicking or focusing anything other than the editor or a keep-open control closes it.
  const onOutsideInteraction = (event: Event) => {
    const target = event.target as Node | null;
    if (!editor || !target || editor.contains(target)) return;
    if (target instanceof Element && target.closest(`[${CANVAS_TEXT_EDITOR_KEEP_OPEN_ATTRIBUTE}]`)) return;
    close();
  };

  function close() {
    if (!editor || !session) return;
    const current = session;
    const closing = editor;
    const runs = trimTrailingWhitespace(readRuns());
    // Cleared first: removing a focused element fires blur and focus events.
    editor = null;
    session = null;
    document.removeEventListener('selectionchange', onSelectionChange);
    document.removeEventListener('pointerdown', onOutsideInteraction, true);
    document.removeEventListener('focusin', onOutsideInteraction, true);
    closing.remove();
    current.onClose(runs);
  }

  return {
    open(next) {
      close();
      session = next;
      baseSize = next.baseSize;
      editor = document.createElement('div');
      editor.className = 'hvy-canvas-text-editor';
      editor.contentEditable = 'true';
      editor.spellcheck = true;
      editor.setAttribute('role', 'textbox');
      editor.setAttribute('aria-multiline', 'true');
      editor.setAttribute('aria-label', 'Canvas text');
      editor.style.left = `${next.center.x}px`;
      editor.style.top = `${next.center.y}px`;
      editor.style.lineHeight = String(CANVAS_TEXT_LINE_HEIGHT);
      editor.style.fontFamily = next.font;
      editor.style.color = next.color;
      render(next.runs);
      editor.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' || (event.key === 'Enter' && (event.metaKey || event.ctrlKey))) {
          event.preventDefault();
          event.stopPropagation();
          close();
        } else if (event.key === 'Enter') {
          event.preventDefault();
          document.execCommand('insertLineBreak');
        }
      });
      editor.addEventListener('paste', (event) => {
        event.preventDefault();
        document.execCommand('insertText', false, event.clipboardData?.getData('text/plain') ?? '');
      });
      // Pointer input inside the editor belongs to it, not the canvas or editor block.
      editor.addEventListener('pointerdown', (event) => event.stopPropagation());
      editor.addEventListener('click', (event) => event.stopPropagation());
      frame.appendChild(editor);
      document.addEventListener('selectionchange', onSelectionChange);
      document.addEventListener('pointerdown', onOutsideInteraction, true);
      document.addEventListener('focusin', onOutsideInteraction, true);
      editor.focus({ preventScroll: true });
      const length = next.runs.reduce((total, run) => total + run.text.length, 0);
      restoreSelection(length, length);
      savedSelection = { start: length, end: length };
      next.onSelectionSize(sizeAtOffset(next.runs, length, baseSize));
    },
    close,
    isOpen: () => editor !== null,
    applySize(size) {
      if (!editor || !session) return;
      const runs = readRuns();
      const length = runs.reduce((total, run) => total + run.text.length, 0);
      const { start, end } = savedSelection;
      const whole = start === end;
      if (whole) baseSize = size;
      render(applySizeToRuns(runs, whole ? 0 : start, whole ? length : end, size));
      editor.focus({ preventScroll: true });
      restoreSelection(start, end);
      session.onSelectionSize(size);
    },
  };
}

function textLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length ?? 0;
  if (node instanceof HTMLElement && node.tagName === 'BR') return 1;
  let total = 0;
  node.childNodes.forEach((child) => {
    total += textLength(child);
  });
  return total;
}

function trimTrailingWhitespace(runs: CanvasTextRun[]): CanvasTextRun[] {
  const trimmed = runs.map((run) => ({ ...run }));
  while (trimmed.length > 0) {
    const last = trimmed[trimmed.length - 1]!;
    last.text = last.text.replace(/\s+$/, '');
    if (last.text) break;
    trimmed.pop();
  }
  return trimmed;
}
