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
  description?: string;
  xrefTitle?: string;
  xrefTarget?: string;
};

export type HvyRequestStructureOptions = {
  componentId?: string;
  componentPath?: string;
  collapse?: boolean;
  describe?: boolean;
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
  const scopedEntries = scopeEntries(entries, options.componentId, options.componentPath);
  return [
    formatComponentCodeKey(),
    '',
    'Custom component types:',
    ...formatCustomComponentDefinitions(document),
    '',
    'Components:',
    ...formatComponentTree(scopedEntries, {
      collapse: options.collapse ?? false,
      describe: options.describe ?? false,
      sectionDescriptions: collectSectionDescriptions(fs),
    }),
  ].join('\n');
}

export function formatHvyRequestStructureForDirectory(
  document: VisualDocument,
  fs: HvyVirtualFileSystem,
  directoryPath: string,
  options: { describe?: boolean } = {}
): string {
  const normalized = directoryPath.replace(/\/$/, '');
  const rootName = normalized.split('/').filter(Boolean).at(-1) ?? 'body';
  const entries = collectComponentStructureEntries(document, fs)
    .map((entry, index) => withStableId(entry, index))
    .filter((entry) => entry.directory === normalized || entry.directory.startsWith(`${normalized}/`))
    .map((entry) => ({
      ...entry,
      directory: `/${rootName}${entry.directory.slice(normalized.length)}`,
      textPath: `/${rootName}${entry.textPath.slice(normalized.length)}`,
      jsonPath: `/${rootName}${entry.jsonPath.slice(normalized.length)}`,
    }));
  if (entries.length === 0) {
    return '(no nested components)';
  }
  return [
    'Components:',
    ...formatComponentTree(entries, {
      collapse: false,
      describe: options.describe ?? true,
      sectionDescriptions: new Map(),
    }),
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
    description: typeof config.description === 'string' && config.description.trim() ? config.description.trim() : undefined,
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
  path: string;
  children: Map<string, ComponentTreeNode>;
  entry?: ComponentStructureEntry;
};

function formatComponentTree(entries: ComponentStructureEntry[], options: { collapse: boolean; describe: boolean; sectionDescriptions: Map<string, string> }): string[] {
  const root: ComponentTreeNode = { name: '', path: '/', children: new Map() };
  for (const entry of entries) {
    const parts = entry.textPath.split('/').filter(Boolean);
    let current = root;
    for (const part of parts) {
      const child = current.children.get(part) ?? { name: part, path: `${current.path === '/' ? '' : current.path}/${part}`, children: new Map() };
      current.children.set(part, child);
      current = child;
    }
    current.entry = entry;
  }
  return [...root.children.values()].flatMap((child) => formatComponentTreeNode(child, 0, options));
}

function formatComponentTreeNode(node: ComponentTreeNode, depth: number, options: { collapse: boolean; describe: boolean; sectionDescriptions: Map<string, string> }): string[] {
  const children = [...node.children.values()];
  const metadataChild = options.collapse ? componentMetadataChild(children) : undefined;
  if (options.collapse && depth >= 2 && !node.entry && metadataChild) {
    const remainingChildren = children.filter((child) => child !== metadataChild);
    const hiddenAnonymousCount = countAnonymousComponentEntries(remainingChildren);
    const visibleChildren = remainingChildren.filter(hasExplicitComponentEntry);
    const hiddenSummary = hiddenAnonymousCount > 0 ? ` (+${hiddenAnonymousCount} anonymous descendants)` : '';
    return [
      `${'  '.repeat(depth)}/${node.name} ${formatComponentStructureLine(metadataChild.entry!)}${hiddenSummary}${formatDescriptionSuffix(metadataChild.entry!.description, options.describe)}`,
      ...formatComponentTreeChildren(visibleChildren, depth + 1, options),
    ];
  }
  const label = node.entry
    ? `${formatComponentStructureLine(node.entry)}${formatDescriptionSuffix(node.entry.description, options.describe)}`
    : `/${node.name}${formatDescriptionSuffix(options.sectionDescriptions.get(node.path), options.describe)}`;
  return [
    `${'  '.repeat(depth)}${label}`,
    ...formatComponentTreeChildren(children, depth + 1, options),
  ];
}

function collapsibleMetadataChild(children: ComponentTreeNode[]): ComponentTreeNode | undefined {
  return children.find((child) => child.entry && !child.entry.explicitId && child.children.size === 0);
}

function componentMetadataChild(children: ComponentTreeNode[]): ComponentTreeNode | undefined {
  return children.find((child) => child.entry && child.children.size === 0);
}

function hasExplicitComponentEntry(node: ComponentTreeNode): boolean {
  return !!node.entry?.explicitId || [...node.children.values()].some(hasExplicitComponentEntry);
}

function countAnonymousComponentEntries(nodes: ComponentTreeNode[]): number {
  return nodes.reduce((total, node) => {
    const own = node.entry && !node.entry.explicitId ? 1 : 0;
    return total + own + countAnonymousComponentEntries([...node.children.values()]);
  }, 0);
}

function formatComponentTreeChildren(children: ComponentTreeNode[], depth: number, options: { collapse: boolean; describe: boolean; sectionDescriptions: Map<string, string> }): string[] {
  if (!options.collapse) {
    return children.flatMap((child) => formatComponentTreeNode(child, depth, options));
  }
  const coveredAnonymousLeafNames = new Set(children.flatMap(collectCoveredAnonymousLeafNames));
  const lines: string[] = [];
  for (let index = 0; index < children.length;) {
    if (coveredAnonymousLeafNames.has(children[index]!.name) && anonymousLeafEntry(children[index])) {
      index += 1;
      continue;
    }
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

function collectCoveredAnonymousLeafNames(node: ComponentTreeNode): string[] {
  const metadataChild = componentMetadataChild([...node.children.values()]);
  if (!metadataChild?.entry) {
    return [];
  }
  return collectAnonymousLeafNames([...node.children.values()]);
}

function collectAnonymousLeafNames(children: ComponentTreeNode[]): string[] {
  return children.flatMap((child) => {
    if (anonymousLeafEntry(child)) {
      return [child.name];
    }
    return collectAnonymousLeafNames([...child.children.values()]);
  });
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

function collectSectionDescriptions(fs: HvyVirtualFileSystem): Map<string, string> {
  const descriptions = new Map<string, string>();
  for (const [path, entry] of fs.entries) {
    if (entry.kind !== 'file' || !path.endsWith('/section.json')) {
      continue;
    }
    const description = readJsonFile(fs, path).description;
    if (typeof description === 'string' && description.trim()) {
      descriptions.set(path.replace(/\/section\.json$/, ''), description.trim());
    }
  }
  return descriptions;
}

function formatDescriptionSuffix(description: string | undefined, enabled: boolean): string {
  if (!enabled || !description?.trim()) {
    return '';
  }
  return ` - ${description.trim().replace(/\s+/g, ' ')}`;
}

function scopeEntries(entries: ComponentStructureEntry[], componentId = '', componentPath = ''): ComponentStructureEntry[] {
  const path = componentPath.replace(/\/$/, '');
  if (path) {
    const scoped = entries.filter((entry) => entry.directory === path || entry.directory.startsWith(`${path}/`));
    if (scoped.length > 0) {
      return scoped;
    }
    throw new Error(`hvy request_structure: unknown component path ${componentPath}`);
  }
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
