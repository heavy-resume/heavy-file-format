const HVY_COMPONENT_HELP: Record<string, string[]> = {
  text: [
    'Text component: plain Markdown-like document content.',
    'The component body is the visible text shown in the document.',
  ],
  table: [
    'Table component: static table data rendered from configured rows and columns.',
    'tableColumns is a comma-separated column list.',
    'tableRows is an array of row objects like {"cells":["Example","Open"]}.',
  ],
  container: [
    'Container component: groups nested HVY components.',
    'The container config controls wrapper metadata; visible content usually lives in nested child components.',
  ],
  'component-list': [
    'Component-list component: repeated child components.',
    'componentListComponent describes what kind of item the list is expected to contain.',
    'componentListItemLabel is a human-friendly singular label for add/edit prompts.',
    'The visible text may be an aggregate of nested children. Edit/remove individual list items under component-list/ when changing one item.',
  ],
  grid: [
    'Grid component: lays out child components visually like a CSS grid.',
    'gridColumns controls the column layout.',
    'Child components live under grid/ and render in slot order, wrapping to new rows as needed.',
    'To change visible grid content, inspect or edit the specific child component under grid/.',
  ],
  expandable: [
    'Expandable component: reveal/hide component with stub and content slots.',
    'The stub is the always-visible summary; content is the detail shown when expanded.',
    'Edit nested children under expandable-stub/ or expandable-content/ for visible text.',
  ],
  plugin: [
    'Plugin component: registered plugin block.',
    'The plugin id selects the registered plugin implementation.',
    'pluginConfig stores plugin-specific metadata.',
    'The component body stores plugin-owned text, YAML, scripts, or other plugin-specific content.',
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
