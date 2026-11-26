import type { JsonObject } from '../../../hvy/types';
import { compileSurfaceResponsiveCss, filterCssDeclarations, getSurfaceResponsiveClass } from '../../../surface-responsive-css';

const DEFAULT_CONTAINER_BORDER_DECLARATIONS: Array<[string, string]> = [
  ['border', '1px solid var(--hvy-border)'],
  ['border-radius', '8px'],
  ['padding', '0.75rem'],
];

export function hasContainerBorderCss(css: string): boolean {
  return /(?:^|[;{\n])\s*border\s*:/i.test(css) || /(?:^|[;{\n])\s*border-(?:top|right|bottom|left)\s*:/i.test(css);
}

export function addDefaultContainerBorderCss(css: string): string {
  const additions = DEFAULT_CONTAINER_BORDER_DECLARATIONS.filter(([property]) => !hasCssDeclaration(css, property));
  if (additions.length === 0) {
    return css;
  }
  const trimmed = css.trim();
  const prefix = trimmed.length > 0 ? `${trimmed.replace(/;?\s*$/, ';')}\n` : '';
  return `${prefix}${additions.map(([property, value]) => `${property}: ${value};`).join('\n')}`;
}

export function removeDefaultContainerBorderCss(css: string): string {
  return DEFAULT_CONTAINER_BORDER_DECLARATIONS.reduce(
    (current, [property, value]) => current.replace(new RegExp(`\\s*${escapeRegExp(property)}\\s*:\\s*${escapeRegExp(value)}\\s*;?`, 'gi'), ''),
    css
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Properties that arrange an element's children. The block shell's only child is
// the container's internal wrapper, so these have to land on the element holding
// the child blocks. `display` is the exception: it also decides how the shell sits
// in its parent, so it applies to both.
const CONTAINER_CHILD_LAYOUT_PROPERTIES = new Set([
  'flex-direction',
  'flex-wrap',
  'flex-flow',
  'justify-content',
  'justify-items',
  'align-items',
  'align-content',
  'place-items',
  'place-content',
  'gap',
  'row-gap',
  'column-gap',
  'grid',
  'grid-template',
  'grid-template-columns',
  'grid-template-rows',
  'grid-template-areas',
  'grid-auto-flow',
  'grid-auto-columns',
  'grid-auto-rows',
  'columns',
  'column-count',
  'column-width',
]);

export function getContainerShellCss(css: string, documentMeta: JsonObject | null | undefined): string {
  return filterCssDeclarations(css, documentMeta, (property) => !CONTAINER_CHILD_LAYOUT_PROPERTIES.has(property));
}

export function renderContainerBodyElement(options: {
  sectionKey: string;
  blockId: string;
  css: string;
  documentMeta: JsonObject | null | undefined;
  attrs: string;
  body: string;
  escapeAttr: (value: string) => string;
}): string {
  const childLayoutCss = filterCssDeclarations(
    options.css,
    options.documentMeta,
    (property) => property === 'display' || CONTAINER_CHILD_LAYOUT_PROPERTIES.has(property)
  );
  const responsiveClass = getSurfaceResponsiveClass(options.sectionKey, options.blockId, 'container-children');
  const compiled = compileSurfaceResponsiveCss(childLayoutCss, `.${responsiveClass}`, options.documentMeta);
  const rules = compiled.responsiveRules ? `<style>${compiled.responsiveRules}</style>` : '';
  const className = compiled.responsiveRules ? `reader-container-body ${responsiveClass}` : 'reader-container-body';
  const style = compiled.inlineCss.trim() ? ` style="${options.escapeAttr(compiled.inlineCss)}"` : '';
  return `${rules}<div class="${className}"${style}${options.attrs}>${options.body}</div>`;
}

function hasCssDeclaration(css: string, property: string): boolean {
  return new RegExp(`(?:^|[;{\\n])\\s*${escapeRegExp(property)}\\s*:`, 'i').test(css);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
