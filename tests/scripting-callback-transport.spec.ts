import { expect, test } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';

test('document Brython preserves callbacks for JavaScript and Brython plugin methods', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw' }).waitFor();
  const manifest = {
    formatVersion: '0.2',
    id: 'com.example.fake-python-callback',
    version: '1.0.0',
    displayName: 'Fake Python Callback',
    entry: 'plugin.py',
    styles: [],
    permissions: [],
    hvyApiVersion: '0.1',
  };
  const archive = Array.from(zipSync({
    'hvy-plugin.json': strToU8(JSON.stringify(manifest)),
    'plugin.py': strToU8(`from browser import window

def invoke(args, ctx):
    def finish():
        callback = args["handlers"][0]["finished"]
        window.fakePythonCallbackReturns = [
            callback({"status": "python-one", "values": [1, {"ok": True}]}),
            callback({"status": "python-two", "values": [2, {"ok": True}]}),
        ]
    delay = args["delay"] if "delay" in args else 5
    window.setTimeout(finish, int(delay))
    return "scheduled"

plugin = {
    "id": "com.example.fake-python-callback",
    "version": "1.0.0",
    "hvyApiVersion": "0.1",
    "displayName": "Fake Python Callback",
    "scripting": {"methods": {"invoke": invoke}},
}
`),
  }));

  const expectedResult = await page.evaluate(async (bytes) => {
    const [{ loadHvyPluginZip }, registry, stateModule, serialization, wrapper, callbackLifecycle] = await Promise.all([
      import('/src/plugin-package-zip.ts'),
      import('/src/plugins/registry.ts'),
      import('/src/state.ts'),
      import('/src/serialization.ts'),
      import('/src/plugins/scripting/wrapper.ts'),
      import('/src/plugins/scripting/callback-lifecycle.ts'),
    ]);
    const loaded = await loadHvyPluginZip(Uint8Array.from(bytes));
    const callbackReturns: unknown[] = [];
    const javascriptPlugin = {
      id: 'com.example.fake-js-callback',
      version: '1.0.0',
      hvyApiVersion: '0.1',
      displayName: 'Fake JavaScript Callback',
      scripting: {
        methods: {
          invoke(args: Record<string, unknown>) {
            window.setTimeout(() => {
              const callback = args.on_complete as (value: unknown) => unknown;
              const count = Number(args.count ?? 1);
              for (let index = 0; index < count; index += 1) {
                callbackReturns.push(callback({ status: `js-${index + 1}`, nested: [{ ok: true }] }));
              }
            }, Number(args.delay ?? 5));
            return 'scheduled';
          },
        },
      },
    };
    registry.registerHostPlugin(javascriptPlugin);
    registry.registerHostPlugin(loaded.plugin);
    const declarations = [javascriptPlugin.id, loaded.plugin.id].map((id) => ({
      id,
      versionRange: '^1.0.0',
      permissions: ['scripting'],
    }));
    stateModule.state.document.meta.plugins = declarations;

    const initial = await wrapper.runUserScript({
      document: stateModule.state.document,
      pluginVersion: '0.2',
      componentId: 'fake-callback-script',
      source: `def js_finished(result):
    doc.header.set("fake_js_status", result["status"])
    return "js-return:" + result["status"]

def python_finished(result):
    doc.header.set("fake_python_status", result["status"])
    doc.header.set("fake_python_values", result["values"])
    return "python-return:" + result["status"]

doc.plugins.call(
    "com.example.fake-js-callback",
    "invoke",
    {"count": 2, "on_complete": js_finished},
)
doc.plugins.call(
    "com.example.fake-python-callback",
    "invoke",
    {"handlers": [{"finished": python_finished}]},
)
`,
    });
    await new Promise((resolve) => window.setTimeout(resolve, 25));
    const initialCallbackReturns = [...callbackReturns];

    let callbackError = '';
    const errorRun = await wrapper.runUserScript({
      document: stateModule.state.document,
      pluginVersion: '0.2',
      componentId: 'fake-callback-error-script',
      source: `def failed(result):
    raise RuntimeError("fake delayed callback error")

doc.plugins.call("com.example.fake-js-callback", "invoke", {"on_complete": failed})
`,
      onCallbackError: (result) => {
        callbackError = result.errorDetail ?? result.error ?? '';
      },
    });
    await new Promise((resolve) => window.setTimeout(resolve, 15));

    let stepCallbackError = '';
    await wrapper.runUserScript({
      document: stateModule.state.document,
      pluginVersion: '0.2',
      componentId: 'fake-callback-step-script',
      maxLines: 20,
      source: `def exceed_steps(result):
    while True:
        pass

doc.plugins.call("com.example.fake-js-callback", "invoke", {"on_complete": exceed_steps})
`,
      onCallbackError: (result) => {
        stepCallbackError = result.errorDetail ?? result.error ?? '';
      },
    });
    await new Promise((resolve) => window.setTimeout(resolve, 15));

    const previousDocument = stateModule.state.document;
    await wrapper.runUserScript({
      document: previousDocument,
      pluginVersion: '0.2',
      source: `def late(result):
    doc.header.set("must_not_cross_document", "bad")

doc.plugins.call("com.example.fake-js-callback", "invoke", {"delay": 20, "on_complete": late})
`,
    });
    const replacement = serialization.deserializeDocument('---\nhvy_version: 1.0\n---\n', '.hvy');
    replacement.meta.plugins = declarations;
    stateModule.state.document = replacement;
    await new Promise((resolve) => window.setTimeout(resolve, 30));

    await wrapper.runUserScript({
      document: replacement,
      pluginVersion: '0.2',
      source: `def after_destroy(result):
    doc.header.set("must_not_run_after_destroy", "bad")

doc.plugins.call("com.example.fake-js-callback", "invoke", {"delay": 20, "on_complete": after_destroy})
`,
    });
    callbackLifecycle.disposeScriptingCallbacks(stateModule.getActiveStateRuntime());
    await new Promise((resolve) => window.setTimeout(resolve, 30));

    const result = {
      initialOk: initial.ok,
      initialError: initial.errorDetail ?? initial.error,
      errorRunOk: errorRun.ok,
      jsStatus: previousDocument.meta.fake_js_status,
      pythonStatus: previousDocument.meta.fake_python_status,
      pythonValues: previousDocument.meta.fake_python_values,
      callbackReturns: initialCallbackReturns,
      pythonCallbackReturns: (window as Window & { fakePythonCallbackReturns?: unknown[] }).fakePythonCallbackReturns,
      callbackError,
      stepCallbackError,
      replacementHeader: { ...replacement.meta },
    };
    loaded.dispose();
    return result;
  }, archive);

  expect(expectedResult.initialOk, expectedResult.initialError).toBe(true);
  expect(expectedResult).toMatchObject({
    initialOk: true,
    errorRunOk: true,
    jsStatus: 'js-2',
    pythonStatus: 'python-two',
    pythonValues: [2, { ok: true }],
    callbackReturns: ['js-return:js-1', 'js-return:js-2'],
    pythonCallbackReturns: ['python-return:python-one', 'python-return:python-two'],
  });
  expect(expectedResult.callbackError).toContain('fake delayed callback error');
  expect(expectedResult.stepCallbackError).toContain('step budget (20)');
  expect(expectedResult.replacementHeader).not.toHaveProperty('must_not_cross_document');
  expect(expectedResult.replacementHeader).not.toHaveProperty('must_not_run_after_destroy');
});
