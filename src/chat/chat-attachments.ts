import type { ChatAttachment, ChatState } from '../types';

export const CHAT_PASTE_ATTACHMENT_THRESHOLD = 2_000;

export function createPastedChatAttachment(chat: ChatState, text: string): ChatAttachment {
  const usedNames = new Set(chat.attachments.map((attachment) => attachment.name));
  let index = 1;
  while (usedNames.has(`Pasted text ${index}.txt`)) {
    index += 1;
  }
  return {
    id: crypto.randomUUID(),
    name: `Pasted text ${index}.txt`,
    text,
    characterCount: text.length,
    lineCount: countTextLines(text),
  };
}

export function getPendingChatAttachments(chat: ChatState): ChatAttachment[] {
  const pendingIds = new Set(chat.pendingAttachmentIds);
  return chat.attachments.filter((attachment) => pendingIds.has(attachment.id));
}

export function removePendingChatAttachment(chat: ChatState, id: string): ChatAttachment | null {
  if (!chat.pendingAttachmentIds.includes(id)) {
    return null;
  }
  const attachment = chat.attachments.find((candidate) => candidate.id === id) ?? null;
  chat.pendingAttachmentIds = chat.pendingAttachmentIds.filter((candidate) => candidate !== id);
  chat.attachments = chat.attachments.filter((candidate) => candidate.id !== id);
  return attachment;
}

export function appendTextAtSelection(
  textarea: HTMLTextAreaElement,
  text: string
): { value: string; selection: number } {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? start;
  return {
    value: `${textarea.value.slice(0, start)}${text}${textarea.value.slice(end)}`,
    selection: start + text.length,
  };
}

function countTextLines(text: string): number {
  if (!text) {
    return 0;
  }
  return text.split(/\r\n|\r|\n/).length;
}
