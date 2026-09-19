import { stringify as stringifyYaml } from 'yaml';

/**
 * Serializes HVY YAML (front matter, reusable definitions, plugin specs).
 *
 * `blockQuote: 'literal'` keeps multi-line strings as literal block scalars. The `yaml`
 * default also allows folded `>` scalars, which it switches to as soon as one line passes
 * the fold width; that splits the long line and re-encodes every real newline as a blank
 * line. It round trips through the parser but wrecks verbatim text for anyone reading or
 * editing the YAML by hand: plugin scripts, and any block `text` carrying a plugin spec
 * through a reusable definition.
 *
 * Single-line strings are unaffected and still wrap at the default line width.
 */
export function stringifyYamlUnfolded(value: unknown): string {
  return stringifyYaml(value, { blockQuote: 'literal' });
}
