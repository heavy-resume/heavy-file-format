import { expect, test } from 'vitest';

import {
  buildPythonProgram,
  buildScriptingVersionMismatchMessage,
  comparePluginVersions,
  instrumentPythonSource,
  stripPythonImports,
  summarizeScriptingError,
  runUserScript,
} from '../src/plugins/scripting/wrapper';
import { SCRIPTING_PLUGIN_VERSION } from '../src/plugins/scripting/version';

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
