import {
  applyRichAction,
  handleRichEditorBeforeInput,
  handleRichEditorCopy,
  handleRichEditorKeydown,
  handleRichEditorKeyup,
  refreshRichToolbarState,
} from '../block-ops';
import { markdownToEditorHtml, normalizeEditorMarkdownWhitespace, normalizeMarkdownLists, removeNonTextContentFromRichEditor, turndown } from '../markdown';
import { getCachedComponentRenderHelpers } from '../state';
import type { HvyPluginTextEditorInstance, HvyPluginTextEditorMountOptions } from './types';

let pluginTextEditorId = 0;

export function mountPluginTextEditor(options: HvyPluginTextEditorMountOptions): HvyPluginTextEditorInstance {
  const ownerDocument = document;
  const id = `plugin-text-editor-${pluginTextEditorId += 1}`;
  const shell = ownerDocument.createElement('div');
  shell.className = 'text-editor-shell hvy-plugin-text-editor';
  const toolbarSlot = ownerDocument.createElement('div');
  toolbarSlot.className = 'text-editor-toolbar-slot';
  const editable = ownerDocument.createElement('div');
  editable.className = 'rich-editor';
  editable.contentEditable = 'true';
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
  shell.append(toolbarSlot, editable);

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
  };

  const writeEditable = (markdown: string): void => {
    editable.innerHTML = markdownToEditorHtml(markdown, {
      textLineStyles: getCachedComponentRenderHelpers().getTextLineStyles?.() ?? {},
      textLineStyleMode: 'editor',
    });
  };

  const readMarkdown = (): string => {
    removeNonTextContentFromRichEditor(editable);
    return normalizeMarkdownLists(normalizeEditorMarkdownWhitespace(turndown.turndown(editable.innerHTML)));
  };

  const syncChange = (): void => {
    options.onChange(readMarkdown());
    refreshRichToolbarState(editable);
  };

  const onBeforeInput = (event: Event): void => {
    if (handleRichEditorBeforeInput(event as InputEvent, editable)) {
      event.preventDefault();
    }
  };
  const onCopy = (event: Event): void => {
    handleRichEditorCopy(event as ClipboardEvent, editable);
  };
  const onInput = (): void => syncChange();
  const onKeydown = (event: KeyboardEvent): void => {
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
    handleRichEditorKeyup(editable);
    refreshRichToolbarState(editable);
  };
  const onToolbarClick = (event: Event): void => {
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
    applyRichAction(action, editable, value);
    syncChange();
    editable.focus({ preventScroll: true });
  };

  writeToolbar(options.value);
  writeEditable(options.value);
  shell.addEventListener('click', onToolbarClick);
  editable.addEventListener('beforeinput', onBeforeInput);
  editable.addEventListener('copy', onCopy);
  editable.addEventListener('input', onInput);
  editable.addEventListener('keydown', onKeydown);
  editable.addEventListener('keyup', onKeyup);

  return {
    element: shell,
    editable,
    getValue: readMarkdown,
    setValue(markdown: string) {
      writeToolbar(markdown);
      if (ownerDocument.activeElement !== editable && !editable.contains(ownerDocument.activeElement)) {
        writeEditable(markdown);
      }
    },
    focus() {
      editable.focus();
    },
    unmount() {
      shell.removeEventListener('click', onToolbarClick);
      editable.removeEventListener('beforeinput', onBeforeInput);
      editable.removeEventListener('copy', onCopy);
      editable.removeEventListener('input', onInput);
      editable.removeEventListener('keydown', onKeydown);
      editable.removeEventListener('keyup', onKeyup);
      shell.remove();
    },
  };
}
