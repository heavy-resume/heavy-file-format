#!/usr/bin/env python3
"""One-shot migration: rewrite a HVY file's slot markers from the old
'component attr on the slot' form to the new 'empty slot + nested child
directive' form. See REFACTOR-PLAN.md.

Rules:
- Slot markers: expandable:stub, expandable:content, component-list:N,
  grid:N, container:N, table:R:D.
- When a slot marker has a 'component' property in its JSON payload, split:
    * Slot keeps only its slot-level fields (see SLOT_KEEP).
    * Everything else (including all non-slot-level props) moves to a new
      child directive named after the 'component' value, emitted one indent
      deeper than the slot.
- Child content that was previously nested under the slot is re-indented to
  sit under the new child directive (i.e. +1 per split ancestor).
"""
import json
import re
import sys

DIRECTIVE = re.compile(r'^( *)<!--hvy:([a-z][a-z0-9-]*(?::[a-z0-9-]+)*)\s*(\{.*\})\s*-->\s*$')
# Matches any structural line (section header, any hvy directive, frontmatter
# fence, css fence). Structural lines respect indent and pop splits.
STRUCT = re.compile(r'^( *)(?:<!--hvy[: ]|#{1,6}! |---|```|~~~)')


def slot_keep_for(name):
    if name in ('expandable:stub', 'expandable:content'):
        return {'lock'}
    if re.match(r'^grid:\d+$', name):
        return {'column', 'id'}
    # component-list:N, container:N, table:R:D -> keep nothing
    return set()


def is_slot(name):
    if name in ('expandable:stub', 'expandable:content'):
        return True
    if re.match(r'^(component-list|grid|container):\d+$', name):
        return True
    if re.match(r'^table:\d+:\d+$', name):
        return True
    return False


def split_frontmatter(text):
    """Return (frontmatter_incl_fences, body)."""
    if not text.startswith('---'):
        return '', text
    m = re.match(r'^(---\r?\n.*?\r?\n---\r?\n?)', text, flags=re.DOTALL)
    if not m:
        return '', text
    fm = m.group(1)
    body = text[len(fm):]
    return fm, body


def transform_body(body):
    lines = body.split('\n')
    out = []
    # Stack of slot ORIGINAL indents where a split happened. Each entry
    # contributes +1 to every line's effective indent while the line is
    # inside that slot's subtree.
    splits = []

    def bump():
        return len(splits)

    for line in lines:
        if line.strip() == '':
            out.append('')
            continue

        m = DIRECTIVE.match(line)
        if not m:
            s = STRUCT.match(line)
            if s:
                # Structural non-block line (section header, section
                # directive `<!--hvy: {...}-->`, frontmatter/css fence).
                # Pop splits based on its indent; emit unmodified.
                indent_n = len(s.group(1))
                while splits and splits[-1] >= indent_n:
                    splits.pop()
                out.append(line)
                continue
            # Non-directive content line. Apply current bump uniformly.
            out.append(' ' * bump() + line)
            continue

        indent_str, name, payload = m.group(1), m.group(2), m.group(3)
        indent_n = len(indent_str)

        # Pop splits we've exited (this directive is at same or shallower
        # indent than a prior split slot).
        while splits and splits[-1] >= indent_n:
            splits.pop()

        effective_indent = indent_n + bump()

        try:
            props = json.loads(payload)
        except json.JSONDecodeError:
            out.append(' ' * bump() + line)
            continue

        if is_slot(name) and isinstance(props, dict) and 'component' in props:
            keep = slot_keep_for(name)
            slot_props = {k: v for k, v in props.items() if k in keep}
            child_name = props['component']
            child_props = {k: v for k, v in props.items()
                           if k != 'component' and k not in keep}

            slot_json = json.dumps(slot_props, separators=(',', ':'))
            child_json = json.dumps(child_props, separators=(',', ':'))

            out.append(f"{' ' * effective_indent}<!--hvy:{name} {slot_json}-->")
            out.append('')
            out.append(f"{' ' * (effective_indent + 1)}<!--hvy:{child_name} {child_json}-->")

            # Push this slot so all subsequent nested lines get +1 bump.
            splits.append(indent_n)
            continue

        # Pass-through directive with current bump.
        out.append(' ' * bump() + line)

    return '\n'.join(out)


def main():
    if len(sys.argv) < 2:
        print('usage: migrate-slots.py <file> [<file> ...]', file=sys.stderr)
        sys.exit(2)
    for path in sys.argv[1:]:
        with open(path) as f:
            text = f.read()
        fm, body = split_frontmatter(text)
        new_body = transform_body(body)
        with open(path, 'w') as f:
            f.write(fm + new_body)
        print(f'migrated: {path}')


if __name__ == '__main__':
    main()
