import { resolveBaseComponentFromMeta } from '../component-defs';
import type { JsonObject } from '../hvy/types';
import type { VisualDocument } from '../types';
import type { HvyVirtualEntry, HvyVirtualFileSystem } from './virtual-file-system';

type ComponentStructureEntry = {
  code: string;
  directory: string;
  id: string;
  explicitId: boolean;
  type: string;
  textPath: string;
  jsonPath: string;
  xrefTitle?: string;
  xrefTarget?: string;
};

export type HvyRequestStructureOptions = {
  componentId?: string;
  collapse?: boolean;
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

export function formatHvyRequestStructure(document: VisualDocument, fs: HvyVirtualFileSystem, options: HvyRequestStructureOptions = {}): string {
  const entries = collectComponentStructureEntries(document, fs).map((entry, index) => withStableId(entry, index));
  const scopedEntries = scopeEntries(entries, options.componentId);
  return [
    formatComponentCodeKey(),
    '',
    'Custom component types:',
    ...formatCustomComponentDefinitions(document),
    '',
    'Components:',
    ...formatComponentTree(scopedEntries, { collapse: options.collapse ?? false }),
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
    .filter((entry): entry is ComponentStructureEntry => !!entry);
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
    explicitId: typeof config.id === 'string' && config.id.trim().length > 0,
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

function formatComponentTree(entries: ComponentStructureEntry[], options: { collapse: boolean }): string[] {
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
  return [...root.children.values()].flatMap((child) => formatComponentTreeNode(child, 0, options));
}

function formatComponentTreeNode(node: ComponentTreeNode, depth: number, options: { collapse: boolean }): string[] {
  const children = [...node.children.values()];
  const metadataChild = options.collapse ? collapsibleMetadataChild(children) : undefined;
  if (options.collapse && depth >= 2 && !node.entry && metadataChild) {
    const remainingChildren = children.filter((child) => child !== metadataChild);
    return [
      `${'  '.repeat(depth)}/${node.name} ${formatComponentStructureLine(metadataChild.entry!)}`,
      ...formatComponentTreeChildren(remainingChildren, depth + 1, options),
    ];
  }
  const label = node.entry ? formatComponentStructureLine(node.entry) : `/${node.name}`;
  return [
    `${'  '.repeat(depth)}${label}`,
    ...formatComponentTreeChildren(children, depth + 1, options),
  ];
}

function collapsibleMetadataChild(children: ComponentTreeNode[]): ComponentTreeNode | undefined {
  return children.find((child) => child.entry && !child.entry.explicitId && child.children.size === 0);
}

function formatComponentTreeChildren(children: ComponentTreeNode[], depth: number, options: { collapse: boolean }): string[] {
  if (!options.collapse) {
    return children.flatMap((child) => formatComponentTreeNode(child, depth, options));
  }
  const lines: string[] = [];
  for (let index = 0; index < children.length;) {
    const run = collectAnonymousLeafRun(children, index);
    if (run.length >= 3) {
      lines.push(formatAnonymousLeafRun(run, depth));
      index += run.length;
      continue;
    }
    lines.push(...formatComponentTreeNode(children[index]!, depth, options));
    index += 1;
  }
  return lines;
}

function collectAnonymousLeafRun(children: ComponentTreeNode[], startIndex: number): ComponentTreeNode[] {
  const firstEntry = anonymousLeafEntry(children[startIndex]);
  if (!firstEntry) {
    return [];
  }
  const run: ComponentTreeNode[] = [];
  for (let index = startIndex; index < children.length; index += 1) {
    const entry = anonymousLeafEntry(children[index]);
    if (!entry || entry.code !== firstEntry.code || entry.type !== firstEntry.type) {
      break;
    }
    run.push(children[index]!);
  }
  return run;
}

function anonymousLeafEntry(node: ComponentTreeNode | undefined): ComponentStructureEntry | undefined {
  if (!node || node.entry || node.children.size !== 1) {
    return undefined;
  }
  const metadataChild = collapsibleMetadataChild([...node.children.values()]);
  return metadataChild?.entry;
}

function formatAnonymousLeafRun(run: ComponentTreeNode[], depth: number): string {
  const first = run[0]!;
  const last = run[run.length - 1]!;
  const firstEntry = anonymousLeafEntry(first)!;
  const lastEntry = anonymousLeafEntry(last)!;
  return `${'  '.repeat(depth)}/${first.name}..${last.name} [${firstEntry.code}] ${firstEntry.textPath.split('/').pop() ?? firstEntry.textPath} ids=${firstEntry.id}-${lastEntry.id}`;
}

function withStableId(entry: ComponentStructureEntry, index: number): ComponentStructureEntry {
  return entry.id ? entry : { ...entry, id: `C${index}` };
}

function scopeEntries(entries: ComponentStructureEntry[], componentId = ''): ComponentStructureEntry[] {
  const id = componentId.trim();
  if (!id) {
    return entries;
  }
  const root = entries.find((entry) => entry.id === id);
  if (!root) {
    throw new Error(`hvy request_structure: unknown component id ${id}`);
  }
  return entries.filter((entry) => entry.directory === root.directory || entry.directory.startsWith(`${root.directory}/`));
}
