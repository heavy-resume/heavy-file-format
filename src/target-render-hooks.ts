import type { HvyTarget } from './embed-target';

export type HvyTargetRenderMode = 'viewer' | 'editor' | 'ai';
export type HvyTargetRenderSurface = 'reader' | 'editor';

export interface HvyTargetRenderContext {
  element: HTMLElement;
  target: Readonly<HvyTarget>;
  mode: HvyTargetRenderMode;
  surface: HvyTargetRenderSurface;
}

export interface HvyTargetRenderHook {
  /** Unique within this mount. Reusing an ID replaces the prior registration. */
  id: string;
  target: HvyTarget;
  /** Defaults to every interactive document mode. */
  modes?: readonly HvyTargetRenderMode[];
  /** Runs whenever this target gains a rendered DOM element. */
  postRender(context: HvyTargetRenderContext): void | (() => void);
}

type MountedTargetRenderHook = {
  hook: HvyTargetRenderHook;
  element: HTMLElement;
  cleanup: (() => void) | null;
};

const controllers = new WeakMap<HTMLElement, TargetRenderHookController>();

export function getTargetRenderHookController(
  root: HTMLElement,
  getMode: () => HvyTargetRenderMode
): TargetRenderHookController {
  const existing = controllers.get(root);
  if (existing) {
    return existing;
  }
  const controller = new TargetRenderHookController(root, getMode);
  controllers.set(root, controller);
  return controller;
}

export function destroyTargetRenderHookController(root: HTMLElement): void {
  controllers.get(root)?.destroy();
  controllers.delete(root);
}

export class TargetRenderHookController {
  private hooks: readonly HvyTargetRenderHook[] = [];
  private mounted: MountedTargetRenderHook[] = [];
  private scheduled = false;
  private destroyed = false;
  private readonly observer: MutationObserver;

  constructor(
    private readonly root: HTMLElement,
    private readonly getMode: () => HvyTargetRenderMode
  ) {
    this.observer = new MutationObserver(() => this.scheduleReconcile());
    this.observer.observe(root, { childList: true, subtree: true });
  }

  setHooks(hooks: readonly HvyTargetRenderHook[]): void {
    if (this.destroyed) {
      throw new Error('HVY target render hooks belong to a destroyed mount.');
    }
    const ids = new Set<string>();
    hooks.forEach((hook) => {
      const id = hook.id.trim();
      if (!id) {
        throw new Error('HVY target render hook IDs cannot be empty.');
      }
      if (ids.has(id)) {
        throw new Error(`Duplicate HVY target render hook ID: ${id}`);
      }
      ids.add(id);
    });
    this.hooks = [...hooks];
    this.reconcile();
  }

  reconcile(): void {
    if (this.destroyed) {
      return;
    }
    const mode = this.getMode();
    const desired = this.hooks.flatMap((hook) => {
      if (hook.modes && !hook.modes.includes(mode)) {
        return [];
      }
      return findRenderedTargetElements(this.root, hook.target).map(({ element, surface }) => ({
        hook,
        element,
        surface,
      }));
    });

    const retained: MountedTargetRenderHook[] = [];
    this.mounted.forEach((entry) => {
      const keep = desired.some((candidate) => candidate.hook === entry.hook && candidate.element === entry.element);
      if (keep) {
        retained.push(entry);
      } else {
        entry.cleanup?.();
      }
    });
    this.mounted = retained;

    desired.forEach(({ hook, element, surface }) => {
      if (this.mounted.some((entry) => entry.hook === hook && entry.element === element)) {
        return;
      }
      const cleanup = hook.postRender({ element, target: hook.target, mode, surface });
      this.mounted.push({ hook, element, cleanup: typeof cleanup === 'function' ? cleanup : null });
    });
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.observer.disconnect();
    this.mounted.forEach((entry) => entry.cleanup?.());
    this.mounted = [];
    this.hooks = [];
  }

  private scheduleReconcile(): void {
    if (this.scheduled || this.destroyed) {
      return;
    }
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      this.reconcile();
    });
  }
}

function findRenderedTargetElements(
  root: HTMLElement,
  target: HvyTarget
): Array<{ element: HTMLElement; surface: HvyTargetRenderSurface }> {
  const candidates = target.blockId
    ? root.querySelectorAll<HTMLElement>('.reader-block[data-section-key][data-block-id], .editor-block[data-section-key][data-block-id], .editor-block-passive[data-section-key][data-block-id]')
    : root.querySelectorAll<HTMLElement>('.reader-section[data-section-key], .editor-section-card[data-section-key]');
  return Array.from(candidates).flatMap((element) => {
    if (element.dataset.sectionKey !== target.sectionKey) {
      return [];
    }
    if (target.blockId && element.dataset.blockId !== target.blockId) {
      return [];
    }
    const surface = getTargetRenderSurface(element);
    if (target.blockId && surface === 'editor' && element.classList.contains('reader-block')) {
      return [];
    }
    return surface ? [{ element, surface }] : [];
  });
}

function getTargetRenderSurface(element: HTMLElement): HvyTargetRenderSurface | null {
  if (element.closest('.reader-document, .viewer-sidebar-panel')) {
    return 'reader';
  }
  if (element.closest('.editor-tree, .editor-sidebar-panel')) {
    return 'editor';
  }
  return null;
}
