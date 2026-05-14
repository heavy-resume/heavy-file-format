import './button.css';
import type { ComponentEditorRenderer, ComponentReaderRenderer, ComponentRenderHelpers } from '../../component-helpers';
import type { VisualBlock } from '../../types';
import { sanitizeInlineCss } from '../../../css-sanitizer';
import { isButtonAiGenerateRunning } from './button-actions';

function renderButton(sectionKey: string, block: VisualBlock, helpers: ComponentRenderHelpers): string {
  const label = block.schema.buttonLabel.trim() || 'Generate';
  const style = sanitizeInlineCss(block.schema.buttonCss);
  const visibleState = block.schema.buttonVisibleScript.trim() ? 'pending' : 'visible';
  const isRunning = isButtonAiGenerateRunning(sectionKey, block.id);
  const statusId = `${block.id}-button-status`;
  return `<div
	    class="hvy-button-component"
	    data-hvy-button="true"
	    data-busy-state="${isRunning ? 'busy' : 'idle'}"
	    data-visible-state="${helpers.escapeAttr(visibleState)}"
    data-section-key="${helpers.escapeAttr(sectionKey)}"
    data-block-id="${helpers.escapeAttr(block.id)}"
    ${isRunning ? 'aria-busy="true"' : ''}
    style="${helpers.escapeAttr(style)}"
  >
    <button
      type="button"
      class="hvy-button-component-button"
      data-action="run-button-ai-generate"
      data-section-key="${helpers.escapeAttr(sectionKey)}"
      data-block-id="${helpers.escapeAttr(block.id)}"
      aria-describedby="${helpers.escapeAttr(statusId)}"
      ${isRunning ? 'disabled' : ''}
    >${helpers.escapeHtml(isRunning ? 'Generating...' : label)}</button>
    <span id="${helpers.escapeAttr(statusId)}" class="hvy-button-status" data-hvy-button-status="true">${isRunning ? 'Generating...' : ''}</span>
  </div>`;
}

export const renderButtonEditor: ComponentEditorRenderer = (sectionKey, block, helpers) =>
  renderButton(sectionKey, block, helpers);

export const renderButtonReader: ComponentReaderRenderer = (section, block, helpers) =>
  renderButton(section.key, block, helpers);
