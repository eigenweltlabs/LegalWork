# Wiki graph rendering and scale research

Research and implementation date: 11 October 2026. This document records the original implementation, primary-source research, inspection of the running Obsidian 1.14.4 application, changes implemented on the wiki branch, and measured limits. It does not claim that LegalWork or Obsidian has passed a complete 100,000-page acceptance benchmark.

## Findings

The original graph was a static SVG diagram capped at 60 pages. The branch now uses Sigma WebGL with D3 worker physics for graphs up to 5,000 pages, Cosmos GPU simulation and drawing above that size, and automatic Canvas recovery. A useful replacement needs a real camera, a meaningful layout, direct page navigation, readable labels, and persistence. Reaching 100,000 pages also requires changing the server index and graph transport. Replacing SVG alone will not achieve that target.

Implemented decision: preserve the graph data and navigation interfaces across both engines. The CPU benchmark exposed a large-layout bottleneck, so Cosmos 3.5.1 was measured in visible Chromium and integrated for larger graphs. This improves camera interaction at 100,000 nodes; continuous large layout and cold indexing still miss the full acceptance criteria below.

## Original implementation

These observations describe the implementation inspected during research; later changes may supersede them.

| Area | Observed behavior | Consequence |
| --- | --- | --- |
| Graph selection | `wikiGraph` in `apps/app/src/react-app/domains/wiki/wiki-model.ts` defaults to 60 visible pages | The whole-wiki option does not render the whole wiki above that size |
| Layout | `WikiGraphPane` in `wiki-views.tsx` places nodes on fixed rings in an 800 by 600 SVG view box | The arrangement does not reflect connectivity, and does not support camera movement or node dragging |
| Labels | Every displayed node gets a text element, truncated after a fixed number of characters | Labels collide while useful names disappear |
| Graph construction | Each edge calls `resolveWikiPage`, which scans the page array | Raising the cap exposes approximately O(EV) work, where V is pages and E is links |
| Position construction | Every node calls `findIndex` on surrounding nodes | A second quadratic operation appears if the cap is raised |
| Page list | The graph repeats its nodes in a permanent adjacent list | The canvas loses space without gaining an effective large-graph search facility |
| Inventory | `WikiStore.inventory` in `apps/server/src/wiki/store.ts` enforces limits around 20,000 files/folders | The server cannot currently supply a 100,000-page graph |
| Refresh | Each snapshot scans and stats the directory tree | Frequent snapshots remain expensive even when most pages are unchanged |
| Resolution | Server `resolveWikiLinks` builds maps and resolves the full snapshot | The server resolver is approximately O(V+E), not quadratic, but repeats the full work |
| Transport | Snapshots include all page properties, links and excerpts | Graph display receives substantially more data than it needs |
| Polling | `wiki-pane.tsx` polls a snapshot every five seconds and the wiki list every fifteen seconds | Repeated scans and full snapshots continue while the user is working |

The graph should consume canonical resolved targets from the server. It should not redo resolution with a different client-side interpretation. Unresolved and ambiguous links need explicit handling rather than silently selecting a page.

## Local graph-construction measurement

Before editing, a read-only Bun invocation generated pages with three already-resolved links each and called the current `wikiGraph` with its limit explicitly raised. No repository code was changed for the measurement.

| Pages | Links | Construction time |
| ---: | ---: | ---: |
| 1,000 | 3,000 | 2,910 ms |
| 3,000 | 9,000 | 26,122 ms |

These are single runs on the development machine. They exclude filesystem indexing, network transfer, layout, SVG creation and browser rendering. They are not production throughput measurements. The shipped 60-page cap was deliberately bypassed in the call, so these timings do not describe the capped screen's normal render time. The roughly ninefold increase for three times as many pages is consistent with the repeated linear resolution scans.

Reproduction from `apps/app`:

```sh
pnpm exec bun -e '
import { wikiGraph } from "./src/react-app/domains/wiki/wiki-model.ts";
for (const n of [1000, 3000]) {
  const pages = Array.from({ length: n }, (_, i) => ({
    path: `Note ${i}.md`,
    title: `Note ${i}`,
    type: "page",
    properties: {},
    links: [1, 7, 31].map(d => ({
      target: `Note ${(i + d) % n}.md`,
      label: "",
      property: null,
      resolved: true,
    })),
    excerpt: "",
    revision: "x",
    updatedAt: 0,
  }));
  const start = performance.now();
  const graph = wikiGraph(pages, null, n);
  console.log(JSON.stringify({
    nodes: n,
    edges: graph.edges.length,
    ms: Math.round(performance.now() - start),
  }));
}
'
```

## What is established about Obsidian

### Documented interaction model

Obsidian documents global and local graph views, adjustable local depth, hover highlighting, direct note opening, context menus, keyboard and mouse pan/zoom, search filters, colored groups, connection-dependent node sizes, text fade, and configurable layout forces. These are concrete behavior references for LegalWork. The documentation does not publish a universal node-count performance guarantee. [Obsidian graph documentation](https://obsidian.md/help/plugins/graph)

### Rendering and layout evidence

An Obsidian core developer confirmed shipping Pixi in a 2020 discussion. A 2022 technical forum explanation states that Pixi renders the graph and the remaining machinery is custom. These establish the rendering lineage, not the exact internals of every current release. [Core developer confirmation](https://forum.obsidian.md/t/blank-graph-view/1073/6), [technical explanation](https://forum.obsidian.md/t/understanding-the-graph-view-core/41020)

A plugin author working against the native renderer describes a worker, quadtree-based position calculation and WebAssembly. Their public source accesses the native Pixi scene and renderer. This is direct plugin implementation evidence, but not a supported core API or an official current architecture specification. [Graph View Folders source and engineering notes](https://github.com/mtx9/obsidian-graphviewfolders)

No reproducible official evidence was found that establishes effortless layout and interaction for 100,000 pages across hardware. Page count alone is also insufficient: 100,000 pages with 100,000 links is a different workload from 100,000 pages with one million links.

## Renderer decision

| Candidate | Strength | Cost or open question | Recommendation |
| --- | --- | --- | --- |
| Sigma.js + Graphology | Graph-specific GPU rendering, camera interaction, picking, graph events and algorithms | CPU layout at 100,000 nodes still needs measurement and caching | Preferred first implementation |
| cosmos.gl | GPU simulation and rendering with typed-array input | Benchmark interaction, labels, updates and device compatibility in LegalWork | Alternative when continuous large-graph layout is the bottleneck |
| Pixi with custom graph engine | Fine control over appearance and matches Obsidian's rendering lineage | We must implement graph interaction, picking, labels and layout integration | Avoid taking on this work initially |
| SVG | Simple and accessible for small static diagrams | DOM and label costs are unsuitable for the target global graph | Replace the current global graph renderer |

Sigma provides WebGL rendering and built-in camera interactions. Version 4 was released on 8 October and adds WebGL2-only rendering, GPU SDF labels and built-in node dragging. Its documentation describes GPU picking and reusable GPU data. Pin and validate a specific version in Electron; do not mix version 3 examples with version 4 APIs. The release is very recent relative to this research. [Sigma overview](https://www.sigmajs.org/), [v4 release](https://github.com/jacomyal/sigma.js/releases), [rendering architecture](https://www.sigmajs.org/concepts/rendering/)

Graphology's ForceAtlas2 implementation includes a worker. Enable `barnesHutOptimize` explicitly: its documented default is false, with quadratic repulsion instead of the approximately O(V log V) approximation. Persisted positions are necessary for fast reopening; a worker prevents UI blocking but does not make the calculation free. [ForceAtlas2 documentation](https://graphology.github.io/standard-library/layout-forceatlas2.html)

cosmos.gl performs force simulation and drawing on the GPU and exposes typed-array data interfaces. Its maintainers describe support for hundreds of thousands of points and links on modern hardware. Treat that as a library capability claim to test, not as a LegalWork benchmark result. [Cosmos source and documentation](https://github.com/cosmosgl/graph)

## Proposed data and rendering architecture

### Incremental indexing

Keep Markdown as the source of truth. Extend the existing SQLite index with durable internal page identities, canonical resolved edges and reverse-edge indexes. Preserve identity through an explicit rename transaction without requiring users to author IDs in frontmatter.

Update changed files incrementally and reconcile periodically. A title or alias change must invalidate the affected resolution keys, including previously ambiguous or unresolved references. Deletion, rename, sync changes and access revocation must invalidate the corresponding nodes, edges and cached graph data.

Do not remove the inventory limit until indexing, transport and memory behavior have been verified at the larger size. Increasing the constant alone would expose expensive operations elsewhere.

### Compact graph API

Provide a graph projection containing:

- Nodes: internal ID, path, title, type, selected grouping fields and revision.
- Edges: source ID, target ID, relation type and optional aggregated occurrence count.
- Snapshot revision and a cursor for subsequent additions, updates and removals.

Exclude document bodies and excerpts. Page content loads only when opened. Apply the existing wiki authorization to graph reads and changes. Cache keys must include the correct account, server and wiki context.

Build adjacency indexes once. Local graphs use bounded breadth-first traversal by depth. Repeated references can share a visual edge while preserving count and relation information. Clearly distinguish excluded, unresolved and filtered nodes; do not silently truncate the global graph.

### Layout

Run layout outside the UI thread. Reuse saved positions, seed new nodes near their neighbors, and avoid rebuilding all positions after each edit. Persist a layout version so incompatible caches can be invalidated deliberately.

Use transferable typed buffers and bounded update batches rather than sending a complete object graph every frame. Stop layout when settled, hidden or closed. Batch position changes before notifying the renderer. For 100,000-node continuous simulation, compare worker layout against GPU simulation rather than assuming either is fast enough.

Large graphs can open from a cached or progressively refined layout while computation continues. Report cold layout time separately from warm graph opening.

### Rendering and memory

React should own controls and lifecycle. A single imperative graph instance should own rendering buffers and interactions. Camera movement must reuse geometry rather than rebuild graph objects. Batch incremental updates and destroy workers, event listeners and GPU resources when the graph closes. Sigma distinguishes expensive data processing from cheaper camera-driven rendering and documents explicit disposal. [Sigma lifecycle](https://www.sigmajs.org/concepts/lifecycle/)

Use zoom-dependent labels, a bounded visible label set, and reliable labels for hovered or selected nodes. Restrict unnecessary edge picking. Use simple line geometry and control edge overdraw. Sigma's own profiling notes identify antialiasing, translucent blending and extra picking passes as major costs on dense graphs. These options need visual comparison, not blanket disabling. [Sigma performance guidance](https://www.sigmajs.org/how-to/technical/performance/)

At 100,000 nodes and 500,000 edges, two 32-bit coordinates per node and two 32-bit endpoint IDs per edge require approximately 4.8 MB in total. This is only raw position/endpoint storage. Labels, graph objects, adjacency, renderer attributes, GPU resources and duplicated buffers add substantial memory. Measure the full Electron process delta rather than reporting this lower bound as total usage.

### Workspace interaction

Make the graph fill its workspace tab. Replace the permanent duplicate node list with a compact searchable finder and collapsible settings. Provide pan, zoom, fit, zoom-to-selection, local depth, type/folder filters and restrained group colors.

Hover highlights the neighborhood. A node click uses the same page-opening function as other wiki navigation. Modifier-click opens another tab. Dragging and panning must not trigger page opening. Preserve camera, filters, local depth, selection and layout per wiki/view when switching workspaces or reopening tabs.

Optional clustering should show explicit counts and allow expansion. It must not become a hidden page cap. Provide keyboard navigation and an accessible searchable results list alongside the canvas.

## Verification criteria for 100,000 pages

The following are proposed acceptance targets, not achieved results. Pin representative hardware, Electron version, screen resolution and device pixel ratio before recording them.

### Datasets

| Tier | Nodes | Edges | Purpose |
| --- | ---: | ---: | --- |
| Small | 1,000 | 3,000 | Layout quality and interaction correctness |
| Medium | 10,000 | 30,000 | Typical performance baseline |
| Large sparse | 100,000 | 300,000 | Full target page count |
| Large dense | 100,000 | 1,000,000 | Edge rendering and adjacency pressure |

Include hubs, clusters, disconnected components, orphans, repeated references, self-links, unresolved links, ambiguous aliases, long Unicode titles and page moves. Add incremental edits and deletions during rendering. Use deterministic fixtures and at least one representative exported graph with permitted data.

### Measurement boundaries

Record indexing, graph projection, transfer/deserialization, initial layout, first usable frame and warm reopening separately. Rendering a precomputed layout is not equivalent to calculating that layout live.

Use a visible Electron window with actual GPU acceleration, verify node and edge coverage, and record camera movement on screen. Avoid headless software-renderer results and background-window frame throttling. A public benchmark project provides useful coverage and presentation checks, but its graph layouts are precomputed and its results are not a LegalWork guarantee. [Reproducible graph benchmark methodology](https://github.com/GusEllerm/viz-bench)

### Proposed pass conditions

- All expected authorized nodes and edges are present. Any user-selected filter is visible and reflected in counts.
- On the agreed baseline laptop, warm 100,000-node opening reaches a usable graph within five seconds. Cold indexing and layout have separate reported timings and leave the app responsive.
- During a defined pan/zoom trace, p95 frame time is at most 33 ms, with 16.7 ms as the target on the primary development machine. Report the result for both sparse and dense tiers.
- Graph click feedback and keyboard interactions remain below 100 ms p95. Editor typing remains responsive while layout runs in another pane.
- A single-page update applies incrementally without resetting camera or layout and without loading a full graph snapshot again.
- Repeated open/close and workspace switching do not show monotonically growing retained memory or worker/GPU-resource leaks after cleanup.
- Peak graph memory is measured and reported separately from existing wiki data. Set the release budget from baseline measurements; do not infer it from raw typed-array sizes.
- Layout stops consuming continuous compute after settling or becoming hidden. Resume and restore preserve the user's position.
- Direct page opening, modifier-click, dragging, browser/app navigation and reopening restore state correctly.
- GPU-context loss or unavailable acceleration produces an explicit usable state, never an unexplained blank pane or a silent claim that all nodes were rendered.

## Implementable sequence

1. Replace linear per-edge resolution and quadratic position preparation with canonical IDs and maps.
2. Integrate a full-tab GPU graph with camera controls, meaningful layout, direct tab navigation and saved positions. Verify the medium fixture and interaction behavior.
3. Add the incremental index, compact graph projection and revision-based updates. Remove full-snapshot polling from graph maintenance.
4. Run the large sparse and dense fixtures, comparing worker layout and GPU simulation where necessary. Adjust the inventory limit only after the complete path passes.
5. Add label detail, optional clustering and visual refinements against measured frame and memory budgets.

## Changes implemented

The application now uses Sigma 4.0.0 and Graphology 0.26.0 for an imperative WebGL graph, with a licensed d3-force 3.0.0 worker. A real Canvas renderer automatically takes over if GPU construction or context recovery fails. There is no technical graphics warning or duplicate wall of page buttons in the user flow. Both renderers support node navigation, pan/zoom, fit, dragging, cooling and persisted positions. Controls include an accessible page finder and collapsible type, folder, local-depth and orphan filters. The default graph has no node cap.

The first Sigma integration incorrectly replaced its default style bindings. That caused an initialization error for enabled dragging, misreported as unsupported WebGL. Explicit typed position, size and label bindings fixed the actual cause. A second native-only integration error was found through Electron DevTools: a size-only Graphology update selected Sigma's fast repaint before newly added nodes had GPU indices, throwing and aborting layout startup. Removing that hint allows full indexing; asynchronous update failures now trigger recovery. Native verification then showed visible circles, differentiated hubs and a moving, centered layout. Small graphs show larger nodes and labels, with a minimum radius at wide zoom. Fixed world bounds prevent layout ticks from continuously changing the camera scale. The Sigma path adds time-based easing for up to 5,000 nodes. Above that size the normal renderer is Cosmos, which keeps physics coordinates on the GPU. The worker implementation still coalesces large updates if used as a fallback. This interpolation is a LegalWork choice, not a claim about Obsidian's position renderer.

The compact API is `GET /wikis/:wikiId/graph?revision=...`: full snapshot, delta or unchanged response. Nodes carry canonical path IDs, path, title and type; edges carry endpoints and optional relation. There are no document bodies, properties or excerpts in that feed. A bounded change log retains deltas rather than repeated full snapshots. Existing wiki authorization applies. Path identities change on rename; durable internal identities and persisted edge tables remain unimplemented.

A separate `GET /wikis/:wikiId/graph/revision` revision includes Markdown bodies, assets, folder changes, configuration and view definitions. Recursive filesystem watching refreshes changed Markdown entries, with periodic reconciliation (60 seconds when a watcher works, five seconds otherwise). Explicit snapshot requests still scan immediately, preserving external-change correctness. The wiki navigation and session observers now use the lightweight revision poll instead of repeatedly requesting rich snapshots and wiki lists. A changed graph still rebuilds its complete derived resolution projection in O(V+E); it is not a fully incremental edge index. The inventory ceiling was raised from 20,000 to 250,000 entries. This is an eligibility change, not evidence that cold filesystem indexing at that size is fast.

Graph camera/filter preferences are saved locally by server/wiki; positions use a versioned IndexedDB key. Physics workers, observers and GPU resources are disposed on unmount. Revision mismatch recovers a fresh graph snapshot.

## Running Obsidian 1.14.4, inspected directly

The user explicitly requested inspection of the running application. CUA identified the current window as `Graph view - sim - Obsidian 1.14.4`. Its controls showed center force 0.5187132, repel force 10, link force 1, and link distance 250. The visible graph used neutral gray nodes with pronounced hubs, thin translucent edges, and a bright connected neighborhood against subdued unrelated nodes. No vault content or settings were edited.

Read-only inspection of the matching installed update at `~/Library/Application Support/obsidian/obsidian-1.14.4.asar` established the following facts. The older `/Applications/Obsidian.app` bundle reports 1.9.14 and is not the running update. No Obsidian implementation source was copied into LegalWork.

| Mechanism | Confirmed in the running update's bundled assets |
| --- | --- |
| Drawing | `lib/pixi.min.js` identifies `pixi.js-legacy 7.2.4`, MIT. `app.js` constructs a Pixi application with antialiasing, transparent background and manual rendering. |
| Physics | A dedicated `Graph Worker` loads `sim.js`. It prefers WebAssembly physics, with a JavaScript implementation using D3-style link, many-body, quadtree and collision mechanics when WASM is unavailable. The D3 lineage is a structural inference from its APIs and algorithms; no package version was declared in this worker. |
| Tick rate | The worker schedules the next tick at a target interval of 1,000/60 ms. Heavy workloads can exceed this interval; this is not a 60fps guarantee. |
| Cooling | The alpha decay corresponds to a 300-tick reduction toward a 0.001 stopping threshold. Velocity retention is 0.6. |
| Forces | The observed defaults include roughly -1,000 repulsion, a 30-unit minimum charge distance, 250-unit link distance, and a 60-unit collision radius with strength 0.5. The UI's repel slider is cubed before it reaches physics. |
| Transport | Positions are packed into Float32 arrays. SharedArrayBuffer is used when available; otherwise a transferred ArrayBuffer is posted. |
| Dragging | A dragged node is pinned in the worker and alpha is reheated to 0.3. Release removes the pin and lets the graph cool. Other nodes continue responding. |
| Render loop | The renderer uses requestAnimationFrame, applies the latest worker positions directly, and stops scheduling after 60 idle frames. Position interpolation was not found in the inspected node renderer. |
| Smooth motion | Zoom approaches a target gradually, preserving the cursor-centered world position. Panning has damped momentum. Node/edge alpha and colors ease toward their targets on render frames. |
| Detail | Node radius grows approximately with the square root of connectivity, within bounds. Node scale compensates partially for zoom. Text alpha follows zoom and selected nodes remain legible. Viewport tests skip invisible circles, labels and links; node graphics creation is spread across frames. |

Pixi alone does not explain the effect. The separate WASM worker, tick cadence, pin-and-reheat dragging, neutral visual hierarchy, zoom/text scaling and render-loop damping work together. LegalWork now uses licensed D3 primitives to recover those interaction characteristics at smaller scales; it does not reuse Obsidian's proprietary worker or WASM.

## Measurements after implementation

Reproduce the CPU/data test:

```sh
pnpm --filter @legalwork/app exec bun scripts/benchmark-wiki-graph.ts --dense
```

Single local run on macOS arm64, Bun 1.3.9, 11 October 2026. Deterministic fixtures contain clusters, hubs and cross-links. The following exclude disk indexing, server HTTP transport, browser parsing, React, labels, GPU rendering and input latency.

| Nodes | Edges | Server projection | Adjacency index | Local depth 2 | D3 tick range (3 ticks) | Compact JSON |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 2,980 | 21.1 ms | 0.8 ms | 0.8 ms | 4.7-13.4 ms | 0.40 MiB |
| 10,000 | 29,800 | 203.4 ms | 6.6 ms | 1.0 ms | 47.8-60.9 ms | 4.10 MiB |
| 100,000 | 298,000 | 2,384.1 ms | 150.4 ms | 8.6 ms | 753.8-814.4 ms | 42.45 MiB |
| 100,000 | 997,990 | 5,495.5 ms | 506.1 ms | 29.7 ms | 826.1-960.8 ms | 123.60 MiB |

The client construction for 1,000 nodes now takes 27.9 ms, compared with 2,910 ms in the earlier fixture. These fixtures are not identical, so the numbers demonstrate the removed quadratic bottleneck rather than a controlled speedup ratio. Unchanged compact responses took at most 0.1 ms in the synthetic index. A single changed title produced a 261-byte delta, but recomputing the projection still took 2.28 seconds at 100,000/298,000 and 5.59 seconds at 100,000/997,990. This remains a significant indexing limitation.

Incremental heap growth reported by the test was 326 MiB for the sparse 100,000-node case and 590 MiB for the dense case. Peak process RSS reached 4.44 GiB across the sequence because the harness simultaneously retains rich pages, multiple projections, adjacency, JSON serialization, physics objects and allocator arenas. This is not isolated Electron renderer memory. The position buffer itself was 0.76 MiB; reporting that alone would hide most memory costs.

The CPU worker does not meet 60Hz continuous-layout performance at 100,000 nodes. Moving it off the UI thread preserves the UI event loop but does not change that result. The GPU alternative was tested and integrated; its results are recorded below. The complete 100,000-page acceptance conditions above remain unpassed.

Focused verification completed: 17 client graph/model/navigation/physics tests (73 assertions), and 27 server graph/store/HTTP tests (212 assertions). App and server typechecks passed during implementation; final build and native visual verification are coordinated with the parent task.


## GPU implementation and visible-browser measurements

`wiki-graph-gpu.ts` integrates `@cosmos.gl/graph` 3.5.1 for full graphs above 5,000 pages. Nodes and every resolved edge remain in typed GPU input arrays. Physics coordinates stay on the GPU rather than travelling through JavaScript and Graphology every tick. The existing page-opening callback, search focus, fit, camera preferences, versioned layout cache and automatic Canvas recovery remain available. Labels are limited to up to 60 high-connectivity nodes plus the focused/hovered node, with zoom and collision checks; this is a label budget, not a node cap.

The graph renders at one device pixel per CSS pixel on large canvases to bound fill cost. Labels remain independently sharp up to DPR 2. Neutral opaque edge colors avoid the cost of repeatedly blending a million translucent lines. Camera interaction pauses simulation until 650ms after the camera rests. For graphs above 500,000 edges, connections are temporarily hidden during camera movement, then restored in full at rest. No edges are removed from connectivity, the API or the layout forces. This tradeoff improves navigation but differs visually from continuously drawing every line while moving.

A real integration fault was caught by the adapter harness: after pausing for a data update, `render()` does not restart Cosmos simulation. The adapter now explicitly calls `start()` after initial upload. The implementation uses automatic recovery for initialization or context failures, not user-facing graphics instructions.

### Bare-engine comparison

A temporary visible Chrome harness first tested the library at 100,000 points. At DPR 2, the sparse 298,000-edge fixture reached 20.5fps during live layout and 52.5fps during settled camera movement; the 997,990-edge fixture reached 10.5fps and 9.6fps respectively. Rendering at DPR 1 and avoiding synchronous GPU position readback on each camera movement improved settled motion to 54.8fps sparse and 11fps dense. Both fixtures returned exactly 100,000 finite GPU positions. These tests excluded LegalWork labels, callbacks and the wiki data path.

### Actual LegalWork adapter

The committed browser harness imports the production `GpuGraphRenderer` directly, generates deterministic clusters, hubs and cross-links, and measures visible requestAnimationFrame intervals. It uses the real label tracking, camera transforms, cache and callbacks. Run:

```sh
pnpm --filter @legalwork/app exec vite --config scripts/wiki-graph-browser-benchmark/vite.config.mjs
```

Open `http://127.0.0.1:5189/` in a visible browser and click each fixture. Keep it foreground for the entire trace. Results are shown on the page and appended to `/tmp/wiki-graph-adapter-results.jsonl`. The harness is outside the production app entry point and does not modify any wiki.

Final local run: Chrome 156 on macOS, 2,560 by 1,266 CSS pixels, device DPR 2, graph rendering DPR 1. Each phase lasted about four seconds. The first-running callback measures initialization/data submission, not first presented frame or time to a settled layout.

| Fixture | First running callback | Live layout | Camera with active layout and automatic pause | Settled camera |
| --- | ---: | --- | --- | --- |
| 100,000 nodes / 298,000 edges | 481ms | 20.7fps, p95 150.3ms | 45.1fps, p95 50.0ms | 59.3fps, p95 17.6ms |
| 100,000 nodes / 997,990 edges | 598ms | 15.0fps, p95 282.2ms | 36.7fps, p95 82.7ms | 60.0fps, p95 17.5ms |

Before temporarily hiding dense edges during camera motion, the actual million-edge adapter reached 40.7fps with p95 66.7ms on the settled trace. The final result explicitly includes the edge visibility tradeoff above. Sparse motion keeps all edges drawn.

These are renderer-adapter results, not complete 100,000-page Electron results. They exclude filesystem indexing, HTTP transfer, JSON parsing, React state and other application activity. RAF intervals include browser pacing and are not direct GPU timer queries or human click-latency measurements. Whole-process renderer/GPU memory, real-file cold indexing, prolonged leak tests, and warm full-application reopening remain unmeasured at 100,000 pages. Active-layout frame time misses the proposed 33ms p95 target even though settled camera motion meets it in this run. The full acceptance criteria are therefore not passed.

Final focused commands:

```sh
pnpm --filter @legalwork/app exec bun test tests/wiki-graph-data.test.ts tests/wiki-graph-physics.test.ts tests/wiki-model.test.ts tests/wiki-navigation-regression.test.ts
pnpm --filter legalwork-server exec bun test src/wiki/graph.test.ts src/wiki/store.test.ts src/wikis.e2e.test.ts
pnpm --filter @legalwork/app typecheck
```
