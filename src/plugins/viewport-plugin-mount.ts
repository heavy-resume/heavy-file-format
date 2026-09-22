import type { HvyPluginInstance } from './types';

export interface ViewportPluginMountOptions {
  strategy?: 'viewport' | 'immediate';
  placeholderHeight?: string;
}

const DEFAULT_PLUGIN_PLACEHOLDER_HEIGHT = '12rem';
const PLUGIN_PRELOAD_MARGIN_PX = 600;

export function createPluginMount(
  create: () => HvyPluginInstance,
  options: ViewportPluginMountOptions = {},
): HvyPluginInstance {
  return options.strategy === 'immediate'
    ? create()
    : createViewportPluginMount(create, options);
}

/**
 * Creates a host-owned mount that does not invoke the plugin factory until its
 * reserved layout box approaches the document viewport.
 */
export function createViewportPluginMount(
  create: () => HvyPluginInstance,
  options: ViewportPluginMountOptions,
): HvyPluginInstance {
  const placeholder = document.createElement('div');
  placeholder.className = 'hvy-plugin-mount hvy-plugin-viewport-placeholder';
  placeholder.style.minHeight = options.placeholderHeight ?? DEFAULT_PLUGIN_PLACEHOLDER_HEIGHT;
  placeholder.setAttribute('aria-busy', 'true');

  let mounted: HvyPluginInstance | null = null;
  let observer: IntersectionObserver | null = null;
  let disposed = false;
  let scheduleVersion = 0;

  const disconnect = () => {
    observer?.disconnect();
    observer = null;
  };

  const activate = () => {
    if (disposed || mounted) return;
    disconnect();
    try {
      mounted = create();
      placeholder.replaceWith(mounted.element);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Plugin failed to mount.';
      placeholder.textContent = `Plugin error: ${message}`;
      placeholder.classList.add('hvy-plugin-error');
      placeholder.removeAttribute('aria-busy');
    }
  };

  const schedule = () => {
    if (disposed || mounted) return;
    const version = ++scheduleVersion;
    queueMicrotask(() => {
      if (disposed || mounted || version !== scheduleVersion) return;
      disconnect();
      if (typeof IntersectionObserver === 'undefined') {
        activate();
        return;
      }
      // Embedded hosts can attach their root after mounting. Observing while
      // detached lets IntersectionObserver activate it once it becomes visible.
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) activate();
      }, {
        root: placeholder.closest('.reader-document, .editor-tree, .viewer-sidebar-panel'),
        rootMargin: `${PLUGIN_PRELOAD_MARGIN_PX}px 0px`,
        threshold: 0,
      });
      observer.observe(placeholder);
    });
  };

  schedule();
  return {
    get element() {
      return mounted?.element ?? placeholder;
    },
    refresh() {
      if (mounted) {
        mounted.refresh?.();
      } else {
        schedule();
      }
    },
    unmount() {
      disposed = true;
      scheduleVersion += 1;
      disconnect();
      mounted?.unmount?.();
    },
  };
}
