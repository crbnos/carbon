// Reader for large .heapsnapshot files (too big for JSON.parse or DevTools).
// Prints the shortest strong retainer path from the GC roots to objects whose
// constructor is named <marker>, then the top constructors by self size.
//   node --max-old-space-size=4096 heap-retainers.mjs <file> [marker] [top]
// DOM=1 builds the dominator tree and prints the objects with the largest
// retained size, each with its retainer path (what DevTools' Summary shows).
// CUT=name1,name2 also prints, per property/context name, the bytes that only
// stay alive through edges of that name (its retained size).

import { readFileSync } from "node:fs";

const [file, marker = "LeakMarker", top = "40"] = process.argv.slice(2);
const buf = readFileSync(file);

const find = (needle, from = 0) => {
  const at = buf.indexOf(needle, from, "latin1");
  if (at < 0) throw new Error(`${needle} not found`);
  return at;
};
const nodesAt = find('"nodes":[');
const meta = JSON.parse(`${buf.toString("utf8", 0, nodesAt).replace(/,\s*$/, "")}}`).snapshot;
const NF = meta.meta.node_fields.length;
const EF = meta.meta.edge_fields.length;

// Reads the comma-separated integers after `from` up to the closing bracket.
function ints(from, length) {
  const out = new Uint32Array(length);
  let n = 0;
  let current = -1;
  let i = from;
  for (; n < length || current >= 0; i++) {
    const c = buf[i];
    if (c >= 48 && c <= 57) current = (current < 0 ? 0 : current * 10) + (c - 48);
    else if (current >= 0) {
      out[n++] = current;
      current = -1;
      if (c === 93) break;
    } else if (c === 93) break;
  }
  return { out, end: i };
}
const { out: nodes, end: nodesEnd } = ints(nodesAt + 9, meta.node_count * NF);
const edgesAt = find('"edges":[', nodesEnd);
const { out: edges, end: edgesEnd } = ints(edgesAt + 9, meta.edge_count * EF);

const strings = [];
{
  let i = find('"strings":[', edgesEnd) + 11;
  for (;;) {
    while (buf[i] !== 34 && buf[i] !== 93) i++;
    if (buf[i] === 93) break;
    const start = i + 1;
    let escaped = false;
    for (i = start; ; i++) {
      const c = buf[i];
      if (escaped) escaped = false;
      else if (c === 92) escaped = true;
      else if (c === 34) break;
    }
    const raw = buf.toString("utf8", start, i);
    strings.push(raw.includes("\\") ? JSON.parse(`"${raw}"`) : raw);
    i++;
  }
}

// --- graph ----------------------------------------------------------------------
const f = meta.meta.node_fields;
const ef = meta.meta.edge_fields;
const [nType, nName, nSize, nEdges] = ["type", "name", "self_size", "edge_count"].map((k) => f.indexOf(k));
const [eType, eName, eTo] = ["type", "name_or_index", "to_node"].map((k) => ef.indexOf(k));
const nodeTypes = meta.meta.node_types[nType];
const edgeTypes = meta.meta.edge_types[eType];
const WEAK = edgeTypes.indexOf("weak");
const N = meta.node_count;
const firstEdge = new Uint32Array(N + 1);
for (let n = 0, e = 0; n < N; n++) {
  firstEdge[n] = e;
  e += nodes[n * NF + nEdges] * EF;
  firstEdge[n + 1] = e;
}
const label = (n) => `${nodeTypes[nodes[n * NF + nType]]}:${strings[nodes[n * NF + nName]]}`.replace(/\s+/g, " ").slice(0, 140);
const edgeLabel = (e) => {
  const t = edgeTypes[edges[e + eType]];
  const v = edges[e + eName];
  return t === "element" || t === "hidden" ? `${t}[${v}]` : `${t}:${strings[v]}`;
};

const devtools = new Set(strings.flatMap((v, i) => (v.includes("DevTools console") ? [i] : [])));

// BFS from the root over strong edges: the shortest path that keeps a node alive.
const parentEdge = new Uint32Array(N);
const parentNode = new Uint32Array(N);
const seen = new Uint8Array(N);
{
  const queue = new Uint32Array(N);
  let qh = 0;
  let qt = 0;
  queue[qt++] = 0;
  seen[0] = 1;
  while (qh < qt) {
    const n = queue[qh++];
    for (let e = firstEdge[n]; e < firstEdge[n + 1]; e += EF) {
      if (edges[e + eType] === WEAK) continue;
      // The inspector's own handles (objects a CDP client asked for) are not app retainers.
      if (devtools.has(edges[e + eName]) && edgeTypes[edges[e + eType]] !== "element") continue;
      const to = edges[e + eTo] / NF;
      if (seen[to]) continue;
      seen[to] = 1;
      parentEdge[to] = e;
      parentNode[to] = n;
      queue[qt++] = to;
    }
  }
}

// Bytes reachable only through edges named `name` (strong reachability with them cut).
function retainedThrough(name) {
  const cut = new Set(strings.flatMap((v, i) => (v === name ? [i] : [])));
  const reach = new Uint8Array(N);
  const queue = new Uint32Array(N);
  let qh = 0;
  let qt = 0;
  queue[qt++] = 0;
  reach[0] = 1;
  while (qh < qt) {
    const n = queue[qh++];
    for (let e = firstEdge[n]; e < firstEdge[n + 1]; e += EF) {
      const t = edges[e + eType];
      if (t === WEAK) continue;
      const nameIdx = edges[e + eName];
      if (devtools.has(nameIdx) && edgeTypes[t] !== "element") continue;
      if (cut.has(nameIdx) && edgeTypes[t] !== "element" && edgeTypes[t] !== "hidden") continue;
      const to = edges[e + eTo] / NF;
      if (reach[to]) continue;
      reach[to] = 1;
      queue[qt++] = to;
    }
  }
  let bytes = 0;
  let count = 0;
  for (let n = 0; n < N; n++)
    if (seen[n] && !reach[n]) {
      bytes += nodes[n * NF + nSize];
      count++;
    }
  return { bytes, count };
}
for (const name of (process.env.CUT ?? "").split(",").filter(Boolean)) {
  const { bytes, count } = retainedThrough(name);
  console.log(`retained only through "${name}": ${(bytes / 1048576).toFixed(1)} MB in ${count} objects`);
}

const markerName = strings.indexOf(marker);
let shown = 0;
for (let n = 0; n < N && shown < Number(process.env.MARKERS ?? 3) && markerName >= 0; n++) {
  if (nodes[n * NF + nName] !== markerName || nodeTypes[nodes[n * NF + nType]] !== "object") continue;
  shown++;
  console.log(`\nretainer path to ${label(n)}${seen[n] ? "" : " (not strongly reachable)"}:`);
  const path = [];
  for (let m = n; m !== 0 && seen[m] && path.length < 80; m = parentNode[m])
    path.push(`  ${label(parentNode[m])}  --${edgeLabel(parentEdge[m])}-->  ${label(m)}`);
  console.log(path.reverse().join("\n"));
}

const bySize = new Map();
for (let n = 0; n < N; n++) {
  const k = label(n).slice(0, 80);
  const v = bySize.get(k) ?? [0, 0];
  v[0] += nodes[n * NF + nSize];
  v[1]++;
  bySize.set(k, v);
}
if (process.env.DUMP) (await import("node:fs")).writeFileSync(process.env.DUMP, JSON.stringify([...bySize]));
console.log(`\n${N} nodes, ${meta.edge_count} edges; top self size:`);
for (const [k, [size, count]] of [...bySize].sort((a, b) => b[1][0] - a[1][0]).slice(0, Number(top)))
  console.log(`${(size / 1048576).toFixed(1).padStart(8)} MB ${String(count).padStart(9)}  ${k}`);


// --- dominators (Cooper, Harvey, Kennedy: "A Simple, Fast Dominance Algorithm") ---
if (process.env.DOM) {
  const strong = (e) => {
    const t = edges[e + eType];
    if (t === WEAK) return false;
    return !(devtools.has(edges[e + eName]) && edgeTypes[t] !== "element");
  };
  // Post-order by iterative DFS.
  const order = new Uint32Array(N); // post-order index -> node
  const po = new Uint32Array(N).fill(0xffffffff); // node -> post-order index
  {
    const stack = new Uint32Array(N);
    const cursor = new Uint32Array(N);
    const visited = new Uint8Array(N);
    let sp = 0;
    let k = 0;
    stack[sp++] = 0;
    visited[0] = 1;
    cursor[0] = firstEdge[0];
    while (sp) {
      const n = stack[sp - 1];
      let pushed = false;
      while (cursor[n] < firstEdge[n + 1]) {
        const e = cursor[n];
        cursor[n] += EF;
        if (!strong(e)) continue;
        const to = edges[e + eTo] / NF;
        if (visited[to]) continue;
        visited[to] = 1;
        cursor[to] = firstEdge[to];
        stack[sp++] = to;
        pushed = true;
        break;
      }
      if (!pushed) {
        sp--;
        po[n] = k;
        order[k++] = n;
      }
    }
    var reached = k;
  }
  // Predecessors (CSR) among reached nodes.
  const predCount = new Uint32Array(N + 1);
  for (let n = 0; n < N; n++) {
    if (po[n] === 0xffffffff) continue;
    for (let e = firstEdge[n]; e < firstEdge[n + 1]; e += EF) if (strong(e)) predCount[edges[e + eTo] / NF + 1]++;
  }
  for (let n = 0; n < N; n++) predCount[n + 1] += predCount[n];
  const preds = new Uint32Array(predCount[N]);
  const fill = predCount.slice(0, N);
  for (let n = 0; n < N; n++) {
    if (po[n] === 0xffffffff) continue;
    for (let e = firstEdge[n]; e < firstEdge[n + 1]; e += EF) if (strong(e)) preds[fill[edges[e + eTo] / NF]++] = n;
  }
  // idom in post-order numbers; root has the highest post-order index.
  const UNDEF = 0xffffffff;
  const idom = new Uint32Array(reached).fill(UNDEF);
  const root = reached - 1;
  idom[root] = root;
  for (let changed = true, pass = 0; changed; pass++) {
    changed = false;
    for (let b = root - 1; b >= 0; b--) {
      const node = order[b];
      let next = UNDEF;
      for (let p = predCount[node]; p < predCount[node + 1]; p++) {
        let a = po[preds[p]];
        if (idom[a] === UNDEF) continue;
        if (next === UNDEF) {
          next = a;
          continue;
        }
        let c = next;
        while (a !== c) {
          while (a < c) a = idom[a];
          while (c < a) c = idom[c];
        }
        next = a;
      }
      if (next !== UNDEF && idom[b] !== next) {
        idom[b] = next;
        changed = true;
      }
    }
    if (pass > 50) break;
  }
  const retained = new Float64Array(reached);
  for (let b = 0; b < reached; b++) retained[b] += nodes[order[b] * NF + nSize];
  for (let b = 0; b < root; b++) if (idom[b] !== UNDEF) retained[idom[b]] += retained[b];
  // Largest retainers that are not synthetic roots, skipping a node whose
  // retained size is mostly one child's (so the list shows distinct owners).
  const ranked = [...Array(reached).keys()]
    .filter((b) => nodeTypes[nodes[order[b] * NF + nType]] !== "synthetic")
    .sort((a, b) => retained[b] - retained[a]);
  const childMax = new Float64Array(reached);
  for (let b = 0; b < root; b++) if (idom[b] !== UNDEF) childMax[idom[b]] = Math.max(childMax[idom[b]], retained[b]);
  console.log(`\nlargest retained sizes (dominator tree, ${reached} reachable):`);
  let printed = 0;
  for (const b of ranked) {
    if (printed >= Number(process.env.DOM_TOP ?? 25)) break;
    if (childMax[b] > retained[b] * 0.9) continue;
    printed++;
    const n = order[b];
    const chain = [];
    for (let m = n; m !== 0 && seen[m] && chain.length < Number(process.env.DOM_DEPTH ?? 14); m = parentNode[m]) chain.push(`${edgeLabel(parentEdge[m])}`);
    console.log(`${(retained[b] / 1048576).toFixed(1).padStart(8)} MB  ${label(n)}\n            via ${chain.reverse().join(" > ")}`);
  }
}
