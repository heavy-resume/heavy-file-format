import { expect, test, vi } from 'vitest';

vi.mock('dompurify', () => ({
  default: {
    sanitize: (value: string) => value,
  },
}));

vi.mock('../src/markdown', () => ({
  markdownToEditorHtml: (value: string) => value,
  normalizeMarkdownLists: (value: string) => value,
}));

import { createDefaultChatState, renderChatPanel } from '../src/chat/chat';
import { deserializeDocument } from '../src/serialization';

const deps = {
  escapeAttr: (value: string) => value.replaceAll('"', '&quot;'),
  escapeHtml: (value: string) => value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;'),
};

test('renderChatPanel allows edit chat sends for a blank document', () => {
  const chat = createDefaultChatState();
  chat.panelOpen = true;
  const document = deserializeDocument(`---
hvy_version: 0.1
---
`, '.hvy');

  const html = renderChatPanel(chat, document, deps, 'document-edit');

  expect(html).toContain('<button type="submit" class="secondary">Send</button>');
});

test('renderChatPanel keeps ask chat disabled for a blank document', () => {
  const chat = createDefaultChatState();
  chat.panelOpen = true;
  const document = deserializeDocument(`---
hvy_version: 0.1
---
`, '.hvy');

  const html = renderChatPanel(chat, document, deps, 'qa');

  expect(html).toContain('<button type="submit" class="secondary" disabled>Send</button>');
});

test('renderChatPanel shows token usage on assistant messages', () => {
  const chat = createDefaultChatState();
  chat.panelOpen = true;
  chat.messages = [
    {
      id: 'a1',
      role: 'assistant',
      content: 'Done.',
      tokenUsage: { inputTokens: 120, outputTokens: 30 },
    },
  ];
  const document = deserializeDocument(`---
hvy_version: 0.1
---

#! Summary
`, '.hvy');

  const html = renderChatPanel(chat, document, deps, 'document-edit');

  expect(html).toContain('<div class="chat-token-usage">Tokens: input 120 / output 30</div>');
  expect(html).toContain('Last tokens: input 120 / output 30');
});
