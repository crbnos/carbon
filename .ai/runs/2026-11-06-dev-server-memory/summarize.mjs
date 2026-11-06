// Summarise a .heapprofile from bench.mjs --sampling: live heap by the package
// that allocated it (self) and by notable functions anywhere on the stack.
//   node summarize.mjs out/baseline-pages.heapprofile

import { readFileSync } from "node:fs";

const { head } = JSON.parse(readFileSync(process.argv[2], "utf8"));
const mb = (n) => (n / 1048576).toFixed(1);

const where = (url) => {
  if (!url) return "(native/vm)";
  const nm = url.lastIndexOf("node_modules/");
  if (nm >= 0) {
    const rest = url.slice(nm + 13).split("/");
    return rest[0].startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0];
  }
  const m = url.match(/(apps\/\w+|packages\/[\w-]+)\//);
  return m ? m[1] : url.replace(/^.*\//, "");
};

const self = new Map();
const onStack = new Map();
let total = 0;
function walk(node, stack) {
  const f = node.callFrame;
  const key = `${f.functionName || "(anon)"} ${where(f.url)}`;
  const next = [...stack, key];
  const size = node.selfSize;
  total += size;
  if (size) {
    // Attribute to the deepest frame that is not V8/Node internals.
    const owner =
      [...next].reverse().find((k) => !k.endsWith("(native/vm)")) ?? key;
    const pkg = owner.slice(owner.lastIndexOf(" ") + 1);
    self.set(pkg, (self.get(pkg) ?? 0) + size);
    for (const k of new Set(next)) onStack.set(k, (onStack.get(k) ?? 0) + size);
  }
  for (const c of node.children) walk(c, next);
}
walk(head, []);

console.log(`live sampled heap: ${mb(total)} MB\n\nby allocating package:`);
for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25))
  console.log(`${mb(v).padStart(8)}  ${k}`);
console.log("\nby function on stack (inclusive):");
for (const [k, v] of [...onStack].sort((a, b) => b[1] - a[1]).slice(0, 60))
  console.log(`${mb(v).padStart(8)}  ${k}`);
