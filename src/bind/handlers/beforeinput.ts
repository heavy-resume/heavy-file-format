import { handleRichEditorBeforeInput, handleRichEditorCopy, handleRichEditorPlainTextPaste } from './_imports';

export function bindBeforeinput(app: HTMLElement): void {
  app.addEventListener('copy', (event) => {
    const editable = getRichEditable(event.target as HTMLElement);
    if (editable) {
      handleRichEditorCopy(event, editable);
      return;
    }
    handleViewerCopy(event, app);
  });

  app.addEventListener('paste', (event) => {
    const editable = getRichEditable(event.target as HTMLElement);
    if (!editable || !consumePendingPlainPaste(editable)) {
      return;
    }

    if (!handleRichEditorPlainTextPaste(event, editable)) {
      return;
    }

    event.preventDefault();
  });

  app.addEventListener('beforeinput', (event) => {
    const editable = getRichEditable(event.target as HTMLElement);

    if (!editable) {
      return;
    }

    const inputEvent = event as InputEvent;
    if (!handleRichEditorBeforeInput(inputEvent, editable)) {
      return;
    }

    if (inputEvent.inputType === 'insertFromPasteAsQuotation') {
      clearPendingPlainPaste(editable);
    }

    event.preventDefault();
  });
}

function getRichEditable(target: HTMLElement): HTMLElement | null {
  return target.dataset.field === 'block-rich' ||
    target.dataset.field === 'block-grid-rich' ||
    target.dataset.field === 'table-details-rich' ||
    target.dataset.field === 'caption-rich'
    ? target
    : target.closest<HTMLElement>(
        '[data-field="block-rich"], [data-field="block-grid-rich"], [data-field="table-details-rich"], [data-field="caption-rich"]'
      );
}

export function handleViewerCopy(event: ClipboardEvent, app: HTMLElement): boolean {
  const clipboard = event.clipboardData;
  const selection = window.getSelection();
  if (!clipboard || !selection?.rangeCount) {
    return false;
  }
  const range = selection.getRangeAt(0);
  if (range.collapsed) {
    return false;
  }
  const reader = getViewerReaderForRange(range, app);
  if (!reader) {
    return false;
  }
  const container = document.createElement('div');
  container.appendChild(cloneViewerSelection(range, reader));
  container.querySelectorAll('.text-copy-button, .reader-add-component-slot, .ghost-section-card').forEach((element) => element.remove());
  const html = container.innerHTML.trim();
  if (!html) {
    return false;
  }
  clipboard.setData('text/html', html);
  clipboard.setData('text/plain', range.toString().trim());
  event.preventDefault();
  return true;
}

function getViewerReaderForRange(range: Range, app: HTMLElement): HTMLElement | null {
  const commonElement = range.commonAncestorContainer instanceof HTMLElement
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;
  const reader = commonElement?.closest<HTMLElement>('.reader-document');
  const shell = reader?.closest<HTMLElement>('.viewer-shell');
  return reader && shell && !shell.classList.contains('ai-view-shell') && app.contains(reader) && reader.contains(range.commonAncestorContainer)
    ? reader
    : null;
}

function cloneViewerSelection(range: Range, reader: HTMLElement): DocumentFragment {
  const fragment = range.cloneContents();
  const commonElement = range.commonAncestorContainer instanceof HTMLElement
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;
  if (!commonElement || commonElement === reader) {
    return fragment;
  }
  const contextAncestors: HTMLElement[] = [];
  for (let element: HTMLElement | null = commonElement; element && element !== reader; element = element.parentElement) {
    contextAncestors.push(element);
  }
  const wrapperFragment = document.createDocumentFragment();
  let parent: ParentNode = wrapperFragment;
  for (const element of contextAncestors.reverse()) {
    const wrapper = document.createElement(element.tagName.toLowerCase());
    copyViewerSelectionContextAttributes(element, wrapper);
    parent.appendChild(wrapper);
    parent = wrapper;
  }
  parent.appendChild(fragment);
  return wrapperFragment;
}

function copyViewerSelectionContextAttributes(source: HTMLElement, target: HTMLElement): void {
  for (const name of ['style', 'href', 'title']) {
    const value = source.getAttribute(name);
    if (value) {
      target.setAttribute(name, value);
    }
  }
}

function consumePendingPlainPaste(editable: HTMLElement): boolean {
  const until = Number(editable.dataset.hvyPlainPasteUntil ?? '0');
  clearPendingPlainPaste(editable);
  return Number.isFinite(until) && until >= Date.now();
}

function clearPendingPlainPaste(editable: HTMLElement): void {
  delete editable.dataset.hvyPlainPasteUntil;
}
