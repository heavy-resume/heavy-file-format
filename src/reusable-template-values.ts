import { normalizeLinkInputValue, serializeMarkdownLinkDestination } from './link-value';
import type { VisualBlock, VisualSection } from './editor/types';
import { createTextFillInMarker } from './text-fill-in';
import { inheritTemplateParagraphStyle } from './template-paragraph-styles';
import type { ComponentDefinition, ComponentTemplateFlavor, SectionDefinition, SectionTemplateFlavor, ReusableTemplateVariableConfig } from './types';

export type ReusableTemplateVariableType = 'text' | 'block' | 'url';
type ReusableTemplateFilter = 'text' | 'block' | 'isempty';

export interface ReusableTemplateVariable {
  name: string;
  type: ReusableTemplateVariableType;
  label: string;
  generator?: string;
  generatorLabel?: string;
}

export const REUSABLE_TEMPLATE_REFERENCES_CHANGED_EVENT = 'hvy:reusable-template-references-changed';

const TEMPLATE_TOKEN_PATTERN = /{%\s*([A-Za-z_][A-Za-z0-9_-]*)\s*(?:\|\s*(text|block|isempty)\s*)?%}/g;

export function extractReusableTemplateVariablesFromDefinition(definition: ComponentDefinition | null | undefined): ReusableTemplateVariable[] {
  const source = definition?.template ?? definition?.schema;
  if (!source) {
    return [];
  }
  return extractReusableTemplateVariables(source, getReusableTemplateVariableConfig(definition));
}

export function extractReusableTemplateVariablesFromFlavor(
  flavor: ComponentTemplateFlavor | null | undefined,
  fallbackConfig: ComponentDefinition['templateVariables'] = {}
): ReusableTemplateVariable[] {
  const source = flavor?.template ?? flavor?.schema;
  if (!source) {
    return [];
  }
  return extractReusableTemplateVariables(source, mergeTemplateVariableConfig(fallbackConfig, flavor));
}

export function extractReusableTemplateVariablesFromSectionDefinition(definition: SectionDefinition | null | undefined): ReusableTemplateVariable[] {
  if (!definition?.template) {
    return [];
  }
  return extractReusableTemplateVariables(definition.template, getReusableTemplateVariableConfig(definition));
}

export function extractReusableTemplateVariablesFromSectionFlavor(
  flavor: SectionTemplateFlavor | null | undefined,
  fallbackConfig: SectionDefinition['templateVariables'] = {}
): ReusableTemplateVariable[] {
  if (!flavor?.template) {
    return [];
  }
  return extractReusableTemplateVariables(flavor.template, mergeTemplateVariableConfig(fallbackConfig, flavor));
}

function mergeTemplateVariableConfig(
  fallback: Record<string, ReusableTemplateVariableConfig>,
  flavor: ComponentTemplateFlavor | SectionTemplateFlavor | null | undefined
): Record<string, ReusableTemplateVariableConfig> {
  const config = getReusableTemplateVariableConfig({ templateVariables: fallback } as ComponentTemplateFlavor);
  Object.entries(getReusableTemplateVariableConfig(flavor)).forEach(([name, value]) => {
    config[name] = { ...config[name], ...value };
  });
  return config;
}

export function extractReusableTemplateVariables(value: unknown, config: Record<string, ReusableTemplateVariableConfig> = {}): ReusableTemplateVariable[] {
  const variables = new Map<string, { type: ReusableTemplateVariableType; explicit: boolean }>();
  visitTemplateStrings(value, (text) => {
    for (const match of text.matchAll(TEMPLATE_TOKEN_PATTERN)) {
      const name = match[1] ?? '';
      const { type, explicit } = normalizeTemplateVariableType(match[2]);
      const existing = variables.get(name);
      if (existing && existing.explicit && explicit && existing.type !== type && !config[name]?.type) {
        throw new Error(`Template variable "${name}" uses conflicting types: ${existing.type} and ${type}.`);
      }
      if (!existing) {
        variables.set(name, { type, explicit });
      } else if (!existing.explicit && explicit) {
        existing.type = type;
        existing.explicit = true;
      }
    }
  });
  return [...variables.entries()].map(([name, variable]) => ({
    name,
    type: config[name]?.type ?? variable.type,
    label: config[name]?.label || humanizeTemplateVariableName(name),
    ...(config[name]?.generator ? { generator: config[name]?.generator } : {}),
    ...(config[name]?.generatorLabel ? { generatorLabel: config[name]?.generatorLabel } : {}),
  }));
}

export function validateReusableTemplateValues(
  variables: ReusableTemplateVariable[],
  values: Record<string, string>
): void {
  const expected = variables.map((variable) => variable.name);
  const expectedSet = new Set(expected);
  const actual = Object.keys(values);
  const missing = expected.filter((key) => !Object.prototype.hasOwnProperty.call(values, key));
  const extra = actual.filter((key) => !expectedSet.has(key));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error([
      'Template values must exactly match expected keys.',
      `Expected keys: ${formatTemplateKeys(expected)}`,
      missing.length > 0 ? `Missing keys: ${formatTemplateKeys(missing)}` : '',
      extra.length > 0 ? `Extra keys: ${formatTemplateKeys(extra)}` : '',
    ].filter(Boolean).join(' '));
  }
  const multilineVariable = variables.find((variable) => variable.type !== 'block' && /\r|\n/.test(values[variable.name] ?? ''));
  if (multilineVariable) {
    throw new Error(`Template value "${multilineVariable.name}" is type ${multilineVariable.type} and cannot contain newlines. Set its templateVariables type to block for multi-line values.`);
  }
}

export function applyReusableTemplateValues(
  block: VisualBlock,
  values: Record<string, string>,
  variables: ReusableTemplateVariable[] = []
): VisualBlock {
  replaceTemplateStringsInBlock(
    block,
    normalizeTemplateLinkValues(values, variables),
    getReusableTemplateVariableLabelMap(variables),
    new WeakSet<object>(),
    new Set(variables.filter((variable) => variable.type === 'url').map((variable) => variable.name))
  );
  normalizeTemplatePlaceholderTextBlocks(block);
  return block;
}

export function applyReusableSectionTemplateValues(
  section: VisualSection,
  values: Record<string, string>,
  variables: ReusableTemplateVariable[] = []
): VisualSection {
  replaceTemplateStringsInSection(
    section,
    normalizeTemplateLinkValues(values, variables),
    getReusableTemplateVariableLabelMap(variables),
    new WeakSet<object>(),
    new Set(variables.filter((variable) => variable.type === 'url').map((variable) => variable.name))
  );
  normalizeSectionTemplatePlaceholderTextBlocks(section);
  return section;
}

function normalizeTemplateLinkValues(values: Record<string, string>, variables: ReusableTemplateVariable[]): Record<string, string> {
  const normalized = { ...values };
  variables.filter((variable) => variable.type === 'url').forEach((variable) => {
    normalized[variable.name] = normalizeLinkInputValue(values[variable.name] ?? '');
  });
  return normalized;
}

export function parseReusableTemplateJson(raw: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`--using-template must be a JSON object of string values. ${error instanceof Error ? error.message : ''}`.trim());
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('--using-template must be a JSON object of string values.');
  }
  const values: Record<string, string> = {};
  Object.entries(parsed as Record<string, unknown>).forEach(([key, value]) => {
    if (typeof value !== 'string') {
      throw new Error(`--using-template value for "${key}" must be a string.`);
    }
    values[key] = value;
  });
  return values;
}

export function formatTemplateKeys(keys: string[]): string {
  return keys.length > 0 ? keys.join(', ') : '(none)';
}

export function humanizeTemplateVariableName(name: string): string {
  return name
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function createReusableTemplateVariableName(label: string, existingNames: Iterable<string> = []): string {
  const normalized = label
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const baseName = /^[a-z_]/.test(normalized) ? normalized : `value-${normalized || 'text'}`;
  const used = new Set(existingNames);
  let name = baseName;
  let suffix = 2;
  while (used.has(name)) {
    name = `${baseName}-${suffix}`;
    suffix += 1;
  }
  return name;
}

export function renameReusableTemplateVariable(value: unknown, oldName: string, newName: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(newName) || oldName === newName) {
    return;
  }
  visitAndReplaceTemplateStrings(value, (text) => text.replace(
    new RegExp(`{%\\s*${escapeRegExp(oldName)}(\\s*(?:\\|\\s*(?:text|block|isempty)\\s*)?)%}`, 'g'),
    `{% ${newName}$1%}`
  ));
}

export function setReusableTemplateVariableType(
  value: unknown,
  name: string,
  type: 'text' | 'block'
): void {
  visitAndReplaceTemplateStrings(value, (text) => text.replace(
    new RegExp(`{%\\s*${escapeRegExp(name)}\\s*(?:\\|\\s*(text|block|isempty)\\s*)?%}`, 'g'),
    (token, filter: string | undefined) => filter === 'isempty' ? token : `{% ${name} | ${type} %}`
  ));
}

export function replaceReusableTemplateVariableOccurrenceWithText(
  value: unknown,
  name: string,
  occurrenceIndex: number,
  replacement: string
): void {
  let currentIndex = 0;
  visitAndReplaceTemplateStrings(value, (text) => text.replace(
    new RegExp(`{%\\s*${escapeRegExp(name)}\\s*(?:\\|\\s*(?:text|block|isempty)\\s*)?%}`, 'g'),
    (token) => {
      const shouldReplace = currentIndex === occurrenceIndex;
      currentIndex += 1;
      return shouldReplace ? replacement : token;
    }
  ));
}

export function countReusableTemplateVariableOccurrences(value: unknown, name: string): number {
  let count = 0;
  visitTemplateStrings(value, (text) => {
    count += [...text.matchAll(new RegExp(`{%\\s*${escapeRegExp(name)}\\s*(?:\\|\\s*(?:text|block|isempty)\\s*)?%}`, 'g'))].length;
  });
  return count;
}

function visitAndReplaceTemplateStrings(value: unknown, replace: (text: string) => string, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return replace(value);
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => { value[index] = visitAndReplaceTemplateStrings(item, replace, seen); });
    return value;
  }
  Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
    (value as Record<string, unknown>)[key] = visitAndReplaceTemplateStrings(item, replace, seen);
  });
  return value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getReusableTemplateVariableConfig(definition: ComponentDefinition | ComponentTemplateFlavor | SectionDefinition | SectionTemplateFlavor | null | undefined): Record<string, ReusableTemplateVariableConfig> {
  const config = definition?.templateVariables;
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return {};
  }
  const variables: Record<string, ReusableTemplateVariableConfig> = {};
  Object.entries(config).forEach(([name, value]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return;
    }
    const next: ReusableTemplateVariableConfig = {};
    if (value.type !== undefined) {
      if (!['text', 'block', 'url'].includes(value.type)) throw new Error(`Invalid template variable type: ${value.type}`);
      next.type = value.type;
    }
    const label = (value as { label?: unknown }).label;
    if (typeof label === 'string' && label.trim()) {
      next.label = label.trim();
    }
    const generator = (value as { generator?: unknown }).generator;
    if (typeof generator === 'string' && generator.trim()) {
      next.generator = generator.trim();
    }
    const generatorLabel = (value as { generatorLabel?: unknown }).generatorLabel;
    if (typeof generatorLabel === 'string' && generatorLabel.trim()) {
      next.generatorLabel = generatorLabel.trim();
    }
    variables[name] = next;
  });
  return variables;
}

function replaceTemplateStringsInSection(
  section: VisualSection,
  values: Record<string, string>,
  labels: Record<string, string>,
  seen = new WeakSet<object>(),
  urlVariables = new Set<string>()
): void {
  if (seen.has(section)) {
    return;
  }
  seen.add(section);
  section.customId = replaceTemplateStrings(section.customId, values, seen) as string;
  section.title = replaceTemplateStrings(section.title, values, seen) as string;
  section.css = replaceTemplateStrings(section.css, values, seen) as string;
  section.tags = replaceTemplateStrings(section.tags, values, seen) as string;
  section.description = replaceTemplateStrings(section.description, values, seen) as string;
  section.templateKey = typeof section.templateKey === 'string'
    ? replaceTemplateStrings(section.templateKey, values, seen) as string
    : section.templateKey;
  section.blocks.forEach((block) => replaceTemplateStringsInBlock(block, values, labels, seen, urlVariables));
}

function getReusableTemplateVariableLabelMap(variables: ReusableTemplateVariable[]): Record<string, string> {
  const labels: Record<string, string> = {};
  variables.forEach((variable) => {
    if (variable.label.trim()) {
      labels[variable.name] = variable.label.trim();
    }
  });
  return labels;
}

function normalizeTemplateVariableType(raw: string | undefined): { type: ReusableTemplateVariableType; explicit: boolean } {
  if (raw === 'block') {
    return { type: 'block', explicit: true };
  }
  if (raw === 'text') {
    return { type: 'text', explicit: true };
  }
  return { type: 'text', explicit: false };
}

function visitTemplateStrings(value: unknown, visit: (text: string) => void, seen = new WeakSet<object>()): void {
  if (typeof value === 'string') {
    visit(value);
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  if (seen.has(value)) {
    return;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item) => visitTemplateStrings(item, visit, seen));
    return;
  }
  Object.values(value as Record<string, unknown>).forEach((item) => visitTemplateStrings(item, visit, seen));
}

function replaceTemplateStringsInBlock(
  block: VisualBlock,
  values: Record<string, string>,
  labels: Record<string, string>,
  seen = new WeakSet<object>(),
  urlVariables = new Set<string>()
): void {
  if (seen.has(block)) {
    return;
  }
  seen.add(block);

  const textResult = replaceTemplateString(block.text, values, labels, block.schema.kind === 'text' || block.schema.component === 'text', urlVariables);
  block.text = textResult.text;

  replaceTemplateStringsInSchema(block.schema as unknown as Record<string, unknown>, values, seen);
  if (textResult.fillIn) {
    block.schema.fillIn = true;
    block.schema.placeholder = '';
  }
  block.schema.containerBlocks?.forEach((child) => replaceTemplateStringsInBlock(child, values, labels, seen, urlVariables));
  block.schema.componentListBlocks?.forEach((child) => replaceTemplateStringsInBlock(child, values, labels, seen, urlVariables));
  block.schema.gridItems?.forEach((item) => replaceTemplateStringsInBlock(item.block, values, labels, seen, urlVariables));
  block.schema.expandableStubBlocks?.children.forEach((child) => replaceTemplateStringsInBlock(child, values, labels, seen, urlVariables));
  block.schema.expandableContentBlocks?.children.forEach((child) => replaceTemplateStringsInBlock(child, values, labels, seen, urlVariables));
}

function replaceTemplateStringsInSchema(schema: Record<string, unknown>, values: Record<string, string>, seen: WeakSet<object>): void {
  Object.entries(schema).forEach(([key, item]) => {
    if (key === 'containerBlocks' || key === 'componentListBlocks') {
      return;
    }
    if (key === 'gridItems') {
      replaceTemplateStringsInGridItems(item, values, seen);
      return;
    }
    if (key === 'expandableStubBlocks' || key === 'expandableContentBlocks') {
      replaceTemplateStringsInPane(item, values, seen);
      return;
    }
    schema[key] = replaceTemplateStrings(item, values, seen);
  });
}

function replaceTemplateStringsInGridItems(value: unknown, values: Record<string, string>, seen: WeakSet<object>): void {
  if (!Array.isArray(value)) {
    return;
  }
  value.forEach((item) => {
    if (!item || typeof item !== 'object' || seen.has(item)) {
      return;
    }
    seen.add(item);
    Object.entries(item as Record<string, unknown>).forEach(([key, nested]) => {
      if (key === 'block') {
        return;
      }
      (item as Record<string, unknown>)[key] = replaceTemplateStrings(nested, values, seen);
    });
  });
}

function replaceTemplateStringsInPane(value: unknown, values: Record<string, string>, seen: WeakSet<object>): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || seen.has(value)) {
    return;
  }
  seen.add(value);
  Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
    if (key === 'children') {
      return;
    }
    (value as Record<string, unknown>)[key] = replaceTemplateStrings(item, values, seen);
  });
}

function replaceTemplateString(
  text: string,
  values: Record<string, string>,
  labels: Record<string, string>,
  blankAsFillIn: boolean,
  urlVariables: Set<string>
): { text: string; fillIn: boolean } {
  let fillIn = false;
  const replaced = text.replace(TEMPLATE_TOKEN_PATTERN, (_token, name: string, rawFilter: ReusableTemplateFilter | undefined, offset: number) => {
    const value = values[name] ?? '';
    if (rawFilter === 'isempty') {
      return value.trim().length === 0 ? 'yes' : 'no';
    }
    if (urlVariables.has(name)) return blankAsFillIn ? serializeMarkdownLinkDestination(value) : value;
    if (blankAsFillIn && value.length === 0) {
      fillIn = true;
      return createTextFillInMarker(Object.prototype.hasOwnProperty.call(labels, name) ? labels[name] || humanizeTemplateVariableName(name) : humanizeTemplateVariableName(name));
    }
    return blankAsFillIn ? inheritTemplateParagraphStyle(text, offset, value) : value;
  });
  return { text: replaced, fillIn };
}

function replaceTemplateStrings(value: unknown, values: Record<string, string>, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') {
    return value.replace(TEMPLATE_TOKEN_PATTERN, (_token, name: string, rawFilter: ReusableTemplateFilter | undefined) => {
      const templateValue = values[name] ?? '';
      if (rawFilter === 'isempty') {
        return templateValue.trim().length === 0 ? 'yes' : 'no';
      }
      return templateValue;
    });
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  if (seen.has(value)) {
    return value;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      value[index] = replaceTemplateStrings(item, values, seen);
    });
    return value;
  }
  Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
    (value as Record<string, unknown>)[key] = replaceTemplateStrings(item, values, seen);
  });
  return value;
}

function normalizeTemplatePlaceholderTextBlocks(block: VisualBlock): void {
  const placeholder = typeof block.schema.placeholder === 'string' ? block.schema.placeholder.trim() : '';
  if (placeholder && !hasVisibleMarkdownText(block.text)) {
    block.text = '';
  }
  block.schema.containerBlocks?.forEach(normalizeTemplatePlaceholderTextBlocks);
  block.schema.componentListBlocks?.forEach(normalizeTemplatePlaceholderTextBlocks);
  block.schema.gridItems?.forEach((item) => normalizeTemplatePlaceholderTextBlocks(item.block));
  block.schema.expandableStubBlocks?.children.forEach(normalizeTemplatePlaceholderTextBlocks);
  block.schema.expandableContentBlocks?.children.forEach(normalizeTemplatePlaceholderTextBlocks);
}

function normalizeSectionTemplatePlaceholderTextBlocks(section: VisualSection): void {
  section.blocks.forEach(normalizeTemplatePlaceholderTextBlocks);
}

function hasVisibleMarkdownText(text: string): boolean {
  return text
    .split(/\r?\n/)
    .some((line) => stripMarkdownScaffold(line).trim().length > 0);
}

function stripMarkdownScaffold(line: string): string {
  return line
    .replace(/^\s{0,3}#{1,6}\s*/, '')
    .replace(/^\s{0,3}>\s?/, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/^\s*[-*_]{3,}\s*$/, '')
    .replace(/[\\`*_~#[\]()!>-]/g, '');
}
