import {
  applyRichAction,
  handleRichEditorBeforeInput,
  handleRichEditorCopy,
  handleRichEditorKeydown,
  handleRichEditorKeyup,
  updateRichCodeBlockLanguageInput,
  refreshRichToolbarState,
} from '../block-ops';
import { getRichEditorSerializableHtml, markdownToEditorHtml, normalizeEditorMarkdownWhitespace, normalizeMarkdownLists, removeNonTextContentFromRichEditor, turndown } from '../markdown';
import { getCachedComponentRenderHelpers } from '../state';
import { syncTextToolbarLayout } from '../editor/components/text/text-toolbar-layout';
import type { HvyPluginTextEditorInstance, HvyPluginTextEditorMountOptions } from './types';

import '../editor/components/text/text.css';

let pluginTextEditorId = 0;

export function mountPluginTextEditor(options: HvyPluginTextEditorMountOptions): HvyPluginTextEditorInstance {
  const ownerDocument = document;
  const id = `plugin-text-editor-${pluginTextEditorId += 1}`;
  let disabled = options.disabled === true;
  let savedSelection: Range | null = null;
  const shell = ownerDocument.createElement('div');
  shell.className = 'text-editor-shell hvy-plugin-text-editor';
  const toolbarBounds = ownerDocument.createElement('div');
  toolbarBounds.className = 'text-editor-toolbar-bounds';
  const toolbarSlot = ownerDocument.createElement('div');
  toolbarSlot.className = 'text-editor-toolbar-slot';
  const toolbarSpacer = ownerDocument.createElement('div');
  toolbarSpacer.className = 'text-editor-toolbar-spacer';
  const editable = ownerDocument.createElement('div');
  editable.className = 'rich-editor';
  editable.contentEditable = disabled ? 'false' : 'true';
  editable.spellcheck = true;
  editable.dataset.field = 'hvy-plugin-text-editor';
  editable.dataset.sectionKey = `__plugin_text_editor_${id}`;
  editable.dataset.blockId = id;
  if (options.placeholder) {
    editable.dataset.placeholder = options.placeholder;
  }
  if (options.align && options.align !== 'left') {
    editable.style.textAlign = options.align;
  }
  toolbarBounds.append(toolbarSlot);
  shell.append(toolbarBounds, toolbarSpacer, editable);

  const syncDisabledState = (): void => {
    shell.classList.toggle('is-disabled', disabled);
    shell.dataset.disabled = disabled ? 'true' : 'false';
    editable.contentEditable = disabled ? 'false' : 'true';
    editable.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    editable.tabIndex = disabled ? -1 : 0;
    toolbarSlot.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
      button.disabled = disabled;
      button.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    });
  };

  const writeToolbar = (markdown: string): void => {
    const helpers = getCachedComponentRenderHelpers();
    toolbarSlot.innerHTML = helpers.renderRichToolbar(`__plugin_text_editor_${id}`, id, {
      field: 'hvy-plugin-text-editor',
      includeAlign: options.includeAlign === true,
      includeFillIn: options.includeFillIn === true,
      align: options.align ?? 'left',
      currentMarkdown: markdown,
      textLineStyles: helpers.getTextLineStyles?.() ?? {},
    });
    syncDisabledState();
    syncTextToolbarLayout(shell);
  };

  const writeEditable = (markdown: string): void => {
    editable.innerHTML = markdownToEditorHtml(markdown, {
      textLineStyles: getCachedComponentRenderHelpers().getTextLineStyles?.() ?? {},
      textLineStyleMode: 'editor',
    });
  };

  const readMarkdown = (): string => {
    removeNonTextContentFromRichEditor(editable);
    return normalizeMarkdownLists(normalizeEditorMarkdownWhitespace(turndown.turndown(getRichEditorSerializableHtml(editable))));
  };

  const syncChange = (target?: EventTarget | null): void => {
    if (disabled) {
      return;
    }
    updateRichCodeBlockLanguageInput(target ?? null);
    options.onChange(readMarkdown());
    refreshRichToolbarState(editable);
  };

  const hasSelectionInsideEditable = (): boolean => {
    const selection = ownerDocument.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return false;
    }
    const range = selection.getRangeAt(0);
    return editable.contains(range.commonAncestorContainer);
  };

  const storeSelection = (): void => {
    const selection = ownerDocument.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return;
    }
    const range = selection.getRangeAt(0);
    if (!editable.contains(range.commonAncestorContainer)) {
      return;
    }
    savedSelection = range.cloneRange();
  };

  const restoreSelection = (): void => {
    if (!savedSelection) {
      return;
    }
    const selection = ownerDocument.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(savedSelection.cloneRange());
  };

  const onBeforeInput = (event: Event): void => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    if (handleRichEditorBeforeInput(event as InputEvent, editable)) {
      event.preventDefault();
    }
  };
  const onCopy = (event: Event): void => {
    handleRichEditorCopy(event as ClipboardEvent, editable);
  };
  const onInput = (event: Event): void => syncChange(event.target);
  const onKeydown = (event: KeyboardEvent): void => {
    if (disabled) {
      return;
    }
    if (handleRichEditorKeydown(event, editable)) {
      return;
    }
    const meta = event.metaKey || event.ctrlKey;
    if (!meta) {
      return;
    }
    const key = event.key.toLowerCase();
    if (key === 'b' || key === 'i' || key === 'u') {
      event.preventDefault();
      applyRichAction(key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline', editable);
    }
  };
  const onKeyup = (): void => {
    if (disabled) {
      return;
    }
    handleRichEditorKeyup(editable);
    storeSelection();
    refreshRichToolbarState(editable);
  };
  const onMouseup = (): void => {
    if (!disabled) {
      storeSelection();
    }
  };
  const onToolbarMouseDown = (event: Event): void => {
    if (disabled) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest<HTMLElement>('[data-rich-action], [data-action]');
    if (!button || !shell.contains(button)) {
      return;
    }
    if (hasSelectionInsideEditable()) {
      storeSelection();
    }
    event.preventDefault();
  };
  const onToolbarClick = (event: Event): void => {
    if (disabled) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest<HTMLElement>('[data-rich-action], [data-action]');
    if (!button || !shell.contains(button)) {
      return;
    }
    event.stopPropagation();
    const paragraphToolbar = button.closest<HTMLElement>('.paragraph-style-toolbar');
    if (button.dataset.action === 'open-paragraph-style-picker') {
      paragraphToolbar?.classList.add('is-picker-open');
      button.setAttribute('aria-expanded', 'true');
      event.preventDefault();
      return;
    }
    if (button.dataset.action === 'close-paragraph-style-picker') {
      paragraphToolbar?.classList.remove('is-picker-open');
      paragraphToolbar?.querySelector<HTMLElement>('[data-action="open-paragraph-style-picker"]')?.setAttribute('aria-expanded', 'false');
      event.preventDefault();
      return;
    }
    const action = button.dataset.richAction;
    if (!action) {
      return;
    }
    event.preventDefault();
    const value = action === 'text-line-style' ? button.dataset.textLineStyleName ?? '' : undefined;
    restoreSelection();
    applyRichAction(action, editable, value);
    syncChange();
    editable.focus({ preventScroll: true });
  };

  writeToolbar(options.value);
  writeEditable(options.value);
  syncDisabledState();
  shell.addEventListener('mousedown', onToolbarMouseDown);
  shell.addEventListener('click', onToolbarClick);
  editable.addEventListener('beforeinput', onBeforeInput);
  editable.addEventListener('copy', onCopy);
  editable.addEventListener('input', onInput);
  editable.addEventListener('keydown', onKeydown);
  editable.addEventListener('keyup', onKeyup);
  editable.addEventListener('mouseup', onMouseup);

  return {
    element: shell,
    editable,
    getValue: readMarkdown,
    setValue(markdown: string) {
      writeToolbar(markdown);
      if (disabled || (ownerDocument.activeElement !== editable && !editable.contains(ownerDocument.activeElement))) {
        writeEditable(markdown);
      }
    },
    setDisabled(nextDisabled: boolean) {
      disabled = nextDisabled;
      syncDisabledState();
    },
    focus() {
      if (!disabled) {
        editable.focus();
      }
    },
    unmount() {
      shell.removeEventListener('mousedown', onToolbarMouseDown);
      shell.removeEventListener('click', onToolbarClick);
      editable.removeEventListener('beforeinput', onBeforeInput);
      editable.removeEventListener('copy', onCopy);
      editable.removeEventListener('input', onInput);
      editable.removeEventListener('keydown', onKeydown);
      editable.removeEventListener('keyup', onKeyup);
      editable.removeEventListener('mouseup', onMouseup);
      shell.remove();
    },
  };
}
