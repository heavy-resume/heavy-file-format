import { getBrython } from './brython-loader';

interface BrythonValueConverter {
  builtins: Record<string, unknown>;
  pyobj2jsobj?: (pythonValue: unknown) => unknown;
}

function isHostPrimitive(value: unknown): boolean {
  return value === null
    || typeof value === 'undefined'
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
    || typeof value === 'bigint';
}

/**
 * Converts values leaving Brython into values owned by the JavaScript host.
 * Brython's built-in converter handles Python containers and callables, while
 * this layer closes its remaining gaps: Python None, recursive capability
 * results, and values produced later by converted functions or coroutines.
 */
export function normalizeBrythonHostValue(
  value: unknown,
  seen = new WeakMap<object, unknown>()
): unknown {
  if (isHostPrimitive(value)) return value;
  const brython = getBrython() as ReturnType<typeof getBrython> & BrythonValueConverter;
  if (value === brython.builtins.None) return null;

  const converted = typeof brython.pyobj2jsobj === 'function'
    ? brython.pyobj2jsobj(value)
    : value;
  if (converted === brython.builtins.None) return null;
  if (isHostPrimitive(converted)) return converted;
  if (
    (typeof converted === 'object' || typeof converted === 'function')
    && typeof (converted as PromiseLike<unknown>).then === 'function'
  ) {
    return Promise.resolve(converted).then((resolved) => normalizeBrythonHostValue(resolved, seen));
  }
  if (typeof converted === 'function') {
    const existing = seen.get(converted);
    if (existing) return existing;
    const wrapped = function (this: unknown, ...args: unknown[]) {
      return normalizeBrythonHostValue(converted.apply(this, args));
    };
    seen.set(converted, wrapped);
    return wrapped;
  }
  if (!converted || typeof converted !== 'object') return converted;
  const existing = seen.get(converted);
  if (existing) return existing;
  if (Array.isArray(converted)) {
    const normalized: unknown[] = [];
    seen.set(converted, normalized);
    normalized.push(...converted.map((entry) => normalizeBrythonHostValue(entry, seen)));
    return normalized;
  }
  if (Object.getPrototypeOf(converted) !== Object.prototype) return converted;
  const normalized: Record<string, unknown> = {};
  seen.set(converted, normalized);
  for (const [key, entry] of Object.entries(converted)) {
    normalized[key] = normalizeBrythonHostValue(entry, seen);
  }
  return normalized;
}

export function normalizeBrythonHostArguments(values: readonly unknown[]): unknown[] {
  return values.map((value) => normalizeBrythonHostValue(value));
}
