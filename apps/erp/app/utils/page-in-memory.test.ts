// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

// @carbon/auth's barrel pulls in a Lingui macro plain vitest cannot run (see
// query.test.ts). Only the URL number parser is used here, so stand it in.
vi.mock("@carbon/auth", () => ({
  badRequest: vi.fn(),
  parseNumberFromUrlParam: (
    params: URLSearchParams,
    key: string,
    fallback: number
  ) => {
    const value = params.get(key);
    return value === null ? fallback : Number(value);
  }
}));

const { pageInMemory } = await import("./query");

type Row = { id: string; version: number; materials: string[] };

const rows: Row[] = [
  { id: "PART-10", version: 2, materials: ["BOLT"] },
  { id: "PART-2", version: 10, materials: ["NUT", "WASHER"] },
  { id: "PART-1", version: 2, materials: ["SCREW"] }
];

const page = (query: string) =>
  pageInMemory(rows, new URLSearchParams(query), (row) => [
    row.id,
    ...row.materials
  ]);

describe("pageInMemory", () => {
  it("keeps the input order with no sort", () => {
    expect(page("").rows.map((row) => row.id)).toEqual([
      "PART-10",
      "PART-2",
      "PART-1"
    ]);
  });

  it("searches every searchable value, shown or not", () => {
    const result = page("search=washer");
    expect(result.rows.map((row) => row.id)).toEqual(["PART-2"]);
    expect(result.count).toBe(1);
  });

  it("sorts ids by their numbers, not character by character", () => {
    expect(page("sort=id:asc").rows.map((row) => row.id)).toEqual([
      "PART-1",
      "PART-2",
      "PART-10"
    ]);
  });

  it("sorts numbers as numbers and an array by its first entry", () => {
    expect(page("sort=version:desc").rows.map((row) => row.id)).toEqual([
      "PART-2",
      "PART-10",
      "PART-1"
    ]);
    expect(page("sort=materials:asc").rows.map((row) => row.id)).toEqual([
      "PART-10",
      "PART-2",
      "PART-1"
    ]);
  });

  it("breaks a tie on the first sort with the second", () => {
    expect(
      page("sort=version:asc&sort=id:asc").rows.map((row) => row.id)
    ).toEqual(["PART-1", "PART-10", "PART-2"]);
  });

  it("leaves rows in place for a sort key no row has", () => {
    expect(page("sort=missing:asc").rows.map((row) => row.id)).toEqual([
      "PART-10",
      "PART-2",
      "PART-1"
    ]);
  });

  it("pages after filtering and counts every match", () => {
    const result = page("limit=20&offset=2");
    expect(result.rows.map((row) => row.id)).toEqual(["PART-1"]);
    expect(result.count).toBe(3);
    expect(page("offset=10").rows).toEqual([]);
  });
});
