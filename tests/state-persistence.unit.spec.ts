import { afterEach, expect, test, vi } from 'vitest';
import { deserializeDocument } from '../src/serialization';
import { loadResumeState, saveResumeState } from '../src/state-persistence';
import type { AppState } from '../src/types';

afterEach(() => {
  vi.unstubAllGlobals();
});

test('saveResumeState and loadResumeState round trip the working document and lightweight UI state', () => {
  const storage = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });

  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {}-->
 Saved work
`, '.hvy');

  saveResumeState({
    document,
    filename: 'saved.hvy',
    currentView: 'ai',
    editorMode: 'raw',
    showAdvancedEditor: true,
    rawEditorText: 'raw text',
    templateValues: { name: 'Ada' },
    chat: {
      settings: { provider: 'openai', model: 'gpt-5-mini' },
      draft: 'continue this',
      messages: [
        { id: 'm1', role: 'user', content: 'Please edit.' },
        { id: 'm2', role: 'assistant', content: 'Working...', progress: true },
        { id: 'm3', role: 'assistant', content: 'Done.' },
      ],
      panelOpen: true,
      isSending: true,
      error: 'old error',
      requestNonce: 12,
      abortController: new AbortController(),
    },
  } as unknown as AppState);

  const resumed = loadResumeState();

  expect(resumed?.filename).toBe('saved.hvy');
  expect(resumed?.currentView).toBe('ai');
  expect(resumed?.editorMode).toBe('raw');
  expect(resumed?.showAdvancedEditor).toBe(true);
  expect(resumed?.rawEditorText).toBe('raw text');
  expect(resumed?.templateValues).toEqual({ name: 'Ada' });
  expect(resumed?.chat.draft).toBe('continue this');
  expect(resumed?.chat.panelOpen).toBe(true);
  expect(resumed?.chat.messages).toEqual([
    { id: 'm1', role: 'user', content: 'Please edit.' },
    { id: 'm3', role: 'assistant', content: 'Done.' },
  ]);
  expect(resumed?.document.sections[0]?.title).toBe('Summary');
  expect(resumed?.document.sections[0]?.blocks[0]?.text).toBe('Saved work');
});
