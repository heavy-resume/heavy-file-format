import { getReferenceAppConfig } from '../reference-config';
import type { VisualBlock, VisualSection } from '../editor/types';
import type { VisualDocument } from '../types';
import type { HvyDescriptionParentContext, HvyDescriptionProvider, HvyDescriptionRequest, HvyDescriptionResponse, HvyDescriptionTargetKind } from './types';

const DEFAULT_DESCRIPTION_MODEL = 'gpt-5.4-nano';
const MAX_CONTENT_CHARS = 1400;

export const localDescriptionProvider: HvyDescriptionProvider = (request) => ({
  description: buildLocalDescription(request),
});

export const openAiDescriptionProvider: HvyDescriptionProvider = async (request) => {
  if (typeof fetch !== 'function') {
    throw new Error('Description generation requires the local chat proxy.');
  }
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      provider: 'openai',
      model: DEFAULT_DESCRIPTION_MODEL,
      mode: 'qa',
      openAiReasoningEffort: 'none',
      context: buildDescriptionPrompt(request),
      messages: [{
        role: 'user',
        content: 'Write the description now.',
      }],
    }),
    signal: request.signal,
  });
  const payload = await response.json().catch(() => null) as { output?: unknown; error?: unknown } | null;
  if (!response.ok || typeof payload?.output !== 'string') {
    const message = typeof payload?.error === 'string' && payload.error.trim()
      ? payload.error.trim()
      : 'Description generation failed.';
    throw new Error(message);
  }
  const description = cleanDescription(payload.output);
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
    '- Keep it under 24 words.',
    '- Describe what function this location serves in the document.',
    '- Do not summarize, restate, or describe the specific contents found here.',
    '- Write a location label such as "skills list for this role", "project details area", or "contact metadata section".',
    '- Use the content only to infer the location function.',
    '- Prefer headings, labels, and parent context over individual values.',
    '- Do not mention HVY, JSON, schema, block ids, or component type unless the visible content requires it.',
    '',
    `Target kind: ${request.kind}`,
    `Section: ${request.section.title || request.section.customId || 'Untitled section'}`,
    request.parentTree.length ? `Parent tree:\n${formatParentTree(request.parentTree)}` : request.parentTrail.length ? `Parent context: ${request.parentTrail.join(' / ')}` : '',
    request.block ? `Visible label: ${getBlockLabel(request.block)}` : '',
    '',
    'Content:',
    request.contentSummary || '(no visible text)',
  ].filter(Boolean).join('\n');
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
    return truncate(block.schema.expandableStubBlocks.children.map(summarizeBlock).join('\n'));
  }
  if (kind === 'expandable-content') {
    return truncate(block.schema.expandableContentBlocks.children.map(summarizeBlock).join('\n'));
  }
  return truncate(summarizeBlock(block));
}

function summarizeBlock(block: VisualBlock): string {
  const values = [
    block.schema.xrefTitle,
    block.schema.xrefDetail,
    block.schema.containerTitle,
    block.schema.imageAlt,
    block.text,
    block.schema.component === 'table' ? block.schema.tableColumns.join(' ') : '',
    block.schema.component === 'table' ? block.schema.tableRows.flatMap((row) => row.cells).join(' ') : '',
    block.schema.containerBlocks.map(summarizeBlock).join('\n'),
    block.schema.componentListBlocks.map(summarizeBlock).join('\n'),
    block.schema.gridItems.map((item) => summarizeBlock(item.block)).join('\n'),
  ];
  return values.filter(Boolean).join('\n').replace(/\s+/g, ' ').trim();
}

function findBlockParentPath(blocks: VisualBlock[], targetBlockId: string): VisualBlock[] | null {
  for (const block of blocks) {
    if (block.id === targetBlockId) {
      return [];
    }
    const childLists = [
      block.schema.containerBlocks,
      block.schema.componentListBlocks,
      block.schema.expandableStubBlocks.children,
      block.schema.expandableContentBlocks.children,
      block.schema.gridItems.map((item) => item.block),
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
    || block.schema.componentListItemLabel.trim()
    || block.schema.componentListComponent.trim()
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
    || block.schema.containerTitle.trim()
    || firstLine(block.text)
    || block.schema.imageAlt.trim()
    || block.schema.id.trim();
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
