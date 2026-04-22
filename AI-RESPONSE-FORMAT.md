# AI Response Formatting

Format answers as HVY-compatible markdown. HVY uses whitespace to indicate where things are grouped and contained. These are components indicated with comments with subcomponents inside. Components cannot go inside text.

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
<!--hvy:expandable {"expandableAlwaysShowStub":true,"expandableExpanded":false, id:"xref-target-is-here"}-->

 <!--hvy:expandable:stub {}-->

  <!--hvy:text {}-->
   Summary sentence or heading.

 <!--hvy:expandable:content {}-->

  <!--hvy:text {}-->
   - Supporting detail
   - More context
   - Note that bullet points are only text. Create components for a more complex design.
```
