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

function hasCssDeclaration(css: string, property: string): boolean {
  return new RegExp(`(?:^|[;{\\n])\\s*${escapeRegExp(property)}\\s*:`, 'i').test(css);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
