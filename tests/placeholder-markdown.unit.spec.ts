import { expect, test } from 'vitest';
import { turndown } from '../src/markdown';

for (const [tag, delimiter] of [['strong', '**'], ['em', '_'], ['u', '___'], ['s', '~~']]) {
  test(`${tag} preserves template token source without Markdown escapes`, () => {
    expect(turndown.turndown(
      `<p>Before <${tag}><span class="template-value-token" data-template-value-token="fake_title"><span class="template-value-token-source">{% fake_title | text %}</span><span class="template-value-token-label">Fake Title · text</span></span></${tag}> after</p>`
    )).toBe(`Before ${delimiter}{% fake_title | text %}${delimiter} after`);
  });

  test(`${tag} preserves fill-in placeholder source without Markdown escapes`, () => {
    expect(turndown.turndown(
      `<p>Before <${tag}><span data-hvy-fill-in-marker="true" data-placeholder="Fake_title">Fake_title</span></${tag}> after</p>`
    )).toBe(`Before ${delimiter}<!-- value {"placeholder":"Fake_title"} -->${delimiter} after`);
  });
}
