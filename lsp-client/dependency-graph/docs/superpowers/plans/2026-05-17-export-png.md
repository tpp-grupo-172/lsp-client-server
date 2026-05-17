# Export PNG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Export PNG" button to the graph header that downloads the entire project dependency graph as a single high-resolution PNG.

**Architecture:** `GraphCache.getAllElements()` collects all content nodes (files, functions, classes, methods) and all calls/import edges from `_nodes` and `_edges`. `exportPng()` in `GraphView.svelte` spins up a temporary off-screen Cytoscape instance with those elements, runs the cose-bilkent layout, calls `cy.png()`, and triggers a browser download. A button in the header drives the flow with idle/generating states.

**Tech Stack:** Svelte 5, Cytoscape 3.33 (built-in `cy.png()`), cytoscape-cose-bilkent

---

## File Map

| File | Change |
|------|--------|
| `src/lib/GraphCache.js` | Add `getAllElements()` method |
| `src/lib/GraphView.svelte` | Add `exportState`, `exportPng()`, export button in `<header>` |
| `src/lib/GraphView.css` | Add `.export-btn` styles |

---

### Task 1: Add `getAllElements()` to GraphCache

**Files:**
- Modify: `src/lib/GraphCache.js`

- [ ] **Step 1: Add the method at the end of the GraphCache class, before the closing `}`**

  Open `src/lib/GraphCache.js`. After the `getLevelElements` method (ends at line 217), and before the closing `}` of the class (line 218), insert:

  ```js
  /**
   * Returns all content nodes (files, functions, classes, methods) and all
   * calls/imports edges across the entire project — not scoped to any level.
   * Used for full-graph PNG export.
   *
   * @returns {{ nodes: { data: Record<string, unknown> }[], edges: { data: Record<string, unknown> }[] }}
   */
  getAllElements() {
    /** @type {{ data: Record<string, unknown> }[]} */
    const cytoscapeNodes = [];
    /** @type {{ data: Record<string, unknown> }[]} */
    const cytoscapeEdges = [];

    for (const [id, node] of this._nodes) {
      if (node.type === 'folder') continue;

      /** @type {Record<string, unknown>} */
      const data = { ...node };

      if (node.type === 'file') {
        data.displayLabel = '📄  ' + node.label;
      }

      const parentId = this._parentMap.get(id);
      if (parentId) {
        const parentNode = this._nodes.get(parentId);
        if (parentNode && parentNode.type !== 'folder') {
          data.parent = parentId;
        }
      }

      cytoscapeNodes.push({ data });
    }

    const addedEdgeKeys = new Set();
    for (const edge of this._edges) {
      if (edge.type !== 'calls' && edge.type !== 'imports') continue;

      const sourceNode = this._nodes.get(edge.source);
      const targetNode = this._nodes.get(edge.target);
      if (!sourceNode || !targetNode) continue;
      if (sourceNode.type === 'folder' || targetNode.type === 'folder') continue;

      const key = `${edge.type}|${edge.source}|${edge.target}`;
      if (addedEdgeKeys.has(key)) continue;
      addedEdgeKeys.add(key);

      cytoscapeEdges.push({
        data: { id: key, source: edge.source, target: edge.target, type: edge.type }
      });
    }

    return { nodes: cytoscapeNodes, edges: cytoscapeEdges };
  }
  ```

- [ ] **Step 2: Verify in the browser console**

  Run: `pnpm dev`, open `http://localhost:5173`, open DevTools console, paste:

  ```js
  // The graphCache is not directly exposed, so verify via the bundle
  // Just confirm no import errors on load — check the console for red errors
  ```

  Expected: No red errors in the console. The app loads normally.

- [ ] **Step 3: Commit**

  ```bash
  git add src/lib/GraphCache.js
  git commit -m "feat: add GraphCache.getAllElements() for full-graph export"
  ```

---

### Task 2: Add export logic to GraphView.svelte

**Files:**
- Modify: `src/lib/GraphView.svelte`

- [ ] **Step 1: Add `exportState` variable after the existing state block**

  In `GraphView.svelte`, find the state block that ends with:
  ```js
  /** @type {string | null} */
  let _prevNodeId = null;
  ```

  After that line, add:
  ```js
  // ── Export state ─────────────────────────────────────────────────────────────
  /** @type {'idle' | 'generating'} */
  let exportState = 'idle';
  ```

- [ ] **Step 2: Add the `exportPng` function**

  Find the `shortPath` function (last function in the `<script>` block, around line 647):
  ```js
  /** @param {string | undefined} path */
  function shortPath(path) {
  ```

  Add the following function immediately before `shortPath`:

  ```js
  async function exportPng() {
    if (exportState === 'generating') return;
    exportState = 'generating';

    // Yield to event loop so Svelte can update button to "Generating…" state
    await new Promise((r) => setTimeout(r, 0));

    const hiddenDiv = document.createElement('div');
    hiddenDiv.style.cssText =
      'position:absolute;left:-9999px;top:-9999px;width:3000px;height:2000px;pointer-events:none;';
    document.body.appendChild(hiddenDiv);

    const { nodes, edges } = graphCache.getAllElements();

    const tempCy = cytoscape(/** @type {any} */ ({
      container: hiddenDiv,
      elements: { nodes, edges },
      style: buildStyle(),
      userZoomingEnabled: false,
      userPanningEnabled: false,
      boxSelectionEnabled: false,
      pixelRatio: window.devicePixelRatio ?? 1
    }));

    tempCy.layout(/** @type {any} */ ({
      name: 'cose-bilkent',
      nodeDimensionsIncludeLabels: true,
      edgeElasticity: 0.08,
      nodeRepulsion: 4500,
      idealEdgeLength: 120,
      nestingFactor: 0.1,
      gravity: 0.15,
      numIter: 2500,
      tile: true,
      padding: 60,
      randomize: false,
      animate: false
    })).run();

    const dataUrl = tempCy.png({ output: 'base64uri', full: true, scale: 2, bg: '#1e1e1e' });

    tempCy.destroy();
    document.body.removeChild(hiddenDiv);

    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = 'dependency-graph.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    exportState = 'idle';
  }
  ```

- [ ] **Step 3: Verify the function wires up without errors**

  With `pnpm dev` running, check the browser console. Expected: no errors on load. The `exportPng` function is not called yet — we're just confirming the script parses cleanly.

- [ ] **Step 4: Commit**

  ```bash
  git add src/lib/GraphView.svelte
  git commit -m "feat: add exportPng() function to GraphView"
  ```

---

### Task 3: Add export button to header + styles

**Files:**
- Modify: `src/lib/GraphView.svelte` (template section)
- Modify: `src/lib/GraphView.css`

- [ ] **Step 1: Add the export button to the header**

  In `GraphView.svelte`, find the closing `</nav>` tag of the legend nav (around line 701):
  ```svelte
  		</nav>
  	</header>
  ```

  Replace just that closing `</nav>` + `</header>` block with:
  ```svelte
  		</nav>

  		<button
  			class="export-btn"
  			on:click={exportPng}
  			disabled={exportState === 'generating'}
  			title="Export full project graph as PNG"
  		>
  			{exportState === 'generating' ? 'Generating…' : 'Export PNG'}
  		</button>
  	</header>
  ```

- [ ] **Step 2: Add `.export-btn` styles to GraphView.css**

  Open `src/lib/GraphView.css`. After the `.back-btn:disabled` rule (around line 53), add:

  ```css
  .export-btn {
  	display: flex;
  	align-items: center;
  	background: none;
  	border: 1px solid #444;
  	color: #ccc;
  	padding: 4px 12px;
  	border-radius: 4px;
  	cursor: pointer;
  	font-size: 12px;
  	font-family: inherit;
  	white-space: nowrap;
  	transition:
  		background 0.15s,
  		color 0.15s;
  }

  .export-btn:hover:not(:disabled) {
  	background: #3c3c3c;
  	color: #fff;
  }

  .export-btn:disabled {
  	opacity: 0.3;
  	cursor: default;
  }
  ```

- [ ] **Step 3: Manual end-to-end test**

  With `pnpm dev` running:
  1. Open `http://localhost:5173` — confirm the "Export PNG" button is visible in the header on the right side.
  2. Click "Export PNG" — button should change to "Generating…" and become disabled.
  3. After a few seconds (layout runs), button returns to "Export PNG" and a file named `dependency-graph.png` downloads.
  4. Open the downloaded PNG — confirm it shows all files, functions, and edges in a dark background graph. Confirm it is not blank.
  5. Click the back button and navigate into a sub-folder, then click "Export PNG" again — confirm the downloaded PNG still shows the **full** project graph (not just the current folder).

- [ ] **Step 4: Commit**

  ```bash
  git add src/lib/GraphView.svelte src/lib/GraphView.css
  git commit -m "feat: add Export PNG button to graph header"
  ```
