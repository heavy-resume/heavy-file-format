import { expect, test } from '@playwright/test';

test('cli view can navigate and edit virtual body files', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'CLI' }).click();

  await page.locator('#cliInput').fill('ls /');
  await page.keyboard.press('Enter');
  await expect(page.locator('#cliOutput')).toContainText('body');

  await page.locator('#cliInput').fill('find /body -name body.txt');
  await page.keyboard.press('Enter');
  await expect(page.locator('#cliOutput')).toContainText('body.txt');

  const bodyPath = (await page
    .locator('#cliOutput')
    .textContent())?.match(/\/body\/overview\/import-failure-example\/import-example-result\/body\.txt/)?.[0];
  expect(bodyPath).toBeTruthy();

  await page.locator('#cliInput').fill(`sed s/pending/done/ ${bodyPath}`);
  await page.keyboard.press('Enter');
  await expect(page.locator('#cliOutput')).toContainText('updated');
});
