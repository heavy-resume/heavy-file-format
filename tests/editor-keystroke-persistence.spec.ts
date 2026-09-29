import { expect, test, type Locator, type Page } from '@playwright/test';

const SESSION_STATE_KEY = 'hvy-editor-session-state-v1';
const untouchedDocumentText = `Untouched start ${'z'.repeat(12_000)} untouched end`;

type CapturedStorageWrite = {
  key: string;
  value: string;
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
    const writes: CapturedStorageWrite[] = [];
    Object.defineProperty(window, '__hvyCapturedStorageWrites', {
      configurable: true,
      value: writes,
      writable: true,
    });
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function captureStorageWrite(key: string, value: string): void {
      if (this === window.sessionStorage) {
        (window as Window & { __hvyCapturedStorageWrites: CapturedStorageWrite[] })
          .__hvyCapturedStorageWrites.push({ key, value });
      }
      originalSetItem.call(this, key, value);
    };
  });
});

test('before, three text keystrokes, after: persistence waits for 750 ms of input inactivity', async ({ page }) => {
  const editor = await openPersistenceProbeEditor(page);

  await editor.pressSequentially('abc', { delay: 20 });

  expect(await readCapturedSessionWrites(page)).toHaveLength(0);
  await page.waitForTimeout(850);
  const writesAfterIdle = await readCapturedSessionWrites(page);
  expect(writesAfterIdle).toHaveLength(1);
  const storedDocuments = writesAfterIdle.map(decodeStoredDocument);
  expect(storedDocuments).toEqual([expect.stringContaining('Editable startabc')]);
  for (const documentText of storedDocuments) {
    expect(documentText).toContain('Untouched start');
    expect(documentText).toContain('untouched end');
    expect(documentText.match(/z/g)).toHaveLength(12_000);
  }
  expect(writesAfterIdle[0]!.value.length).toBeGreaterThan(16_000);
});

test('before, continuous typing crosses the former history window, after: one idle checkpoint undoes the entire burst', async ({ page }) => {
  test.setTimeout(5_000);
  const editor = await openPersistenceProbeEditor(page);
  const historyLengthBeforeTyping = await readHistoryLength(page);

  const characters = [...'abcde'];
  for (const [index, character] of characters.entries()) {
    await editor.press(character);
    if (index < characters.length - 1) await page.waitForTimeout(330);
  }

  expect(await readCapturedSessionWrites(page)).toHaveLength(0);
  expect(await readHistoryLength(page)).toBe(historyLengthBeforeTyping);
  await page.waitForTimeout(850);
  const storedDocuments = (await readCapturedSessionWrites(page)).map(decodeStoredDocument);
  expect(storedDocuments).toHaveLength(1);
  expect(storedDocuments[0]).toContain('Editable startabcde');
  expect(await readHistoryLength(page)).toBe(historyLengthBeforeTyping + 1);

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
  await expect(editor).toHaveText('Editable start');
});

test('before, two typing bursts separated by inactivity, after: each burst is one undo step', async ({ page }) => {
  test.setTimeout(5_000);
  const editor = await openPersistenceProbeEditor(page);

  await editor.pressSequentially('abc', { delay: 20 });
  await page.waitForTimeout(850);
  await editor.pressSequentially('def', { delay: 20 });
  await page.waitForTimeout(850);

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
  await expect(editor).toHaveText('Editable startabc');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
  await expect(editor).toHaveText('Editable start');
});

test('before, pending persistence, after: pagehide flushes immediately and cancels the idle write', async ({ page }) => {
  const editor = await openPersistenceProbeEditor(page);

  await editor.pressSequentially('abc', { delay: 20 });
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));

  const writesAfterPagehide = await readCapturedSessionWrites(page);
  expect(writesAfterPagehide).toHaveLength(1);
  expect(decodeStoredDocument(writesAfterPagehide[0]!)).toContain('Editable startabc');
  await page.waitForTimeout(850);
  expect(await readCapturedSessionWrites(page)).toHaveLength(1);
});

test('before, pending persistence, after: Done flushes the completed edit immediately', async ({ page }) => {
  const editor = await openPersistenceProbeEditor(page);

  await editor.pressSequentially('abc', { delay: 20 });
  await page.locator('.editor-block[data-active-editor-block="true"] [data-action="deactivate-block"]').click();

  const writesAfterDone = await readCapturedSessionWrites(page);
  expect(writesAfterDone).toHaveLength(1);
  expect(decodeStoredDocument(writesAfterDone[0]!)).toContain('Editable startabc');
  await page.waitForTimeout(850);
  expect(await readCapturedSessionWrites(page)).toHaveLength(1);
});

test('editor surface disables the native WebKit tap highlight', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('.editor-shell')).toHaveCSS('-webkit-tap-highlight-color', 'rgba(0, 0, 0, 0)');
});

async function openPersistenceProbeEditor(page: Page): Promise<Locator> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"editable"}-->
#! Editable

 <!--hvy:text {"id":"editable-text"}-->
  Editable start

<!--hvy: {"id":"untouched"}-->
#! Untouched

 <!--hvy:text {"id":"untouched-text"}-->
  ${untouchedDocumentText}
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic', exact: true }).click();
  await page.locator('[data-action="activate-block"]', { hasText: 'Editable start' }).click();
  const editor = page.locator('[data-field="block-rich"][data-block-id]').filter({ hasText: 'Editable start' });
  await expect(editor).toBeFocused();
  await editor.press('End');
  await page.evaluate(() => {
    (window as Window & { __hvyCapturedStorageWrites: CapturedStorageWrite[] })
      .__hvyCapturedStorageWrites = [];
  });
  return editor;
}

async function readCapturedSessionWrites(page: Page): Promise<CapturedStorageWrite[]> {
  return page.evaluate((sessionStateKey) => (
    (window as Window & { __hvyCapturedStorageWrites: CapturedStorageWrite[] })
      .__hvyCapturedStorageWrites.filter((write) => write.key === sessionStateKey)
  ), SESSION_STATE_KEY);
}

async function readHistoryLength(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const modulePath = '/src/state.ts';
    const { state } = await import(/* @vite-ignore */ modulePath);
    return state.history.length;
  });
}

function decodeStoredDocument(write: CapturedStorageWrite): string {
  const payload = JSON.parse(write.value) as { documentBase64?: string; documentTextBase64?: string };
  const encodedDocument = payload.documentBase64 ?? payload.documentTextBase64;
  if (!encodedDocument) {
    throw new Error('Expected the session write to contain serialized document bytes.');
  }
  return Buffer.from(encodedDocument, 'base64').toString('utf8');
}
