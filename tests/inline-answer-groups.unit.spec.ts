import { describe, expect, test } from 'vitest';
import {
  buildInlineAnswerGroupIndex,
  clearSelectedRadioAnswers,
  getBlockAnswerGroups,
  radioGroupDirective,
  getNearbyRadioGroupNames,
  resolveBlockAnswerGroups,
  setAnswerRangeRadioGroup,
  scanInlineAnswers,
  stripRadioGroupDirectives,
} from '../src/inline-answer-groups';
import type { VisualBlock, VisualSection } from '../src/editor/types';

function makeTextBlock(id: string, text: string): VisualBlock {
  return {
    id,
    text,
    schemaMode: false,
    schema: { kind: 'text', component: 'text', id, pluginConfig: {} },
  } as unknown as VisualBlock;
}

function makeSections(blocks: VisualBlock[]): VisualSection[] {
  return [{ key: 'section-1', blocks, children: [] } as unknown as VisualSection];
}

describe('radio group directives', () => {
  test('directive round-trips a name and strips out of rendered text', () => {
    expect(radioGroupDirective('  preferred   contact ')).toBe('<!--hvy:radio-group preferred contact-->');
    expect(radioGroupDirective('')).toBe('<!--hvy:radio-group-->');
    expect(stripRadioGroupDirectives('<!--hvy:radio-group contact-->( ) Email')).toBe('( ) Email');
    expect(stripRadioGroupDirectives('( ) Email<!--hvy:radio-group-->')).toBe('( ) Email');
  });
});

describe('scanInlineAnswers', () => {
  test('indexes every marker in source order and records its position', () => {
    const expectedResult = scanInlineAnswers('[x] Copy me\n<!--hvy:radio-group contact-->( ) Email');

    expect(expectedResult.markers).toEqual([
      { answerIndex: 0, lineIndex: 0, start: 0, length: 3, radio: false, checked: true },
      { answerIndex: 1, lineIndex: 1, start: 30, length: 3, radio: true, checked: false },
    ]);
    expect(expectedResult.directives).toEqual([
      { lineIndex: 1, start: 0, length: 30, name: 'contact' },
    ]);
  });

  test('markers inside fenced code and inline code are not answers', () => {
    const expectedResult = scanInlineAnswers('```\n( ) not an answer\n```\n`( ) also not` ( ) real');

    expect(expectedResult.markers).toEqual([
      { answerIndex: 0, lineIndex: 3, start: 15, length: 3, radio: true, checked: false },
    ]);
  });
});

describe('resolveBlockAnswerGroups', () => {
  test('consecutive radio lines with no directive form one implicit group per run', () => {
    const expectedResult = resolveBlockAnswerGroups(
      '( ) Email\n( ) Phone\n\nsome prose\n\n( ) Fax\n( ) Pigeon',
      'section-1::contact',
      null
    );

    expect([...expectedResult.groups.entries()]).toEqual([
      [0, 'run:section-1::contact:1'],
      [1, 'run:section-1::contact:1'],
      [2, 'run:section-1::contact:2'],
      [3, 'run:section-1::contact:2'],
    ]);
    expect(expectedResult.activeName).toBe(null);
  });

  test('a blank line ends an implicit group', () => {
    const expectedResult = resolveBlockAnswerGroups('( ) Email\n\n( ) Phone', 'section-1::contact', null);

    expect([...expectedResult.groups.values()]).toEqual([
      'run:section-1::contact:1',
      'run:section-1::contact:2',
    ]);
  });

  test('checkbox markers take an answer index but never a group', () => {
    const expectedResult = resolveBlockAnswerGroups('[x] Copy me\n( ) Email\n( ) Phone', 'section-1::contact', null);

    expect([...expectedResult.groups.keys()]).toEqual([1, 2]);
  });

  test('a named directive applies from its position onward and leaks to the next block', () => {
    const expectedResult = resolveBlockAnswerGroups(
      '( ) Loose\n<!--hvy:radio-group contact-->\n( ) Email\n( ) Phone',
      'section-1::contact',
      null
    );

    expect([...expectedResult.groups.entries()]).toEqual([
      [0, 'run:section-1::contact:1'],
      [1, 'name:contact'],
      [2, 'name:contact'],
    ]);
    expect(expectedResult.activeName).toBe('contact');
  });

  test('a bare directive ends the active name and restores implicit grouping', () => {
    const expectedResult = resolveBlockAnswerGroups(
      '( ) Mail\n<!--hvy:radio-group-->\n( ) Loose',
      'section-1::fallback',
      'contact'
    );

    expect([...expectedResult.groups.entries()]).toEqual([
      [0, 'name:contact'],
      [1, 'run:section-1::fallback:2'],
    ]);
    expect(expectedResult.activeName).toBe(null);
  });
});

describe('buildInlineAnswerGroupIndex', () => {
  test('a named group spans components and collects every member', () => {
    const expectedResult = buildInlineAnswerGroupIndex(
      makeSections([
        makeTextBlock('preferred', '<!--hvy:radio-group contact-->\n( ) Email\n( ) Phone'),
        makeTextBlock('fallback', '(x) Postal mail\n<!--hvy:radio-group-->'),
        makeTextBlock('unrelated', '( ) Yes\n( ) No'),
      ])
    );

    expect(expectedResult.byKey.get('name:contact')?.members).toEqual([
      { sectionKey: 'section-1', blockId: 'preferred', answerIndex: 0, checked: false },
      { sectionKey: 'section-1', blockId: 'preferred', answerIndex: 1, checked: false },
      { sectionKey: 'section-1', blockId: 'fallback', answerIndex: 0, checked: true },
    ]);
    expect(expectedResult.byKey.get('run:section-1::unrelated:1')?.members).toEqual([
      { sectionKey: 'section-1', blockId: 'unrelated', answerIndex: 0, checked: false },
      { sectionKey: 'section-1', blockId: 'unrelated', answerIndex: 1, checked: false },
    ]);
    expect(expectedResult.orderedNames).toEqual(['contact']);
  });

  test('implicit groups never merge across components', () => {
    const expectedResult = buildInlineAnswerGroupIndex(
      makeSections([makeTextBlock('first', '( ) Email'), makeTextBlock('second', '( ) Phone')])
    );

    expect(getBlockAnswerGroups(expectedResult, 'section-1', 'first').get(0)).toBe('run:section-1::first:1');
    expect(getBlockAnswerGroups(expectedResult, 'section-1', 'second').get(0)).toBe('run:section-1::second:1');
  });

  test('the same name in two places refers to one group', () => {
    const expectedResult = buildInlineAnswerGroupIndex(
      makeSections([
        makeTextBlock('a', '<!--hvy:radio-group contact-->( ) Email<!--hvy:radio-group-->'),
        makeTextBlock('b', '<!--hvy:radio-group contact-->( ) Phone<!--hvy:radio-group-->'),
      ])
    );

    expect(expectedResult.byKey.get('name:contact')?.members).toEqual([
      { sectionKey: 'section-1', blockId: 'a', answerIndex: 0, checked: false },
      { sectionKey: 'section-1', blockId: 'b', answerIndex: 0, checked: false },
    ]);
    expect(expectedResult.orderedNames).toEqual(['contact']);
  });
});

describe('setAnswerRangeRadioGroup', () => {
  test('assigning a name to a bare run inserts the directive before it', () => {
    const expectedResult = setAnswerRangeRadioGroup('Pick one\n( ) Email\n( ) Phone', 0, 1, 'contact');

    expect(expectedResult).toBe('Pick one\n<!--hvy:radio-group contact-->\n( ) Email\n( ) Phone');
  });

  test('content after the range keeps the group it already had', () => {
    const expectedResult = setAnswerRangeRadioGroup(
      '( ) Email\n( ) Phone\n<!--hvy:radio-group other-->\n( ) Later',
      0,
      1,
      'contact'
    );

    expect(expectedResult).toBe(
      '<!--hvy:radio-group contact-->\n( ) Email\n( ) Phone\n<!--hvy:radio-group other-->\n( ) Later'
    );
  });

  test('a run already inside the target group is left untouched', () => {
    const expectedResult = setAnswerRangeRadioGroup(
      '<!--hvy:radio-group contact-->\n( ) Email\n( ) Phone',
      0,
      1,
      'contact'
    );

    expect(expectedResult).toBe('<!--hvy:radio-group contact-->\n( ) Email\n( ) Phone');
  });

  test('a run inheriting the group from an earlier component needs no directive', () => {
    const expectedResult = setAnswerRangeRadioGroup('( ) Postal mail', 0, 0, 'contact', 'contact');

    expect(expectedResult).toBe('( ) Postal mail');
  });

  test('clearing the name drops the run out of the group and restores it for later content', () => {
    const expectedResult = setAnswerRangeRadioGroup(
      '<!--hvy:radio-group contact-->\n( ) Email\n( ) Later',
      0,
      0,
      null
    );

    expect(expectedResult).toBe('( ) Email\n<!--hvy:radio-group contact-->\n( ) Later');
  });

  test('an inherited group is explicitly ended when the run leaves it', () => {
    const expectedResult = setAnswerRangeRadioGroup('( ) Postal mail\n( ) Later', 0, 0, null, 'contact');

    expect(expectedResult).toBe('<!--hvy:radio-group-->\n( ) Postal mail\n<!--hvy:radio-group contact-->\n( ) Later');
  });

  test('directives inside the range are dropped so one group wins', () => {
    const expectedResult = setAnswerRangeRadioGroup(
      '( ) Email\n<!--hvy:radio-group stray-->\n( ) Phone',
      0,
      1,
      'contact'
    );

    expect(expectedResult).toBe('<!--hvy:radio-group contact-->\n( ) Email\n( ) Phone');
  });
});

describe('getNearbyRadioGroupNames', () => {
  test('offers groups from adjacent components, nearest first', () => {
    const sections = makeSections([
      makeTextBlock('far', '<!--hvy:radio-group faraway-->( ) A<!--hvy:radio-group-->'),
      makeTextBlock('before', '<!--hvy:radio-group contact-->( ) B<!--hvy:radio-group-->'),
      makeTextBlock('target', 'no answers here'),
      makeTextBlock('after', '<!--hvy:radio-group shipping-->( ) C<!--hvy:radio-group-->'),
    ]);

    expect(getNearbyRadioGroupNames(sections, 'section-1', 'target', 1)).toEqual(['contact', 'shipping']);
    expect(getNearbyRadioGroupNames(sections, 'section-1', 'target', 2)).toEqual(['contact', 'shipping', 'faraway']);
  });
});

describe('clearSelectedRadioAnswers', () => {
  test('clears selected radios across components and leaves checkboxes alone', () => {
    const texts = new Map([
      ['preferred', '<!--hvy:radio-group contact-->\n(x) Email\n( ) Phone'],
      ['extras', '[x] Send a copy\n( ) Fax'],
    ]);
    const sections = makeSections([
      makeTextBlock('preferred', texts.get('preferred')!),
      makeTextBlock('extras', texts.get('extras')!),
    ]);

    const expectedResult = clearSelectedRadioAnswers(
      sections,
      (_sectionKey, blockId) => texts.get(blockId) ?? null,
      (_sectionKey, blockId, text) => texts.set(blockId, text)
    );

    expect(expectedResult).toEqual([{ sectionKey: 'section-1', blockId: 'preferred' }]);
    expect(texts.get('preferred')).toBe('<!--hvy:radio-group contact-->\n( ) Email\n( ) Phone');
    expect(texts.get('extras')).toBe('[x] Send a copy\n( ) Fax');
  });

  test('a document with nothing selected reports no changes', () => {
    const expectedResult = clearSelectedRadioAnswers(
      makeSections([makeTextBlock('pick', '( ) Email\n( ) Phone')]),
      () => '( ) Email\n( ) Phone',
      () => { throw new Error('should not write an unchanged block'); }
    );

    expect(expectedResult).toEqual([]);
  });
});
