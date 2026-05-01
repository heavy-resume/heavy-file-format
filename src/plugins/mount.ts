import { state, getRenderApp, getRefreshReaderPanels } from '../state';
import { findBlockByIds } from '../block-ops';
import { recordHistory } from '../history';
import { syncReusableTemplateForBlock } from '../reusable';
import { serializeDocument } from '../serialization';
import { getAttachment, setAttachment, removeAttachment } from '../attachments';
import { getHostPlugin } from './registry';
import type {
  HvyPluginContext,
  HvyPluginInstance,
  HvyPluginRegistration,
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
const mounted = new Map<string, MountedPlugin>();

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
  registration: HvyPluginRegistration,
  mode: 'editor' | 'reader',
  sectionKey: string,
  blockId: string
): HvyPluginContext | null {
  const block = findBlockByIds(sectionKey, blockId);
  if (!block) {
    return null;
  }

  const requestRerender = () => getRenderApp()();

  const setConfig = (patch: JsonObject) => {
    const current = findBlockByIds(sectionKey, blockId);
    if (!current) return;
    current.schema.pluginConfig = { ...current.schema.pluginConfig, ...patch };
    syncReusableTemplateForBlock(sectionKey, blockId);
    recordHistory(`plugin-config:${registration.id}:${sectionKey}:${blockId}`);
    getRefreshReaderPanels()();
    refreshMountedPlugins(registration.id, sectionKey, blockId);
  };

  const setText = (text: string) => {
    const current = findBlockByIds(sectionKey, blockId);
    if (!current) return;
    current.text = text;
    syncReusableTemplateForBlock(sectionKey, blockId);
    recordHistory(`plugin-text:${registration.id}:${sectionKey}:${blockId}`);
    getRefreshReaderPanels()();
    refreshMountedPlugins(registration.id, sectionKey, blockId);
  };

  return {
    mode,
    get advanced() {
      return state.showAdvancedEditor;
    },
    sectionKey,
    block,
    rawDocument: state.document,
    document: {
      getHvy: () => serializeDocument(state.document),
    },
    attachments: {
      list: () => state.document.attachments.slice(),
      get: (id) => getAttachment(state.document, id),
      set: (id, meta, bytes) => setAttachment(state.document, id, meta, bytes),
      remove: (id) => removeAttachment(state.document, id),
    },
    header: {
      get: (key) => state.document.meta[key],
      set: (key, value) => {
        (state.document.meta as Record<string, unknown>)[key] = value;
      },
    },
    setConfig,
    setText,
    requestRerender,
  };
}

function refreshMountedPlugins(pluginId: string, sectionKey: string, blockId: string): void {
  for (const entry of mounted.values()) {
    if (entry.pluginId !== pluginId || entry.sectionKey !== sectionKey || entry.blockId !== blockId) {
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
export function reconcilePluginMounts(root: ParentNode): void {
  const seen = new Set<string>();
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

  // Reconcile: anything cached but not seen this pass is orphaned.
  for (const [key, entry] of mounted) {
    if (seen.has(key)) {
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

// Capture the currently-focused element if it's inside a cached plugin
// element, and stash it on that mount entry so the next reconcile pass can
// restore focus before the plugin's refresh() runs. We have to do this BEFORE
// `app.innerHTML = ...` wipes the DOM (which detaches the focused element
// and moves document.activeElement back to body).
export function capturePluginFocus(): void {
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
  for (const entry of mounted.values()) {
    try {
      entry.instance.unmount?.();
    } catch (error) {
      console.error('[hvy:plugin] unmount threw', error);
    }
  }
  mounted.clear();
}
