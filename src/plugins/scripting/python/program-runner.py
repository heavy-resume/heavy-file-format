# Executes the user script: line tracing, compile / cache, user globals, exec.

def __hvy_trace__(frame, event, arg):
    if frame.f_code.co_filename != __hvy_trace_filename__:
        return None
    if event == 'line':
        __hvy_user_step__()
    return __hvy_trace__


try:
    try:
        import sys as __hvy_sys__
        if hasattr(__hvy_sys__, 'settrace'):
            __hvy_sys__.settrace(__hvy_trace__)
            __hvy_trace_enabled__ = True
    except Exception:
        __hvy_trace_enabled__ = False

    __hvy_compilable_source__ = __hvy_source__ if __hvy_trace_enabled__ else __hvy_instrumented_source__
    if __hvy_definition_key__ is None:
        __hvy_code__ = compile(__hvy_compilable_source__, __hvy_trace_filename__, 'exec')
    else:
        __hvy_code__ = __hvy_globals__.compiledDefinitions.get(__hvy_definition_key__)
        if __hvy_code__ is None or __hvy_globals__.compiledDefinitionSources.get(__hvy_definition_key__) != __hvy_compilable_source__:
            __hvy_code__ = compile(__hvy_compilable_source__, __hvy_trace_filename__, 'exec')
            __hvy_globals__.compiledDefinitionSources.set(__hvy_definition_key__, __hvy_compilable_source__)
            __hvy_globals__.compiledDefinitions.set(__hvy_definition_key__, __hvy_code__)
    __hvy_user_globals__ = {
        '__hvy_step__': __hvy_user_step__,
        '__import__': __hvy_script_import__,
        '__builtins__': __hvy_safe_builtins__,
        'doc': __HvyDocProxy__(__hvy_runtime__.doc),
        'eval': __hvy_safe_eval__,
        'getattr': __hvy_getattr__,
        'globals': __hvy_safe_globals__,
        'hasattr': __hvy_hasattr__,
        'setattr': __hvy_setattr__,
        'delattr': __hvy_delattr__,
        'print': __hvy_print__,
        '__name__': '__hvy_script__',
    }
    for __hvy_restricted_name__ in __hvy_restricted_builtin_names__:
        __hvy_user_globals__[__hvy_restricted_name__] = __HvyRestrictedBuiltin__(__hvy_restricted_name__)
    for __hvy_library__ in __hvy_allowed_libraries__:
        __hvy_user_globals__[__hvy_library__] = __hvy_script_import__(__hvy_library__)
    __hvy_user_globals__.update(__hvy_injected_globals__)
    __hvy_sanitize_user_globals__()
    exec(__hvy_code__, __hvy_user_globals__)
    __hvy_entrypoint__ = __hvy_user_globals__.get('__hvy_user_main__')
    __hvy_sanitize_user_globals__()
    if __hvy_entrypoint__ is not None:
        __hvy_globals__.results[__hvy_runtime_id__] = __hvy_entrypoint__()
    __hvy_runtime__.doc.rerender()
except Exception as __hvy_err__:
    __hvy_globals__.errors[__hvy_runtime_id__] = __hvy_window__.__BRYTHON__.error_trace(__hvy_err__)
finally:
    if __hvy_trace_enabled__:
        try:
            __hvy_sys__.settrace(None)
        except Exception:
            pass
    __hvy_globals__.callbacks[__hvy_runtime_id__]()
