#!/usr/bin/env node
// Blanks the msgstr of translations that disagree with the approved glossary.
// /translate only ever fills EMPTY msgstr, so a wrong one must be cleared first.
//
//   node .claude/skills/translate/scripts/reset-violations.mjs --locale zh --dry-run
//   node .claude/skills/translate/scripts/reset-violations.mjs --locale zh
//   node .claude/skills/translate/scripts/reset-violations.mjs --locale zh --include-advisory
//
// Enforced-only by default: blanking advisory hits would re-translate strings
// that were probably right. Always records what it cleared (and the old values)
// under .ai/runs/translation-consistency/ so a lost connection loses nothing.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  buildMatcher,
  loadGlossary,
  localeCoverage,
  localesOf,
  termsInString,
  usesApprovedTerm,
} from "./lib-glossary.mjs";
import { escapePo, parsePo } from "./lib-po.mjs";

const REPO = process.cwd();
const LOCALES_DIR = `${REPO}/packages/locale/locales`;
const RECORD_DIR = `${REPO}/.ai/runs/translation-consistency`;
const CATALOGS = ["erp", "mes"];

const argv = process.argv.slice(2);
const flag = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? undefined : argv[i + 1];
};
const dryRun = argv.includes("--dry-run");
const includeAdvisory = argv.includes("--include-advisory");
const locale = flag("locale");

const doc = loadGlossary();
if (!locale) {
  console.error(`--locale is required. Known: ${localesOf(doc).join(", ")}`);
  process.exit(1);
}
if (!localesOf(doc).includes(locale)) {
  console.error(`Unknown locale "${locale}". Known: ${localesOf(doc).join(", ")}`);
  process.exit(1);
}

const coverage = localeCoverage(doc, locale);
if (coverage.filled === 0) {
  console.error(
    `${locale} has no approved terms in the glossary — there is nothing to reset against. Fill packages/locale/locales/glossary.json first.`,
  );
  process.exit(1);
}

const matcher = buildMatcher(doc);
const approved = new Map();
for (const e of doc.terms) {
  const t = (e.translations?.[locale] || "").trim();
  if (t) approved.set(e.term, t);
}

let totalCleared = 0;
const summary = [];

for (const catalog of CATALOGS) {
  const po = `${LOCALES_DIR}/${locale}/${catalog}.po`;
  if (!existsSync(po)) continue;
  const text = readFileSync(po, "utf8");
  const { lines, entries } = parsePo(text);
  const cleared = [];

  for (const entry of entries) {
    if (!entry.msgid || !entry.msgstr) continue;
    const hits = termsInString(entry.msgid, matcher);
    const bad = [];
    for (const hit of hits) {
      const want = approved.get(hit.term);
      if (!want) continue;
      if (usesApprovedTerm(entry.msgstr, want)) continue;
      if (hit.ambiguity && !includeAdvisory) continue;
      bad.push({ term: hit.term, expected: want });
    }
    if (!bad.length) continue;
    cleared.push({ msgid: entry.msgid, was: entry.msgstr, terms: bad });
    // A msgstr can span continuation lines; blanking only the first would leave
    // the rest as orphan strings and corrupt the catalog.
    lines[entry.msgstrLineIndex] = `msgstr "${escapePo("")}"`;
    for (let i = 1; i < entry.msgstrLineCount; i++) lines[entry.msgstrLineIndex + i] = null;
  }

  if (cleared.length && !dryRun) {
    writeFileSync(po, lines.filter((l) => l !== null).join("\n"));
  }
  totalCleared += cleared.length;
  summary.push({ catalog, cleared: cleared.length, entries: cleared });
}

console.log(`${locale}: ${coverage.filled}/${coverage.total} approved terms`);
for (const s of summary) console.log(`  ${s.catalog}: ${s.cleared} translation(s) ${dryRun ? "would be" : ""} cleared`);
console.log(`Total: ${totalCleared}${includeAdvisory ? " (including advisory)" : " (enforced only)"}`);

if (dryRun) {
  console.log(`\nDRY RUN — nothing written. Sample:`);
  for (const s of summary) {
    for (const e of s.entries.slice(0, 5)) {
      console.log(`  [${s.catalog}] ${e.terms.map((t) => `${t.term}→${t.expected}`).join(", ")}`);
      console.log(`     en: ${e.msgid}`);
      console.log(`     ${locale}: ${e.was}`);
    }
  }
  process.exit(0);
}

if (totalCleared) {
  mkdirSync(RECORD_DIR, { recursive: true });
  const path = `${RECORD_DIR}/reset-${locale}.json`;
  writeFileSync(path, JSON.stringify({ locale, includeAdvisory, coverage, summary }, null, 2));
  console.log(`\nRecord written: ${path}`);
  console.log(`The old values are in that file — recoverable if a re-translation goes wrong.`);
  console.log(`Next: run the /translate skill to refill the ${totalCleared} now-empty entries.`);
} else {
  console.log(`\nNothing to reset — ${locale} already agrees with every approved term.`);
}
