This repo is for a file spec (HVY-SPEC.md) and contains a reference implementation of a reader / editor (under src). There's also examples under examples. a HVY file is the primary file. THVY is a template file used as a starting point.

The source of truth for crafting a hvy or thvy file is _supposed_ to be HVY-SPEC.md.
All features of the file format should be in there.
Features of the reader / client may not.

If asked to build hvy from thvy then use thvy + HVY-SPEC.md, don't go reverse engineer the reference implementation. If a feature is missing from the spec, then go add it.

The spec and implementation should bias towards reusable components. I.e. consider DOM / React behavior where nested things are all essentially containers. It is MOSTLY build out right now so don't go making any foundational changes unless asked. 

The current state of the repo is where there are no "legacy files" so don't preserve any old behavior when making changes to new behavior or formats. There are no prior users.

Tests are in the tests directory. For serialization / deserialization changes always ensure there's appropriate test coverage.

Tests for tools should prefer BEFORE, TOOL CALL, AFTER flow and not use mock calls or things potentially altered by order. The idea this is equally human and machine readable. When naming things prefer "expected result" or similar to make it clear. Additionally, avoid moving things to variables if they're used exactly once in tests, and keep variable definitions near usage.

When adding components ALWAYS PREFER REUSABLE COMPONENTS. ITS BUILT OUT SO USE IT, DONT MAKE A NEW UI.

Components go into their own directories with their own css and logic files

Editor input/focus rule: typing inside an active component or plugin must not trigger a full `getRenderApp()()` rerender unless the component is making a structural change that cannot be applied locally. Prefer mutating the document state, refreshing reader panels, and updating the component DOM in place. This is especially important for plugins: ordinary `setConfig` / `setText` style edits should preserve focus and caret selection; only explicit structural actions should request a full rerender.

When asked to have something be HVY always use the reusable HVY rendering and not a new solution.

The default startup document should treat `examples/example.hvy` as the single source of truth. It contains a real HVY tail attachment, so do not load it as raw text; load it as bytes / asset URL and deserialize bytes so `--HVY-TAIL--` data does not leak into the visible document.

Embedding is a common use case. The embedded client boundary lives in `src/embed.ts`; use `mountHvy` / `mountHvyViewer` from `window.HVY` and keep host-facing API types there. The README has the public embedding examples. Embedded hosts pass plugins through `plugins`, chat through `chatClient`, palettes through `paletteId`, and async link validation/rewrites through `linkObserver` / `mount.setLinkObserver(...)`; the link observer implementation is in `src/link-observer.ts`.

Be careful with the app's view terminology. `AI` is a document view/editing mode that sits alongside `editor` and `viewer`; it is not the same thing as the chat panel itself. When a user refers to "AI mode", confirm whether they mean the document `AI` view versus the chat UI before making rendering or styling assumptions.

Naming convention notes:
- Avoid repeating names (ensure good grepability to avoid confusion or overloading a name)
- Avoid repeating filenames (ensure cmd / ctrl + p doesn't reveal a bunch of files with the same name)
  - This means: avoid adding another index.ts and another README.md, among other things

Avoid letting files get over 1k in length. Consider breaking things up at that point unless there's a good reason it has to be that long.

Use dev-traces to debug stuff the user reports as issues with the LLM based chat. The cli logs are only for the cli.

Agents can inspect HVY files through the Node CLI harness when a browser is unnecessary. Use `node scripts/hvy-cli.mjs --file examples/resume.hvy -- "ls /body"` or pass another HVY path with `--file`; this exercises the same CLI virtual file system paths used by the reference implementation.

The reference app's faux resume reader views live in `examples/resume-views.json`. Keep those implementation-only view filters in sync with `examples/resume.hvy` / `examples/resume.thvy`, and prefer stable `/id/<id>/<subpath>` targets there over full `/body/...` paths when possible.

Refrain from the temptation to solve things with laser "if" conditionals and always consider the long term reusable solution - if we had different plugins, different extra features, would this idea work? Don't go out and chase LLM mistakes by muddying up the interface.

When assessing mistakes LLMs show in the chat interface, refrain from solving things with aliases without asking first.

When updating UI, strongly consider how scrolling would happen and whether things would constantly scroll-to-top on rerender. This happens a lot.

When the user asks to investigate a problem don't jump into a solution.

When publishing or pushing a branch, the local branch name and upstream branch name should match unless the user explicitly asks for a different remote branch. If they do not match, stop and fix the upstream before pushing; do not silently push a local branch to an older or differently named remote branch.

Under no circumstance should a log have its own code path that would deviate from what it is supposed to be logging (except, strictly, for readability mutations.) Logs should be "raw data" first. Do not ever try to reconstruct what you think should show up in point A by having log code reconstruct in point B. Restructure the code if that isn't simple and obvious.

Do not alter logging in any form without permission.

For CLI/API design, avoid one-off special cases that look like a broader convention. Prefer APIs and more long term facing over APIs that merely solve the immediate example. Don't spend effort writing something limited when something much more capable is basically the same work.

When creating new input components, always jazz it up. Anything default browser UI won't work.

Animations, colors, highlights, etc all have examples. Use them!

Make sure stuff isn't losing focus after each keystroke. This is a common, reoccuring problem!

If the instructions say "on the mobile layout ..." it really means "on smaller screens or using the phone emulator" and media selectors should always use container, or not use a media selector at all.

The app has built-in preview emulation for Full, Phone, Tablet, and Desktop widths. UI that belongs to the reader/editor/viewer surface, including chat, search, context menus, and progress surfaces, should be positioned inside that emulated preview frame unless the user explicitly asks for a viewport-level overlay. Do not "fix" preview-frame placement bugs by switching these surfaces to viewport-fixed positioning; that bypasses the emulation model.

When running any sort of tests don't interfere with port 5173 which is the dev server port doing hot reloading.

For ad-hoc browser verification, use the stable browser harness commands instead of one-off `node -e` Playwright scripts or direct `kill` commands. Start the local browser test server with `npm run browser:start`, edit `scratch/browser-smoke.mjs` for the current Playwright scenario, run it with `npm run browser:smoke`, and stop the server with `npm run browser:stop`. The harness uses port 5174 and keeps scratch files ignored so repeated browser tests and stop commands can be approved once.

When creating new inputs, etc make sure they use the HVY theme variables including backgrounds. Script components should use the script rendering.

Right now as of version 0.1 of the spec there's no "older" stuff to worry about so don't waste effort on backwards compatibility.

When adding new colors or adjusting the CSS variables that are color related be sure to update the theme editor. Make sure new states are editable.

The lock logic is not intended to inherit. A locked section doesn't automatically lock the interior components.

Avoid the temptation to special case things and consider generic solutions. In some cases if something looks wrong in the example its because the example is wrong, not the code.

When fixing a theme always review other themes for a similar issue unless instructed otherwise.

Common UI bugs from stuff you write - check for this and look at what you did before:
- Single character input then loses focus
- Bad click handler, especially around overlapping clickable components

Playwright test timeouts:
- single action - no more than 1s
- full test - no more than 5s

If you're writing AI instructions don't just throw a patchwork fix for a specific issue with a specific thing. Don't write real world examples since it risks being misleading. Make example names obviously fake.

Don't make compatibilty fallbacks
