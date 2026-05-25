# PDF Export Strategy

PDF export has two separate responsibilities:

1. **Planning:** decide what the export should contain and how HVY targets should be treated.
2. **Rendering:** deterministically turn the cloned, filtered HVY document into pdfmake nodes.

The planner may use AI. The renderer must not. AI can propose a `contentView`, an `HvyPdfExportStrategy`, and an optional prep script, but PDF bytes are generated only after deterministic validation succeeds.

## Data Flow

```text
HVY document
  -> clone document
  -> apply contentView / reader-view semantics
  -> run optional export prep script on the clone
  -> resolve HvyPdfExportStrategy rules
  -> convert visible sections/components to pdfmake nodes
  -> validate output
  -> generate/download PDF
```

The export strategy is the stable boundary between an AI planner and PDF generation. It is not raw PDF layout code.

## What AI Sees

The default planner gets a compact packet, not the full document:

- the rendered user prompt
- allowed strategy actions
- current content view
- semantic matches, if any
- unsupported visible components
- compact allowed targets, prioritized by unsupported/matched/current-view targets
- compact candidate summaries
- counts showing whether candidates or targets were truncated

Each individual LLM context is capped at 20,000 characters. If a planning call exceeds that, it fails before calling a model.

Embedded hosts may provide their own `strategyProvider`. They receive the structured request object and can apply their own budgeting, ranking, or model flow.

## Strategy Shape

A strategy is ordered rules plus defaults and an optional prep script:

```json
{
  "defaults": {
    "pageSize": "LETTER",
    "pageMargins": [40, 36, 40, 36],
    "font": "Roboto",
    "unsupportedPluginPolicy": "error"
  },
  "rules": [
    { "id": "summary", "include": true, "keepWithNext": true },
    { "tag": "resume-primary", "include": true },
    { "componentTag": "pdf-hide", "hide": true },
    { "baseComponent": "expandable", "stubThenContent": true, "keepTogether": true }
  ],
  "prepScript": "doc.export.hide('pdf-hide')"
}
```

Rules can target:

- `id`: stable section/component id, for example `summary`
- `path`: CLI-style path, for example `/id/history/project-heavy-stack`
- `component`: concrete component name, for example `xref-card`
- `baseComponent`: renderer behavior family, for example `expandable`
- `tag`, `sectionTag`, `componentTag`

Rules can act with:

- visibility: `include`, `hide`, `dim`, `highlight`
- expandable behavior: `expand`, `collapse`, `stubOnly`, `contentOnly`, `stubThenContent`
- pagination hints: `keepTogether`, `keepWithNext`, `allowSplit`, `pageBreakBefore`, `pageBreakAfter`
- roles: `asHeading`, `asBody`, `asMetadata`, `asSidebar`
- rendering: `pdfStyle`, `adapter`

Later scalar settings override earlier ones. `hide` remains sticky unless a later explicit `include` targets the same item.

## Resume Example

`examples/resume.hvy` defines a prompt template:

```yaml
export_prompt_templates:
  - id: tailor-resume-export
    label: Tailor resume for prompt
    prompt: |-
      Plan a PDF export of this document for the following criteria.

      {% target_context | block %}
```

For a fake role like **ExampleCo Platform Tooling Role**, the pasted context might ask for Python, cloud systems, developer tooling, and AI integration. The planner should not rewrite the HVY file. It should produce a view and strategy that select the relevant existing content.

Example plan output:

```json
{
  "contentView": {
    "summary": ["priority", "highlight"],
    "history": ["priority"],
    "tools-technologies": ["priority"],
    "resume-publications": ["hidden"]
  },
  "rules": [
    { "id": "summary", "include": true, "keepWithNext": true },
    { "id": "history", "include": true },
    { "sectionTag": "resume-primary", "include": true },
    { "tag": "python", "highlight": true },
    { "tag": "cloud", "highlight": true },
    { "tag": "developer-tools", "highlight": true },
    { "tag": "weak-match", "hide": true },
    { "baseComponent": "expandable", "stubThenContent": true, "keepTogether": true },
    { "component": "plugin", "hide": true }
  ],
  "decisions": [
    {
      "target": "summary",
      "action": "include",
      "reason": "The summary is the top-level narrative for the export."
    },
    {
      "target": "tag:developer-tools",
      "action": "highlight",
      "reason": "The pasted criteria emphasize tooling and developer velocity."
    },
    {
      "target": "component:plugin",
      "action": "hide",
      "reason": "No PDF adapter is available for visible plugin components."
    }
  ]
}
```

The deterministic renderer then resolves those rules against the cloned export document:

- `contentView` can hide, deprioritize, or highlight existing reader targets.
- strategy rules decide final PDF visibility and presentation.
- unsupported visible plugins still fail unless hidden or handled by an adapter.
- expandable records use the selected pane policy.
- `keepTogether` and `keepWithNext` become pdfmake pagination hints.

## Prep Script

Prep scripts run only on the export clone. They are useful when the export needs computed tags or clone-only text adjustments.

Example:

```python
doc.export.hide("weak-match")
doc.export.keep_together("resume-primary")
doc.export.strategy({"baseComponent": "expandable", "stubThenContent": True})
```

The prep script may add runtime strategy rules through `doc.export`. It must be visible in the review/debug panel before PDF generation.

## Validation Gates

Before generating a PDF, validation rejects:

- unknown ids, paths, tags, components, or actions
- predicate functions from AI output
- unsupported visible plugin/components
- empty PDF output
- raw HVY markers in generated pdfmake content
- per-call LLM contexts over 20,000 characters

These gates are meant to keep AI in the planning lane and keep PDF generation deterministic.

## Design Rule Of Thumb

AI should answer:

> “Which existing HVY targets matter for this export, and what export policy should apply to them?”

The PDF renderer should answer:

> “Given this validated strategy, how do I produce a stable PDF?”

Those two questions should stay separate.
