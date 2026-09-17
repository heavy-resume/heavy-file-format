import { expect, test } from 'vitest';
import { parseFormSpec } from '../src/plugins/form';
import { createLiveState, reconcileLiveState } from '../src/plugins/form-live-state/form-live-state';

test('definition edits replace defaults and options while preserving unrelated live input', () => {
  const spec = parseFormSpec(`fields:
  - label: Fake choice
    type: select
    options: [Fake old, Fake spare]
    value: Fake old
  - label: Fake text
    value: Fake before
  - label: Fake untouched
    value: Fake default
`).spec;
  const live = createLiveState(spec);
  live.values['Fake untouched'] = 'Fake typed';
  live.errors['Fake text'] = 'Fake error';
  expect(live.values).toEqual({ 'Fake choice': 'Fake old', 'Fake text': 'Fake before', 'Fake untouched': 'Fake typed' });

  spec.fields[0]!.options = [{ label: 'Fake new', value: 'Fake new' }];
  spec.fields[0]!.value = 'Fake new';
  spec.fields[1]!.value = 'Fake after';
  reconcileLiveState(live, spec);

  expect(live.values).toEqual({ 'Fake choice': 'Fake new', 'Fake text': 'Fake after', 'Fake untouched': 'Fake typed' });
  expect(live.options['Fake choice']).toEqual([{ label: 'Fake new', value: 'Fake new' }]);
  expect(live.errors).toEqual({});
});

test('unchanged definitions preserve script values, script options, input, and errors across repeated refreshes', () => {
  const spec = parseFormSpec(`fields:
  - label: Fake choice
    type: select
    options: [Fake default]
  - label: Fake text
    value: Fake default
`).spec;
  const live = createLiveState(spec);
  live.options['Fake choice'] = [{ label: 'Fake scripted', value: 'Fake scripted' }];
  live.values['Fake choice'] = 'Fake scripted';
  live.values['Fake text'] = 'Fake typed';
  live.errors['Fake text'] = 'Fake error';

  spec.fields[1]!.placeholder = 'Fake updated hint';
  reconcileLiveState(live, structuredClone(spec));
  reconcileLiveState(live, structuredClone(spec));

  expect(live.values).toEqual({ 'Fake choice': 'Fake scripted', 'Fake text': 'Fake typed' });
  expect(live.options['Fake choice']).toEqual([{ label: 'Fake scripted', value: 'Fake scripted' }]);
  expect(live.errors).toEqual({ 'Fake text': 'Fake error' });
});

for (const type of ['select', 'radio']) {
  test(`${type} options edits preserve valid selections and replace removed selections`, () => {
    const spec = parseFormSpec(`fields:
  - label: Fake choice
    type: ${type}
    options: [Fake first, Fake selected]
`).spec;
    const live = createLiveState(spec);
    live.values['Fake choice'] = 'Fake selected';

    spec.fields[0]!.options[1]!.label = 'Fake renamed';
    reconcileLiveState(live, spec);

    expect(live.values['Fake choice']).toBe('Fake selected');
    expect(live.options['Fake choice']![1]).toEqual({ label: 'Fake renamed', value: 'Fake selected' });

    spec.fields[0]!.options.pop();
    reconcileLiveState(live, spec);

    expect(live.values['Fake choice']).toBe('Fake first');

    spec.fields[0]!.options = [];
    reconcileLiveState(live, spec);

    expect(live.values['Fake choice']).toBe('');
  });
}

test('type changes reset incompatible live state and removed fields are fresh when readded', () => {
  const spec = parseFormSpec('fields:\n  - label: Fake field\n    type: text\n    value: Fake default').spec;
  const live = createLiveState(spec);
  live.values['Fake field'] = 'Fake typed';
  live.options['Fake field'] = [{ label: 'Fake option', value: 'Fake option' }];
  live.errors['Fake field'] = 'Fake error';

  reconcileLiveState(live, parseFormSpec('fields:\n  - label: Fake field\n    type: checkbox\n    value: false').spec);

  expect(live.values['Fake field']).toBe(false);
  expect(live.options['Fake field']).toEqual([]);
  expect(live.errors).toEqual({});

  reconcileLiveState(live, parseFormSpec('fields: []').spec);

  expect(live.values).toEqual({});
  expect(live.options).toEqual({});
  expect(live.definitions.size).toBe(0);

  reconcileLiveState(live, spec);

  expect(live.values['Fake field']).toBe('Fake default');
});

test('equivalent photo defaults preserve live changes while edited photo defaults are applied', () => {
  const spec = parseFormSpec(`fields:
  - label: Fake photo
    type: photo
    value:
      attachmentId: fake-a
      imageFile: fake-a.png
      mediaType: image/png
`).spec;
  const live = createLiveState(spec);
  live.values['Fake photo'] = { attachmentId: 'fake-user', imageFile: 'fake-user.png', mediaType: 'image/png' };

  reconcileLiveState(live, structuredClone(spec));

  expect(live.values['Fake photo']).toEqual({ attachmentId: 'fake-user', imageFile: 'fake-user.png', mediaType: 'image/png' });

  spec.fields[0]!.value = { attachmentId: 'fake-b', imageFile: 'fake-b.png', mediaType: 'image/png' };
  reconcileLiveState(live, spec);

  expect(live.values['Fake photo']).toEqual({ attachmentId: 'fake-b', imageFile: 'fake-b.png', mediaType: 'image/png' });
});
