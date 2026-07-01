import type { VisualBlock, VisualSection } from '../editor/types';
import { getTextCaptionMarkdown } from '../caption';
import { buildHvyVirtualFileSystem, findVirtualDirectoryForBlock, findVirtualDirectoryForSection } from '../cli-core/virtual-file-system';
import { collectHvyComponentStructureReferences } from '../cli-core/request-structure';
import { resolveBaseComponentFromMeta } from '../component-defs';
import { getSectionId } from '../section-ops';
import type {
  HvySemanticFilterCandidate,
  HvySemanticFilterCandidateBudget,
  HvySemanticFilterRequest,
} from './types';
import type { VisualDocument } from '../types';

const DEFAULT_MAX_CANDIDATE_SUMMARY_CHARS = 800;
const DEFAULT_MAX_TOTAL_CANDIDATE_CHARS = 80_000;
const DEFAULT_MAX_WINDOW_CANDIDATE_CHARS = 10_000;
const UNLIMITED_CANDIDATE_SUMMARY_CHARS = Number.MAX_SAFE_INTEGER;
const SEMANTIC_WINDOW_CHUNK_OVERLAP_CHARS = 400;

interface BuildSemanticFilterRequestOptions {
  document: VisualDocument;
  prompt: string;
  signal?: AbortSignal;
  maxCandidateSummaryChars?: number;
  maxTotalCandidateChars?: number;
}

export interface HvySemanticFilterCandidateWindow {
  windowIndex: number;
  windowCount: number;
  label: string;
  candidates: HvySemanticFilterCandidate[];
  candidateBudget: HvySemanticFilterCandidateBudget;
}

interface BuildSemanticFilterWindowsOptions extends BuildSemanticFilterRequestOptions {
  maxWindowCandidateChars?: number;
}

export function buildSemanticFilterRequest(options: BuildSemanticFilterRequestOptions): HvySemanticFilterRequest {
  const maxCandidateSummaryChars = options.maxCandidateSummaryChars ?? DEFAULT_MAX_CANDIDATE_SUMMARY_CHARS;
  const maxTotalCandidateChars = options.maxTotalCandidateChars ?? DEFAULT_MAX_TOTAL_CANDIDATE_CHARS;
  const allCandidates = buildSemanticFilterCandidates(options.document, { maxCandidateSummaryChars });
  const { candidates, candidateBudget } = applySemanticCandidateBudget(allCandidates, {
    maxCandidateSummaryChars,
    maxTotalCandidateChars,
  });
  const documentTitle = getDocumentTitle(options.document);
  return {
    prompt: options.prompt,
    instructionPrompt: buildSemanticFilterInstructionPrompt(options.prompt, candidates),
    ...(documentTitle ? { documentTitle } : {}),
    candidates,
    candidateBudget,
    ...(options.signal ? { signal: options.signal } : {}),
  };
}

export function buildSemanticFilterWindows(options: BuildSemanticFilterWindowsOptions): {
  candidates: HvySemanticFilterCandidate[];
  candidateBudget: HvySemanticFilterCandidateBudget;
  windows: HvySemanticFilterCandidateWindow[];
} {
  const maxCandidateSummaryChars = UNLIMITED_CANDIDATE_SUMMARY_CHARS;
  const maxTotalCandidateChars = options.maxTotalCandidateChars ?? DEFAULT_MAX_TOTAL_CANDIDATE_CHARS;
  const maxWindowCandidateChars = options.maxWindowCandidateChars ?? DEFAULT_MAX_WINDOW_CANDIDATE_CHARS;
  const candidates = buildSemanticFilterCandidates(options.document, { maxCandidateSummaryChars })
    .sort((left, right) => left.documentOrder - right.documentOrder);
  const candidateIdsWithDescendants = getCandidateIdsWithDescendants(candidates);
  const windowCandidates = candidates.filter((candidate) => !candidateIdsWithDescendants.has(candidate.candidateId));
  const candidateBudget = summarizeSemanticCandidateBudget(windowCandidates, {
    maxCandidateSummaryChars,
    maxTotalCandidateChars,
  });
  const windows = packSemanticCandidateWindows(windowCandidates, {
    maxCandidateSummaryChars,
    maxWindowCandidateChars,
    overallCandidateBudget: candidateBudget,
  });
  return { candidates, candidateBudget, windows };
}

export function buildSemanticFilterWindowRequest(
  prompt: string,
  window: HvySemanticFilterCandidateWindow,
  options: { documentTitle?: string; traceRunId?: string; signal?: AbortSignal } = {}
): HvySemanticFilterRequest {
  return {
    prompt,
    instructionPrompt: buildSemanticFilterInstructionPrompt(prompt, window.candidates),
    ...(options.documentTitle ? { documentTitle: options.documentTitle } : {}),
    candidates: window.candidates,
    candidateBudget: window.candidateBudget,
    windowIndex: window.windowIndex,
    windowCount: window.windowCount,
    windowLabel: window.label,
    ...(options.traceRunId ? { traceRunId: options.traceRunId } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  };
}

export function buildSemanticFilterCandidates(
  document: VisualDocument,
  options: { maxCandidateSummaryChars?: number } = {}
): HvySemanticFilterCandidate[] {
  const maxCandidateSummaryChars = options.maxCandidateSummaryChars ?? DEFAULT_MAX_CANDIDATE_SUMMARY_CHARS;
  const sectionCandidates: HvySemanticFilterCandidate[] = [];
  const blockCandidates: HvySemanticFilterCandidate[] = [];
  const targetRefs = buildSemanticTargetRefs(document);
  let documentOrder = 0;

  const visitSection = (section: VisualSection, ancestors: string[]): void => {
    if (section.isGhost) {
      return;
    }
    const sectionOrder = documentOrder;
    documentOrder += 1;
    const sectionLabel = section.title.trim() || getSectionId(section) || 'Untitled section';
    const targetPath = findVirtualDirectoryForSection(document, section);
    const targetRef = targetPath ?? (getSectionId(section) || section.key);
    const sectionSummary = truncateSummary(buildSectionSummary(section), maxCandidateSummaryChars);
    sectionCandidates.push({
      candidateId: `section:${targetRef}`,
      targetKind: 'section',
      sectionKey: section.key,
      targetId: getSectionId(section) || section.key,
      ...(targetPath ? { targetPath } : {}),
      targetRef,
      label: sectionLabel,
      ...(ancestors.length ? { contextLabel: ancestors.slice(-3).join(' / ') } : {}),
      tags: splitTags(section.tags ?? ''),
      description: cleanText(section.description ?? ''),
      summary: sectionSummary.summary,
      documentOrder: sectionOrder,
      truncated: sectionSummary.truncated,
    });
    const nextAncestors = appendContext(ancestors, sectionLabel);
    for (const block of section.blocks) {
      visitBlock(document, section, block, nextAncestors, sectionLabel);
    }
    for (const child of section.children) {
      visitSection(child, nextAncestors);
    }
  };

  const visitBlock = (
    document: VisualDocument,
    section: VisualSection,
    block: VisualBlock,
    contextTrail: string[],
    nearestLocationLabel: string
  ): void => {
    const blockOrder = documentOrder;
    documentOrder += 1;
    const baseComponent = resolveBaseComponentFromMeta(block.schema.component, document.meta);
    const label = getBlockLabel(block) || nearestLocationLabel;
    const locationLabel = (block.schema.description ?? '').trim() || nearestLocationLabel;
    const targetPath = findVirtualDirectoryForBlock(document, block);
    const targetRef = (targetPath ? targetRefs.componentRefsByPath.get(targetPath) : undefined) ?? (block.schema.id.trim() || block.id);
    const summaryResult = truncateSummary(buildBlockSummary(block, baseComponent), maxCandidateSummaryChars);
    const contextLabel = contextTrail.filter((part) => part && part !== label).slice(-3).join(' / ');
    blockCandidates.push({
      candidateId: `component:${targetRef}`,
      targetKind: 'block',
      sectionKey: section.key,
      blockId: block.id,
      targetId: (block.schema.id ?? '').trim() || block.id,
      ...(targetPath ? { targetPath } : {}),
      targetRef,
      label,
      locationLabel,
      ...(contextLabel ? { contextLabel } : {}),
      tags: splitTags(block.schema.tags ?? ''),
      description: cleanText(block.schema.description ?? ''),
      summary: summaryResult.summary,
      documentOrder: blockOrder,
      truncated: summaryResult.truncated,
    });
    const childTrail = appendContext(contextTrail, getBlockContextLabel(block));
    const childLocation = locationLabel || nearestLocationLabel;
    for (const child of block.schema.containerBlocks ?? []) visitBlock(document, section, child, childTrail, childLocation);
    for (const child of block.schema.componentListBlocks ?? []) visitBlock(document, section, child, childTrail, childLocation);
    for (const child of block.schema.expandableStubBlocks?.children ?? []) {
      visitBlock(document, section, child, childTrail, (block.schema.expandableStubDescription ?? '').trim() || childLocation);
    }
    for (const child of block.schema.expandableContentBlocks?.children ?? []) {
      visitBlock(document, section, child, childTrail, (block.schema.expandableContentDescription ?? '').trim() || childLocation);
    }
    for (const item of block.schema.gridItems ?? []) visitBlock(document, section, item.block, childTrail, childLocation);
  };

  for (const section of document.sections) {
    visitSection(section, []);
  }
  return [...sectionCandidates, ...blockCandidates];
}

function buildSemanticTargetRefs(document: VisualDocument): { componentRefsByPath: Map<string, string> } {
  const fs = buildHvyVirtualFileSystem(document);
  return {
    componentRefsByPath: new Map(
      collectHvyComponentStructureReferences(document, fs).map((entry) => [entry.directory, entry.id])
    ),
  };
}

export function buildSemanticFilterInstructionPrompt(prompt: string, candidates: HvySemanticFilterCandidate[]): string {
  const candidateBlocks = formatSemanticCandidatePromptBlocks(candidates);
  return [
    'You are selecting visible content from structured HVY document candidates for a semantic filter.',
    '',
    '--- user filter prompt ---',
    prompt,
    '--- end user filter prompt ---',
    '',
    'Candidate list as XML-like structured text:',
    ...candidateBlocks,
    '',
    'Selection contract:',
    '1. First pass: list only candidate IDs that obviously satisfy the user filter prompt, with one short sentence explaining why each is relevant.',
    '2. If no candidates are relevant, write that no candidates are relevant.',
    '3. Final answer: write one JSON array containing exactly the candidate IDs from the first pass.',
    '4. If the first pass found no relevant candidates, the final JSON array must be [].',
    '',
    'Relevance rules:',
    '- Relevant means the candidate has direct evidence from its text, tags, label, description, or surrounding context.',
    '- Exclude loosely associated, incidental, speculative, or merely adjacent candidates.',
    '- If explaining relevance takes more than one sentence, exclude the candidate.',
    '- Do not output all candidate IDs unless every candidate was listed as relevant in the first pass.',
    '- Only use candidateId values from the candidate list.',
    '- Prefer the most precise leaf component candidate whose text satisfies the prompt.',
    '- Parent sections and containers are included automatically when a leaf component matches.',
    '- Do not invent IDs.',
    '- Do not rewrite the document.',
    '',
    'End with the final JSON array on its own line. Do not put explanations inside the JSON array.',
  ].join('\n');
}

function formatSemanticCandidatePromptBlocks(candidates: HvySemanticFilterCandidate[]): string[] {
  const blocks: string[] = [];
  let contextStack: string[] = [];
  for (const candidate of candidates) {
    const contextParts = getSemanticCandidatePromptContextParts(candidate);
    let shared = 0;
    while (
      shared < contextStack.length
      && shared < contextParts.length
      && contextStack[shared] === contextParts[shared]
    ) {
      shared += 1;
    }
    for (let index = contextStack.length - 1; index >= shared; index -= 1) {
      blocks.push(`${'  '.repeat(index)}</context>`);
    }
    for (let index = shared; index < contextParts.length; index += 1) {
      blocks.push(`${'  '.repeat(index)}<context label="${escapeSemanticXmlAttr(contextParts[index]!)}">`);
    }
    contextStack = contextParts;
    blocks.push(formatSemanticCandidatePromptBlock(candidate));
  }
  for (let index = contextStack.length - 1; index >= 0; index -= 1) {
    blocks.push(`${'  '.repeat(index)}</context>`);
  }
  return blocks;
}

function formatSemanticCandidatePromptBlock(candidate: HvySemanticFilterCandidate): string {
  const indent = '  '.repeat(getSemanticCandidatePromptContextParts(candidate).length);
  const attributes = [
    `id="${escapeSemanticXmlAttr(candidate.candidateId)}"`,
    ...(candidate.documentId ? [`document-id="${escapeSemanticXmlAttr(candidate.documentId)}"`] : []),
    ...(candidate.documentTitle ? [`document-title="${escapeSemanticXmlAttr(candidate.documentTitle)}"`] : []),
    ...(candidate.tags.length ? [`tags="${escapeSemanticXmlAttr(candidate.tags.join(', '))}"`] : []),
    ...(candidate.windowChunk ? [`chunk="${candidate.windowChunk.index + 1}/${candidate.windowChunk.count}"`, `chars="${candidate.windowChunk.start}-${candidate.windowChunk.end}"`] : []),
  ].join(' ');
  return [
    `${indent}<candidate ${attributes}>`,
    `${indent}  ${escapeSemanticXmlText(candidate.summary)}`,
    `${indent}</candidate>`,
  ].join('\n');
}

function getSemanticCandidatePromptContextParts(candidate: HvySemanticFilterCandidate): string[] {
  const parts = [
    ...(candidate.documentTitle ? [candidate.documentTitle] : []),
    ...splitContextParts(candidate.contextLabel ?? ''),
    ...splitContextParts(candidate.locationLabel ?? ''),
  ].map(cleanText).filter(Boolean);
  return parts.filter((part, index) => parts.indexOf(part) === index);
}

function splitContextParts(value: string): string[] {
  return value.split('/').map((part) => part.trim()).filter(Boolean);
}

function escapeSemanticXmlAttr(value: string): string {
  return escapeSemanticXmlText(value).replace(/"/g, '&quot;');
}

function escapeSemanticXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function applySemanticCandidateBudget(
  candidates: HvySemanticFilterCandidate[],
  options: { maxCandidateSummaryChars: number; maxTotalCandidateChars: number }
): { candidates: HvySemanticFilterCandidate[]; candidateBudget: HvySemanticFilterCandidateBudget } {
  const included: HvySemanticFilterCandidate[] = [];
  let usedTotalCandidateChars = 0;
  for (const candidate of candidates) {
    const candidateChars = JSON.stringify(candidate).length;
    if (included.length > 0 && usedTotalCandidateChars + candidateChars > options.maxTotalCandidateChars) {
      break;
    }
    included.push(candidate);
    usedTotalCandidateChars += candidateChars;
  }
  return {
    candidates: included,
    candidateBudget: {
      maxCandidateSummaryChars: options.maxCandidateSummaryChars,
      maxTotalCandidateChars: options.maxTotalCandidateChars,
      usedTotalCandidateChars,
      includedCandidates: included.length,
      totalCandidates: candidates.length,
      truncated: included.length < candidates.length || included.some((candidate) => candidate.truncated),
    },
  };
}

function summarizeSemanticCandidateBudget(
  candidates: HvySemanticFilterCandidate[],
  options: { maxCandidateSummaryChars: number; maxTotalCandidateChars: number }
): HvySemanticFilterCandidateBudget {
  return {
    maxCandidateSummaryChars: options.maxCandidateSummaryChars,
    maxTotalCandidateChars: options.maxTotalCandidateChars,
    usedTotalCandidateChars: candidates.reduce((total, candidate) => total + getSemanticCandidatePromptChars(candidate), 0),
    includedCandidates: candidates.length,
    totalCandidates: candidates.length,
    truncated: candidates.some((candidate) => candidate.truncated),
  };
}

function packSemanticCandidateWindows(
  candidates: HvySemanticFilterCandidate[],
  options: {
    maxCandidateSummaryChars: number;
    maxWindowCandidateChars: number;
    overallCandidateBudget: HvySemanticFilterCandidateBudget;
  }
): HvySemanticFilterCandidateWindow[] {
  const windows: Array<{ label: string; candidates: HvySemanticFilterCandidate[]; usedTotalCandidateChars: number }> = [];
  let current: HvySemanticFilterCandidate[] = [];
  let currentChars = 0;

  const flush = (): void => {
    if (current.length === 0) {
      return;
    }
    windows.push({
      label: getSemanticWindowLabel(current),
      candidates: current,
      usedTotalCandidateChars: currentChars,
    });
    current = [];
    currentChars = 0;
  };

  const pushCandidate = (candidate: HvySemanticFilterCandidate): void => {
    const candidateChars = getSemanticCandidatePromptChars(candidate);
    const startsSectionWindow = candidate.targetKind === 'section' && current.length > 0;
    const exceedsWindow = current.length > 0 && currentChars + candidateChars > options.maxWindowCandidateChars;
    if (startsSectionWindow || exceedsWindow) {
      flush();
    }
    current.push(candidate);
    currentChars += candidateChars;
  };

  for (const candidate of candidates) {
    for (const windowCandidate of buildWindowCandidateChunks(candidate, options.maxWindowCandidateChars)) {
      pushCandidate(windowCandidate);
    }
  }
  flush();

  return windows.map((window, index) => ({
    windowIndex: index,
    windowCount: windows.length,
    label: window.label,
    candidates: window.candidates,
    candidateBudget: {
      maxCandidateSummaryChars: options.maxCandidateSummaryChars,
      maxTotalCandidateChars: options.maxWindowCandidateChars,
      usedTotalCandidateChars: window.usedTotalCandidateChars,
      includedCandidates: window.candidates.length,
      totalCandidates: options.overallCandidateBudget.totalCandidates,
      truncated: options.overallCandidateBudget.truncated,
    },
  }));
}

function getCandidateIdsWithDescendants(candidates: HvySemanticFilterCandidate[]): Set<string> {
  const candidatesWithDescendants = new Set<string>();
  const candidatesWithPaths = candidates.filter((candidate) => candidate.targetPath);
  for (const candidate of candidatesWithPaths) {
    const candidatePath = candidate.targetPath;
    if (!candidatePath) {
      continue;
    }
    const descendantPrefix = `${candidatePath}/`;
    if (candidatesWithPaths.some((other) => other !== candidate && other.targetPath?.startsWith(descendantPrefix))) {
      candidatesWithDescendants.add(candidate.candidateId);
    }
  }
  return candidatesWithDescendants;
}

function buildWindowCandidateChunks(
  candidate: HvySemanticFilterCandidate,
  maxWindowCandidateChars: number
): HvySemanticFilterCandidate[] {
  const candidateChars = getSemanticCandidatePromptChars(candidate);
  if (candidateChars <= maxWindowCandidateChars || candidate.summary.length === 0) {
    return [candidate];
  }

  const emptySummaryChars = getSemanticCandidatePromptChars({ ...candidate, summary: '', windowChunk: { index: 0, count: 1, start: 0, end: 0 } });
  const maxSummaryChars = Math.max(1, maxWindowCandidateChars - emptySummaryChars);
  if (maxSummaryChars >= candidate.summary.length) {
    return [candidate];
  }

  const overlapChars = Math.min(
    SEMANTIC_WINDOW_CHUNK_OVERLAP_CHARS,
    Math.max(0, Math.floor(maxSummaryChars / 4))
  );
  const stepChars = Math.max(1, maxSummaryChars - overlapChars);
  const ranges: Array<{ start: number; end: number }> = [];
  for (let start = 0; start < candidate.summary.length; start += stepChars) {
    const end = Math.min(candidate.summary.length, start + maxSummaryChars);
    ranges.push({ start, end });
    if (end >= candidate.summary.length) {
      break;
    }
  }

  return ranges.map((range, index) => ({
    ...candidate,
    summary: candidate.summary.slice(range.start, range.end),
    truncated: false,
    windowChunk: {
      index,
      count: ranges.length,
      start: range.start,
      end: range.end,
    },
  }));
}

function getSemanticCandidatePromptChars(candidate: HvySemanticFilterCandidate): number {
  const contextChars = getSemanticCandidatePromptContextParts(candidate)
    .reduce((total, part, index) => total + `${'  '.repeat(index)}<context label="${escapeSemanticXmlAttr(part)}">\n`.length + `${'  '.repeat(index)}</context>\n`.length, 0);
  return formatSemanticCandidatePromptBlock(candidate).length + contextChars;
}

function getSemanticWindowLabel(candidates: HvySemanticFilterCandidate[]): string {
  const section = candidates.find((candidate) => candidate.targetKind === 'section') ?? candidates[0];
  if (!section) {
    return 'Document window';
  }
  return section.contextLabel ? `${section.contextLabel} / ${section.label}` : section.label;
}

function buildSectionSummary(section: VisualSection): string {
  return cleanText([
    section.title,
    section.tags ?? '',
  ].join('\n'));
}

function buildBlockSummary(block: VisualBlock, baseComponent: string): string {
  const childSummary = shouldSummarizeChildContent(baseComponent, block)
    ? getNestedBlockSummaryText(block)
    : '';
  return cleanText([
    block.schema.component,
    block.schema.tags ?? '',
    block.schema.xrefTitle ?? '',
    block.schema.xrefDetail ?? '',
    block.schema.containerTitle ?? '',
    block.schema.imageAlt ?? '',
    getTextCaptionMarkdown(block.schema.caption),
    (block.schema.tableColumns ?? []).join(' '),
    (block.schema.tableRows ?? []).flatMap((row) => row.cells).join(' '),
    block.text,
    childSummary,
  ].join('\n'));
}

function shouldSummarizeChildContent(baseComponent: string, block: VisualBlock): boolean {
  return baseComponent === 'expandable'
    || (block.schema.component !== baseComponent && baseComponent !== 'component-list' && baseComponent !== 'container' && baseComponent !== 'grid');
}

function getNestedBlockSummaryText(block: VisualBlock): string {
  return cleanText([
    ...(block.schema.containerBlocks ?? []).map(getBlockSummaryText),
    ...(block.schema.componentListBlocks ?? []).map(getBlockSummaryText),
    ...(block.schema.expandableStubBlocks?.children ?? []).map(getBlockSummaryText),
    ...(block.schema.expandableContentBlocks?.children ?? []).map(getBlockSummaryText),
    ...(block.schema.gridItems ?? []).map((item) => getBlockSummaryText(item.block)),
  ].join('\n'));
}

function getBlockSummaryText(block: VisualBlock): string {
  return cleanText([
    block.schema.xrefTitle ?? '',
    block.schema.containerTitle ?? '',
    block.text,
    block.schema.imageAlt ?? '',
    getTextCaptionMarkdown(block.schema.caption),
    ...(block.schema.containerBlocks ?? []).map(getBlockSummaryText),
    ...(block.schema.componentListBlocks ?? []).map(getBlockSummaryText),
    ...(block.schema.expandableStubBlocks?.children ?? []).map(getBlockSummaryText),
    ...(block.schema.expandableContentBlocks?.children ?? []).map(getBlockSummaryText),
    ...(block.schema.gridItems ?? []).map((item) => getBlockSummaryText(item.block)),
  ].join('\n'));
}

function getBlockLabel(block: VisualBlock): string {
  return cleanText(block.schema.xrefTitle ?? '')
    || cleanText(block.schema.containerTitle ?? '')
    || firstLine(block.text)
    || cleanText(getTextCaptionMarkdown(block.schema.caption))
    || cleanText(block.schema.imageAlt ?? '')
    || cleanText(block.schema.id ?? '');
}

function getBlockContextLabel(block: VisualBlock): string {
  return cleanText(block.schema.xrefTitle ?? '')
    || cleanText(block.schema.containerTitle ?? '')
    || firstLine(block.text)
    || cleanText(getTextCaptionMarkdown(block.schema.caption))
    || cleanText(block.schema.imageAlt ?? '');
}

function getDocumentTitle(document: VisualDocument): string {
  const title = document.meta.title;
  return typeof title === 'string' ? title.trim() : '';
}

export function getSemanticDocumentTitle(document: VisualDocument): string {
  return getDocumentTitle(document);
}

export function getDefaultSemanticCandidateBudget(): {
  maxCandidateSummaryChars: number;
  maxTotalCandidateChars: number;
} {
  return {
    maxCandidateSummaryChars: DEFAULT_MAX_CANDIDATE_SUMMARY_CHARS,
    maxTotalCandidateChars: DEFAULT_MAX_TOTAL_CANDIDATE_CHARS,
  };
}

function splitTags(tags: string): string[] {
  return tags.split(',').map((tag) => tag.trim()).filter(Boolean);
}

function appendContext(context: string[], label: string): string[] {
  const clean = cleanText(label);
  if (!clean || context[context.length - 1] === clean) {
    return context;
  }
  return [...context, clean];
}

function firstLine(value: string): string {
  const clean = cleanText(value);
  return clean.length > 82 ? `${clean.slice(0, 81).trim()}...` : clean;
}

function cleanText(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^#{1,6}\s+/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateSummary(value: string, maxChars: number): { summary: string; truncated: boolean } {
  const clean = cleanText(value);
  if (clean.length <= maxChars) {
    return { summary: clean, truncated: false };
  }
  return { summary: `${clean.slice(0, Math.max(0, maxChars - 3)).trim()}...`, truncated: true };
}
