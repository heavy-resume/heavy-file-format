// JavaScript side of the checked `datetime`, `zoneinfo` and `tzlocal`
// libraries (python/timezone-shim.py). Scripts reach it only through the
// internal runtime, never through `doc`.
import {
  getLocalTimeZone,
  getSupportedIanaTimeZones,
  getTimeZoneAbbreviation,
  getTimeZoneOffsetMs,
  isSupportedIanaTimeZone,
  parseOffsetMs,
  resolveTimezoneAbbreviationOffset,
} from '../../time-zone-lookup';

export interface ScriptingClockZoneList {
  count(): number;
  valueAt(index: number): string;
}

export interface ScriptingClock {
  now_ms(): number;
  local_zone(): string;
  is_zone(name: string): boolean;
  zones(): ScriptingClockZoneList;
  offset_ms(utcMs: number, zone: string): number;
  abbreviation(utcMs: number, zone: string): string;
  /** Offset for a short abbreviation such as PDT at the given wall-clock time, or null when unknown or ambiguous. */
  abbreviation_offset_ms(abbreviation: string, year: number, month: number, day: number, hour: number, minute: number, second: number): number | null;
}

export interface ScriptingClockOptions {
  now?: () => Date;
  /** IANA zone treated as the viewer's local zone. Defaults to the browser zone. */
  timeZone?: string;
}

export function createScriptingClock(options: ScriptingClockOptions = {}): ScriptingClock {
  const now = options.now ?? (() => new Date());
  const localZone = options.timeZone ?? getLocalTimeZone();
  return {
    now_ms: () => now().getTime(),
    local_zone: () => localZone,
    is_zone: (name) => isSupportedIanaTimeZone(String(name)),
    zones: () => {
      const zones = getSupportedIanaTimeZones();
      return { count: () => zones.length, valueAt: (index) => zones[Math.trunc(index)] ?? '' };
    },
    offset_ms: (utcMs, zone) => getTimeZoneOffsetMs(new Date(Number(utcMs)), String(zone)),
    abbreviation: (utcMs, zone) => getTimeZoneAbbreviation(new Date(Number(utcMs)), String(zone)),
    abbreviation_offset_ms: (abbreviation, year, month, day, hour, minute, second) => {
      const offset = resolveTimezoneAbbreviationOffset(String(abbreviation), {
        year: Number(year),
        month: Number(month),
        day: Number(day),
        hour: Number(hour),
        minute: Number(minute),
        second: Number(second),
        millisecond: 0,
      });
      return offset ? parseOffsetMs(offset) : null;
    },
  };
}
