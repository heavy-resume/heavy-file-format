import { expect, test } from '@playwright/test';

test('expanding a sidebar container preserves plugins across reader surface refreshes', async ({ page }) => {
  test.setTimeout(5000);
  await page.goto('/');
  await page.evaluate(async () => {
    const { mountHvyViewer, deserializeDocumentBytes } = await import('/src/embed.ts');
    document.body.innerHTML = '<div id="fake-host" style="height: 600px"></div>';
    mountHvyViewer({
      root: document.getElementById('fake-host')!,
      document: deserializeDocumentBytes(new TextEncoder().encode(`---
hvy_version: 0.1
---
<!--hvy: {"id":"main"}-->
#! Fake Main
 <!--hvy:plugin {"plugin":"fake.badge","id":"main-badge"}-->
<!--hvy: {"id":"side","location":"sidebar"}-->
#! Fake Sidebar
 <!--hvy:plugin {"plugin":"fake.badge","id":"sidebar-badge"}-->
 <!--hvy:container {"id":"sidebar-container","containerTitle":"Fake group","containerExpanded":false,"css":"border: 1px solid;"}-->
  <!--hvy:text {}-->
   Fake group content
`), '.hvy'),
      plugins: [{
        id: 'fake.badge', uuid: '3cb8b5d9-3273-41a5-87e3-953dc9a376b9', version: '1.0.0', hvyApiVersion: '0.1', displayName: 'Fake badge',
        create(context) {
          const element = document.createElement('input');
          element.dataset.fakePlugin = context.block.schema.id;
          element.value = 'Fake local input';
          return { element };
        },
      }],
    });
  });
  await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  const sidebarPlugin = page.locator('[data-fake-plugin="sidebar-badge"]');
  await expect(sidebarPlugin).toBeVisible();
  await sidebarPlugin.fill('Keep this local value');
  await page.getByRole('button', { name: 'Expand container', exact: true }).click();
  await expect(sidebarPlugin).toBeVisible();
  await expect(sidebarPlugin).toHaveValue('Keep this local value');
  await expect(page.locator('[data-fake-plugin="main-badge"]')).toHaveCount(1);
});
