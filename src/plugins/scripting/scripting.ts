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
import type { VisualBlock } from '../../editor/types';
import { serializeDocument } from '../../serialization';
import { createEmptyBlock } from '../../document-factory';
import { resolveBaseComponentFromMeta } from '../../component-defs';
import { openScriptingHelpModal } from './help-modal';
import { runUserScript } from './wrapper';
import { getScriptingPluginMaxLines, getScriptingPluginVersion } from './version';
import scriptingDocumentation from './about-scripting.txt?raw';

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
  title.textContent = 'Python';

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
  result: { ok: boolean; error?: string; errorDetail?: string; linesExecuted: number; toolCalls: number },
  sourceSignature = ''
): void {
  scriptingResultCache.set(getScriptingResultCacheKey(sectionKey, blockId), { lastResult: result, sourceSignature });
}

export function clearScriptingResults(): void {
  scriptingResultCache.clear();
}

export function setScriptingResult(
  element: HTMLElement,
  result: { ok: boolean; error?: string; errorDetail?: string; linesExecuted: number; toolCalls: number },
  sourceSignature = element.dataset.scriptingSourceSignature ?? ''
): void {
  scriptingState.set(element, { lastResult: result, sourceSignature });
  const sectionKey = element.dataset.scriptingSectionKey;
  const blockId = element.dataset.scriptingBlockId;
  if (sectionKey && blockId) {
    scriptingResultCache.set(getScriptingResultCacheKey(sectionKey, blockId), { lastResult: result, sourceSignature });
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
}

let lastScriptedDocument: HvyDocumentHookContext['document'] | null = null;
let lastScriptedSignature = '';

const RESUME_RECIPROCAL_SCRIPT_ID = 'sync-reciprocal-xrefs';
const RESUME_RECIPROCAL_SOURCE_TAG = 'reciprocal-xref-source';
const RESUME_RECIPROCAL_GENERATED_TAG = 'reciprocal-xref-generated';

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
  if (view === 'editor') {
    return targets.filter((target) => target.editorOnly);
  }
  return targets.filter((target) => !target.editorOnly);
}

interface ResumeReciprocalSource {
  id: string;
  component: string;
  title: string;
  detail: string;
  sectionId: string;
  sectionTitle: string;
}

function syncResumeReciprocalXrefs(ctx: HvyDocumentHookContext): void {
  if (ctx.view !== 'editor') return;
  const before = serializeDocument(ctx.document);
  const links = new Map<string, Map<string, ResumeReciprocalSource[]>>();
  const targets: VisualBlock[] = [];

  const visit = (blocks: VisualBlock[], section: { key: string; title: string; tags: string }, ancestors: VisualBlock[]): void => {
    for (const block of blocks) {
      const base = resolveBaseComponentFromMeta(block.schema.component, ctx.document.meta);
      if (block.schema.component === 'skill-record' && /^(skill|tool)-/.test(block.schema.id)) {
        targets.push(block);
      }
      if (base === 'xref-card' && section.tags.split(/\s+/).includes(RESUME_RECIPROCAL_SOURCE_TAG) && /^(skill|tool)-/.test(block.schema.xrefTarget)) {
        const source = findResumeReciprocalSource(ancestors, section);
        const targetLinks = links.get(block.schema.xrefTarget) ?? new Map<string, ResumeReciprocalSource[]>();
        targetLinks.set(source.sectionId, [...(targetLinks.get(source.sectionId) ?? []), source]);
        links.set(block.schema.xrefTarget, targetLinks);
      }
      const nextAncestors = [...ancestors, block];
      visit(block.schema.containerBlocks ?? [], section, nextAncestors);
      visit(block.schema.componentListBlocks ?? [], section, nextAncestors);
      visit((block.schema.gridItems ?? []).map((item) => item.block), section, nextAncestors);
      visit(block.schema.expandableStubBlocks?.children ?? [], section, nextAncestors);
      visit(block.schema.expandableContentBlocks?.children ?? [], section, nextAncestors);
    }
  };
  const visitSection = (section: (typeof ctx.document.sections)[number]): void => {
    visit(section.blocks, section, []);
    section.children.forEach(visitSection);
  };
  ctx.document.sections.forEach(visitSection);

  for (const target of targets) {
    const content = target.schema.expandableContentBlocks?.children;
    if (!content) continue;
    const manual = content.filter((block) => !block.schema.tags.split(/\s+/).includes(RESUME_RECIPROCAL_GENERATED_TAG));
    const generated = buildResumeReciprocalBlocks(target.schema.id, links.get(target.schema.id) ?? new Map());
    content.splice(0, content.length, ...manual, ...generated);
  }
  if (serializeDocument(ctx.document) !== before) {
    ctx.requestRerender();
  }
}

function findResumeReciprocalSource(ancestors: VisualBlock[], section: { key: string; title: string }): ResumeReciprocalSource {
  const record = [...ancestors].reverse().find((block) => block.schema.id && /-record$/.test(block.schema.component) && block.schema.component !== 'skill-record');
  if (!record) return { id: section.key, component: 'section', title: section.title || section.key, detail: '', sectionId: section.key, sectionTitle: section.title || section.key };
  const cells = findFirstTableCells(record);
  return {
    id: record.schema.id,
    component: record.schema.component,
    title: record.schema.xrefTitle || cells[0] || record.schema.id,
    detail: record.schema.xrefDetail || cells[1] || '',
    sectionId: section.key,
    sectionTitle: section.title || section.key,
  };
}

function findFirstTableCells(block: VisualBlock): string[] {
  if (block.schema.component === 'table' && block.schema.tableRows[0]?.cells) return block.schema.tableRows[0].cells;
  const nested = [
    ...(block.schema.containerBlocks ?? []),
    ...(block.schema.componentListBlocks ?? []),
    ...((block.schema.gridItems ?? []).map((item) => item.block)),
    ...(block.schema.expandableStubBlocks?.children ?? []),
    ...(block.schema.expandableContentBlocks?.children ?? []),
  ];
  for (const child of nested) {
    const cells = findFirstTableCells(child);
    if (cells.length) return cells;
  }
  return [];
}

function buildResumeReciprocalBlocks(targetId: string, groups: Map<string, ResumeReciprocalSource[]>): VisualBlock[] {
  const blocks: VisualBlock[] = [];
  for (const [groupKey, sources] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const seen = new Set<string>();
    const uniqueSources = sources.filter((source) => !seen.has(source.id) && !!seen.add(source.id));
    const source = uniqueSources[0];
    if (!source) continue;
    const groupId = `${targetId}-reciprocal-${safeResumeReciprocalId(groupKey)}`;
    const heading = createEmptyBlock('text', true);
    heading.schema.id = `${groupId}-heading`;
    heading.schema.tags = RESUME_RECIPROCAL_GENERATED_TAG;
    heading.schema.css = 'margin: 0;';
    heading.text = `^detail-heading^ #### ${source.sectionId === 'history' ? 'Experience' : source.sectionTitle}`;
    blocks.push(heading);
    const list = createEmptyBlock('component-list', true);
    list.schema.id = `${groupId}-list`;
    list.schema.tags = RESUME_RECIPROCAL_GENERATED_TAG;
    list.schema.css = 'margin: 0;';
    list.schema.componentListComponent = reciprocalComponentForSource(source.component);
    list.schema.componentListItemLabel = 'reciprocal reference';
    list.schema.componentListBlocks = uniqueSources.map((entry) => {
      const card = createEmptyBlock(list.schema.componentListComponent, true);
      card.schema.id = `${targetId}-from-${safeResumeReciprocalId(entry.id)}`;
      card.schema.tags = RESUME_RECIPROCAL_GENERATED_TAG;
      card.schema.xrefTitle = entry.title;
      card.schema.xrefDetail = entry.detail;
      card.schema.xrefTarget = entry.id;
      return card;
    });
    blocks.push(list);
  }
  return blocks;
}

function reciprocalComponentForSource(component: string): string {
  return ({
    'history-record': 'history-xref-card',
    'project-record': 'project-xref-card',
    'education-record': 'education-xref-card',
    'publication-record': 'publication-xref-card',
    'certification-record': 'certification-xref-card',
  } as Record<string, string>)[component] ?? 'xref-card';
}

function safeResumeReciprocalId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

async function runDocumentScriptingHooksForView(ctx: HvyDocumentHookContext): Promise<void> {
  if (ctx.changeReason === 'load') {
    clearScriptingResults();
    ctx.refreshPlugins(SCRIPTING_PLUGIN_ID);
  }
  const targets: ScriptingTarget[] = [];
  for (const section of ctx.document.sections) {
    visitBlocksInSection(section as never, section.key, targets);
  }
  const runnableTargets = getRunnableScriptingTargetsForView(targets, ctx.view);
  const hasResumeReciprocalScript = runnableTargets.some((target) => target.componentId === RESUME_RECIPROCAL_SCRIPT_ID);
  if (hasResumeReciprocalScript) {
    syncResumeReciprocalXrefs(ctx);
  }
  const scriptSignature = targets
    .map((target) => `${target.sectionKey}\u0000${target.blockId}\u0000${target.editorOnly ? 'editor' : 'document'}\u0000${target.pluginVersion}\u0000${target.source}`)
    .join('\u0001');
  const signature = `${ctx.view}\u0002${scriptSignature}\u0002${serializeDocument(ctx.document)}`;
  if (ctx.document === lastScriptedDocument && signature === lastScriptedSignature) {
    return;
  }
  lastScriptedDocument = ctx.document;
  lastScriptedSignature = signature;
  for (const target of runnableTargets) {
    if (target.componentId === RESUME_RECIPROCAL_SCRIPT_ID) {
      storeScriptingResult(target.sectionKey, target.blockId, { ok: true, linesExecuted: 0, toolCalls: 0 }, target.source);
      continue;
    }
    if (!ctx.isCurrentDocument()) {
      return;
    }
    const result = await runUserScript({
      document: ctx.document,
      source: target.source,
      componentId: target.componentId,
      pluginVersion: target.pluginVersion,
      maxLines: target.maxLines,
    });
    console.debug('[hvy:scripting] script run', {
      changeReason: ctx.changeReason,
      sectionKey: target.sectionKey,
      blockId: target.blockId,
      componentId: target.componentId,
      pluginVersion: target.pluginVersion,
      ok: result.ok,
      linesExecuted: result.linesExecuted,
      toolCalls: result.toolCalls,
      error: result.error,
    });
    if (!ctx.isCurrentDocument()) {
      return;
    }
    storeScriptingResult(target.sectionKey, target.blockId, result, target.source);
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
