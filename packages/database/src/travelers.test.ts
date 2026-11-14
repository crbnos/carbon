// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  claimTravelerPrint,
  type OperationLabelInput,
  shouldPrintOperationLabel
} from "./travelers.ts";
import type { Database } from "./types.ts";

type Row = {
  id: string;
  companyId: string;
  locationId: string;
  status: string;
  travelersPrintedAt: string | null;
};

/**
 * An in-memory `pickingList` table: it keeps rows and applies the filters the
 * claim sends, as PostgREST would. Each call to `update` resolves on its own,
 * so two claims of one row run one after the other, as two UPDATEs do.
 */
function pickingListTable(rows: Row[]) {
  const client = {
    from(table: string) {
      expect(table).toBe("pickingList");
      let patch: Partial<Row> = {};
      const filters: ((row: Row) => boolean)[] = [];
      const builder = {
        update(values: Partial<Row>) {
          patch = values;
          return builder;
        },
        eq(column: keyof Row, value: unknown) {
          filters.push((row) => row[column] === value);
          return builder;
        },
        is(column: keyof Row, value: null) {
          filters.push((row) => row[column] === value);
          return builder;
        },
        not(column: keyof Row, operator: "in", list: string) {
          expect(operator).toBe("in");
          const values = list.slice(1, -1).split(",");
          filters.push((row) => !values.includes(String(row[column])));
          return builder;
        },
        select(columns: string) {
          expect(columns).toBe("locationId");
          return builder;
        },
        async maybeSingle() {
          const matched = rows.filter((row) => filters.every((f) => f(row)));
          for (const row of matched) Object.assign(row, patch);
          const [row] = matched;
          return {
            data: row ? { locationId: row.locationId } : null,
            error: null
          };
        }
      };
      return builder;
    }
  };
  return client as unknown as SupabaseClient<Database>;
}

function list(overrides: Partial<Row> = {}): Row {
  return {
    id: "pl1",
    companyId: "c1",
    locationId: "loc1",
    status: "In Progress",
    travelersPrintedAt: null,
    ...overrides
  };
}

const claim = {
  pickingListId: "pl1",
  companyId: "c1",
  at: "2026-11-12T10:00:00Z"
};

describe("claimTravelerPrint", () => {
  it("claims a started list once, so a second pick prints nothing", async () => {
    const rows = [list()];
    const client = pickingListTable(rows);
    const [first, second] = await Promise.all([
      claimTravelerPrint(client, claim),
      claimTravelerPrint(client, claim)
    ]);
    expect([first.claimed, second.claimed]).toEqual([true, false]);
    expect(first.locationId).toBe("loc1");
    expect(rows[0]?.travelersPrintedAt).toBe(claim.at);
  });

  it.each([
    ["Completed", true],
    ["Partial", true],
    ["Draft", false],
    ["Cancelled", false]
  ])("claims a %s list: %s", async (status, expected) => {
    const rows = [list({ status })];
    const result = await claimTravelerPrint(pickingListTable(rows), claim);
    expect(result.claimed).toBe(expected);
    expect(rows[0]?.travelersPrintedAt).toBe(expected ? claim.at : null);
  });

  it("does not claim a list that already printed", async () => {
    const rows = [list({ travelersPrintedAt: "2026-11-01T00:00:00Z" })];
    const result = await claimTravelerPrint(pickingListTable(rows), claim);
    expect(result.claimed).toBe(false);
    expect(rows[0]?.travelersPrintedAt).toBe("2026-11-01T00:00:00Z");
  });

  it("does not claim another company's list", async () => {
    const rows = [list({ companyId: "c2" })];
    const result = await claimTravelerPrint(pickingListTable(rows), claim);
    expect(result.claimed).toBe(false);
    expect(rows[0]?.travelersPrintedAt).toBeNull();
  });
});

function base(
  overrides: Partial<OperationLabelInput> = {}
): OperationLabelInput {
  return {
    isFirstOperation: false,
    isLastOperation: false,
    isTopLevelMakeMethod: true,
    travelerLabels: false,
    travelerPrinted: false,
    printLabelOnCompletion: false,
    ...overrides
  };
}

describe("shouldPrintOperationLabel", () => {
  it("prints at the first operation when travelers carry no label", () => {
    expect(shouldPrintOperationLabel(base({ isFirstOperation: true }))).toBe(
      true
    );
  });

  it("skips the first operation when a printed traveler carries the label", () => {
    expect(
      shouldPrintOperationLabel(
        base({
          isFirstOperation: true,
          travelerLabels: true,
          travelerPrinted: true
        })
      )
    ).toBe(false);
  });

  it("prints at the first operation when no traveler has printed for the job", () => {
    expect(
      shouldPrintOperationLabel(
        base({ isFirstOperation: true, travelerLabels: true })
      )
    ).toBe(true);
  });

  it("prints at the first operation when travelers are off, even if one printed before", () => {
    expect(
      shouldPrintOperationLabel(
        base({ isFirstOperation: true, travelerPrinted: true })
      )
    ).toBe(true);
  });

  it("prints at the last top-level operation with the completion flag", () => {
    expect(
      shouldPrintOperationLabel(
        base({ isLastOperation: true, printLabelOnCompletion: true })
      )
    ).toBe(true);
  });

  it("skips the last sub-assembly operation even with the completion flag", () => {
    expect(
      shouldPrintOperationLabel(
        base({
          isLastOperation: true,
          isTopLevelMakeMethod: false,
          printLabelOnCompletion: true
        })
      )
    ).toBe(false);
  });

  it("prints on a single-operation routing with both settings on", () => {
    expect(
      shouldPrintOperationLabel(
        base({
          isFirstOperation: true,
          isLastOperation: true,
          travelerLabels: true,
          travelerPrinted: true,
          printLabelOnCompletion: true
        })
      )
    ).toBe(true);
  });
});
