import { expect, test } from '@playwright/test';

test('chat CLI form edits refresh mounted values and options without resetting unrelated input', async ({ page }) => {
  test.setTimeout(5000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
plugins:
  - id: hvy.form
---

<!--hvy: {"id":"fake-form-section"}-->
#! Fake form

<!--hvy:plugin {"id":"fake-form","plugin":"hvy.form"}-->
fields:
  - label: Fake choice
    type: select
    options: [Fake old, Fake spare]
    value: Fake old
  - label: Fake text
    value: Fake before
  - label: Fake untouched
    value: Fake default
`);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('button', { name: 'AI', exact: true }).click();
  await page.locator('input[name="Fake untouched"]').fill('Fake typed');
  await expect(page.locator('select[name="Fake choice"] option')).toHaveText(['Fake old', 'Fake spare']);
  await expect(page.locator('input[name="Fake text"]')).toHaveValue('Fake before');

  // Execute the same tool implementation used by chat, then its targeted reader refresh.
  const result = await page.evaluate(async () => {
    const { state, getRefreshReaderBlock } = await import('/src/state.ts');
    const { createChatCliInterface } = await import('/src/chat-cli/chat-cli-interface.ts');
    const execution = await createChatCliInterface(state.document).run(`cat > /id/fake-form/plugin.txt <<'END'
fields:
  - label: Fake choice
    type: select
    options: [Fake new, Fake extra]
    value: Fake new
  - label: Fake text
    value: Fake after
  - label: Fake untouched
    value: Fake default
END`);
    return {
      mutated: execution.mutated,
      refreshed: getRefreshReaderBlock()(document.body, state.document.sections[0]!.key, state.document.sections[0]!.blocks[0]!.id, { runVisibilityScripts: false }),
    };
  });

  expect(result).toEqual({ mutated: true, refreshed: true });
  await expect(page.locator('select[name="Fake choice"] option')).toHaveText(['Fake new', 'Fake extra']);
  await expect(page.locator('select[name="Fake choice"]')).toHaveValue('Fake new');
  await expect(page.locator('input[name="Fake text"]')).toHaveValue('Fake after');
  await expect(page.locator('input[name="Fake untouched"]')).toHaveValue('Fake typed');

  await page.evaluate(async () => {
    const { getRefreshReaderPanels } = await import('/src/state.ts');
    getRefreshReaderPanels()({ runVisibilityScripts: false });
  });

  await expect(page.locator('select[name="Fake choice"] option')).toHaveText(['Fake new', 'Fake extra']);
  await expect(page.locator('input[name="Fake untouched"]')).toHaveValue('Fake typed');
});
