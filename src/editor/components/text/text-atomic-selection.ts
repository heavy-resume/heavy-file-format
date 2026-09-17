import { getCaretRangeFromPoint } from '../../../scroll';

/** Keep a drag that starts on an inline atom anchored to the whole atom. */
export function beginAtomicInlineSelection(event: MouseEvent, editable: HTMLElement): boolean {
  const atom = event.target instanceof Element
    ? event.target.closest<HTMLElement>('[data-rich-atomic="true"][contenteditable="false"]')
    : null;
  if (!atom || !editable.contains(atom) || event.shiftKey) return false;

  // Native user-select:all selects on press, then collapses the range while the
  // pointer crosses a non-editable child. Own this gesture, including extension
  // into surrounding text, so its selection does not blink off between moves.
  event.preventDefault();
  editable.focus({ preventScroll: true });
  const selection = window.getSelection();
  if (!selection) return false;
  const atomRange = document.createRange();
  atomRange.selectNode(atom);
  selection.removeAllRanges();
  selection.addRange(atomRange.cloneRange());

  const gesture = new AbortController();
  let backward = false;
  const update = (move: MouseEvent) => {
    if (!atom.isConnected || !(move.buttons & 1)) {
      gesture.abort();
      return;
    }
    move.preventDefault();
    const range = atomRange.cloneRange();
    const target = document.elementFromPoint(move.clientX, move.clientY);
    if (!target || !atom.contains(target)) {
      const caret = getCaretRangeFromPoint(move.clientX, move.clientY);
      if (!caret) return;
      const contents = document.createRange();
      contents.selectNodeContents(editable);
      const outside = contents.comparePoint(caret.startContainer, caret.startOffset);
      if (outside < 0) {
        caret.setStart(contents.startContainer, contents.startOffset);
      } else if (outside > 0) {
        caret.setStart(contents.endContainer, contents.endOffset);
      }
      caret.collapse(true);
      const direction = atomRange.comparePoint(caret.startContainer, caret.startOffset);
      const otherAtom = target?.closest('[data-rich-atomic="true"][contenteditable="false"]');
      if (direction < 0) {
        backward = true;
        if (otherAtom && editable.contains(otherAtom)) range.setStartBefore(otherAtom);
        else range.setStart(caret.startContainer, caret.startOffset);
      } else if (direction > 0) {
        backward = false;
        if (otherAtom && editable.contains(otherAtom)) range.setEndAfter(otherAtom);
        else range.setEnd(caret.startContainer, caret.startOffset);
      }
    }
    const anchorNode = backward ? range.endContainer : range.startContainer;
    const anchorOffset = backward ? range.endOffset : range.startOffset;
    const focusNode = backward ? range.startContainer : range.endContainer;
    const focusOffset = backward ? range.startOffset : range.endOffset;
    if (selection.anchorNode === anchorNode && selection.anchorOffset === anchorOffset
      && selection.focusNode === focusNode && selection.focusOffset === focusOffset) return;
    selection.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
  };
  window.addEventListener('mousemove', update, { signal: gesture.signal });
  window.addEventListener('mouseup', () => gesture.abort(), { once: true, signal: gesture.signal });
  window.addEventListener('blur', () => gesture.abort(), { once: true, signal: gesture.signal });
  return true;
}
