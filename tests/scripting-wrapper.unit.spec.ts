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
  wrapPythonSourceInFunction,
} from '../src/plugins/scripting/wrapper';
import { createScriptingRuntime } from '../src/plugins/scripting/runtime';
import { SCRIPTING_PLUGIN_VERSION } from '../src/plugins/scripting/version';
import { getRunnableScriptingTargetsForView } from '../src/plugins/scripting/scripting';
import { deserializeDocument } from '../src/serialization';
import { initCallbacks, initState } from '../src/state';
import { createTestState } from './serialization-test-helpers';

test('instrumentPythonSource adds step calls without rewriting compare expressions', () => {
  expect(
    instrumentPythonSource(
      `output = doc.tool.view_component(component_ref="script-value")
for line in output.split('\\n'):
    if "Script test value:" in line:
        parts = line.split('|', 1)
        if len(parts) == 2:
            doc.header.set("ok", "yes")
`
    )
  ).toBe(
    `__hvy_step__()
output = doc.tool.view_component(component_ref="script-value")
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

test('buildPythonProgram exposes doc.tool attributes with keyword arguments', () => {
  const expectedResult = buildPythonProgram('runtime-keyword-test');

  expect(expectedResult).toContain('class __HvyToolProxy__:');
  expect(expectedResult).toContain('def __call__(self, name, args=None, **kwargs):');
  expect(expectedResult).toContain('def __getattr__(self, name):');
  expect(expectedResult).toContain('merged.update(kwargs)');
  expect(expectedResult).toContain('return self.__js_doc.tool_json(name, __hvy_to_json__(merged))');
  expect(expectedResult).toContain('self.tool = __HvyToolProxy__(js_doc)');
  expect(expectedResult).toContain("'doc': __HvyDocProxy__(__hvy_runtime__.doc)");
});

test('buildPythonProgram exposes doc sub-apis through the doc proxy', () => {
  const expectedResult = buildPythonProgram('runtime-doc-json-test');

  expect(expectedResult).toContain('class __HvyDocProxy__:');
  expect(expectedResult).toContain('return getattr(self.__js_doc, name)');
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
except Exception:
    __hvy_step__()
    doc.header.set("phase", "error")
finally:
    __hvy_step__()
    doc.header.set("phase", "done")
`
  );
});

test('buildPythonProgram traces user frames and falls back to instrumented source', () => {
  const program = buildPythonProgram('r7');
  expect(program).toContain("import sys as __hvy_sys__");
  expect(program).toContain("__hvy_sys__.settrace(__hvy_trace__)");
  expect(program).toContain("if frame.f_code.co_filename != '<hvy-script>':");
  expect(program).toContain("__hvy_compilable_source__ = __hvy_source__ if __hvy_trace_enabled__ else __hvy_instrumented_source__");
  expect(program).not.toContain('NodeTransformer');
  expect(program).not.toContain('visit_Compare');
});

test('buildPythonProgram executes user code with restricted builtins', () => {
  const program = buildPythonProgram('r7');

  expect(program).toContain('__hvy_safe_builtins__ = {');
  expect(program).toContain("'__builtins__': __hvy_safe_builtins__");
  expect(program).toContain("'__import__': __hvy_script_import__");
  expect(program).toContain("'print': __hvy_print__");
  expect(program).toContain('__hvy_runtime__.doc.log_json(__hvy_to_json__([text]))');
  expect(program).toContain('raise RuntimeError("Custom eval globals are not allowed in HVY scripts.")');
});

test('wrapPythonSourceInFunction allows top-level return semantics', () => {
  expect(
    wrapPythonSourceInFunction(
      `doc.header.set("phase", "before")
return
doc.header.set("phase", "after")`
    )
  ).toBe(
    `def __hvy_user_main__():
    doc.header.set("phase", "before")
    return
    doc.header.set("phase", "after")`
  );
});

test('buildPythonProgram uses the component id in tracebacks when available', () => {
  expect(buildPythonProgram('r7', 'import-example-script')).toContain(
    "__hvy_code__ = compile(__hvy_compilable_source__, '<import-example-script>', 'exec')"
  );
});

test('buildPythonProgram preloads checked libraries', () => {
  const program = buildPythonProgram('r7', 'library-example-script', {}, ['random', 're']);

  expect(program).toContain('__hvy_allowed_libraries__ = ["random", "re"]');
  expect(program).toContain("__hvy_user_globals__[__hvy_library__] = __hvy_script_import__(__hvy_library__)");
  expect(program).toContain('if root_name == "re":');
  expect(program).toContain('return __HvyReModule__()');
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

test('stripPythonImports allows checked library imports', () => {
  expect(
    stripPythonImports(
      `import random
items = [1, 2, 3]
random.shuffle(items)
`,
      ['random']
    )
  ).toBe(
    `
items = [1, 2, 3]
random.shuffle(items)
`
  );
});

test('stripPythonImports allows checked regex library imports', () => {
  expect(
    stripPythonImports(
      `import re
match = re.search("a+", "caaat")
`,
      ['re']
    )
  ).toBe(
    `
match = re.search("a+", "caaat")
`
  );
});

test('stripPythonImports allows checked regex from-import statements', () => {
  expect(
    stripPythonImports(
      `from re import search
match = search("a+", "caaat")
`,
      ['re']
    )
  ).toBe(
    `search = re.search
match = search("a+", "caaat")
`
  );
});

test('stripPythonImports rewrites checked import aliases', () => {
  expect(
    stripPythonImports(
      `import re as regex
from re import search as find, sub
match = find("a+", "caaat")
clean = sub("a+", "a", "caaat")
`,
      ['re']
    )
  ).toBe(
    `regex = re
find = re.search
sub = re.sub
match = find("a+", "caaat")
clean = sub("a+", "a", "caaat")
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
    stepsExecuted: 0,
    stepBudget: 100_000,
    linesExecuted: 0,
    toolCalls: 0,
  });
});

test('createScriptingRuntime exposes a supplied form API', () => {
  const runtime = createScriptingRuntime({
    document: { meta: {}, extension: '.hvy', sections: [], attachments: [] },
    form: {
      get_value: (label) => (label === 'Food' ? 'soup' : null),
      set_value: () => {},
      get_values: () => ({ Food: 'soup' }),
      set_options: () => {},
      get_options: () => [{ label: 'Soup', value: 'soup' }],
      set_error: () => {},
      clear_error: () => {},
    },
  });

  expect(runtime.doc.form.get_value('Food')).toBe('soup');
  expect(runtime.doc.form.get_values()).toEqual({ Food: 'soup' });
  expect(runtime.doc.form.get_options('Food')).toEqual([{ label: 'Soup', value: 'soup' }]);
});

test('createScriptingRuntime reports when the line budget is exceeded', () => {
  const runtime = createScriptingRuntime({
    document: { meta: {}, extension: '.hvy', sections: [], attachments: [] },
    maxLines: 2,
  });

  expect(runtime.step()).toBeNull();
  expect(runtime.step()).toBeNull();
  expect(runtime.step()).toContain('step budget (2)');
  expect(runtime.stats.stepsExecuted).toBe(3);
  expect(runtime.stats.stepBudget).toBe(2);
  expect(runtime.stats.linesExecuted).toBe(3);
});

test('createScriptingRuntime stores script logs', () => {
  const runtime = createScriptingRuntime({
    document: { meta: {}, extension: '.hvy', sections: [], attachments: [] },
  });

  runtime.doc.log_json('["before",{"count":2}]');

  expect(runtime.stats.logs).toEqual(['before {"count":2}']);
});

test('createScriptingRuntime exposes doc.json response parsing helpers', () => {
  const runtime = createScriptingRuntime({
    document: { meta: {}, extension: '.hvy', sections: [], attachments: [] },
  });

  const object = runtime.doc.json.parse_object('```json\n{"question":"What changed?","nested":{"answer":"doc.json"}}\n```') as Record<string, unknown> & {
    get(key: string, defaultValue?: unknown): unknown;
  };
  expect(object.question).toBe('What changed?');
  expect(object.get('question')).toBe('What changed?');
  expect(object.get('missing', 'fallback')).toBe('fallback');
  expect((object.nested as { get(key: string): unknown }).get('answer')).toBe('doc.json');

  const array = runtime.doc.json.parse_array('Response:\n```json\n[{"source_id":"intro"},{"source_id":"details"}]\n```') as Array<{
    get(key: string): unknown;
  }>;
  expect(array).toHaveLength(2);
  expect(array[0]?.get('source_id')).toBe('intro');

  expect(runtime.doc.json.parse('The object is {"ok":true}.')).toEqual({ ok: true });
});

test('createScriptingRuntime doc.json throws for invalid or mismatched response shapes', () => {
  const runtime = createScriptingRuntime({
    document: { meta: {}, extension: '.hvy', sections: [], attachments: [] },
  });

  expect(() => runtime.doc.json.parse('not json')).toThrow('Response was not valid JSON.');
  expect(() => runtime.doc.json.parse_array('{"items":[]}')).toThrow('Return exactly one JSON array.');
  expect(() => runtime.doc.json.parse_object('[{"item":1}]')).toThrow('Return exactly one JSON object.');
});

test('createScriptingRuntime exposes time helpers', () => {
  const runtime = createScriptingRuntime({
    document: { meta: {}, extension: '.hvy', sections: [], attachments: [] },
    now: () => new Date(2026, 5, 30, 15, 45, 12, 345),
  });

  const expectedDate = new Date(2026, 5, 30, 15, 45, 12, 345);
  expect(runtime.doc.time.now_iso()).toBe(expectedDate.toISOString());
  expect(runtime.doc.time.now_local()).toBe(new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(expectedDate));
  expect(runtime.doc.time.now_local()).not.toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(runtime.doc.time.now_unix_ms()).toBe(expectedDate.getTime());
  expect(runtime.doc.time.today_iso()).toBe('2026-06-30');
});

test('createScriptingRuntime syncs script-created sort value annotations before rerender', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: minute-entry
    baseType: container
    sortValueDefs:
      Time:
        type: datetime
    schema:
      containerExpanded: true
      containerBlocks: []
---

<!--hvy: {"id":"minutes"}-->
#! Minutes

 <!--hvy:component-list {"id":"minute-entries","componentListComponent":"minute-entry"}-->
`, '.hvy');
  initCallbacks({
    renderApp: () => {},
    refreshReaderPanels: () => {},
    refreshModalPreview: () => {},
    componentRenderHelpers: null,
    readerRenderer: null,
  });
  initState(createTestState(document));
  const runtime = createScriptingRuntime({ document });
  const entries = (runtime.doc.tool('get_components', { component: 'component-list' }) as Array<{
    append_child(component: string, config?: unknown, text?: string, slot?: string): {
      append_child(component: string, config?: unknown, text?: string, slot?: string): unknown;
    };
  }>)[0]!;
  const entry = entries.append_child(
    'minute-entry',
    { id: 'minute-entry-1', tags: 'meeting-minute' },
    '',
    'component-list'
  );
  entry.append_child(
    'text',
    {},
    '<!--hvy:sort-value {"key":"Time"}-->July 8, 2026 at 9:15 AM PDT<!--/hvy:sort-value-->',
    'container'
  );

  runtime.doc.rerender();

  const expectedResult = document.sections[0]!.blocks[0]!.schema.componentListBlocks[0]!.schema.sortKeys;
  expect(expectedResult).toEqual({ Time: '2026-07-08T16:15:00.000Z' });
});

test('createScriptingRuntime component set_text clears stale fill-in state', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"header","hideIfUnmodified":true}-->
#! Header

<!--hvy:text {"id":"pronunciation","fillIn":true}-->
[<!-- value {"placeholder":"pronunciation"} -->]
`, '.hvy');
  const runtime = createScriptingRuntime({ document });

  runtime.doc.component.set_text('pronunciation', '[AY-vuh-ree HART]');

  expect(document.sections[0]?.blocks[0]?.text).toBe('[AY-vuh-ree HART]');
  expect(document.sections[0]?.blocks[0]?.schema.fillIn).toBe(false);
  expect(document.sections[0]?.hideIfUnmodified).toBe(false);
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

  expect(runtime.doc.cli.run('hvy insert 0 section / notes "Notes"')).toBe('/body/notes');
  expect(runtime.doc.cli.run('hvy insert 0 text /notes intro')).toContain('/body/notes/intro: created');
  expect(runtime.doc.cli.run('cat /notes/intro/text.txt')).toBe('');
  expect(runtime.stats.toolCalls).toBe(3);
});

test('createScriptingRuntime exposes safe virtual file writes', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"notes"}-->
#! Notes

<!--hvy:text {"id":"note"}-->
 Before
`, '.hvy');
  const runtime = createScriptingRuntime({ document });

  expect(runtime.doc.cli.run('cat /id/note/raw.hvy')).toContain('Before');
  expect(runtime.doc.cli.write('/id/note/text.json', '{ "css": "margin: 0;" }')).toBe('/id/note/text.json: written');
  expect(() => runtime.doc.cli.write('/id/note/raw.hvy', '<!--hvy:text {"id":"note"}-->\n After')).toThrow(
    'doc.cli.write does not write raw.hvy files.'
  );

  expect(runtime.doc.cli.run('cat /id/note/text.json')).toContain('"css": "margin: 0;"');
});

test('createScriptingRuntime exposes component handles for reciprocal xref scripts after updates', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"history","tags":"reciprocal-xref-source"}-->
#! Experience

 <!--hvy:history-record {"id":"history-acme","xrefTitle":"Acme Platform","xrefDetail":"Staff Engineer"}-->

  <!--hvy:xref-card {"id":"history-acme-python","xrefTarget":"skill-python"}-->

<!--hvy: {"id":"skills"}-->
#! Skills

 <!--hvy:skill-record {"id":"skill-python","tags":"skill"}-->
  Python

  <!--hvy:expandable:content {}-->
`, '.hvy');
  const runtime = createScriptingRuntime({ document, changeReason: 'edit' });
  const xref = runtime.doc.tool('get_updated_components', { component: 'xref' }) as Array<{
    get(name: string): unknown;
    get_parent_by_tag(tag: string): { section_id: string } | null;
  }>;

  expect(xref[0]?.get('xrefTarget')).toBe('skill-python');
  expect(xref[0]?.get_parent_by_tag('reciprocal-xref-source')?.section_id).toBe('history');
  expect(runtime.stats.toolCalls).toBe(1);
});

test('createScriptingRuntime returns no updated components during document load', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"history","tags":"reciprocal-xref-source"}-->
#! Experience

 <!--hvy:xref-card {"id":"history-acme-python","xrefTarget":"skill-python"}-->
`, '.hvy');
  const runtime = createScriptingRuntime({ document, changeReason: 'load' });

  const updated = runtime.doc.tool('get_updated_components', { component: 'xref' }) as unknown[];
  const all = runtime.doc.tool('get_components', { component: 'xref' }) as unknown[];

  expect(updated).toEqual([]);
  expect(all).toHaveLength(1);
});

test('createScriptingRuntime returns changed and removed components after updates', () => {
  const previousDocument = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"history","tags":"reciprocal-xref-source"}-->
#! Experience

 <!--hvy:xref-card {"id":"history-acme-python","xrefTarget":"skill-python"}-->

 <!--hvy:xref-card {"id":"history-acme-typescript","xrefTarget":"tool-typescript"}-->
`, '.hvy');
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"history","tags":"reciprocal-xref-source"}-->
#! Experience

 <!--hvy:xref-card {"id":"history-acme-python","xrefTarget":"tool-python"}-->
`, '.hvy');
  const runtime = createScriptingRuntime({ document, previousDocument, changeReason: 'edit' });

  const updated = runtime.doc.tool('get_updated_components', { component: 'xref' }) as Array<{
    id: string;
    removed: boolean;
    get(name: string): unknown;
  }>;

  expect(updated.map((component) => ({
    id: component.id,
    removed: component.removed,
    target: component.get('xrefTarget'),
  }))).toEqual([
    { id: 'history-acme-python', removed: false, target: 'tool-python' },
    { id: 'history-acme-typescript', removed: true, target: 'tool-typescript' },
  ]);
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

test('scripting hooks run editor-only scripts in editor and AI views', () => {
  const targets = [
    {
      sectionKey: 'section',
      blockId: 'editor-script',
      source: 'print("editor")',
      editorOnly: true,
      pluginVersion: SCRIPTING_PLUGIN_VERSION,
      componentId: '',
      libraries: [],
    },
    {
      sectionKey: 'section',
      blockId: 'document-script',
      source: 'print("document")',
      editorOnly: false,
      pluginVersion: SCRIPTING_PLUGIN_VERSION,
      componentId: '',
      libraries: [],
    },
  ];

  expect(getRunnableScriptingTargetsForView(targets, 'editor').map((target) => target.blockId)).toEqual(['editor-script']);
  expect(getRunnableScriptingTargetsForView(targets, 'viewer').map((target) => target.blockId)).toEqual(['document-script']);
  expect(getRunnableScriptingTargetsForView(targets, 'ai').map((target) => target.blockId)).toEqual(['editor-script']);
});
