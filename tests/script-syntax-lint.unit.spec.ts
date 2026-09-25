import { expect, test } from 'vitest';
import { createHvyCliSession, executeHvyCliCommand } from '../src/cli-core/commands';
import { deserializeDocument, serializeDocument } from '../src/serialization';

function scriptDocument(source: string, plugin = 'hvy.scripting') {
  return deserializeDocument(`---
hvy_version: 0.1
---
<!--hvy: {"id":"syntax-probe"}-->
#! Syntax probe

<!--hvy:plugin {"id":"probe-script","plugin":"${plugin}"}-->
${source}
`, '.hvy');
}

test.each([
  ['unclosed quote', 'value = "unfinished'],
  ['broken escaping', String.raw`value = str(value).replace("\", "\\")`],
  ['newline inside a string', 'value = "first\nsecond"'],
  ['missing colon', 'if True\n    pass'],
  ['missing indentation', 'if True:\npass'],
  ['unclosed bracket', 'values = [1, 2'],
  ['mismatched brackets', 'values = [1, 2)'],
  ['invalid control flow', 'break'],
])('hvy lint reports Python syntax errors: %s', async (_name, source) => {
  // BEFORE
  const document = scriptDocument(source);
  const before = serializeDocument(document);

  // TOOL CALL
  const result = await executeHvyCliCommand(document, createHvyCliSession(), 'hvy lint');

  // AFTER
  expect(result.output).toContain('/body/syntax-probe/probe-script');
  expect(result.output).toMatch(/script\.py: line \d+, column \d+/);
  expect(result.output).toMatch(/SyntaxError|IndentationError/);
  expect(serializeDocument(document)).toBe(before);
});

test('hvy lint preserves source line and column numbers', async () => {
  const document = scriptDocument('value = 1\nvalue = "unfinished');

  const result = await executeHvyCliCommand(document, createHvyCliSession(), 'hvy lint');

  expect(result.output).toContain('script.py: line 2, column 9');
});

test('hvy lint validates power scripts', async () => {
  const document = scriptDocument('value = "unfinished', 'hvy.power-scripting');

  const result = await executeHvyCliCommand(document, createHvyCliSession(), 'hvy lint');

  expect(result.output).toContain('plugin.txt: line 1, column 9');
  expect(result.output).toContain('SyntaxError');
});

test('hvy lint validates every named form script after decoding YAML', async () => {
  const document = scriptDocument(`fields: []
scripts:
  probe_first: |
    return 1
  probe_second: |
    value = 1
    value = "unfinished
  probe_third: |
    values = [1, 2
`, 'hvy.form');

  const result = await executeHvyCliCommand(document, createHvyCliSession(), 'hvy lint');

  expect(result.output).toContain('plugin.txt script "probe_second": line 2, column 9');
  expect(result.output).toContain('plugin.txt script "probe_third": line 1, column');
  expect(result.output).not.toContain('script "probe_first":');
});

test('hvy lint clears the syntax diagnostic after the script is repaired', async () => {
  // BEFORE
  const document = scriptDocument('value = "unfinished');
  const session = createHvyCliSession();
  expect((await executeHvyCliCommand(document, session, 'hvy lint')).output).toContain('SyntaxError');

  // TOOL CALL
  await executeHvyCliCommand(document, session, "printf 'return 1' > /id/probe-script/script.py");

  // AFTER
  expect((await executeHvyCliCommand(document, session, 'hvy lint')).output).toBe('No lint issues.');
});

test.each(['hvy.scripting', 'hvy.power-scripting'])('hvy lint compiles %s without executing or rejecting valid Python', async (plugin) => {
  const document = scriptDocument(String.raw`# An unmatched quote in a comment is fine: "
text = "escaped quote: \" and backslash: \\ and newline: \n"
multiline = """first
second"""
values = [
    1,
    2,
]
def nested(value):
    return f"value: {value}"
doc.header.set("title", "must not execute")
raise Exception("must not execute")
return nested(values)
`, plugin);
  const before = serializeDocument(document);

  const result = await executeHvyCliCommand(document, createHvyCliSession(), 'hvy lint');

  expect(result.output).toBe('No lint issues.');
  expect(serializeDocument(document)).toBe(before);
});
