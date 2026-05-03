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

interface ReaderHandles {
  shell: HTMLDivElement;
  summary: HTMLDivElement;
  detail: HTMLPreElement;
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

function buildReaderDom(): { root: HTMLDivElement; handles: ReaderHandles } {
  const root = document.createElement('div');
  root.className = 'hvy-scripting-reader-shell';

  const summary = document.createElement('div');
  summary.className = 'hvy-scripting-reader-summary';

  const detail = document.createElement('pre');
  detail.className = 'hvy-scripting-error-detail';

  root.appendChild(summary);
  root.appendChild(detail);

  return {
    root,
    handles: {
      shell: root,
      summary,
      detail,
    },
  };
}

interface ScriptingState {
  lastResult: { ok: boolean; error?: string; errorDetail?: string; linesExecuted: number; toolCalls: number } | null;
}

const scriptingState = new WeakMap<HTMLElement, ScriptingState>();
const scriptingResultCache = new Map<string, ScriptingState['lastResult']>();

function getScriptingResultCacheKey(sectionKey: string, blockId: string): string {
  return `${sectionKey}|${blockId}`;
}

export function setScriptingResult(
  element: HTMLElement,
  result: { ok: boolean; error?: string; errorDetail?: string; linesExecuted: number; toolCalls: number }
): void {
  scriptingState.set(element, { lastResult: result });
  const sectionKey = element.dataset.scriptingSectionKey;
  const blockId = element.dataset.scriptingBlockId;
  if (sectionKey && blockId) {
    scriptingResultCache.set(getScriptingResultCacheKey(sectionKey, blockId), result);
  }
  const status = element.querySelector<HTMLDivElement>('.hvy-scripting-status');
  if (status) {
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

  const readerShell = element.querySelector<HTMLDivElement>('.hvy-scripting-reader-shell');
  const readerSummary = element.querySelector<HTMLDivElement>('.hvy-scripting-reader-summary');
  const readerDetail = element.querySelector<HTMLPreElement>('.hvy-scripting-error-detail');
  if (readerShell && readerSummary && readerDetail) {
    if (result.ok) {
      readerShell.classList.remove('is-visible');
      readerSummary.textContent = '';
      readerDetail.textContent = '';
    } else {
      readerShell.classList.add('is-visible');
      readerSummary.textContent = `Script error: ${result.error ?? 'unknown error'}`;
      readerDetail.textContent = result.errorDetail ?? result.error ?? 'unknown error';
    }
  }
}

function build(ctx: HvyPluginContext): HvyPluginInstance {
  const root = document.createElement('div');
  root.className = `hvy-scripting hvy-scripting-${ctx.mode}`;
  root.dataset.scriptingMount = 'true';
  root.dataset.scriptingSectionKey = ctx.sectionKey;
  root.dataset.scriptingBlockId = ctx.block.id;

  if (ctx.mode === 'reader') {
    const { root: readerRoot } = buildReaderDom();
    root.appendChild(readerRoot);
    return {
      element: root,
      refresh: () => {
        const cached =
          scriptingState.get(root) ?? {
            lastResult: scriptingResultCache.get(getScriptingResultCacheKey(ctx.sectionKey, ctx.block.id)) ?? null,
          };
        if (cached?.lastResult) {
          setScriptingResult(root, cached.lastResult);
        }
      },
    };
  }

  const { root: editorRoot, handles } = buildEditorDom(ctx);
  root.appendChild(editorRoot);

  const sync = () => {
    const active = document.activeElement;
    if (handles.textarea !== active && handles.textarea.value !== ctx.block.text) {
      handles.textarea.value = ctx.block.text;
    }
    const cached =
      scriptingState.get(root) ?? {
        lastResult: scriptingResultCache.get(getScriptingResultCacheKey(ctx.sectionKey, ctx.block.id)) ?? null,
      };
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
  aiHint: 'Script-backed component. Executable source lives in the body.',
  aiHelp: [
    `Use \`<!--hvy:plugin {"plugin":"${SCRIPTING_PLUGIN_ID}","pluginConfig":{"version":"0.1"}}-->\`.`,
    'Put executable script source in the component body.',
    'Scripts run as top-level Python/Brython code with a `doc` global. Top-level `return` is a syntax error, though `return` is fine inside helper functions you define.',
    'Use the `doc` API for host capabilities: document tools through `doc.tool(name, args)`, header helpers, attachment helpers, and plugin-provided APIs.',
    'Use this only when the user explicitly needs a script-backed component.',
  ].join(' '),
  create: scriptingPluginFactory,
};

export function findScriptingMounts(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-scripting-mount="true"]'));
}
