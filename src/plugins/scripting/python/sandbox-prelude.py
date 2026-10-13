# Wrapper globals, user-global sanitizing, guarded builtins and the import hook.
# Per-run values (__hvy_static_runtime_id__, __hvy_allowed_libraries__, ...)
# are assigned by the header that python-program.ts emits before this file.

from browser import window as __hvy_window__

__hvy_globals__ = __hvy_window__.__HVY_SCRIPTING__
if __hvy_definition_key__ is None:
    __hvy_runtime_id__ = __hvy_static_runtime_id__
else:
    __hvy_runtime_id__ = __hvy_globals__.activeRuntimeIds.get(__hvy_definition_key__)
__hvy_runtime__ = __hvy_globals__.runtimes[__hvy_runtime_id__]
__hvy_source__ = __hvy_globals__.sources[__hvy_runtime_id__]
__hvy_instrumented_source__ = __hvy_globals__.instrumentedSources[__hvy_runtime_id__]
__hvy_trace_enabled__ = False
__hvy_builtin_import__ = __import__
__hvy_builtin_eval__ = eval
__hvy_forbidden_global_names__ = (
    'window',
    'document',
    'browser',
    '__BRYTHON__',
    '__hvy_window__',
    '__hvy_globals__',
    '__hvy_runtime__',
    '__hvy_source__',
    '__hvy_instrumented_source__',
    '__hvy_user_globals__',
    '__hvy_user_main__',
)


def __hvy_sanitize_user_globals__():
    try:
        for __hvy_name__ in __hvy_forbidden_global_names__:
            __hvy_user_globals__.pop(__hvy_name__, None)
    except Exception:
        pass


def __hvy_user_step__():
    __hvy_step_error__ = __hvy_runtime__.step()
    if __hvy_step_error__:
        raise RuntimeError(__hvy_step_error__)
    __hvy_sanitize_user_globals__()


def __hvy_safe_globals__():
    __hvy_sanitize_user_globals__()
    return {
        __hvy_key__: __hvy_value__
        for __hvy_key__, __hvy_value__ in __hvy_user_globals__.items()
        if __hvy_key__ not in __hvy_forbidden_global_names__
    }


# Copy string subclasses through the base operation, bypassing user overrides.
# Check and use this exact text for both policy and execution / lookup.
def __hvy_plain_string__(value):
    if not isinstance(value, str):
        raise TypeError("HVY attribute names and eval expressions must be strings.")
    if type(value) is str:
        return value
    return str.__getitem__(value, slice(None))


def __hvy_safe_eval__(expression, globals=None, locals=None):
    expression = __hvy_plain_string__(expression)
    if expression.strip() in __hvy_forbidden_global_names__:
        raise NameError("name '" + expression.strip() + "' is not defined")
    if globals is not None or locals is not None:
        raise RuntimeError("Custom eval globals are not allowed in HVY scripts.")
    __hvy_policy_error__ = __hvy_globals__.sourcePolicyError(expression)
    if __hvy_policy_error__:
        raise RuntimeError(__hvy_policy_error__)
    __hvy_sanitize_user_globals__()
    return __hvy_builtin_eval__(expression, __hvy_user_globals__, __hvy_user_globals__)


def __hvy_blocked_import__(*args, **kwargs):
    raise RuntimeError("Import statements are not allowed in HVY scripts.")


# Installed as user globals so they shadow Brython's real builtins while still
# letting scripts bind the same names (methods, parameters, locals) normally.
class __HvyRestrictedBuiltin__:
    def __init__(self, name):
        self.name = name

    def __call__(self, *args, **kwargs):
        raise NameError("builtin '" + self.name + "' is not available in HVY scripts.")

    def __repr__(self):
        return "<restricted builtin '" + self.name + "'>"




def __hvy_require_public_attribute__(name):
    name = __hvy_plain_string__(name)
    if "__" in name and name not in __hvy_public_dunder_names__:
        raise AttributeError("HVY scripts cannot access private runtime attribute '" + name + "'.")
    return name


def __hvy_getattr__(value, name, *default):
    name = __hvy_require_public_attribute__(name)
    if len(default) > 1:
        raise TypeError("getattr expected at most 3 arguments")
    if len(default) == 1:
        return getattr(value, name, default[0])
    return getattr(value, name)


def __hvy_hasattr__(value, name):
    try:
        __hvy_getattr__(value, name)
        return True
    except AttributeError:
        return False


def __hvy_setattr__(value, name, replacement):
    name = __hvy_require_public_attribute__(name)
    return setattr(value, name, replacement)


def __hvy_delattr__(value, name):
    name = __hvy_require_public_attribute__(name)
    return delattr(value, name)


def __hvy_script_import__(name, globals=None, locals=None, fromlist=(), level=0):
    root_name = str(name).split('.')[0]
    if level != 0 or root_name not in __hvy_allowed_libraries__:
        raise RuntimeError("Import statements are not allowed in HVY scripts.")
    if root_name == "random":
        return __HvyRandomModule__()
    if root_name == "re":
        return __HvyReModule__()
    if root_name == "datetime":
        return __HvyDatetimeModule__()
    return __hvy_builtin_import__(name, globals, locals, fromlist, level)


def __hvy_print__(*values, sep=' ', end='\n', file=None, flush=False):
    if file is not None:
        raise RuntimeError("print(file=...) is not supported in HVY scripts.")
    text = str(sep).join([str(value) for value in values]) + str(end)
    if text.endswith('\n'):
        text = text[:-1]
    __hvy_runtime__.doc.log_json(__hvy_to_json__([text]))


__hvy_safe_builtins__ = {
    'abs': abs,
    'all': all,
    'any': any,
    'bool': bool,
    'dict': dict,
    'enumerate': enumerate,
    'float': float,
    'getattr': __hvy_getattr__,
    'hasattr': __hvy_hasattr__,
    'int': int,
    'isinstance': isinstance,
    'len': len,
    'list': list,
    'max': max,
    'min': min,
    'print': __hvy_print__,
    'range': range,
    'round': round,
    'set': set,
    'sorted': sorted,
    'str': str,
    'setattr': __hvy_setattr__,
    'sum': sum,
    'tuple': tuple,
    'delattr': __hvy_delattr__,
    'zip': zip,
    'BaseException': BaseException,
    'Exception': Exception,
    'RuntimeError': RuntimeError,
    'TypeError': TypeError,
    'ValueError': ValueError,
    '__import__': __hvy_script_import__,
}
