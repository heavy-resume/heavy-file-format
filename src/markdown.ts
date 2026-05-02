import { marked } from 'marked';
import DOMPurify from 'dompurify';
import TurndownService from 'turndown';

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
  replacement: (content) => (content.trim().length > 0 ? `++${content}++` : ''),
});

export function markdownToEditorHtml(markdown: string): string {
  const normalized = normalizeMarkdownIndentation(markdown || '');
  const html = addExternalLinkTargets(DOMPurify.sanitize(marked.parse(applyUnderlineSyntax(escapeRawHtml(normalized))) as string));
  const template = document.createElement('template');
  template.innerHTML = html;
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
  return markdown.replace(/\+\+([^+\n](?:[^+\n]|\+(?!\+))*?)\+\+/g, '<u>$1</u>');
}

export function normalizeMarkdownLists(markdown: string): string {
  const lines = markdown.split(/\r?\n/).map((line) => line.replace(/^(\s*)\\-/, '$1-'));
  const out: string[] = [];
  let inList = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const bullet = line.match(/^(\s*)[-*+]\s+(.+)$/);
    if (bullet) {
      if (!inList && out.length > 0 && out[out.length - 1].trim().length > 0) {
        out.push('');
      }
      out.push(`${bullet[1]}- ${bullet[2].trim()}`);
      inList = true;
      continue;
    }

    if (line.trim().length === 0) {
      const next = lines[i + 1] ?? '';
      if (inList && /^(\s*)[-*+]\s+(.+)$/.test(next)) {
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
