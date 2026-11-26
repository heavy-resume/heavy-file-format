import { expect, test, type Page } from '@playwright/test';

const SCRIPTING_IDLE_TIMEOUT_MS = 1_000;

test.use({ timezoneId: 'America/Los_Angeles' });

async function runScript(page: Page, id: string, libraries: string[], source: string): Promise<void> {
  await page.clock.setFixedTime(new Date('2026-10-16T22:00:00Z'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"${id}"}-->
#! Time Zones

<!--hvy:plugin {"id":"${id}-check","editorOnly":true,"plugin":"hvy.scripting","pluginConfig":{"version":"0.1","libraries":${JSON.stringify(libraries)}}}-->
${source.trim()}
`);
  await page.getByRole('button', { name: 'Apply' }).click();
}

async function readDocumentMeta(page: Page, key: string): Promise<unknown> {
  return page.evaluate(async (metaKey) => {
    const { state } = await import(/* @vite-ignore */ '/src/state.ts');
    return state.document.meta[metaKey];
  }, key);
}

async function waitForDocumentMetaLines(page: Page, key: string, expectedLines: string[]): Promise<void> {
  await expect.poll(async () => String(await readDocumentMeta(page, key) ?? '').split('\n'), { timeout: SCRIPTING_IDLE_TIMEOUT_MS }).toEqual(expectedLines);
}

test('checked datetime converts stored timestamps into the viewer local zone', async ({ page }) => {
  await runScript(page, 'local-zone', ['datetime', 'zoneinfo', 'tzlocal'], `
from datetime import datetime, date, timezone
from tzlocal import get_localzone, get_localzone_name

stamp = datetime.fromisoformat("2026-10-16T22:00:00Z")
winter = datetime.fromisoformat("2026-01-16T22:00:00+00:00")
lines = [
    get_localzone_name(),
    repr(get_localzone()),
    stamp.astimezone().strftime("%Y-%m-%d %H:%M %Z %z"),
    repr(stamp.astimezone().tzinfo),
    winter.astimezone(get_localzone()).strftime("%Y-%m-%d %H:%M %Z %:z"),
    str(datetime.now()),
    str(datetime.now(timezone.utc)),
    datetime.now(get_localzone()).isoformat(),
    date.today().isoformat(),
    str(stamp.timestamp()),
]
doc.header.set("local_zone_result", "\\n".join(lines))
`);

  await waitForDocumentMetaLines(page, 'local_zone_result', [
    'America/Los_Angeles',
    "zoneinfo.ZoneInfo(key='America/Los_Angeles')",
    '2026-10-16 15:00 PDT -0700',
    "datetime.timezone(datetime.timedelta(days=-1, seconds=61200), 'PDT')",
    '2026-01-16 14:00 PST -08:00',
    '2026-10-16 15:00:00',
    '2026-10-16 22:00:00+00:00',
    '2026-10-16T15:00:00-07:00',
    '2026-10-16',
    '1792188000.0',
  ]);
});

test('checked datetime parses and formats offsets, abbreviations and IANA zone names', async ({ page }) => {
  await runScript(page, 'zone-parsing', ['datetime', 'zoneinfo'], `
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

stamp = datetime.fromisoformat("2026-10-16T22:00:00Z")
lines = [
    repr(datetime.strptime("2026-10-16 15:00 -0700", "%Y-%m-%d %H:%M %z")),
    datetime.strptime("Oct 16 2026 3:00 PM PDT", "%b %d %Y %I:%M %p %Z").astimezone(timezone.utc).isoformat(),
    repr(datetime.strptime("2026-10-16 18:00 America/New_York", "%Y-%m-%d %H:%M %Z")),
    datetime.fromisoformat("2026-10-17T03:30:00+05:30").astimezone(timezone.utc).isoformat(),
    stamp.astimezone(ZoneInfo("Europe/Berlin")).strftime("%a %d %B %Y %H:%M %Z"),
    stamp.astimezone(ZoneInfo("Asia/Tokyo")).strftime("%I:%M %p %Z"),
    stamp.astimezone(ZoneInfo("Asia/Kolkata")).isoformat(),
    str(timezone(timedelta(hours=5, minutes=30))),
    repr(timezone(timedelta(0))),
]
doc.header.set("zone_parsing_result", "\\n".join(lines))
`);

  await waitForDocumentMetaLines(page, 'zone_parsing_result', [
    'datetime.datetime(2026, 10, 16, 15, 0, tzinfo=datetime.timezone(datetime.timedelta(days=-1, seconds=61200)))',
    '2026-10-16T22:00:00+00:00',
    "datetime.datetime(2026, 10, 16, 18, 0, tzinfo=zoneinfo.ZoneInfo(key='America/New_York'))",
    '2026-10-16T22:00:00+00:00',
    'Sat 17 October 2026 00:00 CEST',
    '07:00 AM +09',
    '2026-10-17T03:30:00+05:30',
    'UTC+05:30',
    'datetime.timezone.utc',
  ]);
});

test('checked zoneinfo resolves repeated and skipped local times with fold', async ({ page }) => {
  await runScript(page, 'zone-fold', ['datetime', 'zoneinfo'], `
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

pacific = ZoneInfo("America/Los_Angeles")
lines = [
    datetime(2026, 11, 1, 1, 30, tzinfo=pacific).isoformat(),
    datetime(2026, 11, 1, 1, 30, fold=1, tzinfo=pacific).isoformat(),
    datetime(2026, 3, 8, 2, 30, tzinfo=pacific).astimezone(timezone.utc).isoformat(),
    str(datetime(2026, 11, 1, 9, 30, tzinfo=timezone.utc).astimezone(pacific).fold),
    str(datetime(2026, 7, 1, tzinfo=pacific).dst()),
    str(datetime(2026, 1, 1, tzinfo=pacific).dst()),
    str(datetime(2026, 10, 17, tzinfo=timezone.utc) - datetime(2026, 10, 16, 15, tzinfo=pacific)),
    str(datetime(2026, 10, 16, 15, tzinfo=pacific) == datetime.fromisoformat("2026-10-16T22:00:00Z")),
]
doc.header.set("zone_fold_result", "\\n".join(lines))
`);

  await waitForDocumentMetaLines(page, 'zone_fold_result', [
    '2026-11-01T01:30:00-07:00',
    '2026-11-01T01:30:00-08:00',
    '2026-03-08T10:30:00+00:00',
    '1',
    '1:00:00',
    '0:00:00',
    '2:00:00',
    'True',
  ]);
});

test('checked zoneinfo reports unknown zones and naive / aware mixing like CPython', async ({ page }) => {
  await runScript(page, 'zone-errors', ['datetime', 'zoneinfo', 'tzlocal'], `
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
import tzlocal

results = []

def record(label, action):
    try:
        action()
        results.append(label + ":allowed")
    except ZoneInfoNotFoundError:
        results.append(label + ":ZoneInfoNotFoundError")
    except TypeError:
        results.append(label + ":TypeError")
    except BaseException:
        results.append(label + ":blocked")

record("unknown_zone", lambda: ZoneInfo("Fake/Zone"))
record("mixed_compare", lambda: datetime(2026, 1, 1) < datetime(2026, 1, 1, tzinfo=timezone.utc))
record("mixed_subtract", lambda: datetime(2026, 1, 1) - datetime(2026, 1, 1, tzinfo=timezone.utc))
record("bad_tzinfo", lambda: datetime(2026, 1, 1, tzinfo="UTC"))
record("zone_globals", lambda: getattr(tzlocal.get_localzone, "_" * 2 + "globals" + "_" * 2))
record("zone_window", lambda: ZoneInfo("UTC").window)
results.append("mixed_equal:" + str(datetime(2026, 1, 1) == datetime(2026, 1, 1, tzinfo=timezone.utc)))
doc.header.set("zone_error_result", ",".join(results))
`);

  await waitForDocumentMetaLines(page, 'zone_error_result', [
    'unknown_zone:ZoneInfoNotFoundError,mixed_compare:TypeError,mixed_subtract:TypeError,bad_tzinfo:TypeError,zone_globals:blocked,zone_window:blocked,mixed_equal:False',
  ]);
});

test('meeting minutes template stamps entries in the viewer zone with a datetime sort key', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-16T22:00:00Z'));
  await page.goto('/');
  await page.evaluate(async () => {
    document.body.innerHTML = '<div id="meetingMount"></div>';
    const { deserializeDocumentBytes, mountHvy, plugins } = await import(/* @vite-ignore */ '/src/embed-full.ts');
    const response = await fetch('/examples/meeting-minutes.thvy');
    const root = document.querySelector<HTMLElement>('#meetingMount');
    if (!root) throw new Error('Meeting mount missing.');
    const mount = mountHvy({
      root,
      document: deserializeDocumentBytes(new Uint8Array(await response.arrayBuffer()), '.thvy'),
      mode: 'viewer',
      plugins: [plugins.form],
    });
    (window as Window & { meetingMount?: typeof mount }).meetingMount = mount;
  });

  await page.getByRole('textbox', { name: 'Note' }).fill('Fake agenda minute');
  await page.getByRole('button', { name: 'Add minute' }).click();

  await expect(page.getByText('October 16, 2026 at 15:00 PDT', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const mount = (window as Window & { meetingMount?: { getDocument(): { sections: Array<{ blocks: unknown[] }> } } }).meetingMount;
    const entries: Array<{ schema: { id?: string; sortKeys?: Record<string, unknown> } }> = [];
    const visit = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      const block = value as { schema?: { id?: string; sortKeys?: Record<string, unknown> } };
      if (block.schema?.id?.startsWith('minute-entry-')) entries.push(block as { schema: { id?: string; sortKeys?: Record<string, unknown> } });
      Object.values(value).forEach(visit);
    };
    mount?.getDocument().sections.forEach(visit);
    return entries.map((entry) => ({ id: entry.schema.id, sortKeys: entry.schema.sortKeys }));
  })).toEqual([{ id: 'minute-entry-1792188000000', sortKeys: { Time: '2026-10-16T22:00:00.000Z' } }]);
});
