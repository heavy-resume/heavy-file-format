import './ai-edit.css';
import { DEFAULT_OPENAI_COMPACTION_MODEL } from './chat/chat';
import type { AppState } from './types';

interface AiModeUiDeps {
  escapeAttr: (value: string) => string;
  escapeHtml: (value: string) => string;
}

export function renderAiModeHint(state: AppState, deps: AiModeUiDeps): string {
  if (state.currentView !== 'ai' || state.aiModeTipDismissed) {
    return '';
  }
  return `<button type="button" class="ai-view-hint" data-action="dismiss-ai-mode-tip" aria-label="Dismiss AI editing tip">
    <span class="ai-view-hint-desktop">${deps.escapeHtml('Double click or right click to edit or request changes.')}</span>
    <span class="ai-view-hint-touch">${deps.escapeHtml('On touch, double tap or tap and hold to edit or request changes.')}</span>
  </button>`;
}

export function renderAiEditPopover(state: AppState, deps: AiModeUiDeps): string {
  if (!state.aiEdit.sectionKey || !state.aiEdit.blockId) {
    return '';
  }
  if (state.aiEdit.isSending) {
    return '';
  }

  const popupStyle = `left: ${state.aiEdit.popupX}px; top: ${state.aiEdit.popupY}px;`;
  const providerLabel = state.chat.settings.provider === 'openai' ? 'OpenAI' : state.chat.settings.provider === 'qwen' ? 'Qwen' : 'Anthropic';

  return `
    <section class="ai-edit-popover" style="${deps.escapeAttr(popupStyle)}" aria-label="Request AI component changes">
      <div class="ai-edit-popover-head">
        <div>
          <h3>Request changes</h3>
        </div>
        <button type="button" class="ghost" data-action="close-ai-edit" aria-label="Close request changes">Close</button>
      </div>
      <div class="ai-edit-settings">
        <label class="chat-setting">
          <span>Provider</span>
          <select data-field="ai-provider" aria-label="AI edit provider">
            <option value="openai"${state.chat.settings.provider === 'openai' ? ' selected' : ''}>OpenAI</option>
            <option value="anthropic"${state.chat.settings.provider === 'anthropic' ? ' selected' : ''}>Anthropic</option>
            <option value="qwen"${state.chat.settings.provider === 'qwen' ? ' selected' : ''}>Qwen</option>
          </select>
        </label>

        <label class="chat-setting">
          <span>Model</span>
          <input
            type="text"
            data-field="ai-model"
            value="${deps.escapeAttr(state.chat.settings.model)}"
            placeholder="${deps.escapeAttr(providerLabel === 'OpenAI' ? 'gpt-5.4-mini' : providerLabel === 'Qwen' ? 'qwen-plus' : 'claude-sonnet-4-6')}"
            autocapitalize="off"
            autocomplete="off"
            spellcheck="false"
            aria-label="AI edit model"
          />
        </label>

        <label class="chat-setting">
          <span>Compaction provider</span>
          <select data-field="chat-compaction-provider" aria-label="AI edit compaction provider">
            <option value="openai"${(state.chat.settings.compactionProvider ?? 'openai') === 'openai' ? ' selected' : ''}>OpenAI</option>
            <option value="anthropic"${state.chat.settings.compactionProvider === 'anthropic' ? ' selected' : ''}>Anthropic</option>
          </select>
        </label>

        <label class="chat-setting">
          <span>Compaction model</span>
          <input
            type="text"
            data-field="chat-compaction-model"
            value="${deps.escapeAttr(state.chat.settings.compactionModel ?? DEFAULT_OPENAI_COMPACTION_MODEL)}"
            placeholder="${deps.escapeAttr(DEFAULT_OPENAI_COMPACTION_MODEL)}"
            autocapitalize="off"
            autocomplete="off"
            spellcheck="false"
            aria-label="AI edit compaction model"
          />
        </label>
      </div>
      ${state.aiEdit.error ? `<div class="ai-edit-error" role="alert">${deps.escapeHtml(state.aiEdit.error)}</div>` : ''}
      <form id="aiEditComposer" class="ai-edit-composer">
        <label class="chat-composer-field">
          <span>Change request</span>
          <textarea data-field="ai-edit-input" rows="5" placeholder="Describe what should change in this component...">${deps.escapeHtml(state.aiEdit.draft)}</textarea>
        </label>
        <div class="chat-composer-actions">
          <span class="chat-composer-status">Describe the change you want, then send.</span>
          <button type="submit" class="secondary">Send</button>
        </div>
      </form>
    </section>
  `;
}
