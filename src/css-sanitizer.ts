import { isExternalCssAllowed } from './reference-config';

export interface CssSanitizeOptions {
  /** When true, leave external fetch constructs intact. Defaults to the reference-config flag. */
  allowExternal?: boolean;
}

/**
 * Decode CSS character escapes so detection cannot be bypassed by writing
 * `u\72l(...)` or `\55RL(...)`. Per the CSS spec a backslash followed by 1-6
 * hex digits is a code point, optionally terminated by a single whitespace; any
 * other backslash escapes the next character literally.
 */
export function decodeCssEscapes(input: string): string {
  return input
    .replace(/\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?/g, (_match, hex: string) => {
      const code = Number.parseInt(hex, 16);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) {
        return '';
      }
      try {
        return String.fromCodePoint(code);
      } catch {
        return '';
      }
    })
    .replace(/\\([^\n\r\f])/g, (_match, ch: string) => ch);
}

const NETWORK_AT_RULES = ['import', 'font-face', 'namespace', 'property'];
const NETWORK_FUNCTIONS = ['url', 'image-set', 'src'];

const DECL_NETWORK_FUNCTION_PATTERN = new RegExp(
  `\\b(?:${NETWORK_FUNCTIONS.join('|')})\\s*\\(`,
  'i'
);

const DECL_NETWORK_PROPERTY_PATTERN = /(^|[\s;{])\s*src\s*:/i;

const AT_RULE_PATTERN = new RegExp(
  `@(?:${NETWORK_AT_RULES.join('|')})\\b`,
  'i'
);

/** Returns true if the given fragment, after escape decoding, can trigger a network fetch. */
export function cssFragmentTriggersNetwork(fragment: string): boolean {
  const decoded = decodeCssEscapes(fragment);
  if (AT_RULE_PATTERN.test(decoded)) {
    return true;
  }
  if (DECL_NETWORK_FUNCTION_PATTERN.test(decoded)) {
    return true;
  }
  if (DECL_NETWORK_PROPERTY_PATTERN.test(decoded)) {
    return true;
  }
  return false;
}

function shouldAllow(options?: CssSanitizeOptions): boolean {
  if (options && typeof options.allowExternal === 'boolean') {
    return options.allowExternal;
  }
  return isExternalCssAllowed();
}

/**
 * Sanitize an inline style string (the value of an HTML `style="..."` attribute or
 * the body of an `hvy:*` `css` field). Declarations that could cause the renderer
 * to fetch a remote resource are dropped.
 */
export function sanitizeInlineCss(input: string, options?: CssSanitizeOptions): string {
  if (!input) {
    return input;
  }
  if (shouldAllow(options)) {
    return input;
  }
  // Inline styles are a sequence of declarations separated by `;`. They cannot contain
  // at-rules or selector blocks, so we filter the declarations and rejoin.
  const declarations = input.split(';');
  const safe = declarations.filter((declaration) => declaration.trim().length === 0 || !cssFragmentTriggersNetwork(declaration));
  return safe.join(';');
}

/**
 * Sanitize a full CSS stylesheet (e.g. a fenced `~~~css` block or an `hvy:css`
 * directive payload). Removes at-rules and declarations that could trigger
 * network fetches.
 */
export function sanitizeCssBlock(input: string, options?: CssSanitizeOptions): string {
  if (!input) {
    return input;
  }
  if (shouldAllow(options)) {
    return input;
  }
  const decoded = decodeCssEscapes(input);
  // Strip @import statements (single-line, terminated by ; or url(...) ;).
  let result = decoded.replace(/@import\s+[^;]*;?/gi, '');
  // Strip @font-face / @namespace / @property at-rules including their block bodies.
  result = stripAtRuleBlocks(result, ['font-face', 'namespace', 'property']);
  // Inside any remaining declarations, drop ones that contain url(...) or image-set(...).
  result = stripNetworkDeclarations(result);
  return result;
}

function stripAtRuleBlocks(source: string, names: string[]): string {
  const pattern = new RegExp(`@(?:${names.join('|')})\\b`, 'gi');
  let output = '';
  let cursor = 0;
  while (cursor < source.length) {
    pattern.lastIndex = cursor;
    const match = pattern.exec(source);
    if (!match) {
      output += source.slice(cursor);
      break;
    }
    output += source.slice(cursor, match.index);
    cursor = match.index + match[0].length;
    // Walk forward to find the end of this at-rule: either `;` (statement form) or
    // a balanced `{ ... }` block (block form).
    while (cursor < source.length && source[cursor] !== ';' && source[cursor] !== '{') {
      cursor += 1;
    }
    if (cursor >= source.length) {
      break;
    }
    if (source[cursor] === ';') {
      cursor += 1;
      continue;
    }
    // Block form: skip a balanced { ... }
    let depth = 0;
    while (cursor < source.length) {
      const ch = source[cursor];
      cursor += 1;
      if (ch === '{') {
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          break;
        }
      }
    }
  }
  return output;
}

function stripNetworkDeclarations(source: string): string {
  // Walk top-level structure; within rule bodies (`{ ... }`), drop declarations
  // that contain unsafe url()/image-set()/src() functions or `src:` properties.
  let output = '';
  let cursor = 0;
  while (cursor < source.length) {
    const openBrace = source.indexOf('{', cursor);
    if (openBrace < 0) {
      output += source.slice(cursor);
      break;
    }
    output += source.slice(cursor, openBrace + 1);
    // Find matching close brace.
    let depth = 1;
    let scan = openBrace + 1;
    while (scan < source.length && depth > 0) {
      const ch = source[scan];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      scan += 1;
    }
    const blockBody = source.slice(openBrace + 1, scan - 1);
    const safeBody = blockBody
      .split(';')
      .filter((declaration) => declaration.trim().length === 0 || !cssFragmentTriggersNetwork(declaration))
      .join(';');
    output += `${safeBody}}`;
    cursor = scan;
  }
  return output;
}
