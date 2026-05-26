import { describe, expect, test, vi } from 'vitest';

import { createEmptyBlock, createEmptySection } from '../src/document-factory';
import { createPdfExportPlan, createPdfExportPlanFromPrompt } from '../src/pdf-export/planning';
import { getPdfExportPlanModalTemplates, renderPdfExportPlanModalPrompt } from '../src/pdf-export/plan-modal-templates';
import { getPdfExportPromptTemplates, renderPdfExportPromptTemplate } from '../src/pdf-export/prompt-templates';
import type { HvyPdfExportStrategyProviderRequest } from '../src/pdf-export/types';
import type { VisualDocument } from '../src/types';

vi.mock('../src/plugins/scripting/wrapper', () => ({
  runUserScript: vi.fn(async (options) => {
    options.document.sections[0].blocks[0].text = 'Export clone text';
    options.exportRuleRecorder.hide('#script-plugin');
    options.exportRuleRecorder.strategy({ tag: 'script-keep', keepTogether: true });
    return { ok: true, stepsExecuted: 1, stepBudget: 100_000, linesExecuted: 1, toolCalls: 0 };
  }),
}));

function createTextBlock(id: string, text: string, tags = '') {
  const block = createEmptyBlock('text');
  block.id = `block-${id}`;
  block.schema.id = id;
  block.schema.tags = tags;
  block.text = text;
  return block;
}

function createPluginBlock(id: string, plugin = 'example.plugin') {
  const block = createEmptyBlock('plugin');
  block.id = `block-${id}`;
  block.schema.id = id;
  block.schema.plugin = plugin;
  block.schema.tags = 'unsupported-plugin';
  return block;
}

function createPlanningDocument(): VisualDocument {
  const summary = createEmptySection(1, '');
  summary.key = 'section-summary';
  summary.customId = 'summary';
  summary.title = 'Summary';
  summary.tags = 'primary';
  summary.blocks = [createTextBlock('intro', 'Intro text', 'script-keep')];

  const plugins = createEmptySection(1, '');
  plugins.key = 'section-plugins';
  plugins.customId = 'plugins';
  plugins.title = 'Plugins';
  plugins.blocks = [createPluginBlock('script-plugin', 'heavy.example')];

  return {
    meta: {
      title: 'Planning Fixture',
      export_prompt_templates: [
        {
          id: 'generic-export',
          label: 'Generic export',
          description: 'Use pasted criteria.',
          prompt: 'Plan this export.\n\n{% target_context | block %}',
          variables: {
            target_context: {
              label: 'Target context',
              type: 'block',
              required: true,
            },
          },
        },
      ],
    },
    extension: '.hvy',
    attachments: [],
    sections: [summary, plugins],
  };
}

describe('PDF export planning', () => {
  test('parses and renders document export prompt templates', () => {
    const document = createPlanningDocument();
    const templates = getPdfExportPromptTemplates(document);

    expect(templates).toHaveLength(1);
    expect(templates[0]).toMatchObject({
      id: 'generic-export',
      label: 'Generic export',
      variables: {
        target_context: expect.objectContaining({ label: 'Target context', type: 'block' }),
      },
    });
    expect(renderPdfExportPromptTemplate(document, 'generic-export', { target_context: 'Audience criteria.' })).toBe(
      'Plan this export.\n\nAudience criteria.'
    );
    expect(() => renderPdfExportPromptTemplate(document, 'generic-export', { target_context: '' })).toThrow(
      /target_context/
    );
  });

  test('reference modal provides a generic fallback template when the document has none', () => {
    const document = createPlanningDocument();
    document.meta = { title: 'No Templates' };

    const templates = getPdfExportPlanModalTemplates(document);

    expect(getPdfExportPromptTemplates(document)).toEqual([]);
    expect(templates).toEqual([
      expect.objectContaining({
        id: 'reference-generic-pdf-export',
        variables: {
          export_context: expect.objectContaining({ required: false, type: 'block' }),
        },
      }),
    ]);
    expect(renderPdfExportPlanModalPrompt(document, templates[0].id, { export_context: 'Keep it short.' })).toContain(
      'Keep it short.'
    );
  });

  test('planning packet includes current view, candidates, allowed targets, and unsupported inventory', async () => {
    const document = createPlanningDocument();
    let captured: HvyPdfExportStrategyProviderRequest | null = null;

    const expectedResult = await createPdfExportPlan({
      document,
      templateId: 'generic-export',
      values: { target_context: 'Keep the summary focused.' },
      currentContentView: { summary: ['priority'] },
      strategyProvider: (request) => {
        captured = request;
        return {
          rules: [{ id: 'script-plugin', hide: true }],
          decisions: [{ target: 'summary', action: 'include', reason: 'Matches requested focus.' }],
        };
      },
      semanticFilterProvider: () => {
        throw new Error('Semantic filter should not run when a current view is supplied.');
      },
    });

    expect(captured?.currentContentView).toEqual({ summary: ['priority'] });
    expect(captured?.candidates.length).toBeGreaterThan(0);
    expect(captured?.allowedTargets.map((target) => target.id)).toEqual(expect.arrayContaining(['summary', 'intro', 'script-plugin']));
    expect(captured?.unsupportedComponents).toEqual([
      expect.objectContaining({ id: 'script-plugin', component: 'plugin', baseComponent: 'plugin' }),
    ]);
    expect(expectedResult.diagnostics).toEqual([]);
    expect(expectedResult.previewStats.contentNodeCount).toBeGreaterThan(0);
  });

  test('invalid AI rules fail validation before export', async () => {
    const expectedResult = await createPdfExportPlanFromPrompt({
      document: createPlanningDocument(),
      prompt: 'Export for a precise audience.',
      strategyProvider: () => ({
        rules: [
          { id: 'missing-target', hide: true },
          { id: 'script-plugin', hide: true, madeUpAction: true } as never,
        ],
      }),
      semanticFilterProvider: null,
    });

    expect(expectedResult.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: 'error', message: expect.stringContaining('missing-target') }),
        expect.objectContaining({ severity: 'error', message: expect.stringContaining('madeUpAction') }),
      ])
    );
    expect(expectedResult.previewStats.contentNodeCount).toBe(0);
  });

  test('unsupported visible plugin blocks export until strategy hides it', async () => {
    const blockedResult = await createPdfExportPlanFromPrompt({
      document: createPlanningDocument(),
      prompt: 'Export the document.',
      strategyProvider: () => ({ rules: [] }),
      semanticFilterProvider: null,
    });

    expect(blockedResult.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'error', message: expect.stringContaining('cannot render component') }),
    ]));

    const hiddenResult = await createPdfExportPlanFromPrompt({
      document: createPlanningDocument(),
      prompt: 'Export the document.',
      strategyProvider: () => ({ rules: [{ id: 'script-plugin', hide: true }] }),
      semanticFilterProvider: null,
    });

    expect(hiddenResult.diagnostics.filter((entry) => entry.severity === 'error')).toEqual([]);
    expect(hiddenResult.previewStats.contentNodeCount).toBeGreaterThan(0);
  });

  test('prep script mutates only the export clone and can add export rules', async () => {
    const document = createPlanningDocument();
    const before = document.sections[0].blocks[0].text;

    const expectedResult = await createPdfExportPlanFromPrompt({
      document,
      prompt: 'Export with script preparation.',
      strategyProvider: () => ({
        prepScript: 'doc.component.set_text("intro", "Export clone text")\ndoc.export.hide("#script-plugin")',
      }),
      semanticFilterProvider: null,
    });

    expect(document.sections[0].blocks[0].text).toBe(before);
    expect(expectedResult.diagnostics.filter((entry) => entry.severity === 'error')).toEqual([]);
    expect(expectedResult.prepScript).toContain('doc.export.hide');
  });
});
