const componentDocModules = import.meta.glob('./component-docs/about-*.txt', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>;

const componentDocs = new Map(
  Object.entries(componentDocModules)
    .map(([path, content]) => {
      const match = path.match(/\/about-(.+)\.txt$/);
      return match ? [match[1], content.trim()] : null;
    })
    .filter((entry): entry is [string, string] => !!entry)
);

function getHelpLines(name: string): string[] {
  const content = componentDocs.get(name.trim().toLowerCase()) ?? '';
  return content ? content.split(/\r?\n/) : [];
}

export function getHvySectionHelpLines(): string[] {
  return getHelpLines('section');
}

export function getHvySectionHelp(): string {
  return getHvySectionHelpLines().join(' ');
}

export function getHvyComponentHelpLines(component: string): string[] {
  return getHelpLines(component);
}

export function getHvyComponentHelp(component: string): string {
  return getHvyComponentHelpLines(component).join(' ');
}
