import { expect, test } from 'vitest';

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
