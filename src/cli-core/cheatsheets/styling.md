# Styling Cheatsheet

Prefer theme variables and reusable defaults over repeated one-off inline styling.

Use component `css`, section `css`, `component_defaults`, and `section_defaults` for CSS properties. Use `theme.colors` for shared custom properties such as `--hvy-bg`, `--hvy-text`, and `--hvy-accent-1`.

Inspect styling sources:

```shell
cat /header.yaml
grep -n "theme:\\|component_defaults:\\|section_defaults:" /header.yaml
hvy request_structure --collapse
cat /body/demo-area/example-component/component.json
```

Use `theme.colors` for shared colors:

```yaml
theme:
  colors:
    --hvy-bg: "#ffffff"
    --hvy-text: "#1f2a37"
    --hvy-accent-1: "#1f7a8c"
    --hvy-border: "#d2dde6"
```

Use `component_defaults` for document-wide component presentation:

```yaml
component_defaults:
  widget-record:
    css: "padding: 0.5rem; background: var(--hvy-surface);"
```

Use `section_defaults` for document-wide section wrapper styling:

```yaml
section_defaults:
  css: "margin: 0.5rem 0;"
```

Use a component or section `css` field for a local adjustment:

```shell
cat /body/demo-area/example-component/component.json
sed -i 's/"css":"[^"]*"/"css":"margin: 0;"/' /body/demo-area/example-component/component.json
```

Inline `css` values are declaration-only, like an HTML `style` attribute. Do not put selectors, `@media`, `@container`, or `@import` in inline `css`.

Use CSS blocks for selectors or responsive rules:

```markdown
<!--hvy:css {"id":"fake-widget-layout","scope":"document"}-->
~~~css
@container hvy-surface (max-width: 40rem) {
  .reader-block[data-component="widget-record"] {
    padding: 0.5rem;
  }
}
~~~
```

Use container queries for responsive document behavior. The reader/editor surface may be rendered inside an emulated preview frame, so viewport-only media queries can be misleading.

Validate after styling changes:

```shell
hvy lint
hvy preview /body/demo-area/example-component
```
