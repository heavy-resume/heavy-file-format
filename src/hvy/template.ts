import type { JsonObject } from './types';

const PLACEHOLDER_RE = /(?<!\\)\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

export function collectPlaceholders(input: string): string[] {
  const seen = new Set<string>();
  for (const match of input.matchAll(PLACEHOLDER_RE)) {
    if (match[1]) {
      seen.add(match[1]);
    }
  }
  return [...seen];
}

export function applyTemplateValues(input: string, values: JsonObject): string {
  return input.replace(PLACEHOLDER_RE, (_all, path: string) => {
    const found = getByPath(values, path);
    if (found === undefined || found === null) {
      return '';
    }
    if (typeof found === 'object') {
      return JSON.stringify(found);
    }
    return String(found);
  }).replace(/\\\{\{/g, '{{');
}

function getByPath(obj: JsonObject, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function schemaDefaults(schema: JsonObject | undefined): JsonObject {
  const defaults: JsonObject = {};
  if (!schema || typeof schema !== 'object') {
    return defaults;
  }

  const properties = (schema.properties ?? {}) as JsonObject;
  for (const [key, value] of Object.entries(properties)) {
    if (value && typeof value === 'object') {
      const candidate = value as JsonObject;
      if ('default' in candidate) {
        defaults[key] = candidate.default;
      } else if (candidate.type === 'array') {
        defaults[key] = [];
      } else {
        defaults[key] = '';
      }
    }
  }
  return defaults;
}
