import { expect, test, type Page } from '@playwright/test';

const toggleDocument = `---
hvy_version: 0.1
---

<!--hvy: {"id":"fake-hooks-section"}-->
#! Fake hooks

<!--hvy:plugin {"id":"fake-form","plugin":"hvy.form","pluginConfig":{"version":"0.1","showSubmit":false}}-->
fields:
  - label: Fake toggle
    type: checkbox
    triggers:
      change: toggle
scripts:
  toggle: |
    doc.header.set("fake_toggle", doc.form.get_value("Fake toggle"))

<!--hvy:plugin {"id":"fake-load-script","plugin":"hvy.scripting","pluginConfig":{"version":"0.1"}}-->
doc.header.set("fake_load_runs", (doc.header.get("fake_load_runs") or 0) + 1)
doc.header.set("fake_load_saw_toggle", doc.header.get("fake_toggle"))
`;

const editorScriptDocument = `---
hvy_version: 0.1
---

<!--hvy: {"id":"fake-editor-section"}-->
#! Fake editor

<!--hvy:plugin {"id":"fake-editor-script","editorOnly":true,"plugin":"hvy.scripting","pluginConfig":{"version":"0.1"}}-->
doc.header.set("fake_editor_runs", (doc.header.get("fake_editor_runs") or 0) + 1)
`;

const labelScriptDocument = `---
hvy_version: 0.1
---

<!--hvy: {"id":"fake-label-section"}-->
#! Fake label

<!--hvy:plugin {"id":"fake-label-script","editorOnly":true,"plugin":"hvy.scripting","pluginConfig":{"version":"0.1"}}-->
doc.header.set("fake_label_runs", (doc.header.get("fake_label_runs") or 0) + 1)
doc.header.set("fake_label", doc.component.get_text("fake-label-text").strip())

 <!--hvy:text {"id":"fake-label-text"}-->
  Fake start
`;

type HookTestWindow = Window & {
  fakeHookRuns: string[];
  fakeMount: {
    getDocument(): { meta: Record<string, unknown> };
    setMode(mode: string): Promise<void>;
    undo(): Promise<void>;
  };
};

async function mountFakeDocument(
  page: Page,
  source: string,
  options: { mode?: 'viewer' | 'editor'; promoteToFullRuntime?: boolean }
): Promise<void> {
  await page.goto('/');
  await page.evaluate(async ({ source, mode, promoteToFullRuntime }) => {
    const embedPath = '/src/embed.ts';
    const { deserializeDocumentBytes, mountHvy, plugins } = await import(/* @vite-ignore */ embedPath);
    document.body.innerHTML = '<div id="fakeRoot" style="height:600px"></div>';
    const testWindow = window as unknown as HookTestWindow;
    testWindow.fakeHookRuns = [];
    testWindow.fakeMount = mountHvy({
      root: document.querySelector('#fakeRoot'),
      mode,
      document: deserializeDocumentBytes(new TextEncoder().encode(source), '.hvy'),
      plugins: [plugins.form, plugins.scripting, {
        id: 'fake.hook-recorder',
        displayName: 'Fake hook recorder',
        create: () => ({ element: document.createElement('div') }),
        hooks: {
          documentLoad: { run: (ctx: { changeReason: string }) => { testWindow.fakeHookRuns.push(`load:${ctx.changeReason}`); } },
          documentChange: { run: (ctx: { changeReason: string }) => { testWindow.fakeHookRuns.push(`change:${ctx.changeReason}`); } },
        },
      }],
    });
    if (promoteToFullRuntime) {
      await testWindow.fakeMount.setMode('editor');
      await testWindow.fakeMount.setMode('viewer');
    }
  }, { source, mode: options.mode ?? 'viewer', promoteToFullRuntime: options.promoteToFullRuntime ?? false });
}

function readMeta(page: Page, keys: string[]): Promise<Record<string, unknown>> {
  return page.evaluate((keys) => {
    const meta = (window as unknown as HookTestWindow).fakeMount.getDocument().meta;
    return Object.fromEntries(keys.map((key) => [key, meta[key] ?? null]));
  }, keys);
}

function readHookRuns(page: Page): Promise<string[]> {
  return page.evaluate(() => [...(window as unknown as HookTestWindow).fakeHookRuns]);
}

for (const promoteToFullRuntime of [false, true]) {
  const runtimeName = promoteToFullRuntime ? 'promoted full runtime' : 'lightweight viewer runtime';

  test(`${runtimeName}: a form change script's document edit runs documentChange hooks as a script edit`, async ({ page }) => {
    test.setTimeout(5_000);
    await mountFakeDocument(page, toggleDocument, { promoteToFullRuntime });
    await expect.poll(async () => typeof (await readMeta(page, ['fake_load_runs'])).fake_load_runs).toBe('number');
    const loadRunsBefore = (await readMeta(page, ['fake_load_runs'])).fake_load_runs as number;
    const hookRunsBefore = (await readHookRuns(page)).length;

    await page.locator('#fakeRoot').getByLabel('Fake toggle').check();

    await expect.poll(() => readMeta(page, ['fake_toggle', 'fake_load_saw_toggle', 'fake_load_runs'])).toEqual({
      fake_toggle: true,
      fake_load_saw_toggle: true,
      fake_load_runs: loadRunsBefore + 1,
    });
    expect((await readHookRuns(page)).slice(hookRunsBefore)).toEqual(['change:script-edit']);
  });

  test(`${runtimeName}: three quick user ticks are not mistaken for a script render loop`, async ({ page }) => {
    test.setTimeout(5_000);
    await mountFakeDocument(page, toggleDocument, { promoteToFullRuntime });
    await expect.poll(async () => typeof (await readMeta(page, ['fake_load_runs'])).fake_load_runs).toBe('number');
    const loadRunsBefore = (await readMeta(page, ['fake_load_runs'])).fake_load_runs as number;
    const toggle = page.locator('#fakeRoot').getByLabel('Fake toggle');

    await toggle.check();
    await expect.poll(() => readMeta(page, ['fake_load_runs'])).toEqual({ fake_load_runs: loadRunsBefore + 1 });
    await toggle.uncheck();
    await expect.poll(() => readMeta(page, ['fake_load_runs'])).toEqual({ fake_load_runs: loadRunsBefore + 2 });
    await toggle.check();

    await expect.poll(() => readMeta(page, ['fake_toggle', 'fake_load_saw_toggle', 'fake_load_runs'])).toEqual({
      fake_toggle: true,
      fake_load_saw_toggle: true,
      fake_load_runs: loadRunsBefore + 3,
    });
    await expect(page.locator('#fakeRoot').getByText(/render cycle/)).toHaveCount(0);
  });
}

const invokeReasonDocument = `---
hvy_version: 0.1
---

<!--hvy: {"id":"fake-reason-section"}-->
#! Fake reason

<!--hvy:plugin {"id":"fake-reason-form","plugin":"hvy.form","pluginConfig":{"version":"0.1","showSubmit":false}}-->
fields:
  - label: Fake toggle
    type: checkbox
    triggers:
      change: toggle
scripts:
  toggle: |
    doc.header.set("fake_toggle", doc.form.get_value("Fake toggle"))
    doc.header.set("fake_form_reason", repr(run_context.invoke_reason))

<!--hvy:plugin {"id":"fake-reason-script","plugin":"hvy.scripting","pluginConfig":{"version":"0.1"}}-->
doc.header.set("fake_reasons", (doc.header.get("fake_reasons") or "") + run_context.invoke_reason + ",")
if run_context.invoke_reason == "script-edit":
    return
doc.header.set("fake_full_runs", (doc.header.get("fake_full_runs") or 0) + 1)
`;

test('a document script reads run_context.invoke_reason and returns early after a form tick', async ({ page }) => {
  test.setTimeout(5_000);
  await mountFakeDocument(page, invokeReasonDocument, {});
  await expect.poll(() => readMeta(page, ['fake_reasons', 'fake_full_runs'])).toEqual({ fake_reasons: 'load,', fake_full_runs: 1 });

  await page.locator('#fakeRoot').getByLabel('Fake toggle').check();

  await expect.poll(() => readMeta(page, ['fake_toggle', 'fake_form_reason', 'fake_reasons', 'fake_full_runs'])).toEqual({
    fake_toggle: true,
    fake_form_reason: 'None',
    fake_reasons: 'load,script-edit,',
    fake_full_runs: 1,
  });
});

test('a document script first run after entering the viewer sees invoke_reason "unknown", not "load"', async ({ page }) => {
  test.setTimeout(5_000);
  await mountFakeDocument(page, invokeReasonDocument, { mode: 'editor' });
  expect(await readMeta(page, ['fake_reasons'])).toEqual({ fake_reasons: null });

  await page.evaluate(() => (window as unknown as HookTestWindow).fakeMount.setMode('viewer'));

  await expect.poll(() => readMeta(page, ['fake_reasons', 'fake_full_runs'])).toEqual({ fake_reasons: 'unknown,', fake_full_runs: 1 });
});

test('switching an embedded viewer into the editor runs editor-only document scripts', async ({ page }) => {
  test.setTimeout(5_000);
  await mountFakeDocument(page, editorScriptDocument, {});
  expect(await readMeta(page, ['fake_editor_runs'])).toEqual({ fake_editor_runs: null });

  await page.evaluate(() => (window as unknown as HookTestWindow).fakeMount.setMode('editor'));

  await expect.poll(() => readMeta(page, ['fake_editor_runs'])).toEqual({ fake_editor_runs: 1 });
});

test('typing in an embedded editor runs no document hooks and keeps focus and caret', async ({ page }) => {
  test.setTimeout(5_000);
  await mountFakeDocument(page, `${editorScriptDocument}
 <!--hvy:text {"id":"fake-editable-text"}-->
  Fake editable start
`, { mode: 'editor' });
  await expect.poll(() => readMeta(page, ['fake_editor_runs'])).toEqual({ fake_editor_runs: 1 });
  await page.locator('#fakeRoot [data-action="activate-block"]', { hasText: 'Fake editable start' }).click();
  const editor = page.locator('#fakeRoot [data-field="block-rich"][data-block-id]').filter({ hasText: 'Fake editable start' });
  await expect(editor).toBeFocused();
  await editor.press('End');
  const hookRunsBefore = await readHookRuns(page);

  await editor.pressSequentially('abc', { delay: 20 });
  await editor.press('ArrowLeft');
  await editor.pressSequentially('X');
  // Past the 750 ms input-idle checkpoint, so any idle-time render has happened.
  await page.waitForTimeout(850);

  expect(await readHookRuns(page)).toEqual(hookRunsBefore);
  expect(await readMeta(page, ['fake_editor_runs'])).toEqual({ fake_editor_runs: 1 });
  await expect(editor).toBeFocused();
  await expect(editor).toContainText('Fake editable startabXc');
  expect(await editor.evaluate((element) => {
    const selection = element.ownerDocument.getSelection();
    return Boolean(selection?.isCollapsed && selection.focusNode?.textContent?.slice(0, selection.focusOffset).endsWith('abX'));
  })).toBe(true);
});

test('undo after a committed edit returns to the state before it, with script output, without rerunning scripts', async ({ page }) => {
  test.setTimeout(5_000);
  await mountFakeDocument(page, labelScriptDocument, { mode: 'editor' });
  await expect.poll(() => readMeta(page, ['fake_label', 'fake_label_runs'])).toEqual({ fake_label: 'Fake start', fake_label_runs: 1 });
  await page.locator('#fakeRoot [data-action="activate-block"]', { hasText: 'Fake start' }).click();
  const editor = page.locator('#fakeRoot [data-field="block-rich"][data-block-id]').filter({ hasText: 'Fake start' });
  await expect(editor).toBeFocused();
  await editor.press('End');
  await editor.pressSequentially(' edited');
  // Past the 750 ms input-idle checkpoint, so history holds the typed text before its script runs.
  await page.waitForTimeout(850);
  await page.locator('#fakeRoot [data-active-editor-block="true"] [data-action="deactivate-block"]').click();
  await expect.poll(() => readMeta(page, ['fake_label', 'fake_label_runs'])).toEqual({ fake_label: 'Fake start edited', fake_label_runs: 2 });
  const hookRunsBefore = await readHookRuns(page);

  await page.evaluate(() => (window as unknown as HookTestWindow).fakeMount.undo());

  await expect(page.locator('#fakeRoot [data-action="activate-block"]', { hasText: 'Fake start' })).not.toContainText('edited');
  expect(await readMeta(page, ['fake_label', 'fake_label_runs'])).toEqual({ fake_label: 'Fake start', fake_label_runs: 1 });
  expect(await readHookRuns(page)).toEqual(hookRunsBefore);
});

const updatedComponentsDocument = `---
hvy_version: 0.1
---

<!--hvy: {"id":"fake-updated-section"}-->
#! Fake updated

<!--hvy:plugin {"id":"fake-updates-form","plugin":"hvy.form","pluginConfig":{"version":"0.1","showSubmit":false}}-->
fields:
  - label: Fake edit
    type: checkbox
    triggers:
      change: edit
  - label: Fake remove
    type: checkbox
    triggers:
      change: remove
scripts:
  edit: |
    doc.component.set_text("fake-updated-text", "changed " + str(doc.form.get_value("Fake edit")))
  remove: |
    doc.tool.remove_component(component_ref="fake-removed-text")

<!--hvy:text {"id":"fake-updated-text"}-->
Fake start

<!--hvy:text {"id":"fake-removed-text"}-->
Fake removed

<!--hvy:plugin {"id":"fake-updates-script","plugin":"hvy.scripting","pluginConfig":{"version":"0.2"}}-->
if run_context.invoke_reason == "script-edit":
    updates = [("removed:" if handle.removed else "") + handle.id for handle in doc.tool.get_updated_components(component="text")]
    doc.header.set("fake_updates", ",".join(updates))
else:
    doc.header.set("fake_loaded", True)
`;

test('get_updated_components reports each script edit and removal through the document hook', async ({ page }) => {
  test.setTimeout(5_000);
  await mountFakeDocument(page, updatedComponentsDocument, {});
  await expect.poll(() => readMeta(page, ['fake_loaded'])).toEqual({ fake_loaded: true });
  const root = page.locator('#fakeRoot');

  await root.getByLabel('Fake edit').check();
  await expect.poll(() => readMeta(page, ['fake_updates'])).toEqual({ fake_updates: 'fake-updated-text' });

  await root.getByLabel('Fake edit').uncheck();
  await expect.poll(async () => (await page.evaluate(() => (window as unknown as HookTestWindow).fakeMount.getDocument().sections[0] as unknown as { blocks: Array<{ text: string }> })).blocks[1]?.text).toBe('changed False');
  await expect.poll(() => readMeta(page, ['fake_updates'])).toEqual({ fake_updates: 'fake-updated-text' });

  await root.getByLabel('Fake remove').check();
  await expect.poll(() => readMeta(page, ['fake_updates'])).toEqual({ fake_updates: 'removed:fake-removed-text' });
});

for (const mode of ['viewer', 'editor'] as const) {
  test(`${mode} mount: whenLoaded resolves only after the initial documentLoad hook run settles`, async ({ page }) => {
    test.setTimeout(5_000);
    await page.goto('/');
    const source = mode === 'editor' ? editorScriptDocument : toggleDocument;
    const expectedMetaKey = mode === 'editor' ? 'fake_editor_runs' : 'fake_load_runs';
    const result = await page.evaluate(async ({ source, mode, expectedMetaKey }) => {
      const embedPath = '/src/embed.ts';
      const { deserializeDocumentBytes, mountHvy, plugins } = await import(/* @vite-ignore */ embedPath);
      document.body.innerHTML = '<div id="fakeRoot" style="height:600px"></div>';

      let markEntered!: () => void;
      const gateEntered = new Promise<void>((resolve) => {
        markEntered = resolve;
      });
      let releaseGate!: () => void;
      const gate = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });

      const mount = mountHvy({
        root: document.querySelector('#fakeRoot') as HTMLElement,
        mode,
        document: deserializeDocumentBytes(new TextEncoder().encode(source), '.hvy'),
        plugins: [plugins.form, plugins.scripting, {
          id: 'fake.load-gate',
          displayName: 'Fake load gate',
          create: () => ({ element: document.createElement('div') }),
          hooks: {
            documentLoad: {
              priority: 10,
              run: async () => {
                markEntered();
                await gate;
              },
            },
          },
        }],
      });

      let loadedBeforeRelease = false;
      const loadPromise = mount.whenLoaded().then(() => {
        loadedBeforeRelease = true;
      });

      await gateEntered;
      await new Promise((r) => setTimeout(r, 20));
      const settledWhileBlocked = loadedBeforeRelease;
      const runsWhileBlocked = mount.getDocument().meta[expectedMetaKey] ?? null;

      releaseGate();
      await loadPromise;
      const runsAfterLoad = mount.getDocument().meta[expectedMetaKey] ?? null;

      // Calling whenLoaded() again resolves without re-running hooks.
      await mount.whenLoaded();
      const runsAfterSecondAwait = mount.getDocument().meta[expectedMetaKey] ?? null;
      mount.destroy();

      return {
        settledWhileBlocked,
        runsWhileBlocked,
        runsAfterLoad,
        runsAfterSecondAwait,
      };
    }, { source, mode, expectedMetaKey });

    expect(result).toEqual({
      settledWhileBlocked: false,
      runsWhileBlocked: null,
      runsAfterLoad: 1,
      runsAfterSecondAwait: 1,
    });
  });
}

const backgroundQueueDocument = `---
hvy_version: 0.1
plugins:
  - id: fake.queue
    versionRange: ^1.0.0
    permissions: [scripting]
---

<!--hvy: {"id":"fake-bg-section"}-->
#! Fake background queue

<!--hvy:text {"id":"fake-bg-status"}-->
initial

<!--hvy:plugin {"id":"fake-bg-script","plugin":"hvy.scripting","pluginConfig":{"version":"0.2"}}-->
if run_context.invoke_reason == "load":
    doc.header.set("fake_load_runs", (doc.header.get("fake_load_runs") or 0) + 1)
    session.state["seen"] = []

    def on_result(item):
        seen = session.state["seen"]
        seen.append(item)
        session.state["seen"] = seen
        doc.component.set_text("fake-bg-status", ",".join(seen))
        doc.header.set("fake_seen_count", len(seen))

    doc.plugins.call("fake.queue", "subscribe", {"on_result": on_result})
`;

const otherTabDocument = `---
hvy_version: 0.1
---

<!--hvy: {"id":"fake-other-section"}-->
#! Fake other tab

<!--hvy:text {"id":"fake-other-text"}-->
Other tab visible
`;

for (const mode of ['viewer', 'editor'] as const) {
  test(`${mode} mount: detach keeps script callbacks and session alive while another tab uses the root, and attach renders without rerunning load`, async ({ page }) => {
    test.setTimeout(5_000);
    await page.goto('/');

    const result = await page.evaluate(async ({ bgSource, otherSource, mode }) => {
      const embedPath = '/src/embed.ts';
      const { deserializeDocumentBytes, mountHvy, plugins } = await import(/* @vite-ignore */ embedPath);
      document.body.innerHTML = '<div id="sharedRoot" style="height:600px"></div>';
      const sharedRoot = document.querySelector('#sharedRoot') as HTMLElement;

      let deliverResult: ((item: string) => void) | null = null;
      const queuePlugin = {
        id: 'fake.queue',
        version: '1.0.0',
        hvyApiVersion: '0.1',
        displayName: 'Fake queue',
        create: () => ({ element: document.createElement('div') }),
        scripting: {
          methods: {
            subscribe: (args: unknown) => {
              const record = args as { on_result?: (item: string) => void };
              deliverResult = record.on_result ?? null;
              return true;
            },
          },
        },
      };

      const docChangeEvents: string[] = [];
      const bgDoc = deserializeDocumentBytes(new TextEncoder().encode(bgSource), '.hvy');
      const mountA = mountHvy({
        root: sharedRoot,
        mode,
        document: bgDoc,
        plugins: [plugins.scripting, queuePlugin],
        onDocumentChange: (event: { reason: string }) => {
          docChangeEvents.push(event.reason);
        },
      });
      await mountA.whenLoaded();

      if (!deliverResult) {
        mountA.destroy();
        return { skipped: true };
      }

      const loadRunsAfterMount = mountA.getDocument().meta.fake_load_runs ?? null;

      // Switch away to Tab B: detach Tab A and mount Tab B into the same root.
      mountA.detach();
      const rootHtmlAfterDetach = sharedRoot.innerHTML;

      const mountB = mountHvy({
        root: sharedRoot,
        mode: 'viewer',
        document: deserializeDocumentBytes(new TextEncoder().encode(otherSource), '.hvy'),
        plugins: [],
      });
      await mountB.whenLoaded();

      // Deliver a queued result while Tab A is detached and Tab B owns sharedRoot.
      const changesBeforeBg = docChangeEvents.length;
      deliverResult('bg-item-alpha');
      await new Promise((r) => setTimeout(r, 30));
      const otherTabTextWhileBgRan = sharedRoot.textContent ?? '';
      const bgSeenCountWhileDetached = mountA.getDocument().meta.fake_seen_count ?? null;
      const changesAfterBg = docChangeEvents.length;

      // Switch back to Tab A: destroy Tab B and reattach Tab A to sharedRoot.
      mountB.destroy();
      mountA.attach(sharedRoot);
      const renderedTextAfterReattach = sharedRoot.textContent ?? '';
      const loadRunsAfterReattach = mountA.getDocument().meta.fake_load_runs ?? null;

      // Deliver a second result after reattaching: session.state and callback must still be alive.
      deliverResult('bg-item-beta');
      await new Promise((r) => setTimeout(r, 30));
      const renderedTextAfterSecond = sharedRoot.textContent ?? '';
      const bgSeenCountAfterSecond = mountA.getDocument().meta.fake_seen_count ?? null;

      // Close Tab A: destroy() disposes callbacks and invoking them throws HvyDisposedCallbackError.
      mountA.destroy();
      let destroyCallbackError: { name: string; code?: string; reason?: string } | null = null;
      try {
        deliverResult('bg-item-gamma');
      } catch (error) {
        const err = error as Error & { code?: string; reason?: string };
        destroyCallbackError = { name: err.name, code: err.code, reason: err.reason };
      }
      await new Promise((r) => setTimeout(r, 30));
      const bgSeenCountAfterDestroy = mountA.getDocument().meta.fake_seen_count ?? null;

      return {
        skipped: false,
        loadRunsAfterMount,
        rootHtmlAfterDetach,
        otherTabStillVisible: otherTabTextWhileBgRan.includes('Other tab visible'),
        otherTabNotClobbered: !otherTabTextWhileBgRan.includes('bg-item-alpha'),
        bgSeenCountWhileDetached,
        firedDocumentChangeWhileDetached: changesAfterBg > changesBeforeBg,
        renderedFirstAfterReattach: renderedTextAfterReattach.includes('bg-item-alpha'),
        loadRunsAfterReattach,
        renderedSecondAfterReattach: renderedTextAfterSecond.includes('bg-item-alpha,bg-item-beta'),
        bgSeenCountAfterSecond,
        bgSeenCountAfterDestroy,
        destroyCallbackError,
      };
    }, {
      bgSource: mode === 'editor'
        ? backgroundQueueDocument.replace('"hvy.scripting"', '"hvy.scripting","editorOnly":true')
        : backgroundQueueDocument,
      otherSource: otherTabDocument,
      mode,
    });

    expect(result).toEqual({
      skipped: false,
      loadRunsAfterMount: 1,
      rootHtmlAfterDetach: '',
      otherTabStillVisible: true,
      otherTabNotClobbered: true,
      bgSeenCountWhileDetached: 1,
      firedDocumentChangeWhileDetached: true,
      renderedFirstAfterReattach: true,
      loadRunsAfterReattach: 1,
      renderedSecondAfterReattach: true,
      bgSeenCountAfterSecond: 2,
      bgSeenCountAfterDestroy: 2,
      destroyCallbackError: {
        name: 'HvyDisposedCallbackError',
        code: 'HVY_CALLBACK_DISPOSED',
        reason: 'disposed',
      },
    });
  });
}

const resubscribingQueueDocument = `---
hvy_version: 0.1
plugins:
  - id: fake.queue
    versionRange: ^1.0.0
    permissions: [scripting]
---

<!--hvy: {"id":"fake-resub-section"}-->
#! Fake resubscribe

<!--hvy:text {"id":"fake-resub-status"}-->
initial

<!--hvy:plugin {"id":"fake-resub-script","plugin":"hvy.scripting","pluginConfig":{"version":"0.2"}}-->
run_num = (doc.header.get("fake_resub_runs") or 0) + 1
doc.header.set("fake_resub_runs", run_num)

def on_result(item):
    doc.component.set_text("fake-resub-status", f"run{run_num}:{item}")

doc.plugins.call("fake.queue", "subscribe", {"run": run_num, "on_result": on_result})
`;

test('queued documentChange rerun runs in its detached mount runtime and replaces prior component callbacks', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');

  const result = await page.evaluate(async ({ resubSource, otherSource }) => {
    const embedPath = '/src/embed.ts';
    const { deserializeDocumentBytes, mountHvy, plugins, HvyDisposedCallbackError } = await import(/* @vite-ignore */ embedPath);
    document.body.innerHTML = '<div id="sharedRoot" style="height:600px"></div>';
    const sharedRoot = document.querySelector('#sharedRoot') as HTMLElement;

    const handlers: Array<{ run: number; cb: (item: string) => void }> = [];
    const queuePlugin = {
      id: 'fake.queue',
      version: '1.0.0',
      hvyApiVersion: '0.1',
      displayName: 'Fake queue',
      create: () => ({ element: document.createElement('div') }),
      scripting: {
        methods: {
          subscribe: (args: unknown) => {
            const record = args as { run: number; on_result: (item: string) => void };
            handlers.push({ run: record.run, cb: record.on_result });
            return true;
          },
        },
      },
    };

    const mountA = mountHvy({
      root: sharedRoot,
      mode: 'viewer',
      document: deserializeDocumentBytes(new TextEncoder().encode(resubSource), '.hvy'),
      plugins: [plugins.scripting, queuePlugin],
    });
    await mountA.whenLoaded();

    // Trigger a document edit via run 1's callback (which queues a documentChange rerun),
    // then immediately detach Tab A and mount Tab B *without* fake.queue before the rerun finishes.
    const firstHandler = handlers[0]!.cb;
    firstHandler('from-run-1');
    mountA.detach();

    const mountB = mountHvy({
      root: sharedRoot,
      mode: 'viewer',
      document: deserializeDocumentBytes(new TextEncoder().encode(otherSource), '.hvy'),
      plugins: [plugins.scripting],
    });
    await mountB.whenLoaded();
    await new Promise((r) => setTimeout(r, 80));

    // The queued rerun must have executed in Tab A's runtime (where fake.queue exists)
    // and registered a replacement handler (run 2).
    const runsAfterSwitch = mountA.getDocument().meta.fake_resub_runs ?? null;
    const handlerCount = handlers.length;

    // Calling run 1's replaced callback must throw HvyDisposedCallbackError('replaced').
    let replacedError: { isInstance: boolean; code?: string; reason?: string } | null = null;
    try {
      firstHandler('stale-item');
    } catch (error) {
      const err = error as Error & { code?: string; reason?: string };
      replacedError = {
        isInstance: error instanceof HvyDisposedCallbackError,
        code: err.code,
        reason: err.reason,
      };
    }

    // Calling run 2's replacement callback while still detached must succeed.
    handlers[1]?.cb('from-run-2');
    await new Promise((r) => setTimeout(r, 40));

    mountB.destroy();
    mountA.attach(sharedRoot);
    const renderedAfterReattach = sharedRoot.textContent ?? '';
    mountA.destroy();

    return {
      runsAfterSwitch,
      handlerCount,
      replacedError,
      renderedRun2Result: renderedAfterReattach.includes('run2:from-run-2'),
      didNotRenderStale: !renderedAfterReattach.includes('stale-item'),
    };
  }, { resubSource: resubscribingQueueDocument, otherSource: otherTabDocument });

  expect(result).toEqual({
    runsAfterSwitch: 2,
    handlerCount: 2,
    replacedError: {
      isInstance: true,
      code: 'HVY_CALLBACK_DISPOSED',
      reason: 'replaced',
    },
    renderedRun2Result: true,
    didNotRenderStale: true,
  });
});
