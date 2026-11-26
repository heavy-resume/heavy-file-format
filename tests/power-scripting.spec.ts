import { expect, test } from '@playwright/test';

test('power scripts require viewer trust, can reach canvas through doc, and clean up on destroy', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    document.body.innerHTML = '<div id="powerMount"></div>';
    const modulePath = '/src/embed.ts';
    const { deserializeDocumentBytes, mountHvy, plugins } = await import(/* @vite-ignore */ modulePath);
    const source = `---
hvy_version: 0.1
---

<!--hvy: {"id":"demo"}-->
#! Demo

<!--hvy:plugin {"id":"test-canvas","plugin":"hvy.canvas","pluginConfig":{"width":320,"height":180}}-->
Placeholder canvas description.

<!--hvy:plugin {"id":"trusted-code","plugin":"hvy.power-scripting"}-->
window.__powerRuns = (window.__powerRuns || 0) + 1;
const canvas = await doc.canvas.wait("test-canvas");
window.__powerCanvasFound = Boolean(canvas);
canvas.addItem({ kind: "brush", color: "#123456", width: 2, points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] });
window.__powerStrokeAdded = canvas.getDrawing().layers.flatMap((layer) => layer.items).length;
doc.listen(window, "power-test-event", () => window.__powerEvents = (window.__powerEvents || 0) + 1);
`;
    const root = document.querySelector<HTMLElement>('#powerMount');
    if (!root) throw new Error('Mount root missing.');
    (window as Window & { testPowerMount?: ReturnType<typeof mountHvy> }).testPowerMount = mountHvy({
      root,
      document: deserializeDocumentBytes(new TextEncoder().encode(source), '.hvy'),
      mode: 'viewer',
      // The script reaches the canvas component, so the host registers both plugins.
      plugins: [plugins.powerScripting, plugins.canvas],
    });
  });

  await expect(page.getByText('This document contains unrestricted JavaScript')).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { __powerRuns?: number }).__powerRuns ?? 0)).toBe(0);

  await page.getByRole('button', { name: 'Enable power script' }).click();
  await expect.poll(() => page.evaluate(() => (window as Window & { __powerRuns?: number }).__powerRuns ?? 0)).toBe(1);
  await expect.poll(() => page.evaluate(() => {
    const roots = Array.from(document.querySelectorAll<HTMLElement>('[data-hvy-canvas-id="test-canvas"]'));
    const testWindow = window as Window & { __powerCanvasFound?: boolean; __powerStrokeAdded?: number };
    return {
      found: testWindow.__powerCanvasFound ?? false,
      added: testWindow.__powerStrokeAdded ?? 0,
      roots: roots.length,
      apis: roots.filter((root) => Boolean(root.hvyCanvas)).length,
      visible: Math.max(0, ...roots.map((root) => root.hvyCanvas?.getDrawing().layers.flatMap((layer) => layer.items).length ?? 0)),
    };
  })).toEqual({ found: true, added: 1, roots: 1, apis: 1, visible: 1 });

  await page.evaluate(() => window.dispatchEvent(new Event('power-test-event')));
  expect(await page.evaluate(() => (window as Window & { __powerEvents?: number }).__powerEvents ?? 0)).toBe(1);

  await page.evaluate(() => {
    (window as Window & { testPowerMount?: { destroy(): void } }).testPowerMount?.destroy();
    window.dispatchEvent(new Event('power-test-event'));
  });
  expect(await page.evaluate(() => (window as Window & { __powerEvents?: number }).__powerEvents ?? 0)).toBe(1);
});

test('embedded hosts can enable or hide power scripts programmatically', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<div id="enabled"></div><div id="hidden"></div>';
    const modulePath = '/src/embed.ts';
    const { deserializeDocumentBytes, mountHvy, plugins } = await import(/* @vite-ignore */ modulePath);
    const source = `---
hvy_version: 0.1
---

<!--hvy: {"id":"demo"}-->
#! Demo

<!--hvy:plugin {"id":"trusted-code","plugin":"hvy.power-scripting"}-->
window.__programmaticRuns = (window.__programmaticRuns || 0) + 1;
`;
    const makeDocument = () => deserializeDocumentBytes(new TextEncoder().encode(source), '.hvy');
    mountHvy({
      root: document.querySelector<HTMLElement>('#enabled')!,
      document: makeDocument(),
      mode: 'viewer',
      plugins: [plugins.powerScripting],
      powerScripts: 'enabled',
    });
    mountHvy({
      root: document.querySelector<HTMLElement>('#hidden')!,
      document: makeDocument(),
      mode: 'viewer',
      plugins: [plugins.powerScripting],
      powerScripts: 'hidden',
    });
    await new Promise((resolve) => window.setTimeout(resolve, 100));
    return {
      runs: (window as Window & { __programmaticRuns?: number }).__programmaticRuns ?? 0,
      hidden: document.querySelector<HTMLElement>('#hidden .hvy-power-script')?.hidden,
    };
  });

  expect(result).toEqual({ runs: 1, hidden: true });
});

test('embedded hosts own power-script acceptance across remounts', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    document.body.innerHTML = '<div id="acceptanceMount"></div>';
    const { deserializeDocumentBytes, mountHvy, plugins } = await import('/src/embed.ts');
    const source = `---
hvy_version: 0.1
---

<!--hvy: {"id":"acceptance-demo"}-->
#! Acceptance

<!--hvy:plugin {"id":"accepted-code","plugin":"hvy.power-scripting"}-->
window.__acceptedRuns = (window.__acceptedRuns || 0) + 1;
`;
    const accepted = new Set<string>();
    const options = {
      root: document.querySelector<HTMLElement>('#acceptanceMount')!,
      document: deserializeDocumentBytes(new TextEncoder().encode(source), '.hvy'),
      mode: 'viewer' as const,
      plugins: [plugins.powerScripting],
      getPowerScriptAcceptance: ({ fingerprint }: { fingerprint: string }) => accepted.has(fingerprint),
      onPowerScriptAcceptanceChanged: ({ fingerprint, accepted: value }: { fingerprint: string; accepted: boolean }) => {
        if (value) accepted.add(fingerprint);
        else accepted.delete(fingerprint);
      },
    };
    const testWindow = window as Window & { __acceptanceMount?: ReturnType<typeof mountHvy>; __acceptanceRemount?: () => void };
    testWindow.__acceptanceRemount = () => {
      testWindow.__acceptanceMount?.destroy();
      testWindow.__acceptanceMount = mountHvy({ ...options, document: deserializeDocumentBytes(new TextEncoder().encode(source), '.hvy') });
    };
    testWindow.__acceptanceMount = mountHvy(options);
  });

  await page.getByRole('button', { name: 'Enable power script' }).click();
  await expect.poll(() => page.evaluate(() => (window as Window & { __acceptedRuns?: number }).__acceptedRuns)).toBe(1);
  await page.evaluate(() => (window as Window & { __acceptanceRemount?: () => void }).__acceptanceRemount?.());
  await expect(page.getByRole('button', { name: 'Enable power script' })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as Window & { __acceptedRuns?: number }).__acceptedRuns)).toBe(2);
});

test('viewer power scripts draw canvas overlays on key input and create database tables', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  await page.evaluate(async () => {
    document.body.innerHTML = '<div id="powerMount"></div>';
    const modulePath = '/src/embed.ts';
    const { deserializeDocumentBytes, mountHvy, plugins } = await import(/* @vite-ignore */ modulePath);
    const source = `---
hvy_version: 0.1
---

<!--hvy: {"id":"demo"}-->
#! Demo

<!--hvy:plugin {"id":"overlay-script","plugin":"hvy.power-scripting"}-->
const canvas = await doc.canvas.wait("overlay-canvas");
doc.db.execute("CREATE TABLE IF NOT EXISTS placeholder_scores (id INTEGER PRIMARY KEY, score INTEGER NOT NULL)");
doc.listen(window, "keydown", (event) => {
  if (event.code !== "Space") return;
  canvas.redraw();
  const context = canvas.canvas.getContext("2d");
  context.fillStyle = "#ff0000";
  context.fillRect(0, 0, canvas.canvas.width, canvas.canvas.height);
});

<!--hvy:plugin {"id":"overlay-canvas","plugin":"hvy.canvas","pluginConfig":{"width":320,"height":180}}-->
Placeholder canvas description.
`;
    (window as Window & { testPowerMount?: ReturnType<typeof mountHvy> }).testPowerMount = mountHvy({
      root: document.querySelector<HTMLElement>('#powerMount')!,
      document: deserializeDocumentBytes(new TextEncoder().encode(source), '.hvy'),
      mode: 'viewer',
      plugins: [plugins.powerScripting, plugins.canvas, plugins.dbTable],
    });
  });
  await expect(page.locator('.hvy-canvas-toolbar:visible')).toHaveCount(0);
  await page.getByRole('button', { name: 'Enable power script' }).click();

  const readCenterPixel = () => page.locator('[data-hvy-canvas-id="overlay-canvas"] canvas').evaluate((surface: HTMLCanvasElement) => (
    [...surface.getContext('2d')!.getImageData(Math.round(surface.width / 2), Math.round(surface.height / 2), 1, 1).data]
  ));
  await expect.poll(async () => {
    await page.keyboard.press('Space');
    return readCenterPixel();
  }, { timeout: 2_000 }).toEqual([255, 0, 0, 255]);

  expect(await page.evaluate(async () => {
    const databasePath = '/src/plugins/db-table.ts';
    const { createScriptingDbRuntime } = await import(/* @vite-ignore */ databasePath);
    const mount = (window as Window & { testPowerMount: { getDocument(): unknown } }).testPowerMount;
    const database = await createScriptingDbRuntime(mount.getDocument());
    try {
      return database.api.query("SELECT name FROM sqlite_master WHERE type = 'table'").map((row: { name: string }) => row.name);
    } finally {
      database.dispose();
    }
  })).toContain('placeholder_scores');
});

test('power-script prompts render inside the HVY surface without browser dialogs and save requests require a host', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    document.body.innerHTML = '<div id="dialogMount"></div>';
    const modulePath = '/src/embed.ts';
    const { deserializeDocumentBytes, mountHvy, plugins } = await import(/* @vite-ignore */ modulePath);
    const source = `---
hvy_version: 0.1
---

<!--hvy: {"id":"dialog-demo"}-->
#! Dialog

<!--hvy:plugin {"id":"dialog-code","plugin":"hvy.power-scripting"}-->
window.__dialogResult = await doc.dialog.prompt("Pilot name", { title: "High score", value: "ACE", confirmLabel: "Save" });
window.__saveStatus = await doc.save.request({ reason: "Save the updated score?" });
`;
    mountHvy({
      root: document.querySelector<HTMLElement>('#dialogMount')!,
      document: deserializeDocumentBytes(new TextEncoder().encode(source), '.hvy'),
      mode: 'viewer',
      plugins: [plugins.powerScripting],
      powerScripts: 'enabled',
    });
  });

  const dialog = page.getByRole('dialog');
  await page.waitForTimeout(250);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox').fill('NOVA');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => page.evaluate(() => (window as Window & { __dialogResult?: string }).__dialogResult)).toBe('NOVA');
  await expect.poll(() => page.evaluate(() => (window as Window & { __saveStatus?: string }).__saveStatus)).toBe('canceled');
});

test('embedded hosts can autosave power-script document changes', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    document.body.innerHTML = '<div id="saveMount"></div>';
    const modulePath = '/src/embed.ts';
    const { deserializeDocumentBytes, mountHvy, plugins } = await import(/* @vite-ignore */ modulePath);
    const source = `---
hvy_version: 0.1
---

<!--hvy: {"id":"save-demo"}-->
#! Save

<!--hvy:plugin {"id":"save-code","plugin":"hvy.power-scripting"}-->
doc.header.set("power_save_marker", "ready");
window.__embeddedSaveStatus = await doc.save.request({ reason: "High score added" });
`;
    mountHvy({
      root: document.querySelector<HTMLElement>('#saveMount')!,
      document: deserializeDocumentBytes(new TextEncoder().encode(source), '.hvy'),
      mode: 'viewer',
      plugins: [plugins.powerScripting],
      powerScripts: 'enabled',
      onSaveRequest: async (request) => {
        const serialized = new TextDecoder().decode(await request.serializeDocumentBytesAsync());
        (window as Window & { __embeddedSaveRequest?: unknown }).__embeddedSaveRequest = {
          reason: request.reason,
          filename: request.filename,
          containsMarker: serialized.includes('power_save_marker: ready'),
        };
        return 'saved';
      },
    });
  });

  await expect.poll(() => page.evaluate(() => (window as Window & { __embeddedSaveRequest?: unknown }).__embeddedSaveRequest)).toEqual({
    reason: 'High score added',
    filename: 'resume.hvy',
    containsMarker: true,
  });
  expect(await page.evaluate(() => (window as Window & { __embeddedSaveStatus?: string }).__embeddedSaveStatus)).toBe('saved');
});

test('reference app offers download when a power script requests saving a bundled document', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"save-request-demo"}-->
#! Save request

<!--hvy:plugin {"id":"save-request-code","plugin":"hvy.power-scripting"}-->
doc.db.execute("CREATE TABLE IF NOT EXISTS save_request_scores (name TEXT)");
const pilot = await doc.dialog.prompt("Pilot name", {
  title: "New high score",
  value: "ACE",
  confirmLabel: "Save score",
});
doc.db.execute("INSERT INTO save_request_scores (name) VALUES (?)", [pilot]);
window.__referenceSaveReached = true;
window.__referenceSaveStatus = await doc.save.request({ reason: \`\${pilot} updated the document.\` });

<!--hvy:plugin {"id":"save-request-table","plugin":"hvy.db-table","pluginConfig":{"source":"with-file","table":"save_request_scores"}}-->
 SELECT name FROM save_request_scores
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Viewer' }).click();
  await page.getByRole('button', { name: 'Enable power script' }).click();
  await page.getByRole('button', { name: 'Save score' }).click();

  await expect(page.getByText('Trusted JavaScript enabled')).toHaveCount(0);
  await expect(page.getByText('Power script running.')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as Window & { __referenceSaveReached?: boolean }).__referenceSaveReached)).toBe(true);
  await expect(page.getByRole('heading', { name: 'Download updated document?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download updated file' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
});

test('power-script click callbacks read and write the current database between other writers', async ({ page }) => {
  await page.goto('/');
  // BEFORE
  await page.evaluate(async () => {
    document.body.innerHTML = '<div id="callbackDbMount"></div>';
    const modulePath = '/src/embed.ts';
    const { deserializeDocumentBytes, mountHvy, plugins } = await import(/* @vite-ignore */ modulePath);
    const addClickButton = (id: string, source: string) => `
const button = document.createElement("button");
button.id = "${id}";
button.textContent = "${id}";
doc.listen(button, "click", () => {
  doc.db.execute("CREATE TABLE IF NOT EXISTS fake_clicks (source TEXT)");
  doc.db.execute("INSERT INTO fake_clicks (source) VALUES (?)", ["${source}"]);
  window.__fakeClickRows = doc.db.query("SELECT source FROM fake_clicks ORDER BY rowid").map((row) => row.source);
});
document.body.appendChild(button);
`;
    const source = `---
hvy_version: 0.1
---

<!--hvy: {"id":"callback-db"}-->
#! Callback DB

<!--hvy:plugin {"id":"writer-a","plugin":"hvy.power-scripting"}-->
${addClickButton('fake-writer-a', 'A')}

<!--hvy:plugin {"id":"writer-b","plugin":"hvy.power-scripting"}-->
${addClickButton('fake-writer-b', 'B')}
`;
    mountHvy({
      root: document.querySelector<HTMLElement>('#callbackDbMount')!,
      document: deserializeDocumentBytes(new TextEncoder().encode(source), '.hvy'),
      mode: 'viewer',
      plugins: [plugins.powerScripting],
      powerScripts: 'enabled',
    });
  });

  // ACTION
  await page.locator('#fake-writer-a').click();
  await page.locator('#fake-writer-b').click();
  await page.locator('#fake-writer-a').click();

  // AFTER
  expect(await page.evaluate(() => (window as Window & { __fakeClickRows?: string[] }).__fakeClickRows)).toEqual(['A', 'B', 'A']);
});
