import type { VisualBlock, VisualSection } from '../editor/types';
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
const DEFAULT_MAX_WINDOW_CANDIDATE_CHARS = 12_000;

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
  const maxCandidateSummaryChars = options.maxCandidateSummaryChars ?? DEFAULT_MAX_CANDIDATE_SUMMARY_CHARS;
  const maxTotalCandidateChars = options.maxTotalCandidateChars ?? DEFAULT_MAX_TOTAL_CANDIDATE_CHARS;
  const maxWindowCandidateChars = options.maxWindowCandidateChars ?? DEFAULT_MAX_WINDOW_CANDIDATE_CHARS;
  const allCandidates = buildSemanticFilterCandidates(options.document, { maxCandidateSummaryChars })
    .sort((left, right) => left.documentOrder - right.documentOrder);
  const { candidates, candidateBudget } = applySemanticCandidateBudget(allCandidates, {
    maxCandidateSummaryChars,
    maxTotalCandidateChars,
  });
  const windows = packSemanticCandidateWindows(candidates, {
    maxCandidateSummaryChars,
    maxWindowCandidateChars,
    overallCandidateBudget: candidateBudget,
  });
  return { candidates, candidateBudget, windows };
}

export function buildSemanticFilterWindowRequest(
  prompt: string,
  window: HvySemanticFilterCandidateWindow,
  options: { documentTitle?: string; signal?: AbortSignal } = {}
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
  const candidateLines = candidates.map((candidate) => JSON.stringify({
    candidateId: candidate.candidateId,
    ...(candidate.documentId ? { documentId: candidate.documentId } : {}),
    ...(candidate.documentTitle ? { documentTitle: candidate.documentTitle } : {}),
    targetKind: candidate.targetKind,
    ...(candidate.targetRef ? { targetRef: candidate.targetRef } : {}),
    ...(candidate.targetPath ? { targetPath: candidate.targetPath } : {}),
    label: candidate.label,
    ...(candidate.locationLabel ? { locationLabel: candidate.locationLabel } : {}),
    ...(candidate.contextLabel ? { contextLabel: candidate.contextLabel } : {}),
    tags: candidate.tags,
    description: candidate.description,
    summary: candidate.summary,
    documentOrder: candidate.documentOrder,
    truncated: candidate.truncated,
  }));
  return [
    'You are selecting visible content from structured HVY document candidates.',
    '',
    'User filter prompt:',
    JSON.stringify(prompt),
    '',
    'Choose the candidates that are relevant to the user prompt. Return only JSON:',
    '{',
    '  "matches": ["candidateId from the list"]',
    '}',
    '',
    'Rules:',
    '- Only use candidateId values from the candidate list.',
    '- Return only matching candidateId strings; do not include explanations.',
    '- candidateId values identify exact section/component targets. Component targetRef values match the CLI request_structure IDs, including generated C0/C1-style IDs for anonymous components.',
    '- Prefer the most precise component candidate whose summary satisfies the prompt.',
    '- Prefer child item/record candidates over their parent list/container candidates unless the user asks for the whole group.',
    '- Select a section only when the section itself is relevant or the user asks for that whole section.',
    '- Do not invent IDs.',
    '- Do not rewrite the document.',
    '- Do not include unrelated candidates.',
    '',
    'Candidate list as JSONL:',
    ...candidateLines,
  ].join('\n');
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

  for (const candidate of candidates) {
    const candidateChars = JSON.stringify(candidate).length;
    const startsSectionWindow = candidate.targetKind === 'section' && current.length > 0;
    const exceedsWindow = current.length > 0 && currentChars + candidateChars > options.maxWindowCandidateChars;
    if (startsSectionWindow || exceedsWindow) {
      flush();
    }
    current.push(candidate);
    currentChars += candidateChars;
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
    section.description ?? '',
    section.tags ?? '',
  ].join('\n'));
}

function buildBlockSummary(block: VisualBlock, baseComponent: string): string {
  const childSummary = shouldSummarizeChildContent(baseComponent, block)
    ? getNestedBlockSummaryText(block)
    : '';
  return cleanText([
    block.schema.component,
    block.schema.description ?? '',
    block.schema.tags ?? '',
    block.schema.xrefTitle ?? '',
    block.schema.xrefDetail ?? '',
    block.schema.containerTitle ?? '',
    block.schema.imageAlt ?? '',
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
    || cleanText(block.schema.imageAlt ?? '')
    || cleanText(block.schema.id ?? '');
}

function getBlockContextLabel(block: VisualBlock): string {
  return cleanText(block.schema.xrefTitle ?? '')
    || cleanText(block.schema.containerTitle ?? '')
    || firstLine(block.text)
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
