import { afterEach, expect, test, vi } from 'vitest';
import { deserializeDocument } from '../src/serialization';
import { loadResumeState, saveResumeState } from '../src/state-persistence';
import type { AppState } from '../src/types';

afterEach(() => {
  vi.unstubAllGlobals();
});

test('saveResumeState and loadResumeState round trip the working document and lightweight UI state', () => {
  const storage = new Map<string, string>();
  const legacyStorage = new Map<string, string>([['hvy-editor-resume-state-v1', 'stale shared tab state']]);
  vi.stubGlobal('window', {
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    localStorage: {
      getItem: (key: string) => legacyStorage.get(key) ?? null,
      setItem: (key: string, value: string) => legacyStorage.set(key, value),
      removeItem: (key: string) => legacyStorage.delete(key),
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
    selectedExample: 'resume-example',
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
        {
          id: 'm2',
          role: 'assistant',
          content: 'Working...',
          progress: true,
          work: {
            status: 'running',
            lastCommand: 'hvy lint',
            details: ['$ hvy lint'],
            reasoning: ['Checking the document.'],
          },
        },
        { id: 'm3', role: 'assistant', content: 'Done.' },
      ],
      panelOpen: true,
      isSending: true,
      error: 'old error',
      requestNonce: 12,
      abortController: new AbortController(),
    },
    search: {
      open: true,
      queryDraft: 'Python',
      submittedQuery: 'Python',
      caseSensitive: true,
      categories: { tags: false, contents: true, description: true },
      activeTab: 'filter',
      filterEnabled: true,
      filterMode: 'deprioritize',
      resultsCollapsed: false,
      activeResultId: 'result-1',
      isLoading: true,
      error: 'old search error',
      results: [
        {
          id: 'result-1',
          category: 'contents',
          targetKind: 'block',
          sectionKey: document.sections[0]!.key,
          blockId: document.sections[0]!.blocks[0]!.id,
          targetId: '',
          label: 'Summary',
          preview: 'Python',
          matchedText: 'Python',
          sourceField: 'Text',
          documentOrder: 1,
        },
      ],
      navigationResultIds: ['result-1'],
      clearedSectionKeys: ['section-cleared'],
      clearedBlockIds: ['block-cleared'],
      requestNonce: 99,
      abortController: new AbortController(),
    },
    cliDraft: 'ls /body',
    cliSession: {
      cwd: '/body/summary',
      scratchpadContent: 'Plan\n',
      scratchpadEdited: true,
      scratchpadCommandsSinceEdit: ['ls /body'],
      rawWipContentByPath: { '/body/summary/intro/raw.wip.hvy': 'broken' },
    },
    cliHistory: [
      { cwd: '/', command: 'ls /', output: 'dir body', error: false },
      { cwd: '/body/summary', command: 'cat missing', output: 'no such file', error: true },
    ],
  } as unknown as AppState);

  const resumed = loadResumeState();

  expect(resumed?.filename).toBe('saved.hvy');
  expect(resumed?.selectedExample).toBe('resume-example');
  expect(resumed?.currentView).toBe('ai');
  expect(resumed?.editorMode).toBe('raw');
  expect(resumed?.showAdvancedEditor).toBe(true);
  expect(resumed?.rawEditorText).toBe('raw text');
  expect(resumed?.templateValues).toEqual({ name: 'Ada' });
  expect(resumed?.chat.draft).toBe('continue this');
  expect(resumed?.chat.panelOpen).toBe(true);
  expect(resumed?.search).toMatchObject({
    open: true,
    queryDraft: 'Python',
    submittedQuery: 'Python',
    caseSensitive: true,
    categories: { tags: false, contents: true, description: true },
    activeTab: 'filter',
    filterEnabled: true,
    filterMode: 'deprioritize',
    resultsCollapsed: false,
    activeResultId: 'result-1',
    results: [
      expect.objectContaining({
        id: 'result-1',
        category: 'contents',
        targetKind: 'block',
        label: 'Summary',
      }),
    ],
    navigationResultIds: ['result-1'],
    clearedSectionKeys: ['section-cleared'],
    clearedBlockIds: ['block-cleared'],
    isLoading: false,
    error: null,
    requestNonce: 0,
    abortController: null,
  });
  expect(resumed?.cli).toEqual({
    draft: 'ls /body',
    session: {
      cwd: '/body/summary',
      scratchpadContent: 'Plan\n',
      scratchpadEdited: true,
      scratchpadCommandsSinceEdit: ['ls /body'],
      rawWipContentByPath: { '/body/summary/intro/raw.wip.hvy': 'broken' },
    },
    history: [
      { cwd: '/', command: 'ls /', output: 'dir body', error: false },
      { cwd: '/body/summary', command: 'cat missing', output: 'no such file', error: true },
    ],
  });
  expect(resumed?.chat.messages).toEqual([
    { id: 'm1', role: 'user', content: 'Please edit.' },
    {
      id: 'm2',
      role: 'assistant',
      content: 'Working...',
      error: true,
      work: {
        status: 'error',
        lastCommand: 'hvy lint',
        details: ['$ hvy lint'],
        reasoning: ['Checking the document.'],
      },
    },
    { id: 'm3', role: 'assistant', content: 'Done.' },
  ]);
  expect(resumed?.document.sections[0]?.title).toBe('Summary');
  expect(resumed?.document.sections[0]?.blocks[0]?.text).toBe('Saved work');
  expect(storage.has('hvy-editor-resume-state-v2')).toBe(true);
  expect(legacyStorage.has('hvy-editor-resume-state-v1')).toBe(false);
});

test('loadResumeState ignores legacy shared localStorage state from other tabs', () => {
  const sessionStorage = new Map<string, string>();
  const localStorage = new Map<string, string>([['hvy-editor-resume-state-v1', JSON.stringify({
    version: 1,
    savedAt: new Date().toISOString(),
    filename: 'other-tab.hvy',
    currentView: 'editor',
    editorMode: 'basic',
    showAdvancedEditor: false,
    rawEditorText: '',
    templateValues: {},
    chat: { settings: { provider: 'openai', model: 'gpt-5-mini' }, draft: '', messages: [], panelOpen: false },
    cli: { draft: '', session: { cwd: '/' }, history: [] },
    documentBase64: '',
  })]]);
  vi.stubGlobal('window', {
    sessionStorage: {
      getItem: (key: string) => sessionStorage.get(key) ?? null,
      setItem: (key: string, value: string) => sessionStorage.set(key, value),
      removeItem: (key: string) => sessionStorage.delete(key),
    },
    localStorage: {
      getItem: (key: string) => localStorage.get(key) ?? null,
      setItem: (key: string, value: string) => localStorage.set(key, value),
      removeItem: (key: string) => localStorage.delete(key),
    },
  });

  expect(loadResumeState()).toBeNull();
});
