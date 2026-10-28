// Names that reach JavaScript's object model (for example `constructor` leads to
// `Function`). They are blocked as attributes on every object, Python or
// JavaScript-backed, and as item keys on JavaScript-backed objects.
export const BLOCKED_ATTRIBUTE_NAMES: ReadonlySet<string> = new Set([
  'constructor', 'prototype', '__proto__', 'caller', 'callee', 'arguments',
]);

export interface BrythonInteropRuntime {
  JSObj: Record<string, (...args: unknown[]) => unknown>;
  builtins: { AttributeError: { $factory(message: string): unknown } };
  hvyBlockedAttributeNames?: ReadonlySet<string>;
  hvyBlockedAttributeError?: (name: string) => unknown;
}

export function installBrythonInteropPolicy(brython: BrythonInteropRuntime): void {
  const blockedAttributeError = (name: string): unknown =>
    brython.builtins.AttributeError.$factory(`HVY scripts cannot access the '${name}' attribute.`);
  // Consulted by Brython's $getattr / $setattr / delattr (brython-source-patches.ts).
  brython.hvyBlockedAttributeNames = BLOCKED_ATTRIBUTE_NAMES;
  brython.hvyBlockedAttributeError = blockedAttributeError;
  // JavaScript-backed objects also expose properties as items (`obj["constructor"]`),
  // which Brython routes through JSObj rather than $getattr.
  for (const operation of ['__getattribute__', '__setattr__', '__setitem__', '__delitem__']) {
    const original = brython.JSObj[operation]!;
    brython.JSObj[operation] = function (...args: unknown[]): unknown {
      const name = args[1];
      if (typeof name === 'string' && BLOCKED_ATTRIBUTE_NAMES.has(name)) {
        throw blockedAttributeError(name);
      }
      return original.apply(this, args);
    };
  }
}
