import assert from 'node:assert/strict';
export default async function ({ chromium, baseUrl }) {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const mode of ['ai', 'editor']) {
      const page = await browser.newPage();
      page.setDefaultTimeout(1000);
      const deadline = setTimeout(() => page.close(), 5000);
      try {
        await page.goto(baseUrl);
        await page.getByRole('button', { name: 'Raw', exact: true }).click();
        await page.locator('#rawEditor').fill('---\nhvy_version: 0.1\n---\n\n<!--hvy: {"id":"summary"}-->\n#! Summary\n\n Misspeled sample words\n');
        await page.getByRole('button', { name: 'Apply', exact: true }).click();
        await page.locator(`[data-action="switch-view"][data-view="${mode}"]`).click();
        if (mode === 'ai') {
          await page.locator('#aiReaderDocument .reader-block').first().click({ button: 'right' });
          await page.getByRole('button', { name: 'Edit component', exact: true }).click();
        } else {
          await page.getByRole('button', { name: 'Advanced', exact: true }).click();
          await page.locator('#editorTree .editor-block-passive').first().click();
        }
        const editor = page.locator('.editor-block[data-active-editor-block="true"] .rich-editor').first();
        await editor.fill('Misspeled sample words');
        await page.evaluate(() => {
          window.contextEvents = [];
          document.addEventListener('contextmenu', event => window.contextEvents.push({
            prevented: event.defaultPrevented,
            editable: event.target.isContentEditable,
            spellcheck: event.target.closest('.rich-editor')?.spellcheck,
          }));
        });
        await editor.click({ button: 'right' });
        const result = await page.evaluate(() => ({
          events: window.contextEvents,
          componentMenu: document.querySelector('.hvy-context-popover')?.textContent,
          activeEditor: !!document.querySelector('.editor-block[data-active-editor-block="true"]'),
        }));
        console.log(JSON.stringify({ mode, gesture: 'right click inside active prose editor', ...result }));
        assert.equal(result.events.at(-1).prevented, mode === 'ai');
        if (mode === 'ai') {
          await page.locator('.hvy-context-popover-backdrop-target').click({ position: { x: 12, y: 12 } });
          const modifierResult = await editor.evaluate(element => {
            const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, metaKey: true });
            element.dispatchEvent(event);
            return { prevented: event.defaultPrevented, componentMenu: !!document.querySelector('.hvy-context-popover') };
          });
          console.log(JSON.stringify({ mode, gesture: 'Command + right click', ...modifierResult }));
          assert.equal(modifierResult.prevented, false);
        }
      } finally {
        clearTimeout(deadline);
        await page.close();
      }
    }
  } finally { await browser.close(); }
}
