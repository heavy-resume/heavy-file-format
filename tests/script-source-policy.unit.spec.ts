import { expect, test } from 'vitest';
import { checkScriptSourcePolicy } from '../src/plugins/scripting/script-source-policy';
import { runUserScript } from '../src/plugins/scripting/wrapper';

test.each([
  'doc.__class__', 'doc._HvyDocProxy____js_doc', 'value = "{doc.__class__}"',
  'getattr(doc, "__globals__")', 'eval("__import__(\'browser\')")',
  'global eval\ndel eval', 'global value, getattr\ndel getattr',
  'global value, \\\n    globals', 'global ｅｖａｌ',
  'global open\ndel open', 'global value, type', 'global ｏｐｅｎ',
  'doc.＿＿class＿＿',
  String.raw`getattr(doc, "\x5f\x5fglobals\x5f\x5f")`,
  String.raw`getattr(doc, "_\137globals\U0000005f\x5f")`,
  String.raw`getattr(doc, "\N{LOW LINE}\N{low line}globals\N{LOW LINE}\N{LOW LINE}")`,
  'f"{doc.header.get(\'x\').__class__}"', 'f"{doc.__class__}"', 'f"{f"{doc.__class__}"}"',
  'f"{doc.header.get("title").__class__}"', 'f"{1:{doc.__class__}}"',
  String.raw`f"{1:\{doc.__class__}}"`,
  'f"{1!r:{doc.__class__}}"', 'f"{doc.__class__=}"',
  'f"""{ # comment\n doc.__class__ }"""', String.raw`f"\{doc.__class__}"`,
  'f"{ {"key": doc.__class__} }"',
  'f"{[value for value in doc.__class__]}"',
  'f"literal __globals__ {1}"',
])('source policy rejects restricted code: %s', (source) => {
  expect(checkScriptSourcePolicy(source)).toMatchObject({ name: 'ScriptPolicyError' });
});

test.each([
  '# __globals__ open type\nreturn 1',
  'class Example:\n    def __init__(self):\n        self.value = 7\n    @classmethod\n    def name(cls):\n        return cls.__name__',
  'def __custom__(value):\n    return value', 'class __Custom__:\n    pass',
  'if __name__ == "__main__":\n    return 1',
  'doc.header.open = "value"', 'value = "open type object"',
  'f"{doc.header.get("title")}"', 'f"{ {"key": 1} }"',
  'f"{f"{1 + 2}"}"', 'f"{{literal}}"', 'f"{1:{2}}"', 'f"{1!r:10}"',
  'r"escaped quote: \\" text"', 'values = [\n    1,\n    2,\n]',
  'global ordinary\nordinary = 1',
  'class Example:\n    def open(self):\n        return 1\nExample().open()',
  'def describe(type, input=None):\n    return type + str(input)',
  'for type in ["a", "b"]:\n    print(type)',
])('source policy preserves ordinary Python: %s', (source) => {
  expect(checkScriptSourcePolicy(source)).toBeNull();
});

test.each([
  'open("x")', 'value = type(doc)', 'vars(doc)', 'f"{open("x")}"', 'eval("open")',
])('restricted builtin loads are left to the runtime stubs: %s', (source) => {
  expect(checkScriptSourcePolicy(source)).toBeNull();
});

test('policy diagnostics use original source coordinates', () => {
  expect(checkScriptSourcePolicy('answer = 1\nvalue = doc.__class__')).toMatchObject({ line: 2, column: 13 });
});

test('rejected scripts do not initialize Brython or mutate the document', async () => {
  const document = { meta: {}, extension: '.hvy' as const, sections: [], attachments: [] };
  expect(await runUserScript({ document, source: 'doc.header.set("changed", True)\nvalue = doc.__class__' }))
    .toMatchObject({ ok: false, error: expect.stringContaining("private name '__class__'"), toolCalls: 0, stepsExecuted: 0 });
  expect(document.meta).toEqual({});
});
