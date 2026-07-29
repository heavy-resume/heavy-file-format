import type { JsonObject } from './hvy/types';
import { sanitizeInlineCss } from './css-sanitizer';

export const DEFAULT_SURFACE_BREAKPOINTS: Readonly<Record<string, string>> = Object.freeze({
  sm: '40rem',
  md: '48rem',
  lg: '64rem',
  xl: '80rem',
  '2xl': '96rem',
});

const CSS_LENGTH = /^(?:\d+|\d*\.\d+)(?:px|rem|em|ch|vw|vh|vmin|vmax|cqw|cqi|%)$/;
const CSS_PROPERTY = /^(?:--[a-z0-9_-]+|[a-z-][a-z0-9-]*)$/i;

export interface SurfaceResponsiveCss {
  inlineCss: string;
  responsiveRules: string;
}

export function getSurfaceResponsiveClass(...keys: string[]): string {
  let hash = 2166136261;
  const value = keys.join(':');
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `surface-responsive-${(hash >>> 0).toString(36)}`;
}

export function getSurfaceBreakpoints(documentMeta: JsonObject | null | undefined): Record<string, string> {
  const configured = documentMeta?.responsive_breakpoints;
  const breakpoints = { ...DEFAULT_SURFACE_BREAKPOINTS };
  if (!configured || typeof configured !== 'object' || Array.isArray(configured)) {
    return breakpoints;
  }
  for (const [name, value] of Object.entries(configured)) {
    if (/^[a-z][a-z0-9-]*$/i.test(name) && typeof value === 'string' && CSS_LENGTH.test(value.trim())) {
      breakpoints[name] = value.trim();
    }
  }
  return breakpoints;
}

export function compileSurfaceResponsiveCss(
  input: string | null | undefined,
  selector: string,
  documentMeta: JsonObject | null | undefined
): SurfaceResponsiveCss {
  const breakpoints = getSurfaceBreakpoints(documentMeta);
  const inlineDeclarations: string[] = [];
  const responsiveDeclarations = new Map<string, string[]>();

  for (const rawDeclaration of (input ?? '').split(';')) {
    const declaration = rawDeclaration.trim();
    if (!declaration) {
      continue;
    }
    const parsed = parseResponsiveDeclaration(declaration, breakpoints);
    if (!parsed) {
      inlineDeclarations.push(declaration);
      continue;
    }
    const safeDeclaration = sanitizeInlineCss(`${parsed.property}:${parsed.value};`).trim();
    if (!safeDeclaration.replace(/;/g, '').trim()) {
      continue;
    }
    const declarations = responsiveDeclarations.get(parsed.query) ?? [];
    declarations.push(`${parsed.property}: ${parsed.value};`);
    responsiveDeclarations.set(parsed.query, declarations);
  }

  const inlineCss = sanitizeInlineCss(inlineDeclarations.join(';'));
  const responsiveRules = [...responsiveDeclarations.entries()]
    .map(([query, declarations]) =>
      `@container hvy-surface (${query}) { ${selector} { ${declarations.join(' ')} } }`
    )
    .join('\n');
  return { inlineCss, responsiveRules };
}

function parseResponsiveDeclaration(
  declaration: string,
  breakpoints: Record<string, string>
): { query: string; property: string; value: string } | null {
  const parts = declaration.split(':');
  if (parts.length < 3) {
    return null;
  }
  const variant = parts[0]?.trim() ?? '';
  const property = parts[1]?.trim() ?? '';
  const value = parts.slice(2).join(':').trim();
  if (!CSS_PROPERTY.test(property) || !value) {
    return null;
  }
  if (variant.startsWith('max-')) {
    const width = breakpoints[variant.slice(4)];
    return width ? { query: `inline-size < ${width}`, property, value } : null;
  }
  const width = breakpoints[variant];
  return width ? { query: `inline-size >= ${width}`, property, value } : null;
}
