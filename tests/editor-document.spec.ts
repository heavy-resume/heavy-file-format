import { expect, test, type Page } from '@playwright/test';

async function selectDocumentMenuItem(page: Page, name: string): Promise<void> {
  await expect(page.locator('#downloadName')).toHaveValue(/.+\.(hvy|thvy)$/);
  await page.locator('.document-menu summary').click();
  const item = page.getByRole('button', { name, exact: true });
  await expect(item).toBeVisible();
  await item.click({ force: true });
}

test('reference app uses embedded runtime boundary for themed controls', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('#app')).toHaveClass(/hvy-document/);
  await expect(page.locator('main.layout')).toHaveClass(/hvy-embed-layout/);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).margin)).toBe('0px');
  await expect(page.getByRole('link', { name: 'Two embedded docs' })).toHaveAttribute('href', '/examples/two-embedded-docs.html');

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

test('reference app can load the import HVY reference document', async ({ page }) => {
  await page.goto('/');

  await selectDocumentMenuItem(page, 'Import Reference');

  await expect(page.locator('#downloadName')).toHaveValue('ai-import-hvy-format-reference.hvy');
});

test('reference app saves the import reference document through the server file endpoint', async ({ page }) => {
  let savedBody = '';
  let downloaded = false;
  page.on('download', () => {
    downloaded = true;
  });
  await page.route('**/api/import-reference-document', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        contentType: 'text/plain; charset=utf-8',
        body: `---
hvy_version: 0.1
title: Import Reference Test
---

<!--hvy: {"id":"summary"}-->
#! Summary
`,
      });
      return;
    }
    if (route.request().method() === 'PUT') {
      savedBody = route.request().postData() ?? '';
      await route.fulfill({
        contentType: 'application/json',
        body: '{"ok":true}',
      });
      return;
    }
    await route.fulfill({ status: 405, body: '{"error":"Method not allowed."}' });
  });
  await page.goto('/');

  await selectDocumentMenuItem(page, 'Import Reference');
  await page.getByRole('button', { name: 'Save File' }).click();

  await expect.poll(() => savedBody).toContain('hvy_version: 0.1');
  expect(downloaded).toBe(false);
});

test('reference app saves the guide document through the server file endpoint', async ({ page }) => {
  let savedBody = '';
  let downloaded = false;
  page.on('download', () => {
    downloaded = true;
  });
  await page.route('**/api/hvy-guide-document', async (route) => {
    if (route.request().method() === 'PUT') {
      savedBody = route.request().postData() ?? '';
      await route.fulfill({
        contentType: 'application/json',
        body: '{"ok":true}',
      });
      return;
    }
    await route.fulfill({ status: 405, body: '{"error":"Method not allowed."}' });
  });
  await page.goto('/');

  await selectDocumentMenuItem(page, 'Guide');
  await page.getByRole('button', { name: 'Save File' }).click();

  await expect.poll(() => savedBody).toContain('hvy_version: 0.1');
  expect(downloaded).toBe(false);
});

test('search result navigation stays in editor view', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw' }).click();
  const spacerSections = Array.from({ length: 14 }, (_item, index) => `
<!--hvy: {"id":"spacer-${index + 1}"}-->
#! Spacer ${index + 1}

 ${Array.from({ length: 10 }, (_line, lineIndex) => `Spacer ${index + 1}.${lineIndex + 1}.`).join('\n ')}
`).join('\n');
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

 ${spacerSections}

<!--hvy: {"id":"target"}-->
#! Target

 <!--hvy:text {"id":"intro"}-->
  Find this editor-only needle.
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+F' : 'Control+F');
  await page.locator('[data-field="search-query"]').fill('editor-only needle');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.search-result');
  await page.locator('.search-result').first().click();

  await expect(page.locator('#editorTree')).toBeVisible();
  await expect(page.locator('#readerDocument')).toHaveCount(0);
  await expect(page.locator('#editorTree .is-temp-highlighted')).toContainText('editor-only needle', { timeout: 800 });
  await expect.poll(async () =>
    page.locator('#editorTree .is-temp-highlighted').evaluate((target) => {
      const container = target.closest<HTMLElement>('.editor-tree');
      if (!container) {
        return Number.POSITIVE_INFINITY;
      }
      const targetRect = target.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      return Math.abs(targetRect.top - (containerRect.top + containerRect.height / 2));
    })
  ).toBeLessThan(140);
  const editorScroll = await page.locator('#editorTree').evaluate((container) => container.scrollTop);
  expect(editorScroll).toBeGreaterThan(200);

  await page.locator('.search-collapsed-main').click();
  await page.locator('[data-action="close-search"]').last().click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+F' : 'Control+F');

  await expect(page.locator('.search-result')).toHaveCount(0);
  await expect(page.locator('.search-results-empty')).toContainText('Search results will appear here.');
});

test('editor search opens sidebar for sidebar results', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"main"}-->
#! Main

 Main content.

<!--hvy: {"id":"side","location":"sidebar"}-->
#! Side

 <!--hvy:text {"id":"side-note"}-->
  Sidebar-only search needle.
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();
  await expect(page.locator('.editor-shell')).toHaveClass(/is-sidebar-closed/);

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+F' : 'Control+F');
  await page.locator('[data-field="search-query"]').fill('sidebar-only search needle');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.search-result');
  await page.locator('.search-result').first().click();

  await expect(page.locator('.editor-shell')).toHaveClass(/is-sidebar-open/);
  await expect(page.locator('.editor-sidebar-panel .is-temp-highlighted')).toContainText('Sidebar-only search needle', { timeout: 800 });
  await expect(page.locator('#editorTree')).toBeVisible();
  await expect(page.locator('#readerDocument')).toHaveCount(0);
});

test('editor search expands collapsed expandable ancestors', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"main"}-->
#! Main

 <!--hvy:expandable {"id":"record","expandableAlwaysShowStub":true,"expandableExpanded":false}-->
  <!--hvy:expandable:stub {}-->
   <!--hvy:text {"id":"record-title"}-->
    Searchable record
  <!--hvy:expandable:content {}-->
   <!--hvy:text {"id":"record-detail"}-->
    Hidden expandable editor needle.
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();
  await expect(page.locator('#editorTree')).not.toContainText('Hidden expandable editor needle');

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+F' : 'Control+F');
  await page.locator('[data-field="search-query"]').fill('hidden expandable editor needle');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.search-result');
  await page.locator('.search-result').first().click();

  await expect(page.locator('#editorTree')).toBeVisible();
  await expect(page.locator('#readerDocument')).toHaveCount(0);
  await expect(page.locator('#editorTree .is-temp-highlighted')).toContainText('Hidden expandable editor needle', { timeout: 800 });
});

test('embedded runtime keeps host button, link, and list styles outside the mounted document', async ({ page }) => {
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

 - Embedded bullet
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
      ul, ol { list-style: none; padding-left: 0; }
      li { display: block; }
    `;
    document.head.append(style);
    const button = root.querySelector<HTMLElement>('.viewer-sidebar-tab');
    const link = root.querySelector<HTMLElement>('.reader-block a');
    const list = root.querySelector<HTMLElement>('.reader-block ul');
    const listItem = root.querySelector<HTMLElement>('.reader-block li');
    if (!button || !link || !list || !listItem) {
      throw new Error('Expected embedded controls missing.');
    }
    const buttonStyle = getComputedStyle(button);
    const linkStyle = getComputedStyle(link);
    const listStyle = getComputedStyle(list);
    const listItemStyle = getComputedStyle(listItem);
    return {
      hasBoundary: root.classList.contains('hvy-document'),
      hasLayout: Boolean(root.querySelector('.hvy-embed-layout')),
      buttonColor: buttonStyle.color,
      buttonBackground: buttonStyle.backgroundColor,
      linkColor: linkStyle.color,
      listStyleType: listStyle.listStyleType,
      listPaddingInlineStart: listStyle.paddingInlineStart,
      listItemDisplay: listItemStyle.display,
    };
  });

  expect(result.hasBoundary).toBe(true);
  expect(result.hasLayout).toBe(true);
  expect(result.buttonColor).not.toBe('rgb(255, 0, 0)');
  expect(result.buttonBackground).not.toBe('rgb(255, 255, 255)');
  expect(result.linkColor).not.toBe('rgb(255, 0, 0)');
  expect(result.listStyleType).toBe('disc');
  expect(result.listPaddingInlineStart).not.toBe('0px');
  expect(result.listItemDisplay).toBe('list-item');
});

test('embedded runtime lets hosts asynchronously rewrite rendered reader links', async ({ page }) => {
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

 [Example link](https://example.com/report)
 [Preview link](https://example.com/preview)
`;
    const root = document.querySelector<HTMLElement>('#mount');
    if (!root) {
      throw new Error('Mount root missing.');
    }
    const seen: string[] = [];
    mountHvyViewer({
      root,
      document: deserializeDocumentBytes(new TextEncoder().encode(source), '.hvy'),
      async linkObserver(link) {
        seen.push(`${link.href}:${link.text.trim()}`);
        await Promise.resolve();
        if (link.href.endsWith('/preview')) {
          return {
            html: `<a class="safe-preview-link" href="/preview-card">Preview: ${link.text}</a><span class="safe-preview-label">Ready</span>`,
          };
        }
        return {
          href: `/safe-link?url=${encodeURIComponent(link.href)}`,
          text: `Safe: ${link.text.trim()}`,
          attributes: { 'data-link-reviewed': 'true' },
        };
      },
    });
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    const link = root.querySelector<HTMLAnchorElement>('.reader-block a');
    const preview = root.querySelector<HTMLAnchorElement>('.safe-preview-link');
    const previewLabel = root.querySelector<HTMLElement>('.safe-preview-label');
    if (!link) {
      throw new Error('Expected rendered link missing.');
    }
    return {
      seen,
      href: link.getAttribute('href'),
      text: link.textContent,
      reviewed: link.getAttribute('data-link-reviewed'),
      previewHref: preview?.getAttribute('href') ?? '',
      previewText: preview?.textContent ?? '',
      previewLabel: previewLabel?.textContent ?? '',
    };
  });

  expect(result.seen).toEqual(['https://example.com/report:Example link', 'https://example.com/preview:Preview link']);
  expect(result.href).toBe('/safe-link?url=https%3A%2F%2Fexample.com%2Freport');
  expect(result.text).toBe('Safe: Example link');
  expect(result.reviewed).toBe('true');
  expect(result.previewHref).toBe('/preview-card');
  expect(result.previewText).toBe('Preview: Preview link');
  expect(result.previewLabel).toBe('Ready');
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

test('embedded runtime exposes current document bytes for host downloads', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<div id="viewerMount"></div><div id="editorMount"></div>';
    const modulePath = '/src/embed.ts';
    const { deserializeDocumentBytes, mountHvy, mountHvyViewer } = await import(/* @vite-ignore */ modulePath);
    const source = `---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

 Host download serialization test.
`;
    const encoder = new TextEncoder();
    const viewerRoot = document.querySelector<HTMLElement>('#viewerMount');
    const editorRoot = document.querySelector<HTMLElement>('#editorMount');
    if (!viewerRoot || !editorRoot) {
      throw new Error('Mount roots missing.');
    }
    const viewerMount = mountHvyViewer({
      root: viewerRoot,
      document: deserializeDocumentBytes(encoder.encode(source), '.hvy'),
    });
    const editorMount = mountHvy({
      root: editorRoot,
      document: deserializeDocumentBytes(encoder.encode(source), '.hvy'),
      mode: 'editor',
    });
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    const viewerDocument = new TextDecoder().decode(viewerMount.serializeDocumentBytes());
    const editorDocument = new TextDecoder().decode(editorMount.serializeDocumentBytes());
    return {
      viewerHasSerializer: typeof viewerMount.serializeDocumentBytes,
      editorHasSerializer: typeof editorMount.serializeDocumentBytes,
      viewerText: viewerDocument,
      editorText: editorDocument,
    };
  });

  expect(result.viewerHasSerializer).toBe('function');
  expect(result.editorHasSerializer).toBe('function');
  expect(result.viewerText).toContain('Host download serialization test.');
  expect(result.editorText).toContain('Host download serialization test.');
});

test('embedded viewer mounts keep independent documents and link observers', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<div id="firstMount"></div><div id="secondMount"></div>';
    const modulePath = '/src/embed.ts';
    const { deserializeDocumentBytes, mountHvyViewer } = await import(/* @vite-ignore */ modulePath);
    const firstSource = `---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! First Summary

 First embedded document with [First Link](https://first.example).
`;
    const secondSource = `---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Second Summary

 Second embedded document with [Second Link](https://second.example).
`;
    const encoder = new TextEncoder();
    const firstRoot = document.querySelector<HTMLElement>('#firstMount');
    const secondRoot = document.querySelector<HTMLElement>('#secondMount');
    if (!firstRoot || !secondRoot) {
      throw new Error('Mount roots missing.');
    }
    const firstMount = mountHvyViewer({
      root: firstRoot,
      document: deserializeDocumentBytes(encoder.encode(firstSource), '.hvy'),
      linkObserver: async () => ({ title: 'first-observer', href: '/first-rewrite' }),
    });
    const secondMount = mountHvyViewer({
      root: secondRoot,
      document: deserializeDocumentBytes(encoder.encode(secondSource), '.hvy'),
      linkObserver: async () => ({ title: 'second-observer', href: '/second-rewrite' }),
    });
    await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
    firstMount.setPaletteOverrideId('paper');
    secondMount.setPaletteOverrideId('spring');
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    return {
      firstText: firstRoot.textContent,
      secondText: secondRoot.textContent,
      firstDocumentTitle: firstMount.getDocument().sections[0]?.title,
      secondDocumentTitle: secondMount.getDocument().sections[0]?.title,
      firstHref: firstRoot.querySelector('a')?.getAttribute('href'),
      secondHref: secondRoot.querySelector('a')?.getAttribute('href'),
      firstTitle: firstRoot.querySelector('a')?.getAttribute('title'),
      secondTitle: secondRoot.querySelector('a')?.getAttribute('title'),
      firstBg: firstRoot.style.getPropertyValue('--hvy-bg'),
      secondBg: secondRoot.style.getPropertyValue('--hvy-bg'),
    };
  });

  expect(result.firstText).toContain('First embedded document');
  expect(result.firstText).not.toContain('Second embedded document');
  expect(result.secondText).toContain('Second embedded document');
  expect(result.secondText).not.toContain('First embedded document');
  expect(result.firstDocumentTitle).toBe('First Summary');
  expect(result.secondDocumentTitle).toBe('Second Summary');
  expect(result.firstHref).toBe('/first-rewrite');
  expect(result.secondHref).toBe('/second-rewrite');
  expect(result.firstTitle).toBe('first-observer');
  expect(result.secondTitle).toBe('second-observer');
  expect(result.firstBg).not.toBe('');
  expect(result.secondBg).not.toBe('');
  expect(result.firstBg).not.toBe(result.secondBg);
});

test('embedded editor and viewer mounts coexist without sharing document state', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<div id="viewerMount"></div><div id="editorMount"></div>';
    const modulePath = '/src/embed.ts';
    const { deserializeDocumentBytes, mountHvy, mountHvyViewer } = await import(/* @vite-ignore */ modulePath);
    const makeSource = (title: string, body: string) => `---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! ${title}

 ${body}
`;
    const encoder = new TextEncoder();
    const viewerRoot = document.querySelector<HTMLElement>('#viewerMount');
    const editorRoot = document.querySelector<HTMLElement>('#editorMount');
    if (!viewerRoot || !editorRoot) {
      throw new Error('Mount roots missing.');
    }
    const viewerMount = mountHvyViewer({
      root: viewerRoot,
      document: deserializeDocumentBytes(encoder.encode(makeSource('Viewer Summary', 'Viewer-only body.')), '.hvy'),
    });
    const editorMount = mountHvy({
      root: editorRoot,
      document: deserializeDocumentBytes(encoder.encode(makeSource('Editor Summary', 'Editor-only body.')), '.hvy'),
      mode: 'editor',
      storageKey: 'mixed-editor',
    });
    await new Promise<void>((resolve, reject) => {
      const startedAt = performance.now();
      const waitForEditorMount = () => {
        if (!editorRoot.textContent?.includes('Loading HVY')) {
          resolve();
          return;
        }
        if (performance.now() - startedAt > 1000) {
          reject(new Error('Timed out waiting for editor embed.'));
          return;
        }
        window.requestAnimationFrame(waitForEditorMount);
      };
      waitForEditorMount();
    });

    editorMount.getDocument().sections[0]!.title = 'Editor Mutated';
    editorMount.setPaletteOverrideId('spring');
    viewerMount.setPaletteOverrideId('paper');
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

    return {
      viewerText: viewerRoot.textContent,
      editorText: editorRoot.textContent,
      viewerDocumentTitle: viewerMount.getDocument().sections[0]?.title,
      editorDocumentTitle: editorMount.getDocument().sections[0]?.title,
      viewerBg: viewerRoot.style.getPropertyValue('--hvy-bg'),
      editorBg: editorRoot.style.getPropertyValue('--hvy-bg'),
    };
  });

  expect(result.viewerText).toContain('Viewer-only body.');
  expect(result.viewerText).not.toContain('Editor-only body.');
  expect(result.editorText).toContain('Editor-only body.');
  expect(result.editorText).not.toContain('Viewer-only body.');
  expect(result.viewerDocumentTitle).toBe('Viewer Summary');
  expect(result.editorDocumentTitle).toBe('Editor Mutated');
  expect(result.viewerBg).not.toBe('');
  expect(result.editorBg).not.toBe('');
  expect(result.viewerBg).not.toBe(result.editorBg);
});

test('embedded editor mounts isolate keyed session state', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async () => {
    sessionStorage.clear();
    document.body.innerHTML = '<div id="firstMount"></div><div id="secondMount"></div>';
    const modulePath = '/src/embed-full.ts';
    const { deserializeDocumentBytes, mountHvy } = await import(/* @vite-ignore */ modulePath);
    const makeSource = (title: string) => `---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! ${title}

 ${title} body
`;
    const encoder = new TextEncoder();
    const firstRoot = document.querySelector<HTMLElement>('#firstMount');
    const secondRoot = document.querySelector<HTMLElement>('#secondMount');
    if (!firstRoot || !secondRoot) {
      throw new Error('Mount roots missing.');
    }
    const firstMount = mountHvy({
      root: firstRoot,
      document: deserializeDocumentBytes(encoder.encode(makeSource('First Initial')), '.hvy'),
      mode: 'editor',
      storageKey: 'first-editor',
    });
    const secondMount = mountHvy({
      root: secondRoot,
      document: deserializeDocumentBytes(encoder.encode(makeSource('Second Initial')), '.hvy'),
      mode: 'editor',
      storageKey: 'second-editor',
    });
    firstMount.getDocument().sections[0]!.title = 'First Saved';
    secondMount.getDocument().sections[0]!.title = 'Second Saved';
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    firstMount.destroy();
    secondMount.destroy();
    const firstResumeMount = mountHvy({
      root: firstRoot,
      document: deserializeDocumentBytes(encoder.encode(makeSource('First Fresh')), '.hvy'),
      mode: 'editor',
      storageKey: 'first-editor',
    });
    const secondResumeMount = mountHvy({
      root: secondRoot,
      document: deserializeDocumentBytes(encoder.encode(makeSource('Second Fresh')), '.hvy'),
      mode: 'editor',
      storageKey: 'second-editor',
    });
    return {
      firstTitle: firstResumeMount.getDocument().sections[0]?.title,
      secondTitle: secondResumeMount.getDocument().sections[0]?.title,
      hasFirstStorage: Boolean(sessionStorage.getItem('hvy-editor-session-state-v1:first-editor')),
      hasSecondStorage: Boolean(sessionStorage.getItem('hvy-editor-session-state-v1:second-editor')),
      hasSharedStorage: Boolean(sessionStorage.getItem('hvy-editor-session-state-v1')),
    };
  });

  expect(result.firstTitle).toBe('First Saved');
  expect(result.secondTitle).toBe('Second Saved');
  expect(result.hasFirstStorage).toBe(true);
  expect(result.hasSecondStorage).toBe(true);
  expect(result.hasSharedStorage).toBe(false);
});

test('embedded editor mounts do not persist session state without a storage key', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async () => {
    sessionStorage.clear();
    document.body.innerHTML = '<div id="mount"></div>';
    const modulePath = '/src/embed-full.ts';
    const { deserializeDocumentBytes, mountHvy } = await import(/* @vite-ignore */ modulePath);
    const source = `---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Temporary Initial

 Temporary body
`;
    const root = document.querySelector<HTMLElement>('#mount');
    if (!root) {
      throw new Error('Mount root missing.');
    }
    const mount = mountHvy({
      root,
      document: deserializeDocumentBytes(new TextEncoder().encode(source), '.hvy'),
      mode: 'editor',
    });
    mount.getDocument().sections[0]!.title = 'Temporary Saved';
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    return {
      storageKeys: Object.keys(sessionStorage),
      title: mount.getDocument().sections[0]?.title,
    };
  });

  expect(result.title).toBe('Temporary Saved');
  expect(result.storageKeys).toEqual([]);
});

test('embedded editor storage key does not override explicit viewer mode', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async () => {
    sessionStorage.clear();
    document.body.innerHTML = '<div id="mount"></div>';
    const modulePath = '/src/embed-full.ts';
    const { deserializeDocumentBytes, mountHvy } = await import(/* @vite-ignore */ modulePath);
    const makeSource = (title: string) => `---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! ${title}

 ${title} body
`;
    const root = document.querySelector<HTMLElement>('#mount');
    if (!root) {
      throw new Error('Mount root missing.');
    }
    const encoder = new TextEncoder();
    const editorMount = mountHvy({
      root,
      document: deserializeDocumentBytes(encoder.encode(makeSource('Initial Editor')), '.hvy'),
      mode: 'editor',
      storageKey: 'mode-isolation',
    });
    editorMount.getDocument().sections[0]!.title = 'Saved Document';
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    editorMount.destroy();
    const viewerMount = mountHvy({
      root,
      document: deserializeDocumentBytes(encoder.encode(makeSource('Fresh Viewer')), '.hvy'),
      mode: 'viewer',
      storageKey: 'mode-isolation',
    });
    return {
      hasViewer: Boolean(root.querySelector('#readerDocument')),
      hasEditor: Boolean(root.querySelector('#editorTree')),
      hasViewerShell: Boolean(root.querySelector('.viewer-shell')),
      title: viewerMount.getDocument().sections[0]?.title,
    };
  });

  expect(result.hasViewer).toBe(true);
  expect(result.hasEditor).toBe(false);
  expect(result.hasViewerShell).toBe(true);
  expect(result.title).toBe('Fresh Viewer');
});

test('embedded viewer sidebar stays open after remounting root from editor to viewer', async ({ page }) => {
  await page.goto('/');

  await page.evaluate(async () => {
    sessionStorage.clear();
    document.body.innerHTML = '<div id="mount"></div>';
    const modulePath = '/src/embed-full.ts';
    const { deserializeDocumentBytes, mountHvy } = await import(/* @vite-ignore */ modulePath);
    const source = `---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

 Body
`;
    const root = document.querySelector<HTMLElement>('#mount');
    if (!root) {
      throw new Error('Mount root missing.');
    }
    const encoder = new TextEncoder();
    const editorMount = mountHvy({
      root,
      document: deserializeDocumentBytes(encoder.encode(source), '.hvy'),
      mode: 'editor',
      storageKey: 'sidebar-remount',
    });
    editorMount.destroy();
    mountHvy({
      root,
      document: deserializeDocumentBytes(encoder.encode(source), '.hvy'),
      mode: 'viewer',
      storageKey: 'sidebar-remount',
    });
  });

  await page.locator('#mount .viewer-sidebar-tab').click();

  await expect(page.locator('#mount .viewer-shell')).toHaveClass(/is-sidebar-open/);
  await expect(page.locator('#mount .viewer-sidebar-tab')).toHaveAttribute('aria-expanded', 'true');
});

test('embedded viewer storage key does not persist stale document state', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async () => {
    sessionStorage.clear();
    document.body.innerHTML = '<div id="mount"></div>';
    const modulePath = '/src/embed-full.ts';
    const { deserializeDocumentBytes, mountHvy } = await import(/* @vite-ignore */ modulePath);
    const makeSource = (title: string) => `---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! ${title}

 ${title} body
`;
    const root = document.querySelector<HTMLElement>('#mount');
    if (!root) {
      throw new Error('Mount root missing.');
    }
    const encoder = new TextEncoder();
    const firstMount = mountHvy({
      root,
      document: deserializeDocumentBytes(encoder.encode(makeSource('Initial Viewer')), '.hvy'),
      mode: 'viewer',
      storageKey: 'viewer-refresh',
    });
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    firstMount.destroy();
    const secondMount = mountHvy({
      root,
      document: deserializeDocumentBytes(encoder.encode(makeSource('Fresh Viewer')), '.hvy'),
      mode: 'viewer',
      storageKey: 'viewer-refresh',
    });
    const payload = JSON.parse(sessionStorage.getItem('hvy-editor-session-state-v1:viewer-refresh') ?? '{}') as { documentBase64?: string };
    return {
      title: secondMount.getDocument().sections[0]?.title,
      hasDocumentBase64: typeof payload.documentBase64 === 'string',
    };
  });

  expect(result.title).toBe('Fresh Viewer');
  expect(result.hasDocumentBase64).toBe(false);
});

test('embedded runtime only registers plugins supplied by the host', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<div id="viewerMount"></div><div id="editorMount"></div>';
    const modulePath = '/src/embed.ts';
    const registryPath = '/src/plugins/registry.ts';
    const { deserializeDocumentBytes, mountHvy, mountHvyViewer, plugins } = await import(/* @vite-ignore */ modulePath);
    const { getHostPlugins } = await import(/* @vite-ignore */ registryPath);
    const source = `---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

 Embedded plugin registration test.
`;
    const encoder = new TextEncoder();
    const viewerRoot = document.querySelector<HTMLElement>('#viewerMount');
    const editorRoot = document.querySelector<HTMLElement>('#editorMount');
    if (!viewerRoot || !editorRoot) {
      throw new Error('Mount roots missing.');
    }
    const viewerMount = mountHvyViewer({
      root: viewerRoot,
      document: deserializeDocumentBytes(encoder.encode(source), '.hvy'),
    });
    const viewerPluginIds = getHostPlugins().map((plugin) => plugin.id);
    viewerMount.destroy();
    mountHvy({
      root: editorRoot,
      document: deserializeDocumentBytes(encoder.encode(source), '.hvy'),
      mode: 'editor',
      plugins: [plugins.graph],
    });
    await new Promise<void>((resolve, reject) => {
      const startedAt = performance.now();
      const waitForEditorMount = () => {
        if (!editorRoot.textContent?.includes('Loading HVY')) {
          resolve();
          return;
        }
        if (performance.now() - startedAt > 1000) {
          reject(new Error('Timed out waiting for full embed mount.'));
          return;
        }
        window.requestAnimationFrame(waitForEditorMount);
      };
      waitForEditorMount();
    });
    return {
      viewerPluginIds,
      editorPluginIds: getHostPlugins().map((plugin) => plugin.id),
    };
  });

  expect(result.viewerPluginIds).toEqual([]);
  expect(result.editorPluginIds).toEqual(['hvy.graph']);
});

test('embedded component meta modal centers within the mounted app', async ({ page }) => {
  await page.goto('/');

  await page.evaluate(async () => {
    document.body.innerHTML = '<div id="mount" style="width: 420px; height: 560px;"></div>';
    const modulePath = '/src/embed.ts';
    const { deserializeDocumentBytes, mountHvy } = await import(/* @vite-ignore */ modulePath);
    const source = `---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

 <!--hvy:text {"id":"summary-text"}-->
  Embedded modal placement test.
`;
    const root = document.querySelector<HTMLElement>('#mount');
    if (!root) {
      throw new Error('Mount root missing.');
    }
    mountHvy({
      root,
      document: deserializeDocumentBytes(new TextEncoder().encode(source), '.hvy'),
      mode: 'editor',
      showAdvancedEditor: true,
    });
  });

  const mount = page.locator('#mount');
  await mount.locator('[data-action="activate-block"]').first().click();
  await mount.locator('[data-action="open-component-meta"]').click();

  const placement = await mount.locator('.component-meta-modal').evaluate((modal) => {
    const root = modal.closest<HTMLElement>('#mount');
    if (!root) {
      throw new Error('Mount root missing.');
    }
    const rootRect = root.getBoundingClientRect();
    const modalRect = modal.getBoundingClientRect();
    return {
      modalCenterY: modalRect.top + modalRect.height / 2,
      rootCenterY: rootRect.top + rootRect.height / 2,
    };
  });

  expect(Math.abs(placement.modalCenterY - placement.rootCenterY)).toBeLessThan(12);
});

test('embedded editor runtime registers built-in graph plugin', async ({ page }) => {
  await page.goto('/');

  await page.evaluate(async () => {
    document.body.innerHTML = '<div id="mount"></div>';
    const modulePath = '/src/embed.ts';
    const { deserializeDocumentBytes, mountHvy } = await import(/* @vite-ignore */ modulePath);
    const response = await fetch('/examples/example.hvy');
    const root = document.querySelector<HTMLElement>('#mount');
    if (!root) {
      throw new Error('Mount root missing.');
    }
    mountHvy({
      root,
      document: deserializeDocumentBytes(new Uint8Array(await response.arrayBuffer()), '.hvy'),
      mode: 'editor',
    });
  });

  await expect(page.locator('#mount')).toContainText('Graph Example');
  await expect(page.locator('#mount')).not.toContainText('Plugin "hvy.graph" is not available.');
  await expect(page.locator('#mount .hvy-carousel img').first()).toBeVisible();
  const registered = await page.evaluate(async () => {
    const registryModulePath = '/src/plugins/registry.ts';
    const { getHostPlugin } = await import(/* @vite-ignore */ registryModulePath);
    return {
      graph: getHostPlugin('hvy.graph')?.displayName ?? null,
    };
  });
  expect(registered).toEqual({ graph: 'Graph' });
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
  await expect(page.locator('.ai-view-hint')).toHaveCSS('left', '16px');
  await expect(page.locator('.ai-view-hint')).toHaveCSS('bottom', '16px');
  await expect(page.locator('.ai-view-hint')).toHaveCSS('background-color', 'rgb(255, 244, 199)');
  await page.locator('#aiReaderDocument .reader-block', { hasText: 'Embedded AI target' }).click({ button: 'right' });
  await expect(page.locator('.hvy-context-popover')).toContainText('Request changes');
  await expect(page.locator('.ai-view-hint')).toHaveCount(0);
  await page.locator('.hvy-context-popover button', { hasText: 'Request changes' }).click();

  await expect(page.locator('.ai-edit-popover')).toBeVisible();
  await expect(page.locator('.ai-edit-popover')).toContainText('Request changes');
  await expect(page.locator('.ai-edit-popover [data-field="ai-provider"]')).toHaveCount(0);
  await expect(page.locator('.ai-edit-popover [data-field="ai-model"]')).toHaveCount(0);
});

test('embedded importFromText runs mocked LLM import and reports diagnostics', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<div id="mount"></div>';
    const modulePath = '/src/embed.ts';
    const { deserializeDocumentBytes, mountHvy } = await import(/* @vite-ignore */ modulePath);
    const source = `---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"intro"}-->
 Existing content

<!--hvy:expandable {"id":"bad-expandable"}-->
`;
    const root = document.querySelector<HTMLElement>('#mount');
    if (!root) {
      throw new Error('Mount root missing.');
    }
    const responses = [
      '{"targets":[]}',
      '{"information":"Bad card"}',
      '{"hvy":"<!--hvy: {\\"id\\":\\"imported-after-diagnostic\\"}-->\\n#! Imported\\n\\n <!--hvy:text {\\"id\\":\\"imported-after-diagnostic-text\\"}-->\\n  Imported despite diagnostic"}',
    ];
    const calls: unknown[] = [];
    const progress: string[] = [];
    const mount = mountHvy({
      root,
      document: deserializeDocumentBytes(new TextEncoder().encode(source), '.hvy'),
      mode: 'editor',
    });
    const importResult = await mount.importFromText({
      sourceName: 'bad.txt',
      sourceText: 'Bad card',
      steps: ['Add imported text'],
      llm: {
        settings: { provider: 'openai', model: 'mock-import-model' },
        client: {
          async complete(request) {
            calls.push(request);
            const output = responses.shift();
            if (!output) {
              throw new Error('Unexpected import LLM call.');
            }
            return { output };
          },
        },
      },
      onProgress(event) {
        progress.push(event.phase);
      },
    });
    return {
      result: importResult,
      calls: calls.length,
      progress,
      html: root.textContent,
    };
  });

  expect(result.calls).toBe(3);
  expect(result.progress).toContain('linting');
  expect(result.result.status).toBe('error');
  expect(result.result.message).toContain('expandable block is missing');
  expect(result.html).toContain('Existing content');
  expect(result.html).toContain('Imported despite diagnostic');
});

test('embedded importFromText awaits document update hooks before diagnostics and render', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<div id="mount"></div>';
    const modulePath = '/src/embed.ts';
    const { deserializeDocumentBytes, mountHvy, serializeDocument } = await import(/* @vite-ignore */ modulePath);
    const source = `---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"intro"}-->
 Existing content
`;
    const root = document.querySelector<HTMLElement>('#mount');
    if (!root) {
      throw new Error('Mount root missing.');
    }
    const hookReasons: string[] = [];
    const progressSnapshots: string[] = [];
    const responses = [
      '{"targets":[]}',
      '{"information":"Imported summary"}',
      '{"hvy":"<!--hvy: {\\"id\\":\\"imported-summary\\"}-->\\n#! Imported Summary\\n\\n <!--hvy:text {\\"id\\":\\"imported-summary-text\\"}-->\\n  Imported summary"}',
    ];
    const mount = mountHvy({
      root,
      document: deserializeDocumentBytes(new TextEncoder().encode(source), '.hvy'),
      mode: 'editor',
      plugins: [{
        id: 'test.import-hook',
        displayName: 'Import Hook',
        create() {
          return { element: document.createElement('div') };
        },
        hooks: {
          documentChange: {
            async run(ctx) {
              hookReasons.push(ctx.changeReason);
              await new Promise((resolve) => setTimeout(resolve, 0));
              const imported = ctx.document.sections.find((section) => section.customId === 'imported-summary');
              if (imported) {
                imported.title = 'Hook Updated Import';
              }
            },
          },
        },
      }],
    });
    const importResult = await mount.importFromText({
      sourceName: 'summary.txt',
      sourceText: 'Imported summary',
      steps: [{ section: 'Summary', sectionId: 'summary' }],
      llm: {
        settings: { provider: 'openai', model: 'mock-import-model' },
        client: {
          async complete() {
            const output = responses.shift();
            if (!output) {
              throw new Error('Unexpected import LLM call.');
            }
            return { output };
          },
        },
      },
      onProgress(event) {
        progressSnapshots.push(`${event.phase}:${root.textContent?.includes('Hook Updated Import') ? 'rendered' : 'pending'}`);
      },
    });
    return {
      importResult,
      hookReasons,
      progressSnapshots,
      html: root.textContent,
      serialized: serializeDocument(mount.getDocument()),
    };
  });

  expect(result.importResult.status).toBe('complete');
  expect(result.hookReasons).toEqual(['ai-edit']);
  expect(result.progressSnapshots).toContain('linting:rendered');
  expect(result.html).toContain('Hook Updated Import');
  expect(result.serialized).toContain('#! Hook Updated Import');
});

test('embedded importFromText can force template JSON mode with mocked client', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<div id="mount"></div>';
    const modulePath = '/src/embed.ts';
    const { deserializeDocumentBytes, mountHvy, serializeDocument } = await import(/* @vite-ignore */ modulePath);
    const source = `---
hvy_version: 0.1
section_defs:
  - name: Award Section
    templateVariables:
      section_title:
        label: Section title
    template:
      title: "{% section_title %}"
      blocks:
        - text: "# {% section_title %}"
          schema:
            component: text
        - text: ""
          schema:
            id: awards-list
            component: component-list
            componentListComponent: award-record
            componentListItemLabel: award
component_defs:
  - name: award-record
    baseType: expandable
    templateVariables:
      award:
        label: Award
      details:
        label: Details
    schema:
      component: award-record
      expandableStubBlocks:
        children:
          - text: "### {% award %}"
            schema:
              component: text
      expandableContentBlocks:
        children:
          - text: "{% details | block %}"
            schema:
              component: text
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {}-->
 Existing summary
`;
    const root = document.querySelector<HTMLElement>('#mount');
    if (!root) {
      throw new Error('Mount root missing.');
    }
    const responses = [
      '{"steps":[{"section":"Awards","templateName":"Award Section"}]}',
      '{"targets":[]}',
      '{"values":{"section_title":"Awards","awards_list":[{"award":"Best Tool","details":"Won for developer tooling."}]}}',
    ];
    const calls: unknown[] = [];
    const mount = mountHvy({
      root,
      document: deserializeDocumentBytes(new TextEncoder().encode(source), '.hvy'),
      mode: 'editor',
    });
    const llm = {
      settings: { provider: 'openai' as const, model: 'mock-import-model' },
      client: {
        async complete(request: unknown) {
          calls.push(request);
          const output = responses.shift();
          if (!output) {
            throw new Error('Unexpected import LLM call.');
          }
          return { output };
        },
      },
    };
    const plan = await mount.buildImportPlan({
      sourceName: 'resume.txt',
      sourceText: 'Awards\\nBest Tool',
      llm,
    });
    if (plan.status !== 'ready' || !plan.steps?.[0]?.templateStructure) {
      throw new Error('Expected forced-template descriptor.');
    }
    const importResult = await mount.importFromText({
      sourceName: 'resume.txt',
      sourceText: 'Awards\\nBest Tool',
      steps: [{ ...plan.steps[0], importMode: 'template', templateStructureId: plan.steps[0].templateStructure.id }],
      llm,
    });
    return {
      plan,
      importResult,
      calls: calls.length,
      serialized: serializeDocument(mount.getDocument()),
      text: root.textContent,
    };
  });

  expect(result.plan.steps?.[0]?.templateStructure?.id).toBe('definition:award-section');
  expect(result.importResult.status).toBe('complete');
  expect(result.calls).toBe(3);
  expect(result.serialized).toContain('# Awards');
  expect(result.serialized).toContain('Best Tool');
  expect(result.serialized).toContain('Won for developer tooling.');
  expect(result.text).toContain('Best Tool');
});

test('new section component picker opens on the first click', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="add-top-level-section"]').click();
  const newSection = page.locator('.editor-section-card').last();
  await expect(newSection.locator('[data-field="section-title"]')).toBeFocused();

  await newSection.locator('.component-picker-trigger').click();
  await expect(newSection.locator('.component-picker')).toHaveAttribute('data-open', 'true');
});

test('AI mode shows add section ghost and opens the new section inline', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="switch-view"][data-view="ai"]').click();
  await expect(page.locator('#aiReaderDocument [data-action="add-top-level-section"][data-section-key="__top_level__"]')).toBeVisible();

  await page.locator('#aiReaderDocument [data-action="add-top-level-section"][data-section-key="__top_level__"]').click();

  const activeEditor = page.locator('#aiReaderDocument .editor-block[data-active-editor-block="true"]');
  await expect(activeEditor).toBeVisible();
  await activeEditor.locator('.rich-editor').fill('AI-added section body');
  await expect(page.locator('#aiReaderDocument')).toContainText('AI-added section body');

  const newSection = page.locator('#aiReaderDocument .reader-section', { hasText: 'AI-added section body' }).last();
  await expect(newSection.locator('.compact-add-component-ghost .component-picker-trigger')).toBeVisible();
  await newSection.locator('.compact-add-component-ghost .component-picker-trigger').click();
  await expect(newSection.locator('.component-picker')).toHaveAttribute('data-open', 'true');
  await newSection.locator('.component-picker-row-direct[data-component="text"]').click();

  const secondEditor = newSection.locator('.editor-block[data-active-editor-block="true"]');
  await expect(secondEditor).toBeVisible();
  await secondEditor.locator('.rich-editor').fill('Second AI section component');
  await expect(newSection).toContainText('Second AI section component');
});

test('AI mode opens added section templates with nested components editable', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
section_defs:
  - name: Tabular Section
    repeatable: true
    template:
      title: Tabular Section
      blocks:
        - text: "# Tabular Section"
          schema:
            component: text
        - text: ""
          schema:
            component: table
            tableColumns: ["YEAR", "ORGANIZATION", "TITLE"]
            tableRows:
              - cells: ["", "", ""]
      children: []
---

#! Existing
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.locator('[data-action="switch-view"][data-view="ai"]').click();

  await page.locator('#aiReaderDocument [data-field="reusable-section-type"][data-section-key="__top_level__"]').selectOption('section-def:Tabular Section');
  await page.locator('#aiReaderDocument [data-action="add-top-level-section"][data-section-key="__top_level__"]').click();

  const newSection = page.locator('#aiReaderDocument .reader-section', { hasText: 'Tabular Section' }).last();
  await expect(newSection.locator('.rich-editor[data-field="block-rich"]')).toBeVisible();
  await expect(newSection.locator('[data-field="table-column"]').first()).toBeVisible();
  await newSection.locator('[data-field="table-column"]').first().fill('DATES');
  await expect(newSection.locator('[data-field="table-column"]').first()).toHaveText('DATES');
});

test('section virtualization unloads and reloads offscreen editor sections', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

${Array.from({ length: 42 }, (_item, index) => `<!--hvy: {"id":"virtual-${index + 1}"}-->
#! Virtual ${index + 1}

 ${Array.from({ length: 8 }, (_line, lineIndex) => `Virtual ${index + 1}.${lineIndex + 1}`).join('\n ')}
`).join('\n')}
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  const editorTree = page.locator('#editorTree');
  await editorTree.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect.poll(() => page.locator('#editorTree [data-hvy-virtual-placeholder="true"]').count()).toBeGreaterThan(0);
  await expect(page.locator('#editorTree [data-hvy-virtual-placeholder="true"]').first()).not.toHaveAttribute('data-cached-section-html', /./);

  await editorTree.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(page.locator('#editorTree .editor-section-card').filter({ has: page.getByRole('button', { name: 'Virtual 1', exact: true }) })).toBeVisible();
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

  await selectDocumentMenuItem(page, 'Resume Template');
  await page.getByRole('button', { name: 'Viewer' }).click();
  await expect(page.locator('#header')).toHaveCount(0);
  await expect(page.locator('#summary')).toHaveCount(0);
  await expect(page.locator('#history')).toHaveCount(0);
  await expect(page.locator('#projects')).toHaveCount(0);
  await expect(page.locator('#awards')).toHaveCount(0);
  await expect(page.locator('#education')).toHaveCount(0);

  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();
  await expect(page.locator('#editorTree')).toContainText('Info');
  await expect(page.locator('#editorTree')).toContainText('Summary');
  await expect(page.locator('#editorTree')).toContainText('History');
  await expect(page.locator('.section-title-passive', { hasText: 'Projects' })).toHaveCount(0);
  await expect(page.locator('.section-title-passive', { hasText: 'Awards' })).toHaveCount(0);
  await expect(page.locator('#editorTree')).toContainText('Education');
});

test('first styled heading in resume grid cell aligns to the top', async ({ page }) => {
  await page.goto('/');

  await selectDocumentMenuItem(page, 'Resume Example');
  await page.getByRole('button', { name: 'Viewer' }).click();

  const certification = page.locator('#certifications .reader-block-expandable').first();
  await certification.click();

  const heading = page.locator('#certifications h3', { hasText: 'AWS Certified Developer - Associate' });
  await expect(heading).toBeVisible();

  const margins = await heading.evaluate((node) => {
    const wrapper = node.closest<HTMLElement>('.hvy-text-line-style');
    return {
      headingMarginTop: getComputedStyle(node).marginTop,
      wrapperMarginTop: wrapper ? getComputedStyle(wrapper).marginTop : '',
    };
  });
  expect(margins).toEqual({ headingMarginTop: '0px', wrapperMarginTop: '0px' });
});

test('h3 headings after body copy have subsection spacing', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

 <!--hvy:text {}-->
  ### Templating and Fill-ins

  You can set up template components and sections with the "Make Template" button.

  ### Meta Information
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Viewer' }).click();

  const margins = await page.locator('#readerDocument h3').evaluateAll((headings) => headings.map((heading) => getComputedStyle(heading).marginTop));
  expect(margins).toEqual(['0px', '15.2px']);

  const weights = await page.locator('#readerDocument h3').evaluateAll((headings) => headings.map((heading) => getComputedStyle(heading).fontWeight));
  expect(weights).toEqual(['700', '700']);
});

test('reader headings keep bold default weight', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

 <!--hvy:text {}-->
  # Heading One
  ## Heading Two
  ### Heading Three
  #### Heading Four
  ##### Heading Five
  ###### Heading Six
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Viewer' }).click();

  const weights = await page
    .locator('#readerDocument :is(h1, h2, h3, h4, h5, h6)')
    .evaluateAll((headings) => headings.map((heading) => getComputedStyle(heading).fontWeight));
  expect(weights).toEqual(['700', '700', '700', '700', '700', '700']);
});

test('grid cells stretch container cards and pin trailing xref cards', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"cards"}-->
#! Cards

 <!--hvy:grid {"id":"mode-grid","gridColumns":3}-->

  <!--hvy:grid:0 {"id":"viewer-cell"}-->

   <!--hvy:container {"id":"viewer-card","containerTitle":"Viewer","css":"padding: 0.85rem; border: 1px solid var(--hvy-border); border-radius: 0.5rem; height: 100%;"}-->

    <!--hvy:text {}-->
     ## Viewer
     Shows the document without editing features.

    <!--hvy:xref-card {"xrefTitle":"Viewer Mode","xrefTarget":"viewer-mode"}-->

  <!--hvy:grid:1 {"id":"ai-cell"}-->

   <!--hvy:container {"id":"ai-card","containerTitle":"AI","css":"padding: 0.85rem; border: 1px solid var(--hvy-border); border-radius: 0.5rem; height: 100%;"}-->

    <!--hvy:text {}-->
     ## AI Assisted
     Double click, tap, or ask for changes in chat. This card has enough copy to force the row taller than the neighboring cards.

    <!--hvy:xref-card {"xrefTitle":"AI Mode","xrefTarget":"ai-mode"}-->

  <!--hvy:grid:2 {"id":"editor-cell"}-->

   <!--hvy:container {"id":"editor-card","css":"padding: 0.85rem; border: 1px solid var(--hvy-border); border-radius: 0.5rem; height: 100%;"}-->

    <!--hvy:text {}-->
     ## Editor
     For direct editing.

    <!--hvy:xref-card {"xrefTitle":"Editor Mode","xrefTarget":"editor-mode"}-->

<!--hvy: {"id":"viewer-mode"}-->
#! Viewer Mode

<!--hvy: {"id":"ai-mode"}-->
#! AI Mode

<!--hvy: {"id":"editor-mode"}-->
#! Editor Mode
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Viewer' }).click();

  const metrics = await page.locator('#cards .reader-grid-layout').evaluate((grid) => {
    const cells = Array.from(grid.querySelectorAll<HTMLElement>('.reader-grid-cell'));
    const cards = Array.from(grid.querySelectorAll<HTMLElement>('.reader-block-container'));
    const containers = Array.from(grid.querySelectorAll<HTMLElement>('.reader-container'));
    const bodies = Array.from(grid.querySelectorAll<HTMLElement>('.reader-container-body'));
    const xrefs = Array.from(grid.querySelectorAll<HTMLElement>('.reader-container-body > .reader-block-xref-card:last-child'));
    return {
      gridAlignItems: getComputedStyle(grid).alignItems,
      cellDisplays: cells.map((cell) => getComputedStyle(cell).display),
      cellHeights: cells.map((cell) => cell.getBoundingClientRect().height),
      cardHeights: cards.map((card) => card.getBoundingClientRect().height),
      bodyHeightGaps: bodies.map((body, index) => containers[index]!.getBoundingClientRect().height - body.getBoundingClientRect().height),
      xrefBottomGaps: xrefs.map((xref) => {
        const body = xref.closest<HTMLElement>('.reader-container-body');
        if (!body) return -1;
        return body.getBoundingClientRect().bottom - xref.getBoundingClientRect().bottom - parseFloat(getComputedStyle(xref).marginBottom || '0');
      }),
    };
  });

  expect(metrics.gridAlignItems).toBe('stretch');
  expect(metrics.cellDisplays).toEqual(['grid', 'grid', 'grid']);
  expect(Math.max(...metrics.cellHeights) - Math.min(...metrics.cellHeights)).toBeLessThanOrEqual(1);
  expect(Math.max(...metrics.cardHeights) - Math.min(...metrics.cardHeights)).toBeLessThanOrEqual(1);
  expect(metrics.bodyHeightGaps.every((gap) => gap >= 0 && gap <= 1)).toBe(true);
  expect(metrics.xrefBottomGaps.every((gap) => gap >= 0 && gap <= 1)).toBe(true);
});

test('resume section templates hide already used non-repeatable sections', async ({ page }) => {
  await page.goto('/');

  await selectDocumentMenuItem(page, 'Resume Template');
  let options = await page.locator('[data-field="reusable-section-type"][data-section-key="__top_level__"] option').evaluateAll((items) =>
    items.map((item) => item.textContent?.trim())
  );
  expect(options).toEqual(['Blank', 'Projects', 'Publications', 'Awards', 'Certifications', 'Resume Section']);

  await selectDocumentMenuItem(page, 'Resume Example');
  options = await page.locator('[data-field="reusable-section-type"][data-section-key="__top_level__"] option').evaluateAll((items) =>
    items.map((item) => item.textContent?.trim())
  );
  expect(options).toEqual(['Blank', 'Awards', 'Resume Section']);
});

test('adding a section template with multiple flavors asks which flavor to use', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
section_defs:
  - name: Feature
    repeatable: true
    template:
      title: Feature
      blocks:
        - text: "# Feature Base"
          schema:
            component: text
      children: []
    flavors:
      - name: Cards
        description: Use when the section has several independent cards.
        template:
          title: Feature
          blocks:
            - text: "# Feature Cards"
              schema:
                component: text
          children: []
      - name: Linear
        description: Use when the section is short and sequential.
        template:
          title: Feature
          blocks:
            - text: "# Feature Linear"
              schema:
                component: text
          children: []
---

#! Existing
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('[data-field="reusable-section-type"][data-section-key="__top_level__"]').selectOption('section-def:Feature');
  await page.locator('[data-action="add-top-level-section"][data-section-key="__top_level__"]').click();

  await expect(page.getByRole('heading', { name: 'Choose Feature Flavor' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Cards/ })).toContainText('Use when the section has several independent cards.');
  await page.getByRole('button', { name: /Linear/ }).click();

  await expect(page.locator('.editor-section-card', { hasText: 'Feature Linear' })).toBeVisible();
  await expect(page.locator('.editor-section-card', { hasText: 'Feature Cards' })).toHaveCount(0);
});

test('resume editor script does not scan changed reciprocal xrefs on load', async ({ page }) => {
  await page.goto('/');

  await selectDocumentMenuItem(page, 'Resume Example');
  await page.getByRole('button', { name: 'Raw' }).click();

  const rawEditor = page.locator('#rawEditor');
  await expect(rawEditor).toContainText('reciprocal-xrefs: targets", len(targets)');
  await expect(rawEditor).not.toContainText('skill-software-engineering-from-history-northwind-labs-senior-software-engineer');
  await expect(rawEditor).not.toContainText('tool-python-from-education-bs-computer-science');
  await expect(rawEditor).not.toContainText('skill-software-engineering-from-top-skills-list');
});

test('resume template empty skill and tool sections show add controls directly in AI view', async ({ page }) => {
  await page.goto('/');

  await selectDocumentMenuItem(page, 'Resume Template');
  await page.locator('[data-action="switch-view"][data-view="ai"]').click();
  await page.locator('.viewer-sidebar-tab').click();

  const skills = page.locator('#aiSidebarSections #skills');
  await expect(skills).toBeVisible();
  await expect(skills).not.toHaveClass(/is-collapsed-preview/);
  await skills.locator('.passive-empty-list-ghost', { hasText: 'Add Skill' }).evaluate((element: HTMLElement) => element.click());
  let modal = page.locator('.reusable-template-modal');
  await expect(modal).toBeVisible();
  await expect(modal.locator('label', { hasText: 'Skill' })).toBeVisible();
  await expect(modal).not.toContainText('Skill / Tool');
  const skillGenerator = modal.locator('[data-template-generator="hvy.resume.skill-description"]');
  await expect(skillGenerator).toBeDisabled();
  await modal.locator('input[data-template-variable="skill"]').fill('Systems Design');
  await expect(skillGenerator).toBeEnabled();
  await modal.locator('[data-modal-action="close"]').first().click();

  const tools = page.locator('#aiSidebarSections #tools-technologies');
  await expect(tools).toBeVisible();
  await expect(tools).not.toHaveClass(/is-collapsed-preview/);
  await tools.locator('.passive-empty-list-ghost', { hasText: 'Add Tool / Technology' }).evaluate((element: HTMLElement) => element.click());
  modal = page.locator('.reusable-template-modal');
  await expect(modal).toBeVisible();
  await expect(modal.locator('label', { hasText: 'Tool / Technology' })).toBeVisible();
  const toolGenerator = modal.locator('[data-template-generator="hvy.resume.tool-description"]');
  await expect(toolGenerator).toBeDisabled();
  await modal.locator('input[data-template-variable="tool_technology"]').fill('TypeScript');
  await expect(toolGenerator).toBeEnabled();
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

  await selectDocumentMenuItem(page, 'Resume Template');
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

test('document ai import guidance is editable metadata and keeps focus while typing', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Advanced' }).click();
  await page.getByRole('button', { name: 'Document Meta' }).click();

  const importGuidance = page.locator('[data-field="meta-ai-import-guidance"]');
  await importGuidance.fill('');
  await importGuidance.type('Route scattered awards into the Awards template.');

  await expect(importGuidance).toBeFocused();
  await expect(importGuidance).toHaveValue('Route scattered awards into the Awards template.');

  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).toContainText('ai-import-guidance: Route scattered awards into the Awards template.');
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

test('custom component template output generator fills a field from provided variables', async ({ page }) => {
  let prompt = '';
  await page.route('**/api/chat', async (route) => {
    const payload = route.request().postDataJSON() as { messages?: Array<{ content?: string }>; context?: string };
    prompt = payload.context ?? '';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ output: 'Generated TypeScript description' }),
    });
  });

  await page.goto('/');
  await page.evaluate(async () => {
    const registryPath = '/src/plugins/registry.ts';
    const { setHostPlugins } = await import(/* @vite-ignore */ registryPath);
    setHostPlugins([{
      id: 'hvy.resume',
      displayName: 'Resume',
      outputGenerators: [{
        key: 'hvy.resume.skill-description',
        label: 'Generate',
        requiredVariables: ['skill'],
        generate: (request: { values: Record<string, string> }) => {
          (window as unknown as { __generatorValues: Record<string, string> }).__generatorValues = request.values;
          return {
            prompt: `Write one sentence for ${request.values.skill}.`,
            answer: 'Fallback skill description',
          };
        },
      }],
    }]);
  });

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
component_defs:
  - name: skill-record
    baseType: container
    templateVariables:
      skill:
        label: Skill
      description:
        label: Description
        generator: hvy.resume.skill-description
        generatorLabel: Suggest
    schema:
      containerBlocks:
        - text: "{% skill %}"
          schema:
            component: text
            placeholder: Skill
        - text: "{% description | block %}"
          schema:
            component: text
            placeholder: Description
---

<!--hvy: {"id":"skills"}-->
#! Skills

<!--hvy:component-list {"id":"skill-list","componentListComponent":"skill-record","componentListItemLabel":"skill"}-->
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.ghost-label', { hasText: 'Add Skill' }).click();
  const modal = page.locator('.reusable-template-modal');
  const skillInput = modal.locator('input[data-template-variable="skill"]');
  const descriptionInput = modal.locator('textarea[data-template-variable="description"]');
  const generatorButton = modal.locator('[data-modal-action="run-template-generator"]');

  await expect(generatorButton).toBeDisabled();
  await skillInput.fill('TypeScript');
  await expect(generatorButton).toBeEnabled();
  await generatorButton.click();

  await expect(descriptionInput).toHaveValue('Generated TypeScript description');
  await expect(generatorButton).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as { __generatorValues: Record<string, string> }).__generatorValues)).toEqual({ skill: 'TypeScript' });
  expect(prompt).toBe('Write one sentence for TypeScript.');
  await modal.locator('[data-modal-action="insert-reusable-template"]').click();

  await expect(page.locator('#editorTree')).toContainText('TypeScript');
  await expect(page.locator('#editorTree')).toContainText('Generated TypeScript description');
});

test('custom component template output generator locks field while pending and hides for existing values', async ({ page }) => {
  let releaseGeneration: (() => void) | null = null;
  await page.route('**/api/chat', async (route) => {
    await new Promise<void>((resolve) => {
      releaseGeneration = resolve;
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ output: 'Generated TypeScript description' }),
    });
  });

  await page.goto('/');
  await page.evaluate(async () => {
    const registryPath = '/src/plugins/registry.ts';
    const { setHostPlugins } = await import(/* @vite-ignore */ registryPath);
    setHostPlugins([{
      id: 'hvy.resume',
      displayName: 'Resume',
      outputGenerators: [{
        key: 'hvy.resume.skill-description',
        requiredVariables: ['skill'],
        generate: (request: { values: Record<string, string> }) => ({ prompt: `Write one sentence for ${request.values.skill}.` }),
      }],
    }]);
  });

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
component_defs:
  - name: skill-record
    baseType: container
    templateVariables:
      skill:
        label: Skill
      description:
        label: Description
        generator: hvy.resume.skill-description
    schema:
      containerBlocks:
        - text: "{% skill %}"
          schema:
            component: text
        - text: "{% description | block %}"
          schema:
            component: text
---

<!--hvy: {"id":"skills"}-->
#! Skills

<!--hvy:component-list {"id":"skill-list","componentListComponent":"skill-record","componentListItemLabel":"skill"}-->
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.ghost-label', { hasText: 'Add Skill' }).click();
  const modal = page.locator('.reusable-template-modal');
  const descriptionInput = modal.locator('textarea[data-template-variable="description"]');
  const generatorButton = modal.locator('[data-modal-action="run-template-generator"]');

  await modal.locator('input[data-template-variable="skill"]').fill('TypeScript');
  await expect(generatorButton).toBeVisible();
  await descriptionInput.fill('Manual description');
  await expect(generatorButton).toBeHidden();
  await descriptionInput.fill('');
  await expect(generatorButton).toBeVisible();

  await generatorButton.click();
  await expect(descriptionInput).toBeDisabled();
  releaseGeneration?.();
  await expect(descriptionInput).toHaveValue('Generated TypeScript description');
  await expect(descriptionInput).toBeEnabled();
  await expect(generatorButton).toBeHidden();
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

test('text component fenced code wraps long directive lines instead of overflowing', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"code-sample"}-->
#! Code Sample

<!--hvy:text {"id":"long-code-example"}-->
\`\`\`hvy
<!--hvy:component-list {"id":"items","componentListComponent":"widget-record","componentListDefaultSortKey":"Name","componentListDefaultSortDirection":"asc","componentListDefaultGroupKey":"Category"}-->
 <!--hvy:component-list:0 {}-->
\`\`\`
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Viewer' }).click();

  await page.setViewportSize({ width: 390, height: 760 });
  const pre = page.locator('.reader-code-block pre').first();
  const code = page.locator('.reader-code-block code').first();
  await expect(code).toBeVisible();
  await expect.poll(async () => pre.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await expect.poll(async () => code.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
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
