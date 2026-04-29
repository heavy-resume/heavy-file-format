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

- [x] 1. New `src/plugins/types.ts` with the interfaces above.
- [x] 2. Host-supplied registry on `src/plugins/registry.ts` (`registerHostPlugin`,
       `setHostPlugins`, `getHostPlugins`). Reference-config.ts deferred —
       hosts use the registry directly, simpler to wire.
- [x] 3. Rework `src/plugins/registry.ts` to use the host registry.
- [x] 4. Mount/unmount machinery in `src/plugins/mount.ts` (post-render walk +
       cache + `refresh()` + reconciliation).
- [x] 5. Wrap DB-table in a factory; register as default built-in.
- [x] 6. Update `editor/components/plugin/plugin.ts` to render the selector +
       mount placeholder.
- [x] 7. New `src/plugins/progress-bar.ts` and register as reference built-in.
- [x] 8. Wire `block-plugin` field handler.
- [x] 9. Update HVY-SPEC.md (added §7.4 Plugin installation and selection;
       clarified §7.3 text-body semantics).
- [x] 10. Tests: registry append/dedupe, document-vs-host fallback, progress-bar
       round-trip, plugin swap reset.

## Follow-up issues (round 2)

- [x] 11. Plugin creation is a lock-in flow: empty plugin block shows a
       chooser (select + "Use Plugin" button). After commit, the plugin id is
       fixed for that block — no chooser shown thereafter; to change, delete
       and recreate. The dead `block-plugin` field handler in block-ops.ts
       was removed.
- [x] 12. Chooser now renders in the block-head row (next to the block title)
       via `renderPluginHeaderChooser` exported from the plugin component.
- [x] 13. Focus preservation across `renderApp()` and `refreshReaderPanels()`:
       `capturePluginFocus()` + `restorePluginFocus()` save the focused element
       inside any cached plugin element (and its selection range), then
       re-apply after reconcile reattaches. Note: this only helps when the
       focused element survives the re-render. db-table's `refresh()` rebuilds
       its inner HTML and so loses the reference — fix that by either
       refreshing in place (diff) or skipping refresh while a child is
       focused.
- [ ] 14. DB-table draft-row commit should keep the user in edit mode without
       requiring Done → re-enter to add additional rows. Suspected cause:
       `sqliteAddRow` / `materializeDbTableDraftRow` triggers `renderApp()`
       which rebuilds the plugin's inner HTML; the focused cell is destroyed
       and the draft row disappears. Needs in-browser debugging.

## Scripting plugin (round 3 — landed)

A `dev.heavy.scripting` plugin now exists. Code is held in `block.text` as
Python; on document load (driven by a `lastScriptedDocument` guard inside
`renderApp`) it runs once via Brython 3.14.0, lazy-loaded from CDN.

- [x] Dispatcher: `executeDocumentEditToolByName(name, args, document, onMutation)`
      exported from `ai-document-edit.ts`. Same surface as the AI agent's
      sync tools (request_structure, grep, view_component, get_css,
      get_properties, set_properties, patch_component, create_component,
      remove_component, create_section, remove_section, reorder_section,
      view_header, grep_header, patch_header). `edit_component` (LLM-driven)
      and `query_db_table` (async) are not exposed here.
- [x] Brython lazy-loader (`brython-loader.ts`).
- [x] AST line wrapper: prepends `__hvy_step__()` before every statement,
      recursing into functions, loops, conditionals, try/except, with-blocks.
      Each step bumps a counter; default budget 100 000 lines, raises on
      overflow.
- [x] Python `doc` runtime exposed: `doc.tool(name, args)`, `doc.header.{get,set,remove,keys}`,
      `doc.attachments.{list,read,write,remove}`, `doc.rerender()`.
- [x] Plugin component: code-editor textarea + Help button. Reader mode
      renders nothing visible (scripts are load-time only).
- [x] On-load execution: hook in `renderApp()` runs scripts when the document
      reference changes. `setScriptingResult()` writes status to the editor.
- [x] Help modal: bundled `help.hvy`, deserialized and rendered as collapsible
      `<details>` sections (`expanded:false` → collapsed by default).

Known v1 limitations (deferred):
- [ ] No worker isolation. Network blocking is "by absence" (we don't expose
      `browser.*` to scripts, but a determined script can still
      `from browser import window` and reach `fetch`). The plan to move
      execution into a Web Worker still applies — it's the proper fix.
- [ ] No async / no yield. Scripts run synchronously and may briefly block
      the first paint. Add `await asyncio.sleep(0)` between batches once we
      switch to an async wrapper or worker.
- [ ] No breakpoints. The line-step hook is the obvious place to plumb them.
- [ ] No status/error display in the reader pane (only the editor's status
      strip).
- [ ] Help.hvy is a starter; content needs polishing.

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
