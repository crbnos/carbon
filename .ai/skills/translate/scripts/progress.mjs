#!/usr/bin/env node
// Live progress for /translate. Reads the manifest + the out/ chunk files that
// Haiku subagents write as they finish, and reports how many chunks / strings
// are done, overall and per locale.
//
//   node progress.mjs            one-shot snapshot (print after each batch)
//   node progress.mjs --watch    tick every 10s until .done marker (background)
//
// Runs independently of the main agent loop, so --watch keeps ticking even while
// the main loop is blocked awaiting a batch of subagents.
import { existsSync, readFileSync, readdirSync } from "node:fs";

const REPO = process.cwd();
const DIR = `${REPO}/.ai/scratch/translate`;
const MANIFEST = `${DIR}/manifest.json`;
const DONE_MARKER = `${DIR}/.done`;
const watch = process.argv.includes("--watch");
const INTERVAL_MS = Number(process.env.TRANSLATE_PROGRESS_INTERVAL || 10) * 1000;
const MAX_MS = 45 * 60 * 1000; // safety stop

function bar(frac, width = 24) {
  const n = Math.max(0, Math.min(width, Math.round(frac * width)));
  return `[${"#".repeat(n)}${"-".repeat(width - n)}]`;
}

function snapshot() {
  if (!existsSync(MANIFEST)) return "[progress] waiting for manifest…";
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  } catch {
    return "[progress] manifest being rewritten…";
  }
  const outFiles = existsSync(`${DIR}/out`) ? new Set(readdirSync(`${DIR}/out`)) : new Set();
  const exp = {};
  const got = {};
  let chunksDone = 0;
  let strDone = 0;
  let strExp = 0;
  for (const m of manifest) {
    exp[m.locale] = (exp[m.locale] || 0) + m.count;
    got[m.locale] = got[m.locale] || 0;
    strExp += m.count;
    const fname = `${m.chunk}.json`;
    if (outFiles.has(fname)) {
      try {
        const keys = Object.keys(JSON.parse(readFileSync(`${DIR}/out/${fname}`, "utf8"))).length;
        chunksDone++;
        strDone += keys;
        got[m.locale] += keys;
      } catch {
        // half-written file this tick; counts next tick
      }
    }
  }
  const frac = strExp ? strDone / strExp : 1;
  const perLocale = Object.keys(exp)
    .map((l) => `${l} ${got[l]}/${exp[l]}`)
    .join(" · ");
  const ts = new Date().toISOString().slice(11, 19);
  return (
    `[progress ${ts}] ${bar(frac)} chunks ${chunksDone}/${manifest.length} · ` +
    `strings ${strDone}/${strExp} (${Math.round(frac * 100)}%)\n            ${perLocale}`
  );
}

if (!watch) {
  console.log(snapshot());
} else {
  const start = Date.now();
  console.log(snapshot());
  const timer = setInterval(() => {
    if (existsSync(DONE_MARKER) || Date.now() - start > MAX_MS) {
      console.log(snapshot());
      console.log("[progress] done.");
      clearInterval(timer);
      return;
    }
    console.log(snapshot());
  }, INTERVAL_MS);
}
