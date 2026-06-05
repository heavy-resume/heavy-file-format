import {
  state,
  findSectionByKey,
  getReusableNameFromSectionKey,
  findBlockByIds,
  setActiveEditorBlock,
  setAiEditorHostBlock,
  applyRichAction,
  openLinkInlineModal,
  getRenderApp,
} from './_imports';
import { actionRegistry } from '../actions/registry';
import { openRemoveConfirmationModal } from './remove-confirmation-modal';
import { clearHideIfUnmodifiedForSectionPath, clearHideIfUnmodifiedForSections, findSectionPath } from '../../template-hide';
import { isAiEditablePlaceholderTextBlock } from '../../ai-placeholder';
import { logClickTrace } from '../click-trace';

interface RichToolbarSelection {
  range: Range;
  anchor: HTMLAnchorElement | null;
}

const richToolbarSelections = new WeakMap<HTMLElement, RichToolbarSelection>();

export function bindClickDispatch(app: HTMLElement): void {
  app.addEventListener('click', (event) => {
    logClickTrace(event, 'click-dispatch:capture:enter', {
      currentView: state.currentView,
    });
    handleAiReaderTextActivationClick(event);
  }, true);

  app.addEventListener('contextmenu', (event) => {
    const target = event.target as HTMLElement;
    const styleButton = target.closest<HTMLElement>('.paragraph-style-card[data-rich-action="text-line-style"][data-text-line-style-name]');
    const styleName = styleButton?.dataset.textLineStyleName ?? '';
    if (!styleButton || !styleName) {
      return;
    }
    event.preventDefault();
    const toolbar = styleButton.closest<HTMLElement>('.paragraph-style-toolbar');
    openParagraphStyleEditor(toolbar, styleName);
  });

  app.addEventListener('mouseup', (event) => {
    const editable = (event.target as HTMLElement).closest<HTMLElement>('.rich-editor');
    if (editable) {
      storeCurrentRichSelection(editable);
    }
  });

  app.addEventListener('keyup', (event) => {
    const editable = (event.target as HTMLElement).closest<HTMLElement>('.rich-editor');
    if (editable) {
      storeCurrentRichSelection(editable);
    }
  });

  app.addEventListener('mousedown', (event) => {
    const target = event.target as HTMLElement;
    const actionButton = target.closest<HTMLElement>('[data-action]');
    const richButton = target.closest<HTMLElement>('[data-rich-action]');
    logClickTrace(event, 'click-dispatch:mousedown:enter', {
      action: actionButton?.dataset.action ?? null,
      richAction: richButton?.dataset.richAction ?? null,
    });
    if (richButton) {
      const editable = getRichEditableForButton(app, richButton);
      if (editable) {
        storeCurrentRichSelection(editable, { preserveExistingSelection: true });
      }
      event.preventDefault();
      logClickTrace(event, 'click-dispatch:mousedown:rich-selection-preserved', {
        richAction: richButton.dataset.richAction ?? null,
      });
      return;
    }
    if (actionButton && isParagraphStyleToolbarAction(actionButton.dataset.action ?? '')) {
      const toolbar = actionButton.closest<HTMLElement>('.paragraph-style-toolbar');
      const editable = toolbar ? getRichEditableForButton(app, toolbar) : null;
      if (editable) {
        storeCurrentRichSelection(editable);
      }
      event.preventDefault();
      logClickTrace(event, 'click-dispatch:mousedown:paragraph-style-preserved', {
        action: actionButton.dataset.action ?? null,
      });
      return;
    }
    if (actionButton?.dataset.action === 'set-block-align') {
      event.preventDefault();
      logClickTrace(event, 'click-dispatch:mousedown:set-block-align-prevent-default');
    }
    if (actionButton?.dataset.action === 'set-editor-mode' || actionButton?.dataset.action === 'switch-view') {
      event.preventDefault();
      logClickTrace(event, 'click-dispatch:mousedown:preserve-fill-in-for-shell-action', {
        action: actionButton.dataset.action,
      });
    }
  });

  app.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const actionButton = target.closest<HTMLElement>('[data-action]');
    logClickTrace(event, 'click-dispatch:bubble:enter', {
      action: actionButton?.dataset.action ?? null,
      componentPlacement: Boolean(state.componentPlacement),
    });

    if (state.componentPlacement && !isPlacementModeAction(actionButton?.dataset.action ?? '')) {
      logClickTrace(event, 'click-dispatch:bubble:handled:cancel-component-placement');
      state.componentPlacement = null;
      event.preventDefault();
      event.stopPropagation();
      getRenderApp()();
      return;
    }

    if (target.closest('select') || target.closest('input')) {
      logClickTrace(event, 'click-dispatch:bubble:skip', {
        skipReason: 'form-control-target',
      });
      return;
    }

    const richButton = target.closest<HTMLElement>('[data-rich-action]');
    if (richButton) {
      event.preventDefault();
      logClickTrace(event, 'click-dispatch:bubble:handled:rich-action', {
        richAction: richButton.dataset.richAction ?? null,
      });
      const paragraphStyleToolbar = richButton.closest<HTMLElement>('.paragraph-style-toolbar');
      if (paragraphStyleToolbar && isCompactParagraphStylePickerButton(richButton, paragraphStyleToolbar)) {
        openParagraphStylePicker(paragraphStyleToolbar);
        return;
      }
      paragraphStyleToolbar?.classList.remove('is-picker-open');
      paragraphStyleToolbar?.querySelector<HTMLButtonElement>('[data-action="open-paragraph-style-picker"]')?.setAttribute('aria-expanded', 'false');
      const sectionKey = richButton.dataset.sectionKey;
      const blockId = richButton.dataset.blockId;
      const action = richButton.dataset.richAction;
      if (sectionKey && blockId && action) {
        const editable = getRichEditableForButton(app, richButton);
        if (editable) {
          const restoredSelection = restoreRichToolbarSelection(editable);
          if (action === 'link') {
            openLinkInlineModal(
              app,
              editable,
              restoredSelection?.anchor?.getAttribute('href') ?? '',
              restoredSelection?.range ?? null,
              restoredSelection?.anchor ?? null
            );
            return;
          }
          if (!editable.contains(document.activeElement) && !hasSelectionInside(editable)) {
            editable.focus();
          }
          applyRichAction(action, editable, richButton.dataset.textLineStyleName);
          clearHideIfUnmodifiedForSectionPath(state.document.sections, sectionKey);
          editable.focus({ preventScroll: true });
          richToolbarSelections.delete(editable);
        }
      }
      return;
    }

    if (!actionButton) {
      logClickTrace(event, 'click-dispatch:bubble:skip', {
        skipReason: 'no-data-action',
      });
      return;
    }

    if (actionButton.dataset.action === 'open-paragraph-style-picker') {
      event.preventDefault();
      logClickTrace(event, 'click-dispatch:bubble:handled:open-paragraph-style-picker');
      const toolbar = actionButton.closest<HTMLElement>('.paragraph-style-toolbar');
      if (toolbar?.classList.contains('is-picker-open')) {
        closeParagraphStylePicker(toolbar);
      } else if (toolbar) {
        openParagraphStylePicker(toolbar);
      }
      return;
    }

    if (actionButton.dataset.action === 'close-paragraph-style-picker') {
      event.preventDefault();
      logClickTrace(event, 'click-dispatch:bubble:handled:close-paragraph-style-picker');
      const toolbar = actionButton.closest<HTMLElement>('.paragraph-style-toolbar');
      if (toolbar) {
        closeParagraphStylePicker(toolbar);
      }
      return;
    }

    if (actionButton.dataset.action === 'close-paragraph-style-edit') {
      event.preventDefault();
      logClickTrace(event, 'click-dispatch:bubble:handled:close-paragraph-style-edit');
      const toolbar = actionButton.closest<HTMLElement>('.paragraph-style-toolbar');
      toolbar?.classList.remove('is-style-edit-open');
      toolbar?.querySelectorAll<HTMLElement>('.paragraph-style-edit-panel').forEach((panel) => {
        panel.hidden = true;
      });
      return;
    }

    logClickTrace(event, 'click-dispatch:bubble:execute-action:start', {
      action: actionButton.dataset.action ?? null,
      sectionKey: actionButton.dataset.sectionKey ?? null,
      blockId: actionButton.dataset.blockId ?? null,
    });
    const handled = executeActionButton(app, actionButton, event);
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      logClickTrace(event, 'click-dispatch:bubble:execute-action:stopped', {
        action: actionButton.dataset.action ?? null,
      });
    }
    logClickTrace(event, 'click-dispatch:bubble:execute-action:end', {
      action: actionButton.dataset.action ?? null,
      defaultPreventedAfter: event.defaultPrevented,
      cancelBubbleAfter: event.cancelBubble,
      handled,
    });
  });
}

function handleAiReaderTextActivationClick(event: MouseEvent): void {
  if (state.currentView !== 'ai' || event.defaultPrevented) {
    if (state.currentView === 'ai') {
      logAiReaderTextActivation(event, 'skip', { skipReason: 'default-prevented-before-capture' });
    }
    return;
  }
  const target = event.target as HTMLElement | null;
  if (!target || target.closest('a, button, input, select, textarea, [contenteditable="true"], [role="button"]')) {
    logAiReaderTextActivation(event, 'skip', {
      skipReason: target ? 'interactive-target' : 'missing-target',
      interactiveAncestor: target ? describeElement(target.closest('a, button, input, select, textarea, [contenteditable="true"], [role="button"]')) : null,
    });
    return;
  }
  const textBlock = target.closest<HTMLElement>(
    '.reader-block[data-component="text"][data-section-key][data-block-id]'
  );
  if (!textBlock) {
    logAiReaderTextActivation(event, 'skip', { skipReason: 'no-reader-text-block' });
    return;
  }
  const sectionKey = textBlock.dataset.sectionKey ?? '';
  const blockId = textBlock.dataset.blockId ?? '';
  if (!sectionKey || !blockId) {
    logAiReaderTextActivation(event, 'skip', {
      skipReason: 'missing-reader-text-ids',
      textBlock: describeElement(textBlock),
      sectionKey,
      blockId,
    });
    return;
  }
  const block = findBlockByIds(sectionKey, blockId);
  if (block?.schema.component !== 'text') {
    logAiReaderTextActivation(event, 'skip', {
      skipReason: 'resolved-block-not-text',
      sectionKey,
      blockId,
      resolvedComponent: block?.schema.component ?? null,
      textBlock: describeElement(textBlock),
    });
    return;
  }
  const hasPlaceholder = String(block.schema.placeholder ?? '').trim().length > 0;
  const editablePlaceholder = isAiEditablePlaceholderTextBlock(block);
  const isInsideExpandableToggle = Boolean(textBlock.closest('[data-reader-action="toggle-expandable"]'));
  if (hasPlaceholder && textBlock.closest('[data-reader-action="toggle-expandable"][aria-expanded="false"]')) {
    return;
  }
  if (!editablePlaceholder) {
    logAiReaderTextActivation(event, 'skip', {
      skipReason: !hasPlaceholder ? 'text-without-placeholder' : 'text-placeholder-already-filled',
      sectionKey,
      blockId,
      hasPlaceholder,
      editablePlaceholder,
      isInsideExpandableToggle,
      textBlock: describeElement(textBlock),
    });
    return;
  }
  logAiReaderTextActivation(event, 'activate', {
    sectionKey,
    blockId,
    hasPlaceholder,
    isInsideExpandableToggle,
    textBlock: describeElement(textBlock),
  });
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  state.aiModeTipDismissed = true;
  setActiveEditorBlock(sectionKey, blockId, { targetOnly: true });
  setAiEditorHostBlock(sectionKey, blockId);
  if (state.pendingEditorActivation) {
    state.pendingEditorActivation.immediateFocus = true;
  }
  getRenderApp()();
}

function logAiReaderTextActivation(event: MouseEvent, stage: 'skip' | 'activate', details: Record<string, unknown> = {}): void {
  const target = event.target instanceof HTMLElement ? event.target : null;
  console.debug('[hvy:ai-reader-text-activation]', {
    stage,
    currentView: state.currentView,
    eventType: event.type,
    eventPhase: event.eventPhase,
    defaultPrevented: event.defaultPrevented,
    clientX: event.clientX,
    clientY: event.clientY,
    target: describeElement(target),
    nearestReaderBlock: describeElement(target?.closest('.reader-block')),
    nearestReaderAction: describeElement(target?.closest('[data-reader-action]')),
    composedPath: typeof event.composedPath === 'function'
      ? event.composedPath().slice(0, 8).map((item) => describeEventPathItem(item))
      : [],
    ...details,
  });
}

function describeEventPathItem(item: EventTarget): Record<string, string | null> | string | null {
  return item instanceof HTMLElement ? describeElement(item) : Object.prototype.toString.call(item);
}

function describeElement(element: Element | null | undefined): Record<string, string | null> | null {
  if (!element) {
    return null;
  }
  const htmlElement = element as HTMLElement;
  return {
    tag: element.tagName.toLowerCase(),
    id: htmlElement.id || null,
    className: typeof htmlElement.className === 'string' ? htmlElement.className : null,
    component: htmlElement.dataset?.component ?? null,
    sectionKey: htmlElement.dataset?.sectionKey ?? null,
    blockId: htmlElement.dataset?.blockId ?? null,
    action: htmlElement.dataset?.action ?? null,
    readerAction: htmlElement.dataset?.readerAction ?? null,
    text: htmlElement.textContent?.replace(/\s+/g, ' ').trim().slice(0, 120) ?? null,
  };
}

function isParagraphStyleToolbarAction(action: string): boolean {
  return action === 'open-paragraph-style-picker' || action === 'close-paragraph-style-picker' || action === 'close-paragraph-style-edit';
}

function isCompactParagraphStylePickerButton(richButton: HTMLElement, toolbar: HTMLElement): boolean {
  if (richButton.closest('.paragraph-style-modal, .paragraph-style-edit-modal')) {
    return false;
  }
  if (richButton.dataset.richAction !== 'text-line-style') {
    return false;
  }
  const label = toolbar.querySelector<HTMLElement>('.text-line-style-toolbar-label');
  return Boolean(label && getComputedStyle(label).display === 'none');
}

function openParagraphStylePicker(toolbar: HTMLElement): void {
  toolbar.classList.add('is-picker-open');
  toolbar.querySelector<HTMLButtonElement>('[data-action="open-paragraph-style-picker"]')?.setAttribute('aria-expanded', 'true');
}

function closeParagraphStylePicker(toolbar: HTMLElement): void {
  toolbar.classList.remove('is-picker-open');
  toolbar.querySelector<HTMLButtonElement>('[data-action="open-paragraph-style-picker"]')?.setAttribute('aria-expanded', 'false');
}

function openParagraphStyleEditor(toolbar: HTMLElement | null, styleName: string): void {
  if (!toolbar) {
    return;
  }
  toolbar.classList.remove('is-picker-open');
  toolbar.classList.add('is-style-edit-open');
  toolbar.querySelector<HTMLButtonElement>('[data-action="open-paragraph-style-picker"]')?.setAttribute('aria-expanded', 'false');
  toolbar.querySelectorAll<HTMLElement>('.paragraph-style-edit-panel').forEach((panel) => {
    panel.hidden = panel.dataset.editStyleName !== styleName;
  });
}

function isPlacementModeAction(action: string): boolean {
  return action === 'place-component'
    || action === 'cancel-component-placement'
    || action === 'toggle-editor-sidebar'
    || action === 'activate-block'
    || action === 'toggle-editor-expandable'
    || action === 'toggle-expandable-editor-panel';
}

function executeActionButton(app: HTMLElement, actionButton: HTMLElement, event: Event | null = null, confirmedRemoveReady = false): boolean {
  const action = actionButton.dataset.action;
  if (!action) {
    logActionExecution(event, 'click-dispatch:execute-action:skip', { skipReason: 'missing-action' });
    return false;
  }

  const handler = actionRegistry[action];
  if (!handler) {
    logActionExecution(event, 'click-dispatch:execute-action:skip', {
      skipReason: 'no-component-action-handler',
      action,
    });
    return false;
  }

  if (requiresRemoveConfirmation(action) && !confirmedRemoveReady) {
    logActionExecution(event, 'click-dispatch:execute-action:confirm-required', { action });
    openRemoveConfirmationModal(() => executeActionButton(app, actionButton, null, true), app);
    return true;
  }

  const sectionKey = getActionSectionKey(actionButton);
  const blockId = actionButton.dataset.blockId ?? '';

  if (action === 'add-top-level-section' || action === 'paste-section') {
    logActionExecution(event, 'click-dispatch:execute-action:handled', {
      action,
      sectionKey,
      blockId,
      targetKind: 'top-level-section',
    });
    handler({ app, actionButton, sectionKey, blockId, section: null, reusableName: null });
    return true;
  }

  if (sectionKey.length === 0) {
    logActionExecution(event, 'click-dispatch:execute-action:skip', {
      skipReason: 'missing-section-key',
      action,
      blockId,
    });
    return false;
  }

  const reusableName = getReusableNameFromSectionKey(sectionKey);
  const section = reusableName ? null : findSectionByKey(state.document.sections, sectionKey);
  if (!section && !reusableName) {
    logActionExecution(event, 'click-dispatch:execute-action:skip', {
      skipReason: 'missing-section',
      action,
      sectionKey,
      blockId,
      reusableName,
    });
    return false;
  }

  const templateHidePath = shouldClearTemplateHideForAction(action)
    ? findSectionPath(state.document.sections, sectionKey)
    : null;
  logActionExecution(event, 'click-dispatch:execute-action:handled', {
    action,
    sectionKey,
    blockId,
    reusableName,
    hasSection: Boolean(section),
    templateHidePathLength: templateHidePath?.length ?? null,
  });
  handler({ app, actionButton, sectionKey, blockId, section, reusableName });
  if (templateHidePath && clearHideIfUnmodifiedForSections(templateHidePath)) {
    getRenderApp()();
  }
  return true;
}

function logActionExecution(event: Event | null, stage: string, details: Record<string, unknown>): void {
  if (event) {
    logClickTrace(event, stage, details);
    return;
  }
  console.debug('[hvy:click-trace]', { stage, ...details });
}

function getActionSectionKey(actionButton: HTMLElement): string {
  const declaredSectionKey = actionButton.dataset.sectionKey ?? '';
  if (actionButton.dataset.action === 'add-block' && actionButton.dataset.insertPlacement) {
    const nearestEditorSection = actionButton.closest<HTMLElement>('[data-editor-section]')?.dataset.editorSection ?? '';
    if (nearestEditorSection && nearestEditorSection !== declaredSectionKey) {
      return nearestEditorSection;
    }
  }
  return declaredSectionKey;
}

function shouldClearTemplateHideForAction(action: string): boolean {
  return !new Set([
    'focus-modal',
    'open-component-meta',
    'start-component-move',
    'start-component-copy',
    'cancel-component-placement',
    'jump-to-reader',
    'toggle-schema',
  ]).has(action);
}

function hasSelectionInside(editable: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection?.rangeCount) {
    return false;
  }
  const range = selection.getRangeAt(0);
  return isRangeInside(editable, range);
}

function isRangeInside(editable: HTMLElement, range: Range): boolean {
  return editable.contains(range.commonAncestorContainer) || range.commonAncestorContainer === editable;
}

function storeCurrentRichSelection(editable: HTMLElement, options: { preserveExistingSelection?: boolean } = {}): RichToolbarSelection | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (!isRangeInside(editable, range)) {
    return null;
  }
  const existing = richToolbarSelections.get(editable);
  if (
    options.preserveExistingSelection &&
    range.collapsed &&
    existing &&
    !existing.range.collapsed &&
    isRangeInside(editable, existing.range)
  ) {
    return existing;
  }
  const clone = range.cloneRange();
  const stored = {
    range: clone,
    anchor: findLinkAnchorForRange(editable, clone),
  };
  richToolbarSelections.set(editable, stored);
  return stored;
}

function restoreRichToolbarSelection(editable: HTMLElement): RichToolbarSelection | null {
  const stored = richToolbarSelections.get(editable);
  if (!stored || !isRangeInside(editable, stored.range)) {
    return null;
  }
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(stored.range);
  return stored;
}

function findLinkAnchorForRange(editable: HTMLElement, range: Range): HTMLAnchorElement | null {
  for (const node of [range.startContainer, range.endContainer, range.commonAncestorContainer]) {
    const element = node instanceof Element ? node : node.parentNode instanceof Element ? node.parentNode : null;
    const anchor = element?.closest<HTMLAnchorElement>('a[href]') ?? null;
    if (anchor && editable.contains(anchor)) {
      return anchor;
    }
  }
  return null;
}

function getRichEditableForButton(app: HTMLElement, richButton: HTMLElement): HTMLElement | null {
  const sectionKey = richButton.dataset.sectionKey;
  const blockId = richButton.dataset.blockId;
  if (!sectionKey || !blockId) {
    return null;
  }
  const richField = richButton.dataset.richField ?? 'block-rich';
  const gridItemId = richButton.dataset.gridItemId;
  const rowIndex = richButton.dataset.rowIndex;
  const columnIndex = richButton.dataset.columnIndex;
  const cellIndex = richButton.dataset.cellIndex;
  const selectorBase = `[data-section-key="${sectionKey}"][data-block-id="${blockId}"][data-field="${richField}"]`;
  const selector = richField === 'table-column' && columnIndex !== undefined
    ? `${selectorBase}[data-column-index="${columnIndex}"]`
    : richField === 'table-cell' && rowIndex !== undefined && cellIndex !== undefined
    ? `${selectorBase}[data-row-index="${rowIndex}"][data-cell-index="${cellIndex}"]`
    : rowIndex
    ? `${selectorBase}[data-row-index="${rowIndex}"]`
    : gridItemId
    ? `${selectorBase}[data-grid-item-id="${gridItemId}"]`
    : selectorBase;
  const localScope = richButton.closest<HTMLElement>('.editor-block, .table-inline-edit-shell');
  const localEditable = localScope?.querySelector<HTMLElement>(selector);
  if (localEditable) {
    return localEditable;
  }
  return app.querySelector<HTMLElement>(selector);
}

function requiresRemoveConfirmation(action: string): boolean {
  return new Set([
    'remove-block',
    'remove-section',
    'remove-subsection',
    'remove-grid-item',
    'remove-table-row',
    'remove-table-column',
    'sqlite-drop-column',
    'image-delete-unused',
    'image-delete-current',
    'carousel-delete-image',
    'remove-component-def',
    'remove-section-def',
  ]).has(action);
}
