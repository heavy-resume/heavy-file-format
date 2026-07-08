export type HvyLinkKind = 'link' | 'xref-card';

export type XrefTargetClassification =
  | { kind: 'empty' }
  | { kind: 'local'; target: string; href: string }
  | { kind: 'workspace'; target: string; href: string }
  | { kind: 'invalid'; target: string };

export function classifyXrefTarget(target: unknown): XrefTargetClassification {
  const trimmed = readLinkTarget(target);
  if (!trimmed) {
    return { kind: 'empty' };
  }
  if (isUrlSchemeTarget(trimmed)) {
    return { kind: 'invalid', target: trimmed };
  }
  if (isWorkspacePathTarget(trimmed)) {
    return { kind: 'workspace', target: trimmed, href: trimmed };
  }
  if (trimmed.startsWith('#')) {
    const id = trimmed.slice(1).trim();
    return id ? { kind: 'local', target: id, href: `#${id}` } : { kind: 'empty' };
  }
  return { kind: 'local', target: trimmed, href: `#${trimmed}` };
}

export function normalizeLocalXrefTarget(target: unknown): string {
  const classified = classifyXrefTarget(target);
  return classified.kind === 'local' ? classified.target : '';
}

export function isWorkspacePathTarget(target: unknown): boolean {
  const trimmed = readLinkTarget(target);
  return trimmed.startsWith('./') || trimmed.startsWith('../') || trimmed.startsWith('/');
}

export function isUrlSchemeTarget(target: unknown): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(readLinkTarget(target));
}

export function applyWorkspaceLinkRendering(root: ParentNode, enabled: boolean): void {
  root.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
    const href = anchor.getAttribute('href')?.trim() ?? '';
    if (!isWorkspacePathTarget(href)) {
      return;
    }
    anchor.dataset.hvyLinkKind = anchor.dataset.hvyLinkKind || 'link';
    anchor.dataset.hvyCrossDocument = 'true';
    if (enabled) {
      return;
    }
    anchor.removeAttribute('href');
    anchor.removeAttribute('target');
    anchor.removeAttribute('rel');
    anchor.setAttribute('aria-disabled', 'true');
    anchor.classList.add('hvy-workspace-link-disabled');
  });
}

export function renderWorkspaceLinksInHtml(html: string, enabled: boolean): string {
  if (typeof document !== 'undefined') {
    const template = document.createElement('template');
    template.innerHTML = html;
    applyWorkspaceLinkRendering(template.content, enabled);
    return template.innerHTML;
  }
  return html.replace(/<a\b([^>]*?)\bhref="([^"]*)"([^>]*)>/g, (match, before, rawHref, after) => {
    const href = decodeHtmlAttribute(rawHref);
    if (!isWorkspacePathTarget(href)) {
      return match;
    }
    const attrs = `${before}${after}`.replace(/\s(?:target|rel|href|aria-disabled|data-hvy-link-kind|data-hvy-cross-document)="[^"]*"/g, '');
    const common = ` data-hvy-link-kind="link" data-hvy-cross-document="true"`;
    if (enabled) {
      return `<a${before}href="${rawHref}"${after}${match.includes('data-hvy-cross-document=') ? '' : common}>`;
    }
    return `<a${attrsWithoutClass(attrs)}${common} aria-disabled="true" class="${mergeClassAttribute(attrs, 'hvy-workspace-link-disabled')}">`;
  });
}

function readLinkTarget(target: unknown): string {
  return typeof target === 'string' ? target.trim() : '';
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function mergeClassAttribute(attrs: string, className: string): string {
  const match = attrs.match(/\bclass="([^"]*)"/);
  if (!match) {
    return className;
  }
  const current = match[1] ?? '';
  return `${current} ${className}`.trim();
}

function attrsWithoutClass(attrs: string): string {
  return attrs.replace(/\sclass="[^"]*"/, '');
}
