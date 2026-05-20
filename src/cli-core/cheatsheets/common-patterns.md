# Common Structural Patterns Cheatsheet

Use this cheatsheet to recognize where content lives in the virtual filesystem. Inspect structure before editing text or copying components.

Start with a structural map:

```shell
hvy request_structure --collapse
hvy request_structure COMPONENT_ID --describe
ls /body/demo-area
```

## Section With Intro Text

Raw HVY often looks like a section header followed by an indented text component:

```markdown
<!--hvy: {"id":"demo-area"}-->
#! Demo Area

 <!--hvy:text {"id":"intro-blurb"}-->
  Example body text.
```

In the virtual filesystem, the section metadata and visible body text are separate:

```shell
cat /body/demo-area/section.json
cat /body/demo-area/intro-blurb/text.txt
```

Edit the section title, id, description, tags, lock, or section CSS in `section.json`. Edit the visible paragraph body in the child component's `text.txt`.

## Component Directory Shape

Most components expose a config JSON, CSS file, body text preview/file, and help:

```shell
ls /body/demo-area/example-component
cat /body/demo-area/example-component/component.json
cat /body/demo-area/example-component/component.css
cat /body/demo-area/example-component/component.txt
cat /body/demo-area/example-component/about-component.txt
```

The exact filenames use the component type. A text component has `text.json`, `text.css`, and `text.txt`; an xref card has `xref-card.json`, `xref-card.css`, and `xref-card.txt`.

## Component List Items

A `component-list` stores repeated child item components directly inside the list directory:

```shell
cat /body/demo-area/widget-list/component-list.json
ls /body/demo-area/widget-list
cat /body/demo-area/widget-list/children-order.json
```

Read `componentListComponent` in `component-list.json` before adding an item:

```shell
hvy insert -1 widget-record /body/demo-area/widget-list widget-orbital
```

Use `children-order.json` only for reordering existing children. It should contain each child directory key exactly once.

## Containers, Expandables, And Grids

Containers put children under `container/`:

```shell
ls /body/demo-area/panel-box/container
cat /body/demo-area/panel-box/container/children-order.json
```

Expandables split visible stub content from hidden/expanded content:

```shell
ls /body/demo-area/details-box/expandable-stub
ls /body/demo-area/details-box/expandable-content
```

Grids put grid item components under `grid/`:

```shell
ls /body/demo-area/tile-grid/grid
cat /body/demo-area/tile-grid/grid/children-order.json
```

When copying or adding to one of these structures, insert into the container path that actually owns the children.

## Xrefs And Targets

Xref cards point at another id with `xrefTarget`:

```shell
cat /body/demo-area/pointer-card/xref-card.json
hvy request_structure target-widget --describe
hvy preview /id/target-widget
```

When copying a referenced component, decide whether xref cards should still point to the old target or the new copied id. Update `xrefTarget` only when the reference should move.

## Copying Components

Copy a component directory with `cp -r`:

```shell
cp -r /body/demo-area/widget-list/widget-alpha /body/demo-area/widget-list/widget-orbital
```

The destination path supplies the copied root component id. After copying, inspect the copy:

```shell
cat /body/demo-area/widget-list/widget-orbital/widget-record.json
find /body/demo-area/widget-list/widget-orbital -type f
rg -n "widget-alpha|Alpha Widget|target-widget" /body/demo-area/widget-list/widget-orbital
```

Then update copied content and ids that should be unique:

```shell
sed -i 's/"Alpha Widget"/"Orbital Widget"/' /body/demo-area/widget-list/widget-orbital/widget-record.json
sed -i 's/widget-alpha/widget-orbital/g' /body/demo-area/widget-list/widget-orbital/widget-record.txt
```

Review nested custom ids, `xrefTarget`, `sortKeys`, `groupKeys`, and visible text. The root copied component gets the destination id, but nested components and references still need a deliberate pass.

## Verify Structure

After structural edits:

```shell
hvy lint
hvy request_structure --collapse
hvy preview /body/demo-area/widget-list/widget-orbital
```

