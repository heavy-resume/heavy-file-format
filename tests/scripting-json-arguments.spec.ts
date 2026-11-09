import { expect, test } from '@playwright/test';

// Text reaches the host as JSON, so every kind of character must arrive unchanged.
test('text arguments reach the host unchanged, whatever characters they contain', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).waitFor();

  const expectedResult = await page.evaluate(async () => {
    const [{ runUserScript }, { deserializeDocument }] = await Promise.all([
      import('/src/plugins/scripting/wrapper.ts'),
      import('/src/serialization.ts'),
    ]);
    const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
    const result = await runUserScript({
      document,
      source: `
samples = {
    "quote": 'say "fake"',
    "backslash": "fake\\\\path",
    "newline": "fake\\nline",
    "carriage": "fake\\rline",
    "tab": "fake\\tcell",
    "control": "fake\\x01\\x1fend",
    "backspace": "fake\\b\\fend",
    "unicode": "fäke ☃ 漢字",
    "emoji": "fake 😀 end 🎉",
    "json": '{"fake": ["a", 1]}',
    "empty": "",
}
checks = {}
for name, value in samples.items():
    returned = doc.db.query("SELECT ? AS value", [value])[0]["value"]
    checks[name] = returned == value and len(returned) == len(value)
doc.header.set("fake_checks", checks)
doc.header.set("fake_emoji", samples["emoji"])
`,
    });
    return { ok: result.ok, error: result.error, checks: document.meta.fake_checks, emoji: document.meta.fake_emoji };
  });

  expect(expectedResult).toEqual({
    ok: true,
    error: undefined,
    checks: { quote: true, backslash: true, newline: true, carriage: true, tab: true, control: true, backspace: true, unicode: true, emoji: true, json: true, empty: true },
    emoji: 'fake 😀 end 🎉',
  });
});
