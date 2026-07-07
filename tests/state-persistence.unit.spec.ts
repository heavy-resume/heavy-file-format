import { afterEach, expect, test, vi } from 'vitest';
import { deserializeDocument } from '../src/serialization';
import { createDefaultSearchState } from '../src/search/state';
import { loadSessionState, saveChatSessionState, saveSessionState } from '../src/state-persistence';
import type { AppState } from '../src/types';
import { setAttachment } from '../src/attachments';

afterEach(() => {
  vi.unstubAllGlobals();
});

function createPersistenceTestState(documentTitle: string, sessionStorageKey: string | null): AppState {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! ${documentTitle}

<!--hvy:text {}-->
 ${documentTitle} body
`, '.hvy');
  return {
    document,
    filename: `${documentTitle.toLowerCase().replace(/\s+/g, '-')}.hvy`,
    selectedExample: 'custom',
    currentView: 'editor',
    editorMode: 'basic',
    responsivePreview: 'full',
    sessionStorageKey,
    showAdvancedEditor: false,
    rawEditorText: '',
    templateValues: {},
    chat: {
      settings: { provider: 'openai', model: 'gpt-5-mini' },
      draft: '',
      messages: [],
      panelOpen: false,
      isSending: false,
      status: null,
      error: null,
      requestNonce: 0,
      abortController: null,
      cliSimEnabled: false,
      cliSim: null,
    },
    search: createDefaultSearchState(),
    cliDraft: '',
    cliSession: { cwd: '/' },
    cliHistory: [],
  } as unknown as AppState;
}

test('saveSessionState and loadSessionState round trip the working document and lightweight UI state', () => {
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

  saveSessionState({
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
      filterQueryMode: 'keyword',
      submittedFilterQueryMode: 'keyword',
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

  const loaded = loadSessionState();

  expect(loaded?.filename).toBe('saved.hvy');
  expect(loaded?.selectedExample).toBe('resume-example');
  expect(loaded?.currentView).toBe('ai');
  expect(loaded?.editorMode).toBe('raw');
  expect(loaded?.showAdvancedEditor).toBe(true);
  expect(loaded?.rawEditorText).toBe('raw text');
  expect(loaded?.templateValues).toEqual({ name: 'Ada' });
  expect(loaded?.chat.draft).toBe('continue this');
  expect(loaded?.chat.panelOpen).toBe(true);
  expect(loaded?.search).toMatchObject({
    open: true,
    queryDraft: 'Python',
    submittedQuery: 'Python',
    caseSensitive: true,
    categories: { tags: false, contents: true, description: true },
    activeTab: 'filter',
    filterEnabled: true,
    filterMode: 'deprioritize',
    filterQueryMode: 'keyword',
    submittedFilterQueryMode: 'keyword',
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
  expect(loaded?.cli).toEqual({
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
  expect(loaded?.chat.messages).toEqual([
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
  expect(loaded?.document?.sections[0]?.title).toBe('Summary');
  expect(loaded?.document?.sections[0]?.blocks[0]?.text).toBe('Saved work');
  expect(storage.has('hvy-editor-session-state-v1')).toBe(true);
  expect(legacyStorage.has('hvy-editor-resume-state-v1')).toBe(false);
});

test('saveChatSessionState stores chat updates separately without rewriting the document payload', () => {
  const storage = new Map<string, string>();
  vi.stubGlobal('window', {
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    localStorage: {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    },
  });
  const state = createPersistenceTestState('Chat Delta', '');
  state.chat.panelOpen = false;
  saveSessionState(state);
  const originalMainPayload = storage.get('hvy-editor-session-state-v1');
  expect(JSON.parse(originalMainPayload ?? '{}')).toHaveProperty('documentBase64');

  state.chat.panelOpen = true;
  state.chat.messages = [
    { id: 'u1', role: 'user', content: 'What changed?' },
    { id: 'a1', role: 'assistant', content: 'Only chat changed.' },
  ];
  saveChatSessionState(state);

  expect(storage.get('hvy-editor-session-state-v1')).toBe(originalMainPayload);
  const chatPayload = storage.get('hvy-editor-session-state-v1:chat');
  expect(chatPayload).toContain('Only chat changed.');
  expect(JSON.parse(chatPayload ?? '{}')).not.toHaveProperty('documentBase64');
  const loaded = loadSessionState();
  expect(loaded?.document?.sections[0]?.title).toBe('Chat Delta');
  expect(loaded?.chat.panelOpen).toBe(true);
  expect(loaded?.chat.messages).toEqual([
    { id: 'u1', role: 'user', content: 'What changed?' },
    { id: 'a1', role: 'assistant', content: 'Only chat changed.' },
  ]);
});

test('loadSessionState ignores legacy shared localStorage state from other tabs', () => {
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

  expect(loadSessionState()).toBeNull();
});

test('loadSessionState resets saved semantic filter runs on refresh', () => {
  const storage = new Map<string, string>();
  vi.stubGlobal('window', {
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    localStorage: {
      removeItem: vi.fn(),
    },
  });
  const state = createPersistenceTestState('Semantic Refresh', 'semantic');
  state.search = {
    ...state.search,
    open: true,
    activeTab: 'filter',
    queryDraft: 'Anything Carta',
    submittedQuery: 'Anything Carta',
    filterEnabled: true,
    filterQueryMode: 'semantic',
    submittedFilterQueryMode: 'semantic',
    results: [{
      id: 'semantic-1',
      category: 'semantic',
      targetKind: 'block',
      sectionKey: state.document.sections[0]!.key,
      blockId: state.document.sections[0]!.blocks[0]!.id,
      targetId: 'example',
      label: 'Example',
      preview: 'Old semantic result',
      matchedText: 'Anything Carta',
      sourceField: 'Semantic match',
    }],
    navigationResultIds: ['semantic-1'],
    activeResultId: 'semantic-1',
  };

  saveSessionState(state);

  const loaded = loadSessionState('semantic');
  expect(loaded?.search).toMatchObject({
    open: true,
    activeTab: 'filter',
    queryDraft: 'Anything Carta',
    submittedQuery: '',
    filterEnabled: false,
    filterQueryMode: 'semantic',
    submittedFilterQueryMode: 'semantic',
    results: [],
    navigationResultIds: [],
    activeResultId: null,
    isLoading: false,
    semanticProgress: null,
    error: null,
  });
});

test('saveSessionState and loadSessionState isolate custom session storage keys', () => {
  const storage = new Map<string, string>();
  vi.stubGlobal('window', {
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    localStorage: {
      removeItem: vi.fn(),
    },
  });

  saveSessionState(createPersistenceTestState('First Instance', 'first'));
  saveSessionState(createPersistenceTestState('Second Instance', 'second'));

  expect(storage.has('hvy-editor-session-state-v1:first')).toBe(true);
  expect(storage.has('hvy-editor-session-state-v1:second')).toBe(true);
  expect(loadSessionState('first')?.document?.sections[0]?.title).toBe('First Instance');
  expect(loadSessionState('second')?.document?.sections[0]?.title).toBe('Second Instance');
  expect(loadSessionState()).toBeNull();
});

test('loadSessionState restores the document extension from the saved filename', () => {
  const storage = new Map<string, string>();
  vi.stubGlobal('window', {
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
  });

  const state = createPersistenceTestState('PDF Template', 'pdf-template');
  state.document.extension = '.phvy';
  state.filename = 'pdf-template.phvy';

  saveSessionState(state);

  expect(loadSessionState('pdf-template')?.document?.extension).toBe('.phvy');
});

test('saveSessionState skips persistence when sessionStorageKey is null', () => {
  const storage = new Map<string, string>();
  vi.stubGlobal('window', {
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    localStorage: {
      removeItem: vi.fn(),
    },
  });

  saveSessionState(createPersistenceTestState('Temporary Instance', null));

  expect(storage.size).toBe(0);
});

test('saveSessionState can persist keyed viewer UI state without storing document bytes', () => {
  const storage = new Map<string, string>();
  vi.stubGlobal('window', {
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    localStorage: {
      removeItem: vi.fn(),
    },
  });

  const viewerState = createPersistenceTestState('Viewer Instance', 'viewer');
  saveSessionState({
    ...viewerState,
    currentView: 'viewer',
    persistDocumentState: false,
    chat: {
      ...viewerState.chat,
      panelOpen: true,
    },
  });

  const payload = JSON.parse(storage.get('hvy-editor-session-state-v1:viewer') ?? '{}') as { documentBase64?: string };
  const loaded = loadSessionState('viewer');
  expect(payload.documentBase64).toBeUndefined();
  expect(loaded?.document).toBeUndefined();
  expect(loaded?.chat.panelOpen).toBe(true);
});

test('saveSessionState does not rewrite attachment tail bytes for text-only document changes', () => {
  const storage = new Map<string, string>();
  const writes: string[] = [];
  vi.stubGlobal('window', {
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        writes.push(key);
        storage.set(key, value);
      },
      removeItem: (key: string) => storage.delete(key),
    },
    localStorage: {
      removeItem: vi.fn(),
    },
  });
  const state = createPersistenceTestState('Attached Document', 'attached');
  setAttachment(state.document, 'image:photo.jpg', { mediaType: 'image/jpeg' }, new Uint8Array([1, 2, 3, 4]));

  saveSessionState(state);
  const firstAttachmentPayload = storage.get('hvy-editor-session-state-v1:attached:attachments');
  state.document.sections[0]!.blocks[0]!.text = 'Edited body only';
  saveSessionState(state);
  const loaded = loadSessionState('attached');

  expect(storage.get('hvy-editor-session-state-v1:attached:attachments')).toBe(firstAttachmentPayload);
  expect(writes.filter((key) => key === 'hvy-editor-session-state-v1:attached:attachments')).toHaveLength(1);
  expect(writes.filter((key) => key === 'hvy-editor-session-state-v1:attached')).toHaveLength(2);
  expect(loaded?.document?.sections[0]?.blocks[0]?.text).toBe('Edited body only');
  expect(Array.from(loaded?.document?.attachments[0]?.bytes ?? [])).toEqual([1, 2, 3, 4]);
});
