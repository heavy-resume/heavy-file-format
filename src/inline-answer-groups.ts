import type { VisualBlock, VisualSection } from './editor/types';

/**
 * Radio grouping for persistent inline answers (HVY-SPEC.md §5.7 "Radio groups").
 *
 * A `<!--hvy:radio-group NAME-->` directive names the group every following radio
 * option joins. It carries forward in document order past the end of its own text
 * component until another directive changes it; the bare `<!--hvy:radio-group-->`
 * ends the active named group. Radio options with no active named group fall back
 * to implicit grouping: consecutive radio-option lines inside one component.
 *
 * `scanInlineAnswers` is the single source of truth for which markers exist in a
 * text block and what `answerIndex` each one carries. Rendering, group resolution,
 * and source rewriting all read it, so they cannot drift apart.
 */

const RADIO_GROUP_DIRECTIVE = /<!--hvy:radio-group(?:[ \t]+([^>]*?))?[ \t]*-->/g;
const ANSWER_MARKER = /^(?:\[( |x|X)\]|\(( |x|X)\))/;
const RADIO_MARKER_IN_LINE = /(^|\s)\((?: |x|X)\)(?=\s|$)/;
const CODE_FENCE = /^( {0,3})(`{3,}|~{3,})/;

export interface ScannedAnswerMarker {
  answerIndex: number;
  lineIndex: number;
  /** Offset of the marker within its line. */
  start: number;
  length: number;
  radio: boolean;
  checked: boolean;
}

export interface ScannedRadioGroupDirective {
  lineIndex: number;
  start: number;
  length: number;
  /** null for the bare directive that ends the active group. */
  name: string | null;
}

export interface ScannedInlineAnswers {
  /** Lines without their separators, indexed by `lineIndex`. */
  lines: string[];
  markers: ScannedAnswerMarker[];
  directives: ScannedRadioGroupDirective[];
}

/** One radio option's place in the document, addressed the way block edits are. */
export interface InlineAnswerGroupMember {
  sectionKey: string;
  blockId: string;
  answerIndex: number;
  checked: boolean;
}

export interface InlineAnswerGroup {
  /** Stable DOM-safe identity, unique across the document. */
  key: string;
  /** Author-facing name, or null for an implicit group. */
  name: string | null;
  members: InlineAnswerGroupMember[];
}

export interface InlineAnswerGroupIndex {
  /** Group key per radio `answerIndex`, keyed by `makeAnswerBlockKey`. */
  byBlock: Map<string, Map<number, string>>;
  byKey: Map<string, InlineAnswerGroup>;
  /** Named groups in the document order of their first member. */
  orderedNames: string[];
  /** Every text block in document order, for proximity lookups. */
  order: { sectionKey: string; blockId: string }[];
  /** Named groups each text block participates in, keyed by `makeAnswerBlockKey`. */
  blockGroupNames: Map<string, string[]>;
}

export function normalizeRadioGroupName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export function radioGroupDirective(name: string): string {
  const normalized = normalizeRadioGroupName(name);
  return normalized ? `<!--hvy:radio-group ${normalized}-->` : '<!--hvy:radio-group-->';
}

export function stripRadioGroupDirectives(text: string): string {
  return text.replace(RADIO_GROUP_DIRECTIVE, '');
}

export function makeAnswerBlockKey(sectionKey: string, blockId: string): string {
  return `${sectionKey}::${blockId}`;
}

/**
 * Walks a text block once, collecting answer markers and radio-group directives in
 * source order. Markers inside fenced code blocks or inline code spans are ignored,
 * matching what the renderer turns into controls.
 */
export function scanInlineAnswers(text: string): ScannedInlineAnswers {
  const lines = text.split(/\r?\n/);
  const markers: ScannedAnswerMarker[] = [];
  const directives: ScannedRadioGroupDirective[] = [];
  let fence: { marker: string; length: number } | null = null;
  let answerIndex = 0;

  lines.forEach((line, lineIndex) => {
    const fenceMatch = line.match(CODE_FENCE);
    if (fence) {
      if (fenceMatch && fenceMatch[2]![0] === fence.marker && fenceMatch[2]!.length >= fence.length) {
        fence = null;
      }
      return;
    }
    if (fenceMatch) {
      fence = { marker: fenceMatch[2]![0]!, length: fenceMatch[2]!.length };
      return;
    }

    RADIO_GROUP_DIRECTIVE.lastIndex = 0;
    let directive: RegExpExecArray | null = RADIO_GROUP_DIRECTIVE.exec(line);
    while (directive) {
      const name = normalizeRadioGroupName(directive[1] ?? '');
      directives.push({
        lineIndex,
        start: directive.index,
        length: directive[0].length,
        name: name.length > 0 ? name : null,
      });
      directive = RADIO_GROUP_DIRECTIVE.exec(line);
    }

    let cursor = 0;
    let inlineCodeMarker: string | null = null;
    while (cursor < line.length) {
      const codeMatch = line.slice(cursor).match(/^`+/);
      if (codeMatch?.[0]) {
        inlineCodeMarker = inlineCodeMarker === codeMatch[0] ? null : inlineCodeMarker ?? codeMatch[0];
        cursor += codeMatch[0].length;
        continue;
      }
      const markerMatch = line.slice(cursor).match(ANSWER_MARKER);
      if (markerMatch?.[0] && !inlineCodeMarker) {
        const radio = markerMatch[0].startsWith('(');
        const state = radio ? markerMatch[2] : markerMatch[1];
        markers.push({
          answerIndex,
          lineIndex,
          start: cursor,
          length: markerMatch[0].length,
          radio,
          checked: (state ?? ' ').toLowerCase() === 'x',
        });
        answerIndex += 1;
        cursor += markerMatch[0].length;
        continue;
      }
      cursor += 1;
    }
  });

  return { lines, markers, directives };
}

/**
 * Resolves a group key for every radio marker in one block, continuing from
 * `activeName` and reporting the active name left over for the next block.
 */
export function resolveBlockAnswerGroups(
  text: string,
  blockKey: string,
  activeName: string | null
): { groups: Map<number, string>; activeName: string | null; scanned: ScannedInlineAnswers } {
  const scanned = scanInlineAnswers(text);
  const groups = new Map<number, string>();
  let currentName = activeName;
  let implicitRun = 0;
  let previousLineWasRadio = false;
  let lastLineIndex = -1;

  const events = [
    ...scanned.directives.map((directive) => ({ ...directive, kind: 'directive' as const })),
    ...scanned.markers.map((marker) => ({ ...marker, kind: 'marker' as const })),
  ].sort((left, right) => left.lineIndex - right.lineIndex || left.start - right.start);

  const advanceLinesTo = (lineIndex: number): void => {
    for (let index = lastLineIndex + 1; index <= lineIndex; index += 1) {
      const lineHasRadio = RADIO_MARKER_IN_LINE.test(stripRadioGroupDirectives(scanned.lines[index] ?? ''));
      if (lineHasRadio && !previousLineWasRadio) implicitRun += 1;
      previousLineWasRadio = lineHasRadio;
    }
    lastLineIndex = Math.max(lastLineIndex, lineIndex);
  };

  events.forEach((event) => {
    advanceLinesTo(event.lineIndex);
    if (event.kind === 'directive') {
      currentName = event.name;
      return;
    }
    if (!event.radio) return;
    groups.set(event.answerIndex, currentName ? `name:${currentName}` : `run:${blockKey}:${implicitRun}`);
  });

  return { groups, activeName: currentName, scanned };
}

/**
 * Rewrites a block so the markers in `[startAnswerIndex, endAnswerIndex]` belong to
 * `groupName` (or to no named group when null). Content after the range keeps whatever
 * group it already had, so retargeting one run never silently regroups the rest of the
 * document.
 */
export function setAnswerRangeRadioGroup(
  text: string,
  startAnswerIndex: number,
  endAnswerIndex: number,
  groupName: string | null,
  incomingName: string | null = null
): string {
  const scanned = scanInlineAnswers(text);
  const first = scanned.markers.find((marker) => marker.answerIndex === startAnswerIndex);
  const last = [...scanned.markers].reverse().find((marker) => marker.answerIndex === endAnswerIndex);
  if (!first || !last) {
    return text;
  }
  const target = groupName ? normalizeRadioGroupName(groupName) : null;
  const isBefore = (
    left: { lineIndex: number; start: number },
    right: { lineIndex: number; start: number }
  ): boolean => left.lineIndex < right.lineIndex || (left.lineIndex === right.lineIndex && left.start < right.start);
  const activeNameAt = (position: { lineIndex: number; start: number }): string | null =>
    scanned.directives.reduce<string | null>(
      (name, directive) => (isBefore(directive, position) ? directive.name : name),
      incomingName
    );

  const lines = [...scanned.lines];
  const removals = scanned.directives.filter(
    (directive) => !isBefore(directive, first) && !isBefore(last, directive)
  );
  const insertions: { at: number; line: string }[] = [];

  // Later markers must keep the group they resolve to today. A directive already
  // sitting between the range and the next marker does that on its own.
  const nextMarker = scanned.markers.find((marker) => marker.answerIndex > endAnswerIndex);
  if (nextMarker) {
    const separated = scanned.directives.some(
      (directive) => isBefore(last, directive) && isBefore(directive, nextMarker) && !removals.includes(directive)
    );
    const nameAfter = activeNameAt(nextMarker);
    if (!separated && nameAfter !== target) {
      insertions.push({ at: last.lineIndex + 1, line: radioGroupDirective(nameAfter ?? '') });
    }
  }
  if (activeNameAt(first) !== target) {
    insertions.push({ at: first.lineIndex, line: radioGroupDirective(target ?? '') });
  }

  removals
    .sort((left, right) => right.lineIndex - left.lineIndex || right.start - left.start)
    .forEach((directive) => {
      const line = lines[directive.lineIndex] ?? '';
      lines[directive.lineIndex] = `${line.slice(0, directive.start)}${line.slice(directive.start + directive.length)}`;
    });
  removals
    .map((directive) => directive.lineIndex)
    .filter((lineIndex, index, all) => all.indexOf(lineIndex) === index && (lines[lineIndex] ?? '').trim().length === 0)
    .sort((left, right) => right - left)
    .forEach((lineIndex) => {
      lines.splice(lineIndex, 1);
      insertions.forEach((insertion) => {
        if (insertion.at > lineIndex) insertion.at -= 1;
      });
    });

  insertions
    .sort((left, right) => right.at - left.at)
    .forEach((insertion) => lines.splice(insertion.at, 0, insertion.line));

  return dropRedundantRadioGroupDirectives(lines.join('\n'), incomingName);
}

/**
 * Removes directives that change nothing: ones restating the active group, and ones
 * superseded by a later directive before any marker uses them. Repeated regrouping
 * would otherwise pile up dead directives in the source.
 */
function dropRedundantRadioGroupDirectives(text: string, incomingName: string | null): string {
  const scanned = scanInlineAnswers(text);
  const dead = new Set<ScannedRadioGroupDirective>();
  let activeName = incomingName;
  scanned.directives.forEach((directive, position) => {
    const next = scanned.directives[position + 1];
    const usedBeforeNext = scanned.markers.some(
      (marker) =>
        (marker.lineIndex > directive.lineIndex ||
          (marker.lineIndex === directive.lineIndex && marker.start > directive.start)) &&
        (!next ||
          marker.lineIndex < next.lineIndex ||
          (marker.lineIndex === next.lineIndex && marker.start < next.start))
    );
    if (directive.name === activeName || !usedBeforeNext) {
      dead.add(directive);
      return;
    }
    activeName = directive.name;
  });
  if (dead.size === 0) {
    return text;
  }
  const lines = [...scanned.lines];
  const editedLineIndexes = new Set<number>();
  [...dead]
    .sort((left, right) => right.lineIndex - left.lineIndex || right.start - left.start)
    .forEach((directive) => {
      const line = lines[directive.lineIndex] ?? '';
      lines[directive.lineIndex] = `${line.slice(0, directive.start)}${line.slice(directive.start + directive.length)}`;
      editedLineIndexes.add(directive.lineIndex);
    });
  // A line that held nothing but a dead directive should go away, not leave a blank.
  return lines
    .filter((line, lineIndex) => !editedLineIndexes.has(lineIndex) || line.trim().length > 0)
    .join('\n');
}

/**
 * Clears every selected radio option in the document, returning the blocks it changed.
 *
 * A radio has no native way to deselect, so once a reader picks one the choice is stuck
 * in the source. Authoring starts from a clean slate instead of inheriting whatever was
 * clicked while reading. Checkboxes are left alone: those can already be unticked.
 */
export function clearSelectedRadioAnswers(
  sections: VisualSection[],
  getBlockText: (sectionKey: string, blockId: string) => string | null,
  setBlockText: (sectionKey: string, blockId: string, text: string) => void
): { sectionKey: string; blockId: string }[] {
  const index = getInlineAnswerGroupIndex(sections);
  const clearedByBlock = new Map<string, { sectionKey: string; blockId: string; indexes: number[] }>();
  index.byKey.forEach((group) => {
    group.members.forEach((member) => {
      if (!member.checked) return;
      const key = makeAnswerBlockKey(member.sectionKey, member.blockId);
      const entry = clearedByBlock.get(key)
        ?? { sectionKey: member.sectionKey, blockId: member.blockId, indexes: [] };
      entry.indexes.push(member.answerIndex);
      clearedByBlock.set(key, entry);
    });
  });

  const changed: { sectionKey: string; blockId: string }[] = [];
  clearedByBlock.forEach((entry) => {
    const text = getBlockText(entry.sectionKey, entry.blockId);
    if (text === null) return;
    const scanned = scanInlineAnswers(text);
    const lines = [...scanned.lines];
    scanned.markers
      .filter((marker) => marker.radio && entry.indexes.includes(marker.answerIndex))
      .sort((left, right) => right.lineIndex - left.lineIndex || right.start - left.start)
      .forEach((marker) => {
        const line = lines[marker.lineIndex] ?? '';
        lines[marker.lineIndex] = `${line.slice(0, marker.start)}( )${line.slice(marker.start + marker.length)}`;
      });
    const next = lines.join('\n');
    if (next === text) return;
    setBlockText(entry.sectionKey, entry.blockId, next);
    changed.push({ sectionKey: entry.sectionKey, blockId: entry.blockId });
  });
  if (changed.length > 0) {
    invalidateInlineAnswerGroupIndex();
  }
  return changed;
}

/** Named groups used by components near `blockId` in document order, nearest first. */
export function getNearbyRadioGroupNames(
  sections: VisualSection[],
  sectionKey: string,
  blockId: string,
  radius = 2
): string[] {
  const index = getInlineAnswerGroupIndex(sections);
  const position = index.order.findIndex(
    (entry) => entry.sectionKey === sectionKey && entry.blockId === blockId
  );
  if (position === -1) {
    return [...new Set(index.orderedNames)];
  }
  const names: string[] = [];
  for (let distance = 0; distance <= radius; distance += 1) {
    [position - distance, position + distance].forEach((neighbour) => {
      const entry = index.order[neighbour];
      if (!entry) return;
      (index.blockGroupNames.get(makeAnswerBlockKey(entry.sectionKey, entry.blockId)) ?? []).forEach((name) => {
        if (!names.includes(name)) names.push(name);
      });
    });
  }
  return names;
}

let cachedIndex: { sections: VisualSection[]; index: InlineAnswerGroupIndex } | null = null;

/**
 * Group membership depends on the whole document, so it is resolved once per render
 * pass and shared by every block rendered in that pass. Callers that regenerate HTML
 * invalidate first; between renders the DOM is untouched, so a cached index cannot
 * go stale in a way that is observable.
 */
export function getInlineAnswerGroupIndex(sections: VisualSection[]): InlineAnswerGroupIndex {
  if (cachedIndex && cachedIndex.sections === sections) {
    return cachedIndex.index;
  }
  const index = buildInlineAnswerGroupIndex(sections);
  cachedIndex = { sections, index };
  return index;
}

export function invalidateInlineAnswerGroupIndex(): void {
  cachedIndex = null;
}

/** Walks every text block in document order, carrying the active group name across blocks. */
export function buildInlineAnswerGroupIndex(sections: VisualSection[]): InlineAnswerGroupIndex {
  const index: InlineAnswerGroupIndex = {
    byBlock: new Map(),
    byKey: new Map(),
    orderedNames: [],
    order: [],
    blockGroupNames: new Map(),
  };
  let activeName: string | null = null;
  const seen = new Set<VisualBlock>();

  const visitBlock = (block: VisualBlock, sectionKey: string): void => {
    if (seen.has(block)) return;
    seen.add(block);
    if (block.schema.kind === 'text') {
      const blockKey = makeAnswerBlockKey(sectionKey, block.id);
      index.order.push({ sectionKey, blockId: block.id });
      const resolved = resolveBlockAnswerGroups(block.text, blockKey, activeName);
      activeName = resolved.activeName;
      if (resolved.groups.size > 0) {
        index.byBlock.set(blockKey, resolved.groups);
        resolved.scanned.markers.forEach((marker) => {
          const key = resolved.groups.get(marker.answerIndex);
          if (!key) return;
          let group = index.byKey.get(key);
          if (!group) {
            group = { key, name: key.startsWith('name:') ? key.slice('name:'.length) : null, members: [] };
            index.byKey.set(key, group);
            if (group.name) index.orderedNames.push(group.name);
          }
          group.members.push({ sectionKey, blockId: block.id, answerIndex: marker.answerIndex, checked: marker.checked });
          if (group.name) {
            const names = index.blockGroupNames.get(blockKey) ?? [];
            if (!names.includes(group.name)) names.push(group.name);
            index.blockGroupNames.set(blockKey, names);
          }
        });
      }
    }
    getNestedBlocks(block).forEach((nested) => visitBlock(nested, sectionKey));
  };

  const visitSections = (sections: VisualSection[]): void => {
    sections.forEach((section) => {
      section.blocks.forEach((block) => visitBlock(block, section.key));
      visitSections(section.children);
    });
  };
  visitSections(sections);
  return index;
}

export function getBlockAnswerGroups(
  index: InlineAnswerGroupIndex,
  sectionKey: string,
  blockId: string
): Map<number, string> {
  return index.byBlock.get(makeAnswerBlockKey(sectionKey, blockId)) ?? new Map();
}

/** DOM `name` for a resolved group key, unique across the whole rendered document. */
export function answerGroupInputName(groupKey: string): string {
  return `hvy-inline-radio-${groupKey.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

function getNestedBlocks(block: VisualBlock): VisualBlock[] {
  return [
    ...(block.schema.containerBlocks ?? []),
    ...(block.schema.componentListBlocks ?? []),
    ...(block.schema.gridItems ?? []).map((item) => item.block),
    ...(block.schema.expandableStubBlocks?.children ?? []),
    ...(block.schema.expandableContentBlocks?.children ?? []),
    ...(block.schema.encryptedBlock ? [block.schema.encryptedBlock] : []),
  ];
}
