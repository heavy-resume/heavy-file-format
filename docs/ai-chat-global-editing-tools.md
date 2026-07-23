# Tools for Complex AI Editing Across an HVY Document

## Status

Design proposal for review. This does not change the HVY file format.

## Problem

AI chat already has a virtual CLI for inspecting, editing, traversing, and validating an open document. It should remain the primary interface.

Two gaps remain:

1. Tool-oriented models often guess HVY CLI syntax even when CLI help is in context.
2. Coordinated edits across distant virtual files are cumbersome as separate CLI commands.

Automatically supplied search results also cause anchoring: models may treat weak candidates as instructions. Search should be an explicit model decision.

## Editing Strategy

Before editing, the agent should classify the request:

1. **Localized**
   - A small, known, or readily discovered section or component.
   - Use the CLI to inspect and edit it.

2. **Exhaustive**
   - Requires reviewing the whole document or close to it.
   - Traverse the relevant scope with the CLI in bounded batches.
   - Search may prioritize the work but does not prove completeness.

3. **Searchable batch**
   - Search can identify likely targets and the edits can be applied together.
   - Search, inspect uncertain candidates with the CLI, then batch patch.

Requests using words such as “all,” “every,” or “throughout” normally require exhaustive traversal unless an exact search can prove coverage.

## Tool Surface

1. `run_hvy_cli`
2. `search_hvy_document`
3. `apply_hvy_patch`
4. `finish_task`
5. `ask_user`

There is intentionally no structured read or planning tool. Known paths should be inspected with the CLI so it remains the driver.

The chat startup context may include neutral structure, diagnostics, and an explicitly selected component. It should not automatically search based on the request.

## `search_hvy_document`

Find likely locations for a concept without requiring CLI syntax.

```ts
interface SearchHvyDocumentInput {
  query: string;
  limit?: number;
  cursor?: string;
}
```

Behavior:

- Use the existing document embedding index exclusively when it is available.
- Otherwise use the current local search as a fallback.
- `hvy search` and this tool must share one search service.
- Aggregate matching chunks into stable, editable section or component paths.
- Return ordered results with compact excerpts.
- Do not expose raw scores or confidence labels; relative ordering is what matters.
- Report whether embeddings or lexical fallback produced the results.
- Support continuation with a cursor.
- Do not imply that search results are exhaustive.

```ts
interface SearchHvyDocumentResult {
  mode: "embeddings" | "lexical_fallback";
  query: string;
  results: Array<{
    path: string;
    kind: "section" | "component" | "section-template" | "doc";
    type: string;
    excerpt?: string;
  }>;
  nextCursor?: string;
  fallbackReason?: string;
}
```

## `apply_hvy_patch`

Apply contextual edits to several existing writable virtual files in one operation.

```text
*** Begin Patch
*** Update File: /body/example-section/example-text/text.txt
@@
-Old visible text.
+New visible text.
*** Update File: /body/example-section/example-card/example-card.json
@@
-  "label": "Old label",
+  "label": "New label",
*** End Patch
```

Initial scope:

- Update existing absolute virtual paths only.
- No add, delete, move, or rename directives; use the CLI for structural changes.
- No raw HVY or other read-only targets.
- Exact contextual matching only.

Application:

1. Parse the complete patch before mutation.
2. Apply all hunks for one file to an in-memory copy.
3. If any hunk fails to match uniquely, leave that file unchanged.
4. Write a successful file once through the shared CLI virtual-file write path.
5. Continue to later files after a file fails.
6. Group all successful files into one chat mutation/history operation.

Files, not hunks, are the unit of partial success. This avoids invalid intermediate structured content and prevents a file from being left half-patched.

```ts
interface ApplyHvyPatchResult {
  appliedFileCount: number;
  failedFileCount: number;
  files: Array<
    | {
        status: "applied";
        path: string;
        hunkCount: number;
      }
    | {
        status: "failed";
        path: string;
        error: string;
        currentContext?: string;
      }
  >;
  diagnostics?: HvyCliDiagnosticIssue[];
}
```

Keep results compact:

- List each file and status.
- Include repair context only for failures.
- Do not repeat successful patch content.
- Keep mutation and refresh metadata internal unless the model can act on it.

## Models Without Native Tools

Native and text-only models should use the same logical tools and dispatcher.

Models without a native `tools` parameter can emit a constrained call:

```json
{
  "tool": "search_hvy_document",
  "arguments": {
    "query": "references to unusually fast software development",
    "limit": 20
  }
}
```

Both transports must share validation, execution, results, mutations, diagnostics, refresh behavior, and traces. Fenced shell commands may remain a compatibility fallback.

## Model Guidance

1. Classify the request as localized, exhaustive, or searchable batch.
2. Use the CLI for localized work and exhaustive traversal.
3. Use search only when candidate discovery helps.
4. Inspect uncertain candidates with the CLI.
5. Use direct CLI commands for ordinary local or structural edits.
6. Use a patch for coordinated edits across understood files.
7. Repair only failed files after partial success.
8. Verify with the appropriate semantic search, literal search, traversal, structure, preview, and lint checks.
9. Finish only after reviewing the requested scope.

## TODO

### Search foundation

- [x] Extract one document-search service shared by `hvy search` and chat tools.
- [x] Connect it to the existing embedding provider and prepared runtime index.
- [x] Use lexical search only when embeddings are unavailable or fail.
- [x] Aggregate embedding chunks into stable HVY paths with compact excerpts.
- [x] Preserve component-level targets in the prepared embedding index; long individual components remain chunked.
- [x] Add cursor-based continuation.
- [x] Remove model-facing scores from `hvy search`.
- [x] Add search mode and fallback reason to results.
- [x] Invalidate embedding search after document mutations and reuse unchanged component vectors during refresh.
- [x] Add search service tests for embedding, fallback, aggregation, and cursors.

### Chat search tool

- [x] Add the `search_hvy_document` native tool definition and validation.
- [x] Dispatch it through the shared search service.
- [x] Add the equivalent constrained text call for models without native tools.
- [x] Remove automatic request-based search from chat startup.
- [x] Keep neutral startup structure, diagnostics, and selected-component context.
- [x] Test equivalent native and text-only results.
- [x] Exercise embedding search through the existing CLI Sim state machine.

### Shared patch foundation

- [x] Extract a reusable virtual-file write operation from the CLI command layer.
- [x] Preserve validation, failed structured-write sidecars, path invalidation, and refresh metadata.
- [x] Implement and test the constrained patch parser.
- [x] Implement exact unique contextual matching.
- [x] Apply all hunks in memory and write each successful file once.

### Chat patch tool

- [x] Add the `apply_hvy_patch` native tool definition and validation.
- [x] Add the equivalent constrained text call.
- [x] Return compact per-file success and failure results.
- [x] Collect diagnostics once after patch application.
- [x] Group successful files into one chat mutation/history operation.
- [x] Preserve mutation reporting when patching and finishing occur in the same tool turn.
- [x] Test text, JSON, CSS, table, ordering, read-only, invalid, and partial-success cases.

### Agent guidance and evaluation

- [x] Add localized, exhaustive, and searchable-batch guidance.
- [x] Make clear that semantic search is not exhaustive.
- [ ] Evaluate a localized edit.
- [ ] Evaluate a semantic batch edit.
- [ ] Evaluate a coordinated content, configuration, and CSS edit.
- [ ] Evaluate removal of every paraphrased reference to a concept in a large document.
- [ ] Compare native-tool and text-only models for guessed syntax, turns, failures, missed targets, and final validity.

## Open Questions

1. What result batch size balances useful search coverage against tool-history growth?
2. What chunk aggregation rules produce the best editable candidates?
3. Should embedding failure automatically use lexical fallback or report the failure first?
4. Which neutral startup commands remain worth their token cost?
