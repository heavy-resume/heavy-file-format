export default async function ({ chromium, baseUrl }) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    page.setDefaultTimeout(3000);
    await page.goto(baseUrl);
    await page.waitForTimeout(800);
    await page.evaluate(() => document.querySelector('#resumeExampleBtn')?.click());
    await page.waitForTimeout(1200);
    await page.locator('[data-action="switch-view"][data-view="editor"]').click();
    await page.getByRole('button', { name: 'Phone 390' }).click();
    await page.waitForTimeout(500);
    const card = page.locator('.editor-block-passive', { hasText: 'Software Engineering' }).last();
    await card.scrollIntoViewIfNeeded();
    await card.click();
    await page.waitForTimeout(600);
    const card2 = page.locator('.editor-block-passive', { hasText: 'Library Development' }).last();
    if (await card2.count()) { await card2.click(); await page.waitForTimeout(600); }
    const gates = await page.evaluate(() => [...document.querySelectorAll('[data-hvy-component-editor-gate="true"]')].map((g) => ({
      label: g.dataset.componentLabel,
      width: Math.round(g.getBoundingClientRect().width),
      narrow: g.classList.contains('is-component-editor-too-narrow'),
      shell: Math.round((document.querySelector('.editor-shell') ?? document.body).getBoundingClientRect().width),
    })));
    console.log(JSON.stringify(gates, null, 1));
    const btn = page.locator('.component-editor-compact-button:visible').first();
    if (await btn.count()) {
      await btn.click();
      await page.waitForTimeout(300);
      console.log('modal layer width', await page.evaluate(() => {
        const b = document.querySelector('.component-editor-modal-body');
        const s = b && getComputedStyle(b);
        return b && { body: b.getBoundingClientRect().width, content: b.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight), root: document.querySelector('.component-editor-modal-root').getBoundingClientRect().width };
      }));
    }
    await page.screenshot({ path: 'scratch/compact-gate.png' });
  } finally { await browser.close(); }
}
