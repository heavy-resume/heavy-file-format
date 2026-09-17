import { expect } from '@playwright/test';
export default async function ({ chromium, baseUrl }) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(1000);
    await page.goto(baseUrl);
    await page.locator('.document-menu').evaluate(menu => { menu.open = true; });
    await page.getByRole('button', { name: 'Resume Template', exact: true }).click();
    await page.getByRole('button', { name: 'Editor', exact: true }).click();
    await page.getByRole('button', { name: 'Basic', exact: true }).click();
    const picker = page.locator('[data-field="reusable-section-type"][data-section-key="__top_level__"]');
    await picker.selectOption('section-def:Awards');
    await page.locator('[data-action="add-top-level-section"][data-section-key="__top_level__"]').click();
    console.log('After adding Awards:', await picker.inputValue(), await picker.locator('option').allTextContents());
    await expect(picker.locator('option[value="section-def:Awards"]')).toHaveCount(0);
  } finally { await browser.close(); }
}
