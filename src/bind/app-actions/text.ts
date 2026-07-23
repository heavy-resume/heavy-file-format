import { findBlockByIds } from '../../block-ops';
import { copyTextToClipboard, type CopyPayload } from '../../clipboard';
import type { AppActionHandler } from './types';

const copyTextComponent: AppActionHandler = ({ actionButton, sectionKey, blockId }) => {
  const block = findBlockByIds(sectionKey, blockId);
  if (!block) {
    return;
  }
  const copyPayload = getRenderedCopyPayload(actionButton) ?? { plainText: block.text, html: null };
  void copyTextToClipboard(copyPayload).then((ok) => {
    if (!ok) {
      actionButton.classList.remove('is-copied');
      actionButton.setAttribute('aria-label', 'Copy failed');
      actionButton.setAttribute('title', 'Copy failed');
      return;
    }
    actionButton.classList.add('is-copied');
    actionButton.setAttribute('aria-label', 'Copied');
    actionButton.setAttribute('title', 'Copied');
    window.setTimeout(() => {
      actionButton.classList.remove('is-copied');
      actionButton.setAttribute('aria-label', 'Copy text');
      actionButton.setAttribute('title', 'Copy text');
    }, 1200);
  });
};

function getRenderedCopyPayload(actionButton: HTMLElement): CopyPayload | null {
  const readerBlock = actionButton.closest<HTMLElement>('.reader-block');
  if (!readerBlock) {
    return null;
  }
  const clone = readerBlock.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.text-copy-button').forEach((button) => button.remove());
  return {
    plainText: (clone.innerText || clone.textContent || '').trim(),
    html: clone.innerHTML.trim(),
  };
}

export const textActions: Record<string, AppActionHandler> = {
  'copy-text-component': copyTextComponent,
};
