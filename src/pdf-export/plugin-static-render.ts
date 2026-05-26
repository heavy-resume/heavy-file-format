import { getAttachment, removeAttachment, setAttachment } from '../attachments';
import type { VisualBlock, VisualSection } from '../editor/types';
import type { JsonObject } from '../hvy/types';
import { getHostPlugin } from '../plugins/registry';
import type { HvyPluginPdfStaticRenderResult } from '../plugins/types';
import { serializeDocument } from '../serialization';
import type { VisualDocument } from '../types';

const MAX_STATIC_RENDER_DEPTH = 8;

export async function resolvePdfStaticPluginBlocks(document: VisualDocument): Promise<void> {
  for (const section of document.sections) {
    await resolveSectionPdfStaticPluginBlocks(document, section, 0);
  }
}

async function resolveSectionPdfStaticPluginBlocks(
  document: VisualDocument,
  section: VisualSection,
  depth: number
): Promise<void> {
  section.blocks = await resolveBlockListPdfStaticPlugins(document, section.key, section.blocks, depth);
  for (const child of section.children) {
    await resolveSectionPdfStaticPluginBlocks(document, child, depth);
  }
}

async function resolveBlockListPdfStaticPlugins(
  document: VisualDocument,
  sectionKey: string,
  blocks: VisualBlock[],
  depth: number
): Promise<VisualBlock[]> {
  const resolved: VisualBlock[] = [];
  for (const block of blocks) {
    resolved.push(...await resolveBlockPdfStaticPlugins(document, sectionKey, block, depth));
  }
  return resolved;
}

async function resolveBlockPdfStaticPlugins(
  document: VisualDocument,
  sectionKey: string,
  block: VisualBlock,
  depth: number
): Promise<VisualBlock[]> {
  if (depth > MAX_STATIC_RENDER_DEPTH) {
    throw new Error(`PDF static plugin rendering exceeded maximum depth at component "${block.schema.id || block.id}".`);
  }
  if (block.schema.component === 'plugin') {
    const pluginId = block.schema.plugin.trim();
    const plugin = pluginId ? getHostPlugin(pluginId) : null;
    if (!plugin?.pdf?.renderStatic) {
      return [block];
    }
    const rendered = normalizeStaticRenderResult(await plugin.pdf.renderStatic(createStaticRenderContext(document, sectionKey, block)));
    return resolveBlockListPdfStaticPlugins(document, sectionKey, rendered, depth + 1);
  }

  if (Array.isArray(block.schema.containerBlocks)) {
    block.schema.containerBlocks = await resolveBlockListPdfStaticPlugins(document, sectionKey, block.schema.containerBlocks, depth);
  }
  if (Array.isArray(block.schema.componentListBlocks)) {
    block.schema.componentListBlocks = await resolveBlockListPdfStaticPlugins(document, sectionKey, block.schema.componentListBlocks, depth);
  }
  if (Array.isArray(block.schema.gridItems)) {
    block.schema.gridItems = await Promise.all(block.schema.gridItems.map(async (item) => ({
      ...item,
      block: (await resolveBlockPdfStaticPlugins(document, sectionKey, item.block, depth))[0] ?? item.block,
    })));
  }
  if (block.schema.expandableStubBlocks) {
    block.schema.expandableStubBlocks.children = await resolveBlockListPdfStaticPlugins(
      document,
      sectionKey,
      block.schema.expandableStubBlocks.children,
      depth
    );
  }
  if (block.schema.expandableContentBlocks) {
    block.schema.expandableContentBlocks.children = await resolveBlockListPdfStaticPlugins(
      document,
      sectionKey,
      block.schema.expandableContentBlocks.children,
      depth
    );
  }
  return [block];
}

function createStaticRenderContext(document: VisualDocument, sectionKey: string, block: VisualBlock) {
  return {
    sectionKey,
    block,
    rawDocument: document,
    document: {
      getHvy: () => serializeDocument(document),
    },
    attachments: {
      list: () => document.attachments.slice(),
      get: (id: string) => getAttachment(document, id),
      set: (id: string, meta: JsonObject, bytes: Uint8Array) => setAttachment(document, id, meta, bytes),
      remove: (id: string) => removeAttachment(document, id),
    },
    header: {
      get: (key: string) => document.meta[key],
      set: (key: string, value: unknown) => {
        (document.meta as Record<string, unknown>)[key] = value;
      },
    },
  };
}

function normalizeStaticRenderResult(
  result: HvyPluginPdfStaticRenderResult | VisualBlock[] | VisualBlock | null | undefined
): VisualBlock[] {
  if (!result) {
    return [];
  }
  if (Array.isArray(result)) {
    return result;
  }
  if ('schema' in result) {
    return [result];
  }
  if (result.blocks) {
    return result.blocks;
  }
  return result.block ? [result.block] : [];
}
