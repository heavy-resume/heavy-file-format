# Scripting Plugin

This directory contains the built-in HVY scripting plugin.

The plugin lets a `plugin` block run Python code in the browser via Brython.
The script body lives in the block text, while plugin-specific metadata lives
in `block.schema.pluginConfig`.

## Files

- `scripting.ts`: plugin mount UI for editor and reader modes
- `scripting.css`: editor and reader styling for the plugin
- `wrapper.ts`: script preparation, version checks, Brython execution, and error cleanup
- `runtime.ts`: sandboxed runtime surface exposed to user scripts as `doc`
- `brython-loader.ts`: lazy-loads Brython from CDN on first execution
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

1. Strip Python `import` statements before execution.
2. Prefer `sys.settrace()` for line counting.
3. Fall back to host-side source instrumentation when tracing is unavailable.

This was chosen because Brython AST rewriting proved brittle for some compare
expressions during `compile(...)`.

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

- `SCRIPTING_PLUGIN_VERSION = "0.1"`

Per-block scripting version lives in:

- `block.schema.pluginConfig.version`

If a document asks for a newer scripting plugin version than the client
supports, execution is refused before Brython runs and the mismatch is surfaced
as the script error.

This is block-level plugin metadata, not document-level plugin declaration
metadata.

## Example

```hvy
<!--hvy:plugin {"plugin":"dev.heavy.scripting","pluginConfig":{"version":"0.1"}}-->
doc.header.set("last_viewed", "from python!")
```
