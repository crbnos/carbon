#!/usr/bin/env node
// Consistency gate for /translate. `merge-translations.mjs` proves nothing is
// EMPTY; this proves the filled ones AGREE.
//
//   node .claude/skills/translate/scripts/check-glossary.mjs
//   node .claude/skills/translate/scripts/check-glossary.mjs --locale zh --max 40
//   node .claude/skills/translate/scripts/check-glossary.mjs --json > violations.json
//
// Exit 0 = clean (or nothing approved yet to check against), 1 = violations.
// Only as strong as the glossary is filled, so coverage is printed up front
// rather than showing a green tick over an empty rulebook.
import { existsSync, readFileSync } from "node:fs";
import {
  buildMatcher,
  loadGlossary,
  localeCoverage,
  localesOf,
  termsInString,
  usesApprovedTerm,
} from "./lib-glossary.mjs";
import { parsePo, readLocaleConfig } from "./lib-po.mjs";

const REPO = process.cwd();
const LOCALES_DIR = `${REPO}/packages/locale/locales`;
const CATALOGS = ["erp", "mes"];

const argv = process.argv.slice(2);
const flag = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? undefined : argv[i + 1];
};
const asJson = argv.includes("--json");
const strict = argv.includes("--strict");
const maxShown = Number(flag("max") || 25);

const doc = loadGlossary();
const matcher = buildMatcher(doc);
const { codes } = readLocaleConfig(`${REPO}/packages/locale/src/config.ts`, readFileSync);
const only = flag("locale");
const targets = (only ? [only] : codes.filter((c) => c !== "en")).filter((c) => localesOf(doc).includes(c));

const violations = [];
let checkedStrings = 0;

for (const locale of targets) {
  const approved = new Map();
  for (const e of doc.terms) {
    const t = (e.translations?.[locale] || "").trim();
    if (t) approved.set(e.term, { approved: t, entry: e });
  }
  if (approved.size === 0) continue;

  for (const catalog of CATALOGS) {
    const po = `${LOCALES_DIR}/${locale}/${catalog}.po`;
    if (!existsSync(po)) continue;
    const { entries } = parsePo(readFileSync(po, "utf8"));
    for (const entry of entries) {
      if (!entry.msgid || !entry.msgstr) continue;
      const hits = termsInString(entry.msgid, matcher);
      if (!hits.length) continue;
      checkedStrings++;
      for (const hit of hits) {
        const rule = approved.get(hit.term);
        if (!rule) continue;
        // Base form + inflection: "Aufträge" for approved "Auftrag" is not a violation.
        if (usesApprovedTerm(entry.msgstr, rule.approved)) continue;
        // An `ambiguity` note means a miss isn't reliably a defect — flag, don't fail.
        violations.push({
          locale,
          catalog,
          term: hit.term,
          expected: rule.approved,
          msgid: entry.msgid,
          msgstr: entry.msgstr,
          advisory: Boolean(hit.ambiguity),
        });
      }
    }
  }
}

const hard = violations.filter((v) => !v.advisory);
const advisory = violations.filter((v) => v.advisory);

if (asJson) {
  console.log(JSON.stringify({ checkedStrings, violations }, null, 2));
  process.exit((strict ? violations.length : hard.length) ? 1 : 0);
}

console.log(`Glossary: ${doc.terms.length} terms`);
for (const l of targets) {
  const c = localeCoverage(doc, l);
  console.log(`  ${c.locale}: ${c.filled}/${c.total} terms approved (${c.pct}%)`);
}
const noRules = targets.filter((l) => localeCoverage(doc, l).filled === 0);
if (noRules.length === targets.length) {
  console.log(`\nNo approved translations yet — nothing to check against. Fill packages/locale/locales/glossary.json first.`);
  process.exit(0);
}
if (noRules.length) console.log(`\nSkipped (no approved terms): ${noRules.join(", ")}`);

console.log(`\nChecked ${checkedStrings} translated strings containing a glossary term.`);
console.log(`Violations: ${hard.length} enforced, ${advisory.length} advisory`);

// Per-term breakdown first: a term with hundreds of advisory hits is the real
// story of a run, and printing only the enforced list would hide it.
const byTerm = new Map();
for (const v of violations) {
  const k = `${v.locale}  ${v.term}`;
  const row = byTerm.get(k) || { locale: v.locale, term: v.term, expected: v.expected, hard: 0, advisory: 0 };
  row[v.advisory ? "advisory" : "hard"]++;
  byTerm.set(k, row);
}
if (byTerm.size) {
  console.log(`\nBy term:`);
  for (const r of [...byTerm.values()].sort((a, b) => b.hard + b.advisory - (a.hard + a.advisory))) {
    const tag = r.advisory ? `${r.hard} enforced + ${r.advisory} advisory` : `${r.hard} enforced`;
    console.log(`  [${r.locale}] ${r.term} → "${r.expected}": ${tag}`);
  }
}

const sample = (rows, heading) => {
  if (!rows.length) return;
  console.log(`\n--- ${heading} ---`);
  for (const v of rows.slice(0, maxShown)) {
    console.log(`\n[${v.locale}/${v.catalog}] "${v.term}" should render as "${v.expected}"`);
    console.log(`   en: ${v.msgid}`);
    console.log(`   ${v.locale}: ${v.msgstr}`);
  }
  if (rows.length > maxShown) console.log(`\n… ${rows.length - maxShown} more (use --json for the full list).`);
};
sample(hard, "ENFORCED (unambiguous terms — these are defects)");
sample(advisory, "ADVISORY (term has a non-domain sense too — read before acting)");

if (advisory.length && !strict) {
  console.log(`\nAdvisory hits do not fail this check. Re-run with --strict to fail on them too.`);
}
process.exit((strict ? violations.length : hard.length) ? 1 : 0);
