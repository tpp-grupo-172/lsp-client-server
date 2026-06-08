<!-- src/lib/GraphView.svelte -->
<script>
	import cytoscape from 'cytoscape';
	import { onDestroy, onMount } from 'svelte';
// @ts-ignore -- no type declarations for cytoscape-cose-bilkent
	import coseBilkent from 'cytoscape-cose-bilkent';
	// @ts-ignore -- no type declarations for cytoscape-edge-connections
	import edgeConnections from 'cytoscape-edge-connections';
	import './GraphView.css';
	import { sendMessage, sendMessageAndWait, vscode } from './vscode';

	cytoscape.use(coseBilkent);
	cytoscape.use(edgeConnections);

	/** @type {import('./GraphCache').GraphCache} */
	export let graphCache;

	// ── DOM refs ────────────────────────────────────────────────────────────────
	/** @type {HTMLElement} */
	let container;

	// ── State ───────────────────────────────────────────────────────────────────
	/** @type {cytoscape.Core | null} */
	let cy = null;

	/** @type {any | null} */
	let ec = null;

	/** @type {string[]} Stack of folder IDs visited (index 0 = root) */
	let navigationStack = [];

	/**
	 * Selected node, optionally extended with the resolved parent file.
	 * @type {(import('./protocol').InternalNode & { _parentFile?: import('./protocol').InternalNode | null }) | null}
	 */
	let selectedNode = null;

	// ── Rename state ─────────────────────────────────────────────────────────────
	/** @type {'idle' | 'editing' | 'loading' | 'success' | 'error'} */
	let renameState = 'idle';
	let renameValue = '';
	let renameError = '';
	/** @type {string | null} */
	let _prevNodeId = null;

	// ── Export state ─────────────────────────────────────────────────────────────
	/** @type {'idle' | 'generating' | 'done' | 'error'} */
	let exportState = 'idle';
	/** @type {string} */
	let exportErrorMsg = '';

	// Reset rename state when selected node changes
	$: {
		if (selectedNode?.id !== _prevNodeId) {
			_prevNodeId = selectedNode?.id ?? null;
			renameState = 'idle';
			renameValue = '';
			renameError = '';
		}
	}

	function startRename() {
		renameValue = selectedNode?.label ?? '';
		renameState = 'editing';
	}

	function cancelRename() {
		renameState = 'idle';
		renameValue = '';
		renameError = '';
	}

	/** Extrae el nombre de clase del ID de un nodo método (mth::file::ClassName::method)
	 * @param {string | null | undefined} id */
	function classNameFromNodeId(id) {
		if (!id?.startsWith('mth::')) return null;
		const parts = id.split('::');
		return parts.length >= 4 ? parts[2] : null;
	}

	function submitRename() {
		if (!selectedNode || !renameValue.trim() || renameValue.trim() === selectedNode.label) {
			cancelRename();
			return;
		}
		renameState = 'loading';
		sendMessage('rename-function', {
			filePath: selectedNode.path,
			oldName: selectedNode.label,
			newName: renameValue.trim(),
			line: selectedNode.line ?? null,
			className: selectedNode.className ?? classNameFromNodeId(selectedNode.id) ?? null,
		});
	}

	/** @param {HTMLElement} node */
	function focusOnMount(node) {
		node.focus();
	}

	/** @param {KeyboardEvent} e */
	function handleRenameKey(e) {
		if (e.key === 'Enter') submitRename();
		if (e.key === 'Escape') cancelRename();
	}

	/** @param {MessageEvent} event */
	function handleRenameResult(event) {
		const message = event.data;
		if (message?.command !== 'rename-function-result') return;
		if (message.success) {
			renameState = 'success';
			setTimeout(() => {
				selectedNode = null;
				renameState = 'idle';
			}, 1500);
		} else {
			renameState = 'error';
			renameError = message.error ?? 'Error desconocido';
		}
	}

	// Derived: breadcrumb items
	$: breadcrumb = navigationStack.map((id) => ({
		id,
		label: graphCache.getNode(id)?.label ?? id
	}));

	// ── Lifecycle ────────────────────────────────────────────────────────────────
	/** @type {import('./GraphCache').GraphCache | null} */
	let _mountedCache = null;

	onMount(() => {
		const rootId = graphCache.getRootId();
		console.log(graphCache);
		if (rootId) {
			navigationStack = [rootId];
			renderLevel(rootId);
		}
		window.addEventListener('message', handleRenameResult);
		_mountedCache = graphCache;
	});

	// Cuando llega nueva data (graphCache cambia de referencia después del mount)
	$: if (graphCache !== _mountedCache && _mountedCache !== null) {
		handleDataUpdate();
	}

	function handleDataUpdate() {
		_mountedCache = graphCache;

		// Trim navigation stack to the deepest folder that still exists.
		// If an entry is invalid all entries after it are also invalid (children
		// of a removed folder can't exist), so we cut at the first missing node.
		let cutAt = navigationStack.length;
		for (let i = 0; i < navigationStack.length; i++) {
			if (!graphCache.getNode(navigationStack[i])) { cutAt = i; break; }
		}
		const validStack = cutAt > 0 ? navigationStack.slice(0, cutAt) : [graphCache.getRootId()];
		if (validStack.length !== navigationStack.length) navigationStack = validStack;

		const currentId = validStack[validStack.length - 1];

		// If cy is null (e.g. a navigation renderLevel is in progress), skip
		// the incremental path and do a full render instead of silently dropping.
		if (!cy) {
			renderLevel(currentId);
			return;
		}

		// Compare visible node sets. If they differ (node added or removed) use
		// renderLevel so compound children are laid out correctly. Incremental
		// refreshLevel mispositions nodes re-added as compound children because
		// cy.extent() inside a batch doesn't account for newly added children.
		const { nodes } = graphCache.getLevelElements(currentId);
		const newIds = new Set(nodes.map((n) => /** @type {string} */ (n.data.id)));
		/** @type {Set<string>} */
		const oldIds = new Set(cy.nodes().not('.aux-node').map((n) => n.id()));

		const sameSet = newIds.size === oldIds.size && [...newIds].every((id) => oldIds.has(id));

		if (sameSet) {
			refreshLevel(currentId);
		} else {
			renderLevel(currentId);
		}
	}

	onDestroy(() => {
		cy?.destroy();
		window.removeEventListener('message', handleRenameResult);
	});

	// ── Navigation helpers ───────────────────────────────────────────────────────
	/** @param {string} folderId */
	function enterFolder(folderId) {
		navigationStack = [...navigationStack, folderId];
		renderLevel(folderId);
	}

	function goBack() {
		if (navigationStack.length <= 1) return;
		const next = navigationStack.slice(0, -1);
		navigationStack = next;
		renderLevel(next[next.length - 1]);
	}

	/** @param {number} index */
	function jumpToBreadcrumb(index) {
		if (index === navigationStack.length - 1) return; // already here
		const next = navigationStack.slice(0, index + 1);
		navigationStack = next;
		renderLevel(next[next.length - 1]);
	}

	// ── Overlap resolution ──────────────────────────────────────────────────────
	/** @param {import('cytoscape').Core} cyInstance */
	function resolveAllOverlaps(cyInstance) {
		const MARGIN = 100;
		const nodes = cyInstance.nodes(':orphan').toArray();

		let changed = true;
		let passes = 0;

		while (changed && passes < 50) {
			changed = false;
			passes++;

			for (let i = 0; i < nodes.length; i++) {
				for (let j = i + 1; j < nodes.length; j++) {
					const a = nodes[i];
					const b = nodes[j];
					const bb = a.boundingBox();
					const obb = b.boundingBox();

					const overlapX = Math.min(bb.x2, obb.x2) - Math.max(bb.x1, obb.x1) + MARGIN;
					const overlapY = Math.min(bb.y2, obb.y2) - Math.max(bb.y1, obb.y1) + MARGIN;

					if (overlapX > 0 && overlapY > 0) {
						const dx = (bb.x1 + bb.x2) / 2 - (obb.x1 + obb.x2) / 2 || 1;
						const dy = (bb.y1 + bb.y2) / 2 - (obb.y1 + obb.y2) / 2 || 1;

						if (overlapX <= overlapY) {
							const half = overlapX / 2;
							const dir = dx >= 0 ? 1 : -1;
							a.position('x', a.position('x') + dir * half);
							b.position('x', b.position('x') - dir * half);
						} else {
							const half = overlapY / 2;
							const dir = dy >= 0 ? 1 : -1;
							a.position('y', a.position('y') + dir * half);
							b.position('y', b.position('y') - dir * half);
						}
						changed = true;
					}
				}
			}
		}
	}

	// ── Edge bundling ────────────────────────────────────────────────────────────
	/**
	 * Groups edges by (target, type). For each group with ≥2 edges, the first
	 * becomes the trunk edge (source→target node) and the rest become branch edges
	 * whose target is the trunk edge's ID — the library resolves that to the
	 * trunk's aux node automatically.
	 *
	 * @param {{ data: Record<string, unknown> }[]} edges
	 * @returns {{ data: Record<string, unknown> }[]}
	 */
	function groupEdgesForBundling(edges) {
		/** @type {Map<string, { data: Record<string, unknown> }[]>} */
		const groups = new Map();
		for (const edge of edges) {
			const key = `${edge.data.type}::${edge.data.target}`;
			if (!groups.has(key)) groups.set(key, []);
			/** @type {{ data: Record<string, unknown> }[]} */ (groups.get(key)).push(edge);
		}

		/** @type {{ data: Record<string, unknown> }[]} */
		const result = [];
		for (const group of groups.values()) {
			// Trunk: first edge in the group — connects two node IDs as usual
			result.push(group[0]);
			// Branches: remaining edges point to the trunk edge's ID
			for (let i = 1; i < group.length; i++) {
				result.push({
					data: {
						id: `branch::${i}::${group[0].data.id}::${group[i].data.source}`,
						source: group[i].data.source,
						target: group[0].data.id, // edge ID → library resolves to aux node
						type: group[i].data.type
					}
				});
			}
		}
		return result;
	}

	// ── Incremental update (preserva posiciones) ─────────────────────────────────
	/** @param {string} folderId */
	function refreshLevel(folderId) {
		if (!cy || !ec) return;
		const _cy = /** @type {cytoscape.Core} */ (cy);
		selectedNode = null;

		const { nodes, edges } = graphCache.getLevelElements(folderId);
		const newNodeMap = /** @type {Map<string, { data: Record<string, unknown> }>} */ (
			new Map(nodes.map((n) => [/** @type {string} */ (n.data.id), n]))
		);

		// Guardar posiciones de nodos existentes
		/** @type {Map<string, { x: number, y: number }>} */
		const savedPos = new Map();
		_cy.nodes().not('.aux-node').forEach((n) => {
			savedPos.set(n.id(), { ...n.position() });
		});

		// Limpiar edges y aux-nodes del plugin
		_cy.edges().remove();
		_cy.nodes('.aux-node').remove();

		_cy.batch(() => {
			// Eliminar nodos que ya no existen
			_cy.nodes().forEach((n) => {
				if (!newNodeMap.has(n.id())) n.remove();
			});

			// Agregar o actualizar nodos
			for (const [id, nodeData] of newNodeMap) {
				const existing = _cy.getElementById(id);
				if (existing.length === 0) {
					_cy.add({ group: 'nodes', data: nodeData.data });
				} else {
					existing.data(nodeData.data);
				}
			}

			// Restaurar posiciones de nodos que sobrevivieron
			savedPos.forEach((pos, id) => {
				const node = _cy.getElementById(id);
				if (node.length) node.position(pos);
			});

			// Posicionar nodos nuevos en el centro del viewport
			const ext = _cy.extent();
			const cx = (ext.x1 + ext.x2) / 2;
			const cy_ = (ext.y1 + ext.y2) / 2;
			let i = 0;
			_cy.nodes().not('.aux-node').forEach((n) => {
				if (!savedPos.has(n.id())) {
					n.position({ x: cx + i * 60, y: cy_ + i * 60 });
					i++;
				}
			});
		});

		// Re-agregar edges vía edge-connections
		ec = /** @type {any} */ (_cy).edgeConnections();
		ec.addEdges(groupEdgesForBundling(edges));
	}

	// ── Core render ──────────────────────────────────────────────────────────────
	/** @param {string} folderId */
	function renderLevel(folderId) {
		selectedNode = null;

		// Destroy previous instance
		if (cy) {
			cy.destroy();
			cy = null;
			ec = null;
		}

		if (!container) return;

		const { nodes, edges } = graphCache.getLevelElements(folderId);

		cy = cytoscape(/** @type {any} */ ({
			container,
			elements: { nodes },
			style: buildStyle(),
			userZoomingEnabled: true,
			userPanningEnabled: true,
			boxSelectionEnabled: false,
			minZoom: 0.1,
			maxZoom: 4,
			zoom: 1,
			zoomingEnabled: true,
			pixelRatio: window.devicePixelRatio ?? 1,
			motionBlur: true,
			wheelSensitivity: 0.5
		}));

		ec = /** @type {any} */ (cy).edgeConnections();

		cy.layout(/** @type {any} */ ({
			name: 'cose-bilkent',
			nodeDimensionsIncludeLabels: true,
			edgeElasticity: 0.08,
			nodeRepulsion: 4500,
			idealEdgeLength: 120,
			nestingFactor: 0.1,
			gravity: 0.15, // más compactación
			numIter: 2500,
			tile: true,
			padding: 1000,
			randomize: false,
			animate: false
		})).run();

		resolveAllOverlaps(cy);
		cy.fit("60");

		ec.addEdges(groupEdgesForBundling(edges));

		// ── Event handlers ─────────────────────────────────────────────────────────
		// Folder: navigate into
		cy.on('tap', 'node[type="folder"]', (e) => {
			enterFolder(e.target.id());
		});

		// File: show info panel
		cy.on('tap', 'node[type="file"]', (e) => {
			selectedNode = graphCache.getNode(e.target.id());
		});

		// Class: show detail panel
		cy.on('tap', 'node[type="class"]', (e) => {
			selectedNode = graphCache.getNode(e.target.id());
		});

		// Function / method: show detail panel
		cy.on('tap', 'node[type="function"], node[type="method"]', (e) => {
			const node = graphCache.getNode(e.target.id());
			if (!node) return;
			// Attach parent file info dynamically
			const parentFile = graphCache.getParentOf(e.target.id());
			selectedNode = { ...node, _parentFile: parentFile };
		});

		// Background tap: deselect
		cy.on('tap', (e) => {
			if (e.target === cy) selectedNode = null;
		});

		// Hover effects for interactive nodes
		cy.on('mouseover', 'node[type="folder"]', (e) => {
			e.target.style({ 'border-color': '#ffd580', 'background-color': '#3e3921' });
		});
		cy.on('mouseout', 'node[type="folder"]', (e) => {
			e.target.style({ 'border-color': '#e5c07b', 'background-color': '#2a2618' });
		});

		cy.on('mouseover', 'node[type="function"], node[type="method"]', (e) => {
			e.target.style({ 'border-color': '#7ee8d4' });
		});
		cy.on('mouseout', 'node[type="function"], node[type="method"]', (e) => {
			e.target.style({ 'border-color': null });
		});

		// Prevent node overlap: after drag, push node away from any overlapping sibling
		cy.on('free', 'node', (e) => {
			const node = e.target;
			const MARGIN = 10;
			if (!cy) return;
			const others = cy.nodes().not(node).not(node.ancestors()).not(node.descendants());

			others.forEach((other) => {
				const bb = node.boundingBox();
				const obb = other.boundingBox();

				const overlapX = Math.min(bb.x2, obb.x2) - Math.max(bb.x1, obb.x1) + MARGIN;
				const overlapY = Math.min(bb.y2, obb.y2) - Math.max(bb.y1, obb.y1) + MARGIN;

				if (overlapX > 0 && overlapY > 0) {
					const nodeCx = (bb.x1 + bb.x2) / 2;
					const otherCx = (obb.x1 + obb.x2) / 2;
					const nodeCy = (bb.y1 + bb.y2) / 2;
					const otherCy = (obb.y1 + obb.y2) / 2;

					if (overlapX <= overlapY) {
						const dir = nodeCx >= otherCx ? 1 : -1;
						node.position('x', node.position('x') + dir * overlapX);
					} else {
						const dir = nodeCy >= otherCy ? 1 : -1;
						node.position('y', node.position('y') + dir * overlapY);
					}
				}
			});
		});
	}

	// ── Cytoscape stylesheet ─────────────────────────────────────────────────────
	/** @returns {any[]} */
	function buildStyle() {
		return [
			// ── Z-order: nodes siempre por encima de edges ──────────────────────────
			{
				selector: 'node',
				style: { 'z-index': 10 }
			},
			{
				selector: 'edge',
				style: { 'z-index': 1 }
			},

			// ── Aux nodes (cytoscape-edge-connections midpoints) ────────────────────
			{
				selector: 'node.aux-node',
				style: {
					width: 8,
					height: 8,
					shape: 'ellipse',
					'border-width': 0,
					label: '',
					'overlay-opacity': 0,
					events: 'no'
				}
			},

			// ── Folder nodes ────────────────────────────────────────────────────────
			{
				selector: 'node[type="folder"]',
				style: {
					shape: 'round-rectangle',
					width: 150,
					height: 50,
					'background-color': '#2a2618',
					'border-width': 2,
					'border-color': '#e5c07b',

					label: 'data(displayLabel)',
					'text-valign': 'center',
					'text-halign': 'center',
					'font-size': 13,
					'font-family': '"Consolas", "Menlo", monospace',
					color: '#e5c07b',
					'text-wrap': 'wrap'
				}
			},

			// ── File nodes (compound) ────────────────────────────────────────────────
			{
				selector: 'node[type="file"]',
				style: {
					shape: 'round-rectangle',
					width: 150,
					height: 50,
					'background-color': '#12243a',
					'background-opacity': 0.85,
					'border-width': 2,
					'border-color': '#569cd6',

					label: 'data(displayLabel)',
					'text-valign': 'top',
					'text-halign': 'center',
					'text-margin-y': -10,
					'font-size': 13,
					'font-family': '"Consolas", "Menlo", monospace',
					color: '#569cd6',
					'font-weight': 'bold',
					padding: '8px'
				}
			},
			{
				selector: 'node[type="class"]',
				style: {
					shape: 'round-rectangle',
					width: 150,
					height: 50,
					'background-color': '#25466e',
					'background-opacity': 0.6,
					'border-width': 2,
					'border-color': '#6fb0e0',

					label: 'data(label)',
					'text-valign': 'top',
					'text-halign': 'center',
					'text-margin-y': -10,
					'font-size': 13,
					'font-family': '"Consolas", "Menlo", monospace',
					color: '#569cd6',
					'font-weight': 'bold',
					padding: '8px'
				}
			},

			// ── Function nodes (inside file compound) ────────────────────────────────
			{
				selector: 'node[type="function"]',
				style: {
					shape: 'round-rectangle',
					width: 150,
					height: 50,
					padding: '6px',
					'background-color': '#0d2b25',
					'border-width': 1.5,
					'border-color': '#4ec9b0',

					label: 'data(label)',
					'text-valign': 'center',
					'font-size': 10,
					'font-family': '"Consolas", "Menlo", monospace',
					color: '#4ec9b0'
				}
			},

			// ── Method nodes ─────────────────────────────────────────────────────────
			{
				selector: 'node[type="method"]',
				style: {
					shape: 'round-rectangle',
					width: 150,
					height: 50,
					padding: '6px',
					'background-color': '#29271a',
					'border-width': 1.5,
					'border-color': '#dcdcaa',

					label: 'data(label)',
					'text-valign': 'center',
					'font-size': 10,
					'font-family': '"Consolas", "Menlo", monospace',
					color: '#dcdcaa'
				}
			},

			// ── External import source nodes ────────────────────────────────────────
			// Nodes that are imported by files outside their own directory
			{
				selector: 'node[?externalImport]',
				style: {
					'background-color': '#2d1500',
					'border-color': '#e06030',
					color: '#e07848'
				}
			},

			// ── Import edges (dashed) ────────────────────────────────────────────────
			{
				selector: 'edge[type="imports"]',
				style: {
					width: 1.5,
					'line-color': '#5a6472',
					'line-style': 'dashed',
					'line-dash-pattern': [6, 4],
					'target-arrow-color': '#5a6472',
					'target-arrow-shape': 'none',
					'arrow-scale': 0.9,
					'curve-style': 'round-taxi',
					'taxi-direction': 'auto',
					'taxi-turn': '50%',
					'font-size': 10,
					color: '#5a6472',
					'edge-text-rotation': 'none',
					'text-background-color': '#1e1e1e',
					'text-background-opacity': 0.8,
					'text-background-padding': '2px',
					'text-margin-y': -10
				}
			},

			// ── Call edges (solid) ───────────────────────────────────────────────────
			{
				selector: 'edge[type="calls"]',
				style: {
					width: 1.5,
					'line-color': '#4ec9b0',
					'target-arrow-color': '#4ec9b0',
					'target-arrow-shape': 'triangle',
					'arrow-scale': 0.9,
					'curve-style': 'round-taxi',
					'taxi-direction': 'auto',
					'taxi-turn': '50%',
					'font-size': 10,
					color: '#4ec9b0',
					'edge-text-rotation': 'none',
					'text-background-color': '#1e1e1e',
					'text-background-opacity': 0.8,
					'text-background-padding': '2px'
				}
			},
		];
	}

	/** @returns {any[]} */
	function buildExportStyle() {
		return [
			{
				selector: 'node',
				style: { 'z-index': 10, 'overlay-opacity': 0 }
			},
			{
				selector: 'edge',
				style: { 'z-index': 1 }
			},
			// Hide aux-nodes — only used for edge bundling in the interactive view
			{
				selector: 'node.aux-node',
				style: { display: 'none' }
			},
			{
				selector: 'node[type="folder"]',
				style: {
					shape: 'round-rectangle',
					'background-color': '#2a2618',
					'border-width': 1.5,
					'border-color': '#e5c07b',
					label: 'data(displayLabel)',
					'text-valign': 'center',
					'text-halign': 'center',
					'font-size': 16,
					'font-family': '"Consolas", "Menlo", monospace',
					'font-weight': 'bold',
					color: '#e5c07b',
					'text-wrap': 'none',
					width: 'label',
					height: 'label',
					padding: '8px',
				}
			},
			{
				selector: 'node[type="file"]',
				style: {
					shape: 'round-rectangle',
					'background-color': '#12243a',
					'border-width': 1.5,
					'border-color': '#569cd6',
					label: 'data(displayLabel)',
					'text-valign': 'center',
					'text-halign': 'center',
					'font-size': 14,
					'font-family': '"Consolas", "Menlo", monospace',
					'font-weight': 'bold',
					color: '#569cd6',
					'text-wrap': 'none',
					width: 'label',
					height: 'label',
					padding: '7px',
				}
			},
			{
				selector: 'node[type="class"]',
				style: {
					shape: 'round-rectangle',
					'background-color': '#25466e',
					'border-width': 1,
					'border-color': '#6fb0e0',
					label: 'data(label)',
					'text-valign': 'center',
					'text-halign': 'center',
					'font-size': 12,
					'font-family': '"Consolas", "Menlo", monospace',
					color: '#9fc8e8',
					'text-wrap': 'ellipsis',
					'text-max-width': '110px',
					width: 120,
					height: 24,
				}
			},
			{
				selector: 'node[type="function"]',
				style: {
					shape: 'round-rectangle',
					'background-color': '#0d2b25',
					'border-width': 1,
					'border-color': '#4ec9b0',
					label: 'data(label)',
					'text-valign': 'center',
					'text-halign': 'center',
					'font-size': 12,
					'font-family': '"Consolas", "Menlo", monospace',
					color: '#4ec9b0',
					'text-wrap': 'ellipsis',
					'text-max-width': '110px',
					width: 120,
					height: 24,
				}
			},
			{
				selector: 'node[type="method"]',
				style: {
					shape: 'round-rectangle',
					'background-color': '#29271a',
					'border-width': 1,
					'border-color': '#dcdcaa',
					label: 'data(label)',
					'text-valign': 'center',
					'text-halign': 'center',
					'font-size': 12,
					'font-family': '"Consolas", "Menlo", monospace',
					color: '#dcdcaa',
					'text-wrap': 'ellipsis',
					'text-max-width': '110px',
					width: 120,
					height: 24,
				}
			},
			{
				selector: 'node[?externalImport]',
				style: {
					'background-color': '#2d1500',
					'border-color': '#e06030',
					color: '#e07848'
				}
			},
			{
				selector: 'edge[type="imports"]',
				style: {
					width: 1,
					'line-color': '#4a5260',
					'line-style': 'dashed',
					'line-dash-pattern': [4, 3],
					'target-arrow-shape': 'none',
					'curve-style': 'bezier',
				}
			},
			{
				selector: 'edge[type="calls"]',
				style: {
					width: 1,
					'line-color': '#3a9982',
					'target-arrow-color': '#3a9982',
					'target-arrow-shape': 'triangle',
					'arrow-scale': 0.7,
					'curve-style': 'bezier',
				}
			},
			{
				selector: 'edge[type="declares"]',
				style: {
					width: 1,
					'line-color': '#3a4a5e',
					'target-arrow-shape': 'none',
					'curve-style': 'bezier',
					opacity: 0.5,
				}
			},
			{
				selector: 'edge[type="contains"]',
				style: { display: 'none' }
			},
		];
	}

	// ── Detail panel helper ──────────────────────────────────────────────────────
	const NODE_TYPE_COLORS = {
		folder: '#e5c07b',
		file: '#569cd6',
		function: '#4ec9b0',
		method: '#dcdcaa',
		class: '#c586c0'
	};

	async function exportPng() {
		if (exportState === 'generating') return;
		exportState = 'generating';

		const hiddenDiv = document.createElement('div');
		hiddenDiv.style.cssText =
			'position:absolute;left:-9999px;top:-9999px;width:1600px;height:480px;pointer-events:none;';
		document.body.appendChild(hiddenDiv);

		/** @type {cytoscape.Core | undefined} */
		let tempCy;
		try {
			const { nodes, edges } = graphCache.getAllElements();

				// ── Two-pass layout ──────────────────────────────────────────────────
			// Pass 1: breadthfirst on file nodes only (no compound nesting).
			// Pass 2: place each file's children in a compact grid below it.
			// This keeps the hierarchy readable without compound node expansion.

			const fileNodes  = nodes.filter((/** @type {any} */ n) => !n.data.parent);
			const childNodes = nodes.filter((/** @type {any} */ n) =>  !!n.data.parent);

			/** @type {Map<string, any[]>} */
			const childrenByParent = new Map();
			for (const child of childNodes) {
				const pid = child.data.parent;
				if (!childrenByParent.has(pid)) childrenByParent.set(pid, []);
				childrenByParent.get(pid).push(child);
			}

			tempCy = cytoscape(/** @type {any} */ ({
				container: hiddenDiv,
				elements: { nodes: fileNodes, edges: [] },
				style: buildExportStyle(),
				userZoomingEnabled: false,
				userPanningEnabled: false,
				boxSelectionEnabled: false
			}));

			// Grid layout wraps file nodes into rows instead of a single line.
			tempCy.layout({
				name: 'grid',
				padding: 30,
				spacingFactor: 1.0,
				cols: Math.ceil(Math.sqrt(fileNodes.length)),
				animate: false,
			}).run();

			// Pass 2: position children in a compact grid below their parent file.
			const COLS       = 3;
			const CHILD_W    = 120;
			const CHILD_H    = 24;
			const GAP_X      = 8;
			const GAP_Y      = 6;
			const PARENT_GAP = 12;

			for (const [parentId, children] of childrenByParent) {
				const parentEl = tempCy.getElementById(parentId);
				if (parentEl.empty()) continue;

				const pos    = parentEl.position();
				const ph     = parentEl.height();
				const cols   = Math.min(children.length, COLS);
				const blockW = cols * CHILD_W + (cols - 1) * GAP_X;
				const startX = pos.x - blockW / 2 + CHILD_W / 2;
				const startY = pos.y + ph / 2 + PARENT_GAP + CHILD_H / 2;

				tempCy.add(children.map((/** @type {any} */ child, i) => ({
					group: 'nodes',
					data: { ...child.data, parent: undefined },
					position: {
						x: startX + (i % COLS) * (CHILD_W + GAP_X),
						y: startY + Math.floor(i / COLS) * (CHILD_H + GAP_Y)
					}
				})));
			}

			// Add edges last so all endpoints exist.
			tempCy.add(edges);

			const dataUrl = tempCy.png({ output: 'base64uri', full: true, scale: 3, bg: '#1e1e1e' });
			const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');

			if (vscode) {
				const reply = await sendMessageAndWait(
					'export-png',
					{ data: base64 },
					'export-png-result',
					60000
				);
				if (reply.cancelled) {
					exportState = 'idle';
					return;
				}
				if (!reply.success) throw new Error(reply.error ?? 'Error al guardar');
			} else {
				const a = document.createElement('a');
				a.href = dataUrl;
				a.download = 'dependency-graph.png';
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
			}
			exportState = 'done';
		} catch (err) {
			console.error('[exportPng] failed:', err);
			exportErrorMsg = err instanceof Error ? err.message : String(err);
			exportState = 'error';
		} finally {
			tempCy?.destroy();
			document.body.removeChild(hiddenDiv);
			setTimeout(() => { exportState = 'idle'; exportErrorMsg = ''; }, 3000);
		}
	}

	/** @param {string | undefined} path */
	function shortPath(path) {
		if (!path) return '';
		const parts = path.split('/');
		if (parts.length <= 2) return path;
		return '.../' + parts.slice(-2).join('/');
	}
</script>

<!-- ══════════════════════════════════════════════════════════════════════════ -->
<div class="wrapper">
	<!-- ── Header / breadcrumb ── -->
	<header class="header">
		<button
			class="back-btn"
			on:click={goBack}
			disabled={navigationStack.length <= 1}
			title="Volver"
		>
			← Atrás
		</button>

		<nav class="breadcrumb" aria-label="Ubicación actual">
			{#each breadcrumb as crumb, i}
				{#if i > 0}<span class="sep" aria-hidden="true">/</span>{/if}
				<button
					class="crumb"
					class:active={i === breadcrumb.length - 1}
					on:click={() => jumpToBreadcrumb(i)}
					disabled={i === breadcrumb.length - 1}
				>
					{crumb.label}
				</button>
			{/each}
		</nav>
		<nav>
			<div class="legend">
				<p class="legend-title">Referencias</p>
				<div class="legend-item">
					<span class="legend-line dashed"></span>
					<span class="legend-label">imports</span>
				</div>
				<div class="legend-item">
					<span class="legend-line solid"></span>
					<span class="legend-label">calls</span>
				</div>
				<div class="legend-item">
					<span class="legend-dot external"></span>
					<span class="legend-label">externo al directorio</span>
				</div>
				<div class="legend-item">
					<span class="legend-dot bundle-point"></span>
					<span class="legend-label">punto de convergencia</span>
				</div>
			</div>
		</nav>

		<button
			type="button"
			class="export-btn"
			class:export-btn--done={exportState === 'done'}
			class:export-btn--error={exportState === 'error'}
			on:click={exportPng}
			disabled={exportState === 'generating'}
			title={exportState === 'error' ? exportErrorMsg : 'Export full project graph as PNG'}
		>
			{#if exportState === 'generating'}Generating…
			{:else if exportState === 'done'}✓ Saved
			{:else if exportState === 'error'}✗ Error
			{:else}Exportar PNG{/if}
		</button>
	</header>

	<!-- ── Graph area ── -->
	<div class="graph-area">
		<div bind:this={container} class="cy-container"></div>

		<!-- ── Detail panel ── -->
		{#if selectedNode}
			{@const typeColor = NODE_TYPE_COLORS[selectedNode.type] ?? '#ccc'}
			<aside class="detail-panel" aria-label="Información del nodo">
				<button class="close-btn" on:click={() => (selectedNode = null)} title="Cerrar">✕</button>

				<p class="detail-type" style="color: {typeColor}">
					{selectedNode.type.toUpperCase()}
				</p>
				<h2 class="detail-name" style="color: {typeColor}">{selectedNode.label}</h2>

				<ul class="detail-list">
					{#if selectedNode._parentFile}
						<li class="detail-item">
							<span class="detail-key">Archivo</span>
							<span class="detail-val mono">{selectedNode._parentFile.label}</span>
						</li>
					{/if}

					{#if selectedNode.path}
						<li class="detail-item">
							<span class="detail-key">Ruta</span>
							<span class="detail-val mono small">{selectedNode.path}</span>
						</li>
					{/if}

					{#if selectedNode.returnType != null}
						<li class="detail-item">
							<span class="detail-key">Retorna</span>
							<span class="detail-val mono" style="color: #ce9178">{selectedNode.returnType}</span>
						</li>
					{/if}
				</ul>

				{#if selectedNode.type === 'file'}
					{@const importGroups = graphCache.getImportedFunctionsForFile(selectedNode.id)}
					{#if importGroups.length > 0}
						<p class="imports-title">Funciones importadas</p>
						<div class="imports-list">
							{#each importGroups as { fileNode, fns }}
								<div class="import-group">
									<p class="import-file" title={fileNode.path}>{shortPath(fileNode.path)}</p>
									<ul class="import-fn-list">
										{#each fns as fn}
											<li class="import-fn">{fn.label}</li>
										{/each}
									</ul>
								</div>
							{/each}
						</div>
					{/if}
				{/if}

				{#if selectedNode.type === 'function' || selectedNode.type === 'method'}
					<div class="rename-section">
						{#if renameState === 'idle'}
							<button class="rename-btn" on:click={startRename}>Renombrar</button>
						{:else if renameState === 'editing'}
							<input
								class="rename-input"
								type="text"
								bind:value={renameValue}
								on:keydown={handleRenameKey}
								use:focusOnMount
							/>
							<div class="rename-actions">
								<button class="rename-confirm" on:click={submitRename}>✓ Confirmar</button>
								<button class="rename-cancel" on:click={cancelRename}>✕ Cancelar</button>
							</div>
						{:else if renameState === 'loading'}
							<p class="rename-status loading">Aplicando renombre…</p>
						{:else if renameState === 'success'}
							<p class="rename-status success">✓ Renombrado correctamente</p>
						{:else if renameState === 'error'}
							<p class="rename-status error">{renameError}</p>
							<button class="rename-btn" on:click={startRename}>Reintentar</button>
						{/if}
					</div>
				{/if}
			</aside>
		{/if}
	</div>
</div>

<!-- ══════════════════════════════════════════════════════════════════════════ -->
<style>
	.rename-section {
		margin-top: 12px;
		padding-top: 12px;
		border-top: 1px solid #2a2a2a;
	}

	.rename-btn {
		width: 100%;
		padding: 6px 10px;
		background: #1a3a30;
		color: #4ec9b0;
		border: 1px solid #4ec9b0;
		border-radius: 4px;
		font-family: 'Consolas', 'Menlo', monospace;
		font-size: 12px;
		cursor: pointer;
		transition: background 0.15s;
	}
	.rename-btn:hover {
		background: #1f4a3c;
	}

	.rename-input {
		width: 100%;
		box-sizing: border-box;
		padding: 5px 8px;
		background: #1e1e1e;
		color: #d4d4d4;
		border: 1px solid #4ec9b0;
		border-radius: 4px;
		font-family: 'Consolas', 'Menlo', monospace;
		font-size: 13px;
		outline: none;
		margin-bottom: 6px;
	}
	.rename-input:focus {
		border-color: #7ee8d4;
	}

	.rename-actions {
		display: flex;
		gap: 6px;
	}

	.rename-confirm {
		flex: 1;
		padding: 5px 8px;
		background: #1a3a30;
		color: #4ec9b0;
		border: 1px solid #4ec9b0;
		border-radius: 4px;
		font-size: 12px;
		cursor: pointer;
	}
	.rename-confirm:hover {
		background: #1f4a3c;
	}

	.rename-cancel {
		flex: 1;
		padding: 5px 8px;
		background: #2a1a1a;
		color: #888;
		border: 1px solid #444;
		border-radius: 4px;
		font-size: 12px;
		cursor: pointer;
	}
	.rename-cancel:hover {
		background: #3a2020;
		color: #aaa;
	}

	.rename-status {
		margin: 0;
		padding: 6px 8px;
		border-radius: 4px;
		font-size: 12px;
		font-family: 'Consolas', 'Menlo', monospace;
	}
	.rename-status.loading {
		color: #888;
		background: #1e1e1e;
	}
	.rename-status.success {
		color: #4ec9b0;
		background: #0d2b25;
	}
	.rename-status.error {
		color: #f48771;
		background: #2b0d0d;
		margin-bottom: 6px;
	}

	.export-btn--done {
		background: #0d2b25 !important;
		color: #4ec9b0 !important;
		border-color: #4ec9b0 !important;
	}
	.export-btn--error {
		background: #2b0d0d !important;
		color: #f48771 !important;
		border-color: #f48771 !important;
	}
</style>
