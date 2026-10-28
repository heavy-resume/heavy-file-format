# Parameter kinds for the `doc` API. Every call names the kind of each of its
# parameters; these helpers own the type checks and the error messages, and
# return plain Python values ready to cross into JavaScript.


from javascript import JSObject as __hvy_js_object_type__


def __hvy_value_kind__(value):
    if value is None:
        return 'none'
    if value is True or value is False:
        return 'bool'
    if isinstance(value, (int, float)):
        return 'number'
    if isinstance(value, str):
        return 'text'
    if isinstance(value, (bytes, bytearray)):
        return 'bytes'
    if isinstance(value, dict):
        return 'mapping'
    if isinstance(value, __hvy_js_object_type__):
        # Values the script received from the host (rows, plugin results,
        # attachment bytes); only the host can tell their shape apart.
        return {
            'array': 'sequence',
            'object': 'mapping',
            'bytes': 'bytes',
            'function': 'callable',
        }.get(__hvy_globals__.valueKind(value), 'unsupported')
    if hasattr(value, 'isoformat'):
        return 'temporal'
    if callable(value):
        return 'callable'
    try:
        iter(value)
        return 'sequence'
    except TypeError:
        return 'unsupported'


def __hvy_type_name__(value):
    if isinstance(value, __hvy_js_object_type__):
        return 'JavaScript ' + __hvy_globals__.valueKind(value)
    return value.__class__.__name__


def __hvy_argument_error__(where, expected, value):
    return TypeError(where + " must be " + expected + ", got " + __hvy_type_name__(value))


def __hvy_mapping_items__(where, value):
    pairs = value.items() if isinstance(value, dict) else [(key, value[key]) for key in value]
    items = []
    for key, item in pairs:
        if not isinstance(key, str):
            raise __hvy_argument_error__(where + " key", "text", key)
        items.append((key, item))
    return items


def __hvy_text_arg__(where, value):
    if isinstance(value, str):
        return value
    raise __hvy_argument_error__(where, "text", value)


def __hvy_bool_arg__(where, value):
    if value is True or value is False:
        return value
    raise __hvy_argument_error__(where, "a boolean", value)


def __hvy_int_arg__(where, value):
    if isinstance(value, int) and value is not True and value is not False:
        return value
    raise __hvy_argument_error__(where, "an integer", value)


def __hvy_scalar_arg__(where, value):
    kind = __hvy_value_kind__(value)
    if kind in ('none', 'bool', 'number', 'text'):
        return value
    if kind == 'temporal':
        return str(value)
    raise __hvy_argument_error__(where, "text, a number, a boolean, None or a date", value)


def __hvy_sql_params_arg__(where, value):
    kind = __hvy_value_kind__(value)
    if kind == 'none':
        return None
    if kind == 'mapping':
        return {key: __hvy_scalar_arg__(where + "/" + key, item) for key, item in __hvy_mapping_items__(where, value)}
    if kind == 'sequence':
        return [__hvy_scalar_arg__(where + "/" + str(index), item) for index, item in enumerate(value)]
    raise __hvy_argument_error__(where, "a sequence or mapping of SQL values", value)


def __hvy_json_pointer_segment__(value):
    return str(value).replace('~', '~0').replace('/', '~1')


# Callables are accepted only when `callbacks` is a dict; they are recorded by
# JSON pointer path and their position in the value becomes None.
def __hvy_json_arg__(where, value, callbacks=None, path=''):
    kind = __hvy_value_kind__(value)
    if kind in ('none', 'bool', 'number', 'text'):
        return value
    if kind == 'temporal':
        return str(value)
    if kind == 'mapping':
        return {
            key: __hvy_json_arg__(where, item, callbacks, path + "/" + __hvy_json_pointer_segment__(key))
            for key, item in __hvy_mapping_items__(where + path, value)
        }
    if kind == 'sequence':
        return [
            __hvy_json_arg__(where, item, callbacks, path + "/" + str(index))
            for index, item in enumerate(value)
        ]
    if kind == 'callable' and callbacks is not None:
        callbacks[path] = __hvy_wrap_plugin_callback__(value)
        return None
    expected = "a JSON value or callback" if callbacks is not None else "a JSON value"
    raise __hvy_argument_error__(where + path, expected, value)


def __hvy_json_object_arg__(where, value, callbacks=None):
    if __hvy_value_kind__(value) != 'mapping':
        raise __hvy_argument_error__(where, "a mapping", value)
    return __hvy_json_arg__(where, value, callbacks)


# Merges a call's positional args mapping with its keyword arguments.
def __hvy_call_args__(where, args, kwargs, callbacks=None):
    merged = {} if args is None else __hvy_json_object_arg__(where, args, callbacks)
    for key, item in kwargs.items():
        merged[key] = __hvy_json_arg__(where, item, callbacks, "/" + __hvy_json_pointer_segment__(key))
    return merged


def __hvy_bytes_arg__(where, value):
    kind = __hvy_value_kind__(value)
    if kind == 'bytes':
        return list(value) if isinstance(value, (bytes, bytearray)) else value
    if kind == 'sequence':
        data = list(value)
        for index, item in enumerate(data):
            if not isinstance(item, int) or item is True or item is False or item < 0 or item > 255:
                raise __hvy_argument_error__(where + "/" + str(index), "an integer from 0 to 255", item)
        return data
    raise __hvy_argument_error__(where, "bytes or a sequence of integers from 0 to 255", value)


# Encodes values produced by the helpers above (plain Python values only).
def __hvy_json_escape__(value):
    out = '"'
    for ch in str(value):
        if ch == '\\':
            out += '\\\\'
        elif ch == '"':
            out += '\\"'
        elif ch == '\n':
            out += '\\n'
        elif ch == '\r':
            out += '\\r'
        elif ch == '\t':
            out += '\\t'
        else:
            out += ch
    return out + '"'


def __hvy_to_json__(value):
    if value is None:
        return 'null'
    if value is True:
        return 'true'
    if value is False:
        return 'false'
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str):
        return __hvy_json_escape__(value)
    if isinstance(value, list):
        return '[' + ','.join([__hvy_to_json__(item) for item in value]) + ']'
    if isinstance(value, dict):
        return '{' + ','.join([__hvy_json_escape__(key) + ':' + __hvy_to_json__(item) for key, item in value.items()]) + '}'
    raise TypeError("internal: value was not normalized by a doc argument helper")
