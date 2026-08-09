import { expect, test, type Page } from '@playwright/test';

/**
 * Waits until a mount stops re-rendering. Boot work (visibility scripts, link observer)
 * keeps replacing nodes for several hundred milliseconds, and a click landing on a node
 * that is about to be replaced is simply lost.
 */
async function waitForMountIdle(page: Page, selector: string, quietMs = 250): Promise<void> {
  await page.locator(selector).evaluate((root, quiet) => new Promise<void>((resolve) => {
    let timer = window.setTimeout(finish, quiet as number);
    const observer = new MutationObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(finish, quiet as number);
    });
    function finish(): void {
      observer.disconnect();
      resolve();
    }
    observer.observe(root, { subtree: true, childList: true, attributes: true });
  }), quietMs);
}

/**
 * Reloads and waits for the app to finish booting. `waitUntil: 'networkidle'` cannot be
 * used here: it costs at least 500ms of enforced network silence on top of load, which
 * does not fit the 1s navigation budget on a cold dev server.
 */
async function reloadApp(page: Page): Promise<void> {
  await page.reload();
  // Embedded example pages mount more than one document, so match the first mount.
  await expect(page.locator('#downloadName').first()).toHaveValue(/.+\.(hvy|thvy)$/);
}

/**
 * Replaces the raw editor contents the way a paste would. `fill()` drives text through CDP
 * and costs ~19s on a full example document, while the app's own input handler only needs
 * ~10ms for the same change, so the wait is pure harness overhead.
 */
async function setRawEditorText(page: Page, text: string): Promise<void> {
  await page.locator('#rawEditor').evaluate((node, value) => {
    (node as HTMLTextAreaElement).value = value;
    node.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
}

/** Documents live behind the collapsed document menu, so it has to be opened first. */
async function openDocument(page: Page, name: string): Promise<void> {
  await page.locator('.document-menu').evaluate((menu) => {
    if (menu instanceof HTMLDetailsElement) menu.open = true;
  });
  await page.locator('.document-menu-panel').getByRole('button', { name, exact: true }).click();
}

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
  - name: hvy.form
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

test('text component showCopy copies reader text to clipboard', async ({ page }) => {
  test.setTimeout(5000);
  await page.goto('/');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as unknown as { __copiedText: string }).__copiedText = value;
        },
        write: async (items: ClipboardItem[]) => {
          const item = items[0];
          const plainBlob = await item.getType('text/plain');
          const htmlBlob = await item.getType('text/html');
          (window as unknown as { __copiedText: string }).__copiedText = await plainBlob.text();
          (window as unknown as { __copiedHtml: string }).__copiedHtml = await htmlBlob.text();
        },
      },
    });
  });
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(String.raw`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

 <!--hvy:text {"id":"copyable","showCopy":true}-->
  Copy this text

 <!--hvy:text {"id":"copy-heading","showCopy":true}-->
  ## Copy Heading
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Viewer' }).click();

  const copyable = page.locator('.reader-block-text[data-component-id="copyable"]');
  await expect(copyable).toContainText('Copy this text');
  const copyLayout = await copyable.evaluate((block) => {
    const button = block.querySelector<HTMLElement>('.text-copy-button');
    if (!button) {
      throw new Error('Copy button markup missing.');
    }
    const textNode = Array.from(block.childNodes).find((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim().length > 0);
    if (!textNode) {
      throw new Error('Copy text node missing.');
    }
    const textRange = document.createRange();
    textRange.selectNodeContents(textNode);
    const blockStyles = getComputedStyle(block);
    const blockBox = block.getBoundingClientRect();
    const buttonBox = button.getBoundingClientRect();
    const textBox = textRange.getBoundingClientRect();
    textRange.detach();
    return {
      hasCopyShell: Boolean(block.querySelector('.text-copy-shell')),
      blockPaddingTop: blockStyles.paddingTop,
      textTop: textBox.top,
      blockTop: blockBox.top,
      buttonBottom: buttonBox.bottom,
      blockBottom: blockBox.bottom,
    };
  });
  expect(copyLayout.hasCopyShell).toBe(false);
  expect(copyLayout.blockPaddingTop).toBe('0px');
  expect(copyLayout.textTop).toBeGreaterThanOrEqual(copyLayout.blockTop);
  expect(copyLayout.buttonBottom).toBeLessThanOrEqual(copyLayout.blockBottom);
  const headingCopyable = page.locator('.reader-block-text[data-component-id="copy-heading"]');
  await expect(headingCopyable).toContainText('Copy Heading');
  const headingLayout = await headingCopyable.evaluate((block) => {
    const heading = block.querySelector<HTMLElement>('h2');
    if (!heading) {
      throw new Error('Copy heading markup missing.');
    }
    return getComputedStyle(heading).marginTop;
  });
  expect(headingLayout).toBe('0px');
  await copyable.hover();
  await copyable.getByRole('button', { name: 'Copy text' }).click({ timeout: 1000 });

  await expect.poll(() => page.evaluate(() => (window as unknown as { __copiedText?: string }).__copiedText)).toBe('Copy this text');
  await expect(copyable.getByRole('button', { name: 'Copied' })).toBeVisible({ timeout: 1000 });

  await page.evaluate(() => {
    (window as unknown as { __copiedHtml?: string; __copiedText?: string }).__copiedText = undefined;
    (window as unknown as { __copiedHtml?: string; __copiedText?: string }).__copiedHtml = undefined;
  });
  await headingCopyable.hover();
  await headingCopyable.getByRole('button', { name: 'Copy text' }).click({ timeout: 1000 });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __copiedText?: string }).__copiedText)).toBe('Copy Heading');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __copiedHtml?: string }).__copiedHtml)).toContain('<h2>Copy Heading</h2>');
});

test('study tools flashcards form remains mounted after sidebar reader refresh', async ({ page }) => {
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
  await selectDocumentMenuItem(page, 'Study Tools Example');
  await page.getByRole('button', { name: 'Viewer' }).click();
  await expect(page.locator('.viewer-sidebar-tab')).toContainText('Study Tools', { timeout: 1000 });
  const sidebarTabBox = await page.locator('.viewer-sidebar-tab').boundingBox();
  const sidebarTabLabelBox = await page.locator('.viewer-sidebar-tab .sidebar-tab-label').boundingBox();
  const sidebarHelpBox = await page.locator('.viewer-sidebar-help-balloon').boundingBox();
  expect(sidebarTabBox).not.toBeNull();
  expect(sidebarTabLabelBox).not.toBeNull();
  expect(sidebarHelpBox).not.toBeNull();
  expect(sidebarTabBox!.height).toBeGreaterThan(sidebarTabBox!.width);
  expect(sidebarTabLabelBox!.height).toBeGreaterThan(sidebarTabLabelBox!.width);
  expect(sidebarTabLabelBox!.height).toBeLessThanOrEqual(sidebarTabBox!.height);
  const sidebarTabCenter = sidebarTabBox!.y + sidebarTabBox!.height / 2;
  const sidebarHelpCenter = sidebarHelpBox!.y + sidebarHelpBox!.height / 2;
  expect(Math.abs(sidebarTabCenter - sidebarHelpCenter)).toBeLessThanOrEqual(3);
  expect(sidebarHelpBox!.x).toBeGreaterThanOrEqual(sidebarTabBox!.x + sidebarTabBox!.width + 9);
  await page.locator('.viewer-sidebar-tab').dispatchEvent('click');
  await expect(page.locator('.viewer-sidebar-tab')).toHaveAttribute('aria-expanded', 'true', { timeout: 1000 });
  const flashcardsSection = page.locator('#flashcards-sidebar');
  await expect(flashcardsSection).toHaveClass(/is-collapsed-preview/, { timeout: 1000 });
  await flashcardsSection.dispatchEvent('click');
  await expect(flashcardsSection).not.toHaveClass(/is-collapsed-preview/, { timeout: 1000 });

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
  await generatedCards.first().click({ timeout: 1000 });
  await expect(generatedCards.first()).toContainText('Source: Concept Model', { timeout: 1000 });

  await page.getByRole('button', { name: 'Shuffle cards' }).click({ timeout: 1000 });
  await expect(generatedCards.first()).toContainText('What does a form submit target script receive?', { timeout: 1000 });
  await generatedCards.first().click({ timeout: 1000 });
  await expect(generatedCards.first()).toContainText('Source: Scripting Runtime', { timeout: 1000 });
});

test('study tools quiz generates radio choices and compares results', async ({ page }) => {
  test.setTimeout(5000);
  await page.route('**/api/chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        output: '[{"source_id":"concept-model","question":"What are Heavy documents composed from?","option_1":"Sections and reusable components","option_2":"Only raw text files","option_3":"A single hidden table","option_4":"External browser tabs","correct_option_letter":"A"},{"source_id":"scripting-runtime","question":"What does the submit target script receive?","option_1":"Only the document title","option_2":"Injected response and source values","option_3":"A CSS-only payload","option_4":"No values","correct_option_letter":"B"}]',
      }),
    });
  });

  await page.goto('/');
  await selectDocumentMenuItem(page, 'Study Tools Example');
  await page.getByRole('button', { name: 'Viewer' }).click();
  await page.locator('.viewer-sidebar-tab').dispatchEvent('click');
  await expect(page.locator('.viewer-sidebar-tab')).toHaveAttribute('aria-expanded', 'true', { timeout: 1000 });
  const quizSection = page.locator('#quiz-sidebar');
  await expect(quizSection).toHaveClass(/is-collapsed-preview/, { timeout: 1000 });
  await quizSection.dispatchEvent('click');
  await expect(quizSection).not.toHaveClass(/is-collapsed-preview/, { timeout: 1000 });

  await page.getByRole('button', { name: 'Generate quiz' }).click({ timeout: 1000 });
  const firstAnswer = page.getByRole('radio', { name: 'A. Sections and reusable components', exact: true });
  await expect(firstAnswer).toBeVisible({ timeout: 2000 });
  await expect(page.locator('#quiz-answer-form')).not.toContainText('Correct answer:', { timeout: 1000 });

  await firstAnswer.check({ timeout: 1000 });
  await page.getByRole('button', { name: 'Compare results' }).click({ timeout: 1000 });

  await expect(page.getByLabel('Quiz result')).toHaveValue('Score: 1/2 (1 skipped)', { timeout: 1000 });
  await expect(page.locator('#quiz-answer-form')).toContainText('Skipped. Correct answer: B', { timeout: 1000 });
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
  await reloadApp(page);
  await openDocument(page, 'Resume Template');

  await expect(page.locator('[data-component-id="resume-pronunciation"]').first()).toBeHidden({ timeout: 1_000 });
  await expect(page.locator('[data-action="run-button-ai-generate"]')).toBeHidden();

  await page.getByRole('button', { name: 'Raw' }).click();

  const raw = page.locator('#rawEditor');
  await setRawEditorText(page, (await raw.inputValue()).replace('# <!-- value {"placeholder":"Name"} -->', '# Avery Hart'));
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
  await reloadApp(page);
  await openDocument(page, 'Resume Template');

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
  await reloadApp(page);
  await openDocument(page, 'Resume Template');

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
  await reloadApp(page);
  await openDocument(page, 'Resume Template');
  await page.getByRole('button', { name: 'Raw' }).click();

  const raw = page.locator('#rawEditor');
  await setRawEditorText(page, (await raw.inputValue()).replace('# <!-- value {"placeholder":"Name"} -->', '# Avery Hart'));
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
  await page.locator('.text-use-as-button').click();
  await page.locator('[data-rich-action="fill-in"]').click();

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
  await reloadApp(page);
  await selectDocumentMenuItem(page, 'Resume Template');
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
  const visibilityScript = settings.locator('.visibility-script-field');
  await expect(visibilityScript).not.toHaveAttribute('open', '');
  await expect(visibilityScript.locator('summary')).toContainText('Visibility Script');
  await expect(visibilityScript.locator('summary')).toContainText('Configured');
  await visibilityScript.locator('summary').click();
  const visibleScriptBox = await settings.locator('[data-field="block-button-visible-script"]').boundingBox();

  expect(previewBox).not.toBeNull();
  expect(buttonBox).not.toBeNull();
  expect(visibleScriptBox).not.toBeNull();
  expect(buttonBox!.y + buttonBox!.height).toBeLessThan(visibleScriptBox!.y);
  expect(buttonBox!.y).toBeGreaterThanOrEqual(previewBox!.y);

  await page.locator('.editor-block[data-active-editor-block="true"] [data-action="open-component-meta"]').click();
  await expect(page.locator('#modalRoot')).toBeVisible();
  await page.locator('.component-meta-modal [data-modal-action="close"]').click();
  await expect(page.locator('#modalRoot')).toHaveCount(0);
});

test('embedded editor and viewer keep independent document state', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/examples/two-embedded-docs.html');
  await page.evaluate(() => sessionStorage.clear());
  await reloadApp(page);

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

test('search result highlights inside an active text editor without serializing marker markup', async ({ page }) => {
  test.setTimeout(5_000);

  await page.goto('/');
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"main"}-->
#! Main

<!--hvy:text {"id":"body"}-->
 Editable needle text
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();
  await page.locator('.editor-block-passive', { hasText: 'Editable needle text' }).click();
  await expect(page.locator('.editor-block[data-active-editor-block="true"] .rich-editor')).toBeVisible({ timeout: 1_000 });

  await page.locator('.search-launcher').click();
  await page.locator('[data-field="search-query"]').fill('needle');
  await page.locator('#searchComposer').press('Enter');
  await page.getByRole('button', { name: /Editable needle text/ }).click();

  const activeEditor = page.locator('.editor-block[data-active-editor-block="true"] .rich-editor');
  await expect(activeEditor.locator('mark.search-match-marker')).toHaveText('needle', { timeout: 1_000 });
  await activeEditor.evaluate((editor) => {
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.keyboard.type('!');
  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).toContainText('Editable needle text!', { timeout: 1_000 });
  await expect(page.locator('#rawEditor')).not.toContainText('search-match-marker', { timeout: 1_000 });
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

/** Opens the two-doc example with a stubbed chat proxy and waits for both mounts. */
async function openTwoEmbeddedDocs(
  page: Page,
  chatRequests: Array<{ mode?: string; context?: string; messages?: Array<{ role?: string; content?: string }> }>
): Promise<void> {
  await page.route('**/api/chat', async (route) => {
    chatRequests.push(route.request().postDataJSON() as { mode?: string; context?: string });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ output: 'API answer: Avery Hart is the resume candidate.' }),
    });
  });
  await page.goto('/examples/two-embedded-docs.html');
  await page.evaluate(() => sessionStorage.clear());
  await reloadApp(page);
  await expect(page.locator('#docTwo #readerDocument')).toBeVisible({ timeout: 1_000 });
}

test('embedded mounts fill their host frames', async ({ page }) => {
  test.setTimeout(5_000);
  await openTwoEmbeddedDocs(page, []);

  for (const id of ['#docOne', '#docTwo']) {
    const mountBox = await page.locator(id).boundingBox();
    const layoutBox = await page.locator(`${id} .hvy-embed-layout`).boundingBox();
    expect(mountBox).not.toBeNull();
    expect(layoutBox).not.toBeNull();
    expect(layoutBox!.height).toBeGreaterThanOrEqual(mountBox!.height - 1);
  }
});

test('embedded search panel opens inside its own mount', async ({ page }) => {
  test.setTimeout(5_000);
  await openTwoEmbeddedDocs(page, []);
  const firstDoc = page.locator('#docOne');

  await waitForMountIdle(page, '#docOne');
  await firstDoc.locator('.search-launcher').click();
  await expect(firstDoc.locator('.search-modal')).toBeVisible({ timeout: 1_000 });
  const mountBox = await firstDoc.boundingBox();
  const modalBox = await firstDoc.locator('.search-modal').boundingBox();
  expect(mountBox).not.toBeNull();
  expect(modalBox).not.toBeNull();
  expect(modalBox!.y).toBeGreaterThanOrEqual(mountBox!.y);
  expect(modalBox!.y + modalBox!.height).toBeLessThanOrEqual(mountBox!.y + mountBox!.height + 1);
  await firstDoc.getByRole('button', { name: 'Close search panel' }).click();
  await expect(firstDoc.locator('.search-modal')).toHaveCount(0);
});

test('second embedded viewer runs its own search', async ({ page }) => {
  test.setTimeout(5_000);
  await openTwoEmbeddedDocs(page, []);
  const secondDoc = page.locator('#docTwo');

  await secondDoc.locator('.viewer-sidebar-help-balloon').click();
  await waitForMountIdle(page, '#docTwo');
  await secondDoc.locator('.search-launcher').click();
  await expect(secondDoc.locator('.search-modal')).toBeVisible({ timeout: 1_000 });
  await secondDoc.locator('[data-field="search-query"]').fill('Avery Hart');
  await secondDoc.locator('#searchComposer').press('Enter');
  await expect(secondDoc.locator('.search-result')).toContainText('Avery Hart', { timeout: 1_000 });
  await secondDoc.getByRole('button', { name: 'Close search panel' }).click();
  await expect(secondDoc.locator('.search-modal')).toHaveCount(0);
});

test('embedded chat panel opens inside its own mount', async ({ page }) => {
  test.setTimeout(5_000);
  await openTwoEmbeddedDocs(page, []);
  const firstDoc = page.locator('#docOne');

  await waitForMountIdle(page, '#docOne');
  await firstDoc.locator('.chat-launcher').click();
  await expect(firstDoc.locator('.chat-panel')).toBeVisible({ timeout: 1_000 });
  const mountBox = await firstDoc.boundingBox();
  const panelBox = await firstDoc.locator('.chat-panel').boundingBox();
  expect(mountBox).not.toBeNull();
  expect(panelBox).not.toBeNull();
  expect(panelBox!.x).toBeGreaterThanOrEqual(mountBox!.x);
  expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(mountBox!.x + mountBox!.width + 1);
  expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(mountBox!.y + mountBox!.height + 1);
  const emptyBox = await firstDoc.locator('.chat-empty').boundingBox();
  const composerBox = await firstDoc.locator('.chat-composer').boundingBox();
  expect(emptyBox).not.toBeNull();
  expect(composerBox).not.toBeNull();
  expect(composerBox!.y - (emptyBox!.y + emptyBox!.height)).toBeLessThanOrEqual(18);
  // The launcher is display:none while the panel is open; the panel owns its close control.
  await firstDoc.getByRole('button', { name: 'Close chat' }).click();
  await expect(firstDoc.locator('.chat-panel')).toBeHidden();
});

test('second embedded viewer answers chat through its host chat client', async ({ page }) => {
  test.setTimeout(5_000);
  // The example mounts supply their own chatClient, so the proxy route should stay unused.
  const proxyRequests: Array<{ mode?: string; context?: string; messages?: Array<{ role?: string; content?: string }> }> = [];
  await openTwoEmbeddedDocs(page, proxyRequests);
  const firstDoc = page.locator('#docOne');
  const secondDoc = page.locator('#docTwo');

  await waitForMountIdle(page, '#docTwo');
  await secondDoc.locator('.chat-launcher').click();
  await expect(secondDoc.locator('.chat-panel')).toBeVisible({ timeout: 1_000 });
  await expect(secondDoc.locator('[data-field="chat-input"]')).toHaveAttribute('placeholder', 'Ask about the current HVY document...');
  await secondDoc.locator('[data-field="chat-input"]').fill('Who is the resume candidate?');
  await secondDoc.locator('[data-field="chat-input"]').press('Enter');

  // The example's client echoes the document context back, labelled per mount.
  await expect(secondDoc.locator('.chat-panel')).toContainText('Document Two generated from:', { timeout: 3_500 });
  await expect(secondDoc.locator('.chat-panel')).toContainText('Who is the resume candidate?');
  expect(proxyRequests).toHaveLength(0);
  await expect(firstDoc).not.toContainText('Document Two generated from:');
});
