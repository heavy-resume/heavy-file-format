import { expect, test } from '@playwright/test';

test('cli view can navigate and edit virtual body files', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'CLI' }).click();

  await expect(page.locator('.chat-launcher')).toHaveCount(0);
  await expect(page.getByLabel('Allowed CLI commands')).toContainText('cd, pwd, ls, cat');
  await expect(page.getByLabel('Allowed CLI commands')).toContainText('form, db-table');
  await expect(page.locator('#cliInput')).toBeFocused();

  await page.locator('#cliInput').fill('ls /');
  await page.keyboard.press('Enter');
  await expect(page.locator('#cliOutput')).toContainText('body');
  await expect(page.locator('#cliInput')).toBeFocused();

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.getByRole('button', { name: 'CLI' }).click();
  await expect(page.locator('#cliOutput')).toContainText('ls /');
  await expect(page.locator('#cliInput')).toBeFocused();

  await page.locator('#cliInput').fill('find /body -name body.txt');
  await page.keyboard.press('Enter');
  await expect(page.locator('#cliOutput')).toContainText('body.txt');
  await expect
    .poll(async () =>
      page.locator('#cliOutput').evaluate((node) => Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop) <= 2)
    )
    .toBe(true);

  const bodyPath = (await page
    .locator('#cliOutput')
    .textContent())?.match(/\/body\/overview\/import-failure-example\/import-example-result\/body\.txt/)?.[0];
  expect(bodyPath).toBeTruthy();

  await page.locator('#cliInput').fill(`sed s/pending/done/ ${bodyPath}`);
  await page.keyboard.press('Enter');
  await expect(page.locator('#cliOutput')).toContainText('updated');
});
