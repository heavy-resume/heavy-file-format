import type { ComponentDefinition, ComponentTemplateFlavor, SectionDefinition, VisualDocument } from '../types';
import type { VisualBlock, VisualSection } from '../editor/types';
import { getComponentDefsFromMeta, getSectionDefsFromMeta, isBuiltinComponentName, resolveBaseComponentFromMeta } from '../component-defs';
import { parseVisualBlock, parseVisualSection } from '../document-factory';
import type { JsonObject } from '../hvy/types';
import { makeId } from '../utils';
import type { HvyVirtualEntry } from './virtual-file-system';

/** A definition's editing tree. Reads never materialize defaults in document metadata. */
export interface TemplateDirectory {
  path: string;
  contentPath: string;
  metadata: Record<string, unknown>;
  identityField: 'name' | 'key';
  block?: VisualBlock;
  section?: VisualSection;
  commit: () => void;
  remove: () => void;
}

const componentTrees = new WeakMap<object, { schema: unknown; template: unknown; templateSchema: unknown; base: string; block: VisualBlock }>();

function componentTree(document: VisualDocument, definition: ComponentDefinition, value: ComponentDefinition | ComponentTemplateFlavor): VisualBlock {
  const base = resolveBaseComponentFromMeta(definition.name, document.meta);
  const cached = componentTrees.get(value);
  if (cached && cached.schema === value.schema && cached.template === value.template && cached.templateSchema === value.template?.schema && cached.base === base) return cached.block;
  const sourceSchema = value.template?.schema ?? value.schema;
  const block: VisualBlock = sourceSchema?.kind
    ? { id: value.template?.id ?? makeId('block'), text: '', schema: sourceSchema, schemaMode: false }
    : parseVisualBlock({ text: value.text ?? '', schema: { ...(sourceSchema as unknown as Record<string, unknown> | undefined), component: base } }, new WeakSet<object>(), document.meta);
  // Normalized schemas stay live: editor mutations must be visible without rebuilding a cached copy.
  // The root uses its base type for the ordinary component file mapping; nested custom names are unchanged.
  if (sourceSchema?.kind) {
    block.schema = new Proxy(sourceSchema, {
      get: (schema, key, receiver) => key === 'component' ? base : Reflect.get(schema, key, receiver),
    });
  }
  Object.defineProperty(block, 'text', {
    enumerable: true,
    get: () => value.template && value.template !== block ? value.template.text : value.text ?? '',
    set: (text: string) => {
      value.text = text;
      if (value.template && value.template !== block) value.template.text = text;
    },
  });
  componentTrees.set(value, { schema: value.schema, template: value.template, templateSchema: value.template?.schema, base, block });
  return block;
}

export function templatePathSegment(name: string): string {
  return encodeURIComponent(name).replace(/\./g, '%2E');
}

export function getTemplateDirectories(document: VisualDocument): TemplateDirectory[] {
  const result: TemplateDirectory[] = [];
  for (const definition of getComponentDefsFromMeta(document.meta)) {
    const path = `/templates/components/${templatePathSegment(definition.name)}`;
    const add = (value: ComponentDefinition | ComponentTemplateFlavor, directory: string, remove: () => void) => {
      const block = componentTree(document, definition, value);
      result.push({
        path: directory, contentPath: `${directory}/schema`, metadata: value as unknown as Record<string, unknown>, identityField: 'name', block,
        commit: () => {
          value.schema = block.schema;
          if (block.text) value.text = block.text;
          else delete value.text;
          if (value.template || block.text) value.template = block;
          const cached = componentTrees.get(value)!;
          cached.schema = value.schema;
          cached.template = value.template;
          cached.templateSchema = value.template?.schema;
        }, remove,
      });
    };
    add(definition, path, () => removeValue(document.meta.component_defs as unknown[], definition));
    for (const flavor of definition.flavors ?? []) {
      add(flavor, `${path}/flavors/${templatePathSegment(flavor.name)}`, () => removeValue(definition.flavors!, flavor));
    }
  }
  for (const definition of getSectionDefsFromMeta(document.meta)) {
    const path = `/templates/sections/${templatePathSegment(definition.key || definition.name)}`;
    const add = (value: SectionDefinition | NonNullable<SectionDefinition['flavors']>[number], directory: string, remove: () => void) => {
      result.push({
        path: directory, contentPath: `${directory}/template`, metadata: value as unknown as Record<string, unknown>,
        identityField: value === definition && definition.key?.trim() ? 'key' : 'name',
        section: value.template, commit: () => {}, remove,
      });
    };
    add(definition, path, () => removeValue(document.meta.section_defs as unknown[], definition));
    for (const flavor of definition.flavors ?? []) {
      add(flavor, `${path}/flavors/${templatePathSegment(flavor.name)}`, () => removeValue(definition.flavors!, flavor));
    }
  }
  return result;
}

function removeValue(values: unknown[], value: unknown): void {
  const index = values.indexOf(value);
  if (index >= 0) values.splice(index, 1);
}

export function findTemplateDirectory(document: VisualDocument, path: string): TemplateDirectory | undefined {
  if (!path.startsWith('/templates/')) return undefined;
  return getTemplateDirectories(document).find((root) => path === root.path || path === root.contentPath || path.startsWith(`${root.contentPath}/`));
}

export function commitTemplateDirectory(document: VisualDocument, path: string): void {
  findTemplateDirectory(document, path)?.commit();
}

export function addTemplateMetadataFiles(entries: Map<string, HvyVirtualEntry>, roots: TemplateDirectory[]): void {
  for (const path of ['/templates', '/templates/components', '/templates/sections']) entries.set(path, { kind: 'dir', path });
  for (const root of roots) {
    for (const path of [root.path, ...(!root.path.includes('/flavors/') ? [`${root.path}/flavors`] : [])]) entries.set(path, { kind: 'dir', path });
    const path = `${root.path}/definition.json`;
    entries.set(path, {
      kind: 'file', path,
      read: () => `${JSON.stringify(metadataOnly(root.metadata), null, 2)}\n`,
      write: (content) => {
        const parsed: unknown = JSON.parse(content);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${path} must contain a JSON object.`);
        const next = parsed as Record<string, unknown>;
        for (const field of ['schema', 'template', 'flavors', 'text']) {
          if (field in next) throw new Error(`${field} has its own virtual directory; edit it there.`);
        }
        // Identity and base type determine paths and child schemas. Do not silently orphan references.
        // A keyed section definition's name is a label, independent of its stable identity.
        for (const field of new Set([root.identityField, 'key', 'baseType'])) {
          if (next[field] !== root.metadata[field]) throw new Error(`${field} must remain unchanged. Create a new definition to change its identity or base type.`);
        }
        if (typeof next.name !== 'string' || !next.name.trim() || next.name !== next.name.trim()) {
          throw new Error('Template definitions require a non-empty name without surrounding whitespace.');
        }
        if (next.name !== root.metadata.name && roots.some((other) =>
          other !== root && other.path.slice(0, other.path.lastIndexOf('/')) === root.path.slice(0, root.path.lastIndexOf('/')) &&
          (other.metadata.name === next.name || other.metadata.key === next.name)
        )) {
          throw new Error(`Template definition already exists: ${next.name}`);
        }
        for (const field of ['description', 'tags']) {
          if (field in next && typeof next[field] !== 'string') throw new Error(`${field} must be a string.`);
        }
        if ('repeatable' in next && typeof next.repeatable !== 'boolean') throw new Error('repeatable must be a boolean.');
        if ('templateVariables' in next) validateTemplateVariables(next.templateVariables);
        for (const field of Object.keys(metadataOnly(root.metadata))) delete root.metadata[field];
        Object.assign(root.metadata, next);
      },
    });
  }
}

function metadataOnly(value: Record<string, unknown>): Record<string, unknown> {
  const { schema: _schema, template: _template, flavors: _flavors, text: _text, ...metadata } = value;
  return metadata;
}

function validateTemplateVariables(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('templateVariables must be an object.');
  for (const item of Object.values(value)) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.values(item).some((field) => typeof field !== 'string')) {
      throw new Error('Each template variable must contain string metadata fields.');
    }
  }
}

/** Create a definition (or flavor) from a blank node or a copied document node. */
export function insertTemplateDefinition(document: VisualDocument, parent: string, name: string, index: number, node: VisualBlock | VisualSection, metadata?: Record<string, unknown>): string {
  if (!name.trim() || name !== name.trim()) throw new Error('Template definitions require a non-empty name without surrounding whitespace.');
  const section = 'blocks' in node;
  const collectionPath = section ? '/templates/sections' : '/templates/components';
  const owner = getTemplateDirectories(document).find((root) => `${root.path}/flavors` === parent && !root.path.includes('/flavors/'));
  if (parent !== collectionPath && (!owner || Boolean(owner.section) !== section)) throw new Error(`Invalid template destination: ${parent}`);
  if (owner?.block && resolveBaseComponentFromMeta((node as VisualBlock).schema.component, document.meta) !== owner.block.schema.component) throw new Error(`Flavor must use base component ${owner.block.schema.component}.`);
  const field = section ? 'section_defs' : 'component_defs';
  const values = (owner ? owner.metadata.flavors : document.meta[field]) as Record<string, unknown>[] | undefined;
  const existing = values ?? [];
  if (existing.some((value) => value.name === name || value.key === name)) throw new Error(`Template definition already exists: ${name}`);
  if (!section && !owner && isBuiltinComponentName(name)) throw new Error(`Template name conflicts with builtin component: ${name}`);
  const offset = index < 0 ? existing.length + index + 1 : index;
  if (offset < 0 || offset > existing.length) throw new Error(`hvy insert: index ${index} is out of range for ${existing.length} definitions.`);
  const copiedMetadata = metadata ? JSON.parse(JSON.stringify(metadata)) as Record<string, unknown> : {};
  const value: Record<string, unknown> = section
    ? { ...copiedMetadata, name, ...(!owner ? { key: name, repeatable: metadata?.repeatable === true } : {}), template: parseVisualSection(JSON.parse(JSON.stringify(node)), new WeakSet<object>(), document.meta) }
    : { ...copiedMetadata, name, ...(!owner ? { baseType: resolveBaseComponentFromMeta((node as VisualBlock).schema.component, document.meta) } : {}), template: parseVisualBlock(JSON.parse(JSON.stringify(node)), new WeakSet<object>(), document.meta) };
  if (!section) {
    const block = value.template as VisualBlock;
    block.schema.component = owner?.block?.schema.component ?? String(value.baseType);
    block.schema.id = '';
    value.schema = block.schema;
    if (block.text) value.text = block.text;
    else delete value.text;
  }
  existing.splice(offset, 0, value);
  if (owner) owner.metadata.flavors = existing;
  else document.meta[field] = existing as JsonObject[];
  return `${parent}/${templatePathSegment(name)}`;
}
