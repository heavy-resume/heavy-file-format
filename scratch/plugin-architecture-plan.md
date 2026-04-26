# Plugin Architecture Plan

## Goal

Create a plugin system on top of the current placeholders by properly
converting the DB Table plugin to the extensible format and adding a new
plugin progress bar. The reference implementation can be embedded in
third-party sites that supply their own plugins (alongside theme, etc.).

## Plugin contract (framework-agnostic)

A plugin is a factory function. It returns an `HTMLElement` that the plugin
fully owns — the host treats it as an opaque div. The plugin attaches its own
event listeners, manages its own state, and interprets its own `block.text`.

```ts
interface HvyPluginContext {
  mode: 'editor' | 'reader';
  block: VisualBlock;            // includes block.text and block.schema.pluginConfig
  document: {
    getHvy(): string;            // serialize current document on demand
  };
  attachments: {
    get(id): DocumentAttachment | null;
    set(id, meta, bytes): void;
    delete(id): void;
    list(): DocumentAttachment[];
  };
  header: {
    get(key): unknown;
    set(key, value): void;
  };
  requestRerender(): void;       // ask host to re-render (e.g. after config change)
}

interface HvyPluginInstance {
  element: HTMLElement;
  unmount?(): void;              // optional — free resources, detach listeners
}

type HvyPluginFactory = (ctx: HvyPluginContext) => HvyPluginInstance;

interface HvyPluginRegistration {
  id: string;                    // e.g. 'dev.heavy.db-table'
  displayName: string;           // shown in selector
  create: HvyPluginFactory;
}
```

Plugins style themselves via the standard CSS theme variables. Nothing is
enforced — just convention.

## Configuration storage

Plugins choose either:
- `block.schema.pluginConfig` — structured JSON (good for numbers, booleans,
  enums). Example: `{ min: 0, max: 100, value: 42, color: '#3b82f6' }`.
- `block.text` — free text the plugin parses itself. Good for templated strings
  (e.g. a label formatter using JS template-literal syntax with backticks:
  `${value}%` evaluated against config).

Both are surfaced when the document is deserialized; the plugin reads what it
needs.

## Host registry

Extend `src/reference-config.ts` to accept a `plugins: HvyPluginRegistration[]`
list. Built-in DB-table registers itself by default. Embedding sites can append
more registrations alongside theme/feature config.

Replace `src/plugins/registry.ts`'s hardcoded `DB_TABLE_PLUGIN_ID` checks with
lookups against this registry. `getAvailableDocumentPlugins()` returns the list
of registrations that are available in the current host.

## Plugin selector (component editor)

In [plugin.ts](../src/editor/components/plugin/plugin.ts):
- Stop auto-picking DB Table.
- Render a `<select>` listing all registered plugins (plus a "— select plugin —"
  placeholder when `block.schema.plugin` is empty).
- On change, set `block.schema.plugin` (new `block-plugin` field handler in
  main.ts) and clear `pluginConfig`/`text`.
- Below the select, mount the plugin's element. If no plugin is selected, show
  a placeholder.

## Mount lifecycle and caching

The editor rebuilds HTML on every `renderApp()`. Live plugin elements must
survive re-render or they lose focus/state and re-instantiate on every
keystroke.

Plan:
- Maintain a per-`(sectionKey, blockId)` cache of `{ pluginId, instance }`.
- On render: emit a placeholder `<div data-plugin-mount data-section-key data-block-id>`.
- After `renderApp()` writes the HTML, walk all `[data-plugin-mount]` nodes:
  - If a cached instance exists for the key with the same `pluginId`, move its
    `element` into the placeholder.
  - Otherwise, instantiate the registered factory, cache it, and insert.
- Reconciliation pass: any cached instance whose mount placeholder no longer
  exists in the DOM is considered orphaned. Call its `unmount?.()` and drop it
  from the cache. This handles deleted blocks, plugin swaps, and document loads.
- On document swap (existing `resetRuntime()`-style flow), unmount everything.

This keeps the plugin "live" across edits to the surrounding document.

## DB-table migration

DB-table stays special internally (it already integrates with AI tools, query
modal, sqlite-row-component modal, attachments, etc.) — but it gets registered
through the new system. Wrap its current string-returning render in a factory
that:
- Builds an element via `document.createElement('div')` + `innerHTML = ...`.
- Returns `{ element, unmount }` where `unmount` clears its scoped view-state
  cache and detaches any frame-scroll listeners.

No breaking changes to DB-table's existing handlers, modals, or AI tools.

## Progress-bar plugin (reference example, NOT in spec)

`src/plugins/progress-bar.ts` — demonstrates a non-trivial third-party-style
plugin without DB-table's complexity.

- Config (`pluginConfig`): `{ min: number, max: number, value: number, color: string }`.
- Text (`block.text`): optional JS template-literal label formatter, e.g.
  `` `${value}%` `` or `` `${value} of ${max}` ``. Empty text = no label.
- **Sandboxing the formatter**: pure JS does not have a real sandbox — `Function`
  and `eval` always see the global scope, so any expression can reach `window`,
  `document`, `fetch`, etc. Mitigations, in increasing isolation:
    1. **Restrictive `Function` wrapper (default)**: build the formatter as
       `new Function('min','max','value', 'with(arguments[3]){return `' + text + '`;}')`
       called with a `Proxy` that returns `undefined` for anything not in the
       allow-list (`min`, `max`, `value`). This blocks bare references to
       `window`/`document` because `with`+Proxy intercepts identifier lookup.
       Still defeatable via `globalThis`/`this` tricks — adequate for
       trusted-author docs, not for adversarial input.
    2. **Worker isolation**: evaluate the formatter inside a Web Worker with
       no `importScripts`. Worker globals exist but no DOM. Heavier, async.
    3. **Sandboxed `<iframe sandbox="allow-scripts">` + postMessage**: full
       origin isolation. Heaviest, async.
  Plan: ship option 1 for the progress bar (synchronous, fast, good enough
  given the document author writes the formatter). Document the limitation in
  code comments. Hosts that need real isolation can swap in option 2/3 later
  via a future plugin-host hook — out of scope for this pass.
- Editor mode: number inputs for min/max/value, color input, textarea for the
  formatter, and a live preview bar.
- Reader mode: just the bar with the centered label.

Tests cover serialization round-trip and label-formatter evaluation.

## Spec changes (HVY-SPEC.md)

Add a "Plugins" section covering:
- How a plugin is referenced from a `plugin` component (`block.schema.plugin`
  is the plugin id).
- Plugin id format / namespacing convention.
- That `block.text` and `block.schema.pluginConfig` are both plugin-defined and
  preserved verbatim by readers.
- That plugins may own attachments (referenced by `block.schema.plugin` id) and
  may write to the document header.
- How hosts install plugins (out-of-band — host code passes plugin
  registrations to the reference reader/editor at startup).

Do NOT mention progress-bar in the spec — it's reference-impl only.

## Implementation order

- [ ] 1. New `src/plugins/types.ts` with the interfaces above.
- [ ] 2. Extend `reference-config.ts` to accept plugin registrations.
- [ ] 3. Rework `src/plugins/registry.ts` to use the host registry.
- [ ] 4. Mount/unmount machinery in main.ts (post-render walk + cache).
- [ ] 5. Wrap DB-table in a factory; register it as default built-in.
- [ ] 6. Update `editor/components/plugin/plugin.ts` to render the selector + mount placeholder.
- [ ] 7. New `src/plugins/progress-bar.ts` and register it as a reference built-in.
- [ ] 8. Wire `block-plugin` field handler.
- [ ] 9. Update HVY-SPEC.md.
- [ ] 10. Tests: progress-bar config round-trip, plugin-selector switching, unmount on
       block deletion.

## Future: scripting component sandbox

A future scripting component lets power users author Python (Brython) inside
the document that mutates the document at load time. Goal: full power over
the doc, zero network access.

**Sandbox**: Brython in a Web Worker.
- Worker has no DOM, no `window`, no `browser` module registered.
- Network primitives nulled at worker bootstrap
  (`self.fetch = self.XMLHttpRequest = self.WebSocket = self.importScripts = undefined`),
  plus CSP `connect-src 'none'` on the worker script.
- `import`/`from` statements regex-rejected before Brython compile;
  `__import__`, `open`, `eval`, `exec` deleted from builtins.
- A single `doc` global is injected — the only way to touch the document.

**Execution model**: snapshot-in, diff-out (sync inside the worker).
- Only the visual doc tree + header are structured-cloned into the worker.
  Attachments are NOT cloned — their bytes can be large (e.g. embedded SQLite).
- All section/block/header edits are synchronous Python. User scripts read
  cleanly: `for section in doc.sections: ...` with no `await` noise.
- Attachment access is the one async surface:
  `bytes = await doc.read_attachment("db")` — bytes are streamed in on demand
  via postMessage. Mutating attachments is similarly async.
- Worker runs the script to completion against its local copy, then posts
  back the mutated doc (or a diff). Main thread applies and renders.

**When it runs**: at document load.
1. Deserialize HVY → in-memory doc.
2. Collect scripting-component blocks in document order.
3. Spin up (or reuse a pooled) worker. Send `{ doc, scripts }` — no
   attachments.
4. Worker executes each script synchronously, awaiting only attachment I/O.
5. Worker returns mutated doc; main thread replaces state and renders.

The whole pipeline is async *to the host* (one `await runScripts(doc)`
during load), but each user script stays synchronous Python. No
mid-edit race conditions because the user isn't typing yet at load time.

**Mitigations**:
- Per-script timeout; main thread `worker.terminate()`s on overrun.
- Staged / preview mode before applying mutations on first run of a doc.

Not implementing now — captured here so the plugin contract leaves room for
async-mounted plugins (the `HvyPluginInstance` shape already permits returning
an element that finishes initializing later).

See [brython-scripting-example.py](brython-scripting-example.py) for the
user-facing API sketch.

## Open questions deferred

- [ ] Whether plugins should be able to register tools for AI editing (DB-table
      does this internally today). Out of scope for this pass.
- [ ] Whether the host can sandbox plugin code (CSP, iframe). Out of scope.
- [ ] Brython-based formatter (Python f-strings, imports stripped) as a stronger
      alternative to the JS Proxy+`with` sandbox. Defer until a second scripted
      plugin appears.
