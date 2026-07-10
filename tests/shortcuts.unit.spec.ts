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
  };
});

class TestHTMLElement extends EventTarget {
  isContentEditable = false;
  themeModalAncestor = false;
  richEditorAncestor = false;

  closest(selector: string) {
    if (selector === '.rich-editor' && this.richEditorAncestor) {
      return this;
    }
    return selector === '.theme-modal' && this.themeModalAncestor ? this : null;
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
  const { isNativeUndoTarget } = await import('../src/bind/handlers/shortcuts');

  expect(isNativeUndoTarget(new TestTextAreaElement())).toBe(true);
  expect(isNativeUndoTarget(new TestInputElement())).toBe(true);

  const editable = new TestHTMLElement();
  editable.isContentEditable = true;
  expect(isNativeUndoTarget(editable)).toBe(true);
});

test('rich editors keep native text undo behavior', async () => {
  const { isNativeUndoTarget } = await import('../src/bind/handlers/shortcuts');

  const editable = new TestHTMLElement();
  editable.isContentEditable = true;
  editable.richEditorAncestor = true;

  expect(isNativeUndoTarget(editable)).toBe(true);
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

  expect(prevented).toBe(false);
  expect(undoStateMock).not.toHaveBeenCalled();
});

test('global undo shortcut does not intercept rich editor native undo when available', async () => {
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

  expect(prevented).toBe(false);
  expect(undoStateMock).not.toHaveBeenCalled();
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

test('global undo shortcut handles pending document undo before rich editor native undo', async () => {
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
  const { routeNextUndoToDocument } = await import('../src/edit-command-routing');
  const { bindShortcuts } = await import('../src/bind/handlers/shortcuts');
  const { setShortcutsBound } = await import('../src/bind/handlers/_imports');
  setShortcutsBound(false);
  bindShortcuts(new TestHTMLElement() as unknown as HTMLElement);

  routeNextUndoToDocument();
  const editable = new TestHTMLElement();
  editable.isContentEditable = true;
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
  expect(undoStateMock).toHaveBeenCalledTimes(1);
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
