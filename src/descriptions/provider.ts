import { getReferenceAppConfig } from '../reference-config';
import { buildProviderProxyRequest } from '../chat/chat-provider-payload';
import type { VisualBlock, VisualSection } from '../editor/types';
import type { VisualDocument } from '../types';
import type { HvyDescriptionProvider, HvyDescriptionRequest, HvyDescriptionResponse, HvyDescriptionTargetKind } from './types';

const DEFAULT_DESCRIPTION_MODEL = 'gpt-5.4-nano';
const MAX_CONTENT_CHARS = 1400;

export const localDescriptionProvider: HvyDescriptionProvider = (request) => ({
  description: buildLocalDescription(request),
});

export const openAiDescriptionProvider: HvyDescriptionProvider = async (request) => {
  if (typeof fetch !== 'function') {
    return localDescriptionProvider(request);
  }
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildProviderProxyRequest({
      provider: 'openai',
      model: DEFAULT_DESCRIPTION_MODEL,
      mode: 'qa',
      context: buildDescriptionPrompt(request),
      messages: [{
        role: 'user',
        content: 'Write the description now.',
      }],
    })),
    signal: request.signal,
  });
  const payload = await response.json().catch(() => null) as { output?: unknown; error?: unknown } | null;
  if (!response.ok || typeof payload?.output !== 'string') {
    return localDescriptionProvider(request);
  }
  const description = cleanDescription(payload.output);
  return { description: description || buildLocalDescription(request) };
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
  signal?: AbortSignal;
}): HvyDescriptionRequest {
  return {
    document: params.document,
    section: params.section,
    block: params.block,
    kind: params.kind,
    parentTrail: params.parentTrail ?? [],
    contentSummary: summarizeTargetContent(params.kind, params.section, params.block),
    signal: params.signal,
  };
}

export async function generateDescription(request: HvyDescriptionRequest): Promise<string> {
  const provider = getDescriptionProvider();
  const response: HvyDescriptionResponse = await provider(request);
  return cleanDescription(response.description) || buildLocalDescription(request);
}

function buildDescriptionPrompt(request: HvyDescriptionRequest): string {
  return [
    'Generate one concise search description for this HVY document component.',
    'Rules:',
    '- Return only the description text.',
    '- Keep it under 24 words.',
    '- Describe user-facing purpose, not implementation details.',
    '- Prefer labels and context from parent sections/components.',
    '- Do not mention HVY, JSON, schema, block ids, or component type unless the visible content requires it.',
    '',
    `Target kind: ${request.kind}`,
    `Section: ${request.section.title || request.section.customId || 'Untitled section'}`,
    request.parentTrail.length ? `Parent context: ${request.parentTrail.join(' / ')}` : '',
    request.block ? `Visible label: ${getBlockLabel(request.block)}` : '',
    '',
    'Content:',
    request.contentSummary || '(no visible text)',
  ].filter(Boolean).join('\n');
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
