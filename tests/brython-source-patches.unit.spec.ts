import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test } from 'vitest';
import { applyBrythonSourcePatches } from '../src/plugins/scripting/brython-source-patches';

test('the installed Brython bundle contains every internal the source patches rewrite', () => {
  const bundledSource = readFileSync(createRequire(import.meta.url).resolve('brython/brython.min.js'), 'utf8');

  const patchedSource = applyBrythonSourcePatches(bundledSource);

  expect(patchedSource).toContain('if(jsobj===null){return $B.builtins.None}');
  expect(patchedSource).toContain('case"undefined":return $B.builtins.None;');
  expect(patchedSource).toContain('attr in _self){return $B.builtins.None}');
  expect(patchedSource).toContain('case null:case $B.builtins.None:return null}');
  const attributeGuard = 'if($B.hvyBlockedAttributeNames?.has(attr)){throw $B.hvyBlockedAttributeError(attr)}';
  expect(patchedSource).toContain(`$B.$getattr=function(obj,attr,_default){${attributeGuard}`);
  expect(patchedSource).toContain(`$B.$setattr=function(obj,attr,value){${attributeGuard}`);
  expect(patchedSource).toContain(`_b_.delattr=function(obj,attr){${attributeGuard}`);
  expect(patchedSource).toContain('$current_exception;if(trace_func===_b_.None){return _b_.None}return trace_func(');
  expect(patchedSource).toContain('}if(trace_func===_b_.None){return _b_.None}return trace_func(frame,"line",');
  expect(patchedSource).toContain('$current_frame_id||trace_func===_b_.None){return _b_.None}trace_func(frame,"return",value)}');
});

test('the source patches refuse a Brython bundle whose internals changed', () => {
  expect(() => applyBrythonSourcePatches('var fake_brython_bundle = 1;')).toThrow(
    'Brython jsobj2pyobj source not found; update brython-source-patches.ts for this Brython version.'
  );
});
