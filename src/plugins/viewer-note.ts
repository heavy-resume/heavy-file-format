import './viewer-note.css';

import { VIEWER_NOTE_PLUGIN_ID } from './registry';
import type { HvyPlugin, HvyPluginContext, HvyPluginFactory, HvyPluginInstance } from './types';
import viewerNoteDocumentation from './viewer-note.about.txt?raw';

const VIEWER_NOTE_PLACEHOLDER = 'Write a note.';

function build(ctx: HvyPluginContext): HvyPluginInstance {
  const root = document.createElement('div');
  root.className = `hvy-viewer-note hvy-viewer-note-${ctx.mode}`;

  const frame = document.createElement('div');
  frame.className = 'hvy-viewer-note-frame';

  const heading = document.createElement('p');
  heading.className = 'hvy-viewer-note-heading';
  heading.textContent = 'Note';

  const editor = ctx.textEditor.mount({
    value: ctx.block.text,
    placeholder: VIEWER_NOTE_PLACEHOLDER,
    includeAlign: true,
    disabled: true,
    onChange(markdown) {
      if (!isViewerNoteEditable(root, ctx)) {
        return;
      }
      ctx.setText(markdown);
    },
  });

  frame.append(heading, editor.element);
  root.append(frame);

  const syncDisabledState = (): void => {
    editor.setDisabled(!isViewerNoteEditable(root, ctx));
  };
  window.setTimeout(syncDisabledState, 0);

  return {
    element: root,
    refresh() {
      syncDisabledState();
      editor.setValue(ctx.block.text);
    },
    unmount() {
      editor.unmount();
    },
  };
}

function isViewerNoteEditable(root: HTMLElement, ctx: HvyPluginContext): boolean {
  return ctx.mode === 'reader' && !root.closest('#editorTree, .editor-block-passive, .editor-shell');
}

export const viewerNotePluginFactory: HvyPluginFactory = build;

export const viewerNotePlugin: HvyPlugin = {
  id: VIEWER_NOTE_PLUGIN_ID,
  displayName: 'Viewer Note',
  documentation: {
    filename: 'about-viewer-note.txt',
    text: viewerNoteDocumentation,
  },
  aiHint: 'Viewer Note plugin. Editable Markdown lives in plugin.txt and remains editable in viewer mode.',
  aiHelp: [
    `Use \`<!--hvy:plugin {"plugin":"${VIEWER_NOTE_PLUGIN_ID}"}-->\` followed by Markdown in the component body.`,
    'Store the note Markdown in plugin.txt. No pluginConfig fields are required.',
  ].join(' '),
  create: viewerNotePluginFactory,
};

/** @deprecated Use viewerNotePlugin. */
export const viewerNotePluginRegistration = viewerNotePlugin;
