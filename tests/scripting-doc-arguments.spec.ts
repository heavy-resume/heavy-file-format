import { expect, test } from '@playwright/test';

const fakeDocument = `---
hvy_version: 0.1
plugins:
  - id: com.example.fake-echo
    versionRange: ^1.0.0
    permissions: [scripting]
---

<!--hvy: {"id":"fake-section"}-->
#! Fake Section

<!--hvy:text {"id":"fake-text"}-->
 Fake body text

<!--hvy:container {"id":"fake-container"}-->
`;

async function runFakeEchoScript(
  page: import('@playwright/test').Page,
  source: string,
  libraries: string[] = []
): Promise<unknown> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).waitFor();
  return page.evaluate(async ({ documentText, scriptSource, scriptLibraries }) => {
    const [{ runUserScript }, { deserializeDocument, serializeDocument }, registry] = await Promise.all([
      import('/src/plugins/scripting/wrapper.ts'),
      import('/src/serialization.ts'),
      import('/src/plugins/registry.ts'),
    ]);
    const received: string[] = [];
    registry.registerHostPlugin({
      id: 'com.example.fake-echo',
      version: '1.0.0',
      hvyApiVersion: '0.1',
      displayName: 'Fake Echo',
      scripting: {
        methods: {
          items: () => ({ items: [{ a: 1, b: null }] }),
          accept: (args: Record<string, unknown>) => {
            received.push(JSON.stringify(args));
            return 'accepted';
          },
        },
      },
    });
    const document = deserializeDocument(documentText, '.hvy');
    const result = await runUserScript({ document, source: scriptSource, libraries: scriptLibraries });
    const serialized = serializeDocument(document);
    return {
      ok: result.ok,
      error: result.error,
      probe: document.meta.probe,
      received,
      serializedProbeLines: serialized.split('\n').filter((line) => line.startsWith('fake_')),
    };
  }, { documentText: fakeDocument, scriptSource: source, scriptLibraries: libraries });
}

test('values received from the host pass back through doc calls as their JSON shape', async ({ page }) => {
  test.setTimeout(5_000);
  const expectedResult = await runFakeEchoScript(page, `
rows = doc.db.query("SELECT 1 AS a, NULL AS b")
doc.plugins.call("com.example.fake-echo", "accept", {"rows": rows})
doc.plugins.call("com.example.fake-echo", "accept", {"row": rows[0]})
items = doc.plugins.call("com.example.fake-echo", "items", {})["items"]
doc.plugins.call("com.example.fake-echo", "accept", {"items": items})
doc.header.set("probe", repr(doc.db.query("SELECT ? AS a", [rows[0]["a"]])[0]["a"]))
`);
  expect(expectedResult).toMatchObject({
    ok: true,
    error: undefined,
    received: [
      '{"rows":[{"0":1,"1":null,"a":1,"b":null}]}',
      '{"row":{"0":1,"1":null,"a":1,"b":null}}',
      '{"items":[{"a":1,"b":null}]}',
    ],
    probe: '1',
  });
});

test('iterables become sequences and dates become text wherever a doc call accepts them', async ({ page }) => {
  test.setTimeout(5_000);
  const expectedResult = await runFakeEchoScript(page, `
from datetime import date, datetime
values = []
values.append(doc.db.query("SELECT ? AS v", (1,))[0]["v"])
values.append(doc.db.query("SELECT ? AS v", (x for x in [2]))[0]["v"])
values.append(doc.db.query("SELECT ? AS v", [date(2026, 1, 2)])[0]["v"])
doc.plugins.call("com.example.fake-echo", "accept", {"tuple": (1, 2), "range": range(2), "when": datetime(2026, 1, 2, 3, 4, 5)})
doc.header.set("fake_date", date(2026, 1, 2))
doc.header.set("fake_range", range(3))
doc.header.set("probe", repr(values))
`, ['datetime']);
  expect(expectedResult).toMatchObject({
    ok: true,
    error: undefined,
    probe: "[1, 2, '2026-01-02']",
    received: ['{"tuple":[1,2],"range":[0,1],"when":"2026-01-02 03:04:05"}'],
    serializedProbeLines: ['fake_date: 2026-01-02', 'fake_range:'],
  });
});

test('doc calls reject arguments of the wrong type with the parameter and expected kind', async ({ page }) => {
  test.setTimeout(5_000);
  const expectedResult = await runFakeEchoScript(page, `
class FakeCard:
    pass

errors = []
def attempt(action):
    try:
        action()
        errors.append("accepted")
    except TypeError as error:
        errors.append(str(error))

attempt(lambda: doc.db.query("SELECT ?", [[1, 2]]))
attempt(lambda: doc.db.query("SELECT 1", "not params"))
attempt(lambda: doc.header.set("fake_card", FakeCard()))
attempt(lambda: doc.header.set("fake_nested", {"cards": [FakeCard()]}))
attempt(lambda: doc.header.set(5, "value"))
attempt(lambda: doc.component.set_text("fake-text", 5))
attempt(lambda: doc.plugins.call("com.example.fake-echo", "accept", {"card": FakeCard()}))
attempt(lambda: doc.plugins.call("com.example.fake-echo", "accept", ["not", "a", "mapping"]))
attempt(lambda: doc.attachments.write("fake-attachment", [1, 300]))
attempt(lambda: doc.form.set_submit_disabled("yes"))
doc.header.set("probe", "\\n".join(errors))
`);
  expect((expectedResult as { probe: string }).probe.split('\n')).toEqual([
    'doc.db.query params/0 must be text, a number, a boolean, None or a date, got list',
    'doc.db.query params must be a sequence or mapping of SQL values, got str',
    'doc.header.set value must be a JSON value, got FakeCard',
    'doc.header.set value/cards/0 must be a JSON value, got FakeCard',
    'doc.header.set key must be text, got int',
    'doc.component.set_text text must be text, got int',
    'doc.plugins.call args/card must be a JSON value or callback, got FakeCard',
    'doc.plugins.call args must be a mapping, got list',
    'doc.attachments.write bytes/1 must be an integer from 0 to 255, got int',
    'doc.form.set_submit_disabled disabled must be a boolean, got str',
  ]);
});

test('component handles convert their arguments and return handles', async ({ page }) => {
  test.setTimeout(5_000);
  const expectedResult = await runFakeEchoScript(page, `
class FakeCard:
    pass

handle = doc.tool.get_components("container")[0]
handle.set("css", "margin: 0;")
child = handle.append_child("text", {"css": "padding: 0;"}, "Fake child", "container")
out = [handle.id, handle.get("css"), child.component, child.get("text"), repr(handle.get_parent_by_tag("missing"))]
try:
    handle.set("css", FakeCard())
except TypeError as error:
    out.append(str(error))
doc.header.set("probe", " | ".join(out))
`);
  expect(expectedResult).toMatchObject({
    ok: true,
    error: undefined,
    probe: 'fake-container | margin: 0; | text | Fake child | None | handle.set value must be a JSON value, got FakeCard',
  });
});

test('attachment bytes read from the host can be written back', async ({ page }) => {
  test.setTimeout(5_000);
  const expectedResult = await runFakeEchoScript(page, `
doc.attachments.write("fake-source", b"fake bytes")
doc.attachments.write("fake-copy", doc.attachments.read("fake-source"))
doc.attachments.write("fake-list", [102, 97, 107, 101])
doc.header.set("probe", repr(list(doc.attachments.read("fake-copy"))[:4]) + " " + repr(list(doc.attachments.read("fake-list"))))
`);
  expect(expectedResult).toMatchObject({ ok: true, error: undefined, probe: '[102, 97, 107, 101] [102, 97, 107, 101]' });
});
