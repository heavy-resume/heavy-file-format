import { getTextProcessingSettings, hasHostChatClient, persistChatSettings, shouldRenderChatProviderControls } from '../../../chat/chat';
import { runWithStateRuntime, type StateRuntime } from '../../../state';
import type { ChatSettings } from '../../../types';
import { escapeAttr } from '../../../utils';

export function renderTextAiSettings(settings: ChatSettings): string {
  if (hasHostChatClient() || !shouldRenderChatProviderControls()) return '';
  const provider = settings.textProcessingProvider;
  const model = settings.textProcessingModel ?? '';
  return `<details class="text-ai-settings"${getTextProcessingSettings(settings) ? '' : ' open'}><summary>Model settings</summary>
    <div class="chat-settings">
      <label class="chat-setting"><span>Provider</span><select data-text-processing-provider aria-label="Text processing provider">
        <option value=""${!provider ? ' selected' : ''}>Not set</option>
        <option value="openai"${provider === 'openai' ? ' selected' : ''}>OpenAI</option>
        <option value="anthropic"${provider === 'anthropic' ? ' selected' : ''}>Anthropic</option>
        <option value="qwen"${provider === 'qwen' ? ' selected' : ''}>Qwen</option>
      </select></label>
      <label class="chat-setting"><span>Model</span><input data-text-processing-model aria-label="Text processing model" value="${escapeAttr(model)}" placeholder="Not set" autocapitalize="off" autocomplete="off" spellcheck="false"></label>
    </div>
  </details>`;
}

export function bindTextAiSettings(modal: HTMLElement, runtime: StateRuntime, onChange: () => void): void {
  const provider = modal.querySelector<HTMLSelectElement>('[data-text-processing-provider]');
  const model = modal.querySelector<HTMLInputElement>('[data-text-processing-model]');
  if (!provider || !model) return;
  model.addEventListener('input', () => runWithStateRuntime(runtime, () => {
    runtime.state.chat.settings.textProcessingModel = model.value.trim() || null;
    persistChatSettings(runtime.state.chat.settings);
    onChange();
  }));
  provider.addEventListener('change', () => runWithStateRuntime(runtime, () => {
    const settings = runtime.state.chat.settings;
    settings.textProcessingProvider = provider.value ? provider.value as ChatSettings['provider'] : null;
    model.value = '';
    settings.textProcessingModel = null;
    persistChatSettings(settings);
    onChange();
  }));
}
