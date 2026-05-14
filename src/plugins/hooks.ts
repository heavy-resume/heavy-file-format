import { getRenderApp, state } from '../state';
import { serializeDocument } from '../serialization';
import type { VisualDocument } from '../types';
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

let lastHookDocument: VisualDocument | null = null;
let lastHookSignature = '';
let hookRun = Promise.resolve();

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
  return {
    document,
    view: state.currentView,
    changeReason,
    refreshPlugins: (pluginId) => refreshMountedPlugins(pluginId),
    requestRerender: () => getRenderApp()(),
    isCurrentDocument: () => state.document === document,
  };
}

async function runHookHandlers(hookName: DocumentHookName, ctx: HvyDocumentHookContext): Promise<void> {
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
}

export function resetPluginDocumentHookState(): void {
  lastHookDocument = null;
  lastHookSignature = '';
  hookRun = Promise.resolve();
}

export function runPluginDocumentHooks(changeReason: HvyPluginHookChangeReason = 'unknown'): Promise<void> {
  const document = state.document;
  const signature = serializeDocument(document);
  const hookName: DocumentHookName | null = lastHookDocument !== document
    ? 'documentLoad'
    : lastHookSignature !== signature
      ? 'documentChange'
      : null;

  lastHookDocument = document;
  lastHookSignature = signature;

  if (!hookName) {
    return hookRun;
  }

  const ctx = createHookContext(document, hookName === 'documentLoad' ? 'load' : changeReason);
  hookRun = hookRun.then(() => runHookHandlers(hookName, ctx));
  return hookRun;
}
