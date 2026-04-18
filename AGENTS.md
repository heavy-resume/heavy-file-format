This repo is for a file spec (HVY-SPEC.md) and contains a reference implementation of a reader / editor (under src). There's also examples under examples.

The source of truth for crafting a hvy or thvy file is _supposed_ to be HVY-SPEC.md.
All features of the file format should be in there.
Features of the reader / client may not.

If asked to build hvy from thvy then use thvy + HVY-SPEC.md, don't go reverse engineer the reference implementation.

The current state of the repo is where there are no "legacy files" so don't preserve any old behavior when making changes to new behavior or formats. There are no prior users.
