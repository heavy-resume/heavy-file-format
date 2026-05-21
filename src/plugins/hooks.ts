import { getActiveStateRuntime, getRenderApp, runWithStateRuntime, runWithStateRuntimeAsync, state, type StateRuntime } from '../state';
import { serializeDocument } from '../serialization';
import type { VisualDocument } from '../types';
import { notifyDocumentMayHaveChanged } from '../document-change';
import { refreshMountedPlugins } from './mount';
import { getHostPlugins } from './registry';
import type {
  HvyDocumentHookContext,
  HvyPlugin,
  HvyPluginHookChangeReason,
  HvyPluginHookHandler,
  HvyPluginHooks,
} from './types';

type DocumentHookName = keyof Pick<HvyPluginHooks, 'documentLoad' | 'documentChange'>;

interface OrderedHookHandler {
  handler: HvyPluginHookHandler;
  pluginOrder: number;
  handlerOrder: number;
}

interface HookRuntimeState {
  lastHookDocument: VisualDocument | null;
  lastHookSignature: string;
  hookRun: Promise<void>;
  hookRunDepth: number;
}

const fallbackHookState: HookRuntimeState = {
  lastHookDocument: null,
  lastHookSignature: '',
  hookRun: Promise.resolve(),
  hookRunDepth: 0,
};
const hookStateByRuntime = new WeakMap<StateRuntime, HookRuntimeState>();

function getHookState(): HookRuntimeState {
  try {
    const runtime = getActiveStateRuntime();
    let hookState = hookStateByRuntime.get(runtime);
    if (!hookState) {
      hookState = {
        lastHookDocument: null,
        lastHookSignature: '',
        hookRun: Promise.resolve(),
        hookRunDepth: 0,
      };
      hookStateByRuntime.set(runtime, hookState);
    }
    return hookState;
  } catch {
    return fallbackHookState;
  }
}

function normalizeHandlers(value: HvyPluginHookHandler | HvyPluginHookHandler[] | undefined): HvyPluginHookHandler[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function getOrderedHandlers(hookName: DocumentHookName, plugins: HvyPlugin[]): OrderedHookHandler[] {
  return plugins
    .flatMap((plugin, pluginOrder) =>
      normalizeHandlers(plugin.hooks?.[hookName]).map((handler, handlerOrder) => ({
        handler,
        pluginOrder,
        handlerOrder,
      }))
    )
    .sort((left, right) => {
      const priorityDelta = (right.handler.priority ?? 0) - (left.handler.priority ?? 0);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      const pluginDelta = left.pluginOrder - right.pluginOrder;
      if (pluginDelta !== 0) {
        return pluginDelta;
      }
      return left.handlerOrder - right.handlerOrder;
    });
}

function createHookContext(document: VisualDocument, changeReason: HvyPluginHookChangeReason): HvyDocumentHookContext {
  const runtime = getActiveStateRuntime();
  return {
    document,
    view: state.currentView,
    changeReason,
    refreshPlugins: (pluginId) => refreshMountedPlugins(pluginId),
    requestRerender: () => runWithStateRuntime(runtime, () => getRenderApp()()),
    isCurrentDocument: () => state.document === document,
  };
}

async function runHookHandlers(hookName: DocumentHookName, ctx: HvyDocumentHookContext): Promise<void> {
  const hookState = getHookState();
  hookState.hookRunDepth += 1;
  try {
    for (const { handler } of getOrderedHandlers(hookName, getHostPlugins())) {
      if (!ctx.isCurrentDocument()) {
        return;
      }
      try {
        await handler.run(ctx);
      } catch {
        // A plugin hook should not prevent later document lifecycle handling.
      }
    }
  } finally {
    hookState.hookRunDepth = Math.max(0, hookState.hookRunDepth - 1);
  }
}

export function resetPluginDocumentHookState(): void {
  const hookState = getHookState();
  hookState.lastHookDocument = null;
  hookState.lastHookSignature = '';
  hookState.hookRun = Promise.resolve();
}

export function runPluginDocumentHooks(changeReason: HvyPluginHookChangeReason = 'unknown'): Promise<void> {
  const runtime = getActiveStateRuntime();
  const hookState = getHookState();
  const document = state.document;
  const signature = serializeDocument(document);
  const hookName: DocumentHookName | null = hookState.lastHookDocument !== document
    ? 'documentLoad'
    : hookState.lastHookSignature !== signature
      ? 'documentChange'
      : null;

  hookState.lastHookDocument = document;
  hookState.lastHookSignature = signature;

  if (hookState.hookRunDepth > 0) {
    return Promise.resolve();
  }

  if (!hookName) {
    return hookState.hookRun;
  }

  const ctx = createHookContext(document, hookName === 'documentLoad' ? 'load' : changeReason);
  hookState.hookRun = hookState.hookRun.then(async () => {
    await runWithStateRuntimeAsync(runtime, async () => {
      await runHookHandlers(hookName, ctx);
      if (ctx.isCurrentDocument()) {
        hookState.lastHookDocument = document;
        hookState.lastHookSignature = serializeDocument(document);
        notifyDocumentMayHaveChanged(`document-hook:${ctx.changeReason}`, 'script');
      }
    });
  });
  return hookState.hookRun;
}
