import { expect, test, type Page } from '@playwright/test';

async function selectDocumentMenuItem(page: Page, name: string): Promise<void> {
  await expect(page.locator('#downloadName')).toHaveValue(/.+\.(hvy|thvy)$/);
  await page.locator('.document-menu').evaluate((menu) => {
    if (menu instanceof HTMLDetailsElement) {
      menu.open = true;
    }
  });
  const item = page.locator('.document-menu-panel').getByRole('button', { name, exact: true });
  await expect(item).toBeVisible();
  await item.click({ force: true });
}

test('AI form submit applies generated card data through a component template', async ({ page }) => {
  test.setTimeout(5000);
  let requestCount = 0;
  await page.route('**/api/chat', async (route) => {
    const payload = route.request().postDataJSON() as { context?: string };
    requestCount += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        output: payload.context?.includes('Widget basics')
          ? requestCount === 1
            ? '[{"source_id":"widget-basics","question":"What is Widget basics?","answer":"Widget basics are source-backed study material."}]'
            : '[{"source_id":"widget-basics","question":"How can Widget basics be reviewed again?","answer":"A reusable form submit can run again and append another templated card."}]'
          : '',
      }),
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(String.raw`---
hvy_version: 0.1
plugins:
  - id: hvy.form
    source: builtin://form
component_defs:
  - name: flashcard-card
    baseType: expandable
    templateVariables:
      question:
        label: Question
      answer:
        label: Answer
    schema:
      tags: generated-flashcard
      expandableAlwaysShowStub: true
      expandableExpanded: false
      expandableStubBlocks:
        children:
          - text: "{% question | block %}"
            schema:
              component: text
      expandableContentBlocks:
        children:
          - text: "{% answer | block %}"
            schema:
              component: text
---

<!--hvy: {"id":"main"}-->
#! Main

 <!--hvy:text {"id":"source"}-->
  Widget basics

 <!--hvy:plugin {"id":"generator","plugin":"hvy.form","pluginConfig":{"version":"0.1","submitAction":"ai-generate","submitScript":"apply","submitLabel":"Generate cards","submitPrompt":"Return one JSON card record.","submitOutputCharLimit":2000}}-->
  fields:
    - label: Topic
      type: text
      value: Widget basics
  scripts:
    apply: |
      def read_json_string(source, key, default_value=""):
          marker = '"' + key + '"'
          start = source.find(marker)
          if start < 0:
              return default_value
          colon = source.find(":", start + len(marker))
          quote = source.find('"', colon + 1)
          index = quote + 1
          value = ""
          escaped = False
          while index < len(source):
              char = source[index]
              if escaped:
                  value += "\n" if char == "n" else char
                  escaped = False
              elif char == "\\":
                  escaped = True
              elif char == '"':
                  return value
              else:
                  value += char
              index += 1
          return default_value
      def json_escape(value):
          return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
      question = read_json_string(response, "question")
      answer = read_json_string(response, "answer")
      values_json = '{"question":"' + json_escape(question) + '","answer":"' + json_escape(answer) + '"}'
      existing_count = 0
      for component in doc.tool.get_components("flashcard-card"):
          if component.section_id == "main" and component.has_tag("generated-flashcard"):
              existing_count += 1
      doc.cli.run("hvy insert -1 flashcard-card /body/main --id flashcard-widget-basics-" + str(existing_count + 1) + " --using-template '" + values_json + "'")
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Viewer' }).click();

  await page.getByRole('button', { name: 'Generate cards' }).click({ timeout: 1000 });

  await expect(page.locator('#readerDocument')).toContainText('What is Widget basics?', { timeout: 1000 });
  await page.getByText('What is Widget basics?').click({ timeout: 1000 });
  await expect(page.locator('#readerDocument')).toContainText('Widget basics are source-backed study material.', { timeout: 1000 });

  await expect(page.getByRole('button', { name: 'Generate cards' })).toBeVisible({ timeout: 1000 });
  await page.getByRole('button', { name: 'Generate cards' }).click({ timeout: 1000 });
  await expect(page.locator('#readerDocument')).toContainText('How can Widget basics be reviewed again?', { timeout: 1000 });
});

test('flashcards generator form remains mounted after sidebar reader refresh', async ({ page }) => {
  test.setTimeout(5000);
  await page.route('**/api/chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        output: '[{"source_id":"concept-model","question":"What does the source material say Heavy documents contain?","answer":"They contain sections and reusable components."},{"source_id":"scripting-runtime","question":"What does a form submit target script receive?","answer":"It receives the generated response and source values."}]',
      }),
    });
  });

  await page.goto('/');
  await selectDocumentMenuItem(page, 'Flashcards Example');
  await page.getByRole('button', { name: 'Viewer' }).click();
  await page.locator('.viewer-sidebar-tab').click({ timeout: 1000 });

  const generateButton = page.getByRole('button', { name: 'Generate flashcards' });
  await expect(generateButton).toBeVisible({ timeout: 1000 });
  await generateButton.click({ timeout: 1000 });

  await expect(page.locator('#readerSidebarSections')).toContainText('What does the source material say Heavy documents contain?', { timeout: 2000 });
  await expect(generateButton).toBeVisible({ timeout: 1000 });
  await expect(
    page.locator('#flashcard-generator-form [data-hvy-plugin-mount="true"]')
  ).toHaveCount(0);

  const generatedCards = page.locator('#readerSidebarSections .reader-block-expandable[data-component-id^="flashcard-"]');
  await expect(generatedCards).toHaveCount(2);
  await expect(generatedCards.first()).toContainText('What does the source material say Heavy documents contain?');
  await expect(generatedCards.first()).toHaveCSS('min-height', '128px');
  await expect(generatedCards.first()).not.toHaveCSS('border-top-style', 'none');

  await page.getByRole('button', { name: 'Shuffle cards' }).click({ timeout: 1000 });
  await expect(generatedCards.first()).toContainText('What does a form submit target script receive?', { timeout: 1000 });
});

test('editor-only generate button applies pronunciation and stays out of viewer', async ({ page }) => {
  await page.route('**/api/chat', async (route) => {
    const payload = route.request().postDataJSON() as { context?: string };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        output: payload.context?.includes('Avery Hart') ? 'AY-vuh-ree HART' : 'UNKNOWN',
      }),
    });
  });

  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Resume Template' }).click();

  await expect(page.locator('[data-component-id="resume-pronunciation"]').first()).toBeHidden({ timeout: 1_000 });
  await expect(page.locator('[data-action="run-button-ai-generate"]')).toBeHidden();

  await page.getByRole('button', { name: 'Raw' }).click();

  const raw = page.locator('#rawEditor');
  await raw.fill((await raw.inputValue()).replace('# <!-- value {"placeholder":"Name"} -->', '# Avery Hart'));
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  const generateButton = page.locator('[data-action="run-button-ai-generate"]');
  await expect(generateButton).toBeVisible({ timeout: 1_000 });

  await generateButton.click();
  await expect(page.locator('#editorTree')).toContainText('[AY-vuh-ree HART]');
  await expect(generateButton).toBeHidden({ timeout: 1_000 });

  await page.getByRole('button', { name: 'Viewer' }).click();
  await expect(page.locator('[data-action="run-button-ai-generate"]')).toHaveCount(0);
  await expect(page.locator('#readerDocument')).toContainText('[AY-vuh-ree HART]');
});

test('generate button runs on the first click after completing a fill-in', async ({ page }) => {
  await page.route('**/api/chat', async (route) => {
    const payload = route.request().postDataJSON() as { context?: string };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        output: payload.context?.includes('Avery Hart') ? 'AY-vuh-ree HART' : 'UNKNOWN',
      }),
    });
  });

  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Resume Template' }).click();

  await page.locator('.editor-block-passive .editor-block-content[data-component-id="resume-name"] .text-fill-in-box').click();
  const nameFillIn = page.locator('.editor-block:has(.editor-block-content[data-component-id="resume-name"]) [data-field="text-fill-in-value"]');
  await nameFillIn.fill('Avery Hart');

  const generateButton = page.locator('[data-action="run-button-ai-generate"]');
  await expect(generateButton).toBeVisible({ timeout: 1_000 });
  await generateButton.click();

  await expect(page.locator('#editorTree')).toContainText('[AY-vuh-ree HART]');
});

test('generate button shows disabled busy state while pronunciation is generating', async ({ page }) => {
  let releaseGeneration: (() => void) | null = null;
  await page.route('**/api/chat', async (route) => {
    await new Promise<void>((resolve) => {
      releaseGeneration = resolve;
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ output: 'AY-vuh-ree HART' }),
    });
  });

  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Resume Template' }).click();

  await page.locator('.editor-block-passive .editor-block-content[data-component-id="resume-name"] .text-fill-in-box').click();
  await page.locator('.editor-block:has(.editor-block-content[data-component-id="resume-name"]) [data-field="text-fill-in-value"]').fill('Avery Hart');

  const generateButton = page.locator('[data-action="run-button-ai-generate"]');
  await expect(generateButton).toBeVisible({ timeout: 1_000 });
  await generateButton.click();

  await expect(generateButton).toBeDisabled();
  await expect(generateButton).toHaveText('Generating...');
  await expect(generateButton).toHaveCSS('cursor', 'wait');
  const busyButtonHost = generateButton.locator('xpath=ancestor::*[@data-hvy-button="true"][1]');
  await expect(busyButtonHost).toHaveAttribute('data-busy-state', 'busy');
  await expect(busyButtonHost).toHaveAttribute('aria-busy', 'true');
  await expect(busyButtonHost).not.toHaveCSS('box-shadow', 'none');

  releaseGeneration?.();
  await expect(page.locator('#editorTree')).toContainText('[AY-vuh-ree HART]');
});

test('generated pronunciation can be converted back into a clean fill-in', async ({ page }) => {
  await page.route('**/api/chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ output: 'AY-vuh-ree HART' }),
    });
  });

  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Resume Template' }).click();
  await page.getByRole('button', { name: 'Raw' }).click();

  const raw = page.locator('#rawEditor');
  await raw.fill((await raw.inputValue()).replace('# <!-- value {"placeholder":"Name"} -->', '# Avery Hart'));
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('[data-action="run-button-ai-generate"]').click();
  await expect(page.locator('#editorTree')).toContainText('[AY-vuh-ree HART]');

  await page.locator('[data-component-id="resume-pronunciation"]').first().click();
  await expect(page.locator('.rich-editor[data-field="block-rich"]')).toBeVisible();
  await page.locator('.rich-editor[data-field="block-rich"]').evaluate((editable) => {
    editable.innerHTML = '<p>[FILL ME IN]</p>';
    editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const textNode = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT).nextNode();
    if (!textNode?.textContent) return;
    const start = textNode.textContent.indexOf('FILL ME IN');
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + 'FILL ME IN'.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.locator('.rich-editor[data-field="block-rich"]').dispatchEvent('keyup');
  await page.getByRole('button', { name: 'Convert to Fill-in' }).click();

  const pronunciationFillIn = page.locator('.editor-block:has(.editor-block-content[data-component-id="resume-pronunciation"]) [data-field="text-fill-in-value"]');
  await expect(pronunciationFillIn).toHaveAttribute('data-placeholder', 'FILL ME IN');
  await expect(page.locator('.editor-block:has(.editor-block-content[data-component-id="resume-pronunciation"]) .text-fill-in-editor')).toHaveText('[]');
  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).toContainText('\\[<!-- value {"placeholder":"FILL ME IN"} -->\\]');
  await expect(page.locator('#rawEditor')).toContainText('"placeholder":"FILL ME IN"');
  await expect(page.locator('#rawEditor')).not.toContainText('"placeholder":"pronunciation"');
});

test('advanced editor exposes anchored button configuration as a component card', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Resume Template' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();

  const buttonCard = page.locator('.editor-block-passive', { hasText: 'Button: Generate anchored to resume-pronunciation' });
  await expect(buttonCard).toBeVisible();
  await buttonCard.click();

  const preview = page.locator('[aria-label="Button preview"]');
  const settings = page.locator('[aria-label="Button settings"]');
  await expect(preview).toBeVisible();
  await expect(page.locator('[aria-label="Button settings"]')).toBeVisible();
  await expect(page.locator('[data-field="block-button-position-target-id"]')).toHaveValue('resume-pronunciation');
  await expect(page.locator('[data-field="block-button-prompt"]')).toContainText('Generate a concise pronunciation guide');

  const previewButton = preview.locator('.hvy-button-component');
  await expect(previewButton).toBeVisible();
  await expect(preview.locator('.button-component-preview-stage')).toBeVisible();

  const previewBox = await preview.boundingBox();
  const buttonBox = await previewButton.boundingBox();
  const visibleScriptBox = await settings.locator('[data-field="block-button-visible-script"]').boundingBox();

  expect(previewBox).not.toBeNull();
  expect(buttonBox).not.toBeNull();
  expect(visibleScriptBox).not.toBeNull();
  expect(buttonBox!.y + buttonBox!.height).toBeLessThan(visibleScriptBox!.y);
  expect(buttonBox!.y).toBeGreaterThanOrEqual(previewBox!.y);
});

test('embedded editor and viewer keep independent document state', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/examples/two-embedded-docs.html');
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });

  const firstDoc = page.locator('#docOne');
  const secondDoc = page.locator('#docTwo');
  await expect(firstDoc.locator('#editorTree')).toBeVisible({ timeout: 1_000 });
  await expect(firstDoc.locator('#editorTree')).toContainText('Current Goal');
  await expect(secondDoc.locator('#readerDocument')).toBeVisible();
  await expect(secondDoc.locator('#editorTree')).toHaveCount(0);
  await expect(secondDoc.locator('.viewer-sidebar-help-balloon')).toBeVisible();

  await secondDoc.locator('.viewer-sidebar-help-balloon').click();
  await expect(secondDoc.locator('.viewer-sidebar-help-balloon')).toHaveClass(/is-closing/);
  await page.waitForTimeout(220);
  await expect(secondDoc.locator('.viewer-sidebar-help-balloon')).toHaveCount(0);
  await secondDoc.locator('.viewer-sidebar-tab').click();
  await expect(secondDoc.locator('.viewer-shell')).toHaveClass(/is-sidebar-open/);
  await expect(secondDoc.locator('.viewer-sidebar-panel')).toContainText('Skills');
  await secondDoc.locator('.viewer-sidebar-tab').click();
  await expect(secondDoc.locator('.viewer-shell')).toHaveClass(/is-sidebar-closed/);
});

test('embedded editor remains in editor view after activating a component beside a viewer mount', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/examples/two-embedded-docs.html');
  await page.evaluate(() => sessionStorage.clear());
  await page.getByRole('button', { name: 'Reset sessions' }).click();

  const firstDoc = page.locator('#docOne');
  const secondDoc = page.locator('#docTwo');
  await expect(firstDoc.locator('#editorTree')).toBeVisible({ timeout: 1_000 });
  await expect(secondDoc.locator('#readerDocument')).toBeVisible({ timeout: 1_000 });

  await firstDoc.locator('.editor-block-passive').first().click();

  await expect(firstDoc.locator('#editorTree')).toBeVisible();
  await expect(firstDoc.locator('#readerDocument')).toHaveCount(0);
  await expect(firstDoc.locator('.editor-block[data-active-editor-block="true"]')).toBeVisible();
  await firstDoc.locator('.chat-launcher').click();
  await expect(firstDoc.locator('.chat-panel')).toHaveClass(/is-document-edit/);
});

test('embedded editor remains in editor view after switching from viewer back to editor', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/examples/two-embedded-docs.html');
  await page.evaluate(() => sessionStorage.clear());
  await page.getByRole('button', { name: 'Reset sessions' }).click();

  const firstDoc = page.locator('#docOne');
  await expect(firstDoc.locator('#editorTree')).toBeVisible({ timeout: 1_000 });

  await page.locator('[data-doc-one-mode="viewer"]').click();
  await expect(firstDoc.locator('#readerDocument')).toBeVisible({ timeout: 1_000 });
  await expect(page.locator('[data-doc-one-mode="viewer"]')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('[data-doc-one-mode="editor"]').click();
  await expect(firstDoc.locator('#editorTree')).toBeVisible({ timeout: 1_000 });
  await expect(page.locator('[data-doc-one-mode="editor"]')).toHaveAttribute('aria-pressed', 'true');

  await firstDoc.getByText('Land three strong interviews this month', { exact: false }).click();

  await expect(firstDoc.locator('#editorTree')).toBeVisible();
  await expect(firstDoc.locator('#readerDocument')).toHaveCount(0);
  await expect(firstDoc.locator('.editor-block[data-active-editor-block="true"]').first()).toBeVisible();
});

test('embedded AI remains in document edit mode after switching from viewer to AI', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/examples/two-embedded-docs.html');
  await page.evaluate(() => sessionStorage.clear());
  await page.getByRole('button', { name: 'Reset sessions' }).click();

  const firstDoc = page.locator('#docOne');
  await expect(firstDoc.locator('#editorTree')).toBeVisible({ timeout: 1_000 });

  await page.locator('[data-doc-one-mode="viewer"]').click();
  await expect(firstDoc.locator('#readerDocument')).toBeVisible({ timeout: 1_000 });
  await expect(page.locator('[data-doc-one-mode="viewer"]')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('[data-doc-one-mode="ai"]').click();
  await expect(firstDoc.locator('#aiReaderDocument')).toBeVisible({ timeout: 1_000 });
  await expect(page.locator('[data-doc-one-mode="ai"]')).toHaveAttribute('aria-pressed', 'true');

  await firstDoc.locator('#aiReaderDocument [data-action="add-top-level-section"][data-section-key="__top_level__"]').click();
  await expect(firstDoc.locator('#aiReaderDocument .editor-block[data-active-editor-block="true"]').first()).toBeVisible();

  await firstDoc.locator('.chat-launcher').click();
  await expect(firstDoc.locator('.chat-panel')).toHaveClass(/is-document-edit/);
});

test('two embedded docs can switch example sources independently', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/examples/two-embedded-docs.html');
  await page.evaluate(() => sessionStorage.clear());
  await page.getByRole('button', { name: 'Reset sessions' }).click();
  await expect(page.locator('#eventLog')).toContainText('Reset both keyed sessions.');

  const firstDoc = page.locator('#docOne');
  const secondDoc = page.locator('#docTwo');
  await expect(firstDoc.locator('#editorTree')).toBeVisible({ timeout: 1_000 });
  await expect(firstDoc).toContainText('Current Goal');
  await expect(secondDoc.locator('#readerDocument')).toBeVisible();
  await expect(secondDoc).toContainText('Skills');

  await page.getByRole('button', { name: 'Resume' }).first().click();
  await expect(firstDoc).toContainText('Avery Hart');
  await expect(firstDoc).not.toContainText('Current Goal');

  await page.getByRole('button', { name: 'Example' }).nth(1).click();
  await expect(secondDoc).toContainText('Current Goal');
  await expect(secondDoc).not.toContainText('Avery Hart');
});

test('second embedded viewer action buttons remain clickable', async ({ page }) => {
  test.setTimeout(5_000);
  const chatRequests: Array<{ mode?: string; context?: string; messages?: Array<{ role?: string; content?: string }> }> = [];
  await page.route('**/api/chat', async (route) => {
    const payload = route.request().postDataJSON() as { mode?: string; context?: string; messages?: Array<{ role?: string; content?: string }> };
    chatRequests.push(payload);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        output: 'API answer: Avery Hart is the resume candidate.',
      }),
    });
  });
  await page.goto('/examples/two-embedded-docs.html');
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });

  const firstDoc = page.locator('#docOne');
  const secondDoc = page.locator('#docTwo');
  await expect(secondDoc.locator('#readerDocument')).toBeVisible({ timeout: 1_000 });
  const firstDocMountBox = await firstDoc.boundingBox();
  const firstDocLayoutBox = await firstDoc.locator('.hvy-embed-layout').boundingBox();
  const secondDocMountBox = await secondDoc.boundingBox();
  const secondDocLayoutBox = await secondDoc.locator('.hvy-embed-layout').boundingBox();
  expect(firstDocMountBox).not.toBeNull();
  expect(firstDocLayoutBox).not.toBeNull();
  expect(secondDocMountBox).not.toBeNull();
  expect(secondDocLayoutBox).not.toBeNull();
  expect(firstDocLayoutBox!.height).toBeGreaterThanOrEqual(firstDocMountBox!.height - 1);
  expect(secondDocLayoutBox!.height).toBeGreaterThanOrEqual(secondDocMountBox!.height - 1);

  await firstDoc.locator('.search-launcher').click();
  await expect(firstDoc.locator('.search-palette')).toBeVisible({ timeout: 1_000 });
  const firstDocSearchBox = await firstDoc.boundingBox();
  const firstSearchPaletteBox = await firstDoc.locator('.search-palette').boundingBox();
  expect(firstDocSearchBox).not.toBeNull();
  expect(firstSearchPaletteBox).not.toBeNull();
  expect(firstSearchPaletteBox!.y).toBeGreaterThanOrEqual(firstDocSearchBox!.y);
  expect(firstSearchPaletteBox!.y + firstSearchPaletteBox!.height).toBeLessThanOrEqual(firstDocSearchBox!.y + firstDocSearchBox!.height + 1);
  await firstDoc.getByRole('button', { name: 'Close search panel' }).click();
  await expect(firstDoc.locator('.search-palette')).toHaveCount(0);

  await secondDoc.locator('.viewer-sidebar-help-balloon').click();
  await page.waitForTimeout(220);
  await secondDoc.locator('.viewer-sidebar-tab').click();
  await expect(secondDoc.locator('.viewer-shell')).toHaveClass(/is-sidebar-open/);
  await expect(secondDoc.locator('.viewer-sidebar-panel')).toContainText('Skills');
  await secondDoc.locator('.viewer-sidebar-tab').click();
  await expect(secondDoc.locator('.viewer-shell')).toHaveClass(/is-sidebar-closed/);

  await secondDoc.locator('.search-launcher').click();
  await expect(secondDoc.locator('.search-palette')).toBeVisible({ timeout: 1_000 });
  await secondDoc.locator('[data-field="search-query"]').fill('Avery Hart');
  await secondDoc.locator('#searchComposer').press('Enter');
  await expect(secondDoc.locator('.search-result')).toContainText('Avery Hart', { timeout: 1_000 });
  await secondDoc.getByRole('button', { name: 'Close search panel' }).click();
  await expect(secondDoc.locator('.search-palette')).toHaveCount(0);

  await firstDoc.locator('.chat-launcher').click();
  await expect(firstDoc.locator('.chat-panel')).toBeVisible({ timeout: 1_000 });
  const firstDocBox = await firstDoc.boundingBox();
  const firstChatPanelBox = await firstDoc.locator('.chat-panel').boundingBox();
  expect(firstDocBox).not.toBeNull();
  expect(firstChatPanelBox).not.toBeNull();
  expect(firstChatPanelBox!.x).toBeGreaterThanOrEqual(firstDocBox!.x);
  expect(firstChatPanelBox!.x + firstChatPanelBox!.width).toBeLessThanOrEqual(firstDocBox!.x + firstDocBox!.width + 1);
  expect(firstChatPanelBox!.y + firstChatPanelBox!.height).toBeLessThanOrEqual(firstDocBox!.y + firstDocBox!.height + 1);
  const firstChatEmptyBox = await firstDoc.locator('.chat-empty').boundingBox();
  const firstChatComposerBox = await firstDoc.locator('.chat-composer').boundingBox();
  expect(firstChatEmptyBox).not.toBeNull();
  expect(firstChatComposerBox).not.toBeNull();
  expect(firstChatComposerBox!.y - (firstChatEmptyBox!.y + firstChatEmptyBox!.height)).toBeLessThanOrEqual(18);
  await firstDoc.locator('.chat-launcher').click();
  await expect(firstDoc.locator('.chat-panel')).toBeHidden();

  await secondDoc.locator('.chat-launcher').click();
  await expect(secondDoc.locator('.chat-panel')).toBeVisible({ timeout: 1_000 });
  await expect(secondDoc.locator('[data-field="chat-input"]')).toHaveAttribute('placeholder', 'Ask about the current HVY document...');
  await secondDoc.locator('[data-field="chat-input"]').fill('Who is the resume candidate?');
  await secondDoc.locator('[data-field="chat-input"]').press('Enter');
  await expect(secondDoc.locator('.chat-panel')).toContainText('API answer: Avery Hart is the resume candidate.', { timeout: 3_500 });
  expect(chatRequests).toHaveLength(1);
  expect(chatRequests[0]?.mode).toBe('qa');
  expect(chatRequests[0]?.context).toContain('Avery Hart');
  expect(chatRequests[0]?.messages?.at(-1)?.content).toBe('Who is the resume candidate?');
  await expect(firstDoc).not.toContainText('API answer');
});
