import type { JsonObject } from '../../hvy/types';
import type { HvyPluginHookChangeReason } from '../types';
import type { HvyPdfExportRuleRecorder, HvyPdfExportStrategyRule } from '../../pdf-export/types';
import type { VisualDocument } from '../../types';
import type { VisualSection } from '../../editor/types';
import { getAttachment, removeAttachment, setAttachment } from '../../attachments';
import { executeDocumentEditToolByName } from '../../ai-document-edit';
import { executeHvyCliCommandSync, writeHvyVirtualFileSync } from '../../cli-core/commands';
import { resolveBaseComponentFromMeta } from '../../component-defs';
import { createEmptyBlock } from '../../document-factory';
import { parseJsonObjectResponse, parseJsonValueResponse } from '../../llm-tool-loop';
import { serializeDocument } from '../../serialization';
import { syncSortValuesForDocument } from '../../sort-values';
import { state, getRefreshReaderPanels, getRenderApp } from '../../state';
import { clearHideIfUnmodifiedForSectionPath } from '../../template-hide';
import { hasTextFillInMarker } from '../../text-fill-in';
import type { VisualBlock } from '../../editor/types';

// JS-side `doc` runtime exposed to the user's Python script. Every method is
// synchronous from Python's point of view; mutations on the visual document
// trigger a re-render once the script run finishes.
//
// Loose typing on purpose: the stable contract here is "supported sync tool
// name + args dict". Async/LLM/database tools are intentionally not exposed.

export interface ScriptingRuntimeStats {
  toolCalls: number;
  stepsExecuted: number;
  stepBudget: number;
  /** @deprecated Use stepsExecuted. */
  linesExecuted: number;
  logs: string[];
}

export interface ScriptingRuntime {
  doc: ScriptingDocApi;
  stats: ScriptingRuntimeStats;
  step(): string | null;
  markMutated(): void;
  setLineBudget(maxLines: number): void;
}

interface ScriptingDocApi {
  log_json: (valuesJson: string) => void;
  tool: (name: string, args?: unknown) => unknown;
  tool_json: (name: string, argsJson: string) => unknown;
  component: ScriptingComponentApi;
  header: ScriptingHeaderApi;
  attachments: ScriptingAttachmentsApi;
  form: ScriptingFormApi;
  db: ScriptingDbApi;
  json: ScriptingJsonApi;
  time: ScriptingTimeApi;
  export: ScriptingExportApi;
  cli: ScriptingCliApi;
  rerender: () => void;
}

interface ScriptingComponentApi {
  get_text(id: string): string;
  set_text(id: string, text: string): void;
  is_empty(id: string): boolean;
}

interface ScriptingHeaderApi {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  remove(key: string): void;
  keys(): string[];
}

interface ScriptingAttachmentsApi {
  list(): string[];
  read(id: string): Uint8Array | null;
  write(id: string, bytes: Uint8Array | ArrayBuffer | number[], meta?: JsonObject): void;
  remove(id: string): void;
}

export interface ScriptingFormOption {
  label: string;
  value: string;
}

export interface ScriptingFormApi {
  get_value(label: string): unknown;
  set_value(label: string, value: unknown): void;
  get_values(): Record<string, unknown>;
  set_options(label: string, options: ScriptingFormOption[]): void;
  get_options(label: string): ScriptingFormOption[];
  set_error(label: string, message: string): void;
  clear_error(label: string): void;
}

export interface ScriptingDbApi {
  query(sql: string, params?: unknown): Record<string, unknown>[];
  execute(sql: string, params?: unknown): string;
}

export interface ScriptingJsonApi {
  parse(response: string): unknown;
  parse_array(response: string): unknown[];
  parse_object(response: string): JsonObject;
}

export interface ScriptingTimeApi {
  now_iso(): string;
  now_local(): string;
  now_unix_ms(): number;
  today_iso(): string;
}

export interface ScriptingCliApi {
  run(command: string): string;
  write(path: string, content: string): string;
}

export interface ScriptingExportApi {
  hide(idOrTag: string): void;
  include(idOrTag: string): void;
  expand(idOrTag: string): void;
  keep_together(idOrTag: string): void;
  style(idOrTag: string, style: Record<string, unknown>): void;
  strategy(rule: HvyPdfExportStrategyRule | HvyPdfExportStrategyRule[]): void;
}

export interface ScriptingRuntimeOptions {
  maxLines?: number;
  document: VisualDocument;
  previousDocument?: VisualDocument | null;
  changeReason?: HvyPluginHookChangeReason;
  form?: ScriptingFormApi;
  db?: ScriptingDbApi;
  exportRuleRecorder?: HvyPdfExportRuleRecorder;
  now?: () => Date;
  onMutationFlushed?: () => void;
}

function createUnavailableFormApi(): ScriptingFormApi {
  const fail = () => {
    throw new Error('doc.form is only available while running a form plugin script.');
  };
  return {
    get_value: fail,
    set_value: fail,
    get_values: fail,
    set_options: fail,
    get_options: fail,
    set_error: fail,
    clear_error: fail,
  };
}

function createUnavailableDbApi(): ScriptingDbApi {
  const fail = () => {
    throw new Error('doc.db is unavailable because the document database could not be initialized.');
  };
  return {
    query: fail,
    execute: fail,
  };
}

function createUnavailableExportApi(): ScriptingExportApi {
  const fail = () => {
    throw new Error('doc.export is only available while running a PDF export prep script.');
  };
  return {
    hide: fail,
    include: fail,
    expand: fail,
    keep_together: fail,
    style: fail,
    strategy: fail,
  };
}

function createExportApi(recorder: HvyPdfExportRuleRecorder): ScriptingExportApi {
  return {
    hide: (idOrTag) => recorder.hide(String(idOrTag)),
    include: (idOrTag) => recorder.include(String(idOrTag)),
    expand: (idOrTag) => recorder.expand(String(idOrTag)),
    keep_together: (idOrTag) => recorder.keep_together(String(idOrTag)),
    style: (idOrTag, style) => recorder.style(String(idOrTag), normalizeScriptObject(style)),
    strategy: (rule) => recorder.strategy(normalizeExportRuleInput(rule)),
  };
}

function throwJsonParseError(result: unknown): never {
  const message = result && typeof result === 'object' && 'message' in result
    ? (result as { message?: unknown }).message
    : undefined;
  throw new Error(typeof message === 'string' ? message : 'Invalid JSON response.');
}

function addJsonObjectHelpers(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(addJsonObjectHelpers);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const record = value as Record<string, unknown>;
  for (const [key, item] of Object.entries(record)) {
    record[key] = addJsonObjectHelpers(item);
  }
  Object.defineProperty(record, 'get', {
    value: (key: unknown, defaultValue: unknown = null) => (
      Object.prototype.hasOwnProperty.call(record, String(key)) ? record[String(key)] : defaultValue
    ),
    enumerable: false,
    configurable: true,
  });
  return record;
}

function createJsonApi(): ScriptingJsonApi {
  return {
    parse: (response) => {
      const result = parseJsonValueResponse(String(response ?? ''));
      return result.ok ? addJsonObjectHelpers(result.value) : throwJsonParseError(result);
    },
    parse_array: (response) => {
      const result = parseJsonValueResponse(String(response ?? ''));
      if (!result.ok) {
        return throwJsonParseError(result);
      }
      if (!Array.isArray(result.value)) {
        throw new Error('Return exactly one JSON array.');
      }
      return addJsonObjectHelpers(result.value) as unknown[];
    },
    parse_object: (response) => {
      const result = parseJsonObjectResponse(String(response ?? ''));
      return result.ok ? addJsonObjectHelpers(result.value) as JsonObject : throwJsonParseError(result);
    },
  };
}

function createTimeApi(now: () => Date): ScriptingTimeApi {
  return {
    now_iso: () => now().toISOString(),
    now_local: () => formatLocalDateTime(now()),
    now_unix_ms: () => now().getTime(),
    today_iso: () => formatLocalDate(now()),
  };
}

function formatLocalDateTime(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}

function formatLocalDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function createScriptingRuntime(options: ScriptingRuntimeOptions): ScriptingRuntime {
  const stats: ScriptingRuntimeStats = { toolCalls: 0, stepsExecuted: 0, stepBudget: options.maxLines ?? 100_000, linesExecuted: 0, logs: [] };
  let mutated = false;

  const onMutation = () => {
    mutated = true;
  };
  const recordLog = (...values: unknown[]) => {
    if (stats.logs.length >= 200) {
      if (stats.logs.at(-1) !== '[log limit reached]') {
        stats.logs.push('[log limit reached]');
      }
      return;
    }
    stats.logs.push(values.map(formatScriptLogValue).join(' '));
  };

  const flushIfMutated = () => {
    if (!mutated) return;
    mutated = false;
    syncSortValuesForDocument(options.document);
    if (state?.document === options.document) {
      state.rawEditorText = serializeDocument(options.document);
      state.rawEditorError = null;
      state.rawEditorDiagnostics = [];
    }
    try {
      getRefreshReaderPanels()();
    } catch {
      // Reader panel may not be initialized yet (during pre-first-render execution).
    }
    try {
      getRenderApp()();
    } catch {
      // renderApp may not be ready yet during the very first load.
    }
    options.onMutationFlushed?.();
  };

  const doc: ScriptingDocApi = {
    log_json: (valuesJson) => {
      const parsed = JSON.parse(String(valuesJson || '[]')) as unknown;
      recordLog(...(Array.isArray(parsed) ? parsed : [parsed]));
    },
    tool: (name, args) => {
      stats.toolCalls += 1;
      if (name === 'get_updated_components') {
        if (options.changeReason === 'load') {
          return [];
        }
        return getUpdatedScriptingComponentHandles(
          options.document,
          options.previousDocument ?? null,
          String(readScriptValue(args, 'component') ?? ''),
          onMutation
        );
      }
      if (name === 'get_components') {
        return getScriptingComponentHandles(options.document, String(readScriptValue(args, 'component') ?? ''), onMutation);
      }
      const result = executeDocumentEditToolByName(name, normalizeScriptObject(args), options.document, onMutation);
      return result;
    },
    tool_json: (name, argsJson) => {
      const parsed = JSON.parse(String(argsJson || '{}')) as Record<string, unknown>;
      return doc.tool(name, parsed);
    },
    component: {
      get_text: (id) => findComponentBySchemaId(options.document, String(id ?? ''))?.block.text ?? '',
      set_text: (id, text) => {
        const entry = findComponentBySchemaId(options.document, String(id ?? ''));
        if (!entry) {
          throw new Error(`Component "${String(id ?? '')}" was not found.`);
        }
        const { block, sectionKey } = entry;
        block.text = String(text ?? '');
        block.schema.fillIn = hasTextFillInMarker(block.text);
        clearHideIfUnmodifiedForSectionPath(options.document.sections, sectionKey);
        mutated = true;
      },
      is_empty: (id) => {
        const block = findComponentBySchemaId(options.document, String(id ?? ''))?.block ?? null;
        return !block || block.text.trim().length === 0 || /<!--\s*value\s*-->/.test(block.text);
      },
    },
    header: {
      get: (key) => options.document.meta[key],
      set: (key, value) => {
        (options.document.meta as Record<string, unknown>)[key] = value as never;
        mutated = true;
      },
      remove: (key) => {
        if (key in options.document.meta) {
          delete (options.document.meta as Record<string, unknown>)[key];
          mutated = true;
        }
      },
      keys: () => Object.keys(options.document.meta),
    },
    attachments: {
      list: () => options.document.attachments.map((entry) => entry.id),
      read: (id) => {
        const attachment = getAttachment(options.document, id);
        return attachment ? Uint8Array.from(attachment.bytes) : null;
      },
      write: (id, bytes, meta) => {
        const previous = getAttachment(options.document, id);
        const normalized =
          bytes instanceof Uint8Array
            ? Uint8Array.from(bytes)
            : bytes instanceof ArrayBuffer
              ? new Uint8Array(bytes)
              : Uint8Array.from(bytes as number[]);
        setAttachment(
          options.document,
          id,
          { ...(previous?.meta ?? {}), ...(meta ?? {}) },
          normalized
        );
        mutated = true;
      },
      remove: (id) => {
        if (getAttachment(options.document, id)) {
          removeAttachment(options.document, id);
          mutated = true;
        }
      },
    },
    form: options.form ?? createUnavailableFormApi(),
    db: options.db ?? createUnavailableDbApi(),
    json: createJsonApi(),
    time: createTimeApi(options.now ?? (() => new Date())),
    export: options.exportRuleRecorder ? createExportApi(options.exportRuleRecorder) : createUnavailableExportApi(),
    cli: {
      run: (command) => {
        stats.toolCalls += 1;
        const result = executeHvyCliCommandSync(options.document, command);
        if (result.mutated) {
          mutated = true;
        }
        return result.output;
      },
      write: (path, content) => {
        stats.toolCalls += 1;
        const result = writeHvyVirtualFileSync(options.document, String(path ?? ''), String(content ?? ''));
        if (result.mutated) {
          mutated = true;
        }
        return result.output;
      },
    },
    rerender: flushIfMutated,
  };

  // Bind only when state is initialized to avoid throwing during tests that
  // don't construct a full app.
  if (state && state.document === options.document) {
    // doc already references state.document via the closure.
  }

  return {
    doc,
    stats,
    step: () => {
      stats.stepsExecuted += 1;
      stats.linesExecuted = stats.stepsExecuted;
      if (stats.stepsExecuted > stats.stepBudget) {
        return `Scripting plugin exceeded its step budget (${stats.stepBudget}). Add fewer steps or raise the budget.`;
      }
      return null;
    },
    markMutated: onMutation,
    setLineBudget: (maxLines: number) => {
      stats.stepBudget = Math.max(1, Math.floor(maxLines));
    },
  };
}

function formatScriptLogValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || typeof value === 'undefined') {
    return String(value);
  }
  try {
    const rendered = JSON.stringify(value);
    return rendered.length > 2000 ? `${rendered.slice(0, 2000)}...` : rendered;
  } catch {
    return String(value);
  }
}

interface ScriptingComponentEntry {
  block: VisualBlock;
  sectionKey: string;
}

function findComponentBySchemaId(document: VisualDocument, id: string): ScriptingComponentEntry | null {
  const targetId = id.trim();
  if (!targetId) {
    return null;
  }
  for (const section of document.sections) {
    const found = findComponentBySchemaIdInSection(section, targetId);
    if (found) {
      return found;
    }
  }
  return null;
}

function findComponentBySchemaIdInSection(section: VisualSection, id: string): ScriptingComponentEntry | null {
  const found = findComponentBySchemaIdInBlocks(section.blocks, id);
  if (found) {
    return { block: found, sectionKey: section.key };
  }
  for (const child of section.children) {
    const childFound = findComponentBySchemaIdInSection(child, id);
    if (childFound) {
      return childFound;
    }
  }
  return null;
}

function findComponentBySchemaIdInBlocks(
  blocks: VisualBlock[],
  id: string,
  seen = new Set<VisualBlock>()
): VisualBlock | null {
  for (const block of blocks) {
    if (seen.has(block)) {
      continue;
    }
    seen.add(block);
    if (block.schema.id.trim() === id) {
      return block;
    }
    const nested = [
      ...(block.schema.containerBlocks ?? []),
      ...(block.schema.componentListBlocks ?? []),
      ...((block.schema.gridItems ?? []).map((item) => item.block)),
      ...(block.schema.expandableStubBlocks?.children ?? []),
      ...(block.schema.expandableContentBlocks?.children ?? []),
    ];
    const found = findComponentBySchemaIdInBlocks(nested, id, seen);
    if (found) {
      return found;
    }
  }
  return null;
}

interface ScriptingBlockLocation {
  block: VisualBlock;
  section: VisualSection;
  ancestors: VisualBlock[];
}

class ScriptingComponentHandle {
  id: string;
  component: string;
  base_component: string;
  section_id: string;
  section_title: string;
  removed: boolean;

  constructor(
    private document: VisualDocument,
    private location: ScriptingBlockLocation,
    private markMutated: () => void,
    removed = false
  ) {
    this.id = location.block.schema.id;
    this.component = location.block.schema.component;
    this.base_component = resolveBaseComponentFromMeta(location.block.schema.component, document.meta);
    this.section_id = location.section.customId || location.section.key;
    this.section_title = location.section.title;
    this.removed = removed;
  }

  get(name: string): unknown {
    if (name === 'text') return this.location.block.text;
    if (name in this.location.block.schema) {
      return this.location.block.schema[name as keyof typeof this.location.block.schema];
    }
    return undefined;
  }

  set(name: string, value: unknown): void {
    if (name === 'text') {
      this.location.block.text = String(value ?? '');
      this.markMutated();
      return;
    }
    if (name in this.location.block.schema) {
      (this.location.block.schema as unknown as Record<string, unknown>)[name] = value;
      this.markMutated();
    }
  }

  has_tag(tag: string): boolean {
    return hasTag(this.location.block.schema.tags, tag);
  }

  get_parent_by_tag(tag: string): ScriptingComponentHandle | ScriptingSectionHandle | null {
    for (const ancestor of [...this.location.ancestors].reverse()) {
      if (hasTag(ancestor.schema.tags, tag)) {
        return new ScriptingComponentHandle(this.document, { ...this.location, block: ancestor }, this.markMutated, this.removed);
      }
    }
    return hasTag(this.location.section.tags, tag)
      ? new ScriptingSectionHandle(this.location.section)
      : null;
  }

  get_ancestor_record(excluded_tags = ''): ScriptingComponentHandle | null {
    const excluded = excluded_tags.split(/\s+/).filter(Boolean);
    for (const ancestor of [...this.location.ancestors].reverse()) {
      if (!ancestor.schema.id || !/-record$/.test(ancestor.schema.component)) {
        continue;
      }
      if (excluded.some((tag) => hasTag(ancestor.schema.tags, tag))) {
        continue;
      }
      return new ScriptingComponentHandle(this.document, { ...this.location, block: ancestor }, this.markMutated, this.removed);
    }
    return null;
  }

  first_table_cell(index = 0): string {
    return findFirstTableCell(this.location.block, Math.max(0, Math.floor(Number(index) || 0)));
  }

  fingerprint(): string {
    return JSON.stringify({
      text: this.location.block.text,
      schema: this.location.block.schema,
    });
  }

  remove_children_by_tag(tag: string, slot = 'expandable-content'): number {
    const children = getChildSlot(this.location.block, slot);
    const before = children.length;
    for (let index = children.length - 1; index >= 0; index -= 1) {
      if (hasTag(children[index]!.schema.tags, tag)) {
        children.splice(index, 1);
      }
    }
    const removed = before - children.length;
    if (removed > 0) {
      this.markMutated();
    }
    return removed;
  }

  append_child(component: string, config?: unknown, text = '', slot = 'expandable-content'): ScriptingComponentHandle {
    const child = createEmptyBlock(String(component || 'text'), true, this.document.meta);
    child.text = String(text ?? '');
    if (config && typeof config === 'object') {
      applyBlockConfig(child, config);
    }
    const children = getChildSlot(this.location.block, slot);
    children.push(child);
    this.markMutated();
    return new ScriptingComponentHandle(this.document, {
      block: child,
      section: this.location.section,
      ancestors: [...this.location.ancestors, this.location.block],
    }, this.markMutated);
  }
}

class ScriptingSectionHandle {
  id: string;
  component = 'section';
  base_component = 'section';
  section_id: string;
  section_title: string;

  constructor(private section: VisualSection) {
    this.id = section.customId || section.key;
    this.section_id = this.id;
    this.section_title = section.title;
  }

  get(name: string): unknown {
    if (name === 'title') return this.section.title;
    if (name in this.section) {
      return this.section[name as keyof VisualSection];
    }
    return undefined;
  }

  has_tag(tag: string): boolean {
    return hasTag(this.section.tags, tag);
  }
}

function getScriptingComponentHandles(
  document: VisualDocument,
  component: string,
  markMutated: () => void,
  removed = false
): ScriptingComponentHandle[] {
  const query = component.trim();
  const matches: ScriptingComponentHandle[] = [];
  const visit = (blocks: VisualBlock[], section: VisualSection, ancestors: VisualBlock[]): void => {
    for (const block of blocks) {
      const base = resolveBaseComponentFromMeta(block.schema.component, document.meta);
      if (!query || block.schema.component === query || base === query || (query === 'xref' && base === 'xref-card')) {
        matches.push(new ScriptingComponentHandle(document, { block, section, ancestors }, markMutated, removed));
      }
      const nextAncestors = [...ancestors, block];
      visit(block.schema.containerBlocks ?? [], section, nextAncestors);
      visit(block.schema.componentListBlocks ?? [], section, nextAncestors);
      visit((block.schema.gridItems ?? []).map((item) => item.block), section, nextAncestors);
      visit(block.schema.expandableStubBlocks?.children ?? [], section, nextAncestors);
      visit(block.schema.expandableContentBlocks?.children ?? [], section, nextAncestors);
    }
  };
  const visitSection = (section: VisualSection): void => {
    visit(section.blocks, section, []);
    section.children.forEach(visitSection);
  };
  document.sections.forEach(visitSection);
  return matches;
}

function getUpdatedScriptingComponentHandles(
  document: VisualDocument,
  previousDocument: VisualDocument | null,
  component: string,
  markMutated: () => void
): ScriptingComponentHandle[] {
  const current = getScriptingComponentHandles(document, component, markMutated);
  if (!previousDocument) {
    return current;
  }
  const previous = getScriptingComponentHandles(previousDocument, component, () => {}, true);
  const previousById = new Map(previous.map((handle) => [handle.id, handle]));
  const currentIds = new Set(current.map((handle) => handle.id).filter(Boolean));
  const updated = current.filter((handle) => {
    if (!handle.id) {
      return true;
    }
    const previousHandle = previousById.get(handle.id);
    return !previousHandle || previousHandle.fingerprint() !== handle.fingerprint();
  });
  const removed = previous.filter((handle) => handle.id && !currentIds.has(handle.id));
  return [...updated, ...removed];
}

function getChildSlot(block: VisualBlock, slot: string): VisualBlock[] {
  if (slot === 'component-list') return block.schema.componentListBlocks;
  if (slot === 'container') return block.schema.containerBlocks;
  if (slot === 'expandable-stub') return block.schema.expandableStubBlocks.children;
  return block.schema.expandableContentBlocks.children;
}

function applyBlockConfig(block: VisualBlock, config: unknown): void {
  for (const [key, value] of Object.entries(normalizeScriptObject(config))) {
    if (key === 'text') {
      block.text = String(value ?? '');
    } else if (key in block.schema) {
      (block.schema as unknown as Record<string, unknown>)[key] = value;
    }
  }
}

function readScriptValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  if (Object.prototype.hasOwnProperty.call(value, key)) {
    return (value as Record<string, unknown>)[key];
  }
  const direct = (value as Record<string, unknown>)[key];
  if (typeof direct !== 'undefined') {
    return direct;
  }
  const candidate = value as {
    get?: (key: string) => unknown;
    __getitem__?: (key: string) => unknown;
  };
  if (typeof candidate.get === 'function') {
    try {
      return candidate.get(key);
    } catch {
      // Some Brython objects expose JS-looking methods that are not callable
      // for plain string keys.
    }
  }
  if (typeof candidate.__getitem__ === 'function') {
    try {
      return candidate.__getitem__(key);
    } catch {
      // Missing keys are simply treated as absent.
    }
  }
  return undefined;
}

function normalizeScriptObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 0) {
    return Object.fromEntries(entries);
  }
  const candidate = value as { items?: () => unknown };
  if (typeof candidate.items !== 'function') {
    return {};
  }
  try {
    const result: Record<string, unknown> = {};
    for (const item of Array.from(candidate.items() as Iterable<unknown>)) {
      if (Array.isArray(item) && item.length >= 2) {
        result[String(item[0])] = item[1];
      }
    }
    return result;
  } catch {
    return {};
  }
}

function normalizeExportRuleInput(rule: unknown): HvyPdfExportStrategyRule | HvyPdfExportStrategyRule[] {
  if (Array.isArray(rule)) {
    return rule.map((entry) => normalizeScriptObject(entry) as HvyPdfExportStrategyRule);
  }
  return normalizeScriptObject(rule) as HvyPdfExportStrategyRule;
}

function findFirstTableCell(block: VisualBlock, index: number): string {
  if (block.schema.component === 'table') {
    return block.schema.tableRows[0]?.cells[index] ?? '';
  }
  const nested = [
    ...(block.schema.containerBlocks ?? []),
    ...(block.schema.componentListBlocks ?? []),
    ...((block.schema.gridItems ?? []).map((item) => item.block)),
    ...(block.schema.expandableStubBlocks?.children ?? []),
    ...(block.schema.expandableContentBlocks?.children ?? []),
  ];
  for (const child of nested) {
    const value = findFirstTableCell(child, index);
    if (value) return value;
  }
  return '';
}

function hasTag(value: string, tag: string): boolean {
  return value.split(/\s+/).includes(tag);
}
