import { parse as parseYaml } from 'yaml';
import type { HvyCssBlock, HvyDocument, HvySection, JsonObject } from './types';

interface ParseState {
  root: HvySection;
  stack: HvySection[];
  cssBlocks: HvyCssBlock[];
  errors: string[];
  docMetaDirectives: JsonObject[];
  pendingSection: HvySection | undefined;
}

export function parseHvy(sourceText: string, extension: HvyDocument['extension']): HvyDocument {
  const { frontMatter, body, errors: frontMatterErrors } = extractFrontMatter(sourceText);

  const state: ParseState = {
    root: createSection('__root__', 'Root', 0),
    stack: [],
    cssBlocks: [],
    errors: [...frontMatterErrors],
    docMetaDirectives: [],
    pendingSection: undefined,
  };

  state.stack = [state.root];

  const lines = body.split(/\r?\n/);
  let pendingCssMeta: JsonObject | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';

    const docDirective = parsePrefixedDirective(line, 'hvy:doc');
    if (docDirective) {
      state.docMetaDirectives.push(docDirective.value);
      if (!docDirective.ok) {
        state.errors.push(`Line ${index + 1}: invalid hvy:doc directive JSON.`);
      }
      continue;
    }

    const cssDirective = parsePrefixedDirective(line, 'hvy:css');
    if (cssDirective) {
      if (cssDirective.ok) {
        pendingCssMeta = cssDirective.value;
      } else {
        pendingCssMeta = undefined;
        state.errors.push(`Line ${index + 1}: invalid hvy:css directive JSON.`);
      }
      continue;
    }

    const sectionTitleMatch = line.match(/^(#{1,6})!\s+(.*)$/);
    if (sectionTitleMatch) {
      const level = sectionTitleMatch[1].length;
      const title = (sectionTitleMatch[2] ?? '').trim();
      const section = state.pendingSection ?? createSection('', '', level);
      state.pendingSection = undefined;
      section.title = title;
      section.level = level;
      while ((state.stack.at(-1)?.level ?? 0) >= level) {
        state.stack.pop();
      }
      const parent = state.stack.at(-1);
      if (parent) {
        parent.children.push(section);
      }
      state.stack.push(section);
      continue;
    }

    const sectionDirective = parsePrefixedDirective(line, 'hvy:');
    if (sectionDirective) {
      flushPendingSection(state);
      if (!sectionDirective.ok) {
        state.errors.push(`Line ${index + 1}: invalid section hvy directive JSON.`);
        continue;
      }
      const newSection = createSection('', '', 0);
      Object.assign(newSection.meta, sectionDirective.value);
      if (typeof newSection.meta.id === 'string' && newSection.meta.id.trim().length > 0) {
        newSection.id = newSection.meta.id.trim();
      }
      state.pendingSection = newSection;
      continue;
    }

    const cssFence = parseCssFenceStart(line);
    if (cssFence) {
      flushPendingSection(state);
      const cssLines: string[] = [];
      let closed = false;
      for (index = index + 1; index < lines.length; index += 1) {
        const inner = lines[index] ?? '';
        if (inner.trim() === cssFence.fence) {
          closed = true;
          break;
        }
        cssLines.push(inner);
      }
      if (!closed) {
        state.errors.push(`Line ${index + 1}: unclosed CSS fence.`);
      }
      state.cssBlocks.push({
        css: cssLines.join('\n'),
        meta: pendingCssMeta ?? {},
      });
      pendingCssMeta = undefined;
      continue;
    }

    if (line.trim().length > 0) {
      pendingCssMeta = undefined;
      flushPendingSection(state);
    }

    const currentSection = state.stack.at(-1);
    if (currentSection && currentSection.id !== '__root__') {
      if (line.trim().length > 0 || currentSection.contentMarkdown.length > 0) {
        currentSection.contentMarkdown += `${line}\n`;
      }
    }
  }

  flushPendingSection(state);
  assignGeneratedIds(state.root.children);

  const meta = mergeObjects(frontMatter ?? {}, ...state.docMetaDirectives);
  const plugins = Array.isArray(meta.plugins) ? (meta.plugins as JsonObject[]) : [];

  return {
    extension,
    meta,
    sections: state.root.children,
    cssBlocks: state.cssBlocks,
    plugins,
    sourceText,
    errors: state.errors,
  };
}

function extractFrontMatter(source: string): {
  frontMatter: JsonObject | undefined;
  body: string;
  errors: string[];
} {
  const errors: string[] = [];
  const match = source.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) {
    return { frontMatter: undefined, body: source, errors };
  }

  const frontMatterText = match[1] ?? '';
  const body = source.slice(match[0].length);

  try {
    const parsed = parseYaml(frontMatterText);
    if (parsed && typeof parsed === 'object') {
      return { frontMatter: parsed as JsonObject, body, errors };
    }
    return { frontMatter: undefined, body, errors };
  } catch {
    errors.push('Invalid YAML front matter.');
    return { frontMatter: undefined, body, errors };
  }
}

function parsePrefixedDirective(
  line: string,
  prefix: 'hvy:doc' | 'hvy:css' | 'hvy:'
): { ok: boolean; value: JsonObject } | null {
  const safePrefix = prefix.replace(':', '\\:');
  const pattern = new RegExp(`^<!--${safePrefix}\\s*(\\{.*\\})\\s*-->$`);
  const match = line.trim().match(pattern);
  if (!match) {
    return null;
  }
  const payload = match[1] ?? '{}';
  try {
    const parsed = JSON.parse(payload);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, value: {} };
    }
    return { ok: true, value: parsed as JsonObject };
  } catch {
    return { ok: false, value: {} };
  }
}

function parseCssFenceStart(line: string): { fence: '```' | '~~~' } | null {
  const trimmed = line.trim();
  if (trimmed === '```css') {
    return { fence: '```' };
  }
  if (trimmed === '~~~css') {
    return { fence: '~~~' };
  }
  return null;
}

function createSection(id: string, title: string, level: number): HvySection {
  return {
    id,
    title,
    level,
    contentMarkdown: '',
    meta: {},
    children: [],
  };
}

function flushPendingSection(state: ParseState): void {
  if (!state.pendingSection) return;
  const section = state.pendingSection;
  state.pendingSection = undefined;
  if (!section.title) {
    section.title = section.id || 'untitled';
  }
  const level = section.level || 1;
  section.level = level;
  while ((state.stack.at(-1)?.level ?? 0) >= level) {
    state.stack.pop();
  }
  const parent = state.stack.at(-1);
  if (parent) {
    parent.children.push(section);
  }
  state.stack.push(section);
}

function assignGeneratedIds(sections: HvySection[], prefix = 'sec'): void {
  sections.forEach((section, index) => {
    if (!section.id || section.id.trim().length === 0) {
      section.id = `${prefix}-${index + 1}-${slugify(section.title || 'untitled')}`;
    }
    assignGeneratedIds(section.children, section.id);
  });
}

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'section';
}

function mergeObjects(...objects: JsonObject[]): JsonObject {
  const out: JsonObject = {};
  for (const obj of objects) {
    for (const [key, value] of Object.entries(obj)) {
      out[key] = value;
    }
  }
  return out;
}
