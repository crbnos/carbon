// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { PageGate } from "@carbon/database/access";
import { describe, expect, it } from "vitest";
import { importMethods } from "../app/modules/shared/shared.service";

const COMPANY = "company-1";

const items = [
  { id: "item-tool", readableId: "TOOL-1", revision: "0", type: "Tool" },
  { id: "item-part", readableId: "PART-1", revision: "0", type: "Part" },
  { id: "item-mat", readableId: "MAT-1", revision: "0", type: "Material" }
];

/** Reads answer `item` with `items` and every other table with nothing;
 *  opening a transaction is the first write, counted and then refused. */
function fakeDb() {
  const state = { transactions: 0 };
  const query = (table: string): unknown =>
    new Proxy(
      {},
      {
        get(_, prop) {
          if (prop === "then") return undefined;
          if (prop === "execute") {
            return async () => (table === "item" ? items : []);
          }
          if (prop === "executeTakeFirst") return async () => undefined;
          return () => query(table);
        }
      }
    );
  const db = {
    selectFrom: (table: string) => query(table),
    transaction: () => ({
      execute: async () => {
        state.transactions++;
        throw new Error("no writes in this test");
      }
    })
  };
  return { db: db as never, state };
}

/** A caller holding Edit on exactly `pages`. */
const holding =
  (...pages: string[]) =>
  (gate: PageGate) =>
    Object.keys(gate).every((page) => pages.includes(page));

async function importBom(parentId: string, can: (gate: PageGate) => boolean) {
  const { db, state } = fakeDb();
  const summary = {
    inserted: 0,
    updated: 0,
    errors: [] as { row: number; reason: string }[],
    skipped: [] as { row: number; reason: string }[]
  };
  await importMethods(db, {
    table: "bom",
    mappedRecords: [{ parentId, componentId: "MAT-1", quantity: "1" }],
    companyId: COMPANY,
    userId: "user-1",
    summary,
    can
  });
  return { summary, state };
}

describe("method import: the parent's type page", () => {
  it("refuses a Tool's method to a caller without Tools Edit, before any write", async () => {
    const { summary, state } = await importBom(
      "TOOL-1",
      holding("parts.parts")
    );
    expect(summary.errors).toEqual([
      { row: 0, reason: expect.stringContaining("Edit on Tools") }
    ]);
    expect(state.transactions).toBe(0);
  });

  it("writes a Tool's method for a caller with Tools Edit", async () => {
    const { state } = await importBom("TOOL-1", holding("parts.tools"));
    expect(state.transactions).toBe(1);
  });

  it("writes a Part's method for a caller with Parts Edit", async () => {
    const { state } = await importBom("PART-1", holding("parts.parts"));
    expect(state.transactions).toBe(1);
  });
});
