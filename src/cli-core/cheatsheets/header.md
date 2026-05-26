# Header Cheatsheet

The document header is the YAML front matter for document-wide metadata, reusable definitions, theme colors, and defaults.

Inspect the header before patching it:

```shell
cat /header.yaml
grep -n "component_defs\|section_defs\|theme\|component_defaults\|section_defaults\|heading_styles" /header.yaml
nl -ba /header.yaml
```

Use the header for document-level concerns:

- `title`, `description`, `tags`, `sidebar_label`, and `reader_max_width`
- `theme.colors`
- `component_defs` and `section_defs`
- `component_defaults`, `section_defaults`, and `heading_styles`
- plugin or template metadata that belongs to the whole document

Use body component files for visible content:

```shell
hvy search "example widget"
hvy request_structure --collapse
hvy preview /body/demo-area/example-widget
cat /body/demo-area/example-widget/component.json
cat /body/demo-area/example-widget/text.txt
```

Patch small header values with `sed` only after locating the line:

```shell
grep -n "reader_max_width" /header.yaml
sed -i '12c\reader_max_width: 72ch' /header.yaml
```

For larger YAML changes, rewrite `/header.yaml` with complete valid YAML:

```shell
cat > /header.yaml <<'EOF'
hvy_version: 0.1
title: Fake Widget Catalog
section_defaults:
  css: "margin: 0.5rem 0;"
theme:
  colors:
    --hvy-bg: "#ffffff"
    --hvy-text: "#1f2a37"
EOF
```

`section_defaults` currently supports `css`. Do not invent fields such as `wrapper_style`; put declaration-only CSS in `css`.

Validate after editing:

```shell
hvy lint
cat /header.yaml
```
