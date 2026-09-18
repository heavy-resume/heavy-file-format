import { expect, test } from 'vitest';
import { requestTextAiOutput } from '../src/editor/components/text-ai/text-ai-request';

test('an unconfigured text request rejects before invoking the host client', async () => {
  let requestCount = 0;
  await expect(requestTextAiOutput({
    original: 'Original value.',
    instructions: 'Fix typos.',
    settings: { provider: 'openai', model: 'fake-chat-model' },
    client: { complete: async () => { requestCount += 1; return { output: 'Unexpected value.' }; } },
  })).rejects.toThrow('Text processing is not configured');
  expect(requestCount).toBe(0);
});

test('an explicitly configured text request uses only its selected provider and model', async () => {
  const requests: Array<{ provider: string; model: string }> = [];
  expect(await requestTextAiOutput({
    original: 'Original value.',
    instructions: 'Fix typos.',
    settings: { provider: 'openai', model: 'fake-chat-model', textProcessingProvider: 'qwen', textProcessingModel: 'fake-text-model' },
    client: { complete: async request => { requests.push({ provider: request.provider, model: request.model }); return { output: 'Expected result.' }; } },
  })).toBe('Expected result.');
  expect(requests).toEqual([{ provider: 'qwen', model: 'fake-text-model' }]);
});
