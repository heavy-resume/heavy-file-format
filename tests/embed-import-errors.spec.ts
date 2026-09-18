import { expect, test } from '@playwright/test';

for (const mode of ['viewer', 'editor'] as const) {
  for (const operation of ['plan', 'import'] as const) {
    test(`${mode} ${operation} reports HTTP quota failure once and settles`, async ({ page }) => {
      test.setTimeout(5_000);
      let requests = 0;
      await page.route('**/api/chat', async (route) => {
        requests += 1;
        await route.fulfill({ status: 429, contentType: 'application/json',
          headers: { 'Retry-After': '60' },
          body: JSON.stringify({ error: 'Sample quota exhausted', code: 'sample_limit', quota: 'sample-quota' }),
        });
      });
      await page.goto('/');
      const result = await page.evaluate(async ({ mode, operation }) => {
        const modulePath = '/src/embed.ts';
        const { mountHvy, deserializeDocumentBytes } = await import(/* @vite-ignore */ modulePath);
        const root = document.createElement('div');
        document.body.replaceChildren(root);
        const mount = mountHvy({ root, mode, document: deserializeDocumentBytes(new TextEncoder().encode(
          '---\nhvy_version: 0.1\n---\n\n<!--hvy: {"id":"sample"}-->\n#! Sample\n',
        ), '.hvy') });
        const errors: unknown[] = [];
        const progress: string[] = [];
        const options = {
          sourceText: 'Fictional sample content',
          steps: [{ section: 'Sample', sectionId: 'sample' }],
          llm: { settings: { provider: 'openai', model: 'fake-model' }, client: null },
          onError: (error: unknown) => { errors.push(error); },
          onProgress: (event: { phase: string }) => { progress.push(event.phase); },
        };
        const result = await (operation === 'plan' ? mount.buildImportPlan(options) : mount.importFromText(options));
        mount.destroy();
        return { result, errors, progress };
      }, { mode, operation });
      expect(result.result).toMatchObject({ status: 'error', error: {
        message: 'Sample quota exhausted', status: 429, code: 'sample_limit', quota: 'sample-quota', retryAfter: '60',
      } });
      expect(result.errors).toEqual([result.result.error]);
      expect(result.progress).not.toContain('complete');
      expect(requests).toBe(1);
    });
  }
}
