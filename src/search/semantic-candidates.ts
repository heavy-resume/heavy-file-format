import type { VisualBlock, VisualSection } from '../editor/types';
import { findVirtualDirectoryForBlock } from '../cli-core/virtual-file-system';
import { getSectionId } from '../section-ops';
import type {
  HvySemanticFilterCandidate,
  HvySemanticFilterCandidateBudget,
  HvySemanticFilterRequest,
} from './types';
import type { VisualDocument } from '../types';

const DEFAULT_MAX_CANDIDATE_SUMMARY_CHARS = 800;
const DEFAULT_MAX_TOTAL_CANDIDATE_CHARS = 80_000;

interface BuildSemanticFilterRequestOptions {
  document: VisualDocument;
  prompt: string;
  signal?: AbortSignal;
  maxCandidateSummaryChars?: number;
  maxTotalCandidateChars?: number;
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

export function buildSemanticFilterCandidates(
  document: VisualDocument,
  options: { maxCandidateSummaryChars?: number } = {}
): HvySemanticFilterCandidate[] {
  const maxCandidateSummaryChars = options.maxCandidateSummaryChars ?? DEFAULT_MAX_CANDIDATE_SUMMARY_CHARS;
  const sectionCandidates: HvySemanticFilterCandidate[] = [];
  const blockCandidates: HvySemanticFilterCandidate[] = [];
  let documentOrder = 0;

  const visitSection = (section: VisualSection, ancestors: string[]): void => {
    if (section.isGhost) {
      return;
    }
    const sectionOrder = documentOrder;
    documentOrder += 1;
    const sectionLabel = section.title.trim() || getSectionId(section) || 'Untitled section';
    const sectionSummary = truncateSummary(buildSectionSummary(section), maxCandidateSummaryChars);
    sectionCandidates.push({
      candidateId: `section:${section.key}`,
      targetKind: 'section',
      sectionKey: section.key,
      targetId: getSectionId(section) || section.key,
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
    const label = getBlockLabel(block) || nearestLocationLabel;
    const locationLabel = (block.schema.description ?? '').trim() || nearestLocationLabel;
    const summaryResult = truncateSummary(buildBlockSummary(block), maxCandidateSummaryChars);
    const targetPath = findVirtualDirectoryForBlock(document, block);
    const contextLabel = contextTrail.filter((part) => part && part !== label).slice(-3).join(' / ');
    blockCandidates.push({
      candidateId: `block:${section.key}:${block.id}`,
      targetKind: 'block',
      sectionKey: section.key,
      blockId: block.id,
      targetId: (block.schema.id ?? '').trim() || block.id,
      ...(targetPath ? { targetPath } : {}),
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

export function buildSemanticFilterInstructionPrompt(prompt: string, candidates: HvySemanticFilterCandidate[]): string {
  const candidateLines = candidates.map((candidate) => JSON.stringify({
    candidateId: candidate.candidateId,
    ...(candidate.documentId ? { documentId: candidate.documentId } : {}),
    ...(candidate.documentTitle ? { documentTitle: candidate.documentTitle } : {}),
    targetKind: candidate.targetKind,
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
    '  "matches": [',
    '    { "candidateId": "id from the list", "reason": "short reason", "score": 0.0 }',
    '  ]',
    '}',
    '',
    'Rules:',
    '- Only use candidateId values from the candidate list.',
    '- Prefer precise component matches when a component alone satisfies the prompt.',
    '- Select a section when the whole section is relevant or when many child components are relevant.',
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

function buildSectionSummary(section: VisualSection): string {
  return cleanText([
    section.title,
    section.description ?? '',
    section.tags ?? '',
    ...section.blocks.map((block) => getBlockSummaryText(block)).filter(Boolean).slice(0, 8),
  ].join('\n'));
}

function buildBlockSummary(block: VisualBlock): string {
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
