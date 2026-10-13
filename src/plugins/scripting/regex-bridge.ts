// JavaScript side of the checked `re` library shim (python/re-shim.py).
interface HvyScriptingRegexMatch {
  matched: boolean;
  captureCount(): number;
  captureAt(index: number): string | null;
  index: number;
  end: number;
}

interface HvyScriptingRegexFindAllResult {
  count(): number;
  isTuple(index: number): boolean;
  tupleCount(index: number): number;
  valueAt(index: number, groupIndex: number): string | null;
}

interface HvyScriptingRegexSplitResult {
  count(): number;
  valueAt(index: number): string;
}

export interface HvyScriptingRegexBridge {
  exec(pattern: string, flags: string, source: string): HvyScriptingRegexMatch;
  findall(pattern: string, flags: string, source: string): HvyScriptingRegexFindAllResult;
  sub(pattern: string, flags: string, replacement: string, source: string, count: number): string;
  split(pattern: string, flags: string, source: string, maxsplit: number): HvyScriptingRegexSplitResult;
}

function normalizeRegexFlags(flags: string, globalSearch: boolean): string {
  const out = new Set<string>();
  for (const flag of flags) {
    if (flag === 'g') {
      continue;
    }
    out.add(flag);
  }
  if (globalSearch) {
    out.add('g');
  }
  return Array.from(out).join('');
}

function createRegex(pattern: string, flags: string, globalSearch: boolean): RegExp {
  return new RegExp(pattern, normalizeRegexFlags(flags, globalSearch));
}

export function createScriptingRegexBridge(): HvyScriptingRegexBridge {
  return {
    exec(pattern, flags, source) {
      const regex = createRegex(pattern, flags, true);
      const match = regex.exec(source);
      if (!match) {
        return { matched: false, captureCount: () => 0, captureAt: () => null, index: -1, end: -1 };
      }
      const captures = Array.from(match, (value) => value ?? null);
      return {
        matched: true,
        captureCount: () => captures.length,
        captureAt: (index) => captures[Math.trunc(index)] ?? null,
        index: match.index,
        end: match.index + match[0].length,
      };
    },
    findall(pattern, flags, source) {
      const regex = createRegex(pattern, flags, true);
      const out: Array<string | null | Array<string | null>> = [];
      let match: RegExpExecArray | null;
      while ((match = regex.exec(source)) !== null) {
        if (match.length > 2) {
          out.push(match.slice(1).map((value) => value ?? null));
        } else if (match.length === 2) {
          out.push(match[1] ?? null);
        } else {
          out.push(match[0]);
        }
        if (match[0] === '') {
          regex.lastIndex += 1;
        }
      }
      return {
        count: () => out.length,
        isTuple: (index) => Array.isArray(out[Math.trunc(index)]),
        tupleCount: (index) => {
          const item = out[Math.trunc(index)];
          return Array.isArray(item) ? item.length : 1;
        },
        valueAt: (index, groupIndex) => {
          const item = out[Math.trunc(index)];
          if (Array.isArray(item)) {
            return item[Math.trunc(groupIndex)] ?? null;
          }
          return item ?? null;
        },
      };
    },
    sub(pattern, flags, replacement, source, count) {
      const limit = Math.floor(Number.isFinite(count) ? count : 0);
      if (limit <= 0) {
        return source.replace(createRegex(pattern, flags, true), replacement);
      }
      let replaced = 0;
      return source.replace(createRegex(pattern, flags, true), (match) => {
        if (replaced >= limit) {
          return match;
        }
        replaced += 1;
        return replacement;
      });
    },
    split(pattern, flags, source, maxsplit) {
      const limit = Math.floor(Number.isFinite(maxsplit) ? maxsplit : 0);
      if (limit <= 0) {
        const parts = source.split(createRegex(pattern, flags, true));
        return {
          count: () => parts.length,
          valueAt: (index) => parts[Math.trunc(index)] ?? '',
        };
      }
      const out: string[] = [];
      const regex = createRegex(pattern, flags, true);
      let cursor = 0;
      let splitCount = 0;
      let match: RegExpExecArray | null;
      while (splitCount < limit && (match = regex.exec(source)) !== null) {
        out.push(source.slice(cursor, match.index));
        cursor = match.index + match[0].length;
        splitCount += 1;
        if (match[0] === '') {
          regex.lastIndex += 1;
        }
      }
      out.push(source.slice(cursor));
      return {
        count: () => out.length,
        valueAt: (index) => out[Math.trunc(index)] ?? '',
      };
    },
  };
}
