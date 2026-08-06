import { expect, test } from '@playwright/test';

test('photo field stages an attachment before submitScript reads its value', async ({ page }) => {
  test.setTimeout(5000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
plugins:
  - id: hvy.form
---

<!--hvy: {"id":"profile"}-->
#! Profile

 <!--hvy:plugin {"id":"profile-form","plugin":"hvy.form","pluginConfig":{"version":"0.1","submitScript":"submit","submitLabel":"Create profile"}}-->
  fields:
    - label: Photo
      type: photo
      required: true
      meta:
        accept: [image/png]
        maxBytes: 100000
        maxWidth: 400
        maxHeight: 400
  scripts:
    submit: |
      photo = doc.form.get_value("Photo")
      doc.header.set("submitted_photo_file", photo["imageFile"])
      doc.header.set("submitted_photo_attachment", photo["attachmentId"])
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Viewer' }).click();

  const form = page.locator('.hvy-form-reader-form');
  await form.locator('input[type="file"][name="Photo"]').setInputFiles({
    name: 'portrait.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  });
  await expect(form.locator('.hvy-form-photo-preview img')).toBeVisible({ timeout: 1000 });
  await form.getByRole('button', { name: 'Create profile' }).click({ timeout: 1000 });
  await expect(page.locator('.hvy-form-status')).toContainText('Script ran', { timeout: 1000 });

  const expectedResult = await page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return {
      imageFile: state.document.meta.submitted_photo_file,
      attachmentId: state.document.meta.submitted_photo_attachment,
      attachment: state.document.attachments.find((entry) => entry.id === 'image:portrait.png'),
    };
  });
  expect(expectedResult.imageFile).toBe('portrait.png');
  expect(expectedResult.attachmentId).toBe('image:portrait.png');
  expect(expectedResult.attachment).toMatchObject({
    id: 'image:portrait.png',
    meta: { mediaType: 'image/png' },
  });
  expect(expectedResult.attachment?.bytes.length).toBeGreaterThan(0);
});
