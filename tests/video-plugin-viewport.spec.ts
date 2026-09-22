import { expect, test } from '@playwright/test';

test('YouTube embed waits until its clipped expandable content approaches the viewport', async ({ page }) => {
  test.setTimeout(5000);
  const youtubeRequests: string[] = [];
  page.on('request', (request) => {
    if (/youtube|googlevideo/i.test(request.url())) {
      youtubeRequests.push(request.url());
    }
  });
  await page.route(/youtube|googlevideo/i, (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Raw', exact: true })).toBeVisible();

  await page.evaluate(async () => {
    const { createPluginMount } = await import('/src/plugins/viewport-plugin-mount.ts');
    const { videoPlugin, videoPluginFactory } = await import('/src/plugins/video/video.ts');
    const context = {
      mode: 'reader',
      block: {
        schema: {
          pluginConfig: {
            url: 'https://www.youtube.com/watch?v=abcdefghijk',
            title: 'Clipped video',
          },
        },
      },
      observeLinks: () => {},
    } as never;
    const instance = createPluginMount(
      () => videoPluginFactory(context),
      videoPlugin.mount!,
    );
    document.body.innerHTML = `<div class="hvy-document">
      <div class="viewer-shell">
        <div class="reader-document" style="height: 300px; overflow: auto;">
          <section class="reader-section">
            <div class="expandable-reader has-empty-stub is-collapsed">
              <div class="expandable-reader-body">
                <div class="expandable-reader-pane expandable-reader-pane-expanded expandable-reader-pane-content-preview">
                  <div class="expand-content"><div style="height: 260px;">Preview content</div><div id="video-target"></div></div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>`;
    document.querySelector('#video-target')?.replaceWith(instance.element);
  });

  await page.waitForTimeout(100);
  const iframe = page.getByTitle('Clipped video');
  await expect(iframe).toHaveCount(0);
  expect(youtubeRequests).toHaveLength(0);

  await page.locator('.expandable-reader').evaluate((expandable) => {
    expandable.classList.remove('is-collapsed');
    expandable.classList.add('is-expanded');
  });
  await expect(iframe).toHaveAttribute('src', /^https:\/\/www\.youtube\.com\/embed\//, { timeout: 1000 });
  await expect.poll(() => youtubeRequests.length, { timeout: 1000 }).toBeGreaterThan(0);
});
