import { GpuGraphRenderer } from "../../src/react-app/domains/wiki/wiki-graph-gpu";
import type { WikiGraphData } from "@legalwork/types/wiki";

const container = document.querySelector<HTMLDivElement>("#graph");
const status = document.querySelector<HTMLParagraphElement>("#status");
const result = document.querySelector<HTMLPreElement>("#result");
const sparse = document.querySelector<HTMLButtonElement>("#sparse");
const dense = document.querySelector<HTMLButtonElement>("#dense");
if (!container || !status || !result || !sparse || !dense) throw new Error("Benchmark controls are missing");
const elements = { container, status, result, sparse, dense };
let renderer: GpuGraphRenderer | undefined;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))];

async function run(degree: number) {
  elements.sparse.disabled = elements.dense.disabled = true;
  elements.status.textContent = "Constructing 100,000 nodes...";
  elements.result.textContent = "";
  renderer?.dispose();
  const count = 100_000;
  const data: WikiGraphData = { revision: "benchmark", nodes: [], edges: [] };
  for (let i = 0; i < count; i++) {
    data.nodes.push({ id: `page-${i}`, path: `Cluster ${Math.floor(i / 100)}/Page ${i}.md`, title: `Page ${i}`, type: "page" });
    const seen = new Set<number>();
    for (let j = 0; j < degree; j++) {
      const target = j === 0 ? Math.floor(i / 100) * 100 : j === 1 ? (Math.floor(i / 100) * 100 + (i + 1) % 100) % count : (i * 31 + j * 7919) % count;
      if (target === i || seen.has(target)) continue;
      data.edges.push({ id: `${i}:${target}`, source: `page-${i}`, target: `page-${target}`, relation: null });
      seen.add(target);
    }
  }
  let firstRunning = 0, running = false, error: string | null = null;
  const start = performance.now();
  const graph = renderer = new GpuGraphRenderer(elements.container, `benchmark-${degree}-${Date.now()}`, {
    onCamera: () => {}, onOpen: (path) => { elements.status.textContent = `Opened ${path}`; },
    onError: (message) => { error = message; },
    onRunning: (value) => { running = value; if (value) firstRunning ||= performance.now(); },
  });
  graph.setData(data);
  while (!firstRunning && !error && performance.now() - start < 30_000) await delay(50);
  if (error || !firstRunning) throw new Error(error ?? "Renderer initialization timed out");
  await delay(1000);
  async function measure(name: string, moving: boolean) {
    const frames: number[] = [], started = performance.now();
    let last = started, lastAction = started, hidden = false, runningFrames = 0, actions = 0;
    await new Promise<void>((resolve) => {
      function frame(now: number) {
        frames.push(now - last); last = now;
        hidden ||= document.visibilityState !== "visible";
        if (running) runningFrames++;
        if (moving && now - lastAction > 1000) { graph.pan(actions % 2 ? -0.04 : 0.04, 0.02); graph.zoom(actions % 2 ? 1 : -1); lastAction = now; actions++; }
        if (now - started < 4000) requestAnimationFrame(frame); else resolve();
      }
      requestAnimationFrame(frame);
    });
    return { name, visible: !hidden, frames: frames.length, fps: +(frames.length * 1000 / (performance.now() - started)).toFixed(1), p50Ms: +percentile(frames, 0.5).toFixed(1), p95Ms: +percentile(frames, 0.95).toFixed(1), maxMs: +Math.max(...frames).toFixed(1), runningFrames, actions };
  }
  elements.status.textContent = "Measuring actual adapter with GPU physics and label LOD...";
  graph.arrange(); const layout = await measure("layout", false);
  elements.status.textContent = "Measuring camera movement with automatic simulation pause...";
  graph.arrange(); const camera = await measure("camera-auto-pause", true);
  graph.pause(); elements.status.textContent = "Measuring settled camera...";
  const settled = await measure("settled-camera", true);
  const report = { engine: "LegalWork GpuGraphRenderer + @cosmos.gl/graph 3.5.1", ua: navigator.userAgent, nodes: count, edges: data.edges.length, width: innerWidth, height: innerHeight, devicePixelRatio, renderPixelRatio: 1, firstRunningMs: +(firstRunning - start).toFixed(1), measurements: [layout, camera, settled], caveat: "Synthetic direct adapter benchmark. Includes bounded labels, hover handlers, camera transforms and layout caching. Excludes server, HTTP, JSON parsing, React and whole application. RAF pacing is not direct GPU timing or human input latency." };
  elements.result.textContent = JSON.stringify(report, null, 2);
  elements.status.textContent = "Complete. Pan, zoom and click to inspect.";
  console.info("Wiki graph adapter benchmark", report);
  await fetch("/__results", { method: "POST", body: JSON.stringify(report) });
  elements.sparse.disabled = elements.dense.disabled = false;
}
for (const [button, degree] of [[elements.sparse, 3], [elements.dense, 10]] satisfies [HTMLButtonElement, number][]) button.onclick = () => { void run(degree).catch((error: unknown) => { elements.status.textContent = String(error); elements.sparse.disabled = elements.dense.disabled = false; }); };
