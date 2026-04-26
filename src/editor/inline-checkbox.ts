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
    if (offset === 0 && node.data.startsWith(' ') && node.previousSibling instanceof HTMLInputElement && node.previousSibling.type === 'checkbox') {
      return { checkbox: node.previousSibling, spacer: node, container: node.parentNode };
    }
    if (offset === 1 && node.data.startsWith(' ') && node.previousSibling instanceof HTMLInputElement && node.previousSibling.type === 'checkbox') {
      return { checkbox: node.previousSibling, spacer: node, container: node.parentNode };
    }
    if (offset === 0 && node.previousSibling instanceof Text && node.previousSibling.data.startsWith(' ')) {
      const checkbox = node.previousSibling.previousSibling;
      if (checkbox instanceof HTMLInputElement && checkbox.type === 'checkbox') {
        return { checkbox, spacer: node.previousSibling, container: node.parentNode };
      }
    }
    return null;
  }
  if (node instanceof HTMLElement || node instanceof DocumentFragment) {
    const previousNode = node.childNodes[offset - 1] ?? null;
    const nextNode = node.childNodes[offset] ?? null;
    if (previousNode instanceof HTMLInputElement && previousNode.type === 'checkbox' && editable.contains(previousNode)) {
      const spacer = nextNode instanceof Text && nextNode.data.startsWith(' ') ? nextNode : null;
      return { checkbox: previousNode, spacer, container: node };
    }
    if (previousNode instanceof Text && previousNode.data.startsWith(' ')) {
      const checkbox = previousNode.previousSibling;
      if (checkbox instanceof HTMLInputElement && checkbox.type === 'checkbox' && editable.contains(checkbox)) {
        return { checkbox, spacer: previousNode, container: node };
      }
    }
  }
  return null;
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
