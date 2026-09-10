import { expect, test } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';

function packageBytes(manifest: Record<string, unknown>, files: Record<string, string>): number[] {
  return Array.from(zipSync({
    'hvy-plugin.json': strToU8(JSON.stringify(manifest)),
    ...Object.fromEntries(Object.entries(files).map(([path, source]) => [path, strToU8(source)])),
  }));
}

test('Brython package factory normalizes the complete host capability shape and disposes modules', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw' }).waitFor();
  const archive = packageBytes({
    formatVersion: '0.2',
    id: 'com.example.fake-worker',
    uuid: 'fake-worker-primary',
    version: '1.0.0',
    displayName: 'Fake Worker',
    entry: 'plugin.py',
    styles: [],
    permissions: [],
    pythonImports: ['random', 're', 'datetime'],
    hvyApiVersion: '0.1',
  }, {
    'assets/fake.txt': 'fake resource',
    'helpers.py': 'FAKE_LABEL = "relative-import-ok"\n',
    'plugin.py': `from .helpers import FAKE_LABEL
from datetime import date
import random
import re

events = []

def create_component(ctx):
    from browser import document
    element = document.createElement("div")
    element.textContent = FAKE_LABEL
    return {
        "element": element,
        "refresh": lambda: events.append("refresh"),
        "unmount": lambda: events.append("unmount"),
    }

def start(args, ctx):
    first = args["on_complete"]({"status": "done", "values": [1, {"ok": True}]})
    second = args["nested"][0]["finished"]("again")
    return {
        "first": first,
        "second": second,
        "year": date(2030, 1, 2).year,
        "matched": re.fullmatch("fake", "fake") is not None,
        "random_type": type(random.randint(1, 3)).__name__,
        "none_value": None,
        "tuple_value": (3, {"ok": True}),
    }

async def render_static(ctx):
    return {"blocks": [], "noneValue": None, "tupleValue": (4, {"ok": True})}

def make_plugin(context):
    assert context["manifest"].id == "com.example.fake-worker"
    return {
        "id": "com.example.fake-worker",
        "uuid": "fake-worker-primary",
        "version": "1.0.0",
        "hvyApiVersion": "0.1",
        "displayName": "Fake Worker",
        "components": [{"id": "fake", "displayName": "Fake", "create": create_component}],
        "create": create_component,
        "hooks": {"documentLoad": {"run": lambda ctx: events.append("load")}},
        "scripting": {"methods": {"start": start}},
        "visualDescription": {"describe": lambda ctx: FAKE_LABEL},
        "pdf": {"renderStatic": render_static},
        "aiHelp": context["resource_url"]("assets/fake.txt"),
    }

plugin = make_plugin
`,
  });
  const mappingArchive = packageBytes({
    formatVersion: '0.2', id: 'com.example.fake-mapping', version: '2.0.0',
    displayName: 'Fake Mapping', entry: 'plugin.py', styles: [], permissions: [], hvyApiVersion: '0.1',
  }, {
    'plugin.py': `plugin = {"id": "com.example.fake-mapping", "version": "2.0.0", "hvyApiVersion": "0.1", "displayName": "Fake Mapping"}\n`,
  });
  const invalidIdentityArchive = packageBytes({
    formatVersion: '0.2', id: 'com.example.fake-expected', version: '1.0.0',
    displayName: 'Fake Expected', entry: 'plugin.py', styles: [], permissions: [], hvyApiVersion: '0.1',
  }, {
    'plugin.py': `plugin = {"id": "com.example.fake-wrong", "version": "1.0.0", "hvyApiVersion": "0.1", "displayName": "Fake Expected"}\n`,
  });
  const tracebackArchive = packageBytes({
    formatVersion: '0.2', id: 'com.example.fake-traceback', version: '1.0.0',
    displayName: 'Fake Traceback', entry: 'plugin.py', styles: [], permissions: [], hvyApiVersion: '0.1',
  }, {
    'plugin.py': 'raise RuntimeError("fake package load failure")\n',
  });

  const expectedResult = await page.evaluate(async ({ factoryBytes, mappingBytes, invalidBytes, tracebackBytes }) => {
    const { loadHvyPluginZip } = await import('/src/plugin-package-zip.ts');
    const loaded = await loadHvyPluginZip(Uint8Array.from(factoryBytes));
    const callbackArguments: unknown[] = [];
    const methodResult = loaded.plugin.scripting!.methods.start({
      on_complete(value: unknown) {
        callbackArguments.push(value);
        return 'top-return';
      },
      nested: [{
        finished(value: unknown) {
          callbackArguments.push(value);
          return 'nested-return';
        },
      }],
    }, { pluginId: loaded.plugin.id, rawDocument: {} as never, markMutated() {} });
    const instance = loaded.plugin.create!({} as never);
    instance.refresh!();
    instance.unmount!();
    await loaded.plugin.hooks!.documentLoad!.run({} as never);
    const packageModules = Object.keys(window.__BRYTHON__!.VFS!).filter((name) => name.startsWith('__hvy_plugin_'));
    const result = {
      id: loaded.plugin.id,
      componentText: instance.element.textContent,
      callbackArguments,
      methodResult,
      pdf: await loaded.plugin.pdf!.renderStatic({} as never),
      visualDescription: loaded.plugin.visualDescription!.describe({} as never),
      resourceUrlIsLocal: String(loaded.plugin.aiHelp).startsWith('blob:'),
      packageModuleCount: packageModules.length,
    };
    loaded.dispose();
    const mappingPackage = await loadHvyPluginZip(Uint8Array.from(mappingBytes));
    const mappingId = mappingPackage.plugin.id;
    mappingPackage.dispose();
    let identityError = '';
    try {
      await loadHvyPluginZip(Uint8Array.from(invalidBytes));
    } catch (error) {
      identityError = error instanceof Error ? error.message : String(error);
    }
    let tracebackError = '';
    try {
      await loadHvyPluginZip(Uint8Array.from(tracebackBytes));
    } catch (error) {
      tracebackError = error instanceof Error ? error.message : String(error);
    }
    return {
      ...result,
      mappingId,
      identityError,
      tracebackError,
      remainingPackageModules: Object.keys(window.__BRYTHON__!.VFS!).filter((name) => name.startsWith('__hvy_plugin_')).length,
    };
  }, {
    factoryBytes: archive,
    mappingBytes: mappingArchive,
    invalidBytes: invalidIdentityArchive,
    tracebackBytes: tracebackArchive,
  });

  expect(expectedResult).toEqual({
    id: 'com.example.fake-worker',
    componentText: 'relative-import-ok',
    callbackArguments: [{ status: 'done', values: [1, { ok: true }] }, 'again'],
    methodResult: {
      first: 'top-return',
      second: 'nested-return',
      year: 2030,
      matched: true,
      random_type: 'int',
      none_value: null,
      tuple_value: [3, { ok: true }],
    },
    pdf: { blocks: [], noneValue: null, tupleValue: [4, { ok: true }] },
    visualDescription: 'relative-import-ok',
    resourceUrlIsLocal: true,
    packageModuleCount: 3,
    mappingId: 'com.example.fake-mapping',
    identityError: expect.stringContaining('does not match manifest'),
    tracebackError: expect.stringContaining('fake package load failure'),
    remainingPackageModules: 0,
  });
});

test('Python plugin imports remain unavailable unless requested by the manifest', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw' }).waitFor();
  const archive = packageBytes({
    formatVersion: '0.2', id: 'com.example.fake-missing-import', version: '1.0.0',
    displayName: 'Fake Missing Import', entry: 'plugin.py', styles: [], permissions: [], hvyApiVersion: '0.1',
  }, {
    'plugin.py': `import random
plugin = {"id": "com.example.fake-missing-import", "version": "1.0.0", "hvyApiVersion": "0.1", "displayName": "Fake Missing Import"}
`,
  });

  const expectedResult = await page.evaluate(async (bytes) => {
    const { loadHvyPluginZip } = await import('/src/plugin-package-zip.ts');
    try {
      await loadHvyPluginZip(Uint8Array.from(bytes));
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, archive);

  expect(expectedResult).toContain('random');
  expect(expectedResult).toContain('ModuleNotFoundError');
  expect(expectedResult).not.toContain('XMLHttpRequest');
});
