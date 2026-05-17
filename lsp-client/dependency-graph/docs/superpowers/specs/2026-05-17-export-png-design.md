# Export PNG Feature Design

**Date:** 2026-05-17  
**Branch:** export-file  
**Status:** Approved

## Summary

Add an "Export PNG" button to the graph header that downloads a full-project dependency graph as a single PNG image — a complete ERD-style snapshot of all files, functions, classes, methods, and their call/import relationships.

---

## 1. Data Layer — `GraphCache.getAllElements()`

**File:** `src/lib/GraphCache.js`

Add a new method `getAllElements()` that returns Cytoscape-ready elements for the entire project graph (not scoped to any navigation level).

**Nodes:**
- Include every node whose `type` is `file`, `function`, `method`, or `class`.
- Exclude `folder` and `root` nodes (they are navigation artifacts, not content).
- Functions/methods/classes get a `parent` property pointing to their file ID, so Cytoscape renders them as compound children inside their file node — consistent with the existing level view.

**Edges:**
- Include all `calls` and `imports` edges where both `source` and `target` exist in `this._nodes`.
- Deduplicate using the same `type|source|target` key pattern as `getLevelElements`.

**Signature:**
```js
getAllElements() → { nodes: { data: Record<string, unknown> }[], edges: { data: Record<string, unknown> }[] }
```

---

## 2. Export Logic — `GraphView.svelte`

**File:** `src/lib/GraphView.svelte`

A new `exportPng()` async function triggered by the button click.

**Steps:**
1. Set `exportState = 'generating'` (disables button, changes label).
2. Create a hidden `<div>` appended to `document.body`, positioned off-screen at a fixed size (e.g. `3000×2000px`) to give the layout room.
3. Instantiate a temporary Cytoscape instance with:
   - Elements from `graphCache.getAllElements()`
   - Same stylesheet as the live graph (`buildStyle()`)
   - `cose-bilkent` layout (same params as the live render, but with higher `numIter` for the larger node count)
   - **No** `cytoscape-edge-connections` plugin — edges are added as standard Cytoscape edges to avoid aux-node artifacts in the exported image.
4. Wait for layout `stop` event.
5. Call `cy.png({ output: 'blob', full: true, scale: 2, bg: '#1e1e1e' })` to produce a high-resolution PNG blob with the dark background.
6. Trigger download: create a temporary `<a>`, set `href = URL.createObjectURL(blob)`, `download = 'dependency-graph.png'`, click it, revoke the URL.
7. Destroy the temp Cytoscape instance, remove the hidden div, reset `exportState = 'idle'`.

**State variable:**
```js
let exportState = 'idle'; // 'idle' | 'generating'
```

---

## 3. UI — Export Button

**File:** `src/lib/GraphView.svelte` (template section), `src/lib/GraphView.css`

A button added inside `<header class="header">`, to the right of the legend nav (the header already uses `justify-content: space-between`, so the button slots in naturally on the right side).

**States:**
- **Idle:** label `Export PNG`, styled like `.back-btn` (border `#444`, color `#ccc`).
- **Generating:** label `Generating…`, `disabled`, opacity reduced — same as `.back-btn:disabled`.

The button is only rendered when `graphCache` is non-null (i.e. data has loaded).

No modal, no format picker, no extra options.

---

## Constraints & Decisions

- **No new dependencies.** `cy.png()` is built into Cytoscape 3.x.
- **`cytoscape-edge-connections` is skipped** for the export render. The plugin adds invisible aux nodes that appear as dots in exports. Standard Cytoscape edges are sufficient for a static image.
- **Scale 2** produces a 6000×4000px image at the hidden div's base size — enough resolution to read function names after zooming in.
- **No folder nodes** in the full graph. Folders are a navigation UI concept; the full graph shows content nodes only, which is what makes it ERD-like.
- **Layout may take a few seconds** on large projects. The `Generating…` button state communicates this without a separate loading overlay.
