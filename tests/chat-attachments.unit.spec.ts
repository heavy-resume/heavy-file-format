import { expect, test } from 'vitest';

import {
  CHAT_PASTE_ATTACHMENT_THRESHOLD,
  appendTextAtSelection,
  createPastedChatAttachment,
  removePendingChatAttachment,
} from '../src/chat/chat-attachments';
import { createDefaultChatState } from '../src/chat/chat';

test('expected result: pasted chat attachments retain text outside message content', () => {
  const chat = createDefaultChatState();
  const text = `${'A'.repeat(CHAT_PASTE_ATTACHMENT_THRESHOLD - 1)}\nB`;

  const attachment = createPastedChatAttachment(chat, text);
  chat.attachments.push(attachment);
  chat.pendingAttachmentIds.push(attachment.id);

  expect(attachment).toEqual(expect.objectContaining({
    name: 'Pasted text 1.txt',
    text,
    characterCount: text.length,
    lineCount: 2,
  }));
  expect(chat.messages).toEqual([]);
});

test('expected result: removing a pending attachment removes its stored text', () => {
  const chat = createDefaultChatState();
  const attachment = createPastedChatAttachment(chat, 'Source facts');
  chat.attachments.push(attachment);
  chat.pendingAttachmentIds.push(attachment.id);

  expect(removePendingChatAttachment(chat, attachment.id)).toEqual(attachment);
  expect(chat.attachments).toEqual([]);
  expect(chat.pendingAttachmentIds).toEqual([]);
});

test('expected result: restored attachment text inserts at the textarea selection', () => {
  const textarea = {
    value: 'Update  please',
    selectionStart: 7,
    selectionEnd: 7,
  } as HTMLTextAreaElement;

  expect(appendTextAtSelection(textarea, 'from this')).toEqual({
    value: 'Update from this please',
    selection: 16,
  });
});
