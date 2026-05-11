import { findBlockByIds } from '../../../block-ops';
import { requestProxyCompletion } from '../../../chat/chat';
import { recordHistory } from '../../../history';
import { runUserScript } from '../../../plugins/scripting/wrapper';
import { state, getRefreshReaderPanels, getRenderApp } from '../../../state';
import type { ChatMessage } from '../../../types';

const runningButtons = new Set<string>();

function buttonKey(sectionKey: string, blockId: string): string {
  return `${sectionKey}:${blockId}`;
}

function coerceReturnedText(value: unknown): string {
  if (value === null || typeof value === 'undefined') {
    return '';
  }
  return String(value).trim();
}

function coerceReturnedBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized.length > 0 && normalized !== 'false' && normalized !== '0' && normalized !== 'none';
  }
  return !!value;
}

export async function runButtonVisibilityScripts(root: ParentNode): Promise<void> {
  const buttons = Array.from(root.querySelectorAll<HTMLElement>('[data-hvy-button="true"]'));
  await Promise.all(buttons.map(async (element) => {
    const sectionKey = element.dataset.sectionKey ?? '';
    const blockId = element.dataset.blockId ?? '';
    const block = findBlockByIds(sectionKey, blockId);
    if (!block) {
      element.dataset.visibleState = 'hidden';
      return;
    }
    const source = block.schema.buttonVisibleScript.trim();
    if (!source) {
      element.dataset.visibleState = 'visible';
      return;
    }
    element.dataset.visibleState = 'pending';
    const result = await runUserScript({
      document: state.document,
      source,
      componentId: block.schema.id || block.id,
    });
    if (!element.isConnected) {
      return;
    }
    if (!result.ok) {
      element.dataset.visibleState = 'hidden';
      const status = element.querySelector<HTMLElement>('[data-hvy-button-status="true"]');
      if (status) {
        status.textContent = result.error ?? 'Visibility script failed.';
        status.classList.add('is-error');
      }
      return;
    }
    element.dataset.visibleState = coerceReturnedBoolean(result.returnValue) ? 'visible' : 'hidden';
  }));
}

export async function runButtonAiGenerate(app: HTMLElement, actionButton: HTMLElement, sectionKey: string, blockId: string): Promise<void> {
  const key = buttonKey(sectionKey, blockId);
  if (runningButtons.has(key)) {
    return;
  }
  const block = findBlockByIds(sectionKey, blockId);
  if (!block || block.schema.buttonAction !== 'ai-generate') {
    return;
  }

  const root = actionButton.closest<HTMLElement>('[data-hvy-button="true"]');
  const status = root?.querySelector<HTMLElement>('[data-hvy-button-status="true"]') ?? null;
  const setStatus = (message: string, error = false) => {
    if (status) {
      status.textContent = message;
      status.classList.toggle('is-error', error);
    }
  };

  runningButtons.add(key);
  actionButton.setAttribute('disabled', 'true');
  setStatus('Preparing...');
  try {
    const sourceResult = await runUserScript({
      document: state.document,
      source: block.schema.buttonSourceScript,
      componentId: block.schema.id || block.id,
    });
    if (!sourceResult.ok) {
      throw new Error(sourceResult.error ?? 'Source script failed.');
    }
    const source = coerceReturnedText(sourceResult.returnValue);
    if (!source) {
      setStatus('Nothing to generate.');
      return;
    }
    if (source.length > block.schema.buttonInputCharLimit) {
      throw new Error(`Generation input exceeds ${block.schema.buttonInputCharLimit} characters.`);
    }

    setStatus('Generating...');
    const prompt = block.schema.buttonPrompt.trim() || 'Generate the requested text. Return only the generated text.';
    const messages: ChatMessage[] = [{
      id: crypto.randomUUID(),
      role: 'user',
      content: prompt,
    }];
    const response = await requestProxyCompletion({
      settings: state.chat.settings,
      messages,
      context: `Button generation input:\n${source}`,
      responseInstructions: 'Return only the generated text. Do not include Markdown fences, explanations, or labels.',
      mode: 'qa',
      debugLabel: 'button-ai-generate',
    });
    if (response.length > block.schema.buttonOutputCharLimit) {
      throw new Error(`Generation output exceeds ${block.schema.buttonOutputCharLimit} characters.`);
    }

    setStatus('Applying...');
    recordHistory(`button:${block.id}:ai-generate`);
    const targetResult = await runUserScript({
      document: state.document,
      source: block.schema.buttonTargetScript,
      componentId: block.schema.id || block.id,
      injectedGlobals: {
        response,
        source,
      },
    });
    if (!targetResult.ok) {
      throw new Error(targetResult.error ?? 'Target script failed.');
    }
    setStatus('Done.');
    getRefreshReaderPanels()();
    getRenderApp()();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Generation failed.', true);
  } finally {
    runningButtons.delete(key);
    actionButton.removeAttribute('disabled');
    void runButtonVisibilityScripts(app);
  }
}
