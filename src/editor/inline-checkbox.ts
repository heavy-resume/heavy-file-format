export const INLINE_CHECKBOX_CARET_ANCHOR = '\u200b';

export function handleInlineCheckboxBackspace(editable: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.isCollapsed) {
    return false;
  }

  const range = selection.getRangeAt(0);
  const removal = findInlineCheckboxRemovalTarget(range.startContainer, range.startOffset, editable);
  if (!removal) {
    return false;
  }

  removal.checkbox.remove();
  if (removal.spacer instanceof Text) {
    if (removal.spacer.data.length > 1) {
      removal.spacer.data = removal.spacer.data.slice(1);
      setCollapsedSelection(removal.spacer, 0);
    } else {
      const anchor = removal.spacer.nextSibling;
      removal.spacer.remove();
      if (anchor instanceof Text) {
        setCollapsedSelection(anchor, 0);
      } else if (anchor) {
        setCollapsedSelectionBefore(anchor);
      } else if (removal.container) {
        setCollapsedSelection(removal.container, Math.max(0, getNodeIndex(removal.checkbox)));
      }
    }
  }
  return true;
}

function findInlineCheckboxRemovalTarget(
  node: Node | null,
  offset: number,
  editable: HTMLElement
): { checkbox: HTMLInputElement; spacer: Node | null; container: Node | null } | null {
  if (node instanceof Text) {
    if (offset === 0 && node.previousSibling instanceof HTMLInputElement && node.previousSibling.type === 'checkbox') {
      return { checkbox: node.previousSibling, spacer: null, container: node.parentNode };
    }
    if (offset === 0 && isInlineCheckboxSpacer(node) && node.previousSibling instanceof HTMLInputElement && node.previousSibling.type === 'checkbox') {
      return { checkbox: node.previousSibling, spacer: node, container: node.parentNode };
    }
    if (offset === 1 && isInlineCheckboxSpacer(node) && node.previousSibling instanceof HTMLInputElement && node.previousSibling.type === 'checkbox') {
      return { checkbox: node.previousSibling, spacer: node, container: node.parentNode };
    }
    if (offset === 0 && node.previousSibling instanceof Text && isInlineCheckboxSpacer(node.previousSibling)) {
      const checkbox = node.previousSibling.previousSibling;
      if (checkbox instanceof HTMLInputElement && checkbox.type === 'checkbox') {
        return { checkbox, spacer: node.previousSibling, container: node.parentNode };
      }
    }
    return null;
  }
  if (node instanceof HTMLElement || node instanceof DocumentFragment) {
    if (node instanceof HTMLInputElement && node.type === 'checkbox' && editable.contains(node)) {
      const spacer = node.nextSibling instanceof Text && isInlineCheckboxSpacer(node.nextSibling) ? node.nextSibling : null;
      return { checkbox: node, spacer, container: node.parentNode };
    }
    if (offset <= 1 && node === editable) {
      const leading = findLeadingCheckbox(node, editable);
      if (leading) {
        return leading;
      }
    }
    if (offset === 0) {
      const leading = findLeadingCheckbox(node, editable);
      if (leading) {
        return leading;
      }
    }
    const previousNode = node.childNodes[offset - 1] ?? null;
    const nextNode = node.childNodes[offset] ?? null;
    if (previousNode instanceof HTMLInputElement && previousNode.type === 'checkbox' && editable.contains(previousNode)) {
      const spacer = nextNode instanceof Text && isInlineCheckboxSpacer(nextNode) ? nextNode : null;
      return { checkbox: previousNode, spacer, container: node };
    }
    if (previousNode instanceof Text && isInlineCheckboxSpacer(previousNode)) {
      const checkbox = previousNode.previousSibling;
      if (checkbox instanceof HTMLInputElement && checkbox.type === 'checkbox' && editable.contains(checkbox)) {
        return { checkbox, spacer: previousNode, container: node };
      }
    }
  }
  return null;
}

function findLeadingCheckbox(
  node: HTMLElement | DocumentFragment,
  editable: HTMLElement
): { checkbox: HTMLInputElement; spacer: Node | null; container: Node | null } | null {
  const firstNode = node.childNodes[0] ?? null;
  if (firstNode instanceof HTMLInputElement && firstNode.type === 'checkbox' && editable.contains(firstNode)) {
    const spacer = firstNode.nextSibling instanceof Text && isInlineCheckboxSpacer(firstNode.nextSibling) ? firstNode.nextSibling : null;
    return { checkbox: firstNode, spacer, container: node };
  }
  if (firstNode instanceof HTMLElement) {
    return findLeadingCheckbox(firstNode, editable);
  }
  return null;
}

function isInlineCheckboxSpacer(node: Text): boolean {
  return node.data.startsWith(' ') || node.data.startsWith(INLINE_CHECKBOX_CARET_ANCHOR);
}

function setCollapsedSelection(node: Node, offset: number): void {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function setCollapsedSelectionBefore(node: Node): void {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }
  const range = document.createRange();
  range.setStartBefore(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function getNodeIndex(node: Node): number {
  let index = 0;
  let current = node.previousSibling;
  while (current) {
    index += 1;
    current = current.previousSibling;
  }
  return index;
}
