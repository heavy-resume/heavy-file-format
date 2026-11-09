import { expect, test, type Page } from '@playwright/test';

const fakeFormDocument = `---
hvy_version: 0.1
---
<!--hvy: {"id":"fake-section"}-->
#! Fake Section

<!--hvy:text {"id":"fake-counter"}-->
Picked: none

<!--hvy:plugin {"id":"fake-editing-form","plugin":"hvy.form","pluginConfig":{"version":"0.1","showSubmit":false}}-->
fields:
  - label: Fake toggle
    type: checkbox
    triggers:
      change: toggle
  - label: Fake answer
    type: text
scripts:
  toggle: |
    doc.component.set_text("fake-counter", "Picked: " + str(doc.form.get_value("Fake toggle")))
    doc.form.set_value("Fake answer", "set by script")

<!--hvy:plugin {"id":"fake-other-form","plugin":"hvy.form","pluginConfig":{"version":"0.1","showSubmit":false}}-->
fields:
  - label: Fake other
    type: text

<!--hvy:text {"id":"fake-scripted-text","visibleScript":"return doc.component.get_text(\\"fake-counter\\").strip() == \\"Picked: True\\""}-->
Fake scripted text
`;

const fakeDatabaseDocument = `---
hvy_version: 0.1
---
<!--hvy: {"id":"fake-section"}-->
#! Fake Section

<!--hvy:plugin {"id":"fake-writer-form","plugin":"hvy.form","pluginConfig":{"version":"0.1","showSubmit":false}}-->
fields:
  - label: Fake write
    type: checkbox
    triggers:
      change: write
scripts:
  write: |
    doc.db.execute("CREATE TABLE IF NOT EXISTS fake_records(id INTEGER PRIMARY KEY)")
    doc.db.execute("INSERT INTO fake_records DEFAULT VALUES")

<!--hvy:plugin {"id":"fake-listener-form","plugin":"hvy.form","pluginConfig":{"version":"0.1","showSubmit":false,"changeScript":"count"}}-->
fields:
  - label: Fake listener
    type: text
scripts:
  count: |
    doc.form.set_value("Fake listener", "rows " + str(doc.db.query("SELECT COUNT(*) AS n FROM fake_records")[0]["n"]))
`;

async function mountFakeViewer(page: Page, source: string): Promise<void> {
  await page.goto('/');
  await page.evaluate(async (documentSource) => {
    const embedPath = '/src/embed.ts';
    const { deserializeDocumentBytes, mountHvy, plugins } = await import(/* @vite-ignore */ embedPath);
    document.body.innerHTML = '<div id="fakeRoot" style="height:600px"></div>';
    mountHvy({
      root: document.querySelector('#fakeRoot'),
      mode: 'viewer',
      document: deserializeDocumentBytes(new TextEncoder().encode(documentSource), '.hvy'),
      plugins: [plugins.form, plugins.scripting],
    });
  }, source);
}

test('before, a script edits the document, after: the page redraws once', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).waitFor();
  const countersBefore = await page.evaluate(async () => {
    const { renderCount, refreshReaderCount } = await import('/src/state.ts');
    return { renderCount, refreshReaderCount };
  });

  await page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    const { runUserScript } = await import('/src/plugins/scripting/wrapper.ts');
    await runUserScript({ document: state.document, source: 'doc.header.set("fake_key", "fake value")' });
  });

  await expect.poll(() => page.evaluate(async () => {
    const { renderCount, refreshReaderCount } = await import('/src/state.ts');
    return { renderCount, refreshReaderCount };
  })).toEqual({ renderCount: countersBefore.renderCount + 1, refreshReaderCount: countersBefore.refreshReaderCount });
});

test('before, a script edit from one form, after: an unchanged form keeps its DOM', async ({ page }) => {
  test.setTimeout(5_000);
  await mountFakeViewer(page, fakeFormDocument);
  const otherInput = page.locator('#fakeRoot').getByLabel('Fake other');
  await otherInput.waitFor();
  await otherInput.evaluate((element) => {
    (window as Window & { fakeOtherForm?: Element | null }).fakeOtherForm = element.closest('form');
  });

  await page.locator('#fakeRoot').getByLabel('Fake toggle').check();

  await expect(page.locator('#fakeRoot')).toContainText('Picked: True');
  expect(await otherInput.evaluate((element) => (
    element.closest('form') === (window as Window & { fakeOtherForm?: Element | null }).fakeOtherForm
  ))).toBe(true);
});

test('before, a form script sets its own field, after: the new value is shown', async ({ page }) => {
  test.setTimeout(5_000);
  await mountFakeViewer(page, fakeFormDocument);
  const answer = page.locator('#fakeRoot').getByLabel('Fake answer');
  await expect(answer).toHaveValue('');

  await page.locator('#fakeRoot').getByLabel('Fake toggle').check();

  await expect(answer).toHaveValue('set by script');
});

test('before, a database write from another form, after: an unchanged form still runs its change script', async ({ page }) => {
  test.setTimeout(5_000);
  await mountFakeViewer(page, fakeDatabaseDocument);
  const listener = page.locator('#fakeRoot').getByLabel('Fake listener');
  await expect(listener).toHaveValue('');

  await page.locator('#fakeRoot').getByLabel('Fake write').check();
  await expect(listener).toHaveValue('rows 1');

  await page.locator('#fakeRoot').getByLabel('Fake write').uncheck();
  await expect(listener).toHaveValue('rows 2');
});

test('before, typing in one form, a script edit from another, after: focus and text are kept', async ({ page }) => {
  test.setTimeout(5_000);
  await mountFakeViewer(page, fakeFormDocument);
  const otherInput = page.locator('#fakeRoot').getByLabel('Fake other');
  await otherInput.pressSequentially('abc');
  await expect(otherInput).toBeFocused();

  await page.locator('#fakeRoot').getByLabel('Fake toggle').evaluate((element) => (element as HTMLInputElement).click());
  await expect(page.locator('#fakeRoot')).toContainText('Picked: True');

  await expect(otherInput).toBeFocused();
  await expect(otherInput).toHaveValue('abc');
  await otherInput.pressSequentially('d');
  await expect(otherInput).toHaveValue('abcd');
});

test('blocks without a visible script are not tracked, and a visible script still decides visibility', async ({ page }) => {
  test.setTimeout(5_000);
  await mountFakeViewer(page, fakeFormDocument);
  const trackedBlocks = page.locator('#fakeRoot [data-hvy-dynamic-visibility="true"]');
  await expect(trackedBlocks).toHaveCount(1);
  await expect(trackedBlocks).toHaveAttribute('data-visible-state', 'hidden');

  await page.locator('#fakeRoot').getByLabel('Fake toggle').check();

  await expect(page.locator('#fakeRoot [data-hvy-dynamic-visibility="true"]')).toHaveAttribute('data-visible-state', 'visible');
  await expect(page.locator('#fakeRoot').getByText('Fake scripted text')).toBeVisible();
});
