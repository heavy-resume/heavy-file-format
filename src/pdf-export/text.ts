import { marked } from 'marked';
import type { Align } from '../editor/types';
import type { HvyPdfExportDecision, HvyPdfMakeNode, HvyPdfMakeNodeObject } from './types';

interface PdfTextLine {
  styleName: string | null;
  text: string;
}

export interface PdfTextBlockStyle {
  bold?: boolean;
  color?: string;
  fillColor?: string;
  fontSize?: number;
  lineHeight?: number;
}

export type PdfHeadingTextStyles = Partial<Record<1 | 2 | 3 | 4, PdfTextBlockStyle>>;

type PdfInlineText = string | Array<string | HvyPdfMakeNodeObject>;

export function renderPdfTextBlock(
  text: string,
  _placeholder: string,
  decision: HvyPdfExportDecision,
  align?: Align,
  textStyle: PdfTextBlockStyle = {},
  headingStyles: PdfHeadingTextStyles = {}
): HvyPdfMakeNodeObject {
  const lines = splitPdfTextLines(getPdfTextBlockSource(text));
  if (!lines.length) {
    return applyTextStyle(
      applyTextAlignment({ text: '', style: decision.role === 'metadata' ? 'metadata' : 'paragraph' }, align),
      textStyle
    );
  }
  const stack: HvyPdfMakeNode[] = [];
  let listItems: HvyPdfMakeNode[] = [];
  let activeListStyle: string | null = null;
  const flushList = (): void => {
    if (listItems.length) {
      stack.push({ ul: listItems, style: activeListStyle ? ['list', activeListStyle] : 'list' });
      listItems = [];
      activeListStyle = null;
    }
  };
  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+)$/.exec(line.text);
    const bullet = /^[-*]\s+(.+)$/.exec(line.text);
    const style = getPdfTextLineStyle(line.styleName, decision);
    if (heading) {
      flushList();
      const headingLevel = Math.min(4, heading[1].length) as 1 | 2 | 3 | 4;
      stack.push(
        applyTextStyle(
          applyTextAlignment({
            text: renderPdfInlineMarkdown(heading[2] ?? ''),
            style: getHeadingStyle(heading[1].length, style),
            headlineLevel: heading[1].length,
            hvyKeepWithNext: true,
          }, align),
          { ...headingStyles[headingLevel], ...textStyle }
        )
      );
    } else if (bullet) {
      activeListStyle = style;
      listItems.push(applyTextStyle(applyTextAlignment({ text: renderPdfInlineMarkdown(bullet[1] ?? ''), style }, align), textStyle));
    } else {
      flushList();
      stack.push(
        applyTextStyle(
          applyTextAlignment({
            text: renderPdfInlineMarkdown(line.text),
            style: line.styleName?.includes('heading') ? getHeadingStyle(4, style) : style,
            headlineLevel: line.styleName?.includes('heading') ? 4 : undefined,
            hvyKeepWithNext: line.styleName?.includes('heading') ? true : undefined,
          }, align),
          textStyle
        )
      );
    }
  }
  flushList();
  return applyTextAlignment(stack.length === 1 && typeof stack[0] !== 'string' ? stack[0] : { stack }, align);
}

export function hasRenderablePdfTextBlock(text: string): boolean {
  return splitPdfTextLines(getPdfTextBlockSource(text)).length > 0;
}

function getPdfTextBlockSource(text: string): string {
  return stripFillInMarkers(normalizePdfTextInline(text || ''));
}

export function normalizePdfTextInline(text: string): string {
  return text
    .replace(/<!--hvy:alt\s+(\{.*?\})-->\s*([\s\S]*?)\s*<!--\/hvy:alt-->/g, (_match, _rawJson, fullText) => String(fullText).trim())
    .replace(/<!--hvy:nowrap-->\s*([\s\S]*?)\s*<!--\/hvy:nowrap-->/g, (_match, nowrapText) => String(nowrapText).trim());
}

function splitPdfTextLines(text: string): PdfTextLine[] {
  const lines: PdfTextLine[] = [];
  let paragraphParts: string[] = [];
  const flushParagraph = (): void => {
    const text = paragraphParts.join(' ').replace(/[ \t]{2,}/g, ' ').trim();
    if (text.length > 0 && !/^\[\s*\]$/.test(text)) {
      lines.push({ styleName: null, text });
    }
    paragraphParts = [];
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || /^\[\s*\]$/.test(line)) {
      flushParagraph();
      continue;
    }
    const parsed = parsePdfTextLine(line);
    if (!parsed || parsed.text.length === 0 || /^\[\s*\]$/.test(parsed.text) || !hasVisiblePdfLineText(parsed.text)) {
      flushParagraph();
      continue;
    }
    if (parsed.styleName || /^(#{1,6})\s+(.+)$/.test(parsed.text) || /^[-*]\s+(.+)$/.test(parsed.text)) {
      flushParagraph();
      lines.push(parsed);
      continue;
    }
    paragraphParts.push(parsed.text);
  }
  flushParagraph();
  return lines;
}

function hasVisiblePdfLineText(text: string): boolean {
  return stripMarkdownScaffold(text).trim().length > 0;
}

function stripMarkdownScaffold(line: string): string {
  return line
    .replace(/^\s{0,3}#{1,6}\s*/, '')
    .replace(/^\s{0,3}>\s?/, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/^\s*[-*_]{3,}\s*$/, '')
    .replace(/[\\`*_~#[\]()!>-]/g, '');
}

function parsePdfTextLine(line: string): PdfTextLine | null {
  const escaped = /^(\\\^)([a-z0-9_-]+)\^\s?(.*)$/i.exec(line);
  if (escaped) {
    return { styleName: null, text: `^${escaped[2]}^${escaped[3] ? ` ${escaped[3]}` : ''}` };
  }
  const styled = /^\^([a-z0-9_-]+)\^\s?(.*)$/i.exec(line);
  if (styled) {
    return { styleName: styled[1], text: styled[2].trim() };
  }
  return { styleName: null, text: line };
}

function renderPdfInlineMarkdown(text: string): PdfInlineText {
  const inlineTokens = getMarkedInlineTokens(text);
  if (!inlineTokens.length) {
    return text;
  }
  const rendered = renderMarkedInlineTokens(inlineTokens);
  if (rendered.length === 0) {
    return text;
  }
  return rendered.length === 1 && typeof rendered[0] === 'string' ? rendered[0] : rendered;
}

function getMarkedInlineTokens(text: string): unknown[] {
  const tokens = marked.lexer(text, { gfm: true, breaks: false });
  const first = tokens[0] as { type?: string; tokens?: unknown[] } | undefined;
  return first?.type === 'paragraph' && Array.isArray(first.tokens) ? first.tokens : [];
}

function renderMarkedInlineTokens(tokens: unknown[]): Array<string | HvyPdfMakeNodeObject> {
  return tokens.flatMap((token) => renderMarkedInlineToken(token));
}

function renderMarkedInlineToken(token: unknown): Array<string | HvyPdfMakeNodeObject> {
  if (!token || typeof token !== 'object') {
    return [];
  }
  const typed = token as { type?: string; text?: string; tokens?: unknown[] };
  if (typed.type === 'strong') {
    return [{ text: coercePdfInlineText(renderMarkedInlineTokens(typed.tokens ?? [])), bold: true }];
  }
  if (typed.type === 'em') {
    return [{ text: coercePdfInlineText(renderMarkedInlineTokens(typed.tokens ?? [])), italics: true }];
  }
  if (typed.type === 'codespan') {
    return [{ text: typed.text ?? '', font: 'Roboto' }];
  }
  if (typed.type === 'del') {
    return [{ text: coercePdfInlineText(renderMarkedInlineTokens(typed.tokens ?? [])), decoration: 'lineThrough' }];
  }
  if (typed.type === 'link') {
    return renderMarkedInlineTokens(typed.tokens ?? []);
  }
  if (Array.isArray(typed.tokens)) {
    return renderMarkedInlineTokens(typed.tokens);
  }
  return typed.text ? [typed.text] : [];
}

function coercePdfInlineText(parts: Array<string | HvyPdfMakeNodeObject>): PdfInlineText {
  return parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : parts;
}

function stripFillInMarkers(text: string): string {
  return text
    .replace(/<!--\s*value(?:\s+\{.*?\})?\s*-->/g, '')
    .replace(/^[ \t]*\[[ \t]*\][ \t]*$/gm, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function getPdfTextLineStyle(styleName: string | null, decision: HvyPdfExportDecision): string {
  if (decision.role === 'metadata') return 'metadata';
  if (!styleName) return 'paragraph';
  if (styleName.includes('body')) return 'detailBody';
  if (styleName.includes('heading')) return 'detailHeading';
  return 'paragraph';
}

function getHeadingStyle(level: number, lineStyle: string): string[] {
  const headingStyle = level <= 1 ? 'sectionTitle' : level === 2 ? 'sectionTitle2' : 'sectionTitle3';
  return lineStyle === 'paragraph' ? [headingStyle] : [headingStyle, lineStyle];
}

function applyTextAlignment<T extends HvyPdfMakeNodeObject>(node: T, align: Align | undefined): T {
  return align && align !== 'left' ? { ...node, alignment: align } : node;
}

function applyTextStyle<T extends HvyPdfMakeNodeObject>(node: T, textStyle: PdfTextBlockStyle): T {
  return {
    ...node,
    ...(textStyle.bold === undefined ? {} : { bold: textStyle.bold }),
    ...(textStyle.color ? { color: textStyle.color } : {}),
    ...(textStyle.fillColor ? { fillColor: textStyle.fillColor } : {}),
    ...(typeof textStyle.fontSize === 'number' ? { fontSize: textStyle.fontSize } : {}),
    ...(typeof textStyle.lineHeight === 'number' ? { lineHeight: textStyle.lineHeight } : {}),
  };
}
