// Brython wraps host objects and functions as JSObject values. Prevent their
// prototype / function metadata from turning document APIs into JS execution.
export interface BrythonInteropRuntime {
  JSObj: Record<string, (...args: unknown[]) => unknown>;
  builtins: { AttributeError: { $factory(message: string): unknown } };
}

const blockedProperties = new Set([
  'constructor', 'prototype', '__proto__', 'caller', 'callee', 'arguments',
]);

export function installBrythonInteropPolicy(brython: BrythonInteropRuntime): void {
  function guard(name: unknown): void {
    if (typeof name === 'string' && blockedProperties.has(name)) {
      throw brython.builtins.AttributeError.$factory(`HVY scripts cannot access JavaScript property '${name}'.`);
    }
  }
  for (const operation of ['__getattribute__', '__setattr__', '__setitem__', '__delitem__']) {
    const original = brython.JSObj[operation]!;
    brython.JSObj[operation] = function (...args: unknown[]): unknown {
      guard(args[1]);
      return original.apply(this, args);
    };
  }
  // String-key reads already dispatch through JSObj.__getattribute__. Writes
  // need their own wrapper: Brython aliases __setitem__ before this patch.
}
