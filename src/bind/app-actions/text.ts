import { findBlockByIds } from '../../block-ops';
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

type CopyPayload = {
  plainText: string;
  html: string | null;
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

async function copyTextToClipboard(payload: CopyPayload): Promise<boolean> {
  if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined' && payload.html) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([payload.html], { type: 'text/html' }),
          'text/plain': new Blob([payload.plainText], { type: 'text/plain' }),
        }),
      ]);
      return true;
    } catch {
      // Fall through to plain text copy paths.
    }
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(payload.plainText);
      return true;
    } catch {
      // Fall through to the textarea fallback.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = payload.plainText;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand('copy');
  } finally {
    textarea.remove();
  }
}

export const textActions: Record<string, AppActionHandler> = {
  'copy-text-component': copyTextComponent,
};
