export default async function ({ chromium, baseUrl }) {
  const browser = await chromium.launch({ headless: true });
  const source = '---\nhvy_version: 0.1\n---\n\n<!--hvy: {"id":"undo-context"}-->\n#! Undo Context\n\n <!--hvy:xref-card {"id":"reference","xrefTitle":"Custom title","xrefDetail":"Custom detail","xrefTarget":"undo-context"}-->\n';
  try {
    for (const mode of ['reference', 'embed-keyboard', 'embed-api']) {
      const page = await browser.newPage();
      page.setDefaultTimeout(1000);
      await page.goto(baseUrl);
      if (mode === 'reference') {
        await page.getByRole('button', { name: 'Raw', exact: true }).click();
        await page.locator('#rawEditor').fill(source);
        await page.getByRole('button', { name: 'Apply', exact: true }).click();
        await page.getByRole('button', { name: 'Basic', exact: true }).click();
      } else {
        await page.evaluate(async source => {
          const { mountHvy, deserializeDocumentBytes } = await import('/src/embed.ts');
          document.body.innerHTML = '<div id="embed-root"></div>';
          window.testMount = mountHvy({ root: document.querySelector('#embed-root'), mode: 'editor', document: deserializeDocumentBytes(new TextEncoder().encode(source), '.hvy') });
        }, source);
      }
      await page.locator('.editor-block-passive', { has: page.locator('[data-component-id="reference"]') }).click();
      const field = page.locator('[data-active-editor-block="true"] [data-field="block-xref-detail"]');
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await field.evaluate(node => {
        node.focus();
        const range = document.createRange();
        range.setStart(node.firstChild, 7);
        range.setEnd(node.firstChild, 13);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
      });
      await page.keyboard.press('Backspace');
      if ((await field.textContent()).replaceAll('\u00a0', ' ') !== 'Custom ') throw new Error('Edit failed: ' + JSON.stringify(await field.textContent()));
      if (mode === 'embed-api') await page.evaluate(() => window.testMount.undo());
      else await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
      await page.waitForFunction(() => document.querySelector('[data-active-editor-block="true"] [data-field="block-xref-detail"]')?.textContent === 'Custom detail');
      console.log(mode, await page.evaluate(async () => {
        const { state } = await import('/src/state.ts');
        return { text: document.querySelector('[data-active-editor-block="true"] [data-field="block-xref-detail"]').textContent, focus: document.activeElement.tagName, field: document.activeElement.dataset.field, selection: window.getSelection().toString(), pending: state.pendingEditorActivation };
      }));
      await page.close();
    }
  } finally { await browser.close(); }
}
