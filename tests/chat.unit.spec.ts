import { expect, test } from 'vitest';

import {
  buildChatDocumentContext,
  buildProxyChatRequest,
  getEnvChatSettings,
  mergeChatSettings,
  stripDocumentHeaderAndComments,
} from '../src/chat';
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
      formatInstructions: 'Format as HVY.',
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
    formatInstructions: 'Format as HVY.',
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
