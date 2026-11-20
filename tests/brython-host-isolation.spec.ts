import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';

const require = createRequire(import.meta.url);
const hostBrythonSource = readFileSync(require.resolve('brython/brython.min.js'), 'utf8');

test('HVY scripts run in an isolated Brython realm without colliding with or mutating a host Brython', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).waitFor();

  const expectedResult = await page.evaluate(async (brythonSource) => {
    const [{ runUserScript }, { deserializeDocument }] = await Promise.all([
      import('/src/plugins/scripting/wrapper.ts'),
      import('/src/serialization.ts'),
    ]);

    // Load an unpatched Brython onto the host window, simulating an embed host
    // that already uses Brython before HVY initializes.
    const url = URL.createObjectURL(new Blob([brythonSource], { type: 'text/javascript' }));
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.onload = () => { URL.revokeObjectURL(url); resolve(); };
      script.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load host Brython')); };
      document.head.appendChild(script);
    });
    window.brython!({ debug: 0 });

    const hostBrython = window.__BRYTHON__ as unknown as {
      jsobj2pyobj(value: unknown): unknown;
      JSObj: Record<string, unknown>;
      hvyBlockedAttributeNames?: unknown;
    };
    const hostJsObjGetAttrBefore = hostBrython.JSObj.__getattribute__;
    const hostNullBefore = hostBrython.jsobj2pyobj(null);

    const documentModel = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
    const run = await runUserScript({
      document: documentModel,
      source: `
parsed = doc.json.parse('{"missing": null}')
doc.header.set("null_ok", str(parsed["missing"] is None))
try:
    _ = parsed.constructor
    doc.header.set("guard_ok", "false")
except AttributeError:
    doc.header.set("guard_ok", "true")
`,
    });

    return {
      ok: run.ok,
      error: run.error,
      nullOk: documentModel.meta.null_ok,
      guardOk: documentModel.meta.guard_ok,
      hostNullBeforeIsNull: hostNullBefore === null,
      hostNullAfterIsNull: hostBrython.jsobj2pyobj(null) === null,
      hostJsObjUnchanged: hostBrython.JSObj.__getattribute__ === hostJsObjGetAttrBefore,
      hostBlockedNamesUntouched: hostBrython.hvyBlockedAttributeNames === undefined,
    };
  }, hostBrythonSource);

  expect(expectedResult).toEqual({
    ok: true,
    error: undefined,
    nullOk: 'True',
    guardOk: 'true',
    hostNullBeforeIsNull: true,
    hostNullAfterIsNull: true,
    hostJsObjUnchanged: true,
    hostBlockedNamesUntouched: true,
  });
});
