# JSON marshaling, plugin callback wrapping and the `doc` proxies scripts use.

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
    if isinstance(value, (list, tuple)):
        return '[' + ','.join([__hvy_to_json__(item) for item in value]) + ']'
    if isinstance(value, dict):
        parts = []
        for key, item in value.items():
            parts.append(__hvy_json_escape__(key) + ':' + __hvy_to_json__(item))
        return '{' + ','.join(parts) + '}'
    return __hvy_json_escape__(value)


def __hvy_json_pointer_segment__(value):
    return str(value).replace('~', '~0').replace('/', '~1')


def __hvy_wrap_plugin_callback__(callback):
    def __hvy_plugin_callback__(*args):
        __hvy_callback_trace_enabled__ = False
        try:
            if __hvy_trace_enabled__:
                __hvy_sys__.settrace(__hvy_trace__)
                __hvy_callback_trace_enabled__ = True
            return callback(*args)
        except Exception as __hvy_callback_err__:
            __hvy_runtime__.doc.callback_error(
                __hvy_window__.__BRYTHON__.error_trace(__hvy_callback_err__)
            )
            return None
        finally:
            if __hvy_callback_trace_enabled__:
                try:
                    __hvy_sys__.settrace(None)
                except Exception:
                    pass
    return __hvy_plugin_callback__


def __hvy_plugin_to_json__(value, callbacks, path=''):
    if callable(value):
        callbacks[path] = __hvy_wrap_plugin_callback__(value)
        return 'null'
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
    if isinstance(value, (list, tuple)):
        return '[' + ','.join([
            __hvy_plugin_to_json__(item, callbacks, path + '/' + str(index))
            for index, item in enumerate(value)
        ]) + ']'
    if isinstance(value, dict):
        parts = []
        for key, item in value.items():
            key_text = str(key)
            parts.append(
                __hvy_json_escape__(key_text) + ':' +
                __hvy_plugin_to_json__(
                    item,
                    callbacks,
                    path + '/' + __hvy_json_pointer_segment__(key_text)
                )
            )
        return '{' + ','.join(parts) + '}'
    return __hvy_json_escape__(value)


class __HvyToolProxy__:
    def __init__(self, js_doc):
        self.__js_doc = js_doc

    def __call__(self, name, args=None, **kwargs):
        if args is None:
            merged = {}
        elif isinstance(args, dict):
            merged = dict(args)
        else:
            raise TypeError("doc.tool args must be a dict when provided")
        merged.update(kwargs)
        return self.__js_doc.tool_json(name, __hvy_to_json__(merged))

    def __getattr__(self, name):
        def __hvy_named_tool__(*args, **kwargs):
            if len(args) == 0:
                return self(name, None, **kwargs)
            if len(args) == 1:
                if name in ("get_updated_components", "get_components") and not isinstance(args[0], dict):
                    merged = {"component": args[0]}
                    merged.update(kwargs)
                    return self(name, merged)
                return self(name, args[0], **kwargs)
            raise TypeError("doc.tool.NAME accepts at most one positional args dict")
        return __hvy_named_tool__

class __HvyPluginsProxy__:
    def __init__(self, js_doc):
        self.__js_doc = js_doc

    def call(self, plugin_id, method, args=None, **kwargs):
        if args is None:
            merged = {}
        elif isinstance(args, dict):
            merged = dict(args)
        else:
            raise TypeError("doc.plugins.call args must be a dict when provided")
        merged.update(kwargs)
        callbacks = {}
        args_json = __hvy_plugin_to_json__(merged, callbacks)
        return self.__js_doc.plugins.call_marshaled(plugin_id, method, args_json, callbacks)


class __HvyDbProxy__:
    def __init__(self, js_doc):
        self.__js_doc = js_doc

    def query(self, sql, params=None):
        return self.__js_doc.db.query_json(sql, __hvy_to_json__(params))

    def execute(self, sql, params=None):
        return self.__js_doc.db.execute_json(sql, __hvy_to_json__(params))

    def get_tables(self):
        return self.__js_doc.db.get_tables()

    def get_updated_tables(self, table_name=''):
        return self.__js_doc.db.get_updated_tables(table_name)


class __HvyDocProxy__:
    def __init__(self, js_doc):
        self.__js_doc = js_doc
        self.tool = __HvyToolProxy__(js_doc)
        self.plugins = __HvyPluginsProxy__(js_doc)
        self.db = __HvyDbProxy__(js_doc)

    def __getattr__(self, name):
        return getattr(self.__js_doc, name)
