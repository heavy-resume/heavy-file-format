import type { VisualBlock } from '../editor/types';
import type { VisualSection } from '../editor/types';
import type { VisualDocument } from '../types';
import { deserializeDocumentBytes, serializeDocumentBytes } from '../serialization';
import { downloadBlob } from '../utils';
import { buildPdfExportDocDefinition } from './doc-definition';
import { createPdfExportRuleRecorder, mergePdfExportStrategies } from './strategy';
import type {
  HvyPdfExportOptions,
  HvyPdfExportResult,
  HvyPdfExportStrategy,
  HvyPdfMakeDocumentDefinition,
} from './types';

type PdfMake = {
  vfs?: Record<string, string>;
  addVirtualFileSystem?: (vfs: Record<string, string>) => void;
  createPdf(definition: HvyPdfMakeDocumentDefinition): {
    getBlob(callback?: (blob: Blob) => void): void | Promise<Blob>;
  };
};

export async function preparePdfExport(
  sourceDocument: VisualDocument,
  options: HvyPdfExportOptions = {}
): Promise<HvyPdfExportResult> {
  const exportDocument = cloneDocumentForPdfExport(sourceDocument);
  const strategy = await prepareExportStrategy(exportDocument, options.strategy, options.runPrepScript !== false);
  return {
    sourceDocument,
    exportDocument,
    strategy,
    docDefinition: buildPdfExportDocDefinition(exportDocument, { contentView: options.contentView, strategy }),
  };
}

export async function getHvyPdfBlob(document: VisualDocument, options: HvyPdfExportOptions = {}): Promise<Blob> {
  const { docDefinition } = await preparePdfExport(document, options);
  const pdfMake = await loadPdfMake();
  return new Promise((resolve, reject) => {
    const result = pdfMake.createPdf(docDefinition).getBlob(resolve);
    if (result && typeof (result as Promise<Blob>).then === 'function') {
      void (result as Promise<Blob>).then(resolve, reject);
    }
  });
}

export async function exportHvyPdf(document: VisualDocument, options: HvyPdfExportOptions = {}): Promise<void> {
  const blob = await getHvyPdfBlob(document, options);
  downloadBlob(normalizePdfFilename(options.filename), blob);
}

export function cloneDocumentForPdfExport(document: VisualDocument): VisualDocument {
  return deserializeDocumentBytes(serializeDocumentBytes(document), document.extension);
}

async function prepareExportStrategy(
  exportDocument: VisualDocument,
  strategy: HvyPdfExportStrategy | undefined,
  runPrepScript: boolean
): Promise<HvyPdfExportStrategy> {
  if (!runPrepScript || !strategy?.prepScript) {
    return strategy ?? {};
  }
  const source = resolvePrepScriptSource(exportDocument, strategy.prepScript);
  const recorder = createPdfExportRuleRecorder();
  const { runUserScript } = await import('../plugins/scripting/wrapper');
  const result = await runUserScript({
    document: exportDocument,
    source,
    componentId: typeof strategy.prepScript === 'object' ? strategy.prepScript.componentId : undefined,
    changeReason: 'unknown',
    exportRuleRecorder: recorder,
  });
  if (!result.ok) {
    throw new Error(result.errorDetail || result.error || 'PDF export prep script failed.');
  }
  return mergePdfExportStrategies(strategy, recorder.getStrategy());
}

function resolvePrepScriptSource(
  document: VisualDocument,
  prepScript: NonNullable<HvyPdfExportStrategy['prepScript']>
): string {
  if (typeof prepScript === 'string') {
    return prepScript;
  }
  const block = findBlockBySchemaId(collectSectionBlocks(document.sections), prepScript.componentId);
  if (!block) {
    throw new Error(`PDF export prep script component not found: ${prepScript.componentId}`);
  }
  return block.text;
}

function collectSectionBlocks(sections: VisualSection[]): VisualBlock[] {
  return sections.flatMap((section) => [...section.blocks, ...collectSectionBlocks(section.children)]);
}

function findBlockBySchemaId(blocks: VisualBlock[], componentId: string): VisualBlock | null {
  for (const block of blocks) {
    if (block.schema.id === componentId || block.id === componentId) {
      return block;
    }
    const child = findBlockBySchemaId(
      [
        ...(block.schema.containerBlocks ?? []),
        ...(block.schema.componentListBlocks ?? []),
        ...(block.schema.gridItems ?? []).map((item) => item.block),
        ...(block.schema.expandableStubBlocks?.children ?? []),
        ...(block.schema.expandableContentBlocks?.children ?? []),
      ],
      componentId
    );
    if (child) {
      return child;
    }
  }
  return null;
}

async function loadPdfMake(): Promise<PdfMake> {
  const [pdfMakeModule, fontsModule] = await Promise.all([
    import('pdfmake/build/pdfmake.js'),
    import('pdfmake/build/vfs_fonts.js'),
  ]);
  const pdfMake = (pdfMakeModule.default ?? pdfMakeModule) as PdfMake;
  const fonts = fontsModule.default ?? fontsModule;
  const vfs = resolvePdfMakeVfs(fonts);
  if (vfs) {
    pdfMake.vfs = vfs;
    pdfMake.addVirtualFileSystem?.(vfs);
  }
  return pdfMake;
}

function resolvePdfMakeVfs(fonts: unknown): Record<string, string> | undefined {
  const candidate = fonts as { pdfMake?: { vfs?: Record<string, string> }; vfs?: Record<string, string> };
  if (candidate.pdfMake?.vfs) return candidate.pdfMake.vfs;
  if (candidate.vfs) return candidate.vfs;
  if (fonts && typeof fonts === 'object') {
    const directEntries = Object.entries(fonts).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
    if (directEntries.length > 0) {
      return Object.fromEntries(directEntries);
    }
  }
  return undefined;
}

function normalizePdfFilename(filename: string | undefined): string {
  const value = (filename || 'document.pdf').trim() || 'document.pdf';
  return value.toLowerCase().endsWith('.pdf') ? value : value.replace(/\.(hvy|thvy|md|markdown)$/i, '') + '.pdf';
}
