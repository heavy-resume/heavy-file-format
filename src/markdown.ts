import { marked } from 'marked';
import DOMPurify from 'dompurify';
import TurndownService from 'turndown';
import { getTextLineStyleLabel, sanitizeTextLineStyleCss, type TextLineStyles } from './text-line-styles';
import { createTextFillInMarker } from './text-fill-in';
import { renderWorkspaceLinksInHtml } from './workspace-links';
import { formatSortValueAnnotation, replaceSortValueAnnotations } from './sort-values';
import { normalizeRenderedMarkdownSoftBreaks } from './rendered-markdown-text';
import {
  answerGroupInputName,
  normalizeRadioGroupName,
  radioGroupDirective,
  resolveBlockAnswerGroups,
  scanInlineAnswers,
} from './inline-answer-groups';

marked.setOptions({ gfm: true, breaks: false });
marked.use({
  renderer: {
    image: () => '',
  },
  tokenizer: {
    del: (source) => {
      // Returning false delegates intentional double-tilde markup to Marked's
      // tokenizer; returning nothing lets a single tilde remain ordinary text.
      return source.startsWith('~~') ? false : undefined;
    },
  },
});

export const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '_',
});

turndown.addRule('task-list-checkbox', {
  filter: (node) => node.nodeName === 'INPUT' && ['checkbox', 'radio'].includes((node as HTMLInputElement).getAttribute('type') ?? ''),
  replacement: (_content, node) => {
    const input = node as HTMLInputElement;
    const marker = input.getAttribute('type') === 'radio' ? ['( )', '(x)'] : ['[ ]', '[x]'];
    return marker[input.checked ? 1 : 0] ?? marker[0]!;
  },
});

turndown.addRule('inline-answer-line-break', {
  filter: (node) => node.nodeName === 'BR' && Boolean(node.parentElement?.closest('.hvy-inline-checkbox-line')),
  replacement: () => '\n',
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
    return href.length > 0 ? `[${content}](${serializeMarkdownLinkDestination(href)})` : content;
  },
});

function serializeMarkdownLinkDestination(href: string): string {
  return href
    .replace(/\s/g, (whitespace) => encodeURIComponent(whitespace))
    .replace(/([<>()])/g, '\\$1');
}

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

turndown.addRule('hvy-radio-group-marker', {
  filter: (node) => node.nodeType === 1 && (node as Element).getAttribute('data-hvy-radio-group') !== null,
  replacement: (_content, node) =>
    radioGroupDirective(normalizeRadioGroupName((node as Element).getAttribute('data-hvy-radio-group') ?? '')),
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

turndown.addRule('hvy-sort-value', {
  filter: (node) => node.nodeType === 1 && (node as Element).getAttribute('data-hvy-sort-value') === 'true',
  replacement: (content, node) => {
    const element = node as HTMLElement;
    const key = element.getAttribute('data-sort-value-key')?.trim() ?? '';
    if (!key) {
      return content;
    }
    const label = element.nodeName.toUpperCase() === 'SELECT'
      ? Array.from(element.querySelectorAll('option')).find((option) => option.selected)?.textContent?.trim()
        ?? element.getAttribute('value')?.trim()
        ?? content
      : (element.textContent ?? content).replaceAll('\u200b', '').trim();
    return formatSortValueAnnotation({ key }, label);
  },
});

export interface MarkdownRenderOptions {
  textLineStyles?: TextLineStyles;
  textLineStyleMode?: 'viewer' | 'editor';
  codeLanguageInputAttrs?: Record<string, string>;
  crossDocumentLinksEnabled?: boolean;
  preserveSortValueAnnotations?: boolean;
  /**
   * Resolved radio group key per answer marker index, from
   * `buildInlineAnswerGroupIndex`. Groups can span components, so this is
   * supplied by the caller that knows the whole document. Without it, radio
   * options fall back to grouping within this text alone.
   */
  answerGroups?: Map<number, string>;
}

export function markdownToEditorHtml(markdown: string, options: MarkdownRenderOptions = {}): string {
  const normalized = normalizeMarkdownIndentation(markdown || '');
  const annotations = extractResponsiveAnnotations(normalized, { editable: true, answerGroups: options.answerGroups });
  const html = renderMarkdownHtml(annotations.markdown, {
    textLineStyles: options.textLineStyles ?? {},
    textLineStyleMode: options.textLineStyleMode ?? 'editor',
  });
  const template = document.createElement('template');
  template.innerHTML = addExternalLinkTargets(restoreResponsiveAnnotationTokens(html, annotations.tokens));
  template.content.querySelectorAll<HTMLElement>('pre > code').forEach((code) => {
    const languageClass = Array.from(code.classList).find((className) => className.startsWith('language-'));
    const language = languageClass ? languageClass.slice('language-'.length) : code.dataset.language || 'text';
    const pre = code.parentElement;
    pre?.setAttribute('data-code-language', language || 'text');
    pre?.setAttribute('contenteditable', 'false');
    code.setAttribute('contenteditable', 'true');
    if (pre instanceof HTMLElement) {
      wrapCodeBlockEditor(pre, renderCodeLanguageControl(pre.ownerDocument, language || 'text', options.codeLanguageInputAttrs ?? {}));
    }
  });
  renderInlineCheckboxes(template.content);
  normalizeInlineAnswerControls(template.content, true);
  preserveTrailingEditableSpaces(template.content);
  template.content.querySelectorAll<HTMLInputElement>('input[type="checkbox"], input[type="radio"]').forEach((checkbox) => {
    checkbox.removeAttribute('disabled');
    checkbox.setAttribute('contenteditable', 'false');
  });
  removeDirectWhitespaceTextNodes(template.content);
  if (!template.content.hasChildNodes()) {
    const paragraph = document.createElement('p');
    paragraph.appendChild(document.createElement('br'));
    template.content.appendChild(paragraph);
  }
  return template.innerHTML;
}

function removeDirectWhitespaceTextNodes(root: ParentNode): void {
  [...root.childNodes].forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim().length === 0) {
      node.remove();
    }
  });
}

export function getRichEditorSerializableHtml(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll<HTMLElement>('mark.search-match-marker').forEach((marker) => {
    marker.replaceWith(...Array.from(marker.childNodes));
  });
  clone.querySelectorAll('.rich-code-language-control').forEach((control) => control.remove());
  clone.querySelectorAll<HTMLElement>('.rich-code-block-shell').forEach((shell) => {
    const pre = shell.querySelector(':scope > pre');
    if (pre) {
      shell.replaceWith(pre);
    }
  });
  return clone.innerHTML;
}

function wrapCodeBlockEditor(pre: HTMLElement, control: HTMLElement): void {
  const wrapper = pre.ownerDocument.createElement('div');
  wrapper.className = 'rich-code-block-shell';
  pre.before(wrapper);
  wrapper.append(control, pre);
}

function renderCodeLanguageControl(ownerDocument: Document, language: string, attrs: Record<string, string>): HTMLElement {
  const label = ownerDocument.createElement('label');
  label.className = 'rich-code-language-control';
  label.contentEditable = 'false';
  const labelText = ownerDocument.createElement('span');
  labelText.textContent = 'Language';
  const input = ownerDocument.createElement('input');
  input.type = 'text';
  input.value = language === 'text' ? '' : language;
  input.placeholder = 'text';
  input.dataset.field = 'rich-code-language';
  for (const [key, value] of Object.entries(attrs)) {
    input.setAttribute(key, value);
  }
  label.append(labelText, input);
  return label;
}

export function markdownToMobileAdjustmentEditorHtml(markdown: string): string {
  return markdownToEditorHtml(markdown);
}

export function markdownToReaderHtml(markdown: string, options: MarkdownRenderOptions = {}): string {
  const annotations = extractResponsiveAnnotations(markdown || '', {
    editable: false,
    preserveSortValues: options.preserveSortValueAnnotations === true,
    answerGroups: options.answerGroups,
  });
  const html = renderMarkdownHtml(annotations.markdown, {
    textLineStyles: options.textLineStyles ?? {},
    textLineStyleMode: options.textLineStyleMode ?? 'viewer',
  });
  return renderWorkspaceLinksInHtml(
    wrapInlineCheckboxLines(restoreResponsiveAnnotationTokens(html, annotations.tokens)),
    options.crossDocumentLinksEnabled === true
  );
}

function renderMarkdownHtml(markdown: string, options: Required<Pick<MarkdownRenderOptions, 'textLineStyles' | 'textLineStyleMode'>>): string {
  const segments = splitTextLineStyleSegments(markdown);
  if (segments.length === 1 && segments[0]?.kind === 'markdown') {
    return renderSanitizedMarkdownHtml(markdown);
  }
  return segments
    .map((segment) => {
      if (segment.kind === 'markdown') {
        return renderSanitizedMarkdownHtml(segment.markdown);
      }
      const lineHtml = renderSanitizedMarkdownHtml(segment.markdown);
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

function renderSanitizedMarkdownHtml(markdown: string): string {
  return normalizeRenderedMarkdownSoftBreaks(
    sanitizeHtml(marked.parse(applyUnderlineSyntax(escapeRawHtml(markdown))) as string)
  );
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

function extractResponsiveAnnotations(
  markdown: string,
  options: { editable: boolean; preserveSortValues?: boolean; answerGroups?: Map<number, string> }
): { markdown: string; tokens: ResponsiveAnnotationToken[] } {
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
  const withSortValues = replaceSortValueAnnotations(withNowrap, (annotation) =>
    makeToken(options.editable || options.preserveSortValues
      ? renderSortValueAnnotationHtml(annotation.key, annotation.text)
      : escapeHtml(annotation.text))
  );
  return {
    markdown: replaceInlineCheckboxMarkers(withSortValues, makeToken, {
      editable: options.editable,
      answerGroups: options.answerGroups,
    }),
    tokens,
  };
}

function renderSortValueAnnotationHtml(key: string, text: string): string {
  return `<span class="hvy-sort-value" data-hvy-sort-value="true" data-sort-value-key="${escapeHtml(key)}">${escapeHtml(text)}</span>`;
}

let fallbackGroupSeed = 0;

function replaceInlineCheckboxMarkers(
  markdown: string,
  makeToken: (html: string) => string,
  options: { editable: boolean; answerGroups?: Map<number, string> }
): string {
  const scanned = scanInlineAnswers(markdown);
  // Callers that know the document supply resolved groups. Without them, grouping is
  // local to this text, and the key must still be unique per render so two separately
  // rendered blocks never share a DOM radio name.
  fallbackGroupSeed += 1;
  const fallbackGroups = options.answerGroups
    ? null
    : resolveBlockAnswerGroups(markdown, `local-${fallbackGroupSeed}`, null).groups;
  const groupOf = (answerIndex: number): string | undefined =>
    (options.answerGroups ?? fallbackGroups ?? undefined)?.get(answerIndex);

  // Splice replacements into each line back-to-front so earlier offsets stay valid.
  const replacementsByLine = new Map<number, { start: number; length: number; html: string }[]>();
  const addReplacement = (lineIndex: number, start: number, length: number, html: string): void => {
    const list = replacementsByLine.get(lineIndex) ?? [];
    list.push({ start, length, html });
    replacementsByLine.set(lineIndex, list);
  };
  scanned.markers.forEach((marker) => {
    const groupKey = marker.radio ? groupOf(marker.answerIndex) : undefined;
    addReplacement(
      marker.lineIndex,
      marker.start,
      marker.length,
      makeToken(renderInlineCheckboxHtml(marker.checked, marker.radio, marker.answerIndex, groupKey))
    );
  });
  scanned.directives.forEach((directive) => {
    addReplacement(
      directive.lineIndex,
      directive.start,
      directive.length,
      makeToken(options.editable ? renderRadioGroupDirectiveHtml(directive.name) : '')
    );
  });

  const segments = markdown.split(/(\r?\n)/);
  return segments
    .map((segment, segmentIndex) => {
      if (segmentIndex % 2 === 1) {
        return segment;
      }
      const lineIndex = segmentIndex / 2;
      const replacements = replacementsByLine.get(lineIndex);
      let rendered = segment;
      if (replacements) {
        replacements
          .sort((left, right) => right.start - left.start)
          .forEach((replacement) => {
            rendered = `${rendered.slice(0, replacement.start)}${replacement.html}${rendered.slice(replacement.start + replacement.length)}`;
          });
      }
      if (isBareAnswerMarkerLine(segment) && isBareAnswerMarkerLine(segments[segmentIndex + 2] ?? '')) {
        rendered = `${rendered.replace(/[ \t]+$/, '')}  `;
      }
      return rendered;
    })
    .join('');
}

function renderRadioGroupDirectiveHtml(name: string | null): string {
  const label = name ?? 'end group';
  return `<span
    class="hvy-radio-group-marker${name ? '' : ' is-group-end'}"
    data-hvy-radio-group="${escapeHtml(name ?? '')}"
    contenteditable="false"
  >${escapeHtml(label)}</span>`;
}

function isBareAnswerMarkerLine(line: string): boolean {
  return /^\s*(?:\[(?: |x|X)\]|\((?: |x|X)\))(?=\s|$)/.test(line);
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

function renderInlineCheckboxHtml(checked: boolean, radio = false, answerIndex?: number, groupKey?: string): string {
  const answerAttrs = typeof answerIndex === 'number' ? ` data-field="inline-persisted-answer" data-answer-index="${answerIndex}"` : '';
  const groupAttrs = radio && groupKey
    ? ` name="${escapeHtml(answerGroupInputName(groupKey))}" data-answer-group="${escapeHtml(groupKey)}"`
    : '';
  return `<input class="hvy-inline-checkbox${radio ? ' hvy-inline-radio' : ''}" type="${radio ? 'radio' : 'checkbox'}"${groupAttrs}${answerAttrs}${checked ? ' checked' : ''} contenteditable="false">`;
}

function wrapInlineCheckboxLines(html: string): string {
  return html.replace(/<p>((?=[\s\S]*?\bhvy-inline-checkbox\b)[\s\S]*?)<\/p>/g, (_match, content: string) =>
    content
      .split(/<br\s*\/?>/i)
      .map((row) => `<div class="hvy-inline-checkbox-line">${row}</div>`)
      .join('')
  );
}

function markInlineCheckboxLines(root: ParentNode): void {
  root.querySelectorAll<HTMLInputElement>('input.hvy-inline-checkbox').forEach((checkbox) => {
    const parent = checkbox.parentElement;
    if (!parent) {
      return;
    }
    if (root instanceof HTMLElement && parent === root && root.matches('.rich-editor')) {
      removeEmptyRichEditorPrefix(checkbox);
      wrapDirectInlineAnswerLine(root, checkbox);
      return;
    }
    if (!isLeadingInlineCheckbox(checkbox)) {
      return;
    }
    parent.classList.add('hvy-inline-checkbox-line');
  });
}

function removeEmptyRichEditorPrefix(checkbox: HTMLInputElement): void {
  const precedingNodes: ChildNode[] = [];
  let current = checkbox.previousSibling;
  while (current) {
    precedingNodes.unshift(current);
    current = current.previousSibling;
  }
  if (precedingNodes.length === 0 || !precedingNodes.every(isEmptyRichEditorPlaceholderNode)) {
    return;
  }
  precedingNodes.forEach((node) => node.remove());
}

function isEmptyRichEditorPlaceholderNode(node: ChildNode): boolean {
  if (node instanceof Text) {
    return node.data.replace(/\u200b/g, '').trim().length === 0;
  }
  return node instanceof HTMLElement
    && node.matches('p, div')
    && [...node.childNodes].every((child) => (
      child instanceof HTMLBRElement
      || (child instanceof Text && child.data.replace(/\u200b/g, '').trim().length === 0)
    ));
}

function wrapDirectInlineAnswerLine(root: HTMLElement, checkbox: HTMLInputElement): void {
  const row = document.createElement('div');
  row.className = 'hvy-inline-checkbox-line';
  root.insertBefore(row, checkbox);
  let current: ChildNode | null = checkbox;
  while (current) {
    const next: ChildNode | null = current.nextSibling;
    if (current !== checkbox && isDirectInlineAnswerLineBoundary(current)) {
      break;
    }
    row.appendChild(current);
    current = next;
  }
}

function isDirectInlineAnswerLineBoundary(node: ChildNode): boolean {
  return node instanceof HTMLBRElement
    || (node instanceof HTMLElement && /^(?:ADDRESS|BLOCKQUOTE|DIV|H[1-6]|HR|OL|P|PRE|TABLE|UL)$/.test(node.tagName));
}

function splitInlineAnswerLineContainers(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('.hvy-inline-checkbox-line').forEach((container) => {
    if (!container.querySelector('input.hvy-inline-checkbox')) return;
    const hasStructuralAnswerBoundary = Boolean(container.querySelector(
      '.hvy-radio-group-marker.is-group-end ~ input.hvy-inline-checkbox, input.hvy-inline-checkbox ~ .hvy-radio-group-marker:not(.is-group-end)'
    ));
    if (!container.querySelector('br') && !hasStructuralAnswerBoundary) return;
    const rows: HTMLDivElement[] = [document.createElement('div')];
    rows[0]!.className = 'hvy-inline-checkbox-line';
    [...container.childNodes].forEach((node) => {
      const currentRow = rows[rows.length - 1]!;
      const startsAfterGroupEnd = node instanceof HTMLInputElement
        && node.classList.contains('hvy-inline-checkbox')
        && Boolean(currentRow.querySelector('.hvy-radio-group-marker.is-group-end'));
      const startsRadioGroup = node instanceof HTMLElement
        && node.classList.contains('hvy-radio-group-marker')
        && !node.classList.contains('is-group-end')
        && Boolean(currentRow.querySelector('input.hvy-inline-checkbox'));
      if (node instanceof HTMLBRElement || startsAfterGroupEnd || startsRadioGroup) {
        const row = document.createElement('div');
        row.className = 'hvy-inline-checkbox-line';
        rows.push(row);
        if (node instanceof HTMLBRElement) return;
      }
      rows[rows.length - 1]!.appendChild(node);
    });
    container.replaceWith(...rows.filter((row) => row.childNodes.length > 0));
  });
}

/**
 * Group membership is resolved from the document source (see `inline-answer-groups`)
 * and carried on `data-answer-group`. Inputs recovered from literal marker text by
 * `renderInlineCheckboxes` carry no group, so they inherit the run they sit in.
 */
function configureInlineAnswerControls(root: ParentNode, editable: boolean): void {
  const inputs = [...root.querySelectorAll<HTMLInputElement>('input.hvy-inline-checkbox')];
  inputs.forEach((input, index) => {
    input.dataset.answerIndex = String(index);
    if (!editable) input.dataset.field = 'inline-persisted-answer';
  });
  let recoveredRun = 0;
  let previousContainer: Element | null = null;
  let previousGroupKey: string | null = null;
  for (const input of inputs) {
    if (input.type !== 'radio') {
      previousContainer = null;
      previousGroupKey = null;
      continue;
    }
    const container = input.closest('li, .hvy-inline-checkbox-line') ?? input.parentElement;
    const consecutive = previousContainer !== null && previousContainer.nextElementSibling === container;
    let groupKey = input.dataset.answerGroup ?? '';
    if (!groupKey) {
      if (consecutive && previousGroupKey) {
        groupKey = previousGroupKey;
      } else {
        recoveredRun += 1;
        groupKey = `recovered:${recoveredRun}`;
      }
      input.dataset.answerGroup = groupKey;
    }
    input.name = answerGroupInputName(groupKey);
    previousContainer = container;
    previousGroupKey = groupKey;
  }
}

/** Establishes the editor DOM invariants shared by rendered and newly inserted answers. */
export function normalizeInlineAnswerControls(root: ParentNode, editable: boolean): void {
  markInlineCheckboxLines(root);
  splitInlineAnswerLineContainers(root);
  configureInlineAnswerControls(root, editable);
}

function isLeadingInlineCheckbox(checkbox: HTMLInputElement): boolean {
  let previous = checkbox.previousSibling;
  while (previous) {
    if (previous.nodeType === Node.TEXT_NODE && (previous.textContent ?? '').trim().length === 0) {
      previous = previous.previousSibling;
      continue;
    }
    // Structural markers carry no visible content, so a marker sitting in front of an
    // answer must not stop it counting as the start of its line.
    if (previous instanceof Element && isStructuralInlineMarker(previous)) {
      previous = previous.previousSibling;
      continue;
    }
    return false;
  }
  return true;
}

function isStructuralInlineMarker(element: Element): boolean {
  return element.hasAttribute('data-hvy-radio-group');
}

export function normalizeEditorMarkdownWhitespace(markdown: string): string {
  const normalized = markdown.replace(/\u00a0/g, ' ').replace(/\u200b/g, '');
  const withCollapsedMarkerSpacing = normalized.replace(
    /^(\s*(?:\[(?: |x|X)\]|\((?: |x|X)\)))[ \t]+/gm,
    '$1 '
  );
  const withSingleMarkerSpacing = withCollapsedMarkerSpacing.replace(
    /^(\s*(?:\[(?: |x|X)\]|\((?: |x|X)\)))(?=\S)/gm,
    '$1 '
  );
  let compacted = withSingleMarkerSpacing;
  const answerParagraphGap = /^(\s*(?:\[(?: |x|X)\]|\((?: |x|X)\))[^\n]*)\n[ \t]*\n(?=[ \t]*(?:\[(?: |x|X)\]|\((?: |x|X)\)))/gm;
  while (answerParagraphGap.test(compacted)) {
    compacted = compacted.replace(answerParagraphGap, '$1\n');
  }
  return compacted;
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

export function addExternalLinkTargets(html: string, options: { crossDocumentLinksEnabled?: boolean } = {}): string {
  if (typeof document === 'undefined') {
    return renderWorkspaceLinksInHtml(addExternalLinkTargetsWithoutDom(html), options.crossDocumentLinksEnabled === true);
  }
  const template = document.createElement('template');
  template.innerHTML = html;
  template.content.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
    const href = anchor.getAttribute('href') ?? '';
    if (/^https?:\/\//i.test(href)) {
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
    }
  });
  return renderWorkspaceLinksInHtml(template.innerHTML, options.crossDocumentLinksEnabled === true);
}

function addExternalLinkTargetsWithoutDom(html: string): string {
  return html.replace(/<a\b([^>]*?)\bhref="(https?:\/\/[^"]*)"([^>]*)>/gi, (match, before, href, after) => {
    const withTarget = /\btarget=/.test(match) ? match : `<a${before}href="${href}"${after} target="_blank">`;
    return /\brel=/.test(withTarget)
      ? withTarget
      : withTarget.replace(/>$/, ' rel="noopener noreferrer">');
  });
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

const markdownEscapablePunctuation = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/;

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
    if (char === '\\' && index + 1 < markdown.length && markdownEscapablePunctuation.test(markdown[index + 1]!)) {
      output += markdown.slice(index, index + 2);
      index += 2;
      continue;
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
      return /(\[( |x|X)\]|\(( |x|X)\))/.test(node.textContent ?? '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
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
    const regex = /(\[( |x|X)\]|\(( |x|X)\))/g;
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
      const radio = match[0].startsWith('(');
      checkbox.type = radio ? 'radio' : 'checkbox';
      checkbox.classList.add('hvy-inline-checkbox');
      if (radio) checkbox.classList.add('hvy-inline-radio');
      const isChecked = (radio ? match[3] : match[2] ?? ' ').toLowerCase() === 'x';
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
