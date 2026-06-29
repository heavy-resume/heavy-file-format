# The HVY File Format

Heavy "HVY" (`.hvy`) is a file format for structured, interactive content designed for information ingestion across different audiences.
PDF template documents use the related `.phvy` extension and restrict authoring to PDF-compatible components.

## Why

The purpose of the HVY file format is to create a document that isn't tied to being printable. It is handling a use case exposed in Heavy Resume that isn't confined to resumes. Essentially:
- You want to provide more information if the audience calls for it
- You want to be able to reorganize or rephrase things depending on the audience
- The client (application that displays it) can be configured to customize and reorganize what the document displays.
- You want an LLM to be able to ingest it without having to ingest the whole thing or likewise have to reinvent a strategy for ingesting the data. Everything has defined, atomic thoughts through explicit sections and components.
- Expandable through plugins.

## Other Benefits

It's not a stretch to take this kind of format and use it for other purposes besides conveying informaton to others. For example, it could double as a personal note taking document or workspace. Extensinsibility with editors, clients, and plugins could easily bridge functionality gaps.

## Standardized Vision

Users are able to add sections and components using a visual editor, through LLM instruction (essentially coding the document), and through a data import.

Expandability and crosslinking make it easy to chase down items of interest.

Users can ask questions to AI and get back answers based on the contents.

Additional data can be recorded off of the display area.

An attached database allows for complex interactions.

Intrinsically offline - capabilities similar to a web page without the need for hosting and with sandbox and security.

Use of JSON and Markdown make it easy for LLMs to parse.

## Reference Implementation Progress

- [X] Create blank documents, with placeholders and templates
- [X] Read from and write HYV / THVY files
- [X] Color scheme and override support
- [X] Color scheme editor and cleanup
- [X] AI-based answering questions
- [X] AI-based editing
- [X] Embedded / attached database runtime
- [X] Plugin block schema and DB table tail spec draft
- [X] Image component
- [X] Plugin execution/runtime
- [X] Sandboxed scripting component (throttled, max lines)
- [ ] Form component

## Draft Spec

- [HVY Specification v0.1 Draft](HVY-SPEC.md)

## Examples

- [Example HVY Document](examples/example.hvy)
- [CRM Example HVY Document](examples/crm.hvy)
- [Study Tools Example](examples/study-tools.hvy)
- [PDF Template Example (PHVY)](examples/pdf-template.phvy)
- [Example Resume Template (THVY)](examples/resume.thvy)
- [Example Resume (HVY)](examples/resume.hvy)
- [Embedded Plugin Text Editor Example](examples/embed-text-editor-plugin.html)

## TypeScript Reference Implementation

A browser-based reference app is included with:
- `Visual Editor`: click to add sections, nested sections, and text blocks.
- `Schema Mode`: per-block advanced settings (component, alignment, left/center/right slot).
- `Reader`: expandable sections, navigation by section ID, and section meta styling.
- `Download`: save the current editor buffer as a local file.
- `Select File`: pick a local file and display it immediately.

Reference app feature flags:
- Set `window.HVY_REFERENCE_CONFIG = { features: { tables: false } }` before the bundle loads to disable table authoring/rendering in an embedded host.
- Set `window.HVY_REFERENCE_CONFIG = { aiEditor: { doubleClickDelayMs: 400 } }` to tune how long AI mode waits before running single-click reader actions, leaving room for double-click edit gestures.
- Set `window.HVY_REFERENCE_CONFIG = { semanticFilterProvider }` or pass `semanticFilterProvider` to an embedded mount to enable AI-backed semantic filtering in the Filter panel.
- When present, DB table tail payloads are now preserved on open/download for `.hvy` files.

Reference app reader view filters are implementation-only and are not serialized into `.hvy` / `.thvy` / `.phvy` files. A filter is a JSON object mapping section/component IDs, or CLI-style virtual paths such as `/body/tools-technologies`, to modifiers:
- `highlight`: adds reader highlight styling and expands/prioritizes parent containers.
- `priority`: expands/prioritizes the target and its parent containers without adding the visual highlight.
- `collapse`: forces a collapsed reader preview where practical.
- `dimmed`: visually dims the target and moves it after non-dimmed siblings while preserving dimmed relative order; clicking/tapping activates the target visually without moving it.
- `hidden`: omits the target and wins over visible modifiers.

Priority affects ordering only for sections and component-list items, preserving the authored order of ordinary block containers so headers and context stay with their content. Invalid reader-view targets warn in the console. The resume reference app includes two faux role filters in [`examples/resume-views.json`](examples/resume-views.json), exposed by `TypeScript View`, `LLM Engineer View`, and `No View` buttons next to the reader preview controls when the Resume Example is selected.

### Run

```bash
npm install
npm run dev
```

Open the local Vite URL shown in terminal.

The CLI harness can load any HVY document for node-based inspection:

```bash
node scripts/hvy-cli.mjs --file examples/resume.hvy -- "find /body/tools-technologies"
```

For AI document chat in local development, configure provider credentials in `.env` for the local proxy:

```bash
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...

VITE_HVY_CHAT_PROVIDER=openai
VITE_HVY_CHAT_MODEL=gpt-5.4-mini
```

Notes:
- The browser only sees provider/model defaults.
- API keys are consumed by the isolated local proxy in [`proxy/chat-proxy.ts`](proxy/chat-proxy.ts).
- `VITE_OPENAI_API_KEY` / `VITE_ANTHROPIC_API_KEY` are still accepted as a dev fallback, but `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` are preferred so keys are not exposed to the client bundle.

### Run In VS Code

VS Code configuration is included:
- Launch configs:
  - `HVY: Full Stack` (recommended)
  - `HVY: Start Dev Server`
  - `HVY: Open In Chrome`
- Tasks:
  - `Install Dependencies`
  - `Run Reference App (Vite)`
  - `Build Reference App`

Recommended first run:
1. Run task `Install Dependencies`.
2. Start launch config `HVY: Full Stack`.

### Build

```bash
npm run build
npm run preview
```

### Hosted Viewer With Static Image Assets

For web hosting, extract a `.hvy` into a small document body plus static
attachment files. This avoids downloading large image tails during the initial
page load:

```bash
npm run docker:hosted -- examples/example.hvy my-hvy-viewer:latest
docker run --rm -p 8080:8080 my-hvy-viewer:latest
```

When iterating on a document and reusing the same image tag, pass `--no-cache`
through the script to force Docker to rebuild every layer:

```bash
npm run docker:hosted -- --no-cache examples/example.hvy my-hvy-viewer:latest
```

For Cloud Run or other `linux/amd64` hosts, build and push with the registry
tag in one command:

```bash
npm run docker:hosted -- --no-cache --push examples/example.hvy REGISTRY_HOST/PROJECT/REPOSITORY/my-hvy-viewer:latest
```

The image serves the viewer at `http://localhost:8080`.

To inspect or host the extracted static files directly:

```bash
npm run extract:hosted -- examples/example.hvy --out dist-hvy-viewer
```

The output is static-server friendly:

```text
dist-hvy-viewer/
  document.hvy
  attachments.json
  preview.json
  image/<encoded image filename>
```

The reusable viewer image can also mount an extracted directory at `/site`:

```bash
docker build -t hvy-hosted-viewer .
docker run --rm -p 8080:8080 -v "$PWD/dist-hvy-viewer:/site:ro" hvy-hosted-viewer
```

The viewer loads `document.hvy` and `attachments.json` first, then resolves
regular image and carousel attachments through the manifest so images are fetched
from `./image/...` only when the browser/component needs them.

Built-in plugin objects are selected at build time from `hvy.build.json`. The
default config includes every bundled plugin in the output file, but plugins are
not enabled automatically:

```json
{
  "plugins": [
    "hvy.db-table",
    "hvy.form",
    "hvy.progress-bar",
    "hvy.scripting",
    "hvy.graph",
    "hvy.diagram",
    "hvy.qr-code"
  ]
}
```

Use `HVY_BUILD_PLUGINS=hvy.form,hvy.progress-bar npm run build` for
a one-off override, or `HVY_BUILD_CONFIG=path/to/config.json` to point at another
config file. Config files may also use `include` and `exclude` arrays with the
same plugin ids.

If you build the embedded library from source or copy the Vite setup into another
host build, include `createBrythonMinimalVfsPlugin()` from
`heavy-file-format-ref-impl/brython-minimal-vfs-plugin` (or from
`src/plugins/scripting/brython-minimal-vfs-plugin.ts` inside this repo). The
scripting runtime imports `brython/brython.min.js?raw` and
`virtual:hvy-brython-minimal-vfs`; the virtual VFS intentionally includes only
`browser` and `sys`. Checked libraries such as `random` and `re` are provided by
the HVY scripting shim, so do not add Brython's real `re`, `python_re`, `enum`,
or wider stdlib dependency graph to make checked `import re` work.

Embedded hosts enable plugins per mount:

```js
HVY.mountHvy({
  root,
  document,
  plugins: [HVY.plugins.progressBar],
});
```

Editor and AI mounts resize large uploaded JPEG, PNG, and WebP image attachments
to fit within 2048 x 2048 pixels by default. Hosts can override the bound, or
disable resizing with `null`:

```js
HVY.mountHvy({
  root,
  document,
  mode: 'editor',
  imageAttachmentMaxDimensions: { width: 1600, height: 1200 },
});
```

Embedded hosts can download the current mounted document as a complete `.hvy`
byte stream, including attachments, through the mount handle:

```js
const mount = HVY.mountHvy({ root, document, mode: 'editor' });
const bytes = mount.serializeDocumentBytes();
```

Hosts that keep attachments outside the in-memory HVY document can provide an
attachment adapter. For example, a static site can resolve image attachments to
pre-published files without loading the image bytes into the client:

```js
HVY.mountHvyViewer({
  root,
  document,
  attachmentStore: {
    list() {
      return [
        { id: 'image:hero.png', meta: { mediaType: 'image/png' }, length: 48192 },
      ];
    },
    recall(id) {
      return fetch(`/assets/hvy/${encodeURIComponent(id)}`).then((response) => response.arrayBuffer());
    },
    store() {},
    remove() {},
    resolveUrl(id) {
      return id === 'image:hero.png' ? '/assets/hvy/hero.png' : null;
    },
  },
});
```

Hosts can also use async serialization when attachment recall or final byte
assembly belongs to another runtime, such as a local/native serializer:

```js
const mount = HVY.mountHvy({ root, document, mode: 'editor', attachmentStore, serializer: {
  serializeDocumentBytes(request) {
    return nativeHvySerializer.save({
      textBody: request.textBody,
      tail: request.tail,
      readAttachment: request.recallAttachment,
    });
  },
} });

const bytes = await mount.serializeDocumentBytesAsync();
```

Encrypted documents and encrypted components use Fernet keys supplied by the
embedded host. Keys are addressed by UUID; the host should persist its own
UUID-to-key map and pass it as a keyring when deserializing or mounting:

```js
const keyring = {
  '00000000-0000-4000-8000-000000000000': 'fernet-url-safe-base64-key',
};

const document = await HVY.deserializeDocumentBytesAsync(bytes, '.hvy', {
  encryption: { keyring },
});

const mount = HVY.mountHvy({
  root,
  document,
  mode: 'editor',
  encryption: {
    keyring,
    onKeyGenerated({ keyId, key }) {
      keyring[keyId] = key;
    },
  },
});

const generated = await mount.encryptComponentAsync(sectionKey, blockId);
keyring[generated.keyId] = generated.key;
const savedBytes = await mount.serializeDocumentBytesAsync();
```

Whole-document encryption wraps the serialized HVY byte stream in an encrypted
envelope. Use the async byte APIs for encrypted documents:

```js
const generated = await mount.encryptDocumentAsync();
keyring[generated.keyId] = generated.key;
const encryptedBytes = await mount.serializeDocumentBytesAsync();
```

Editor, AI, and import mutations can also notify hosts when the mounted
document changes relative to the last saved baseline:

```js
const mount = HVY.mountHvy({
  root,
  document,
  mode: 'editor',
  onDocumentChange(event) {
    console.log(event.dirty, event.source, event.reason);
  },
});

await saveDocument(mount.serializeDocumentBytes());
mount.markSaved();

// Hosts can also route their own undo/redo controls through the mounted editor.
mount.undo();
mount.redo();
```

Embedded editor/AI instances do not persist reconnect/reload session state by
default. Set `persistSessionState: true` to opt in. Pass a stable `storageKey`
per instance to persist without sharing a `sessionStorage` bucket:

```js
HVY.mountHvy({
  root,
  document,
  mode: 'editor',
  storageKey: 'customer-profile-editor',
  persistSessionState: true,
});
```

Without `persistSessionState`, `storageKey` is only a name available to hosts and
does not cause HVY to write document state during reload lifecycle events.

Third-party plugins use the same `HvyPlugin` shape and can be mixed with bundled
plugins:

```js
HVY.mountHvy({
  root,
  document,
  plugins: [customPlugin, HVY.plugins.form],
});
```

Embedded hosts can observe rendered reader links asynchronously and return how
the link should be rendered. Use this for URL validation, safe-link
interstitials, previews, or host-specific routing:

```js
HVY.mountHvyViewer({
  root,
  document,
  async linkObserver(link) {
    if (!link.external) return null;
    const safeUrl = `/safe-link?url=${encodeURIComponent(link.href)}`;
    return {
      href: safeUrl,
      rel: 'noopener noreferrer',
      attributes: { 'data-original-url': link.href },
    };
  },
});
```

Return `{ html }` to replace the rendered link with sanitized HTML, or return
`null` / `undefined` to keep the default rendering.

Embedded hosts can also enable semantic filtering by providing a callback that
selects candidate IDs from the AI-friendly request packet:

```js
HVY.mountHvyViewer({
  root,
  document,
  async semanticFilterProvider(request) {
    const response = await llm.complete(request.instructionPrompt);
    return JSON.parse(response).matches;
  },
});
```

The request includes structured `candidates` and a deterministic
`instructionPrompt`; hosts should return only candidate IDs supplied by the
request.

Hosts can also search across many HVY documents without mounting them. Keyword
mode uses the built-in search provider unless a host supplies one. Semantic mode
builds one cross-document candidate packet and requires a semantic provider:

For a single mounted document filter, use the same public filter snapshot helper
that mirrors the reference reader Filter UI. This is the best API when an
embedding host wants to apply or debug a document-level filter without changing
the candidate IDs or prompt shape through the multi-document search route:

```js
const snapshot = await HVY.createDocumentFilterSnapshot({
  document,
  query: 'Find implementation experience',
  mode: 'semantic',
  view: 'viewer',
  filterMode: 'hide',
  async semanticFilterProvider(request) {
    const response = await llm.complete(request.instructionPrompt);
    return JSON.parse(response).matches;
  },
});

mount.setSearchSnapshot(snapshot);
```

```js
const response = await HVY.searchDocuments({
  query: 'Find implementation experience',
  mode: 'semantic',
  documents: [
    { documentId: 'resume', documentTitle: 'Resume', document: resumeDocument },
    { documentId: 'portfolio', documentTitle: 'Portfolio', document: portfolioDocument },
  ],
  async semanticFilterProvider(request) {
    const response = await llm.complete(request.instructionPrompt);
    return JSON.parse(response).matches;
  },
});

for (const result of response.results) {
  console.log(result.documentId, result.targetKind, result.sectionKey, result.blockId);
}

const selectedSnapshot = HVY.createDocumentSearchSnapshot(response, 'resume', {
  filterMode: 'hide',
});

const mount = HVY.mountHvyViewer({
  root,
  document: resumeDocument,
  searchSnapshot: selectedSnapshot,
});

// Or apply a later meta-app selection without remounting the document.
mount.setSearchSnapshot(selectedSnapshot);
```

Embedded hosts can run AI import as a reviewable two-stage flow. First build a
plan, show the returned steps to the user, then pass the approved steps into the
import call:

```js
const plan = await mount.buildImportPlan({
  sourceName: file.name,
  sourceText,
  llm,
});

if (plan.status === 'ready') {
  for (const step of plan.steps) {
    console.log(step.sectionTitle, step.extractedInformation);
  }

  await mount.importFromText({
    sourceName: file.name,
    sourceText,
    steps: plan.steps.filter((step) => userApproved(step)),
    llm,
  });
}
```

Set `newSectionsOnly: true` on both calls when import should append blank
sections or instantiate reusable section templates without replacing existing
body sections. Individual body sections can also set `protect_from_import: true`
in section metadata to prevent import from modifying that section.

Import calls can use different models for different pipeline stages. Any omitted
stage falls back to `llm.settings`:

```js
const llm = {
  settings: { provider: 'openai', model: 'gpt-5.4-mini' },
  stages: {
    sectionPlanner: { provider: 'openai', model: 'gpt-5.4-mini' },
    templateSectionWriter: { provider: 'openai', model: 'gpt-5.4' },
    rawSectionWriter: { provider: 'openai', model: 'gpt-5.4' },
    xrefs: { provider: 'openai', model: 'gpt-5.4-mini' },
  },
  client: chatClient,
};
```

For templates with `importPreplan`, `extractedInformation` is already populated
during planning. That makes it suitable for a review popover or detail drawer,
for example to catch a section whose source facts belong somewhere else before
the import mutates the document.

## Notes

- Markdown is treated as valid HVY.
- Section IDs are configurable and navigable via `#id` links.
- Expand/collapse is implemented in the client (plus/minus control in reader).
- Section meta supports section-level CSS editing with outside click to close.
- Sections support persistent highlight and temporary highlight on navigation.

# Plugin / Callback Support

HVY has a documented plugin block envelope plus a first plugin contract for `hvy.db-table`.

- The plugin instance is authored as a `plugin` component with `plugin` and `pluginConfig`.
- The current built-in DB table implementation uses a gzip-compressed SQLite tail payload appended after the textual HVY body.
- The current reference app can author and round-trip the plugin metadata, but it does not yet read or write the binary tail runtime.
- Plugin editor UIs can reuse the host text editor with `ctx.textEditor.mount({ value, onChange })`. The returned element uses the same rich text toolbar, Markdown conversion, paste handling, and caret-preserving input behavior as normal HVY text components; plugins remain responsible for persisting changes through `ctx.setText`, `ctx.setConfig`, or their own `onChange` callback.
- See [`examples/embed-text-editor-plugin.html`](examples/embed-text-editor-plugin.html) for an isolated embedded editor that places a normal text component next to a plugin using `ctx.textEditor.mount(...)` and `ctx.setText(...)`.
