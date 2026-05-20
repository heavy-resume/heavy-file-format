import { findBlockByIds, handleBlockFieldInput } from './block-ops';
import { runPluginDocumentHooks } from './plugins/hooks';
import { state } from './state';
import { saveSessionState } from './state-persistence';

export function commitTextFillInElement(target: HTMLElement | null | undefined, source = 'unknown'): boolean {
  if (target?.dataset.field !== 'text-fill-in-value') {
    console.debug('[hvy:fill-in-commit]', {
      source,
      skipped: 'not-text-fill-in',
      field: target?.dataset.field ?? null,
      tagName: target?.tagName ?? null,
      sectionKey: target?.dataset.sectionKey ?? null,
      blockId: target?.dataset.blockId ?? null,
    });
    return false;
  }
  const sectionKey = target.dataset.sectionKey ?? '';
  const blockId = target.dataset.blockId ?? '';
  const blockBefore = sectionKey && blockId ? findBlockByIds(sectionKey, blockId) : null;
  const textBefore = blockBefore?.text ?? null;
  const fillInBefore = blockBefore?.schema.fillIn ?? null;
  const handled = handleBlockFieldInput(target);
  if (handled) {
    saveSessionState(state);
    void runPluginDocumentHooks('edit');
  }
  const blockAfter = sectionKey && blockId ? findBlockByIds(sectionKey, blockId) : null;
  console.debug('[hvy:fill-in-commit]', {
    source,
    handled,
    sectionKey,
    blockId,
    fillIndex: target.dataset.fillIndex ?? null,
    placeholder: target.dataset.placeholder ?? null,
    domText: target.textContent ?? '',
    textBefore,
    textAfter: blockAfter?.text ?? null,
    fillInBefore,
    fillInAfter: blockAfter?.schema.fillIn ?? null,
    inAiReaderSurface: Boolean(target.closest('.hvy-ai-reader-surface')),
  });
  return handled;
}

export function commitActiveTextFillIn(source = 'unknown'): boolean {
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  if (!active || active.dataset.field !== 'text-fill-in-value') {
    console.debug('[hvy:fill-in-commit]', {
      source,
      skipped: active ? 'active-not-text-fill-in' : 'no-active-element',
      activeField: active?.dataset.field ?? null,
      activeTagName: active?.tagName ?? null,
      activeSectionKey: active?.dataset.sectionKey ?? null,
      activeBlockId: active?.dataset.blockId ?? null,
    });
  }
  return commitTextFillInElement(active, source);
}
