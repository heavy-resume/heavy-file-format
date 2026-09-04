import { expect, test, type Locator } from '@playwright/test';

async function inspectNativePdf(frame: Locator): Promise<{ header: string; pageCount: number; digest: string }> {
  return frame.evaluate(async (element: HTMLIFrameElement) => {
    const bytes = new Uint8Array(await (await fetch(element.src)).arrayBuffer());
    const binary = new TextDecoder('latin1').decode(bytes);
    const digestBytes = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return {
      header: binary.slice(0, 5),
      pageCount: binary.match(/\/Type\s*\/Page\b/g)?.length ?? 0,
      digest: [...digestBytes].map((value) => value.toString(16).padStart(2, '0')).join(''),
    };
  });
}

test('before, viewer entry, resize: PHVY preview embeds the exact native PDF artifact', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Editor', exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const [{ deserializeDocument }, { state, getRenderApp }] = await Promise.all([
      import('/src/serialization.ts'),
      import('/src/state.ts'),
    ]);
    const paragraphs = Array.from({ length: 95 }, (_value, index) =>
      index === 0
        ? 'Paragraph 1: deterministic pagination text with an [authoritative link](https://example.com) for the exact PHVY preview reproduction.'
        : `Paragraph ${index + 1}: deterministic pagination text for the exact PHVY preview reproduction.`
    ).join('\n\n');
    state.document = deserializeDocument(`---
hvy_version: 0.1
title: PDF Preview Reproduction
pdf_page:
  size: LETTER
  margins: [0.75in, 0.75in, 0.75in, 0.75in]
---

<!--hvy: {"id":"preview-reproduction","contained":false}-->
#! Preview Reproduction

 <!--hvy:text {"id":"pagination-copy","css":"font-size: 10pt; line-height: 1.25; margin: 0;"}-->
  ${paragraphs.replace(/\n/g, '\n  ')}
`, '.phvy');
    state.filename = 'pdf-preview-reproduction.phvy';
    state.currentView = 'viewer';
    getRenderApp()();
  });

  const preview = page.locator('[data-hvy-pdf-preview="true"]');
  await expect(preview).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open search' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open chat' })).toHaveCount(0);
  await expect(preview.locator('.phvy-page-guide-layer')).toHaveCount(0);
  await expect(preview.locator('.hvy-pdf-page-overlay')).toHaveCount(0);
  const nativeFrame = preview.locator('iframe[title="PDF preview"]');
  await expect(nativeFrame).toHaveAttribute('src', /^blob:/, { timeout: 3_000 });
  const readerLayout = await page.locator('#readerDocument').evaluate((element) => {
    const style = getComputedStyle(element);
    const frame = element.querySelector<HTMLIFrameElement>('iframe[title="PDF preview"]');
    return {
      padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
      readerHeight: element.getBoundingClientRect().height,
      frameHeight: frame?.getBoundingClientRect().height ?? 0,
    };
  });
  expect(readerLayout.padding).toEqual(['0px', '0px', '0px', '0px']);
  expect(readerLayout.frameHeight).toBeCloseTo(readerLayout.readerHeight, 1);
  const fullWidth = (await nativeFrame.boundingBox())!.width;
  const artifact = await inspectNativePdf(nativeFrame);
  expect(artifact.header).toBe('%PDF-');
  expect(artifact.pageCount).toBeGreaterThan(1);

  await page.getByRole('button', { name: 'Phone 390' }).click();
  await expect(nativeFrame).toHaveAttribute('src', /^blob:/, { timeout: 3_000 });
  expect((await nativeFrame.boundingBox())!.width).toBeLessThan(fullWidth);
  expect((await inspectNativePdf(nativeFrame)).digest).toBe(artifact.digest);
  for (const mode of ['Tablet 768', 'Desktop', 'Full']) {
    await page.getByRole('button', { name: mode, exact: true }).click();
    await expect(nativeFrame).toHaveAttribute('src', /^blob:/, { timeout: 3_000 });
    expect((await inspectNativePdf(nativeFrame)).digest).toBe(artifact.digest);
  }
});

test('an open Viewer marks changed PHVY content stale and regenerates on re-entry', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Editor', exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const [{ deserializeDocument }, { state, getRenderApp }] = await Promise.all([
      import('/src/serialization.ts'),
      import('/src/state.ts'),
    ]);
    state.document = deserializeDocument(`---
hvy_version: 0.1
pdf_page:
  size: LETTER
---

<!--hvy: {"id":"stale-preview","contained":false}-->
#! Stale Preview

 <!--hvy:text {"id":"stale-copy"}-->
  Before document change.
`, '.phvy');
    state.currentView = 'viewer';
    getRenderApp()();
  });
  const preview = page.locator('[data-hvy-pdf-preview="true"]');
  const nativeFrame = preview.locator('iframe[title="PDF preview"]');
  await expect(nativeFrame).toHaveAttribute('src', /^blob:/, { timeout: 3_000 });
  const before = await inspectNativePdf(nativeFrame);

  await page.evaluate(async () => {
    const { state, getRenderApp } = await import('/src/state.ts');
    state.document.sections[0]!.blocks[0]!.text = 'After document change.';
    getRenderApp()();
  });
  await expect(preview.locator('[data-hvy-pdf-preview-stale="true"]')).toBeVisible();
  expect((await inspectNativePdf(nativeFrame)).digest).toBe(before.digest);

  await page.getByRole('button', { name: 'Editor', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open search' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open chat' })).toBeVisible();
  await page.getByRole('button', { name: 'Viewer', exact: true }).click();
  await expect(nativeFrame).toHaveAttribute('src', /^blob:/, { timeout: 3_000 });
  expect((await inspectNativePdf(nativeFrame)).digest).not.toBe(before.digest);
  await expect(preview.locator('[data-hvy-pdf-preview-stale="true"]')).toHaveCount(0);
});

test('leaving Viewer during generation cannot install a stale PDF preview', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Editor', exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const [{ deserializeDocument }, { state, getRenderApp }] = await Promise.all([
      import('/src/serialization.ts'),
      import('/src/state.ts'),
    ]);
    state.document = deserializeDocument(`---
hvy_version: 0.1
pdf_page:
  size: A4
---

<!--hvy: {"id":"generation-switch","contained":false}-->
#! Generation Switch

 <!--hvy:text {"id":"generation-copy"}-->
  This PDF must only appear in Viewer.
`, '.phvy');
    state.currentView = 'viewer';
    getRenderApp()();
    state.currentView = 'editor';
    getRenderApp()();
  });

  await page.waitForTimeout(500);
  await expect(page.locator('[data-hvy-pdf-preview="true"]')).toHaveCount(0);
  await expect(page.locator('#editorTree')).toBeVisible();
  await page.getByRole('button', { name: 'Viewer', exact: true }).click();
  await expect(page.locator('iframe[title="PDF preview"]')).toHaveCount(1, { timeout: 3_000 });
});

test('lightweight and full embeds install the PDF preview in their own mount runtime', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Editor', exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const [{ deserializeDocument }, { mountHvyViewer }] = await Promise.all([
      import('/src/serialization.ts'),
      import('/src/embed.ts'),
    ]);
    document.body.innerHTML = '<div id="lightweight" style="height: 360px"></div><div id="full" style="height: 360px"></div>';
    const source = `---
hvy_version: 0.1
title: Embedded PDF Preview
pdf_page:
  size: A4
---

<!--hvy: {"id":"embed-preview","contained":false}-->
#! Embedded Preview

 <!--hvy:text {"id":"embed-copy"}-->
  Exact embedded PDF page.
`;
    const mount = mountHvyViewer({
      root: document.querySelector<HTMLElement>('#lightweight')!,
      document: deserializeDocument(source, '.phvy'),
    });
    (window as typeof window & { previewMount?: typeof mount; previewSource?: string }).previewMount = mount;
    (window as typeof window & { previewSource?: string }).previewSource = source;
  });

  const lightweight = page.locator('#lightweight');
  await expect(lightweight.locator('iframe[title="PDF preview"]')).toHaveCount(1, { timeout: 3_000 });
  expect(await page.evaluate(async () => {
    const mount = (window as typeof window & { previewMount: { getPdfBlob(): Promise<Blob> } }).previewMount;
    return await mount.getPdfBlob() === await mount.getPdfBlob();
  })).toBe(true);
  await page.evaluate(async () => {
    const [{ deserializeDocument }, { mountHvy }] = await Promise.all([
      import('/src/serialization.ts'),
      import('/src/embed-full.ts'),
    ]);
    const source = (window as typeof window & { previewSource: string }).previewSource;
    (window as typeof window & { fullMount?: ReturnType<typeof mountHvy> }).fullMount = mountHvy({
      root: document.querySelector<HTMLElement>('#full')!,
      document: deserializeDocument(source, '.phvy'),
      mode: 'viewer',
    });
  });
  await expect(page.locator('#full iframe[title="PDF preview"]')).toHaveCount(1, { timeout: 3_000 });
  await expect(page.locator('#full').getByRole('button', { name: 'Open search' })).toHaveCount(0);
  await expect(page.locator('#full').getByRole('button', { name: 'Open chat' })).toHaveCount(0);
  for (const selector of ['#lightweight', '#full']) {
    const bounds = await page.locator(`${selector} #readerDocument`).evaluate((element) => {
      const frame = element.querySelector<HTMLIFrameElement>('iframe[title="PDF preview"]');
      return {
        paddingBottom: getComputedStyle(element).paddingBottom,
        readerBottom: element.getBoundingClientRect().bottom,
        frameBottom: frame?.getBoundingClientRect().bottom ?? 0,
      };
    });
    expect(bounds.paddingBottom).toBe('0px');
    expect(bounds.frameBottom).toBeCloseTo(bounds.readerBottom, 1);
  }
  const lightweightPreviewUrl = (await lightweight.locator('iframe[title="PDF preview"]').getAttribute('src'))!.split('#')[0]!;
  await page.evaluate(() => {
    const mounts = window as typeof window & {
      previewMount: { destroy(): void };
      fullMount: { destroy(): void };
    };
    mounts.previewMount.destroy();
    mounts.fullMount.destroy();
  });
  expect(await page.evaluate(async (url) => {
    try {
      return (await fetch(url)).ok;
    } catch {
      return false;
    }
  }, lightweightPreviewUrl)).toBe(false);
});
