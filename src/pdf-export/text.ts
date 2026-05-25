import type { HvyPdfExportDecision, HvyPdfMakeNode, HvyPdfMakeNodeObject } from './types';

interface PdfTextLine {
  styleName: string | null;
  text: string;
}

export function renderPdfTextBlock(text: string, placeholder: string, decision: HvyPdfExportDecision): HvyPdfMakeNodeObject {
  const lines = splitPdfTextLines(stripFillInMarkers(normalizePdfTextInline(text || placeholder || '')));
  if (!lines.length) {
    return { text: '', style: decision.role === 'metadata' ? 'metadata' : 'paragraph' };
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
      stack.push({
        text: heading[2],
        style: getHeadingStyle(heading[1].length, style),
        headlineLevel: heading[1].length,
        hvyKeepWithNext: true,
      });
    } else if (bullet) {
      activeListStyle = style;
      listItems.push({ text: bullet[1], style });
    } else {
      flushList();
      stack.push({
        text: line.text,
        style: line.styleName?.includes('heading') ? getHeadingStyle(4, style) : style,
        headlineLevel: line.styleName?.includes('heading') ? 4 : undefined,
        hvyKeepWithNext: line.styleName?.includes('heading') ? true : undefined,
      });
    }
  }
  flushList();
  return stack.length === 1 && typeof stack[0] !== 'string' ? stack[0] : { stack };
}

export function normalizePdfTextInline(text: string): string {
  return text
    .replace(/<!--hvy:alt\s+(\{.*?\})-->\s*([\s\S]*?)\s*<!--\/hvy:alt-->/g, (_match, _rawJson, fullText) => String(fullText).trim())
    .replace(/<!--hvy:nowrap-->\s*([\s\S]*?)\s*<!--\/hvy:nowrap-->/g, (_match, nowrapText) => String(nowrapText).trim());
}

function splitPdfTextLines(text: string): PdfTextLine[] {
  return text
    .split(/\r?\n/)
    .map((rawLine) => rawLine.trim())
    .filter((line) => line.length > 0 && !/^\[\s*\]$/.test(line))
    .map((line) => {
      const escaped = /^(\\\^)([a-z0-9_-]+)\^\s?(.*)$/i.exec(line);
      if (escaped) {
        return { styleName: null, text: `^${escaped[2]}^${escaped[3] ? ` ${escaped[3]}` : ''}` };
      }
      const styled = /^\^([a-z0-9_-]+)\^\s?(.*)$/i.exec(line);
      if (styled) {
        return { styleName: styled[1], text: styled[2].trim() };
      }
      return { styleName: null, text: line };
    })
    .filter((line) => line.text.length > 0 && !/^\[\s*\]$/.test(line.text));
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
