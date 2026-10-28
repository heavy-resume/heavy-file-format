# Plugin callback wrapping and the `doc` proxies scripts use. Each proxy method
# declares its parameter kinds with the helpers in doc-arguments.py.

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


def __hvy_handle__(js_handle):
    if js_handle is None:
        return None
    if js_handle.component == 'section':
        return __HvySectionHandle__(js_handle)
    return __HvyComponentHandle__(js_handle)


class __HvySectionHandle__:
    def __init__(self, js_handle):
        self.__js = js_handle
        self.id = js_handle.id
        self.component = js_handle.component
        self.base_component = js_handle.base_component
        self.section_id = js_handle.section_id
        self.section_title = js_handle.section_title

    def get(self, name):
        return self.__js.get(__hvy_text_arg__("section.get name", name))

    def has_tag(self, tag):
        return self.__js.has_tag(__hvy_text_arg__("section.has_tag tag", tag))


class __HvyComponentHandle__:
    def __init__(self, js_handle):
        self.__js = js_handle
        self.id = js_handle.id
        self.component = js_handle.component
        self.base_component = js_handle.base_component
        self.section_id = js_handle.section_id
        self.section_title = js_handle.section_title
        self.removed = js_handle.removed

    def get(self, name):
        return self.__js.get(__hvy_text_arg__("handle.get name", name))

    def set(self, name, value):
        self.__js.set(__hvy_text_arg__("handle.set name", name), __hvy_json_arg__("handle.set value", value))

    def has_tag(self, tag):
        return self.__js.has_tag(__hvy_text_arg__("handle.has_tag tag", tag))

    def expand(self):
        self.__js.expand()

    def get_parent_by_tag(self, tag):
        return __hvy_handle__(self.__js.get_parent_by_tag(__hvy_text_arg__("handle.get_parent_by_tag tag", tag)))

    def get_ancestor_record(self, excluded_tags=""):
        return __hvy_handle__(self.__js.get_ancestor_record(
            __hvy_text_arg__("handle.get_ancestor_record excluded_tags", excluded_tags)
        ))

    def first_table_cell(self, index=0):
        return self.__js.first_table_cell(__hvy_int_arg__("handle.first_table_cell index", index))

    def set_sort_value(self, key, value):
        return self.__js.set_sort_value(
            __hvy_text_arg__("handle.set_sort_value key", key),
            __hvy_scalar_arg__("handle.set_sort_value value", value),
        )

    def set_group_value(self, key, value):
        return self.__js.set_group_value(
            __hvy_text_arg__("handle.set_group_value key", key),
            __hvy_scalar_arg__("handle.set_group_value value", value),
        )

    def fingerprint(self):
        return self.__js.fingerprint()

    def remove_children_by_tag(self, tag, slot="expandable-content"):
        return self.__js.remove_children_by_tag(
            __hvy_text_arg__("handle.remove_children_by_tag tag", tag),
            __hvy_text_arg__("handle.remove_children_by_tag slot", slot),
        )

    def append_child(self, component, config=None, text="", slot="expandable-content"):
        return __hvy_handle__(self.__js.append_child(
            __hvy_text_arg__("handle.append_child component", component),
            None if config is None else __hvy_json_object_arg__("handle.append_child config", config),
            __hvy_text_arg__("handle.append_child text", text),
            __hvy_text_arg__("handle.append_child slot", slot),
        ))


# Tools whose results are component handles rather than text.
__hvy_handle_tools__ = ("get_components", "get_updated_components")


class __HvyToolProxy__:
    def __init__(self, js_doc):
        self.__js_doc = js_doc

    def __call__(self, name, args=None, **kwargs):
        name = __hvy_text_arg__("doc.tool name", name)
        result = self.__js_doc.tool_json(name, __hvy_to_json__(__hvy_call_args__("doc.tool args", args, kwargs)))
        if name in __hvy_handle_tools__:
            return [__hvy_handle__(handle) for handle in result]
        return result

    def __getattr__(self, name):
        def __hvy_named_tool__(*args, **kwargs):
            if len(args) == 0:
                return self(name, None, **kwargs)
            if len(args) == 1:
                if name in __hvy_handle_tools__ and __hvy_value_kind__(args[0]) != 'mapping':
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
        callbacks = {}
        args_json = __hvy_to_json__(__hvy_call_args__("doc.plugins.call args", args, kwargs, callbacks))
        return self.__js_doc.plugins.call_marshaled(
            __hvy_text_arg__("doc.plugins.call plugin_id", plugin_id),
            __hvy_text_arg__("doc.plugins.call method", method),
            args_json,
            callbacks,
        )


class __HvyDbProxy__:
    def __init__(self, js_doc):
        self.__js_db = js_doc.db

    def query(self, sql, params=None):
        return self.__js_db.query_json(
            __hvy_text_arg__("doc.db.query sql", sql),
            __hvy_to_json__(__hvy_sql_params_arg__("doc.db.query params", params)),
        )

    def execute(self, sql, params=None):
        return self.__js_db.execute_json(
            __hvy_text_arg__("doc.db.execute sql", sql),
            __hvy_to_json__(__hvy_sql_params_arg__("doc.db.execute params", params)),
        )

    def get_tables(self):
        return self.__js_db.get_tables()

    def get_updated_tables(self, table_name=""):
        return self.__js_db.get_updated_tables(__hvy_text_arg__("doc.db.get_updated_tables table_name", table_name))


class __HvyHeaderProxy__:
    def __init__(self, js_doc):
        self.__js_header = js_doc.header

    def get(self, key):
        return self.__js_header.get(__hvy_text_arg__("doc.header.get key", key))

    def set(self, key, value):
        self.__js_header.set(__hvy_text_arg__("doc.header.set key", key), __hvy_json_arg__("doc.header.set value", value))

    def remove(self, key):
        self.__js_header.remove(__hvy_text_arg__("doc.header.remove key", key))

    def keys(self):
        return self.__js_header.keys()


class __HvyComponentProxy__:
    def __init__(self, js_doc):
        self.__js_component = js_doc.component

    def get_text(self, id):
        return self.__js_component.get_text(__hvy_text_arg__("doc.component.get_text id", id))

    def set_text(self, id, text):
        self.__js_component.set_text(
            __hvy_text_arg__("doc.component.set_text id", id),
            __hvy_text_arg__("doc.component.set_text text", text),
        )

    def is_empty(self, id):
        return self.__js_component.is_empty(__hvy_text_arg__("doc.component.is_empty id", id))


class __HvyAttachmentsProxy__:
    def __init__(self, js_doc):
        self.__js_attachments = js_doc.attachments

    def list(self):
        return self.__js_attachments.list()

    def read(self, id):
        return self.__js_attachments.read(__hvy_text_arg__("doc.attachments.read id", id))

    def write(self, id, bytes, meta=None):
        self.__js_attachments.write(
            __hvy_text_arg__("doc.attachments.write id", id),
            __hvy_bytes_arg__("doc.attachments.write bytes", bytes),
            None if meta is None else __hvy_json_object_arg__("doc.attachments.write meta", meta),
        )

    def remove(self, id):
        self.__js_attachments.remove(__hvy_text_arg__("doc.attachments.remove id", id))


class __HvyFormProxy__:
    def __init__(self, js_doc):
        self.__js_form = js_doc.form

    def get_value(self, label):
        return self.__js_form.get_value(__hvy_text_arg__("doc.form.get_value label", label))

    def set_value(self, label, value):
        self.__js_form.set_value(
            __hvy_text_arg__("doc.form.set_value label", label),
            __hvy_json_arg__("doc.form.set_value value", value),
        )

    def get_values(self):
        return self.__js_form.get_values()

    def set_options(self, label, options):
        self.__js_form.set_options(
            __hvy_text_arg__("doc.form.set_options label", label),
            __hvy_json_arg__("doc.form.set_options options", options),
        )

    def get_options(self, label):
        return self.__js_form.get_options(__hvy_text_arg__("doc.form.get_options label", label))

    def set_error(self, label, message):
        self.__js_form.set_error(
            __hvy_text_arg__("doc.form.set_error label", label),
            __hvy_text_arg__("doc.form.set_error message", message),
        )

    def clear_error(self, label):
        self.__js_form.clear_error(__hvy_text_arg__("doc.form.clear_error label", label))

    def set_submit_disabled(self, disabled, reason=""):
        self.__js_form.set_submit_disabled(
            __hvy_bool_arg__("doc.form.set_submit_disabled disabled", disabled),
            __hvy_text_arg__("doc.form.set_submit_disabled reason", reason),
        )

    def get_submit_disabled(self):
        return self.__js_form.get_submit_disabled()


class __HvyJsonProxy__:
    def __init__(self, js_doc):
        self.__js_json = js_doc.json

    def parse(self, response):
        return self.__js_json.parse(__hvy_text_arg__("doc.json.parse response", response))

    def parse_array(self, response):
        return self.__js_json.parse_array(__hvy_text_arg__("doc.json.parse_array response", response))

    def parse_object(self, response):
        return self.__js_json.parse_object(__hvy_text_arg__("doc.json.parse_object response", response))


class __HvyTimeProxy__:
    def __init__(self, js_doc):
        self.__js_time = js_doc.time

    def now_iso(self):
        return self.__js_time.now_iso()

    def now_local(self):
        return self.__js_time.now_local()

    def now_unix_ms(self):
        return self.__js_time.now_unix_ms()

    def today_iso(self):
        return self.__js_time.today_iso()


class __HvyExportProxy__:
    def __init__(self, js_doc):
        self.__js_export = js_doc.export

    def hide(self, id_or_tag):
        self.__js_export.hide(__hvy_text_arg__("doc.export.hide id_or_tag", id_or_tag))

    def include(self, id_or_tag):
        self.__js_export.include(__hvy_text_arg__("doc.export.include id_or_tag", id_or_tag))

    def expand(self, id_or_tag):
        self.__js_export.expand(__hvy_text_arg__("doc.export.expand id_or_tag", id_or_tag))

    def keep_together(self, id_or_tag):
        self.__js_export.keep_together(__hvy_text_arg__("doc.export.keep_together id_or_tag", id_or_tag))

    def style(self, id_or_tag, style):
        self.__js_export.style(
            __hvy_text_arg__("doc.export.style id_or_tag", id_or_tag),
            __hvy_json_object_arg__("doc.export.style style", style),
        )

    def strategy(self, rule):
        self.__js_export.strategy(__hvy_json_arg__("doc.export.strategy rule", rule))


class __HvyCliProxy__:
    def __init__(self, js_doc):
        self.__js_cli = js_doc.cli

    def run(self, command):
        return self.__js_cli.run(__hvy_text_arg__("doc.cli.run command", command))

    def write(self, path, content):
        return self.__js_cli.write(
            __hvy_text_arg__("doc.cli.write path", path),
            __hvy_text_arg__("doc.cli.write content", content),
        )


class __HvyDocProxy__:
    def __init__(self, js_doc):
        self.__js_doc = js_doc
        self.tool = __HvyToolProxy__(js_doc)
        self.plugins = __HvyPluginsProxy__(js_doc)
        self.db = __HvyDbProxy__(js_doc)
        self.header = __HvyHeaderProxy__(js_doc)
        self.component = __HvyComponentProxy__(js_doc)
        self.attachments = __HvyAttachmentsProxy__(js_doc)
        self.form = __HvyFormProxy__(js_doc)
        self.json = __HvyJsonProxy__(js_doc)
        self.time = __HvyTimeProxy__(js_doc)
        self.export = __HvyExportProxy__(js_doc)
        self.cli = __HvyCliProxy__(js_doc)

    def rerender(self):
        self.__js_doc.rerender()
