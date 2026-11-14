# CLI as a live view of the document tree

## Goal

The deserialized `VisualDocument` is the only state. A CLI path is a route through that tree, resolved when used. Nothing is precomputed, so nothing is cached, invalidated, or rebuilt.

## Problem

`buildHvyVirtualFileSystem` (`src/cli-core/virtual-file-system.ts`) enumerates every path in the document into a map up front. Any edit that might change the set of paths throws the map away, and the next CLI call rebuilds it for the whole document.

- `virtualFileWriteInvalidatesFileSystem` treats every `.json`/`.yaml` write (except table data) as structural, so a config-only `plugin.json` edit costs a full rebuild.
- After every mutating command, `syncSortValuesForSection` walks every section.
- `sed` always writes and reports `mutated: true`, even when nothing matched.
- The scripting runtime drops its CLI session on each mutation and on the next microtask.
- About 10 lookup builders (`buildVirtualDirectoryBlockLookup`, `findBlockForVirtualDirectory`, `findBlockInsertionTargetForVirtualDirectory`, ...) each walk the whole document on every call. `resolveIdAliasPath` re-collects every `/id` alias on each call.

Example: a script that runs `sed` on two `plugin.json` files per card pays about 2 full rebuilds and 2 full sort walks per card. Across N cards that is O(N × document size).

Some `read`/`write` closures also capture build-time values, which is why rebuilding was needed for correctness:

- `children-order.json` captures the child names from build time.
- Block writes capture `baseComponent` from build time.
- Which files exist (component type, plugin id, form scripts parsed from `plugin.txt`) is decided at build time. Likely staleness: adding a form script via `plugin.txt` does not invalidate, so the new `.py` may not appear until something else forces a rebuild. Not yet verified.

## Design

- **Resolve by walking the node tree.** `children(node)` lists one directory from the live node. `resolve(path)` walks the path one segment at a time. `find`, `rg`, and the linter walk the tree.
- **Values come from the node.** Names, which files exist, file contents, and writes are all read from the live node when used. Nothing is captured at build time.
- **Naming is unchanged.** Reuse the existing id and temporary-name logic (`schema.id`, otherwise the session's `anonymousBlockNamesById`). Do not change how temporary names work: agents already confuse temporary names from `ls` with explicitly assigned ids.
- **`/id/<id>`.** Search the tree, stopping at the first match. No index.
- **Node to path** (`findVirtualDirectoryForBlock`). Search the tree, stopping at the node.
- **Session files.** The scratchpad, `readOnlyFiles`, `.modified` sidecars, and `raw*` files stay as a layer checked before the tree.
- **Interface.** Keep the `fs.entries` interface (`get`, `has`, `listChildPaths`, tree-ordered iteration) so command, linter, request-structure, and completion call sites do not change. `set`/`delete` write only to the session layer.

## Deleted

- The session file system cache and its invalidation:
  - `sessionVirtualFileSystems`
  - `invalidateHvyCliSessionVirtualFileSystem`
  - `updateSessionVirtualFileSystemAfterCommand`
  - `refreshHvyVirtualFileSystemSection`
  - `HvyVirtualEntryMap.replaceSubtree`
  - `virtualFileWriteInvalidatesFileSystem`
- The scripting runtime's per-microtask `cliSession` reset.
- The whole-document lookup builders, replaced by `resolve`.
- The global `syncSortValuesForSection` after each command. Structural commands (`mv`, `cp`, `rm`, insert) sync where they mutate; block writes already sync their owning list item.

To verify, not delete: `refreshSectionPaths`, `requiresFullRefresh`, and `mutatedPaths` are also used by `src/bind/handlers/submit.ts`, `src/chat-cli/chat-cli-edit-loop.ts`, and `src/webmcp.ts`, probably as UI refresh hints. They lose their file system meaning but may stay for UI refresh.

## Steps

- [x] 1. Build the resolver alongside the current build. Add a test asserting identical paths, contents, and listing order on the example documents.
  - Each directory's listing is now a function (`HvyVirtualDirectoryLister`) that adds only its own entries and hands subdirectories to `ctx.descend`. The full build calls `descend` immediately; the live tree (`HvyVirtualTreeEntries`, `src/cli-core/virtual-tree-entries.ts`) records it and lists a subdirectory only when a path goes through it. Both share the same listing code.
  - `/id/<id>` resolution searches the document in order and stops at the matching root (`iterateCanonicalIdAliases`, `iterateVirtualIdAliasRoots`).
  - `tests/cli-virtual-tree-entries.unit.spec.ts` checks the live tree against the full build on every example document: paths, order, directory listings, and file contents.
  - Confirmed bug, fixed by the live tree: adding a form script through `plugin.txt` does not show the new `.py` in the same session's `ls`, but does in a fresh session. A test covers the live tree's behaviour.
  - Existing issue, not changed: `/id` source paths are computed with positional names (`blockDirectoryName`), while the tree uses the session's stable temporary names (`stableBlockDirectoryName`). They agree until a block without an id is moved within a session.
  - `cli.fs.build.sections`, `cli.fs.build.docs`, `cli.fs.build.aliasCollect`, and `cli.fs.build.aliasEntries` (with `entriesBefore`) are removed. `cli.fs.build` stays until the full build is deleted.
- [x] 2. Switch the CLI session to the resolver. Delete the cache and invalidation code. Run the CLI, scripting `doc.cli`, and chat CLI tests.
  - `createHvyVirtualFileSystem` (was `buildHvyVirtualFileSystem`) returns the live tree. The full build, `HvyVirtualEntryMap`, the session cache, `invalidateHvyCliSessionVirtualFileSystem`, the section refresh, `rebuildsWholeVirtualFileSystem`, and `buildHvyVirtualBlockSubtreeFileSystem` are deleted. `history.ts` no longer invalidates anything.
  - Each command opens its own session file system (`openSessionVirtualFileSystem`): the live tree plus session-only files (scratchpad, read-only files, drafts, `.modified` sidecars).
  - Raw HVY files are attached to their node through `HvyVirtualListingContext.addNodeFiles`. Whether a node has `raw.hvy` or `raw-preview.hvy.txt` depends on its serialized size, so each is a deferred entry: the size is only checked when that file is looked up or its directory is listed. Previously the first listing serialized every node.
  - `/id/<name>` lookup (`findCanonicalIdAliasSourcePath`) searches nodes by id and works out only the matching node's path.
  - The scripting runtime keeps one CLI session per run instead of dropping it on every mutation and microtask.
  - Verified against the old code: a snapshot of the session file system (every path, kind, writability, and file content, including raw files and `/id` copies) is identical on all 14 example documents, with `Math.random` seeded so generated ids match.
  - Regression tests: `tests/cli-live-tree.unit.spec.ts` (form script listed in the same session; an edit made outside the CLI is visible to the next command). The step 1 comparison test is removed with the full build it compared against.
  - Removed measurements (approved): `cli.fs.build`, `cli.fs.session.get`, `cli.sessionFiles.rawHvy.skip`, `cli.sessionFiles.rawSections.*`, `cli.sessionFiles.rawComponents.*`, and `entriesBefore` on `cli.sessionFiles.add`.
  - Listing order matches the old code: within a directory, the document's entries, then session files placed `before-node-files` (scratchpad, read-only files), then the node's raw files, then the other session files (drafts, `.modified` sidecars). Session files choose their side with `HvyVirtualTreeEntries.set(path, entry, placement)`. Verified by comparing the full listing order of all 14 examples and an `ls` / `ls -R` / `find` scenario with drafts and sidecars against the old code; `tests/cli-live-tree.unit.spec.ts` pins the order.
  - `invalidatesVirtualFileSystem` now only decides whether a command runs the whole-document sort sync. It goes away in step 4.
  - Measured on `examples/resume.hvy`, per command, old → new: `sed` on a `.json` file 2.0 ms → 0.28 ms; `cat` through `/id` 0.014 ms → 0.16 ms; `cat` through `/body` 0.004 ms → 0.020 ms. Old reads were faster only while nothing had changed since the last rebuild. Each command still resolves the same path about 3 times (path check, resolve, read), each with its own `/id` search; reducing that is a possible follow-up.
- [x] 3. Replace the lookup builders' callers one area at a time: CLI, then search, PDF export, view filter, and form submit.
  - Directory entries carry the node they show (`section`, `block`) and, where components can be created, an `insert` target. Template directories run their commit after inserts as well as writes.
  - Path to node (`findBlockForVirtualDirectory`, `findSectionForVirtualDirectory`, `findBlockInsertionTargetForVirtualDirectory`) is one lookup on the live tree; `/id` paths resolve through it, so the separate `/id` handling is gone. An `/id/<name>` root entry is its source entry shown at the alias path.
  - Node to path and the whole-body maps walk the tree with `directoriesUnder` / `childDirectories`, which visit only the document's directories. The callers' function signatures are unchanged.
  - Deleted: the separate lookup and insertion-target builders, `resolveIdAliasPath`, the `...WithAliases` lookups, and `virtual-entry-map.ts`. The `/id` search moved to `virtual-id-aliases.ts` and the naming helpers to `virtual-path-names.ts`.
  - `/body` no longer has an insertion target. It used to accept a component and do nothing with it, so `mv` of a component to `/body/<name>` reported "moved" and deleted the component. `mv`, `cp`, and `hvy insert` into `/body` now error and leave the document unchanged (regression test in `tests/cli-core.unit.spec.ts`).
  - Measured on `examples/resume.hvy`, old → new: path to node 0.19 ms → 0.02 ms; insertion target 0.17 ms → 0.02 ms; node to path 0.16 ms → 0.15 ms; whole-body block map 0.32 ms → 0.98 ms (it now lists each block's files too); section map 0.006 ms → 0.012 ms.
  - `virtual-file-system.ts` is about 1,200 lines (from about 1,550). Most of the rest is the section and component file formats (`applyBlockSchemaJson`, table data files, and so on), which could move to their own file.
  - Removed the flaky `not.toContain('10')` assertions from `tests/history.unit.spec.ts`: each history snapshot includes a random UUID (`databaseHistoryVersion`), which contains `10` about 11% of the time.
- [x] 4. Move the sort sync into structural commands.
  - Sort and group values are recalculated where the document changes, for the list items that change can affect. The listing context carries the innermost component-list item (`listItem`), so no document walk is needed to find it.
    - File writes inside an item, inserts, and `children-order.json` writes sync the owning item, plus the list items inside an inserted block. This replaces the per-write `findSortValueOwnerBlock` walk.
    - A new list item is synced when inserted into a list.
    - Removing a block (`rm`, `mv`, `hvy remove`) syncs the item it was removed from (`HvyVirtualDirectory.listItem`).
    - `raw.hvy` writes sync the item and the lists inside the block, or the section, or the document, depending on what they replace.
    - `hvy insert section` syncs the new section. Adding or removing a template definition, `hvy prune-xref`, and `hvy lint --fix` sync the whole document, because they change definitions or edit across it.
    - Template content is not synced (`ignoresSortValues`), as before.
  - Deleted: the after-command whole-document sync, `invalidatesVirtualFileSystem` (from every result type), and `virtualFileWriteInvalidatesFileSystem`. The scripting runtime still syncs the whole document once when a run flushes.
  - `tests/cli-sort-value-sync.unit.spec.ts` covers `mv`, `cp`, component and document `raw.hvy` writes, insert-then-write, `rm`, and inserting a section from a template. All pass on the old code and the new; disabling the section sync makes its test fail.
  - Existing bugs found and fixed:
    - Section `raw.hvy` writes parsed the fragment without the document's front matter, so custom components from `component_defs` lost their children (they became separate list items) and the next command threw `Cannot read properties of undefined (reading 'map')`. The fragment is now parsed under the document's metadata (`wrapHvySectionFragmentAsDocument`), as component `raw.hvy` writes already were. Tests: `tests/cli-core.unit.spec.ts` (unchanged write keeps the document identical) and the section case in `tests/cli-sort-value-sync.unit.spec.ts`.
    - `rm`, `mv`, and `hvy remove` rejected `/id/...` source paths. Removal now resolves the alias to the canonical path first, and removal errors name the command that failed (`mv:` instead of `rm:`). Test in `tests/cli-core.unit.spec.ts`.
- [x] Follow-up: `hvy remove` / `rm` found the xref cards pointing at the removed component (`collectXrefVirtualPaths`) by walking every entry of the tree and parsing every `.json` file, twice with `--prune-xref`. It now finds the cards with a plain walk over the blocks, using the same test as `pruneXrefs` (`isXrefCardPointingAt`), and walks directories for their paths only when there are any. On `examples/resume.hvy`: removing a component nothing points at 12.9 ms (old code) → 0.13 ms; removing one with 4 cards pointing at it 18.9 ms → 1.3 ms, same output. Cards inside templates are no longer listed; pruning never removed them. Test in `tests/cli-core.unit.spec.ts` pins the exact hint and prune output.
- [x] Follow-up: avoidable whole-document walks on script command paths.
  - `find`, `grep`, and `rg` under a path, and `hvy request_structure`, iterated the whole tree (including `/id` copies) and filtered by prefix. They now use `entriesUnder(root)`.
  - Block to path (`findVirtualDirectoryForBlock`, xref card paths) walks the blocks to find the block's ancestors (`visitBodyBlocks`, nothing listed), then descends from `/body` listing only the directories on the way (`descendThrough`), each once. `hvy insert` names the created component by listing only its parent (`childDirectoryShowing`), searching more widely only if it is not there.
  - Measured on `examples/resume.hvy` (100 runs each, warm): `find` under an `/id` path 24 ms → 0.8 ms; `grep -r` 23 ms → 1.1 ms; `rg` under a section 25 ms → 1.2 ms; `hvy insert` under an `/id` path 0.4 ms; `hvy remove` with 4 xref cards pointing at it 0.38 ms. The "before" figures for remove and insert were taken with 20 cold runs, so only the find/grep/rg comparison is like for like.
  - Test in `tests/cli-live-tree.unit.spec.ts`: for every block in every example, the ancestor-based path equals the path the directory listing shows.
  - Still walking: each `/id/...` lookup searches blocks in document order until the id matches (about 3 lookups per command). Whole-document by design: `find /`, glob expansion, `hvy search`, the linter, search snapshot alignment, semantic candidates, `prune-xref`, `lint --fix`.
- [ ] 5. Measure before and after with the `cli.*` measurements and `scripts/chat-performance-harness.mjs`.
  - Blocked: `npm run browser:chat-perf` fails on the old code and the new. Its mock LLM replies no longer satisfy the chat agent ("Viewer agent stopped after 12 steps without answering"), so it times out waiting for `Mock QA answer 1 for performance measurement.` before measuring anything. The mock responses need updating to the current agent protocol.

## Decided

- Remove the `entriesBefore` fields (on `cli.sessionFiles.add` and `cli.fs.build.aliasEntries`) and the `cli.fs.build.*` measurements. They have no meaning once nothing is prebuilt, and nothing reads them. Approved.
- No commits while this work is in progress.
