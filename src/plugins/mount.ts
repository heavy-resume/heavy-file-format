import { state, getRenderApp, getRefreshReaderPanels, getObserveLinks, getActiveStateRuntime, getCachedComponentRenderHelpers, runWithStateRuntime, type StateRuntime } from '../state';
import { findBlockByIds } from '../block-ops';
import { recordHistory } from '../history';
import { syncReusableTemplateForBlock } from '../reusable';
import { serializeDocument } from '../serialization';
import { getAttachment, setAttachment, removeAttachment } from '../attachments';
import { getHostPlugin } from './registry';
import { createDefaultTextCaption, renderTextCaptionElement } from '../caption';
import { createDefaultTextComponent, renderTextComponentElement } from '../text-component';
import { mountPluginTextEditor } from './text-editor';
import type {
  HvyPluginContext,
  HvyPluginInstance,
  HvyPlugin,
} from './types';
import type { JsonObject } from '../hvy/types';

interface SavedFocus {
  element: HTMLElement;
  selectionStart: number | null;
  selectionEnd: number | null;
  selectionDirection: 'forward' | 'backward' | 'none' | null;
}

interface MountedPlugin {
  pluginId: string;
  sectionKey: string;
  blockId: string;
  mode: 'editor' | 'reader';
  instance: HvyPluginInstance;
  placeholder: HTMLElement | null;
  pendingFocus: SavedFocus | null;
}

const MOUNT_KEY_PREFIX = 'hvy-plugin-mount';
const fallbackMounted = new Map<string, MountedPlugin>();
const mountedByRuntime = new WeakMap<StateRuntime, Map<string, MountedPlugin>>();

function getMountedPlugins(): Map<string, MountedPlugin> {
  try {
    const runtime = getActiveStateRuntime();
    let mounted = mountedByRuntime.get(runtime);
    if (!mounted) {
      mounted = new Map<string, MountedPlugin>();
      mountedByRuntime.set(runtime, mounted);
    }
    return mounted;
  } catch {
    return fallbackMounted;
  }
}

function getPluginEditorDetailLevel(mode: 'editor' | 'reader'): number {
  if (mode !== 'editor') {
    return 0;
  }
  return state.showAdvancedEditor ? 2 : 1;
}

function mountKey(pluginId: string, mode: 'editor' | 'reader', sectionKey: string, blockId: string): string {
  return `${MOUNT_KEY_PREFIX}|${pluginId}|${mode}|${sectionKey}|${blockId}`;
}

export function renderPluginMountPlaceholder(
  pluginId: string,
  mode: 'editor' | 'reader',
  sectionKey: string,
  blockId: string,
  escapeAttr: (value: string) => string
): string {
  return (
    '<div class="hvy-plugin-mount" ' +
    `data-hvy-plugin-mount="true" ` +
    `data-plugin-id="${escapeAttr(pluginId)}" ` +
    `data-plugin-mode="${escapeAttr(mode)}" ` +
    `data-section-key="${escapeAttr(sectionKey)}" ` +
    `data-block-id="${escapeAttr(blockId)}"></div>`
  );
}

function buildContext(
  plugin: HvyPlugin,
  mode: 'editor' | 'reader',
  sectionKey: string,
  blockId: string
): HvyPluginContext | null {
  const runtime = getActiveStateRuntime();
  const block = findBlockByIds(sectionKey, blockId);
  if (!block) {
    return null;
  }

  const requestRerender = () => runWithStateRuntime(runtime, () => getRenderApp()());

  const setConfig = (patch: JsonObject) => {
    runWithStateRuntime(runtime, () => {
      const current = findBlockByIds(sectionKey, blockId);
      if (!current) return;
      recordHistory(`plugin-config:${plugin.id}:${sectionKey}:${blockId}`);
      current.schema.pluginConfig = { ...current.schema.pluginConfig, ...patch };
      syncReusableTemplateForBlock(sectionKey, blockId);
      getRefreshReaderPanels()();
      refreshMountedPlugins(plugin.id, sectionKey, blockId);
    });
  };

  const setText = (text: string) => {
    runWithStateRuntime(runtime, () => {
      const current = findBlockByIds(sectionKey, blockId);
      if (!current) return;
      recordHistory(`plugin-text:${plugin.id}:${sectionKey}:${blockId}`);
      current.text = text;
      syncReusableTemplateForBlock(sectionKey, blockId);
      getRefreshReaderPanels()();
      refreshMountedPlugins(plugin.id, sectionKey, blockId);
    });
  };

  const setCss = (css: string) => {
    runWithStateRuntime(runtime, () => {
      const current = findBlockByIds(sectionKey, blockId);
      if (!current) return;
      recordHistory(`plugin-css:${plugin.id}:${sectionKey}:${blockId}`);
      current.schema.css = css;
      syncReusableTemplateForBlock(sectionKey, blockId);
      getRefreshReaderPanels()();
      refreshMountedPlugins(plugin.id, sectionKey, blockId);
    });
  };

  return {
    mode,
    get editor() {
      return {
        mode: mode === 'editor' ? 'edit' as const : 'view' as const,
        detailLevel: getPluginEditorDetailLevel(mode),
      };
    },
    sectionKey,
    block,
    rawDocument: state.document,
    document: {
      getHvy: () => serializeDocument(state.document),
    },
    attachments: {
      list: () => runWithStateRuntime(runtime, () => state.document.attachments.slice()),
      get: (id) => runWithStateRuntime(runtime, () => getAttachment(state.document, id)),
      set: (id, meta, bytes) => runWithStateRuntime(runtime, () => {
        recordHistory(`plugin-attachment:${plugin.id}:${sectionKey}:${blockId}:${id}`);
        setAttachment(state.document, id, meta, bytes);
      }),
      remove: (id) => runWithStateRuntime(runtime, () => {
        recordHistory(`plugin-attachment-remove:${plugin.id}:${sectionKey}:${blockId}:${id}`);
        removeAttachment(state.document, id);
      }),
    },
    header: {
      get: (key) => runWithStateRuntime(runtime, () => state.document.meta[key]),
      set: (key, value) => runWithStateRuntime(runtime, () => {
        recordHistory(`plugin-header:${plugin.id}:${sectionKey}:${blockId}:${key}`);
        (state.document.meta as Record<string, unknown>)[key] = value;
      }),
    },
    setConfig,
    setText,
    setCss,
    observeLinks: (root) => runWithStateRuntime(runtime, () => getObserveLinks()(root)),
    caption: {
      createDefaultTextCaption,
      openTextCaptionModal: (options) => runWithStateRuntime(runtime, () => {
        const configKey = options.configKey ?? 'caption';
        state.captionTextModal = {
          target: { kind: 'plugin-config', pluginId: plugin.id, sectionKey, blockId, configKey, title: options.title },
          title: options.title ?? 'Caption',
          onChange: options.onChange ?? ((next) => setConfig({ [configKey]: next })),
        };
        getRenderApp()();
      }),
      renderTextCaption: (value) => runWithStateRuntime(runtime, () => renderTextCaptionElement(value, getCachedComponentRenderHelpers())),
    },
    text: {
      createDefaultText: createDefaultTextComponent,
      renderText: (value) => runWithStateRuntime(runtime, () => renderTextComponentElement(value, getCachedComponentRenderHelpers())),
    },
    textEditor: {
      mount: (options) => runWithStateRuntime(runtime, () => mountPluginTextEditor(options)),
    },
    requestRerender,
  };
}

export function refreshMountedPlugins(pluginId?: string, sectionKey?: string, blockId?: string): void {
  const mounted = getMountedPlugins();
  for (const entry of mounted.values()) {
    if (pluginId && entry.pluginId !== pluginId) {
      continue;
    }
    if (sectionKey && entry.sectionKey !== sectionKey) {
      continue;
    }
    if (blockId && entry.blockId !== blockId) {
      continue;
    }
    try {
      entry.instance.refresh?.();
    } catch (error) {
      console.error('[hvy:plugin] refresh threw', error);
    }
  }
}

// Walk all plugin mount placeholders in the rendered DOM, instantiate factories
// for any new mounts, reuse cached instances for existing ones, and reconcile
// the cache by unmounting plugins whose placeholders are no longer present.
export function reconcilePluginMounts(root: ParentNode, options: { prune?: boolean } = {}): void {
  const mounted = getMountedPlugins();
  const seen = new Set<string>();
  const seenModes = new Set<'editor' | 'reader'>();
  const placeholders = root.querySelectorAll<HTMLElement>('[data-hvy-plugin-mount="true"]');

  placeholders.forEach((placeholder) => {
    const pluginId = placeholder.dataset.pluginId ?? '';
    const mode = (placeholder.dataset.pluginMode as 'editor' | 'reader' | undefined) ?? 'editor';
    const sectionKey = placeholder.dataset.sectionKey ?? '';
    const blockId = placeholder.dataset.blockId ?? '';
    if (pluginId.length === 0 || sectionKey.length === 0 || blockId.length === 0) {
      return;
    }

    const key = mountKey(pluginId, mode, sectionKey, blockId);
    seen.add(key);
    seenModes.add(mode);

    const existing = mounted.get(key);
    if (existing) {
      placeholder.replaceWith(existing.instance.element);
      existing.placeholder = existing.instance.element;
      // Restore focus before refresh — plugins (e.g. progress-bar) that
      // skip rebuilding while a child is focused need document.activeElement
      // to already point at their input by the time refresh runs.
      if (existing.pendingFocus) {
        applySavedFocus(existing.pendingFocus);
        existing.pendingFocus = null;
      }
      try {
        existing.instance.refresh?.();
      } catch (error) {
        console.error('[hvy:plugin] refresh threw', error);
      }
      return;
    }

    const registration = getHostPlugin(pluginId);
    if (!registration) {
      placeholder.textContent = `Plugin "${pluginId}" is not available.`;
      placeholder.classList.add('hvy-plugin-missing');
      return;
    }

    const ctx = buildContext(registration, mode, sectionKey, blockId);
    if (!ctx) {
      placeholder.textContent = 'Plugin block is missing.';
      placeholder.classList.add('hvy-plugin-missing');
      return;
    }

    if (!registration.create) {
      placeholder.textContent = `Plugin "${pluginId}" does not provide a renderable component.`;
      placeholder.classList.add('hvy-plugin-missing');
      return;
    }

    let instance: HvyPluginInstance;
    try {
      instance = registration.create(ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Plugin failed to mount.';
      placeholder.textContent = `Plugin error: ${message}`;
      placeholder.classList.add('hvy-plugin-error');
      return;
    }

    placeholder.replaceWith(instance.element);
    mounted.set(key, {
      pluginId,
      sectionKey,
      blockId,
      mode,
      instance,
      placeholder: instance.element,
      pendingFocus: null,
    });
  });

  if (options.prune === false) {
    return;
  }

  const pruneAll = isFullPluginReconcileRoot(root);

  // Reconcile: anything cached but not seen this pass is orphaned.
  for (const [key, entry] of mounted) {
    if (seen.has(key)) {
      continue;
    }
    if (!pruneAll && !seenModes.has(entry.mode)) {
      continue;
    }
    try {
      entry.instance.unmount?.();
    } catch (error) {
      console.error('[hvy:plugin] unmount threw', error);
    }
    if (entry.instance.element.parentElement) {
      entry.instance.element.remove();
    }
    mounted.delete(key);
  }
}

function isFullPluginReconcileRoot(root: ParentNode): boolean {
  if (root instanceof Document) {
    return true;
  }
  return root instanceof HTMLElement && root.id === 'app';
}

// Capture the currently-focused element if it's inside a cached plugin
// element, and stash it on that mount entry so the next reconcile pass can
// restore focus before the plugin's refresh() runs. We have to do this BEFORE
// `app.innerHTML = ...` wipes the DOM (which detaches the focused element
// and moves document.activeElement back to body).
export function capturePluginFocus(): void {
  const mounted = getMountedPlugins();
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) {
    return;
  }
  for (const entry of mounted.values()) {
    if (!entry.instance.element.contains(active)) {
      continue;
    }
    let selectionStart: number | null = null;
    let selectionEnd: number | null = null;
    let selectionDirection: 'forward' | 'backward' | 'none' | null = null;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
      try {
        selectionStart = active.selectionStart;
        selectionEnd = active.selectionEnd;
        selectionDirection = active.selectionDirection ?? null;
      } catch {
        // selectionStart can throw on number/email/etc. inputs — ignore.
      }
    }
    entry.pendingFocus = { element: active, selectionStart, selectionEnd, selectionDirection };
    return;
  }
}

function applySavedFocus(saved: SavedFocus): void {
  if (!saved.element.isConnected) return;
  try {
    saved.element.focus({ preventScroll: true });
    if (
      (saved.element instanceof HTMLInputElement || saved.element instanceof HTMLTextAreaElement) &&
      saved.selectionStart !== null &&
      saved.selectionEnd !== null
    ) {
      saved.element.setSelectionRange(saved.selectionStart, saved.selectionEnd, saved.selectionDirection ?? undefined);
    }
  } catch {
    // Best-effort.
  }
}

export function unmountAllPlugins(): void {
  const mounted = getMountedPlugins();
  for (const entry of mounted.values()) {
    try {
      entry.instance.unmount?.();
    } catch (error) {
      console.error('[hvy:plugin] unmount threw', error);
    }
  }
  mounted.clear();
}
