# Checked `datetime` library: date, datetime and timedelta implemented in Python.

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

    def weekday(self):
        return (self.__ordinal() - 1) % 7

    def isocalendar(self):
        ordinal = self.__ordinal()
        thursday = ordinal + (3 - self.weekday())
        iso_year = __hvy_ordinal_to_date__(thursday)[0]
        first_thursday = __hvy_date_to_ordinal__(iso_year, 1, 4)
        first_thursday += 3 - ((first_thursday - 1) % 7)
        return iso_year, (thursday - first_thursday) // 7 + 1, self.weekday() + 1

    def isoformat(self):
        return f"{self.year:04d}-{self.month:02d}-{self.day:02d}"

    def __str__(self):
        return self.isoformat()

    def __repr__(self):
        return f"datetime.date({self.year}, {self.month}, {self.day})"

    def strftime(self, format):
        return __hvy_strftime__(self, str(format))

    def __add__(self, other):
        if isinstance(other, __HvyTimedelta__):
            year, month, day = __hvy_ordinal_to_date__(self.__ordinal() + other.days)
            return __HvyDate__(year, month, day)
        return NotImplemented

    def __sub__(self, other):
        if isinstance(other, __HvyTimedelta__):
            return self + (-other)
        if isinstance(other, __HvyDate__):
            return __HvyTimedelta__(days=self.__ordinal() - other.__ordinal())
        return NotImplemented

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
    def __init__(self, year, month, day, hour=0, minute=0, second=0, microsecond=0):
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
        self.hour = hour
        self.minute = minute
        self.second = second
        self.microsecond = microsecond

    def __total_microseconds(self):
        return ((self._ordinal_value() - 1) * 86400 + self.hour * 3600 + self.minute * 60 + self.second) * 1000000 + self.microsecond

    def _ordinal_value(self):
        return __hvy_date_to_ordinal__(self.year, self.month, self.day)

    @classmethod
    def fromisoformat(cls, value):
        source = str(value)
        if source.endswith("Z") or "+" in source[10:] or "-" in source[10:]:
            raise ValueError("timezone-aware datetimes are not supported")
        parts = source.replace("T", " ", 1).split(" ")
        date_parts = parts[0].split("-")
        if len(date_parts) != 3 or len(parts) > 2:
            raise ValueError("Invalid isoformat string")
        time_values = [0, 0, 0, 0]
        if len(parts) == 2 and parts[1] != "":
            time_source = parts[1]
            fraction = ""
            if "." in time_source:
                time_source, fraction = time_source.split(".", 1)
                if not fraction.isdigit() or len(fraction) > 6:
                    raise ValueError("Invalid isoformat string")
                time_values[3] = int((fraction + "000000")[:6])
            clock = time_source.split(":")
            if len(clock) < 2 or len(clock) > 3 or not all(item.isdigit() for item in clock):
                raise ValueError("Invalid isoformat string")
            for index, item in enumerate(clock):
                time_values[index] = int(item)
        if not all(item.isdigit() for item in date_parts):
            raise ValueError("Invalid isoformat string")
        return cls(int(date_parts[0]), int(date_parts[1]), int(date_parts[2]), *time_values)

    @classmethod
    def strptime(cls, value, format):
        source = str(value)
        template = str(format)
        fields = {"Y": 1900, "m": 1, "d": 1, "H": 0, "M": 0, "S": 0, "f": 0}
        widths = {"Y": 4, "m": 2, "d": 2, "H": 2, "M": 2, "S": 2}
        source_index = 0
        format_index = 0
        while format_index < len(template):
            if template[format_index] != "%":
                if source_index >= len(source) or source[source_index] != template[format_index]:
                    raise ValueError("time data does not match format")
                source_index += 1
                format_index += 1
                continue
            format_index += 1
            if format_index >= len(template):
                raise ValueError("stray % in format")
            directive = template[format_index]
            format_index += 1
            if directive == "%":
                if source_index >= len(source) or source[source_index] != "%":
                    raise ValueError("time data does not match format")
                source_index += 1
                continue
            if directive == "f":
                end = source_index
                while end < len(source) and end - source_index < 6 and source[end].isdigit():
                    end += 1
                token = source[source_index:end]
                if token == "":
                    raise ValueError("time data does not match format")
                fields[directive] = int((token + "000000")[:6])
                source_index = end
                continue
            if directive not in widths:
                raise ValueError("unsupported datetime format directive: %" + directive)
            width = widths[directive]
            token = source[source_index:source_index + width]
            if len(token) != width or not token.isdigit():
                raise ValueError("time data does not match format")
            fields[directive] = int(token)
            source_index += width
        if source_index != len(source):
            raise ValueError("unconverted data remains")
        return cls(fields["Y"], fields["m"], fields["d"], fields["H"], fields["M"], fields["S"], fields["f"])

    def date(self):
        return __HvyDate__(self.year, self.month, self.day)

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
        return output

    def __str__(self):
        return self.isoformat(" ")

    def __repr__(self):
        values = [self.year, self.month, self.day, self.hour, self.minute]
        if self.second or self.microsecond:
            values.append(self.second)
        if self.microsecond:
            values.append(self.microsecond)
        return "datetime.datetime(" + ", ".join(str(value) for value in values) + ")"

    def __add__(self, other):
        if not isinstance(other, __HvyTimedelta__):
            return NotImplemented
        total = self.__total_microseconds() + other._total_microseconds_value()
        ordinal_minus_one, remainder = divmod(total, 86400000000)
        year, month, day = __hvy_ordinal_to_date__(ordinal_minus_one + 1)
        hour, remainder = divmod(remainder, 3600000000)
        minute, remainder = divmod(remainder, 60000000)
        second, microsecond = divmod(remainder, 1000000)
        return __HvyDateTime__(year, month, day, hour, minute, second, microsecond)

    def __sub__(self, other):
        if isinstance(other, __HvyTimedelta__):
            return self + (-other)
        if isinstance(other, __HvyDateTime__):
            return __HvyTimedelta__(microseconds=self.__total_microseconds() - other.__total_microseconds())
        return NotImplemented

    def __eq__(self, other):
        return isinstance(other, __HvyDateTime__) and self.__total_microseconds() == other.__total_microseconds()

    def __lt__(self, other):
        if not isinstance(other, __HvyDateTime__):
            return NotImplemented
        return self.__total_microseconds() < other.__total_microseconds()

    def __le__(self, other):
        if not isinstance(other, __HvyDateTime__):
            return NotImplemented
        return self.__total_microseconds() <= other.__total_microseconds()


def __hvy_strftime__(value, format):
    iso_year, iso_week, iso_weekday = value.isocalendar()
    day_of_year = __hvy_date_to_ordinal__(value.year, value.month, value.day) - __hvy_date_to_ordinal__(value.year, 1, 1) + 1
    replacements = {
        "Y": f"{value.year:04d}", "y": f"{value.year % 100:02d}", "m": f"{value.month:02d}",
        "d": f"{value.day:02d}", "j": f"{day_of_year:03d}", "w": str((value.weekday() + 1) % 7),
        "u": str(value.weekday() + 1), "V": f"{iso_week:02d}", "G": f"{iso_year:04d}", "g": f"{iso_year % 100:02d}",
        "H": f"{getattr(value, 'hour', 0):02d}", "M": f"{getattr(value, 'minute', 0):02d}",
        "S": f"{getattr(value, 'second', 0):02d}", "f": f"{getattr(value, 'microsecond', 0):06d}", "%": "%",
    }
    output = ""
    index = 0
    while index < len(format):
        if format[index] != "%":
            output += format[index]
            index += 1
            continue
        index += 1
        if index >= len(format) or format[index] not in replacements:
            raise ValueError("unsupported datetime format directive")
        output += replacements[format[index]]
        index += 1
    return output


class __HvyDateTimeFacade__:
    def __call__(self, year, month, day, hour=0, minute=0, second=0, microsecond=0):
        return __HvyDateTime__(year, month, day, hour, minute, second, microsecond)

    def fromisoformat(self, value):
        return __HvyDateTime__.fromisoformat(value)

    def strptime(self, value, format):
        return __HvyDateTime__.strptime(value, format)


class __HvyTimedeltaFacade__:
    def __call__(self, days=0, seconds=0, microseconds=0, milliseconds=0, minutes=0, hours=0, weeks=0):
        return __HvyTimedelta__(days, seconds, microseconds, milliseconds, minutes, hours, weeks)


class __HvyDatetimeModule__:
    datetime = __HvyDateTimeFacade__()
    timedelta = __HvyTimedeltaFacade__()
