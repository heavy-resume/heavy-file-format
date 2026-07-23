export type CopyPayload = {
  plainText: string;
  html: string | null;
};

export async function copyTextToClipboard(payload: CopyPayload): Promise<boolean> {
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
