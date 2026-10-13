# Scripting Plugin

This directory contains the built-in HVY scripting plugin.

The plugin lets a `plugin` block run Python code in the browser via Brython.
The script body lives in the block text, while plugin-specific metadata lives
in `block.schema.pluginConfig`.

## Files

- `scripting.ts`: plugin mount UI for editor and reader modes
- `scripting.css`: editor and reader styling for the plugin
- `wrapper.ts`: script preparation, version checks, Brython execution, and error cleanup
- `runtime.ts`: restricted runtime surface exposed to user scripts as `doc`
- `brython-loader.ts`: lazy-loads the locally bundled Brython runtime on first execution
- `help.hvy` / `help-modal.ts`: user-facing help content and modal
- `version.ts`: supported scripting plugin version constant and helpers

## Runtime Model

- Scripts do not execute in `editor` view.
- Scripts execute in `viewer` and document `ai` view.
- `viewer` may hide the source code while still running the script.
- Document `ai` view should still show the code preview and also mount the
  scripting reader UI so errors can be surfaced there.

Execution is kicked off from the app layer in `src/main.ts`, not from the
plugin mount itself.

## Brython Notes

The runtime intentionally avoids Brython AST mutation. The current flow is:

1. Check the original source with the shared lexical policy used by lint and `eval`.
2. Strip unchecked Python `import` statements before execution.
3. Wrap the source in a generated function so `return` can stop the script early.
4. Prefer `sys.settrace()` for line counting.
5. Fall back to host-side source instrumentation when tracing is unavailable.

This was chosen because Brython AST rewriting proved brittle for some compare
expressions during `compile(...)`.

Document scripts use `createBrythonMinimalVfsPlugin()` to provide Brython with a tiny
virtual filesystem containing only `browser` and `sys`. Keep checked libraries
such as `random`, `re`, and `datetime` in `wrapper.ts` shims instead of bundling Brython's
real stdlib modules such as `re`, `python_re`, or `enum`; otherwise checked
imports can expose a larger module object graph than the restricted environment intends.

Installed format-0.2 Python plugin packages use a separate unrestricted
adapter. Their requested `random`, `re`, and `datetime` modules and dependency
closures are split into a lazy VFS payload. The JavaScript interop property guard
applies to the shared Brython runtime, including those packages.

Brython resolves native builtins even with a restricted `__builtins__` dictionary.
The wrapper therefore installs `open`, `type`, `object`, `vars`, `locals`,
`compile`, `exec`, `breakpoint`, `input`, `help`, and `memoryview` as user
globals bound to stubs that raise when called. Ordinary Python scoping still lets
scripts use those names for methods, parameters, and locals; only loads that fall
through to the global scope reach a stub. These are runtime checks, not lexical ones.

The lexical policy rejects private names containing double underscores in identifiers and decoded
string literals, including recursively scanned f-string replacement fields.
Identifiers are NFKC-normalized. The exceptions are `__init__`, `__name__`,
`__main__`, and definition names immediately after `def` or `class`.

Guarded `getattr`, `hasattr`, `setattr`, and `delattr` reject computed private names
with the same three exceptions. Attribute names and `eval` expressions are
copied from string subclasses through the base string operation, so user
conversion overrides cannot disguise the text being checked. `eval` accepts string
expressions only, checks them with the source policy, and rejects custom globals or locals. `global`
declarations cannot replace or delete `getattr`, `setattr`, `delattr`, `hasattr`,
`eval`, `globals`, or any of the restricted builtin stubs. These guards are placed explicitly in user globals rather
than relying on the builtins dictionary.

JavaScript object reads, writes, and deletions deny `constructor`, `prototype`,
`__proto__`, `caller`, `callee`, and `arguments`, including computed string keys.
Ordinary Python classes, descriptors, and public attribute operations remain
supported. Concrete capability chains are covered in
`tests/cli-plugin-integration.spec.ts` and tokenizer cases in
`tests/script-source-policy.unit.spec.ts`.

These checks harden the shared-realm implementation; they do not provide process
isolation. A dynamically constructed `str.format` field can still read attributes
into a string, and component handles expose document data that may bypass mutation
tracking. Neither behavior is addressed by this source policy.

Brython also emits a noisy console line in some failure paths:

- `method from func w-o $infos ...`

`wrapper.ts` suppresses that specific noise while leaving normal console output
alone.

## Error Handling

Reader-mode scripting errors are shown inline below the scripting block, not as
an overlay/popover.

The wrapper returns:

- `error`: concise summary for inline status text
- `errorDetail`: cleaned traceback for detailed display

Tracebacks intentionally hide wrapper frames like the internal `exec(...)`
bridge so the user mostly sees their script frame.

If the block has a component id (`block.schema.id`), that id is used as the
trace label instead of the generic `hvy-script`.

## Versioning

The supported client version is defined in `version.ts` as a single constant:

- `SCRIPTING_PLUGIN_VERSION = "0.2"`

Per-block scripting version lives in:

- `block.schema.pluginConfig.version`

If a document asks for a newer scripting plugin version than the client
supports, execution is refused before Brython runs and the mismatch is surfaced
as the script error.

This is block-level plugin metadata, not document-level plugin declaration
metadata.

## Example

```hvy
<!--hvy:plugin {"plugin":"hvy.scripting","pluginConfig":{"version":"0.2"}}-->
doc.header.set("last_viewed", "from python!")
```

Version `0.2` also preserves callable values nested in
`doc.plugins.call(..., args)`. Plugins may invoke them synchronously or later;
delayed callbacks resume the originating script guards and are discarded when
the document or mount is gone. Version `0.1` blocks remain supported.
