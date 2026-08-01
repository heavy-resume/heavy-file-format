import './editable-text.css';

import { createBuiltInPluginMetadata, EDITABLE_TEXT_PLUGIN_ID } from '../registry';
import type { HvyPlugin, HvyPluginContext, HvyPluginFactory, HvyPluginInstance } from '../types';
import editableTextDocumentation from './editable-text.about.txt?raw';

const EDITABLE_TEXT_PLACEHOLDER = 'Write here.';

function build(ctx: HvyPluginContext): HvyPluginInstance {
  const root = document.createElement('div');
  root.className = `hvy-editable-text hvy-editable-text-${ctx.mode}`;

  const editor = ctx.textEditor.mount({
    value: ctx.block.text,
    placeholder: readPlaceholder(ctx),
    includeAlign: true,
    disabled: true,
    onChange(markdown) {
      if (isViewerEditable(root, ctx)) {
        ctx.setText(markdown);
      }
    },
  });

  root.append(editor.element);

  const syncState = (): void => {
    editor.setDisabled(!isViewerEditable(root, ctx));
  };
  window.setTimeout(syncState, 0);

  return {
    element: root,
    refresh() {
      syncState();
      editor.setValue(ctx.block.text);
    },
    unmount() {
      editor.unmount();
    },
  };
}

function readPlaceholder(ctx: HvyPluginContext): string {
  const placeholder = ctx.block.schema.pluginConfig.placeholder;
  return typeof placeholder === 'string' && placeholder.trim() ? placeholder : EDITABLE_TEXT_PLACEHOLDER;
}

function isViewerEditable(root: HTMLElement, ctx: HvyPluginContext): boolean {
  return ctx.mode === 'reader' && !root.closest('#editorTree, .editor-block-passive, .editor-shell');
}

export const editableTextPluginFactory: HvyPluginFactory = build;

export const editableTextPlugin: HvyPlugin = {
  ...createBuiltInPluginMetadata(EDITABLE_TEXT_PLUGIN_ID),
  displayName: 'Editable Text',
  documentation: {
    filename: 'about-editable-text.txt',
    text: editableTextDocumentation,
  },
  aiHint: 'Editable Text plugin. Rich Markdown in plugin.txt remains visibly editable in viewer mode.',
  aiHelp: [
    `Use \`<!--hvy:plugin {"plugin":"${EDITABLE_TEXT_PLUGIN_ID}","pluginConfig":{"placeholder":"Write here."}}-->\` followed by Markdown in the component body.`,
    'Store the editable Markdown in plugin.txt. The optional placeholder config is shown while it is empty.',
  ].join(' '),
  create: editableTextPluginFactory,
};
