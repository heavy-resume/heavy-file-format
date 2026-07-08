import { expect, test, vi } from 'vitest';

vi.mock('dompurify', () => ({
  default: {
    sanitize: (value: string) => value,
  },
}));

vi.mock('../src/markdown', () => ({
  markdownToReaderHtml: (value: string) => value,
  normalizeMarkdownLists: (value: string) => value,
}));

import { createDefaultChatState, renderChatPanel } from '../src/chat/chat';
import { renderAiEditPopover } from '../src/ai-mode-ui';
import { deserializeDocument } from '../src/serialization';
import type { AppState } from '../src/types';

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

  const html = renderChatPanel(chat, document, deps, 'document-edit', true);

  expect(html).toContain('<article class="chat-bubble chat-bubble-assistant has-token-usage"');
  expect(html).toContain('<div class="chat-token-usage">Tokens: input 120 / output 30</div>');
  expect(html).toContain('aria-label="Copy response options"');
  expect(html.indexOf('>Copy response</button>')).toBeLessThan(html.indexOf('>Copy as new section</button>'));
  expect(html).toContain('Last tokens: input 120 / output 30');
});

test('renderChatPanel gives HVY response expandables a visible disclosure cue', () => {
  const chat = createDefaultChatState();
  chat.panelOpen = true;
  chat.messages = [
    {
      id: 'a1',
      role: 'assistant',
      content: `<!--hvy:expandable {"id":"details","expandableExpanded":false}-->
 <!--hvy:expandable:stub {}-->
  <!--hvy:text {"id":"details-summary"}-->
   Short answer
 <!--hvy:expandable:content {}-->
  <!--hvy:text {"id":"details-body"}-->
   Longer answer`,
    },
  ];
  const document = deserializeDocument(`---
hvy_version: 0.1
---

#! Summary
`, '.hvy');

  const html = renderChatPanel(chat, document, deps, 'qa');

  expect(html).toContain('class="expandable-reader-pane expandable-reader-pane-stub" data-chat-expandable-pane="stub"');
  expect(html).toContain('class="expandable-reader-pane expandable-reader-pane-expanded" data-chat-expandable-pane="content" hidden');
  expect(html).toContain('class="expandable-reader-pane expandable-reader-pane-expanded expandable-reader-pane-content-preview" data-chat-expandable-pane="preview" hidden');
  expect(html).not.toContain('expandable-pane-stub');
  expect(html).toContain('class="expandable-reader-cue" aria-hidden="true"');
  expect(html).toContain('data-chat-action="toggle-expandable" aria-expanded="false"');
});

test('renderChatPanel does not show a blank expandable stub for content-only HVY response expandables', () => {
  const chat = createDefaultChatState();
  chat.panelOpen = true;
  chat.messages = [
    {
      id: 'a1',
      role: 'assistant',
      content: `<!--hvy:expandable {"id":"details","expandableExpanded":false}-->
 <!--hvy:expandable:stub {}-->
 <!--hvy:expandable:content {}-->
  <!--hvy:text {"id":"details-body"}-->
   Key points of Actual grouped`,
    },
  ];
  const document = deserializeDocument(`---
hvy_version: 0.1
---

#! Summary
`, '.hvy');

  const html = renderChatPanel(chat, document, deps, 'qa');

  expect(html).toContain('class="expandable-reader-pane expandable-reader-pane-stub" data-chat-expandable-pane="stub" hidden');
  expect(html).toContain('class="expandable-reader-pane expandable-reader-pane-expanded" data-chat-expandable-pane="content" hidden');
  expect(html).toContain('class="expandable-reader-pane expandable-reader-pane-expanded expandable-reader-pane-content-preview" data-chat-expandable-pane="preview"');
  expect(html).not.toContain('expandable-pane-expanded');
  expect(html).toContain('Key points of Actual grouped');
  expect(html).toContain('class="expandable-reader-cue" aria-hidden="true"');
});

test('renderChatPanel hides the change request input while document edits are running', () => {
  const chat = createDefaultChatState();
  chat.panelOpen = true;
  chat.isSending = true;
  const document = deserializeDocument(`---
hvy_version: 0.1
---
`, '.hvy');

  const html = renderChatPanel(chat, document, deps, 'document-edit');

  expect(html).not.toContain('data-field="chat-input"');
  expect(html).not.toContain('Change request');
  expect(html).toContain('Working through the request...');
  expect(html).toContain('data-action="cancel-chat-request"');
});

test('renderChatPanel shows CLI sim as a toggle before a draft exists', () => {
  const chat = createDefaultChatState();
  chat.panelOpen = true;
  const document = deserializeDocument(`---
hvy_version: 0.1
---
`, '.hvy');

  const html = renderChatPanel(chat, document, deps, 'document-edit');

  expect(html).toContain('data-action="toggle-chat-cli-sim"');
  expect(html).toContain('<button type="button" class="ghost" data-action="toggle-chat-cli-sim">CLI Sim Off</button>');
});

test('renderChatPanel shows provider and model controls together in the reference surface', () => {
  const chat = createDefaultChatState();
  chat.panelOpen = true;
  const document = deserializeDocument(`---
hvy_version: 0.1
---
`, '.hvy');

  const html = renderChatPanel(chat, document, deps, 'document-edit');

  expect(html).toContain('data-field="chat-provider"');
  expect(html).toContain('data-field="chat-model"');
  expect(html).toContain('data-field="chat-compaction-provider"');
  expect(html).toContain('data-field="chat-compaction-model"');
});

test('renderChatPanel hides provider and model controls together in the embedded surface', () => {
  const chat = createDefaultChatState();
  chat.panelOpen = true;
  const document = deserializeDocument(`---
hvy_version: 0.1
---
`, '.hvy');

  const html = renderChatPanel(chat, document, deps, 'document-edit', false, 'embedded');

  expect(html).not.toContain('data-field="chat-provider"');
  expect(html).not.toContain('data-field="chat-model"');
  expect(html).not.toContain('data-field="chat-compaction-provider"');
  expect(html).not.toContain('data-field="chat-compaction-model"');
});

test('renderChatPanel shows reusable context controls for document questions', () => {
  const chat = createDefaultChatState();
  chat.panelOpen = true;
  const document = deserializeDocument(`---
hvy_version: 0.1
---

#! Summary
`, '.hvy');

  const html = renderChatPanel(chat, document, deps, 'qa', false, 'reference', {
    chatContext: { mode: 'embedding-retrieval', embeddingModel: 'text-embedding-ada-002' },
    embeddingAvailable: true,
    canPersistEmbeddingCache: true,
  });

  expect(html).toContain('data-field="chat-context-mode"');
  expect(html).toContain('value="embedding-retrieval" selected');
  expect(html).toContain('data-field="chat-embedding-model"');
  expect(html).toContain('data-action="build-chat-embeddings"');
  expect(html).toContain('Build Embeddings</button>');
});

test('renderChatPanel shows context controls for document editing question fallback', () => {
  const chat = createDefaultChatState();
  chat.panelOpen = true;
  const document = deserializeDocument(`---
hvy_version: 0.1
---
`, '.hvy');

  const html = renderChatPanel(chat, document, deps, 'document-edit', false, 'reference', {
    chatContext: { mode: 'embedding-retrieval' },
    embeddingAvailable: true,
    canPersistEmbeddingCache: true,
  });

  expect(html).toContain('data-field="chat-context-mode"');
  expect(html).toContain('value="embedding-retrieval" selected');
  expect(html).toContain('data-action="build-chat-embeddings"');
});

test('renderAiEditPopover shows provider and model controls together in the reference surface', () => {
  const state = {
    chat: createDefaultChatState(),
    aiEdit: {
      sectionKey: 'body',
      blockId: 'summary',
      draft: '',
      isSending: false,
      error: null,
      popupX: 20,
      popupY: 30,
      requestNonce: 0,
    },
  } as unknown as AppState;

  const html = renderAiEditPopover(state, deps);

  expect(html).toContain('data-field="ai-provider"');
  expect(html).toContain('data-field="ai-model"');
  expect(html).toContain('data-field="chat-compaction-provider"');
  expect(html).toContain('data-field="chat-compaction-model"');
});

test('renderAiEditPopover hides provider and model controls together in the embedded surface', () => {
  const state = {
    chat: createDefaultChatState(),
    aiEdit: {
      sectionKey: 'body',
      blockId: 'summary',
      draft: '',
      isSending: false,
      error: null,
      popupX: 20,
      popupY: 30,
      requestNonce: 0,
    },
  } as unknown as AppState;

  const html = renderAiEditPopover(state, { ...deps, surface: 'embedded' });

  expect(html).not.toContain('data-field="ai-provider"');
  expect(html).not.toContain('data-field="ai-model"');
  expect(html).not.toContain('data-field="chat-compaction-provider"');
  expect(html).not.toContain('data-field="chat-compaction-model"');
});

test('renderChatPanel shows CLI sim request, response, and thinking summary', () => {
  const chat = createDefaultChatState();
  chat.panelOpen = true;
  chat.draft = 'Add a chore section.';
  chat.cliSim = {
    requestPayload: { messages: [] },
    requestJson: '{\n  "messages": []\n}',
    responseJson: '{\n  "output": "done Added it."\n}',
    responseOutput: 'done Added it.',
    reasoningSummary: 'Checked the structure, then edited.',
    commandResultMessage: '',
    turnState: {},
    isPreparing: false,
    isSending: false,
    error: null,
  };
  const document = deserializeDocument(`---
hvy_version: 0.1
---
`, '.hvy');

  const html = renderChatPanel(chat, document, deps, 'document-edit');

  expect(html).toContain('data-action="toggle-chat-cli-sim"');
  expect(html).toContain('CLI Sim');
  expect(html).toContain('Request JSON');
  expect(html).toContain('"messages": []');
  expect(html).toContain('Response JSON');
  expect(html).toContain('"output": "done Added it."');
  expect(html).toContain('Thinking summary');
  expect(html).toContain('Checked the structure, then edited.');
  expect(html).toContain('data-action="run-chat-cli-sim-step"');
  expect(html).toContain('Run Commands And Prepare Next');
});
