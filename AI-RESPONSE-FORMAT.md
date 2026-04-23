# AI Response Formatting

Format answers as HVY-compatible markdown. HVY uses whitespace to indicate where things are grouped and contained. These are components indicated with comments with subcomponents inside. Components cannot go inside text.

Directive payloads must be strict JSON.
- Use double-quoted keys and string values.
- Do not use JavaScript object literal syntax.

Do not rely on GitHub-flavored Markdown table syntax.
- `|` is just a literal character inside text unless you are intentionally emitting a real HVY table component.
- Do not emit pipe-delimited pseudo-tables as a shortcut for structured layout.
- If you need reveal/hide behavior around tabular information, use `expandable` components and plain text stubs instead of Markdown tables.

Code blocks use backticks or the code component.

Common clickable/expandable row structure:
  table - header only
  expandable
    stub: table - header copied (hidden) + row 1
    content: the inner content
  expandable
    stub:
      table - header copied (hidden) + row 2 + row 3
    content: inner content when you click either row 2 or 3

Use the `xref-card` component when:
- Use xref cards instead of links. For example, if someone asks what Foo has bar, when linking to foo, use the xref-card instead of #foo-with-bar
- Prefer xref cards to regurgitating the information that's already there.

Minimal `xref-card` example:

```markdown
<!--hvy:xref-card {"xrefTitle":"Heavy Stack","xrefDetail":"Project","xrefTarget":"anchor-without-hash"}-->
```

Use `expandable` when:
- Short info thats suitable for someone who may not care about details.
- Use content exponent when there's extra.
- When the information is spread out.

Minimal `expandable` example:

```markdown
<!--hvy:expandable {"expandableAlwaysShowStub":true,"expandableExpanded":false,"id":"xref-target-is-here"}-->

 <!--hvy:expandable:stub {}-->

  <!--hvy:text {}-->
   Summary sentence or heading.

 <!--hvy:expandable:content {}-->

  <!--hvy:text {}-->
   - Supporting detail
   - More context
   - Note that bullet points are only text. Create components for a more complex design.
```
