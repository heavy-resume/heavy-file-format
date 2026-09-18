import { escapeAttr } from '../../../utils';
import { bindTextAiSettings, renderTextAiSettings } from './text-ai-settings';
import './text-ai-modal.css';
import { getTextProcessingSettings } from '../../../chat/chat';
import { closeIcon } from '../../../icons';
import { state, getActiveStateRuntime, runWithStateRuntime, getCachedComponentRenderHelpers } from '../../../state';
import { findBlockByIds, refreshReaderPanelsOutsideActiveEditor, refreshRichToolbarState } from '../../../block-ops';
import { recordHistory } from '../../../history';
import { syncReusableTemplateForBlock } from '../../../reusable';
import { syncSortValuesForDocument } from '../../../sort-values';
import { invalidateInlineAnswerGroupIndex } from '../../../inline-answer-groups';
import { renderTextRichEditorContent } from '../text/text';
import { requestTextAiOutput, TEXT_CLEAN_UP_INSTRUCTIONS } from './text-ai-request';

export function openTextAiModal(app: HTMLElement, trigger: HTMLElement): void {
  const sectionKey = trigger.dataset.sectionKey ?? '';
  const blockId = trigger.dataset.blockId ?? '';
  const block = findBlockByIds(sectionKey, blockId);
  const editable = trigger.closest('.text-editor-shell')?.querySelector<HTMLElement>('[data-field="block-rich"]');
  if (!block || block.schema.kind !== 'text' || block.schema.lock || !editable || app.querySelector('[data-text-ai-modal]')) return;
  const runtime = getActiveStateRuntime();
  const originalDocument = state.document;
  const original = block.text;
  const controller = new AbortController();
  const modal = document.createElement('div');
  modal.className = 'modal-root';
  modal.dataset.textAiModal = 'true';
  modal.innerHTML = `<div class="modal-overlay" data-text-ai-close></div>
    <section class="modal-panel text-ai-modal" role="dialog" aria-modal="true" aria-label="Process with AI">
      <div class="modal-head"><h3>Process with AI</h3><button type="button" class="ghost remove-x" data-text-ai-close aria-label="Close">${closeIcon()}</button></div>
      <form class="text-ai-form">
        <div class="text-ai-body">
        ${renderTextAiSettings(state.chat.settings)}
        <details class="text-ai-custom"><summary>Custom Instructions</summary>
          <textarea aria-label="Custom Instructions" placeholder="${escapeAttr(TEXT_CLEAN_UP_INSTRUCTIONS)}"></textarea>
        </details>
        </div>
        <button type="submit" class="secondary" data-text-ai-clean>Clean Up</button>
      </form>
      <p class="text-ai-status" role="status" aria-live="polite"></p>
    </section>`;
  const form = modal.querySelector<HTMLFormElement>('form')!;
  const input = modal.querySelector<HTMLTextAreaElement>('textarea')!;
  const status = modal.querySelector<HTMLElement>('[role="status"]')!;
  const clean = modal.querySelector<HTMLButtonElement>('[data-text-ai-clean]')!;
  let sending = false;
  const syncConfiguration = (updateStatus = true): void => {
    const configured = getTextProcessingSettings(runtime.state.chat.settings) !== null;
    clean.disabled = sending || !configured;
    if (!updateStatus) return;
    status.textContent = configured ? '' : modal.querySelector('.text-ai-settings')
      ? 'Text processing is not configured. Select a provider and model to continue.'
      : 'Text processing is not configured. The app host must set a provider and model.';
  };
  bindTextAiSettings(modal, runtime, syncConfiguration);
  syncConfiguration();
  const close = (): void => {
    controller.abort();
    modal.remove();
    if (editable.isConnected) editable.focus({ preventScroll: true });
  };
  const submit = async (instructions: string): Promise<void> => {
    if (sending || !instructions.trim()) return;
    sending = true;
    status.textContent = 'Processing…';
    modal.querySelectorAll<HTMLButtonElement | HTMLTextAreaElement | HTMLInputElement | HTMLSelectElement>('form button, textarea, .text-ai-settings input, .text-ai-settings select').forEach(element => { element.disabled = true; });
    try {
      const output = await runWithStateRuntime(runtime, () => requestTextAiOutput({
        original, instructions, settings: state.chat.settings, signal: controller.signal,
      }));
      if (controller.signal.aborted || !modal.isConnected) return;
      runWithStateRuntime(runtime, () => {
        if (state.document !== originalDocument || findBlockByIds(sectionKey, blockId) !== block || block.text !== original || block.schema.lock || !editable.isConnected) {
          throw new Error('This text changed while AI was processing. Close this dialog and try again.');
        }
        if (output !== original) {
          recordHistory(`text-ai:${crypto.randomUUID()}`);
          block.text = output;
          syncReusableTemplateForBlock(sectionKey, blockId);
          syncSortValuesForDocument(state.document);
          invalidateInlineAnswerGroupIndex();
          editable.innerHTML = renderTextRichEditorContent(sectionKey, block, getCachedComponentRenderHelpers());
          refreshRichToolbarState(editable);
          refreshReaderPanelsOutsideActiveEditor(editable);
        }
        close();
      });
    } catch (error) {
      if (!controller.signal.aborted) status.textContent = error instanceof Error ? error.message : 'Could not process this text. Try again.';
    } finally {
      sending = false;
      modal.querySelectorAll<HTMLButtonElement | HTMLTextAreaElement | HTMLInputElement | HTMLSelectElement>('form button, textarea, .text-ai-settings input, .text-ai-settings select').forEach(element => { element.disabled = false; });
      syncConfiguration(false);
    }
  };
  modal.addEventListener('click', event => {
    event.stopPropagation();
    if ((event.target as HTMLElement).closest('[data-text-ai-close]')) close();
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    void submit(input.value.trim() || TEXT_CLEAN_UP_INSTRUCTIONS);
  });
  modal.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Tab') {
      const controls = Array.from(modal.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), summary')).filter(element => element.getClientRects().length > 0);
      const next = event.shiftKey ? controls.at(-1)! : controls[0];
      if (document.activeElement === (event.shiftKey ? controls[0] : controls.at(-1))) { event.preventDefault(); next.focus(); }
    }
  });
  (trigger.closest('.editor-shell, .viewer-shell') ?? app).append(modal);
  (clean.disabled ? modal.querySelector<HTMLElement>('[data-text-processing-provider], [data-text-ai-close]') : clean)?.focus({ preventScroll: true });
}
