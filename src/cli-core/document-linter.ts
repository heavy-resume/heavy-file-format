import { resolveBaseComponentFromMeta } from '../component-defs';
import type { VisualBlock, VisualSection } from '../editor/types';
import type { JsonObject } from '../hvy/types';
import { findFormFieldTypeIssues, parseFormSpec, serializeFormSpec } from '../plugins/form';
import { DB_TABLE_PLUGIN_ID, FORM_PLUGIN_ID, SCRIPTING_PLUGIN_ID } from '../plugins/registry';
import { visitBlocks } from '../section-ops';
import type { VisualDocument } from '../types';
import { getHvyCliPluginCommandRegistrationByPluginId } from './plugin-command-registry';
import { buildHvyVirtualFileSystem, type HvyVirtualEntry, type HvyVirtualFileSystem } from './virtual-file-system';
import { cssValueLooksLikeSerializedJson } from '../css-value-validation';
import { isPdfPageMarginsInput } from '../pdf-page-settings';

const SUPPORTED_HVY_VERSION = '0.1';
const KNOWN_HEADER_METADATA_KEYS = new Set([
  'hvy_version',
  'title',
  'description',
  'author',
  'tags',
  'ai-context',
  'ai-import-guidance',
  'importPreplan',
  'sidebar_label',
  'reader_max_width',
  'pdf_page',
  'image_attachment_max_dimensions',
  'theme',
  'component_defs',
  'section_defs',
  'component_defaults',
  'section_defaults',
  'text_line_styles',
  'heading_styles',
  'plugins',
]);
const DATABASE_SCHEMA_HEADER_KEYS = new Set(['tables', 'database', 'schema', 'columns']);

export interface HvyCliLintIssue {
  key: string;
  path: string;
  component: string;
  message: string;
}

export async function runHvyCliLinter(document: VisualDocument, fs: HvyVirtualFileSystem = buildHvyVirtualFileSystem(document)): Promise<HvyCliLintIssue[]> {
  const componentJsonFiles = [...fs.entries.values()]
    .filter((entry): entry is HvyVirtualEntry & { kind: 'file' } => isLintableComponentJsonPath(fs, entry))
    .filter((entry) => !isFlattenedComponentListAlias(fs, entry.path));
  const componentIssues = await Promise.all(componentJsonFiles
    .map((entry) => lintComponentFile(document, fs, entry.path)));
  return [
    ...lintHeader(document),
    ...lintHeaderCssValues(document),
    ...lintSections(fs),
    ...componentIssues.flat(),
  ];
}

function isLintableComponentJsonPath(fs: HvyVirtualFileSystem, entry: HvyVirtualEntry): entry is HvyVirtualEntry & { kind: 'file' } {
  return entry.kind === 'file'
    && entry.path.startsWith('/body/')
    && entry.path.endsWith('.json')
    && !entry.path.endsWith('/section.json')
    && !entry.path.endsWith('/children-order.json')
    && !!findComponentBodyPath(fs, entry.path.replace(/\/[^/]+$/, ''), entry.path.split('/').pop()?.replace(/\.json$/, '') ?? '');
}

function isFlattenedComponentListAlias(_fs: HvyVirtualFileSystem, _jsonPath: string): boolean {
  return false;
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
  const textPath = findComponentBodyPath(fs, directory, component);
  const body = readFile(fs, textPath);
  const config = readJsonFile(fs, jsonPath);
  if (component === 'table') {
    const tableRows = readJsonFileValue(fs, `${directory}/tableRows.json`);
    if (Array.isArray(tableRows)) {
      config.tableRows = tableRows.map((row) => {
        if (row && typeof row === 'object' && !Array.isArray(row) && Array.isArray((row as JsonObject).cells)) {
          return row;
        }
        return { cells: Array.isArray(row) ? row : [] };
      }) as unknown as JsonObject[];
    }
  }
  const baseComponent = resolveBaseComponentFromMeta(component, document.meta);
  return [
    ...lintCoreComponent({ path: directory, component, baseComponent, config, body }),
    ...await lintPluginComponent({ document, path: directory, textPath, jsonPath, config, body }),
  ];
}

function findComponentBodyPath(fs: HvyVirtualFileSystem, directory: string, component: string): string {
  for (const path of [`${directory}/${component}.txt`, `${directory}/script.py`]) {
    if (fs.entries.get(path)?.kind === 'file') {
      return path;
    }
  }
  return '';
}

function lintHeader(document: VisualDocument): HvyCliLintIssue[] {
  const issues: HvyCliLintIssue[] = [];
  const version = readHeaderVersion(document.meta.hvy_version);
  if (!version) {
    issues.push({
      key: '/header.yaml:hvy-version-invalid',
      path: '/header.yaml',
      component: 'header',
      message: 'header.yaml has an invalid hvy_version. Expected a dotted numeric version such as 0.1.',
    });
    return issues;
  }
  if (compareDottedVersions(version, SUPPORTED_HVY_VERSION) > 0) {
    issues.push({
      key: '/header.yaml:hvy-version-newer',
      path: '/header.yaml',
      component: 'header',
      message: `This file uses hvy_version ${version}, but this client supports ${SUPPORTED_HVY_VERSION}. Avoid editing with this client until it supports that HVY version.`,
    });
    return issues;
  }

  for (const key of Object.keys(document.meta)) {
    if (DATABASE_SCHEMA_HEADER_KEYS.has(key)) {
      issues.push({
        key: `/header.yaml:db-schema-metadata:${key}`,
        path: '/header.yaml',
        component: 'header',
        message: `header.yaml has unsupported "${key}" metadata that looks like a database schema. SQL tables/views live in the db-table backend; inspect or change them with hvy plugin db-table tables, hvy plugin db-table schema, and hvy plugin db-table exec.`,
      });
      continue;
    }
    if (!KNOWN_HEADER_METADATA_KEYS.has(key)) {
      issues.push({
        key: `/header.yaml:unused-metadata:${key}`,
        path: '/header.yaml',
        component: 'header',
        message: `header.yaml metadata key "${key}" is not used by HVY ${SUPPORTED_HVY_VERSION} or this editor. Remove it if it was accidental.`,
      });
    }
  }
  return issues;
}

function readHeaderVersion(value: unknown): string | null {
  let version: string | null = null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    version = String(value);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    version = value.trim();
  }
  return version && parseDottedVersion(version) ? version : null;
}

function compareDottedVersions(left: string, right: string): number {
  const leftParts = parseDottedVersion(left);
  const rightParts = parseDottedVersion(right);
  if (!leftParts || !rightParts) return 0;
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    if (leftPart !== rightPart) {
      return leftPart > rightPart ? 1 : -1;
    }
  }
  return 0;
}

function parseDottedVersion(value: string): number[] | null {
  if (!/^\d+(?:\.\d+)*$/.test(value)) {
    return null;
  }
  return value.split('.').map((part) => Number(part));
}

function lintSections(fs: HvyVirtualFileSystem): HvyCliLintIssue[] {
  const issues: HvyCliLintIssue[] = [];
  for (const entry of [...fs.entries.values()].filter((entry): entry is HvyVirtualEntry & { kind: 'file' } => entry.kind === 'file' && entry.path.startsWith('/body/') && entry.path.endsWith('/section.json'))) {
    const sectionPath = entry.path.replace(/\/section\.json$/, '');
    const section = readJsonFile(fs, entry.path);
    if (cssValueLooksLikeSerializedJson(readTrimmedString(section.css))) {
      issues.push({
        key: `${sectionPath}:section-css-json`,
        path: sectionPath,
        component: 'section',
        message: 'section css looks like serialized JSON. CSS must be an inline declaration string such as "margin: 0;", not component or section metadata.',
      });
    }
  }
  issues.push(...[...fs.entries.values()]
    .filter((entry): entry is HvyVirtualEntry & { kind: 'file' } => entry.kind === 'file' && entry.path.startsWith('/body/') && entry.path.endsWith('/section.json'))
    .filter((entry) => {
      const sectionPath = entry.path.replace(/\/section\.json$/, '');
      return ![...fs.entries.keys()].some((candidatePath) =>
        candidatePath.startsWith(`${sectionPath}/`)
        && candidatePath !== entry.path
        && candidatePath !== `${sectionPath}/section-info.txt`
        && candidatePath !== `${sectionPath}/about-section.txt`
        && candidatePath !== `${sectionPath}/children-order.json`
        && !isRawEditHelperPath(candidatePath)
      );
    })
    .map((entry) => {
      const sectionPath = entry.path.replace(/\/section\.json$/, '');
      return {
        key: `${sectionPath}:empty-section`,
        path: sectionPath,
        component: 'section',
        message: 'section has no content.',
      };
    }));
  return issues;
}

function isRawEditHelperPath(path: string): boolean {
  const filename = path.split('/').pop() ?? '';
  return filename === 'raw.hvy' || filename === 'raw-preview.hvy.txt' || filename === 'raw.wip.hvy';
}

function lintCoreComponent(params: { path: string; component: string; baseComponent: string; config: JsonObject; body: string }): HvyCliLintIssue[] {
  const issues: HvyCliLintIssue[] = [];
  if (cssValueLooksLikeSerializedJson(readTrimmedString(params.config.css))) {
    issues.push(createLintIssue(params, 'css-json', 'component css looks like serialized JSON. CSS must be an inline declaration string such as "margin: 0;", not component metadata.'));
  }
  if (params.baseComponent === 'text') {
    issues.push(...lintTextMarkdownBlocks(params));
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

function lintHeaderCssValues(document: VisualDocument): HvyCliLintIssue[] {
  const issues: HvyCliLintIssue[] = [];
  const sectionDefaults = document.meta.section_defaults;
  if (sectionDefaults && typeof sectionDefaults === 'object' && !Array.isArray(sectionDefaults)) {
    pushHeaderCssJsonIssue(issues, 'section_defaults.css', (sectionDefaults as JsonObject).css);
    const contained = (sectionDefaults as JsonObject).contained;
    if (typeof contained !== 'undefined' && typeof contained !== 'boolean') {
      issues.push({
        key: '/header.yaml:section_defaults.contained:type',
        path: '/header.yaml',
        component: 'header',
        message: 'section_defaults.contained must be a boolean.',
      });
    }
  }
  const componentDefaults = document.meta.component_defaults;
  if (componentDefaults && typeof componentDefaults === 'object' && !Array.isArray(componentDefaults)) {
    for (const [componentName, defaults] of Object.entries(componentDefaults)) {
      if (defaults && typeof defaults === 'object' && !Array.isArray(defaults)) {
        pushHeaderCssJsonIssue(issues, `component_defaults.${componentName}.css`, (defaults as JsonObject).css);
      }
    }
  }
  const textLineStyles = document.meta.text_line_styles;
  if (textLineStyles && typeof textLineStyles === 'object' && !Array.isArray(textLineStyles)) {
    for (const [styleName, style] of Object.entries(textLineStyles)) {
      if (style && typeof style === 'object' && !Array.isArray(style)) {
        pushHeaderCssJsonIssue(issues, `text_line_styles.${styleName}.css`, (style as JsonObject).css);
      }
    }
  }
  const headingStyles = document.meta.heading_styles;
  if (headingStyles && typeof headingStyles === 'object' && !Array.isArray(headingStyles)) {
    for (const [styleName, style] of Object.entries(headingStyles)) {
      if (style && typeof style === 'object' && !Array.isArray(style)) {
        pushHeaderCssJsonIssue(issues, `heading_styles.${styleName}.css`, (style as JsonObject).css);
      }
    }
  }
  const pdfPage = document.meta.pdf_page;
  if (pdfPage && typeof pdfPage === 'object' && !Array.isArray(pdfPage)) {
    const margins = (pdfPage as JsonObject).margins;
    if (typeof margins !== 'undefined' && !isPdfPageMarginsInput(margins)) {
      issues.push({
        key: '/header.yaml:pdf_page.margins:type',
        path: '/header.yaml',
        component: 'header',
        message: 'pdf_page.margins must be a length such as "0.75in" or "1cm", a [horizontal, vertical] array, or a [left, top, right, bottom] array of non-negative lengths.',
      });
    }
    const debug = (pdfPage as JsonObject).debug;
    if (typeof debug !== 'undefined' && typeof debug !== 'boolean') {
      issues.push({
        key: '/header.yaml:pdf_page.debug:type',
        path: '/header.yaml',
        component: 'header',
        message: 'pdf_page.debug must be a boolean.',
      });
    }
  }
  return issues;
}

function pushHeaderCssJsonIssue(issues: HvyCliLintIssue[], label: string, value: unknown): void {
  if (!cssValueLooksLikeSerializedJson(readTrimmedString(value))) {
    return;
  }
  issues.push({
    key: `/header.yaml:${label}:css-json`,
    path: '/header.yaml',
    component: 'header',
    message: `${label} looks like serialized JSON. CSS must be an inline declaration string such as "margin: 0;", not component or section metadata.`,
  });
}

function lintTextMarkdownBlocks(params: { path: string; component: string; body: string }): HvyCliLintIssue[] {
  const lines = params.body.split(/\r?\n/);
  const issues: HvyCliLintIssue[] = [];
  lines.forEach((line, index) => {
    if (/^\s*>\s*$/.test(line)) {
      issues.push(createLintIssue(params, `empty-markdown-quote-${index + 1}`, `empty Markdown quote block at line ${index + 1}.`));
    }
  });
  for (let index = 0; index < lines.length; index += 1) {
    const fence = lines[index]?.match(/^(\s*)(`{3,}|~{3,})/);
    if (!fence) {
      continue;
    }
    const marker = fence[2]?.[0] ?? '';
    const length = fence[2]?.length ?? 3;
    let closeIndex = -1;
    for (let scan = index + 1; scan < lines.length; scan += 1) {
      if (new RegExp(`^\\s*${escapeRegExp(marker)}{${length},}\\s*$`).test(lines[scan] ?? '')) {
        closeIndex = scan;
        break;
      }
    }
    if (closeIndex < 0) {
      continue;
    }
    const content = lines.slice(index + 1, closeIndex).join('\n').trim();
    if (content.length === 0) {
      issues.push(createLintIssue(params, `empty-markdown-code-${index + 1}`, `empty Markdown code block starting at line ${index + 1}.`));
    }
    index = closeIndex;
  }
  return issues;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  const value = readJsonFileValue(fs, path);
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function readJsonFileValue(fs: HvyVirtualFileSystem, path: string): unknown {
  const entry = fs.entries.get(path);
  if (!entry || entry.kind !== 'file') {
    return null;
  }
  try {
    return JSON.parse(entry.read()) as unknown;
  } catch {
    return null;
  }
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
