# Heavy File Format (HVY) v0.1 Draft

Status: Draft proposal  
Last updated: 2026-06-11

## 1. Overview

Heavy (`.hvy`) is a Markdown-compatible document format for interactive and structured content ingestion by humans and AI systems.

Design goals:
- Keep plain Markdown valid as HVY with zero changes.
- Add structure for atomic thoughts, nesting, and metadata.
- Support CSS and web rendering in safe/offline-first clients.
- Support template documents that can be filled in via `.thvy` files.
- Support PDF template documents via `.phvy` files.
- Support extensibility via plugins.
- Support whole-document and component-level encryption without changing the reusable component model.

## 2. File Types

- `.hvy`: Concrete content document.
- `.thvy`: Template document. Identical to `.hvy` except for extension and media type.
- `.phvy`: PDF template document. Uses HVY syntax with PDF-safe authoring constraints.

Rule: Any valid `.md` file is valid `.hvy`.

## 2.1 Encryption

HVY supports Fernet encryption for whole documents and individual components. Fernet keys are supplied by the host/client and are identified in HVY metadata by a UUID string. HVY files MUST NOT serialize raw encryption keys.

### Whole-document encryption

A whole-document encrypted HVY file is an encrypted envelope rather than ordinary HVY text. The envelope metadata MUST identify:
- `hvy_encryption`: `1`
- `algorithm`: `"fernet"`
- `keyId`: the UUID for the Fernet key

The envelope payload is one Fernet token whose plaintext is the complete standard HVY byte stream, including the textual body, tail preamble, and binary tail attachment bytes. Clients that decrypt an encrypted document SHOULD cache the decrypted document for the mount/session and MUST NOT re-decrypt the envelope during ordinary rendering, editing, or component encryption operations.

### Encrypted components

Individual components use the native `encrypted` component directive:

```markdown
<!--hvy:encrypted {"keyId":"00000000-0000-4000-8000-000000000000"}-->
```

`hvy:encrypted` is a built-in HVY component, not a plugin. Its only serialized directive attribute is `keyId`. The encrypted payload is stored in a tail attachment with id `encrypted:<keyId>`. The attachment payload is a Fernet token whose plaintext is exactly one serialized HVY component fragment.

When a renderer has the key for an encrypted component, it SHOULD decrypt the attachment once and render the decrypted component through the normal reusable HVY component renderer. When the key is missing, viewer and document AI mode MUST NOT render the component. Editor advanced surfaces MAY show an opaque locked placeholder containing the key UUID and attachment id. Editors MUST preserve the encrypted directive and tail bytes when the key is missing.

Authoring tools that encrypt a component MUST generate a fresh UUID and Fernet key unless the host explicitly provides them. The tool MUST return or report both the UUID and key to the host so the host can persist a UUID-to-key mapping. Encrypting a component MUST NOT cause a whole-document encrypted envelope to be re-decrypted.

## 3. Compatibility Model

### 3.1 Markdown compatibility

If HVY-specific directives are absent, parse as Markdown only. `_I'm in italics_` is used for italics rather than `*`.
HVY text also supports `___underlined___` as a constrained inline underline extension. The underline marker uses three underscores so language names such as `C++` remain plain text.
Text components preserve standard Markdown unordered and ordered list syntax. Authoring tools MAY expose separate controls for unordered (`-`) and ordered (`1.`) lists. Readers SHOULD render nested ordered lists with alphabetic markers at the second level and may use roman or other conventional markers for deeper levels.

Markdown links inside text components MAY point to `http:`, `https:`, `mailto:`, or internal fragment (`#id`) targets. Empty link targets SHOULD be treated as plain text by authoring tools rather than serialized as links.

Markdown image syntax inside text components is valid source text but MUST NOT render as an image. Authoring tools SHOULD omit pasted non-text media from text components. Use dedicated `image` or `carousel` components for offline image assets stored in HVY tail attachments.

When an authoring client imports a `.md` or `.markdown` file and converts it into an editable `.hvy` document, it SHOULD coerce Markdown into reusable HVY structure rather than a single opaque text blob:
- ATX headings define section boundaries. A heading with greater depth becomes a child section of the nearest prior heading with lower depth. Markdown before the first heading goes into an "Imported Markdown" section.
- Consecutive prose, list, blockquote, fenced or indented code, thematic-break, and raw HTML Markdown blocks become `text` components that preserve the source Markdown.
- GitHub-Flavored Markdown table blocks become `table` components, using the header row for `tableColumns` and body rows for `tableRows`.
- Imported Markdown documents SHOULD save as `.hvy` after conversion. The original Markdown source remains valid HVY by compatibility, but the editable imported representation is a richer client-authored HVY document.

### 3.2 Unusual Markdown

Nonstandard Markdown rendering behavior is ignored.

### 3.3 Unknown HVY directives

Unknown `hvy:*` metadata keys MUST be preserved and ignored (forward compatibility).

## 4. File Structure
The HVY format can be thought of like Markdown with extra features. At the top
is document metadata surrounded with `---`

Comments are denoted with `<!--  -->`
Directives are comments that lead with `hvy` and followed with a JSON payload.

Leading whitespace sets nesting (see §5.11)

```
---
Document metadata as yaml
---
<!--hvy {"id":"identifier"}-->
#! Section name
  # Section wording
  Blah blah blah
  - a list
  - another list
  <!--hvy:container {"css":"... styling css ...","lock":true}-->
  # A Title
  ## A Subtitle
    <!--hvy:container {...}-->
      ### Smaller text (still markdown here)
      Heres some text just like in markdown
    <!--hvy:component-list {"componentListType":"xref-card"}>
    <!--hvy:xref-card>
      Label
      Sublabel
      destination-id
    <!--hvy:xref-card>
      Another Label
      Another Sublabel
      a-different-destination-id
    # Implied switch to text due to drop in indentation
```

## 4. Document Structure

When viewed, the HVY segments the information into the atomic sections and the default behavior is to display them in the order that they are encountered in the file. There is, built in, a main pane and a sidebar pane. The typical behavior is that the sidebar is a tab on the side of the viewer that expands to be revealed. Cross-references can be navigated through cards, which cause things to be scrolled into view.

Everything is contained as either a section or component, and a section is essentially just a container component. There is a set of built in components native to the format, as well as component definitions used for templating, and finally plugin components.

A section is considered an atomic thought if it has a defined ID. So for example, a section may exist for "Projects" and then each individual project can be a subsection or even a component within a subsection with its own ID.

Component templates are defined as yaml in the document metadata.

### 4.1 Atomic Section

Each section contains:
- `id` (string, optional; autogenerated if absent)
- `title` (string, optional)
- `content_markdown` (string)
- `meta` (object)

Notes:
- `title` is derived from the `#!` section title line, if present, otherwise defaults to the `id` value.
- When `id` is absent, authoring tools SHOULD generate a stable slug from the section title. If that slug is already used in the document, append a numeric suffix such as `-2`. This generated ID is the section's public document ID, not an editor-internal key.
- Use `title` for navigation, editing, outline views, or linking.
- `#!` lines are never rendered as Markdown content.

## 5. Syntax

HVY defines metadata channels that remain Markdown-safe.

### 5.1 Document metadata (YAML front matter)

Top-of-file YAML front matter is optional and maps to `document.meta`.

```markdown
---
hvy_version: 0.1
title: Example
description: A short summary for document previews.
tags: [guide, onboarding]
---
```

Document identity metadata includes:
- `title`: optional string naming the document.
- `description`: optional string summarizing the document for metadata surfaces such as hosted link previews.
- `tags`: optional comma-separated string or string array for document-level classification.

Presentation keys in document metadata include:
- `sidebar_label`: optional string. Use it as the label for the sidebar toggle control. Defaults to a client-defined fallback (e.g. `☰`) if absent.
- `reader_max_width`: optional CSS width value applied to the main reader document column, for example `60rem` or `72ch`.
- `pdf_page`: optional object for `.phvy` PDF page defaults. See PDF template documents.
- `section_defaults`: optional object for authoring defaults applied when creating new manual sections. `section_defaults.css` is the default inline section CSS. `section_defaults.contained` is an optional boolean that controls whether newly created manual sections default to contained; it defaults to `true`.

AI-facing document metadata includes:
- `ai-context`: optional string with general document organization and preservation guidance for AI-assisted authoring tools.
- `ai-import-guidance`: optional string with import-specific guidance for mapping source facts to existing body sections, section templates, component template records, and cross references. Importers MAY include this guidance in planning and execution prompts; readers that do not use AI SHOULD preserve and ignore it.
- `importPreplan`: optional ordered list for AI import batching. Each entry is either a section target id string or a list of section target id strings. When present, importers SHOULD use it as the authoritative initial section import order instead of asking AI to discover the initial section list. A target id resolves first to an existing body section `id`, then to `section_defs[*].key`, then to `section_defs[*].template.id`. Sections marked `exclude_from_import` MUST NOT resolve as import targets. Importers MAY group targets from one list into a single source-information extraction call and SHOULD preserve and ignore invalid targets they cannot resolve. Readers that do not use AI SHOULD preserve and ignore it.

Responsive rendering SHOULD be based on the rendered document container's inline size, not only the browser viewport. Renderers that support responsive behavior SHOULD establish a named CSS query container around the document surface, for example:

```css
.hvy-surface {
  container: hvy-surface / inline-size;
}
```

This lets the same responsive rules work when a document is rendered inside a smaller editor pane, iframe, embedded frame, or preview surface. Width presets in authoring tools are editor/client state and MUST NOT be serialized into the `.hvy` file.

### 5.2 Section boundaries

Top-level sections are defined by `<!--hvy: {...}-->` directives.

Subsections (children of the current section) are defined by `<!--hvy:subsection {...}-->` directives.

Either directive may be followed by a `#!` title line. The `!` suffix distinguishes section titles from standard ATX headings; `#!` lines are consumed by the parser and not rendered as Markdown content. Nesting is determined by the directive type, not the number of `#` characters.

If no `#!` line follows the directive, the section title defaults to the `id` value from the directive.

Standard ATX headings (`#` through `######`) are plain Markdown content and do not define section boundaries.

### 5.3 Section metadata directives

Top-level section with title:
```markdown
<!--hvy: {"id":"topic-1","tags":["intro"],"style":"card"}-->
#! Topic Title
```

Subsection:
```markdown
<!--hvy:subsection {"id":"details"}-->
#! Details
```

Without title (id is used as the section name):
```markdown
<!--hvy: {"id":"topic-1","tags":["intro"]}-->
```

Rules:
- The directive MUST be on a single line.
- The payload MUST be valid JSON object.
- `#!` lines are consumed by the parser and not rendered.
- If no `#!` follows the directive, the section title defaults to `id`.
- `id` is optional. Authoring clients MAY generate transient section ids for editing controls, navigation, and runtime anchors, but MUST NOT serialize generated ids back into section metadata when the author did not provide an id.
- If multiple directives precede the same `#!` line, they are merged (last key wins).

### 5.4 Document-level directives

Document directives can appear anywhere as standalone comments:

```markdown
<!--hvy:doc {"audience":"mixed","lang":"en"}-->
```

This merges into `document.meta`.

### 5.5 CSS blocks

CSS blocks are declared with fenced code blocks using language `css`.

```markdown
~~~css
:root { --brand: #1f7a8c; }
article { max-width: 72ch; }
~~~
```

Optional CSS metadata directive (must appear immediately above CSS fence):

```markdown
<!--hvy:css {"id":"theme-base","scope":"document"}-->
``` 

`scope` values:
- `document` (default)
- `section:<section-id>`

### 5.6 Block metadata in `meta.blocks`

Section metadata optionally includes a `blocks` array describing per-block rendering metadata for authoring tools and implementations.

Common block metadata fields include:
- `id`
- `component`
- `editorOnly`
- `lock`
- `align`
- `slot`
- `sortKeys`
- `groupKeys`
- `tags`
- `description`
- `hideIfYes`
- `visibleScript`
- `placeholder`
- `fillIn`
- `css`

`id` is an optional author-provided stable identifier for linking, virtual filesystem paths, and reusable component references. Authoring clients MAY generate transient block ids for editing controls or CLI addressing, but MUST NOT serialize generated ids back into block metadata when the author did not provide an id.
`css` is an optional inline CSS style string applied to that block's rendered wrapper. Authoring tools expose this for layout and presentation adjustments such as collapsing spacing between adjacent blocks.
Inline `css` strings are declaration-only values equivalent to an HTML `style` attribute. They MUST NOT contain selectors, `@media`, `@container`, or other at-rules. Responsive author CSS belongs in fenced HVY CSS blocks.
`hideIfYes` is an optional string on any block. Viewer-oriented renderers MUST hide the block when the trimmed, case-insensitive value is `yes`. Empty, missing, or any other value means the block is visible unless another visibility rule hides it. Editor surfaces and document AI editing mode MUST still render the block. Template authors SHOULD use this for template-time conditional hiding, for example `hideIfYes: "{% description | isempty %}"`.
`visibleScript` is an optional Brython/Python function body on any block. Renderers that support scripting SHOULD run it with the same document component API used by button scripts and show the block only when the return value is truthy. Empty or missing `visibleScript` means the block is visible. This is intended for reusable template affordances whose visibility depends on nearby fill-ins or document state.
`editorOnly` is an optional boolean on sections and blocks. When true, the section or block exists in editor surfaces and document AI editing mode, but MUST NOT be rendered in the viewer, viewer navigation/sidebar, or viewer-oriented reader views/search results. Use it for authoring controls such as generation buttons that should not become part of the finished document.
`lock` is an optional boolean. Use it to prevent structural additions inside that block, such as nested child blocks or table-column changes.
`placeholder` is an optional string. Display it as plain hint text when the block's content is empty, helping template authors communicate intent to document authors. It applies to text-based blocks and grid item blocks. It is not parsed as Markdown or HVY content.
`fillIn` is an optional boolean for text blocks. When true, authoring tools SHOULD treat each `<!-- value -->` or `<!-- value {"placeholder":"Label"} -->` marker in the text body as an editable fill-in region in basic editing modes. Text outside the markers is scaffold text and SHOULD NOT be edited by constrained/basic editors. Fill-in placeholder labels belong on the value marker, not on the block-level `placeholder` field; the block-level field remains reserved for whole-block empty-content hints. When all markers are filled or removed and no value marker remains, tools SHOULD treat the block like regular text again.
`componentListItemLabel` is an optional human-readable singular label for items added to a `component-list`, such as `"skill"`, `"resume item"`, or `"tool / tech"`. Authoring tools SHOULD use it in add/edit prompts. When a `component-list` is configured with a non-default `componentListComponent`, authoring tools SHOULD write `componentListItemLabel` with the intended item label instead of relying on reader inference. If omitted, tools SHOULD derive a readable fallback from `componentListComponent` by converting separators to spaces and MAY drop generic suffixes such as `record`, `entry`, or `card` from machine-style component names such as `skill-record` or `tool-tech-xref-card`.
`sortKeys` is an optional object on any block. Keys are human-readable sort names and MAY contain spaces. Values MUST be strings or finite numbers. Component-list views use these values for sorting without changing source document order.
`groupKeys` is an optional object on any block. Keys are human-readable grouping names and MAY contain spaces. Values MUST be strings. Component-list views use these values to create reader-only grouped displays.

Section metadata also includes optional presentation keys such as:
- `expanded`
- `highlight`
- `priority`
- `lock`
- `editorOnly`
- `contained`
- `hideIfUnmodified`
- `exclude_from_import`
- `protect_from_import`
- `css`
- `location`
- `templateKey`

`css` is an optional inline CSS style string applied to the rendered section wrapper.
Inline section `css` follows the same declaration-only rule as block `css`. Use CSS blocks for media queries, container queries, selectors, and other stylesheet-level constructs.
`priority` is an optional boolean for sections that should remain prominent in reader-oriented ordering. Readers SHOULD keep priority sections before non-priority sections when applying search/filter ordering or other relevance-based reordering. `priority` does not imply `highlight`; use `highlight` for visual emphasis.
`lock` is an optional boolean. Use it to prevent adding new blocks or child sections inside that section.
`editorOnly` follows the same visibility rule as block `editorOnly`.
`contained` is an optional boolean. When `true` (default, unless overridden by `document.meta.section_defaults.contained` for newly created manual sections), render the section as the normal bordered card/container and allow collapse/expand UI. When `false`, render the section edge-to-edge without the section border/background wrapper and without the section expander/collapser.
`hideIfUnmodified` is an optional boolean for template-authored scaffold sections. When `true`, viewer-oriented renderers MUST hide the entire section subtree, including sidebar/navigation entries, search results, and reader-view targets. Editor surfaces and document AI editing mode MUST still render the section so users and agents can change it. Authoring tools SHOULD remove this flag from the section and any flagged ancestor section when structured editing changes that section subtree.
`exclude_from_import` is an optional boolean for sections or section templates that AI import tools MUST ignore when selecting import targets. It does not affect normal editor, AI editing, or viewer rendering.
`protect_from_import` is an optional boolean for body sections that AI import tools MUST NOT modify during import. Protected sections remain normal editor, AI editing, and viewer content, but import planners and executors MUST NOT use them or their descendant sections as existing body-section replacement targets. Import tools MAY still create unrelated new sections and MAY instantiate reusable section templates. If both `exclude_from_import` and `protect_from_import` are present, `exclude_from_import` controls target discovery.
`location` is an optional string. Use it to route a section to a named layout zone in the viewer. Defined values are `"main"` (default) and `"sidebar"`. Unknown values SHOULD be treated as `"main"`.
`templateKey` is optional authoring metadata identifying the section template definition that created the section. Authoring tools SHOULD use it to decide whether non-repeatable section template definitions have already been used.

### 5.7 Block directives

Authoring tools emit block-scoped metadata comments directly in section content:

```markdown
<!--hvy:text {"css":"margin: 0.5rem 0;"}-->
> Design the format like a document, not a form.
```

The directive name after `hvy:` can be a component name. In that form, `component` is implied by the directive name. For compatibility, tools also support the legacy `hvy:block` directive with an explicit `component` field.

Block content indentation is structural and MUST NOT be interpreted as Markdown code. Renderers MUST render code from fenced Markdown code blocks using triple backticks (or standard Markdown fences) inside text content.

`hvy:encrypted` is the native encrypted-component directive. It uses the same block directive position as any other component, but its decrypted payload is stored in the HVY tail as described in §2.1 and MUST NOT be serialized as nested visible block content.

### 5.7.1 Inline responsive annotations

Text content MAY include paired HVY comment annotations for explicit responsive hints:

```markdown
<!--hvy:alt {"compact":"Tools & Tech"}-->Tools & Technologies<!--/hvy:alt-->
<!--hvy:nowrap-->Tools & Technologies<!--/hvy:nowrap-->
```

`alt` marks a full phrase and an explicit compact replacement for constrained layouts. The payload MUST be a JSON object with string field `compact`. Renderers that support responsive text SHOULD display the full phrase in unconstrained containers and the `compact` value in constrained containers. The reference implementation treats tablet-or-narrower document containers as constrained.

`nowrap` marks a phrase that SHOULD stay on one line when the renderer supports it. Renderers MAY shrink, clip, or ellipsize the phrase according to their own CSS defaults.

These annotations are semantic hints, not raw HTML. Renderers SHOULD convert them into implementation-specific inline elements and MUST NOT leak the marker comments into visible output.

Expandable blocks can be emitted with specialized directives so their stub and expanded content remain normal Markdown blocks:

```markdown
<!--hvy:expandable {"css":"margin: 0.5rem 0;","expandableAlwaysShowStub":true,"expandableExpanded":false}-->

 <!--hvy:expandable:stub {}-->

  <!--hvy:text {"css":"margin-bottom: 0;"}-->
   ## Summary

 <!--hvy:expandable:content {}-->

  <!--hvy:text {"css":"margin: 0;"}-->
   - Expanded detail
```

Grid blocks can be emitted with specialized directives so grid item content remains normal block content:

```markdown
<!--hvy:grid {"css":"margin: 0.5rem 0; gap: 0.75rem;","gridColumns":2,"gridStackWidth":"50rem"}-->

 <!--hvy:grid:0 {"id":"skills"}-->

  <!--hvy:component-list {"componentListComponent":"text"}-->

 <!--hvy:grid:1 {"id":"tools-technologies"}-->

  <!--hvy:component-list {"componentListComponent":"text"}-->
```

Grid item `id` metadata is optional. Authoring clients MAY generate transient item ids for editing controls, but MUST NOT serialize generated ids back into inline `gridItems` or `hvy:grid:N` metadata when the author did not provide an id.

Grid slot directives MAY include `id`. Use the child block's `css` or `align` metadata for alignment inside a grid cell.

Readers SHOULD trim top and bottom margins on direct grid cell child blocks so grid gaps, rather than nested component edge margins, control spacing between cells.

`gridStackWidth` is an optional string controlling when the grid switches to a single-column stack in responsive renderers. It defaults to `50rem`. It MUST be either `"never"` or a simple CSS length token such as `"30rem"`, `"640px"`, or `"42em"`. `"never"` disables automatic stacking. This field controls only the final stack-to-one-column behavior; authors who need multi-step layouts such as three columns to two columns to one column SHOULD use fenced `hvy:css` container-query rules.

When a `component-list` grid item has plain Markdown content before its first `hvy:component-list:N` directive, that content is implicitly treated as the first block in the list. This allows a text header to appear above list items without a wrapping directive:

```markdown
<!--hvy:grid:0 {"id":"skills"}-->
 <!--hvy:component-list {"componentListComponent":"xref-card"}-->
  ## Skills
  <!--hvy:component-list:0 {}-->
   <!--hvy:text {"css":"margin: 0 0 0.35rem;"}-->
```

Here `## Skills` becomes `componentListBlocks[0]` (an implicit text block) and the `component-list:0` item becomes `componentListBlocks[1]`.

For numbered component-list slots, the numeric suffix controls display order. Readers and editors MUST sort `hvy:component-list:N` children by `N` ascending, using file order only to break ties when multiple items use the same `N`.

Container children are emitted directly under the container directive:

```markdown
<!--hvy:container {"containerTitle":"Important Stuff"}-->

 <!--hvy:text {}-->
  I'm text inside a container.

 <!--hvy:text {}-->
  I'm another child of the same container.
```

Component-list display defaults are optional reader defaults over the same source child list:

```markdown
<!--hvy:component-list {"componentListComponent":"xref-card","componentListDefaultSortKey":"Job Match","componentListDefaultSortDirection":"desc","componentListDefaultGroupKey":"Category","componentListGroupCollapsedPreviewRem":5}-->
 <!--hvy:component-list:0 {}>
  <!--hvy:xref-card {"xrefTitle":"Postgres","xrefTarget":"skill-postgres","sortKeys":{"Job Match":92},"groupKeys":{"Category":"Database"}}-->
```

`componentListDefaultSortKey` names the item-owned `sortKeys` key readers SHOULD sort by when no runtime reader override is supplied. Blank or omitted means `None`, so items render in source order. `componentListDefaultSortDirection` is `"asc"` or `"desc"` and defaults to `"asc"`. `componentListDefaultGroupKey` names the item-owned `groupKeys` key readers SHOULD group by; blank or omitted means `None`. `componentListGroupCollapsedPreviewRem` controls grouped virtual container preview height in `rem` units and defaults to `5`.

When sorting is active, child blocks that have the selected sort key render before child blocks that do not. Keyed children are sorted by the selected direction; missing-key children keep source order after keyed children. Ties keep source order. If grouping is active, readers SHOULD create virtual container components for each group value. If grouping is active without sorting, group containers SHOULD be ordered alphabetically by group value. These virtual containers are reader-only and MUST NOT be serialized into `componentListBlocks`, slot directives, or child order files. Group containers are collapsed by default and reveal their members when activated. Reader UI MAY offer runtime sort, direction, and group selections derived from child item keys without rewriting the document.

Cross-reference cards can be emitted as a block directive with all card data in metadata and no raw HTML body:

```markdown
<!--hvy:xref-card {"xrefTitle":"Heavy Stack","xrefDetail":"05/2024 - present","xrefTarget":"project-heavy-stack"}-->
```

Cross-reference card requirements:
- `xrefTitle` is REQUIRED.
- `xrefTarget` is RECOMMENDED. If omitted, implementations SHOULD preserve the card, treat it as disabled/non-navigable, and surface a warning to authors.
- `xrefTargetTagFilter` is optional authoring metadata. When present, editors SHOULD filter target pickers to sections or components tagged with at least one listed tag. The value uses the same comma-separated tag syntax as `tags`; it does not affect rendering or link resolution.

Reusable cross-reference card components can carry target picker filters:

```yaml
component_defs:
  - name: skill-xref-card
    baseType: xref-card
    schema:
      xrefTargetTagFilter: skill
```

Image blocks reference a binary attachment stored in the document tail:

```markdown
<!--hvy:image {"imageFile":"hero.png","imageAlt":"Cover photo","caption":{"text":"Product overview","schema":{"kind":"text","component":"text","align":"center"}}}-->
```

Image block fields:
- `imageFile`: REQUIRED string naming the attached file. The bytes are stored as a tail attachment with `id` `image:<imageFile>` (see §7.4). Filenames are unique per document; writing an image with an existing filename overwrites the prior bytes.
- `imageAlt`: optional alternate text for the rendered image.
- `caption`: optional text caption payload shaped as `{"text": string, "schema": text component schema}`. Caption text uses the same Markdown and styling behavior as a text component. Authoring tools SHOULD default caption schemas to centered text.

Common web image media types SHOULD be supported, including `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/svg+xml`, `image/avif`, and `image/bmp`. Clients MUST treat tail bytes as untrusted (see §8) and SHOULD render the image inline when the attachment is present, or surface a warning when it is missing.

Carousel blocks are an image component variant that display multiple attached
images in an auto-scrolling sequence:

```markdown
<!--hvy:carousel {"carouselDurationMs":3000,"carouselPauseOnHover":true,"carouselShowControls":true,"carouselShowIndicators":true,"carouselImages":[{"imageFile":"slide-a.png","imageAlt":"Slide A","caption":"First slide"},{"imageFile":"slide-b.png","caption":"Second slide"}]}-->
```

Carousel block fields:
- `carouselImages`: ordered array. Each entry MUST include `imageFile`, a
  filename whose bytes are stored in the tail attachment `image:<imageFile>`.
- Each carousel image entry MAY include `imageAlt` and `caption` strings.
- `carouselDurationMs` is optional and defaults to `3000`. Clients SHOULD clamp
  very small or very large values to preserve usability.
- `carouselPauseOnHover`, `carouselShowControls`,
  `carouselShowIndicators`, and `carouselShowFrame` are optional booleans and
  default to `true`. When `carouselShowFrame` is `false`, clients SHOULD keep
  the carousel frame layout and behavior but hide its visible background and
  border treatment.
- Clients SHOULD only start automatic movement once the carousel is visible.
- Missing image attachments SHOULD be rendered as an inline missing-asset
  warning while preserving the carousel configuration on save.

Rules:
- The directive MUST be on a single line.
- The payload MUST be valid JSON object.
- The directive applies to the immediately following content block.
- `hvy:expandable` starts an expandable block. Its payload is the expandable block schema, with `component:"expandable"` implied.
- `hvy:expandable:stub` and `hvy:expandable:content` are slot markers. Their payload may be empty or include only pane metadata such as `css` and `description`.
- The child block for an expandable slot is declared one indentation level deeper as its own directive.
- Multiple `hvy:expandable:stub` or `hvy:expandable:content` directives can be used for a single expandable block.
- Each `expandable` block MUST include at least one content child. The stub slot MAY be empty when the expandable is intended to use its content as the collapsed preview. Missing content is malformed.
- `hvy:grid` starts a grid block. Its payload is the grid block schema, with `component:"grid"` implied.
- `hvy:grid:N` and `hvy:component-list:N` are slot markers. Their payload contains slot metadata only; the actual child block is declared one indentation level deeper as its own directive.
- For `hvy:grid:N`, `N` determines the item's placement order. Readers and editors SHOULD tile items across `gridColumns` in slot order, wrapping to the next row as needed.
- For `hvy:component-list:N`, `N` is an ordering key rather than just an identifier. Lower numbers render first; file order breaks ties.
- `hvy:container` starts a container block. Its child blocks are declared directly under the container; there is no `hvy:container:N` slot directive.
- Slot markers MUST NOT carry `component` or `type`. Documents that use the old slot-carried child-component form are malformed.
- Plain Markdown content that appears after a `hvy:grid:N`, standalone `hvy:component-list`, or `hvy:container` directive and before the first child directive is implicitly treated as the first block in that grid item, list, or container.
- If both `meta.blocks[n]` and a block directive describe the same logical block, `meta.blocks[n]` wins.
- Tables are non-interactive. If authors want reveal/hide behavior or supporting narrative detail, they SHOULD wrap the table in an `expandable` rather than attaching row-level interaction metadata.

### 5.8 Recursive block shape

Block metadata is component-specific. A block schema is selected by the block's component directive name, or by `schema.component` when using the generic `hvy:block` directive. Custom components use their `component_defs[].baseType` as the schema shape while preserving the custom component name for round-tripping.

All block schemas MAY include common document fields:
- `id`
- `editorOnly`
- `lock`
- `align`
- `slot`
- `css`
- `sortKeys`
- `groupKeys`
- `tags`
- `description`
- `visibleScript`
- `placeholder`
- `fillIn`
- `xrefTitle`
- `xrefDetail`

Component-owned fields are:
- `text`: `showCopy`
- `code`: `codeLanguage`
- `container`: `containerTitle`, `containerExpanded`, `containerCollapsedPreviewRem`, `containerBlocks`
- `component-list`: `componentListComponent`, `componentListItemLabel`, `componentListBlocks`, `componentListDefaultSortKey`, `componentListDefaultSortDirection`, `componentListDefaultGroupKey`, `componentListGroupCollapsedPreviewRem`
- `grid`: `gridColumns`, `gridStackWidth`, `gridItems`
- `plugin`: `plugin`, `pluginConfig`
- `xref-card`: `xrefTarget`, `xrefTargetTagFilter`
- `expandable`: `expandableAlwaysShowStub`, `expandableExpanded`, `expandableStubCss`, `expandableStubDescription`, `expandableStubBlocks`, `expandableContentCss`, `expandableContentDescription`, `expandableContentBlocks`
- `table`: `tableColumns`, `tableShowHeader`, `tableRows`
- `image`: `imageFile`, `imageAlt`, `caption`
- `carousel`: `carouselImages`, `carouselDurationMs`, `carouselPauseOnHover`, `carouselShowControls`, `carouselShowIndicators`, `carouselShowFrame`
- `button`: `buttonLabel`, `buttonAction`, `buttonVisibleScript`, `buttonSourceScript`, `buttonPrompt`, `buttonTargetScript`, `buttonInputCharLimit`, `buttonOutputCharLimit`, `buttonPositionTargetId`, `buttonCss`

Fields from other component schemas MUST NOT be emitted. Readers SHOULD ignore fields that do not belong to the selected schema shape.

Nested block arrays such as `containerBlocks` use a recursive block object shape:

Container blocks MAY be collapsible in readers. `containerExpanded` stores the default expanded state and defaults to `true`. `containerCollapsedPreviewRem` stores the collapsed preview height in `rem` units and defaults to `3`. `containerTitle` is an optional label shown by readers as the collapse/expand control. Collapsed containers SHOULD render a non-editing preview of their first visible content up to the configured height.

```json
{
  "text": "Nested block text",
  "schema": {
    "component": "text",
    "css": "margin: 0.5rem 0;"
  }
}
```

When a nested block places a custom (non-builtin) component, a shorthand form can be used instead:

```yaml
- component: my-custom-component
```

This is equivalent to `{ schema: { component: "my-custom-component" } }`. The full template for the component is defined in `component_defs` and applied at instantiation time; no other fields need to appear at the usage site.

`expandableStubBlocks` and `expandableContentBlocks` are container objects, not flat arrays. Each has the shape:

```yaml
expandableStubBlocks:
  description: "Collapsed summary row"
  children:        # array of recursive block objects
    - text: ""
      schema:
        component: text
        css: "margin: 0;"
```

The `children` array uses the same recursive block object shape as other nested block arrays.

An expandable with empty `expandableStubBlocks.children` and populated `expandableContentBlocks.children` uses the content pane as its collapsed preview. Readers SHOULD omit the empty stub pane entirely, render a non-editing clipped preview of the first visible content while collapsed, and expand/collapse when the expandable is activated. This differs from a collapsed container preview: activating an expandable toggles it open and closed, while container preview activation opens the container.

The built-in `table` component is static document data stored in `tableColumns` and `tableRows`. Use a dynamic data-backed plugin such as `hvy.db-table` when rows should come from a backend query.

For static tables, `tableColumns` is a JSON/YAML array of strings:

```yaml
tableColumns: ["Column A", "Column B"]
```

Each `tableRows` entry contains only:

```yaml
- cells: ["Cell A", "Cell B"]
```

Static tables do not have intrinsic row expansion, row click behavior, or row-attached detail blocks in HVY v0.1. Use an enclosing `expandable` when the table should reveal additional information.

For inline HVY serialization, stub-pane and content-pane CSS/description metadata belong on the slot markers themselves:

```markdown
<!--hvy:expandable {"css":"margin: 0.5rem 0;"}-->

 <!--hvy:expandable:stub {"css":"padding: 0.5rem;","description":"Collapsed summary row"}-->

  <!--hvy:text {}-->
   Stub content

 <!--hvy:expandable:content {"css":"padding: 0.5rem;","description":"Detailed body"}-->

  <!--hvy:text {}-->
   Expanded content
```

In the in-memory/schema form used by `component_defs`, these pane-level styles and descriptions are stored as `expandableStubCss`, `expandableContentCss`, `expandableStubDescription`, and `expandableContentDescription`. The expandable block's own `css` and `description` still apply to the outer expandable component wrapper.

Serialized block objects SHOULD contain document data only. Editor-only UI state, such as whether a schema editor is open for a block, MUST NOT be emitted.

Preserve and round-trip these fields. When emitting new documents, prefer `hvy:expandable:stub` and `hvy:expandable:content` inline directives over `expandableStubBlocks`/`expandableContentBlocks`; the container object form is used in `component_defs` schemas where inline directives are not applicable.

### 5.9 Component template definitions

Document metadata optionally includes `component_defs`, an array of component template definitions for authoring tools.

Example:

```yaml
component_defs:
  - name: callout
    baseType: container
    tags: ui, emphasis
    description: Framed callout container
    schema:
      css: "margin: 0.5rem 0;"
      containerTitle: Callout
      containerBlocks: []
```

Notes:
- `schema` is optional.
- When present, use it as the default schema/template when creating a block with that component template.
- The `component` field MUST NOT appear inside `schema`; the component type is already captured by `baseType`.
- A component definition name can be used anywhere a block `component` value is accepted, including block directives, nested block schemas, and `componentListComponent`.
- When a nested block array (e.g. `containerBlocks`, `expandableContentBlocks`) places a custom component, the shorthand form `{ component: name }` SHOULD be used instead of the full `{ schema: { component: name, ... } }` form. The component's template provides all other properties at instantiation time.
- Implementations SHOULD render custom components according to `baseType` and preserve the custom component name for editing and round-tripping.

Component templates MAY include value tokens in any string field. Tokens use Markdown-safe text and are replaced only when an authoring tool creates a component instance from the component template definition:

```text
{% organization %}
{% role | text %}
{% description | block %}
{% description | isempty %}
{% project-link %}
```

Template value notes:
- `{% name %}` is equivalent to `{% name | text %}`.
- `text` values are single-line values; `block` values may contain multiple lines.
- `isempty` resolves to `yes` when the value is empty or whitespace-only, and `no` otherwise. It does not change the variable's text/block validation type.
- Variable names MUST be identifier-like strings: letters, numbers, underscores, and hyphens, starting with a letter or underscore.
- Repeated variables use the same value; conflicting types for the same variable are invalid.
- Blank values are allowed. Replacing a token with a blank value does not remove or change separate schema fields such as `placeholder`.
- Authoring tools that accept explicit template values SHOULD require the provided keys to exactly match the expected variable names.
- Component template definitions and section template definitions MAY include `templateVariables`, keyed by variable name. Each variable config MAY include `label`, a human-readable field label for authoring UIs. When `label` is omitted, authoring tools SHOULD derive one by converting snake_case or kebab-case separators to spaces and title-casing the result.
- A template variable config MAY include `generator`, a plugin-qualified output generator key such as `hvy.resume.skill-description`. Authoring tools MAY expose this as a field-level generation action. Generator requests MUST include only template variables that the author has provided with non-empty values; missing or empty variables MUST be omitted. If the installed generator declares required variables, authoring tools SHOULD disable the action until all required variables are non-empty.
- A template variable config MAY include `generatorLabel`, overriding the visible action label for that variable. If omitted, authoring tools SHOULD use the installed generator's label or a generic label such as `Generate`.

Component template definitions MAY include `flavors`, an array of alternate schemas for the same component template name. Each flavor has:
- `name`: stable flavor identifier.
- `description`: optional authoring and AI guidance describing when to use the flavor.
- `schema`: optional schema with the same shape and rules as the component template's main `schema`.
- `templateVariables`: optional variable labels/generators for tokens in that flavor. If omitted, authoring tools MAY reuse the parent component template's variable config.

When a component-list uses a component template with flavors, AI import tools SHOULD choose the best flavor before filling template values for each generated list item. If no flavors are defined, authoring tools use the main component template as usual.

### 5.10 Section template definitions

Document metadata optionally includes `section_defs`, an array of section template definitions for authoring tools.

Example:

```yaml
section_defs:
  - name: faq-section
    key: faq
    repeatable: false
    templateVariables:
      section_title:
        label: Section title
    template:
      id: faq
      title: "{% section_title %}"
      level: 2
      contained: true
      expanded: true
      highlight: false
      css: ""
      blocks:
        - text: "## {% section_title %}"
          schema:
            component: text
            css: "margin: 0.5rem 0;"
      children: []
```

Notes:
- `key` is an optional stable template identity. When omitted, `name` is the template identity.
- `repeatable` is optional and defaults to `false`. Authoring tools SHOULD hide a non-repeatable section template when the document already contains a section whose `templateKey` matches the definition's `key` or `name`.
- Sections created from section template definitions SHOULD set `templateKey` to the definition's `key` or `name`. Manually created blank sections SHOULD omit `templateKey`.
- `template` stores a full section subtree, including blocks and nested child sections.
- `templateVariables` follows the rules in section 5.9 and applies to tokens anywhere in the section template subtree, including section fields, block text, and nested block schema fields.
- Clone a `section_defs[*].template` when inserting a new section or subsection.
- Section templates preserve section-level presentation fields such as `contained`, `expanded`, `highlight`, `priority`, `css`, `location`, and `hideIfUnmodified`.
- Section template definitions MAY include `flavors`, an array of alternate section templates. Each flavor has `name`, optional `description`, optional `templateVariables`, and `template`. AI import tools SHOULD choose the best section flavor before filling template values. If no flavors are defined, authoring tools use the main section template as usual.
- Implementations SHOULD assign fresh section keys, block IDs, and custom IDs when instantiating a section template.

### 5.11 Indentation

Leading whitespace determines nesting depth. Each level of nesting adds one space. This is semantic: a directive or content line at indent level N is a child of the nearest enclosing directive at indent level N-1. A decrease in indentation closes open blocks, exactly as Python uses indentation to delimit scopes.

Parsers MUST use the leading whitespace count of a directive line to determine which open frames to close before processing that directive. When a directive at indent N is encountered, all open frames at indent >= N are closed first. Content lines (non-directive) inherit the indent of their enclosing block.

| Element | Indent |
|---|---|
| Top-level section directive (`<!--hvy: ...-->`) and `#!` title | 0 spaces |
| Direct block directives inside a section | 1 space |
| Content text of direct blocks | 2 spaces |
| Sub-directives (`expandable:stub`, `expandable:content`, `grid:N`, `component-list:N`) inside a direct block | 2 spaces |
| Content text / nested directives inside a sub-directive | 3 spaces |
| Each additional level of nesting | +1 space per level |

Example:

```
<!--hvy: {"id":"example","lock":true}-->
#! Example

 <!--hvy:expandable {"expandableAlwaysShowStub":true}-->

  <!--hvy:expandable:stub {}-->

   <!--hvy:text {}-->
    ## Stub heading

  <!--hvy:expandable:content {}-->

   <!--hvy:component-list {"componentListComponent":"text"}-->

    <!--hvy:component-list:0 {}-->

     <!--hvy:text {}-->
      First item

    <!--hvy:component-list:1 {}-->

     <!--hvy:text {}-->
      Second item
```

### 5.12 Color theme

Color themes are implemented intrinsically by the viewer application. A `.hvy` or `.thvy` file MAY declare theme colors in document front matter under the `theme` key. When absent, the viewer supplies its own light- and dark-mode defaults.

A theme exposes CSS custom properties that document and component CSS refer to with `var(...)`. This keeps color choices centralized and makes light/dark variants a data change rather than a content change.

Theme variables describe shared document roles. Plugins MUST NOT add plugin-specific global theme variables such as `--hvy-<plugin>-text` or `--hvy-<plugin>-series-1` for their internal rendering. A plugin SHOULD derive its colors from existing shared roles such as text, surface, border, accent, status, highlight, and link variables, or expose plugin-local styling through `pluginConfig` / plugin content when that styling is part of the plugin contract.

#### Naming

Each entry under `theme.colors` is a CSS custom property name mapped directly to a value. The key **is** the CSS variable name — no transformation is applied:

| YAML key              | CSS variable           |
|-----------------------|------------------------|
| `--hvy-bg`    | `--hvy-bg`     |
| `--hvy-text-alt`      | `--hvy-text-alt`       |
| `--hvy-accent-1`      | `--hvy-accent-1`       |
| `--hvy-my-custom`     | `--hvy-my-custom`      |

The viewer sets each key verbatim on the document root (`root.style.setProperty(key, value)`). Authors may use any CSS custom property name; the `--hvy-` prefix is conventional but not enforced.

#### Conventional palette

Viewers SHOULD ship built-in defaults for the following conventional names so documents that omit them still render correctly, and should provide both a light and a dark default set:

| Variable | Affects |
| --- | --- |
| `--hvy-bg` | Page background |
| `--hvy-bg-alt` | Page background gradient end |
| `--hvy-surface` | Panel and card backgrounds |
| `--hvy-surface-alt` | Inset and secondary panel backgrounds |
| `--hvy-surface-tint` | Subtle panel tinting |
| `--hvy-text` | Primary text |
| `--hvy-text-alt` | Secondary text |
| `--hvy-text-muted` | Muted helper text |
| `--hvy-link-color` | Inline link text |
| `--hvy-accent-1` | Primary accent fill |
| `--hvy-accent-1-alt` | Primary accent border |
| `--hvy-accent-1-text` | Text on primary accent |
| `--hvy-accent-2` | Secondary accent fill |
| `--hvy-accent-2-alt` | Secondary accent border |
| `--hvy-button-bg` | Primary button background |
| `--hvy-button-text` | Primary button text |
| `--hvy-highlight-1` | Soft content highlight |
| `--hvy-highlight-2` | Strong content highlight |
| `--hvy-border` | Default panel border |
| `--hvy-border-alt` | Emphasized border |
| `--hvy-border-input` | Form field and table border |
| `--hvy-border-translucent` | Floating toolbar border |
| `--hvy-ghost-border` | Muted dashed border for editor ghost inputs |
| `--hvy-xref-card-bg` | Cross-reference card background |
| `--hvy-xref-card-hover-bg` | Cross-reference card hover background |
| `--hvy-table-header` | Table header background |
| `--hvy-table-row-bg-1` | Odd table row background |
| `--hvy-table-row-bg-2` | Even table row background |
| `--hvy-icon-muted` | Muted icon color |
| `--hvy-shadow` | Small shadow color |
| `--hvy-shadow-md` | Medium shadow color |
| `--hvy-shadow-lg` | Large shadow color |
| `--hvy-overlay` | Modal and sidebar backdrop |
| `--hvy-danger` | Danger action and error text |
| `--hvy-warning` | Warning accent |
| `--hvy-warning-bg` | Warning background |
| `--hvy-warning-border` | Warning border |
| `--hvy-warning-text` | Warning text |
| `--hvy-success` | Success text |
| `--hvy-success-bg` | Success background |
| `--hvy-success-border` | Success border |

Alternates (`*-alt`) are intended as fallbacks for cases where the base color would clash with its surroundings.

#### Front matter shape

```yaml
theme:
  colors:
    --hvy-bg: "#ffffff"
    --hvy-text: "#1f2a37"
    --hvy-text-alt: "#4b5563"
    --hvy-accent-1: "#1f7a8c"
    --hvy-accent-1-alt: "#a7d3db"
    --hvy-border: "#d2dde6"
    --hvy-xref-card-bg: "#f3f5f8"
    --hvy-table-header: "#e5e7eb"
    --hvy-table-row-bg-1: "#ffffff"
    --hvy-table-row-bg-2: "#f9fafb"
    --hvy-my-overlay: "rgba(0, 0, 0, 0.04)"
```

Rules:
- All keys under `colors` are optional. Missing keys fall back to the viewer's built-in defaults.
- Values MUST be valid CSS color expressions (`#rrggbb`, `#rrggbbaa`, `rgb(...)`, `rgba(...)`, `hsl(...)`, named colors, etc.). Semi-transparent values are permitted.
- The viewer applies these variables to the document root (typically `:root` or the document container) before any CSS blocks or inline component CSS is evaluated, so `var(--hvy-bg)` and similar expressions resolve everywhere.
- When the viewer exposes a UI for editing theme colors, edits MUST be persisted back into `document.meta.theme.colors` so they round-trip through save.

### 5.13 Document-level component defaults

A `.hvy` or `.thvy` file MAY declare default presentation values for named components in front matter under `component_defaults`.

This is intended for document-wide presentation adjustments that should apply consistently without repeating the same inline `css` on every block instance.

#### Front matter shape

```yaml
component_defaults:
  xref-card:
    css: "padding: 0.5rem;"
```

Rules:
- Each key under `component_defaults` is a component name such as `xref-card`.
- `css` is an optional inline CSS style string applied to the rendered root element of that component type.
- Explicit block-level `css` remains valid and MAY be combined with or override document-level defaults in a viewer-specific way.
- Unknown component names or unsupported default fields MUST be ignored.

### 5.14 Document-level section defaults

A `.hvy` or `.thvy` file MAY declare default presentation values for sections in front matter under `section_defaults`.

This is intended for document-wide section wrapper styling and authoring defaults without repeating the same metadata on every section.

#### Front matter shape

```yaml
section_defaults:
  css: "margin: 0.5rem 0;"
  contained: true
```

Rules:
- `css` is an optional inline CSS style string applied to each rendered section wrapper.
- `contained` is an optional boolean used by authoring tools as the default `contained` value for newly created manual sections. It defaults to `true`.
- Explicit section-level `css` remains valid and MAY be combined with or override document-level defaults in a viewer-specific way.
- Explicit section-level `contained` remains valid and overrides the document-level default for that section.
- Unknown fields under `section_defaults` MUST be ignored.

### 5.15 Document-level text line styles

A `.hvy` or `.thvy` file MAY declare named text line styles in front matter under `text_line_styles`. Text line styles are source-visible markers for styling individual Markdown lines inside `text` components without splitting the content into multiple HVY components.

#### Front matter shape

```yaml
text_line_styles:
  role:
    label: Role heading
    css: "margin: 0.5rem 0 0.1rem; font-weight: 700;"
  detail:
    label: Detail line
    css: "margin: 0 0 0.4rem; padding-left: 1.5rem;"
```

#### Marker syntax

```markdown
^role^ #### Foo
^detail^ moo cow
```

Rules:
- A marker has the form `^name^` at the start of a Markdown line. `name` MUST contain only ASCII letters, digits, `_`, or `-`.
- The marker is source-only. Renderers that support `text_line_styles` MUST remove the marker from visible output and apply the referenced style to that rendered line.
- `\^name^` escapes the marker and renders literal text.
- Markers inside fenced code blocks MUST remain literal.
- Unknown style names SHOULD render the line content normally. Authoring tools SHOULD show an editor warning so authors can catch typos.
- `css` is an optional inline CSS declaration string and MUST be sanitized using the same rules as other document-supplied inline CSS.
- Text line styles do not create HVY components, sections, component defaults, or component-level CSS. Component-level `css` continues to persist independently.

### 5.16 Document-level heading styles

A `.hvy` or `.thvy` file MAY declare presentation values for standard Markdown headings in front matter under `heading_styles`.

This styles visible ATX headings (`#` through `######`) inside `text` components. It does not style HVY section titles from `#!` lines, because those lines are section metadata and are not rendered as Markdown content.

#### Front matter shape

```yaml
heading_styles:
  h2:
    label: Heading 2
    css: "margin: 1.5rem 0 0.2rem; font-weight: 700; line-height: 1.15;"
    afterContentMarginTop: "1.5rem"
  h3:
    label: Heading 3
    css: "margin: 1rem 0 0.2rem; font-weight: 700; line-height: 1.15;"
    afterContentMarginTop: "1rem"
```

Rules:
- Keys under `heading_styles` are `h1` through `h4`.
- `css` is an optional inline CSS declaration string applied to that rendered heading level and MUST be sanitized using the same rules as other document-supplied inline CSS.
- `afterContentMarginTop` is an optional CSS length or expression used as the top margin when that heading follows prose, a list, blockquote, or code block in the same text component.
- Renderers SHOULD remove the top margin from the first visible heading in a text block or styled text-line wrapper so a heading at the start of a section aligns with the section content.
- Renderers SHOULD remove the bottom margin from the last visible heading in a text block or styled text-line wrapper so a heading at the bottom of a component does not add trailing space.
- Unknown heading style fields MUST be ignored.

## 6. Template & Schema (`.thvy`)

A `.thvy` file is a `.hvy` file. The distinction is the `.thvy` extension or `text/thvy` media type.

Template sections that contain scaffold content but should not appear in a finished viewer until changed MAY set `hideIfUnmodified: true` in section metadata. Viewer-oriented surfaces hide a flagged section, its descendants, sidebar/navigation entries, search results, and reader-view targets while the flag is present. If a user, agent, or structured authoring tool edits that section, a child section, or any descendant block, the tool SHOULD remove `hideIfUnmodified` from the edited section and any flagged ancestor sections. After the flag is removed and saved, the section renders normally.

This is not an emptiness test. A section can contain headers, placeholder rows, tables, or list scaffolds and still be hidden while the flag remains. Editor and AI modes always show flagged sections. Raw source editors MAY leave or remove the flag directly; no baseline comparison is required.

### 6.1 Template metadata

Front matter MUST contain:
- `hvy_version`

`schema` is optional. When present, it describes expected placeholder fields.

Minimal example:

```yaml
---
hvy_version: 0.1
---
```

### 6.2 PDF template documents (`.phvy`)

A `.phvy` file is a HVY-family document intended for PDF template authoring and export. Authoring clients SHOULD indicate when the current document is a PDF document and SHOULD prevent creation of components that cannot render to PDF.

PDF-template authoring supports these component base types:
- `text`
- `container`
- `component-list`
- `grid`
- `image`
- `table` when static table support is enabled

Custom component templates are allowed only when their resolved `baseType` is one of the supported PDF component base types. `.phvy` documents MUST NOT contain sidebar sections. Authoring clients SHOULD disable sidebar creation and sidebar movement controls for `.phvy` documents and SHOULD NOT render a viewer/sidebar surface for them. Existing incompatible components or sidebar sections remain visible for correction in authoring surfaces, but PDF export MUST reject the document rather than hiding or replacing them.

PDF export renderers SHOULD map PDF-safe text component inline `css` declarations and document `heading_styles.*.css` declarations onto equivalent PDF text properties when a direct equivalent exists. At minimum, `text-align: left|center|right` maps to PDF text alignment, `font-size` maps to PDF text size, unitless `line-height` maps to PDF line height, `font-weight: bold` or numeric weights of `600` and above map to bold PDF text, `color` maps to PDF text color, and simple `background` / `background-color` color values map to PDF text fill/background color. Exporters SHOULD also map section and block `margin` / `margin-*` declarations to PDF node margins, including margins inherited through `section_defaults.css`. CSS custom properties MAY be resolved through the document theme when the resolved value is a PDF-safe color.

`.phvy` documents MAY declare `pdf_page` in front matter:

```yaml
pdf_page:
  size: LETTER
  margins: [0.75in, 0.75in, 0.75in, 0.75in]
  debug: false
```

- `size` is optional and defaults to `LETTER`. Renderers SHOULD support `LETTER`, `A4`, `LEGAL`, `TABLOID`, and `LEDGER`; renderers MAY also accept `{width, height}` point objects.
- `margins` is optional and defaults to `[0.75in, 0.75in, 0.75in, 0.75in]`. It MAY be a single length for all sides, `[horizontal, vertical]`, or `[left, top, right, bottom]`. Supported units are `in`, `cm`, `mm`, and `pt`.
- `debug` is optional and defaults to `false`. Authoring clients MAY use it to show page and printable-area bounds in PHVY preview surfaces. Exporters SHOULD render diagnostic page and printable-area bounds into generated PDFs when `debug` is `true`; authors SHOULD disable it for final PDFs.
- Explicit PDF export strategy defaults override `pdf_page` for that export operation.

With optional schema:

```yaml
---
hvy_version: 0.1
schema:
  type: object
  properties:
    lesson_title: { type: string }
    target_audience: { type: string }
  required: [lesson_title]
---
```

### 6.2 Placeholders

Placeholders use mustache-like syntax:
- `{{field_name}}`
- `{{nested.field}}`

Rules:
- Unknown placeholders SHOULD be reported by authoring tools.
- Missing required fields MUST be surfaced as validation errors.
- Escaped literal form: `\{{not_a_placeholder}}`.

### 6.3 Schema dialect

`schema` uses a JSON-Schema-like subset:
- `type`: `object|string|number|integer|boolean|array`
- `properties`
- `required`
- `enum`
- `items`
- `description`
- `default`

## 7. Plugin Declaration Model

HVY does not execute scripts inline. Extensions are declared as metadata and resolved by the client.

### 7.1 Plugin declaration

Declare plugins in front matter under `plugins`:

```yaml
plugins:
  - id: com.example.timeline
    source: https://plugins.example.com/timeline.hvyplugin
    version: 1.2.0
    integrity: sha256-BASE64_DIGEST
```

Required fields:
- `id`: globally unique plugin identifier. Built-in HVY plugins use the `hvy.*`
  namespace; third-party plugins SHOULD use a namespace they control.
- `source`: plugin package location or a client-known plugin locator such as `builtin://...`

Recommended fields:
- `version`
- `integrity`
- `permissions` (declared capabilities)

### 7.2 Plugin metadata at section level

Sections can request plugin behavior with metadata:

```markdown
<!--hvy: {"plugin":"com.example.timeline","plugin_config":{"start":"2026-01-01"}}-->
#! Launch Timeline
```

### 7.3 Plugin block component

Use the `plugin` block when a document embeds a client-resolved plugin instance in normal content flow:

```markdown
<!--hvy:plugin {"plugin":"hvy.db-table","pluginConfig":{"source":"with-file","table":"work_items"}}-->
```

Plugin block fields:
- `plugin`: REQUIRED plugin identifier matching a declared plugin
- `pluginConfig`: optional object interpreted only by that plugin

HVY core only standardizes the envelope. The meaning of `pluginConfig` is plugin-specific.

The `plugin` block additionally has a free-form text body. Like `pluginConfig`,
the text body is plugin-specific: clients MUST preserve it verbatim across
read/write cycles and MUST NOT attempt to interpret it as Markdown or HVY
content. Plugins are free to use the text body as a query string, a label
formatter, a templated expression, or any other plugin-defined payload, and
MAY use both `pluginConfig` and the text body together (for example,
structured numeric configuration in `pluginConfig` plus a templated label
string in the text body).

### 7.4 Plugin installation and selection

A plugin is identified by a stable namespace-qualified id and is
resolved by the host that embeds an HVY reader/editor, not by the document
itself. Hosts install zero or more plugin implementations at startup; the
reference reader/editor exposes this as a host-supplied list of plugin objects.
Each plugin object is a host-installed capability bundle. It MAY provide:

- the plugin `id` matching the value used in `block.plugin`;
- a human-readable display name (used by editors to populate the plugin
  selector for new `plugin` blocks);
- one or more renderable component factories that produce plugin instances bound to specific blocks;
- one or more output generators that produce text directly or produce prompts for a host LLM/chat client;
- a PDF/static render capability that resolves a plugin block to ordinary
  PDF-compatible HVY blocks for export.

An output generator has a globally unique plugin-qualified key, an optional
human-readable label, optional required template variable names, and a generate
function. The generate function receives the current document, component name,
target template variable, insertion target, and only the currently provided
non-empty template variable values. It returns a response object with:

- `answer`: optional direct text output;
- `prompt`: optional prompt text for the host LLM/chat client;
- `responseInstructions`: optional instructions for interpreting the prompt response;
- `inputCharLimit`: optional maximum prompt length;
- `outputCharLimit`: optional maximum generated text length.

If `prompt` is present, the host SHOULD submit it through its configured
LLM/chat path. If both `prompt` and `answer` are present, `answer` is a fallback
used only when the LLM request fails or returns no text. If only `answer` is
present, the host SHOULD insert that text directly. If neither path produces
text, the authoring UI SHOULD show an error and preserve the user's existing
field value.

A PDF/static render capability is invoked by the host at PDF export time before
PDF component validation and layout. It receives the plugin block, document
header, attachments API, and current document context, and returns zero or more
ordinary HVY blocks. Returned blocks MUST use components that are valid in the
target PDF document, such as `text`, `container`, `grid`, `table`, or `image`.
The capability MAY perform asynchronous work, including host-approved API calls,
and MAY write static attachments before returning image or carousel blocks that
reference those attachments. For example, a plugin can fetch or generate a QR
code, store it as an image attachment, and return an `image` block. Hosts SHOULD
replace only the export clone with these static blocks; the authored plugin
block and plugin-owned configuration/text MUST remain unchanged. If a `.phvy`
plugin block has no installed PDF/static render capability, authoring clients
SHOULD keep the plugin visible in pickers but disabled, and PDF export MUST
reject the unresolved plugin block rather than silently hiding it.

Plugins MUST own the rendered DOM for their block. Hosts MUST treat the
returned element as opaque and MUST NOT mutate its children, except to remove
it on unmount. Plugins MUST be framework-agnostic: a plugin written in plain
JavaScript, in another language compiled to JavaScript, or in a different UI
framework MUST be usable so long as it returns a DOM element.

Plugins SHOULD style themselves using the document's standard CSS theme
variables. This is convention, not requirement.

When rendering a plugin for editing, hosts SHOULD pass an editor context object
to the plugin. The editor context MUST include:

- `mode`: `"view"` or `"edit"`.
- `detailLevel`: a number indicating how much editing UI the host is asking the
  plugin to show.

The conventional `detailLevel` meanings are:

- `0`: hidden, compact, or out-of-the-way plugin UI. This is reserved for
  minimized or low-presence editing displays.
- `1`: basic editing UI. Plugins SHOULD show normal user-facing controls here.
- `2`: advanced editing UI. Plugins SHOULD show configuration, wiring, scripts,
  ids, host-action settings, and other expert controls here.

Hosts and plugins SHOULD rely only on levels `0`, `1`, and `2` for now. Other
numbers are reserved; plugins receiving an unknown level SHOULD fall back to the
nearest supported behavior.

When a `plugin` component block has no `plugin` value, editors MUST present a
selector populated from the host's installed plugins and MUST NOT render any
plugin instance until the user picks one. When the document declares a
`plugin` id that the host does not have installed, the editor SHOULD still
preserve the block (including `pluginConfig` and text body) on save, and
SHOULD render a placeholder indicating the plugin is unavailable.

### 7.5 Tail payload envelope

`.hvy` files MAY append one or more opaque binary attachments after the Markdown/HVY text body. Attachments are intended for plugin-owned payloads (such as an embedded database) and for component-owned binary assets (such as image files referenced by `image` components).

Tail format:
1. The textual document body ends with one or more consecutive single-line tail directives, each describing one attachment:

```markdown
<!--hvy:tail {"id":"db","plugin":"hvy.db-table","mediaType":"application/vnd.sqlite3","encoding":"gzip","length":1234}-->
<!--hvy:tail {"id":"image:hero.png","mediaType":"image/png","length":5678}-->
```

2. The next line MUST be the exact ASCII sentinel:

```text
--HVY-TAIL--
```

3. All remaining bytes after the trailing newline of that sentinel are the concatenated attachment payloads, laid out in the order the directives appear. Each attachment's byte slice has length `length` from its directive.

Tail directive fields:
- `id`: REQUIRED stable identifier unique within the document. Conventional ids include `db` for the database plugin payload and `image:<filename>` for image component attachments.
- `mediaType`: RECOMMENDED IANA media type of the decoded payload.
- `length`: REQUIRED non-negative integer byte count for that attachment's slice. When omitted on the last directive, the slice consumes all remaining tail bytes.
- `encoding`: optional. When `"gzip"`, the attachment bytes are gzip-compressed and clients MUST decompress before handing them to the consumer.
- `plugin`: optional. Names the plugin that owns the attachment.

Rules:
- Tail payloads are NOT part of Markdown parsing.
- Tail payloads are only valid for `.hvy`, not `.thvy`.
- Duplicate `id` values are not permitted; if a writer adds an attachment whose `id` already exists, the previous entry is overwritten.
- Clients that do not recognize an attachment's declared plugin or media type SHOULD preserve the bytes and pass them through on save, but MAY render the corresponding component as unsupported.

### 7.6 DB table plugin contract

The first standardized plugin contract is `hvy.db-table`.

Declaration example:

```yaml
plugins:
  - id: hvy.db-table
    source: builtin://db-table
```

Block example:

```markdown
<!--hvy:plugin {"plugin":"hvy.db-table","pluginConfig":{"source":"with-file","table":"work_items"}}-->
 SELECT company, url, status
 FROM work_items
 WHERE status != 'Rejected'
```

Plugin-specific rules:
- `pluginConfig.source` MUST currently be `"with-file"`.
- `pluginConfig.table` MUST be an existing table or view name in the plugin's current data backend. It MUST NOT contain SQL.
- The plugin block text is interpreted as an optional read-only `SELECT` or `WITH` query string. This is an implicit property derived from the block text body rather than from `pluginConfig`.
- Query text does not create data objects. Tables and views MUST be created through the backend execution API before a DB Table component can reference them.
- If the plugin block contains non-text structured content, clients SHOULD discard that structured content for this plugin and preserve only the text body as the query value.
- If the query text is empty after trimming, clients MUST behave as though the query were `SELECT * FROM <pluginConfig.table>`.
- If the query text is non-empty, clients MUST render the result in a read-only state and SHOULD visually indicate that the table is query-driven rather than directly editable.
- `pluginConfig.queryDynamicWindow` is an optional boolean. When `true` or absent, query views SHOULD use a moving offset/limit window. When `false`, clients SHOULD instead execute the query with a fixed limit and no moving offset window.
- `pluginConfig.queryLimit` is an optional integer used when `pluginConfig.queryDynamicWindow` is `false`. Clients MUST clamp it to fewer than 100 rows.
- Clients MUST enforce an implicit result cap of fewer than 100 rows for query-driven views.
- Clients SHOULD render at most 50 rows at a time in the visible window and SHOULD advance or rewind the offset window as the user scrolls, for example by shifting the offset after the viewport passes roughly row 75.
- Sort controls MAY be exposed for direct table views. If exposed, ascending and descending sort orders SHOULD be supported per visible column. Query-driven views SHOULD preserve query-defined ordering instead.
- The current built-in implementation stores this plugin in exactly one gzip-compressed SQL database in the document tail.
- Multiple plugin blocks MAY point at different tables within the same attached backend.

Recommended client behavior:
- Spreadsheet-like table views SHOULD virtualize row rendering and MUST NOT attempt to render every row at once for large tables.
- Clients MAY store row-attached HVY fragments in companion tables keyed by table name and row identifier.
- If row-attached HVY is supported, clients MAY expose context-menu actions such as setting or viewing the attached component for a row.

### 7.7 Form plugin contract

The built-in form plugin is `hvy.form`. A form is a plugin component, not
a native HVY container. HVY stores the plugin block and a plugin-owned YAML text
body; individual inputs are not separate HVY components.

Declaration example:

```yaml
plugins:
  - id: hvy.form
    source: builtin://form
```

Block example:

```markdown
<!--hvy:plugin {"plugin":"hvy.form","pluginConfig":{"version":"0.1","initialScript":"populate_food","submitScript":"submit_order","submitLabel":"Save order"}}-->
fields:
  - label: Food
    type: select
    options:
      - label: Apple
        value: apple
      - label: Soup
        value: soup
    triggers:
      change: populate_food
  - label: Notes
    type: textarea
scripts:
  populate_food: |
    if doc.form.get_value("Food") == "soup":
        doc.form.set_value("Notes", "Bring a spoon.")
  submit_order: |
    doc.header.set("last_order", doc.form.get_values())
```

Plugin-specific rules:
- `pluginConfig.version` is optional and defaults to `"0.1"`.
- Form-level behavior is stored in `pluginConfig`. `pluginConfig.initialScript`
  and `pluginConfig.submitScript` reference named scripts from the form body.
  `pluginConfig.submitLabel` customizes the visible submit button text and
  defaults to `"Submit"`. `pluginConfig.showSubmit` defaults to `true`; when
  `false`, clients MUST omit the visible submit button while preserving the form
  and any non-submit triggers.
- `pluginConfig.submitAction` is optional and defaults to `"script"`. Supported
  values are `"script"` and `"ai-generate"`. For `"script"`, submitting the form
  runs `pluginConfig.submitScript`. For `"ai-generate"`, submitting the form
  calls the host-managed chat model, then runs `pluginConfig.submitScript` to
  apply the returned text.
- For `submitAction: "ai-generate"`, `pluginConfig.submitSourceScript` MAY
  reference a named script that returns the model input text. If omitted, clients
  SHOULD use the current form values as structured input. `pluginConfig.submitPrompt`
  is the user prompt sent with that source text. `pluginConfig.submitInputCharLimit`
  and `pluginConfig.submitOutputCharLimit` are optional positive integers used to
  bound model input and output. During the submit target script,
  `response` contains the generated text and `source` contains the model input
  text.
- The plugin block text MUST be interpreted as YAML owned by the form plugin.
- Top-level YAML keys are `fields` and `scripts`.
- `fields` is an ordered list. Each field supports `label`, `type`,
  `value`, `placeholder`, `required`, `options`, `triggers`, and `meta`.
- Field `label` is both the visible label and the script key used with
  `doc.form` helpers.
- Field `meta` is plugin-owned field metadata. `meta.css` is an optional
  inline CSS style string applied to that rendered field wrapper and MUST be
  sanitized like other document-supplied CSS.
- Supported `type` values are `text`, `textarea`, `number`, `select`,
  `checkbox`, `radio`, `date`, `email`, `tel`, `url`, `password`, and `hidden`.
  File inputs are not part of the standard form plugin contract.
- `options` applies to `select` and `radio`. Each option MAY be a string or an
  object with `label` and optional `value`; when `value` is omitted, clients MUST
  use `label` as the value.
- `scripts` is a map from script name to Python/Brython source.
  `pluginConfig.initialScript`, `pluginConfig.submitSourceScript`,
  `pluginConfig.submitScript`, and field trigger values reference keys in this
  map.
- `pluginConfig.scriptLibraries` MAY list scripting libraries the client should
  make available to every form script before execution. Supported values are
  client-defined; this reference client supports `"random"` and `"re"`. Import statements
  for unchecked libraries MUST remain blocked by the scripting sandbox.
- `pluginConfig.scriptStepBudget` MAY set a positive integer step budget for
  each form script run. Clients SHOULD default to 100000 steps.
- Field `triggers` MAY define `input`, `change`, and `blur` script references.
  Clients SHOULD debounce `input` trigger execution.
- Viewer clients MUST render an HTML `<form>`, prevent native navigation on
  submit, gather current field values, and run the configured submit action.
  Networked model generation is implied only when `pluginConfig.submitAction` is
  `"ai-generate"` and the host provides a chat client or proxy.
- Form scripts run through the installed scripting runtime. During form script
  execution, `doc.form` exposes `get_value(label)`, `set_value(label, value)`,
  `get_values()`, `set_options(label, options)`, `get_options(label)`,
  `set_error(label, message)`, and `clear_error(label)`.
- Dynamic dropdown/radio options SHOULD be set by scripts using
  `doc.form.set_options(...)` rather than by schema-level database source
  declarations.

### 7.8 Graph plugin contract

The built-in graph plugin is `hvy.graph`. Graph attributes live in
`pluginConfig`; chart data lives in the plugin text body as CSV.

Declaration example:

```yaml
plugins:
  - id: hvy.graph
    source: builtin://graph
```

Block example:

```markdown
<!--hvy:plugin {"plugin":"hvy.graph","pluginConfig":{"type":"bar","title":"Example","xAxisLabel":"Label","yAxisLabel":"Value","legend":true}}-->
Label,Value
Example A,10
Example B,20
```

Plugin-specific rules:
- `pluginConfig.type` is optional and defaults to `"bar"`. Supported values are
  `"bar"`, `"line"`, `"pie"`, `"doughnut"`, `"scatter"`, `"bubble"`,
  `"radar"`, and `"polarArea"`.
- `pluginConfig.title`, `pluginConfig.xAxisLabel`, and
  `pluginConfig.yAxisLabel` are optional strings.
- `pluginConfig.legend` is optional and defaults to `true`.
- The plugin text body MUST be interpreted as CSV with the first row as column
  headers.
- Graph renderers MUST use existing shared theme color variables for chart text,
  grid lines, outlines, and series colors. The graph plugin MUST NOT define
  graph-specific document theme color variables.
- For `"bar"`, `"line"`, and `"radar"` charts, the first CSV column is labels
  and all following columns are numeric datasets.
- For `"pie"`, `"doughnut"`, and `"polarArea"` charts, the first CSV column is
  labels and the first numeric data column is used.
- `"scatter"` charts use numeric `x` and `y` columns. `"bubble"` charts use
  numeric `x`, `y`, and `r` columns.
- Invalid CSV or non-numeric chart values SHOULD render an inline plugin error
  while preserving the original plugin text body.

### 7.9 Diagram plugin contract

The built-in diagram plugin is `hvy.diagram`. Diagram source lives in the
plugin text body as Mermaid text. `pluginConfig.syntax` is optional and defaults
to `"mermaid"`.

Declaration example:

```yaml
plugins:
  - id: hvy.diagram
    source: builtin://diagram
```

Block example:

```markdown
<!--hvy:plugin {"plugin":"hvy.diagram","pluginConfig":{"syntax":"mermaid"}}-->
flowchart TD
  start[Start] --> review{Review}
  review -->|Approved| ship[Ship]
  review -->|Needs work| edit[Edit]
  edit --> review
```

Plugin-specific rules:
- The plugin text body MUST be interpreted as Mermaid source.
- `pluginConfig.syntax` MAY be omitted. When present, clients MUST treat
  `"mermaid"` as Mermaid source. Other syntax values are reserved.
- Invalid Mermaid source SHOULD render an inline plugin error while preserving
  the original plugin text body.
- Renderers MUST sanitize the generated SVG/HTML before inserting it into the
  document.

### 7.10 QR code plugin contract

The built-in QR code plugin is `hvy.qr-code`. The encoded QR payload lives in
the plugin text body. QR caption and visual style live in `pluginConfig`.
Rendered size and alignment SHOULD use the standard block `css` field, matching
image component sizing conventions.

Declaration example:

```yaml
plugins:
  - id: hvy.qr-code
    source: builtin://qr-code
```

Block example:

```markdown
<!--hvy:plugin {"plugin":"hvy.qr-code","pluginConfig":{"caption":{"text":"Scan code","schema":{"kind":"text","component":"text","align":"center"}},"foregroundColor":"#111827","backgroundColor":"#ffffff","dotsType":"square","cornersSquareType":"square","cornersDotType":"square"}}-->
https://example.invalid/qr-code
```

Plugin-specific rules:
- The plugin text body MUST be interpreted as the QR code payload string.
- `pluginConfig.caption` is an optional text caption payload rendered below the QR code. It has the same shape and centered default as image `caption`.
- Renderers SHOULD use the highest QR error correction level that can encode the
  current payload, trying `"H"`, then `"Q"`, then `"M"`, then `"L"`.
- `pluginConfig.foregroundColor` and `pluginConfig.backgroundColor` are
  optional `#rrggbb` color strings.
- `pluginConfig.dotsType` is optional and defaults to `"square"`. Supported
  values are `"square"`, `"dots"`, `"rounded"`, `"classy"`,
  `"classy-rounded"`, and `"extra-rounded"`.
- `pluginConfig.cornersSquareType` is optional and defaults to
  `"square"`. Supported values are `"square"`, `"dot"`,
  `"extra-rounded"`, `"dots"`, `"rounded"`, `"classy"`, and
  `"classy-rounded"`.
- `pluginConfig.cornersDotType` is optional and defaults to `"square"`. Supported
  values are `"square"`, `"dot"`, `"dots"`, `"rounded"`, `"classy"`,
  `"classy-rounded"`, and `"extra-rounded"`.
- PHVY/PDF export renderers SHOULD resolve QR code plugin blocks to ordinary
  `image` blocks backed by SVG image attachments. The authored plugin block
  MUST remain unchanged.

## 8. Security & Runtime Constraints

Client assumptions from product requirements:
- Offline-first by default.
- Network access is disabled unless user explicitly enables it.
- No script execution except installed plugins.

Normative behavior:
- Renderers MUST NOT execute JavaScript from document content.
- Renderers MUST escape raw HTML in Markdown content. Rich visual structures SHOULD be represented with HVY components and metadata rather than inline HTML.
- Remote resource fetches MUST be gated behind user network permission.
- Plugin installation MUST show `id` and `source` before trust is granted.
- Clients MUST treat tail payload bytes as untrusted input and only hand them to the declared plugin after normal trust checks.
- Renderers MUST sanitize document-supplied CSS (inline `css` fields, fenced `~~~css` blocks, `hvy:css` directives, `theme.colors` values, `component_defaults.*.css`, `section_defaults.css`, `text_line_styles.*.css`, `heading_styles.*.css`, and section/block `css`) so it cannot trigger network fetches unless the user has explicitly enabled external CSS resources. Specifically, renderers MUST drop or neutralize `url(...)`, `image-set(...)`, `src(...)`, `src:` declarations, and the at-rules `@import`, `@font-face`, `@namespace`, and `@property`. Sanitization MUST decode CSS character escapes (e.g. `u\72l(...)` and `\55RL(...)`) before pattern matching so obfuscated forms are also blocked.

## 9. Parsing Rules (Normative)

1. Read the file as bytes.
2. If the byte stream contains one or more consecutive `hvy:tail` directives immediately followed by `--HVY-TAIL--`, split the file into text bytes before the directives and opaque tail bytes after the sentinel. Each tail directive's `length` field controls how many bytes belong to that attachment, in declaration order. Otherwise treat the whole file as text bytes.
3. Decode the text bytes as UTF-8 text.
4. Parse YAML front matter if present at file start.
5. Parse Markdown into block structure. `<!--hvy: {...}-->` directives define top-level sections; `<!--hvy:subsection {...}-->` directives define subsections. An optional `#!` line immediately following sets the section title; it is consumed and not rendered. Standard ATX headings are plain content.
6. Attach `<!--hvy:doc ...-->`, `<!--hvy:css ...-->`, block component directives such as `<!--hvy:text ...-->`, legacy `<!--hvy:block ...-->`, and `<!--hvy:expandable...-->` directives per placement rules.
7. Extract CSS fenced blocks (language `css`) and optional preceding `hvy:css` metadata.
8. Build section tree from directive types (`hvy:` = top-level, `hvy:subsection` = child).
9. Validate template rules when extension is `.thvy`: require `hvy_version`.

## 10. Validation

Document is valid HVY if:
- It is parseable Markdown text.
- Any `hvy:*` JSON directive is syntactically valid JSON.
- If `hvy:tail` directives are present, they form a consecutive block immediately preceding `--HVY-TAIL--`, and only appear in `.hvy`.

Additional validity for `.thvy`:
- If `schema` is present, it is valid against the supported subset.

Additional validity for `.phvy`:
- All rendered component base types MUST be PDF-compatible: `text`, `container`, `grid`, `image`, or static `table`.
- Sections MUST NOT use `location: sidebar`.

## 11. Recommended MIME and Media Types

Proposed (experimental):
- `text/hvy` for `.hvy`
- `text/thvy` for `.thvy`
- `text/phvy` for `.phvy`

## 12. Future Work

- Canonical schema dialect identifier.
- Plugin package signature standard.
- Deterministic section ID generation profile.
- Static export profile for archive-safe rendering.
