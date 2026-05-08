import { expect, test, type Page } from '@playwright/test';

async function runCliCommand(page: Page, command: string): Promise<void> {
  const lineCount = await page.locator('#cliOutput .cli-line').count();
  const isPlaceholder = (await page.locator('#cliOutput').textContent())?.includes('/ $ man ls') ?? false;
  await page.locator('#cliInput').fill(command);
  await page.keyboard.press('Enter');
  await expect(page.locator('#cliOutput .cli-line')).toHaveCount(isPlaceholder ? lineCount : lineCount + 1);
}

function writeFileCommand(path: string, content: string): string {
  return `echo ${JSON.stringify(content.trimEnd().replace(/\n/g, '\\n'))} > ${path}`;
}

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

test('mobile adjustment hides text formatting and keeps expandable options read-only', async ({ page }) => {
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
  await page.getByRole('button', { name: 'Mobile Adjustment' }).click();

  await page.locator('.editor-block-passive', { has: page.locator('.expandable-reader') }).first().evaluate((node) => {
    (node as HTMLElement).click();
  });
  const activeBlock = page.locator('.editor-block', { has: page.locator('.expand-chooser-grid') }).first();

  await activeBlock.locator('[data-expandable-panel="stub"]').first().click();
  const alwaysShow = activeBlock.locator('[data-field="block-expandable-always"]');

  await expect(alwaysShow).toBeChecked();
  await expect(alwaysShow).toBeDisabled();

  await expect(activeBlock.locator('.rich-toolbar')).toHaveCount(0);
  await expect(activeBlock.getByRole('button', { name: 'Expandable stub component type' })).toHaveCount(0);

  await alwaysShow.evaluate((node) => {
    const checkbox = node as HTMLInputElement;
    checkbox.checked = false;
    checkbox.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
  await expect(alwaysShow).toBeChecked();
  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).toContainText('<!--hvy:expandable');
  await expect(page.locator('#rawEditor')).not.toContainText('"expandableAlwaysShowStub":false');
});

test('expandable pane meta owns always show and pane css controls', async ({ page }) => {
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
    Summary

  <!--hvy:expandable:content {}-->

   <!--hvy:text {}-->
    Expanded detail
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();

  await page.locator('.editor-block-passive', { has: page.locator('.expandable-reader') }).first().evaluate((node) => {
    (node as HTMLElement).click();
  });
  const activeBlock = page.locator('.editor-block', { has: page.locator('.expand-chooser-grid') }).first();

  await activeBlock.locator('[data-expandable-panel="stub"]').first().click();
  await expect(activeBlock.locator('.expandable-part-body [data-field="block-expandable-always"]')).toHaveCount(0);
  await expect(activeBlock.locator('.expandable-part-stub .expandable-header .expandable-pane-meta-button')).toBeVisible();
  await activeBlock.locator('.expandable-part-stub .expandable-pane-meta-button').click();
  await activeBlock.locator('[data-field="block-expandable-always"]').uncheck();
  await activeBlock.locator('[data-field="block-expandable-stub-css"]').fill('padding: 0.25rem;');

  await activeBlock.locator('[data-expandable-panel="expanded"]').first().click();
  await expect(activeBlock.locator('.expandable-part-expanded .expandable-header .expandable-pane-meta-button')).toBeVisible();
  await activeBlock.locator('.expandable-part-expanded .expandable-pane-meta-button').click();
  await activeBlock.locator('[data-field="block-expandable-content-css"]').fill('padding: 0.5rem;');

  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).toContainText('"expandableAlwaysShowStub":false');
  await expect(page.locator('#rawEditor')).toContainText('<!--hvy:expandable:stub {"css":"padding: 0.25rem;"}-->');
  await expect(page.locator('#rawEditor')).toContainText('<!--hvy:expandable:content {"css":"padding: 0.5rem;"}-->');
});

test('expandable pane meta buttons only render in advanced mode', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

 <!--hvy:expandable {"expandableExpanded":false}-->

  <!--hvy:expandable:stub {}-->

   <!--hvy:text {}-->
    Summary

  <!--hvy:expandable:content {}-->

   <!--hvy:text {}-->
    Expanded detail
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.editor-block-passive', { has: page.locator('.expandable-reader') }).first().click();
  let activeBlock = page.locator('.editor-block', { has: page.locator('.expand-chooser-grid') }).first();
  await activeBlock.locator('[data-expandable-panel="stub"]').first().click();
  await expect(activeBlock.locator('.expandable-pane-meta-button')).toHaveCount(0);

  await page.getByRole('button', { name: 'Advanced' }).click();
  activeBlock = page.locator('.editor-block', { has: page.locator('.expand-chooser-grid') }).first();
  await expect(activeBlock.locator('.expandable-part-stub .expandable-header .expandable-pane-meta-button')).toBeVisible();
  await expect(activeBlock.locator('.expandable-part-expanded .expandable-header .expandable-pane-meta-button')).toBeVisible();
});

test('expandable reader toggles from the styled outer block padding', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

 <!--hvy:expandable {"id":"padded-card","css":"padding: 1.5rem; border: 1px solid red;","expandableAlwaysShowStub":true,"expandableExpanded":false}-->

  <!--hvy:expandable:stub {}-->

   <!--hvy:text {}-->
    Clickable Stub

  <!--hvy:expandable:content {}-->

   <!--hvy:text {}-->
    Expanded detail
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Viewer' }).click();

  await expect(page.locator('#padded-card')).toHaveAttribute('data-reader-action', 'toggle-expandable');
  await expect(page.locator('#padded-card')).toHaveCSS('cursor', 'pointer');
  await expect(page.locator('#readerDocument')).not.toContainText('Expanded detail');

  const box = await page.locator('#padded-card').boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click((box?.x ?? 0) + 5, (box?.y ?? 0) + 5);

  await expect(page.locator('#readerDocument')).toContainText('Expanded detail');

  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await expect(page.locator('#editorTree')).not.toContainText('Expanded detail');
});

test('text toolbar fill-in converts selected text to a fill-in slot', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"header"}-->
#! Header

 <!--hvy:text {"id":"name","align":"center","placeholder":"Name"}-->
  # Name
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.editor-block-passive', { has: page.locator('#name') }).click();
  await page.locator('.rich-editor').evaluate((editable) => {
    const textNode = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT).nextNode();
    if (!textNode?.textContent) return;
    const start = textNode.textContent.indexOf('Name');
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + 'Name'.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.locator('.rich-editor').dispatchEvent('keyup');
  await expect(page.getByRole('button', { name: 'Convert to Fill-in' })).toBeVisible();
  await page.getByRole('button', { name: 'Convert to Fill-in' }).click();

  await expect(page.locator('[data-field="text-fill-in-value"]')).toBeVisible();
  await expect(page.locator('#editorTree h1 .text-fill-in-box')).toBeVisible();
  expect((await page.locator('[data-field="text-fill-in-value"]').boundingBox())?.width ?? 0).toBeGreaterThan(40);
  await page.locator('[data-field="text-fill-in-value"]').fill('Ada Lovelace');

  await expect(page.locator('#editorTree h1')).toHaveText('Ada Lovelace');
  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).toContainText('# Ada Lovelace');
  await expect(page.locator('#rawEditor')).not.toContainText('<!-- value -->');
  await expect(page.locator('#rawEditor')).not.toContainText('"fillIn"');
});

test('cancel restores text edits made after component activation', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"header"}-->
#! Header

 <!--hvy:text {"id":"name","align":"center","placeholder":"Name"}-->
  # Name
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.editor-block-passive', { has: page.locator('#name') }).click();
  await page.locator('.rich-editor').evaluate((editable) => {
    const textNode = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT).nextNode();
    if (!textNode?.textContent) return;
    const start = textNode.textContent.indexOf('Name');
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + 'Name'.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.locator('.rich-editor').dispatchEvent('keyup');
  await page.getByRole('button', { name: 'Convert to Fill-in' }).click();
  await expect(page.locator('[data-field="text-fill-in-value"]')).toBeVisible();

  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).toContainText('# Name');
  await expect(page.locator('#rawEditor')).not.toContainText('<!-- value -->');
  await expect(page.locator('#rawEditor')).not.toContainText('"fillIn"');
});

test('removing text fill-in keeps placeholder metadata out of document text', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"header"}-->
#! Header

 <!--hvy:text {"id":"name","align":"center","placeholder":"Name","fillIn":true}-->
  # <!-- value -->
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.editor-block-passive', { has: page.locator('#name') }).click();
  await page.getByRole('button', { name: 'Remove Fill-in' }).click();

  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).toContainText('"placeholder":"Name"');
  await expect(page.locator('#rawEditor')).toContainText('#');
  await expect(page.locator('#rawEditor')).not.toContainText('# Name');
  await expect(page.locator('#rawEditor')).not.toContainText('<!-- value -->');
  await expect(page.locator('#rawEditor')).not.toContainText('"fillIn"');
});

test('section highlight control lives in section meta next to contained', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Advanced' }).click();

  await expect(page.locator('#editorTree [data-field="section-highlight"]')).toHaveCount(0);
  await page.locator('[data-action="focus-modal"]').first().click();

  const metaModal = page.locator('.section-meta-modal');
  await expect(metaModal.getByLabel('Contained')).toBeVisible();
  await expect(metaModal.getByLabel('Highlight')).toBeVisible();

  const containedBox = await metaModal.getByLabel('Contained').boundingBox();
  const highlightBox = await metaModal.getByLabel('Highlight').boundingBox();
  expect(containedBox).not.toBeNull();
  expect(highlightBox).not.toBeNull();
  expect(Math.abs((containedBox?.y ?? 0) - (highlightBox?.y ?? 0))).toBeLessThan(12);

  await metaModal.getByLabel('Highlight').check();
  await metaModal.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).toContainText('"highlight":true');
});

test('active component done and cancel buttons are centered below the editor body', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const activeBlock = page.locator('.editor-block[data-active-editor-block="true"]').first();
  const cancelButton = activeBlock.locator('.editor-block-cancel-button');
  const doneButton = activeBlock.locator('.editor-block-done-button');

  await expect(activeBlock.locator('.editor-block-head').getByRole('button', { name: 'Done' })).toHaveCount(0);
  await expect(activeBlock.locator('.editor-block-head').getByRole('button', { name: 'Cancel' })).toHaveCount(0);
  await expect(cancelButton).toBeVisible();
  await expect(doneButton).toBeVisible();
  await expect(cancelButton).toHaveCSS('width', '64px');
  await expect(doneButton).toHaveCSS('width', '64px');

  const blockBox = await activeBlock.boundingBox();
  const cancelBox = await cancelButton.boundingBox();
  const doneBox = await doneButton.boundingBox();
  expect(blockBox).not.toBeNull();
  expect(cancelBox).not.toBeNull();
  expect(doneBox).not.toBeNull();
  const actionGroupLeft = cancelBox?.x ?? 0;
  const actionGroupRight = (doneBox?.x ?? 0) + (doneBox?.width ?? 0);
  expect(Math.abs((actionGroupLeft + (actionGroupRight - actionGroupLeft) / 2) - ((blockBox?.x ?? 0) + (blockBox?.width ?? 0) / 2))).toBeLessThan(4);
});

test('active component remove button is anchored to the editor frame corner', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const activeBlock = page.locator('.editor-block[data-active-editor-block="true"]').first();
  const removeButton = activeBlock.locator('.editor-block-remove-button');

  await expect(removeButton).toBeVisible();
  await expect(activeBlock.locator('.editor-block-head .editor-block-remove-button')).toHaveCount(0);

  const blockBox = await activeBlock.boundingBox();
  const buttonBox = await removeButton.boundingBox();
  expect(blockBox).not.toBeNull();
  expect(buttonBox).not.toBeNull();
  expect(buttonBox?.x ?? 0).toBeGreaterThan((blockBox?.x ?? 0) + (blockBox?.width ?? 0) - (buttonBox?.width ?? 0) - 8);
  expect(buttonBox?.y ?? 0).toBeLessThan(blockBox?.y ?? 0);
});

test('unfilled text fill-in renders as an editor box and blank viewer text', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"header"}-->
#! Header

 <!--hvy:text {"id":"name","align":"center","placeholder":"Name","fillIn":true}-->
  # <!-- value -->
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await expect(page.locator('#editorTree h1 .text-fill-in-box')).toBeVisible();
  await expect(page.locator('#editorTree')).not.toContainText('<!-- value -->');

  await page.getByRole('button', { name: 'AI' }).click();
  await expect(page.locator('#aiReaderDocument h1 .text-fill-in-box')).toBeVisible();
  await expect(page.locator('#aiReaderDocument')).not.toContainText('<!-- value -->');

  await page.getByRole('button', { name: 'Viewer' }).click();
  await expect(page.locator('#readerDocument')).not.toContainText('<!-- value -->');
  await expect(page.locator('#readerDocument .text-fill-in-box')).toHaveCount(0);
});

test('editor pullout help balloon lists loaded sidebar sections', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Resume Template' }).click();

  const balloon = page.locator('.editor-sidebar-help-balloon');
  await expect(balloon).toBeVisible();
  await expect(balloon.locator('li')).toContainText(['Skills', 'Tools & Technologies']);
  await expect(balloon).toHaveCSS('overflow', 'auto');

  await balloon.click();
  await expect(balloon).toHaveClass(/is-closing/);
  await expect(balloon).toBeHidden();

  await page.getByRole('button', { name: 'Resume Template' }).click();
  await expect(balloon).toBeVisible();
  await expect(balloon).toBeHidden({ timeout: 7000 });

  await page.getByRole('button', { name: 'Resume Template' }).click();
  await expect(balloon).toBeVisible();
  await page.locator('.editor-sidebar-tab').click();
  await expect(balloon).toBeHidden();
});

test('viewer pullout help balloon lists loaded sidebar sections', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Resume Template' }).click();
  await page.getByRole('button', { name: 'Viewer' }).click();

  const balloon = page.locator('.viewer-sidebar-help-balloon');
  await expect(balloon).toBeVisible();
  await expect(balloon.locator('li')).toContainText(['Skills', 'Tools & Technologies']);
  await expect(balloon).toHaveCSS('overflow', 'auto');

  await balloon.click();
  await expect(balloon).toHaveClass(/is-closing/);
  await expect(balloon).toBeHidden();

  await page.getByRole('button', { name: 'Resume Template' }).click();
  await page.getByRole('button', { name: 'Viewer' }).click();
  await expect(balloon).toBeVisible();
  await page.locator('.viewer-sidebar-tab').click();
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
  await page.addInitScript(() => {
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    (window as any).__hvyScrollIntoViewCalls = [];
    Element.prototype.scrollIntoView = function scrollIntoViewSpy(options?: boolean | ScrollIntoViewOptions): void {
      (window as any).__hvyScrollIntoViewCalls.push({
        activeEditorBlock: this instanceof Element && this.matches('[data-active-editor-block="true"]'),
        block: typeof options === 'object' ? options.block : undefined,
      });
      originalScrollIntoView.call(this, options as never);
    };
  });
  await page.goto('/');

  await page.getByRole('button', { name: 'Resume Template' }).click();
  const addSkill = page.locator('.editor-tree .editor-block-passive .add-ghost', { hasText: 'Add Skill' }).first();
  await expect(addSkill).toHaveCSS('cursor', 'pointer');
  await addSkill.click();

  const activatingBlocks = page.locator('.editor-block.is-activating-path');
  await expect(activatingBlocks).toHaveCount(3);
  await expect(activatingBlocks.nth(0)).toHaveAttribute('style', /--editor-activation-delay: 0ms;/);
  await expect(activatingBlocks.nth(1)).toHaveAttribute('style', /--editor-activation-delay: 150ms;/);
  await expect(activatingBlocks.nth(2)).toHaveAttribute('style', /--editor-activation-delay: 300ms;/);
  await expect(page.locator('.editor-block[data-active-editor-block="true"] [contenteditable="true"]').first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__hvyScrollIntoViewCalls.some(
    (call: { activeEditorBlock: boolean; block?: ScrollLogicalPosition }) => call.activeEditorBlock && call.block === 'center'
  ))).toBe(true);
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

test('active nested list item exposes delete controls on ancestor components', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"history"}-->
#! History

 <!--hvy:component-list {"id":"history-list","componentListComponent":"expandable"}-->

  <!--hvy:component-list:0 {}-->

   <!--hvy:expandable {"id":"history-row","expandableExpanded":true}-->

    <!--hvy:expandable:stub {}-->

     <!--hvy:text {}-->
      Heavy Resume

    <!--hvy:expandable:content {}-->

     <!--hvy:text {}-->
      Founder details
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.editor-block-passive', { hasText: 'Founder details' }).last().click();

  await expect(page.locator('.editor-block-head', { hasText: 'component-list' }).locator('[data-action="remove-block"]')).toBeVisible();
  await expect(page.locator('.editor-block-head', { hasText: 'expandable' }).locator('[data-action="remove-block"]')).toBeVisible();

  await page.locator('.editor-block-head', { hasText: 'expandable' }).locator('[data-action="remove-block"]').click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Raw' }).click();
  const raw = await page.locator('#rawEditor').inputValue();
  expect(raw).not.toContain('Founder details');
  expect(raw).toContain('component-list');
});

test('cli-created expanded history record can be closed and followed by another list item', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Resume Template' }).click();
  await page.getByRole('button', { name: 'CLI' }).click();
  await runCliCommand(page, 'hvy insert 0 history-record /body/history/component-list-2 --id history-reproco-founder --using-template \'{"years":"","organization":"","role":"","location":"","date_range":"","description":""}\'');
  await runCliCommand(page, writeFileCommand('/body/history/component-list-2/history-reproco-founder/expandable-stub/table-0/tableRows.json', '[{"cells":["2025-2026","ReproCo","Founder"]}]'));
  await runCliCommand(page, writeFileCommand('/body/history/component-list-2/history-reproco-founder/expandable-content/text-0/text.txt', '### ReproCo'));

  await page.getByRole('button', { name: 'AI' }).click();
  const aiRecord = page.locator('#aiReaderDocument .reader-block', { hasText: 'ReproCo' }).first();
  await aiRecord.locator('[data-reader-action="toggle-expandable"]').first().click();

  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await expect(page.locator('.passive-list-add-ghost', { hasText: 'Add History' }).first()).toBeVisible();
  const passiveRecord = page.locator('.editor-block-passive', { hasText: 'ReproCo' }).last();
  await expect(passiveRecord).not.toContainText('Empty text');

  await passiveRecord.click();
  const activeRecord = page.locator('.editor-block[data-active-editor-block="true"]');
  await expect(activeRecord).not.toContainText('Empty text');
  await activeRecord.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.editor-block[data-active-editor-block="true"]')).toHaveCount(0);
  await expect(page.locator('.passive-list-add-ghost', { hasText: 'Add History' }).first()).toBeVisible();

  await page.locator('.passive-list-add-ghost', { hasText: 'Add History' }).first().click();
  await page.locator('.modal-panel', { hasText: 'history-record' }).getByRole('button', { name: 'Insert' }).click();
  await page.getByRole('button', { name: 'Raw' }).click();
  const raw = await page.locator('#rawEditor').inputValue();
  expect(raw.match(/<!--hvy:history-record/g) ?? []).toHaveLength(2);
});

test('editing a second component-list item does not overwrite the first item', async ({ page }) => {
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

  await page.locator('.editor-block-passive', { hasText: 'TypeScript' }).last().click();
  const activeEditor = page.locator('.editor-block[data-active-editor-block="true"] .rich-editor');
  await expect(activeEditor).toContainText('TypeScript');
  await activeEditor.fill('Rust');

  await page.getByRole('button', { name: 'Raw' }).click();
  const raw = await page.locator('#rawEditor').inputValue();
  expect(raw).toContain('Python');
  expect(raw).toContain('Rust');
  expect(raw).not.toContain('TypeScript');
  expect(raw.indexOf('Python')).toBeLessThan(raw.indexOf('Rust'));
});

test('editing the second resume project does not duplicate it after done', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Resume Example' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  const projectEntry = page.locator('.editor-block-passive', { hasText: 'Autonomous Agent Hackathon' }).last();
  await projectEntry.click();
  await page.locator('[data-expandable-panel="expanded"]').last().click();
  await page.locator('.editor-block-passive', { hasText: 'Autonomous Agent Hackathon' }).last().click();
  const expandedTitleEditor = page.locator('.rich-editor', { hasText: 'Autonomous Agent Hackathon' }).first();
  await expect(expandedTitleEditor).toBeVisible();
  await expandedTitleEditor.click();
  await page.getByRole('button', { name: 'H2' }).click();

  const projectRecordEditor = page.locator('.editor-block', { has: page.locator('.editor-block-title', { hasText: 'project-record' }) }).last();
  await projectRecordEditor.getByRole('button', { name: 'Done' }).first().click();
  await expect(page.locator('.editor-block[data-active-editor-block="true"]')).toHaveCount(0);

  await page.getByRole('button', { name: 'Raw' }).click();
  const raw = await page.locator('#rawEditor').inputValue();
  expect(raw.match(/<!--hvy:project-record/g) ?? []).toHaveLength(2);
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

  await page.locator('.editor-block-passive', { hasText: 'Python' }).last().click();
  activeBlock = page.locator('.editor-block[data-active-editor-block="true"]');
  await expect(activeBlock.locator('.rich-editor')).toContainText('Python');
  await expect(page.getByText('List type:')).toBeVisible();
  await expect(page.getByText('List Component Type')).toHaveCount(0);
  await expect(page.locator('[data-field="block-component-list-component"]')).toHaveCount(0);
});

test('component move and copy use placement boundaries', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"main"}-->
#! Main

 <!--hvy:text {"id":"alpha"}-->
  Alpha

 <!--hvy:text {"id":"beta"}-->
  Beta
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.editor-block-passive', { hasText: 'Alpha' }).click();
  await page.locator('.editor-block[data-active-editor-block="true"] [data-action="start-component-copy"]').click();
  await expect(page.locator('.component-placement-target')).toHaveCount(3);
  await page.locator('.editor-section-head').first().click();
  await expect(page.locator('.component-placement-target')).toHaveCount(0);

  await page.locator('.editor-block[data-active-editor-block="true"] [data-action="start-component-copy"]').click();
  await expect(page.locator('.component-placement-target')).toHaveCount(3);
  await page.locator('[data-action="place-component"][data-placement="after"]').nth(1).click();

  await page.locator('.editor-block-passive', { hasText: 'Beta' }).first().click();
  await page.locator('.editor-block[data-active-editor-block="true"] [data-action="start-component-move"]').click();
  await page.locator('[data-action="place-component"][data-placement="before"]').first().click();

  await page.getByRole('button', { name: 'Raw' }).click();
  const raw = await page.locator('#rawEditor').inputValue();
  expect(raw.indexOf('Beta')).toBeLessThan(raw.indexOf('Alpha'));
  expect(raw.match(/Alpha/g)).toHaveLength(2);
});

test('component placement supports grid slots', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"main"}-->
#! Main

 <!--hvy:grid {"id":"layout","gridColumns":2}-->
  <!--hvy:grid:0 {}-->

   <!--hvy:text {"id":"one"}-->
    One

  <!--hvy:grid:1 {}-->

   <!--hvy:text {"id":"two"}-->
    Two
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.reader-grid-cell .editor-block-passive', { hasText: 'One' }).click();
  await page.locator('.editor-block[data-active-editor-block="true"] [data-action="start-component-copy"]').click();

  await expect(page.locator('[data-placement-container="grid"]')).toHaveCount(3);
  await expect(page.locator('.grid-add-ghost')).toHaveCount(0);
  await page.locator('[data-placement-container="grid"][data-placement="after"]').first().click();

  await page.getByRole('button', { name: 'Raw' }).click();
  const raw = await page.locator('#rawEditor').inputValue();
  expect(raw.match(/One/g)).toHaveLength(2);
  expect(raw.indexOf('One')).toBeLessThan(raw.indexOf('Two'));
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
