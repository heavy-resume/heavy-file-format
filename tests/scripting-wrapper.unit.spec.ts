import { expect, test } from 'vitest';

import { buildPythonProgram, instrumentPythonSource } from '../src/plugins/scripting/wrapper';

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
