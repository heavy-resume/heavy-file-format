import { resolveBaseComponentFromMeta } from '../component-defs';
import type { JsonObject } from '../hvy/types';
import type { VisualDocument } from '../types';
import type { HvyVirtualEntry, HvyVirtualFileSystem } from './virtual-file-system';

type ComponentStructureEntry = {
  code: string;
  directory: string;
  id: string;
  type: string;
  textPath: string;
  jsonPath: string;
  xrefTitle?: string;
  xrefTarget?: string;
};

const COMPONENT_TYPE_CODES: Record<string, string> = {
  text: 'x',
  quote: 'q',
  code: 'k',
  container: 'c',
  plugin: 'p',
  table: 't',
  image: 'i',
  grid: 'g',
  'component-list': 'l',
  expandable: 'e',
  'xref-card': 'r',
};

export function formatHvyRequestStructure(document: VisualDocument, fs: HvyVirtualFileSystem): string {
  const entries = collectComponentStructureEntries(document, fs).map((entry, index) => withStableId(entry, index));
  return [
    formatComponentCodeKey(),
    '',
    'Custom component types:',
    ...formatCustomComponentDefinitions(document),
    '',
    'Components:',
    ...formatComponentTree(entries),
  ].join('\n');
}

export function formatHvyStructureForPaths(document: VisualDocument, fs: HvyVirtualFileSystem, rawPaths: string[]): string {
  const allEntries = collectComponentStructureEntries(document, fs).map(withStableId);
  const selected = allEntries.filter((entry) =>
    rawPaths.some((path) => path === entry.directory || path === entry.textPath || path === entry.jsonPath || path.startsWith(`${entry.directory}/`))
  );
  const unique = selected.filter((entry, index, entries) => entries.findIndex((candidate) => candidate.directory === entry.directory) === index);
  if (unique.length === 0) {
    return '';
  }
  return [
    'Search result component structure:',
    formatComponentCodeKey(),
    ...unique.slice(0, 12).map(formatSearchStructureLine),
    ...(unique.length > 12 ? [`... ${unique.length - 12} more matched components omitted.`] : []),
  ].join('\n');
}

export function extractVirtualPathsFromOutput(output: string): string[] {
  return [...output.matchAll(/(?:^|\s)(\/(?:body|attachments)\/[^\s:]+)(?::\d+)?/gm)]
    .map((match) => match[1] ?? '')
    .filter(Boolean);
}

function collectComponentStructureEntries(document: VisualDocument, fs: HvyVirtualFileSystem): ComponentStructureEntry[] {
  return [...fs.entries.values()]
    .filter((entry): entry is HvyVirtualEntry & { kind: 'file' } =>
      entry.kind === 'file' && entry.path.startsWith('/body/') && entry.path.endsWith('.json') && !entry.path.endsWith('/section.json'))
    .map((entry) => componentEntryFromJsonFile(document, fs, entry.path))
    .filter((entry): entry is ComponentStructureEntry => !!entry)
    .sort((left, right) => left.directory.localeCompare(right.directory));
}

function componentEntryFromJsonFile(document: VisualDocument, fs: HvyVirtualFileSystem, jsonPath: string): ComponentStructureEntry | null {
  const directory = jsonPath.replace(/\/[^/]+$/, '');
  const type = jsonPath.split('/').pop()?.replace(/\.json$/, '') ?? '';
  const textPath = `${directory}/${type}.txt`;
  const textEntry = fs.entries.get(textPath);
  if (!type || textEntry?.kind !== 'file') {
    return null;
  }
  const config = readJsonFile(fs, jsonPath);
  const baseType = resolveBaseComponentFromMeta(type, document.meta);
  return {
    code: COMPONENT_TYPE_CODES[baseType] ?? '?',
    directory,
    id: typeof config.id === 'string' && config.id.trim() ? config.id.trim() : '',
    type,
    textPath,
    jsonPath,
    xrefTitle: typeof config.xrefTitle === 'string' && config.xrefTitle.trim() ? config.xrefTitle.trim() : undefined,
    xrefTarget: typeof config.xrefTarget === 'string' && config.xrefTarget.trim() ? config.xrefTarget.trim() : undefined,
  };
}

function readJsonFile(fs: HvyVirtualFileSystem, path: string): JsonObject {
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

function formatComponentCodeKey(): string {
  return 'Key: [x] text, [c] container, [p] plugin, [t] table, [i] image, [g] grid, [l] component-list, [e] expandable, [r] xref-card, [?] unknown. Custom types use their base type code.';
}

function formatCustomComponentDefinitions(document: VisualDocument): string[] {
  const definitions = Array.isArray(document.meta.component_defs) ? document.meta.component_defs : [];
  if (definitions.length === 0) {
    return ['- (none)'];
  }
  return definitions.map((definition) => {
    const entry = definition && typeof definition === 'object' && !Array.isArray(definition) ? definition as JsonObject : {};
    const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : '(unnamed)';
    const baseType = typeof entry.baseType === 'string' && entry.baseType.trim() ? entry.baseType.trim() : '(unknown)';
    const description = typeof entry.description === 'string' && entry.description.trim() ? ` - ${entry.description.trim()}` : '';
    return `- ${name} baseType=${baseType}${description}`;
  });
}

function formatComponentStructureLine(entry: ComponentStructureEntry): string {
  return `[${entry.code}] ${entry.textPath.split('/').pop() ?? entry.textPath} id=${entry.id}`;
}

function formatSearchStructureLine(entry: ComponentStructureEntry): string {
  const xref = entry.type === 'xref-card'
    ? [
        entry.xrefTitle ? ` xrefTitle="${entry.xrefTitle}"` : '',
        entry.xrefTarget ? ` xrefTarget=${entry.xrefTarget}` : '',
        ' - if removing this reference, prefer `hvy remove ' + entry.directory + '` over editing JSON text.',
      ].join('')
    : '';
  return `${formatComponentStructureLine(entry)}${xref}`;
}

type ComponentTreeNode = {
  name: string;
  children: Map<string, ComponentTreeNode>;
  entry?: ComponentStructureEntry;
};

function formatComponentTree(entries: ComponentStructureEntry[]): string[] {
  const root: ComponentTreeNode = { name: '', children: new Map() };
  for (const entry of entries) {
    const parts = entry.textPath.split('/').filter(Boolean);
    let current = root;
    for (const part of parts) {
      const child = current.children.get(part) ?? { name: part, children: new Map() };
      current.children.set(part, child);
      current = child;
    }
    current.entry = entry;
  }
  return [...root.children.values()].flatMap((child) => formatComponentTreeNode(child, 0));
}

function formatComponentTreeNode(node: ComponentTreeNode, depth: number): string[] {
  const children = [...node.children.values()];
  if (!node.entry && children.length === 1 && children[0]?.entry && children[0].children.size === 0) {
    return [`${'  '.repeat(depth)}/${node.name} ${formatComponentStructureLine(children[0].entry)}`];
  }
  const label = node.entry ? formatComponentStructureLine(node.entry) : `/${node.name}`;
  return [
    `${'  '.repeat(depth)}${label}`,
    ...children.flatMap((child) => formatComponentTreeNode(child, depth + 1)),
  ];
}

function withStableId(entry: ComponentStructureEntry, index: number): ComponentStructureEntry {
  return entry.id ? entry : { ...entry, id: `C${index}` };
}
