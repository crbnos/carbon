import { describe, expect, it } from "vitest";
import { getEntry, hasEntry, lookupEntry, termSlug } from "./helpers";
import { terms } from "./terms";
import type { GlossaryEntry } from "./types";

// `terms` is `as const satisfies ...`, so each entry has its narrowed literal
// shape — optional fields are absent on entries that don't set them, which
// makes loop-style checks awkward. The data still satisfies GlossaryEntry, so
// widen to that uniform shape for the iteration helpers below.
const entriesById = Object.entries(terms) as Array<[string, GlossaryEntry]>;

describe("glossary", () => {
  it("every entry has a non-empty term and definition", () => {
    for (const [id, entry] of entriesById) {
      expect(entry.term, `${id}.term`).toMatch(/\S/);
      expect(entry.definition, `${id}.definition`).toMatch(/\S/);
    }
  });

  it("slugs are unique", () => {
    const ids = Object.keys(terms);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("href, if set, points at /docs, /guides, or an absolute URL — shape only", () => {
    // Shape check only. We do NOT verify the docs anchor actually resolves —
    // that belongs in a docs-site link checker, not this package's test.
    const shape = /^\/(docs|guides)\/|^https?:\/\//;
    for (const [id, entry] of entriesById) {
      if (entry.href !== undefined) {
        expect(entry.href, `${id}.href`).toMatch(shape);
      }
    }
  });

  it("slug ids are valid lowercase-hyphen tokens", () => {
    // We don't enforce `termSlug(entry.term) === id` — many canonical ids are
    // intentional abbreviations of a spelled-out term (oem, wip, bom, mrp,
    // cogs, rfq, fefo, macrs, 8d, gr-ir). Just check the id shape.
    const shape = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    for (const [id] of entriesById) {
      expect(id, `id "${id}"`).toMatch(shape);
    }
  });

  it("termSlug() round-trips a normal term name", () => {
    expect(termSlug("Make to Order")).toBe("make-to-order");
    expect(termSlug("  Mixed-Case TEXT  ")).toBe("mixed-case-text");
  });

  it("getEntry is total over TermId", () => {
    // `getEntry` is typed as `(id: TermId) => GlossaryEntry` — no undefined.
    // Free-text/alias probes go through `lookupEntry` instead.
    expect(getEntry("method").term).toBe("Method");
  });

  it("hasEntry / lookupEntry resolve unknown slugs to nothing", () => {
    expect(hasEntry("method")).toBe(true);
    expect(hasEntry("not-a-real-slug")).toBe(false);
    expect(lookupEntry("method")?.term).toBe("Method");
    expect(lookupEntry("not-a-real-slug")).toBeUndefined();
  });

  it("hasEntry / lookupEntry resolve aliases to the canonical entry", () => {
    // `cogs` declares `aliases: ["cost-of-goods-sold"]`. The spelled-out slug
    // is not in `terms` but must resolve to the same canonical entry — that's
    // the whole point of the alias mechanism (lets MDX prose write either
    // form and land on the same definition).
    expect(hasEntry("cost-of-goods-sold")).toBe(true);
    expect(lookupEntry("cost-of-goods-sold")).toBe(getEntry("cogs"));
  });

  it("every declared alias points at exactly one canonical entry", () => {
    // Aliases must be globally unique — if two entries declared the same alias,
    // the lookup result would depend on insertion order. Catch that here.
    const seen = new Map<string, string>();
    for (const [id, entry] of entriesById) {
      for (const alias of entry.aliases ?? []) {
        const prior = seen.get(alias);
        expect(
          prior,
          `alias "${alias}" is declared on both "${prior}" and "${id}"`
        ).toBeUndefined();
        seen.set(alias, id);
      }
    }
  });
});
