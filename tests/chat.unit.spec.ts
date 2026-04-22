import { expect, test } from 'vitest';

import {
  buildChatDocumentContext,
  buildProxyChatRequest,
  getEnvChatSettings,
  mergeChatSettings,
  stripDocumentHeaderAndComments,
} from '../src/chat';
import { deserializeDocument } from '../src/serialization';

test('stripDocumentHeaderAndComments removes front matter and all html comments', () => {
  const input = `---
hvy_version: 0.1
title: Example
---

<!--hvy: {"id":"summary"}-->
#! Summary

Visible paragraph.

<!-- ordinary comment -->

More content.
`;

  expect(stripDocumentHeaderAndComments(input)).toBe('#! Summary\n\nVisible paragraph.\n\nMore content.');
});

test('buildChatDocumentContext uses serialized document content without directives', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {}-->
 Hello there
`, '.hvy');

  expect(buildChatDocumentContext(document)).toContain('#! Summary');
  expect(buildChatDocumentContext(document)).toContain('Hello there');
  expect(buildChatDocumentContext(document)).not.toContain('<!--hvy:');
  expect(buildChatDocumentContext(document)).not.toContain('hvy_version');
});

test('buildProxyChatRequest preserves provider, model, messages, and context', () => {
  expect(
    buildProxyChatRequest({
      provider: 'openai',
      model: 'gpt-5-mini',
      context: 'Context body',
      messages: [
        { id: '1', role: 'user', content: 'What is this?' },
        { id: '2', role: 'assistant', content: 'A summary.' },
      ],
    })
  ).toEqual({
    provider: 'openai',
    model: 'gpt-5-mini',
    context: 'Context body',
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
    } as ImportMetaEnv)
  ).toEqual({
    provider: 'anthropic',
    model: 'claude-custom',
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
  });

  expect(
    getEnvChatSettings({
      VITE_HVY_CHAT_PROVIDER: 'anthropic',
    } as ImportMetaEnv)
  ).toEqual({
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
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
      }
    )
  ).toEqual({
    provider: 'openai',
    model: 'gpt-5-mini',
  });
});
