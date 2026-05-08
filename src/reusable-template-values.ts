import type { VisualBlock } from './editor/types';
import type { ComponentDefinition } from './types';

export type ReusableTemplateVariableType = 'text' | 'block';

export interface ReusableTemplateVariable {
  name: string;
  type: ReusableTemplateVariableType;
}

const TEMPLATE_TOKEN_PATTERN = /{%\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:\|\s*(text|block)\s*)?%}/g;

export function extractReusableTemplateVariablesFromDefinition(definition: ComponentDefinition | null | undefined): ReusableTemplateVariable[] {
  const source = definition?.template ?? definition?.schema;
  if (!source) {
    return [];
  }
  return extractReusableTemplateVariables(source);
}

export function extractReusableTemplateVariables(value: unknown): ReusableTemplateVariable[] {
  const variables = new Map<string, ReusableTemplateVariableType>();
  visitTemplateStrings(value, (text) => {
    for (const match of text.matchAll(TEMPLATE_TOKEN_PATTERN)) {
      const name = match[1] ?? '';
      const type = normalizeTemplateVariableType(match[2]);
      const existing = variables.get(name);
      if (existing && existing !== type) {
        throw new Error(`Template variable "${name}" uses conflicting types: ${existing} and ${type}.`);
      }
      if (!existing) {
        variables.set(name, type);
      }
    }
  });
  return [...variables.entries()].map(([name, type]) => ({ name, type }));
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
  const textVariables = variables.filter((variable) => variable.type === 'text').map((variable) => variable.name);
  const multilineTextKey = textVariables.find((key) => /\r|\n/.test(values[key] ?? ''));
  if (multilineTextKey) {
    throw new Error(`Template value "${multilineTextKey}" is type text and cannot contain newlines. Use "{% ${multilineTextKey} | block %}" for multi-line values.`);
  }
}

export function applyReusableTemplateValues(block: VisualBlock, values: Record<string, string>): VisualBlock {
  replaceTemplateStrings(block, values);
  normalizeTemplatePlaceholderTextBlocks(block);
  return block;
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

function normalizeTemplateVariableType(raw: string | undefined): ReusableTemplateVariableType {
  return raw === 'block' ? 'block' : 'text';
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

function replaceTemplateStrings(value: unknown, values: Record<string, string>, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') {
    return value.replace(TEMPLATE_TOKEN_PATTERN, (_token, name: string) => values[name] ?? '');
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
  if (block.schema.placeholder.trim() && !hasVisibleMarkdownText(block.text)) {
    block.text = '';
  }
  block.schema.containerBlocks?.forEach(normalizeTemplatePlaceholderTextBlocks);
  block.schema.componentListBlocks?.forEach(normalizeTemplatePlaceholderTextBlocks);
  block.schema.gridItems?.forEach((item) => normalizeTemplatePlaceholderTextBlocks(item.block));
  block.schema.expandableStubBlocks?.children.forEach(normalizeTemplatePlaceholderTextBlocks);
  block.schema.expandableContentBlocks?.children.forEach(normalizeTemplatePlaceholderTextBlocks);
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
