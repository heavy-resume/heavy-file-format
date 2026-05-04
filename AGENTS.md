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

Be careful with the app's view terminology. `AI` is a document view/editing mode that sits alongside `editor` and `viewer`; it is not the same thing as the chat panel itself. When a user refers to "AI mode", confirm whether they mean the document `AI` view versus the chat UI before making rendering or styling assumptions.

Naming convention notes:
- Avoid repeating names (ensure good grepability to avoid confusion or overloading a name)
- Avoid repeating filenames (ensure cmd / ctrl + p doesn't reveal a bunch of files with the same name)
  - This means: avoid adding another index.ts and another README.md, among other things

Avoid letting files get over 1k in length. Consider breaking things up at that point unless there's a good reason it has to be that long.

Use dev-traces to debug stuff the user reports as issues with the LLM based chat. The cli logs are only for the cli.
