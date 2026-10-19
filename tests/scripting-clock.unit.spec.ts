import { expect, test } from 'vitest';
import { createScriptingClock } from '../src/plugins/scripting/clock-bridge';
import { buildPythonProgram } from '../src/plugins/scripting/python-program';
import { createScriptingRuntime } from '../src/plugins/scripting/runtime';

test('createScriptingClock reports the configured zone and per-instant offsets', () => {
  const clock = createScriptingClock({ now: () => new Date('2026-10-16T22:00:00Z'), timeZone: 'America/Los_Angeles' });

  expect(clock.now_ms()).toBe(Date.parse('2026-10-16T22:00:00Z'));
  expect(clock.local_zone()).toBe('America/Los_Angeles');
  expect(clock.offset_ms(Date.parse('2026-10-16T22:00:00Z'), 'America/Los_Angeles')).toBe(-7 * 3_600_000);
  expect(clock.offset_ms(Date.parse('2026-01-16T22:00:00Z'), 'America/Los_Angeles')).toBe(-8 * 3_600_000);
  expect(clock.abbreviation(Date.parse('2026-01-16T22:00:00Z'), 'America/Los_Angeles')).toBe('PST');
  expect(clock.abbreviation_offset_ms('PDT', 2026, 10, 16, 15, 0, 0)).toBe(-7 * 3_600_000);
  expect(clock.abbreviation_offset_ms('FAKEZ', 2026, 10, 16, 15, 0, 0)).toBeNull();
  expect(clock.is_zone('Asia/Tokyo')).toBe(true);
  expect(clock.is_zone('Fake/Zone')).toBe(false);
});

test('deprecated doc.time helpers read the runtime clock zone', () => {
  const runtime = createScriptingRuntime({
    document: { meta: {}, extension: '.hvy', sections: [], attachments: [] },
    now: () => new Date('2026-10-16T22:00:00Z'),
    timeZone: 'Asia/Tokyo',
  });

  expect(runtime.doc.time.now_iso()).toBe('2026-10-16T22:00:00.000Z');
  expect(runtime.doc.time.now_unix_ms()).toBe(Date.parse('2026-10-16T22:00:00Z'));
  expect(runtime.doc.time.today_iso()).toBe('2026-10-17');
  expect(runtime.doc.time.now_local()).toBe(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date('2026-10-16T22:00:00Z')));
});

test('buildPythonProgram compiles checked library files only for enabled libraries', () => {
  const withoutLibraries = buildPythonProgram('r1', 'no-library-script');
  expect(withoutLibraries).not.toContain('class __HvyDatetimeModule__');
  expect(withoutLibraries).not.toContain('class __HvyRandomModule__');
  expect(withoutLibraries).not.toContain('class __HvyReModule__');

  const withTzlocal = buildPythonProgram('r2', 'tzlocal-script', {}, ['tzlocal']);
  expect(withTzlocal).toContain('class __HvyTzlocalModule__');
  expect(withTzlocal.split('class __HvyDateTime__(').length - 1).toBe(1);
  expect(withTzlocal).not.toContain('class __HvyRandomModule__');

  const withAllDateTimeLibraries = buildPythonProgram('r3', 'datetime-script', {}, ['datetime', 'zoneinfo', 'tzlocal']);
  expect(withAllDateTimeLibraries.split('class __HvyZoneInfo__(').length - 1).toBe(1);
});
