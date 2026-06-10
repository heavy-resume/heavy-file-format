import type { JsonObject } from '../hvy/types';
import type { VisualBlock } from '../editor/types';
import type { DocumentAttachment, ReusableTemplateModalState, VisualDocument } from '../types';
import type { ReusableTemplateVariableType } from '../reusable-template-values';

// A plugin owns the DOM element it returns. The host treats it as opaque.
// Plugins style themselves using the standard CSS theme variables; nothing is
// enforced.
//
// Configuration is split between two slots and the plugin chooses which to use:
//   - block.schema.pluginConfig — structured JSON (numbers, booleans, enums).
//   - block.text — free text the plugin parses itself (templated strings, etc.).
// Both round-trip through HVY serialization untouched.

export interface HvyPluginDocumentApi {
  getHvy(): string;
}

export interface HvyPluginAttachmentsApi {
  list(): DocumentAttachment[];
  get(id: string): DocumentAttachment | null;
  set(id: string, meta: JsonObject, bytes: Uint8Array): void;
  remove(id: string): void;
}

export interface HvyPluginHeaderApi {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export interface HvyPluginEditorContext {
  mode: 'view' | 'edit';
  // Conventional levels: 0 = hidden/compact, 1 = basic, 2 = advanced.
  detailLevel: number;
}

export interface HvyPluginContext {
  mode: 'editor' | 'reader';
  editor: HvyPluginEditorContext;
  sectionKey: string;
  block: VisualBlock;
  document: HvyPluginDocumentApi;
  attachments: HvyPluginAttachmentsApi;
  header: HvyPluginHeaderApi;
  // Raw document — exposed so plugins like db-table that already integrate
  // deeply with the visual document tree can do so. Most plugins should not
  // reach for this and use the typed APIs above instead.
  rawDocument: VisualDocument;
  // Persist a config field. Updates block.schema.pluginConfig, refreshes this
  // plugin instance in place, and refreshes reader panels. It must not force a
  // full app re-render on ordinary typing because that drops focus/caret state.
  setConfig(patch: JsonObject): void;
  // Persist plugin-interpreted text (block.text), refreshing this plugin
  // instance in place and reader panels without a full app re-render.
  setText(text: string): void;
  // Persist block-level presentation CSS for plugin-owned controls such as
  // size/alignment presets, refreshing this plugin instance and reader panels.
  setCss(css: string): void;
  // Ask the host to re-render. Use sparingly for structural shell changes only;
  // setConfig/setText already refresh the mounted plugin and reader panels.
  requestRerender(): void;
}

export interface HvyPluginInstance {
  element: HTMLElement;
  // Optional refresh hook. Called by the host on every re-render pass when the
  // instance is reused, so the plugin can reflect external state changes
  // (config mutated by AI tools, attachments updated, etc.). Plugins are
  // responsible for preserving focus / cursor state if they replace DOM here.
  refresh?(): void;
  // Optional cleanup hook. Called when the host detects the mount placeholder
  // is gone (block deleted, plugin swapped, document unloaded). Plugins should
  // free any retained resources here. May be omitted if there is nothing to
  // free.
  unmount?(): void;
}

export type HvyPluginFactory = (ctx: HvyPluginContext) => HvyPluginInstance;

export interface HvyPluginComponentDefinition {
  id?: string;
  displayName?: string;
  create: HvyPluginFactory;
}

export interface HvyOutputGeneratorRequest {
  document: VisualDocument;
  component: string;
  variable: string;
  variableType: ReusableTemplateVariableType;
  label: string;
  values: Record<string, string>;
  target: ReusableTemplateModalState['target'];
}

export interface HvyOutputGeneratorResponse {
  answer?: string;
  prompt?: string;
  responseInstructions?: string;
  inputCharLimit?: number;
  outputCharLimit?: number;
}

export interface HvyOutputGenerator {
  key: string;
  label?: string;
  requiredVariables?: string[];
  generate(request: HvyOutputGeneratorRequest): Promise<HvyOutputGeneratorResponse> | HvyOutputGeneratorResponse;
}

export interface HvyPluginPdfStaticRenderContext {
  sectionKey: string;
  block: VisualBlock;
  document: HvyPluginDocumentApi;
  attachments: HvyPluginAttachmentsApi;
  header: HvyPluginHeaderApi;
  rawDocument: VisualDocument;
}

export interface HvyPluginPdfStaticRenderResult {
  blocks?: VisualBlock[];
  block?: VisualBlock;
}

export interface HvyPluginPdfCapability {
  // Return static HVY blocks that the normal PDF renderer already knows how to
  // render. Plugins may update attachments in the context before returning
  // image/carousel blocks that point at those static assets.
  renderStatic(ctx: HvyPluginPdfStaticRenderContext): Promise<HvyPluginPdfStaticRenderResult | VisualBlock[] | VisualBlock | null | undefined> | HvyPluginPdfStaticRenderResult | VisualBlock[] | VisualBlock | null | undefined;
}

export type HvyPluginHookChangeReason = 'load' | 'edit' | 'raw-edit' | 'ai-edit' | 'plugin-edit' | 'unknown';

export interface HvyDocumentHookContext {
  document: VisualDocument;
  view: 'editor' | 'viewer' | 'ai';
  changeReason: HvyPluginHookChangeReason;
  refreshPlugins(pluginId?: string): void;
  requestRerender(): void;
  isCurrentDocument(): boolean;
}

export interface HvyPluginHookHandler {
  priority?: number;
  run(ctx: HvyDocumentHookContext): void | Promise<void>;
}

export interface HvyPluginHooks {
  documentLoad?: HvyPluginHookHandler | HvyPluginHookHandler[];
  documentChange?: HvyPluginHookHandler | HvyPluginHookHandler[];
}

export interface HvyPlugin {
  // Stable identifier serialized into the document as block.schema.plugin.
  // Convention: namespace-qualified, e.g. 'hvy.db-table'.
  id: string;
  // Human-readable name shown in the plugin selector.
  displayName: string;
  // Optional capability list for renderable plugin components.
  components?: HvyPluginComponentDefinition[];
  // Optional output generators used by authoring UI such as reusable template forms.
  outputGenerators?: HvyOutputGenerator[];
  // Compatibility/default component factory invoked once per mount. The host
  // caches the returned instance per (sectionKey, blockId) and reuses it across
  // re-renders.
  create?: HvyPluginFactory;
  // Optional document lifecycle hooks. Handlers are ordered by per-handler
  // priority, then by the host plugin list order.
  hooks?: HvyPluginHooks;
  // Optional PDF/static rendering capability for PHVY and PDF export. The host
  // invokes this at export time and replaces the plugin block with the returned
  // PDF-compatible HVY blocks in the export clone.
  pdf?: HvyPluginPdfCapability;
  // Optional guidance included in the AI document outline for plugin blocks.
  // Keep this short and action-oriented; it helps the document-edit loop know
  // which serialized fields to patch when users report plugin-rendered errors.
  aiHint?: string | ((block: VisualBlock) => string);
  // Optional longer help. This is exposed through AI tools on demand instead of
  // being included in every prompt.
  aiHelp?: string | ((block?: VisualBlock) => string);
  // Optional read-only documentation file exposed by CLI virtual plugin
  // component directories. The file itself should live next to the plugin
  // implementation so plugin docs are easy to find and update.
  documentation?: {
    filename: string;
    text: string;
  };
}

/** @deprecated Use HvyPlugin. */
export type HvyPluginRegistration = HvyPlugin;
