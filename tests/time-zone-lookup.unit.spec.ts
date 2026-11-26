import { expect, test } from 'vitest';
import { coerceSortValue } from '../src/sort-values';
import {
  getTimeZoneAbbreviation,
  getTimeZoneOffsetMs,
  resolveTimezoneAbbreviationOffset,
} from '../src/time-zone-lookup';

test('getTimeZoneOffsetMs ignores the millisecond part of the instant', () => {
  expect(getTimeZoneOffsetMs(new Date('2026-10-16T22:00:00.500Z'), 'America/Los_Angeles')).toBe(-7 * 3_600_000);
  expect(getTimeZoneOffsetMs(new Date('2026-01-16T22:00:00.999Z'), 'America/Los_Angeles')).toBe(-8 * 3_600_000);
});

test('datetime sort values keep milliseconds when converting an IANA wall-clock time', () => {
  expect(coerceSortValue('2026-10-16T15:00:00.500 America/Los_Angeles', { type: 'datetime' })).toBe('2026-10-16T22:00:00.500Z');
});

test('datetime sort values accept the tz database labels that scripts format with %Z', () => {
  expect(coerceSortValue('October 17, 2026 at 07:00 +09', { type: 'datetime' })).toBe('2026-10-16T22:00:00.000Z');
  expect(coerceSortValue('October 17, 2026 at 03:30 +0530', { type: 'datetime' })).toBe('2026-10-16T22:00:00.000Z');
});

test('getTimeZoneAbbreviation prefers letter abbreviations and falls back to tz database offsets', () => {
  expect(getTimeZoneAbbreviation(new Date('2026-10-16T22:00:00Z'), 'America/Los_Angeles')).toBe('PDT');
  expect(getTimeZoneAbbreviation(new Date('2026-01-16T22:00:00Z'), 'America/Los_Angeles')).toBe('PST');
  expect(getTimeZoneAbbreviation(new Date('2026-10-16T22:00:00Z'), 'Europe/Berlin')).toBe('CEST');
  expect(getTimeZoneAbbreviation(new Date('2026-01-16T22:00:00Z'), 'Europe/London')).toBe('GMT');
  expect(getTimeZoneAbbreviation(new Date('2026-10-16T22:00:00Z'), 'Asia/Tokyo')).toBe('+09');
  expect(getTimeZoneAbbreviation(new Date('2026-10-16T22:00:00Z'), 'Asia/Kolkata')).toBe('+0530');
  expect(getTimeZoneAbbreviation(new Date('2026-10-16T22:00:00Z'), 'UTC')).toBe('UTC');
});

test('resolveTimezoneAbbreviationOffset uses known abbreviations without wall-clock fields', () => {
  expect(resolveTimezoneAbbreviationOffset('PDT', null)).toBe('-07:00');
  expect(resolveTimezoneAbbreviationOffset('FAKEZ', null)).toBeNull();
});
