import { resolveBaseComponentFromMeta } from '../component-defs';
import type { VisualBlock, VisualSection } from '../editor/types';
import type { JsonObject } from '../hvy/types';
import { findFormFieldTypeIssues, parseFormSpec, serializeFormSpec } from '../plugins/form';
import { DB_TABLE_PLUGIN_ID, FORM_PLUGIN_ID, SCRIPTING_PLUGIN_ID } from '../plugins/registry';
import { visitBlocks } from '../section-ops';
import type { VisualDocument } from '../types';
import { getHvyCliPluginCommandRegistrationByPluginId } from './plugin-command-registry';
import { buildHvyVirtualFileSystem, type HvyVirtualEntry, type HvyVirtualFileSystem } from './virtual-file-system';

export interface HvyCliLintIssue {
  key: string;
  path: string;
  component: string;
  message: string;
}

export async function runHvyCliLinter(document: VisualDocument): Promise<HvyCliLintIssue[]> {
  const fs = buildHvyVirtualFileSystem(document);
  const componentIssues = await Promise.all([...fs.entries.values()]
    .filter((entry): entry is HvyVirtualEntry & { kind: 'file' } =>
      entry.kind === 'file' && entry.path.startsWith('/body/') && entry.path.endsWith('.json') && !entry.path.endsWith('/section.json'))
    .map((entry) => lintComponentFile(document, fs, entry.path)));
  return [
    ...lintSections(fs),
    ...componentIssues.flat(),
  ];
}

export function fixHvyCliLintIssues(document: VisualDocument): string[] {
  const fixed: string[] = [];
  for (const section of document.sections) {
    fixSectionPluginAliasIds(section, fixed);
  }
  fixFormFieldTypeAliases(document, fixed);
  return fixed;
}

export function formatHvyCliLintIssues(issues: HvyCliLintIssue[]): string {
  if (issues.length === 0) {
    return 'No lint issues.';
  }
  return [
    `Lint issues: ${issues.length}`,
    ...issues.map(formatHvyCliLintIssueLine),
  ].join('\n');
}

export function formatHvyCliLintDiff(before: HvyCliLintIssue[], after: HvyCliLintIssue[]): string {
  const beforeLines = new Map(before.map((issue) => [issue.key, formatHvyCliLintIssueLine(issue)]));
  const afterLines = new Map(after.map((issue) => [issue.key, formatHvyCliLintIssueLine(issue)]));
  const removed = [...beforeLines.entries()]
    .filter(([key]) => !afterLines.has(key))
    .map(([, line]) => `- ${line}`);
  const added = [...afterLines.entries()]
    .filter(([key]) => !beforeLines.has(key))
    .map(([, line]) => `+ ${line}`);
  if (removed.length === 0 && added.length === 0) {
    return '';
  }
  return [
    'lint diff',
    ...removed,
    ...added,
  ].join('\n');
}

async function lintComponentFile(document: VisualDocument, fs: HvyVirtualFileSystem, jsonPath: string): Promise<HvyCliLintIssue[]> {
  const directory = jsonPath.replace(/\/[^/]+$/, '');
  const component = jsonPath.split('/').pop()?.replace(/\.json$/, '') ?? '';
  const textPath = `${directory}/${component}.txt`;
  const body = readFile(fs, textPath);
  const config = readJsonFile(fs, jsonPath);
  const baseComponent = resolveBaseComponentFromMeta(component, document.meta);
  return [
    ...lintCoreComponent({ fs, path: directory, component, baseComponent, config, body }),
    ...await lintPluginComponent({ document, path: directory, textPath, jsonPath, config, body }),
  ];
}

function lintSections(fs: HvyVirtualFileSystem): HvyCliLintIssue[] {
  return [...fs.entries.values()]
    .filter((entry): entry is HvyVirtualEntry & { kind: 'file' } => entry.kind === 'file' && entry.path.startsWith('/body/') && entry.path.endsWith('/section.json'))
    .filter((entry) => {
      const sectionPath = entry.path.replace(/\/section\.json$/, '');
      return ![...fs.entries.keys()].some((candidatePath) => candidatePath.startsWith(`${sectionPath}/`) && candidatePath !== entry.path);
    })
    .map((entry) => {
      const sectionPath = entry.path.replace(/\/section\.json$/, '');
      return {
        key: `${sectionPath}:empty-section`,
        path: sectionPath,
        component: 'section',
        message: 'section has no content.',
      };
    });
}

function lintCoreComponent(params: { fs: HvyVirtualFileSystem; path: string; component: string; baseComponent: string; config: JsonObject; body: string }): HvyCliLintIssue[] {
  const issues: HvyCliLintIssue[] = [];
  if (params.baseComponent === 'text' && params.body.trim().length === 0) {
    issues.push(createLintIssue(params, 'empty-text', 'text body is empty.'));
  }
  if (params.baseComponent === 'quote' && params.body.trim().length === 0) {
    issues.push(createLintIssue(params, 'empty-quote', 'quote body is empty.'));
  }
  if (params.baseComponent === 'code' && params.body.trim().length === 0) {
    issues.push(createLintIssue(params, 'empty-code', 'code block body is empty.'));
  }
  if (params.baseComponent === 'component-list' && !hasChildComponent(params.fs, `${params.path}/component-list`)) {
    issues.push(createLintIssue(params, 'empty-component-list', 'component-list has no items.'));
  }
  if (params.baseComponent === 'xref-card') {
    if (readTrimmedString(params.config.xrefTitle).length === 0) {
      issues.push(createLintIssue(params, 'xref-title', 'xref-card is missing xrefTitle.'));
    }
    if (readTrimmedString(params.config.xrefTarget).length === 0) {
      issues.push(createLintIssue(params, 'xref-target', 'xref-card is missing xrefTarget.'));
    }
  }
  if (params.baseComponent === 'table') {
    const rows = Array.isArray(params.config.tableRows) ? params.config.tableRows : [];
    rows.forEach((row, index) => {
      const cells = row && typeof row === 'object' && !Array.isArray(row) && Array.isArray((row as { cells?: unknown }).cells)
        ? (row as { cells: unknown[] }).cells
        : [];
      if (cells.length > 0 && cells.every((cell) => String(cell ?? '').trim().length === 0)) {
        issues.push(createLintIssue(params, `empty-table-row-${index + 1}`, `table row ${index + 1} is empty.`));
      }
    });
  }
  return issues;
}

async function lintPluginComponent(params: { document: VisualDocument; path: string; textPath: string; jsonPath: string; config: JsonObject; body: string }): Promise<HvyCliLintIssue[]> {
  const pluginId = readTrimmedString(params.config.plugin);
  if (!pluginId) {
    return [];
  }
  const alias = getStoredPluginAlias(pluginId);
  if (alias) {
    return [{
      key: `${params.path}:plugin-id-alias:${pluginId}`,
      path: params.path,
      component: 'plugin',
      message: `plugin id "${pluginId}" is a CLI command alias, not a stored plugin id. Run hvy lint --fix to change it to "${alias.pluginId}".`,
    }];
  }
  const registration = getHvyCliPluginCommandRegistrationByPluginId(pluginId);
  if (!registration) {
    return [];
  }
  const issueGroups = await Promise.all((registration.lintChecks ?? []).map(async (check, index) =>
    (await check({
      document: params.document,
      path: params.path,
      textPath: params.textPath,
      jsonPath: params.jsonPath,
      config: params.config.pluginConfig && typeof params.config.pluginConfig === 'object' && !Array.isArray(params.config.pluginConfig)
        ? params.config.pluginConfig as JsonObject
        : {},
      body: params.body,
    })).map((issue, issueIndex) => ({
      key: `${params.path}:plugin-${index + 1}-${issueIndex + 1}:${issue.message}`,
      path: params.path,
      component: 'plugin',
      message: appendPluginLintHelp(issue.message, registration),
    }))
  ));
  return issueGroups.flat();
}

function appendPluginLintHelp(
  message: string,
  registration: NonNullable<ReturnType<typeof getHvyCliPluginCommandRegistrationByPluginId>>
): string {
  const cheatsheet = registration.cheatsheetName ?? registration.name;
  return `${message} For help, run hvy cheatsheet ${cheatsheet} or man ${registration.helpTopic}.`;
}

function fixSectionPluginAliasIds(section: VisualSection, fixed: string[]): void {
  for (const block of section.blocks) {
    fixBlockPluginAliasIds(block, fixed);
  }
  for (const child of section.children) {
    fixSectionPluginAliasIds(child, fixed);
  }
}

function fixBlockPluginAliasIds(block: VisualBlock, fixed: string[]): void {
  const plugin = getStoredPluginAlias(block.schema.plugin ?? '');
  if (plugin) {
    block.schema.plugin = plugin.pluginId;
    fixed.push(`${block.schema.id || '(anonymous plugin)'}: ${plugin.alias} -> ${plugin.pluginId}`);
  }
  for (const child of block.schema.containerBlocks ?? []) {
    fixBlockPluginAliasIds(child, fixed);
  }
  for (const child of block.schema.componentListBlocks ?? []) {
    fixBlockPluginAliasIds(child, fixed);
  }
  for (const item of block.schema.gridItems ?? []) {
    fixBlockPluginAliasIds(item.block, fixed);
  }
  for (const child of block.schema.expandableStubBlocks?.children ?? []) {
    fixBlockPluginAliasIds(child, fixed);
  }
  for (const child of block.schema.expandableContentBlocks?.children ?? []) {
    fixBlockPluginAliasIds(child, fixed);
  }
}

function fixFormFieldTypeAliases(document: VisualDocument, fixed: string[]): void {
  visitBlocks(document.sections, (block) => {
    if (block.schema.plugin !== FORM_PLUGIN_ID || findFormFieldTypeIssues(block.text).every((issue) => !issue.canonicalType)) {
      return;
    }
    const parsed = parseFormSpec(block.text, block.schema.pluginConfig);
    if (parsed.error) {
      return;
    }
    block.text = serializeFormSpec(parsed.spec);
    fixed.push(`${block.schema.id || '(anonymous form)'}: canonicalized form field types`);
  });
}

function getStoredPluginAlias(pluginId: string): { alias: string; pluginId: string } | null {
  if (pluginId === 'form') {
    return { alias: 'form', pluginId: FORM_PLUGIN_ID };
  }
  if (pluginId === 'db-table') {
    return { alias: 'db-table', pluginId: DB_TABLE_PLUGIN_ID };
  }
  if (pluginId === 'scripting') {
    return { alias: 'scripting', pluginId: SCRIPTING_PLUGIN_ID };
  }
  return null;
}

function hasChildComponent(fs: HvyVirtualFileSystem, path: string): boolean {
  return [...fs.entries.keys()].some((candidatePath) =>
    candidatePath.startsWith(`${path}/`) && candidatePath.endsWith('.json') && !candidatePath.endsWith('/section.json'));
}

function createLintIssue(params: { path: string; component: string }, code: string, message: string): HvyCliLintIssue {
  return {
    key: `${params.path}:${code}`,
    path: params.path,
    component: params.component,
    message,
  };
}

export function formatHvyCliLintIssueLine(issue: HvyCliLintIssue): string {
  return `[${issue.component}] ${issue.path} - ${issue.message}`;
}

function readFile(fs: HvyVirtualFileSystem, path: string): string {
  const entry = fs.entries.get(path);
  return entry?.kind === 'file' ? entry.read() : '';
}

function readJsonFile(fs: HvyVirtualFileSystem, path: string): JsonObject {
  const entry = fs.entries.get(path);
  if (!entry || entry.kind !== 'file') {
    return {};
  }
  try {
    const value = JSON.parse(entry.read()) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
  } catch {
    return {};
  }
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
