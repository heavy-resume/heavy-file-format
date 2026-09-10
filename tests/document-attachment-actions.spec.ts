import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('before, open PDF attachment, expected result: browser receives a typed blob preview', async ({ page }) => {
  await mountAttachmentViewer(page, {
    filename: 'guide.pdf',
    mediaType: 'application/pdf',
    bytes: [37, 80, 68, 70, 45, 49, 46, 52],
  });

  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Open guide' }).click();
  const popup = await popupPromise;

  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { attachmentPreviewBlobTypes?: string[] }
  ).attachmentPreviewBlobTypes)).toContain('application/pdf');
  await popup.close();
});

test('before, open unknown attachment, expected result: browser downloads the safe leaf filename', async ({ page }) => {
  await mountAttachmentViewer(page, {
    filename: 'folder/guide.zip',
    mediaType: 'application/zip',
    bytes: [80, 75, 3, 4],
  });

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Open guide' }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe('guide.zip');
});

async function mountAttachmentViewer(
  page: import('@playwright/test').Page,
  attachment: { filename: string; mediaType: string; bytes: number[] },
): Promise<void> {
  await page.evaluate(async (value) => {
    document.body.innerHTML = '<div id="attachmentViewer"></div>';
    const testWindow = window as typeof window & { attachmentPreviewBlobTypes?: string[] };
    testWindow.attachmentPreviewBlobTypes = [];
    const createObjectUrl = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      testWindow.attachmentPreviewBlobTypes?.push(blob.type);
      return createObjectUrl(blob);
    };
    const [{ deserializeDocumentBytes, mountHvyViewer }, { storeUserFileAttachment }] = await Promise.all([
      import('/src/embed.ts'),
      import('/src/document-attachments.ts'),
    ]);
    const hvyDocument = deserializeDocumentBytes(new TextEncoder().encode(`---
hvy_version: 0.1
---

<!--hvy: {"id":"resources"}-->
#! Resources

 [Open guide](@attachment:Guide)
`), '.hvy');
    await storeUserFileAttachment(hvyDocument, {
      id: 'file:guide',
      name: 'Guide',
      filename: value.filename,
      mediaType: value.mediaType,
      bytes: new Uint8Array(value.bytes),
    });
    const root = document.querySelector<HTMLElement>('#attachmentViewer');
    if (!root) throw new Error('Attachment viewer root is missing.');
    mountHvyViewer({ root, document: hvyDocument });
  }, attachment);
}
