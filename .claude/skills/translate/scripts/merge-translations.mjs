#!/usr/bin/env node
// Final step of /translate. Reads the chunk outputs produced by the cheap-model
// subagents and writes each translation into the matching empty msgstr in the
// .po files. Deterministic: no model in the write path, only exact msgid match,
// and only empty msgstr are ever touched (existing translations are never
// overwritten). Reports matched / unmatched / still-missing counts.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { escapePo, parsePo } from "./lib-po.mjs";

const REPO = process.cwd();
const OUT_DIR = `${REPO}/.ai/scratch/translate`;
const LOCALES_DIR = `${REPO}/packages/locale/locales`;
const MANIFEST = `${OUT_DIR}/manifest.json`;

if (!existsSync(MANIFEST)) {
  console.error(`No manifest at ${MANIFEST}. Run extract-missing.mjs first.`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));

// Merge all chunk outputs for a given (locale,catalog) against its .po once.
const byPo = {};
for (const m of manifest) {
  const key = `${m.locale}/${m.catalog}`;
  (byPo[key] ||= { locale: m.locale, catalog: m.catalog, outs: [] }).outs.push(m.out);
}

let matched = 0;
let unmatched = 0;
const missingChunks = [];

for (const { locale, catalog, outs } of Object.values(byPo)) {
  const translations = {};
  for (const out of outs) {
    if (!existsSync(out)) {
      missingChunks.push(out);
      continue;
    }
    try {
      Object.assign(translations, JSON.parse(readFileSync(out, "utf8")));
    } catch {
      missingChunks.push(`${out} (invalid JSON)`);
    }
  }
  if (Object.keys(translations).length === 0) continue;

  const po = `${LOCALES_DIR}/${locale}/${catalog}.po`;
  const { lines, entries } = parsePo(readFileSync(po, "utf8"));
  const targeted = new Set();
  for (const e of entries) {
    if (e.msgid === "" || e.msgstr !== "") continue; // only fill empties
    const t = translations[e.msgid];
    if (t === undefined || t === "") continue;
    if (e.msgstrLineCount !== 1) continue; // empty msgstr is always one line
    lines[e.msgstrLineIndex] = `msgstr "${escapePo(t)}"`;
    matched++;
    targeted.add(e.msgid);
  }
  // Translations the model returned that matched no empty msgid.
  for (const k of Object.keys(translations)) if (!targeted.has(k)) unmatched++;
  writeFileSync(po, lines.join("\n"));
}

// Recount remaining empties across the targeted catalogs.
let remaining = 0;
for (const { locale, catalog } of Object.values(byPo)) {
  const { entries } = parsePo(readFileSync(`${LOCALES_DIR}/${locale}/${catalog}.po`, "utf8"));
  remaining += entries.filter((e) => e.msgid !== "" && e.msgstr === "").length;
}

console.log(`Merged: ${matched} filled, ${unmatched} unmatched (key mismatch)`);
console.log(`Remaining empty msgstr in targeted catalogs: ${remaining}`);
if (missingChunks.length) {
  console.log(`Missing/invalid chunk outputs (${missingChunks.length}):`);
  for (const c of missingChunks) console.log(`  ${c}`);
}
if (remaining > 0) console.log("INCOMPLETE — re-run /translate to fill the rest");
