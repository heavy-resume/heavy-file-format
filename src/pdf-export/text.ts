import type { Align } from '../editor/types';
import type { HvyPdfExportDecision, HvyPdfMakeNode, HvyPdfMakeNodeObject } from './types';

interface PdfTextLine {
  styleName: string | null;
  text: string;
}

export function renderPdfTextBlock(
  text: string,
  placeholder: string,
  decision: HvyPdfExportDecision,
  align?: Align
): HvyPdfMakeNodeObject {
  const lines = splitPdfTextLines(stripFillInMarkers(normalizePdfTextInline(text || placeholder || '')));
  if (!lines.length) {
    return applyTextAlignment({ text: '', style: decision.role === 'metadata' ? 'metadata' : 'paragraph' }, align);
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
      stack.push(applyTextAlignment({
        text: heading[2],
        style: getHeadingStyle(heading[1].length, style),
        headlineLevel: heading[1].length,
        hvyKeepWithNext: true,
      }, align));
    } else if (bullet) {
      activeListStyle = style;
      listItems.push(applyTextAlignment({ text: bullet[1], style }, align));
    } else {
      flushList();
      stack.push(applyTextAlignment({
        text: line.text,
        style: line.styleName?.includes('heading') ? getHeadingStyle(4, style) : style,
        headlineLevel: line.styleName?.includes('heading') ? 4 : undefined,
        hvyKeepWithNext: line.styleName?.includes('heading') ? true : undefined,
      }, align));
    }
  }
  flushList();
  return applyTextAlignment(stack.length === 1 && typeof stack[0] !== 'string' ? stack[0] : { stack }, align);
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
    if (!parsed || parsed.text.length === 0 || /^\[\s*\]$/.test(parsed.text)) {
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
