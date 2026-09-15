import { expect, test } from '@playwright/test';
import type { HvyMount } from '../src/embed-full';

type TemplateTestWindow = Window & { fakeTemplateMounts: HvyMount[] };

test('mounted editors route host undo to their own open template drafts', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  await page.evaluate(async () => {
    const { mountHvy } = await import('/src/embed-full.ts');
    const { deserializeDocument } = await import('/src/serialization.ts');
    document.body.innerHTML = '<div id="fake-host-a" style="height:600px"></div><div id="fake-host-b" style="height:600px"></div>';
    (window as unknown as TemplateTestWindow).fakeTemplateMounts = ['fake-host-a', 'fake-host-b'].map(id => {
      const mount = mountHvy({
        root: document.getElementById(id)!,
        mode: 'editor',
        document: deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: fake-card
    baseType: text
    template:
      id: fake-root
      text: Fake text
      schema:
        component: text
---

#! Fake body
`, '.hvy'),
      });
      mount.openDocumentMeta();
      return mount;
    });
  });
  for (const id of ['fake-host-a', 'fake-host-b']) {
    const host = page.locator(`#${id}`);
    await host.getByRole('button', { name: 'Edit Template', exact: true }).click();
    await expect(host.locator('#modalRoot')).toHaveAttribute('data-template-draft-history', 'true');
    await host.locator('[data-field="builder-definition-name"]').fill(id);
  }
  await page.evaluate(async () => (window as unknown as TemplateTestWindow).fakeTemplateMounts[0].undo());
  await expect(page.locator('#fake-host-a [data-field="builder-definition-name"]')).toHaveValue('fake-card');
  await expect(page.locator('#fake-host-b [data-field="builder-definition-name"]')).toHaveValue('fake-host-b');
  await page.evaluate(async () => (window as unknown as TemplateTestWindow).fakeTemplateMounts[0].redo());
  await expect(page.locator('#fake-host-a [data-field="builder-definition-name"]')).toHaveValue('fake-host-a');
  await page.evaluate(async () => (window as unknown as TemplateTestWindow).fakeTemplateMounts[1].undo());
  await expect(page.locator('#fake-host-b [data-field="builder-definition-name"]')).toHaveValue('fake-card');
  await expect(page.locator('#fake-host-a [data-field="builder-definition-name"]')).toHaveValue('fake-host-a');
});
