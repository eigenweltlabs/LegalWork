/** Run: pnpm --filter @legalwork/app exec bun scripts/benchmark-wiki-graph.ts [--dense]
 * Synthetic CPU/data benchmark. It does not measure GPU frames, disk indexing, IPC or interaction latency.
 */
import type { WikiPage } from "@legalwork/types/wiki";
import { WikiGraphIndex } from "../../server/src/wiki/graph";
import { wikiGraph } from "../src/react-app/domains/wiki/wiki-model";
import { defaultGraphFilter, filterWikiGraph, indexWikiGraph, wikiGraphSeed } from "../src/react-app/domains/wiki/wiki-graph-data";
import { createWikiGraphSimulation } from "../src/react-app/domains/wiki/wiki-graph-physics";

function timed<T>(fn: () => T) { const start = performance.now(), result = fn(); return { ms: Math.round((performance.now() - start) * 10) / 10, result }; }
function pages(count: number, degree: number): WikiPage[] {
  return Array.from({ length: count }, (_, index) => {
    const cluster = Math.floor(index / 100) * 100;
    const targets = new Set(Array.from({ length: degree }, (_, link) => link === 0 ? cluster : link === 1 ? (cluster + (index + 1) % 100) % count : (index * 31 + link * 7919) % count));
    targets.delete(index);
    return { path: `Notes/${index}.md`, title: `Page ${index}`, type: index % 9 ? "page" : "client", properties: { id: `p-${index}`, stage: index % 3 ? "active" : "closed" },
      links: [...targets].map((target) => ({ target: `Notes/${target}.md`, label: `Page ${target}`, property: null, resolved: false })), excerpt: "Synthetic linked knowledge page", revision: "a", updatedAt: 1 };
  });
}
console.log(JSON.stringify({ runtime: `Bun ${Bun.version}`, platform: `${process.platform}/${process.arch}`, date: new Date().toISOString(), caveat: "CPU-only synthetic fixtures; no GPU, DOM, disk scan, network or Electron frame timings" }));
const cases = [[1000, 3], [10_000, 3], [100_000, 3], ...(process.argv.includes("--dense") ? [[100_000, 10]] : [])];
for (const [count, degree] of cases) {
  Bun.gc(true); const baseline = process.memoryUsage();
  const fixture = pages(count, degree);
  const projected = timed(() => wikiGraph(fixture, null));
  const server = new WikiGraphIndex();
  const initial = timed(() => server.update(fixture)), snapshot = server.response();
  if (snapshot.kind !== "snapshot") throw new Error("Expected full graph");
  const indexed = timed(() => indexWikiGraph(snapshot));
  const local = timed(() => filterWikiGraph(indexed.result, { ...defaultGraphFilter, local: true, depth: 2 }, "Notes/0.md"));
  const whole = timed(() => filterWikiGraph(indexed.result, defaultGraphFilter, null));
  const unchanged = timed(() => server.response(snapshot.revision));
  fixture[0] = { ...fixture[0], title: "Changed title" };
  const changed = timed(() => server.update(fixture));
  const delta = server.response(snapshot.revision);
  const compactBytes = Buffer.byteLength(JSON.stringify(snapshot));
  const nodes = snapshot.nodes, indices = new Map(nodes.map((node, index) => [node.id, index]));
  const positions = new Float32Array(nodes.length * 2);
  nodes.forEach((_node, index) => { const point = wikiGraphSeed(index, nodes.length); positions[index * 2] = point.x; positions[index * 2 + 1] = point.y; });
  const edges = new Uint32Array(snapshot.edges.length * 2);
  snapshot.edges.forEach((edge, index) => { edges[index * 2] = indices.get(edge.source) ?? 0; edges[index * 2 + 1] = indices.get(edge.target) ?? 0; });
  const physics = timed(() => createWikiGraphSimulation(positions, edges));
  const ticks: number[] = [];
  for (let tick = 0; tick < 3; tick++) ticks.push(timed(() => physics.result.simulation.tick()).ms);
  physics.result.simulation.stop();
  const memory = process.memoryUsage();
  console.log(JSON.stringify({ nodes: count, edges: snapshot.edges.length, clientProjectionMs: projected.ms, serverProjectionMs: initial.ms, adjacencyMs: indexed.ms, wholeFilterMs: whole.ms, localDepth2Ms: local.ms, localNodes: local.result.nodes.length,
    unchangedResponseMs: unchanged.ms, singleTitleUpdateMs: changed.ms, singleTitleDeltaBytes: Buffer.byteLength(JSON.stringify(delta)), compactMiB: +(compactBytes / 1048576).toFixed(2), physicsSetupMs: physics.ms, physicsTickMs: ticks,
    heapGrowthMiB: +((memory.heapUsed - baseline.heapUsed) / 1048576).toFixed(1), rssMiB: +(memory.rss / 1048576).toFixed(1), positionBufferMiB: +(positions.byteLength / 1048576).toFixed(2), filteredNodes: whole.result.nodes.length }));
}
