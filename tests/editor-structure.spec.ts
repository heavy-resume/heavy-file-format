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

test('text editing inside expandable uses text cursor while buttons use pointer cursor', async ({ page }) => {
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

  await page.locator('.editor-block-passive', { has: page.locator('.expandable-reader') }).first().click();
  const expandableEditor = page.locator('.editor-block', { has: page.locator('.expand-chooser-grid') }).first();
  await expandableEditor.locator('[data-expandable-panel="stub"]').first().click();

  await expandableEditor.locator('.expandable-part-stub .editor-block-passive').first().click();
  await expect(expandableEditor.locator('.expandable-part-stub .rich-editor')).toHaveCSS('cursor', 'text');
  await expect(page.getByRole('button', { name: 'Done' }).first()).toHaveCSS('cursor', 'pointer');
});

test('typing in expandable nested text preserves focus without reader refresh', async ({ page }) => {
  const perfMessages: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (text.includes('[hvy:perf] refreshReaderPanels')) {
      perfMessages.push(text);
    }
  });
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

 <!--hvy:expandable {"expandableAlwaysShowStub":true,"expandableExpanded":true}-->

  <!--hvy:expandable:stub {}-->

   <!--hvy:text {}-->
    Stub

  <!--hvy:expandable:content {}-->

   <!--hvy:text {}-->
    Expanded detail
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();

  await page.locator('.editor-block-passive', { has: page.locator('.expandable-reader') }).first().click();
  await page.locator('[data-expandable-panel="expanded"]').last().click();
  await page.locator('.editor-block-passive', { hasText: 'Expanded detail' }).last().click();

  const editor = page.locator('.editor-block[data-active-editor-block="true"] .rich-editor');
  await editor.click();
  perfMessages.length = 0;
  await page.keyboard.type(' stays focused');

  await expect(editor).toBeFocused();
  await expect(editor).toContainText('Expanded detail stays focused');
  expect(perfMessages).toHaveLength(0);
});

test('passive empty expandable shows stub and expanded placeholders', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();
  await page.locator('[data-action="add-block"][data-component="expandable"]').first().evaluate((node) => {
    (node as HTMLElement).click();
  });
  await page.locator('[data-action="deactivate-block"]').first().click();

  const passiveExpandable = page.locator('.editor-block-passive', { has: page.locator('.expandable-reader') }).first();
  await expect(passiveExpandable.locator('.expandable-passive-empty-ghost', { hasText: 'Empty stub' })).toBeVisible();
  await expect(passiveExpandable.locator('.expandable-passive-empty-ghost', { hasText: 'Empty expanded content' })).toBeVisible();
});

test('ai xref click waits for double click edit gesture', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

 <!--hvy:xref-card {"xrefTitle":"Target","xrefTarget":"target"}-->

<!--hvy: {"id":"target"}-->
#! Target

 Target details
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'AI' }).click();

  const xref = page.locator('#aiReaderDocument .reader-xref-card', { hasText: 'Target' }).first();
  const targetSection = page.locator('#aiReaderDocument #target').first();
  await xref.click();
  await page.waitForTimeout(180);
  await expect(targetSection).not.toHaveClass(/is-temp-highlighted/);
  await expect(targetSection).toHaveClass(/is-temp-highlighted/, { timeout: 800 });

  await xref.dblclick();
  await expect(page.locator('.hvy-context-popover')).toContainText('Request changes');
});

test('typing an xref title in ai mode preserves focus', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

 <!--hvy:xref-card {"xrefTitle":"Untitled","xrefTarget":"target"}-->

<!--hvy: {"id":"target"}-->
#! Target
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'AI' }).click();

  await page.locator('#aiReaderDocument .reader-xref-card', { hasText: 'Untitled' }).dblclick();
  await page.getByRole('button', { name: 'Edit component' }).click();
  const title = page.locator('#aiReaderDocument .editor-block[data-active-editor-block="true"] [data-field="block-xref-title"]');
  await title.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.type('Heavy Stack');

  await expect(title).toBeFocused();
  await expect(title).toHaveText('Heavy Stack');
});

test('ai double click opens component menu without leaving text selected', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

 Selectable summary words
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'AI' }).click();

  await page.locator('#aiReaderDocument .reader-block', { hasText: 'Selectable summary words' }).dblclick();
  await expect(page.locator('.hvy-context-popover')).toContainText('Request changes');
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
});

test('ai placeholder text inside collapsed expandable expands before editing', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

 <!--hvy:expandable {"expandableAlwaysShowStub":true,"expandableExpanded":false}-->

  <!--hvy:expandable:stub {}-->

   <!--hvy:text {"id":"summary-short","placeholder":"Short professional summary"}-->
    # Summary

  <!--hvy:expandable:content {}-->

   <!--hvy:text {"id":"summary-detail","placeholder":"Expanded professional summary"}-->
    Expanded detail
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'AI' }).click();

  const expandable = page.locator('#aiReaderDocument .reader-block-expandable').first();
  await page.locator('#aiReaderDocument .reader-block-text[data-component-id="summary-short"]').click();

  await expect(expandable).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#aiReaderDocument .editor-block[data-active-editor-block="true"]')).toHaveCount(0);

  await page.locator('#aiReaderDocument .reader-block-text[data-component-id="summary-short"]').click();
  const activeTextEditor = page.locator('#aiReaderDocument .editor-block[data-active-editor-block="true"] .rich-editor');
  await expect(activeTextEditor).toBeVisible();
  await expect(activeTextEditor).toContainText('Summary');
});

test('ai resume summary placeholder expands parent before editing', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Resume Example' }).click();
  await page.getByRole('button', { name: 'AI' }).click();

  const summaryPlaceholder = page.locator('#aiReaderDocument .reader-block-text').filter({ has: page.locator('h1', { hasText: 'Summary' }) }).first();
  await expect(summaryPlaceholder).toHaveCSS('cursor', 'text');
  await summaryPlaceholder.click();

  await expect(page.locator('#aiReaderDocument .reader-block-expandable[aria-expanded="true"]')).toHaveCount(1);
  await expect(page.locator('#aiReaderDocument .editor-block[data-active-editor-block="true"]')).toHaveCount(0);
});

test('ai resume summary placeholder margin expands parent before editing', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Resume Example' }).click();
  await page.getByRole('button', { name: 'AI' }).click();

  await page.locator('#aiReaderDocument .expand-stub-toggle').first().dispatchEvent('click', {
    bubbles: true,
    cancelable: true,
  });

  await expect(page.locator('#aiReaderDocument .reader-block-expandable[aria-expanded="true"]')).toHaveCount(1);
  await expect(page.locator('#aiReaderDocument .editor-block[data-active-editor-block="true"]')).toHaveCount(0);
});

test('ai resume summary body text expands parent instead of opening text editor', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Resume Example' }).click();
  await page.getByRole('button', { name: 'AI' }).click();

  await page
    .locator('#aiReaderDocument .reader-block-text', { hasText: 'Product-minded software engineer' })
    .first()
    .click();

  await expect(page.locator('#aiReaderDocument .editor-block[data-active-editor-block="true"]')).toHaveCount(0);
  await expect(page.locator('#aiReaderDocument .reader-block-expandable[aria-expanded="true"]')).toHaveCount(1);
});

test('ai sidebar skill click expands collapsed record before editing', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Resume Example' }).click();
  await page.getByRole('button', { name: 'AI' }).click();
  await page.locator('.viewer-sidebar-tab').click();

  const skillsSection = page.locator('#aiSidebarSections #skills');
  await skillsSection.click();
  await expect(skillsSection).not.toHaveClass(/is-collapsed-preview/);

  const skillRecord = skillsSection.locator('.reader-block-expandable[data-component-id="skill-software-engineering"]').first();
  await expect(skillRecord).toHaveAttribute('aria-expanded', 'false');

  await skillRecord.locator('.reader-block-text', { hasText: 'Software Engineering' }).first().click();

  await expect(skillRecord).toHaveAttribute('aria-expanded', 'true');
  await expect(skillsSection.locator('.editor-block[data-active-editor-block="true"]')).toHaveCount(0);
});

test('ai filled placeholder text does not open inline editing on click', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

 <!--hvy:text {"id":"skill-name","placeholder":"### Skill name"}-->
  ### Programming
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'AI' }).click();

  await page.locator('#aiReaderDocument .reader-block-text[data-component-id="skill-name"]', { hasText: 'Programming' }).click();
  await expect(page.locator('#aiReaderDocument .editor-block[data-active-editor-block="true"]')).toHaveCount(0);
});

test('canceling a newly added featured xref removes it without opening list editor', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Resume Example' }).click();

  const topSkillsList = page.locator('[data-component-id="top-skills-list"]').first();
  await topSkillsList.locator('[data-action="add-component-list-item"]').click();

  const activeEditor = page.locator('.editor-block[data-active-editor-block="true"]');
  await expect(activeEditor.locator('.editor-block-title').first()).toContainText('skill-xref-card');
  await expect(activeEditor.locator('select[data-field="block-xref-target"] option[value="skill-software-engineering"]')).toHaveText('Software Engineering');
  await activeEditor.getByRole('button', { name: 'Cancel' }).click();

  await expect(page.locator('[data-component-id="top-skills-list"]')).not.toContainText('Untitled');
  await expect(page.locator('.editor-block[data-active-editor-block="true"]')).toHaveCount(0);
});

test('new featured xref populates title from target defaults', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Resume Example' }).click();

  const topSkillsList = page.locator('[data-component-id="top-skills-list"]').first();
  await topSkillsList.locator('[data-action="add-component-list-item"]').click();

  const activeEditor = page.locator('.editor-block[data-active-editor-block="true"]');
  await activeEditor.locator('[data-field="block-xref-target"]').selectOption('skill-software-engineering');

  await expect(activeEditor.locator('[data-field="block-xref-title"]')).toHaveText('Software Engineering');
});

test('xref template picker explains when no tagged targets are available', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
component_defs:
  - name: skill-xref-card
    baseType: xref-card
    schema:
      xrefTargetTagFilter: skill
---

<!--hvy: {"id":"summary"}-->
#! Summary

 <!--hvy:component-list {"componentListComponent":"skill-xref-card","componentListItemLabel":"skill reference"}-->
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'AI' }).click();

  await page.locator('#aiReaderDocument [data-action="add-component-list-item"]', { hasText: 'Add Skill Reference' }).click();
  const activeEditor = page.locator('#aiReaderDocument .editor-block[data-active-editor-block="true"]');

  await expect(activeEditor.locator('[data-field="block-xref-target"]')).toBeDisabled();
  await expect(activeEditor).toContainText('No skill targets available yet.');
});

test('ai done on an xref without a target removes the draft xref', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
component_defs:
  - name: skill-xref-card
    baseType: xref-card
    schema:
      xrefTargetTagFilter: skill
---

<!--hvy: {"id":"summary"}-->
#! Summary

 <!--hvy:component-list {"id":"top-skills-list","componentListComponent":"skill-xref-card","componentListItemLabel":"skill xref"}-->

<!--hvy: {"id":"skills","location":"sidebar"}-->
#! Skills

 <!--hvy:text {"id":"skill-foo","tags":"skill","xrefTitle":"Foo"}-->
  Foo
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'AI' }).click();

  await page.locator('#aiReaderDocument [data-action="add-component-list-item"]', { hasText: 'Add Skill Xref' }).click();
  const activeEditor = page.locator('#aiReaderDocument .editor-block[data-active-editor-block="true"]');
  await expect(activeEditor.locator('[data-field="block-xref-target"]')).toHaveValue('');

  await activeEditor.getByRole('button', { name: 'Done' }).click();

  await expect(page.locator('#aiReaderDocument .editor-block[data-active-editor-block="true"]')).toHaveCount(0);
  await expect(page.locator('#aiReaderDocument [data-component-id="top-skills-list"]')).not.toContainText('Untitled');
  await expect(page.locator('#aiReaderDocument .reader-xref-card')).toHaveCount(0);
});

test('featured xref helper script reruns after adding a featured xref', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
component_defs:
  - name: skill-xref-card
    baseType: xref-card
    schema:
      xrefTargetTagFilter: skill
---

<!--hvy: {"id":"top-skills-tools-technologies"}-->
#! Featured

 <!--hvy:text {"id":"featured-xref-helper","editorOnly":true}-->
  Tip: Add a featured skill or tool / technology via the sidebar and link it here

 <!--hvy:component-list {"id":"top-skills-list","componentListComponent":"skill-xref-card","componentListItemLabel":"skill xref"}-->

<!--hvy: {"id":"skills","location":"sidebar"}-->
#! Skills

 <!--hvy:text {"id":"skill-foo","tags":"skill","xrefTitle":"Foo"}-->
  Foo

<!--hvy: {"id":"template-maintenance","editorOnly":true}-->
#! Template Maintenance

 <!--hvy:plugin {"id":"remove-featured-xref-helper","editorOnly":true,"plugin":"dev.heavy.scripting","pluginConfig":{"version":"0.1"}}-->
  def has_xref(list_id):
      try:
          raw = doc.tool.view_component(component_ref=list_id)
      except Exception:
          return False
      return '"xrefTarget":"' in raw or '"xrefTarget": "' in raw

  if has_xref("top-skills-list"):
      doc.tool.remove_component(component_ref="featured-xref-helper")
      doc.tool.remove_component(component_ref="remove-featured-xref-helper")
`);
  await page.getByRole('button', { name: 'Apply' }).click({ force: true });
  await page.getByRole('button', { name: 'AI' }).click();

  await expect(page.locator('#aiReaderDocument')).toContainText('Tip: Add a featured skill');
  await page.locator('#aiReaderDocument [data-action="add-component-list-item"]', { hasText: 'Add Skill Xref' }).click();
  const activeEditor = page.locator('#aiReaderDocument .editor-block[data-active-editor-block="true"]');
  await activeEditor.locator('[data-field="block-xref-target"]').selectOption('skill-foo');
  await activeEditor.getByRole('button', { name: 'Done' }).click();

  await expect(page.locator('#aiReaderDocument')).not.toContainText('Tip: Add a featured skill');
});

test('ai canceling a newly added education reference removes it without opening list editor', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
component_defs:
  - name: education-xref-card
    baseType: xref-card
    schema:
      xrefTargetTagFilter: education
      css: "margin: 0.25rem 0;"
---

<!--hvy: {"id":"summary"}-->
#! Summary

 <!--hvy:component-list {"componentListComponent":"education-xref-card","componentListItemLabel":"education reference"}-->

<!--hvy: {"id":"history-target","tags":"history"}-->
#! History Target

 History target

<!--hvy: {"id":"education-target","tags":"education"}-->
#! Education Target

 Education target

<!--hvy: {"id":"project-target","tags":"project"}-->
#! Project Target

 Project target
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'AI' }).click();

  await page.locator('#aiReaderDocument [data-action="add-component-list-item"]', { hasText: 'Add Education Reference' }).click();
  const activeEditor = page.locator('#aiReaderDocument .editor-block[data-active-editor-block="true"]');
  await expect(activeEditor.locator('.editor-block-title').first()).toContainText('education-xref-card');
  await expect(activeEditor.locator('select[data-field="block-xref-target"] option[value="education-target"]')).toHaveCount(1);
  await expect(activeEditor.locator('select[data-field="block-xref-target"] option[value="history-target"]')).toHaveCount(0);
  await expect(activeEditor.locator('select[data-field="block-xref-target"] option[value="project-target"]')).toHaveCount(0);
  await activeEditor.getByRole('button', { name: 'Cancel' }).click();

  await expect(page.locator('#aiReaderDocument')).not.toContainText('Untitled');
  await expect(page.locator('#aiReaderDocument .editor-block[data-active-editor-block="true"]')).toHaveCount(0);
  await expect(page.locator('#aiReaderDocument .component-list-view-editor')).toHaveCount(0);
});

test('ai deleting an edited education reference does not open the parent list editor', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
component_defs:
  - name: education-xref-card
    baseType: xref-card
    schema:
      xrefTargetTagFilter: education
      css: "margin: 0.25rem 0;"
---

<!--hvy: {"id":"summary"}-->
#! Summary

 <!--hvy:component-list {"componentListComponent":"education-xref-card","componentListItemLabel":"education reference"}-->

  <!--hvy:component-list:0 {}-->

   <!--hvy:education-xref-card {"xrefTitle":"B.S. Computer Science","xrefTarget":"education-bs-computer-science"}-->
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'AI' }).click();

  await page.locator('#aiReaderDocument .reader-xref-card', { hasText: 'B.S. Computer Science' }).dblclick();
  await page.locator('.hvy-context-popover button', { hasText: 'Edit component' }).click();
  const activeEditor = page.locator('#aiReaderDocument .editor-block[data-active-editor-block="true"]');
  await expect(activeEditor.locator('.editor-block-title').first()).toContainText('education-xref-card');
  await activeEditor.locator('> [data-action="remove-block"]').click();
  await page.getByRole('dialog', { name: 'Confirm deletion?' }).getByRole('button', { name: 'Delete' }).click();

  await expect(page.locator('#aiReaderDocument')).not.toContainText('B.S. Computer Science');
  await expect(page.locator('#aiReaderDocument .editor-block[data-active-editor-block="true"]')).toHaveCount(0);
  await expect(page.locator('#aiReaderDocument .component-list-view-editor')).toHaveCount(0);
});

test('ai adding history reference inside expandable does not collapse expandable', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
component_defs:
  - name: history-xref-card
    baseType: xref-card
    schema:
      xrefTargetTagFilter: history
      css: "margin: 0.25rem 0;"
---

<!--hvy: {"id":"summary"}-->
#! Summary

 <!--hvy:expandable {"id":"skill-record","expandableAlwaysShowStub":true,"expandableExpanded":true}-->

  <!--hvy:expandable:stub {}-->

   <!--hvy:text {}-->
    ### Skill

  <!--hvy:expandable:content {}-->

   <!--hvy:component-list {"id":"history-refs","componentListComponent":"history-xref-card","componentListItemLabel":"history reference"}-->

    <!--hvy:component-list:0 {}-->

     <!--hvy:history-xref-card {"xrefTitle":"Existing History","xrefTarget":"history-existing"}-->

<!--hvy: {"id":"history-existing","tags":"history"}-->
#! Existing History
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'AI' }).click();

  const expandable = page.locator('#aiReaderDocument .reader-block-expandable[data-component-id="skill-record"]');
  await expect(expandable).toHaveAttribute('aria-expanded', 'true');
  const addGhost = expandable.locator('[data-action="add-component-list-item"]', { hasText: 'Add History Reference' });
  await addGhost.hover();
  const hoverState = await expandable.evaluate((node) => ({
    afterContent: getComputedStyle(node, '::after').content,
    boxShadow: getComputedStyle(node).boxShadow,
  }));
  expect(hoverState.afterContent).toBe('none');
  expect(hoverState.boxShadow).toBe('none');
  await addGhost.click();

  await expect(expandable).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#aiReaderDocument .editor-block[data-active-editor-block="true"] .editor-block-title').first()).toContainText('history-xref-card');
});

test('ai mode template-created skill stays in passive reader mode', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Resume Template' }).click();
  await page.locator('[data-action="switch-view"][data-view="ai"]').click();
  await page.locator('.viewer-sidebar-tab').click();

  await page.locator('#aiSidebarSections #skills [data-action="add-component-list-item"]', { hasText: 'Add Skill' }).click();
  const modal = page.locator('.modal-root', { has: page.locator('input[data-template-variable="skill"]') });
  await expect(modal.locator('input[data-template-variable="skill"]')).toBeVisible();
  await modal.locator('input[data-template-variable="skill"]').fill('Programming');
  await modal.locator('[data-modal-action="insert-reusable-template"]').click();

  await expect(page.locator('#aiSidebarSections .editor-block[data-active-editor-block="true"]')).toHaveCount(0);
  await expect(page.locator('#aiSidebarSections .component-list-view-editor')).toHaveCount(0);
  await expect(page.locator('#aiSidebarSections #skills')).toContainText('Programming');

  const newSkill = page.locator('#aiSidebarSections #skills .reader-block-expandable', { hasText: 'Programming' }).first();
  await newSkill.locator('.reader-block-text', { hasText: 'Programming' }).click();
  await expect(page.locator('#aiSidebarSections .editor-block[data-active-editor-block="true"]')).toHaveCount(0);
  await expect(newSkill).toHaveAttribute('aria-expanded', 'true');
});

test('new tagged reusable template record gets an auto id for xref options', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
component_defs:
  - name: project-record
    baseType: expandable
    templateVariables:
      project:
        label: Project name
    schema:
      tags: project
      expandableAlwaysShowStub: true
      expandableStubBlocks:
        children:
          - text: "{% project %}"
            schema:
              component: text
      expandableContentBlocks:
        children: []
  - name: project-xref-card
    baseType: xref-card
    schema:
      xrefTargetTagFilter: project
---

<!--hvy: {"id":"projects"}-->
#! Projects

 <!--hvy:component-list {"id":"project-list","tags":"project","componentListComponent":"project-record","componentListItemLabel":"project"}-->

<!--hvy: {"id":"featured"}-->
#! Featured

 <!--hvy:component-list {"id":"project-refs","componentListComponent":"project-xref-card","componentListItemLabel":"project reference"}-->
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'AI' }).click();

  await page.locator('#aiReaderDocument #projects [data-action="add-component-list-item"]', { hasText: 'Add Project' }).click();
  const modal = page.locator('.modal-root', { has: page.locator('input[data-template-variable="project"]') });
  await modal.locator('input[data-template-variable="project"]').fill('Heavy Stack');
  await modal.locator('[data-modal-action="insert-reusable-template"]').click();

  await expect(page.locator('#aiReaderDocument .editor-block[data-active-editor-block="true"]')).toHaveCount(0);
  await expect(page.locator('#aiReaderDocument [data-component-id="project-heavy-stack"]')).toContainText('Heavy Stack');

  await page.locator('#aiReaderDocument #featured [data-action="add-component-list-item"]', { hasText: 'Add Project Reference' }).click();
  const xrefEditor = page.locator('#aiReaderDocument .editor-block[data-active-editor-block="true"]');
  await expect(xrefEditor.locator('.editor-block-title').first()).toContainText('project-xref-card');
  await expect(xrefEditor.locator('select[data-field="block-xref-target"] option[value="project-heavy-stack"]')).toHaveText('Heavy Stack');
  await xrefEditor.locator('[data-field="block-xref-target"]').selectOption('project-heavy-stack');
  await expect(xrefEditor.locator('[data-field="block-xref-target"]')).toHaveValue('project-heavy-stack');
  await expect(xrefEditor.locator('[data-field="block-xref-title"]')).toHaveText('Heavy Stack');
});

test('ai context menu stays inside phone preview when opened near the edge', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

 Edge-aware summary words
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'AI' }).click();
  await page.getByRole('button', { name: 'Phone 390' }).click();

  const shell = page.locator('.viewer-shell').first();
  await expect.poll(async () => Math.round((await shell.boundingBox())?.width ?? 0)).toBe(390);
  const shellBox = await shell.boundingBox();
  expect(shellBox).not.toBeNull();

  await page.locator('#aiReaderDocument .reader-block', { hasText: 'Edge-aware summary words' }).dispatchEvent('contextmenu', {
    clientX: (shellBox?.x ?? 0) + (shellBox?.width ?? 0) - 4,
    clientY: (shellBox?.y ?? 0) + 80,
    button: 2,
  });
  await expect(page.locator('.hvy-context-popover')).toContainText('Request changes');

  const menuBox = await page.locator('.hvy-context-popover').boundingBox();
  expect(menuBox).not.toBeNull();
  expect((menuBox?.x ?? 0) + (menuBox?.width ?? 0)).toBeLessThanOrEqual((shellBox?.x ?? 0) + (shellBox?.width ?? 0) + 1);
  expect(menuBox?.x ?? 0).toBeGreaterThanOrEqual((shellBox?.x ?? 0) - 1);
  expect(Math.abs(((menuBox?.x ?? 0) + (menuBox?.width ?? 0) / 2) - ((shellBox?.x ?? 0) + (shellBox?.width ?? 0) / 2))).toBeLessThanOrEqual(2);

  await page.locator('.hvy-context-popover button', { hasText: 'Request changes' }).click();
  await expect(page.locator('.ai-edit-popover')).toBeVisible();
  const requestBox = await page.locator('.ai-edit-popover').boundingBox();
  expect(requestBox).not.toBeNull();
  expect((requestBox?.x ?? 0) + (requestBox?.width ?? 0)).toBeLessThanOrEqual((shellBox?.x ?? 0) + (shellBox?.width ?? 0) + 1);
  expect(requestBox?.x ?? 0).toBeGreaterThanOrEqual((shellBox?.x ?? 0) - 1);
});

test('ai expandable click waits for double click edit gesture', async ({ page }) => {
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
    Open details

  <!--hvy:expandable:content {}-->

   <!--hvy:text {}-->
    Hidden details

 <!--hvy:text {}-->
  Another block
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'AI' }).click();

  const toggle = page.locator('#aiReaderDocument [data-reader-action="toggle-expandable"]').first();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await page.waitForTimeout(180);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true', { timeout: 800 });

  await toggle.dblclick();
  await expect(page.locator('.hvy-context-popover')).toContainText('Request changes');
  await expect(page.locator('.hvy-context-popover-backdrop')).toBeVisible();
  await expect(page.locator('.hvy-context-popover-backdrop-top')).toHaveCSS('backdrop-filter', /blur/);
  await expect(page.locator('.reader-block.is-context-menu-target')).toHaveCSS('visibility', 'hidden');
  await expect(page.locator('.hvy-context-popover-clone')).toBeVisible();
  const targetBox = await page.locator('.reader-block.is-context-menu-target').boundingBox();
  const cloneBox = await page.locator('.hvy-context-popover-clone').boundingBox();
  expect(Math.abs((targetBox?.y ?? 0) - (cloneBox?.y ?? 0))).toBeLessThan(1);
  expect(Math.abs((targetBox?.x ?? 0) - (cloneBox?.x ?? 0))).toBeLessThan(1);
  await page.locator('.hvy-context-popover-backdrop-target').click({ position: { x: 12, y: 12 } });
  await expect(page.locator('.hvy-context-popover')).toHaveCount(0);
  await page.waitForTimeout(500);
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
});

test('closing context popover does not remove an existing modal', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

 Context popover target
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'AI' }).click();

  await page.locator('#aiReaderDocument .reader-block', { hasText: 'Context popover target' }).dblclick();
  await expect(page.locator('.hvy-context-popover')).toContainText('Request changes');
  await page.locator('.hvy-embed-layout').evaluate((layout) => {
    const modal = document.createElement('div');
    modal.className = 'modal-root remove-confirmation-modal-root';
    modal.innerHTML = `
      <div class="modal-overlay"></div>
      <section class="modal-panel remove-confirmation-modal" role="dialog" aria-modal="true" aria-label="Confirm deletion?">
        <div class="modal-head"><h3>Confirm deletion?</h3></div>
      </section>
    `;
    layout.append(modal);
  });
  await expect(page.getByRole('dialog', { name: 'Confirm deletion?' })).toBeVisible();

  await page.locator('.hvy-context-popover-backdrop-target').dispatchEvent('click', {
    bubbles: true,
    cancelable: true,
  });

  await expect(page.locator('.hvy-context-popover')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Confirm deletion?' })).toBeVisible();
});

test('ai context edit focuses text before the first keystroke', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

 <!--hvy:text {"id":"summary-text"}-->
  Original
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'AI' }).click();

  await expect(page.locator('#aiReaderDocument #summary > .reader-section-head .toggle-expand-button')).toBeVisible();
  await page.locator('#aiReaderDocument .reader-block', { hasText: 'Original' }).click({ button: 'right' });
  await page.getByRole('button', { name: 'Edit component' }).click();
  await expect(page.locator('#aiReaderDocument #summary > .reader-section-head .toggle-expand-button')).toHaveCount(0);
  await page.keyboard.type('X');

  const editor = page.locator('#aiReaderDocument [data-field="block-rich"]');
  await expect(editor).toBeFocused();
  await expect(editor).toContainText('OriginalX');
});

test('ai context editing collapsed expandable stub cancels in one step', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

 <!--hvy:expandable {"id":"details","expandableExpanded":false}-->

  <!--hvy:expandable:stub {}-->

   <!--hvy:text {"id":"stub-copy"}-->
    Stub summary

  <!--hvy:expandable:content {}-->

   <!--hvy:text {"id":"expanded-copy"}-->
    Expanded details
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'AI' }).click();

  await page.locator('#aiReaderDocument .reader-block-text', { hasText: 'Stub summary' }).click({ button: 'right' });
  await page.getByRole('button', { name: 'Edit component' }).click();
  const activeEditor = page.locator('#aiReaderDocument .editor-block[data-active-editor-block="true"]');
  await expect(activeEditor.locator('.rich-editor')).toContainText('Stub summary');
  await page.locator('#aiReaderDocument .reader-block-expandable').hover();
  const hoverBorderContent = await activeEditor.locator('.editor-block-remove-button').evaluate((button) => {
    const expandable = button.closest('.reader-block-expandable') as HTMLElement;
    return getComputedStyle(expandable, '::after').content;
  });
  expect(hoverBorderContent).toBe('none');

  await activeEditor.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('#aiReaderDocument .editor-block[data-active-editor-block="true"]')).toHaveCount(0);
  await expect(page.locator('#aiReaderDocument .reader-block-text', { hasText: 'Stub summary' })).toBeVisible();
});

test('ai sidebar expandable hover does not cover active editor delete button', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Resume Example' }).click();
  await page.locator('[data-action="switch-view"][data-view="ai"]').click();
  await page.locator('.viewer-sidebar-tab').click();

  const skillsSection = page.locator('#aiSidebarSections #skills');
  await skillsSection.click();
  const skillRecord = skillsSection.locator('.reader-block-expandable[data-component-id="skill-software-engineering"]').first();
  await skillRecord.locator('.reader-block-text', { hasText: 'Software Engineering' }).first().click({ button: 'right' });
  await page.getByRole('button', { name: 'Edit component' }).click();

  const activeEditor = skillsSection.locator('.editor-block[data-active-editor-block="true"]');
  await expect(activeEditor.locator('.rich-editor')).toContainText('Software Engineering');
  await skillRecord.hover();
  const hoverState = await activeEditor.locator('.editor-block-remove-button').evaluate((button) => {
    const expandable = button.closest('.reader-block-expandable') as HTMLElement;
    return {
      afterContent: getComputedStyle(expandable, '::after').content,
      boxShadow: getComputedStyle(expandable).boxShadow,
      cursor: getComputedStyle(expandable).cursor,
    };
  });
  expect(hoverState.afterContent).toBe('none');
  expect(hoverState.boxShadow).toBe('none');
  expect(hoverState.cursor).toBe('default');

  const expandedBeforeClick = await skillRecord.getAttribute('aria-expanded');
  await skillRecord.click({ position: { x: 8, y: 8 } });
  await expect(skillRecord).toHaveAttribute('aria-expanded', expandedBeforeClick ?? '');
  await expect(activeEditor.locator('.rich-editor')).toContainText('Software Engineering');
});

test('ai context clone trims only leading paragraph style margin', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
text_line_styles:
  pushed:
    label: Pushed
    css: "margin: 32px 0 0; padding-left: 18px; font-weight: 700;"
---

<!--hvy: {"id":"summary"}-->
#! Summary

 <!--hvy:text {}-->
  ^pushed^ Overlay line
  ^pushed^ Follow-up line
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'AI' }).click();

  await page.locator('#aiReaderDocument .reader-block', { hasText: 'Overlay line' }).click({ button: 'right' });
  await expect(page.locator('.hvy-context-popover-clone')).toBeVisible();
  await expect(page.locator('.hvy-context-popover-clone [data-hvy-text-line-style="pushed"]').first()).toHaveCSS('margin-top', '0px');
  await expect(page.locator('.hvy-context-popover-clone [data-hvy-text-line-style="pushed"]').nth(1)).toHaveCSS('margin-top', '32px');
  await expect.poll(async () => {
    const cloneBox = await page.locator('.hvy-context-popover-clone').boundingBox();
    const styledBox = await page.locator('.hvy-context-popover-clone [data-hvy-text-line-style="pushed"]').first().boundingBox();
    if (!cloneBox || !styledBox) {
      return 999;
    }
    return Math.round(styledBox.y - cloneBox.y);
  }).toBeLessThan(2);
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

test('editor-only scripting maintenance section only renders in advanced mode', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"header"}-->
#! Header

 <!--hvy:button {"id":"generate-name","editorOnly":true,"buttonLabel":"Generate"}-->

<!--hvy: {"id":"maintenance","editorOnly":true}-->
#! Maintenance

 <!--hvy:plugin {"id":"cleanup","editorOnly":true,"plugin":"dev.heavy.scripting","pluginConfig":{"version":"0.1"}}-->
  print("maintenance script")
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await expect(page.locator('#editorTree')).toContainText('Generate');
  await expect(page.locator('#editorTree')).not.toContainText('maintenance script');

  await page.getByRole('button', { name: 'AI' }).click();
  await expect(page.locator('#aiReaderDocument')).toContainText('Generate');
  await expect(page.locator('#aiReaderDocument')).not.toContainText('maintenance script');

  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();
  await expect(page.locator('#editorTree')).toContainText('maintenance script');

  await page.locator('[data-action="switch-view"][data-view="ai"]').click();
  await expect(page.locator('#aiReaderDocument')).not.toContainText('maintenance script');

  await page.locator('[data-action="switch-view"][data-view="editor"]').click();
  await expect(page.getByRole('button', { name: 'Basic' })).toHaveClass(/secondary/);
  await expect(page.locator('#editorTree')).not.toContainText('maintenance script');
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

test('expandable reader expansion animation does not persist after expanding', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

 <!--hvy:expandable {"id":"padded-card","expandableAlwaysShowStub":true,"expandableExpanded":false}-->

  <!--hvy:expandable:stub {}-->

   <!--hvy:text {}-->
    Clickable Stub

  <!--hvy:expandable:content {}-->

   <!--hvy:text {}-->
    Expanded detail
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Viewer' }).click();

  await page.locator('#padded-card').click();
  const expandable = page.locator('[data-expandable-id]').first();
  await expect(expandable).toHaveClass(/is-expanding/);
  await expect(expandable).not.toHaveClass(/is-expanding/, { timeout: 1000 });
  await expect(page.locator('.expand-content')).toHaveCSS('animation-name', 'none');
});

test('component-list display defaults sort items into collapsed virtual groups', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"skills"}-->
#! Skills

<!--hvy:component-list {"id":"skill-list","componentListComponent":"text","componentListDefaultSortKey":"Job Match","componentListDefaultSortDirection":"desc","componentListDefaultGroupKey":"Category","componentListGroupCollapsedPreviewRem":1}-->

 <!--hvy:component-list:0 {}-->

  <!--hvy:text {"sortKeys":{"Job Match":80},"groupKeys":{"Category":"Database"}}-->
   PostgreSQL

 <!--hvy:component-list:1 {}-->

  <!--hvy:text {"sortKeys":{"Job Match":95},"groupKeys":{"Category":"Language"}}-->
   TypeScript

 <!--hvy:component-list:2 {}-->

  <!--hvy:text {"sortKeys":{"Job Match":90},"groupKeys":{"Category":"Database"}}-->
   SQLite
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.editor-block-passive', { has: page.locator('.reader-component-list') }).first().click();
  const activeList = page.locator('.component-list-view-editor').first();
  await expect(activeList).toBeVisible();
  await expect(activeList.locator('[data-field="component-list-default-sort-key"]')).toHaveValue('Job Match');
  await expect(activeList.locator('[data-field="component-list-default-sort-direction"]')).toHaveValue('desc');
  await expect(activeList.locator('[data-field="component-list-default-group-key"]')).toHaveValue('Category');

  await page.getByRole('button', { name: 'Viewer' }).click();

  const readerControls = page.locator('.component-list-reader-controls').first();
  await expect(readerControls).toContainText('Sort');
  await expect(readerControls).toContainText('Group');
  await expect(readerControls.locator('[data-field="component-list-reader-view"]')).toHaveValue('Job Match');
  await expect(readerControls.locator('[data-field="component-list-reader-view"] option', { hasText: 'Category' })).toHaveCount(0);
  await expect(readerControls.locator('[data-field="component-list-reader-group"]')).toHaveValue('Category');
  await expect(readerControls.locator('[data-reader-action="toggle-component-list-reverse"]')).toHaveAttribute('aria-label', 'Sort descending');

  const groups = page.locator('.reader-container.is-virtual-group-container');
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0).locator('.reader-container-title')).toHaveText('Language');
  await expect(groups.nth(1).locator('.reader-container-title')).toHaveText('Database');
  await expect(groups.nth(0).locator('.reader-container-toggle')).toHaveAttribute('aria-expanded', 'false');

  await readerControls.locator('[data-reader-action="toggle-component-list-reverse"]').click();
  await expect(readerControls.locator('[data-reader-action="toggle-component-list-reverse"]')).toHaveAttribute('aria-label', 'Sort ascending');
  await expect(groups.nth(0).locator('.reader-container-title')).toHaveText('Database');
  await expect(groups.nth(1).locator('.reader-container-title')).toHaveText('Language');

  await readerControls.locator('[data-field="component-list-reader-group"]').selectOption('');
  await expect(page.locator('.reader-container.is-virtual-group-container')).toHaveCount(0);
  await expect(page.locator('.reader-component-list')).toContainText('PostgreSQL');

  await readerControls.locator('[data-field="component-list-reader-group"]').selectOption('Category');

  await groups.nth(0).locator('.reader-container-toggle').click();

  await expect(groups.nth(0).locator('.reader-container-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(groups.nth(0)).toContainText('PostgreSQL');
  await expect(groups.nth(0)).toContainText('SQLite');
});

test('component-list reader controls hide unavailable sort and group controls', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"lists"}-->
#! Lists

<!--hvy:component-list {"id":"sorted-list","componentListComponent":"text","componentListDefaultSortKey":"Strength","componentListDefaultSortDirection":"desc"}-->

 <!--hvy:component-list:0 {}-->

  <!--hvy:text {"sortKeys":{"Strength":2}}-->
   Two

 <!--hvy:component-list:1 {}-->

  <!--hvy:text {"sortKeys":{"Strength":1}}-->
   One

<!--hvy:component-list {"id":"plain-list","componentListComponent":"text"}-->

 <!--hvy:component-list:0 {}-->

  <!--hvy:text {}-->
   Plain
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Viewer' }).click();

  const controls = page.locator('.component-list-reader-controls');
  await expect(controls).toHaveCount(1);
  await expect(controls.first().locator('[data-field="component-list-reader-view"]')).toBeVisible();
  await expect(controls.first().locator('[data-field="component-list-reader-view"] option[value=""]')).toHaveCount(0);
  await expect(controls.first().locator('[data-field="component-list-reader-group"]')).toHaveCount(0);
  await expect(controls.first().locator('[data-reader-action="toggle-component-list-reverse"]')).toBeVisible();
});

test('component-list default display editor hides unavailable controls', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"lists"}-->
#! Lists

<!--hvy:component-list {"id":"plain-list","componentListComponent":"text"}-->

 <!--hvy:component-list:0 {}-->

  <!--hvy:text {}-->
   Plain

<!--hvy:component-list {"id":"group-list","componentListComponent":"text"}-->

 <!--hvy:component-list:0 {}-->

  <!--hvy:text {"groupKeys":{"Category":"Database"}}-->
   PostgreSQL

 <!--hvy:component-list:1 {}-->

  <!--hvy:text {"groupKeys":{"Category":"Language"}}-->
   TypeScript

 <!--hvy:component-list:2 {}-->

  <!--hvy:text {"groupKeys":{"Category":"Database"}}-->
   SQLite
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.editor-block-passive', { hasText: 'Plain' }).first().click();
  await expect(page.locator('.component-list-view-editor')).toHaveCount(0);

  await page.locator('.editor-block-passive', { hasText: 'PostgreSQL' }).first().click();
  const editor = page.locator('.component-list-view-editor');
  await expect(editor).toBeVisible();
  await expect(editor.locator('[data-field="component-list-default-sort-key"]')).toHaveCount(0);
  await expect(editor.locator('[data-field="component-list-default-sort-direction"]')).toHaveCount(0);
  await expect(editor.locator('[data-field="component-list-default-group-key"]')).toBeVisible();
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

test('text toolbar fill-in uses selected text instead of stale placeholder', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"header"}-->
#! Header

 <!--hvy:text {"id":"pronunciation","placeholder":"pronunciation"}-->
  [FILL ME IN]
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.editor-block-passive', { has: page.locator('#pronunciation') }).click();
  await page.locator('.rich-editor').evaluate((editable) => {
    const textNode = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT).nextNode();
    if (!textNode?.textContent) return;
    const start = textNode.textContent.indexOf('FILL ME IN');
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + 'FILL ME IN'.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.locator('.rich-editor').dispatchEvent('keyup');
  await page.getByRole('button', { name: 'Convert to Fill-in' }).click();

  await expect(page.locator('[data-field="text-fill-in-value"]')).toBeVisible();
  await expect(page.locator('[data-field="text-fill-in-value"]')).toHaveAttribute('data-placeholder', 'FILL ME IN');
  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).toContainText('"placeholder":"FILL ME IN"');
  await expect(page.locator('#rawEditor')).not.toContainText('"placeholder":"pronunciation"');
});

test('text fill-in preserves multiple slots while typing', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"locations"}-->
#! Locations

 <!--hvy:text {"id":"location-details","placeholder":"location, target location","fillIn":true}-->
  **Location:** <!-- value -->

  **Target Location(s):** <!-- value -->
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.editor-block-passive', { hasText: 'Location:' }).click();
  const fillIns = page.locator('[data-field="text-fill-in-value"]');
  await expect(fillIns).toHaveCount(2);

  await fillIns.nth(0).fill('Seattle, WA');
  await expect(fillIns.nth(1)).toHaveAttribute('data-placeholder', 'target location');
  await fillIns.nth(1).fill('Greater Seattle area');

  const editor = page.locator('.text-fill-in-editor');
  await expect(editor).toContainText('Location: Seattle, WA');
  await expect(editor).toContainText('Target Location(s): Greater Seattle area');

  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).toContainText('**Location:** Seattle, WA');
  await expect(page.locator('#rawEditor')).toContainText('**Target Location(s):** Greater Seattle area');
  await expect(page.locator('#rawEditor')).not.toContainText('<!-- value -->');
  await expect(page.locator('#rawEditor')).not.toContainText('"fillIn"');
});

test('location fill-ins keep focus while typing each value', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"locations"}-->
#! Locations

 <!--hvy:text {"id":"location-details","placeholder":"location, target location","fillIn":true}-->
  **Location:** <!-- value -->

  **Target Location(s):** <!-- value -->
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.editor-block-passive .editor-block-content[data-component-id="location-details"] .text-fill-in-box').first().click();
  const fillIns = page.locator('[data-field="text-fill-in-value"]');
  await expect(fillIns).toHaveCount(2);

  await fillIns.nth(0).click();
  await page.keyboard.type('Seattle');
  await expect(fillIns.nth(0)).toBeFocused();

  await fillIns.nth(1).click();
  await page.keyboard.type('Remote');
  await expect(fillIns.nth(1)).toBeFocused();
  await expect(page.locator('.text-fill-in-editor')).toContainText('Target Location(s): Remote');
});

test('completed fill-in slots prune placeholder labels for remaining slots', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"locations"}-->
#! Locations

 <!--hvy:text {"id":"location-details","placeholder":"location, target location","fillIn":true}-->
  **Location:** <!-- value -->

  **Target Location(s):** <!-- value -->
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.editor-block-passive .editor-block-content[data-component-id="location-details"] .text-fill-in-box').first().click();
  await page.locator('[data-field="text-fill-in-value"]').nth(0).fill('Seattle, WA');

  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).toContainText('"placeholder":"target location"');
  await expect(page.locator('#rawEditor')).not.toContainText('"placeholder":"location, target location"');
});

test('resume template location fill-ins keep focus in AI view', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Resume Template' }).click();
  await page.locator('[data-action="switch-view"][data-view="ai"]').click();
  await page.locator('.viewer-sidebar-tab').click();

  const locationBlock = page.locator('#aiSidebarSections #locations');
  const fillIns = locationBlock.locator('[data-field="text-fill-in-value"]');
  await expect(fillIns).toHaveCount(2);

  await fillIns.nth(0).click();
  await page.keyboard.type('Seattle');
  await expect(fillIns.nth(0)).toBeFocused();

  await fillIns.nth(1).click();
  await page.keyboard.type('Remote');
  await expect(fillIns.nth(1)).toBeFocused();
  await expect(locationBlock).toContainText('Target Location(s): Remote');
});

test('single-line text fill-in keeps a compact editor height', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

 <!--hvy:text {"id":"name","placeholder":"name","fillIn":true}-->
  <!-- value -->
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.editor-block-passive .editor-block-content[data-component-id="name"] .text-fill-in-box').click();

  const fillInEditorHeight = await page.locator('.text-fill-in-editor').evaluate((node) => node.getBoundingClientRect().height);
  expect(fillInEditorHeight).toBeLessThan(60);
});

test('clicking another passive fill-in enters the new fill-in while editing one', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

 <!--hvy:text {"id":"first","placeholder":"first","fillIn":true}-->
  <!-- value -->

 <!--hvy:text {"id":"second","placeholder":"second","fillIn":true}-->
  <!-- value -->
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.editor-block-passive .editor-block-content[data-component-id="first"] .text-fill-in-box').click();
  const firstFillIn = page.locator('.editor-block:has(.editor-block-content[data-component-id="first"]) [data-field="text-fill-in-value"]');
  await expect(firstFillIn).toBeVisible();
  await firstFillIn.click();
  await page.keyboard.type('first value');

  await page.locator('.editor-block-passive .editor-block-content[data-component-id="second"] .text-fill-in-box').click();
  const secondFillIn = page.locator('.editor-block:has(.editor-block-content[data-component-id="second"]) [data-field="text-fill-in-value"]');
  await expect(secondFillIn).toBeVisible();
  await secondFillIn.click();
  await page.keyboard.type('second value');

  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).toContainText('first value');
  await expect(page.locator('#rawEditor')).toContainText('second value');
});

test('text fill-in enter exits and modifier-enter adds a newline', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"header"}-->
#! Header

 <!--hvy:text {"id":"pronunciation","placeholder":"pronunciation","fillIn":true}-->
  [<!-- value -->]
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.editor-block-passive', { has: page.locator('#pronunciation') }).click();
  const fillIn = page.locator('[data-field="text-fill-in-value"]');
  await fillIn.fill('Line one');
  await fillIn.focus();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
  await page.keyboard.type('Line two');
  await expect(fillIn).toContainText(/Line one\s+Line two/);
  await page.keyboard.press('Enter');
  await expect(fillIn).not.toBeFocused();

  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).toContainText('Line one\nLine two');
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

test('ancestor component exposes meta actions while editing descendants', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"skills"}-->
#! Skills

<!--hvy:container {"id":"skill-software-engineering","sortKeys":{"Strength":98}}-->

 <!--hvy:container:0 {}-->

  <!--hvy:text {}-->
   ### Software Engineering
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();

  await page.locator('.reader-container-body > .editor-block-passive', { hasText: 'Software Engineering' }).click();

  expect(await page.locator('.editor-block-context-actions [data-action="open-component-meta"]').count()).toBeGreaterThan(1);
});

test('reusable component modal offers update existing or save as new', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
component_defs:
  - name: skill-card
    baseType: text
    schema:
      placeholder: Skill
---

<!--hvy: {"id":"skills"}-->
#! Skills

<!--hvy:skill-card {"id":"skill-card-1"}-->
 Software Engineering
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();

  await page.locator('.editor-block-passive', { hasText: 'Software Engineering' }).click();
  await page.getByLabel('Component options').getByRole('button', { name: 'Reusable' }).click();

  const modal = page.locator('.component-meta-modal', { hasText: 'Update Reusable Component' });
  await expect(modal).toBeVisible();
  await expect(modal.locator('.reusable-existing-option strong')).toHaveText('skill-card');
  await expect(modal.getByRole('button', { name: 'Update Existing' })).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Save As New' })).toBeVisible();
  await expect(modal.locator('#reusableNameInput')).toHaveValue('skill-card-copy');

  await modal.locator('#reusableNameInput').fill('skill-card-alt');
  await modal.getByRole('button', { name: 'Update Existing' }).click();

  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).toHaveValue(/name: skill-card/);
  await expect(page.locator('#rawEditor')).not.toHaveValue(/skill-card-alt/);
  await expect(page.locator('#rawEditor')).toHaveValue(/<!--hvy:skill-card \{"id":"skill-card-1"\}-->/);
});

test('advanced placeholder input keeps focus while typing', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"overview"}-->
#! Overview

<!--hvy:text {"id":"summary"}-->
 Summary
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();

  await page.locator('.editor-block-passive', { hasText: 'Summary' }).click();
  await page.getByLabel('Component options').getByRole('button', { name: 'Meta' }).click();
  const placeholderInput = page.locator('[data-field="block-placeholder"]');

  await placeholderInput.fill('Skill name');
  await expect(placeholderInput).toBeFocused();
  await expect(placeholderInput).toHaveValue('Skill name');
});

test('component list display keys are explicit and shared across list items', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"skills"}-->
#! Skills

<!--hvy:text {"id":"intro"}-->
 Outside list

<!--hvy:component-list {"id":"skill-list","componentListComponent":"text"}-->

 <!--hvy:text {"id":"first","sortKeys":{"Self Rating":9},"groupKeys":{"Category":"Engineering"}}-->
  First

 <!--hvy:text {"id":"second"}-->
  Second
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();

  await page.locator('.editor-block-passive', { hasText: 'Outside list' }).click();
  await page.getByLabel('Component options').getByRole('button', { name: 'Meta' }).click();
  await expect(page.locator('.component-list-display-editor')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close' }).click();

  await page.locator('.reader-component-list > .editor-block-passive', { hasText: 'Second' }).click();
  await page.locator('.editor-block[data-active-editor-block="true"]', { has: page.locator('.rich-editor') }).last().getByRole('button', { name: 'Meta' }).click();

  const display = page.locator('.component-list-display-editor');
  await expect(display).toBeVisible();
  await expect(display.getByText('Sort Keys')).toBeVisible();
  await expect(display.getByText('Grouping Keys')).toBeVisible();
  await expect(display.locator('[data-field="block-sort-key-name"][value="Self Rating"]')).toBeVisible();
  await expect(display.locator('[data-field="block-sort-key-name"][value="Category"]').last()).toBeVisible();

  const selfRatingName = display.locator('[data-field="block-sort-key-name"][value="Self Rating"]');
  await selfRatingName.locator('xpath=following-sibling::input[@data-field="block-sort-key-value"]').fill('7');

  await display.getByRole('button', { name: 'Add Sort Key' }).click();
  const addedName = display.locator('[data-field="block-sort-key-name"][value="Sort Key"]');
  await addedName.fill('Confidence');
  await addedName.locator('xpath=following-sibling::input[@data-field="block-sort-key-value"]').fill('8');
  await addedName.locator('xpath=following-sibling::button[@data-action="remove-block-display-key"]').click();

  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).toHaveValue(/"second","sortKeys":\{"Self Rating":7\}/);
  await expect(page.locator('#rawEditor')).not.toHaveValue(/Confidence/);
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

test('editor fill-in focuses from passive click and accepts typing', async ({ page }) => {
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

  await page.locator('.editor-block-passive .editor-block-content[data-component-id="name"] .text-fill-in-box').click();
  const fillIn = page.locator('[data-field="text-fill-in-value"]');
  await expect(fillIn).toBeFocused();
  await page.keyboard.type('Ada Lovelace');

  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).toContainText('# Ada Lovelace');
  await expect(page.locator('#rawEditor')).not.toContainText('"fillIn"');
});

test('ai fill-in accepts typing in place without leaving the reader surface', async ({ page }) => {
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
  await page.getByRole('button', { name: 'AI' }).click();

  const fillIn = page.locator('#aiReaderDocument [data-field="text-fill-in-value"]');
  await fillIn.click();
  await expect(fillIn).toBeFocused();
  await fillIn.click();
  await expect(fillIn).toBeFocused();
  await expect(page.locator('.hvy-context-popover')).toHaveCount(0);
  await page.keyboard.type('Grace Hopper');
  await expect(page.locator('#aiReaderDocument')).toContainText('Grace Hopper');
  await expect(page.locator('#aiReaderDocument')).not.toContainText('<!-- value -->');
  await page.locator('#aiReaderDocument').click({ position: { x: 4, y: 4 } });
  await expect(page.locator('#aiReaderDocument [data-field="text-fill-in-value"]')).toHaveCount(0);
  await expect(page.locator('#aiReaderDocument .editor-block[data-active-editor-block="true"]')).toHaveCount(0);

  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).toContainText('# Grace Hopper');
  await expect(page.locator('#rawEditor')).not.toContainText('"fillIn"');
});

test('ai fill-in text outside the slot does not activate the whole text block', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

 <!--hvy:text {"id":"description-notes","placeholder":"Description and notes","fillIn":true}-->
  ^detail-heading^ #### Description
  ^detail-body^ <!-- value -->
  ^detail-heading^ #### Notes
  ^detail-body^ <!-- value -->
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'AI' }).click();

  const block = page.locator('#aiReaderDocument .reader-block-text[data-component-id="description-notes"]');
  await expect(block.locator('[data-field="text-fill-in-value"]')).toHaveCount(2);
  await block.getByText('Description').click();

  await expect(page.locator('#aiReaderDocument .editor-block[data-active-editor-block="true"]')).toHaveCount(0);
  await expect(block.locator('[data-field="text-fill-in-value"]')).toHaveCount(2);
});

test('editor pullout help balloon stays when it fits beside the document body', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
reader_max_width: 12rem
---

<!--hvy: {"id":"main"}-->
#! Main

 <!--hvy:text {}-->
  Main body

<!--hvy: {"id":"side","location":"sidebar"}-->
#! Sidebar

 <!--hvy:text {}-->
  Pullout body
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  const balloon = page.locator('.editor-sidebar-help-balloon');
  await expect(balloon).toBeVisible();
  await expect.poll(async () => {
    const balloonBox = await balloon.boundingBox();
    const bodyBox = await page.locator('.editor-tree > .hvy-surface > .editor-tree-body').boundingBox();
    if (!balloonBox || !bodyBox) {
      return true;
    }
    return balloonBox.x < bodyBox.x + bodyBox.width
      && balloonBox.x + balloonBox.width > bodyBox.x
      && balloonBox.y < bodyBox.y + bodyBox.height
      && balloonBox.y + balloonBox.height > bodyBox.y;
  }).toBe(false);
  await page.waitForTimeout(1_000);
  await expect(balloon).toBeVisible();
});

test('closing editor pullout help balloon does not remove an existing modal', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
reader_max_width: 12rem
---

<!--hvy: {"id":"main"}-->
#! Main

 <!--hvy:text {}-->
  Main body

<!--hvy: {"id":"side","location":"sidebar"}-->
#! Sidebar

 <!--hvy:text {}-->
  Pullout body
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await expect(page.locator('.editor-sidebar-help-balloon')).toBeVisible();
  await page.locator('.hvy-embed-layout').evaluate((layout) => {
    const modal = document.createElement('div');
    modal.className = 'modal-root remove-confirmation-modal-root';
    modal.innerHTML = `
      <div class="modal-overlay"></div>
      <section class="modal-panel remove-confirmation-modal" role="dialog" aria-modal="true" aria-label="Confirm deletion?">
        <div class="modal-head"><h3>Confirm deletion?</h3></div>
      </section>
    `;
    layout.append(modal);
  });
  await expect(page.getByRole('dialog', { name: 'Confirm deletion?' })).toBeVisible();

  await page.locator('.editor-sidebar-help-balloon').dispatchEvent('click', {
    bubbles: true,
    cancelable: true,
  });
  await expect(page.locator('.editor-sidebar-help-balloon')).toHaveClass(/is-closing/);
  await page.waitForTimeout(220);

  await expect(page.locator('.editor-sidebar-help-balloon')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Confirm deletion?' })).toBeVisible();
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
  await page.getByRole('button', { name: 'Unlock' }).click();
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

test('active insert above and below controls span the editor block width', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"notes"}-->
#! Notes

 <!--hvy:text {}-->
  Alpha note

 <!--hvy:text {}-->
  Beta note
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.editor-block-passive', { hasText: 'Alpha note' }).click();
  const activeBlock = page.locator('.editor-block[data-active-editor-block="true"]', { hasText: 'Alpha note' });
  await expect(activeBlock.locator('.rich-editor')).toBeVisible();

  const activeBlockWidth = await activeBlock.evaluate((block) => block.getBoundingClientRect().width);
  const insertGhostWidths = await page.locator('.active-component-insert-ghost').evaluateAll((ghosts) => {
    return ghosts.map((ghost) => ghost.getBoundingClientRect().width);
  });
  expect(insertGhostWidths).toHaveLength(2);
  for (const ghostWidth of insertGhostWidths) {
    expect(Math.abs(activeBlockWidth - ghostWidth)).toBeLessThanOrEqual(2);
  }
});

test('clicking a scrolled accomplishment opens editor in place', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"history"}-->
#! History

 <!--hvy:text {}-->
  ${Array.from({ length: 36 }, (_, index) => `Spacer ${index + 1}`).join('\n  \n  ')}

 <!--hvy:component-list {"componentListComponent":"text","componentListItemLabel":"accomplishment"}-->

  <!--hvy:component-list:0 {}-->

   <!--hvy:text {}-->
    Built a shared TypeScript platform package.

  <!--hvy:component-list:1 {}-->

   <!--hvy:text {}-->
    Introduced reproducible developer containers and test workflows.
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();
  const tree = page.locator('.editor-tree');
  const accomplishment = page.locator('.editor-block-passive', { hasText: 'Introduced reproducible developer containers' }).last();
  await accomplishment.scrollIntoViewIfNeeded();
  await tree.evaluate((node) => {
    node.scrollTop += 180;
  });
  await accomplishment.scrollIntoViewIfNeeded();
  const beforeScrollTop = await tree.evaluate((node) => node.scrollTop);
  const beforeTextTop = await accomplishment.locator('.reader-block').evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent ?? '';
      const firstTextIndex = text.search(/\S/);
      if (firstTextIndex >= 0) {
        const range = document.createRange();
        range.setStart(node, firstTextIndex);
        range.setEnd(node, text.length);
        const rect = range.getClientRects()[0];
        range.detach();
        return rect?.top ?? null;
      }
      node = walker.nextNode();
    }
    return null;
  });
  expect(beforeTextTop).not.toBeNull();

  await accomplishment.click();
  const activeBlock = page.locator('.editor-block[data-active-editor-block="true"]', { hasText: 'Introduced reproducible developer containers' }).last();
  await expect(activeBlock.locator('.rich-editor')).toBeVisible();
  await expect.poll(async () => {
    const afterBox = await activeBlock.locator('.rich-editor').boundingBox();
    if (!afterBox || beforeTextTop === null) {
      return 999;
    }
    return Math.abs(Math.round(afterBox.y - beforeTextTop));
  }).toBeLessThanOrEqual(3);
  const afterScrollTop = await tree.evaluate((node) => node.scrollTop);
  expect(afterScrollTop).toBeGreaterThanOrEqual(beforeScrollTop);

  const activeEditorTop = await activeBlock.locator('.rich-editor').evaluate((editor) => editor.getBoundingClientRect().top);
  await activeBlock.getByRole('button', { name: 'Done' }).dispatchEvent('click');
  const passiveAfter = page.locator('.editor-block-passive', { hasText: 'Introduced reproducible developer containers' }).last();
  await expect(passiveAfter).toBeVisible();
  await expect.poll(async () => {
    const passiveTextTop = await passiveAfter.locator('.reader-block').evaluate((root) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const text = node.textContent ?? '';
        const firstTextIndex = text.search(/\S/);
        if (firstTextIndex >= 0) {
          const range = document.createRange();
          range.setStart(node, firstTextIndex);
          range.setEnd(node, text.length);
          const rect = range.getClientRects()[0];
          range.detach();
          return rect?.top ?? null;
        }
        node = walker.nextNode();
      }
      return null;
    });
    if (passiveTextTop === null) {
      return 999;
    }
    return Math.abs(Math.round(passiveTextTop - activeEditorTop));
  }).toBeLessThanOrEqual(3);
  const afterDoneScrollTop = await tree.evaluate((node) => node.scrollTop);
  expect(afterDoneScrollTop).toBeLessThanOrEqual(afterScrollTop);
});

test('nested accomplishment cancel returns to the parent editor', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"history"}-->
#! History

 <!--hvy:component-list {"componentListComponent":"text","componentListItemLabel":"accomplishment"}-->

  <!--hvy:component-list:0 {}-->

   <!--hvy:text {}-->
    Northwind Labs

  <!--hvy:component-list:1 {}-->

   <!--hvy:text {}-->
    Introduced reproducible developer containers and test workflows.
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  const accomplishment = page.locator('.editor-block-passive', { hasText: 'Introduced reproducible developer containers' }).last();
  await accomplishment.click();
  const activeAccomplishment = page.locator('.editor-block[data-active-editor-block="true"]', { hasText: 'Introduced reproducible developer containers' }).last();
  await expect(activeAccomplishment.locator('.rich-editor')).toBeVisible();

  await activeAccomplishment.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.editor-block[data-active-editor-block="true"]')).toHaveCount(1);
  const activeParent = page.locator('.editor-block[data-active-editor-block="true"]', { hasText: 'Northwind Labs' });
  await expect(activeParent).toBeVisible();
  await expect(activeParent).toContainText('Introduced reproducible developer containers');
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

  const listEditor = page.locator(
    'xpath=//div[contains(concat(" ", normalize-space(@class), " "), " editor-block ")][./div[contains(concat(" ", normalize-space(@class), " "), " editor-block-head ")]//strong[contains(concat(" ", normalize-space(@class), " "), " editor-block-title ") and normalize-space()="component-list"]]'
  );
  const expandableEditor = page.locator(
    'xpath=//div[contains(concat(" ", normalize-space(@class), " "), " editor-block ")][./div[contains(concat(" ", normalize-space(@class), " "), " editor-block-head ")]//strong[contains(concat(" ", normalize-space(@class), " "), " editor-block-title ") and normalize-space()="expandable"]]'
  );
  await expect(listEditor.locator('> [data-action="remove-block"]')).toBeVisible();
  await expect(expandableEditor.locator('> [data-action="remove-block"]')).toBeVisible();

  await expandableEditor.locator('> [data-action="remove-block"]').click();
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
  const activeRecord = page.locator('.editor-block[data-active-editor-block="true"]', {
    has: page.locator('.editor-block-title', { hasText: 'history-record' }),
  }).last();
  await expect(activeRecord).not.toContainText('Empty text');
  await activeRecord.locator('> .editor-block-done-row > [data-action="deactivate-block"]').click();
  await page.locator('.editor-block[data-active-editor-block="true"] > .editor-block-done-row > [data-action="deactivate-block"]').click();
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

  const projectRecordEditor = page.locator(
    'xpath=//div[contains(concat(" ", normalize-space(@class), " "), " editor-block ")][@data-active-editor-block="true"][./div[contains(concat(" ", normalize-space(@class), " "), " editor-block-head ")]//strong[contains(concat(" ", normalize-space(@class), " "), " editor-block-title ") and normalize-space()="project-record"]]'
  );
  await projectRecordEditor.locator('> .editor-block-done-row > [data-action="deactivate-block"]').click();
  await page.locator('.editor-block[data-active-editor-block="true"] > .editor-block-done-row > [data-action="deactivate-block"]').click();
  await expect(page.locator('.editor-block[data-active-editor-block="true"]')).toHaveCount(0);

  await page.getByRole('button', { name: 'Raw' }).click();
  const raw = await page.locator('#rawEditor').inputValue();
  expect(raw.match(/<!--hvy:project-record/g) ?? []).toHaveLength(2);
});

test('resume reader view buttons apply filters without changing edit mode', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('button', { name: 'No View' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'TypeScript View' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'LLM Engineer View' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Resume Example' }).click();
  await expect(page.getByRole('button', { name: 'No View' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'TypeScript View' }).click();

  await expect(page.locator('#readerDocument')).toBeVisible();
  await expect(page.getByRole('button', { name: 'No View' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'TypeScript View' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#tool-typescript')).toHaveClass(/is-highlighted/);
  await expect(page.locator('#top-skills-tools-technologies')).not.toContainText('LLM Prompt Engineering');
  await expect(page.locator('#top-skills-tools-technologies')).toContainText('TypeScript');
  await expect(page.locator('#project-autonomous-agent-hackathon')).toHaveClass(/is-reader-view-dimmed/);
  await expect(page.locator('#project-autonomous-agent-hackathon')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#education .toggle-expand-button').click();
  await expect(page.locator('#education')).not.toHaveClass(/is-collapsed-preview/);
  await page.locator('#education-bs-computer-science').click();
  await expect(page.locator('#education')).not.toHaveClass(/is-collapsed-preview/);
  await expect(page.locator('#education-bs-computer-science')).toHaveAttribute('aria-expanded', 'true');

  const projectIdsBefore = await page.locator('#readerDocument [id]').evaluateAll((nodes) => nodes.map((node) => node.id));
  await page.locator('#project-autonomous-agent-hackathon').click();
  const projectIdsAfter = await page.locator('#readerDocument [id]').evaluateAll((nodes) => nodes.map((node) => node.id));

  await expect(page.locator('#project-autonomous-agent-hackathon')).not.toHaveClass(/is-reader-view-dimmed/);
  expect(projectIdsAfter).toEqual(projectIdsBefore);

  await page.getByRole('button', { name: 'LLM Engineer View' }).click();
  await expect(page.getByRole('button', { name: 'TypeScript View' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'LLM Engineer View' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#tool-openai-api')).toHaveClass(/is-highlighted/);
  await expect(page.locator('#tool-typescript')).toHaveClass(/is-reader-view-dimmed/);
  await expect(page.locator('#top-skills-tools-technologies')).not.toContainText('TypeScript');
  await expect(page.locator('#top-skills-tools-technologies')).not.toContainText('Developer Containers');
  await expect(page.locator('#top-skills-tools-technologies')).toContainText('LLM Prompt Engineering');
  await expect(page.locator('#tools-technologies')).not.toHaveClass(/is-collapsed-preview/);
  await expect(
    page.locator('#tools-technologies .reader-container', { hasText: 'AI / Agent Tooling' }).first()
  ).toHaveClass(/is-expanded/);
  const sidebarSectionIds = await page.locator('#readerSidebarSections section[id]').evaluateAll((nodes) => nodes.map((node) => node.id));
  expect(sidebarSectionIds).toEqual(['locations', 'skills', 'tools-technologies']);

  await page.getByRole('button', { name: 'Editor' }).click();
  await expect(page.locator('#editorTree .is-reader-view-dimmed')).toHaveCount(0);
  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).toContainText('"id":"locations"');

  await page.getByRole('button', { name: 'Viewer' }).click();
  await page.getByRole('button', { name: 'No View' }).click();
  await expect(page.getByRole('button', { name: 'No View' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#project-autonomous-agent-hackathon')).not.toHaveClass(/is-reader-view-dimmed/);

  await page.getByRole('button', { name: 'CRM Example' }).click();
  await expect(page.getByRole('button', { name: 'No View' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'TypeScript View' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'LLM Engineer View' })).toHaveCount(0);
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
  await page.locator('.editor-block[data-active-editor-block="true"]', { has: page.locator('.rich-editor') }).locator('[data-action="start-component-copy"]').last().click();

  await expect(page.locator('[data-placement-container="grid"]')).toHaveCount(3);
  await expect(page.locator('.grid-add-ghost')).toHaveCount(0);
  await page.locator('[data-placement-container="grid"][data-placement="after"]').first().click();

  await page.getByRole('button', { name: 'Raw' }).click();
  const raw = await page.locator('#rawEditor').inputValue();
  expect(raw.match(/One/g)).toHaveLength(2);
  expect(raw.indexOf('One')).toBeLessThan(raw.indexOf('Two'));
});

test('component placement supports expandable stub and content children', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"main"}-->
#! Main

 <!--hvy:expandable {"id":"skill","expandableAlwaysShowStub":true,"expandableExpanded":false}-->

  <!--hvy:expandable:stub {}-->

   <!--hvy:text {"id":"name"}-->
    Skill name

  <!--hvy:expandable:content {}-->

   <!--hvy:text {"id":"details"}-->
    Skill details

   <!--hvy:text {"id":"notes"}-->
    Skill notes
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.editor-block-passive', { hasText: 'Skill name' }).first().click();
  await page.locator('[data-action="toggle-expandable-editor-panel"][data-expandable-panel="expanded"]').first().click();
  await page.locator('.editor-block-passive', { hasText: 'Skill details' }).click();
  await page.locator('.editor-block[data-active-editor-block="true"]', { has: page.locator('.rich-editor') }).locator('[data-action="start-component-copy"]').last().click();

  await expect(page.locator('[data-placement-container="expandable-stub"]')).toHaveCount(2);
  await expect(page.locator('[data-placement-container="expandable-content"]')).toHaveCount(3);
  await page.locator('[data-placement-container="expandable-content"][data-placement="after"]').first().click();

  await page.getByRole('button', { name: 'Raw' }).click();
  const raw = await page.locator('#rawEditor').inputValue();
  expect(raw.match(/Skill details/g)).toHaveLength(2);
  expect(raw.indexOf('Skill details')).toBeLessThan(raw.indexOf('Skill notes'));
});

test('component placement works inside expandable children of a locked section', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"main","lock":true}-->
#! Main

 <!--hvy:expandable {"id":"skill","expandableAlwaysShowStub":true,"expandableExpanded":false}-->

  <!--hvy:expandable:stub {}-->

   <!--hvy:text {"id":"name"}-->
    Skill name

  <!--hvy:expandable:content {}-->

   <!--hvy:text {"id":"details"}-->
    Skill details

   <!--hvy:text {"id":"notes"}-->
    Skill notes
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.editor-block-passive', { hasText: 'Skill name' }).first().click();
  await page.locator('[data-action="toggle-expandable-editor-panel"][data-expandable-panel="expanded"]').first().click();
  await page.locator('.editor-block-passive', { hasText: 'Skill notes' }).click();
  await page.locator('.editor-block[data-active-editor-block="true"] [data-action="start-component-move"]').click();

  await expect(page.locator('[data-placement-container="expandable-content"]')).toHaveCount(3);
  await expect(page.locator('[data-placement-container="section"]')).toHaveCount(0);
  await page.locator('[data-placement-container="expandable-content"][data-placement="before"]').first().click();

  await page.getByRole('button', { name: 'Raw' }).click();
  const raw = await page.locator('#rawEditor').inputValue();
  expect(raw.indexOf('Skill notes')).toBeLessThan(raw.indexOf('Skill details'));
});

test('move arrows only render when there is an adjacent target', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  let activeBlock = page.locator('.editor-block[data-active-editor-block="true"]').first();
  await expect(activeBlock.locator('> .editor-block-head [data-action="move-block-up"]')).toHaveCount(0);
  await expect(activeBlock.locator('> .editor-block-head [data-action="move-block-down"]')).toHaveCount(1);
  await activeBlock.getByRole('button', { name: 'Done' }).click();
  await page.locator('[data-action="activate-block"]').last().click();
  activeBlock = page.locator('.editor-block[data-active-editor-block="true"]').last();
  await expect(activeBlock.locator('> .editor-block-head [data-action="move-block-up"]')).toHaveCount(1);
  await expect(activeBlock.locator('> .editor-block-head [data-action="move-block-down"]')).toHaveCount(0);

  const sections = page.locator('.editor-section-card:not(.editor-subsection-card)');
  await expect(sections.first().locator(':scope > .editor-section-head [data-action="move-section-up"]')).toHaveCount(0);
  await expect(sections.first().locator(':scope > .editor-section-head [data-action="move-section-down"]')).toHaveCount(0);

  await page.locator('[data-action="add-top-level-section"]').click();

  await expect(sections.first().locator(':scope > .editor-section-head [data-action="move-section-up"]')).toHaveCount(0);
  await expect(sections.first().locator(':scope > .editor-section-head [data-action="move-section-down"]')).toHaveCount(1);
  await expect(sections.last().locator(':scope > .editor-section-head [data-action="move-section-up"]')).toHaveCount(1);
  await expect(sections.last().locator(':scope > .editor-section-head [data-action="move-section-down"]')).toHaveCount(0);

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
