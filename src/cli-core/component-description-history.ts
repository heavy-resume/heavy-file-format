import { getComponentDefsFromMeta, resolveBaseComponentFromMeta } from '../component-defs';
import type { VisualDocument } from '../types';
import { normalizeVirtualPath, resolveVirtualPath, type HvyVirtualFileSystem } from './virtual-file-system';

type JsonRecord = Record<string, unknown>;

interface ComponentContextEntry {
  path: string;
  kind: 'section' | 'component';
  type: string;
  baseType: string;
  id: string;
  description: string;
  definitionDescription: string;
  componentListComponent: string;
  componentListComponentBaseType: string;
}

export function formatHvyComponentDescriptionHistory(
  document: VisualDocument,
  fs: HvyVirtualFileSystem,
  cwd: string,
  path = '.'
): string {
  const target = resolveExistingContextPath(fs, cwd, path);
  const entries = collectComponentContextEntries(document, fs, target);
  if (entries.length === 0) {
    return '';
  }
  return [
    'Component context:',
    ...entries.flatMap((entry) => formatContextEntry(entry)),
  ].join('\n');
}

function resolveExistingContextPath(fs: HvyVirtualFileSystem, cwd: string, path: string): string {
  const resolved = resolveVirtualPath(fs, cwd, path);
  if (fs.entries.get(resolved)?.kind === 'dir') {
    return resolved;
  }
  if (fs.entries.get(resolved)?.kind === 'file') {
    return resolved.replace(/\/[^/]+$/, '') || '/';
  }
  let current = normalizeVirtualPath(cwd, path);
  while (current !== '/') {
    if (fs.entries.get(current)?.kind === 'dir') {
      return current;
    }
    current = current.replace(/\/[^/]+$/, '') || '/';
  }
  return '/';
}

function collectComponentContextEntries(document: VisualDocument, fs: HvyVirtualFileSystem, target: string): ComponentContextEntry[] {
  const customDescriptions = new Map(
    getComponentDefsFromMeta(document.meta)
      .map((def) => [def.name, typeof def.description === 'string' ? def.description.trim() : ''])
      .filter((entry): entry is [string, string] => !!entry[0] && !!entry[1])
  );
  const entries: ComponentContextEntry[] = [];
  const parts = target.split('/').filter(Boolean);
  for (let index = 1; index <= parts.length; index += 1) {
    const path = `/${parts.slice(0, index).join('/')}`;
    const section = readJson(fs, `${path}/section.json`);
    if (section) {
      entries.push({
        path,
        kind: 'section',
        type: 'section',
        baseType: 'section',
        id: readString(section.id),
        description: readString(section.description),
        definitionDescription: '',
        componentListComponent: '',
        componentListComponentBaseType: '',
      });
      continue;
    }
    const componentType = inferComponentType(fs, path);
    if (!componentType) {
      continue;
    }
    const component = readJson(fs, `${path}/${componentType}.json`) ?? {};
    const baseType = resolveBaseComponentFromMeta(componentType, document.meta);
    entries.push({
      path,
      kind: 'component',
      type: componentType,
      baseType,
      id: readString(component.id),
      description: readString(component.description),
      definitionDescription: customDescriptions.get(componentType) ?? '',
      componentListComponent: readString(component.componentListComponent),
      componentListComponentBaseType: readString(component.componentListComponent)
        ? resolveBaseComponentFromMeta(readString(component.componentListComponent), document.meta)
        : '',
    });
  }
  return entries.filter((entry) =>
    entry.description
    || entry.definitionDescription
    || entry.componentListComponent
    || entry.kind === 'section'
  );
}

function formatContextEntry(entry: ComponentContextEntry): string[] {
  const label = entry.kind === 'section'
    ? `${entry.path} section`
    : `${entry.path} ${entry.type}${entry.baseType !== entry.type ? ` base=${entry.baseType}` : ''}`;
  const lines = [`- ${label}${entry.id ? ` id=${entry.id}` : ''}`];
  if (entry.description) {
    lines.push(`  description: ${oneLine(entry.description)}`);
  }
  if (entry.definitionDescription && entry.definitionDescription !== entry.description) {
    lines.push(`  reusable definition: ${oneLine(entry.definitionDescription)}`);
  }
  if (entry.componentListComponent) {
    lines.push(`  list item type: ${entry.componentListComponent}${entry.componentListComponentBaseType ? ` base=${entry.componentListComponentBaseType}` : ''}`);
  }
  return lines;
}

function inferComponentType(fs: HvyVirtualFileSystem, path: string): string {
  const prefix = `${path}/`;
  for (const entry of fs.entries.values()) {
    if (entry.kind !== 'file' || !entry.path.startsWith(prefix) || entry.path.slice(prefix.length).includes('/')) {
      continue;
    }
    const filename = entry.path.slice(prefix.length);
    if (!filename.endsWith('.json') || filename === 'section.json') {
      continue;
    }
    const componentType = filename.replace(/\.json$/, '');
    if (fs.entries.has(`${path}/${componentType}.txt`) || fs.entries.has(`${path}/script.py`)) {
      return componentType;
    }
  }
  return '';
}

function readJson(fs: HvyVirtualFileSystem, path: string): JsonRecord | null {
  const entry = fs.entries.get(path);
  if (!entry || entry.kind !== 'file') {
    return null;
  }
  try {
    const value = JSON.parse(entry.read()) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
  } catch {
    return null;
  }
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
