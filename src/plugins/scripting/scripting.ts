import type {
  HvyPluginContext,
  HvyPluginFactory,
  HvyPluginInstance,
  HvyPluginRegistration,
} from '../types';
import { SCRIPTING_PLUGIN_ID } from '../registry';
import { openScriptingHelpModal } from './help-modal';

import './scripting.css';

interface EditorHandles {
  textarea: HTMLTextAreaElement;
  status: HTMLDivElement;
}

function buildEditorDom(ctx: HvyPluginContext): { root: HTMLDivElement; handles: EditorHandles } {
  const root = document.createElement('div');
  root.className = 'hvy-scripting-editor code-editor-shell';

  const head = document.createElement('div');
  head.className = 'hvy-scripting-head code-editor-head';

  const title = document.createElement('strong');
  title.className = 'hvy-scripting-title';
  title.textContent = 'Python (Brython)';

  const helpButton = document.createElement('button');
  helpButton.type = 'button';
  helpButton.className = 'ghost hvy-scripting-help-button';
  helpButton.textContent = 'Help';
  helpButton.addEventListener('click', () => {
    openScriptingHelpModal();
  });

  head.appendChild(title);
  head.appendChild(helpButton);

  const textarea = document.createElement('textarea');
  textarea.className = 'code-editor hvy-scripting-textarea';
  textarea.dataset.field = 'block-code';
  textarea.dataset.sectionKey = ctx.sectionKey;
  textarea.dataset.blockId = ctx.block.id;
  textarea.spellcheck = false;
  textarea.placeholder = '# Python — runs on document load. Press Help for the API.';

  const status = document.createElement('div');
  status.className = 'hvy-scripting-status';

  root.appendChild(head);
  root.appendChild(textarea);
  root.appendChild(status);

  return { root, handles: { textarea, status } };
}

interface ScriptingState {
  lastResult: { ok: boolean; error?: string; linesExecuted: number; toolCalls: number } | null;
}

const scriptingState = new WeakMap<HTMLElement, ScriptingState>();

export function setScriptingResult(
  element: HTMLElement,
  result: { ok: boolean; error?: string; linesExecuted: number; toolCalls: number }
): void {
  scriptingState.set(element, { lastResult: result });
  const status = element.querySelector<HTMLDivElement>('.hvy-scripting-status');
  if (!status) return;
  if (result.ok) {
    status.textContent = `Executed ${result.linesExecuted} line${result.linesExecuted === 1 ? '' : 's'}, ${result.toolCalls} tool call${result.toolCalls === 1 ? '' : 's'}.`;
    status.classList.remove('hvy-scripting-status-error');
    status.classList.add('hvy-scripting-status-ok');
  } else {
    status.textContent = `Error: ${result.error ?? 'unknown error'}`;
    status.classList.remove('hvy-scripting-status-ok');
    status.classList.add('hvy-scripting-status-error');
  }
}

function build(ctx: HvyPluginContext): HvyPluginInstance {
  const root = document.createElement('div');
  root.className = `hvy-scripting hvy-scripting-${ctx.mode}`;
  root.dataset.scriptingMount = 'true';
  root.dataset.scriptingSectionKey = ctx.sectionKey;
  root.dataset.scriptingBlockId = ctx.block.id;

  if (ctx.mode === 'reader') {
    // Scripts have no visible reader output. Their effect on the document
    // happens at load time. Render nothing.
    return {
      element: root,
      refresh: () => {},
    };
  }

  const { root: editorRoot, handles } = buildEditorDom(ctx);
  root.appendChild(editorRoot);

  const sync = () => {
    const active = document.activeElement;
    if (handles.textarea !== active && handles.textarea.value !== ctx.block.text) {
      handles.textarea.value = ctx.block.text;
    }
    const cached = scriptingState.get(root);
    if (cached?.lastResult) {
      setScriptingResult(root, cached.lastResult);
    }
  };

  sync();

  return {
    element: root,
    refresh: sync,
  };
}

export const scriptingPluginFactory: HvyPluginFactory = build;

export const scriptingPluginRegistration: HvyPluginRegistration = {
  id: SCRIPTING_PLUGIN_ID,
  displayName: 'Scripting',
  create: scriptingPluginFactory,
};

export function findScriptingMounts(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-scripting-mount="true"]'));
}
