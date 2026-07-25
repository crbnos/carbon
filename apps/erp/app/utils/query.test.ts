import { describe, expect, it } from "vitest";
import { setSearchFilter } from "./query";

// Minimal stand-in for a PostgREST filter builder: it records every `.or(...)`
// string and returns itself so calls can be chained, mirroring supabase-js.
function makeMockQuery() {
  const orCalls: string[] = [];
  const query = {
    orCalls,
    or(filter: string) {
      orCalls.push(filter);
      return query;
    }
  };
  return query;
}

describe("setSearchFilter", () => {
  it("matches a single word against every column (unchanged behavior)", () => {
    const query = makeMockQuery();
    setSearchFilter(query as any, "M8", ["name", "readableIdWithRevision"]);
    expect(query.orCalls).toEqual([
      "name.ilike.%M8%,readableIdWithRevision.ilike.%M8%"
    ]);
  });

  it("requires each word independently (one .or per word, ANDed by PostgREST)", () => {
    const query = makeMockQuery();
    setSearchFilter(query as any, "M8 Washer", [
      "name",
      "readableIdWithRevision"
    ]);
    expect(query.orCalls).toEqual([
      "name.ilike.%M8%,readableIdWithRevision.ilike.%M8%",
      "name.ilike.%Washer%,readableIdWithRevision.ilike.%Washer%"
    ]);
  });

  it("is order-independent — the words alone determine the filter", () => {
    const a = makeMockQuery();
    const b = makeMockQuery();
    setSearchFilter(a as any, "M8 Washer", ["name"]);
    setSearchFilter(b as any, "Washer M8", ["name"]);
    expect(a.orCalls).toEqual([...b.orCalls].reverse());
  });

  it("trims leading/trailing whitespace and collapses runs of spaces", () => {
    const query = makeMockQuery();
    setSearchFilter(query as any, "  M8   Washer  ", ["name"]);
    expect(query.orCalls).toEqual(["name.ilike.%M8%", "name.ilike.%Washer%"]);
  });

  it("treats commas and parentheses as delimiters (they are PostgREST-structural)", () => {
    const query = makeMockQuery();
    setSearchFilter(query as any, "Washer, Flat, M8", ["name"]);
    expect(query.orCalls).toEqual([
      "name.ilike.%Washer%",
      "name.ilike.%Flat%",
      "name.ilike.%M8%"
    ]);
  });

  it("adds no filter for a blank / whitespace-only search", () => {
    const query = makeMockQuery();
    setSearchFilter(query as any, "   ", ["name"]);
    expect(query.orCalls).toEqual([]);
  });
});
