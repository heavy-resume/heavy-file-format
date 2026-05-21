export const DEFAULT_DIAGRAM_SOURCE = [
  'flowchart TD',
  '  start[Start] --> review{Review}',
  '  review -->|Approved| ship[Ship]',
  '  review -->|Needs work| edit[Edit]',
  '  edit --> review',
].join('\n');

export const DEFAULT_DIAGRAM_SYNTAX = 'mermaid';
