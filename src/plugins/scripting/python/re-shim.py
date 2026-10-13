# Checked `re` library, backed by the JavaScript regex bridge (regex-bridge.ts).

class __HvyReMatch__:
    def __init__(self, regex_match, source):
        self.__regex_match = regex_match
        self.string = source
        self.__capture_count = int(regex_match.captureCount())
        self.lastindex = self.__capture_count - 1 if self.__capture_count > 1 else None

    def group(self, *indexes):
        if len(indexes) == 0:
            indexes = (0,)
        values = []
        for index in indexes:
            if not isinstance(index, int):
                raise TypeError("HVY re match group indexes must be integers.")
            if index < 0 or index >= self.__capture_count:
                raise IndexError("no such group")
            value = self.__regex_match.captureAt(index)
            values.append(None if value is None else str(value))
        return values[0] if len(values) == 1 else tuple(values)

    def groups(self):
        return tuple(self.group(index) for index in range(1, self.__capture_count))

    def start(self, index=0):
        if index != 0:
            raise RuntimeError("HVY re match start() only supports group 0.")
        return int(self.__regex_match.index)

    def end(self, index=0):
        if index != 0:
            raise RuntimeError("HVY re match end() only supports group 0.")
        return int(self.__regex_match.end)

    def span(self, index=0):
        return (self.start(index), self.end(index))


class __HvyRePattern__:
    def __init__(self, pattern, flags=0):
        self.pattern = str(pattern)
        self.flags = int(flags or 0)

    def __hvy_js_flags__(self, global_search=False):
        flags = "u"
        if self.flags & __HvyReModule__.IGNORECASE:
            flags += "i"
        if self.flags & __HvyReModule__.MULTILINE:
            flags += "m"
        if self.flags & __HvyReModule__.DOTALL:
            flags += "s"
        return flags

    def search(self, string):
        source = str(string)
        found = __hvy_globals__.regex.exec(self.pattern, self.__hvy_js_flags__(), source)
        return None if not found.matched else __HvyReMatch__(found, source)

    def match(self, string):
        source = str(string)
        found = __hvy_globals__.regex.exec(self.pattern, self.__hvy_js_flags__(), source)
        if not found.matched or int(found.index) != 0:
            return None
        return __HvyReMatch__(found, source)

    def fullmatch(self, string):
        source = str(string)
        found = self.match(source)
        if found is None or found.end(0) != len(source):
            return None
        return found

    def findall(self, string):
        results = __hvy_globals__.regex.findall(self.pattern, self.__hvy_js_flags__(), str(string))
        out = []
        for index in range(0, int(results.count())):
            if results.isTuple(index):
                out.append(tuple(
                    None if results.valueAt(index, group_index) is None else str(results.valueAt(index, group_index))
                    for group_index in range(0, int(results.tupleCount(index)))
                ))
            else:
                value = results.valueAt(index, 0)
                out.append(None if value is None else str(value))
        return out

    def sub(self, repl, string, count=0):
        return str(__hvy_globals__.regex.sub(self.pattern, self.__hvy_js_flags__(), str(repl), str(string), int(count or 0)))

    def split(self, string, maxsplit=0):
        results = __hvy_globals__.regex.split(self.pattern, self.__hvy_js_flags__(), str(string), int(maxsplit or 0))
        return [str(results.valueAt(index)) for index in range(0, int(results.count()))]


class __HvyReModule__:
    IGNORECASE = 2
    I = IGNORECASE
    MULTILINE = 8
    M = MULTILINE
    DOTALL = 16
    S = DOTALL

    def compile(self, pattern, flags=0):
        return __HvyRePattern__(pattern, flags)

    def search(self, pattern, string, flags=0):
        return self.compile(pattern, flags).search(string)

    def match(self, pattern, string, flags=0):
        return self.compile(pattern, flags).match(string)

    def fullmatch(self, pattern, string, flags=0):
        return self.compile(pattern, flags).fullmatch(string)

    def findall(self, pattern, string, flags=0):
        return self.compile(pattern, flags).findall(string)

    def sub(self, pattern, repl, string, count=0, flags=0):
        return self.compile(pattern, flags).sub(repl, string, count)

    def split(self, pattern, string, maxsplit=0, flags=0):
        return self.compile(pattern, flags).split(string, maxsplit)
