import { expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createHvyCliSession, executeHvyCliCommand } from '../src/cli-core/commands';
import { formPluginRegistration } from '../src/plugins/form';
import { setHostPlugins } from '../src/plugins/registry';
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
  expect((await executeHvyCliCommand(document, session, 'ls /body/summary')).output).toContain('file about-section.txt [ro]');
  expect((await executeHvyCliCommand(document, session, 'ls /body/summary')).output).toContain('file section-info.txt [ro]');
  expect((await executeHvyCliCommand(document, session, 'ls /body/summary')).output).toContain('type name [editable] | description | preview');
  expect((await executeHvyCliCommand(document, session, 'ls /body/summary')).output).toContain(
    'type name [editable] | description | preview\nfile section.json [w]'
  );
  expect((await executeHvyCliCommand(document, session, 'ls /')).output).toContain('dir  body | document body sections and components');
  expect((await executeHvyCliCommand(document, session, 'ls /body')).output).toContain('file children-order.json [w] | top-level section order');
  expect((await executeHvyCliCommand(document, session, 'ls /body')).output).toContain('dir  summary | section');
  expect((await executeHvyCliCommand(document, session, 'ls /')).output).toContain('file header.yaml [w] | document metadata YAML');
  expect((await executeHvyCliCommand(document, session, 'ls /')).output).toContain('file scratchpad.txt [w] | ephemeral AI task notes');
  expect((await executeHvyCliCommand(document, session, 'ls /body/summary')).output).toContain('dir  intro | text component | Hello world');
  expect((await executeHvyCliCommand(document, session, 'cat /body/summary/about-section.txt')).output).toContain(
    '# Sections #'
  );
  expect((await executeHvyCliCommand(document, session, 'cat /body/summary/section-info.txt')).output).toContain(
    '# Sections #'
  );
  expect((await executeHvyCliCommand(document, session, 'cat /body/summary/section-info.txt')).output).toContain('This section');
  expect((await executeHvyCliCommand(document, session, 'cat /body/summary/section-info.txt')).output).toContain('name: Summary');
  expect((await executeHvyCliCommand(document, session, 'cat /body/summary/section-info.txt')).output).toContain('section nesting level: 1');
  expect((await executeHvyCliCommand(document, session, 'ls /body/summary/intro')).output).toContain('file text.txt [w]');
  expect((await executeHvyCliCommand(document, session, 'ls /body/summary/intro')).output).toContain('file about-text.txt [ro]');
  expect((await executeHvyCliCommand(document, session, 'cat intro/text.txt')).output).toBe('Hello world');
  expect((await executeHvyCliCommand(document, session, 'cat intro/text.json')).output).toContain('"css": "margin: 0.5rem 0;"');
  expect((await executeHvyCliCommand(document, session, 'cat intro/about-text.txt')).output).toContain('# Text Components #');
  expect((await executeHvyCliCommand(document, session, 'man ls')).output).toContain('stable entries include pipe-delimited descriptions.');
});

test('about-section includes the section metadata description when present', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"history","description":"Work history section. Keep entries reverse chronological."}-->
#! History
`, '.hvy');
  const session = createHvyCliSession();

  const about = await executeHvyCliCommand(document, session, 'cat /body/history/about-section.txt');

  expect(about.output).toContain('Section description:');
  expect(about.output).toContain('Work history section. Keep entries reverse chronological.');
  expect(about.output).toContain('# Sections #');
});

test('cli accepts shell commands prefixed with hvy', async () => {
  const document = createCliTestDocument();
  const session = createHvyCliSession();

  expect((await executeHvyCliCommand(document, session, 'hvy ls /body/summary')).output).toContain('dir  intro');
  expect((await executeHvyCliCommand(document, session, 'hvy cat /body/summary/intro/text.txt')).output).toBe('Hello world');
  expect((await executeHvyCliCommand(document, session, 'hvy nl -ba /body/summary/intro/text.txt')).output).toContain('Hello world');

  const updated = await executeHvyCliCommand(document, session, 'hvy sed -i s/world/there/ /body/summary/intro/text.txt');
  expect(updated.output).toBe('/body/summary/intro/text.txt: updated');
  expect(document.sections[0]?.blocks[0]?.text).toBe('Hello there');
});

test('cli resolves component directories for common read commands', async () => {
  const document = createResumeCliTestDocument();
  const session = createHvyCliSession();

  const catDirectory = await executeHvyCliCommand(document, session, 'cat /body/skills/component-list-1/skill-software-engineering');
  expect(catDirectory.output).toContain('Software Engineering');
  expect(catDirectory.output).toContain('#### Description');

  const catTxtAlias = await executeHvyCliCommand(document, session, 'cat /body/skills/component-list-1/skill-software-engineering.txt');
  expect(catTxtAlias.output).toContain('Software Engineering');

  const numbered = await executeHvyCliCommand(document, session, 'nl -ba /body/skills/component-list-1/skill-software-engineering');
  expect(numbered.output).toContain('     1\tSoftware Engineering');

  const head = await executeHvyCliCommand(document, session, 'head -n 1 /body/top-skills-tools-technologies/grid-0');
  expect(head.output).toContain('## Skills');
});

test('cli exposes form scripts and scripting plugin bodies as python files', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"automation"}-->
#! Automation

<!--hvy:plugin {"id":"startup","plugin":"dev.heavy.scripting","pluginConfig":{"version":"0.1"}}-->
doc.header.set("started", True)

<!--hvy:plugin {"id":"assign","plugin":"dev.heavy.form","pluginConfig":{"version":"0.1","initialScript":"load","submitScript":"submit"}}-->
fields:
  - label: Chore
    type: select
scripts:
  load: |
    rows = doc.db.query("SELECT id, title FROM chores", [])
    doc.form.set_options("Chore", [{"label": row["title"], "value": str(row["id"])} for row in rows])
  submit: |
    chore = doc.form.get_value("Chore")
`, '.hvy');
  const session = createHvyCliSession();

  expect((await executeHvyCliCommand(document, session, 'ls /body/automation/startup')).output).toContain('file script.py');
  expect((await executeHvyCliCommand(document, session, 'cat /body/automation/startup')).output).toContain('doc.header.set("started", True)');
  expect((await executeHvyCliCommand(document, session, 'hvy request_structure startup')).output).toContain('script.py id=startup');

  const listForm = await executeHvyCliCommand(document, session, 'ls /body/automation/assign');
  expect(listForm.output).toContain('file load.py');
  expect(listForm.output).toContain('file submit.py');
  expect((await executeHvyCliCommand(document, session, 'cat /body/automation/assign/load.py')).output).toContain('doc.form.set_options("Chore"');

  const updated = await executeHvyCliCommand(document, session, 'echo "doc.form.set_options(\\"Chore\\", [])" > /body/automation/assign/load.py');
  expect(updated.output).toBe('/body/automation/assign/load.py: written');
  expect((await executeHvyCliCommand(document, session, 'cat /body/automation/assign/plugin.txt')).output).toContain('load: |');
  expect((await executeHvyCliCommand(document, session, 'cat /body/automation/assign/plugin.txt')).output).toContain('doc.form.set_options("Chore", [])');
});

test('cli exposes plugin-registered documentation files next to plugin virtual files', async () => {
  setHostPlugins([formPluginRegistration]);
  try {
    const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"automation"}-->
#! Automation

<!--hvy:plugin {"id":"assign","plugin":"dev.heavy.form","pluginConfig":{"version":"0.1","submitLabel":"Assign"}}-->
fields:
  - label: Chore
    type: select
`, '.hvy');
    const session = createHvyCliSession();

    const listing = await executeHvyCliCommand(document, session, 'ls /body/automation/assign');
    const docs = await executeHvyCliCommand(document, session, 'cat /body/automation/assign/about-form.txt');

    expect(listing.output).toContain('file about-plugin.txt [ro]');
    expect(listing.output).toContain('file about-form.txt [ro]');
    expect(docs.output).toContain('# Form Plugins #');
    expect(docs.output).toContain('Fields live in plugin.txt as YAML under the fields key.');
  } finally {
    setHostPlugins([]);
  }
});

test('hvy append-child section explains when the parent path is a component', async () => {
  const document = createResumeCliTestDocument();
  const session = createHvyCliSession();

  await expect(executeHvyCliCommand(
    document,
    session,
    'hvy append-child section /body/top-skills-tools-technologies/grid-0 top-skill-baking Baking'
  )).rejects.toThrow(
    'hvy append-child section: sections must be added at the root level or on top of an existing section. /body/top-skills-tools-technologies/grid-0 is a component, not a section.'
  );

  await expect(executeHvyCliCommand(
    document,
    session,
    'hvy append-child section /body/skills/component-list-1 skill-baking Baking'
  )).rejects.toThrow(
    'hvy append-child section: sections must be added at the root level or on top of an existing section. /body/skills/component-list-1 is a component, not a section.'
  );
});

test('hvy append-child section treats slash as the document body root', async () => {
  const document = createCliTestDocument();
  const session = createHvyCliSession();

  const section = await executeHvyCliCommand(document, session, 'hvy append-child section / chore-chart "Chore Chart"');
  const table = await executeHvyCliCommand(document, session, 'hvy append-child table /chore-chart chores "chore,description,dad,mom,child" --row "Dishes,Wash dishes after dinner, , ,"');

  expect(section.output).toBe('/body/chore-chart');
  expect(table.output).toContain('/body/chore-chart/chores: created');
  expect(document.sections.at(-1)?.customId).toBe('chore-chart');
  expect(document.sections.at(-1)?.blocks[0]?.schema.component).toBe('table');
});

test('ls keeps custom component directories to file listings without schema preview noise', async () => {
  const document = createResumeCliTestDocument();
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(document, session, 'ls /body/skills/component-list-1/skill-software-engineering');

  expect(result.output).toContain('dir  expandable-content');
  expect(result.output).toContain('file about-skill-record.txt [ro] | documentation for reusable component type and schema');
  expect(result.output).toContain('file skill-record.json');
  expect(result.output).not.toContain('skill-record-info.txt');
  expect(result.output).not.toContain('Custom component definition:');
  expect(result.output).not.toContain('expandableContentBlocks:');
});

test('cli exposes reusable component documentation in about files', async () => {
  const document = createResumeCliTestDocument();
  const session = createHvyCliSession();

  const about = await executeHvyCliCommand(
    document,
    session,
    'cat /body/skills/component-list-1/skill-software-engineering/about-skill-record.txt'
  );

  expect(about.output).toContain('About skill-record');
  expect(about.output).toContain('reusable component: skill-record');
  expect(about.output).toContain('base component: expandable');
  expect(about.output).toContain('Edit this reusable component definition in /header.yaml under component_defs.');
  expect(about.output).toContain('Reusable definition YAML:');
  expect(about.output).toContain('```yaml');
  expect(about.output).toContain('- name: skill-record');
  expect(about.output).toContain('description: Canonical expandable record for one skill, tool, or technology');
  expect(about.output).toContain('Virtual directory mapping:');
  expect(about.output).toContain('- /skill-record contains one skill-record component instance.');
  expect(about.output).toContain('- expandable-stub/ contains the always-visible summary children.');
  expect(about.output).toContain('- expandable-content/ contains the revealed detail children.');
  expect(about.output).toContain('# Expandable Components #');
});

test('ls shows nested component description context for selected component directories', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: history-record
    baseType: expandable
    description: One expandable work-history role at one organization.
---

<!--hvy: {"id":"history","description":"Work history is reverse chronological."}-->
#! History

<!--hvy:component-list {"id":"history-list","componentListComponent":"history-record","description":"List of organization role records."}-->

 <!--hvy:history-record {"id":"history-acme","description":"Acme role details."}-->
  Acme
`, '.hvy');
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(document, session, 'ls /body/history/history-list/history-acme');

  expect(result.output).toContain('Component context:');
  expect(result.output).toContain('/body/history section id=history');
  expect(result.output).toContain('description: Work history is reverse chronological.');
  expect(result.output).toContain('/body/history/history-list component-type: component-list id=history-list');
  expect(result.output).toContain('list item custom-type: history-record base-type: expandable');
  expect(result.output).toContain('/body/history/history-list/history-acme custom-type: history-record base-type: expandable id=history-acme');
  expect(result.output).toContain('description: Acme role details.');
  expect(result.output).toContain('reusable definition: One expandable work-history role at one organization.');
  expect(result.output.indexOf('/body/history/history-list/history-acme')).toBeLessThan(
    result.output.indexOf('/body/history/history-list component-type: component-list')
  );
  expect(result.output.indexOf('/body/history/history-list component-type: component-list')).toBeLessThan(
    result.output.indexOf('/body/history section id=history')
  );
});

test('component hints tell agents to add component-list items blank before filling fields', async () => {
  const { buildChatCliComponentHints } = await import('../src/chat-cli/chat-cli-component-hints');
  const document = deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: history-record
    baseType: expandable
    description: One expandable work-history role at one organization.
---

<!--hvy: {"id":"history","description":"Work history is reverse chronological."}-->
#! History

<!--hvy:component-list {"id":"history-list","componentListComponent":"history-record","description":"List of organization role records."}-->

 <!--hvy:history-record {"id":"history-acme"}-->
  Acme
`, '.hvy');

  const componentListHint = buildChatCliComponentHints({
    document,
    cwd: '/',
    command: 'cat /body/history/history-list.txt',
  });
  const reusableItemHint = buildChatCliComponentHints({
    document,
    cwd: '/',
    command: 'cat /body/history/history-list/history-acme/history-record.txt',
  });

  expect(componentListHint).toContain('optional list-item creation: hvy append-child history-record /body/history/history-list --id NEW_ID');
  expect(componentListHint).toContain('after creating a list item, inspect it with hvy request_structure NEW_ID --describe');
  expect(componentListHint).toContain('component-list.txt is a text preview of existing leaf items');
  expect(reusableItemHint).toContain('optional blank sibling creation: hvy append-child history-record /body/history/history-list --id NEW_ID');
  expect(reusableItemHint).toContain('after creating a reusable component, inspect it with hvy request_structure NEW_ID --describe');
  expect(componentListHint).not.toContain('"Title"');
  expect(reusableItemHint).not.toContain('"Title"');
});

test('ls shows section descriptions from section metadata', async () => {
  const document = createResumeCliTestDocument();
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(document, session, 'ls /body/top-skills-tools-technologies');

  expect(result.output).toContain('Component context:');
  expect(result.output).toContain('/body/top-skills-tools-technologies section id=top-skills-tools-technologies');
  expect(result.output).toContain('description: Featured top skills, tools, and technologies shown near the top of the resume.');
});

test('hvy help append-child explains component creation commands', async () => {
  const document = createResumeCliTestDocument();
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(document, session, 'hvy help append-child');

  expect(result.output).toContain('hvy append-child component PARENT_PATH ID COMPONENT [TEXT] [--config JSON]');
  expect(result.output).toContain('hvy append-child COMPONENT PARENT_PATH --id ID [TEXT] [--config JSON]');
});

test('hvy append-child can create custom components and generic xref components', async () => {
  const document = createResumeCliTestDocument();
  const session = createHvyCliSession();

  const skill = await executeHvyCliCommand(
    document,
    session,
    'hvy append-child skill-record /body/skills/component-list-1 --id skill-baking Baking'
  );
  const xref = await executeHvyCliCommand(
    document,
    session,
    'hvy append-child component /body/top-skills-tools-technologies/grid-0/grid top-skill-baking xref-card Baking --config \'{"xrefTarget":"skill-baking"}\''
  );

  expect(skill.output).toContain('/body/skills/component-list-1/skill-baking: created');
  expect(skill.output).toContain('file skill-record.json');
  expect(skill.output).toContain('file skill-record.txt');
  expect(skill.output).toContain('order:\n  New list items are appended by default.');
  expect(skill.output).toContain('To reorder after creation, edit /body/skills/component-list-1/children-order.json.');
  expect(skill.output).toContain('next:\n  hvy request_structure /body/skills/component-list-1/skill-baking --describe');
  expect(skill.output).toContain('Fill the leaf body/config files shown by request_structure.');
  expect(skill.output).toContain('### CREATED CUSTOM COMPONENT ###');
  expect(skill.output).toContain('Successfully created custom component skill-record.');
  expect(skill.output).toContain('Displaying about-skill-record.txt so you know how to inspect this component again.');
  expect(skill.output).toContain('### ABOUT COMPONENT FILE ###\nCMD: cat /body/skills/component-list-1/skill-baking/about-skill-record.txt');
  expect(skill.output).toContain('About skill-record');
  expect(skill.output).toContain('Reusable definition YAML:');
  expect(skill.output).toContain('### END ABOUT COMPONENT FILE ###');
  expect((await executeHvyCliCommand(document, session, 'cat /body/skills/component-list-1/skill-baking/skill-record.json')).output)
    .toContain('"css": "margin: 0.35rem 0; border: 1px solid var(--hvy-border); border-radius: 4px; padding: 0.35rem 0.5rem; background: var(--hvy-surface);"');
  expect(xref.output).toContain('/body/top-skills-tools-technologies/grid-0/grid/top-skill-baking: created');
  expect(xref.output).toContain('file xref-card.json');
  expect(xref.output).toContain('file xref-card.txt');
  expect(xref.output).toContain('order:\n  New grid items are appended by default.');
  expect(xref.output).toContain('To reorder after creation, edit /body/top-skills-tools-technologies/grid-0/grid/children-order.json.');
  expect(xref.output).not.toContain('### CREATED CUSTOM COMPONENT ###');
  expect((await executeHvyCliCommand(document, session, 'cat /body/skills/component-list-1/skill-baking/skill-record.txt')).output)
    .toContain('Baking');
  expect((await executeHvyCliCommand(document, session, 'cat /body/top-skills-tools-technologies/grid-0/grid/top-skill-baking/xref-card.json')).output)
    .toContain('"xrefTarget": "skill-baking"');
});

test('hvy append-child changes cwd to the newly created component', async () => {
  const document = createResumeCliTestDocument();
  const session = createHvyCliSession();

  const created = await executeHvyCliCommand(
    document,
    session,
    'hvy append-child history-record /body/history/component-list-2 --id history-heavy-resume-founder'
  );

  expect(created.cwd).toBe('/body/history/component-list-2/history-heavy-resume-founder');
  expect(session.cwd).toBe('/body/history/component-list-2/history-heavy-resume-founder');
  expect((await executeHvyCliCommand(document, session, 'pwd')).output).toBe('/body/history/component-list-2/history-heavy-resume-founder');
  expect((await executeHvyCliCommand(document, session, 'ls')).output).toContain('file raw.hvy [w]');
});

test('aggregate body write errors explain how to fill nested reusable components', async () => {
  const document = createResumeCliTestDocument();
  const session = createHvyCliSession();
  await executeHvyCliCommand(
    document,
    session,
    'hvy append-child skill-record /body/skills/component-list-1 --id skill-baking Baking'
  );

  await expect(executeHvyCliCommand(
    document,
    session,
    'echo "one\\ntwo" > /body/skills/component-list-1/skill-baking/skill-record.txt'
  )).rejects.toThrow('Use hvy request_structure COMPONENT_ID --describe to find leaf files');
});

test('hvy prepend-child creates custom components at the beginning', async () => {
  const document = createResumeCliTestDocument();
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(
    document,
    session,
    'hvy prepend-child skill-record /body/skills/component-list-1 --id skill-baking Baking'
  );

  expect(result.output).toContain('/body/skills/component-list-1/skill-baking: created');
  expect(result.output).toContain('file skill-record.json');
  expect(result.output).toContain('file skill-record.txt');
  expect((await executeHvyCliCommand(document, session, 'cat /body/skills/component-list-1/children-order.json')).output)
    .toMatch(/skill-baking[\s\S]*skill-software-engineering/);
  expect((await executeHvyCliCommand(document, session, 'cat /body/skills/component-list-1/skill-baking/skill-record.json')).output)
    .toContain('"css": "margin: 0.35rem 0; border: 1px solid var(--hvy-border); border-radius: 4px; padding: 0.35rem 0.5rem; background: var(--hvy-surface);"');
  expect((await executeHvyCliCommand(document, session, 'cat /body/skills/component-list-1/skill-baking/skill-record.txt')).output)
    .toContain('Baking');
});

test('cat custom component bodies stays focused on file content', async () => {
  const document = createResumeCliTestDocument();
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(document, session, 'cat /body/skills/component-list-1/skill-software-engineering/skill-record.txt');

  expect(result.output).toContain('Software Engineering');
  expect(result.output).not.toContain('Custom component definition:');
  expect(result.output).not.toContain('Preview command: hvy request_structure');
  expect(result.output).not.toContain('Component preview switched to request_structure');
});

test('hvy preview switches long raw fragments to request_structure capped at 100 lines', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"details"}-->
#! Details

<!--hvy:component-list {"id":"long-list","componentListComponent":"text"}-->
${Array.from({ length: 110 }, (_, index) => `
 <!--hvy:component-list:${index} {}>

  <!--hvy:text {}>
   Item ${index}
`).join('')}
`, '.hvy');
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(document, session, 'hvy preview /body/details/long-list');

  expect(result.output).toContain('Preview command: hvy request_structure long-list --describe');
  expect(result.output).toContain('Component preview switched to request_structure because raw HVY is');
  expect(result.output).toContain('/long-list');
  expect(result.output.split('\n').length).toBeLessThanOrEqual(103);
});

test('hvy preview shows short raw fragments and the command used', async () => {
  const document = createCliTestDocument();
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(document, session, 'hvy preview /body/summary/intro');

  expect(result.output).toContain('Preview command: hvy preview /body/summary/intro');
  expect(result.output).toContain('Component preview (raw HVY, first 100 lines):');
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

test('cli sed prints file line ranges without mutating', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"intro"}-->
 one
two
three
four
`, '.hvy');
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(document, session, `sed -n '2,3p' /body/summary/intro/text.txt`);

  expect(result.mutated).toBe(false);
  expect(result.output).toBe('two\nthree');
  expect(document.sections[0]?.blocks[0]?.text).toBe('one\ntwo\nthree\nfour');
  expect((await executeHvyCliCommand(document, session, 'man sed')).output).toContain('sed -n START,ENDp FILE...');
});

test('cli sed supports line-addressed edits', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"intro"}-->
 keep
/doc.db.execute("CREATE TABLE chores (id INTEGER)")
drop me
`, '.hvy');
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(document, session, 'sed -i "2s/^\\\\///" /body/summary/intro/text.txt');

  expect(result.output).toBe('/body/summary/intro/text.txt: updated');
  expect(document.sections[0]?.blocks[0]?.text).toBe('keep\ndoc.db.execute("CREATE TABLE chores (id INTEGER)")\ndrop me');

  const deleted = await executeHvyCliCommand(document, session, 'sed -i 3d /body/summary/intro/text.txt');
  expect(deleted.output).toBe('/body/summary/intro/text.txt: updated');
  expect(document.sections[0]?.blocks[0]?.text).toBe('keep\ndoc.db.execute("CREATE TABLE chores (id INTEGER)")');
});

test('cli sed rejects malformed substitute flags before mutating', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"intro"}-->
 optionsQuery: SELECT id || '|' || title AS option
`, '.hvy');
  const session = createHvyCliSession();

  await expect(executeHvyCliCommand(
    document,
    session,
    `sed -i "s|optionsQuery: SELECT id || '|' || title AS option|optionsQuery: SELECT title AS option|" /body/summary/intro/text.txt`
  )).rejects.toThrow('sed: unsupported substitute flags');
  expect(document.sections[0]?.blocks[0]?.text).toBe("optionsQuery: SELECT id || '|' || title AS option");
});

test('cli echo supports shell-style redirection to writable virtual files', async () => {
  const document = createCliTestDocument();
  const session = createHvyCliSession();

  expect((await executeHvyCliCommand(document, session, 'ls /')).output).toContain('file scratchpad.txt');
  expect((await executeHvyCliCommand(document, session, 'cat /scratchpad.txt')).output).toContain('You havent written your plan yet.');
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

test('cli exposes static table body as read-only preview and rejects empty component-list body writes', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"quality"}-->
#! Quality

<!--hvy:table {"id":"chores","tableColumns":"Chore,Owner","tableRows":[{"cells":["Dishes","Mom"]}]}-->

<!--hvy:component-list {"id":"empty-list","componentListComponent":"text"}-->
`, '.hvy');
  const session = createHvyCliSession();

  const listing = await executeHvyCliCommand(document, session, 'ls /body/quality/chores');
  expect(listing.output).toContain('file table.txt [ro]');
  expect(listing.output).toContain('file tableColumns.json [w]');
  expect(listing.output).toContain('file tableRows.json [w]');

  expect((await executeHvyCliCommand(document, session, 'cat /body/quality/chores/table.txt')).output).toBe('Chore | Owner\nDishes | Mom\n');
  expect((await executeHvyCliCommand(document, session, 'cat /body/quality/chores/tableColumns.json')).output).toBe('[\n  "Chore",\n  "Owner"\n]\n');
  expect((await executeHvyCliCommand(document, session, 'cat /body/quality/chores/tableRows.json')).output).toBe('[\n  [\n    "Dishes",\n    "Mom"\n  ]\n]\n');

  await expect(executeHvyCliCommand(document, session, 'echo "Chore | Owner" > /body/quality/chores/table.txt')).rejects.toThrow(
    'table.txt is a read-only preview for static table components. Edit tableColumns.json and tableRows.json instead'
  );

  expect((await executeHvyCliCommand(document, session, 'echo \'["Task","Done"]\' > /body/quality/chores/tableColumns.json')).output).toBe(
    '/body/quality/chores/tableColumns.json: written'
  );
  expect((await executeHvyCliCommand(document, session, 'echo \'[["Trash","No"],["Dishes","Yes"]]\' > /body/quality/chores/tableRows.json')).output).toBe(
    '/body/quality/chores/tableRows.json: written'
  );
  expect((await executeHvyCliCommand(document, session, 'cat /body/quality/chores/table.txt')).output).toBe('Task | Done\nTrash | No\nDishes | Yes\n');
  expect(serializeDocument(document)).toContain('"tableColumns":"Task, Done"');
  expect(serializeDocument(document)).toContain('"tableRows":[{"cells":["Trash","No"]},{"cells":["Dishes","Yes"]}]');

  await expect(executeHvyCliCommand(document, session, 'echo "- id: item-1" > /body/quality/empty-list.txt')).rejects.toThrow(
    'component-list.txt is a read-only preview until list items exist. Use hvy append-child ITEM_TYPE PATH --id NEW_ID'
  );

  expect((await executeHvyCliCommand(document, session, 'hvy lint')).output).toBe('No lint issues.');
  expect((await executeHvyCliCommand(document, session, 'ls /body/quality/empty-list')).output).not.toContain('dir  component-list');
  expect((await executeHvyCliCommand(document, session, 'hvy append-child text /body/quality/empty-list --id item-1 "First item"')).output).toContain(
    '/body/quality/empty-list/item-1: created'
  );
  expect((await executeHvyCliCommand(document, session, 'cat /body/quality/empty-list/item-1/text.txt')).output).toBe('First item');
});

test('cli static table directory previews follow header visibility', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"quality"}-->
#! Quality

<!--hvy:table {"id":"visible-header","tableColumns":"Year,Organization,Title","tableShowHeader":true,"tableRows":[{"cells":["2024","Northwind","Engineer"]}]}-->

<!--hvy:table {"id":"hidden-header-with-row","tableColumns":"Year,Organization,Title","tableShowHeader":false,"tableRows":[{"cells":["2025","Heavy Resume","Founder"]}]}-->

<!--hvy:table {"id":"hidden-header-empty","tableColumns":"Year,Organization,Title","tableShowHeader":false,"tableRows":[]}-->
`, '.hvy');
  const session = createHvyCliSession();

  const listing = await executeHvyCliCommand(document, session, 'ls /body/quality');

  expect(listing.output).toContain('dir  visible-header | static table component | Year Organization Title');
  expect(listing.output).toContain('dir  hidden-header-with-row | static table component | 2025 Heavy Resume Founder');
  expect(listing.output).toContain('dir  hidden-header-empty | static table component | Year Organization Title');
});

test('cli exposes writable children-order files for ordered component children', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"quality"}-->
#! Quality

<!--hvy:component-list {"id":"items","componentListComponent":"text"}-->

 <!--hvy:text {"id":"banana"}-->
 Banana

 <!--hvy:text {"id":"apple"}-->
 Apple

 <!--hvy:text {"id":"cherry"}-->
 Cherry
`, '.hvy');
  const session = createHvyCliSession();

  expect((await executeHvyCliCommand(document, session, 'ls /body/quality')).output).toContain(
    'dir  items | component-list component | Banana...'
  );

  const before = await executeHvyCliCommand(document, session, 'ls /body/quality/items');
  expect(before.output.indexOf('dir  banana')).toBeLessThan(before.output.indexOf('dir  apple'));
  expect(before.output).toContain('file children-order.json [w] | list item order');
  expect((await executeHvyCliCommand(document, session, 'cat /body/quality/items/children-order.json')).output).toBe(
    '[\n  "banana",\n  "apple",\n  "cherry"\n]\n'
  );

  const reordered = await executeHvyCliCommand(document, session, 'echo \'["apple","cherry","banana"]\' > /body/quality/items/children-order.json');
  expect(reordered.output).toBe('/body/quality/items/children-order.json: written');
  const after = await executeHvyCliCommand(document, session, 'ls /body/quality/items');
  expect(after.output.indexOf('dir  apple')).toBeLessThan(after.output.indexOf('dir  cherry'));
  expect(after.output.indexOf('dir  cherry')).toBeLessThan(after.output.indexOf('dir  banana'));

  await expect(executeHvyCliCommand(document, session, 'echo \'["apple","apple","banana"]\' > /body/quality/items/children-order.json'))
    .rejects.toThrow('/body/quality/items/children-order.json has duplicate child keys: apple');
  await expect(executeHvyCliCommand(document, session, 'echo \'["apple","banana","durian"]\' > /body/quality/items/children-order.json'))
    .rejects.toThrow('Unknown: durian');
  await expect(executeHvyCliCommand(document, session, 'echo \'["apple","banana"]\' > /body/quality/items/children-order.json'))
    .rejects.toThrow('Missing: cherry');
});

test('cli exposes raw.hvy for small documents and applies valid raw edits', async () => {
  const document = createCliTestDocument();
  const session = createHvyCliSession();

  const root = await executeHvyCliCommand(document, session, 'ls /');
  expect(root.output).toContain('file raw.hvy [w]');
  expect(root.output).toContain('raw.hvy [w] | raw HVY for this document');

  const before = await executeHvyCliCommand(document, session, 'cat /raw.hvy');
  expect(before.output).toContain('#! Summary');

  const edited = await executeHvyCliCommand(document, session, `cat > /raw.hvy <<'EOF'
---
hvy_version: 0.1
title: Raw Edit
---

<!--hvy: {"id":"fresh"}-->
#! Fresh

<!--hvy:text {"id":"note"}-->
 Raw replacement
EOF`);

  expect(edited.output).toBe('/raw.hvy: written');
  expect(serializeDocument(document)).toContain('#! Fresh');
  expect(serializeDocument(document)).toContain('Raw replacement');
});

test('cli keeps failed raw.hvy edits in raw.wip.hvy without mutating the document', async () => {
  const document = createCliTestDocument();
  const session = createHvyCliSession();
  const before = serializeDocument(document);

  await expect(executeHvyCliCommand(document, session, `cat > /raw.hvy <<'EOF'
---
hvy_version: [
---

#! Broken
EOF`)).rejects.toThrow('/raw.hvy did not parse; document was not changed.');

  expect(serializeDocument(document)).toBe(before);
  const root = await executeHvyCliCommand(document, session, 'ls /');
  expect(root.output).toContain('file raw.wip.hvy [w]');
  expect(root.output).toContain('raw.wip.hvy [w] | failed raw.hvy draft preserved after a parse error');
  expect((await executeHvyCliCommand(document, session, 'cat /raw.wip.hvy')).output).toContain('#! Broken');
});

test('cli exposes raw-preview.hvy.txt instead of raw.hvy for large documents', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"large"}-->
#! Large

<!--hvy:text {"id":"long"}-->
${'x'.repeat(900)}
${Array.from({ length: 500 }, (_, index) => ` Line ${index}`).join('\n')}
`, '.hvy');
  const session = createHvyCliSession();

  const root = await executeHvyCliCommand(document, session, 'ls /');
  expect(root.output).toContain('file raw-preview.hvy.txt [ro]');
  expect(root.output).not.toContain('file raw.hvy [w]');
  expect(root.output).toContain('raw-preview.hvy.txt [ro] | first 100 prewrapped lines');

  const preview = await executeHvyCliCommand(document, session, 'cat /raw-preview.hvy.txt');
  expect(preview.output.split('\n')).toHaveLength(100);
  expect(preview.output).toContain('xxxxxxxxxxxxxxxx');
  await expect(executeHvyCliCommand(document, session, 'echo "nope" > /raw-preview.hvy.txt')).rejects.toThrow(
    'echo: file is read-only: /raw-preview.hvy.txt'
  );
});

test('cli exposes raw.hvy in component directories and applies valid component edits', async () => {
  const document = createCliTestDocument();
  const session = createHvyCliSession();

  const listing = await executeHvyCliCommand(document, session, 'ls /body/summary/intro');
  expect(listing.output).toContain('file raw.hvy [w]');
  expect(listing.output).toContain('raw.hvy [w] | raw HVY for this component');

  const before = await executeHvyCliCommand(document, session, 'cat /body/summary/intro/raw.hvy');
  expect(before.output).toContain('<!--hvy:text');
  expect(before.output).toContain('Hello world');

  const edited = await executeHvyCliCommand(document, session, `cat > /body/summary/intro/raw.hvy <<'EOF'
<!--hvy:text {"id":"intro","css":"margin: 0.5rem 0;"}-->
 Raw component edit
EOF`);

  expect(edited.output).toBe('/body/summary/intro/raw.hvy: written');
  expect(document.sections[0]?.blocks[0]?.text).toBe('Raw component edit');
  expect(serializeDocument(document)).toContain('Raw component edit');
});

test('cli keeps failed component raw.hvy edits in component raw.wip.hvy', async () => {
  const document = createCliTestDocument();
  const session = createHvyCliSession();
  const before = document.sections[0]?.blocks[0]?.text;

  await expect(executeHvyCliCommand(document, session, `cat > /body/summary/intro/raw.hvy <<'EOF'
<!--hvy:text {"id": -->
 Broken component
EOF`)).rejects.toThrow('/body/summary/intro/raw.hvy did not parse; component was not changed.');

  expect(document.sections[0]?.blocks[0]?.text).toBe(before);
  const listing = await executeHvyCliCommand(document, session, 'ls /body/summary/intro');
  expect(listing.output).toContain('file raw.wip.hvy [w]');
  expect(listing.output).toContain('raw.wip.hvy [w] | failed raw.hvy draft preserved after a parse error');
  expect((await executeHvyCliCommand(document, session, 'cat /body/summary/intro/raw.wip.hvy')).output).toContain('Broken component');
});

test('cli exposes raw.hvy in section directories and applies valid section edits', async () => {
  const document = createCliTestDocument();
  const session = createHvyCliSession();

  const listing = await executeHvyCliCommand(document, session, 'ls /body/summary');
  expect(listing.output).toContain('file raw.hvy [w]');
  expect(listing.output).toContain('raw.hvy [w] | raw HVY for this section');

  const before = await executeHvyCliCommand(document, session, 'cat /body/summary/raw.hvy');
  expect(before.output).toContain('#! Summary');
  expect(before.output).toContain('Hello world');

  const edited = await executeHvyCliCommand(document, session, `cat > /body/summary/raw.hvy <<'EOF'
<!--hvy: {"id":"summary"}-->
#! Updated Summary

<!--hvy:text {"id":"intro"}-->
 Section raw edit
EOF`);

  expect(edited.output).toBe('/body/summary/raw.hvy: written');
  expect(document.sections[0]?.title).toBe('Updated Summary');
  expect(document.sections[0]?.blocks[0]?.text).toBe('Section raw edit');
});

test('ls shows structural directory previews without raw-edit hints', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:expandable {"id":"details"}-->
 <!--hvy:expandable:stub {"lock":false}-->
  <!--hvy:text {"id":"stub"}-->
  Stub

 <!--hvy:expandable:content {"lock":false}-->
  <!--hvy:text {"id":"detail"}-->
  Detail
`, '.hvy');
  const session = createHvyCliSession();

  const structural = await executeHvyCliCommand(document, session, 'ls /body/summary/details/expandable-stub');

  expect(structural.output).toContain("type name [editable] | description | preview\ndir  stub | text component | Stub");
  expect((await executeHvyCliCommand(document, session, 'ls /body/summary/details')).output).toContain("dir  expandable-stub | expandable's stub | Stub");
  expect((await executeHvyCliCommand(document, session, 'ls /body/summary/details')).output).toContain("dir  expandable-content | expandable's content | Detail");
  expect(structural.output).toContain("Component context:");
  expect(structural.output).not.toContain('raw edits available through');
  expect(structural.output).not.toContain('nearest raw-editable parent | /body/summary/details/raw.hvy');
  expect(structural.output).not.toContain('raw.hvy [w] | raw HVY for this component');
});

test('cli keeps failed section raw.hvy edits in section raw.wip.hvy', async () => {
  const document = createCliTestDocument();
  const session = createHvyCliSession();
  const before = serializeDocument(document);

  await expect(executeHvyCliCommand(document, session, `cat > /body/summary/raw.hvy <<'EOF'
<!--hvy: {"id": -->
#! Broken Section
EOF`)).rejects.toThrow('/body/summary/raw.hvy did not parse; section was not changed.');

  expect(serializeDocument(document)).toBe(before);
  const listing = await executeHvyCliCommand(document, session, 'ls /body/summary');
  expect(listing.output).toContain('file raw.wip.hvy [w]');
  expect(listing.output).toContain('raw.wip.hvy [w] | failed raw.hvy draft preserved after a parse error');
  expect((await executeHvyCliCommand(document, session, 'cat /body/summary/raw.wip.hvy')).output).toContain('Broken Section');
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
  expect((await executeHvyCliCommand(document, session, 'find component-list-1/tool-typescript -name skill-record.txt')).output).toContain(
    '/body/tools-technologies/component-list-1/tool-typescript/skill-record.txt'
  );
  expect((await executeHvyCliCommand(document, session, 'cat component-list-1/tool-typescript/skill-record.txt')).output).toContain('Primary application language.');
});

test('cli shows labeled tags for resume header tables without changing directory identity', async () => {
  const document = createResumeCliTestDocument();
  const session = createHvyCliSession();

  expect((await executeHvyCliCommand(document, session, 'ls /body/history')).output).toContain(
    'dir  table-1 tags=[table-header] | static table component | YEAR ORGANIZATION TITLE'
  );
  expect((await executeHvyCliCommand(document, session, 'ls /body/projects')).output).toContain(
    'dir  table-1 tags=[table-header] | static table component | PROJECT DATE'
  );
  expect((await executeHvyCliCommand(document, session, 'ls /body/education')).output).toContain(
    'dir  table-1 tags=[table-header] | static table component | DEGREE INSTITUTION LOCATION'
  );
  expect((await executeHvyCliCommand(document, session, 'cat /body/history/table-1/table.json')).output).toContain('"id": ""');
});

test('cli rejects square brackets in tags because ls displays bracketed tag labels', async () => {
  const document = createCliTestDocument();
  const session = createHvyCliSession();

  await expect(
    executeHvyCliCommand(
      document,
      session,
      'echo \'{"id":"intro","css":"margin: 0.5rem 0;","lock":false,"align":"left","slot":"center","tags":"bad[tag]","description":"","placeholder":""}\' > /body/summary/intro/text.json'
    )
  ).rejects.toThrow('text.json tags cannot contain [ or ]. Tags are displayed as tags=[...] by the CLI.');
});

test('cli accepts body section aliases from root and mutates resume virtual files', async () => {
  const document = createResumeCliTestDocument();
  const session = createHvyCliSession();

  expect((await executeHvyCliCommand(document, session, 'cd /tools-technologies')).cwd).toBe('/body/tools-technologies');

  const before = await executeHvyCliCommand(document, session, 'find /body/tools-technologies/component-list-1/tool-typescript -name skill-record.txt');
  expect(before.output).toContain('/body/tools-technologies/component-list-1/tool-typescript/skill-record.txt');

  const result = await executeHvyCliCommand(document, session, 'sed s/Primary/Core/ /body/tools-technologies/component-list-1/tool-typescript/skill-record.txt');
  expect(result.mutated).toBe(true);
  expect(result.output).toBe('/body/tools-technologies/component-list-1/tool-typescript/skill-record.txt: updated');
  expect((await executeHvyCliCommand(document, session, 'cat /tools-technologies/component-list-1/tool-typescript/skill-record.txt')).output).toContain(
    'Core application language.'
  );
});

test('cli rm recursively removes virtual body directories', async () => {
  const document = createResumeCliTestDocument();
  const session = createHvyCliSession();

  await expect(executeHvyCliCommand(document, session, 'rm /body/tools-technologies/component-list-1/tool-typescript')).rejects.toThrow(
    'is a directory; use -r'
  );

  const result = await executeHvyCliCommand(document, session, 'rm -r body/tools-technologies/component-list-1/tool-typescript');

  expect(result.mutated).toBe(true);
  expect(result.output).toContain('/body/tools-technologies/component-list-1/tool-typescript: removed');
  expect(result.output).toContain('Run: hvy prune-xref tool-typescript');
  expect((await executeHvyCliCommand(document, session, 'find /body/tools-technologies -name skill-record.txt')).output).not.toContain(
    '/body/tools-technologies/component-list-1/tool-typescript/skill-record.txt'
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

  await expect(executeHvyCliCommand(document, session, 'hvy remove /body/tools-technologies/component-list-1/tool-typescriptx'))
    .rejects.toThrow(/Did you mean\?\n\s+Closest existing parent: \/body\/tools-technologies\/component-list-1\n\s+\/body\/tools-technologies\/component-list-1\/tool-typescript/);

  await expect(executeHvyCliCommand(document, session, 'cat /body/tools-technologies/component-list-1/tool-typescript/skill-recrod.txt'))
    .rejects.toThrow(/Did you mean\?\n(?:.*\n)*\s+\/body\/tools-technologies\/component-list-1\/tool-typescript\/skill-record\.txt/);
});

test('cli find supports common filters and warns about ignored options', async () => {
  const document = createResumeCliTestDocument();
  const session = createHvyCliSession();

  const directories = (await executeHvyCliCommand(document, session, 'find /body/tools-technologies -type d -maxdepth 2 -print')).output;
  expect(directories).toContain('/body/tools-technologies/component-list-1/tool-typescript');
  expect(directories).not.toContain('/body/tools-technologies/component-list-1/tool-typescript/expandable-content');

  const files = (await executeHvyCliCommand(document, session, 'find /body/tools-technologies/component-list-1/tool-typescript -type f -name skill-record.txt')).output;
  expect(files).toContain('/body/tools-technologies/component-list-1/tool-typescript/skill-record.txt');

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

  const read = await executeHvyCliCommand(document, session, 'hvy read /body/tools-technologies/component-list-1/tool-typescript/skill-record.txt');
  expect(read.output).toContain('TypeScript');

  const lineNumber = await executeHvyCliCommand(document, session, 'rg -n "TypeScript\\|Typescript" /body/tools-technologies');
  expect(lineNumber.output).toContain('/body/tools-technologies/component-list-1/tool-typescript/skill-record.txt:1:TypeScript');
  expect(lineNumber.output).not.toContain('Warning: rg ignored unsupported option -n');

  const filesOnly = await executeHvyCliCommand(document, session, 'rg "TypeScript" /body/tools-technologies -l');
  expect(filesOnly.output).toContain('/body/tools-technologies/component-list-1/tool-typescript/skill-record.txt');
  expect(filesOnly.output).not.toContain(':1:TypeScript');

  const combined = await executeHvyCliCommand(document, session, 'rg -rn "TypeScript" /body/tools-technologies');
  expect(combined.output).not.toContain('Warning: rg ignored unsupported option -r');
  expect(combined.output).toContain('/body/tools-technologies/component-list-1/tool-typescript/skill-record.txt:1:TypeScript');

  const listFilesAlias = await executeHvyCliCommand(document, session, 'rg -r "TypeScript" /body/tools-technologies --list-files');
  expect(listFilesAlias.output).toContain('/body/tools-technologies/component-list-1/tool-typescript/skill-record.txt');
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
  expect(includeEquals.output).toContain('/body/top-skills-tools-technologies/grid-0/grid/component-list-1/xref-card-1/xref-card.json');
  expect(includeEquals.output).not.toContain('skill-record.txt');

  const includeSeparate = await executeHvyCliCommand(document, session, 'rg -r "" --include "*.yaml" /body -l');
  expect(includeSeparate.output).toBe('');
});

test('cli hvy remove and delete alias recursive rm', async () => {
  const document = createResumeCliTestDocument();
  const session = createHvyCliSession();

  const remove = await executeHvyCliCommand(document, session, 'hvy remove /body/tools-technologies/component-list-1/tool-typescript');
  expect(remove.output).toContain('/body/tools-technologies/component-list-1/tool-typescript: removed');
  expect(remove.output).toContain('Run: hvy prune-xref tool-typescript');
  expect(serializeDocument(document)).not.toContain('id":"tool-typescript"');

  await executeHvyCliCommand(document, session, 'hvy delete /body/tools-technologies/component-list-1/tool-python');
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
    await executeHvyCliCommand(document, session, `hvy append-child section /body item-${index} "Item ${index}"`);
  }

  const output = (await executeHvyCliCommand(document, session, 'find /body -type d')).output;
  expect(output.split('\n').filter((line) => line.startsWith('/body'))).toHaveLength(100);
  expect(output).toContain('Warning: find output truncated to 100 of 106 results.');
});

test('cli command output is capped at 200 lines', async () => {
  const document = deserializeDocument('---\nhvy_version: 0.1\n---\n', '.hvy');
  const session = createHvyCliSession();

  for (let index = 0; index < 205; index += 1) {
    await executeHvyCliCommand(document, session, `hvy append-child section /body item-${index} "Item ${index}"`);
  }

  const result = await executeHvyCliCommand(document, session, 'find /body -type f -name section.json -exec sed s/TypeScript//g {} +');

  expect(result.output.split('\n')).toHaveLength(201);
  expect(result.output).toContain('Warning: output truncated to 200 of 205 lines (5 lines hidden).');
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

test('cli supports stdout redirection for read commands and blocks same-file overwrites', async () => {
  const document = createCliTestDocument();
  const session = createHvyCliSession();

  const redirected = await executeHvyCliCommand(
    document,
    session,
    'nl -ba /body/summary/intro/text.txt > /scratchpad.txt'
  );
  expect(redirected.output).toBe('/scratchpad.txt: written');
  expect(session.scratchpadContent).toContain('Hello world');

  await expect(executeHvyCliCommand(
    document,
    session,
    'nl -ba /body/summary/intro/text.txt > /body/summary/intro/text.txt'
  )).rejects.toThrow('nl: cannot redirect output to the same file being read: /body/summary/intro/text.txt');
  expect(document.sections[0]?.blocks[0]?.text).toBe('Hello world');
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
    'find body -type f -name "text.txt" -exec sed -i -E s/world/there/g {} + && echo done Removed world'
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
    'cp -r /body/skills/component-list-1/skill-llm-prompt-engineering /body/skills/component-list-1/skill-baking'
  );

  expect(result.mutated).toBe(true);
  expect(result.output).toBe('/body/skills/component-list-1/skill-llm-prompt-engineering -> /body/skills/component-list-1/skill-baking: copied');
  expect((await executeHvyCliCommand(document, session, 'cat /body/skills/component-list-1/skill-baking/skill-record.json')).output).toContain(
    '"id": "skill-baking"'
  );
  expect((await executeHvyCliCommand(document, session, 'cat /body/skills/component-list-1/skill-baking/skill-record.txt')).output).toContain(
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

test('hvy lint catches unsupported form YAML keys', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"chore-chart"}-->
#! Chore Chart

<!--hvy:plugin {"id":"assign-chore","plugin":"dev.heavy.form","pluginConfig":{"version":"0.1","submitScript":"submit"}}-->
fields:
  - label: Chore
    type: select
    required: true
    || '|' || title AS option, id AS value FROM chores ORDER BY id ASC
scripts:
  submit: >-
    pass
`, '.hvy');
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(document, session, 'hvy lint');

  expect(result.output).toContain('[plugin] /body/chore-chart/assign-chore - form YAML error: Implicit keys need to be on a single line');
  expect(result.output).toContain('For help, run hvy cheatsheet forms or man hvy plugin form.');
});

test('hvy lint points unsupported form schema keys to form help', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"chore-chart"}-->
#! Chore Chart

<!--hvy:plugin {"id":"assign-chore","plugin":"dev.heavy.form","pluginConfig":{"version":"0.1","submitScript":"submit"}}-->
fields:
  - label: Chore
    type: select
    required: true
    options_query: SELECT id AS value, title AS label FROM chores ORDER BY id ASC
scripts:
  submit: >-
    pass
`, '.hvy');
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(document, session, 'hvy lint');

  expect(result.output).toContain('[plugin] /body/chore-chart/assign-chore - form field "Chore" has unsupported key "options_query".');
  expect(result.output).toContain('For help, run hvy cheatsheet forms or man hvy plugin form.');
});

test('hvy lint warns when form scripts use folded YAML scalars', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"chore-chart"}-->
#! Chore Chart

<!--hvy:plugin {"id":"assign-chore","plugin":"dev.heavy.form","pluginConfig":{"version":"0.1","initialScript":"load","submitScript":"submit"}}-->
fields:
  - label: Chore
    type: select
scripts:
  load: >
    pass
  submit: >-
    pass
`, '.hvy');
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(document, session, 'hvy lint');

  expect(result.output).toContain('[plugin] /body/chore-chart/assign-chore - form script "load" uses folded YAML scalar ">". Use literal scalar "|" so Python newlines and indentation are preserved.');
  expect(result.output).toContain('[plugin] /body/chore-chart/assign-chore - form script "submit" uses folded YAML scalar ">-". Use literal scalar "|" so Python newlines and indentation are preserved.');
});

test('hvy lint catches and fixes non-canonical form field type aliases', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"chore-chart"}-->
#! Chore Chart

<!--hvy:plugin {"id":"assign-chore","plugin":"dev.heavy.form","pluginConfig":{"version":"0.1","initialScript":"load","submitScript":"submit"}}-->
fields:
  - label: Chore
    type: DROPDOWN
scripts:
  load: >-
    pass
  submit: >-
    pass
`, '.hvy');
  const session = createHvyCliSession();

  const before = await executeHvyCliCommand(document, session, 'hvy lint');
  const fix = await executeHvyCliCommand(document, session, 'hvy lint --fix');
  const after = await executeHvyCliCommand(document, session, 'hvy lint');

  expect(before.output).toContain('[plugin] /body/chore-chart/assign-chore - form field "Chore" uses non-canonical type "DROPDOWN". Use "select" instead. Run hvy lint --fix to rewrite form field types.');
  expect(fix.output).toContain('- assign-chore: canonicalized form field types');
  expect(after.output).not.toContain('DROPDOWN');
  expect(serializeDocument(document)).toContain('type: select');
});

test('hvy lint warns about unsupported form field types', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"chore-chart"}-->
#! Chore Chart

<!--hvy:plugin {"id":"assign-chore","plugin":"dev.heavy.form","pluginConfig":{"version":"0.1","initialScript":"load","submitScript":"submit"}}-->
fields:
  - label: Chore
    type: combobox
scripts:
  load: >-
    pass
  submit: >-
    pass
`, '.hvy');
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(document, session, 'hvy lint');

  expect(result.output).toContain('[plugin] /body/chore-chart/assign-chore - form field "Chore" uses unsupported type "combobox". Valid types: text, textarea, number, select, checkbox, radio, date, email, tel, url, password, hidden. Use "select" for dropdowns.');
});

test('hvy lint points form behavior YAML keys to plugin config', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"chore-chart"}-->
#! Chore Chart

<!--hvy:plugin {"id":"assign-chore","plugin":"dev.heavy.form","pluginConfig":{"version":"0.1"}}-->
fields:
  - label: Chore
    type: select
scripts:
  submit: >-
    pass
submitScript: submit
`, '.hvy');
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(document, session, 'hvy lint');

  expect(result.output).toContain('[plugin] /body/chore-chart/assign-chore - form YAML has unsupported top-level key "submitScript".');
  expect(result.output).toContain('[plugin] /body/chore-chart/assign-chore - form has a submit button but no submitScript.');
});

test('hvy lint reports invalid form doc db SQL with component location', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"chore-chart"}-->
#! Chore Chart

<!--hvy:plugin {"id":"assign-chore","plugin":"dev.heavy.form","pluginConfig":{"version":"0.1","initialScript":"load","submitScript":"submit"}}-->
fields:
  - label: Chore
    type: select
scripts:
  load: >-
    rows = doc.db.query("SELECT id, title FROM chores WHERE status = 'active'")
    doc.form.set_options("Chore", [{"label": row["title"], "value": str(row["id"])} for row in rows])
  submit: >-
    pass
`, '.hvy');
  const session = createHvyCliSession();

  await executeHvyCliCommand(document, session, 'hvy plugin db-table exec "CREATE TABLE chores (id INTEGER PRIMARY KEY, title TEXT NOT NULL)"');
  const result = await executeHvyCliCommand(document, session, 'hvy lint');

  expect(result.output).toContain('[plugin] /body/chore-chart/assign-chore - form script doc.db.query SQL is invalid:');
  expect(result.output).toContain('no such column: status');
  expect(result.output).toContain('For help, run hvy cheatsheet forms or man hvy plugin form.');
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

test('cli ignores stderr merge redirection in request_structure pipelines', async () => {
  const document = createResumeCliTestDocument();
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(
    document,
    session,
    'hvy request_structure /body/top-skills-tools-technologies --describe 2>&1 | head -5'
  );

  expect(result.output).toContain('Custom component types:');
  expect(result.output).not.toContain('expected at most one component id');
});

test('cli lists text filters as supported commands', async () => {
  const document = createCliTestDocument();
  const session = createHvyCliSession();

  expect((await executeHvyCliCommand(document, session, 'help')).output).toContain(
    'Commands: cd, pwd, ls, cat, head, tail, nl, find, rg, grep, sort, uniq, wc, tr, xargs, cp, rm, echo, sed, true, hvy. Ask: ask QUESTION. Finish: done MESSAGE_TO_USER.'
  );
  expect((await executeHvyCliCommand(document, session, 'man wc')).output).toContain('wc -l [FILE...]');
  expect((await executeHvyCliCommand(document, session, 'man uniq')).output).toContain('uniq [FILE...]');
  expect((await executeHvyCliCommand(document, session, 'man tr')).output).toContain('tr SET1 SET2');
  expect((await executeHvyCliCommand(document, session, 'man ask')).output).toContain('ask QUESTION');
  expect((await executeHvyCliCommand(document, session, 'ask "Which section?"')).output).toBe('Which section?');
  expect((await executeHvyCliCommand(document, session, 'man done')).output).toContain('done MESSAGE_TO_USER');
  expect((await executeHvyCliCommand(document, session, 'done "Updated the document."')).output).toBe('Updated the document.');
});

test('hvy request_structure lists component directories and custom definitions', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: skill-card
    baseType: xref-card
    description: Skill card
---

<!--hvy: {"id":"summary","tags":"overview, canonical"}-->
#! Summary

<!--hvy:text {"id":"intro","tags":"lead-in"}-->
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
  expect(result.output).toContain('- skill-card baseType=xref-card - Skill card');
  expect(result.output).toContain('Components:');
  expect(result.output).toContain('/body\n  /summary tags=[overview, canonical]');
  expect(result.output).toContain('/intro\n      text.txt id=intro tags=[lead-in]');
  expect(result.output).toMatch(/\/component-list-\d+\n      component-list\.txt id=C\d+\n      \/text-\d+\n        text\.txt id=C\d+/);
  expect(result.output).toContain('/typescript-card\n      xref-card.txt id=typescript-card');
  expect(result.output).toMatch(/\/xref-card-\d+\n      xref-card\.txt id=C\d+/);
  expect(result.output).toContain('/library-card\n      skill-card.txt id=library-card');
  expect(result.output.indexOf('/intro')).toBeLessThan(result.output.indexOf('/component-list-'));
  expect(result.output.indexOf('/component-list-')).toBeLessThan(result.output.indexOf('/typescript-card'));
  expect(result.output.indexOf('/typescript-card')).toBeLessThan(result.output.indexOf('/library-card'));

  const collapsed = await executeHvyCliCommand(document, session, 'hvy request_structure --collapse');
  expect(collapsed.output).toContain('/body\n  /summary tags=[overview, canonical]');
  expect(collapsed.output).toContain('/intro text.txt id=intro tags=[lead-in]');
  expect(collapsed.output).toMatch(/\/component-list-\d+ component-list\.txt id=C\d+ \(\+3 hidden\)/);
  expect(collapsed.output).not.toMatch(/\/text-\d+\.\.text-\d+ text\.txt ids=C\d+-C\d+/);
  expect(collapsed.output).toMatch(/\/xref-card-\d+ xref-card\.txt id=C\d+/);

  const scoped = await executeHvyCliCommand(document, session, 'hvy request_structure typescript-card');
  expect(scoped.output).toContain('/body\n  /summary tags=[overview, canonical]\n    /typescript-card\n      xref-card.txt id=typescript-card');
  expect(scoped.output).not.toContain('/intro');

  const byPath = await executeHvyCliCommand(document, session, 'hvy request_structure /body/summary');
  expect(byPath.output).toContain('/intro');
  expect(byPath.output).toContain('/typescript-card');

  const byRelativePath = await executeHvyCliCommand(document, session, 'hvy request_structure body/summary');
  expect(byRelativePath.output).toContain('/intro');
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
  expect(result.output).toContain('description: Ordered list of reusable skill records.');
  expect(result.output).toContain('description: Featured top skills/tools grid.');
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

test('hvy find-intent boosts tags as explicit metadata', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"notes"}-->
#! Notes

<!--hvy:text {"id":"general","description":"General notes."}-->
General

<!--hvy:text {"id":"tagged","tags":"roadmap planning","description":"Miscellaneous."}-->
Tagged
`, '.hvy');
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(document, session, 'hvy find-intent roadmap --max 2');

  expect(result.output.indexOf('/body/notes/tagged')).toBeGreaterThan(-1);
  expect(result.output.indexOf('/body/notes/general') === -1 || result.output.indexOf('/body/notes/tagged') < result.output.indexOf('/body/notes/general')).toBe(true);
  expect(result.output).toContain('description: Miscellaneous.');
  expect(result.output).toContain('tags: roadmap planning');
  expect(result.output).not.toContain('matched tags');
});

test('hvy request_structure --describe includes non-empty descriptions', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"planning","description":"Roadmap and planning notes.","tags":"planning, roadmap"}-->
#! Planning

<!--hvy:text {"id":"roadmap","description":"Quarterly roadmap notes.","tags":"quarterly","placeholder":"Roadmap details"}-->
Milestones
`, '.hvy');
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(document, session, 'hvy request_structure --describe');

  expect(result.output).toContain('/planning tags=[planning, roadmap] - Roadmap and planning notes.');
  expect(result.output).toContain('text.txt id=roadmap tags=[quarterly] placeholder="Roadmap details" - Quarterly roadmap notes.');
});

test('hvy lint reports core component and plugin issues', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"empty-section"}-->
#! Empty Section

<!--hvy: {"id":"quality"}-->
#! Quality

<!--hvy:text {"id":"text-with-empty-blocks"}-->
>

\`\`\`ts

\`\`\`

<!--hvy:xref-card {"id":"empty-ref"}-->

<!--hvy:table {"id":"chores","tableColumns":"A,B","tableRows":[{"cells":["",""]},{"cells":["Done","Mom"]}]}-->

<!--hvy:component-list {"id":"empty-list","componentListComponent":"text"}-->

<!--hvy:plugin {"id":"broken-db","plugin":"dev.heavy.db-table","pluginConfig":{}}-->

<!--hvy:plugin {"id":"missing-db","plugin":"dev.heavy.db-table","pluginConfig":{"table":"missing_table"}}-->

<!--hvy:plugin {"id":"empty-script","plugin":"dev.heavy.scripting","pluginConfig":{"version":"0.1"}}-->

<!--hvy:plugin {"id":"passive-form","plugin":"dev.heavy.form","pluginConfig":{"version":"0.1","submitLabel":"Add chore"}}-->
fields:
  - label: Chore
    type: text
`, '.hvy');
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(document, session, 'hvy lint');

  expect(result.output).toContain('Lint issues: 10');
  expect(result.output).toContain('[section] /body/empty-section - section has no content.');
  expect(result.output).toContain('[text] /body/quality/text-with-empty-blocks - empty Markdown quote block at line 1.');
  expect(result.output).toContain('[text] /body/quality/text-with-empty-blocks - empty Markdown code block starting at line 3.');
  expect(result.output).toContain('[xref-card] /body/quality/empty-ref - xref-card is missing xrefTitle.');
  expect(result.output).toContain('[xref-card] /body/quality/empty-ref - xref-card is missing xrefTarget.');
  expect(result.output).toContain('[table] /body/quality/chores - table row 1 is empty.');
  expect(result.output).toContain('[plugin] /body/quality/broken-db - db-table plugin is missing pluginConfig.table.');
  expect(result.output).toContain('[plugin] /body/quality/missing-db - db-table pluginConfig.table references missing table/view "missing_table". Create it with hvy plugin db-table exec "CREATE VIEW missing_table AS SELECT ..."');
  expect(result.output).toContain('[plugin] /body/quality/empty-script - scripting plugin body is empty; expected Brython/Python source.');
  expect(result.output).toContain('[plugin] /body/quality/passive-form - form has a submit button but no submitScript.');
});

test('hvy lint reports database schemas stored in header metadata', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
tables:
  job_applications:
    columns:
      id: integer
      company: text
---

<!--hvy: {"id":"crm"}-->
#! CRM

<!--hvy:text {"id":"intro"}-->
Track applications
`, '.hvy');
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(document, session, 'hvy lint');

  expect(result.output).toContain('Lint issues: 1');
  expect(result.output).toContain('[header] /header.yaml - header.yaml has unsupported "tables" metadata that looks like a database schema.');
  expect(result.output).toContain('SQL tables/views live in the db-table backend; inspect or change them with hvy plugin db-table tables, hvy plugin db-table schema, and hvy plugin db-table exec.');
});

test('hvy lint reports unused header metadata for supported format versions', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
workflow_state:
  owner: qa
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"intro"}-->
Hello
`, '.hvy');
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(document, session, 'hvy lint');

  expect(result.output).toContain('Lint issues: 1');
  expect(result.output).toContain('[header] /header.yaml - header.yaml metadata key "workflow_state" is not used by HVY 0.1 or this editor. Remove it if it was accidental.');
});

test('hvy lint warns on newer HVY versions before assuming unused metadata', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.2
future_field: true
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"intro"}-->
Hello
`, '.hvy');
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(document, session, 'hvy lint');

  expect(result.output).toContain('Lint issues: 1');
  expect(result.output).toContain('[header] /header.yaml - This file uses hvy_version 0.2, but this client supports 0.1. Avoid editing with this client until it supports that HVY version.');
  expect(result.output).not.toContain('future_field');
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

  expect((await run('hvy append-child section /body chore-chart "Chore Chart"')).output).toBe('/body/chore-chart');
  await run('hvy append-child text /chore-chart overview "Track active chores, assignments, completion forms, and weekly leaders."');
  await run(
    'hvy append-child table /chore-chart active-chores "Chore,Dad,Mom,Child" --row "Dishes,,,Child" --row "Trash,Dad,," --row "Laundry,,Mom,"'
  );
  await run('hvy append-child plugin form /chore-chart add-chore-form "Add chore" "Description:textarea:required"');
  await run(
    'hvy append-child plugin form /chore-chart assign-chore-form "Assign chore" "Chore:select:required" "Assignee:select:required:Dad|Mom|Child" --script load "rows = doc.db.query(\'SELECT id, description FROM chores ORDER BY id\')\\ndoc.form.set_options(\'Chore\', [{\'label\': row[\'description\'], \'value\': str(row[\'id\'])} for row in rows])" --initial-script load'
  );
  await run(
    'hvy append-child plugin form /chore-chart complete-chore-form "Complete chore" "Chore:text:required" "Completed by:select:required:Dad|Mom|Child"'
  );
  await run('hvy append-child plugin db-table /chore-chart weekly-leaders weekly_chore_leaders "SELECT person, completed_count FROM weekly_chore_leaders ORDER BY completed_count DESC"');

  expect((await run('find /chore-chart -name plugin.txt')).output).toContain('/body/chore-chart/add-chore-form/plugin.txt');
  expect((await run('cat /chore-chart/active-chores/tableColumns.json')).output).toContain('"Chore"');
  expect((await run('cat /chore-chart/active-chores/tableRows.json')).output).toContain('"Dishes"');
  expect((await run('cat /chore-chart/assign-chore-form/plugin.json')).output).toContain('"submitLabel": "Assign chore"');
  expect((await run('cat /chore-chart/assign-chore-form/plugin.json')).output).toContain('"initialScript": "load"');
  expect((await run('cat /chore-chart/assign-chore-form/plugin.txt')).output).toContain("doc.form.set_options('Chore'");
  expect((await run('cat /chore-chart/assign-chore-form/plugin.json')).output).toContain('"plugin": "dev.heavy.form"');
  expect((await run('cat /chore-chart/weekly-leaders/plugin.json')).output).toContain('"table": "weekly_chore_leaders"');
  expect((await run('cat /chore-chart/weekly-leaders/plugin.json')).output).toContain('"plugin": "dev.heavy.db-table"');

  const serialized = serializeDocument(document);
  expect(serialized).toContain('<!--hvy:plugin {"id":"assign-chore-form","plugin":"dev.heavy.form"');
  expect(serialized).toContain('<!--hvy:plugin {"id":"weekly-leaders","plugin":"dev.heavy.db-table"');
  expect(serialized).toContain('"tableRows":[{"cells":["Dishes","","","Child"]}');
});

test('raw plugin creation rejects command aliases and accepts canonical plugin ids', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"quality"}-->
#! Quality
`, '.hvy');
  const session = createHvyCliSession();

  await expect(executeHvyCliCommand(document, session, 'hvy append-child plugin /quality bad-db db-table')).rejects.toThrow(
    'hvy plugin add: "db-table" is a CLI command alias, not a stored plugin id. Use "hvy append-child plugin db-table SECTION_PATH ID TABLE [QUERY]" or plugin id "dev.heavy.db-table".'
  );

  const result = await executeHvyCliCommand(
    document,
    session,
    'hvy append-child plugin /quality raw-scripting dev.heavy.scripting --config \'{"version":"0.1"}\' --body "doc.header.set(\'status\', \'ready\')"'
  );

  expect(result.output).toContain('/body/quality/raw-scripting: created');
  expect((await executeHvyCliCommand(document, session, 'cat /body/quality/raw-scripting/plugin.json')).output)
    .toContain('"plugin": "dev.heavy.scripting"');
});

test('hvy lint reports and fixes stored plugin command aliases', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"quality"}-->
#! Quality

<!--hvy:plugin {"id":"bad-db","plugin":"db-table","pluginConfig":{"table":"chores"}}-->

<!--hvy:plugin {"id":"bad-form","plugin":"form","pluginConfig":{"version":"0.1","submitLabel":"Add chore"}}-->
fields:
  - label: Chore
    type: text
`, '.hvy');
  const session = createHvyCliSession();

  const before = await executeHvyCliCommand(document, session, 'hvy lint');
  expect(before.output).toContain('[plugin] /body/quality/bad-db - plugin id "db-table" is a CLI command alias, not a stored plugin id. Run hvy lint --fix to change it to "dev.heavy.db-table".');
  expect(before.output).toContain('[plugin] /body/quality/bad-form - plugin id "form" is a CLI command alias, not a stored plugin id. Run hvy lint --fix to change it to "dev.heavy.form".');

  const fix = await executeHvyCliCommand(document, session, 'hvy lint --fix');
  expect(fix.output).toContain('Applied lint fixes:');
  expect(fix.output).toContain('- bad-db: db-table -> dev.heavy.db-table');
  expect(fix.output).toContain('- bad-form: form -> dev.heavy.form');
  expect(fix.mutated).toBe(true);

  const serialized = serializeDocument(document);
  expect(serialized).toContain('<!--hvy:plugin {"id":"bad-db","plugin":"dev.heavy.db-table"');
  expect(serialized).toContain('<!--hvy:plugin {"id":"bad-form","plugin":"dev.heavy.form"');
  expect((await executeHvyCliCommand(document, session, 'hvy lint')).output).not.toContain('is a CLI command alias');
});

test('hvy plugin db-table help shows canonical creation and operations', async () => {
  const document = createCliTestDocument();
  const session = createHvyCliSession();

  const help = (await executeHvyCliCommand(document, session, 'man hvy plugin db-table')).output;

  expect(help).toContain('hvy append-child plugin db-table SECTION_PATH ID TABLE [QUERY]');
  expect(help).toContain('hvy plugin db-table query [SELECT/WITH SQL]');
  expect(help).toContain('hvy plugin db-table exec [CREATE / INSERT / UPDATE / DELETE / DROP SQL]');
  expect(help).toContain('pluginConfig.table must be a table/view name, not SQL.');
  expect(help).toContain('hvy plugin db-table tables && hvy plugin db-table schema');
  expect(help).toContain('Do not grep for CREATE TABLE');
});

test('hvy help lists registered plugin add and operation commands as quick-reference options', async () => {
  const document = createCliTestDocument();
  const session = createHvyCliSession();

  const help = (await executeHvyCliCommand(document, session, 'man hvy')).output;

  expect(help).toContain('hvy cheatsheet [NAME]');
  expect(help).toContain('hvy recipe [NAME]');
  expect(help).toContain('Cheatsheets:\n- components\n- db-table\n- forms\n- scripting');
  expect(help).toContain('Recipes:\n- db-and-form\n- form-backed-table\n- populate-form-options-from-db\n- scripting');
  expect(help).toContain('hvy append-child plugin form SECTION_PATH ID SUBMIT_BUTTON_LABEL FIELD_LABEL:TYPE...');
  expect(help).toContain('hvy append-child plugin db-table SECTION_PATH ID TABLE [QUERY]');
  expect(help).toContain('hvy plugin db-table query [SELECT/WITH SQL]');
  expect(help).toContain('hvy plugin db-table exec [CREATE / INSERT / UPDATE / DELETE / DROP SQL]');
  expect(help).toContain('hvy plugin db-table tables');
  expect(help).toContain('hvy plugin db-table schema [TABLE_OR_VIEW]');
  expect(help).not.toContain('Try `man hvy plugin`');
});

test('hvy cheatsheets are discovered from markdown files', async () => {
  const document = createCliTestDocument();
  const session = createHvyCliSession();

  const list = (await executeHvyCliCommand(document, session, 'hvy cheatsheet')).output;
  const dbTable = (await executeHvyCliCommand(document, session, 'hvy cheatsheet db-table')).output;
  const unknown = (await executeHvyCliCommand(document, session, 'hvy cheatsheet missing')).output;

  expect(list).toContain('- db-table');
  expect(dbTable).toContain('# Dynamic Table Cheatsheet');
  expect(dbTable).toContain('Use the `db-table` plugin when rows should come from a live data source instead of static table component rows.');
  expect(dbTable).toContain('pluginConfig.table`, which must be the name of an existing table or view in the current backend.');
  expect(dbTable).toContain('plugin.txt` stores optional read-only `SELECT` or `WITH` SQL');
  expect(dbTable).toContain('Do not search the document for `CREATE TABLE`');
  expect(dbTable).toContain('hvy plugin db-table exec');
  expect(unknown).toContain('Unknown cheatsheet "missing". Available cheatsheets: components, db-table, forms, scripting');
});

test('hvy recipes are discovered from hvy files', async () => {
  const document = createCliTestDocument();
  const session = createHvyCliSession();

  const list = (await executeHvyCliCommand(document, session, 'hvy recipe')).output;
  const recipe = (await executeHvyCliCommand(document, session, 'hvy recipe db-and-form')).output;
  const optionsRecipe = (await executeHvyCliCommand(document, session, 'hvy recipe populate-form-options-from-db')).output;
  const unknown = (await executeHvyCliCommand(document, session, 'hvy recipe missing')).output;

  expect(list).toContain('- db-and-form');
  expect(list).toContain('- populate-form-options-from-db');
  expect(recipe).toContain('#! DB And Form Recipe');
  expect(recipe).toContain('There is no database component to add.');
  expect(recipe).toContain('doc.db.query');
  expect(recipe).toContain('Expected result:');
  expect(optionsRecipe).toContain('#! Populate Form Options From DB Recipe');
  expect(optionsRecipe).toContain('doc.form.set_options');
  expect(optionsRecipe).toContain('There is no `optionsQuery` YAML key.');
  expect(unknown).toContain('Unknown recipe "missing". Available recipes: db-and-form, form-backed-table, populate-form-options-from-db, scripting');
});

test('hvy plugin form help explains script and submit options', async () => {
  const document = createCliTestDocument();
  const session = createHvyCliSession();

  const help = (await executeHvyCliCommand(document, session, 'man hvy plugin form')).output;

  expect(help).toContain('hvy append-child plugin form SECTION_PATH ID SUBMIT_BUTTON_LABEL FIELD_LABEL:TYPE... [--script NAME PYTHON] [--initial-script NAME] [--on-submit-script NAME]');
  expect(help).toContain('--script NAME PYTHON\n  Store a named Python script');
  expect(help).toContain('--initial-script NAME\n  Store pluginConfig.initialScript=NAME');
  expect(help).toContain('--on-submit-script NAME\n  Store pluginConfig.submitScript=NAME');
  expect(help).toContain('There is no optionsQuery YAML key');
  expect(help).toContain('hvy recipe populate-form-options-from-db');
  expect(help).toContain('Example: hvy append-child plugin form /chores add-chore');
  expect(help).toContain('See also: hvy cheatsheet scripting; hvy recipe scripting; man hvy plugin scripting tool TOOL_NAME');
  expect(help).toContain('plugin.txt scripts.NAME: |');
});

test('hvy lint warns about unsupported doc.tool calls inside scripts', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"forms"}-->
#! Forms

<!--hvy:plugin {"id":"bad-form","plugin":"dev.heavy.form","pluginConfig":{"version":"0.1","submitScript":"submit"}}-->
fields:
  - label: Chore
    type: text
scripts:
  submit: |
    rows = doc.tool('db.query', {'query': 'SELECT * FROM chores'})
    doc.tool("db.exec", {"sql": "DELETE FROM chores"})
    doc.tool('refresh', {})
    doc.tool("made_up_tool", {})
`, '.hvy');
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(document, session, 'hvy lint');

  expect(result.output).toContain('[plugin] /body/forms/bad-form - script uses unknown doc.tool("db.query"). Valid doc.tool names: request_structure, grep, view_component');
  expect(result.output).toContain('Use doc.db.query(sql, params) instead.');
  expect(result.output).toContain('script uses unknown doc.tool("db.exec"). Valid doc.tool names: request_structure, grep, view_component');
  expect(result.output).toContain('Use doc.db.execute(sql, params) instead.');
  expect(result.output).toContain('script uses unknown doc.tool("refresh"). Valid doc.tool names: request_structure, grep, view_component');
  expect(result.output).toContain('Remove this call or use doc.rerender() only when explicitly needed.');
  expect(result.output).toContain('script uses unknown doc.tool("made_up_tool"). Valid doc.tool names: request_structure, grep, view_component');
  expect(result.output).toContain('Run man hvy plugin scripting tool for details.');
});

test('registered plugin help topics work without special-case command handlers', async () => {
  const document = createCliTestDocument();
  const session = createHvyCliSession();

  const manHelp = (await executeHvyCliCommand(document, session, 'man hvy plugin scripting')).output;
  const directHelp = (await executeHvyCliCommand(document, session, 'hvy plugin scripting')).output;

  expect(manHelp).toContain('hvy append-child plugin SECTION_PATH ID dev.heavy.scripting --config {"version":"0.1"} --body PYTHON');
  expect(manHelp).toContain('The component body is exposed as script.py. It is Python/Brython source wrapped in a generated function with one injected global: doc.');
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

test('hvy lint reports db-table query errors with component location', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"quality"}-->
#! Quality
`, '.hvy');
  const session = createHvyCliSession();

  await executeHvyCliCommand(document, session, 'hvy plugin db-table exec "CREATE TABLE chores (id INTEGER PRIMARY KEY, title TEXT NOT NULL)"');
  await executeHvyCliCommand(document, session, 'hvy append-child plugin db-table /quality broken-query chores ":"');

  const result = await executeHvyCliCommand(document, session, 'hvy lint');

  expect(result.output).toContain('[plugin] /body/quality/broken-query - db-table query is invalid:');
  expect(result.output).toContain('unrecognized token: ":"');
});

test('hvy lint tells db-table users how to create missing views', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"quality"}-->
#! Quality

<!--hvy:plugin {"id":"missing-view","plugin":"dev.heavy.db-table","pluginConfig":{"table":"active_chores_view"}}-->
 SELECT title FROM active_chores_view
`, '.hvy');
  const session = createHvyCliSession();

  await executeHvyCliCommand(document, session, 'hvy plugin db-table exec "CREATE TABLE chores (id INTEGER PRIMARY KEY, title TEXT NOT NULL)"');

  const result = await executeHvyCliCommand(document, session, 'hvy lint');

  expect(result.output).toContain('[plugin] /body/quality/missing-view - db-table pluginConfig.table references missing table/view "active_chores_view".');
  expect(result.output).toContain('Create it with hvy plugin db-table exec "CREATE VIEW active_chores_view AS SELECT ..."');
  expect(result.output).toContain('Existing tables/views: chores.');
});

test('hvy lint reports db-table SQL stored as a table name', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"quality"}-->
#! Quality

<!--hvy:plugin {"id":"broken-table-name","plugin":"dev.heavy.db-table","pluginConfig":{"table":"SELECT id AS id, title AS Chore FROM chores ORDER BY id"}}-->
`, '.hvy');
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(document, session, 'hvy lint');

  expect(result.output).toContain('[plugin] /body/quality/broken-table-name - db-table pluginConfig.table contains SQL.');
  expect(result.output).toContain('Set pluginConfig.table to a table/view name and put SELECT/WITH SQL in plugin.txt.');
});

test('hvy lint reports db-table table names with spaces', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"quality"}-->
#! Quality

<!--hvy:plugin {"id":"spaced-table","plugin":"dev.heavy.db-table","pluginConfig":{"table":"active chores"}}-->
`, '.hvy');
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(document, session, 'hvy lint');

  expect(result.output).toContain('[plugin] /body/quality/spaced-table - db-table pluginConfig.table contains spaces.');
  expect(result.output).toContain('Use a table/view name without spaces, and put SELECT/WITH SQL in plugin.txt.');
});

test('hvy lint reports db-table table names using reserved SQLite words', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"quality"}-->
#! Quality

<!--hvy:plugin {"id":"reserved-table","plugin":"dev.heavy.db-table","pluginConfig":{"table":"order"}}-->
`, '.hvy');
  const session = createHvyCliSession();

  const result = await executeHvyCliCommand(document, session, 'hvy lint');

  expect(result.output).toContain('[plugin] /body/quality/reserved-table - db-table pluginConfig.table uses reserved SQLite word "order".');
  expect(result.output).toContain('Choose a non-keyword table/view name.');
});
