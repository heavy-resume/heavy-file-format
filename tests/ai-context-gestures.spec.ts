import { expect, test, type Page } from '@playwright/test';

test.use({ hasTouch: true });

async function openAiGestureDocument(page: Page, expanded: boolean): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"fake-section"}-->
#! Fake Section

<!--hvy:expandable {"id":"fake-expandable","expandableAlwaysShowStub":true,"expandableExpanded":${expanded}}-->
 <!--hvy:expandable:stub {}-->
  <!--hvy:text {}-->
   Fake summary
 <!--hvy:expandable:content {}-->
  <!--hvy:text {}-->
   Fake details

<!--hvy:text {}-->
 Fake outside target
`);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('button', { name: 'AI', exact: true }).click();
  await page.getByRole('button', { name: 'Phone 390', exact: true }).click();
}

for (const expanded of [false, true]) {
  for (const input of ['touch', 'mouse']) {
    test(`AI ${input} backdrop dismissal preserves expanded=${expanded}`, async ({ page }) => {
      test.setTimeout(5_000);
      await openAiGestureDocument(page, expanded);
      await page.locator('#aiReaderDocument .reader-block-text', { hasText: 'Fake outside target' }).click({ button: 'right' });
      await expect(page.locator('.hvy-context-popover')).toBeVisible();
      const stubBox = (await page.locator('#aiReaderDocument .expand-stub-toggle').boundingBox())!;

      // ACTION: dismiss the menu over another expandable's stub.
      if (input === 'touch') {
        await page.touchscreen.tap(stubBox.x + stubBox.width / 2, stubBox.y + stubBox.height / 2);
      } else {
        await page.mouse.click(stubBox.x + stubBox.width / 2, stubBox.y + stubBox.height / 2);
      }

      // EXPECTED RESULT: dismissal consumes the gesture, and the next tap still works.
      await expect(page.locator('.hvy-context-popover')).toHaveCount(0);
      await page.waitForTimeout(300);
      await expect(page.locator('#fake-expandable')).toHaveAttribute('aria-expanded', String(expanded));
      await page.locator('#aiReaderDocument .expand-stub-toggle').tap();
      await expect(page.locator('#fake-expandable')).toHaveAttribute('aria-expanded', String(!expanded));
    });
  }

  test(`AI long hold consumes its release and preserves expanded=${expanded}`, async ({ page }) => {
    test.setTimeout(5_000);
    await openAiGestureDocument(page, expanded);
    const stubBox = (await page.locator('#aiReaderDocument .expand-stub-toggle').boundingBox())!;
    const session = await page.context().newCDPSession(page);

    // ACTION: keep holding beyond the old popup click-suppression deadline.
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: [{ x: stubBox.x + stubBox.width / 2, y: stubBox.y + stubBox.height / 2 }],
    });
    await expect(page.locator('.hvy-context-popover')).toBeVisible();
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      document.addEventListener('click', (event) => {
        setTimeout(() => { document.body.dataset.fakeHoldReleasePrevented = String(event.defaultPrevented); }, 0);
      }, { capture: true, once: true });
    });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

    // EXPECTED RESULT: release neither activates the menu nor toggles its target.
    await expect(page.locator('body')).toHaveAttribute('data-fake-hold-release-prevented', 'true');
    await page.waitForTimeout(300);
    await expect(page.locator('#fake-expandable')).toHaveAttribute('aria-expanded', String(expanded));
    await expect(page.locator('.hvy-context-popover')).toBeVisible();
    await page.getByRole('button', { name: 'Edit component', exact: true }).tap();
    await expect(page.locator('.editor-block[data-active-editor-block="true"]')).toBeVisible();
    await session.detach();
  });
}

test('AI menu labels prevent selection and the native context menu', async ({ page }) => {
  test.setTimeout(5_000);
  await openAiGestureDocument(page, false);
  await page.locator('#aiReaderDocument .reader-block-text', { hasText: 'Fake outside target' }).click({ button: 'right' });
  await expect(page.getByRole('button', { name: 'Edit component', exact: true })).toHaveCSS('user-select', 'none');
  await expect(page.locator('#aiReaderDocument .reader-block-text').first()).toHaveCSS('user-select', 'none');
  await page.evaluate(() => {
    document.addEventListener('contextmenu', (event) => {
      document.body.dataset.fakeNativeMenuPrevented = String(event.defaultPrevented);
    }, { once: true });
  });

  // ACTION: request a native context menu on the custom menu itself.
  await page.getByRole('button', { name: 'Edit component', exact: true }).click({ button: 'right' });

  // EXPECTED RESULT: the custom menu stays open and the native menu is suppressed.
  await expect(page.locator('body')).toHaveAttribute('data-fake-native-menu-prevented', 'true');
  await expect(page.locator('.hvy-context-popover')).toBeVisible();
  await expect(page.locator('.hvy-context-popover')).toHaveCSS('touch-action', 'manipulation');
  await expect(page.locator('.hvy-context-popover-backdrop')).toHaveCSS('touch-action', 'manipulation');
});

test('public AI embed backdrop consumes touch dismissal inside its mount', async ({ page }) => {
  test.setTimeout(5_000);
  await openAiGestureDocument(page, false);
  await page.evaluate(async () => {
    const { mountHvy } = await import('/src/embed.ts');
    const { serializeDocument, deserializeDocument } = await import('/src/serialization.ts');
    const { state } = await import('/src/state.ts');
    const doc = deserializeDocument(serializeDocument(state.document), '.hvy');
    const root = document.createElement('div');
    root.id = 'fake-embed-host';
    root.style.cssText = 'height: 600px; width: 390px; touch-action: manipulation';
    document.body.replaceChildren(root);
    await mountHvy({ root, document: doc, mode: 'ai' }).setMode('ai');
  });
  await page.locator('#aiReaderDocument .reader-block-text', { hasText: 'Fake outside target' }).click({ button: 'right' });
  await expect(page.locator('#fake-embed-host .hvy-context-popover-backdrop')).toBeVisible();
  const stubBox = (await page.locator('#aiReaderDocument .expand-stub-toggle').boundingBox())!;

  // ACTION: dismiss the embedded menu over its expandable.
  await page.touchscreen.tap(stubBox.x + stubBox.width / 2, stubBox.y + stubBox.height / 2);

  // EXPECTED RESULT: the popup closes inside the mount and the expandable stays closed.
  await expect(page.locator('.hvy-context-popover')).toHaveCount(0);
  await page.waitForTimeout(300);
  await expect(page.locator('#fake-expandable')).toHaveAttribute('aria-expanded', 'false');
});
