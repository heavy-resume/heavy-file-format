import type { JsonObject } from '../hvy/types';
import type { VisualBlock } from '../editor/types';
import type { DocumentAttachment, VisualDocument } from '../types';

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

export interface HvyPluginContext {
  mode: 'editor' | 'reader';
  advanced: boolean;
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

export interface HvyPluginRegistration {
  // Stable identifier serialized into the document as block.schema.plugin.
  // Convention: reverse-DNS, e.g. 'dev.heavy.db-table'.
  id: string;
  // Human-readable name shown in the plugin selector.
  displayName: string;
  // Factory invoked once per mount. The host caches the returned instance per
  // (sectionKey, blockId) and reuses it across re-renders.
  create: HvyPluginFactory;
}
