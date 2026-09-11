# The HVY ("heavy") File Format

This repository contains the core functionality of the HVY file format, as well
as a reference implementation.

## Basics

HVY files can be thought of as self-contained, sandboxed, web pages. They thinking is to
move beyond printing focused documents with specific, narrow use cases,
and move towards a multipurpose document that can take advantage of the fact that AI
makes coding much more accessible. Documents can also be structured for AI consumption,
or reordered for user presentation,
eliminating the need to guess about information boundaries for things like recall.

A HVY document consists of header with meta information, a body, and a tail. The meta information
can include things such as document color schemes, component template definitions, formatting config,
and more. The body consists of sections, and within sections contain components or subsections. The tail
consists of attached files, such as images, a SQLite database, or arbitrary files such as PDFs.

The main body has a main window and pullout sidebar. Sections can be moved between main / sidebar via the editor.

Pairing the document with AI is intended to be standard functionality. You can of course ask questions
based on the contents of the document, but you can also use semantic search and semantic filtering
to quickly exclude portions that aren't relevant to what you are looking for.

Scripting is a core part of the HVY format, with the intent that the user uses AI to write scripts.
With scripting, you can create a template document with
dynamic instructions on how to fill it out, or craft an application. Scripting is sandboxed, with whitelisted functionality and execution limits.

## PHVY and THVY

In addition to the HVY format, there are PHVY (PDF HVY) and THVY (Template HVY) files. PHVY files
do not allow interactive content. THVY files are identical to HVY and the change in extension
is just a convention.

## Extending Functionality

The scope of the heavy-file-format repository is for single HVY documents. It should support advanced
uses and set a "batteries included" standard that is generally useful.

The most common way of extending functionality comes through plugin components. Hosting applications provide
plugins. If one is unknown, it is displayed as missing. Plugins provide both a component display and can
expose an API for the scripting layer.

An alternative is to use power scripting. Power scripting exposes the javascript runtime to the document.
Hosting applications should always use power scripting paired with an explicit whitelist based on document
ID and contents hash. Power scripting allows you to in theory alter or access anything,
including the host application.

If you're looking for "one of many related documents" functionality, you can check out the [HVY Desktop Applications](https://github.com/heavy-resume/hvy-desktop-applications) which features workspaces, folders, web integrations, MCP, and more.

## Use Cases
- Notetaking document
- Interactive resume / CV
- Interactive survey
- Generate study material
- Soft applications without hosting (diet tracking, etc)
- Arcade machine (game + high score tracking in a single file)
- More!

## Core Features
- Create interactive documents with a "what you see is what you get" editor
- Semantic search / filter and chat with AI powered editing included
- Sandboxed and power scripting
- WebMCP support
- Extendable with plugins. Includes a core set of plugins.
- Includes SQLite databases as well as static tables
- Attach files, automatically shrink images
- Encrypt documents, sections, and components, allowing one document to be shared across different
  access levels
- Built with "use AI and reorganize it if you want" in mind

## Where to Use
If you don't want to build locally, you can use the HVY at:
- [heavyresume.com](https://heavyresume.com)
- [HVY Galaxy (desktop application)](https://heavyresume.com/hvy-galaxy)
- [HVY Editor (VS Code Extension)](https://marketplace.visualstudio.com/items?itemName=HeavyResume.hvy)

# Development Information
## Current State
Everything related to the HVY file format is currently in alpha.

The repo itself is not yet set up for major contributions, with no CI configured and no
usage of GitHub's Releases.

The project is not (yet) deployed to npm. Any sister project would need to copy
in the target version separately, locally, and build against that. This is currently how
the [HVY Desktop Applications](https://github.com/heavy-resume/hvy-desktop-applications)
and [VS Code Extension](https://github.com/heavy-resume/hvy-vs-code-extension) have been
created. This makes it extremely easy and convenient as a solo developer working off
of the only in-flight version, but it won't scale well and needs to be updated.

A lot of functionality is immature, not well tested, and its not uncommon for surprising bugs or regressions
to be encountered. The good news is that alpha 5 has this happen a lot less than before for
common use cases.

## AI Contributions
AI cannot be trusted to properly test things, especially if it's UX / UI related. This repo
was written 99+% by AI (mostly GPT 5.5 and 5.6 Sol) so AI contributions are welcome, but only have it fix issues that you,
as a human, can reproduce and verify. Automated tested crafted by the AI frequently misses things.
It's better to start bug fixes with an isolated reproduction that can be confirmed. In some cases,
AI will think it reproduced the issue when it did not (i.e. I see X which would explain you seeing Y. I removed X. Fixed.)

## Common Gotchas
- The reference implementation uses a container to emulate mobile screen sizes. If you tell AI you see an
  issue on mobile, it very frequently uses the wrong CSS selector and then gets confused when you tell
  it the issue isn't fixed.
- There is intentional scrolling due to the insertion of elements. There is a race condition when
  changing the DOM and calculating sizes. Components also can declare their size. If you see a scrolling
  regression (i.e. I press "done" and it scroll up the page and out of view), stop immediately,
  have the AI reproduce independently, and fix. If you ignore it then things quickly add up.
- The AI may introduce CSS rules and names that overlap with embed users, creating problems not reproduced
  in the reference format but do exist in an embed user (or a specific embed user).
- The AI may mix the concerns of an embed user with this repo and attempt an implementation that isn't
  generic.
- Safari vs Chrome behavior can introduce race conditions among other things.
