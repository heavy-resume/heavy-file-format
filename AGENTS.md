This repo is for a file spec (HVY-SPEC.md) and contains a reference implementation of a reader / editor (under src). There's also examples under examples. a HVY file is the primary file. THVY is a template file used as a starting point.

The source of truth for crafting a hvy or thvy file is _supposed_ to be HVY-SPEC.md.
All features of the file format should be in there.
Features of the reader / client may not.

If asked to build hvy from thvy then use thvy + HVY-SPEC.md, don't go reverse engineer the reference implementation. If a feature is missing from the spec, then go add it.

The spec and implementation should bias towards reusable components. I.e. consider DOM / React behavior where nested things are all essentially containers. It is MOSTLY build out right now so don't go making any foundational changes unless asked. 

The current state of the repo is where there are no "legacy files" so don't preserve any old behavior when making changes to new behavior or formats. There are no prior users.

Tests are in the tests directory. For serialization / deserialization changes always ensure there's appropriate test coverage.
