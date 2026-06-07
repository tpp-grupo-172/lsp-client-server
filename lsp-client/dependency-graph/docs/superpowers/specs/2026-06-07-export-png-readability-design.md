# Export PNG Readability — Design Spec

**Date:** 2026-06-07  
**Status:** Approved

## Problem

The exported PNG is a flat horizontal strip (~25000×239 px) where all nodes appear in a single row and labels are unreadable. Root cause: the `breadthfirst` layout in pass 1 receives nodes with no edges between them, so it places every file node in one line. Font sizes (8–11px) and child node dimensions (88×18px) compound the readability problem.

## Scope

Only `buildExportStyle()` and `exportPng()` in `GraphView.svelte` are changed. No changes to the interactive view, data model, or any other file.

## Design

### 1. Layout — Pass 1 (top-level nodes)

Replace `breadthfirst` with `grid` layout:

```js
tempCy.layout({
  name: 'grid',
  padding: 60,
  spacingFactor: 2.0,
  cols: Math.ceil(Math.sqrt(fileNodes.length)),
  animate: false,
}).run();
```

- `cols: Math.ceil(Math.sqrt(n))` produces a roughly square grid for any count of files (works from 1 to 100+).
- `spacingFactor: 2.0` leaves vertical space between rows for the children block placed in pass 2.

### 2. Node sizes and fonts — `buildExportStyle()`

| Selector | Property | Before | After |
|----------|----------|--------|-------|
| `node[type="folder"]` | font-size | 11 | 16 |
| `node[type="file"]` | font-size | 10 | 14 |
| `node[type="class"]` | font-size | 8 | 12 |
| `node[type="class"]` | width × height | 88×18 | 120×24 |
| `node[type="class"]` | text-max-width | 80px | 110px |
| `node[type="function"]` | font-size | 8 | 12 |
| `node[type="function"]` | width × height | 88×18 | 120×24 |
| `node[type="function"]` | text-max-width | 80px | 110px |
| `node[type="method"]` | font-size | 8 | 12 |
| `node[type="method"]` | width × height | 88×18 | 120×24 |
| `node[type="method"]` | text-max-width | 80px | 110px |

### 3. Pass 2 constants (child positioning)

| Constant | Before | After |
|----------|--------|-------|
| CHILD_W | 88 | 120 |
| CHILD_H | 18 | 24 |
| COLS | 4 | 3 |
| GAP_X | 5 | 8 |
| GAP_Y | 4 | 6 |

### 4. PNG scale

`tempCy.png({ ..., scale: 3, ... })` — up from 2, for crisper text rendering.

## Verification

After implementing, export a PNG from the mid-mock project and visually confirm:
- Nodes are distributed in a grid (not a single line)
- File and function labels are legible
- Image dimensions are roughly square (not a flat strip)
