# Checked time zones for `datetime`, plus the checked `zoneinfo` and `tzlocal`
# libraries. Offsets come from the runtime clock (clock-bridge.ts), which
# resolves every instant against the browser's Intl time zone database, so
# daylight-saving transitions follow the real zone rules.


def __hvy_require_tzinfo__(value):
    if value is not None and not isinstance(value, __HvyTzinfo__):
        raise TypeError("tzinfo must be None, a datetime.timezone or a zoneinfo.ZoneInfo")


def __hvy_checked_offset__(value, label):
    if value is None:
        return None
    if not isinstance(value, __HvyTimedelta__):
        raise TypeError("tzinfo." + label + "() must return None or timedelta")
    total = value._total_microseconds_value()
    if total <= -__hvy_us_per_day__ or total >= __hvy_us_per_day__:
        raise ValueError("offset must be a timedelta strictly between -timedelta(hours=24) and timedelta(hours=24)")
    return value


def __hvy_format_utc_offset__(total, separator):
    sign = "-" if total < 0 else "+"
    hours, remainder = divmod(abs(total), 3600000000)
    minutes, remainder = divmod(remainder, 60000000)
    seconds, microseconds = divmod(remainder, 1000000)
    output = f"{sign}{hours:02d}{separator}{minutes:02d}"
    if seconds or microseconds:
        output += f"{separator}{seconds:02d}"
    if microseconds:
        output += f".{microseconds:06d}"
    return output


def __hvy_clock_ms__(utc_us):
    return (utc_us - __hvy_epoch_naive_us__) // 1000


class __HvyTzinfo__:
    def utcoffset(self, dt):
        raise NotImplementedError("a tzinfo subclass must implement utcoffset()")

    def dst(self, dt):
        raise NotImplementedError("a tzinfo subclass must implement dst()")

    def tzname(self, dt):
        raise NotImplementedError("a tzinfo subclass must implement tzname()")

    def _require_own_datetime(self, dt):
        if not isinstance(dt, __HvyDateTime__):
            raise TypeError("fromutc() argument must be a datetime")
        if dt.tzinfo is not self:
            raise ValueError("fromutc: dt.tzinfo is not self")


class __HvyTimezone__(__HvyTzinfo__):
    def __init__(self, offset, name=None):
        if not isinstance(offset, __HvyTimedelta__):
            raise TypeError("timezone() offset must be a timedelta")
        if name is not None and not isinstance(name, str):
            raise TypeError("timezone() name must be a string")
        __hvy_checked_offset__(offset, "utcoffset")
        self.__offset = offset
        self.__name = name

    def utcoffset(self, dt):
        return self.__offset

    def dst(self, dt):
        return None

    def tzname(self, dt):
        if self.__name is not None:
            return self.__name
        total = self.__offset._total_microseconds_value()
        return "UTC" if total == 0 else "UTC" + __hvy_format_utc_offset__(total, ":")

    def fromutc(self, dt):
        self._require_own_datetime(dt)
        return dt + self.__offset

    def __eq__(self, other):
        return isinstance(other, __HvyTimezone__) and self.__offset == other.utcoffset(None)

    def __hash__(self):
        return hash(self.__offset)

    def __repr__(self):
        if self is __hvy_utc__:
            return "datetime.timezone.utc"
        if self.__name is None:
            return "datetime.timezone(" + repr(self.__offset) + ")"
        return "datetime.timezone(" + repr(self.__offset) + ", " + repr(self.__name) + ")"

    def __str__(self):
        return self.tzname(None)


__hvy_utc__ = __HvyTimezone__(__HvyTimedelta__())


class __HvyZoneInfo__(__HvyTzinfo__):
    def __init__(self, key):
        self.key = key

    def _offset_us_at(self, utc_us):
        return int(__hvy_runtime__.clock.offset_ms(__hvy_clock_ms__(utc_us), self.key)) * 1000

    # Offset for a wall-clock time, following PEP 495: an ambiguous or skipped
    # time uses the pre-transition offset when fold=0 and the post-transition
    # offset when fold=1.
    def _wall_offset_us(self, dt):
        wall = dt._naive_us()
        before = self._offset_us_at(wall - __hvy_us_per_day__)
        after = self._offset_us_at(wall + __hvy_us_per_day__)
        if before == after:
            return self._offset_us_at(wall - before)
        before_valid = self._offset_us_at(wall - before) == before
        after_valid = self._offset_us_at(wall - after) == after
        if before_valid != after_valid:
            return before if before_valid else after
        return after if dt.fold else before

    def utcoffset(self, dt):
        if dt is None:
            return None
        return __hvy_timedelta_us__(self._wall_offset_us(dt))

    # Intl does not report the DST flag, so DST is measured against the
    # zone's smaller offset of January and July in that year.
    def dst(self, dt):
        if dt is None:
            return None
        january = __HvyDateTime__(dt.year, 1, 1)._naive_us()
        july = __HvyDateTime__(dt.year, 7, 1)._naive_us()
        standard = min(self._offset_us_at(january), self._offset_us_at(july))
        return __hvy_timedelta_us__(self._wall_offset_us(dt) - standard)

    def tzname(self, dt):
        if dt is None:
            return None
        utc_us = dt._naive_us() - self._wall_offset_us(dt)
        return str(__hvy_runtime__.clock.abbreviation(__hvy_clock_ms__(utc_us), self.key))

    def fromutc(self, dt):
        self._require_own_datetime(dt)
        utc_us = dt._naive_us()
        offset = self._offset_us_at(utc_us)
        local = __hvy_datetime_from_naive_us__(utc_us + offset, self)
        if self._wall_offset_us(local) != offset:
            local = local.replace(fold=1)
        return local

    def __repr__(self):
        return "zoneinfo.ZoneInfo(key=" + repr(self.key) + ")"

    def __str__(self):
        return self.key


# Named without the internal prefix because scripts see this class name in
# tracebacks and `except` clauses; program-level names never reach user globals.
class ZoneInfoNotFoundError(KeyError):
    pass


__hvy_zoneinfo_cache__ = {}


def __hvy_zoneinfo_for_key__(key, use_cache=True):
    if not isinstance(key, str):
        raise TypeError("ZoneInfo key must be a string")
    if use_cache and key in __hvy_zoneinfo_cache__:
        return __hvy_zoneinfo_cache__[key]
    if not __hvy_runtime__.clock.is_zone(key):
        raise ZoneInfoNotFoundError("No time zone found with key " + key)
    zone = __HvyZoneInfo__(key)
    if use_cache:
        __hvy_zoneinfo_cache__[key] = zone
    return zone


def __hvy_local_zoneinfo__():
    return __hvy_zoneinfo_for_key__(str(__hvy_runtime__.clock.local_zone()))


# What CPython's argument-less astimezone() returns: a fixed offset named after
# the local zone at that instant.
def __hvy_local_fixed_timezone__(utc_us):
    zone = __hvy_local_zoneinfo__()
    name = str(__hvy_runtime__.clock.abbreviation(__hvy_clock_ms__(utc_us), zone.key))
    return __HvyTimezone__(__hvy_timedelta_us__(zone._offset_us_at(utc_us)), name)


class __HvyTimezoneFacade__:
    utc = __hvy_utc__

    def __call__(self, offset, name=None):
        if name is None and isinstance(offset, __HvyTimedelta__) and offset._total_microseconds_value() == 0:
            return __hvy_utc__
        return __HvyTimezone__(offset, name)

    def __instancecheck__(self, value):
        return isinstance(value, __HvyTimezone__)


class __HvyZoneInfoFacade__:
    def __call__(self, key):
        return __hvy_zoneinfo_for_key__(key)

    def __instancecheck__(self, value):
        return isinstance(value, __HvyZoneInfo__)

    def no_cache(self, key):
        return __hvy_zoneinfo_for_key__(key, False)

    def clear_cache(self, *, only_keys=None):
        if only_keys is None:
            __hvy_zoneinfo_cache__.clear()
            return
        for key in only_keys:
            __hvy_zoneinfo_cache__.pop(key, None)


class __HvyDatetimeModule__:
    MINYEAR = 1
    MAXYEAR = 9999
    UTC = __hvy_utc__
    date = __HvyDateFacade__()
    datetime = __HvyDateTimeFacade__()
    timedelta = __HvyTimedeltaFacade__()
    timezone = __HvyTimezoneFacade__()


class __HvyZoneinfoModule__:
    ZoneInfo = __HvyZoneInfoFacade__()
    ZoneInfoNotFoundError = ZoneInfoNotFoundError

    def available_timezones(self):
        zones = __hvy_runtime__.clock.zones()
        return set(str(zones.valueAt(index)) for index in range(int(zones.count())))


class __HvyTzlocalModule__:
    def get_localzone(self):
        return __hvy_local_zoneinfo__()

    def get_localzone_name(self):
        return __hvy_local_zoneinfo__().key
