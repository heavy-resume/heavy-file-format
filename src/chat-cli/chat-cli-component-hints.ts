import { buildHvyVirtualFileSystem, resolveVirtualPath, type HvyVirtualEntry } from '../cli-core/virtual-file-system';
import { tokenizeCommand } from '../cli-core/commands';
import { getHvyCliPluginCommandRegistrationByPluginId } from '../cli-core/plugin-command-registry';
import { extractVirtualPathsFromOutput, formatHvyStructureForPaths } from '../cli-core/request-structure';
import { getHvyComponentHelpLines } from '../component-help';
import type { VisualDocument } from '../types';

const COMPONENT_HINTS_MAX_COUNT = 3;

export function buildChatCliComponentHints(params: {
  document: VisualDocument;
  cwd: string;
  command: string;
  output?: string;
}): string {
  const fs = buildHvyVirtualFileSystem(params.document);
  const commandHints = collectCommandComponentPaths(params.command, params.cwd, fs)
    .map((path) => buildComponentPathHint(path, fs))
    .filter((hint): hint is string => !!hint);
  const searchStructureHint = isSearchStyleCommand(params.command)
    ? formatHvyStructureForPaths(params.document, fs, extractVirtualPathsFromOutput(params.output ?? ''))
    : '';
  const hints = [...new Set([searchStructureHint, ...commandHints].filter(Boolean))];
  return hints.slice(0, COMPONENT_HINTS_MAX_COUNT + 1).join('\n');
}

function isSearchStyleCommand(command: string): boolean {
  const firstCommand = tokenizeCommandSafely(command).find((token) => token !== '|' && token !== '&&' && token !== '||') ?? '';
  return firstCommand === 'rg' || firstCommand === 'grep' || firstCommand === 'find';
}

function collectCommandComponentPaths(command: string, cwd: string, fs: ReturnType<typeof buildHvyVirtualFileSystem>): string[] {
  return tokenizeCommandSafely(command)
    .filter((arg) => !arg.startsWith('-') && (arg.includes('/') || /\.(?:json|txt)$/i.test(arg)))
    .map((arg) => resolveVirtualPath(fs, cwd, arg))
    .filter((path) => path.startsWith('/body/'));
}

function tokenizeCommandSafely(command: string): string[] {
  try {
    return tokenizeCommand(command);
  } catch {
    return [];
  }
}

function buildComponentPathHint(path: string, fs: ReturnType<typeof buildHvyVirtualFileSystem>): string | null {
  const componentDir = findComponentDirectory(path, fs);
  if (!componentDir) {
    return null;
  }
  const componentName = componentNameForDirectory(componentDir, fs);
  if (!componentName) {
    return null;
  }
  return [
    `component ${componentName}: ${componentDir}`,
    ...componentSpecificHintLines(componentName),
    ...pluginSpecificHintLines(componentName, `${componentDir}/${componentName}.json`, fs),
    `  edit: ${componentName}.txt for body, ${componentName}.json for config.`,
    `  structure: hvy request_structure ${componentDir} --describe. remove: hvy remove ${componentDir}.`,
    `  create sibling: ${formatCreateSiblingHint(componentDir, componentName)}`,
  ].join('\n');
}

function componentSpecificHintLines(componentName: string): string[] {
  const [firstHelpLine = ''] = getHvyComponentHelpLines(componentName);
  return firstHelpLine ? [`  ${firstHelpLine}`] : [];
}

function formatCreateSiblingHint(componentDir: string, componentName: string): string {
  const parentPath = componentDir.replace(/\/[^/]+$/, '') || '/body';
  if (componentName === 'xref-card') {
    return `hvy add component ${parentPath} NEW_ID xref-card "Title" --config '{"xrefTarget":"target-id"}'`;
  }
  return `hvy add ${componentName} ${parentPath} --id NEW_ID "Title"`;
}

function pluginSpecificHintLines(componentName: string, jsonPath: string, fs: ReturnType<typeof buildHvyVirtualFileSystem>): string[] {
  if (componentName !== 'plugin') {
    return [];
  }
  const pluginId = readPluginId(jsonPath, fs);
  if (!pluginId) {
    return ['  This plugin component does not currently specify a plugin id in plugin.json.'];
  }
  const registration = getHvyCliPluginCommandRegistrationByPluginId(pluginId);
  if (!registration) {
    return [`  Plugin id: ${pluginId}. No CLI component hints are registered for this plugin.`];
  }
  return [
    `  Plugin id: ${pluginId} (${registration.name}).`,
    ...registration.componentHints.map((line) => `  ${line}`),
  ];
}

function readPluginId(jsonPath: string, fs: ReturnType<typeof buildHvyVirtualFileSystem>): string {
  const entry = fs.entries.get(jsonPath);
  if (!entry || entry.kind !== 'file') {
    return '';
  }
  try {
    const value = JSON.parse(entry.read()) as { plugin?: unknown };
    return typeof value.plugin === 'string' ? value.plugin : '';
  } catch {
    return '';
  }
}

function findComponentDirectory(path: string, fs: ReturnType<typeof buildHvyVirtualFileSystem>): string | null {
  let current = fs.entries.get(path)?.kind === 'dir' ? path : path.replace(/\/[^/]+$/, '');
  while (current.startsWith('/body/')) {
    if (componentNameForDirectory(current, fs)) {
      return current;
    }
    current = current.replace(/\/[^/]+$/, '');
  }
  return null;
}

function componentNameForDirectory(path: string, fs: ReturnType<typeof buildHvyVirtualFileSystem>): string | null {
  const children = [...fs.entries.values()].filter((entry) => isDirectChild(path, entry));
  const jsonNames = children
    .filter((entry) => entry.kind === 'file' && entry.path.endsWith('.json') && !entry.path.endsWith('/section.json'))
    .map((entry) => entry.path.split('/').pop()?.replace(/\.json$/i, '') ?? '');
  return jsonNames.find((name) => !!name && hasTextSibling(path, name, fs)) ?? null;
}

function hasTextSibling(path: string, componentName: string, fs: ReturnType<typeof buildHvyVirtualFileSystem>): boolean {
  return fs.entries.get(`${path}/${componentName}.txt`)?.kind === 'file';
}

function isDirectChild(parent: string, entry: HvyVirtualEntry): boolean {
  if (!entry.path.startsWith(`${parent}/`)) {
    return false;
  }
  return !entry.path.slice(parent.length + 1).includes('/');
}
