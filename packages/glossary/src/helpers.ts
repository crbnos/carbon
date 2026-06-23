import { terms } from "./terms";
import type { GlossaryEntry } from "./types";

/** Slugify a term name into a stable anchor id. Mirrors the slug rule the docs
 * `<Term>` component uses, so authoring `<Term>purchase to order</Term>` finds
 * the `purchase-to-order` entry. */
export function termSlug(term: string): string {
  return term
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Literal union of every canonical term id in the glossary — gives compile-time
 * typo protection at the call site (`useFieldHelp("typo")` is a type error).
 * Note: aliases (e.g. `cost-of-goods-sold` for `cogs`) are NOT in this union —
 * they resolve at runtime via `hasEntry`/`getEntry`. App call-sites should use
 * the canonical id; aliases exist so docs prose can write the spelled-out form. */
export type TermId = keyof typeof terms;

/** Lazy-built alias → canonical id index. Built once on first call. */
let aliasIndex: Map<string, TermId> | undefined;
function getAliasIndex(): Map<string, TermId> {
  if (aliasIndex) return aliasIndex;
  const index = new Map<string, TermId>();
  for (const [id, entry] of Object.entries(terms) as Array<
    [TermId, GlossaryEntry]
  >) {
    for (const alias of entry.aliases ?? []) index.set(alias, id);
  }
  aliasIndex = index;
  return index;
}

/** Canonical lookup — total over `TermId`. Every member of `keyof typeof terms`
 * is a key of `terms`, so this can't return `undefined`; call-sites that have a
 * literal-typed id (e.g. `LabelWithHelp` props) don't have to handle a missing
 * entry. For free-text or alias slugs use `lookupEntry` instead. */
export function getEntry(id: TermId): GlossaryEntry {
  return terms[id];
}

/** Partial lookup for free-text or alias slugs — e.g. the docs MDX
 * `<Term>purchase to order</Term>` slugifies the text and probes the glossary.
 * Returns the canonical entry for a known alias, `undefined` for an unknown
 * slug. App code with a `TermId` should call `getEntry` instead. */
export function lookupEntry(id: string): GlossaryEntry | undefined {
  if (Object.hasOwn(terms, id)) return terms[id as TermId];
  const canonical = getAliasIndex().get(id);
  return canonical ? terms[canonical] : undefined;
}

/** Runtime guard — true when `id` resolves to an entry, either as a canonical
 * slug or a known alias. Doesn't narrow to `TermId` because aliases aren't in
 * the literal union; if you need narrowing, pass a literal-typed id. */
export function hasEntry(id: string): boolean {
  return Object.hasOwn(terms, id) || getAliasIndex().has(id);
}

/** Every canonical entry tagged with its slug, in insertion order. Aliases are
 * not included as separate rows. Useful for tables or list renders that need
 * both pieces. */
export function listEntries(): Array<{ id: TermId; entry: GlossaryEntry }> {
  return (Object.keys(terms) as TermId[]).map((id) => ({
    id,
    entry: terms[id]
  }));
}

/** Canonical entries, alphabetically sorted by display term. The on-page docs
 * glossary and the search index both consume this. Aliases are not surfaced
 * as separate rows. */
export function glossaryEntries(): GlossaryEntry[] {
  return Object.values(terms).sort((a, b) =>
    a.term.toLowerCase().localeCompare(b.term.toLowerCase())
  );
}
