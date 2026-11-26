// Browser Intl time zone lookups shared by datetime sort values and the
// scripting clock. Offsets are always resolved for a specific instant so
// daylight-saving transitions are honored.

export interface WallClockFields {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

const TIMEZONE_ABBREVIATION_OFFSETS: Record<string, string> = {
  UTC: '+00:00',
  GMT: '+00:00',
  EST: '-05:00',
  EDT: '-04:00',
  CST: '-06:00',
  CDT: '-05:00',
  MST: '-07:00',
  MDT: '-06:00',
  PST: '-08:00',
  PDT: '-07:00',
  AKST: '-09:00',
  AKDT: '-08:00',
  HST: '-10:00',
  CET: '+01:00',
  CEST: '+02:00',
  EET: '+02:00',
  EEST: '+03:00',
  WET: '+00:00',
  WEST: '+01:00',
  JST: '+09:00',
  KST: '+09:00',
  HKT: '+08:00',
  SGT: '+08:00',
  PHT: '+08:00',
  ICT: '+07:00',
  WIB: '+07:00',
  WITA: '+08:00',
  WIT: '+09:00',
  PKT: '+05:00',
  NPT: '+05:45',
  AEST: '+10:00',
  AEDT: '+11:00',
  ACST: '+09:30',
  ACDT: '+10:30',
  AWST: '+08:00',
  NZST: '+12:00',
  NZDT: '+13:00',
  MSK: '+03:00',
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getCachedFormatter(key: string, create: () => Intl.DateTimeFormat): Intl.DateTimeFormat {
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = create();
    formatterCache.set(key, formatter);
  }
  return formatter;
}

export function getLocalTimeZone(): string {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function getSupportedIanaTimeZones(): string[] {
  try {
    return typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  } catch {
    return [];
  }
}

export function isSupportedIanaTimeZone(timeZone: string): boolean {
  if (!timeZone) {
    return false;
  }
  try {
    getCachedFormatter(`offset|${timeZone}`, () => createOffsetFormatter(timeZone));
    return true;
  } catch {
    return false;
  }
}

function createOffsetFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
}

export function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = getCachedFormatter(`offset|${timeZone}`, () => createOffsetFormatter(timeZone)).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const zonedAsUtcMs = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );
  // Intl only reports whole seconds, so compare against the instant truncated
  // to its second rather than leaking the millisecond part into the offset.
  return zonedAsUtcMs - Math.floor(date.getTime() / 1000) * 1000;
}

export function getShortTimezoneName(date: Date, timeZone: string, locale = 'en-US'): string {
  return getCachedFormatter(`short|${locale}|${timeZone}`, () => new Intl.DateTimeFormat(locale, {
    timeZone,
    timeZoneName: 'short',
  })).formatToParts(date).find((part) => part.type === 'timeZoneName')?.value ?? '';
}

// Abbreviation in the style of the IANA tz database: a letter abbreviation
// when Intl knows one (en-US covers the Americas, en-GB covers Europe), and a
// numeric "+03" / "+0530" label otherwise.
export function getTimeZoneAbbreviation(date: Date, timeZone: string): string {
  const offsetMs = getTimeZoneOffsetMs(date, timeZone);
  for (const locale of ['en-US', 'en-GB']) {
    const name = getShortTimezoneName(date, timeZone, locale);
    if (name && !/^(?:GMT|UTC)[+-]/.test(name) && (offsetMs === 0 || !/^(?:GMT|UTC)$/.test(name))) {
      return name;
    }
  }
  if (offsetMs === 0) {
    return 'UTC';
  }
  const offset = formatOffsetMs(offsetMs).replace(':', '');
  return offset.endsWith('00') ? offset.slice(0, 3) : offset;
}

export function formatOffsetMs(offsetMs: number): string {
  const sign = offsetMs < 0 ? '-' : '+';
  const absMinutes = Math.abs(Math.trunc(offsetMs / 60_000));
  const hours = String(Math.trunc(absMinutes / 60)).padStart(2, '0');
  const minutes = String(absMinutes % 60).padStart(2, '0');
  return `${sign}${hours}:${minutes}`;
}

export function parseOffsetMs(offset: string): number | null {
  const match = offset.match(/^([+-])(\d{2}):?(\d{2})$/);
  if (!match) {
    return null;
  }
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return (match[1] === '-' ? -1 : 1) * minutes * 60_000;
}

export function wallClockFieldsToUtcMs(fields: WallClockFields, timeZone: string): number {
  const wallClockUtcMs = Date.UTC(
    fields.year,
    fields.month - 1,
    fields.day,
    fields.hour,
    fields.minute,
    fields.second,
    fields.millisecond
  );
  let utcMs = wallClockUtcMs;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offsetMs = getTimeZoneOffsetMs(new Date(utcMs), timeZone);
    const nextUtcMs = wallClockUtcMs - offsetMs;
    if (nextUtcMs === utcMs) {
      break;
    }
    utcMs = nextUtcMs;
  }
  return utcMs;
}

const abbreviationOffsetCache = new Map<string, string | null>();

// Resolves a short time zone abbreviation such as PDT to a "+HH:MM" offset.
// Well-known abbreviations come from a fixed table; others are resolved when
// exactly one UTC offset uses that abbreviation at the given wall-clock time.
export function resolveTimezoneAbbreviationOffset(abbreviation: string, fields: WallClockFields | null): string | null {
  const known = TIMEZONE_ABBREVIATION_OFFSETS[abbreviation];
  if (known) {
    return known;
  }
  const zones = getSupportedIanaTimeZones();
  if (!fields || zones.length === 0) {
    return null;
  }
  const cacheKey = `${abbreviation}|${fields.year}-${fields.month}-${fields.day}T${fields.hour}:${fields.minute}:${fields.second}`;
  if (abbreviationOffsetCache.has(cacheKey)) {
    return abbreviationOffsetCache.get(cacheKey) ?? null;
  }
  const offsets = new Set<string>();
  for (const zone of zones) {
    const utcMs = wallClockFieldsToUtcMs(fields, zone);
    const label = getShortTimezoneName(new Date(utcMs), zone);
    if (label === abbreviation) {
      offsets.add(formatOffsetMs(getTimeZoneOffsetMs(new Date(utcMs), zone)));
    }
  }
  const resolved = offsets.size === 1 ? [...offsets][0] ?? null : null;
  abbreviationOffsetCache.set(cacheKey, resolved);
  return resolved;
}
