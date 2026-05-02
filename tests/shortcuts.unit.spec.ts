import { beforeEach, expect, test, vi } from 'vitest';

const { undoStateMock, redoStateMock } = vi.hoisted(() => ({
  undoStateMock: vi.fn(),
  redoStateMock: vi.fn(),
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
}

class TestInputElement extends TestHTMLElement {}
class TestTextAreaElement extends TestHTMLElement {}
class TestSelectElement extends TestHTMLElement {}

beforeEach(() => {
  vi.resetModules();
  undoStateMock.mockReset();
  redoStateMock.mockReset();
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
  bindShortcuts(new TestHTMLElement() as HTMLElement);

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
  bindShortcuts(new TestHTMLElement() as HTMLElement);

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
