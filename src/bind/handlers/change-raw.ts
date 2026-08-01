import { state, getRenderApp, getDefaultModelForProvider, persistChatSettings, showInlineAnswerModeSwitchForInput } from './_imports';

export function bindChangeRaw(app: HTMLElement): void {
  app.addEventListener('change', (event) => {
    const target = event.target as HTMLElement | null;
    if (target instanceof HTMLSelectElement && target.dataset.field === 'chat-compaction-provider') {
      if (state.chat.isSending || state.aiEdit.isSending) {
        return;
      }
      state.chat.settings.compactionProvider = target.value === 'anthropic' ? 'anthropic' : 'openai';
      persistChatSettings(state.chat.settings);
      state.chat.error = null;
      state.aiEdit.error = null;
      getRenderApp()();
      return;
    }
    if (target instanceof HTMLSelectElement && target.dataset.field === 'chat-context-mode') {
      if (state.chat.isSending) {
        return;
      }
      const mode = target.value === 'full-document'
        ? 'full-document'
        : target.value === 'embedding-retrieval'
        ? 'embedding-retrieval'
        : 'keyword-retrieval';
      state.chatContext = {
        ...(state.chatContext ?? {}),
        mode,
        ...(mode === 'embedding-retrieval' && !state.chatContext?.embeddingModel ? { embeddingModel: 'text-embedding-ada-002' } : {}),
      };
      state.chat.error = null;
      state.chat.status = null;
      getRenderApp()();
      return;
    }
    if (target instanceof HTMLSelectElement && (target.dataset.field === 'chat-provider' || target.dataset.field === 'ai-provider')) {
      if (state.chat.isSending || state.aiEdit.isSending) {
        return;
      }
      const previousProvider = state.chat.settings.provider;
      const previousModel = state.chat.settings.model.trim();
      state.chat.settings.provider = target.value === 'anthropic' || target.value === 'qwen' ? target.value : 'openai';
      if (
        state.chat.settings.provider === 'openai' &&
        (previousModel.length === 0 || previousModel === getDefaultModelForProvider(previousProvider))
      ) {
        state.chat.settings.model = getDefaultModelForProvider('openai');
      }
      if (
        state.chat.settings.provider === 'anthropic' &&
        (previousModel.length === 0 || previousModel === getDefaultModelForProvider(previousProvider))
      ) {
        state.chat.settings.model = getDefaultModelForProvider('anthropic');
      }
      if (
        state.chat.settings.provider === 'qwen' &&
        (previousModel.length === 0 || previousModel === getDefaultModelForProvider(previousProvider))
      ) {
        state.chat.settings.model = getDefaultModelForProvider('qwen');
      }
      persistChatSettings(state.chat.settings);
      state.chat.error = null;
      state.aiEdit.error = null;
      getRenderApp()();
      return;
    }
    const checkboxTarget = event.target;
    if (!(checkboxTarget instanceof HTMLInputElement) || (checkboxTarget.type !== 'checkbox' && checkboxTarget.type !== 'radio')) {
      return;
    }
    if (!checkboxTarget.closest('.rich-editor')) {
      return;
    }
    if (checkboxTarget.type === 'radio') {
      checkboxTarget.closest('.rich-editor')?.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(checkboxTarget.name)}"]`).forEach((radio) => {
        if (radio !== checkboxTarget) radio.removeAttribute('checked');
      });
    }
    if (checkboxTarget.checked) {
      checkboxTarget.setAttribute('checked', '');
    } else {
      checkboxTarget.removeAttribute('checked');
    }
    const editable = checkboxTarget.closest<HTMLElement>('.rich-editor');
    editable?.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const answerIndex = checkboxTarget.dataset.answerIndex;
    const currentInput = answerIndex
      ? app.querySelector<HTMLInputElement>(`.editor-block[data-active-editor-block="true"] .rich-editor input.hvy-inline-checkbox[data-answer-index="${CSS.escape(answerIndex)}"]`)
      : null;
    if (currentInput) showInlineAnswerModeSwitchForInput(currentInput);
  });
}
