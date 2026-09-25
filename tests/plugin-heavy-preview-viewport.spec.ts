import { expect, test } from '@playwright/test';

async function mountClippedPlugin(page: import('@playwright/test').Page, kind: 'diagram' | 'graph' | 'model-3d') {
  await page.evaluate(async (pluginKind) => {
    const { createPluginMount } = await import('/src/plugins/viewport-plugin-mount.ts');
    document.body.innerHTML = `<div class="hvy-document">
      <div class="viewer-shell">
        <div class="reader-document" style="height: 300px; overflow: auto;">
          <section class="reader-section">
            <div class="expandable-reader has-empty-stub is-collapsed">
              <div class="expandable-reader-body">
                <div class="expandable-reader-pane expandable-reader-pane-expanded expandable-reader-pane-content-preview">
                  <div class="expand-content"><div style="height: 260px;">Preview content</div><div id="plugin-target"></div></div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>`;

    if (pluginKind === 'diagram') {
      const { diagramPlugin, diagramPluginFactory } = await import('/src/plugins/diagram.ts');
      const context = {
        mode: 'reader',
        block: { text: 'graph TD\nA-->B', schema: { pluginConfig: { syntax: 'mermaid' } } },
      } as never;
      const instance = createPluginMount(
        () => diagramPluginFactory(context),
        diagramPlugin.mount!,
      );
      document.querySelector('#plugin-target')?.replaceWith(instance.element);
      return;
    }

    if (pluginKind === 'graph') {
      const { graphPlugin, graphPluginFactory } = await import('/src/plugins/graph.ts');
      const context = {
        mode: 'reader',
        block: { text: 'Label,Value\nExample A,10\nExample B,20', schema: { pluginConfig: { type: 'bar' } } },
      } as never;
      const instance = createPluginMount(
        () => graphPluginFactory(context),
        graphPlugin.mount!,
      );
      document.querySelector('#plugin-target')?.replaceWith(instance.element);
      return;
    }

    const { model3dPlugin, model3dPluginFactory } = await import('/src/plugins/model-3d/model-3d.ts');
    const bytes = new TextEncoder().encode(`solid fake
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 1 0 0
vertex 0 1 0
endloop
endfacet
endsolid fake`);
    const context = {
      mode: 'reader',
      block: {
        text: '',
        schema: { pluginConfig: { modelFile: 'fake.stl', mediaType: 'model/stl', height: 240 } },
      },
      attachments: {
        get: (id: string) => id === 'model-3d:fake.stl' ? { id, meta: {}, bytes } : null,
      },
    } as never;
    const instance = createPluginMount(
      () => model3dPluginFactory(context),
      model3dPlugin.mount!,
    );
    document.querySelector('#plugin-target')?.replaceWith(instance.element);
  }, kind);
}

async function expand(page: import('@playwright/test').Page) {
  await page.locator('.expandable-reader').evaluate((expandable) => {
    expandable.classList.remove('is-collapsed');
    expandable.classList.add('is-expanded');
  });
}

test('diagram rendering waits until clipped expandable content approaches the viewport', async ({ page }) => {
  test.setTimeout(5000);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Raw', exact: true })).toBeVisible();
  await mountClippedPlugin(page, 'diagram');

  await page.waitForTimeout(250);
  await expect(page.locator('.hvy-diagram-frame svg')).toHaveCount(0);
  await expand(page);
  await expect(page.locator('.hvy-diagram-frame svg')).toHaveCount(1, { timeout: 1000 });
});

test('graph rendering waits until clipped expandable content approaches the viewport', async ({ page }) => {
  test.setTimeout(5000);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Raw', exact: true })).toBeVisible();
  await mountClippedPlugin(page, 'graph');

  await page.waitForTimeout(250);
  await expect(page.locator('.hvy-graph-frame canvas')).toHaveCount(0);
  await expand(page);
  await expect(page.locator('.hvy-graph-frame canvas')).toHaveCount(1, { timeout: 1000 });
});

test('3D rendering waits until clipped expandable content approaches the viewport', async ({ page }) => {
  test.setTimeout(5000);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Raw', exact: true })).toBeVisible();
  await mountClippedPlugin(page, 'model-3d');

  await page.waitForTimeout(250);
  await expect(page.locator('.hvy-model-3d-canvas')).toHaveCount(0);
  await expand(page);
  await expect(page.locator('.hvy-model-3d-canvas')).toHaveCount(1, { timeout: 1500 });
});
