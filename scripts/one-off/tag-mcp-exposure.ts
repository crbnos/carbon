// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * One-time migration: add `@mcp` to every WRITE/DESTRUCTIVE service function
 * that already has an in-app caller, so the opt-in gate in `mcp-exposure.ts`
 * preserves the tools the app itself uses and drops only the ones nothing calls.
 *
 * LIMITATION: classifications are seeded from the COMMITTED digest, so a
 * function that moves between modules is invisible here — its old
 * `{oldModule}_{fn}` key is in the map and its new one is not. When a merge
 * relocates service functions (as #1780 moved the inspection-document block
 * from production to quality), re-tag those by hand.
 *
 * Over-tagging is the SAFE error: keeping a tool that is currently exposed is
 * the status quo, while missing a caller would remove a tool someone uses. So
 * "caller" is a deliberately generous bare-identifier search over app code.
 *
 *   pnpm exec tsx scripts/one-off/tag-mcp-exposure.ts [--dry]
 */
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";

const ROOT = path.resolve(__dirname, "../..");
const MODULES_DIR = path.join(ROOT, "apps/erp/app/modules");
const DIGEST = "apps/erp/app/routes/api+/mcp+/lib/tool-manifest.digest.json";
const CALLER_ROOTS = [
  "apps/erp/app/routes",
  "apps/erp/app/components",
  "apps/erp/app/hooks",
  "apps/erp/app/services",
  "apps/mes/app",
  "packages/jobs/src",
  "packages/ee/src",
  // A test referencing a tool is a caller: it pins generator behaviour against
  // that tool, so gating it out silently breaks the test rather than the app.
  "apps/erp/test",
  "apps/mes/test"
];
const dry = process.argv.includes("--dry");

/** Every identifier appearing anywhere in app code outside the service files. */
function callerWords(): Set<string> {
  const chunks: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules") walk(p);
      } else if (/\.tsx?$/.test(e.name)) {
        chunks.push(fs.readFileSync(p, "utf-8"));
      }
    }
  };
  for (const r of CALLER_ROOTS) {
    const abs = path.join(ROOT, r);
    if (fs.existsSync(abs)) walk(abs);
  }
  return new Set(chunks.join("\n").match(/\b[A-Za-z_$][\w$]*\b/g) ?? []);
}

/** The pre-gate manifest, which still carries every function's classification. */
function classifications(): Map<string, string> {
  const raw = execFileSync("git", ["show", `HEAD:${DIGEST}`], {
    cwd: ROOT,
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024
  });
  const out = new Map<string, string>();
  for (const t of JSON.parse(raw).tools as { name: string; classification: string }[]) {
    out.set(t.name, t.classification);
  }
  return out;
}

const words = callerWords();
const cls = classifications();
let tagged = 0;
const untouched: string[] = [];

for (const mod of fs.readdirSync(MODULES_DIR)) {
  for (const suffix of [".service.ts", ".ee.service.ts", ".mcp.server.ts"]) {
    const file = path.join(MODULES_DIR, mod, `${mod}${suffix}`);
    if (!fs.existsSync(file)) continue;
    let text = fs.readFileSync(file, "utf-8");
    let changed = false;

    // Walk declarations back-to-front so earlier indices stay valid.
    const decls = [...text.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)\s*\(/gm)].reverse();
    for (const m of decls) {
      const name = m[1];
      if (!name) continue;
      const tool = `${mod}_${name}`;
      const c = cls.get(tool);
      if (c !== "WRITE" && c !== "DESTRUCTIVE") continue;
      // A reference may be the FUNCTION name (a call) or the TOOL name
      // (`production_maxToolQuantityByItem`, how tests and the blocked list
      // name it) — underscore is a word character, so the tool form never
      // matches the bare function name.
      if (!words.has(name) && !words.has(`${mod}_${name}`)) {
        // Report only the ones that are ALSO untagged — a hand-tagged
        // API-first function has no in-app caller by design and is not a drop.
        const b = text.slice(0, m.index);
        const e = b.lastIndexOf("*/");
        const st = b.lastIndexOf("/**");
        const tagged =
          st !== -1 && e > st && b.slice(e + 2).trim() === "" &&
          b.slice(st, e + 2).includes("@mcp");
        if (!tagged) untouched.push(`${c.padEnd(12)} ${tool}`);
        continue;
      }
      const before = text.slice(0, m.index);
      const jsdocEnd = before.lastIndexOf("*/");
      const jsdocStart = before.lastIndexOf("/**");
      const hasAdjacentJsdoc =
        jsdocStart !== -1 &&
        jsdocEnd > jsdocStart &&
        before.slice(jsdocEnd + 2).trim() === "";
      const block = hasAdjacentJsdoc
        ? before.slice(jsdocStart, jsdocEnd + 2)
        : null;
      // Idempotence must match the tag ANYWHERE in the block, not only at a
      // line start: an earlier version of this script spliced `* @mcp` onto the
      // tail of a single-line `/** … */`, the line-start check then failed to
      // see its own output, and three runs produced `/** @mcp * @mcp * @mcp`
      // across 592 blocks.
      if (block && block.includes("@mcp")) continue;

      if (block === null) {
        text = `${text.slice(0, m.index)}/** @mcp */\n${text.slice(m.index)}`;
      } else if (block.includes("\n")) {
        // Multi-line: add a tag line before the closing delimiter.
        text = `${text.slice(0, jsdocEnd)}* @mcp\n ${text.slice(jsdocEnd)}`;
      } else {
        // Single-line `/** text */` — EXPAND it, so the tag gets its own line.
        const inner = block.slice(3, -2).trim();
        text =
          text.slice(0, jsdocStart) +
          `/**\n * ${inner}\n * @mcp\n */` +
          text.slice(jsdocEnd + 2);
      }
      changed = true;
      tagged++;
    }
    if (changed && !dry) fs.writeFileSync(file, text);
  }
}

console.log(`${dry ? "[dry] would tag" : "tagged"}: ${tagged} write/destructive functions with an in-app caller`);
console.log(`left UNTAGGED (no in-app caller) — these stop being tools: ${untouched.length}`);
for (const u of untouched.sort()) console.log(`   ${u}`);
