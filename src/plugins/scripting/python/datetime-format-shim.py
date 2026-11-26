# Checked `datetime` parsing and formatting: strftime, strptime and
# fromisoformat. Names use the C locale (English), as CPython does by default.

__hvy_month_names__ = (
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
)
__hvy_day_names__ = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")


def __hvy_strftime__(value, format):
    is_datetime = isinstance(value, __HvyDateTime__)
    hour = value.hour if is_datetime else 0
    minute = value.minute if is_datetime else 0
    second = value.second if is_datetime else 0
    offset = value._offset_us() if is_datetime else None
    zone_name = value.tzname() if is_datetime else None
    iso_year, iso_week, iso_weekday = value.isocalendar()
    weekday = value.weekday()
    sunday_weekday = (weekday + 1) % 7
    day_of_year = __hvy_date_to_ordinal__(value.year, value.month, value.day) - __hvy_date_to_ordinal__(value.year, 1, 1) + 1
    day_name = __hvy_day_names__[weekday]
    month_name = __hvy_month_names__[value.month - 1]
    replacements = {
        "Y": f"{value.year:04d}", "y": f"{value.year % 100:02d}", "m": f"{value.month:02d}",
        "d": f"{value.day:02d}", "e": f"{value.day:2d}", "j": f"{day_of_year:03d}",
        "w": str(sunday_weekday), "u": str(weekday + 1),
        "U": f"{(day_of_year - 1 + 7 - sunday_weekday) // 7:02d}", "W": f"{(day_of_year - 1 + 7 - weekday) // 7:02d}",
        "V": f"{iso_week:02d}", "G": f"{iso_year:04d}", "g": f"{iso_year % 100:02d}",
        "a": day_name[:3], "A": day_name, "b": month_name[:3], "h": month_name[:3], "B": month_name,
        "H": f"{hour:02d}", "I": f"{(hour % 12) or 12:02d}", "p": "AM" if hour < 12 else "PM",
        "M": f"{minute:02d}", "S": f"{second:02d}",
        "f": f"{getattr(value, 'microsecond', 0):06d}",
        "z": "" if offset is None else __hvy_format_utc_offset__(offset, ""),
        "Z": zone_name or "",
        "c": f"{day_name[:3]} {month_name[:3]} {value.day:2d} {hour:02d}:{minute:02d}:{second:02d} {value.year:04d}",
        "x": f"{value.month:02d}/{value.day:02d}/{value.year % 100:02d}",
        "X": f"{hour:02d}:{minute:02d}:{second:02d}",
        "%": "%",
    }
    output = ""
    index = 0
    while index < len(format):
        if format[index] != "%":
            output += format[index]
            index += 1
            continue
        index += 1
        if format[index:index + 2] == ":z":
            output += "" if offset is None else __hvy_format_utc_offset__(offset, ":")
            index += 2
            continue
        if index >= len(format) or format[index] not in replacements:
            raise ValueError("unsupported datetime format directive")
        output += replacements[format[index]]
        index += 1
    return output


def __hvy_format_mismatch__(source, template):
    return ValueError("time data " + repr(source) + " does not match format " + repr(template))


def __hvy_read_digits__(source, index, min_width, max_width):
    end = index
    while end < len(source) and end - index < max_width and source[end].isdigit():
        end += 1
    if end - index < min_width:
        return None, index
    return int(source[index:end]), end


def __hvy_read_name__(source, index, names):
    best = None
    lowered = source[index:].lower()
    for position, name in enumerate(names):
        if lowered.startswith(name.lower()) and (best is None or len(name) > len(names[best])):
            best = position
    if best is None:
        return None, index
    return best, index + len(names[best])


# Reads "Z" or a "+HH[:MM[:SS[.ffffff]]]" / "+HHMM[SS]" offset; returns
# (offset microseconds, next index) or (None, index).
def __hvy_read_utc_offset__(source, index):
    if index < len(source) and source[index] in "Zz":
        return 0, index + 1
    if index >= len(source) or source[index] not in "+-":
        return None, index
    sign = -1 if source[index] == "-" else 1
    position = index + 1
    values = []
    while len(values) < 3:
        if values and position < len(source) and source[position] == ":":
            position += 1
        value, next_position = __hvy_read_digits__(source, position, 2, 2)
        if value is None:
            break
        values.append(value)
        position = next_position
    if not values or source[position - 1:position] == ":":
        return None, index
    microseconds = 0
    if len(values) == 3 and position < len(source) and source[position] == ".":
        fraction_start = position + 1
        fraction_end = fraction_start
        while fraction_end < len(source) and fraction_end - fraction_start < 6 and source[fraction_end].isdigit():
            fraction_end += 1
        if fraction_end == fraction_start:
            return None, index
        microseconds = int((source[fraction_start:fraction_end] + "000000")[:6])
        position = fraction_end
    while len(values) < 3:
        values.append(0)
    hours, minutes, seconds = values
    if minutes > 59 or seconds > 59:
        return None, index
    total = ((hours * 60 + minutes) * 60 + seconds) * 1000000 + microseconds
    if total >= __hvy_us_per_day__:
        return None, index
    return sign * total, position


def __hvy_read_zone_name__(source, index):
    end = index
    if end < len(source) and source[end] in "+-":
        end += 1
        while end < len(source) and source[end].isdigit():
            end += 1
        return source[index:end], end
    while end < len(source) and (source[end].isalpha() or source[end] == "_"):
        end += 1
    if end < len(source) and source[end] == "/" and end > index:
        while end < len(source) and (source[end].isalnum() or source[end] in "_/+-"):
            end += 1
    return source[index:end], end


# Resolves a %Z token: UTC / GMT, an IANA key such as Etc/Fake_Zone, a
# numeric "+03" label, or an abbreviation such as PDT at that wall-clock time.
def __hvy_resolve_zone_name__(name, fields):
    if name.upper() in ("UTC", "GMT", "Z"):
        return __hvy_utc__
    if name[:1] in "+-":
        offset, end = __hvy_read_utc_offset__(name, 0)
        if offset is None or end != len(name):
            raise ValueError("unknown time zone name: " + name)
        return __HvyTimezone__(__hvy_timedelta_us__(offset), name)
    if "/" in name:
        return __hvy_zoneinfo_for_key__(name)
    offset_ms = __hvy_runtime__.clock.abbreviation_offset_ms(name, fields[0], fields[1], fields[2], fields[3], fields[4], fields[5])
    if offset_ms is not None:
        return __HvyTimezone__(__hvy_timedelta_us__(int(offset_ms) * 1000), name)
    if __hvy_runtime__.clock.is_zone(name):
        return __hvy_zoneinfo_for_key__(name)
    raise ValueError("unknown or ambiguous time zone name: " + name)


__hvy_strptime_numbers__ = {
    "Y": (4, 4), "y": (2, 2), "m": (1, 2), "d": (1, 2), "H": (1, 2), "I": (1, 2),
    "M": (1, 2), "S": (1, 2), "j": (1, 3), "f": (1, 6),
}


def __hvy_strptime__(source, template):
    found = {}
    source_index = 0
    format_index = 0
    while format_index < len(template):
        character = template[format_index]
        if character.isspace():
            format_index += 1
            start = source_index
            while source_index < len(source) and source[source_index].isspace():
                source_index += 1
            if source_index == start:
                raise __hvy_format_mismatch__(source, template)
            continue
        if character != "%":
            if source_index >= len(source) or source[source_index] != character:
                raise __hvy_format_mismatch__(source, template)
            source_index += 1
            format_index += 1
            continue
        format_index += 1
        if format_index >= len(template):
            raise ValueError("stray % in format " + repr(template))
        directive = template[format_index]
        format_index += 1
        if directive == "%":
            if source_index >= len(source) or source[source_index] != "%":
                raise __hvy_format_mismatch__(source, template)
            source_index += 1
            continue
        if directive in __hvy_strptime_numbers__:
            min_width, max_width = __hvy_strptime_numbers__[directive]
            if directive == "f":
                start = source_index
                value, source_index = __hvy_read_digits__(source, source_index, min_width, max_width)
                if value is not None:
                    value = int((source[start:source_index] + "000000")[:6])
            else:
                value, source_index = __hvy_read_digits__(source, source_index, min_width, max_width)
        elif directive in ("b", "h"):
            value, source_index = __hvy_read_name__(source, source_index, [name[:3] for name in __hvy_month_names__])
        elif directive == "B":
            value, source_index = __hvy_read_name__(source, source_index, __hvy_month_names__)
        elif directive == "a":
            value, source_index = __hvy_read_name__(source, source_index, [name[:3] for name in __hvy_day_names__])
        elif directive == "A":
            value, source_index = __hvy_read_name__(source, source_index, __hvy_day_names__)
        elif directive == "p":
            value, source_index = __hvy_read_name__(source, source_index, ("AM", "PM"))
        elif directive == "z":
            value, source_index = __hvy_read_utc_offset__(source, source_index)
        elif directive == "Z":
            value, source_index = __hvy_read_zone_name__(source, source_index)
            if value == "":
                value = None
        else:
            raise ValueError("unsupported datetime format directive: %" + directive)
        if value is None:
            raise __hvy_format_mismatch__(source, template)
        found["b" if directive in ("b", "h", "B") else directive] = value
    if source_index != len(source):
        raise ValueError("unconverted data remains: " + source[source_index:])
    return __hvy_build_parsed_datetime__(found)


def __hvy_build_parsed_datetime__(found):
    if "Y" in found:
        year = found["Y"]
    elif "y" in found:
        year = found["y"] + (1900 if found["y"] >= 69 else 2000)
    else:
        year = 1900
    month = found["b"] + 1 if "b" in found else found.get("m", 1)
    day = found.get("d", 1)
    if "j" in found and "m" not in found and "b" not in found and "d" not in found:
        year, month, day = __hvy_ordinal_to_date__(__hvy_date_to_ordinal__(year, 1, 1) + found["j"] - 1)
    hour = found.get("H", 0)
    if "I" in found:
        hour = found["I"]
        if hour < 1 or hour > 12:
            raise ValueError("%I hour must be in 1..12")
        if found.get("p", 0) == 1:
            hour = hour if hour == 12 else hour + 12
        elif hour == 12:
            hour = 0
    fields = (year, month, day, hour, found.get("M", 0), found.get("S", 0))
    tzinfo = None
    if "z" in found:
        name = found.get("Z")
        tzinfo = __HvyTimezone__(__hvy_timedelta_us__(found["z"]), name) if name else __HvyTimezoneFacade__()(__hvy_timedelta_us__(found["z"]))
    elif "Z" in found:
        tzinfo = __hvy_resolve_zone_name__(found["Z"], fields)
    return __HvyDateTime__(fields[0], fields[1], fields[2], fields[3], fields[4], fields[5], found.get("f", 0), tzinfo)


def __hvy_parse_iso_date__(source):
    if len(source) == 10 and source[4] == "-" and source[7] == "-":
        parts = (source[0:4], source[5:7], source[8:10])
    elif len(source) == 8:
        parts = (source[0:4], source[4:6], source[6:8])
    else:
        raise ValueError("Invalid isoformat string: " + repr(source))
    if not all(part.isdigit() for part in parts):
        raise ValueError("Invalid isoformat string: " + repr(source))
    return __HvyDate__(int(parts[0]), int(parts[1]), int(parts[2]))


def __hvy_parse_iso_datetime__(source):
    date_length = 10 if len(source) >= 10 and source[4:5] == "-" else 8
    parsed_date = __hvy_parse_iso_date__(source[:date_length])
    time_source = source[date_length + 1:]
    if len(source) > date_length and time_source == "":
        raise ValueError("Invalid isoformat string: " + repr(source))
    tzinfo = None
    zone_start = -1
    for index, character in enumerate(time_source):
        if character in "Zz+-":
            zone_start = index
            break
    if zone_start >= 0:
        offset, end = __hvy_read_utc_offset__(time_source, zone_start)
        if offset is None or end != len(time_source):
            raise ValueError("Invalid isoformat string: " + repr(source))
        tzinfo = __HvyTimezoneFacade__()(__hvy_timedelta_us__(offset))
        time_source = time_source[:zone_start]
    clock_values = [0, 0, 0, 0]
    if time_source != "":
        fraction = ""
        for separator in ".,":
            if separator in time_source:
                time_source, fraction = time_source.split(separator, 1)
        if fraction != "":
            if not fraction.isdigit():
                raise ValueError("Invalid isoformat string: " + repr(source))
            clock_values[3] = int((fraction + "000000")[:6])
        clock = time_source.split(":") if ":" in time_source else [time_source[index:index + 2] for index in range(0, len(time_source), 2)]
        if len(clock) < 1 or len(clock) > 3 or not all(len(item) == 2 and item.isdigit() for item in clock):
            raise ValueError("Invalid isoformat string: " + repr(source))
        for index, item in enumerate(clock):
            clock_values[index] = int(item)
    return __HvyDateTime__(parsed_date.year, parsed_date.month, parsed_date.day, *clock_values, tzinfo)
