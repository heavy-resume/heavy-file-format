// Load-time patches to the Brython source. Each rewrites one Brython internal
// that every crossing or lookup funnels through, so the behaviour is fixed at
// its root rather than at each call site. A patch whose original text is not
// found exactly once fails the load instead of silently not applying.

interface BrythonSourcePatch {
  name: string;
  original: string;
  patched: string;
}

// Brython keeps JavaScript null / undefined distinct from Python None in both
// directions. Every crossing goes through jsobj2pyobj / pyobj2jsobj, plus one
// JSObj attribute shortcut for present-but-undefined properties.
const noneConversionPatches: BrythonSourcePatch[] = [
  {
    name: 'jsobj2pyobj',
    original: '$B.jsobj2pyobj=function(jsobj,_this){if(jsobj===null){return null}switch(typeof jsobj){case"boolean":return jsobj;case"undefined":return $B.Undefined;',
    patched: '$B.jsobj2pyobj=function(jsobj,_this){if(jsobj===null){return $B.builtins.None}switch(typeof jsobj){case"boolean":return jsobj;case"undefined":return $B.builtins.None;',
  },
  {
    // Absent properties still raise AttributeError / KeyError below this branch.
    name: 'JSObj.__getattribute__',
    original: 'if(js_attr===undefined){if(typeof _self=="object"&&attr in _self){return $B.Undefined}',
    patched: 'if(js_attr===undefined){if(typeof _self=="object"&&attr in _self){return $B.builtins.None}',
  },
  {
    name: 'pyobj2jsobj',
    original: '$B.pyobj2jsobj=function(pyobj){switch(pyobj){case true:case false:return pyobj;case $B.Undefined:return undefined;case null:return null}',
    patched: '$B.pyobj2jsobj=function(pyobj){switch(pyobj){case true:case false:return pyobj;case $B.Undefined:return undefined;case null:case $B.builtins.None:return null}',
  },
];

// Brython falls back to JavaScript properties for attributes of its own
// objects, so `fn.constructor` on a Python function is JavaScript `Function`.
// Dot access, getattr, hasattr, str.format, f-strings, setattr, del and
// delattr all funnel through these three, which consult the blocked-name guard
// installed by brython-interop-policy.ts.
const attributeGuard = 'if($B.hvyBlockedAttributeNames?.has(attr)){throw $B.hvyBlockedAttributeError(attr)}';
const attributeGuardPatches: BrythonSourcePatch[] = [
  {
    name: '$getattr',
    original: '$B.$getattr=function(obj,attr,_default){',
    patched: `$B.$getattr=function(obj,attr,_default){${attributeGuard}`,
  },
  {
    name: '$setattr',
    original: '$B.$setattr=function(obj,attr,value){',
    patched: `$B.$setattr=function(obj,attr,value){${attributeGuard}`,
  },
  {
    name: 'delattr',
    original: '_b_.delattr=function(obj,attr){',
    patched: `_b_.delattr=function(obj,attr){${attributeGuard}`,
  },
];

// Brython calls the current frame's local trace function without checking it.
// A tracer returns None for frames it ignores (HVY's step tracer ignores
// everything but the user script), and CPython then reports no events for that
// frame; Brython instead calls None, e.g. when bridge code resumes a generator
// the script created.
const traceHookPatches: BrythonSourcePatch[] = [
  {
    name: 'trace_exception',
    original: 'var trace_func=frame.$f_trace,exc=frame[1].$current_exception;return trace_func(',
    patched: 'var trace_func=frame.$f_trace,exc=frame[1].$current_exception;if(trace_func===_b_.None){return _b_.None}return trace_func(',
  },
  {
    name: 'trace_line',
    original: 'var trace_func=frame.$f_trace;if(trace_func===undefined){console.log("trace line, frame",frame)}return trace_func(frame,"line",',
    patched: 'var trace_func=frame.$f_trace;if(trace_func===undefined){console.log("trace line, frame",frame)}if(trace_func===_b_.None){return _b_.None}return trace_func(frame,"line",',
  },
  {
    name: 'trace_return',
    original: 'if(frame[0]==$B.tracefunc.$current_frame_id){return _b_.None}trace_func(frame,"return",value)}',
    patched: 'if(frame[0]==$B.tracefunc.$current_frame_id||trace_func===_b_.None){return _b_.None}trace_func(frame,"return",value)}',
  },
];

export function applyBrythonSourcePatches(source: string): string {
  return [...noneConversionPatches, ...attributeGuardPatches, ...traceHookPatches].reduce((patchedSource, patch) => {
    const occurrences = patchedSource.split(patch.original).length - 1;
    if (occurrences !== 1) {
      throw new Error(`Brython ${patch.name} source not found; update brython-source-patches.ts for this Brython version.`);
    }
    return patchedSource.replace(patch.original, () => patch.patched);
  }, source);
}
