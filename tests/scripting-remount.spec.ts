import { expect, test } from '@playwright/test';

const startupScriptDocument = `---
hvy_version: 0.1
plugins:
  - id: com.example.fake-startup-listener
    versionRange: ^1.0.0
    permissions: [scripting]
---

<!--hvy: {"id":"startup"}-->
#! Startup

<!--hvy:plugin {"id":"startup-script","plugin":"hvy.scripting","pluginConfig":{"version":"0.1"}}-->
doc.plugins.call("com.example.fake-startup-listener", "register", {})
`;

test('remounting the same document object reruns startup scripts', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  await page.evaluate(async (source) => {
    document.body.innerHTML = '<div id="remountRoot"></div>';
    const { deserializeDocumentBytes, mountHvy, plugins } = await import('/src/embed.ts');
    const testWindow = window as Window & { __startupRegistrations?: number; __remount?: () => void };
    testWindow.__startupRegistrations = 0;
    const options = {
      root: document.querySelector<HTMLElement>('#remountRoot')!,
      document: deserializeDocumentBytes(new TextEncoder().encode(source), '.hvy'),
      mode: 'viewer' as const,
      plugins: [plugins.scripting!, {
        id: 'com.example.fake-startup-listener',
        version: '1.0.0',
        hvyApiVersion: '0.1',
        displayName: 'Fake Startup Listener',
        scripting: {
          methods: {
            register: () => {
              testWindow.__startupRegistrations! += 1;
              return null;
            },
          },
        },
      }],
    };
    let mount = mountHvy(options);
    testWindow.__remount = () => {
      mount.destroy();
      mount = mountHvy(options);
    };
  }, startupScriptDocument);
  await expect.poll(() => page.evaluate(() => (window as Window & { __startupRegistrations?: number }).__startupRegistrations)).toBe(1);

  await page.evaluate(() => (window as Window & { __remount?: () => void }).__remount?.());

  await expect.poll(() => page.evaluate(() => (window as Window & { __startupRegistrations?: number }).__startupRegistrations)).toBe(2);
});
