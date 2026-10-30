import { getActiveStateRuntime, getRenderApp, runWithStateRuntime, runWithStateRuntimeAsync, state, type StateRuntime } from '../state';
import { serializeDocument } from '../serialization';
import type { VisualDocument } from '../types';
import { notifyDocumentMayHaveChanged } from '../document-change';
import { elapsedMs, logPerfTrace, nowMs } from '../perf-trace';
import { refreshMountedPlugins } from './mount';
import { getHostPlugins } from './registry';
import { getDatabaseChangeRevision } from '../database-change-tracker';
import { beginReactiveHistoryAmendment } from '../history';
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

export interface PluginDocumentHookResult {
  ran: boolean;
  documentChanged: boolean;
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

// History restores (undo, redo, rollback) return the document to a state that
// already includes the output of the hooks that ran for it, so they adopt the
// restored document as current instead of reloading or rerunning hooks.
export function markPluginDocumentHooksCurrent(): void {
  const hookState = getHookState();
  hookState.lastHookDocument = state.document;
  hookState.lastHookSignature = getHookSignature(state.document);
}

// The view is part of the signature because hooks receive it and may behave
// differently per view; entering another view must rerun them.
function getHookSignature(document: VisualDocument): string {
  return `${state.currentView}\u0000${serializeDocument(document)}\u0000database:${getDatabaseChangeRevision(document)}`;
}

export function runPluginDocumentHooks(changeReason: HvyPluginHookChangeReason = 'unknown'): Promise<PluginDocumentHookResult> {
  const runtime = getActiveStateRuntime();
  const hookState = getHookState();
  const document = state.document;
  const signatureStartedAt = nowMs();
  const signature = getHookSignature(document);
  const signatureMs = elapsedMs(signatureStartedAt);
  const hookName: DocumentHookName | null = hookState.lastHookDocument !== document
    ? 'documentLoad'
    : hookState.lastHookSignature !== signature
      ? 'documentChange'
      : null;

  hookState.lastHookDocument = document;
  hookState.lastHookSignature = signature;

  if (hookState.hookRunDepth > 0) {
    logPerfTrace('plugin-document-hooks:skip', {
      changeReason,
      skipReason: 'nested-hook-run',
      signatureMs,
    });
    return Promise.resolve({ ran: false, documentChanged: false });
  }

  if (!hookName) {
    logPerfTrace('plugin-document-hooks:skip', {
      changeReason,
      skipReason: 'unchanged-document-signature',
      signatureMs,
    });
    return hookState.hookRun.then(() => ({ ran: false, documentChanged: false }));
  }

  const ctx = createHookContext(document, hookName === 'documentLoad' ? 'load' : changeReason);
  const hookResult = hookState.hookRun.then(async (): Promise<PluginDocumentHookResult> => {
    const startedAt = nowMs();
    logPerfTrace('plugin-document-hooks:start', {
      hookName,
      changeReason,
      signatureMs,
    });
    const result = await runWithStateRuntimeAsync(runtime, async (): Promise<PluginDocumentHookResult> => {
      const amendHistory = beginReactiveHistoryAmendment();
      await runHookHandlers(hookName, ctx);
      if (ctx.isCurrentDocument()) {
        const nextSignature = getHookSignature(document);
        hookState.lastHookDocument = document;
        hookState.lastHookSignature = nextSignature;
        const documentChanged = nextSignature !== signature;
        if (documentChanged) {
          amendHistory?.();
          notifyDocumentMayHaveChanged(`document-hook:${ctx.changeReason}`, 'script', { authoritative: true });
        }
        return { ran: true, documentChanged };
      }
      return { ran: true, documentChanged: true };
    });
    logPerfTrace('plugin-document-hooks:end', {
      hookName,
      changeReason,
      elapsedMs: elapsedMs(startedAt),
      signatureMs,
    });
    return result;
  });
  hookState.hookRun = hookResult.then(() => undefined);
  return hookResult;
}
