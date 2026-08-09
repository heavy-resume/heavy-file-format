import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const BRYTHON_MINIMAL_VFS_ID = 'virtual:hvy-brython-minimal-vfs';
const BRYTHON_MINIMAL_VFS_RESOLVED_ID = `\0${BRYTHON_MINIMAL_VFS_ID}`;
const BRYTHON_PLUGIN_VFS_ID = 'virtual:hvy-brython-plugin-vfs';
const BRYTHON_PLUGIN_VFS_RESOLVED_ID = `\0${BRYTHON_PLUGIN_VFS_ID}`;
const PLUGIN_PYTHON_LIBRARY_NAMES = ['random', 're', 'datetime'] as const;

type BrythonVfs = Record<string, unknown>;

function collectModuleClosure(vfs: BrythonVfs, root: string): BrythonVfs {
  const result: BrythonVfs = {};
  const pending = [root];
  while (pending.length > 0) {
    const name = pending.pop()!;
    if (Object.hasOwn(result, name)) continue;
    const entry = vfs[name];
    if (!Array.isArray(entry)) continue;
    result[name] = entry;
    const parentSegments = name.split('.');
    while (parentSegments.length > 1) {
      parentSegments.pop();
      pending.push(parentSegments.join('.'));
    }
    if (Array.isArray(entry[2])) {
      for (const dependency of entry[2]) {
        if (typeof dependency === 'string' && dependency && !dependency.startsWith('.')) {
          pending.push(dependency);
        }
      }
    }
  }
  return result;
}

export interface BrythonMinimalVfsPlugin {
  name: 'hvy-brython-minimal-vfs';
  resolveId(id: string): string | null;
  load(id: string): string | null;
}

export function createBrythonMinimalVfsPlugin(): BrythonMinimalVfsPlugin {
  return {
    name: 'hvy-brython-minimal-vfs',
    resolveId(id) {
      if (id === BRYTHON_MINIMAL_VFS_ID) return BRYTHON_MINIMAL_VFS_RESOLVED_ID;
      if (id === BRYTHON_PLUGIN_VFS_ID) return BRYTHON_PLUGIN_VFS_RESOLVED_ID;
      return null;
    },
    load(id) {
      if (id !== BRYTHON_MINIMAL_VFS_RESOLVED_ID && id !== BRYTHON_PLUGIN_VFS_RESOLVED_ID) {
        return null;
      }
      const stdlibPath = require.resolve('brython/brython_stdlib.js');
      const stdlibSource = readFileSync(stdlibPath, 'utf8');
      const marker = 'var scripts = ';
      const start = stdlibSource.indexOf(marker);
      const end = stdlibSource.lastIndexOf('\n__BRYTHON__.update_VFS');
      if (start < 0 || end < 0) {
        throw new Error('Unable to extract Brython VFS metadata.');
      }
      const vfs = Function(`return ${stdlibSource.slice(start + marker.length, end).trim().replace(/;$/, '')}`)() as BrythonVfs;
      if (id === BRYTHON_PLUGIN_VFS_RESOLVED_ID) {
        const pythonLibraryVfsByName = Object.fromEntries(
          PLUGIN_PYTHON_LIBRARY_NAMES.map((name) => [name, collectModuleClosure(vfs, name)])
        );
        return `export default ${JSON.stringify(pythonLibraryVfsByName)};`;
      }
      const minimalVfs = { $timestamp: vfs.$timestamp, browser: vfs.browser, sys: vfs.sys };
      const source = [
        '__BRYTHON__.use_VFS = true;',
        `__BRYTHON__.update_VFS(${JSON.stringify(minimalVfs)});`,
      ].join('\n');
      return `export default ${JSON.stringify(source)};`;
    },
  };
}
