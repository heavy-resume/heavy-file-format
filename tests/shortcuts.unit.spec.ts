import { beforeEach, expect, test, vi } from 'vitest';

const { undoStateMock, redoStateMock, activeRuntimeBox, runWithStateRuntimeMock } = vi.hoisted(() => ({
  undoStateMock: vi.fn(),
  redoStateMock: vi.fn(),
  activeRuntimeBox: { current: null },
  runWithStateRuntimeMock: vi.fn((_runtime, action: () => void) => action()),
}));

vi.mock('../src/state', () => ({
  getActiveStateRuntime: () => {
    if (!activeRuntimeBox.current) {
      throw new Error('state runtime not initialized');
    }
    return activeRuntimeBox.current;
  },
  runWithStateRuntime: runWithStateRuntimeMock,
}));

vi.mock('../src/bind/handlers/_imports', () => {
  let shortcutsBound = false;
  return {
    get shortcutsBound() {
      return shortcutsBound;
    },
    setShortcutsBound: (value: boolean) => {
      shortcutsBound = value;
    },
    undoState: undoStateMock,
    redoState: redoStateMock,
    undoStateAsync: undoStateMock,
    redoStateAsync: redoStateMock,
  };
});

class TestHTMLElement extends EventTarget {
  isContentEditable = false;
  activeEditorAncestor = false;
  themeModalAncestor = false;
  modalRootAncestor = false;
  richEditorAncestor = false;
  dataset: Record<string, string> = {};

  closest(selector: string) {
    if (selector === '.rich-editor' && this.richEditorAncestor) {
      return this;
    }
    if (selector === '.editor-block[data-active-editor-block="true"]' && this.activeEditorAncestor) {
      return this;
    }
    if (selector === '.theme-modal' && this.themeModalAncestor) {
      return this;
    }
    return selector === '.modal-root' && this.modalRootAncestor ? this : null;
  }
}

class TestInputElement extends TestHTMLElement {}
class TestTextAreaElement extends TestHTMLElement {}
class TestSelectElement extends TestHTMLElement {}

beforeEach(() => {
  vi.resetModules();
  undoStateMock.mockReset();
  redoStateMock.mockReset();
  activeRuntimeBox.current = null;
  runWithStateRuntimeMock.mockClear();
  vi.stubGlobal('HTMLElement', TestHTMLElement);
  vi.stubGlobal('HTMLInputElement', TestInputElement);
  vi.stubGlobal('HTMLTextAreaElement', TestTextAreaElement);
  vi.stubGlobal('HTMLSelectElement', TestSelectElement);
});

test('native undo targets keep browser undo behavior', async () => {
  const { isDocumentUndoTarget, isNativeUndoTarget } = await import('../src/bind/handlers/shortcuts');

  expect(isNativeUndoTarget(new TestTextAreaElement())).toBe(true);
  expect(isNativeUndoTarget(new TestInputElement())).toBe(true);

  const editable = new TestHTMLElement();
  editable.isContentEditable = true;
  expect(isNativeUndoTarget(editable)).toBe(true);

  const chatDraft = new TestTextAreaElement();
  chatDraft.dataset.field = 'chat-input';
  expect(isDocumentUndoTarget(chatDraft)).toBe(false);

  const codeEditor = new TestTextAreaElement();
  codeEditor.dataset.field = 'raw-editor-text';
  expect(isDocumentUndoTarget(codeEditor)).toBe(true);
});

test('rich editors use document undo behavior', async () => {
  const { isDocumentUndoTarget, isNativeUndoTarget } = await import('../src/bind/handlers/shortcuts');

  const editable = new TestHTMLElement();
  editable.isContentEditable = true;
  editable.activeEditorAncestor = true;
  editable.richEditorAncestor = true;

  expect(isNativeUndoTarget(editable)).toBe(true);
  expect(isDocumentUndoTarget(editable)).toBe(true);
});

test('theme modal controls use document undo behavior', async () => {
  const { isNativeUndoTarget } = await import('../src/bind/handlers/shortcuts');

  const input = new TestInputElement();
  input.themeModalAncestor = true;

  expect(isNativeUndoTarget(input)).toBe(false);
});

test('global undo shortcut does not intercept textarea native undo', async () => {
  let listener: ((event: {
    target: EventTarget | null;
    metaKey: boolean;
    ctrlKey: boolean;
    key: string;
    shiftKey: boolean;
    preventDefault: () => void;
  }) => void) | null = null;
  vi.stubGlobal('window', {
    addEventListener: (_type: string, handler: typeof listener) => {
      listener = handler;
    },
  });
  const { bindShortcuts } = await import('../src/bind/handlers/shortcuts');
  const { setShortcutsBound } = await import('../src/bind/handlers/_imports');
  setShortcutsBound(false);
  bindShortcuts(new TestHTMLElement() as unknown as HTMLElement);

  let prevented = false;
  listener?.({
    target: new TestTextAreaElement(),
    metaKey: false,
    ctrlKey: true,
    key: 'z',
    shiftKey: false,
    preventDefault: () => {
      prevented = true;
    },
  });

  listener?.({
    target: new TestTextAreaElement(),
    metaKey: false,
    ctrlKey: true,
    key: 'z',
    shiftKey: false,
    preventDefault: () => {
      prevented = true;
    },
  });

  expect(prevented).toBe(false);
  expect(undoStateMock).not.toHaveBeenCalled();
});

test('global undo shortcut handles a document-backed textarea', async () => {
  let listener: ((event: {
    target: EventTarget | null;
    metaKey: boolean;
    ctrlKey: boolean;
    key: string;
    shiftKey: boolean;
    preventDefault: () => void;
  }) => void) | null = null;
  vi.stubGlobal('window', {
    addEventListener: (_type: string, handler: typeof listener) => {
      listener = handler;
    },
  });
  const { bindShortcuts } = await import('../src/bind/handlers/shortcuts');
  const { setShortcutsBound } = await import('../src/bind/handlers/_imports');
  setShortcutsBound(false);
  bindShortcuts(new TestHTMLElement() as unknown as HTMLElement);

  const textarea = new TestTextAreaElement();
  textarea.dataset.field = 'raw-editor-text';
  let prevented = false;
  listener?.({
    target: textarea,
    metaKey: false,
    ctrlKey: true,
    key: 'z',
    shiftKey: false,
    preventDefault: () => {
      prevented = true;
    },
  });

  expect(prevented).toBe(true);
  expect(undoStateMock).toHaveBeenCalledTimes(1);
});

test('global undo shortcut handles rich editor document undo regardless of browser command state', async () => {
  let listener: ((event: {
    target: EventTarget | null;
    metaKey: boolean;
    ctrlKey: boolean;
    key: string;
    shiftKey: boolean;
    preventDefault: () => void;
  }) => void) | null = null;
  vi.stubGlobal('window', {
    addEventListener: (_type: string, handler: typeof listener) => {
      listener = handler;
    },
  });
  vi.stubGlobal('document', {
    queryCommandEnabled: () => true,
  });
  const { bindShortcuts } = await import('../src/bind/handlers/shortcuts');
  const { setShortcutsBound } = await import('../src/bind/handlers/_imports');
  setShortcutsBound(false);
  bindShortcuts(new TestHTMLElement() as unknown as HTMLElement);

  const editable = new TestHTMLElement();
  editable.isContentEditable = true;
  editable.activeEditorAncestor = true;
  editable.richEditorAncestor = true;
  let prevented = false;
  listener?.({
    target: editable,
    metaKey: false,
    ctrlKey: true,
    key: 'z',
    shiftKey: false,
    preventDefault: () => {
      prevented = true;
    },
  });

  expect(prevented).toBe(true);
  expect(undoStateMock).toHaveBeenCalledTimes(1);
});

test('global undo shortcut handles rich editor undo when no native undo is available', async () => {
  let listener: ((event: {
    target: EventTarget | null;
    metaKey: boolean;
    ctrlKey: boolean;
    key: string;
    shiftKey: boolean;
    preventDefault: () => void;
  }) => void) | null = null;
  vi.stubGlobal('window', {
    addEventListener: (_type: string, handler: typeof listener) => {
      listener = handler;
    },
  });
  vi.stubGlobal('document', {
    queryCommandEnabled: () => false,
  });
  const { bindShortcuts } = await import('../src/bind/handlers/shortcuts');
  const { setShortcutsBound } = await import('../src/bind/handlers/_imports');
  setShortcutsBound(false);
  bindShortcuts(new TestHTMLElement() as unknown as HTMLElement);

  const editable = new TestHTMLElement();
  editable.isContentEditable = true;
  editable.activeEditorAncestor = true;
  editable.richEditorAncestor = true;
  let prevented = false;
  listener?.({
    target: editable,
    metaKey: false,
    ctrlKey: true,
    key: 'z',
    shiftKey: false,
    preventDefault: () => {
      prevented = true;
    },
  });

  expect(prevented).toBe(true);
  expect(undoStateMock).toHaveBeenCalledTimes(1);
});

test('global undo shortcut keeps every document editor undo on document history', async () => {
  let listener: ((event: {
    target: EventTarget | null;
    metaKey: boolean;
    ctrlKey: boolean;
    key: string;
    shiftKey: boolean;
    preventDefault: () => void;
  }) => void) | null = null;
  vi.stubGlobal('window', {
    addEventListener: (_type: string, handler: typeof listener) => {
      listener = handler;
    },
  });
  const { bindShortcuts } = await import('../src/bind/handlers/shortcuts');
  const { setShortcutsBound } = await import('../src/bind/handlers/_imports');
  setShortcutsBound(false);
  bindShortcuts(new TestHTMLElement() as unknown as HTMLElement);

  const editable = new TestHTMLElement();
  editable.isContentEditable = true;
  editable.activeEditorAncestor = true;
  editable.richEditorAncestor = true;
  let prevented = false;
  listener?.({
    target: editable,
    metaKey: false,
    ctrlKey: true,
    key: 'z',
    shiftKey: false,
    preventDefault: () => {
      prevented = true;
    },
  });

  expect(prevented).toBe(true);
  expect(undoStateMock).toHaveBeenCalledTimes(1);

  prevented = false;
  listener?.({
    target: editable,
    metaKey: false,
    ctrlKey: true,
    key: 'z',
    shiftKey: false,
    preventDefault: () => {
      prevented = true;
    },
  });

  expect(prevented).toBe(true);
  expect(undoStateMock).toHaveBeenCalledTimes(2);
});

test('global undo shortcut still handles document-level undo', async () => {
  let listener: ((event: {
    target: EventTarget | null;
    metaKey: boolean;
    ctrlKey: boolean;
    key: string;
    shiftKey: boolean;
    preventDefault: () => void;
  }) => void) | null = null;
  vi.stubGlobal('window', {
    addEventListener: (_type: string, handler: typeof listener) => {
      listener = handler;
    },
  });
  const { bindShortcuts } = await import('../src/bind/handlers/shortcuts');
  const { setShortcutsBound } = await import('../src/bind/handlers/_imports');
  setShortcutsBound(false);
  bindShortcuts(new TestHTMLElement() as unknown as HTMLElement);

  let prevented = false;
  listener?.({
    target: new TestHTMLElement(),
    metaKey: false,
    ctrlKey: true,
    key: 'z',
    shiftKey: false,
    preventDefault: () => {
      prevented = true;
    },
  });

  expect(prevented).toBe(true);
  expect(undoStateMock).toHaveBeenCalledTimes(1);
});

test('global undo shortcut uses refreshed runtime when the same root is rebound', async () => {
  let listener: ((event: {
    target: EventTarget | null;
    metaKey: boolean;
    ctrlKey: boolean;
    key: string;
    shiftKey: boolean;
    preventDefault: () => void;
  }) => void) | null = null;
  vi.stubGlobal('window', {
    addEventListener: (_type: string, handler: typeof listener) => {
      listener = handler;
    },
  });
  const { bindShortcuts } = await import('../src/bind/handlers/shortcuts');
  const { setShortcutsBound } = await import('../src/bind/handlers/_imports');
  setShortcutsBound(false);

  const app = new TestHTMLElement() as unknown as HTMLElement;
  const firstRuntime = { id: 'first' };
  const secondRuntime = { id: 'second' };
  activeRuntimeBox.current = firstRuntime;
  bindShortcuts(app);
  activeRuntimeBox.current = secondRuntime;
  bindShortcuts(app);

  let prevented = false;
  listener?.({
    target: new TestHTMLElement(),
    metaKey: false,
    ctrlKey: true,
    key: 'z',
    shiftKey: false,
    preventDefault: () => {
      prevented = true;
    },
  });

  expect(prevented).toBe(true);
  expect(runWithStateRuntimeMock).toHaveBeenCalledWith(secondRuntime, expect.any(Function));
  expect(undoStateMock).toHaveBeenCalledTimes(1);
});

test('global undo shortcut handles theme modal inputs', async () => {
  let listener: ((event: {
    target: EventTarget | null;
    metaKey: boolean;
    ctrlKey: boolean;
    key: string;
    shiftKey: boolean;
    preventDefault: () => void;
  }) => void) | null = null;
  vi.stubGlobal('window', {
    addEventListener: (_type: string, handler: typeof listener) => {
      listener = handler;
    },
  });
  const { bindShortcuts } = await import('../src/bind/handlers/shortcuts');
  const { setShortcutsBound } = await import('../src/bind/handlers/_imports');
  setShortcutsBound(false);
  bindShortcuts(new TestHTMLElement() as unknown as HTMLElement);

  const input = new TestInputElement();
  input.themeModalAncestor = true;
  let prevented = false;
  listener?.({
    target: input,
    metaKey: false,
    ctrlKey: true,
    key: 'z',
    shiftKey: false,
    preventDefault: () => {
      prevented = true;
    },
  });

  expect(prevented).toBe(true);
  expect(undoStateMock).toHaveBeenCalledTimes(1);
});
