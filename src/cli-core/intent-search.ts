import { Index } from 'flexsearch';

import { resolveBaseComponentFromMeta } from '../component-defs';
import type { JsonObject } from '../hvy/types';
import { truncatePreview } from '../ai-document-structure';
import type { VisualDocument } from '../types';
import type { HvyVirtualFileSystem } from './virtual-file-system';

export interface HvyIntentSearchResult {
  path: string;
  id: string;
  kind: 'section' | 'component';
  type: string;
  score: number;
  reason: string;
  description?: string;
}

interface SemanticRecord {
  key: string;
  path: string;
  id: string;
  kind: 'section' | 'component';
  type: string;
  title: string;
  description: string;
  tags: string;
  body: string;
  roleHints: string[];
  customTypeDescription: string;
  searchText: string;
}

const STOP_WORDS = new Set(['the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'for', 'with', 'this', 'that', 'as']);

export function formatHvyFindIntent(document: VisualDocument, fs: HvyVirtualFileSystem, query: string, options: { max?: number; json?: boolean } = {}): string {
  const max = Math.max(1, Math.min(20, options.max ?? 5));
  const results = searchHvyIntent(document, fs, query, max);
  if (options.json) {
    return `${JSON.stringify(results, null, 2)}\n`;
  }
  if (results.length === 0) {
    return `No intent matches found for "${query}".`;
  }
  return [
    `Best locations for "${query}":`,
    ...results.map((result, index) => [
      `${index + 1}. ${result.path} id=${result.id} kind=${result.kind} type=${result.type} score=${result.score}`,
      `   ${result.reason}`,
      ...(result.description ? [`   description: ${result.description}`] : []),
    ].join('\n')),
  ].join('\n');
}

export function searchHvyIntent(document: VisualDocument, fs: HvyVirtualFileSystem, query: string, max = 5): HvyIntentSearchResult[] {
  const records = buildSemanticRecords(document, fs);
  const queryTokens = tokenizeIntent(query);
  if (records.length === 0 || queryTokens.length === 0) {
    return [];
  }
  const index = new Index({ tokenize: 'forward', preset: 'score' });
  for (const record of records) {
    index.add(record.key, record.searchText);
  }
  const flexMatches = new Set((index.search(query, { limit: Math.max(max * 8, 20), suggest: true }) as Array<string | number>).map(String));
  const queryFlags = detectIntentFlags(queryTokens);
  return records
    .map((record) => scoreSemanticRecord(record, queryTokens, queryFlags, flexMatches.has(record.key)))
    .filter((result): result is HvyIntentSearchResult => !!result && result.score > 0)
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, Math.max(1, Math.min(20, max)));
}

function buildSemanticRecords(document: VisualDocument, fs: HvyVirtualFileSystem): SemanticRecord[] {
  const records: SemanticRecord[] = [];
  const customDescriptions = customComponentDescriptionMap(document);
  for (const [path, entry] of fs.entries) {
    if (entry.kind !== 'file') {
      continue;
    }
    if (path.endsWith('/section.json')) {
      const config = readJson(fs, path);
      const sectionPath = path.replace(/\/section\.json$/, '');
      const id = stringField(config.id) || sectionPath.split('/').pop() || sectionPath;
      const title = stringField(config.title);
      const description = stringField(config.description);
      const tags = stringField(config.tags);
      const roleHints = roleHintsForPath(sectionPath, 'section', '');
      records.push(makeRecord({
        key: `section:${sectionPath}`,
        path: sectionPath,
        id,
        kind: 'section',
        type: 'section',
        title,
        description,
        tags,
        body: '',
        roleHints,
        customTypeDescription: '',
      }));
      continue;
    }
    if (!path.startsWith('/body/') || !path.endsWith('.json') || path.endsWith('/section.json')) {
      continue;
    }
    const componentPath = path.replace(/\/[^/]+$/, '');
    const type = path.split('/').pop()?.replace(/\.json$/, '') ?? '';
    const textPath = `${componentPath}/${type}.txt`;
    const textEntry = fs.entries.get(textPath);
    if (!type || textEntry?.kind !== 'file') {
      continue;
    }
    const config = readJson(fs, path);
    const id = stringField(config.id) || componentPath.split('/').pop() || componentPath;
    const baseType = resolveBaseComponentFromMeta(type, document.meta);
    const roleHints = roleHintsForPath(componentPath, baseType, type, config);
    records.push(makeRecord({
      key: `component:${componentPath}`,
      path: componentPath,
      id,
      kind: 'component',
      type,
      title: [stringField(config.xrefTitle), stringField(config.xrefDetail)].filter(Boolean).join(' '),
      description: stringField(config.description),
      tags: stringField(config.tags),
      body: textEntry.read(),
      roleHints,
      customTypeDescription: customDescriptions.get(type) ?? '',
    }));
  }
  return records;
}

function makeRecord(record: Omit<SemanticRecord, 'searchText'>): SemanticRecord {
  const searchText = [
    record.path,
    record.id,
    record.kind,
    record.type,
    record.title,
    record.description,
    record.tags,
    record.customTypeDescription,
    ...record.roleHints,
    truncatePreview(record.body, 500),
  ].join(' ');
  return { ...record, searchText };
}

function scoreSemanticRecord(record: SemanticRecord, queryTokens: string[], flags: ReturnType<typeof detectIntentFlags>, flexMatched: boolean): HvyIntentSearchResult | null {
  let score = flexMatched ? 8 : 0;
  const reasons: string[] = [];
  score += scoreField(queryTokens, record.description, 12, 'matched description', reasons);
  score += scoreField(queryTokens, record.title, 8, 'matched title', reasons);
  score += scoreField(queryTokens, record.id, 7, 'matched explicit id', reasons);
  score += scoreField(queryTokens, record.path, 6, 'matched path', reasons);
  score += scoreField(queryTokens, record.customTypeDescription, 5, 'matched custom type description', reasons);
  score += scoreField(queryTokens, record.type, 4, 'matched component type', reasons);
  score += scoreField(queryTokens, record.body, 1, 'matched body preview', reasons);
  for (const hint of record.roleHints) {
    score += scoreField(queryTokens, hint, 9, `matched role hint: ${hint}`, reasons);
  }

  if (flags.skillIntent && record.path.startsWith('/body/skills') && (record.type === 'component-list' || record.path.includes('/component-list'))) {
    score += 95;
    reasons.unshift('likely main skills library edit surface');
  }
  if (flags.topIntent && record.path.startsWith('/body/top-skills-tools-technologies')) {
    score += 40;
    reasons.unshift('likely featured top skills/tools surface');
  }
  if (flags.topIntent && isLocalSkillsPath(record.path)) {
    score -= 35;
    reasons.push('penalized local project/history skills list for top/global query');
  }
  if (record.kind === 'section' && flags.skillIntent && record.path === '/body/skills') {
    score += 12;
  }
  if (record.kind === 'section' && flags.topIntent && record.path === '/body/top-skills-tools-technologies') {
    score += 12;
  }
  if (score <= 0) {
    return null;
  }
  return {
    path: record.path,
    id: record.id,
    kind: record.kind,
    type: record.type,
    score,
    reason: reasons.length > 0 ? [...new Set(reasons)].slice(0, 3).join('; ') : 'matched indexed content',
    ...(record.description ? { description: truncatePreview(record.description, 160) } : {}),
  };
}

function scoreField(queryTokens: string[], value: string, weight: number, reason: string, reasons: string[]): number {
  if (!value.trim()) {
    return 0;
  }
  const target = value.toLowerCase();
  const targetTokens = new Set(tokenizeIntent(target));
  let score = 0;
  for (const token of queryTokens) {
    if (targetTokens.has(token)) {
      score += weight;
    } else if (target.includes(token)) {
      score += Math.max(1, Math.floor(weight / 3));
    }
  }
  if (score > 0) {
    reasons.push(reason);
  }
  return score;
}

function detectIntentFlags(tokens: string[]): { topIntent: boolean; skillIntent: boolean } {
  const tokenSet = new Set(tokens);
  return {
    topIntent: tokenSet.has('top') || tokenSet.has('featured') || tokenSet.has('highlight'),
    skillIntent: tokenSet.has('skill') || tokenSet.has('skills') || tokenSet.has('baking') || tokenSet.has('tooling'),
  };
}

function roleHintsForPath(path: string, baseType: string, type: string, config: JsonObject = {}): string[] {
  const hints: string[] = [];
  if (path === '/body/skills' || path.startsWith('/body/skills/')) {
    hints.push('main reusable skills library', 'global skill records live here');
  }
  if (path === '/body/top-skills-tools-technologies' || path.startsWith('/body/top-skills-tools-technologies/')) {
    hints.push('featured top skills tools technologies area', 'top skills grid uses xref cards pointing to skill or tool ids');
  }
  if (isLocalSkillsPath(path)) {
    hints.push('local project or history skills tools list');
  }
  if (baseType === 'component-list') {
    const itemType = stringField(config.componentListComponent);
    hints.push(itemType ? `ordered list of ${itemType} components` : 'ordered component list');
  }
  if (baseType === 'grid') {
    hints.push('visual grid of child components');
  }
  if (baseType === 'xref-card') {
    hints.push('cross reference card pointing to another section or component id');
  }
  if (type && type !== baseType) {
    hints.push(`${type} custom component based on ${baseType}`);
  }
  return hints;
}

function isLocalSkillsPath(path: string): boolean {
  return (path.startsWith('/body/projects/') || path.startsWith('/body/history/')) && /skills|tools|technologies/i.test(path);
}

function tokenizeIntent(value: string): string[] {
  return [...new Set(value.toLowerCase().match(/[a-z0-9_]+/g) ?? [])]
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function customComponentDescriptionMap(document: VisualDocument): Map<string, string> {
  const definitions = Array.isArray(document.meta.component_defs) ? document.meta.component_defs : [];
  const map = new Map<string, string>();
  for (const definition of definitions) {
    if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
      continue;
    }
    const entry = definition as JsonObject;
    const name = stringField(entry.name);
    const description = stringField(entry.description);
    if (name && description) {
      map.set(name, description);
    }
  }
  return map;
}

function readJson(fs: HvyVirtualFileSystem, path: string): JsonObject {
  const entry = fs.entries.get(path);
  if (!entry || entry.kind !== 'file') {
    return {};
  }
  try {
    const value = JSON.parse(entry.read()) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
  } catch {
    return {};
  }
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
