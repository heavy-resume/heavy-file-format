import { marked } from 'marked';
import DOMPurify from 'dompurify';
import TurndownService from 'turndown';
import { getTextLineStyleLabel, sanitizeTextLineStyleCss, type TextLineStyles } from './text-line-styles';

marked.setOptions({ gfm: true, breaks: false });

export const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '_',
});

turndown.addRule('task-list-checkbox', {
  filter: (node) => node.nodeName === 'INPUT' && (node as HTMLInputElement).getAttribute('type') === 'checkbox',
  replacement: (_content, node) => {
    const input = node as HTMLInputElement;
    return input.checked ? '[x] ' : '[ ] ';
  },
});

turndown.addRule('underline', {
  filter: (node) => node.nodeName === 'U',
  replacement: (content) => (content.trim().length > 0 ? `___${content}___` : ''),
});

turndown.addRule('inline-code-literal-text', {
  filter: (node) => node.nodeName === 'CODE' && node.parentNode?.nodeName !== 'PRE',
  replacement: (_content, node) => {
    const text = (node.textContent ?? '').replace(/`/g, '\\`');
    return text.length > 0 ? `\`${text}\`` : '';
  },
});

turndown.addRule('hvy-alt-annotation', {
  filter: (node) => node.nodeType === 1 && (node as Element).getAttribute('data-hvy-alt') === 'true',
  replacement: (_content, node) => {
    const element = node as HTMLElement;
    const full = (element.querySelector<HTMLElement>('.hvy-alt-full')?.textContent ?? '').trim();
    const compact = (element.querySelector<HTMLElement>('.hvy-alt-compact')?.textContent ?? '').trim();
    if (full.length === 0) {
      return '';
    }
    if (compact.trim().length === 0) {
      return full;
    }
    return `<!--hvy:alt ${JSON.stringify({ compact })}-->${full}<!--/hvy:alt-->`;
  },
});

turndown.addRule('hvy-nowrap-annotation', {
  filter: (node) => node.nodeType === 1 && (node as Element).getAttribute('data-hvy-nowrap') === 'true',
  replacement: (content, node) => {
    const text = (node.textContent ?? content).trim();
    return text.length > 0 ? `<!--hvy:nowrap-->${text}<!--/hvy:nowrap-->` : '';
  },
});

turndown.addRule('hvy-text-line-style-marker', {
  filter: (node) => node.nodeType === 1 && (node as Element).classList.contains('hvy-text-line-style-marker'),
  replacement: () => '',
});

turndown.addRule('hvy-text-line-style', {
  filter: (node) => node.nodeType === 1 && (node as Element).getAttribute('data-hvy-text-line-style') !== null,
  replacement: (content, node) => {
    const name = (node as Element).getAttribute('data-hvy-text-line-style') ?? '';
    const trimmed = content.replace(/\n{3,}/g, '\n\n').trim();
    return name && trimmed ? `\n\n^${name}^ ${trimmed}\n\n` : `\n\n${trimmed}\n\n`;
  },
});

export interface MarkdownRenderOptions {
  textLineStyles?: TextLineStyles;
  textLineStyleMode?: 'viewer' | 'editor';
}

export function markdownToEditorHtml(markdown: string, options: MarkdownRenderOptions = {}): string {
  const normalized = normalizeMarkdownIndentation(markdown || '');
  const annotations = extractResponsiveAnnotations(normalized, { editable: true });
  const html = renderMarkdownHtml(annotations.markdown, {
    textLineStyles: options.textLineStyles ?? {},
    textLineStyleMode: options.textLineStyleMode ?? 'editor',
  });
  const template = document.createElement('template');
  template.innerHTML = addExternalLinkTargets(restoreResponsiveAnnotationTokens(html, annotations.tokens));
  template.content.querySelectorAll<HTMLElement>('pre > code').forEach((code) => {
    const languageClass = Array.from(code.classList).find((className) => className.startsWith('language-'));
    const language = languageClass ? languageClass.slice('language-'.length) : code.dataset.language || 'text';
    code.parentElement?.setAttribute('data-code-language', language || 'text');
    code.parentElement?.setAttribute('contenteditable', 'false');
    code.setAttribute('contenteditable', 'true');
  });
  renderInlineCheckboxes(template.content);
  preserveTrailingEditableSpaces(template.content);
  template.content.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.removeAttribute('disabled');
    checkbox.setAttribute('contenteditable', 'false');
  });
  return template.innerHTML;
}

export function markdownToMobileAdjustmentEditorHtml(markdown: string): string {
  return markdownToEditorHtml(markdown);
}

export function markdownToReaderHtml(markdown: string, options: MarkdownRenderOptions = {}): string {
  const annotations = extractResponsiveAnnotations(markdown || '', { editable: false });
  const html = renderMarkdownHtml(annotations.markdown, {
    textLineStyles: options.textLineStyles ?? {},
    textLineStyleMode: options.textLineStyleMode ?? 'viewer',
  });
  return restoreResponsiveAnnotationTokens(html, annotations.tokens);
}

function renderMarkdownHtml(markdown: string, options: Required<MarkdownRenderOptions>): string {
  const segments = splitTextLineStyleSegments(markdown);
  if (segments.length === 1 && segments[0]?.kind === 'markdown') {
    return sanitizeHtml(marked.parse(applyUnderlineSyntax(escapeRawHtml(markdown))) as string);
  }
  return segments
    .map((segment) => {
      if (segment.kind === 'markdown') {
        return sanitizeHtml(marked.parse(applyUnderlineSyntax(escapeRawHtml(segment.markdown))) as string);
      }
      const lineHtml = sanitizeHtml(marked.parse(applyUnderlineSyntax(escapeRawHtml(segment.markdown))) as string);
      const style = options.textLineStyles[segment.name];
      if (!style && options.textLineStyleMode !== 'editor') {
        return lineHtml;
      }
      const marker = options.textLineStyleMode === 'editor'
        ? `<span class="hvy-text-line-style-marker" contenteditable="false">^${escapeHtml(segment.name)}^</span>`
        : '';
      const unknown = !style ? ' is-unknown' : '';
      const label = getTextLineStyleLabel(segment.name, style);
      const css = style ? sanitizeTextLineStyleCss(style.css) : '';
      return `<div class="hvy-text-line-style${unknown}" data-hvy-text-line-style="${escapeHtml(segment.name)}" data-hvy-text-line-style-label="${escapeHtml(label)}" style="${escapeHtml(css)}">${marker}${lineHtml}</div>`;
    })
    .join('');
}

type TextLineStyleSegment =
  | { kind: 'markdown'; markdown: string }
  | { kind: 'styled-line'; name: string; markdown: string };

function splitTextLineStyleSegments(markdown: string): TextLineStyleSegment[] {
  const lines = markdown.split(/\r?\n/);
  const segments: TextLineStyleSegment[] = [];
  const pending: string[] = [];
  let fence: { marker: '`' | '~'; length: number } | null = null;

  const flushPending = (): void => {
    if (pending.length === 0) {
      return;
    }
    segments.push({ kind: 'markdown', markdown: pending.join('\n') });
    pending.length = 0;
  };

  for (const line of lines) {
    const fenceLine = parseTextLineStyleFence(line);
    if (fence) {
      pending.push(line);
      if (fenceLine && fenceLine.marker === fence.marker && fenceLine.length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fenceLine) {
      fence = fenceLine;
      pending.push(line);
      continue;
    }

    const escaped = line.match(/^(\\\^)([a-z0-9_-]+)\^\s?(.*)$/i);
    if (escaped) {
      pending.push(`^${escaped[2]}^${escaped[3] ? ` ${escaped[3]}` : ''}`);
      continue;
    }

    const match = line.match(/^\^([a-z0-9_-]+)\^\s?(.*)$/i);
    if (!match) {
      pending.push(line);
      continue;
    }
    flushPending();
    const name = match[1] ?? '';
    const markdownLine = match[2] ?? '';
    segments.push({ kind: 'styled-line', name, markdown: markdownLine });
  }

  flushPending();
  return segments;
}

function parseTextLineStyleFence(line: string): { marker: '`' | '~'; length: number } | null {
  const match = line.trim().match(/^([`~]{3,})(?:[\w-]+)?\s*$/);
  if (!match) {
    return null;
  }
  const fence = match[1] ?? '';
  const marker = fence[0] as '`' | '~' | undefined;
  return marker ? { marker, length: fence.length } : null;
}

function sanitizeHtml(html: string): string {
  return typeof DOMPurify.sanitize === 'function' ? DOMPurify.sanitize(html) : html;
}

interface ResponsiveAnnotationToken {
  token: string;
  html: string;
}

function extractResponsiveAnnotations(markdown: string, options: { editable: boolean }): { markdown: string; tokens: ResponsiveAnnotationToken[] } {
  const tokens: ResponsiveAnnotationToken[] = [];
  const makeToken = (html: string): string => {
    const token = `HVY_RESPONSIVE_ANNOTATION_${tokens.length}_TOKEN`;
    tokens.push({ token, html });
    return token;
  };
  const withAlt = markdown.replace(/<!--hvy:alt\s+(\{.*?\})-->([\s\S]*?)<!--\/hvy:alt-->/g, (_match, rawJson, fullText) => {
    const parsed = parseAltAnnotationPayload(rawJson);
    if (!parsed) {
      return fullText;
    }
    return makeToken(renderAltAnnotationHtml(fullText, parsed.compact, options.editable));
  });
  const withNowrap = withAlt.replace(/<!--hvy:nowrap-->([\s\S]*?)<!--\/hvy:nowrap-->/g, (_match, text) =>
    makeToken(renderNowrapAnnotationHtml(text))
  );
  return { markdown: withNowrap, tokens };
}

export function renderAltAnnotationsAsFullText(markdown: string): string {
  return replaceAltAnnotations(markdown, (_rawJson, fullText) => fullText);
}

export function renderAltAnnotationsAsMobileText(markdown: string): string {
  return replaceAltAnnotations(markdown, (rawJson, fullText) => parseAltAnnotationPayload(rawJson)?.compact ?? fullText);
}

export function applyMobileAltAdjustment(fullMarkdown: string, mobileMarkdown: string): string {
  const full = renderAltAnnotationsAsFullText(fullMarkdown).trim();
  const mobile = mobileMarkdown.trim();
  if (hasAltAnnotation(mobile)) {
    return removeRedundantAltAnnotations(mobile);
  }
  if (full.length === 0 || mobile.length === 0 || mobile === full) {
    return full;
  }
  const fullHeading = parseSimpleAtxHeading(full);
  if (fullHeading) {
    const mobileHeading = parseSimpleAtxHeading(mobile);
    const mobileText = mobileHeading?.text ?? mobile;
    if (mobileText.length === 0 || mobileText === fullHeading.text) {
      return full;
    }
    return `${fullHeading.prefix}${formatAltAdjustment(fullHeading.text, mobileText)}`;
  }
  return formatAltAdjustment(full, mobile);
}

function hasAltAnnotation(markdown: string): boolean {
  return /<!--hvy:alt\s+\{.*?\}-->[\s\S]*?<!--\/hvy:alt-->/.test(markdown);
}

function removeRedundantAltAnnotations(markdown: string): string {
  return markdown.replace(/<!--hvy:alt\s+(\{.*?\})-->([\s\S]*?)<!--\/hvy:alt-->/g, (match, rawJson, fullText) => {
    const compactText = parseAltAnnotationPayload(rawJson)?.compact.trim() ?? '';
    const normalizedFull = fullText.trim();
    return compactText.length === 0 || compactText === normalizedFull ? fullText : match;
  });
}

function formatAltAnnotation(fullText: string, compactText: string): string {
  return `<!--hvy:alt ${JSON.stringify({ compact: compactText })}-->${fullText}<!--/hvy:alt-->`;
}

function formatAltAdjustment(fullText: string, compactText: string): string {
  const diff = getWordExpandedDiff(fullText, compactText);
  if (!diff) {
    return fullText;
  }
  return `${diff.prefix}${formatAltAnnotation(diff.full, diff.compact)}${diff.suffix}`;
}

function getWordExpandedDiff(fullText: string, compactText: string): { prefix: string; full: string; compact: string; suffix: string } | null {
  if (fullText === compactText) {
    return null;
  }
  let start = 0;
  while (start < fullText.length && start < compactText.length && fullText[start] === compactText[start]) {
    start += 1;
  }

  let fullEnd = fullText.length;
  let compactEnd = compactText.length;
  while (fullEnd > start && compactEnd > start && fullText[fullEnd - 1] === compactText[compactEnd - 1]) {
    fullEnd -= 1;
    compactEnd -= 1;
  }

  while (start > 0 && !isAltDiffBoundary(fullText[start - 1])) {
    start -= 1;
  }
  while (fullEnd < fullText.length && !isAltDiffBoundary(fullText[fullEnd])) {
    fullEnd += 1;
  }
  while (compactEnd < compactText.length && !isAltDiffBoundary(compactText[compactEnd])) {
    compactEnd += 1;
  }

  const prefix = fullText.slice(0, start);
  const suffix = fullText.slice(fullEnd);
  const full = fullText.slice(start, fullEnd).trim();
  const compact = compactText.slice(start, compactEnd).trim();
  if (full.length === 0 || compact.length === 0 || full === compact) {
    return null;
  }
  return { prefix, full, compact, suffix };
}

function isAltDiffBoundary(char: string | undefined): boolean {
  return !char || /\s/.test(char) || /[()[\]{}<>.,;:!?/\\|"'`~+=*&^%$#@-]/.test(char);
}

function parseSimpleAtxHeading(markdown: string): { prefix: string; text: string } | null {
  const match = markdown.match(/^(#{1,6})([ \t]+)(.*?)(?:[ \t]+#+[ \t]*)?$/);
  if (!match) {
    return null;
  }
  const text = match[3]?.trim() ?? '';
  return text.length > 0 ? { prefix: `${match[1]}${match[2]}`, text } : null;
}

function replaceAltAnnotations(markdown: string, replacement: (rawJson: string, fullText: string) => string): string {
  return (markdown || '').replace(/<!--hvy:alt\s+(\{.*?\})-->([\s\S]*?)<!--\/hvy:alt-->/g, (_match, rawJson, fullText) =>
    replacement(rawJson, fullText)
  );
}

function restoreResponsiveAnnotationTokens(html: string, tokens: ResponsiveAnnotationToken[]): string {
  return tokens.reduce((result, token) => result.replaceAll(token.token, token.html), html);
}

function parseAltAnnotationPayload(rawJson: string): { compact: string } | null {
  try {
    const parsed = JSON.parse(rawJson) as { compact?: unknown };
    return typeof parsed.compact === 'string' ? { compact: parsed.compact } : null;
  } catch {
    return null;
  }
}

function renderAltAnnotationHtml(fullText: string, compactText: string, editable: boolean): string {
  const editableAttrs = editable ? ' contenteditable="true" spellcheck="false"' : '';
  return `<span class="hvy-alt" data-hvy-alt="true"><span class="hvy-alt-full">${escapeHtml(fullText)}</span><span class="hvy-alt-compact"${editableAttrs}>${escapeHtml(compactText)}</span></span>`;
}

function renderNowrapAnnotationHtml(text: string): string {
  return `<span class="hvy-nowrap" data-hvy-nowrap="true">${escapeHtml(text)}</span>`;
}

export function normalizeEditorMarkdownWhitespace(markdown: string): string {
  return markdown.replace(/\u00a0/g, ' ').replace(/\u200b/g, '');
}

export function normalizeMarkdownIndentation(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => (line.match(/^ */) ?? [''])[0].length);
  const minIndent = indents.length > 0 ? Math.min(...indents) : 0;

  if (minIndent === 0) {
    return markdown;
  }

  const prefix = ' '.repeat(minIndent);
  return lines.map((line) => (line.startsWith(prefix) ? line.slice(minIndent) : line)).join('\n');
}

export function addExternalLinkTargets(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  template.content.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
    const href = anchor.getAttribute('href') ?? '';
    if (/^https?:\/\//i.test(href)) {
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
    }
  });
  return template.innerHTML;
}

export function escapeRawHtml(markdown: string): string {
  return markdown.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function applyUnderlineSyntax(markdown: string): string {
  return markdown.replace(/___([^_\n](?:[^_\n]|_(?!__))*?)___/g, '<u>$1</u>');
}

export function normalizeMarkdownLists(markdown: string): string {
  const lines = markdown.split(/\r?\n/).map((line) => line.replace(/^(\s*)\\-/, '$1-'));
  const out: string[] = [];
  let inList = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const bullet = line.match(/^(\s*)[-*+]\s+(.+)$/);
    const ordered = line.match(/^(\s*)(\d+)[.)]\s+(.+)$/);
    if (bullet) {
      if (!inList && out.length > 0 && out[out.length - 1].trim().length > 0) {
        out.push('');
      }
      out.push(`${bullet[1]}- ${bullet[2].trim()}`);
      inList = true;
      continue;
    }
    if (ordered) {
      if (!inList && out.length > 0 && out[out.length - 1].trim().length > 0) {
        out.push('');
      }
      out.push(`${ordered[1]}${ordered[2]}. ${ordered[3].trim()}`);
      inList = true;
      continue;
    }

    if (line.trim().length === 0) {
      const next = lines[i + 1] ?? '';
      if (inList && (/^(\s*)[-*+]\s+(.+)$/.test(next) || /^(\s*)\d+[.)]\s+(.+)$/.test(next))) {
        continue;
      }
      inList = false;
      out.push('');
      continue;
    }

    inList = false;
    out.push(line);
  }

  return normalizeEscapedCheckboxMarkers(out.join('\n').replace(/\n{3,}/g, '\n\n'));
}

function normalizeEscapedCheckboxMarkers(markdown: string): string {
  return markdown.replace(/\\\[( |x|X)\\\]/g, (_match, state) => `[${state.toLowerCase() === 'x' ? 'x' : ' '}]`);
}

function renderInlineCheckboxes(root: ParentNode): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      if (!parent) {
        return NodeFilter.FILTER_REJECT;
      }
      if (parent.closest('code, pre, script, style, textarea')) {
        return NodeFilter.FILTER_REJECT;
      }
      return /\[( |x|X)\]/.test(node.textContent ?? '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  const textNodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    if (current instanceof Text) {
      textNodes.push(current);
    }
    current = walker.nextNode();
  }

  textNodes.forEach((textNode) => {
    const text = textNode.textContent ?? '';
    const regex = /\[( |x|X)\]/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null = regex.exec(text);
    if (!match) {
      return;
    }

    const fragment = document.createDocumentFragment();
    do {
      if (match.index > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      const isChecked = (match[1] ?? ' ').toLowerCase() === 'x';
      checkbox.checked = isChecked;
      if (isChecked) {
        checkbox.setAttribute('checked', '');
      }
      checkbox.setAttribute('contenteditable', 'false');
      fragment.appendChild(checkbox);
      lastIndex = regex.lastIndex;
      match = regex.exec(text);
    } while (match);

    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
    textNode.replaceWith(fragment);
  });
}

function preserveTrailingEditableSpaces(root: ParentNode): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      if (!parent || parent.closest('code, pre, script, style, textarea')) {
        return NodeFilter.FILTER_REJECT;
      }
      return / $/.test(node.textContent ?? '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  const textNodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    if (current instanceof Text) {
      textNodes.push(current);
    }
    current = walker.nextNode();
  }

  textNodes.forEach((textNode) => {
    if (hasFollowingInlineContent(textNode)) {
      return;
    }
    textNode.textContent = (textNode.textContent ?? '').replace(/ +$/, (spaces) => '\u00a0'.repeat(spaces.length));
  });
}

function hasFollowingInlineContent(textNode: Text): boolean {
  let next = textNode.nextSibling;
  while (next) {
    if (next instanceof Text) {
      if ((next.textContent ?? '').trim().length > 0) {
        return true;
      }
      next = next.nextSibling;
      continue;
    }
    if (next instanceof HTMLBRElement) {
      return false;
    }
    return true;
  }
  return false;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
