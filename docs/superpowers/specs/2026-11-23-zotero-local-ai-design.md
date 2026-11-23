# Zotero Local AI — Design

Date: 2026-11-23
Status: Draft, awaiting review

## Goal

A Zotero 7/8 plugin that adds fully local AI features, running on Apple Silicon through Ollama:

1. **Local OCR** of scanned PDF pages with MiniCPM-V.
2. **A library-wide knowledge base**: chunk embeddings, a structured "paper card" per paper, and an entity/relation graph across all papers.
3. **Chat** with a local LLM (default `gemma4:12b`) that answers questions such as "what are the main results?", "how can I cite this?", "which of my papers use dataset X?", and cites its sources. Clicking a citation **highlights the cited passage** in Zotero's PDF reader.

Out of scope: modifying PDF files (no OCR text layer is written back), cloud models, sync of the AI index across devices, EPUB/snapshot support (SDT supports them, but v1 indexes PDFs only).

## Decisions

| Topic | Decision |
|---|---|
| Delivery | Bootstrap plugin (`.xpi`) in `zotero-local-ai/` inside this repo; Zotero core is unmodified and used only as reference/dev build. |
| Architecture | All logic in plugin JavaScript; Ollama HTTP API (`http://localhost:11434`) is the only external dependency. |
| Chat model | `gemma4:12b` (configurable). |
| OCR model | `openbmb/minicpm-v4.6` (configurable). |
| Embedding model | `nomic-embed-text` (768-d, configurable; `qwen3-embedding:4b` as a higher-quality option). Changing it triggers re-embedding. |
| Text source | `Zotero.SDT` (Structured Document Text) for pages with a text layer; OCR only for pages where SDT yields no text (setting: "OCR only empty pages" (default) / "never"). |
| Scope | Whole-library knowledge graph; chat scopable to current paper, collection, or library. |
| Indexing | Automatic background queue for new/changed PDFs; user-triggered bulk indexing of collection/library; pausable, with progress view. |
| Citations | Generated live from Zotero metadata via Zotero's citation engine and the user's Quick Copy style — never by the LLM. |

## Architecture

```
zotero-local-ai/
  manifest.json, bootstrap.js, prefs.js
  src/
    ollama.js      HTTP client: chat (stream), embed, generate w/ images, listModels
    extract.js     attachment -> passages [{text, pageIndex, rects, section}]
    ocr.js         render page (pdf.js) -> MiniCPM-V -> blocks w/ bboxes -> PDF coords
    chunker.js     passages -> chunks (~300-500 tokens, section-aware, rects kept)
    graph.js       paper card + entities/relations extraction, entity merging
    store.js       zotero-ai.sqlite schema + queries; in-memory vector index
    indexer.js     queue, Notifier hooks, hash-based invalidation, progress
    retriever.js   routing, hybrid search, graph traversal, context assembly
    citations.js   formatted citation/bibliography for an item via Zotero APIs
    chat/          reader sidebar panel, library chat pane, answer rendering
    highlight.js   navigate + temporary overlays + "save as annotation"
  test/            unit tests (Node, Mocha/Chai) and fixtures
```

Every module has one job and a small interface; pure logic (chunker, router, ranking, citation validation, entity merging, coordinate conversion) has no Zotero dependency so it is unit-testable in Node.

### Data model (`<Zotero data dir>/zotero-ai.sqlite`, via `Zotero.DBConnection`)

- `meta(key, value)` — schema version, embedding model name/dimension.
- `papers(attachmentID PK, itemID, libraryID, hash, status, error, card_json, indexed_at)` — status ∈ `queued | embedding | embedded | graphing | done | partial | skipped | error`.
- `chunks(id PK, attachmentID, ord, text, pageIndex, rects_json, section, source)` — `source` ∈ `sdt | ocr`. `rects_json` is a list of `{pageIndex, rects:[[x1,y1,x2,y2]]}` in PDF user-space coordinates (Zotero annotation position format).
- `chunks_fts` — FTS5 virtual table over `chunks.text`.
- `embeddings(chunkID PK, vec BLOB)` — Float32 little-endian.
- `entities(id PK, type, name, norm_name, description, vec BLOB)` — type ∈ `method | dataset | metric | task | finding | concept | author`.
- `mentions(entityID, chunkID)`.
- `relations(id PK, src, rel, dst, itemID, chunkID)` — e.g. `uses`, `proposes`, `evaluates_on`, `outperforms`, `extends`, `compares_to`.

Deleting a paper row cascades to its chunks, embeddings, mentions, and relations; orphaned entities are pruned.

### Paper card (JSON, validated against a schema)

```json
{
  "summary": "string",
  "contributions": [{"text": "...", "chunks": [12, 14]}],
  "methods":       [{"text": "...", "chunks": [...]}],
  "datasets":      [{"name": "...", "chunks": [...]}],
  "results":       [{"text": "...", "metric": "...", "value": "...", "chunks": [...]}],
  "limitations":   [{"text": "...", "chunks": [...]}]
}
```

Each item references supporting chunk IDs so card-based answers can still be cited and highlighted.

## Indexing pipeline

1. **Trigger**: a `Zotero.Notifier` observer queues PDF attachments on add/modify. The "Index with Local AI" context menu queues selected items or collections; Tools menu → "Index whole library".
2. **Hash check**: skip if `papers.hash` equals the attachment's current hash; otherwise delete old rows.
3. **Extract**: `Zotero.SDT.getReader(attachmentID)` → blocks with PDF anchors → passages. Pages with no text → `ocr.js`.
4. **OCR**: render the page at ~150 DPI with pdf.js (offscreen canvas in a hidden window). Send it to MiniCPM-V with a prompt asking for JSON blocks `{text, bbox:[x1,y1,x2,y2] normalized 0-1000}`. Convert the boxes to PDF coordinates using the page viewBox (y axis flipped). If the model returns no usable boxes, fall back to plain text with a whole-page rect.
5. **Chunk + embed**: chunker → batched `/api/embed` → store. Status becomes `embedded`, and the paper is now searchable.
6. **Graph**: Gemma call 1 builds the paper card (Ollama `format` = JSON schema, numbered chunks as input; long papers use a map-reduce over sections). Gemma call 2 extracts entities and relations with chunk references. Entities are merged with existing ones when `norm_name` matches, or when embedding cosine is ≥ 0.9 and the type is the same. Status becomes `done`.

Queue rules: one Ollama job at a time; chat requests pre-empt indexing; the indexer pauses while a chat answer is streaming; the queue can be paused and resumed; state survives restarts (status column).

## Chat and retrieval

### Surfaces
- **Reader sidebar panel** ("Local AI") registered through the plugin API (`Zotero.ItemPaneManager` / reader sidebar hooks). Default scope: current paper; toggle: library.
- **Library chat pane** (item-pane section or separate tab) with scope: library / current collection.

### Answering a question (`retriever.js`)
1. **Route** with rules first (e.g. "cite", "citation", "bibtex", "reference" → citation; "main result", "contribution", "summary", "method", "limitation" → card; "which papers", "compare", "across", "who uses" → graph), falling back to a small LLM classification. Multiple intents allowed.
2. **Citation intent**: `citations.js` formats the scoped item(s) in the Quick Copy style (plus BibTeX on request). Inserted verbatim; the LLM may only add explanation.
3. **Card intent**: include the relevant card fields plus their supporting chunks.
4. **Graph intent**: embed the question → top entities → 1–2 hop traversal over `relations` → linked papers + supporting chunks.
5. **Detail intent / always**: hybrid search in scope: cosine top-k (k=20) + FTS5 BM25 top-k, combined with reciprocal rank fusion → top 8 chunks.
6. **Prompt**: numbered sources `[n] (Author Year, p. X)` + instruction to cite only `[n]` and to say when the sources don't contain the answer. Stream through `/api/chat`.
7. **Post-process**: drop `[n]` markers that don't refer to a provided source; render each valid one as a chip.

Chat history is kept in memory per panel (the last ~6 turns are sent); it is not persisted in v1.

## Highlighting

- **Chip click**: `Zotero.Reader.open(attachmentID, { pageIndex, position: {pageIndex, rects} })` opens or focuses the tab and navigates to the passage; the reader's built-in navigation flash marks it.
- **Temporary overlays**: when an answer completes in the reader panel, all cited chunks of the open paper are shown as temporary, non-persisted highlights (via the reader's internal annotation display, removed when the next answer arrives or the panel closes). If the reader API makes overlays impossible without core changes, fall back to the navigation flash alone. This is a verification item for build step 2.
- **Save as annotation**: creates a real highlight annotation (`Zotero.Annotations.saveFromJSON`) with the chunk text, tag `ai-cited`, and the question as the comment.
- OCR-derived rects are approximate (block level); SDT rects are exact.

## Error handling

- Ollama unreachable or model missing → banner with the cause and a copyable `ollama pull <model>`; the indexer pauses and retries with exponential backoff (max 5 min).
- Invalid JSON from Gemma → retry once with the validation error; then status `partial` (chunks and embeddings stay usable).
- Encrypted, missing, or unreadable PDF → `skipped` with reason, shown in the index status view.
- Embedding model changed → `meta` mismatch detected at startup → prompt to re-embed (vectors only; cards and graph kept).
- All errors logged with `Zotero.debug` under the prefix `[LocalAI]`.

## Performance targets (Apple Silicon, 16 GB+)

- Embedding a 15-page paper: ~2-5 s. Paper card + graph: ~1-3 min. OCR: ~5-10 s per scanned page.
- Retrieval over 100k chunks: < 300 ms (exact cosine on contiguous Float32Array, loaded lazily per library).
- The UI never blocks: batches yield to the event loop; heavy loops are chunked.

## Testing

- **Unit (Node, Mocha + Chai, test-first)**: chunker, router, RRF ranking, citation-marker validation, entity normalization/merging, OCR bbox → PDF coordinate conversion, card JSON validation, Ollama client (mocked fetch, streaming parsing).
- **Integration (in a development Zotero, plugin test harness)**: store schema/cascade, indexer hash invalidation, SDT extraction on a fixture PDF, reader navigation.
- **End-to-end (manual checklist, real Ollama)**: fixtures — 2-page text PDF, scanned PDF, two related papers sharing a dataset. Questions: "what are the main results?", "how can I cite this?", "which papers use <dataset>?"; check that chips navigate to and highlight the right passage.

## Build order

1. Plugin skeleton (manifest, bootstrap, prefs pane) and Ollama client with a health check.
2. SDT extraction → chunking → embeddings → single-paper chat in the reader sidebar with clickable, highlighted citations and live citation formatting.
3. Background indexer and library/collection-scoped hybrid search; index status view.
4. MiniCPM-V OCR for text-less pages.
5. Paper cards, entity/relation graph, graph-based routing.
6. (Optional) Interactive graph view.

Each step is shippable on its own.

## Open risks

- **Reader API for temporary overlays**: may need reader internals; fallback defined above.
- **Rendering pages for OCR inside the plugin**: pdf.js availability in the plugin context must be confirmed in step 4. Fallback: use the reader's own rendering via a hidden reader instance.
- **MiniCPM-V bounding-box reliability**: mitigated by the plain-text fallback with a whole-page rect.
- **Graph quality from a 12B model**: mitigated by a constrained JSON schema, a fixed relation vocabulary, and chunk-grounded extraction.
