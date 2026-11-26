import { expect, test, type Page } from '@playwright/test';

const QUEUE_DOCUMENT = `---
hvy_version: 0.1
plugins:
  - id: fake.queue
    permissions:
      - scripting
---

<!--hvy: {"id":"fake-queue-section"}-->
#! Fake queue

<!--hvy:text {"id":"fake-queue-count"}-->
 Fake count 0

<!--hvy:plugin {"id":"fake-queue-listener","plugin":"hvy.scripting","pluginConfig":{"version":"0.1"}}-->
def on_result(value):
    doc.component.set_text("fake-queue-count", "Fake count " + str(value))

doc.plugins.call("fake.queue", "subscribe", {"on_result": on_result})
`;

type QueueTestWindow = Window & {
  fakeQueueHandler: ((value: number) => void) | null;
};

async function mountQueueDocument(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(async (source) => {
    const embedPath = '/src/embed.ts';
    const { deserializeDocumentBytes, mountHvy, plugins } = await import(/* @vite-ignore */ embedPath);
    document.body.innerHTML = '<div id="fakeRoot" style="height:600px"></div>';
    const testWindow = window as unknown as QueueTestWindow;
    testWindow.fakeQueueHandler = null;
    mountHvy({
      root: document.querySelector('#fakeRoot'),
      mode: 'viewer',
      document: deserializeDocumentBytes(new TextEncoder().encode(source), '.hvy'),
      plugins: [plugins.scripting, {
        id: 'fake.queue',
        displayName: 'Fake queue',
        create: () => ({ element: document.createElement('div') }),
        scripting: {
          methods: {
            subscribe: (args: { on_result: (value: number) => void }) => {
              testWindow.fakeQueueHandler = args.on_result;
            },
          },
        },
      }],
    });
  }, QUEUE_DOCUMENT);
  await page.waitForFunction(() => (window as unknown as QueueTestWindow).fakeQueueHandler !== null);
}

test('expected result: a queue delivering more results than the chain budget renders every result', async ({ page }) => {
  test.setTimeout(5_000);
  await mountQueueDocument(page);

  // Spaced apart in document time so only the chain budget is under test, not the
  // rolling watchdog, while microtask delivery keeps every run overlapping the last.
  await page.evaluate(async () => {
    const realNow = Date.now.bind(Date);
    let offset = 0;
    Date.now = () => realNow() + offset;
    for (let value = 1; value <= 40; value += 1) {
      offset += 300;
      (window as unknown as QueueTestWindow).fakeQueueHandler!(value);
      await Promise.resolve();
    }
  });

  await expect(page.locator('#fakeRoot').getByText('Fake count 40')).toBeVisible();
});
