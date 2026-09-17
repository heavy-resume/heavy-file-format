# Reusable Definition Cheatsheet

Reusable definitions live under `/templates/components/NAME` and `/templates/sections/KEY`. These virtual directories edit `component_defs` and `section_defs` in the saved HVY header. Document instances, including unnamed components, live under `/body`. `/header.yaml` excludes and preserves both definition collections.

## Discover and inspect

```shell
ls /templates/components
ls /templates/sections
cat /templates/components/fake-card/definition.json
ls /templates/components/fake-card/schema
ls /templates/sections/fake-section/template
```

Copy exact paths from `ls`; definition names are percent-encoded in paths. A definition's `definition.json` exposes metadata without its nested component tree. Component `schema/` and section `template/` reuse the ordinary CLI files, including component JSON, CSS, body text, table data, nested directories, and child ordering. Inspect only the relevant subtree with `ls`, `find PATH -maxdepth N`, and `cat` to keep large-document work bounded. The `/raw.hvy` size limit does not restrict these paths.

## Create a component definition

```shell
hvy insert -1 grid /templates/components --id fake-card
hvy insert -1 text /templates/components/fake-card/schema/grid --id fake-label
printf 'Fake label' > /templates/components/fake-card/schema/grid/fake-label/text.txt
cat /templates/components/fake-card/schema/grid.json
sed -i 's/"gridColumns": 2/"gridColumns": 3/' /templates/components/fake-card/schema/grid.json
```

Inspect the actual JSON before patching; the last command applies only if the inspected value is 2. Names are required and unique. `INDEX` uses the same ordering as other insertions: 0 is first, -1 is last.

To preserve an existing component as a definition:

```shell
cp -r /body/fake-area/fake-existing /templates/components/fake-copy
```

Copies are independent and preserve the source's content and styling. A definition can also be copied from its definition directory. Use an explicit new destination name.

## Create a section definition

```shell
hvy insert -1 section /templates/sections --id fake-section
hvy insert -1 fake-card /templates/sections/fake-section/template --id fake-card-instance
```

Or copy an existing section:

```shell
cp -r /body/fake-area /templates/sections/fake-section-copy
```

Section `definition.json` exposes `repeatable` and template-variable metadata. `template/section.json` edits the section's own title, styling, and other fields. Components use the existing insert commands within `template/`. Use containers to group nested components.

## Edit metadata and flavors

Read `definition.json`, then write the complete intended metadata JSON. Keep identity fields (`name`, section `key` when present, and component `baseType`) unchanged; create a new definition to change identity or base type. Omitted optional metadata fields are removed. Edit tree contents through their directories rather than putting `schema`, `template`, `text`, or `flavors` into `definition.json`.

Alternate flavors live under each definition's `flavors/` directory, with their own `definition.json` and `schema/` or `template/`. Create a flavor using the same base component or section:

```shell
hvy insert -1 grid /templates/components/fake-card/flavors --id fake-alternate
hvy insert -1 section /templates/sections/fake-section/flavors --id fake-alternate
```

Template tokens such as `{% fake_label %}` can appear in root or nested text and schema strings. Configure their types, labels, and generators in `definition.json` under `templateVariables`. Set a variable's `type` to `url` to use the text editor's link normalization and Markdown destination encoding; keep its token as `{% fake_link %}`. Tokens stay unfilled while editing a definition.

## Instantiate in the document

```shell
hvy insert -1 fake-card /body/fake-area --id fake-instance
hvy insert -1 section /body --from-template fake-section
```

When a definition contains tokens, supply all and only the expected string values:

```shell
hvy insert -1 fake-card /body/fake-area --id fake-filled --using-template '{"fake_label":"Fake value"}'
```

Definition edits affect future instances; they do not replace existing `/body` contents. Edit an instance's own virtual files to change it.

## Remove and verify

```shell
hvy remove /templates/components/fake-card/schema/grid/fake-label
hvy remove /templates/components/fake-card/flavors/fake-alternate
hvy remove /templates/components/fake-card
ls /templates/components
hvy lint
```

Removing a definition does not remove its existing instances or references. Update those references when retiring a definition. Root `schema/` and `template/` directories cannot be removed independently; remove the definition directory instead. Nested components support `cp -r`, `mv`, `hvy remove`, and `children-order.json` as in `/body`.
