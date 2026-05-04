const cheatsheetModules = import.meta.glob('./cheatsheets/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

const recipeModules = import.meta.glob('./recipes/*.hvy', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

export function getHvyCheatsheetNames(): string[] {
  return getReferenceNames(cheatsheetModules);
}

export function getHvyRecipeNames(): string[] {
  return getReferenceNames(recipeModules);
}

export function formatHvyCheatsheetList(): string {
  return formatReferenceList('Cheatsheets', 'hvy cheatsheet NAME', getHvyCheatsheetNames());
}

export function formatHvyRecipeList(): string {
  return formatReferenceList('Recipes', 'hvy recipe NAME', getHvyRecipeNames());
}

export function getHvyCheatsheet(name: string): string | null {
  return getReferenceContent(cheatsheetModules, name);
}

export function getHvyRecipe(name: string): string | null {
  return getReferenceContent(recipeModules, name);
}

function getReferenceNames(modules: Record<string, string>): string[] {
  return Object.keys(modules).map(getReferenceNameFromPath).sort();
}

function getReferenceContent(modules: Record<string, string>, name: string): string | null {
  const normalizedName = name.trim();
  if (!normalizedName) {
    return null;
  }
  const entry = Object.entries(modules).find(([path]) => getReferenceNameFromPath(path) === normalizedName);
  return entry ? entry[1].trim() : null;
}

function getReferenceNameFromPath(path: string): string {
  return path.replace(/^.*\//, '').replace(/\.[^.]+$/, '');
}

function formatReferenceList(title: string, command: string, names: string[]): string {
  return [
    `${title}:`,
    ...(names.length > 0 ? names.map((name) => `- ${name}`) : ['- (none)']),
    `Run \`${command}\` to view one.`,
  ].join('\n');
}
