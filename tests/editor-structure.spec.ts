import { expect, test } from '@playwright/test';

test('expandable editor keeps stub and expanded slots unlocked without lock controls', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

 <!--hvy:expandable {"expandableAlwaysShowStub":true,"expandableExpanded":false}-->

  <!--hvy:expandable:stub {}-->

   <!--hvy:text {}-->
    ## Summary

  <!--hvy:expandable:content {}-->

   <!--hvy:text {}-->
    Expanded detail
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.editor-block-passive', { has: page.locator('.expandable-reader') }).first().evaluate((node) => {
    (node as HTMLElement).click();
  });
  const activeBlock = page.locator('.editor-block', { has: page.locator('.expand-chooser-grid') }).first();

  await expect(activeBlock.locator('[data-field="block-expandable-stub-lock"]')).toHaveCount(0);
  await expect(activeBlock.locator('[data-field="block-expandable-content-lock"]')).toHaveCount(0);

  await activeBlock.locator('[data-expandable-panel="stub"]').first().click();
  await activeBlock.locator('[data-expandable-panel="expanded"]').first().click();

  await expect(activeBlock.getByRole('button', { name: 'Expandable stub component type' })).toBeVisible();
  await expect(activeBlock.getByRole('button', { name: 'Expandable content component type' })).toBeVisible();
});

test('editor pullout help balloon lists loaded sidebar sections', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Resume Template' }).click();

  const balloon = page.locator('.editor-sidebar-help-balloon');
  await expect(balloon).toBeVisible();
  await expect(balloon.locator('li')).toContainText(['Skills', 'Tools & Technologies']);
  await expect(balloon).toHaveCSS('overflow', 'auto');

  await balloon.click();
  await expect(balloon).toBeHidden();

  await page.getByRole('button', { name: 'Resume Template' }).click();
  await expect(balloon).toBeVisible();
  await page.locator('.editor-sidebar-tab').click();
  await expect(balloon).toBeHidden();
});

test('unlocking a section schema allows removing locked child fields', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"locations","lock":true}-->
#! Locations

 <!--hvy:text {"lock":true}-->
  **Target Location(s):** Remote, Seattle
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();

  await page.locator('.editor-block-passive', { hasText: 'Target Location(s)' }).click();
  let activeBlock = page.locator('.editor-block[data-active-editor-block="true"]');
  await expect(activeBlock.locator('[data-action="remove-block"]')).toHaveCount(0);

  await page.locator('.editor-section-head [data-action="focus-modal"]').click();
  await page.getByRole('button', { name: 'Unlock Schema' }).click();
  await page.getByRole('button', { name: 'Close' }).click();

  activeBlock = page.locator('.editor-block[data-active-editor-block="true"]');
  await expect(activeBlock.locator('[data-action="remove-block"]')).toBeVisible();
  await activeBlock.locator('[data-action="remove-block"]').click();
  await expect(page.locator('.editor-tree', { hasText: 'Target Location(s)' })).toHaveCount(1);
  await expect(page.getByRole('dialog', { name: 'Confirm deletion?' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.editor-tree', { hasText: 'Target Location(s)' })).toHaveCount(0);
});

test('component editors do not render subsection side buttons', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();

  await expect(page.locator('.editor-block[data-active-editor-block="true"] .block-nest-toggle')).toHaveCount(0);
  await expect(page.locator('.editor-section-head [data-action="toggle-section-location"]').first()).toBeVisible();
});

test('subsections do not render sidebar location buttons', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"parent"}-->
#! Parent

 <!--hvy:text {}-->
  Parent body

<!--hvy: {"id":"child"}-->
## Child

 <!--hvy:text {}-->
  Child body
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();

  await expect(page.locator('.editor-section-card:not(.editor-subsection-card) > .editor-section-head [data-action="toggle-section-location"]').first()).toBeVisible();
  await expect(page.locator('.editor-subsection-card > .editor-section-head [data-action="toggle-section-location"]')).toHaveCount(0);
});

test('component-list add prompt reveals the active edit path with staggered animation', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Resume Template' }).click();
  await page.locator('.editor-tree .editor-block-passive .ghost-label', { hasText: 'Add Skill' }).first().click();

  const activatingBlocks = page.locator('.editor-block.is-activating-path');
  await expect(activatingBlocks).toHaveCount(3);
  await expect(activatingBlocks.nth(0)).toHaveAttribute('style', /--editor-activation-delay: 0ms;/);
  await expect(activatingBlocks.nth(1)).toHaveAttribute('style', /--editor-activation-delay: 150ms;/);
  await expect(activatingBlocks.nth(2)).toHaveAttribute('style', /--editor-activation-delay: 300ms;/);
  await expect(page.locator('.editor-block[data-active-editor-block="true"] [contenteditable="true"]').first()).toBeVisible();
});

test('clicking a nested component-list item opens the item editor on first click', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"skills"}-->
#! Skills

 <!--hvy:component-list {"id":"skills-list","componentListComponent":"text"}-->

  <!--hvy:component-list:0 {}-->

   <!--hvy:text {}-->
    Python

  <!--hvy:component-list:1 {}-->

   <!--hvy:text {}-->
    TypeScript
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.editor-block-passive', { hasText: 'Python' }).last().click();

  const activeBlock = page.locator('.editor-block[data-active-editor-block="true"]');
  await expect(activeBlock.locator('.rich-editor')).toBeVisible();
  await expect(activeBlock.locator('.rich-editor')).toContainText('Python');
  await expect(activeBlock.locator('.rich-editor')).not.toContainText('TypeScript');
});

test('clicking an already revealed nested item skips activation reveal animation', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"skills"}-->
#! Skills

 <!--hvy:component-list {"id":"skills-list","componentListComponent":"text"}-->

  <!--hvy:component-list:0 {}-->

   <!--hvy:text {}-->
    Python

  <!--hvy:component-list:1 {}-->

   <!--hvy:text {}-->
    TypeScript
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.editor-blocks > .editor-block-passive').first().dispatchEvent('click');
  await expect(page.locator('.editor-block[data-active-editor-block="true"] .editor-block-title')).toContainText('component-list');

  await page.locator('.editor-block-passive', { hasText: 'Python' }).last().click();

  const activeBlock = page.locator('.editor-block[data-active-editor-block="true"]');
  await expect(activeBlock.locator('.rich-editor')).toContainText('Python');
  await expect(page.locator('.editor-block.is-activating-path')).toHaveCount(0);
});

test('populated component-list hides the list component type dropdown', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"lists"}-->
#! Lists

 <!--hvy:component-list {"componentListComponent":"text"}-->

 <!--hvy:component-list {"componentListComponent":"text"}-->

  <!--hvy:component-list:0 {}-->

   <!--hvy:text {}-->
    Python
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.editor-block-passive').nth(0).click({ position: { x: 4, y: 4 } });
  let activeBlock = page.locator('.editor-block[data-active-editor-block="true"]');
  await expect(activeBlock.getByText('List Component Type')).toBeVisible();
  await activeBlock.getByRole('button', { name: 'Done' }).click();

  await page.locator('.editor-block-passive', { hasText: 'Python' }).first().click();
  activeBlock = page.locator('.editor-block[data-active-editor-block="true"]');
  await expect(activeBlock.locator('.rich-editor')).toContainText('Python');
  await expect(page.getByText('List type:')).toBeVisible();
  await expect(page.getByText('List Component Type')).toHaveCount(0);
  await expect(page.locator('[data-field="block-component-list-component"]')).toHaveCount(0);
});

test('move arrows only render when there is an adjacent target', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  let activeBlock = page.locator('.editor-block[data-active-editor-block="true"]');
  await expect(activeBlock.locator('[data-action="move-block-up"]')).toHaveCount(0);
  await expect(activeBlock.locator('[data-action="move-block-down"]')).toHaveCount(1);
  await activeBlock.getByRole('button', { name: 'Done' }).click();
  await page.locator('[data-action="activate-block"]').last().click();
  activeBlock = page.locator('.editor-block[data-active-editor-block="true"]');
  await expect(activeBlock.locator('[data-action="move-block-up"]')).toHaveCount(1);
  await expect(activeBlock.locator('[data-action="move-block-down"]')).toHaveCount(0);

  const sections = page.locator('.editor-tree > .editor-tree-body > .editor-section-card');
  await expect(sections.first().locator(':scope > .editor-section-head [data-action="move-section-up"]')).toHaveCount(0);
  await expect(sections.first().locator(':scope > .editor-section-head [data-action="move-section-down"]')).toHaveCount(0);

  await page.locator('[data-action="add-top-level-section"]').click();

  await expect(sections.first().locator(':scope > .editor-section-head [data-action="move-section-up"]')).toHaveCount(0);
  await expect(sections.first().locator(':scope > .editor-section-head [data-action="move-section-down"]')).toHaveCount(1);
  await expect(sections.last().locator(':scope > .editor-section-head [data-action="move-section-up"]')).toHaveCount(1);
  await expect(sections.last().locator(':scope > .editor-section-head [data-action="move-section-down"]')).toHaveCount(0);

  await page.reload();
  await page.getByRole('button', { name: 'Resume Template' }).click();
  await page.locator('.editor-tree .editor-block-passive .ghost-label', { hasText: 'Add Skill' }).first().click();

  activeBlock = page.locator('.editor-block[data-active-editor-block="true"]');
  await expect(activeBlock.locator('[data-action="move-block-up"]')).toHaveCount(1);
  await expect(activeBlock.locator('[data-action="move-block-down"]')).toHaveCount(0);
});

test('named empty sections offer a heading ghost in editor only', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"profile"}-->
#! Profile
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  const headingGhost = page.locator('.empty-section-heading-ghost');
  await expect(headingGhost).toBeVisible();
  await expect(headingGhost.locator('.empty-section-heading-watermark')).toContainText('Profile');
  await expect(headingGhost.getByRole('combobox', { name: 'Heading level' })).toHaveValue('h1');
  await expect(page.locator('.compact-add-component-ghost').getByRole('button', { name: 'Section component type' })).toBeVisible();

  await headingGhost.getByRole('combobox', { name: 'Heading level' }).selectOption('h2');
  await page.locator('.section-title-passive', { hasText: 'Profile' }).click();
  await expect(page.locator('.section-title-input')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.section-title-input')).toHaveCount(0);
  await expect(headingGhost.getByRole('combobox', { name: 'Heading level' })).toHaveValue('h2');

  await page.locator('.section-title-passive', { hasText: 'Profile' }).click();
  await expect(page.locator('.section-title-input')).toBeFocused();
  await page.keyboard.press('Control+Enter');

  await expect(page.locator('.editor-block[data-active-editor-block="true"] .rich-editor h2')).toContainText('Profile');
});
