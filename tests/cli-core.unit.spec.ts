import { expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createHvyCliSession, executeHvyCliCommand } from '../src/cli-core/commands';
import { deserializeDocument, serializeDocument } from '../src/serialization';

function createCliTestDocument() {
  return deserializeDocument(`---
hvy_version: 0.1
title: CLI Test
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"intro","css":"margin: 0.5rem 0;"}-->
 Hello world
`, '.hvy');
}

function createResumeCliTestDocument() {
  return deserializeDocument(readFileSync(fileURLToPath(new URL('../examples/resume.hvy', import.meta.url)), 'utf8'), '.hvy');
}

test('cli can navigate and read virtual component files', async () => {
  const document = createCliTestDocument();
  const session = createHvyCliSession();

  expect((await executeHvyCliCommand(document, session, 'ls /')).output).toContain('body');
  expect((await executeHvyCliCommand(document, session, 'cd /body/summary')).cwd).toBe('/body/summary');
  expect((await executeHvyCliCommand(document, session, 'cat intro/text.txt')).output).toBe('Hello world');
  expect((await executeHvyCliCommand(document, session, 'cat intro/text.json')).output).toContain('"css": "margin: 0.5rem 0;"');
});

test('cli resolves component directories for common read commands', async () => {
  const document = createResumeCliTestDocument();
  const session = createHvyCliSession();

  const catDirectory = await executeHvyCliCommand(document, session, 'cat /body/skills/skill-software-engineering');
  expect(catDirectory.output).toContain('Software Engineering');
  expect(catDirectory.output).toContain('#### Description');

  const catTxtAlias = await executeHvyCliCommand(document, session, 'cat /body/skills/skill-software-engineering.txt');
  expect(catTxtAlias.output).toContain('Software Engineering');

  const numbered = await executeHvyCliCommand(document, session, 'nl -ba /body/skills/skill-software-engineering');
  expect(numbered.output).toContain('     1\tSoftware Engineering');

  const head = await executeHvyCliCommand(document, session, 'head -n 1 /body/top-skills-tools-technologies/grid-0');
  expect(head.output).toContain('## Skills');
});

test('ls describes custom component definitions for custom component directories', async () => {
  const document = createResumeCliTestDocument();
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(document, session, 'ls /body/skills/component-list-1/component-list/skill-software-engineering');

  expect(result.output).toContain('Custom component definition:');
  expect(result.output).toContain('name: skill-record');
  expect(result.output).toContain('baseType: expandable');
  expect(result.output).toContain('description: Skill record');
  expect(result.output).toContain('schema:');
  expect(result.output).toContain('"expandableContentBlocks"');
});

test('cat custom component bodies includes custom definition and component preview', async () => {
  const document = createResumeCliTestDocument();
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(document, session, 'cat /body/skills/component-list-1/component-list/skill-software-engineering/skill-record.txt');

  expect(result.output).toContain('Software Engineering');
  expect(result.output).toContain('Custom component definition:');
  expect(result.output).toContain('name: skill-record');
  expect(result.output).toContain('Preview command: hvy request_structure skill-software-engineering --collapse');
  expect(result.output).toContain('Component preview switched to request_structure because raw HVY is');
  expect(result.output).toContain('/skill-software-engineering');
});

test('hvy preview switches long raw fragments to request_structure capped at 25 lines', async () => {
  const document = createResumeCliTestDocument();
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(document, session, 'hvy preview /body/skills/component-list-1/component-list/skill-software-engineering');

  expect(result.output).toContain('Preview command: hvy request_structure skill-software-engineering --collapse');
  expect(result.output).toContain('Component preview switched to request_structure because raw HVY is');
  expect(result.output).toContain('/skill-software-engineering');
  expect(result.output.split('\n').length).toBeLessThanOrEqual(28);
});

test('hvy preview shows short raw fragments and the command used', async () => {
  const document = createCliTestDocument();
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(document, session, 'hvy preview /body/summary/intro');

  expect(result.output).toContain('Preview command: hvy preview /body/summary/intro');
  expect(result.output).toContain('Component preview (raw HVY, first 25 lines):');
  expect(result.output).toContain('<!--hvy:text {"id":"intro"}-->');
});

test('cli supports cat heredoc writes to writable virtual files', async () => {
  const document = createCliTestDocument();
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(document, session, `cat > /scratchpad.txt <<'TXT'
Plan:
1. Inspect
2. Edit
TXT`);

  expect(result.output).toBe('/scratchpad.txt: written');
  expect(result.mutated).toBe(true);
  expect((await executeHvyCliCommand(document, session, 'cat /scratchpad.txt')).output).toBe('Plan:\n1. Inspect\n2. Edit\n');
});

test('cli sed updates writable virtual files', async () => {
  const document = createCliTestDocument();
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(document, session, 'sed s/world/there/ /body/summary/intro/text.txt');

  expect(result.mutated).toBe(true);
  expect(result.output).toContain('updated');
  expect(document.sections[0]?.blocks[0]?.text).toBe('Hello there');
});

test('cli echo supports shell-style redirection to writable virtual files', async () => {
  const document = createCliTestDocument();
  const session = createHvyCliSession();

  expect((await executeHvyCliCommand(document, session, 'ls /')).output).toContain('file scratchpad.txt');
  expect((await executeHvyCliCommand(document, session, 'cat /scratchpad.txt')).output).toContain('Keep track of your progress');
  expect((await executeHvyCliCommand(document, session, 'echo "Task note" >> scratchpad.txt')).output).toBe('/scratchpad.txt: appended');
  expect((await executeHvyCliCommand(document, session, 'cat scratchpad.txt')).output).toContain('Task note');

  expect((await executeHvyCliCommand(document, session, 'echo "plain output"')).output).toBe('plain output');

  const writeResult = await executeHvyCliCommand(document, session, 'echo "First note" > /body/summary/intro/text.txt');
  expect(writeResult.mutated).toBe(true);
  expect(writeResult.output).toBe('/body/summary/intro/text.txt: written');

  const appendResult = await executeHvyCliCommand(document, session, 'echo "Second note" >> /body/summary/intro/text.txt');
  expect(appendResult.mutated).toBe(true);
  expect(appendResult.output).toBe('/body/summary/intro/text.txt: appended');
  expect((await executeHvyCliCommand(document, session, 'cat /body/summary/intro/text.txt')).output).toBe('First note\nSecond note\n');

  await expect(executeHvyCliCommand(document, session, 'echo nope > /body/summary')).rejects.toThrow('Is a directory');
  expect((await executeHvyCliCommand(document, session, 'man echo')).output).toContain('echo TEXT [> FILE|>> FILE]');
});

test('cli expands supported date command substitutions', async () => {
  const document = createCliTestDocument();
  const session = createHvyCliSession();
  session.now = new Date('2026-05-04T12:34:56Z');

  const result = await executeHvyCliCommand(document, session, 'echo "last-edited: $(date -u +\\"%Y-%m-%dT%H:%M:%SZ\\")" > /scratchpad.txt');

  expect(result.output).toBe('/scratchpad.txt: written');
  expect((await executeHvyCliCommand(document, session, 'cat /scratchpad.txt')).output).toBe('last-edited: 2026-05-04T12:34:56Z\n');

  await executeHvyCliCommand(document, session, 'echo \'literal: $(date -u +"%Y")\' > /scratchpad.txt');
  expect((await executeHvyCliCommand(document, session, 'cat /scratchpad.txt')).output).toBe('literal: $(date -u +"%Y")\n');

  await expect(executeHvyCliCommand(document, session, 'echo "$(whoami)"')).rejects.toThrow('Unsupported command substitution');
});

test('cli warns when scratchpad writes exceed the note limit', async () => {
  const document = createCliTestDocument();
  const session = createHvyCliSession();

  const warning = await executeHvyCliCommand(document, session, `echo "${'x'.repeat(900)}" > scratchpad.txt`);
  expect(warning.output).toContain('/scratchpad.txt: written');
  expect(warning.output).toContain('scratchpad.txt is 800 characters');
  expect(warning.output).toContain('Rewrite scratchpad.txt shorter before adding more notes.');
  expect(warning.output).toContain('x'.repeat(800));

  const inspect = await executeHvyCliCommand(document, session, 'ls /');
  expect(inspect.output).toContain('dir  body');

  const deleted = await executeHvyCliCommand(document, session, 'hvy delete /body/summary/intro');
  expect(deleted.output).toBe('/body/summary/intro: removed');

  expect((await executeHvyCliCommand(document, session, 'echo "short" > scratchpad.txt')).output).toBe('/scratchpad.txt: written');
});

test('cli exposes resume component-list items by stable section paths', async () => {
  const document = createResumeCliTestDocument();
  const session = createHvyCliSession();

  expect((await executeHvyCliCommand(document, session, 'ls /body')).output).toContain('dir  tools-technologies');
  expect((await executeHvyCliCommand(document, session, 'cd tools-technologies')).cwd).toBe('/body/tools-technologies');
  expect((await executeHvyCliCommand(document, session, 'pwd')).output).toBe('/body/tools-technologies');
  expect((await executeHvyCliCommand(document, session, 'find tool-typescript -name skill-record.txt')).output).toContain(
    '/body/tools-technologies/tool-typescript/skill-record.txt'
  );
  expect((await executeHvyCliCommand(document, session, 'cat tool-typescript/skill-record.txt')).output).toContain('Primary application language.');
});

test('cli accepts body section aliases from root and mutates resume virtual files', async () => {
  const document = createResumeCliTestDocument();
  const session = createHvyCliSession();

  expect((await executeHvyCliCommand(document, session, 'cd /tools-technologies')).cwd).toBe('/body/tools-technologies');

  const before = await executeHvyCliCommand(document, session, 'find /body/tools-technologies/tool-typescript -name skill-record.txt');
  expect(before.output).toContain('/body/tools-technologies/tool-typescript/skill-record.txt');

  const result = await executeHvyCliCommand(document, session, 'sed s/Primary/Core/ /body/tools-technologies/tool-typescript/skill-record.txt');
  expect(result.mutated).toBe(true);
  expect(result.output).toBe('/body/tools-technologies/tool-typescript/skill-record.txt: updated');
  expect((await executeHvyCliCommand(document, session, 'cat /tools-technologies/tool-typescript/skill-record.txt')).output).toContain(
    'Core application language.'
  );
});

test('cli rm recursively removes virtual body directories', async () => {
  const document = createResumeCliTestDocument();
  const session = createHvyCliSession();

  await expect(executeHvyCliCommand(document, session, 'rm /body/tools-technologies/tool-typescript')).rejects.toThrow(
    'is a directory; use -r'
  );

  const result = await executeHvyCliCommand(document, session, 'rm -r body/tools-technologies/tool-typescript');

  expect(result.mutated).toBe(true);
  expect(result.output).toContain('/body/tools-technologies/tool-typescript: removed');
  expect(result.output).toContain('Run: hvy prune-xref tool-typescript');
  expect((await executeHvyCliCommand(document, session, 'find /body/tools-technologies -name skill-record.txt')).output).not.toContain(
    '/body/tools-technologies/tool-typescript/skill-record.txt'
  );
  expect(serializeDocument(document)).not.toContain('id":"tool-typescript"');

  const forced = await executeHvyCliCommand(document, session, 'rm -rf body/tools-technologies/missing-tool');
  expect(forced.output).toBe('');
  expect(forced.mutated).toBe(true);

  const forcedReverse = await executeHvyCliCommand(document, session, 'rm -fr body/tools-technologies/missing-tool');
  expect(forcedReverse.output).toBe('');
  expect(forcedReverse.mutated).toBe(true);
});

test('cli suggests nearby paths when a path is missing', async () => {
  const document = createResumeCliTestDocument();
  const session = createHvyCliSession();

  await expect(executeHvyCliCommand(document, session, 'hvy remove /body/tools-technologies/component-list-1/component-list/tool-typescriptx'))
    .rejects.toThrow(/Did you mean\?\n\s+Closest existing parent: \/body\/tools-technologies\/component-list-1\/component-list\n\s+\/body\/tools-technologies\/component-list-1\/component-list\/tool-typescript/);

  await expect(executeHvyCliCommand(document, session, 'cat /body/tools-technologies/tool-typescript/skill-recrod.txt'))
    .rejects.toThrow(/Did you mean\?\n(?:.*\n)*\s+\/body\/tools-technologies\/tool-typescript\/skill-record\.txt/);
});

test('cli find supports common filters and warns about ignored options', async () => {
  const document = createResumeCliTestDocument();
  const session = createHvyCliSession();

  const directories = (await executeHvyCliCommand(document, session, 'find /body/tools-technologies -type d -maxdepth 1 -print')).output;
  expect(directories).toContain('/body/tools-technologies/tool-typescript');
  expect(directories).not.toContain('/body/tools-technologies/tool-typescript/expandable-content');

  const files = (await executeHvyCliCommand(document, session, 'find /body/tools-technologies/tool-typescript -type f -name skill-record.txt')).output;
  expect(files).toContain('/body/tools-technologies/tool-typescript/skill-record.txt');

  expect((await executeHvyCliCommand(document, session, 'find /body -mtime 1 -name skill-record.txt')).output).toContain(
    'Warning: find ignored unsupported option -mtime'
  );
  expect((await executeHvyCliCommand(document, session, 'ls -lah /body')).output).toContain('Warning: ls ignored unsupported option -lah');

  const recursiveList = await executeHvyCliCommand(document, session, 'ls -R body | sed -n "1,5p"');
  expect(recursiveList.output.split('\n')).toHaveLength(5);
  expect(recursiveList.output).toContain('/body');
});

test('cli rg supports common ripgrep flags and hvy read aliases cat', async () => {
  const document = createResumeCliTestDocument();
  const session = createHvyCliSession();

  const read = await executeHvyCliCommand(document, session, 'hvy read /body/tools-technologies/tool-typescript/skill-record.txt');
  expect(read.output).toContain('TypeScript');

  const lineNumber = await executeHvyCliCommand(document, session, 'rg -n "TypeScript\\|Typescript" /body/tools-technologies');
  expect(lineNumber.output).toContain('/body/tools-technologies/tool-typescript/skill-record.txt:1:TypeScript');
  expect(lineNumber.output).not.toContain('Warning: rg ignored unsupported option -n');

  const filesOnly = await executeHvyCliCommand(document, session, 'rg "TypeScript" /body/tools-technologies -l');
  expect(filesOnly.output).toContain('/body/tools-technologies/tool-typescript/skill-record.txt');
  expect(filesOnly.output).not.toContain(':1:TypeScript');

  const combined = await executeHvyCliCommand(document, session, 'rg -rn "TypeScript" /body/tools-technologies');
  expect(combined.output).not.toContain('Warning: rg ignored unsupported option -r');
  expect(combined.output).toContain('/body/tools-technologies/tool-typescript/skill-record.txt:1:TypeScript');

  const listFilesAlias = await executeHvyCliCommand(document, session, 'rg -r "TypeScript" /body/tools-technologies --list-files');
  expect(listFilesAlias.output).toContain('/body/tools-technologies/tool-typescript/skill-record.txt');
  expect(listFilesAlias.output).not.toContain(':1:TypeScript');

  const piped = await executeHvyCliCommand(document, session, 'rg -r "TypeScript" /body -l | head -3');
  expect(piped.output.split('\n')).toHaveLength(3);
  expect(piped.output).not.toContain('Warning: rg ignored unsupported option -3');

  const multiPiped = await executeHvyCliCommand(document, session, 'rg -r "TypeScript" /body -l | head -10 | sed -n "1,3p"');
  expect(multiPiped.output.split('\n')).toHaveLength(3);
  expect(multiPiped.output).not.toContain('Warning: unsupported pipe ignored');

  const filtered = await executeHvyCliCommand(document, session, 'rg -r "TypeScript" /body -l | grep tools | sort | uniq | wc -l');
  expect(Number.parseInt(filtered.output, 10)).toBeGreaterThan(0);

  const replaced = await executeHvyCliCommand(document, session, 'echo "TypeScript language" | sed s/TypeScript/Programming/g | nl');
  expect(replaced.output).toContain('Programming language');
  expect(replaced.output).toContain('1');

  const includeEquals = await executeHvyCliCommand(document, session, 'rg -r "TypeScript" /body --include="*.json" -l');
  expect(includeEquals.output).toContain('/body/top-skills-tools-technologies/grid-0/grid/xref-card-1-2/xref-card.json');
  expect(includeEquals.output).not.toContain('skill-record.txt');

  const includeSeparate = await executeHvyCliCommand(document, session, 'rg -r "" --include "*.yaml" /body -l');
  expect(includeSeparate.output).toBe('');
});

test('cli hvy remove and delete alias recursive rm', async () => {
  const document = createResumeCliTestDocument();
  const session = createHvyCliSession();

  const remove = await executeHvyCliCommand(document, session, 'hvy remove /body/tools-technologies/tool-typescript');
  expect(remove.output).toContain('/body/tools-technologies/tool-typescript: removed');
  expect(remove.output).toContain('Run: hvy prune-xref tool-typescript');
  expect(serializeDocument(document)).not.toContain('id":"tool-typescript"');

  await executeHvyCliCommand(document, session, 'hvy delete /body/tools-technologies/tool-python');
  expect(serializeDocument(document)).not.toContain('id":"tool-python"');
});

test('cli can prune xrefs directly or while removing a target', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"tool-typescript"}-->
TypeScript

<!--hvy:xref-card {"id":"ts-card","xrefTitle":"TypeScript","xrefTarget":"tool-typescript"}-->

<!--hvy:xref-card {"id":"python-card","xrefTitle":"Python","xrefTarget":"tool-python"}-->
`, '.hvy');
  const session = createHvyCliSession();

  const hint = await executeHvyCliCommand(document, session, 'hvy remove /body/summary/tool-typescript');
  expect(hint.output).toContain('Hint: 1 xref-card still point to tool-typescript. Run: hvy prune-xref tool-typescript');
  expect(serializeDocument(document)).toContain('id":"ts-card"');

  const pruned = await executeHvyCliCommand(document, session, 'hvy prune-xref tool-typescript');
  expect(pruned.output).toContain('Removed 1 xref-card pointing to tool-typescript.');
  expect(serializeDocument(document)).not.toContain('id":"ts-card"');
  expect(serializeDocument(document)).toContain('id":"python-card"');

  const secondDocument = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"tool-ruby"}-->
Ruby

<!--hvy:xref-card {"id":"ruby-card","xrefTitle":"Ruby","xrefTarget":"tool-ruby"}-->
`, '.hvy');
  const secondSession = createHvyCliSession();
  const removed = await executeHvyCliCommand(secondDocument, secondSession, 'hvy remove /body/summary/tool-ruby --prune-xref');

  expect(removed.output).toContain('Pruned 1 xref-card pointing to tool-ruby:');
  expect(serializeDocument(secondDocument)).not.toContain('tool-ruby');
  expect(serializeDocument(secondDocument)).not.toContain('ruby-card');
});

test('cli find limits broad result sets', async () => {
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
  const session = createHvyCliSession();

  for (let index = 0; index < 105; index += 1) {
    await executeHvyCliCommand(document, session, `hvy add section /body item-${index} "Item ${index}"`);
  }

  const output = (await executeHvyCliCommand(document, session, 'find /body -type d')).output;
  expect(output.split('\n').filter((line) => line.startsWith('/body'))).toHaveLength(100);
  expect(output).toContain('Warning: find output truncated to 100 of 106 results.');
});

test('cli command output is capped at 100 lines', async () => {
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
  const session = createHvyCliSession();

  for (let index = 0; index < 105; index += 1) {
    await executeHvyCliCommand(document, session, `hvy add section /body item-${index} "Item ${index}"`);
  }

  const result = await executeHvyCliCommand(document, session, 'find /body -type f -name section.json -exec sed s/TypeScript//g {} +');

  expect(result.output.split('\n')).toHaveLength(101);
  expect(result.output).toContain('Warning: output truncated to 100 of 105 lines (5 lines hidden).');
  expect(result.output).toContain('Narrow the command with rg, find -name, head, or a more specific path.');
});

test('cli supports shell-style && command chaining', async () => {
  const document = createCliTestDocument();
  const session = createHvyCliSession();

  const chained = await executeHvyCliCommand(
    document,
    session,
    'sed s/world/there/ /body/summary/intro/text.txt && echo "updated intro" >/scratchpad.txt && cat /body/summary/intro/text.txt'
  );

  expect(chained.mutated).toBe(true);
  expect(chained.output).toBe('Hello there');
  expect(document.sections[0]?.blocks[0]?.text).toBe('Hello there');
  expect(session.scratchpadContent).toBe('updated intro\n');
});

test('cli supports shell-style || command chaining', async () => {
  const document = createCliTestDocument();
  const session = createHvyCliSession();

  const recovered = await executeHvyCliCommand(document, session, 'cat /missing.txt || true && echo "recovered"');
  expect(recovered.output).toBe('recovered');
  expect(recovered.mutated).toBe(false);

  const skipped = await executeHvyCliCommand(document, session, 'cat /body/summary/intro/text.txt || echo "fallback"');
  expect(skipped.output).toBe('Hello world');
});

test('cli supports find -exec with sed -i -E for shell-like batch edits', async () => {
  const document = createCliTestDocument();
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(
    document,
    session,
    'find body -type f -name "*.txt" -exec sed -i -E s/world/there/g {} + && echo done Removed world'
  );

  expect(result.output).toBe('done Removed world');
  expect(result.mutated).toBe(true);
  expect(document.sections[0]?.blocks[0]?.text).toBe('Hello there');
});

test('cli supports xargs in pipelines', async () => {
  const document = createCliTestDocument();
  const session = createHvyCliSession();

  const catResult = await executeHvyCliCommand(document, session, 'find /body/summary -name text.txt | xargs cat');
  expect(catResult.output).toBe('Hello world');

  const sedResult = await executeHvyCliCommand(document, session, 'find /body/summary -name text.txt | xargs -I {} sed s/world/there/ {}');
  expect(sedResult.mutated).toBe(true);
  expect(sedResult.output).toBe('/body/summary/intro/text.txt: updated');
  expect(document.sections[0]?.blocks[0]?.text).toBe('Hello there');

  const emptyResult = await executeHvyCliCommand(document, session, 'find /body/summary -name missing.txt | xargs -r cat');
  expect(emptyResult.output).toBe('');
  expect(emptyResult.mutated).toBe(false);
  expect((await executeHvyCliCommand(document, session, 'man xargs')).output).toContain('COMMAND | xargs [-0] [-r] [-I TOKEN] COMMAND ARG...');
});

test('cli cp -r copies component directories with the destination id', async () => {
  const document = createResumeCliTestDocument();
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(
    document,
    session,
    'cp -r /body/skills/component-list-1/component-list/skill-llm-prompt-engineering /body/skills/component-list-1/component-list/skill-baking'
  );

  expect(result.mutated).toBe(true);
  expect(result.output).toBe('/body/skills/component-list-1/component-list/skill-llm-prompt-engineering -> /body/skills/component-list-1/component-list/skill-baking: copied');
  expect((await executeHvyCliCommand(document, session, 'cat /body/skills/component-list-1/component-list/skill-baking/skill-record.json')).output).toContain(
    '"id": "skill-baking"'
  );
  expect((await executeHvyCliCommand(document, session, 'cat /body/skills/component-list-1/component-list/skill-baking/skill-record.txt')).output).toContain(
    'LLM Prompt Engineering'
  );
  expect((await executeHvyCliCommand(document, session, 'man cp')).output).toContain('cp [-r] SOURCE DEST');
});

test('cli treats rg || true before a pipe as an xargs-friendly fallback idiom', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"intro"}-->
 Uses TypeScript packages
`, '.hvy');
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(
    document,
    session,
    'rg -l --hidden --no-ignore -S "TypeScript" || true | xargs -r sed -i -E \'s/([,\\/ ]*)TypeScript([,\\/ ]*)/\\1\\2/g\' && echo "Removed references to TypeScript" > scratchpad.txt'
  );

  expect(result.mutated).toBe(true);
  expect(result.output).toBe('/scratchpad.txt: written');
  expect(document.sections[0]?.blocks[0]?.text).toBe('Uses  packages');
  expect(session.scratchpadContent).toBe('Removed references to TypeScript\n');
});

test('cli pipes app stdout to the next app stdin for xargs edits', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"intro"}-->
 TypeScript uses shared packages
`, '.hvy');
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(
    document,
    session,
    'rg -l "TypeScript" -S | xargs -r sed -i.bak s/TypeScript//g && echo "Removed references to TypeScript" > scratchpad.txt'
  );

  expect(result.mutated).toBe(true);
  expect(result.output).toBe('/scratchpad.txt: written');
  expect(document.sections[0]?.blocks[0]?.text).toBe(' uses shared packages');
  expect(session.scratchpadContent).toBe('Removed references to TypeScript\n');
});

test('cli supports grep tr xargs sed delete shell flow', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"intro"}-->
 Keep this
TypeScript should be deleted
Keep that
`, '.hvy');
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(
    document,
    session,
    'grep -RIl "TypeScript" . | tr \'\\n\' \'\\0\' | xargs -0 sed -i \'/TypeScript/d\' && echo "Removed TypeScript references from resume files" >> /scratchpad.txt'
  );

  expect(result.output).toBe('/scratchpad.txt: appended');
  expect(result.mutated).toBe(true);
  expect(document.sections[0]?.blocks[0]?.text).toBe('Keep this\nKeep that');
  expect(session.scratchpadContent).toContain('Removed TypeScript references from resume files');
});

test('cli supports rg hidden no-messages null xargs sed delete shell flow', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"intro"}-->
 Keep this
TypeScript should be deleted
Keep that
`, '.hvy');
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(
    document,
    session,
    'rg -l --hidden --no-messages "TypeScript" | tr \'\\n\' \'\\0\' | xargs -0 sed -i \'/TypeScript/d\' && echo "Removed TypeScript references from files" >> /scratchpad.txt'
  );

  expect(result.output).toBe('/scratchpad.txt: appended');
  expect(result.mutated).toBe(true);
  expect(document.sections[0]?.blocks[0]?.text).toBe('Keep this\nKeep that');
  expect(session.scratchpadContent).toContain('Removed TypeScript references from files');
});

test('cli supports sed delete flags and stderr dev null redirection', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"intro"}-->
 Keep this
typescript should be deleted
Keep that
`, '.hvy');
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(
    document,
    session,
    'rg -l --hidden -S -i "TypeScript" / | xargs -r sed -i \'/TypeScript/Id\' && rm -r /body/missing 2>/dev/null || true && echo "Removed TypeScript entries and directory" >> /scratchpad.txt'
  );

  expect(result.output).toBe('/scratchpad.txt: appended');
  expect(result.mutated).toBe(true);
  expect(document.sections[0]?.blocks[0]?.text).toBe('Keep this\nKeep that');
  expect(session.scratchpadContent).toContain('Removed TypeScript entries and directory');
});

test('cli lists text filters as supported commands', async () => {
  const document = createCliTestDocument();
  const session = createHvyCliSession();

  expect((await executeHvyCliCommand(document, session, 'help')).output).toContain(
    'Commands: cd, pwd, ls, cat, head, tail, nl, find, rg, grep, sort, uniq, wc, tr, xargs, cp, rm, echo, sed, true, hvy. Ask: ask QUESTION. Finish: done SUMMARY.'
  );
  expect((await executeHvyCliCommand(document, session, 'man wc')).output).toContain('wc -l [FILE...]');
  expect((await executeHvyCliCommand(document, session, 'man uniq')).output).toContain('uniq [FILE...]');
  expect((await executeHvyCliCommand(document, session, 'man tr')).output).toContain('tr SET1 SET2');
  expect((await executeHvyCliCommand(document, session, 'man ask')).output).toContain('ask QUESTION');
  expect((await executeHvyCliCommand(document, session, 'ask "Which section?"')).output).toBe('Which section?');
  expect((await executeHvyCliCommand(document, session, 'man done')).output).toContain('done SUMMARY');
});

test('hvy request_structure lists component directories and custom definitions', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: skill-card
    baseType: xref-card
    description: Skill card
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"intro"}-->
 Hello

<!--hvy:component-list {"componentListComponent":"text"}-->

 <!--hvy:component-list:0 {}-->

  <!--hvy:text {}-->
   Nested anonymous text

 <!--hvy:component-list:1 {}-->

  <!--hvy:text {}-->
   Second anonymous text

 <!--hvy:component-list:2 {}-->

  <!--hvy:text {}-->
   Third anonymous text

<!--hvy:xref-card {"id":"typescript-card","xrefTitle":"TypeScript","xrefTarget":"tool-typescript"}-->

<!--hvy:xref-card {"xrefTitle":"Python","xrefTarget":"tool-python"}-->

<!--hvy:skill-card {"id":"library-card","xrefTitle":"Library Development","xrefTarget":"skill-library-development"}-->
`, '.hvy');
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(document, session, 'hvy request_structure');

  expect(result.mutated).toBe(false);
  expect(result.output).toContain('Custom types use their base type code.');
  expect(result.output).toContain('- skill-card baseType=xref-card - Skill card');
  expect(result.output).toContain('Components:');
  expect(result.output).toContain('/body\n  /summary');
  expect(result.output).toContain('/intro\n      [x] text.txt id=intro');
  expect(result.output).toMatch(/\/component-list-\d+\n      \[l\] component-list\.txt id=C\d+\n      \/component-list\n        \/text-\d+\n          \[x\] text\.txt id=C\d+/);
  expect(result.output).toContain('/typescript-card\n      [r] xref-card.txt id=typescript-card');
  expect(result.output).toMatch(/\/xref-card-\d+\n      \[r\] xref-card\.txt id=C\d+/);
  expect(result.output).toContain('/library-card\n      [r] skill-card.txt id=library-card');
  expect(result.output.indexOf('/intro')).toBeLessThan(result.output.indexOf('/component-list-'));
  expect(result.output.indexOf('/component-list-')).toBeLessThan(result.output.indexOf('/typescript-card'));
  expect(result.output.indexOf('/typescript-card')).toBeLessThan(result.output.indexOf('/library-card'));

  const collapsed = await executeHvyCliCommand(document, session, 'hvy request_structure --collapse');
  expect(collapsed.output).toContain('/body\n  /summary');
  expect(collapsed.output).toContain('/intro [x] text.txt id=intro');
  expect(collapsed.output).toMatch(/\/component-list-\d+ \[l\] component-list\.txt id=C\d+ \(\+3 anonymous descendants\)/);
  expect(collapsed.output).not.toMatch(/\/text-\d+\.\.text-\d+ \[x\] text\.txt ids=C\d+-C\d+/);
  expect(collapsed.output).toMatch(/\/xref-card-\d+ \[r\] xref-card\.txt id=C\d+/);

  const scoped = await executeHvyCliCommand(document, session, 'hvy request_structure typescript-card');
  expect(scoped.output).toContain('/body\n  /summary\n    /typescript-card\n      [r] xref-card.txt id=typescript-card');
  expect(scoped.output).not.toContain('/intro');
});

test('collapsed request_structure keeps the example resume under 100 lines', async () => {
  const document = createResumeCliTestDocument();
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(document, session, 'hvy request_structure --collapse');

  expect(result.output.split('\n').length).toBeLessThanOrEqual(100);
  expect(result.output).toContain('/body');
  expect(result.output).toContain('/summary');
  expect(result.output).toContain('(+');
});

test('hvy find-intent ranks global skill library and top skills above local skill lists', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: skills-and-tools-tech-list
    baseType: grid
    description: Local skills and tools list
  - name: skill-record
    baseType: expandable
    description: Reusable skill record
---

<!--hvy: {"id":"skills","description":"Main reusable skills library."}-->
#! Skills

<!--hvy:component-list {"id":"skill-list","componentListComponent":"skill-record","description":"Ordered list of reusable skill records."}-->

<!--hvy:skill-record {"id":"skill-software-engineering"}-->
Software Engineering

<!--hvy: {"id":"top-skills-tools-technologies","description":"Featured top skills and tools."}-->
#! Top Skills, Tools & Technologies

<!--hvy:grid {"id":"top-grid","description":"Featured top skills/tools grid."}-->

<!--hvy:xref-card {"id":"software-card","xrefTitle":"Software Engineering","xrefTarget":"skill-software-engineering"}-->

<!--hvy: {"id":"projects"}-->
#! Projects

<!--hvy:skills-and-tools-tech-list {"id":"project-skills","description":"Per-project supporting skills list."}-->

<!--hvy: {"id":"history"}-->
#! History

<!--hvy:skills-and-tools-tech-list {"id":"history-skills","description":"Per-job supporting skills list."}-->
`, '.hvy');
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(document, session, 'hvy find-intent "add baking as a top skill" --max 5');

  const skillListIndex = result.output.indexOf('/body/skills/skill-list');
  const topGridIndex = result.output.indexOf('/body/top-skills-tools-technologies/top-grid');
  const projectSkillsIndex = result.output.indexOf('/body/projects/project-skills');
  const historySkillsIndex = result.output.indexOf('/body/history/history-skills');
  expect(skillListIndex).toBeGreaterThan(-1);
  expect(topGridIndex).toBeGreaterThan(-1);
  expect(skillListIndex).toBeLessThan(topGridIndex);
  expect(projectSkillsIndex === -1 || topGridIndex < projectSkillsIndex).toBe(true);
  expect(historySkillsIndex === -1 || topGridIndex < historySkillsIndex).toBe(true);
  expect(result.output).toContain('likely main skills library edit surface');
  expect(result.output).toContain('likely featured top skills/tools surface');
});

test('hvy find-intent includes descriptions and supports json output', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"planning","description":"Roadmap and planning notes."}-->
#! Planning

<!--hvy:text {"id":"roadmap","description":"Quarterly roadmap notes."}-->
Milestones
`, '.hvy');
  const session = createHvyCliSession();

  const text = await executeHvyCliCommand(document, session, 'hvy find-intent roadmap --max 1');
  const json = await executeHvyCliCommand(document, session, 'hvy find-intent roadmap --max 1 --json');

  expect(text.output).toContain('description: Quarterly roadmap notes.');
  expect(JSON.parse(json.output)).toEqual([
    expect.objectContaining({
      path: '/body/planning/roadmap',
      id: 'roadmap',
      kind: 'component',
      type: 'text',
      description: 'Quarterly roadmap notes.',
    }),
  ]);
});

test('hvy request_structure --describe includes non-empty descriptions', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"planning","description":"Roadmap and planning notes."}-->
#! Planning

<!--hvy:text {"id":"roadmap","description":"Quarterly roadmap notes."}-->
Milestones
`, '.hvy');
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(document, session, 'hvy request_structure --describe');

  expect(result.output).toContain('/planning - Roadmap and planning notes.');
  expect(result.output).toContain('[x] text.txt id=roadmap - Quarterly roadmap notes.');
});

test('hvy lint reports core component and plugin issues', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"empty-section"}-->
#! Empty Section

<!--hvy: {"id":"quality"}-->
#! Quality

<!--hvy:text {"id":"empty-note"}-->

<!--hvy:quote {"id":"empty-quote"}-->

<!--hvy:code {"id":"empty-code","codeLanguage":"ts"}-->

<!--hvy:xref-card {"id":"empty-ref"}-->

<!--hvy:table {"id":"chores","tableColumns":"A,B","tableRows":[{"cells":["",""]},{"cells":["Done","Mom"]}]}-->

<!--hvy:component-list {"id":"empty-list","componentListComponent":"text"}-->

<!--hvy:plugin {"id":"broken-db","plugin":"dev.heavy.db-table","pluginConfig":{}}-->

<!--hvy:plugin {"id":"missing-db","plugin":"dev.heavy.db-table","pluginConfig":{"table":"missing_table"}}-->

<!--hvy:plugin {"id":"empty-script","plugin":"dev.heavy.scripting","pluginConfig":{"version":"0.1"}}-->

<!--hvy:plugin {"id":"passive-form","plugin":"dev.heavy.form","pluginConfig":{"version":"0.1"}}-->
fields:
  - name: chore
    label: Chore
    type: text
submitLabel: Add chore
`, '.hvy');
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(document, session, 'hvy lint');

  expect(result.output).toContain('Lint issues: 12');
  expect(result.output).toContain('[section] /body/empty-section - section has no content.');
  expect(result.output).toContain('[text] /body/quality/empty-note - text body is empty.');
  expect(result.output).toContain('[quote] /body/quality/empty-quote - quote body is empty.');
  expect(result.output).toContain('[code] /body/quality/empty-code - code block body is empty.');
  expect(result.output).toContain('[xref-card] /body/quality/empty-ref - xref-card is missing xrefTitle.');
  expect(result.output).toContain('[xref-card] /body/quality/empty-ref - xref-card is missing xrefTarget.');
  expect(result.output).toContain('[table] /body/quality/chores - table row 1 is empty.');
  expect(result.output).toContain('[component-list] /body/quality/empty-list - component-list has no items.');
  expect(result.output).toContain('[plugin] /body/quality/broken-db - db-table plugin is missing pluginConfig.table.');
  expect(result.output).toContain('[plugin] /body/quality/missing-db - db-table pluginConfig.table references missing SQLite table/view "missing_table".');
  expect(result.output).toContain('[plugin] /body/quality/empty-script - scripting plugin body is empty; expected Brython/Python source.');
  expect(result.output).toContain('[plugin] /body/quality/passive-form - form has a submit button but no submitScript.');
});

test('deserializing custom resume components does not warn about missing app state', () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

  createResumeCliTestDocument();

  expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('[hvy:component-defs]'));
  consoleError.mockRestore();
});

test('cli commands can create a chore chart with tables and form plugins', async () => {
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
  const session = createHvyCliSession();
  const run = (command: string) => executeHvyCliCommand(document, session, command);

  expect((await run('hvy add section /body chore-chart "Chore Chart"')).output).toBe('/body/chore-chart');
  await run('hvy add text /chore-chart overview "Track active chores, assignments, completion forms, and weekly leaders."');
  await run(
    'hvy add table /chore-chart active-chores "Chore,Dad,Mom,Child" --row "Dishes,,,Child" --row "Trash,Dad,," --row "Laundry,,Mom,"'
  );
  await run('hvy add plugin form /chore-chart add-chore-form "Add chore" "description:Description:textarea:required"');
  await run('hvy add plugin form /chore-chart assign-chore-form "Assign chore" "chore:Chore:text:required" "assignee:Assignee:select:required:Dad|Mom|Child"');
  await run(
    'hvy add plugin form /chore-chart complete-chore-form "Complete chore" "chore:Chore:text:required" "completed_by:Completed by:select:required:Dad|Mom|Child"'
  );
  await run('hvy add plugin db-table /chore-chart weekly-leaders weekly_chore_leaders "SELECT person, completed_count FROM weekly_chore_leaders ORDER BY completed_count DESC"');

  expect((await run('find /chore-chart -name plugin.txt')).output).toContain('/body/chore-chart/add-chore-form/plugin.txt');
  expect((await run('cat /chore-chart/active-chores/table.json')).output).toContain('"tableColumns": "Chore,Dad,Mom,Child"');
  expect((await run('cat /chore-chart/assign-chore-form/plugin.txt')).output).toContain('submitLabel: Assign chore');
  expect((await run('cat /chore-chart/weekly-leaders/plugin.json')).output).toContain('"table": "weekly_chore_leaders"');

  const serialized = serializeDocument(document);
  expect(serialized).toContain('<!--hvy:plugin {"id":"assign-chore-form","plugin":"dev.heavy.form"');
  expect(serialized).toContain('<!--hvy:plugin {"id":"weekly-leaders","plugin":"dev.heavy.db-table"');
  expect(serialized).toContain('"tableRows":[{"cells":["Dishes","","","Child"]}');
});

test('hvy plugin db-table help leads with show and keeps add as an alias', async () => {
  const document = createCliTestDocument();
  const session = createHvyCliSession();

  const help = (await executeHvyCliCommand(document, session, 'man hvy plugin db-table')).output;

  expect(help).toContain('hvy add plugin db-table SECTION_PATH ID TABLE [QUERY]');
  expect(help).toContain('Legacy alias: db-table show/add');
  expect(help).toContain('hvy plugin db-table query [SELECT/WITH SQL]');
  expect(help).toContain('hvy plugin db-table exec [CREATE / INSERT / UPDATE / DELETE / DROP SQL]');
});

test('hvy help lists registered plugin add and operation commands as quick-reference options', async () => {
  const document = createCliTestDocument();
  const session = createHvyCliSession();

  const help = (await executeHvyCliCommand(document, session, 'man hvy')).output;

  expect(help).toContain('hvy add plugin form SECTION_PATH ID SUBMIT_BUTTON_LABEL FIELD...');
  expect(help).toContain('hvy add plugin db-table SECTION_PATH ID TABLE [QUERY]');
  expect(help).toContain('hvy plugin db-table query [SELECT/WITH SQL]');
  expect(help).toContain('hvy plugin db-table exec [CREATE / INSERT / UPDATE / DELETE / DROP SQL]');
  expect(help).toContain('hvy plugin db-table tables');
  expect(help).toContain('hvy plugin db-table schema [TABLE_OR_VIEW]');
  expect(help).not.toContain('Try `man hvy plugin`');
});

test('hvy plugin form help explains script and submit options', async () => {
  const document = createCliTestDocument();
  const session = createHvyCliSession();

  const help = (await executeHvyCliCommand(document, session, 'man hvy plugin form')).output;

  expect(help).toContain('hvy add plugin form SECTION_PATH ID SUBMIT_BUTTON_LABEL FIELD... [--script NAME PYTHON] [--on-submit-script NAME]');
  expect(help).toContain('--script NAME PYTHON\n  Store a named Python script');
  expect(help).toContain('--on-submit-script NAME\n  Run that named script when the submit button is pressed');
  expect(help).toContain('Example: hvy add plugin form /chores add-chore');
});

test('registered plugin help topics work without special-case command handlers', async () => {
  const document = createCliTestDocument();
  const session = createHvyCliSession();

  const manHelp = (await executeHvyCliCommand(document, session, 'man hvy plugin scripting')).output;
  const directHelp = (await executeHvyCliCommand(document, session, 'hvy plugin scripting')).output;

  expect(manHelp).toContain('hvy add plugin SECTION_PATH ID dev.heavy.scripting --config {"version":"0.1"} --body PYTHON');
  expect(manHelp).toContain('The component body is top-level Python/Brython source with one injected global: doc.');
  expect(manHelp).toContain('Document tools: request_structure, grep, view_component');
  expect(manHelp).toContain('Not exposed through doc.tool: edit_component, view_rendered_component, query_db_table, execute_sql');
  expect(manHelp).toContain('Example: summary = doc.tool("request_structure"); doc.header.set("script_summary", summary[:200])');
  expect(manHelp).toContain('For a specific doc.tool shape, run: man hvy plugin scripting tool TOOL_NAME');
  expect(directHelp).toBe(manHelp);
});

test('scripting plugin help can show one doc.tool shape at a time', async () => {
  const document = createCliTestDocument();
  const session = createHvyCliSession();

  const grepHelp = (await executeHvyCliCommand(document, session, 'man hvy plugin scripting tool grep')).output;
  const directHelp = (await executeHvyCliCommand(document, session, 'hvy plugin scripting tool patch_header')).output;
  const listHelp = (await executeHvyCliCommand(document, session, 'man hvy plugin scripting tool')).output;

  expect(grepHelp).toContain('hvy plugin scripting tool grep');
  expect(grepHelp).toContain('Use from Brython as: doc.tool("grep", args_dict)');
  expect(grepHelp).toContain('{"tool":"grep","query":"Python|TypeScript"');
  expect(directHelp).toContain('Use from Brython as: doc.tool("patch_header", args_dict)');
  expect(directHelp).toContain('{"tool":"patch_header","edits"');
  expect(listHelp).toContain('Available tools: request_structure, grep, view_component');
});

test('db-table cli can execute modifying SQL and query rows', async () => {
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
  const session = createHvyCliSession();

  const createResult = await executeHvyCliCommand(
    document,
    session,
    'hvy plugin db-table exec "CREATE TABLE chores (id INTEGER PRIMARY KEY, title TEXT NOT NULL)"'
  );
  expect(createResult.mutated).toBe(true);
  expect(createResult.output).toContain('Executed: CREATE TABLE chores');

  await executeHvyCliCommand(document, session, 'hvy plugin db-table exec "INSERT INTO chores (title) VALUES (\'Dishes\')"');

  const queryResult = await executeHvyCliCommand(document, session, 'hvy plugin db-table query "SELECT title FROM chores"');
  expect(queryResult.mutated).toBe(false);
  expect(queryResult.output).toContain('Executed query: SELECT title FROM chores');
  expect(queryResult.output).toContain('Dishes');

  expect((await executeHvyCliCommand(document, session, 'hvy plugin db-table tables')).output).toContain('chores');
  expect((await executeHvyCliCommand(document, session, 'hvy plugin db-table schema chores')).output).toContain('title');
});
