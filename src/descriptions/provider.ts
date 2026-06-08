import { getReferenceAppConfig } from '../reference-config';
import type { VisualBlock, VisualSection } from '../editor/types';
import { renderAltAnnotationsAsFullText } from '../markdown';
import type { VisualDocument } from '../types';
import type { HvyDescriptionParentContext, HvyDescriptionProvider, HvyDescriptionRequest, HvyDescriptionResponse, HvyDescriptionTargetKind } from './types';
import { loadChatSettings, requestProxyCompletion } from '../chat/chat';

const DEFAULT_DESCRIPTION_MODEL = 'gpt-5.4-nano';
const MAX_CONTENT_CHARS = 600;

export const localDescriptionProvider: HvyDescriptionProvider = (request) => ({
  description: buildLocalDescription(request),
});

export const openAiDescriptionProvider: HvyDescriptionProvider = async (request) => {
  const output = await requestProxyCompletion({
    settings: {
      ...loadChatSettings(),
      model: DEFAULT_DESCRIPTION_MODEL,
    },
    mode: 'qa',
    debugLabel: 'description-generation',
    context: buildDescriptionPrompt(request),
    responseInstructions: 'Return only the description text.',
    messages: [{
      id: 'description-request',
      role: 'user',
      content: 'Write the description now.',
    }],
    signal: request.signal,
  });
  const description = cleanDescription(output);
  if (!description) {
    throw new Error('Description generation returned no text.');
  }
  return { description };
};

export function getDescriptionProvider(): HvyDescriptionProvider {
  return getReferenceAppConfig().descriptionProvider ?? openAiDescriptionProvider;
}

export function buildDescriptionRequest(params: {
  document: VisualDocument;
  section: VisualSection;
  block?: VisualBlock;
  kind: HvyDescriptionTargetKind;
  parentTrail?: string[];
  parentTree?: HvyDescriptionParentContext[];
  signal?: AbortSignal;
}): HvyDescriptionRequest {
  const parentTrail = params.parentTrail ?? [];
  return {
    document: params.document,
    section: params.section,
    block: params.block,
    kind: params.kind,
    parentTrail,
    parentTree: params.parentTree ?? parentTrail.map((label) => ({ label })),
    contentSummary: summarizeTargetContent(params.kind, params.section, params.block),
    signal: params.signal,
  };
}

export function buildBlockDescriptionParentTree(section: VisualSection, targetBlock: VisualBlock): HvyDescriptionParentContext[] {
  const sectionLabel = section.title.trim() || section.customId.trim();
  const root = sectionLabel
    ? [{ label: sectionLabel, ...(section.description.trim() ? { description: section.description.trim() } : {}) }]
    : [];
  const blockPath = findBlockParentPath(section.blocks, targetBlock.id);
  return [...root, ...(blockPath ?? []).map(getParentContextForBlock).filter((entry): entry is HvyDescriptionParentContext => entry !== null)];
}

export async function generateDescription(request: HvyDescriptionRequest): Promise<string> {
  const provider = getDescriptionProvider();
  const response: HvyDescriptionResponse = await provider(request);
  const description = cleanDescription(response.description);
  if (!description) {
    throw new Error('Description generation returned no text.');
  }
  return description;
}

function buildDescriptionPrompt(request: HvyDescriptionRequest): string {
  return [
    'Generate one concise search location description for this document component or section.',
    'Rules:',
    '- Return only the description text.',
    '- Write a shorthand label, not a sentence.',
    '- Keep it under 8 words when possible.',
    '- Omit filler like "within", "listing", "capturing", "described in", "for roles", and "section".',
    '- Describe what function this location serves in the document.',
    '- Do not summarize, restate, or describe the specific contents found here.',
    '- Prefer compact labels like "COMPANY_NAME skills list", "PROJECT_NAME details", or "contact information".',
    '- Combine the owning context with the local function when both are available.',
    '- Prefer the owning context over generic section names and over individual content values.',
    '- If an owning context is provided, include it in the description.',
    '- Use the local label/function for the kind of place this is, not as the owner.',
    '- Treat parent descriptions as disambiguation only; do not repeat generic policy phrases like ordering, chronology, or overview.',
    '- Ignore individual content examples unless they are needed to infer the local function.',
    '- Do not mention HVY, JSON, schema, block ids, or component type unless the visible content requires it.',
    '',
    `Target kind: ${request.kind}`,
    `Section: ${request.section.title || request.section.customId || 'Untitled section'}`,
    request.parentTree.length ? `Owning context: ${formatOwningContext(request.parentTree)}` : '',
    request.parentTree.length ? `Local context: ${formatLocalContext(request.parentTree)}` : '',
    request.parentTree.length ? `Parent tree:\n${formatParentTree(request.parentTree)}` : request.parentTrail.length ? `Parent context: ${request.parentTrail.join(' / ')}` : '',
    request.block ? `Visible label: ${getBlockLabel(request.block)}` : '',
    '',
    'Content:',
    request.contentSummary || '(no visible text)',
  ].filter(Boolean).join('\n');
}

function formatOwningContext(parentTree: HvyDescriptionParentContext[]): string {
  const parent = parentTree.find((entry, index) =>
    index > 0 && (entry.description?.trim() || entry.label.trim())
  );
  if (!parent) {
    return '';
  }
  const label = parent.label.trim();
  const description = parent.description?.trim();
  return description && description !== label ? `${label || description} - ${description}` : label || description || '';
}

function formatLocalContext(parentTree: HvyDescriptionParentContext[]): string {
  const parent = [...parentTree].reverse().find((entry) => entry.label.trim() || entry.description?.trim());
  if (!parent) {
    return '';
  }
  const label = parent.label.trim();
  const description = parent.description?.trim();
  return description && description !== label ? `${label || description} - ${description}` : label || description || '';
}

function formatParentTree(parentTree: HvyDescriptionParentContext[]): string {
  return parentTree
    .map((entry, index) => {
      const label = entry.label.trim();
      const description = entry.description?.trim();
      const prefix = `${index + 1}. ${label || 'Untitled parent'}`;
      return description ? `${prefix} - ${description}` : prefix;
    })
    .join('\n');
}

function buildLocalDescription(request: HvyDescriptionRequest): string {
  const sectionTitle = request.section.title.trim() || request.section.customId.trim() || 'section';
  const label = request.block ? getBlockLabel(request.block) : sectionTitle;
  const context = request.parentTrail.filter(Boolean).slice(-2).join(' / ');
  const suffix = request.kind === 'expandable-stub'
    ? 'summary view'
    : request.kind === 'expandable-content'
    ? 'expanded details'
    : request.kind === 'section'
    ? 'section content'
    : 'component content';
  return cleanDescription([context, label, suffix].filter(Boolean).join(' - '));
}

function summarizeTargetContent(kind: HvyDescriptionTargetKind, section: VisualSection, block?: VisualBlock): string {
  if (kind === 'section') {
    return truncate([section.title, section.tags, section.blocks.map(summarizeBlock).join('\n')].filter(Boolean).join('\n'));
  }
  if (!block) {
    return '';
  }
  if (kind === 'expandable-stub') {
    return truncate((block.schema.expandableStubBlocks?.children ?? []).map(summarizeBlock).join('\n'));
  }
  if (kind === 'expandable-content') {
    return truncate((block.schema.expandableContentBlocks?.children ?? []).map(summarizeBlock).join('\n'));
  }
  return truncate(summarizeBlock(block));
}

function summarizeBlock(block: VisualBlock): string {
  const values = [
    block.schema.xrefTitle ?? '',
    block.schema.xrefDetail ?? '',
    block.schema.containerTitle ?? '',
    block.schema.imageAlt ?? '',
    block.schema.caption ?? '',
    block.text,
    block.schema.component === 'table' ? renderAltAnnotationsAsFullText((block.schema.tableColumns ?? []).join(' ')) : '',
    block.schema.component === 'table' ? (block.schema.tableRows ?? []).flatMap((row) => row.cells).join(' ') : '',
    (block.schema.containerBlocks ?? []).map(summarizeBlock).join('\n'),
    (block.schema.componentListBlocks ?? []).map(summarizeBlock).join('\n'),
    (block.schema.gridItems ?? []).map((item) => summarizeBlock(item.block)).join('\n'),
  ];
  return values.filter(Boolean).join('\n').replace(/\s+/g, ' ').trim();
}

function findBlockParentPath(blocks: VisualBlock[], targetBlockId: string): VisualBlock[] | null {
  for (const block of blocks) {
    if (block.id === targetBlockId) {
      return [];
    }
    const childLists = [
      block.schema.containerBlocks ?? [],
      block.schema.componentListBlocks ?? [],
      block.schema.expandableStubBlocks?.children ?? [],
      block.schema.expandableContentBlocks?.children ?? [],
      (block.schema.gridItems ?? []).map((item) => item.block),
    ];
    for (const children of childLists) {
      const childPath = findBlockParentPath(children, targetBlockId);
      if (childPath) {
        return [block, ...childPath];
      }
    }
  }
  return null;
}

function getParentContextForBlock(block: VisualBlock): HvyDescriptionParentContext | null {
  const label = getBlockLabel(block)
    || block.schema.description.trim()
    || (block.schema.componentListItemLabel ?? '').trim()
    || (block.schema.componentListComponent ?? '').trim()
    || block.schema.component.trim();
  const description = block.schema.description.trim();
  if (!label && !description) {
    return null;
  }
  return {
    label: label || 'Untitled parent',
    ...(description ? { description } : {}),
  };
}

function getBlockLabel(block: VisualBlock): string {
  return block.schema.xrefTitle.trim()
    || (block.schema.containerTitle ?? '').trim()
    || firstLine(block.text)
    || (block.schema.caption ?? '').trim()
    || (block.schema.imageAlt ?? '').trim()
    || getTableRowLabel(block)
    || getNestedHeadingLabel(block, new Set([block]))
    || '';
}

function getTableRowLabel(block: VisualBlock): string {
  if (block.schema.component !== 'table') {
    return '';
  }
  return firstLine(block.schema.tableRows?.[0]?.cells.join(' ') ?? '');
}

function getNestedHeadingLabel(block: VisualBlock, seen = new Set<VisualBlock>()): string {
  const nestedBlocks = [
    ...(block.schema.expandableContentBlocks?.children ?? []),
    ...(block.schema.expandableStubBlocks?.children ?? []),
    ...(block.schema.containerBlocks ?? []),
    ...(block.schema.componentListBlocks ?? []),
    ...(block.schema.gridItems ?? []).map((item) => item.block),
  ];
  for (const child of nestedBlocks) {
    if (seen.has(child)) {
      continue;
    }
    seen.add(child);
    const direct = firstHeadingLine(child.text);
    if (direct) {
      return direct;
    }
    const nested = getNestedHeadingLabel(child, seen);
    if (nested) {
      return nested;
    }
    const table = getTableRowLabel(child);
    if (table) {
      return table;
    }
  }
  return '';
}

function firstHeadingLine(value: string): string {
  const heading = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^#{1,6}\s+/.test(line));
  return heading ? firstLine(heading.replace(/^#{1,6}\s+/, '')) : '';
}

function firstLine(value: string): string {
  const line = value.replace(/\s+/g, ' ').trim();
  return line.length > 80 ? `${line.slice(0, 79).trim()}...` : line;
}

function truncate(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= MAX_CONTENT_CHARS ? normalized : `${normalized.slice(0, MAX_CONTENT_CHARS - 1).trim()}...`;
}

function cleanDescription(value: string): string {
  return value
    .replace(/^["'`\s]+|["'`\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}
