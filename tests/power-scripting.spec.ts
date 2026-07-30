import { expect, test } from '@playwright/test';

test('power scripts require viewer trust, can reach canvas through doc, and clean up on destroy', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    document.body.innerHTML = '<div id="powerMount"></div>';
    const modulePath = '/src/embed.ts';
    const { deserializeDocumentBytes, mountHvy } = await import(/* @vite-ignore */ modulePath);
    const source = `---
hvy_version: 0.1
---

<!--hvy: {"id":"demo"}-->
#! Demo

<!--hvy:plugin {"id":"test-canvas","plugin":"hvy.canvas","pluginConfig":{"width":320,"height":180}}-->
{"version":1,"strokes":[]}

<!--hvy:plugin {"id":"trusted-code","plugin":"hvy.power-scripting"}-->
window.__powerRuns = (window.__powerRuns || 0) + 1;
const canvas = await doc.canvas.wait("test-canvas");
window.__powerCanvasFound = Boolean(canvas);
canvas.addStroke({ color: "#123456", width: 2, points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] });
window.__powerStrokeAdded = canvas.getDrawing().strokes.length;
doc.listen(window, "power-test-event", () => window.__powerEvents = (window.__powerEvents || 0) + 1);
`;
    const root = document.querySelector<HTMLElement>('#powerMount');
    if (!root) throw new Error('Mount root missing.');
    (window as Window & { testPowerMount?: ReturnType<typeof mountHvy> }).testPowerMount = mountHvy({
      root,
      document: deserializeDocumentBytes(new TextEncoder().encode(source), '.hvy'),
      mode: 'viewer',
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
      visible: Math.max(0, ...roots.map((root) => root.hvyCanvas?.getDrawing().strokes.length ?? 0)),
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
    const { deserializeDocumentBytes, mountHvy } = await import(/* @vite-ignore */ modulePath);
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
      powerScripts: 'enabled',
    });
    mountHvy({
      root: document.querySelector<HTMLElement>('#hidden')!,
      document: makeDocument(),
      mode: 'viewer',
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
    const { deserializeDocumentBytes, mountHvy } = await import('/src/embed.ts');
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

test('Asteroids example launches on the canvas and initializes its SQL high-score table', async ({ page }) => {
  await page.goto('/');
  await page.locator('.document-menu summary').click();
  await page.locator('.document-menu-panel').getByRole('button', { name: 'Asteroids', exact: true }).click({ force: true });
  await page.getByRole('button', { name: 'Viewer' }).click();
  await expect(page.locator('.hvy-canvas-toolbar:visible')).toHaveCount(0);
  await page.getByRole('button', { name: 'Enable power script' }).click();

  await expect(page.locator('.db-table-frame-readonly')).toBeVisible();
  const beforeLaunch = await page.locator('[data-hvy-canvas-id="asteroids-canvas"] canvas').evaluate(
    (canvas) => (canvas as HTMLCanvasElement).toDataURL()
  );
  await page.keyboard.press('Space');
  await page.waitForTimeout(100);
  const afterLaunch = await page.locator('[data-hvy-canvas-id="asteroids-canvas"] canvas').evaluate(
    (canvas) => (canvas as HTMLCanvasElement).toDataURL()
  );

  expect(afterLaunch).not.toBe(beforeLaunch);
  const tables = await page.evaluate(async () => {
    const statePath = '/src/state.ts';
    const databasePath = '/src/plugins/db-table.ts';
    const { state } = await import(/* @vite-ignore */ statePath);
    const { createScriptingDbRuntime } = await import(/* @vite-ignore */ databasePath);
    const database = await createScriptingDbRuntime(state.document);
    try {
      return database.api.query("SELECT name FROM sqlite_master WHERE type = 'table'").map((row) => row.name);
    } finally {
      database.dispose();
    }
  });
  expect(tables).toContain('asteroid_high_scores');
  expect(await page.evaluate(async () => {
    const statePath = '/src/state.ts';
    const { state } = await import(/* @vite-ignore */ statePath);
    return state.document.sections[0]?.blocks
      .filter((block) => block.schema.component === 'plugin')
      .map((block) => block.schema.plugin);
  })).toEqual(['hvy.power-scripting', 'hvy.canvas']);

  await page.locator('.document-menu').evaluate((menu) => {
    if (menu instanceof HTMLDetailsElement) menu.open = true;
  });
  await page.locator('.document-menu-panel').getByRole('button', { name: 'Default Example', exact: true }).click({ force: true });
  await expect(page.locator('#downloadName')).toHaveValue('example.hvy');
  await page.locator('.document-menu summary').click();
  await page.locator('.document-menu-panel').getByRole('button', { name: 'Asteroids', exact: true }).click({ force: true });

  await expect(page.getByRole('button', { name: 'Enable power script' })).toHaveCount(0);
  await expect(page.locator('[data-hvy-canvas-id="asteroids-canvas"] canvas')).toBeVisible();
});

test('canvas editor has square brush tools, quick sizes, and vector erasing', async ({ page }) => {
  await page.goto('/');
  await page.locator('.document-menu summary').click();
  await page.locator('.document-menu-panel').getByRole('button', { name: 'Asteroids', exact: true }).click({ force: true });
  await page.getByRole('button', { name: 'Editor' }).click();

  const brush = page.getByRole('button', { name: 'Brush', exact: true });
  const eraser = page.getByRole('button', { name: 'Eraser', exact: true });
  await expect(brush).toBeVisible();
  await expect(eraser).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fill canvas', exact: true })).toBeVisible();
  const dimensions = await brush.evaluate((button) => {
    const bounds = button.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height };
  });
  expect(Math.abs(dimensions.width - dimensions.height)).toBeLessThan(1);

  await eraser.click();
  await expect(eraser).toHaveAttribute('aria-pressed', 'true');
  const largeSize = page.getByRole('button', { name: 'Brush size 16' });
  await largeSize.click();
  await expect(largeSize).toHaveAttribute('aria-pressed', 'true');
  const canvas = page.locator('[data-hvy-canvas-id="asteroids-canvas"] canvas');
  await canvas.hover({ position: { x: 200, y: 120 } });
  await expect(page.locator('.hvy-canvas-cursor-preview')).toBeVisible();
  const cursorDimensions = await page.locator('.hvy-canvas-cursor-preview').evaluate((cursor) => {
    const bounds = cursor.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height };
  });
  expect(cursorDimensions.width).toBeGreaterThan(2);
  expect(Math.abs(cursorDimensions.width - cursorDimensions.height)).toBeLessThan(1);

  expect(await canvas.evaluate((surface) => {
    const root = surface.closest<HTMLElement>('[data-hvy-canvas-id]');
    if (!root?.hvyCanvas) throw new Error('Canvas API missing.');
    root.hvyCanvas.addStroke({
      color: '#123456',
      width: 4,
      points: [{ x: 10, y: 10 }, { x: 20, y: 20 }],
    });
    let renderCount = 0;
    root.addEventListener('hvy:canvas:render', () => {
      renderCount += 1;
    });
    root.hvyCanvas.undo();
    return renderCount;
  })).toBe(1);
  expect(await page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    const block = state.document.sections
      .flatMap((section) => section.blocks)
      .find((candidate) => candidate.schema.id === 'asteroids-canvas');
    const attachment = state.document.attachments.find((candidate) => candidate.id === 'canvas:asteroids-canvas');
    return {
      text: block?.text,
      mediaType: attachment?.meta.mediaType,
      drawing: attachment ? JSON.parse(new TextDecoder().decode(attachment.bytes)) : null,
    };
  })).toEqual({
    text: 'Asteroids game surface. The power script renders gameplay here in Viewer mode.',
    mediaType: 'application/vnd.hvy.canvas+json',
    drawing: { version: 1, strokes: [] },
  });
});

test('power-script prompts render inside the HVY surface without browser dialogs and save requests require a host', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    document.body.innerHTML = '<div id="dialogMount"></div>';
    const modulePath = '/src/embed.ts';
    const { deserializeDocumentBytes, mountHvy } = await import(/* @vite-ignore */ modulePath);
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
    const { deserializeDocumentBytes, mountHvy } = await import(/* @vite-ignore */ modulePath);
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
  await page.getByRole('button', { name: 'Raw' }).click();
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
