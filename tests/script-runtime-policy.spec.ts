import { expect, test } from '@playwright/test';

for (const source of [
  'doc.header.set("policy_mutation", True)\nvalue = doc.__class__',
  'value = "{doc.__class__}".format(doc=doc)',
  String.raw`value = f"{1:\{doc.__class__}}"`,
  ...['getattr', 'setattr', 'delattr', 'hasattr', 'eval', 'globals', 'open', 'type'].map(
    (name) => `global ${name}\ndel ${name}\n${name}("open")`,
  ),
]) {
  test(`script policy rejects source before execution: ${source}`, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Raw', exact: true }).waitFor();
    // BEFORE / TOOL CALL / AFTER: use the real script entrypoint and inspect its
    // result and document together, without depending on UI error rendering.
    const expectedResult = await page.evaluate(async (source) => {
      const { runUserScript } = await import('/src/plugins/scripting/wrapper.ts');
      const { deserializeDocument } = await import('/src/serialization.ts');
      const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
      const before = JSON.stringify(document);
      const result = await runUserScript({ document, source });
      return { result, unchanged: JSON.stringify(document) === before };
    }, source);
    expect(expectedResult.unchanged).toBe(true);
    expect(expectedResult.result).toMatchObject({
      ok: false, error: expect.stringContaining('HVY script policy:'),
      stepsExecuted: 0, toolCalls: 0,
    });
  });
}

test('computed JavaScript properties and eval inputs obey the runtime policy', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).waitFor();
  const expectedResult = await page.evaluate(async () => {
    const { runUserScript } = await import('/src/plugins/scripting/wrapper.ts');
    const { deserializeDocument } = await import('/src/serialization.ts');
    const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
    const result = await runUserScript({ document, source: `
results = []
def record(label, action):
    try:
        action()
        results.append(label + ":reached")
    except BaseException:
        results.append(label + ":blocked")

def set_item(name):
    doc.header[name] = None

def delete_item(name):
    del doc.header[name]

for name in ["constructor", "prototype", "caller", "callee", "arguments", "_" * 2 + "proto" + "_" * 2]:
    record(name + ":get", lambda: getattr(doc.header, name))
    record(name + ":set", lambda: setattr(doc.header, name, None))
    record(name + ":item", lambda: doc.header[name])
    record(name + ":item_set", lambda: set_item(name))
    record(name + ":item_delete", lambda: delete_item(name))
    record(name + ":method", lambda: getattr(doc.header.set, name))

record("computed_constructor", lambda: doc.header["con" + "structor"])
record("computed_private_get", lambda: getattr(doc, "_HvyDocProxy" + "_" * 4 + "js_doc"))
record("computed_private_set", lambda: setattr(doc, "_HvyDocProxy" + "_" * 4 + "js_doc", None))
record("computed_private_delete", lambda: delattr(doc, "_HvyDocProxy" + "_" * 4 + "js_doc"))
record("computed_private_has", lambda: getattr(doc, "_" * 2 + "class" + "_" * 2))
record("eval_fstring", lambda: eval('f"{op' + 'en(\\'probe.txt\\')}"'))
record("eval_nonstring", lambda: eval(1))
doc.header.set("runtime_policy_results", ",".join(results))
doc.header.set("private_has_result", hasattr(doc, "_" * 2 + "class" + "_" * 2))
doc.header.set("nested_fstring_result", f"{f"{1 + 2}"}")
return eval("1 + 2")
` });
    return { result, outcomes: document.meta.runtime_policy_results,
      privateHas: document.meta.private_has_result, nestedFstring: document.meta.nested_fstring_result };
  });
  expect(expectedResult.result).toMatchObject({ ok: true, returnValue: 3 });
  expect(expectedResult.privateHas).toBe(false);
  expect(expectedResult.nestedFstring).toBe('3');
  expect(expectedResult.outcomes).toBe([
    ...['constructor', 'prototype', 'caller', 'callee', 'arguments', '__proto__']
      .flatMap((name) => ['get', 'set', 'item', 'item_set', 'item_delete', 'method'].map((operation) => `${name}:${operation}:blocked`)),
    ...['computed_constructor', 'computed_private_get', 'computed_private_set', 'computed_private_delete',
      'computed_private_has', 'eval_fstring', 'eval_nonstring'].map((name) => `${name}:blocked`),
  ].join(','));
});


test('string subclasses cannot disguise private attribute names or eval source', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).waitFor();
  const expectedResult = await page.evaluate(async () => {
    const { runUserScript } = await import('/src/plugins/scripting/wrapper.ts');
    const { deserializeDocument } = await import('/src/serialization.ts');
    const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
    const result = await runUserScript({ document, source: `
class DisguisedName(str):
    def __str__(self):
        return "public"

results = []
for name in ["_HvyDocProxy" + "_" * 4 + "js_doc", "_" * 2 + "class" + "_" * 2]:
    try:
        getattr(doc, DisguisedName(name))
        results.append("attribute:reached")
    except BaseException:
        results.append("attribute:blocked")
try:
    eval(DisguisedName("open"))("probe.txt")
    results.append("eval:reached")
except BaseException:
    results.append("eval:blocked")

doc.header.set("subclass_results", ",".join(results))
class Example:
    answer = 7

doc.header.set("subclass_public", getattr(Example(), DisguisedName("answer")))
doc.header.set("subclass_eval", eval(DisguisedName("1 + 2")))
` });
    return { result, outcomes: document.meta.subclass_results,
      publicValue: document.meta.subclass_public, evalValue: document.meta.subclass_eval };
  });
  expect(expectedResult.result.ok).toBe(true);
  expect(expectedResult.outcomes).toBe('attribute:blocked,attribute:blocked,eval:blocked');
  expect(expectedResult.publicValue).toBe(7);
  expect(expectedResult.evalValue).toBe(3);
});

test('scripts may define and bind names that match restricted builtins', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).waitFor();
  const expectedResult = await page.evaluate(async () => {
    const { runUserScript } = await import('/src/plugins/scripting/wrapper.ts');
    const { deserializeDocument } = await import('/src/serialization.ts');
    const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
    const result = await runUserScript({ document, source: `
class Drawer:
    def open(self, type="drawer"):
        return type + " opened"

def describe(input, object=None):
    return input

doc.header.set("binding_result", Drawer().open(type="cabinet") + "|" + describe(input="ok"))
` });
    return { ok: result.ok, error: result.error, bindingResult: document.meta.binding_result };
  });
  expect(expectedResult).toEqual({ ok: true, error: undefined, bindingResult: 'cabinet opened|ok' });
});

test('restricted builtins fail at runtime wherever the script loads them', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).waitFor();
  const expectedResult = await page.evaluate(async () => {
    const { runUserScript } = await import('/src/plugins/scripting/wrapper.ts');
    const { deserializeDocument } = await import('/src/serialization.ts');
    const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
    const result = await runUserScript({ document, source: `
results = []
def record(label, action):
    try:
        action()
        results.append(label + ":reached")
    except BaseException:
        results.append(label + ":blocked")

class Example:
    def read(self):
        return open("probe.txt")

record("call", lambda: open("probe.txt"))
record("fstring", lambda: f"{open('probe.txt')}")
record("format_spec", lambda: f"{1:{open('probe.txt')}}")
record("method_body", lambda: Example().read())
record("eval", lambda: eval("open")("probe.txt"))
record("type", lambda: type(doc).mro())
record("vars", lambda: vars(doc))
doc.header.set("runtime_builtin_results", ",".join(results))
` });
    return { ok: result.ok, outcomes: document.meta.runtime_builtin_results };
  });
  expect(expectedResult).toEqual({
    ok: true,
    outcomes: 'call:blocked,fstring:blocked,format_spec:blocked,method_body:blocked,eval:blocked,type:blocked,vars:blocked',
  });
});
