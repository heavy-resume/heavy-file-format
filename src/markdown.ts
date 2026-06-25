import { marked } from 'marked';
import DOMPurify from 'dompurify';
import TurndownService from 'turndown';
import { getTextLineStyleLabel, sanitizeTextLineStyleCss, type TextLineStyles } from './text-line-styles';
import { createTextFillInMarker } from './text-fill-in';

marked.setOptions({ gfm: true, breaks: false });
marked.use({
  renderer: {
    image: () => '',
  },
});

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

turndown.addRule('hvy-link', {
  filter: (node) => node.nodeName === 'A',
  replacement: (content, node) => {
    const href = (node as HTMLAnchorElement).getAttribute('href')?.trim() ?? '';
    return href.length > 0 ? `[${content}](${href})` : content;
  },
});

turndown.addRule('non-text-media', {
  filter: (node) => isNonTextMediaElement(node),
  replacement: () => '',
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
    if (!name) {
      return `\n\n${trimmed}\n\n`;
    }
    return trimmed ? `\n\n^${name}^ ${trimmed}\n\n` : `\n\n^${name}^\n\n`;
  },
});

turndown.addRule('hvy-text-fill-in-marker', {
  filter: (node) => node.nodeType === 1 && (node as Element).getAttribute('data-hvy-fill-in-marker') === 'true',
  replacement: (_content, node) => createTextFillInMarker((node as Element).getAttribute('data-placeholder') ?? ''),
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
  markInlineCheckboxLines(template.content);
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
  return wrapInlineCheckboxLines(restoreResponsiveAnnotationTokens(html, annotations.tokens));
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
      if (pending.length === 0 && canContinuePreviousTextLineStyleSegment(segments, line)) {
        const previous = segments[segments.length - 1] as Extract<TextLineStyleSegment, { kind: 'styled-line' }>;
        previous.markdown = `${previous.markdown}\n${line.trim()}`;
        continue;
      }
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

function canContinuePreviousTextLineStyleSegment(segments: TextLineStyleSegment[], line: string): boolean {
  const previous = segments[segments.length - 1];
  if (!previous || previous.kind !== 'styled-line') {
    return false;
  }
  return isPlainTextLineStyleContinuation(line) && isPlainTextLineStyleContinuation(previous.markdown);
}

function isPlainTextLineStyleContinuation(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return false;
  }
  return !(
    parseTextLineStyleFence(trimmed) ||
    /^(\\?\^[a-z0-9_-]+\^)/i.test(trimmed) ||
    /^#{1,6}\s+/.test(trimmed) ||
    /^(?:[-*+]|\d+[.)])\s+/.test(trimmed) ||
    /^>/.test(trimmed) ||
    /^\|/.test(trimmed) ||
    /^[-*_](?:\s*[-*_]){2,}\s*$/.test(trimmed) ||
    /^<!--/.test(trimmed) ||
    /^ {4,}\S/.test(line)
  );
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

export function removeNonTextContentFromRichEditor(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('img, picture, video, audio, source, iframe, object, embed, canvas, svg').forEach((element) => {
    element.remove();
  });
}

function isNonTextMediaElement(node: HTMLElement): boolean {
  return ['IMG', 'PICTURE', 'VIDEO', 'AUDIO', 'SOURCE', 'IFRAME', 'OBJECT', 'EMBED', 'CANVAS', 'SVG'].includes(node.nodeName);
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
  return { markdown: options.editable ? withNowrap : replaceInlineCheckboxMarkers(withNowrap, makeToken), tokens };
}

function replaceInlineCheckboxMarkers(markdown: string, makeToken: (html: string) => string): string {
  const lines = markdown.split(/(\r?\n)/);
  let fence: { marker: '`' | '~'; length: number } | null = null;
  return lines
    .map((line) => {
      if (/^\r?\n$/.test(line)) {
        return line;
      }
      const fenceLine = parseTextLineStyleFence(line);
      if (fence) {
        if (fenceLine && fenceLine.marker === fence.marker && fenceLine.length >= fence.length) {
          fence = null;
        }
        return line;
      }
      if (fenceLine) {
        fence = fenceLine;
        return line;
      }
      return replaceInlineCheckboxMarkersInLine(line, makeToken);
    })
    .join('');
}

function replaceInlineCheckboxMarkersInLine(line: string, makeToken: (html: string) => string): string {
  const taskListPrefix = line.match(/^(\s*(?:[-+*]|\d+[.)])\s+)\[(?: |x|X)\](?=\s|$)/)?.[1]?.length ?? -1;
  let result = '';
  let index = 0;
  let inlineCodeMarker: string | null = null;

  while (index < line.length) {
    const codeMatch = line.slice(index).match(/^`+/);
    if (codeMatch?.[0]) {
      const marker = codeMatch[0];
      if (inlineCodeMarker === marker) {
        inlineCodeMarker = null;
      } else if (!inlineCodeMarker) {
        inlineCodeMarker = marker;
      }
      result += marker;
      index += marker.length;
      continue;
    }

    const checkboxMatch = line.slice(index).match(/^\[( |x|X)\]/);
    if (checkboxMatch?.[0] && !inlineCodeMarker && index !== taskListPrefix) {
      result += makeToken(renderInlineCheckboxHtml((checkboxMatch[1] ?? ' ').toLowerCase() === 'x'));
      index += checkboxMatch[0].length;
      continue;
    }

    result += line[index] ?? '';
    index += 1;
  }

  return result;
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

function renderInlineCheckboxHtml(checked: boolean): string {
  return `<input class="hvy-inline-checkbox" type="checkbox"${checked ? ' checked' : ''} contenteditable="false" disabled>`;
}

function wrapInlineCheckboxLines(html: string): string {
  return html.replace(/<p>((?=[\s\S]*?\bhvy-inline-checkbox\b)[\s\S]*?)<\/p>/g, '<div class="hvy-inline-checkbox-line">$1</div>');
}

function markInlineCheckboxLines(root: ParentNode): void {
  root.querySelectorAll<HTMLInputElement>('input.hvy-inline-checkbox').forEach((checkbox) => {
    const parent = checkbox.parentElement;
    if (!parent || !isLeadingInlineCheckbox(checkbox)) {
      return;
    }
    parent.classList.add('hvy-inline-checkbox-line');
  });
}

function isLeadingInlineCheckbox(checkbox: HTMLInputElement): boolean {
  let previous = checkbox.previousSibling;
  while (previous) {
    if (previous.nodeType === Node.TEXT_NODE && (previous.textContent ?? '').trim().length === 0) {
      previous = previous.previousSibling;
      continue;
    }
    return false;
  }
  return true;
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
  let output = '';
  let index = 0;
  let fence: { marker: string; length: number } | null = null;
  while (index < markdown.length) {
    const lineEnd = markdown.indexOf('\n', index);
    const nextLineIndex = lineEnd === -1 ? markdown.length : lineEnd + 1;
    const line = markdown.slice(index, nextLineIndex);
    const fenceMatch = line.match(/^( {0,3})(`{3,}|~{3,})/);
    if (fence) {
      output += line;
      if (fenceMatch && fenceMatch[2]?.startsWith(fence.marker) && fenceMatch[2].length >= fence.length) {
        fence = null;
      }
      index = nextLineIndex;
      continue;
    }
    if (fenceMatch) {
      const marker = fenceMatch[2]![0]!;
      fence = { marker, length: fenceMatch[2]!.length };
      output += line;
      index = nextLineIndex;
      continue;
    }
    const quotePrefix = line.match(/^( {0,3}(?:>[ \t]?)+)/)?.[0] ?? '';
    output += quotePrefix + escapeRawHtmlOutsideInlineCode(line.slice(quotePrefix.length));
    index = nextLineIndex;
  }
  return output;
}

function escapeRawHtmlOutsideInlineCode(markdown: string): string {
  let output = '';
  let index = 0;
  while (index < markdown.length) {
    const char = markdown[index];
    if (char === '`') {
      const tickMatch = markdown.slice(index).match(/^`+/);
      const ticks = tickMatch?.[0] ?? '`';
      const close = markdown.indexOf(ticks, index + ticks.length);
      if (close !== -1) {
        output += markdown.slice(index, close + ticks.length);
        index = close + ticks.length;
        continue;
      }
    }
    if (char === '<') {
      output += '&lt;';
    } else if (char === '>') {
      output += '&gt;';
    } else {
      output += char;
    }
    index += 1;
  }
  return output;
}

export function applyUnderlineSyntax(markdown: string): string {
  return markdown.replace(/___([^_\n](?:[^_\n]|_(?!__))*?)___/g, '<u>$1</u>');
}

export function normalizeMarkdownLists(markdown: string): string {
  const lines = markdown.split(/\r?\n/).map((line) => line.replace(/^(\s*)\\-/, '$1-'));
  const out: string[] = [];
  let inList = false;
  let listContinuationIndent: string | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const bullet = line.match(bulletListLinePattern);
    const ordered = line.match(orderedListLinePattern);
    if (bullet) {
      if (!inList && out.length > 0 && out[out.length - 1].trim().length > 0) {
        out.push('');
      }
      out.push(`${bullet[1]}- ${bullet[2].trim()}`);
      inList = true;
      listContinuationIndent = `${bullet[1]}  `;
      continue;
    }
    if (ordered) {
      if (!inList && out.length > 0 && out[out.length - 1].trim().length > 0) {
        out.push('');
      }
      out.push(`${ordered[1]}${ordered[2]}. ${ordered[3].trim()}`);
      inList = true;
      listContinuationIndent = `${ordered[1]}${' '.repeat((ordered[2] ?? '').length + 2)}`;
      continue;
    }

    if (line.trim().length === 0) {
      const next = lines[i + 1] ?? '';
      if (inList && (bulletListLinePattern.test(next) || orderedListLinePattern.test(next))) {
        listContinuationIndent = null;
        continue;
      }
      if (inList && listContinuationIndent !== null && startsListAgainAfterPlainLines(lines, i + 1)) {
        continue;
      }
      listContinuationIndent = null;
      inList = false;
      out.push('');
      continue;
    }

    if (inList && listContinuationIndent !== null) {
      out.push(`${listContinuationIndent}${line.trim()}`);
      continue;
    }

    inList = false;
    listContinuationIndent = null;
    out.push(line);
  }

  return normalizeEscapedCheckboxMarkers(out.join('\n').replace(/\n{3,}/g, '\n\n'));
}

const bulletListLinePattern = /^(\s*)[-*+]\s+(.+)$/;
const orderedListLinePattern = /^(\s*)(\d+)[.)]\s+(.+)$/;

function startsListAgainAfterPlainLines(lines: string[], startIndex: number): boolean {
  let sawPlainLine = false;
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.trim().length === 0) {
      return false;
    }
    if (bulletListLinePattern.test(line) || orderedListLinePattern.test(line)) {
      return sawPlainLine;
    }
    sawPlainLine = true;
  }
  return false;
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
      checkbox.classList.add('hvy-inline-checkbox');
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
