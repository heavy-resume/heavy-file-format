import { expect, test } from '@playwright/test';

test('reference app uses embedded runtime boundary for themed controls', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('#app')).toHaveClass(/hvy-document/);
  await expect(page.locator('main.layout')).toHaveClass(/hvy-embed-layout/);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).margin)).toBe('0px');

  const editorButton = page.getByRole('button', { name: 'Editor' });
  await expect.poll(async () => editorButton.evaluate((button) => getComputedStyle(button).backgroundColor)).toBe(
    await page.locator('#app').evaluate((root) => {
      const probe = document.createElement('span');
      probe.style.color = getComputedStyle(root).getPropertyValue('--hvy-button-bg');
      root.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    })
  );
  await expect.poll(async () => editorButton.evaluate((button) => getComputedStyle(button).color)).toBe(
    await page.locator('#app').evaluate((root) => {
      const probe = document.createElement('span');
      probe.style.color = getComputedStyle(root).getPropertyValue('--hvy-button-text');
      root.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    })
  );

  const viewerButton = page.getByRole('button', { name: 'Viewer' });
  await expect(viewerButton).toHaveCSS('border-top-style', 'solid');
  await expect(viewerButton).not.toHaveCSS('border-top-color', 'rgb(0, 0, 0)');

  const addSection = page.locator('[data-action="add-top-level-section"]');
  const addSectionBox = await addSection.boundingBox();
  const editorBodyBox = await page.locator('.editor-tree-body').boundingBox();
  expect(addSectionBox).not.toBeNull();
  expect(editorBodyBox).not.toBeNull();
  expect(addSectionBox!.width).toBeLessThanOrEqual(editorBodyBox!.width + 1);

  await page.locator('.editor-sidebar-tab').click();
  await expect(page.locator('.editor-sidebar-panel')).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});

test('embedded runtime keeps host button and link styles outside the mounted document', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<div id="mount"></div>';
    const modulePath = '/src/embed.ts';
    const { deserializeDocumentBytes, mountHvyViewer } = await import(/* @vite-ignore */ modulePath);
    const source = `---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

 [Example link](https://example.com)
`;
    const documentBytes = new TextEncoder().encode(source);
    const root = document.querySelector<HTMLElement>('#mount');
    if (!root) {
      throw new Error('Mount root missing.');
    }
    mountHvyViewer({ root, document: deserializeDocumentBytes(documentBytes, '.hvy') });
    const style = document.createElement('style');
    style.textContent = `
      body { background: rgb(255, 255, 255); }
      button { color: rgb(255, 0, 0); background: rgb(255, 255, 255); border-color: rgb(255, 0, 0); }
      a { color: rgb(255, 0, 0); }
    `;
    document.head.append(style);
    const button = root.querySelector<HTMLElement>('.viewer-sidebar-tab');
    const link = root.querySelector<HTMLElement>('.reader-block a');
    if (!button || !link) {
      throw new Error('Expected embedded controls missing.');
    }
    const buttonStyle = getComputedStyle(button);
    const linkStyle = getComputedStyle(link);
    return {
      hasBoundary: root.classList.contains('hvy-document'),
      hasLayout: Boolean(root.querySelector('.hvy-embed-layout')),
      buttonColor: buttonStyle.color,
      buttonBackground: buttonStyle.backgroundColor,
      linkColor: linkStyle.color,
    };
  });

  expect(result.hasBoundary).toBe(true);
  expect(result.hasLayout).toBe(true);
  expect(result.buttonColor).not.toBe('rgb(255, 0, 0)');
  expect(result.buttonBackground).not.toBe('rgb(255, 255, 255)');
  expect(result.linkColor).not.toBe('rgb(255, 0, 0)');
});

test('embedded runtime keeps HVY modal panels above host modal overlays', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<div id="mount"></div>';
    const style = document.createElement('style');
    style.textContent = `
      .modal-overlay { position: fixed; inset: 0; z-index: 9999; background: rgba(0, 0, 0, 0.9); }
      .modal-panel { position: relative; z-index: 0; }
    `;
    document.head.append(style);
    const modulePath = '/src/embed.ts';
    const { deserializeDocumentBytes, mountHvy } = await import(/* @vite-ignore */ modulePath);
    const source = `---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

 Embedded modal stacking test.
`;
    const documentBytes = new TextEncoder().encode(source);
    const root = document.querySelector<HTMLElement>('#mount');
    if (!root) {
      throw new Error('Mount root missing.');
    }
    root.style.setProperty('--hvy-modal-root-z', '2222');
    root.style.setProperty('--hvy-modal-overlay-z', '4');
    root.style.setProperty('--hvy-modal-panel-z', '8');
    const mount = mountHvy({ root, document: deserializeDocumentBytes(documentBytes, '.hvy'), mode: 'editor' });
    mount.openThemeEditor();
    const modalRoot = root.querySelector<HTMLElement>('.modal-root');
    const overlay = root.querySelector<HTMLElement>('.modal-overlay');
    const panel = root.querySelector<HTMLElement>('.modal-panel');
    if (!modalRoot || !overlay || !panel) {
      throw new Error('Expected embedded modal missing.');
    }
    return {
      modalRootIsolation: getComputedStyle(modalRoot).isolation,
      modalRootZIndex: getComputedStyle(modalRoot).zIndex,
      overlayZIndex: getComputedStyle(overlay).zIndex,
      panelZIndex: getComputedStyle(panel).zIndex,
    };
  });

  expect(result.modalRootIsolation).toBe('isolate');
  expect(result.modalRootZIndex).toBe('2222');
  expect(result.overlayZIndex).toBe('4');
  expect(result.panelZIndex).toBe('8');
  expect(Number(result.panelZIndex)).toBeGreaterThan(Number(result.overlayZIndex));
});

test('embedded AI mode renders the request changes popover', async ({ page }) => {
  await page.goto('/');

  await page.evaluate(async () => {
    document.body.innerHTML = '<div id="mount"></div>';
    const modulePath = '/src/embed.ts';
    const { deserializeDocumentBytes, mountHvy } = await import(/* @vite-ignore */ modulePath);
    const source = `---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

 Embedded AI target
`;
    const root = document.querySelector<HTMLElement>('#mount');
    if (!root) {
      throw new Error('Mount root missing.');
    }
    mountHvy({
      root,
      document: deserializeDocumentBytes(new TextEncoder().encode(source), '.hvy'),
      mode: 'ai',
    });
  });

  await expect(page.locator('.ai-view-hint')).toBeVisible();
  await page.locator('#aiReaderDocument .reader-block', { hasText: 'Embedded AI target' }).click({ button: 'right' });
  await expect(page.locator('.hvy-context-popover')).toContainText('Request changes');
  await expect(page.locator('.ai-view-hint')).toHaveCount(0);
  await page.locator('.hvy-context-popover button', { hasText: 'Request changes' }).click();

  await expect(page.locator('.ai-edit-popover')).toBeVisible();
  await expect(page.locator('.ai-edit-popover')).toContainText('Request changes');
});

test('new section component picker opens on the first click', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="add-top-level-section"]').click();
  const newSection = page.locator('.editor-section-card').last();
  await expect(newSection.locator('[data-field="section-title"]')).toBeFocused();

  await newSection.locator('.component-picker-trigger').click();
  await expect(newSection.locator('.component-picker')).toHaveAttribute('data-open', 'true');
});

test('section remove requires confirmation', async ({ page }) => {
  await page.goto('/');

  const sections = page.locator('.editor-section-card:not(.editor-subsection-card)');
  const initialCount = await sections.count();

  await page.locator('[data-action="add-top-level-section"]').click();
  await expect(sections).toHaveCount(initialCount + 1);

  const removeButton = sections.last().locator('[data-action="remove-section"]');
  await removeButton.dispatchEvent('click');
  await expect(sections).toHaveCount(initialCount + 1);
  const dialog = page.getByRole('dialog', { name: 'Confirm deletion?' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS('font-family', await page.locator('main.layout').evaluate((el) => getComputedStyle(el).fontFamily));
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toHaveCSS(
    'color',
    await page.locator('#app').evaluate((root) => {
      const probe = document.createElement('span');
      probe.style.color = getComputedStyle(root).getPropertyValue('--hvy-button-text');
      root.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    })
  );
  await expect(dialog.getByRole('button', { name: 'Delete' })).toHaveCSS(
    'background-color',
    await page.locator('#app').evaluate((root) => {
      const probe = document.createElement('span');
      probe.style.color = getComputedStyle(root).getPropertyValue('--hvy-danger');
      root.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    })
  );

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(sections).toHaveCount(initialCount + 1);

  await removeButton.dispatchEvent('click');
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(sections).toHaveCount(initialCount);
});

test('switching to viewer commits the active component edit', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"profile"}-->
#! Profile

  Original text
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.editor-block-passive', { hasText: 'Original text' }).click();
  await page.locator('.rich-editor').fill('Committed by view switch');
  await page.getByRole('button', { name: 'Viewer' }).click();

  await expect(page.locator('#readerDocument')).toContainText('Committed by view switch');
  await expect(page.locator('#readerDocument')).not.toContainText('Original text');

  await page.getByRole('button', { name: 'Editor' }).click();
  await expect(page.locator('[data-active-editor-block="true"]')).toHaveCount(0);
  await expect(page.locator('.editor-block-passive', { hasText: 'Committed by view switch' })).toBeVisible();
});

test('template-hidden sections hide in viewer and lose the marker after editing', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"optional-history","expanded":false,"hideIfUnmodified":true}-->
#! Optional History

 <!--hvy:text {}-->
  #### Scaffold role
  Add accomplishments here

<!--hvy: {"id":"always-visible"}-->
#! Always Visible

 <!--hvy:text {}-->
  Baseline control
`);
  await page.getByRole('button', { name: 'Apply' }).click();

  await page.getByRole('button', { name: 'Viewer' }).click();
  await expect(page.locator('#optional-history')).toHaveCount(0);
  await expect(page.locator('#readerDocument')).toContainText('Baseline control');
  await expect(page.locator('#readerDocument')).not.toContainText('Scaffold role');

  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();
  await expect(page.locator('#editorTree')).toContainText('Optional History');
  await expect(page.locator('#editorTree')).toContainText('Scaffold role');

  await page.getByRole('button', { name: 'AI' }).click();
  await expect(page.locator('#aiReaderDocument')).toContainText('Scaffold role');

  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();
  await page.locator('.editor-block-passive', { hasText: 'Scaffold role' }).click();
  await page.locator('.rich-editor').fill('#### Scaffold role\nChanged accomplishment');
  await page.getByRole('button', { name: 'Viewer' }).click();
  await expect(page.locator('#optional-history')).toBeVisible();
  await expect(page.locator('#readerDocument')).toContainText('Changed accomplishment');

  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).not.toContainText('"hideIfUnmodified":true');
  await expect(page.locator('#rawEditor')).not.toContainText('"expanded":false');
});

test('resume template hides untouched scaffold sections only in viewer', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Resume Template' }).click();
  await page.getByRole('button', { name: 'Viewer' }).click();
  await expect(page.locator('#header')).toHaveCount(0);
  await expect(page.locator('#summary')).toHaveCount(0);
  await expect(page.locator('#history')).toHaveCount(0);
  await expect(page.locator('#projects')).toHaveCount(0);
  await expect(page.locator('#education')).toHaveCount(0);

  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();
  await expect(page.locator('#editorTree')).toContainText('Info');
  await expect(page.locator('#editorTree')).toContainText('Summary');
  await expect(page.locator('#editorTree')).toContainText('History');
  await expect(page.locator('#editorTree')).toContainText('Projects');
  await expect(page.locator('#editorTree')).toContainText('Education');
});

test('resume template empty skill and tool sections show add controls directly in AI view', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Resume Template' }).click();
  await page.locator('[data-action="switch-view"][data-view="ai"]').click();
  await page.locator('.viewer-sidebar-tab').click();

  const skills = page.locator('#aiSidebarSections #skills');
  await expect(skills).toBeVisible();
  await expect(skills).not.toHaveClass(/is-collapsed-preview/);
  await skills.locator('.passive-empty-list-ghost', { hasText: 'Add Skill' }).click();
  let modal = page.locator('.component-meta-modal', { hasText: 'skill-record' });
  await expect(modal).toBeVisible();
  await expect(modal.locator('label', { hasText: 'Skill' })).toBeVisible();
  await expect(modal).not.toContainText('Skill / Tool');
  await modal.getByRole('button', { name: 'Close' }).click();

  const tools = page.locator('#aiSidebarSections #tools-technologies');
  await expect(tools).toBeVisible();
  await expect(tools).not.toHaveClass(/is-collapsed-preview/);
  await tools.locator('.passive-empty-list-ghost', { hasText: 'Add Tool / Technology' }).click();
  modal = page.locator('.component-meta-modal', { hasText: 'tool-tech-record' });
  await expect(modal).toBeVisible();
  await expect(modal.locator('label', { hasText: 'Tool / Technology' })).toBeVisible();
});

test('reader max width keeps focus while typing', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Advanced' }).click();
  await page.getByRole('button', { name: 'Document Meta' }).click();

  const readerMaxWidth = page.locator('[data-field="meta-reader-max-width"]');
  await readerMaxWidth.fill('');
  await readerMaxWidth.type('60rem');

  await expect(readerMaxWidth).toBeFocused();
  await expect(readerMaxWidth).toHaveValue('60rem');
});

test('responsive preview controls resize document frame without resizing app chrome', async ({ page }) => {
  await page.goto('/');

  const surface = page.locator('.hvy-surface').first();
  const previewFrame = page.locator('.editor-shell').first();
  const pane = page.locator('.full-pane').first();
  const workspace = page.locator('.workspace-shell').first();
  const initialWorkspaceWidth = (await workspace.boundingBox())?.width ?? 0;
  const initialPaneWidth = (await pane.boundingBox())?.width ?? 0;
  expect(initialPaneWidth).toBeGreaterThan(768);

  await page.getByRole('button', { name: 'Phone 390' }).click();
  await expect.poll(async () => Math.round((await pane.boundingBox())?.width ?? 0)).toBe(390);
  await expect.poll(async () => Math.round((await previewFrame.boundingBox())?.width ?? 0)).toBe(390);
  await expect.poll(async () => Math.round((await surface.boundingBox())?.width ?? 0)).toBeGreaterThan(320);
  expect(Math.round((await surface.boundingBox())?.width ?? 0)).toBeLessThan(390);
  const phonePaneBox = await pane.boundingBox();
  const phoneSurfaceBox = await surface.boundingBox();
  expect(phonePaneBox).not.toBeNull();
  expect(phoneSurfaceBox).not.toBeNull();
  expect(Math.round(phonePaneBox!.x + phonePaneBox!.width - (phoneSurfaceBox!.x + phoneSurfaceBox!.width))).toBeGreaterThanOrEqual(8);
  expect(Math.round((await workspace.boundingBox())?.width ?? 0)).toBe(Math.round(initialWorkspaceWidth));

  await page.getByRole('button', { name: 'Tablet 768' }).click();
  await expect.poll(async () => Math.round((await pane.boundingBox())?.width ?? 0)).toBe(768);
  await expect.poll(async () => Math.round((await previewFrame.boundingBox())?.width ?? 0)).toBe(768);
  await expect.poll(async () => Math.round((await surface.boundingBox())?.width ?? 0)).toBeGreaterThan(700);
  expect(Math.round((await surface.boundingBox())?.width ?? 0)).toBeLessThan(768);
  const tabletPaneBox = await pane.boundingBox();
  const tabletSurfaceBox = await surface.boundingBox();
  expect(tabletPaneBox).not.toBeNull();
  expect(tabletSurfaceBox).not.toBeNull();
  expect(Math.round(tabletPaneBox!.x + tabletPaneBox!.width - (tabletSurfaceBox!.x + tabletSurfaceBox!.width))).toBeGreaterThanOrEqual(10);
  expect(Math.round((await workspace.boundingBox())?.width ?? 0)).toBe(Math.round(initialWorkspaceWidth));

  await page.getByRole('button', { name: 'Full' }).click();
  await expect.poll(async () => Math.round((await pane.boundingBox())?.width ?? 0)).toBe(Math.round(initialPaneWidth));
  await expect.poll(async () => Math.round((await previewFrame.boundingBox())?.width ?? 0)).toBeGreaterThan(768);
  const fullPaneBox = await pane.boundingBox();
  const fullSurfaceBox = await surface.boundingBox();
  expect(fullPaneBox).not.toBeNull();
  expect(fullSurfaceBox).not.toBeNull();
  expect(Math.round(fullPaneBox!.x + fullPaneBox!.width - (fullSurfaceBox!.x + fullSurfaceBox!.width))).toBeGreaterThanOrEqual(12);

  await page.getByRole('button', { name: 'Desktop' }).click();
  await expect.poll(async () => Math.round((await pane.boundingBox())?.width ?? 0)).toBeGreaterThan(768);
  const desktopPaneBox = await pane.boundingBox();
  const desktopSurfaceBox = await surface.boundingBox();
  expect(desktopPaneBox).not.toBeNull();
  expect(desktopSurfaceBox).not.toBeNull();
  expect(Math.round(desktopPaneBox!.x + desktopPaneBox!.width - (desktopSurfaceBox!.x + desktopSurfaceBox!.width))).toBeGreaterThanOrEqual(12);
});

test('responsive preview applies to pullout document surfaces', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Resume Template' }).click();
  await page.getByRole('button', { name: 'Phone 390' }).click();

  await page.locator('.editor-sidebar-tab').click();
  await expect.poll(async () => Math.round((await page.locator('.editor-pane').boundingBox())?.width ?? 0)).toBe(390);
  await expect.poll(async () => Math.round((await page.locator('.editor-shell').boundingBox())?.width ?? 0)).toBe(390);
  await expect.poll(async () => Math.round((await page.locator('.editor-sidebar').boundingBox())?.width ?? 0)).toBeLessThan(390);
  await expect.poll(async () => Math.round((await page.locator('.editor-sidebar-panel .hvy-surface').boundingBox())?.width ?? 0)).toBeLessThan(390);

  await page.getByRole('button', { name: 'Viewer' }).click();
  await page.locator('.viewer-sidebar-tab').click();
  await expect.poll(async () => Math.round((await page.locator('.reader-pane').boundingBox())?.width ?? 0)).toBe(390);
  await expect.poll(async () => Math.round((await page.locator('.viewer-shell').boundingBox())?.width ?? 0)).toBe(390);
  await expect.poll(async () => Math.round((await page.locator('.viewer-sidebar').boundingBox())?.width ?? 0)).toBeLessThan(390);
  await expect.poll(async () => Math.round((await page.locator('.viewer-sidebar-panel .hvy-surface').boundingBox())?.width ?? 0)).toBeLessThan(390);
});

test('document scrollers reserve bottom room for floating launch buttons', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('.editor-tree')).toHaveCSS('padding-bottom', '105.6px');

  await page.getByRole('button', { name: 'Viewer' }).click();
  await expect(page.locator('.reader-document')).toHaveCSS('padding-bottom', '105.6px');
});

test('responsive preview applies container query defaults', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();
  await editor.evaluate((node) => {
    node.innerHTML =
      '<p><span class="hvy-alt" data-hvy-alt="true"><span class="hvy-alt-full">Tools &amp; Technologies</span><span class="hvy-alt-compact">Tools &amp; Tech</span></span></p>';
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });

  await expect(editor.locator('.hvy-alt-full')).toBeVisible();
  await expect(editor.locator('.hvy-alt-compact')).toBeHidden();

  await page.getByRole('button', { name: 'Phone 390' }).click();
  await expect(editor.locator('.hvy-alt-full')).toBeHidden();
  await expect(editor.locator('.hvy-alt-compact')).toBeVisible();
});

test('tables resize inside narrow responsive preview containers', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"table-test"}-->
#! Table Test

<!--hvy:table {"id":"narrow-table","tableColumns":["Tool","<!--hvy:alt {\\"compact\\":\\"Desc\\"}-->Description<!--/hvy:alt-->","Status"],"tableShowHeader":true,"tableRows":[{"cells":["Heavy File Format","Responsive table text should wrap inside the phone preview instead of pushing the table wider than its container.","In progress"]}]}-->
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Viewer' }).click();
  await page.getByRole('button', { name: 'Phone 390' }).click();

  const pane = page.locator('.reader-pane');
  const frame = page.locator('.reader-table-frame');
  const table = page.locator('.reader-table');

  await expect.poll(async () => Math.round((await pane.boundingBox())?.width ?? 0)).toBe(390);
  await expect.poll(async () => Math.round((await frame.boundingBox())?.width ?? 0)).toBeLessThan(360);
  await expect.poll(async () => Math.round((await table.boundingBox())?.width ?? 0)).toBeLessThanOrEqual(Math.round((await frame.boundingBox())?.width ?? 0) + 1);
  await expect(table.locator('th').first()).toHaveAttribute('title', 'Tool');
  await expect(table.locator('th').nth(1).locator('.hvy-alt-full')).toBeHidden();
  await expect(table.locator('th').nth(1).locator('.hvy-alt-compact')).toHaveText('Desc');
  await expect(table.locator('th').nth(1).locator('.hvy-alt-compact')).toHaveCSS('border-style', 'none');
  await expect(table.locator('td').nth(1)).toHaveCSS('white-space', 'nowrap');
  await expect(table.locator('td').nth(1)).toHaveCSS('text-overflow', 'ellipsis');
  await expect(table.locator('td').nth(1)).toHaveAttribute('title', 'Responsive table text should wrap inside the phone preview instead of pushing the table wider than its container.');
});

test('document ai context is editable metadata and keeps focus while typing', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Advanced' }).click();
  await page.getByRole('button', { name: 'Document Meta' }).click();

  const aiContext = page.locator('[data-field="meta-ai-context"]');
  await aiContext.fill('');
  await aiContext.type('Use top skills as featured skills.');

  await expect(aiContext).toBeFocused();
  await expect(aiContext).toHaveValue('Use top skills as featured skills.');

  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).toContainText('ai-context: Use top skills as featured skills.');
});

test('description generate button appears only for empty component descriptions', async ({ page }) => {
  await page.route('**/api/chat', async (route) => {
    const payload = route.request().postDataJSON() as { model?: string; openAiReasoningEffort?: string };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        output: `AI description from ${payload.model} with reasoning ${payload.openAiReasoningEffort}`,
      }),
    });
  });
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"profile"}-->
#! Profile

<!--hvy:text {"id":"empty-description"}-->
 Empty description body

<!--hvy:text {"id":"filled-description","description":"Existing description"}-->
 Filled description body
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();

  await page.locator('.editor-block-passive', { hasText: 'Empty description body' }).click();
  const activeBlock = page.locator('.editor-block[data-active-editor-block="true"]');
  await activeBlock.getByRole('button', { name: 'Meta' }).click();
  const metaModal = page.locator('.component-meta-modal', { hasText: 'Component Meta: text' });
  await expect(metaModal.locator('[data-action="generate-block-description"]')).toBeVisible();

  await metaModal.locator('[data-action="generate-block-description"]').click();
  await expect(metaModal.locator('[data-action="generate-block-description"]')).toHaveCount(0);
  await expect(metaModal.locator('[data-field="block-description"]')).toHaveValue('AI description from gpt-5.4-nano with reasoning none');
  await expect(activeBlock).toHaveAttribute('data-active-editor-block', 'true');
  await metaModal.locator('[data-field="block-description"]').fill('');
  await expect(metaModal.locator('[data-action="generate-block-description"]')).toBeVisible();
  await expect(metaModal.locator('[data-field="block-description"]')).toBeFocused();

  await page.getByRole('button', { name: 'Close' }).click();
  await activeBlock.getByRole('button', { name: 'Done' }).click();
  await page.locator('.editor-block-passive', { hasText: 'Filled description body' }).click();
  await page.locator('.editor-block[data-active-editor-block="true"]').getByRole('button', { name: 'Meta' }).click();
  await expect(page.locator('.component-meta-modal', { hasText: 'Component Meta: text' }).locator('[data-action="generate-block-description"]')).toHaveCount(0);
});

test('document meta populates missing descriptions parent first', async ({ page }) => {
  const contexts: string[] = [];
  await page.route('**/api/chat', async (route) => {
    const payload = route.request().postDataJSON() as { context?: string };
    contexts.push(payload.context ?? '');
    await new Promise((resolve) => setTimeout(resolve, 80));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        output: contexts.length === 1 ? 'Profile area' : 'Profile summary list',
      }),
    });
  });
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"profile"}-->
#! Profile

<!--hvy:component-list {"id":"summary-list"}-->

 <!--hvy:component-list:0 {}-->

  <!--hvy:text {"id":"summary"}-->
   Summary body
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();
  await page.getByRole('button', { name: 'Document Meta' }).click();

  await expect(page.locator('.document-meta-view')).toBeVisible();
  await expect(page.locator('#editorTree')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open chat' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open search' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Populate Missing' }).click();

  await expect(page.locator('.description-progress-modal')).toBeVisible();
  await expect(page.locator('.description-progress-modal')).toContainText(/0 of 2|1 of 2|2 of 2/);
  await expect(page.locator('.description-progress-modal')).toContainText('Last generated');
  await expect(page.locator('.description-progress-modal')).toContainText('Profile area');
  await expect(page.locator('.description-progress-modal')).toContainText('1 component skipped');
  await expect(page.locator('.meta-panel')).toContainText('Generated 2 missing descriptions.');
  expect(contexts).toHaveLength(2);
  expect(contexts[1]).toContain('Profile - Profile area');
  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).toContainText('"description":"Profile area"');
  await expect(page.locator('#rawEditor')).toContainText('"description":"Profile summary list"');
  await expect(page.locator('#rawEditor')).not.toContainText('Summary body","description"');
});

test('custom component templates open a fill modal before editor insertion', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
component_defs:
  - name: card-record
    baseType: container
    templateVariables:
      title:
        label: Card title
    schema:
      containerBlocks:
        - text: "{% title %}"
          schema:
            component: text
            placeholder: Title
        - text: "{% details | block %}"
          schema:
            component: text
            placeholder: Details
---

<!--hvy: {"id":"cards"}-->
#! Cards

<!--hvy:component-list {"id":"card-list","componentListComponent":"card-record"}-->
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.ghost-label', { hasText: 'Add Card' }).click();
  const modal = page.locator('.component-meta-modal', { hasText: 'card-record' });
  await expect(modal).toBeVisible();
  await expect(modal.locator('label', { hasText: 'Card title' })).toBeVisible();
  await expect(modal.locator('label', { hasText: 'Details' })).toBeVisible();
  await expect(modal.locator('input[data-template-variable="title"]')).toBeVisible();
  await expect(modal.locator('textarea[data-template-variable="details"]')).toBeVisible();

  await modal.locator('input[data-template-variable="title"]').fill('Launch Notes');
  await modal.getByRole('button', { name: 'Insert' }).click();

  const inserted = page.locator('.editor-block', { hasText: 'card-record' });
  await expect(inserted.locator('.editor-block-passive', { hasText: 'Launch Notes' })).toBeVisible();
  await expect(inserted.locator('.editor-block-passive [data-placeholder="Details"]')).toBeVisible();
});

test('AI view shows editor placeholders and empty list add affordances', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"draft"}-->
#! Draft

<!--hvy:text {"id":"summary","placeholder":"Draft summary"}-->

<!--hvy:component-list {"id":"todos","componentListComponent":"text","componentListItemLabel":"todo"}-->

 <!--hvy:component-list:0 {}-->

  Existing todo
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'AI' }).click();

  await expect(page.locator('#aiReaderDocument .editor-passive-empty-text', { hasText: 'Draft summary' })).toBeVisible();
  await expect(page.locator('#aiReaderDocument .ghost-label', { hasText: 'Add Todo' })).toBeVisible();
  await expect(page.locator('#aiReaderDocument')).toContainText('Existing todo');

  await page.locator('#aiReaderDocument .editor-passive-empty-text', { hasText: 'Draft summary' }).click();
  await expect(page.locator('#aiReaderDocument .rich-editor')).toBeVisible();
  await page.locator('#aiReaderDocument .rich-editor').fill('AI draft summary');
  await expect(page.locator('#aiReaderDocument')).toContainText('AI draft summary');

  await page.locator('#aiReaderDocument .ghost-label', { hasText: 'Add Todo' }).click();

  await expect(page.locator('#aiReaderDocument .editor-block .rich-editor')).toBeVisible();
  await expect(page.locator('#aiReaderDocument .ghost-label', { hasText: 'Add Todo' })).toBeVisible();
  await expect(page.locator('#aiReaderDocument .active-component-insert-ghost')).toHaveCount(0);
});

test('custom component template modal cancel leaves the document unchanged', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
component_defs:
  - name: card-record
    baseType: text
    schema:
      id: "{% title %}"
      placeholder: Card title
---

<!--hvy: {"id":"cards"}-->
#! Cards

<!--hvy:component-list {"id":"card-list","componentListComponent":"card-record"}-->
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.ghost-label', { hasText: 'Add Card' }).click();
  const modal = page.locator('.component-meta-modal', { hasText: 'card-record' });
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.reader-block-text', { hasText: 'Card title' })).toHaveCount(0);
});

test('text component fenced python code is syntax highlighted', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"code-sample"}-->
#! Code Sample

<!--hvy:text {"id":"python-example"}-->
\`\`\`python
def greet(name):
    return f"hello {name}"
\`\`\`
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  const code = page.locator('.reader-code-block code.language-python').first();
  await expect(code).toBeVisible();
  const defKeyword = code.locator('.hljs-keyword', { hasText: 'def' }).first();
  const functionTitle = code.locator('.hljs-title.function_', { hasText: 'greet' }).first();
  await expect(defKeyword).toBeVisible();
  await expect(functionTitle).toBeVisible();
  await expect(code.locator('.hljs-keyword', { hasText: 'return' })).toBeVisible();
  await expect.poll(async () => ({
    keyword: await defKeyword.evaluate((node) => getComputedStyle(node).color),
    functionTitle: await functionTitle.evaluate((node) => getComputedStyle(node).color),
  })).toMatchObject({
    keyword: expect.not.stringMatching(/^$/),
    functionTitle: expect.not.stringMatching(/^$/),
  });
  expect(await defKeyword.evaluate((node) => getComputedStyle(node).color)).not.toBe(
    await functionTitle.evaluate((node) => getComputedStyle(node).color)
  );
});

test('trailing spaces after bold labels remain editable outside bold text', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"locations"}-->
#! Locations

 <!--hvy:text {"css":"margin: 0.5rem 0; line-height: 1.5;","lock":true}-->
  **Location:** 

  **Target Location(s):** 
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.editor-block-passive', { hasText: 'Location:' }).click();

  const editor = page.locator('.rich-editor').first();
  await expect(editor).toBeVisible();
  await expect(editor).toContainText('Location:');
  await expect(editor).toContainText('Target Location(s):');
  await expect(editor.locator('p').first()).toHaveJSProperty('innerHTML', '<strong>Location:</strong>&nbsp;');

  await editor.evaluate((node) => {
    const paragraph = node.querySelector('p');
    const trailingSpace = paragraph?.lastChild;
    if (!paragraph || !trailingSpace) {
      throw new Error('Expected trailing editable space after Location label.');
    }
    const range = document.createRange();
    range.setStart(trailingSpace, trailingSpace.textContent?.length ?? 0);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.keyboard.type('Seattle, WA');

  await expect(editor.locator('p').first().locator('strong')).toHaveText('Location:');
  await expect(editor.locator('p').first()).toContainText('Location: Seattle, WA');

  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).toContainText('**Location:** Seattle, WA');
});
