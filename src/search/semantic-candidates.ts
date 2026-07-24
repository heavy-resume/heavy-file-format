import type { VisualBlock, VisualSection } from '../editor/types';
import { getTextCaptionMarkdown } from '../caption';
import {
  buildHvyVirtualFileSystem,
  buildVirtualDirectoryBlockLookup,
  buildVirtualDirectorySectionLookup,
} from '../cli-core/virtual-file-system';
import { collectHvyComponentStructureReferences } from '../cli-core/request-structure';
import { resolveBaseComponentFromMeta } from '../component-defs';
import { getSectionId } from '../section-ops';
import type {
  HvyRetrievalChunk,
  HvySemanticFilterCandidate,
  HvySemanticFilterCandidateBudget,
  HvySemanticFilterRequest,
} from './types';
import type { VisualDocument } from '../types';

const DEFAULT_MAX_CANDIDATE_SUMMARY_CHARS = 800;
const DEFAULT_MAX_TOTAL_CANDIDATE_CHARS = 80_000;
const DEFAULT_MAX_WINDOW_CANDIDATE_CHARS = 10_000;
const UNLIMITED_CANDIDATE_SUMMARY_CHARS = Number.MAX_SAFE_INTEGER;
const SEMANTIC_FILTER_CHUNK_OVERLAP_CHARS = 400;
const RETRIEVAL_CHUNK_OVERLAP_CHARS = 200;

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

export function buildSemanticRetrievalChunks(
  document: VisualDocument,
  options: { targetChunkChars?: number; overlapChars?: number; preserveLeafTargets?: boolean } = {}
): HvyRetrievalChunk[] {
  const targetChunkChars = Math.max(1, Math.floor(options.targetChunkChars ?? DEFAULT_MAX_WINDOW_CANDIDATE_CHARS));
  const overlapChars = normalizeOverlapChars(options.overlapChars, RETRIEVAL_CHUNK_OVERLAP_CHARS);
  const candidates = buildSemanticFilterCandidates(document, { maxCandidateSummaryChars: UNLIMITED_CANDIDATE_SUMMARY_CHARS })
    .sort((left, right) => left.documentOrder - right.documentOrder);
  const candidateIdsWithDescendants = getCandidateIdsWithDescendants(candidates);
  const leavesBySectionKey = new Map<string, HvySemanticFilterCandidate[]>();
  const sectionsByKey = new Map(candidates
    .filter((candidate) => candidate.targetKind === 'section')
    .map((candidate) => [candidate.sectionKey, candidate]));
  for (const candidate of candidates) {
    if (candidateIdsWithDescendants.has(candidate.candidateId)) {
      continue;
    }
    const leaves = leavesBySectionKey.get(candidate.sectionKey) ?? [];
    leaves.push(candidate);
    leavesBySectionKey.set(candidate.sectionKey, leaves);
  }
  if (options.preserveLeafTargets) {
    return [...leavesBySectionKey.values()].flatMap((leaves) =>
      leaves.flatMap((leaf) => buildLeafRetrievalChunks(leaf, targetChunkChars, overlapChars))
    );
  }
  return [...leavesBySectionKey.entries()].flatMap(([sectionKey, leaves]) =>
    buildSectionRetrievalChunks(sectionsByKey.get(sectionKey), leaves, targetChunkChars, overlapChars)
  );
}

function buildLeafRetrievalChunks(
  leaf: HvySemanticFilterCandidate,
  targetChunkChars: number,
  overlapChars: number
): HvyRetrievalChunk[] {
  const pieces = buildWindowCandidateChunks(leaf, targetChunkChars, overlapChars)
    .flatMap((chunk) => splitRetrievalPieceText(chunk, formatRetrievalLeafText(chunk), targetChunkChars));
  return pieces.map((piece, index): HvyRetrievalChunk => ({
    ...piece.candidate,
    chunkId: pieces.length === 1 ? piece.candidate.candidateId : `${piece.candidate.candidateId}#chunk:${index + 1}`,
    sourceCandidateIds: [piece.candidate.candidateId],
    summary: piece.text,
    truncated: pieces.length > 1 || piece.candidate.truncated,
    ...(pieces.length > 1
      ? { windowChunk: { index, count: pieces.length, start: 0, end: piece.text.length } }
      : { windowChunk: undefined }),
  }));
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
  const sectionPaths = reverseVirtualDirectoryLookup(buildVirtualDirectorySectionLookup(document));
  const blockPaths = reverseVirtualDirectoryLookup(buildVirtualDirectoryBlockLookup(document));
  let documentOrder = 0;

  const visitSection = (section: VisualSection, ancestors: string[]): void => {
    if (section.isGhost) {
      return;
    }
    const sectionOrder = documentOrder;
    documentOrder += 1;
    const sectionLabel = section.title.trim() || getSectionId(section) || 'Untitled section';
    const targetPath = sectionPaths.get(section);
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
      visitBlock(document, section, block, nextAncestors, sectionLabel, `section:${targetRef}`);
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
    nearestLocationLabel: string,
    parentCandidateId: string
  ): void => {
    const blockOrder = documentOrder;
    documentOrder += 1;
    const baseComponent = resolveBaseComponentFromMeta(block.schema.component, document.meta);
    const label = getBlockLabel(block) || nearestLocationLabel;
    const locationLabel = (block.schema.description ?? '').trim() || nearestLocationLabel;
    const targetPath = blockPaths.get(block);
    const targetRef = (targetPath ? targetRefs.componentRefsByPath.get(targetPath) : undefined) ?? (block.schema.id.trim() || block.id);
    const summaryResult = truncateSummary(
      buildBlockSummary(block, baseComponent),
      maxCandidateSummaryChars,
      baseComponent === 'plugin'
    );
    const contextLabel = contextTrail.filter((part) => part && part !== label).slice(-3).join(' / ');
    blockCandidates.push({
      candidateId: `component:${targetRef}`,
      targetKind: 'block',
      parentCandidateId,
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
      componentType: baseComponent,
      summary: summaryResult.summary,
      documentOrder: blockOrder,
      truncated: summaryResult.truncated,
    });
    const childTrail = appendContext(contextTrail, getBlockContextLabel(block));
    const childLocation = locationLabel || nearestLocationLabel;
    const childParentCandidateId = `component:${targetRef}`;
    for (const child of block.schema.containerBlocks ?? []) visitBlock(document, section, child, childTrail, childLocation, childParentCandidateId);
    for (const child of block.schema.componentListBlocks ?? []) visitBlock(document, section, child, childTrail, childLocation, childParentCandidateId);
    for (const child of block.schema.expandableStubBlocks?.children ?? []) {
      visitBlock(document, section, child, childTrail, (block.schema.expandableStubDescription ?? '').trim() || childLocation, childParentCandidateId);
    }
    for (const child of block.schema.expandableContentBlocks?.children ?? []) {
      visitBlock(document, section, child, childTrail, (block.schema.expandableContentDescription ?? '').trim() || childLocation, childParentCandidateId);
    }
    for (const item of block.schema.gridItems ?? []) visitBlock(document, section, item.block, childTrail, childLocation, childParentCandidateId);
  };

  for (const section of document.sections) {
    visitSection(section, []);
  }
  return [...sectionCandidates, ...blockCandidates];
}

function reverseVirtualDirectoryLookup<T extends object>(lookup: Map<string, T>): Map<T, string> {
  return new Map([...lookup].map(([path, value]) => [value, path]));
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
    '--- begin filter prompt ---',
    prompt,
    '--- end filter prompt ---',
    '',
    'Candidate list as XML-like structured text:',
    ...candidateBlocks,
    '',
    'Selection contract:',
    '1. First pass: list candidate IDs that appear to satisfy the filter prompt, with one short sentence explaining why each may be relevant.',
    '2. Review the first pass against the relevance rules and remove any weak, speculative, or over-broad matches to the filter prompt.',
    '3. If no candidates survive review, write that no candidates are relevant.',
    '4. Final answer: write one JSON array containing exactly the candidate IDs that survived review.',
    '5. If no candidates survived review, the final JSON array must be [].',
    '',
    'Relevance rules:',
    '- Relevant means the candidate has direct evidence from its text, tags, label, description, or surrounding context.',
    '- Exclude loosely associated, incidental, speculative, or merely adjacent candidates.',
    '- If explaining relevance takes more than one sentence, exclude the candidate.',
    '- Do not output all candidate IDs unless every candidate survived review.',
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
  const candidateIds = new Set(candidates.map((candidate) => candidate.candidateId));
  const parentsByCandidateId = new Map(candidates.map((candidate) => [candidate.candidateId, candidate.parentCandidateId]));
  for (const candidate of candidates) {
    let parentCandidateId = candidate.parentCandidateId;
    while (parentCandidateId && candidateIds.has(parentCandidateId)) {
      candidatesWithDescendants.add(parentCandidateId);
      parentCandidateId = parentsByCandidateId.get(parentCandidateId);
    }
  }
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
  maxWindowCandidateChars: number,
  overlapChars = SEMANTIC_FILTER_CHUNK_OVERLAP_CHARS
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

  const normalizedOverlapChars = Math.min(overlapChars, Math.max(0, maxSummaryChars - 1));
  const stepChars = Math.max(1, maxSummaryChars - normalizedOverlapChars);
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

function buildSectionRetrievalChunks(
  section: HvySemanticFilterCandidate | undefined,
  leaves: HvySemanticFilterCandidate[],
  targetChunkChars: number,
  overlapChars: number
): HvyRetrievalChunk[] {
  if (leaves.length === 0) {
    return [];
  }
  const sectionCandidate = section ?? leaves[0]!;
  const pieces = leaves.flatMap((leaf) =>
    buildWindowCandidateChunks(leaf, targetChunkChars, overlapChars).flatMap((chunk) =>
      splitRetrievalPieceText(chunk, formatRetrievalLeafText(chunk), targetChunkChars)
    )
  );
  const groups: Array<{ pieces: typeof pieces; chars: number }> = [];
  let current: typeof pieces = [];
  let currentChars = 0;
  const flush = (): void => {
    if (current.length === 0) {
      return;
    }
    groups.push({ pieces: current, chars: currentChars });
    current = [];
    currentChars = 0;
  };
  for (const piece of pieces) {
    const nextChars = current.length === 0 ? piece.text.length : currentChars + 2 + piece.text.length;
    if (current.length > 0 && nextChars > targetChunkChars) {
      flush();
    }
    current.push(piece);
    currentChars = current.length === 1 ? piece.text.length : currentChars + 2 + piece.text.length;
  }
  flush();
  return groups.map((group, index): HvyRetrievalChunk => {
    const sourceCandidateIds = [...new Set(group.pieces.map((piece) => piece.candidate.candidateId))];
    const summary = group.pieces.map((piece) => piece.text).join('\n\n');
    return {
      ...sectionCandidate,
      chunkId: getSectionRetrievalChunkId(sectionCandidate, index, groups.length),
      sourceCandidateIds,
      targetKind: 'section',
      blockId: undefined,
      componentType: undefined,
      summary,
      tags: [...new Set([
        ...sectionCandidate.tags,
        ...group.pieces.flatMap((piece) => piece.candidate.tags),
      ])],
      description: sectionCandidate.description || group.pieces.map((piece) => piece.candidate.description).find(Boolean) || '',
      documentOrder: group.pieces[0]?.candidate.documentOrder ?? sectionCandidate.documentOrder,
      truncated: group.pieces.some((piece) => piece.candidate.truncated),
      ...(groups.length > 1
        ? { windowChunk: { index, count: groups.length, start: 0, end: summary.length } }
        : { windowChunk: undefined }),
    };
  });
}

function getSectionRetrievalChunkId(section: HvySemanticFilterCandidate, index: number, count: number): string {
  const baseId = section.targetRef ? `section:${section.targetRef}` : section.candidateId;
  return count <= 1 ? baseId : `${baseId}#chunk:${index + 1}`;
}

function formatRetrievalLeafText(candidate: HvySemanticFilterCandidate): string {
  return [
    candidate.label ? `Label: ${candidate.label}` : '',
    candidate.contextLabel ? `Context: ${candidate.contextLabel}` : '',
    candidate.locationLabel ? `Location: ${candidate.locationLabel}` : '',
    candidate.tags.length ? `Tags: ${candidate.tags.join(', ')}` : '',
    candidate.description ? `Description: ${candidate.description}` : '',
    candidate.componentType ? `Component: ${candidate.componentType}` : '',
    candidate.summary ? `Text: ${candidate.summary}` : '',
  ].filter(Boolean).join('\n');
}

function splitRetrievalPieceText(
  candidate: HvySemanticFilterCandidate,
  text: string,
  targetChunkChars: number
): Array<{ candidate: HvySemanticFilterCandidate; text: string }> {
  if (text.length <= targetChunkChars) {
    return [{ candidate, text }];
  }
  const chunks: Array<{ candidate: HvySemanticFilterCandidate; text: string }> = [];
  const bodyChars = Math.max(1, targetChunkChars - 6);
  for (let start = 0; start < text.length; start += bodyChars) {
    const end = Math.min(text.length, start + bodyChars);
    const prefix = start > 0 ? '...' : '';
    const suffix = end < text.length ? '...' : '';
    chunks.push({
      candidate,
      text: `${prefix}${text.slice(start, end)}${suffix}`,
    });
  }
  return chunks;
}

function normalizeOverlapChars(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
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
  if (baseComponent === 'plugin') {
    return [
      block.schema.plugin ? `Plugin: ${block.schema.plugin}` : '',
      Object.keys(block.schema.pluginConfig).length > 0
        ? `Plugin parameters: ${JSON.stringify(block.schema.pluginConfig)}`
        : '',
      Object.keys(block.schema.pluginSortValues).length > 0
        ? `Plugin sort values: ${JSON.stringify(block.schema.pluginSortValues)}`
        : '',
      childSummary,
      ...(block.text.trim().length > 0
        ? [
            '--- begin plugin text ---',
            block.text.trim(),
            '--- end plugin text ---',
          ]
        : []),
    ].filter(Boolean).join('\n');
  }
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

function truncateSummary(value: string, maxChars: number, preserveLines = false): { summary: string; truncated: boolean } {
  const clean = preserveLines
    ? value.replace(/\r\n?/g, '\n').trim()
    : cleanText(value);
  if (clean.length <= maxChars) {
    return { summary: clean, truncated: false };
  }
  return { summary: `${clean.slice(0, Math.max(0, maxChars - 3)).trim()}...`, truncated: true };
}
