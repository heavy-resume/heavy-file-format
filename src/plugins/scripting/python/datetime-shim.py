# Checked `datetime` library: date, datetime and timedelta implemented in Python.
# Time zone classes live in timezone-shim.py and parsing / formatting lives in
# datetime-format-shim.py. Aware values follow CPython semantics.

__hvy_us_per_second__ = 1000000
__hvy_us_per_day__ = 86400000000
__hvy_keep__ = object()


def __hvy_is_leap_year__(year):
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)


def __hvy_days_in_month__(year, month):
    if month == 2:
        return 29 if __hvy_is_leap_year__(year) else 28
    return (31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)[month - 1]


def __hvy_date_to_ordinal__(year, month, day):
    before_month = (0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334)[month - 1]
    return 365 * (year - 1) + (year - 1) // 4 - (year - 1) // 100 + (year - 1) // 400 + before_month + (1 if month > 2 and __hvy_is_leap_year__(year) else 0) + day


def __hvy_ordinal_to_date__(ordinal):
    if ordinal < 1 or ordinal > 3652059:
        raise OverflowError("date value out of range")
    low = 1
    high = 9999
    while low <= high:
        middle = (low + high) // 2
        first = __hvy_date_to_ordinal__(middle, 1, 1)
        following = __hvy_date_to_ordinal__(middle + 1, 1, 1) if middle < 9999 else 3652060
        if ordinal < first:
            high = middle - 1
        elif ordinal >= following:
            low = middle + 1
        else:
            year = middle
            break
    day_of_year = ordinal - __hvy_date_to_ordinal__(year, 1, 1) + 1
    month = 1
    while day_of_year > __hvy_days_in_month__(year, month):
        day_of_year -= __hvy_days_in_month__(year, month)
        month += 1
    return year, month, day_of_year


__hvy_epoch_naive_us__ = (__hvy_date_to_ordinal__(1970, 1, 1) - 1) * __hvy_us_per_day__


class __HvyTimedelta__:
    def __init__(self, days=0, seconds=0, microseconds=0, milliseconds=0, minutes=0, hours=0, weeks=0):
        values = (days, seconds, microseconds, milliseconds, minutes, hours, weeks)
        if not all(isinstance(value, (int, float)) for value in values):
            raise TypeError("timedelta arguments must be numbers")
        total = (weeks * 7 + days) * 86400000000 + hours * 3600000000 + minutes * 60000000 + seconds * 1000000 + milliseconds * 1000 + microseconds
        self.__total_microseconds = int(round(total))
        self.days, remainder = divmod(self.__total_microseconds, 86400000000)
        self.seconds, self.microseconds = divmod(remainder, 1000000)

    def total_seconds(self):
        return self.__total_microseconds / 1000000

    def __str__(self):
        hours, remainder = divmod(self.seconds, 3600)
        minutes, seconds = divmod(remainder, 60)
        clock = f"{hours}:{minutes:02d}:{seconds:02d}"
        if self.microseconds:
            clock += f".{self.microseconds:06d}"
        if self.days == 0:
            return clock
        label = "day" if abs(self.days) == 1 else "days"
        return f"{self.days} {label}, {clock}"

    def __repr__(self):
        parts = []
        if self.days:
            parts.append(f"days={self.days}")
        if self.seconds:
            parts.append(f"seconds={self.seconds}")
        if self.microseconds:
            parts.append(f"microseconds={self.microseconds}")
        return "datetime.timedelta(" + (", ".join(parts) if parts else "0") + ")"

    def _total_microseconds_value(self):
        return self.__total_microseconds

    def __add__(self, other):
        if isinstance(other, __HvyTimedelta__):
            return __HvyTimedelta__(microseconds=self.__total_microseconds + other._total_microseconds_value())
        return NotImplemented

    def __sub__(self, other):
        if isinstance(other, __HvyTimedelta__):
            return __HvyTimedelta__(microseconds=self.__total_microseconds - other._total_microseconds_value())
        return NotImplemented

    def __neg__(self):
        return __HvyTimedelta__(microseconds=-self.__total_microseconds)

    def __pos__(self):
        return self

    def __abs__(self):
        return -self if self.__total_microseconds < 0 else self

    def __bool__(self):
        return self.__total_microseconds != 0

    def __hash__(self):
        return hash(self.__total_microseconds)

    def __eq__(self, other):
        return isinstance(other, __HvyTimedelta__) and self.__total_microseconds == other._total_microseconds_value()

    def __lt__(self, other):
        if not isinstance(other, __HvyTimedelta__):
            return NotImplemented
        return self.__total_microseconds < other._total_microseconds_value()

    def __le__(self, other):
        if not isinstance(other, __HvyTimedelta__):
            return NotImplemented
        return self.__total_microseconds <= other._total_microseconds_value()


def __hvy_timedelta_us__(us):
    return __HvyTimedelta__(microseconds=us)


class __HvyDate__:
    def __init__(self, year, month, day):
        if not all(isinstance(value, int) for value in (year, month, day)):
            raise TypeError("date arguments must be integers")
        if year < 1 or year > 9999:
            raise ValueError("year must be in 1..9999")
        if month < 1 or month > 12:
            raise ValueError("month must be in 1..12")
        if day < 1 or day > __hvy_days_in_month__(year, month):
            raise ValueError("day is out of range for month")
        self.year = year
        self.month = month
        self.day = day

    def __ordinal(self):
        return __hvy_date_to_ordinal__(self.year, self.month, self.day)

    def toordinal(self):
        return self.__ordinal()

    def weekday(self):
        return (self.__ordinal() - 1) % 7

    def isoweekday(self):
        return self.weekday() + 1

    def isocalendar(self):
        ordinal = self.__ordinal()
        thursday = ordinal + (3 - self.weekday())
        iso_year = __hvy_ordinal_to_date__(thursday)[0]
        first_thursday = __hvy_date_to_ordinal__(iso_year, 1, 4)
        first_thursday += 3 - ((first_thursday - 1) % 7)
        return iso_year, (thursday - first_thursday) // 7 + 1, self.weekday() + 1

    def replace(self, year=None, month=None, day=None):
        return __HvyDate__(
            self.year if year is None else year,
            self.month if month is None else month,
            self.day if day is None else day,
        )

    def isoformat(self):
        return f"{self.year:04d}-{self.month:02d}-{self.day:02d}"

    def __str__(self):
        return self.isoformat()

    def __repr__(self):
        return f"datetime.date({self.year}, {self.month}, {self.day})"

    def strftime(self, format):
        return __hvy_strftime__(self, str(format))

    def __format__(self, format):
        return self.strftime(format) if format else str(self)

    def __add__(self, other):
        if isinstance(other, __HvyTimedelta__):
            year, month, day = __hvy_ordinal_to_date__(self.__ordinal() + other.days)
            return __HvyDate__(year, month, day)
        return NotImplemented

    def __radd__(self, other):
        return self.__add__(other)

    def __sub__(self, other):
        if isinstance(other, __HvyTimedelta__):
            return self + (-other)
        if isinstance(other, __HvyDate__):
            return __HvyTimedelta__(days=self.__ordinal() - other.__ordinal())
        return NotImplemented

    def __hash__(self):
        return hash((self.year, self.month, self.day))

    def __eq__(self, other):
        return isinstance(other, __HvyDate__) and (self.year, self.month, self.day) == (other.year, other.month, other.day)

    def __lt__(self, other):
        if not isinstance(other, __HvyDate__):
            return NotImplemented
        return (self.year, self.month, self.day) < (other.year, other.month, other.day)

    def __le__(self, other):
        if not isinstance(other, __HvyDate__):
            return NotImplemented
        return self == other or self < other


class __HvyDateTime__(__HvyDate__):
    def __init__(self, year, month, day, hour=0, minute=0, second=0, microsecond=0, tzinfo=None, *, fold=0):
        super().__init__(year, month, day)
        if not all(isinstance(value, int) for value in (hour, minute, second, microsecond)):
            raise TypeError("datetime arguments must be integers")
        if hour < 0 or hour > 23:
            raise ValueError("hour must be in 0..23")
        if minute < 0 or minute > 59:
            raise ValueError("minute must be in 0..59")
        if second < 0 or second > 59:
            raise ValueError("second must be in 0..59")
        if microsecond < 0 or microsecond > 999999:
            raise ValueError("microsecond must be in 0..999999")
        if fold not in (0, 1):
            raise ValueError("fold must be either 0 or 1")
        __hvy_require_tzinfo__(tzinfo)
        self.hour = hour
        self.minute = minute
        self.second = second
        self.microsecond = microsecond
        self.tzinfo = tzinfo
        self.fold = fold

    def _naive_us(self):
        return ((self._ordinal_value() - 1) * 86400 + self.hour * 3600 + self.minute * 60 + self.second) * 1000000 + self.microsecond

    def _ordinal_value(self):
        return __hvy_date_to_ordinal__(self.year, self.month, self.day)

    def _offset_us(self):
        offset = self.utcoffset()
        return None if offset is None else offset._total_microseconds_value()

    def date(self):
        return __HvyDate__(self.year, self.month, self.day)

    def utcoffset(self):
        if self.tzinfo is None:
            return None
        return __hvy_checked_offset__(self.tzinfo.utcoffset(self), "utcoffset")

    def dst(self):
        if self.tzinfo is None:
            return None
        return __hvy_checked_offset__(self.tzinfo.dst(self), "dst")

    def tzname(self):
        if self.tzinfo is None:
            return None
        name = self.tzinfo.tzname(self)
        if name is not None and not isinstance(name, str):
            raise TypeError("tzinfo.tzname() must return None or a string")
        return name

    def replace(self, year=None, month=None, day=None, hour=None, minute=None, second=None, microsecond=None, tzinfo=__hvy_keep__, *, fold=None):
        return __HvyDateTime__(
            self.year if year is None else year,
            self.month if month is None else month,
            self.day if day is None else day,
            self.hour if hour is None else hour,
            self.minute if minute is None else minute,
            self.second if second is None else second,
            self.microsecond if microsecond is None else microsecond,
            self.tzinfo if tzinfo is __hvy_keep__ else tzinfo,
            fold=self.fold if fold is None else fold,
        )

    def astimezone(self, tz=None):
        if tz is not None:
            __hvy_require_tzinfo__(tz)
            if self.tzinfo is tz:
                return self
        instant = __hvy_instant_us__(self)
        if tz is None:
            tz = __hvy_local_fixed_timezone__(instant)
        return tz.fromutc(__hvy_datetime_from_naive_us__(instant, tz))

    def timestamp(self):
        return (__hvy_instant_us__(self) - __hvy_epoch_naive_us__) / __hvy_us_per_second__

    def isoformat(self, sep="T", timespec="auto"):
        if timespec not in ("auto", "hours", "minutes", "seconds", "milliseconds", "microseconds"):
            raise ValueError("unsupported timespec")
        output = f"{self.year:04d}-{self.month:02d}-{self.day:02d}{sep}{self.hour:02d}"
        if timespec != "hours":
            output += f":{self.minute:02d}"
        include_seconds = timespec in ("auto", "seconds", "milliseconds", "microseconds")
        if include_seconds:
            output += f":{self.second:02d}"
        if timespec == "milliseconds":
            output += f".{self.microsecond // 1000:03d}"
        elif timespec == "microseconds" or (timespec == "auto" and self.microsecond):
            output += f".{self.microsecond:06d}"
        offset = self._offset_us()
        if offset is not None:
            output += __hvy_format_utc_offset__(offset, ":")
        return output

    def __str__(self):
        return self.isoformat(" ")

    def __repr__(self):
        values = [self.year, self.month, self.day, self.hour, self.minute]
        if self.second or self.microsecond:
            values.append(self.second)
        if self.microsecond:
            values.append(self.microsecond)
        parts = [str(value) for value in values]
        if self.fold:
            parts.append("fold=1")
        if self.tzinfo is not None:
            parts.append("tzinfo=" + repr(self.tzinfo))
        return "datetime.datetime(" + ", ".join(parts) + ")"

    def __add__(self, other):
        if not isinstance(other, __HvyTimedelta__):
            return NotImplemented
        return __hvy_datetime_from_naive_us__(self._naive_us() + other._total_microseconds_value(), self.tzinfo)

    def __radd__(self, other):
        return self.__add__(other)

    def __sub__(self, other):
        if isinstance(other, __HvyTimedelta__):
            return self + (-other)
        if isinstance(other, __HvyDateTime__):
            left, right = __hvy_datetime_comparison_keys__(self, other, "subtract")
            return __HvyTimedelta__(microseconds=left - right)
        return NotImplemented

    def __hash__(self):
        offset = self.replace(fold=0)._offset_us()
        return hash(self._naive_us() - (offset or 0))

    def __eq__(self, other):
        if not isinstance(other, __HvyDateTime__):
            return False
        if self.tzinfo is not other.tzinfo and (self._offset_us() is None) != (other._offset_us() is None):
            return False
        left, right = __hvy_datetime_comparison_keys__(self, other, "compare")
        return left == right

    def __lt__(self, other):
        if not isinstance(other, __HvyDateTime__):
            return NotImplemented
        left, right = __hvy_datetime_comparison_keys__(self, other, "compare")
        return left < right

    def __le__(self, other):
        if not isinstance(other, __HvyDateTime__):
            return NotImplemented
        left, right = __hvy_datetime_comparison_keys__(self, other, "compare")
        return left <= right


def __hvy_datetime_from_naive_us__(total, tzinfo=None, fold=0):
    ordinal_minus_one, remainder = divmod(total, __hvy_us_per_day__)
    year, month, day = __hvy_ordinal_to_date__(ordinal_minus_one + 1)
    hour, remainder = divmod(remainder, 3600000000)
    minute, remainder = divmod(remainder, 60000000)
    second, microsecond = divmod(remainder, 1000000)
    return __HvyDateTime__(year, month, day, hour, minute, second, microsecond, tzinfo, fold=fold)


# Values sharing one tzinfo object compare by wall clock, as in CPython;
# otherwise aware values compare by their UTC instant.
def __hvy_datetime_comparison_keys__(left, right, action):
    if left.tzinfo is right.tzinfo:
        return left._naive_us(), right._naive_us()
    left_offset = left._offset_us()
    right_offset = right._offset_us()
    if (left_offset is None) != (right_offset is None):
        raise TypeError("can't " + action + " offset-naive and offset-aware datetimes")
    if left_offset is None:
        return left._naive_us(), right._naive_us()
    return left._naive_us() - left_offset, right._naive_us() - right_offset


# UTC instant (as naive microseconds) of an aware value, or of a naive value
# interpreted as the viewer's local time.
def __hvy_instant_us__(value):
    offset = value._offset_us()
    if offset is None:
        offset = __hvy_local_zoneinfo__().utcoffset(value)._total_microseconds_value()
    return value._naive_us() - offset


def __hvy_datetime_from_epoch_us__(epoch_us, tz=None):
    utc_us = __hvy_epoch_naive_us__ + epoch_us
    if tz is None:
        local_zone = __hvy_local_zoneinfo__()
        return local_zone.fromutc(__hvy_datetime_from_naive_us__(utc_us, local_zone)).replace(tzinfo=None)
    __hvy_require_tzinfo__(tz)
    return tz.fromutc(__hvy_datetime_from_naive_us__(utc_us, tz))


def __hvy_epoch_us_from_seconds__(timestamp):
    if not isinstance(timestamp, (int, float)):
        raise TypeError("timestamp must be a number")
    return int(round(timestamp * __hvy_us_per_second__))


def __hvy_now_epoch_us__():
    return int(__hvy_runtime__.clock.now_ms()) * 1000


class __HvyDateFacade__:
    def __call__(self, year, month, day):
        return __HvyDate__(year, month, day)

    def __instancecheck__(self, value):
        return isinstance(value, __HvyDate__)

    def today(self):
        return __hvy_datetime_from_epoch_us__(__hvy_now_epoch_us__()).date()

    def fromtimestamp(self, timestamp):
        return __hvy_datetime_from_epoch_us__(__hvy_epoch_us_from_seconds__(timestamp)).date()

    def fromordinal(self, ordinal):
        year, month, day = __hvy_ordinal_to_date__(ordinal)
        return __HvyDate__(year, month, day)

    def fromisoformat(self, value):
        return __hvy_parse_iso_date__(str(value))


class __HvyDateTimeFacade__:
    def __call__(self, year, month, day, hour=0, minute=0, second=0, microsecond=0, tzinfo=None, *, fold=0):
        return __HvyDateTime__(year, month, day, hour, minute, second, microsecond, tzinfo, fold=fold)

    def __instancecheck__(self, value):
        return isinstance(value, __HvyDateTime__)

    def now(self, tz=None):
        return __hvy_datetime_from_epoch_us__(__hvy_now_epoch_us__(), tz)

    def today(self):
        return self.now()

    def utcnow(self):
        return __hvy_datetime_from_naive_us__(__hvy_epoch_naive_us__ + __hvy_now_epoch_us__())

    def fromtimestamp(self, timestamp, tz=None):
        return __hvy_datetime_from_epoch_us__(__hvy_epoch_us_from_seconds__(timestamp), tz)

    def utcfromtimestamp(self, timestamp):
        return __hvy_datetime_from_naive_us__(__hvy_epoch_naive_us__ + __hvy_epoch_us_from_seconds__(timestamp))

    def fromisoformat(self, value):
        return __hvy_parse_iso_datetime__(str(value))

    def strptime(self, value, format):
        return __hvy_strptime__(str(value), str(format))


class __HvyTimedeltaFacade__:
    def __call__(self, days=0, seconds=0, microseconds=0, milliseconds=0, minutes=0, hours=0, weeks=0):
        return __HvyTimedelta__(days, seconds, microseconds, milliseconds, minutes, hours, weeks)

    def __instancecheck__(self, value):
        return isinstance(value, __HvyTimedelta__)
