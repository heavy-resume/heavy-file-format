import { valid } from 'semver';
import { HVY_PLUGIN_API_VERSION } from './plugins/registry';
import type { HvyPlugin } from './plugins/types';

export const HVY_PLUGIN_PACKAGE_FORMAT_VERSION = '0.2';
export const HVY_PLUGIN_PACKAGE_FORMAT_VERSIONS = ['0.1', HVY_PLUGIN_PACKAGE_FORMAT_VERSION] as const;
export const HVY_PLUGIN_PACKAGE_MANIFEST = 'hvy-plugin.json';
export const HVY_PLUGIN_PYTHON_IMPORTS = ['random', 're', 'datetime'] as const;

export type HvyPluginPythonImport = (typeof HVY_PLUGIN_PYTHON_IMPORTS)[number];

export interface HvyPluginPackageManifest {
  formatVersion: string;
  id: string;
  uuid?: string;
  version: string;
  displayName: string;
  entry: string;
  styles: string[];
  documentation?: string;
  permissions: string[];
  pythonImports?: HvyPluginPythonImport[];
  hvyApiVersion: string;
  authorization?: 'required';
}

export interface HvyPluginPackageContext {
  manifest: HvyPluginPackageManifest;
  resourceUrl(path: string): string;
}

export type HvyPluginPackageExport =
  | HvyPlugin
  | ((context: HvyPluginPackageContext) => HvyPlugin | Promise<HvyPlugin>);

export interface HvyPluginModuleNamespace {
  default?: HvyPluginPackageExport;
}

export interface LoadHvyPluginModuleOptions {
  manifest: HvyPluginPackageManifest;
  importEntry(): Promise<HvyPluginModuleNamespace>;
  resourceUrl?(path: string): string;
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = typeof record[key] === 'string' ? record[key].trim() : '';
  if (!value) throw new Error(`Plugin manifest field "${key}" must be a non-empty string.`);
  return value;
}

function optionalStringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (typeof value === 'undefined') return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !entry.trim())) {
    throw new Error(`Plugin manifest field "${key}" must be an array of non-empty strings.`);
  }
  return value.map((entry) => String(entry).trim());
}

function optionalUuid(record: Record<string, unknown>): string | undefined {
  if (typeof record.uuid === 'undefined') return undefined;
  if (typeof record.uuid !== 'string' || !record.uuid.trim()) {
    throw new Error('Plugin manifest field "uuid" must be a non-empty string.');
  }
  if ([...record.uuid].length > 64) {
    throw new Error('Plugin manifest field "uuid" cannot exceed 64 characters.');
  }
  return record.uuid;
}

export function normalizePluginPackagePath(path: string): string {
  const value = path.trim();
  if (!value || value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:/.test(value)) {
    throw new Error(`Plugin package path "${path}" must be relative.`);
  }
  const segments = value.replaceAll('\\', '/').split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Plugin package path "${path}" is not normalized.`);
  }
  return segments.join('/');
}

export function parseHvyPluginPackageManifest(input: string | Uint8Array): HvyPluginPackageManifest {
  let parsed: unknown;
  try {
    const text = typeof input === 'string' ? input : new TextDecoder('utf-8', { fatal: true }).decode(input);
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error('Plugin package manifest must be valid UTF-8 JSON.', { cause: error });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Plugin package manifest must be a JSON object.');
  }
  const record = parsed as Record<string, unknown>;
  const manifest: HvyPluginPackageManifest = {
    formatVersion: requireString(record, 'formatVersion'),
    id: requireString(record, 'id'),
    version: requireString(record, 'version'),
    displayName: requireString(record, 'displayName'),
    entry: normalizePluginPackagePath(requireString(record, 'entry')),
    styles: optionalStringArray(record, 'styles').map(normalizePluginPackagePath),
    permissions: optionalStringArray(record, 'permissions'),
    hvyApiVersion: requireString(record, 'hvyApiVersion'),
  };
  const uuid = optionalUuid(record);
  if (uuid) manifest.uuid = uuid;
  if (typeof record.documentation !== 'undefined') {
    manifest.documentation = normalizePluginPackagePath(requireString(record, 'documentation'));
  }
  if (typeof record.authorization !== 'undefined') {
    if (record.authorization !== 'required') {
      throw new Error('Plugin manifest field "authorization" must be "required" when present.');
    }
    manifest.authorization = 'required';
  }
  if (!(HVY_PLUGIN_PACKAGE_FORMAT_VERSIONS as readonly string[]).includes(manifest.formatVersion)) {
    throw new Error(`Unsupported plugin package format "${manifest.formatVersion}".`);
  }
  const entryExtension = manifest.entry.slice(manifest.entry.lastIndexOf('.')).toLowerCase();
  if (manifest.formatVersion === '0.2' && !['.js', '.mjs', '.py'].includes(entryExtension)) {
    throw new Error('Plugin package entry must be a JavaScript module or Python source file.');
  }
  const pythonImports = optionalStringArray(record, 'pythonImports');
  if (manifest.formatVersion === '0.1' && (entryExtension === '.py' || pythonImports.length > 0)) {
    throw new Error('Python plugin entries require package format "0.2".');
  }
  if (pythonImports.length > 0) {
    const supportedImports = new Set<string>(HVY_PLUGIN_PYTHON_IMPORTS);
    const uniqueImports = new Set<string>();
    for (const moduleName of pythonImports) {
      if (!supportedImports.has(moduleName)) {
        throw new Error(`Plugin package requests unsupported Python import "${moduleName}".`);
      }
      if (uniqueImports.has(moduleName)) {
        throw new Error(`Plugin manifest field "pythonImports" contains duplicate "${moduleName}".`);
      }
      uniqueImports.add(moduleName);
    }
    manifest.pythonImports = pythonImports as HvyPluginPythonImport[];
  }
  if (!valid(manifest.version)) {
    throw new Error(`Plugin package version "${manifest.version}" is not a valid semantic version.`);
  }
  if (manifest.hvyApiVersion !== HVY_PLUGIN_API_VERSION) {
    throw new Error(`Plugin package requires unsupported HVY plugin API "${manifest.hvyApiVersion}".`);
  }
  return manifest;
}

export async function loadHvyPluginModule(options: LoadHvyPluginModuleOptions): Promise<HvyPlugin> {
  const namespace = await options.importEntry();
  const exported = namespace.default;
  if (!exported) throw new Error('Plugin entry module must have a default export.');
  const resourceUrl = options.resourceUrl ?? (() => {
    throw new Error('This plugin source does not provide package resources.');
  });
  const plugin = typeof exported === 'function'
    ? await exported({ manifest: options.manifest, resourceUrl })
    : exported;
  validatePluginAgainstManifest(plugin, options.manifest);
  return plugin;
}

export function validatePluginAgainstManifest(
  plugin: HvyPlugin,
  manifest: HvyPluginPackageManifest
): void {
  if (!plugin || typeof plugin !== 'object') throw new Error('Plugin entry did not export a plugin object.');
  const fields: Array<keyof Pick<HvyPlugin, 'id' | 'uuid' | 'version' | 'hvyApiVersion' | 'displayName'>> = [
    'id',
    'uuid',
    'version',
    'hvyApiVersion',
    'displayName',
  ];
  for (const field of fields) {
    if (plugin[field] !== manifest[field]) {
      throw new Error(
        `Plugin entry ${field} "${String(plugin[field])}" does not match manifest "${String(manifest[field])}".`
      );
    }
  }
}
