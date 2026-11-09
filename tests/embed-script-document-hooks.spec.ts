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
