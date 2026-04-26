# Brython scripting plugin — example user script
#
# This is what an end user would type into a "scripting" component inside
# their HVY document. The host runs this inside Brython with:
#
#   - imports stripped (regex-rejected before compile)
#   - `__import__`, `open`, `eval`, `exec` removed from builtins
#   - `fetch`, `XMLHttpRequest`, etc. unreachable (no `window`, no `browser`
#     module exposed)
#   - a single global `doc` object injected — the only way to touch the
#     document. All mutations flow through it.
#
# Everything below is pure Python; no escape hatches are in scope.


# ---------------------------------------------------------------------------
# API surface the host injects (sketch — actual shape TBD)
# ---------------------------------------------------------------------------
#
# doc.sections                       -> list[Section]   (sync)
# doc.header                         -> dict-like; doc.header["title"] = "..."  (sync)
# doc.move_section(section, "end" | "start" | int_index)                         (sync)
# doc.highlight(section, color="yellow" | None)                                  (sync)
#
# Attachments are NOT cloned into the worker — they're fetched on demand:
#   bytes = await doc.read_attachment("db")                                      (async)
#   await doc.write_attachment("db", new_bytes, meta={...})                      (async)
#   names = doc.list_attachments()                                               (sync, names only)
#
# Section:
#   .title          str
#   .tags           set[str]   (read-only view; mutate via .add_tag / .remove_tag)
#   .collapsed      bool       (writable)
#   .blocks         list[Block]
#   .add_tag(tag), .remove_tag(tag)
#
# Block:
#   .component      str
#   .text           str        (writable)
#   .config         dict       (writable; corresponds to pluginConfig etc.)


# ---------------------------------------------------------------------------
# Example 1: tidy archived sections
# Move sections without an "active" tag to the bottom and collapse them.
# ---------------------------------------------------------------------------

for section in list(doc.sections):
    if "active" not in section.tags:
        doc.move_section(section, "end")
        section.collapsed = True


# ---------------------------------------------------------------------------
# Example 2: highlight sections that need attention
# Any section tagged "needs-review" gets highlighted in yellow; clear the
# highlight on sections that no longer have the tag.
# ---------------------------------------------------------------------------

for section in doc.sections:
    if "needs-review" in section.tags:
        doc.highlight(section, color="yellow")
    else:
        doc.highlight(section, color=None)


# ---------------------------------------------------------------------------
# Example 3: combine — archive untagged, flag stale
# A more realistic single pass that does both jobs and updates the header
# with a summary.
# ---------------------------------------------------------------------------

archived = 0
flagged = 0

for section in list(doc.sections):
    tags = section.tags

    if "active" not in tags:
        doc.move_section(section, "end")  # would probably use an indexing scheme instead of this
        section.collapsed = True
        archived += 1

    if "needs-review" in tags:
        doc.highlight(section, color="yellow")
        flagged += 1
    else:
        doc.highlight(section, color=None)

doc.header["last_script_run"] = f"archived={archived} flagged={flagged}"


# ---------------------------------------------------------------------------
# What is NOT possible (by construction)
# ---------------------------------------------------------------------------
#
#   import urllib.request          # SyntaxError — `import` stripped pre-compile
#   from browser import window     # same
#   __import__("os")               # NameError — removed from builtins
#   open("/etc/passwd")            # NameError
#   doc.__class__.__bases__        # returns object; no globals reachable from there
#
# The worst a hostile script can do is loop forever (mitigated by a host-side
# timeout that terminates the Brython execution context) or mutate the
# document in unwanted ways (mitigated by the host running scripts in a
# preview / staged mode before applying).
