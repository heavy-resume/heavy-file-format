import type {
  HvyDocumentHookContext,
  HvyPlugin,
  HvyPluginContext,
  HvyPluginFactory,
  HvyPluginInstance,
} from '../types';
import { SCRIPTING_PLUGIN_ID } from '../registry';
import { visitBlocksInList } from '../../section-ops';
import type { JsonObject } from '../../hvy/types';
import { deserializeDocument, serializeDocument } from '../../serialization';
import { openScriptingHelpModal } from './help-modal';
import { runUserScript, SCRIPTING_LIBRARY_OPTIONS, type ScriptingLibraryName } from './wrapper';
import { getScriptingPluginMaxLines, getScriptingPluginVersion } from './version';
import scriptingDocumentation from './about-scripting.txt?raw';

import './scripting.css';

interface EditorHandles {
  textarea: HTMLTextAreaElement;
  status: HTMLDivElement;
  logDetail: HTMLPreElement;
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
  title.textContent = 'Python';

  const helpButton = document.createElement('button');
  helpButton.type = 'button';
  helpButton.className = 'ghost hvy-scripting-help-button';
  helpButton.textContent = 'Help';
  helpButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openScriptingHelpModal(helpButton);
  });

  const headActions = document.createElement('div');
  headActions.className = 'hvy-scripting-head-actions';
  if (ctx.block.schema.editorOnly) {
    const editorScriptLabel = document.createElement('span');
    editorScriptLabel.className = 'hvy-scripting-editor-script-label';
    editorScriptLabel.textContent = 'editor script';
    headActions.appendChild(editorScriptLabel);
  }
  headActions.appendChild(helpButton);

  head.appendChild(title);
  head.appendChild(headActions);

  const textarea = document.createElement('textarea');
  textarea.className = 'code-editor hvy-scripting-textarea';
  textarea.dataset.field = 'block-code';
  textarea.dataset.sectionKey = ctx.sectionKey;
  textarea.dataset.blockId = ctx.block.id;
  textarea.spellcheck = false;
  textarea.placeholder = '# Python — runs on document load. Press Help for the API.';

  const status = document.createElement('div');
  status.className = 'hvy-scripting-status';

  const logDetail = document.createElement('pre');
  logDetail.className = 'hvy-scripting-log-detail';

  root.appendChild(head);
  root.appendChild(textarea);
  root.appendChild(status);
  root.appendChild(logDetail);

  return { root, handles: { textarea, status, logDetail } };
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
  lastResult: { ok: boolean; error?: string; errorDetail?: string; stepsExecuted: number; stepBudget: number; linesExecuted?: number; toolCalls: number; logs?: string[] } | null;
  sourceSignature: string;
}

const scriptingState = new WeakMap<HTMLElement, ScriptingState>();
const scriptingResultCache = new Map<string, ScriptingState>();

function getScriptingResultCacheKey(sectionKey: string, blockId: string): string {
  return `${sectionKey}|${blockId}`;
}

export function storeScriptingResult(
  sectionKey: string,
  blockId: string,
  result: { ok: boolean; error?: string; errorDetail?: string; stepsExecuted: number; stepBudget: number; linesExecuted?: number; toolCalls: number; logs?: string[] },
  sourceSignature = ''
): void {
  scriptingResultCache.set(getScriptingResultCacheKey(sectionKey, blockId), { lastResult: result, sourceSignature });
}

export function clearScriptingResults(): void {
  scriptingResultCache.clear();
}

export function setScriptingResult(
  element: HTMLElement,
  result: { ok: boolean; error?: string; errorDetail?: string; stepsExecuted: number; stepBudget: number; linesExecuted?: number; toolCalls: number; logs?: string[] },
  sourceSignature = element.dataset.scriptingSourceSignature ?? ''
): void {
  scriptingState.set(element, { lastResult: result, sourceSignature });
  const sectionKey = element.dataset.scriptingSectionKey;
  const blockId = element.dataset.scriptingBlockId;
  if (sectionKey && blockId) {
    scriptingResultCache.set(getScriptingResultCacheKey(sectionKey, blockId), { lastResult: result, sourceSignature });
  }
  const status = element.querySelector<HTMLDivElement>('.hvy-scripting-status');
  const logs = result.logs ?? [];
  if (status) {
    if (result.ok) {
      const logSuffix = logs.length > 0 ? `, ${logs.length} log${logs.length === 1 ? '' : 's'}` : '';
      const toolSuffix = result.toolCalls > 0 ? ` with ${result.toolCalls} tool call${result.toolCalls === 1 ? '' : 's'}` : '';
      status.textContent = `Script ran ${result.stepsExecuted.toLocaleString()}/${result.stepBudget.toLocaleString()} steps${toolSuffix}${logSuffix}.`;
      status.classList.remove('hvy-scripting-status-error');
      status.classList.add('hvy-scripting-status-ok');
    } else {
      status.textContent = `Error: ${result.error ?? 'unknown error'}`;
      status.classList.remove('hvy-scripting-status-ok');
      status.classList.add('hvy-scripting-status-error');
    }
  }
  const logDetail = element.querySelector<HTMLPreElement>('.hvy-scripting-log-detail');
  if (logDetail) {
    if (logs.length > 0) {
      logDetail.textContent = logs.map((entry, index) => `${index + 1}: ${entry}`).join('\n');
      logDetail.classList.add('is-visible');
    } else {
      logDetail.textContent = '';
      logDetail.classList.remove('is-visible');
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
      const logText = logs.length > 0 ? `Logs:\n${logs.map((entry, index) => `${index + 1}: ${entry}`).join('\n')}\n\n` : '';
      readerDetail.textContent = `${logText}${result.errorDetail ?? result.error ?? 'unknown error'}`;
    }
  }
}

function build(ctx: HvyPluginContext): HvyPluginInstance {
  const root = document.createElement('div');
  root.className = `hvy-scripting hvy-scripting-${ctx.mode}`;
  root.dataset.scriptingMount = 'true';
  root.dataset.scriptingSectionKey = ctx.sectionKey;
  root.dataset.scriptingBlockId = ctx.block.id;
  root.dataset.scriptingSourceSignature = ctx.block.text;

  if (ctx.mode === 'reader') {
    const { root: readerRoot } = buildReaderDom();
    root.appendChild(readerRoot);
    return {
      element: root,
      refresh: () => {
        const cached = getFreshScriptingResult(root, ctx.sectionKey, ctx.block.id, ctx.block.text);
        if (cached?.lastResult) {
          setScriptingResult(root, cached.lastResult);
        }
      },
    };
  }

  const { root: editorRoot, handles } = buildEditorDom(ctx);
  root.appendChild(editorRoot);

  const sync = () => {
    root.dataset.scriptingSourceSignature = ctx.block.text;
    const active = document.activeElement;
    if (handles.textarea !== active && handles.textarea.value !== ctx.block.text) {
      handles.textarea.value = ctx.block.text;
    }
    const cached = getFreshScriptingResult(root, ctx.sectionKey, ctx.block.id, ctx.block.text);
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

interface ScriptingTarget {
  sectionKey: string;
  blockId: string;
  source: string;
  editorOnly: boolean;
  pluginVersion: string;
  maxLines?: number;
  componentId: string;
  libraries: ScriptingLibraryName[];
}

let lastScriptedDocument: HvyDocumentHookContext['document'] | null = null;
let lastScriptedSignature = '';
let lastScriptedDocumentSnapshot = '';

function getScriptingPluginLibraries(pluginConfig: JsonObject | null | undefined): ScriptingLibraryName[] {
  const raw = Array.isArray(pluginConfig?.libraries) ? pluginConfig.libraries : [];
  const allowed = new Set(SCRIPTING_LIBRARY_OPTIONS);
  return raw.filter((item): item is ScriptingLibraryName => typeof item === 'string' && allowed.has(item as ScriptingLibraryName));
}

function visitBlocksInSection(
  section: { key: string; blocks: Array<{ id: string; text: string; schema: { id?: string; component: string; plugin: string; pluginConfig?: JsonObject } }>; children: unknown[] },
  sectionKey: string,
  out: ScriptingTarget[]
): void {
  visitBlocksInList(section.blocks as never, (block) => {
    if (block.schema.component === 'plugin' && block.schema.plugin === SCRIPTING_PLUGIN_ID) {
      out.push({
        sectionKey,
        blockId: block.id,
        source: block.text ?? '',
        editorOnly: block.schema.editorOnly === true,
        componentId: typeof block.schema.id === 'string' ? block.schema.id : '',
        pluginVersion: getScriptingPluginVersion(block.schema.pluginConfig),
        maxLines: getScriptingPluginMaxLines(block.schema.pluginConfig),
        libraries: getScriptingPluginLibraries(block.schema.pluginConfig),
      });
    }
  });
  for (const child of section.children as Array<typeof section>) {
    visitBlocksInSection(child, child.key, out);
  }
}

export function getRunnableScriptingTargetsForView(
  targets: ScriptingTarget[],
  view: HvyDocumentHookContext['view']
): ScriptingTarget[] {
  if (view === 'editor' || view === 'ai') {
    return targets.filter((target) => target.editorOnly);
  }
  return targets.filter((target) => !target.editorOnly);
}

async function runDocumentScriptingHooksForView(ctx: HvyDocumentHookContext): Promise<void> {
  if (ctx.changeReason === 'load') {
    clearScriptingResults();
    lastScriptedDocumentSnapshot = '';
    ctx.refreshPlugins(SCRIPTING_PLUGIN_ID);
  }
  const targets: ScriptingTarget[] = [];
  for (const section of ctx.document.sections) {
    visitBlocksInSection(section as never, section.key, targets);
  }
  const runnableTargets = getRunnableScriptingTargetsForView(targets, ctx.view);
  const scriptSignature = targets
    .map((target) => `${target.sectionKey}\u0000${target.blockId}\u0000${target.editorOnly ? 'editor' : 'document'}\u0000${target.pluginVersion}\u0000${target.libraries.join(',')}\u0000${target.source}`)
    .join('\u0001');
  const signature = `${ctx.view}\u0002${scriptSignature}\u0002${serializeDocument(ctx.document)}`;
  if (ctx.document === lastScriptedDocument && signature === lastScriptedSignature) {
    return;
  }
  const previousDocument = ctx.document === lastScriptedDocument && lastScriptedDocumentSnapshot
    ? deserializeDocument(lastScriptedDocumentSnapshot, ctx.document.extension)
    : null;
  lastScriptedDocument = ctx.document;
  lastScriptedSignature = signature;
  for (const target of runnableTargets) {
    if (!ctx.isCurrentDocument()) {
      return;
    }
    const result = await runUserScript({
      document: ctx.document,
      previousDocument,
      source: target.source,
      componentId: target.componentId,
      pluginVersion: target.pluginVersion,
      maxLines: target.maxLines,
      changeReason: ctx.changeReason,
      libraries: target.libraries,
    });
    console.debug('[hvy:scripting] script run', {
      changeReason: ctx.changeReason,
      sectionKey: target.sectionKey,
      blockId: target.blockId,
      componentId: target.componentId,
      pluginVersion: target.pluginVersion,
      ok: result.ok,
      stepsExecuted: result.stepsExecuted,
      stepBudget: result.stepBudget,
      toolCalls: result.toolCalls,
      error: result.error,
    });
    if (!ctx.isCurrentDocument()) {
      return;
    }
    storeScriptingResult(target.sectionKey, target.blockId, result, target.source);
  }
  if (ctx.isCurrentDocument()) {
    lastScriptedDocumentSnapshot = serializeDocument(ctx.document);
  }
  ctx.refreshPlugins(SCRIPTING_PLUGIN_ID);
}

const scriptingDocumentHook = {
  priority: 0,
  run: runDocumentScriptingHooksForView,
};

export const scriptingPlugin: HvyPlugin = {
  id: SCRIPTING_PLUGIN_ID,
  displayName: 'Scripting',
  documentation: {
    filename: 'about-scripting.txt',
    text: scriptingDocumentation,
  },
  aiHint: 'Script-backed component. Executable source is exposed as script.py.',
  aiHelp: [
    `Use \`<!--hvy:plugin {"plugin":"${SCRIPTING_PLUGIN_ID}","pluginConfig":{"version":"0.1"}}-->\`.`,
    'Put executable script source in the component body.',
    'Scripts run as Python/Brython code wrapped in a generated function with a `doc` global, so `return` can stop the script early.',
    'Use `pluginConfig.libraries` to enable checked sandbox libraries such as `random`, `re`, and `datetime` before the script runs.',
    'Use `pluginConfig.maxSteps` to configure the runtime step budget.',
    'Use the `doc` API for host capabilities: document tools through `doc.tool.TOOL_NAME(**args)`, header helpers, attachment helpers, and plugin-provided APIs.',
    'Use this only when the user explicitly needs a script-backed component.',
  ].join(' '),
  create: scriptingPluginFactory,
  hooks: {
    documentLoad: scriptingDocumentHook,
    documentChange: scriptingDocumentHook,
  },
};

/** @deprecated Use scriptingPlugin. */
export const scriptingPluginRegistration = scriptingPlugin;

function getFreshScriptingResult(
  element: HTMLElement,
  sectionKey: string,
  blockId: string,
  sourceSignature: string
): ScriptingState | null {
  const existing = scriptingState.get(element)
    ?? scriptingResultCache.get(getScriptingResultCacheKey(sectionKey, blockId))
    ?? null;
  if (!existing || existing.sourceSignature !== sourceSignature) {
    return null;
  }
  return existing;
}

export function findScriptingMounts(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-scripting-mount="true"]'));
}
