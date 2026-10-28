import { expect, test } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';

const fakePluginDocument = `---
hvy_version: 0.1
plugins:
  - id: com.example.fake-null
    versionRange: ^1.0.0
    permissions: [scripting]
---
`;

async function runFakeNullScript(page: import('@playwright/test').Page, source: string): Promise<unknown> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).waitFor();
  return page.evaluate(async ({ documentText, scriptSource }) => {
    const [{ runUserScript }, { deserializeDocument }, registry] = await Promise.all([
      import('/src/plugins/scripting/wrapper.ts'),
      import('/src/serialization.ts'),
      import('/src/plugins/registry.ts'),
    ]);
    const frozenResult = Object.freeze({ frozen: null });
    registry.registerHostPlugin({
      id: 'com.example.fake-null',
      version: '1.0.0',
      hvyApiVersion: '0.1',
      displayName: 'Fake Null',
      scripting: {
        methods: {
          status: () => ({ lastError: null, missing: undefined, nested: [null, { inner: null }], count: 0, label: '' }),
          frozen: () => frozenResult,
          callback: (args: Record<string, unknown>) => (
            args.on_result as (value: unknown) => unknown
          )({ body: { salary_min: null } }),
        },
      },
    });
    const document = deserializeDocument(documentText, '.hvy');
    const result = await runUserScript({ document, source: scriptSource });
    return { ok: result.ok, error: result.error, probe: document.meta.probe };
  }, { documentText: fakePluginDocument, scriptSource: source });
}

test('JavaScript null reaches scripts as None from db rows, plugin results, callbacks and doc.json', async ({ page }) => {
  test.setTimeout(5_000);
  const expectedResult = await runFakeNullScript(page, `
out = []
value = doc.db.query("SELECT NULL AS value")[0]["value"]
out.append(repr(value) + " " + str(value is None))
status = doc.plugins.call("com.example.fake-null", "status", {})
out.append(repr(status["lastError"]) + " " + str(status["lastError"] is None) + " " + str(status["lastError"] == None))
out.append(repr(status["missing"]))
out.append(repr(status["nested"][0]) + " " + repr(status["nested"][1]["inner"]))
out.append(repr(status["count"]) + " " + repr(status["label"]))
seen = []
def on_result(result):
    seen.append(result["body"]["salary_min"] is None)
doc.plugins.call("com.example.fake-null", "callback", {"on_result": on_result})
out.append(str(seen))
parsed = doc.json.parse('{"a": null}')
out.append(repr(parsed["a"]) + " " + repr(parsed.get("absent")))
doc.header.set("probe", " | ".join(out))
`);
  expect(expectedResult).toEqual({
    ok: true,
    error: undefined,
    probe: 'None True | None True True | None | None None | 0 \'\' | [True] | None None',
  });
});

test('None read from a JavaScript null is written back as SQL NULL', async ({ page }) => {
  test.setTimeout(5_000);
  const expectedResult = await runFakeNullScript(page, `
doc.db.execute("CREATE TABLE probe (salary_min INTEGER, note TEXT)")
error = doc.plugins.call("com.example.fake-null", "status", {})["lastError"]
doc.db.execute("INSERT INTO probe (salary_min, note) VALUES (?, ?)", [error, error])
row = doc.db.query("SELECT salary_min, note, typeof(note) AS note_type FROM probe")[0]
matching = doc.db.query("SELECT COUNT(*) AS total FROM probe WHERE salary_min >= 0")[0]["total"]
doc.header.set("probe", " | ".join([repr(row["salary_min"]), repr(row["note"]), row["note_type"], str(matching)]))
`);
  expect(expectedResult).toEqual({ ok: true, error: undefined, probe: "None | None | null | 0" });
});

test('host values entering scripts keep their container behaviour', async ({ page }) => {
  test.setTimeout(5_000);
  const expectedResult = await runFakeNullScript(page, `
out = []
rows = doc.db.query("SELECT 1 AS a, NULL AS b UNION ALL SELECT 2, 'x'")
out.append(str(len(rows)))
out.append(",".join(["" if row["b"] is None else str(row["b"]) for row in rows]))
out.append(str("b" in rows[0]) + " " + str("zzz" in rows[0]))
rows[0]["b"] = "changed"
out.append(rows[0]["b"])
frozen = doc.plugins.call("com.example.fake-null", "frozen", {})
out.append(repr(frozen["frozen"]))
doc.header.set("probe", " | ".join(out))
`);
  expect(expectedResult).toEqual({
    ok: true,
    error: undefined,
    probe: '2 | ,x | True False | changed | None',
  });
});

test('Python plugin methods receive JavaScript null in arguments and callback results as None', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).waitFor();
  const manifest = {
    formatVersion: '0.2',
    id: 'com.example.fake-python-null',
    version: '1.0.0',
    displayName: 'Fake Python Null',
    entry: 'plugin.py',
    styles: [],
    permissions: [],
    hvyApiVersion: '0.1',
  };
  const archive = Array.from(zipSync({
    'hvy-plugin.json': strToU8(JSON.stringify(manifest)),
    'plugin.py': strToU8(`def describe(args, ctx):
    answered = args["handlers"][0]["answer"]({"from_plugin": None})
    return " ".join([
        repr(args["value"]),
        str(args["value"] is None),
        repr(args["nested"][0]),
        repr(answered["echo"]),
        str(answered["echo"] is None),
    ])

plugin = {
    "id": "com.example.fake-python-null",
    "version": "1.0.0",
    "hvyApiVersion": "0.1",
    "displayName": "Fake Python Null",
    "scripting": {"methods": {"describe": describe}},
}
`),
  }));
  const expectedResult = await page.evaluate(async (bytes) => {
    const [{ loadHvyPluginZip }, registry, { runUserScript }, { deserializeDocument }] = await Promise.all([
      import('/src/plugin-package-zip.ts'),
      import('/src/plugins/registry.ts'),
      import('/src/plugins/scripting/wrapper.ts'),
      import('/src/serialization.ts'),
    ]);
    const loaded = await loadHvyPluginZip(Uint8Array.from(bytes));
    registry.registerHostPlugin(loaded.plugin);
    const document = deserializeDocument(`---
hvy_version: 0.1
plugins:
  - id: com.example.fake-python-null
    versionRange: ^1.0.0
    permissions: [scripting]
---
`, '.hvy');
    const result = await runUserScript({ document, source: `
def answer(payload):
    return {"echo": payload["from_plugin"]}

doc.header.set("probe", doc.plugins.call(
    "com.example.fake-python-null",
    "describe",
    {"value": None, "nested": [None], "handlers": [{"answer": answer}]},
))
` });
    return { ok: result.ok, error: result.error, probe: document.meta.probe };
  }, archive);
  expect(expectedResult).toEqual({ ok: true, error: undefined, probe: 'None True None None True' });
});

test('Brython maps JavaScript null and undefined to None and None to null at every crossing', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).waitFor();
  const expectedResult = await page.evaluate(async () => {
    const { loadBrython, getBrython } = await import('/src/plugins/scripting/brython-loader.ts');
    await loadBrython();
    const probe = {
      source: { present: 1, nullValue: null, undefinedValue: undefined, nested: [null], list: [1] },
      returnsNothing: () => {},
      describeArgument: (value: unknown) => (value === null ? 'null' : typeof value),
      out: {} as Record<string, unknown>,
    };
    (window as Window & { fakeNoneProbe?: unknown }).fakeNoneProbe = probe;
    (getBrython() as unknown as { runPythonSource(source: string, name: string): void }).runPythonSource(`
from browser import window
probe = window.fakeNoneProbe
source = probe.source
reads = {}
def attempt(label, read):
    try:
        reads[label] = repr(read())
    except Exception as error:
        reads[label] = type(error).__name__
attempt("null_attribute", lambda: source.nullValue)
attempt("null_item", lambda: source["nullValue"])
attempt("null_nested", lambda: source.nested[0])
attempt("undefined_attribute", lambda: source.undefinedValue)
attempt("void_return", lambda: probe.returnsNothing())
attempt("missing_attribute", lambda: source.absent)
attempt("missing_item", lambda: source["absent"])
attempt("missing_in", lambda: "absent" in source)
attempt("list_out_of_range", lambda: source.list[5])
probe.out.reads = reads
probe.out.argument = probe.describeArgument(None)
probe.out.scalar = None
probe.out.container = {"value": None, "items": [None]}
`, 'fake_none_probe');
    const { out } = probe;
    const container = out.container as { value: unknown; items: unknown[] };
    return {
      reads: out.reads,
      argument: out.argument,
      scalarIsNull: out.scalar === null,
      containerValueIsNull: container.value === null,
      containerItemIsNull: container.items[0] === null,
    };
  });
  expect(expectedResult).toEqual({
    reads: {
      null_attribute: 'None',
      null_item: 'None',
      null_nested: 'None',
      undefined_attribute: 'None',
      void_return: 'None',
      missing_attribute: 'AttributeError',
      missing_item: 'KeyError',
      missing_in: 'False',
      list_out_of_range: 'IndexError',
    },
    argument: 'null',
    scalarIsNull: true,
    containerValueIsNull: true,
    containerItemIsNull: true,
  });
});
