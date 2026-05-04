import { expect, test } from 'vitest';

import {
  buildPythonProgram,
  buildScriptingVersionMismatchMessage,
  cleanScriptingErrorDetail,
  comparePluginVersions,
  getScriptingTraceLabel,
  instrumentPythonSource,
  stripPythonImports,
  summarizeScriptingError,
  runUserScript,
} from '../src/plugins/scripting/wrapper';
import { createScriptingRuntime } from '../src/plugins/scripting/runtime';
import { SCRIPTING_PLUGIN_VERSION } from '../src/plugins/scripting/version';
import { deserializeDocument } from '../src/serialization';

test('instrumentPythonSource adds step calls without rewriting compare expressions', () => {
  expect(
    instrumentPythonSource(
      `output = doc.tool("view_component", {"component_ref": "script-value"})
for line in output.split('\\n'):
    if "Script test value:" in line:
        parts = line.split('|', 1)
        if len(parts) == 2:
            doc.header.set("ok", "yes")
`
    )
  ).toBe(
    `__hvy_step__()
output = doc.tool("view_component", {"component_ref": "script-value"})
__hvy_step__()
for line in output.split('\\n'):
    __hvy_step__()
    if "Script test value:" in line:
        __hvy_step__()
        parts = line.split('|', 1)
        __hvy_step__()
        if len(parts) == 2:
            __hvy_step__()
            doc.header.set("ok", "yes")
`
  );
});

test('instrumentPythonSource only injects once for multi-line statements', () => {
  expect(
    instrumentPythonSource(
      `if (
    doc.header.get("status") == "ready"
    and doc.header.get("mode") == "active"
):
    doc.header.set("result", "ok")
`
    )
  ).toBe(
    `__hvy_step__()
if (
    doc.header.get("status") == "ready"
    and doc.header.get("mode") == "active"
):
    __hvy_step__()
    doc.header.set("result", "ok")
`
  );
});

test('instrumentPythonSource skips blank lines and comments while preserving nested indentation', () => {
  expect(
    instrumentPythonSource(
      `# comment

try:
    # inside
    doc.header.set("phase", "start")
except Exception:
    doc.header.set("phase", "error")
finally:
    doc.header.set("phase", "done")
`
    )
  ).toBe(
    `# comment

__hvy_step__()
try:
    # inside
    __hvy_step__()
    doc.header.set("phase", "start")
__hvy_step__()
except Exception:
    __hvy_step__()
    doc.header.set("phase", "error")
__hvy_step__()
finally:
    __hvy_step__()
    doc.header.set("phase", "done")
`
  );
});

test('buildPythonProgram prefers tracing and keeps instrumented fallback available', () => {
  const program = buildPythonProgram('r7');
  expect(program).toContain("import sys as __hvy_sys__");
  expect(program).toContain("__hvy_sys__.settrace(__hvy_trace__)");
  expect(program).toContain("__hvy_compilable_source__ = __hvy_source__ if __hvy_trace_enabled__ else __hvy_instrumented_source__");
  expect(program).not.toContain('NodeTransformer');
  expect(program).not.toContain('visit_Compare');
});

test('buildPythonProgram uses the component id in tracebacks when available', () => {
  expect(buildPythonProgram('r7', 'import-example-script')).toContain(
    "__hvy_code__ = compile(__hvy_compilable_source__, '<import-example-script>', 'exec')"
  );
});

test('stripPythonImports replaces plain import statements with pass', () => {
  expect(
    stripPythonImports(
      `import pandas
doc.header.set("ok", "yes")
`
    )
  ).toBe(
    `raise RuntimeError("Import statements are not allowed in HVY scripts.")
doc.header.set("ok", "yes")
`
  );
});

test('stripPythonImports replaces from-import statements with pass', () => {
  expect(
    stripPythonImports(
      `from browser import window
doc.header.set("ok", "yes")
`
    )
  ).toBe(
    `raise RuntimeError("Import statements are not allowed in HVY scripts.")
doc.header.set("ok", "yes")
`
  );
});

test('stripPythonImports strips multiline imports while preserving block structure', () => {
  expect(
    stripPythonImports(
      `if True:
    from browser import (
        window,
        document,
    )
    doc.header.set("ok", "yes")
`
    )
  ).toBe(
    `if True:
    raise RuntimeError("Import statements are not allowed in HVY scripts.")



    doc.header.set("ok", "yes")
`
  );
});

test('summarizeScriptingError collapses tracebacks into a concise line', () => {
  expect(
    summarizeScriptingError(
      `Traceback (most recent call last):
  File "#hvy_script_r2", line 33, in <module>
    exec(__hvy_code__, __hvy_user_globals__)
  File "<hvy-script>", line 15, in <module>
RuntimeError: Import statements are not allowed in HVY scripts.
`
    )
  ).toBe('Import statements are not allowed in HVY scripts. (line 15)');
});

test('getScriptingTraceLabel falls back to hvy-script when the component id is blank', () => {
  expect(getScriptingTraceLabel('')).toBe('hvy-script');
  expect(getScriptingTraceLabel('import-example-script')).toBe('import-example-script');
});

test('cleanScriptingErrorDetail removes wrapper exec frames from tracebacks', () => {
  expect(
    cleanScriptingErrorDetail(
      `Traceback (most recent call last):
  File "#hvy_script_r2", line 33, in <module>
    exec(__hvy_code__, __hvy_user_globals__)
  File "<hvy-script>", line 1, in <module>
RuntimeError: Import statements are not allowed in HVY scripts.
`
    )
  ).toBe(
    `Traceback (most recent call last):
  File "<hvy-script>", line 1, in <module>
RuntimeError: Import statements are not allowed in HVY scripts.`
  );
});

test('comparePluginVersions orders dot-separated versions numerically', () => {
  expect(comparePluginVersions('0.2', '0.1')).toBe(1);
  expect(comparePluginVersions('0.2', '0.10')).toBe(-1);
  expect(comparePluginVersions('0.1', '0.1.0')).toBe(0);
});

test('runUserScript refuses to execute scripts that require a newer scripting plugin version', async () => {
  const requestedVersion = `${SCRIPTING_PLUGIN_VERSION}.1`;
  await expect(
    runUserScript({
      document: { meta: {}, extension: '.hvy', sections: [], attachments: [] },
      source: 'doc.header.set("ok", "yes")',
      pluginVersion: requestedVersion,
    })
  ).resolves.toEqual({
    ok: false,
    error: buildScriptingVersionMismatchMessage(requestedVersion),
    errorDetail: buildScriptingVersionMismatchMessage(requestedVersion),
    linesExecuted: 0,
    toolCalls: 0,
  });
});

test('createScriptingRuntime exposes a supplied form API', () => {
  const runtime = createScriptingRuntime({
    document: { meta: {}, extension: '.hvy', sections: [], attachments: [] },
    form: {
      get_value: (name) => (name === 'food' ? 'soup' : null),
      set_value: () => {},
      get_values: () => ({ food: 'soup' }),
      set_options: () => {},
      get_options: () => [{ label: 'Soup', value: 'soup' }],
      set_error: () => {},
      clear_error: () => {},
    },
  });

  expect(runtime.doc.form.get_value('food')).toBe('soup');
  expect(runtime.doc.form.get_values()).toEqual({ food: 'soup' });
  expect(runtime.doc.form.get_options('food')).toEqual([{ label: 'Soup', value: 'soup' }]);
});

test('createScriptingRuntime exposes a supplied database API', () => {
  const runtime = createScriptingRuntime({
    document: { meta: {}, extension: '.hvy', sections: [], attachments: [] },
    db: {
      query: (sql, params) => [{ sql, params, title: 'Sweep' }],
      execute: (sql, params) => `ran ${sql} with ${JSON.stringify(params)}`,
    },
  });

  expect(runtime.doc.db.query('SELECT title FROM chores', { active: 1 })).toEqual([
    { sql: 'SELECT title FROM chores', params: { active: 1 }, title: 'Sweep' },
  ]);
  expect(runtime.doc.db.execute('INSERT INTO chores (title) VALUES (?)', ['Sweep'])).toBe(
    'ran INSERT INTO chores (title) VALUES (?) with ["Sweep"]'
  );
});

test('createScriptingRuntime exposes synchronous hvy cli commands', () => {
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
  const runtime = createScriptingRuntime({ document });

  expect(runtime.doc.cli.run('hvy add section / notes "Notes"')).toBe('/body/notes');
  expect(runtime.doc.cli.run('hvy add text /notes intro "Hello from CLI"')).toContain('/body/notes/intro: created');
  expect(runtime.doc.cli.run('cat /notes/intro/text.txt')).toBe('Hello from CLI');
  expect(runtime.stats.toolCalls).toBe(3);
});

test('createScriptingRuntime points db-table SQL callers at doc.db instead of cli', () => {
  const runtime = createScriptingRuntime({
    document: { meta: {}, extension: '.hvy', sections: [], attachments: [] },
    db: {
      query: () => [],
      execute: () => 'ok',
    },
  });

  expect(() => runtime.doc.cli.run('hvy plugin db-table exec "CREATE TABLE things (id INTEGER)"')).toThrow(
    'doc.cli.run cannot run db-table SQL commands. Use doc.db.query or doc.db.execute instead.'
  );
});
