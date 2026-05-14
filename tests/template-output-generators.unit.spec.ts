import { expect, test } from 'vitest';

import { resolveOutputGeneratorResponse } from '../src/template-output-generators';
import type { ChatSettings } from '../src/types';

const settings: ChatSettings = {
  provider: 'openai',
  model: 'test-model',
};

test('output generator response uses direct answer when no prompt exists', async () => {
  await expect(resolveOutputGeneratorResponse({
    response: { answer: 'Local answer' },
    settings,
  })).resolves.toBe('Local answer');
});

test('output generator response uses prompt completion before answer fallback', async () => {
  const output = await resolveOutputGeneratorResponse({
    response: { prompt: 'Write from TypeScript', answer: 'Fallback answer' },
    settings,
    requestCompletion: async (request) => {
      expect(request.messages[0]?.content).toBe('Write from TypeScript');
      expect(request.context).toBe('');
      return 'LLM answer';
    },
  });

  expect(output).toBe('LLM answer');
});

test('output generator response falls back to answer when prompt completion fails', async () => {
  const output = await resolveOutputGeneratorResponse({
    response: { prompt: 'Write from TypeScript', answer: 'Fallback answer' },
    settings,
    requestCompletion: async () => {
      throw new Error('Proxy unavailable');
    },
  });

  expect(output).toBe('Fallback answer');
});

test('output generator response errors when neither prompt nor answer produce text', async () => {
  await expect(resolveOutputGeneratorResponse({
    response: { answer: '  ' },
    settings,
  })).rejects.toThrow('Generator returned no text.');
});
