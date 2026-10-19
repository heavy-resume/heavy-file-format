// A lexical policy, not a Python parser. Brython still validates syntax. Keep
// this independent of the compiler so execution, eval and lint share the rules.
export const SCRIPT_PUBLIC_DUNDER_NAMES = ['__init__', '__name__', '__main__'] as const;
const publicDunders = new Set<string>(SCRIPT_PUBLIC_DUNDER_NAMES);
// Brython resolves missing globals from its real builtins, ignoring
// `__builtins__`. The wrapper therefore installs these names as user globals:
// restricted builtins as blocking stubs, guarded builtins as safe versions.
// Ordinary Python scoping lets scripts bind the same names locally. Only a
// `global` declaration could delete the installed value, so that is rejected.
export const SCRIPT_RESTRICTED_BUILTIN_NAMES = [
  'open', 'type', 'object', 'vars', 'locals', 'compile', 'exec',
  'breakpoint', 'input', 'help', 'memoryview',
] as const;
const installedGlobals = new Set<string>([
  ...SCRIPT_RESTRICTED_BUILTIN_NAMES,
  'getattr', 'setattr', 'delattr', 'hasattr', 'eval', 'globals', 'print',
]);
const identifierStart = /[_\p{ID_Start}]/u;
const identifierContinue = /[_\p{ID_Continue}]/u;

export interface ScriptSourcePolicyIssue {
  name: 'ScriptPolicyError';
  message: string;
  line: number;
  column: number;
}

export function checkScriptSourcePolicy(source: string): ScriptSourcePolicyIssue | null {
  let position = 0;
  let issue: ScriptSourcePolicyIssue | null = null;

  function reject(message: string, offset: number): void {
    if (issue) return;
    const before = source.slice(0, offset);
    issue = {
      name: 'ScriptPolicyError',
      message: `HVY script policy: ${message}`,
      line: before.split('\n').length,
      column: offset - before.lastIndexOf('\n'),
    };
  }

  function checkDunders(value: string, offset: number): void {
    // Check complete identifier-shaped segments, including attribute paths and
    // format fields. The exceptions must never allow a longer private name.
    for (const match of value.matchAll(/[_\p{ID_Continue}]+/gu)) {
      if (match[0].includes('__') && !publicDunders.has(match[0])) {
        reject(`private name '${match[0]}' is not allowed.`, offset);
      }
    }
  }

  function readEscape(raw: boolean, bracesAreCode = false): string {
    position++; // backslash
    // A backslash never escapes a replacement-field brace, including in a
    // format specification. Leave it for the recursive code scanner.
    if (bracesAreCode && /[{}]/.test(source[position] ?? '')) return '\\';
    const character = source[position++] ?? '';
    if (raw) return `\\${character}`;
    if (character === '\n') return '';
    if (character === '\r' && source[position] === '\n') { position++; return ''; }
    const width = character === 'x' ? 2 : character === 'u' ? 4 : character === 'U' ? 8 : 0;
    if (width && new RegExp(`^[0-9a-fA-F]{${width}}$`).test(source.slice(position, position + width))) {
      const code = parseInt(source.slice(position, position + width), 16);
      position += width;
      return code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    if (/[0-7]/.test(character) && character) {
      const rest = source.slice(position).match(/^[0-7]{0,2}/)![0];
      position += rest.length;
      return String.fromCodePoint(parseInt(character + rest, 8));
    }
    if (character === 'N' && source[position] === '{') {
      const end = source.indexOf('}', position);
      if (end >= 0) {
        const name = source.slice(position + 1, end);
        position = end + 1;
        // LOW LINE is the named escape for underscore. Other named escapes
        // cannot introduce the ASCII private-name delimiter.
        return name.toUpperCase() === 'LOW LINE' ? '_' : '?';
      }
    }
    return character;
  }

  function stringLiteral(prefix: string): void {
    const start = position;
    const quote = source[position]!;
    const delimiter = source.startsWith(quote.repeat(3), position) ? quote.repeat(3) : quote;
    position += delimiter.length;
    const formatted = /[ft]/i.test(prefix);
    const raw = /r/i.test(prefix);
    let contents = '';
    while (position < source.length && !issue) {
      if (source.startsWith(delimiter, position)) {
        position += delimiter.length;
        break;
      }
      const character = source[position]!;
      if (formatted && (character === '{' || character === '}') && source[position + 1] === character) {
        contents += character;
        position += 2;
      } else if (formatted && character === '{') {
        checkDunders(contents, start);
        contents = '';
        position++;
        code(true);
      } else if (character === '\\') {
        contents += readEscape(raw, formatted);
      } else {
        contents += character;
        position++;
      }
    }
    checkDunders(contents, start);
  }

  function formatSpec(): void {
    const start = position;
    let contents = '';
    while (position < source.length && !issue) {
      if (source[position] === '}') { position++; break; }
      if (source[position] === '{') {
        checkDunders(contents, start);
        contents = '';
        position++;
        code(true);
      } else if (source[position] === '\\') {
        contents += readEscape(false, true);
      } else {
        contents += source[position++]!;
      }
    }
    checkDunders(contents, start);
  }

  function code(replacement = false): void {
    let previous = '';
    let globalStatement = false;
    const brackets: string[] = [];
    while (position < source.length && !issue) {
      const character = source[position]!;
      if (character === '#') {
        while (position < source.length && source[position] !== '\n') position++;
        continue;
      }
      if (character === '\\' && /[\r\n]/.test(source[position + 1] ?? '')) {
        position += source[position + 1] === '\r' && source[position + 2] === '\n' ? 3 : 2;
        continue;
      }
      if (/\s/.test(character)) {
        if ((character === '\n' || character === '\r') && brackets.length === 0) {
          previous = '';
          globalStatement = false;
        }
        position++;
        continue;
      }
      if (replacement && brackets.length === 0) {
        if (character === '}') { position++; return; }
        if (character === ':' || (character === '!' && source[position + 1] !== '=')) {
          position++;
          if (character === '!') {
            position++; // conversion character; syntax checked by Brython
            if (source[position] === ':') position++;
          }
          formatSpec();
          return;
        }
      }
      if (character === '"' || character === "'") {
        stringLiteral('');
        previous = 'string';
        continue;
      }
      const point = String.fromCodePoint(source.codePointAt(position)!);
      if (identifierStart.test(point)) {
        const start = position;
        position += point.length;
        while (position < source.length) {
          const next = String.fromCodePoint(source.codePointAt(position)!);
          if (!identifierContinue.test(next)) break;
          position += next.length;
        }
        const name = source.slice(start, position).normalize('NFKC');
        if (/^(?:r|u|b|f|t|br|rb|fr|rf|tr|rt)$/i.test(name) && /['"]/.test(source[position] ?? '')) {
          stringLiteral(name);
          previous = 'string';
          continue;
        }
        if (previous !== 'def' && previous !== 'class') checkDunders(name, start);
        if (globalStatement && installedGlobals.has(name)) {
          reject(`global declaration of guarded name '${name}' is not allowed.`, start);
        }
        if (name === 'global' && previous !== '.') globalStatement = true;
        previous = name;
        continue;
      }
      if ('([{'.includes(character)) brackets.push(character);
      if (')]}'.includes(character)) brackets.pop();
      if (character === ';') globalStatement = false;
      previous = character;
      position++;
    }
  }

  code();
  return issue;
}
