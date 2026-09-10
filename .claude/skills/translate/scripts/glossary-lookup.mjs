#!/usr/bin/env node
// Glossary lookup for /translate — "is this a domain term, and what is its
// approved translation?" without reading the whole file into context.
//
//   node .claude/skills/translate/scripts/glossary-lookup.mjs --term Job --locale zh
//   node .claude/skills/translate/scripts/glossary-lookup.mjs --scan "Delete this job material?" --locale zh
//   node .claude/skills/translate/scripts/glossary-lookup.mjs --coverage
//   node .claude/skills/translate/scripts/glossary-lookup.mjs --list --locale zh --missing
//
// Exit codes: 0 found / 1 not found (so it can gate a shell step).
import {
  buildMatcher,
  glossaryForItems,
  loadGlossary,
  localeCoverage,
  localesOf,
  surfaceForms,
  termsInString,
} from "./lib-glossary.mjs";

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1]?.startsWith("--") ? true : argv[i + 1];
};
const has = (name) => argv.includes(`--${name}`);

const doc = loadGlossary();
const locales = localesOf(doc);
const locale = flag("locale");
if (locale && !locales.includes(locale)) {
  console.error(`Unknown locale "${locale}". Known: ${locales.join(", ")}`);
  process.exit(1);
}

const show = (entry) => {
  const line = [`${entry.term}  [${entry.category}]`];
  if (locale) {
    const t = (entry.translations?.[locale] || "").trim();
    line.push(t ? `→ ${locale}: ${t}` : `→ ${locale}: (NOT YET APPROVED — leave to translator judgement)`);
  }
  console.log(line.join("  "));
  console.log(`    meaning: ${entry.context}`);
  if (entry.ambiguity) console.log(`    ONLY applies to: ${entry.ambiguity}`);
  if (entry.englishVariants) console.log(`    same word as: ${entry.englishVariants.join(", ")}`);
  if (entry.seeAlso) console.log(`    see also: ${entry.seeAlso} (related, translated independently)`);
};

if (has("coverage")) {
  console.log(`Glossary: ${doc.terms.length} terms · ${locales.length} locales`);
  for (const l of locales) {
    const c = localeCoverage(doc, l);
    console.log(`  ${c.locale}: ${c.filled}/${c.total} approved (${c.pct}%)`);
  }
  process.exit(0);
}

if (has("list")) {
  const wantMissing = has("missing");
  const rows = doc.terms.filter((t) => {
    if (!locale || !wantMissing) return true;
    return (t.translations?.[locale] || "").trim() === "";
  });
  for (const e of rows.sort((a, b) => a.category.localeCompare(b.category) || a.term.localeCompare(b.term))) {
    console.log(`${e.category.padEnd(12)} ${e.term}${locale ? `  ${(e.translations?.[locale] || "").trim() || "—"}` : ""}`);
  }
  console.log(`\n${rows.length} term(s)${wantMissing && locale ? ` with no approved ${locale} translation` : ""}`);
  process.exit(0);
}

const term = flag("term");
if (term) {
  const key = String(term).toLowerCase();
  const hits = doc.terms.filter((e) => surfaceForms(e).some((f) => f.toLowerCase() === key));
  if (!hits.length) {
    console.log(`"${term}" is not a glossary term — translate it normally.`);
    process.exit(1);
  }
  hits.forEach(show);
  process.exit(0);
}

const scan = flag("scan");
if (scan) {
  const hits = termsInString(String(scan), buildMatcher(doc));
  if (!hits.length) {
    console.log("No glossary terms in that string — translate it normally.");
    process.exit(1);
  }
  hits.forEach(show);
  if (locale) {
    console.log(`\nJSON block for a subagent prompt:`);
    console.log(JSON.stringify(glossaryForItems([String(scan)], locale, doc, buildMatcher(doc)), null, 2));
  }
  process.exit(0);
}

console.error(`Usage:
  --term <English term> [--locale <code>]   look up one term
  --scan "<English string>" [--locale ...]  find every glossary term in a string
  --list [--locale <code>] [--missing]      list terms, optionally only unapproved ones
  --coverage                                approved-term counts per locale`);
process.exit(1);
