import { expect, test } from 'vitest';

import {
  buildChatDocumentContext,
  buildProxyChatRequest,
  closeChatPanel,
  createDefaultChatState,
  getEnvChatSettings,
  mergeChatSettings,
  stopChatRequest,
  stripDocumentHeaderAndComments,
  toggleChatPanelOpen,
} from '../src/chat/chat';
import { wrapChatResponseAsDocument } from '../src/chat/chat-response-document';
import { getDocumentComponentDefaultCss } from '../src/document-component-defaults';
import { deserializeDocument } from '../src/serialization';

test('stripDocumentHeaderAndComments removes front matter and preserves structural hvy comments', () => {
  const input = `---
hvy_version: 0.1
title: Example
---

<!--hvy: {"id":"summary"}-->
#! Summary

Visible paragraph.

<!-- ordinary comment -->

<!--hvy:text {"class":"decorative"}-->

<!--hvy:xref-card {"xrefTitle":"Skill","xrefDetail":"Detail","xrefTarget":"skill"}-->

More content.
`;

  expect(stripDocumentHeaderAndComments(input)).toBe(
    '<!--hvy: {"id":"summary"}-->\n#! Summary\n\nVisible paragraph.\n\n<!--hvy:xref-card {"xrefTitle":"Skill","xrefDetail":"Detail","xrefTarget":"skill"}-->\n\nMore content.'
  );
});

test('buildChatDocumentContext preserves selected structural directives in serialized content', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {}-->
 Hello there

<!--hvy:xref-card {"xrefTitle":"TypeScript","xrefDetail":"Primary language","xrefTarget":"tool-typescript"}-->
`, '.hvy');

  expect(buildChatDocumentContext(document)).toContain('#! Summary');
  expect(buildChatDocumentContext(document)).toContain('Hello there');
  expect(buildChatDocumentContext(document)).toContain('<!--hvy: {"id":"summary"');
  expect(buildChatDocumentContext(document)).toContain('<!--hvy:xref-card {"xrefTitle":"TypeScript","xrefDetail":"Primary language","xrefTarget":"tool-typescript"}-->');
  expect(buildChatDocumentContext(document)).not.toContain('hvy_version');
  expect(buildChatDocumentContext(document)).not.toContain('<!--hvy:text');
});

test('buildChatDocumentContext prepends document ai context from metadata', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
ai-context: This resume uses top-skills-tools-technologies as featured skills.
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {}-->
 Hello there
`, '.hvy');

  const context = buildChatDocumentContext(document);

  expect(context).toContain('Document context:\nThis resume uses top-skills-tools-technologies as featured skills.');
  expect(context).toContain('Document body:\n<!--hvy: {"id":"summary"');
  expect(context).not.toContain('ai-context:');
});

test('buildChatDocumentContext keeps xref-card content under skills headings', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"skills"}-->
#! Skills

<!--hvy:component-list {"componentListComponent":"xref-card"}-->

 <!--hvy:component-list:0 {}-->

  <!--hvy:text {}-->
   #### Relevant Skills

 <!--hvy:component-list:1 {}-->

  <!--hvy:xref-card {"xrefTitle":"Software Engineering","xrefDetail":"Core strength","xrefTarget":"skill-software-engineering"}-->

 <!--hvy:component-list:2 {}-->

  <!--hvy:text {}-->
   #### Tools and Technologies

 <!--hvy:component-list:3 {}-->

  <!--hvy:xref-card {"xrefTitle":"TypeScript","xrefDetail":"Primary application language","xrefTarget":"tool-typescript"}-->
`, '.hvy');

  const context = buildChatDocumentContext(document);
  expect(context).toContain('#### Relevant Skills');
  expect(context).toContain('<!--hvy:xref-card {"xrefTitle":"Software Engineering","xrefDetail":"Core strength","xrefTarget":"skill-software-engineering"}-->');
  expect(context).toContain('#### Tools and Technologies');
  expect(context).toContain('<!--hvy:xref-card {"xrefTitle":"TypeScript","xrefDetail":"Primary application language","xrefTarget":"tool-typescript"}-->');
});

test('buildProxyChatRequest preserves provider, model, messages, and context', () => {
  expect(
    buildProxyChatRequest({
      provider: 'openai',
      model: 'gpt-5-mini',
      context: 'Context body',
      mode: 'qa',
      messages: [
        { id: '1', role: 'user', content: 'What is this?' },
        { id: '2', role: 'assistant', content: 'A summary.' },
      ],
    })
  ).toEqual({
    provider: 'openai',
    model: 'gpt-5-mini',
    context: 'Context body',
    mode: 'qa',
    messages: [
      { id: '1', role: 'user', content: 'What is this?', error: undefined },
      { id: '2', role: 'assistant', content: 'A summary.', error: undefined },
    ],
  });
});

test('getEnvChatSettings prepopulates provider and model from vite env vars', () => {
  expect(
    getEnvChatSettings({
      VITE_HVY_CHAT_PROVIDER: 'anthropic',
      VITE_HVY_CHAT_MODEL: 'claude-custom',
      VITE_HVY_CHAT_COMPACTION_PROVIDER: 'openai',
      VITE_HVY_CHAT_COMPACTION_MODEL: 'gpt-5.4-nano',
    } as unknown as ImportMetaEnv)
  ).toEqual({
    provider: 'anthropic',
    model: 'claude-custom',
    compactionProvider: 'openai',
    compactionModel: 'gpt-5.4-nano',
  });
});

test('getEnvChatSettings falls back to provider-specific model and then built-in default', () => {
  expect(
    getEnvChatSettings({
      VITE_HVY_CHAT_PROVIDER: 'openai',
      VITE_OPENAI_MODEL: 'gpt-dev',
    } as ImportMetaEnv)
  ).toEqual({
    provider: 'openai',
    model: 'gpt-dev',
    compactionProvider: 'openai',
    compactionModel: 'gpt-5.4-nano',
  });

  expect(
    getEnvChatSettings({
      VITE_HVY_CHAT_PROVIDER: 'anthropic',
    } as ImportMetaEnv)
  ).toEqual({
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    compactionProvider: 'openai',
    compactionModel: 'gpt-5.4-nano',
  });
});

test('mergeChatSettings keeps env defaults when localStorage values are empty strings', () => {
  expect(
    mergeChatSettings(
      {
        provider: 'openai',
        model: '',
      },
      {
        provider: 'openai',
        model: 'gpt-5-mini',
        compactionProvider: 'openai',
        compactionModel: 'gpt-5.4-nano',
      }
    )
  ).toEqual({
    provider: 'openai',
    model: 'gpt-5-mini',
    compactionProvider: 'openai',
    compactionModel: 'gpt-5.4-nano',
  });
});

test('stopChatRequest aborts the current question and records the stop', () => {
  const chat = createDefaultChatState();
  const abortController = new AbortController();
  chat.isSending = true;
  chat.abortController = abortController;
  chat.error = 'Still working';

  expect(stopChatRequest(chat)).toBe(true);

  expect(abortController.signal.aborted).toBe(true);
  expect(chat.isSending).toBe(false);
  expect(chat.abortController).toBe(null);
  expect(chat.error).toBe(null);
  expect(chat.requestNonce).toBe(1);
  expect(chat.messages.at(-1)).toMatchObject({
    role: 'assistant',
    content: 'Stopped.',
    progress: true,
  });
});

test('closing the chat panel stops an in-flight question', () => {
  const chat = createDefaultChatState();
  const abortController = new AbortController();
  chat.panelOpen = true;
  chat.isSending = true;
  chat.abortController = abortController;

  closeChatPanel(chat);

  expect(chat.panelOpen).toBe(false);
  expect(abortController.signal.aborted).toBe(true);
  expect(chat.isSending).toBe(false);
});

test('toggling an open chat panel closes and stops the request', () => {
  const chat = createDefaultChatState();
  const abortController = new AbortController();
  chat.panelOpen = true;
  chat.isSending = true;
  chat.abortController = abortController;

  toggleChatPanelOpen(chat);

  expect(chat.panelOpen).toBe(false);
  expect(abortController.signal.aborted).toBe(true);
});

test('wrapChatResponseAsDocument injects chat response component defaults into front matter', () => {
  const wrapped = wrapChatResponseAsDocument(
    '<!--hvy:xref-card {"xrefTitle":"Heavy Stack","xrefDetail":"Project","xrefTarget":"heavy-stack"}-->'
  );
  const document = deserializeDocument(wrapped, '.hvy');

  expect(getDocumentComponentDefaultCss(document.meta, 'xref-card')).toBe('margin-top: 0.25rem; margin-bottom: 0.25rem;');
});
