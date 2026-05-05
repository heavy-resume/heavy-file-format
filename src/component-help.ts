const HVY_COMPONENT_HELP: Record<string, string[]> = {
  text: [
    'Text component: Markdown block content rendered in normal document flow.',
    'The body may contain prose, headings, lists, blockquotes, fenced code blocks, thematic breaks, and inline Markdown formatting.',
    'Use Markdown fences for code; structural indentation around HVY directives is not Markdown code indentation.',
    'Raw HTML in text content is preserved as source text but renderers must escape or sanitize it.',
  ],
  quote: [
    'Quote component: Markdown body rendered as a blockquote.',
    'Use it for quoted or called-out prose, not for nested child components.',
  ],
  image: [
    'Image component: renders a binary image attachment from imageFile.',
    'imageFile is required and names the document tail attachment with id image:<filename>.',
    'imageAlt is optional alternate text for the rendered image.',
  ],
  table: [
    'Table component: static table data rendered from configured rows and columns.',
    'In the CLI, tableColumns.json is a JSON array of strings and tableRows.json is a JSON array of string arrays.',
    'In raw HVY schema, tableColumns is a comma-separated column list.',
    'tableShowHeader controls whether the header row is shown.',
    'In raw HVY schema, tableRows is an array of rows, and each row contains only cells, for example {"cells":["Example","Open"]}.',
    'Tables are non-interactive; use surrounding components when rows need narrative detail or reveal/hide behavior.',
  ],
  container: [
    'Container component: groups nested HVY components.',
    'containerBlocks holds the child block array.',
    'Plain Markdown before the first numbered container slot is treated as the first implicit child block.',
    'Numbered container slots order children by their numeric suffix; slot markers carry only slot metadata.',
  ],
  'component-list': [
    'Component-list component: repeated child components.',
    'componentListComponent describes what kind of item the list is expected to contain.',
    'componentListItemLabel is a human-friendly singular label for add/edit prompts.',
    'componentListBlocks holds the ordered child blocks.',
    'Numbered component-list slots are sorted by numeric suffix, with file order only breaking ties.',
    'Plain Markdown before the first numbered slot is treated as the first implicit child block.',
  ],
  grid: [
    'Grid component: lays out child components visually like a CSS grid.',
    'gridColumns is a number controlling the column layout.',
    'gridItems holds ordered grid slots; readers tile items across gridColumns and wrap to new rows.',
    'Each numbered grid slot carries only slot metadata; the child block is nested one level deeper.',
  ],
  expandable: [
    'Expandable component: reveal/hide component with stub and content slots.',
    'The stub is the always-visible summary; content is the detail shown when expanded.',
    'Each expandable must have at least one stub child and one content child.',
    'expandableAlwaysShowStub controls whether the stub remains visible while expanded.',
    'expandableExpanded stores the default expanded state.',
    'Pane-level styles belong to the stub/content slots in inline HVY and to expandableStubCss/expandableContentCss in schema form.',
  ],
  plugin: [
    'Plugin component: host-resolved extension block rendered in normal document flow.',
    'plugin is the required plugin identifier; pluginConfig is optional plugin-owned metadata.',
    'The body is plugin-owned free-form text and must be preserved verbatim rather than interpreted as Markdown or HVY.',
    'If the plugin is unavailable, clients should preserve the block and show an unavailable-plugin placeholder.',
  ],
  'xref-card': [
    'xref-card component: visible cross-reference card linking to another component or section.',
    'xrefTitle is required and is the visible card title.',
    'xrefDetail is optional supporting text shown on the card.',
    'xrefTarget is the target id without #. If omitted, the card is preserved but disabled/non-navigable.',
    'Use xref-cards instead of plain links when referencing another HVY item.',
  ],
};

export function getHvyComponentHelpLines(component: string): string[] {
  return HVY_COMPONENT_HELP[component.trim().toLowerCase()] ?? [];
}

export function getHvyComponentHelp(component: string): string {
  return getHvyComponentHelpLines(component).join(' ');
}
