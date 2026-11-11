// Builds the undo-history performance document: a component list whose items each own
// a form with its own submit script that updates the attached database, plus a seeded
// SQLite tail (HVY-SPEC §7.6) so undo checkpoints carry a realistically sized database.
//
// The browser harness builds it in memory (see history-performance-harness.mjs). To
// write a copy for opening by hand, run:
//   node scripts/history-performance-document.mjs [output.hvy]
// HVY_HISTORY_PERF_ITEMS and HVY_HISTORY_PERF_SEED_ROWS override the defaults.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { gzipSync } from 'fflate';

export const DEFAULT_ITEM_COUNT = 50;
export const DEFAULT_SEED_ROWS = 4000;
// The harness reads this column to know when a step has rendered.
export const TOTAL_CLICKS_LABEL = 'Fake total clicks';

export function getHistoryPerformanceOptions() {
  return {
    itemCount: readPositiveIntegerEnv('HVY_HISTORY_PERF_ITEMS', DEFAULT_ITEM_COUNT),
    seedRows: readPositiveIntegerEnv('HVY_HISTORY_PERF_SEED_ROWS', DEFAULT_SEED_ROWS),
  };
}

export function getFakeItemName(index) {
  return `fake-item-${String(index + 1).padStart(2, '0')}`;
}

export function getFakeItemSubmitLabel(index) {
  return `Run ${getFakeItemName(index)}`;
}

export async function buildHistoryPerformanceDocument({ itemCount, seedRows }) {
  const text = buildDocumentText(itemCount);
  const database = gzipSync(await buildSeedDatabase(itemCount, seedRows));
  const tailDirective = JSON.stringify({
    id: 'db',
    plugin: 'hvy.db-table',
    mediaType: 'application/vnd.sqlite3',
    encoding: 'gzip',
    length: database.length,
  });
  const head = new TextEncoder().encode(`${text}\n<!--hvy:tail ${tailDirective}-->\n--HVY-TAIL--\n`);
  const bytes = new Uint8Array(head.length + database.length);
  bytes.set(head, 0);
  bytes.set(database, head.length);
  return { bytes, textChars: text.length, databaseBytes: database.length };
}

function buildDocumentText(itemCount) {
  const items = Array.from({ length: itemCount }, (_, index) => buildItem(index)).join('\n');
  return `---
hvy_version: 0.1
title: Fake history performance document
description: Each list item runs its own script that updates the attached database.
plugins:
  - id: hvy.db-table
  - id: hvy.form
---

<!--hvy: {"id":"history-performance"}-->
#! History performance

 <!--hvy:text {}-->
  Each item below runs its own form script that writes to the attached database. Submitting items, then undoing and redoing them, exercises script database checkpoints in the undo history.

 <!--hvy:plugin {"id":"perf-total","plugin":"hvy.db-table","pluginConfig":{"source":"with-file","table":"perf_items","columns":{"total_clicks":{"label":"${TOTAL_CLICKS_LABEL}"},"log_rows":{"label":"Fake log rows"}}}}-->
  SELECT (SELECT SUM(clicks) FROM perf_items) AS total_clicks, (SELECT COUNT(*) FROM perf_log) AS log_rows

 <!--hvy:plugin {"id":"perf-items","plugin":"hvy.db-table","pluginConfig":{"source":"with-file","table":"perf_items","queryLimit":${Math.min(itemCount, 1000)}}}-->

 <!--hvy:component-list {"componentListComponent":"container","componentListItemLabel":"fake perf item"}-->
${items}`;
}

function buildItem(index) {
  const name = getFakeItemName(index);
  return `  <!--hvy:component-list:${index} {}-->
   <!--hvy:container {"id":"${name}"}-->
    <!--hvy:text {}-->
     ### Fake item ${index + 1}
    <!--hvy:plugin {"id":"${name}-form","plugin":"hvy.form","pluginConfig":{"version":"0.1","submitScript":"record_run","submitLabel":"${getFakeItemSubmitLabel(index)}"}}-->
     fields: []
     scripts:
       record_run: |
         doc.db.execute("UPDATE perf_items SET clicks = clicks + 1, last_note = ? WHERE name = ?", ["fake note from ${name}", "${name}"])
         doc.db.execute("INSERT INTO perf_log (item, payload) VALUES (?, ?)", ["${name}", "fake payload from ${name}"])
`;
}

async function buildSeedDatabase(itemCount, seedRows) {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  try {
    db.run('CREATE TABLE perf_items (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, clicks INTEGER NOT NULL DEFAULT 0, last_note TEXT)');
    db.run('CREATE TABLE perf_log (id INTEGER PRIMARY KEY, item TEXT NOT NULL, payload TEXT NOT NULL)');
    db.run('BEGIN');
    for (let index = 0; index < itemCount; index += 1) {
      db.run('INSERT INTO perf_items (name) VALUES (?)', [getFakeItemName(index)]);
    }
    // Deterministic pseudo-random payloads keep the file stable and resist gzip the
    // way real data does, so the attachment size tracks the row count.
    let seed = 0x9e3779b9;
    const nextWord = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0).toString(36);
    };
    for (let row = 0; row < seedRows; row += 1) {
      const payload = Array.from({ length: 12 }, nextWord).join(' ');
      db.run('INSERT INTO perf_log (item, payload) VALUES (?, ?)', [getFakeItemName(row % itemCount), payload]);
    }
    db.run('COMMIT');
    return db.export();
  } finally {
    db.close();
  }
}

function readPositiveIntegerEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = resolve(process.argv[2] ?? 'scratch/history-performance.hvy');
  const { bytes, textChars, databaseBytes } = await buildHistoryPerformanceDocument(getHistoryPerformanceOptions());
  writeFileSync(output, bytes);
  console.log(`Wrote ${output} (${textChars} text chars, ${databaseBytes} gzipped database bytes)`);
}
