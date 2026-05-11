# Reusable Component Cheatsheet

Reusable component definitions live in `/header.yaml` under `component_defs`. They define reusable authoring templates; component instances live in `/body`.

Find available reusable components:

```shell
grep -n "component_defs" /header.yaml
hvy request_structure --collapse
find /docs -maxdepth 1 -type f
cat /docs/about-widget-record.txt
```

Inspect a reusable component list before adding an item:

```shell
hvy search "example widget"
hvy request_structure COMPONENT_ID --describe
cat /body/demo-area/widget-list/component-list.json
ls /body/demo-area/widget-list
```

Create an instance of a reusable component:

```shell
hvy insert -1 widget-record /demo-area/widget-list widget-orbital
```

If the reusable definition has template values, pass exact JSON keys expected by the definition:

```shell
hvy insert -1 widget-record /demo-area/widget-list widget-orbital '{"label":"Orbital Widget","bucket":"Fake Group"}'
```

After creating a reusable instance, inspect the generated files and edit those files directly:

```shell
ls /body/demo-area/widget-list/widget-orbital
cat /body/demo-area/widget-list/widget-orbital/component.json
cat /body/demo-area/widget-list/widget-orbital/component.txt
hvy preview /body/demo-area/widget-list/widget-orbital
```

When a reusable component contains nested slots, use the generated nested paths rather than flattening content into the parent:

```shell
hvy request_structure widget-orbital --describe
ls /body/demo-area/widget-list/widget-orbital
```

Edit the reusable definition only when changing the template for future instances:

```shell
cat /header.yaml
grep -n "name: widget-record" /header.yaml
```

Edit an existing instance when changing one visible item:

```shell
cat /body/demo-area/widget-list/widget-orbital/component.json
sed -i 's/"Orbital Widget"/"Orbital Widget Revised"/' /body/demo-area/widget-list/widget-orbital/component.json
```

Use `componentListComponent` to identify what kind of item a list accepts. A request like "add another like this" should still inspect the selected component, its parent list, and the list's `componentListComponent` before choosing where to insert.
