// Scripts execute inside a function so they can return a result to their host.
// Keep syntax validation and execution on exactly the same source wrapper.
export function wrapPythonSourceInFunction(source: string): string {
  const lines = source.split('\n');
  const body = lines.length > 0 && lines.some((line) => line.trim().length > 0)
    ? lines.map((line) => `    ${line}`)
    : ['    pass'];
  return [
    'def __hvy_user_main__():',
    ...body,
  ].join('\n');
}

export const STRIPPED_IMPORT_MESSAGE = 'Import statements are not allowed in HVY scripts.';

function isEscaped(line: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && line[cursor] === '\\'; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function analyzePythonLine(
  line: string,
  startingBracketDepth: number,
  activeTripleQuote: `'''` | `"""` | null
): {
  bracketDepth: number;
  lineContinuation: boolean;
  tripleQuote: `'''` | `"""` | null;
  isBlankOrComment: boolean;
} {
  let bracketDepth = startingBracketDepth;
  let tripleQuote = activeTripleQuote;
  let inSingleQuotedString: "'" | '"' | null = null;
  let sawCode = false;
  let lineContinuation = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (tripleQuote) {
      if (line.slice(index, index + 3) === tripleQuote && !isEscaped(line, index)) {
        tripleQuote = null;
        index += 2;
      }
      continue;
    }

    if (inSingleQuotedString) {
      if (char === inSingleQuotedString && !isEscaped(line, index)) {
        inSingleQuotedString = null;
      }
      continue;
    }

    if (char === '#') {
      break;
    }

    if (/\s/.test(char)) {
      continue;
    }

    sawCode = true;

    const tripleCandidate = line.slice(index, index + 3);
    if ((tripleCandidate === `'''` || tripleCandidate === `"""`) && !isEscaped(line, index)) {
      tripleQuote = tripleCandidate;
      index += 2;
      continue;
    }

    if ((char === "'" || char === '"') && !isEscaped(line, index)) {
      inSingleQuotedString = char;
      continue;
    }

    if (char === '(' || char === '[' || char === '{') {
      bracketDepth += 1;
      continue;
    }

    if (char === ')' || char === ']' || char === '}') {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }
  }

  let trimIndex = line.length - 1;
  while (trimIndex >= 0 && /\s/.test(line[trimIndex])) {
    trimIndex -= 1;
  }
  if (trimIndex >= 0 && line[trimIndex] === '\\' && !isEscaped(line, trimIndex)) {
    lineContinuation = true;
  }

  return {
    bracketDepth,
    lineContinuation,
    tripleQuote,
    isBlankOrComment: !sawCode,
  };
}

export function instrumentPythonSource(source: string): string {
  const lines = source.split('\n');
  const instrumented: string[] = [];

  let statementOpen = false;
  let bracketDepth = 0;
  let tripleQuote: `'''` | `"""` | null = null;

  for (const line of lines) {
    const analysis = analyzePythonLine(line, bracketDepth, tripleQuote);
    const indentation = line.match(/^\s*/)?.[0] ?? '';
    const trimmed = line.trimStart();

    if (!analysis.isBlankOrComment && !statementOpen && !isCompoundContinuationLine(trimmed)) {
      instrumented.push(`${indentation}__hvy_step__()`);
    }

    instrumented.push(line);

    bracketDepth = analysis.bracketDepth;
    tripleQuote = analysis.tripleQuote;

    if (!analysis.isBlankOrComment) {
      statementOpen = tripleQuote !== null || bracketDepth > 0 || analysis.lineContinuation;
    }
  }

  return instrumented.join('\n');
}

function isCompoundContinuationLine(trimmedLine: string): boolean {
  return /^(elif|else|except|finally)\b/.test(trimmedLine);
}

function isImportStatementStart(line: string): boolean {
  const trimmed = line.trimStart();
  return /^import\b/.test(trimmed) || /^from\b.*\bimport\b/.test(trimmed);
}

function getAllowedImportReplacement(line: string, allowedLibraries: readonly string[]): string | null {
  const allowed = new Set(allowedLibraries);
  const trimmed = line.trimStart();
  const importMatch = trimmed.match(/^import\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+as\s+[A-Za-z_][A-Za-z0-9_]*)?\s*$/);
  if (importMatch) {
    const library = importMatch[1] ?? '';
    if (!allowed.has(library)) {
      return null;
    }
    const aliasMatch = trimmed.match(/\s+as\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/);
    return aliasMatch?.[1] ? `${aliasMatch[1]} = ${library}` : '';
  }
  const fromMatch = trimmed.match(/^from\s+([A-Za-z_][A-Za-z0-9_]*)\s+import\s+(.+?)\s*$/);
  if (fromMatch) {
    const library = fromMatch[1] ?? '';
    if (!allowed.has(library)) {
      return null;
    }
    const imports = (fromMatch[2] ?? '').split(',').map((item) => item.trim()).filter(Boolean);
    if (imports.length === 0) {
      return null;
    }
    const parsedImports: Array<{ name: string; alias: string }> = [];
    for (const item of imports) {
      const itemMatch = item.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?$/);
      if (!itemMatch) {
        return null;
      }
      const name = itemMatch[1] ?? '';
      const alias = itemMatch[2] ?? name;
      parsedImports.push({ name, alias });
    }
    // Resolve every attribute from the module before binding local names. This
    // matters when an imported name shadows the module itself, as in
    // `from datetime import datetime, timedelta`.
    const moduleExpression = parsedImports.some(({ alias }) => alias === library)
      ? `__import__(${JSON.stringify(library)})`
      : library;
    return parsedImports.map(({ name, alias }) => `${alias} = ${moduleExpression}.${name}`).join('\n');
  }
  return null;
}

export function stripPythonImports(source: string, allowedLibraries: readonly string[] = []): string {
  const lines = source.split('\n');
  const stripped: string[] = [];

  let statementOpen = false;
  let bracketDepth = 0;
  let tripleQuote: `'''` | `"""` | null = null;
  let strippingImport = false;

  for (const line of lines) {
    const analysis = analyzePythonLine(line, bracketDepth, tripleQuote);
    const indentation = line.match(/^\s*/)?.[0] ?? '';

    if (!statementOpen && !analysis.isBlankOrComment && isImportStatementStart(line)) {
      const replacement = getAllowedImportReplacement(line, allowedLibraries);
      if (replacement !== null) {
        stripped.push(replacement.split('\n').map((replacementLine) => `${indentation}${replacementLine}`).join('\n'));
        strippingImport = false;
      } else {
        stripped.push(`${indentation}raise RuntimeError(${JSON.stringify(STRIPPED_IMPORT_MESSAGE)})`);
        strippingImport = true;
      }
    } else if (strippingImport) {
      stripped.push('');
    } else {
      stripped.push(line);
    }

    bracketDepth = analysis.bracketDepth;
    tripleQuote = analysis.tripleQuote;

    if (!analysis.isBlankOrComment) {
      statementOpen = tripleQuote !== null || bracketDepth > 0 || analysis.lineContinuation;
    }

    if (strippingImport && !statementOpen) {
      strippingImport = false;
    }
  }

  return stripped.join('\n');
}
