// Shared glossary helpers for the /translate skill.
// A blank translation means NOT YET APPROVED — callers must surface that
// explicitly, so a subagent can't read silence as permission to pick its own word.

import { readFileSync } from "node:fs";

export const GLOSSARY_PATH = "packages/locale/locales/glossary.json";

export function loadGlossary(repo = process.cwd()) {
  const doc = JSON.parse(readFileSync(`${repo}/${GLOSSARY_PATH}`, "utf8"));
  if (!Array.isArray(doc.terms))
    throw new Error(`${GLOSSARY_PATH}: no terms[]`);
  return doc;
}

// The term plus its spelling variants — every English form resolving to this entry.
export function surfaceForms(entry) {
  return [entry.term, ...(entry.englishVariants || [])];
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Abbreviations match case-SENSITIVELY: lowercase "eco" is inside "record" and
// "rma" inside "format", so a loose match there produces confident nonsense.
function formRegex(form) {
  const caseSensitive = form === form.toUpperCase() && /[A-Z]/.test(form);
  return new RegExp(
    `(?<![\\w-])${escapeRe(form)}(s|es)?(?![\\w-])`,
    caseSensitive ? "" : "i"
  );
}

// Build a matcher once, reuse across thousands of strings.
export function buildMatcher(doc) {
  const forms = [];
  for (const entry of doc.terms) {
    for (const form of surfaceForms(entry))
      forms.push({ form, entry, re: formRegex(form) });
  }
  forms.sort((a, b) => b.form.length - a.form.length);
  return forms;
}

// A placeholder is CODE, not prose: `{total}` is a variable name the translator
// must copy verbatim, so scanning it for terms both mis-reports a violation and
// — worse — orders the subagent to translate an identifier. Masked to spaces so
// match offsets still line up with the original.
// Only `{identifier}` is masked. An ICU plural branch (`{# lines differ …}`)
// holds real human text and MUST stay visible to the matcher.
const PLACEHOLDER = /\{[A-Za-z0-9_]+\}/g;

// `{variances, plural, …}` — the argument name and the ICU keyword are code too,
// but the trailing comma keeps them out of PLACEHOLDER. Mask the header ONLY,
// so the branches after it stay visible.
const ICU_HEADER = /\{\s*[A-Za-z0-9_]+\s*,\s*(plural|select|selectordinal)\s*,/g;

export function maskPlaceholders(str) {
  return str
    .replace(ICU_HEADER, (m) => " ".repeat(m.length))
    .replace(PLACEHOLDER, (m) => " ".repeat(m.length));
}

// Longest-match-wins: "Sales Order Line" consumes the "Line" inside it, so a
// compound doesn't drag in its own parts and bury the terms that matter.
export function termsInString(str, matcher) {
  const hits = [];
  let masked = maskPlaceholders(str);
  for (const { form, entry, re } of matcher) {
    const m = masked.match(re);
    if (!m) continue;
    if (!hits.includes(entry)) hits.push(entry);
    masked =
      masked.slice(0, m.index) +
      " ".repeat(m[0].length) +
      masked.slice(m.index + m[0].length);
  }
  return hits;
}

// The per-chunk term list for a subagent. Blank translations pass through as
// `approved: null` with their meaning — context without a wrong word to copy.
export function glossaryForItems(msgids, locale, doc, matcher) {
  const seen = new Map();
  for (const msgid of msgids) {
    for (const entry of termsInString(msgid, matcher)) {
      if (seen.has(entry.term)) continue;
      seen.set(entry.term, {
        term: entry.term,
        approved: entry.translations?.[locale] || null,
        meaning: entry.context,
        ...(entry.ambiguity ? { onlyAppliesTo: entry.ambiguity } : {}),
        ...(entry.englishVariants ? { sameWordAs: entry.englishVariants } : {}),
      });
    }
  }
  return [...seen.values()].sort((a, b) => a.term.localeCompare(b.term));
}

// An approved term is the BASE form and translators inflect it (Auftrag →
// Aufträge, заказ → заказа), so matching is on the STEM, not the whole word.
// Errs toward accepting: a false violation costs trust in the whole gate.

const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/;

function normalize(s) {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

// CJK doesn't inflect, so the term must appear whole; else keep ~60% as stem.
function stemOf(approved) {
  if (CJK.test(approved)) return approved;
  const n = normalize(approved);
  if (n.length <= 4) return n;
  return n.slice(0, Math.max(4, Math.ceil(n.length * 0.6)));
}

// Multi-word terms are checked word by word, since a language may reorder them.
export function usesApprovedTerm(msgstr, approved) {
  if (!approved) return true;
  if (CJK.test(approved)) return msgstr.includes(approved);
  const haystack = normalize(msgstr);
  return approved
    .split(/\s+/)
    .filter((w) => normalize(w).length > 2)
    .every((w) => haystack.includes(stemOf(w)));
}

export function localesOf(doc) {
  return doc._readme?.locales || Object.keys(doc.terms[0]?.translations || {});
}

export function doNotTranslate(doc) {
  return doc._readme?.doNotTranslate || [];
}

export function localeCoverage(doc, locale) {
  const total = doc.terms.length;
  const filled = doc.terms.filter(
    (t) => (t.translations?.[locale] || "").trim() !== ""
  ).length;
  return {
    locale,
    filled,
    total,
    pct: total ? Math.round((filled / total) * 100) : 0,
  };
}
