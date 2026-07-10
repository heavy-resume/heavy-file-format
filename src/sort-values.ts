import type { SortKeyValue, VisualBlock } from './editor/types';
import type { JsonObject } from './hvy/types';
import type { ComponentDefinition, SortValueDefinition, SortValueEnumOption, VisualDocument } from './types';

export interface SortValueAnnotation {
  key: string;
  text: string;
  rawPayload: JsonObject;
}

export const SORT_VALUE_ANNOTATION_PATTERN = /<!--hvy:sort-value\s+(\{.*?\})-->([\s\S]*?)<!--\/hvy:sort-value-->/g;

export function formatSortValueAnnotation(payload: JsonObject, text: string): string {
  return `<!--hvy:sort-value ${JSON.stringify(payload)}-->${text}<!--/hvy:sort-value-->`;
}

export function replaceSortValueAnnotations(
  markdown: string,
  replacement: (annotation: SortValueAnnotation) => string
): string {
  return (markdown || '').replace(SORT_VALUE_ANNOTATION_PATTERN, (_match, rawJson, text) => {
    const payload = parseSortValuePayload(rawJson);
    const key = typeof payload?.key === 'string' ? payload.key.trim() : '';
    if (!payload || !key) {
      return text;
    }
    return replacement({ key, text, rawPayload: payload });
  });
}

export function findSortValueAnnotations(markdown: string): SortValueAnnotation[] {
  const annotations: SortValueAnnotation[] = [];
  replaceSortValueAnnotations(markdown, (annotation) => {
    annotations.push(annotation);
    return annotation.text;
  });
  return annotations;
}

export function getComponentSortValueDefs(
  meta: Record<string, unknown> | null | undefined,
  componentName: string
): Record<string, SortValueDefinition> {
  const definition = getComponentDefinition(meta, componentName);
  return definition ? normalizeSortValueDefs(definition.sortValueDefs) : {};
}

export function getSortValueDefsForBlock(document: VisualDocument, block: VisualBlock): Record<string, SortValueDefinition> {
  const direct = getComponentSortValueDefs(document.meta, block.schema.component);
  if (Object.keys(direct).length > 0) {
    return direct;
  }
  const owner = findSortValueOwnerBlock(document, block.id);
  return owner ? getComponentSortValueDefs(document.meta, owner.schema.component) : {};
}

export function findSortValueOwnerBlock(document: VisualDocument, blockId: string): VisualBlock | null {
  return findComponentListItemOwner(document, blockId);
}

export function syncSortValuesForDocument(document: VisualDocument): boolean {
  let changed = false;
  const visitBlock = (block: VisualBlock): void => {
    if (block.schema.kind === 'component-list') {
      block.schema.componentListBlocks.forEach((item) => {
        changed = syncSortValuesForListItem(document.meta, item) || changed;
      });
    }
    getNestedBlocks(block).forEach(visitBlock);
  };
  const visitSections = (sections: typeof document.sections): void => {
    sections.forEach((section) => {
      section.blocks.forEach(visitBlock);
      visitSections(section.children);
    });
  };
  visitSections(document.sections);
  return changed;
}

export function syncSortValuesForListItem(meta: Record<string, unknown> | null | undefined, item: VisualBlock): boolean {
  const defs = getComponentSortValueDefs(meta, item.schema.component);
  if (Object.keys(defs).length === 0) {
    return false;
  }
  let changed = false;
  const resolvedSources = collectSortValueSources(item, defs);
  const nextDerivedKeys = new Set<string>();
  resolvedSources.forEach((resolved, key) => {
    if (resolved === null) {
      return;
    }
    nextDerivedKeys.add(key);
    if (Object.is(item.schema.sortKeys[key], resolved)) {
      return;
    }
    item.schema.sortKeys[key] = resolved;
    changed = true;
  });
  item.schema.derivedSortKeyNames.forEach((key) => {
    if (nextDerivedKeys.has(key)) {
      return;
    }
    if (Object.prototype.hasOwnProperty.call(item.schema.sortKeys, key)) {
      delete item.schema.sortKeys[key];
      changed = true;
    }
  });
  const nextDerivedKeyNames = [...nextDerivedKeys].sort((left, right) => left.localeCompare(right));
  if (!arraysEqual(item.schema.derivedSortKeyNames, nextDerivedKeyNames)) {
    item.schema.derivedSortKeyNames = nextDerivedKeyNames;
    changed = true;
  }
  return changed;
}

export function coerceSortValue(text: string, definition: SortValueDefinition): SortKeyValue | null {
  const trimmed = text.trim();
  if (definition.type === 'text') {
    return trimmed;
  }
  if (definition.type === 'number') {
    const value = Number(trimmed);
    return Number.isFinite(value) ? value : null;
  }
  if (definition.type === 'datetime') {
    return coerceDatetimeSortValue(trimmed);
  }
  const option = (definition.options ?? []).find((candidate) => candidate.label.trim() === trimmed);
  if (!option) {
    return null;
  }
  return option.value;
}

function collectSortValueSources(
  item: VisualBlock,
  defs: Record<string, SortValueDefinition>
): Map<string, SortKeyValue | null> {
  const sources = new Map<string, SortKeyValue | null>();
  collectAnnotatedText(item).forEach((annotation) => {
    const definition = defs[annotation.key];
    if (!definition) {
      return;
    }
    sources.set(annotation.key, coerceSortValue(annotation.text, definition));
  });
  collectPluginSortValues(item).forEach(({ key, value }) => {
    const definition = defs[key];
    if (!definition) {
      return;
    }
    sources.set(key, coerceSourceSortValue(value, definition));
  });
  return sources;
}

function coerceSourceSortValue(value: SortKeyValue, definition: SortValueDefinition): SortKeyValue | null {
  if (definition.type === 'number' && typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (definition.type === 'text') {
    return String(value).trim();
  }
  if (definition.type === 'enum') {
    const matchingValue = (definition.options ?? []).find((candidate) => Object.is(candidate.value, value));
    if (matchingValue) {
      return matchingValue.value;
    }
  }
  return coerceSortValue(String(value), definition);
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function normalizeSortValueDefs(value: unknown): Record<string, SortValueDefinition> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, SortValueDefinition> = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, raw]) => {
    if (!key.trim() || !raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return;
    }
    const source = raw as Record<string, unknown>;
    const type = source.type === 'text' || source.type === 'number' || source.type === 'datetime' || source.type === 'enum' ? source.type : null;
    if (!type) {
      return;
    }
    const options = Array.isArray(source.options)
      ? source.options.map(normalizeEnumOption).filter((option): option is SortValueEnumOption => option !== null)
      : undefined;
    if (type === 'enum' && (!options || options.length === 0)) {
      return;
    }
    result[key] = { type, ...(options ? { options } : {}) };
  });
  return result;
}

function coerceDatetimeSortValue(text: string): string | null {
  const timestampMs = parseDatetimeSortTimestampMs(text);
  if (!Number.isFinite(timestampMs)) {
    return null;
  }
  return new Date(timestampMs).toISOString();
}

const TIMEZONE_ABBREVIATION_OFFSETS: Record<string, string> = {
  UTC: '+00:00',
  GMT: '+00:00',
  EST: '-05:00',
  EDT: '-04:00',
  CST: '-06:00',
  CDT: '-05:00',
  MST: '-07:00',
  MDT: '-06:00',
  PST: '-08:00',
  PDT: '-07:00',
  AKST: '-09:00',
  AKDT: '-08:00',
  HST: '-10:00',
  CET: '+01:00',
  CEST: '+02:00',
  EET: '+02:00',
  EEST: '+03:00',
  WET: '+00:00',
  WEST: '+01:00',
  JST: '+09:00',
  KST: '+09:00',
  HKT: '+08:00',
  SGT: '+08:00',
  PHT: '+08:00',
  ICT: '+07:00',
  WIB: '+07:00',
  WITA: '+08:00',
  WIT: '+09:00',
  PKT: '+05:00',
  NPT: '+05:45',
  AEST: '+10:00',
  AEDT: '+11:00',
  ACST: '+09:30',
  ACDT: '+10:30',
  AWST: '+08:00',
  NZST: '+12:00',
  NZDT: '+13:00',
  MSK: '+03:00',
};

function parseDatetimeSortTimestampMs(text: string): number {
  const zoned = parseIanaZonedDatetime(text);
  if (zoned !== null) {
    return zoned;
  }
  const normalized = normalizeDatetimeTimezone(text);
  return normalized ? Date.parse(normalized) : Number.NaN;
}

function normalizeDatetimeTimezone(text: string): string | null {
  const trimmed = normalizeHumanDatetimeSeparators(text.trim());
  if (/(?:[zZ]|[+-]\d{2}:?\d{2})\s*$/.test(trimmed)) {
    return trimmed;
  }
  const gmtMatch = trimmed.match(/\bGMT([+-])(\d{1,2})(?::?(\d{2}))?\s*$/i);
  if (gmtMatch) {
    const sign = gmtMatch[1] ?? '+';
    const hours = String(Number(gmtMatch[2] ?? '0')).padStart(2, '0');
    const minutes = gmtMatch[3] ?? '00';
    return trimmed.replace(/\bGMT[+-]\d{1,2}(?::?\d{2})?\s*$/i, `${sign}${hours}:${minutes}`);
  }
  const abbreviationMatch = trimmed.match(/\b([A-Z]{2,5})\s*$/);
  if (!abbreviationMatch) {
    return null;
  }
  const abbreviation = abbreviationMatch[1] ?? '';
  const source = trimmed.slice(0, abbreviationMatch.index).trim();
  const offset = TIMEZONE_ABBREVIATION_OFFSETS[abbreviation] ?? resolveShortTimezoneOffset(source, abbreviation);
  return offset ? trimmed.replace(/\b[A-Z]{2,5}\s*$/, offset) : null;
}

function normalizeHumanDatetimeSeparators(text: string): string {
  return text.replace(/\s+at\s+/i, ', ');
}

const shortTimezoneOffsetCache = new Map<string, string | null>();

function resolveShortTimezoneOffset(sourceText: string, abbreviation: string): string | null {
  const fields = parseDatetimeFields(sourceText);
  const zones = getSupportedIanaTimeZones();
  if (!fields || zones.length === 0) {
    return null;
  }
  const cacheKey = `${abbreviation}|${fields.year}-${fields.month}-${fields.day}T${fields.hour}:${fields.minute}:${fields.second}`;
  if (shortTimezoneOffsetCache.has(cacheKey)) {
    return shortTimezoneOffsetCache.get(cacheKey) ?? null;
  }
  const offsets = new Set<string>();
  for (const zone of zones) {
    const utcMs = zonedFieldsToUtcMs(fields, zone);
    const label = getShortTimezoneName(new Date(utcMs), zone);
    if (label === abbreviation) {
      offsets.add(formatOffsetMs(getTimeZoneOffsetMs(new Date(utcMs), zone)));
    }
  }
  const resolved = offsets.size === 1 ? [...offsets][0] ?? null : null;
  shortTimezoneOffsetCache.set(cacheKey, resolved);
  return resolved;
}

function getSupportedIanaTimeZones(): string[] {
  try {
    return typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  } catch {
    return [];
  }
}

function getShortTimezoneName(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'short',
  }).formatToParts(date).find((part) => part.type === 'timeZoneName')?.value ?? '';
}

function formatOffsetMs(offsetMs: number): string {
  const sign = offsetMs < 0 ? '-' : '+';
  const absMinutes = Math.abs(Math.trunc(offsetMs / 60_000));
  const hours = String(Math.trunc(absMinutes / 60)).padStart(2, '0');
  const minutes = String(absMinutes % 60).padStart(2, '0');
  return `${sign}${hours}:${minutes}`;
}

function parseIanaZonedDatetime(text: string): number | null {
  const trimmed = normalizeHumanDatetimeSeparators(text.trim());
  const bracketMatch = trimmed.match(/\s+\[([A-Za-z_]+\/[A-Za-z0-9_+\-.]+(?:\/[A-Za-z0-9_+\-.]+)*)\]\s*$/);
  const bareMatch = trimmed.match(/\s+([A-Za-z_]+\/[A-Za-z0-9_+\-.]+(?:\/[A-Za-z0-9_+\-.]+)*)\s*$/);
  const zone = bracketMatch?.[1] ?? bareMatch?.[1] ?? '';
  if (!zone || !isSupportedIanaTimeZone(zone)) {
    return null;
  }
  const source = bracketMatch
    ? trimmed.slice(0, bracketMatch.index).trim()
    : bareMatch
      ? trimmed.slice(0, bareMatch.index).trim()
      : '';
  const fields = parseDatetimeFields(source);
  return fields ? zonedFieldsToUtcMs(fields, zone) : null;
}

function isSupportedIanaTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

interface DatetimeFields {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

function parseDatetimeFields(text: string): DatetimeFields | null {
  const timestampMs = Date.parse(text);
  if (!Number.isFinite(timestampMs)) {
    return null;
  }
  const parsed = new Date(timestampMs);
  return {
    year: parsed.getFullYear(),
    month: parsed.getMonth() + 1,
    day: parsed.getDate(),
    hour: parsed.getHours(),
    minute: parsed.getMinutes(),
    second: parsed.getSeconds(),
    millisecond: parsed.getMilliseconds(),
  };
}

function zonedFieldsToUtcMs(fields: DatetimeFields, timeZone: string): number {
  const wallClockUtcMs = Date.UTC(
    fields.year,
    fields.month - 1,
    fields.day,
    fields.hour,
    fields.minute,
    fields.second,
    fields.millisecond
  );
  let utcMs = wallClockUtcMs;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offsetMs = getTimeZoneOffsetMs(new Date(utcMs), timeZone);
    const nextUtcMs = wallClockUtcMs - offsetMs;
    if (nextUtcMs === utcMs) {
      break;
    }
    utcMs = nextUtcMs;
  }
  return utcMs;
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const zonedAsUtcMs = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );
  return zonedAsUtcMs - date.getTime();
}

function normalizeEnumOption(value: unknown): SortValueEnumOption | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.label !== 'string' || !raw.label.trim()) {
    return null;
  }
  if (typeof raw.value === 'string') {
    return { label: raw.label.trim(), value: raw.value };
  }
  if (typeof raw.value === 'number' && Number.isFinite(raw.value)) {
    return { label: raw.label.trim(), value: raw.value };
  }
  return null;
}

function parseSortValuePayload(rawJson: string): JsonObject | null {
  try {
    const parsed = JSON.parse(rawJson) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as JsonObject : null;
  } catch {
    return null;
  }
}

function collectAnnotatedText(block: VisualBlock): SortValueAnnotation[] {
  const annotations: SortValueAnnotation[] = [];
  if (block.schema.kind === 'text') {
    annotations.push(...findSortValueAnnotations(block.text));
  }
  if (block.schema.kind === 'table') {
    block.schema.tableRows.forEach((row) => {
      row.cells.forEach((cell) => annotations.push(...findSortValueAnnotations(cell)));
    });
  }
  getNestedBlocks(block).forEach((child) => annotations.push(...collectAnnotatedText(child)));
  return annotations;
}

function collectPluginSortValues(block: VisualBlock): Array<{ key: string; value: SortKeyValue }> {
  const values: Array<{ key: string; value: SortKeyValue }> = [];
  if (block.schema.kind === 'plugin') {
    Object.entries(block.schema.pluginSortValues).forEach(([key, value]) => {
      if (key.trim().length > 0) {
        values.push({ key, value });
      }
    });
  }
  getNestedBlocks(block).forEach((child) => values.push(...collectPluginSortValues(child)));
  return values;
}

function getNestedBlocks(block: VisualBlock): VisualBlock[] {
  return [
    ...(block.schema.containerBlocks ?? []),
    ...(block.schema.componentListBlocks ?? []),
    ...((block.schema.gridItems ?? []).map((item) => item.block)),
    ...(block.schema.expandableStubBlocks?.children ?? []),
    ...(block.schema.expandableContentBlocks?.children ?? []),
    ...(block.schema.encryptedBlock ? [block.schema.encryptedBlock] : []),
  ];
}

function getComponentDefinition(meta: Record<string, unknown> | null | undefined, componentName: string): ComponentDefinition | null {
  const defs = meta?.component_defs;
  if (!Array.isArray(defs)) {
    return null;
  }
  return defs.find((item): item is ComponentDefinition =>
    !!item && typeof item === 'object' && (item as { name?: unknown }).name === componentName
  ) ?? null;
}

function findComponentListItemOwner(document: VisualDocument, blockId: string): VisualBlock | null {
  let owner: VisualBlock | null = null;
  const visitBlock = (block: VisualBlock): void => {
    if (owner) {
      return;
    }
    if (block.schema.kind === 'component-list') {
      for (const item of block.schema.componentListBlocks) {
        if (containsBlock(item, blockId)) {
          owner = item;
          return;
        }
      }
    }
    getNestedBlocks(block).forEach(visitBlock);
  };
  const visitSections = (sections: typeof document.sections): void => {
    sections.forEach((section) => {
      section.blocks.forEach(visitBlock);
      visitSections(section.children);
    });
  };
  visitSections(document.sections);
  return owner;
}

function containsBlock(block: VisualBlock, blockId: string): boolean {
  return block.id === blockId || getNestedBlocks(block).some((child) => containsBlock(child, blockId));
}
