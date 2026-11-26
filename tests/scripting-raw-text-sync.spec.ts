import { expect, test, type Page } from '@playwright/test';

async function runFakeHeaderEdit(page: Page, value: string): Promise<void> {
  await page.evaluate(async (headerValue) => {
    const { state } = await import('/src/state.ts');
    const { runUserScript } = await import('/src/plugins/scripting/wrapper.ts');
    await runUserScript({ document: state.document, source: `doc.header.set("fake_raw_key", "${headerValue}")` });
  }, value);
}

test('before, a script edit outside the raw editor, after opening it: the edit is in its text', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  const rawButton = page.getByRole('button', { name: 'Raw', exact: true });
  await rawButton.waitFor();

  await runFakeHeaderEdit(page, 'fake outside raw');
  await rawButton.click();

  await expect(page.locator('#rawEditor')).toHaveValue(/fake_raw_key: fake outside raw/);
});

test('before, the raw editor is open, after a script edit: the edit is in its text', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await expect(page.locator('#rawEditor')).toBeVisible();

  await runFakeHeaderEdit(page, 'fake while raw');

  await expect(page.locator('#rawEditor')).toHaveValue(/fake_raw_key: fake while raw/);
});

test('before, a script edit in the viewer with raw as the editor mode, after returning: the edit is kept', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await expect(page.locator('#rawEditor')).toBeVisible();
  await page.getByRole('button', { name: 'Viewer', exact: true }).click();

  await runFakeHeaderEdit(page, 'fake from viewer');
  await page.getByRole('button', { name: 'Editor', exact: true }).click();

  await expect(page.locator('#rawEditor')).toHaveValue(/fake_raw_key: fake from viewer/);
});
