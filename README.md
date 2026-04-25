# The HVY File Format

Heavy "HVY" (`.hvy`) is a file format for structured, interactive content designed for information ingestion across different audiences.

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
- [ ] Image component
- [ ] Plugin execution/runtime
- [ ] Sandboxed scripting component (throttled, max lines)
- [ ] Form component

## Draft Spec

- [HVY Specification v0.1 Draft](HVY-SPEC.md)

## Examples

- [Example HVY Document](examples/example.hvy)
- [CRM Example HVY Document](examples/crm.hvy)
- [Example Resume Template (THVY)](examples/resume.thvy)
- [Example Resume (HVY)](examples/resume.hvy)

## TypeScript Reference Implementation

A browser-based reference app is included with:
- `Visual Editor`: click to add sections, nested sections, and text blocks.
- `Schema Mode`: per-block advanced settings (component, alignment, left/center/right slot).
- `Reader`: expandable sections, navigation by section ID, and section meta styling.
- `Download`: save the current editor buffer as a local file.
- `Select File`: pick a local file and display it immediately.

Reference app feature flags:
- Set `window.HVY_REFERENCE_CONFIG = { features: { tables: false } }` before the bundle loads to disable table authoring/rendering in an embedded host.
- When present, DB table tail payloads are now preserved on open/download for `.hvy` files.

### Run

```bash
npm install
npm run dev
```

Open the local Vite URL shown in terminal.

For AI document chat in local development, configure provider credentials in `.env` for the local proxy:

```bash
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...

VITE_HVY_CHAT_PROVIDER=openai
VITE_HVY_CHAT_MODEL=gpt-5-mini
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

## Notes

- Markdown is treated as valid HVY.
- Section IDs are configurable and navigable via `#id` links.
- Expand/collapse is implemented in the client (plus/minus control in reader).
- Section meta supports section-level CSS editing with outside click to close.
- Sections support persistent highlight and temporary highlight on navigation.

# Plugin / Callback Support

HVY has a documented plugin block envelope plus a first plugin contract for `dev.heavy.db-table`.

- The plugin instance is authored as a `plugin` component with `plugin` and `pluginConfig`.
- The current built-in DB table implementation uses a gzip-compressed SQLite tail payload appended after the textual HVY body.
- The current reference app can author and round-trip the plugin metadata, but it does not yet read or write the binary tail runtime.
