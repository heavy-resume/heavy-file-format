import { getActiveStateRuntime, runWithStateRuntime, type StateRuntime } from '../../state';
import { serializeDocumentBytes, serializeDocumentBytesAsync } from '../../serialization';
import { normalizeFilename } from '../../utils';
import { refreshMountedPlugins } from '../mount';
import type { HvyCanvasApi } from '../canvas/canvas';
import { createScriptingDbRuntime, resetDbTableRuntimeForDocument } from '../db-table';
import { createBuiltInPluginMetadata, DB_TABLE_PLUGIN_ID, FORM_PLUGIN_ID, POWER_SCRIPTING_PLUGIN_ID } from '../registry';
import { createScriptingRuntime, type ScriptingDocApi, type ScriptingRuntime } from '../scripting/runtime';
import { createScriptingPluginsApi } from '../scripting/plugin-apis';
import type { HvyPlugin, HvyPluginContext, HvyPluginFactory, HvyPluginInstance } from '../types';
import { getPowerScriptingModeForDocument, setPowerScriptAccepted } from './power-scripting-policy';
import { getSaveRequestHandler, type HvySaveStatus } from './power-save-request';
import powerScriptingDocumentation from './about-power-scripting.txt?raw';
import './power-scripting.css';

type Cleanup = () => void;

export interface HvyPowerCanvasApi {
  get(id: string): HvyCanvasApi | null;
  wait(id: string, timeoutMs?: number): Promise<HvyCanvasApi>;
}

export interface HvyPowerAnimationApi {
  start(callback: (time: number, delta: number) => void): Cleanup;
}

export interface HvyPowerDialogApi {
  alert(message: string, options?: { title?: string; confirmLabel?: string }): Promise<void>;
  confirm(message: string, options?: { title?: string; confirmLabel?: string; cancelLabel?: string }): Promise<boolean>;
  prompt(message: string, options?: { title?: string; value?: string; placeholder?: string; confirmLabel?: string; cancelLabel?: string }): Promise<string | null>;
}

export interface HvyPowerDocApi extends ScriptingDocApi {
  canvas: HvyPowerCanvasApi;
  animation: HvyPowerAnimationApi;
  dialog: HvyPowerDialogApi;
  save: {
    request(options?: { reason?: string; filename?: string }): Promise<HvySaveStatus>;
  };
  onCleanup(cleanup: Cleanup): Cleanup;
  listen(target: EventTarget, type: string, listener: EventListenerOrEventListenerObject, options?: AddEventListenerOptions | boolean): Cleanup;
}

interface RunningProgram {
  source: string;
  stop(): void;
}

function findCanvas(root: HTMLElement, id: string): HvyCanvasApi | null {
  const selector = `[data-hvy-canvas-id="${CSS.escape(String(id))}"]`;
  return root.querySelector<HTMLElement>(selector)?.hvyCanvas ?? null;
}

function buildPowerDoc(
  ctx: HvyPluginContext,
  dialogRoot: HTMLElement,
  runtime: ScriptingRuntime,
  stateRuntime: StateRuntime,
  registerCleanup: (cleanup: Cleanup) => Cleanup
): HvyPowerDocApi {
  const coreDb = runtime.doc.db;
  const coreRerender = runtime.doc.rerender;
  const openDialog = <T>(options: {
    title: string;
    message: string;
    input?: { value: string; placeholder: string };
    confirmLabel: string;
    cancelLabel?: string;
    resolveConfirm(input: HTMLInputElement | null): T;
    resolveCancel: T;
  }): Promise<T> => new Promise<T>((resolve) => {
    const ownerDocument = ctx.hostRoot.ownerDocument;
    const overlay = ownerDocument.createElement('div');
    overlay.className = 'hvy-power-dialog-overlay';
    const dialog = ownerDocument.createElement('div');
    dialog.className = 'hvy-power-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const title = ownerDocument.createElement('h3');
    title.textContent = options.title;
    const message = ownerDocument.createElement('p');
    message.textContent = options.message;
    const input = options.input ? ownerDocument.createElement('input') : null;
    if (input && options.input) {
      input.type = 'text';
      input.value = options.input.value;
      input.placeholder = options.input.placeholder;
    }
    const actions = ownerDocument.createElement('div');
    actions.className = 'hvy-power-dialog-actions';
    let settled = false;
    const finish = (value: T) => {
      if (settled) return;
      settled = true;
      overlay.remove();
      resolve(value);
    };
    if (options.cancelLabel) {
      const cancel = ownerDocument.createElement('button');
      cancel.type = 'button';
      cancel.className = 'ghost';
      cancel.textContent = options.cancelLabel;
      cancel.addEventListener('click', () => finish(options.resolveCancel));
      actions.appendChild(cancel);
    }
    const confirm = ownerDocument.createElement('button');
    confirm.type = 'button';
    confirm.className = 'primary';
    confirm.textContent = options.confirmLabel;
    confirm.addEventListener('click', () => finish(options.resolveConfirm(input)));
    actions.appendChild(confirm);
    dialog.append(title, message);
    if (input) dialog.appendChild(input);
    dialog.appendChild(actions);
    overlay.appendChild(dialog);
    ctx.hostRoot.classList.add('hvy-power-dialog-host');
    dialogRoot.appendChild(overlay);
    registerCleanup(() => finish(options.resolveCancel));
    queueMicrotask(() => (input ?? confirm).focus({ preventScroll: true }));
    input?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') finish(options.resolveConfirm(input));
      if (event.key === 'Escape') finish(options.resolveCancel);
    });
  });
  return Object.assign(runtime.doc, {
    db: {
      query: (sql: string, params?: unknown) => runWithStateRuntime(stateRuntime, () => coreDb.query(sql, params)),
      get_tables: () => runWithStateRuntime(stateRuntime, () => coreDb.get_tables()),
      get_updated_tables: (tableName?: string) => runWithStateRuntime(stateRuntime, () => coreDb.get_updated_tables(tableName)),
      execute: (sql: string, params?: unknown) => runWithStateRuntime(stateRuntime, () => {
        const result = coreDb.execute(sql, params);
        resetDbTableRuntimeForDocument(ctx.rawDocument);
        refreshMountedPlugins(DB_TABLE_PLUGIN_ID);
        refreshMountedPlugins(FORM_PLUGIN_ID);
        return result;
      }),
    },
    rerender: () => runWithStateRuntime(stateRuntime, coreRerender),
    canvas: {
      get: (id: string) => findCanvas(ctx.hostRoot, id),
      wait: (id: string, timeoutMs = 5000) => new Promise<HvyCanvasApi>((resolve, reject) => {
        const startedAt = performance.now();
        const poll = () => {
          const found = findCanvas(ctx.hostRoot, id);
          if (found) {
            window.clearInterval(interval);
            resolve(found);
          } else if (performance.now() - startedAt >= Math.max(0, timeoutMs)) {
            window.clearInterval(interval);
            reject(new Error(`Canvas "${id}" was not found.`));
          }
        };
        const interval = window.setInterval(poll, 16);
        registerCleanup(() => window.clearInterval(interval));
        poll();
      }),
    },
    animation: {
      start: (callback: (time: number, delta: number) => void) => {
        let frame = 0;
        let previous = performance.now();
        const tick = (time: number) => {
          const delta = Math.min(100, Math.max(0, time - previous));
          previous = time;
          callback(time, delta);
          frame = window.requestAnimationFrame(tick);
        };
        frame = window.requestAnimationFrame(tick);
        return registerCleanup(() => window.cancelAnimationFrame(frame));
      },
    },
    dialog: {
      alert: (message: string, options: { title?: string; confirmLabel?: string } = {}) => openDialog<void>({
        title: options.title ?? 'Notice',
        message: String(message),
        confirmLabel: options.confirmLabel ?? 'OK',
        resolveConfirm: () => undefined,
        resolveCancel: undefined,
      }),
      confirm: (message: string, options: { title?: string; confirmLabel?: string; cancelLabel?: string } = {}) => openDialog<boolean>({
        title: options.title ?? 'Confirm',
        message: String(message),
        confirmLabel: options.confirmLabel ?? 'Continue',
        cancelLabel: options.cancelLabel ?? 'Cancel',
        resolveConfirm: () => true,
        resolveCancel: false,
      }),
      prompt: (message: string, options: { title?: string; value?: string; placeholder?: string; confirmLabel?: string; cancelLabel?: string } = {}) => openDialog<string | null>({
        title: options.title ?? 'Input',
        message: String(message),
        input: { value: options.value ?? '', placeholder: options.placeholder ?? '' },
        confirmLabel: options.confirmLabel ?? 'Submit',
        cancelLabel: options.cancelLabel ?? 'Cancel',
        resolveConfirm: (input) => input?.value ?? '',
        resolveCancel: null,
      }),
    },
    save: {
      request: async (options: { reason?: string; filename?: string } = {}) => {
        const filename = normalizeFilename(options.filename || stateRuntime.state.filename || 'document.hvy');
        const reason = String(options.reason || 'Power script requested a save.');
        const handler = getSaveRequestHandler(stateRuntime);
        if (!handler) return 'canceled';
        const result = await handler({
          reason,
          filename,
          document: ctx.rawDocument,
          serializeDocumentBytes: () => runWithStateRuntime(stateRuntime, () => serializeDocumentBytes(ctx.rawDocument)),
          serializeDocumentBytesAsync: () => runWithStateRuntime(stateRuntime, () => serializeDocumentBytesAsync(ctx.rawDocument)),
        });
        return result === false || result === 'canceled' ? 'canceled' : 'saved';
      },
    },
    onCleanup: registerCleanup,
    listen: (target: EventTarget, type: string, listener: EventListenerOrEventListenerObject, options?: AddEventListenerOptions | boolean) => {
      target.addEventListener(type, listener, options);
      return registerCleanup(() => target.removeEventListener(type, listener, options));
    },
  });
}

async function startProgram(
  ctx: HvyPluginContext,
  dialogRoot: HTMLElement,
  source: string,
  stateRuntime: StateRuntime,
  report: (message: string, error?: boolean) => void
): Promise<RunningProgram> {
  const cleanups = new Set<Cleanup>();
  let stopped = false;
  const registerCleanup = (cleanup: Cleanup): Cleanup => {
    if (stopped) {
      cleanup();
      return cleanup;
    }
    cleanups.add(cleanup);
    return () => {
      if (!cleanups.delete(cleanup)) return;
      cleanup();
    };
  };

  let runtime: ScriptingRuntime | null = null;
  const database = /\bdoc\s*\.\s*db\b/u.test(source)
    ? await runWithStateRuntime(stateRuntime, () => createScriptingDbRuntime(ctx.rawDocument, () => {
        runtime?.markMutated();
      }))
    : null;
  runtime = runWithStateRuntime(stateRuntime, () => createScriptingRuntime({
    document: ctx.rawDocument,
    db: database?.api,
    plugins: createScriptingPluginsApi(ctx.rawDocument, {
      allowAsync: true,
      requireDocumentPermission: false,
      onMutation: () => runtime?.markMutated(),
    }),
    renderOnMutation: false,
  }));
  const doc = buildPowerDoc(ctx, dialogRoot, runtime, stateRuntime, registerCleanup);
  if (database) registerCleanup(() => database.dispose());

  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const cleanup of Array.from(cleanups).reverse()) {
      try {
        cleanup();
      } catch (error) {
        console.error('[hvy:power-scripting] cleanup threw', error);
      }
    }
    cleanups.clear();
  };

  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => (...values: unknown[]) => Promise<unknown>;
    const execute = new AsyncFunction('doc', source);
    const returned = await execute(doc);
    if (typeof returned === 'function') registerCleanup(returned as Cleanup);
    report('Power script running.');
  } catch (error) {
    stop();
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    report(message, true);
  }

  return { source, stop };
}

function build(ctx: HvyPluginContext): HvyPluginInstance {
  const root = document.createElement('div');
  root.className = `hvy-power-script hvy-power-script-${ctx.mode}`;
  const runtime = getActiveStateRuntime();
  let running: RunningProgram | null = null;
  let startingSource: string | null = null;
  let sessionChoice: 'prompt' | 'enabled' | 'hidden' = getPowerScriptingModeForDocument(ctx.rawDocument, runtime);
  let startNonce = 0;

  const stop = () => {
    startNonce += 1;
    running?.stop();
    running = null;
    startingSource = null;
  };

  const renderEditor = () => {
    root.replaceChildren();
    const notice = document.createElement('div');
    notice.className = 'hvy-power-script-editor-notice';
    notice.textContent = 'Trusted JavaScript. This code runs only in Viewer mode after authorization.';
    const editor = document.createElement('textarea');
    editor.className = 'hvy-power-script-source';
    editor.spellcheck = false;
    editor.value = ctx.block.text;
    editor.addEventListener('input', () => ctx.setText(editor.value));
    root.append(notice, editor);
  };

  const status = (message: string, error = false) => {
    let output = root.querySelector<HTMLElement>('[data-power-script-status]');
    if (!error) {
      output?.remove();
      return;
    }
    if (!output) {
      output = document.createElement('pre');
      output.dataset.powerScriptStatus = 'true';
      root.appendChild(output);
    }
    output.classList.toggle('is-error', error);
    output.textContent = message;
  };

  const execute = () => {
    if (ctx.view !== 'viewer' || sessionChoice !== 'enabled') return;
    const source = ctx.block.text;
    if (running?.source === source || startingSource === source) return;
    stop();
    startingSource = source;
    const nonce = ++startNonce;
    status('Starting trusted JavaScript…');
    void startProgram(ctx, root, source, runtime, status).then((program) => {
      if (startingSource === source) startingSource = null;
      if (nonce !== startNonce || sessionChoice !== 'enabled' || ctx.view !== 'viewer') {
        program.stop();
        return;
      }
      running = program;
    });
  };

  const renderPrompt = () => {
    root.replaceChildren();
    const warning = document.createElement('div');
    warning.className = 'hvy-power-script-warning';
    const title = document.createElement('strong');
    title.textContent = 'This document contains unrestricted JavaScript';
    const detail = document.createElement('p');
    detail.textContent = 'Enable it only if you trust the document author. It can access this page, browser APIs, and document data.';
    const actions = document.createElement('div');
    actions.className = 'hvy-power-script-actions';
    const enable = document.createElement('button');
    enable.type = 'button';
    enable.className = 'primary';
    enable.textContent = 'Enable power script';
    enable.addEventListener('click', () => {
      sessionChoice = 'enabled';
      setPowerScriptAccepted(ctx.rawDocument, true, runtime);
      renderViewer();
    });
    const hide = document.createElement('button');
    hide.type = 'button';
    hide.className = 'ghost';
    hide.textContent = 'Hide without running';
    hide.addEventListener('click', () => {
      sessionChoice = 'hidden';
      stop();
      root.hidden = true;
    });
    actions.append(enable, hide);
    warning.append(title, detail, actions);
    root.appendChild(warning);
  };

  const renderViewer = () => {
    root.hidden = sessionChoice === 'hidden';
    if (sessionChoice === 'hidden') {
      stop();
      return;
    }
    if (sessionChoice === 'prompt') {
      stop();
      renderPrompt();
      return;
    }
    if (running?.source === ctx.block.text || startingSource === ctx.block.text) {
      return;
    }
    root.replaceChildren();
    execute();
  };

  const refresh = () => {
    if (ctx.view !== 'viewer') {
      stop();
      if (ctx.mode === 'editor') {
        const editor = root.querySelector<HTMLTextAreaElement>('.hvy-power-script-source');
        if (editor === document.activeElement) return;
        renderEditor();
      } else {
        root.replaceChildren();
        const message = document.createElement('div');
        message.className = 'hvy-power-script-disabled-view';
        message.textContent = 'Power scripts do not run in this view.';
        root.appendChild(message);
      }
      return;
    }
    renderViewer();
  };

  refresh();
  return { element: root, refresh, unmount: stop };
}

export const powerScriptingPluginFactory: HvyPluginFactory = build;

export const powerScriptingPlugin: HvyPlugin = {
  ...createBuiltInPluginMetadata(POWER_SCRIPTING_PLUGIN_ID),
  displayName: 'Power Scripting',
  documentation: { filename: 'about-power-scripting.txt', text: powerScriptingDocumentation },
  aiHint: 'Viewer-only unrestricted JavaScript. Source code lives in plugin.txt and requires explicit trust.',
  aiHelp: `Use \`<!--hvy:plugin {"plugin":"${POWER_SCRIPTING_PLUGIN_ID}"}-->\`. JavaScript receives the existing document API as \`doc\`, plus \`doc.canvas\`, \`doc.animation\`, \`doc.listen\`, and \`doc.onCleanup\`.`,
  create: powerScriptingPluginFactory,
};
