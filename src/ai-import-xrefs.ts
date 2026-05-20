import { requestProxyCompletion, type HostChatClient, type ProxyCompletionParams } from './chat/chat';
import { createEmptyBlock } from './document-factory';
import { throwIfAborted } from './ai-document-loop-state';
import type { ChatSettings, VisualDocument } from './types';
import type { HvyImportTraceRecorder } from './ai-document-import';
import {
  buildImportXrefBatches,
  type ImportXrefBatch,
  type ImportXrefListDescriptor,
  type ImportXrefTargetOption,
} from './ai-import-xref-batches';

interface ImportXrefLlmOptions {
  settings: ChatSettings;
  client?: HostChatClient | null;
  stages?: {
    xrefs?: ChatSettings;
  };
}

interface ImportXrefPassOptions {
  sourceName: string;
  sourceText: string;
  instructions?: string;
  signal?: AbortSignal;
}

interface ImportXrefCreatedTarget {
  id: string;
  title: string;
  kind: string;
  sectionTitle: string;
  sectionId: string;
  component: string;
  text: string;
}

type ImportXrefBeforeLlmCall = ((phase: 'thinking') => ((debugLabel: string) => Promise<void> | void) | undefined) | undefined;

interface ImportXrefItemFill {
  xrefTarget: string;
  xrefTitle?: string;
  xrefDetail?: string;
}

export async function runImportXrefPass(
  document: VisualDocument,
  options: ImportXrefPassOptions,
  llm: ImportXrefLlmOptions,
  beforeLlmCall: ImportXrefBeforeLlmCall,
  traceRecorder: HvyImportTraceRecorder | undefined,
  sectionKeys: string[],
  createdTargets: ImportXrefCreatedTarget[]
): Promise<number> {
  const batches = buildImportXrefBatches(document, sectionKeys);
  let applied = 0;
  for (const [index, batch] of batches.entries()) {
    throwIfAborted(options.signal);
    const request: ProxyCompletionParams = {
      settings: llm.stages?.xrefs ?? llm.settings,
      client: llm.client,
      messages: [
        {
          id: `ai-import-xrefs-${index + 1}-task`,
          role: 'user',
          content: buildImportXrefTaskMessage(options, batch, index, batches.length),
        },
      ],
      context: buildImportXrefContext(options, batch, createdTargets),
      responseInstructions: buildImportXrefResponseInstructions(batch),
      systemInstructions: [
        'You are performing the final HVY import xref pass.',
        'Return only the requested JSON object.',
      ].join('\n'),
      mode: 'document-edit',
      debugLabel: `ai-import-xrefs:${index + 1}`,
      beforeRequest: beforeLlmCall?.('thinking'),
      signal: options.signal,
    };
    const response = traceRecorder
      ? await traceRecorder.recordCompletion('xrefs', 'thinking', request)
      : await requestProxyCompletion(request);
    throwIfAborted(options.signal);
    applied += applyImportXrefResponse(document, batch, response);
  }
  return applied;
}

export function applyImportXrefResponse(document: VisualDocument, batch: ImportXrefBatch, response: string): number {
  const parsed = parseImportXrefResponse(response);
  if (!parsed) {
    return 0;
  }
  let applied = 0;
  for (const list of batch.lists) {
    if (!Object.prototype.hasOwnProperty.call(parsed, list.listId)) {
      continue;
    }
    const rawItems = parsed[list.listId];
    if (!Array.isArray(rawItems)) {
      continue;
    }
    const nextItems = rawItems
      .map((item) => normalizeImportXrefItem(item, list.allowedTargets))
      .filter((item): item is ImportXrefItemFill => !!item)
      .map((item) => createImportXrefBlock(document, list, item));
    list.block.schema.componentListBlocks = nextItems;
    applied += 1;
  }
  return applied;
}

function buildImportXrefTaskMessage(options: ImportXrefPassOptions, batch: ImportXrefBatch, index: number, total: number): string {
  return [
    `Fill xref component lists for imported section "${batch.sectionTitle}" from "${options.sourceName}".`,
    `Xref batch ${index + 1} of ${total}: ${batch.debugName}.`,
    '',
    'Use only source-backed relationships visible in the source document and current section context.',
    'Only choose targets from the allowed target lists provided for each L-key.',
    'Return xrefs only for relationships that are clearly supported.',
    'Use the L-key IDs exactly as response object keys.',
    'Do not invent targets, labels, details, records, dates, or metrics.',
    options.instructions?.trim() ? ['Additional import instructions:', options.instructions.trim()].join('\n') : '',
    '',
    '=== BEGIN RESPONSE INSTRUCTIONS ===',
    buildImportXrefResponseInstructions(batch),
    '=== END RESPONSE INSTRUCTIONS ===',
  ].filter(Boolean).join('\n');
}

function buildImportXrefContext(options: ImportXrefPassOptions, batch: ImportXrefBatch, createdTargets: ImportXrefCreatedTarget[]): string {
  return [
    '=== BEGIN SOURCE DOCUMENT ===',
    `Source name: ${options.sourceName}`,
    '```text',
    options.sourceText,
    '```',
    '=== END SOURCE DOCUMENT ===',
    '',
    buildCreatedTargetFrame(createdTargets),
    '',
    buildBatchListFrame(batch),
    '',
    '=== BEGIN CURRENT IMPORTED SECTION CONTEXT ===',
    batch.contextHvy,
    '=== END CURRENT IMPORTED SECTION CONTEXT ===',
  ].join('\n');
}

function buildBatchListFrame(batch: ImportXrefBatch): string {
  return [
    '=== BEGIN ELIGIBLE XREF LISTS ===',
    `Section: ${batch.sectionTitle}${batch.sectionId ? ` (${batch.sectionId})` : ''}`,
    `Section path: ${batch.sectionPath}`,
    batch.lists.map((list) => [
      `${list.listId}: component-list`,
      `componentListComponent: ${list.component}`,
      list.itemLabel ? `item label: ${list.itemLabel}` : '',
      list.path ? `CLI path: ${list.path}` : '',
      'Existing items:',
      list.existingItems.length > 0
        ? list.existingItems.map((item) => `- ${item.xrefTitle || '(untitled)'}${item.xrefDetail ? ` - ${item.xrefDetail}` : ''} -> ${item.xrefTarget || '(missing target)'}`).join('\n')
        : '- none',
      'Allowed targets:',
      formatAllowedTargets(list.allowedTargets),
    ].filter(Boolean).join('\n')).join('\n\n'),
    '=== END ELIGIBLE XREF LISTS ===',
  ].join('\n');
}

function formatAllowedTargets(targets: ImportXrefTargetOption[]): string {
  return targets.length > 0
    ? targets.map((target) => `- value="${target.value}" label="${target.label}" title="${target.title}" detail="${target.detail}" path="${target.path}"`).join('\n')
    : '- none';
}

function buildCreatedTargetFrame(createdTargets: ImportXrefCreatedTarget[]): string {
  return [
    '=== BEGIN CREATED IMPORT TARGETS ===',
    createdTargets.length > 0
      ? createdTargets.map((target) => [
        `- ${target.id}: ${target.title} [${target.kind}]`,
        `  section: ${target.sectionTitle}${target.sectionId ? ` (${target.sectionId})` : ''}`,
        target.component ? `  component: ${target.component}` : '',
        target.text ? `  peek: ${target.text}` : '',
      ].filter(Boolean).join('\n')).join('\n')
      : '- No created import targets.',
    '=== END CREATED IMPORT TARGETS ===',
  ].join('\n');
}

function buildImportXrefResponseInstructions(batch: ImportXrefBatch): string {
  const example = Object.fromEntries(batch.lists.map((list) => [
    list.listId,
    [{ xrefTarget: 'target-id', xrefTitle: 'Target title', xrefDetail: 'Optional detail' }],
  ]));
  return [
    'Return exactly one JSON object and no prose.',
    'Shape:',
    JSON.stringify(example),
    '',
    `Allowed object keys: ${batch.lists.map((list) => list.listId).join(', ')}.`,
    'Each key value must be an array of xref objects.',
    '`xrefTarget` is required and must exactly match one allowed target value for that list.',
    '`xrefTitle` and `xrefDetail` are optional; omit or use empty string to use the target defaults.',
    'Omit a list key to leave that list unchanged.',
    'Use an empty array to clear/fill no xrefs for that list.',
  ].join('\n');
}

function parseImportXrefResponse(response: string): Record<string, unknown> | null {
  const trimmed = response.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]?.trim();
  try {
    const parsed = JSON.parse(fenced ?? trimmed) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function normalizeImportXrefItem(raw: unknown, allowedTargets: ImportXrefTargetOption[]): ImportXrefItemFill | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const value = raw as { xrefTarget?: unknown; xrefTitle?: unknown; xrefDetail?: unknown };
  const xrefTarget = typeof value.xrefTarget === 'string' ? value.xrefTarget.trim() : '';
  if (!xrefTarget || !allowedTargets.some((target) => target.value === xrefTarget)) {
    return null;
  }
  return {
    xrefTarget,
    xrefTitle: typeof value.xrefTitle === 'string' ? value.xrefTitle.trim() : '',
    xrefDetail: typeof value.xrefDetail === 'string' ? value.xrefDetail.trim() : '',
  };
}

function createImportXrefBlock(document: VisualDocument, list: ImportXrefListDescriptor, item: ImportXrefItemFill) {
  const option = list.allowedTargets.find((target) => target.value === item.xrefTarget);
  const block = createEmptyBlock(list.component, false, document.meta);
  block.schema.component = list.component;
  block.schema.id = '';
  block.schema.xrefTarget = item.xrefTarget;
  block.schema.xrefTitle = item.xrefTitle?.trim() || option?.title || item.xrefTarget;
  block.schema.xrefDetail = item.xrefDetail?.trim() || option?.detail || '';
  return block;
}
