import { marked, type Token, type Tokens } from 'marked';
import { parse as parseYaml } from 'yaml';
import type { VisualBlock, VisualSection } from './editor/types';
import type { JsonObject } from './hvy/types';
import { DEFAULT_READER_MAX_WIDTH, DEFAULT_SECTION_CSS, defaultBlockSchema } from './document-factory';
import type { VisualDocument } from './types';
import { makeId, sanitizeOptionalId } from './utils';

interface MarkdownSource {
  meta: JsonObject;
  body: string;
}

interface SectionFrame {
  headingDepth: number;
  section: VisualSection;
}

export function convertMarkdownToHvyDocument(sourceText: string): VisualDocument {
  const source = splitMarkdownFrontMatter(sourceText);
  const rootSections: VisualSection[] = [];
  const stack: SectionFrame[] = [];
  let currentSection: VisualSection | null = null;
  let textBuffer: string[] = [];
  const usedIds = new Set<string>();

  const flushText = (): void => {
    const text = normalizeMarkdownBlockText(textBuffer.join('\n\n'));
    textBuffer = [];
    if (!text || !currentSection) {
      return;
    }
    currentSection.blocks.push(createTextBlock(text));
  };

  const ensureSection = (): VisualSection => {
    if (!currentSection) {
      currentSection = createMarkdownSection('Imported Markdown', 1, usedIds);
      rootSections.push(currentSection);
      stack.push({ headingDepth: 1, section: currentSection });
    }
    return currentSection;
  };

  const tokens = marked.lexer(source.body, { gfm: true, breaks: false });
  for (const token of tokens) {
    if (token.type === 'space' || token.type === 'def') {
      continue;
    }

    if (isHeadingToken(token)) {
      flushText();
      currentSection = appendHeadingSection(rootSections, stack, token, usedIds);
      continue;
    }

    ensureSection();

    if (isTableToken(token)) {
      flushText();
      currentSection?.blocks.push(createTableBlock(token));
      continue;
    }

    textBuffer.push(token.raw);
  }

  flushText();

  const title = source.meta.title ?? inferMarkdownTitle(rootSections);
  return {
    extension: '.hvy',
    meta: {
      ...source.meta,
      hvy_version: source.meta.hvy_version ?? 0.1,
      reader_max_width: source.meta.reader_max_width ?? DEFAULT_READER_MAX_WIDTH,
      section_defaults: source.meta.section_defaults ?? { css: DEFAULT_SECTION_CSS },
      ...(title ? { title } : {}),
    },
    sections: rootSections,
    attachments: [],
  };
}

function isHeadingToken(token: Token): token is Tokens.Heading {
  return token.type === 'heading' && typeof (token as Tokens.Heading).depth === 'number';
}

function isTableToken(token: Token): token is Tokens.Table {
  return token.type === 'table' && Array.isArray((token as Tokens.Table).header);
}

function appendHeadingSection(
  rootSections: VisualSection[],
  stack: SectionFrame[],
  token: Tokens.Heading,
  usedIds: Set<string>
): VisualSection {
  const section = createMarkdownSection(token.text.trim() || 'Untitled Section', token.depth, usedIds);
  while (stack.length > 0 && stack[stack.length - 1].headingDepth >= token.depth) {
    stack.pop();
  }
  const parent = stack[stack.length - 1]?.section;
  if (parent) {
    parent.children.push(section);
  } else {
    rootSections.push(section);
  }
  stack.push({ headingDepth: token.depth, section });
  return section;
}

function createMarkdownSection(title: string, headingDepth: number, usedIds: Set<string>): VisualSection {
  return {
    key: makeId('section'),
    customId: uniqueMarkdownId(title, usedIds),
    contained: true,
    lock: false,
    idEditorOpen: false,
    isGhost: false,
    title,
    level: Math.max(1, headingDepth),
    expanded: true,
    highlight: false,
    css: '',
    tags: '',
    description: '',
    location: 'main',
    blocks: [],
    children: [],
  };
}

function createTextBlock(text: string): VisualBlock {
  return {
    id: makeId('block'),
    text,
    schema: defaultBlockSchema('text'),
    schemaMode: false,
  };
}

function createTableBlock(token: Tokens.Table): VisualBlock {
  const schema = defaultBlockSchema('table');
  const columns = token.header.map((cell, index) => normalizeTableCellText(cell.text) || `Column ${index + 1}`);
  schema.tableColumns = columns.map((column) => column.replaceAll(',', '')).join(', ');
  schema.tableShowHeader = true;
  schema.tableRows = token.rows.map((row) => ({
    cells: columns.map((_, index) => normalizeTableCellText(row[index]?.text ?? '')),
  }));
  return {
    id: makeId('block'),
    text: '',
    schema,
    schemaMode: false,
  };
}

function splitMarkdownFrontMatter(sourceText: string): MarkdownSource {
  const normalized = sourceText.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) {
    return { meta: {}, body: sourceText };
  }

  try {
    const parsed = parseYaml(match[1] ?? '');
    return {
      meta: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as JsonObject) : {},
      body: normalized.slice(match[0].length),
    };
  } catch {
    return { meta: {}, body: normalized.slice(match[0].length) };
  }
}

function normalizeMarkdownBlockText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
}

function normalizeTableCellText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function uniqueMarkdownId(title: string, usedIds: Set<string>): string {
  const base = sanitizeOptionalId(title) || 'section';
  let candidate = base;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

function inferMarkdownTitle(sections: VisualSection[]): string | undefined {
  return sections[0]?.title;
}
