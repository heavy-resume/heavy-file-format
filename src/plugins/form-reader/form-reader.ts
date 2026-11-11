import type { HvyPluginContext } from '../types';
import type { ScriptingRunResult } from '../scripting/wrapper';
import { openScriptingErrorModal } from '../scripting/error-modal';
import { requestProxyCompletion } from '../../chat/chat';
import { sanitizeInlineCss } from '../../css-sanitizer';
import { recordHistory } from '../../history';
import { elapsedMs, logPerfTrace, nowMs } from '../../perf-trace';
import { getActiveStateRuntime, runWithStateRuntime } from '../../state';
import type { ChatMessage } from '../../types';
import { getDatabaseChangesSince, getDatabaseChangeRevision, type DatabaseChangeSnapshot } from '../../database-change-tracker';
import { createFormRangeDragTracker } from '../form-range-field/form-range-field';
import { reconcileLiveState } from '../form-live-state/form-live-state';
import { claimFormInitialization, type FormLifecycleState } from '../form-live-state/form-lifecycle';
import { FORM_PLUGIN_VERSION, parseFormSpec, type FormSpec } from '../form-spec/form-spec';
import { createFormScriptApi } from './form-script-api';
import { renderFormReaderField, type FormReaderFieldContext, type FormScriptRunOptions as FormFieldScriptRunOptions } from './form-reader-field';

interface FormScriptRunOptions extends FormFieldScriptRunOptions {
  databaseChanges?: DatabaseChangeSnapshot;
}

// Successful runs only surface a transient notice once they are expensive
// enough to be worth knowing about; cheap runs stay silent.
const RUN_NOTICE_MIN_STEPS = 1000;
const RUN_NOTICE_DURATION_MS = 2600;

function resultText(result: ScriptingRunResult): string {
  if (result.ok) {
    const steps = `${result.stepsExecuted.toLocaleString()}/${result.stepBudget.toLocaleString()} steps`;
    return result.toolCalls > 0
      ? `Script ran ${steps} with ${result.toolCalls} tool call${result.toolCalls === 1 ? '' : 's'}.`
      : `Script ran ${steps}.`;
  }
  return `Script error: ${result.error ?? 'unknown error'}`;
}

function coerceReturnedText(value: unknown): string {
  if (value === null || typeof value === 'undefined') {
    return '';
  }
  return String(value).trim();
}

export interface FormReaderMount {
  refresh(): void;
  unmount(): void;
}

export function mountFormReader(ctx: HvyPluginContext, root: HTMLElement, lifecycle: FormLifecycleState): FormReaderMount {
  const live = lifecycle.live;
  let statusText = '';
  let statusError = false;
  let statusErrorDetail: string | null = null;
  let runNotice: { text: string; shownAt: number } | null = null;
  let submitBusy = false;
  let runQueue = Promise.resolve();
  const inputTimers = new Map<string, number>();
  let renderedReaderText: string | null = null;
  let renderedReaderState: string | null = null;
  const rangeDrag = createFormRangeDragTracker();

  const parseCurrent = () => parseFormSpec(ctx.block.text, ctx.block.schema.pluginConfig);

  // Form scripts follow the viewer-script rule (HVY-SPEC 7.14): they run in the
  // viewer and AI views, never in the editor, including its passive previews.
  const canRunFormScripts = (): boolean => ctx.view !== 'editor';

  const runFormScript = async (
    scriptName: string,
    reason: string,
    options: FormScriptRunOptions & { injectedGlobals?: Record<string, unknown> } = {}
  ): Promise<ScriptingRunResult> => {
    const name = scriptName.trim();
    const { spec } = parseCurrent();
    const source = spec.scripts[name];
    if (name.length === 0 || typeof source !== 'string') {
      return {
        ok: false,
        error: name.length === 0 ? 'Script name is empty.' : `Script "${name}" is not defined.`,
        stepsExecuted: 0,
        stepBudget: 100_000,
        linesExecuted: 0,
        toolCalls: 0,
        logs: [],
      };
    }
    const { runUserScript } = await import('../scripting/wrapper');
    return runUserScript({
      document: ctx.rawDocument,
      source,
      componentId: `${ctx.block.schema.id || ctx.block.id}:${name}:${reason}`,
      pluginVersion: String(ctx.block.schema.pluginConfig.version ?? FORM_PLUGIN_VERSION),
      maxLines: spec.scriptStepBudget,
      form: createFormScriptApi({ live, getSpec: () => parseCurrent().spec, render: renderReader }),
      injectedGlobals: options.injectedGlobals,
      libraries: spec.scriptLibraries,
      databaseChanges: options.databaseChanges,
      startedByUser: options.startedByUser,
      onCallbackError: (callbackResult) => {
        statusText = resultText(callbackResult);
        statusError = true;
        statusErrorDetail = callbackResult.errorDetail ?? callbackResult.error ?? 'Unknown script error.';
        renderReader();
      },
    });
  };

  const runNamedScript = (scriptName: string, reason: string, options: FormScriptRunOptions = {}): void => {
    const name = scriptName.trim();
    if (name.length === 0 || !canRunFormScripts()) {
      return;
    }
    const { spec } = parseCurrent();
    if (typeof spec.scripts[name] !== 'string') {
      statusText = `Script "${name}" is not defined.`;
      statusError = true;
      renderReader();
      return;
    }
    runQueue = runQueue
      .then(() => {
        const startedAt = nowMs();
        logPerfTrace('form-script:start', {
          scriptName: name,
          reason,
          componentId: ctx.block.schema.id || ctx.block.id,
        });
        return runFormScript(name, reason, options).then((result) => {
          logPerfTrace('form-script:end', {
            scriptName: name,
            reason,
            componentId: ctx.block.schema.id || ctx.block.id,
            ok: result.ok,
            elapsedMs: elapsedMs(startedAt),
            stepsExecuted: result.stepsExecuted,
            toolCalls: result.toolCalls,
          });
          return result;
        });
      })
      .then((result) => {
        statusText = result.ok ? '' : resultText(result);
        statusError = !result.ok;
        statusErrorDetail = result.ok ? null : result.errorDetail ?? result.error ?? 'Unknown script error.';
        runNotice = result.ok && result.stepsExecuted >= RUN_NOTICE_MIN_STEPS
          ? { text: resultText(result), shownAt: performance.now() }
          : null;
        renderReader();
      })
      .catch((error) => {
        statusText = error instanceof Error ? error.message : 'Script failed.';
        statusError = true;
        statusErrorDetail = error instanceof Error ? error.stack ?? error.message : String(error);
        renderReader();
      });
  };

  const buildDefaultAiSource = (): string => JSON.stringify(live.values, null, 2);

  const runAiSubmit = (startedByUser: boolean): void => {
    if (submitBusy) {
      return;
    }
    const runtime = getActiveStateRuntime();
    const inFormRuntime = <T>(action: () => T): T => runWithStateRuntime(runtime, action);
    const { spec } = parseCurrent();
    submitBusy = true;
    statusText = 'Preparing...';
    statusError = false;
    statusErrorDetail = null;
    renderReader();
    runQueue = runQueue
      .then(async () => {
        let source = buildDefaultAiSource();
        if (spec.submitSourceScript.trim().length > 0) {
          const sourceResult = await runFormScript(spec.submitSourceScript, 'submit-source', { startedByUser });
          if (!sourceResult.ok) {
            throw new Error(sourceResult.error ?? 'Submit source script failed.');
          }
          source = coerceReturnedText(sourceResult.returnValue);
        }
        if (source.length === 0) {
          statusText = 'Nothing to generate.';
          statusError = false;
          return;
        }
        if (source.length > spec.submitInputCharLimit) {
          throw new Error(`Generation input exceeds ${spec.submitInputCharLimit} characters.`);
        }
        statusText = 'Generating...';
        statusError = false;
        renderReader();
        const prompt = spec.submitPrompt.trim() || 'Generate the requested text. Return only the generated text.';
        const messages: ChatMessage[] = [{
          id: crypto.randomUUID(),
          role: 'user',
          content: prompt,
        }];
        const response = await inFormRuntime(() => requestProxyCompletion({
          settings: runtime.state.chat.settings,
          messages,
          context: `Form generation input:\n${source}`,
          responseInstructions: 'Return only the generated text. Do not include Markdown fences, explanations, or labels.',
          mode: 'qa',
          debugLabel: 'form-ai-generate',
        }));
        if (response.length > spec.submitOutputCharLimit) {
          throw new Error(`Generation output exceeds ${spec.submitOutputCharLimit} characters.`);
        }
        if (spec.submitScript.trim().length === 0) {
          throw new Error('AI form submit requires submitScript to apply the generated response.');
        }
        statusText = 'Applying...';
        statusError = false;
        renderReader();
        inFormRuntime(() => recordHistory(`form:${ctx.block.id}:ai-generate`));
        const targetResult = await runFormScript(spec.submitScript, 'submit-target', { injectedGlobals: { response, source }, startedByUser });
        if (!targetResult.ok) {
          throw new Error(targetResult.error ?? 'Submit target script failed.');
        }
        statusText = 'Done.';
        statusError = false;
      })
      .catch((error) => {
        statusText = error instanceof Error ? error.message : 'AI submit failed.';
        statusError = true;
        statusErrorDetail = error instanceof Error ? error.stack ?? error.message : String(error);
      })
      .finally(() => {
        submitBusy = false;
        renderReader();
      });
  };

  const fieldContext: FormReaderFieldContext = {
    ctx,
    live,
    rangeDrag,
    inputTimers,
    runNamedScript,
    renderReader: () => renderReader(),
  };

  function renderReader(): void {
    const block = ctx.block;
    const getReaderState = () => JSON.stringify([block.id, block.schema.pluginConfig, ctx.view, live, statusText, statusError, statusErrorDetail, submitBusy]);
    // Most refreshes change nothing this form shows, so this returns before parsing its spec.
    if (block.text === renderedReaderText && getReaderState() === renderedReaderState && !runNotice) {
      runReaderLifecycle(() => parseFormSpec(block.text, block.schema.pluginConfig).spec);
      return;
    }
    const { spec, error } = parseFormSpec(block.text, block.schema.pluginConfig);
    reconcileLiveState(live, spec);
    renderedReaderText = error ? null : block.text;
    renderedReaderState = getReaderState();
    const focus = captureReaderFocus();
    root.innerHTML = '';
    if (error) {
      const errorBox = document.createElement('div');
      errorBox.className = 'hvy-form-error';
      errorBox.textContent = `Form YAML error: ${error}`;
      root.appendChild(errorBox);
      return;
    }

    const form = document.createElement('form');
    form.className = 'hvy-form-reader-form';
    form.noValidate = false;
    if (spec.formCss.trim().length > 0) {
      form.setAttribute('style', sanitizeInlineCss(spec.formCss));
    }
    spec.fields.forEach((field) => form.appendChild(renderFormReaderField(field, fieldContext)));
    if (spec.showSubmit) {
      const actions = document.createElement('div');
      actions.className = 'hvy-form-actions';
      if (spec.actionsCss.trim().length > 0) {
        actions.setAttribute('style', sanitizeInlineCss(spec.actionsCss));
      }
      const submit = document.createElement('button');
      submit.type = 'submit';
      submit.className = 'secondary';
      submit.textContent = submitBusy ? 'Generating...' : spec.submitLabel || 'Submit';
      submit.disabled = submitBusy || live.submit.disabled;
      if (submitBusy) submit.setAttribute('aria-busy', 'true');
      if (spec.submitCss.trim().length > 0) {
        submit.setAttribute('style', sanitizeInlineCss(spec.submitCss));
      }
      actions.appendChild(submit);
      if (live.submit.disabled && live.submit.reason.trim().length > 0) {
        const reason = document.createElement('div');
        reason.className = 'hvy-form-submit-reason';
        reason.id = `hvy-form-submit-reason-${block.id}`;
        reason.textContent = live.submit.reason;
        submit.setAttribute('aria-describedby', reason.id);
        actions.appendChild(reason);
      }
      form.appendChild(actions);
    }
    root.appendChild(form);

    if (statusText.length > 0) {
      const status = document.createElement('div');
      status.className = `hvy-form-status${statusError ? ' hvy-form-status-error' : ''}`;
      const statusMessage = document.createElement('span');
      statusMessage.textContent = statusText;
      status.appendChild(statusMessage);
      if (statusError && statusErrorDetail) {
        const tracebackButton = document.createElement('button');
        tracebackButton.type = 'button';
        tracebackButton.className = 'hvy-form-traceback-button';
        tracebackButton.setAttribute('aria-label', 'Show script traceback');
        tracebackButton.title = 'Show script traceback';
        tracebackButton.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 4.25v4.5M8 11.5v.25"/></svg>';
        tracebackButton.addEventListener('click', () => openScriptingErrorModal(statusErrorDetail ?? statusText, tracebackButton));
        status.appendChild(tracebackButton);
      }
      root.appendChild(status);
    }
    renderRunNotice();
    restoreReaderFocus(focus);
    runReaderLifecycle(() => spec);
  }

  function runReaderLifecycle(getSpec: () => FormSpec): void {
    if (!canRunFormScripts()) {
      return;
    }
    const initializing = claimFormInitialization(ctx.rawDocument, ctx.block);
    if (initializing) {
      lifecycle.lastDatabaseRevision = getDatabaseChangeRevision(ctx.rawDocument);
      const { initialScript } = getSpec();
      if (initialScript.trim().length > 0) {
        runNamedScript(initialScript, 'initial');
      }
    } else if (lifecycle.initialized) {
      const databaseChanges = getDatabaseChangesSince(ctx.rawDocument, lifecycle.lastDatabaseRevision);
      if (databaseChanges.revision > lifecycle.lastDatabaseRevision) {
        lifecycle.lastDatabaseRevision = databaseChanges.revision;
        runNamedScript(getSpec().changeScript, 'change', { databaseChanges });
      }
    }
  }

  // The notice floats over the form so it never shifts document layout. Reader
  // rebuilds resume its fade where it left off instead of restarting it.
  function renderRunNotice(): void {
    const notice = runNotice;
    if (!notice) return;
    const elapsed = performance.now() - notice.shownAt;
    if (elapsed >= RUN_NOTICE_DURATION_MS) {
      runNotice = null;
      return;
    }
    const popover = document.createElement('div');
    popover.className = 'hvy-form-run-notice';
    popover.setAttribute('role', 'status');
    popover.textContent = notice.text;
    popover.style.animationDuration = `${RUN_NOTICE_DURATION_MS}ms`;
    popover.style.animationDelay = `${-Math.round(elapsed)}ms`;
    popover.addEventListener('animationend', () => {
      if (runNotice === notice) runNotice = null;
      popover.remove();
    });
    root.appendChild(popover);
  }

  // Scripts (including debounced input triggers) rebuild the reader form, so
  // carry focus and caret across to the equivalent new control.
  function captureReaderFocus(): ReaderFocus | null {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !root.contains(active)) {
      return null;
    }
    const selection = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
      ? { start: readSelectionOffset(active, 'selectionStart'), end: readSelectionOffset(active, 'selectionEnd') }
      : null;
    if (active.dataset.formFieldLabel !== undefined) {
      const selector = `[data-form-control][data-form-field-label="${CSS.escape(active.dataset.formFieldLabel)}"]`
        + (active instanceof HTMLInputElement && active.type === 'radio' ? `[value="${CSS.escape(active.value)}"]` : '');
      return { selector, selection };
    }
    if (active instanceof HTMLButtonElement && active.type === 'submit') {
      return { selector: 'button[type="submit"]', selection: null };
    }
    return null;
  }

  function restoreReaderFocus(focus: ReaderFocus | null): void {
    const target = focus ? root.querySelector<HTMLElement>(focus.selector) : null;
    if (!focus || !target || (target instanceof HTMLButtonElement && target.disabled)) {
      return;
    }
    target.focus({ preventScroll: true });
    if (focus.selection && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      try {
        target.setSelectionRange(focus.selection.start, focus.selection.end);
      } catch {
        // Input types such as number and email do not support selection ranges.
      }
    }
  }

  const onSubmit = (event: Event) => {
    event.preventDefault();
    if (!canRunFormScripts()) {
      return;
    }
    if (live.submit.disabled) {
      return;
    }
    const { spec } = parseCurrent();
    if (spec.submitAction === 'ai-generate') {
      runAiSubmit(event.isTrusted);
      return;
    }
    runNamedScript(spec.submitScript, 'submit', { startedByUser: event.isTrusted });
  };

  root.addEventListener('submit', onSubmit);

  return {
    refresh: renderReader,
    unmount: () => {
      root.removeEventListener('submit', onSubmit);
      rangeDrag.dispose();
      for (const timer of inputTimers.values()) {
        window.clearTimeout(timer);
      }
    },
  };
}

interface ReaderFocus {
  selector: string;
  selection: { start: number; end: number } | null;
}

function readSelectionOffset(control: HTMLInputElement | HTMLTextAreaElement, key: 'selectionStart' | 'selectionEnd'): number {
  try {
    return control[key] ?? control.value.length;
  } catch {
    return control.value.length;
  }
}
