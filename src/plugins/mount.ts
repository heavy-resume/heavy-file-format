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

interface MountedPlugin {
  pluginId: string;
  sectionKey: string;
  blockId: string;
  mode: 'editor' | 'reader';
  instance: HvyPluginInstance;
  placeholder: HTMLElement | null;
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
    requestRerender();
  };

  const setText = (text: string) => {
    const current = findBlockByIds(sectionKey, blockId);
    if (!current) return;
    current.text = text;
    syncReusableTemplateForBlock(sectionKey, blockId);
    recordHistory(`plugin-text:${registration.id}:${sectionKey}:${blockId}`);
    getRefreshReaderPanels()();
    requestRerender();
  };

  return {
    mode,
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
