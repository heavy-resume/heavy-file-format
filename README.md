# heavy-file-format

Heavy "HVY" (`.hvy`) is a Markdown-compatible file format for structured, interactive content ingestion by humans and AI.

## Draft Spec

- [HVY Specification v0.1 Draft](docs/HVY-SPEC.md)

## Examples

- [Example HVY Document](examples/example.hvy)
- [Example Template (THVY)](examples/template.thvy)

## TypeScript Reference Implementation

A browser-based reference app is included with:
- `Visual Editor`: click to add sections, nested sections, and text blocks.
- `Schema Mode`: per-block advanced settings (component, alignment, left/center/right slot).
- `Reader`: expandable sections, navigation by section ID, and modal context styling.
- `Download`: save the current editor buffer as a local file.
- `Select File`: pick a local file and display it immediately.

### Run

```bash
npm install
npm run dev
```

Open the local Vite URL shown in terminal.

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
- Modal context supports section-level CSS editing with outside click to close.
- Sections support persistent highlight and temporary highlight on navigation.
