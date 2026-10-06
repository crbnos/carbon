// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import {
  type CompiledQuery,
  type DatabaseConnection,
  DummyDriver,
  Kysely as KyselyClient,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type QueryResult
} from "kysely";
import { describe, expect, it, vi } from "vitest";

vi.mock("@carbon/content/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn(),
  glossaryEntries: () => []
}));
vi.mock("@carbon/server-functions", () => ({ serverFns: {} }));
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray | string, ...values: unknown[]) =>
    Array.isArray(strings)
      ? strings.reduce(
          (acc, s, i) => acc + s + (i < values.length ? String(values[i]) : ""),
          ""
        )
      : String(strings)
}));

const { applyPurchasingPlanningActions } = await import(
  "../app/modules/purchasing/purchasing.service"
);

// The Postgres wire is the boundary. Each statement the apply sends is
// recorded, and the rows "the database" answers with are chosen by what the
// statement is — the claim, a line write, a read, the un-claim.
type Responder = (query: CompiledQuery) => unknown[];

class RecordingDriver extends DummyDriver {
  readonly sent: CompiledQuery[] = [];
  constructor(private readonly respond: Responder) {
    super();
  }
  override async acquireConnection(): Promise<DatabaseConnection> {
    return {
      executeQuery: async <R>(
        query: CompiledQuery
      ): Promise<QueryResult<R>> => {
        this.sent.push(query);
        return { rows: this.respond(query) as R[] };
      },
      // biome-ignore lint/correctness/useYield: never streamed
      streamQuery: async function* () {
        throw new Error("not streamed");
      }
    };
  }
}

function database(respond: Responder) {
  const driver = new RecordingDriver(respond);
  const db = new KyselyClient<KyselyDatabase>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (k) => new PostgresIntrospector(k),
      createQueryCompiler: () => new PostgresQueryCompiler()
    }
  }) as unknown as Kysely<KyselyDatabase>;
  return { db, driver };
}

const is = {
  claim: (q: CompiledQuery) =>
    /^update "planningAction" set "status" = \$1/.test(q.sql) &&
    q.parameters.includes("Actioned"),
  dates: (q: CompiledQuery) =>
    /UPDATE "purchaseOrderLine" AS l\s+SET "requiredDate"/.test(q.sql),
  quantities: (q: CompiledQuery) =>
    /UPDATE "purchaseOrderLine" AS l\s+SET "purchaseQuantity"/.test(q.sql),
  lines: (q: CompiledQuery) => /^select .* from "purchaseOrderLine" as "pol"/.test(q.sql),
  currencies: (q: CompiledQuery) => /^select .* from "currencies"/.test(q.sql),
  cancels: (q: CompiledQuery) => /^delete from "purchaseOrderLine"/.test(q.sql),
  reopen: (q: CompiledQuery) =>
    /UPDATE "planningAction" AS a\s+SET "status" = 'Open'/.test(q.sql),
  drop: (q: CompiledQuery) => /^delete from "planningAction"/.test(q.sql)
};

const ids = (rows: string[]) => rows.map((id) => ({ id }));

const scope = { companyId: "c1", companyGroupId: "g1", userId: "u1" };

const expedite = {
  planningActionId: "a-date",
  type: "Expedite" as const,
  lineId: "pol-date",
  purchaseOrderId: "po1",
  suggestedDate: "2026-11-02",
  suggestedQuantity: null
};
const increase = {
  planningActionId: "a-qty",
  type: "Increase" as const,
  lineId: "pol-qty",
  purchaseOrderId: "po2",
  suggestedDate: null,
  // inventory units; the line below converts at 10 per purchase unit
  suggestedQuantity: 55
};
const cancel = {
  planningActionId: "a-cancel",
  type: "Cancel" as const,
  lineId: "pol-cancel",
  purchaseOrderId: "po3",
  suggestedDate: null,
  suggestedQuantity: null
};

const qtyLine = {
  id: "pol-qty",
  supplierUnitPrice: 2,
  supplierShippingCost: 0,
  purchaseQuantity: 4,
  taxPercent: 0.1,
  supplierTaxAmount: 0.8,
  conversionFactor: 10,
  currencyCode: "USD"
};

// Answers as if every write lands: the claim takes every id, each line write
// returns its lines, the quantity read returns the line and its currency.
function everythingLands(q: CompiledQuery): unknown[] {
  if (is.claim(q)) return ids(["a-date", "a-qty", "a-cancel"]);
  if (is.dates(q)) return ids(["pol-date"]);
  if (is.lines(q)) return [qtyLine];
  if (is.currencies(q)) return [{ code: "USD", decimalPlaces: 2 }];
  if (is.quantities(q)) return ids(["pol-qty"]);
  if (is.cancels(q)) return ids(["pol-cancel"]);
  return [];
}

describe("applyPurchasingPlanningActions", () => {
  it("applies a mixed batch as one statement per kind, inside one transaction", async () => {
    const { db, driver } = database(everythingLands);
    const result = await applyPurchasingPlanningActions(db, {
      ...scope,
      actions: [expedite, increase, cancel]
    });

    expect(result).toEqual({
      applied: ["a-date", "a-qty", "a-cancel"],
      alreadyApplied: [],
      refused: [],
      failed: []
    });
    // one claim, one date write, one lines read, one currency read, one
    // quantity write, one cancel — and nothing per action
    expect(driver.sent.filter(is.claim)).toHaveLength(1);
    expect(driver.sent.filter(is.dates)).toHaveLength(1);
    expect(driver.sent.filter(is.quantities)).toHaveLength(1);
    expect(driver.sent.filter(is.cancels)).toHaveLength(1);
    expect(driver.sent.filter(is.reopen)).toHaveLength(0);
    expect(driver.sent).toHaveLength(6);
  });

  it("claims only Open rows, and every write keeps the Draft / Planned guard", async () => {
    const { db, driver } = database(everythingLands);
    await applyPurchasingPlanningActions(db, {
      ...scope,
      actions: [expedite, increase, cancel]
    });
    const claim = driver.sent.find(is.claim)!;
    expect(claim.parameters).toEqual(
      expect.arrayContaining(["Open", "c1", "a-date", "a-qty", "a-cancel"])
    );
    for (const write of driver.sent.filter(
      (q) => is.dates(q) || is.quantities(q) || is.cancels(q)
    )) {
      expect(write.sql).toMatch(
        /"purchaseOrderId" in \(+select "id" from "purchaseOrder"/i
      );
      expect(write.parameters).toEqual(
        expect.arrayContaining(["Draft", "Planned", "c1"])
      );
    }
    const cancels = driver.sent.find(is.cancels)!;
    expect(cancels.sql).toContain('coalesce("quantityReceived"');
    expect(cancels.sql).toContain('coalesce("quantityInvoiced"');
    // a draft invoice line's RESTRICT reference refuses the line, not the batch
    expect(cancels.sql).toMatch(
      /not exists \(select "purchaseInvoiceLine"\."id" from "purchaseInvoiceLine"/
    );
  });

  // 55 inventory units at 10 per purchase unit is 5.5 → 6 purchase units, and
  // the stored tax amount follows the new base (2 × 6 at 10% = 1.20).
  it("converts a quantity to whole purchase units and restates the tax pair", async () => {
    const { db, driver } = database(everythingLands);
    await applyPurchasingPlanningActions(db, { ...scope, actions: [increase] });
    const write = driver.sent.find(is.quantities)!;
    expect(write.parameters).toEqual(
      expect.arrayContaining(["pol-qty", 6, 0.1, 1.2])
    );
  });

  // MRP measures a line by what it still has to bring (`quantityToReceive`). A
  // PO reopened from planning can carry a receipt: 55 inventory units still to
  // come is 6 purchase units ON TOP of the 2 received — 8 on the line, tax
  // 2 × 8 at 10% = 1.60. Writing 6 would have dropped what arrived.
  it("adds what was already received to the quantity still to come", async () => {
    const { db, driver } = database((q) =>
      is.lines(q) ? [{ ...qtyLine, quantityReceived: 2 }] : everythingLands(q)
    );
    await applyPurchasingPlanningActions(db, { ...scope, actions: [increase] });
    const write = driver.sent.find(is.quantities)!;
    expect(write.parameters).toEqual(
      expect.arrayContaining(["pol-qty", 8, 0.1, 1.6])
    );
  });

  // A PO with no currency is in the company's base currency. It used to fail
  // every quantity change with "Currency (none) has no precision".
  it("prices a PO with no currency in the company's base currency", async () => {
    const { db, driver } = database((q) =>
      is.lines(q)
        ? [{ ...qtyLine, currencyCode: null, baseCurrencyCode: "USD" }]
        : everythingLands(q)
    );
    const result = await applyPurchasingPlanningActions(db, {
      ...scope,
      actions: [increase]
    });
    expect(result.failed).toEqual([]);
    expect(result.applied).toEqual(["a-qty"]);
    expect(driver.sent.find(is.currencies)!.parameters).toContain("USD");
  });

  // An MRP run between the page's read and the claim can move an Open action's
  // quantity or date in place. The claim RETURNS the row's values, and those
  // are what is written: 75 inventory units at 10 per purchase unit is
  // 7.5 → 8, tax 2 × 8 at 10% = 1.60 — not the page's 55.
  it("applies the quantity and date from the claim, not from the page", async () => {
    const { db, driver } = database((q) =>
      is.claim(q)
        ? [
            { id: "a-date", suggestedDate: "2026-11-09", suggestedQuantity: null },
            { id: "a-qty", suggestedDate: null, suggestedQuantity: 75 }
          ]
        : everythingLands(q)
    );
    await applyPurchasingPlanningActions(db, {
      ...scope,
      actions: [expedite, increase]
    });
    const dates = driver.sent.find(is.dates)!;
    expect(dates.parameters).toEqual(
      expect.arrayContaining(["pol-date", "2026-11-09"])
    );
    expect(dates.parameters).not.toContain("2026-11-02");
    const quantities = driver.sent.find(is.quantities)!;
    expect(quantities.parameters).toEqual(
      expect.arrayContaining(["pol-qty", 8, 0.1, 1.6])
    );
    expect(quantities.parameters).not.toContain(6);
  });

  // Another apply took the row first: its line is never written here.
  it("leaves an action another apply already claimed alone", async () => {
    const { db, driver } = database((q) =>
      is.claim(q) ? ids(["a-qty"]) : everythingLands(q)
    );
    const result = await applyPurchasingPlanningActions(db, {
      ...scope,
      actions: [expedite, increase]
    });
    expect(result.alreadyApplied).toEqual(["a-date"]);
    expect(result.applied).toEqual(["a-qty"]);
    expect(driver.sent.filter(is.dates)).toHaveLength(0);
  });

  // The PO was sent after the page loaded: the guarded write changes nothing,
  // the action goes back to Open for review, in the same transaction.
  it("un-claims an action whose write was refused", async () => {
    const { db, driver } = database((q) => {
      if (is.dates(q)) return [];
      if (is.reopen(q)) return ids(["a-date"]);
      return everythingLands(q);
    });
    const result = await applyPurchasingPlanningActions(db, {
      ...scope,
      actions: [expedite, increase]
    });
    expect(result.refused).toEqual([{ id: "a-date", purchaseOrderId: "po1" }]);
    expect(result.applied).toEqual(["a-qty"]);
    const reopen = driver.sent.find(is.reopen)!;
    expect(reopen.parameters).toEqual(expect.arrayContaining(["a-date", "c1"]));
    expect(driver.sent.filter(is.drop)).toHaveLength(0);
  });

  // An MRP run meanwhile wrote a fresh Open row for the same need, so the
  // un-claim would collide with the natural-key index: the claimed row is
  // deleted instead, as releasePlanningActionClaim does.
  it("deletes a refused action that a fresh MRP row has replaced", async () => {
    const { db, driver } = database((q) => {
      if (is.dates(q)) return [];
      if (is.reopen(q)) return [];
      return everythingLands(q);
    });
    await applyPurchasingPlanningActions(db, {
      ...scope,
      actions: [expedite]
    });
    const drop = driver.sent.find(is.drop)!;
    expect(drop.parameters).toEqual(
      expect.arrayContaining(["a-date", "c1", "Actioned"])
    );
  });

  it("reports a line whose currency has no precision, and un-claims it", async () => {
    const { db, driver } = database((q) => {
      if (is.currencies(q)) return [];
      if (is.reopen(q)) return ids(["a-qty"]);
      return everythingLands(q);
    });
    const result = await applyPurchasingPlanningActions(db, {
      ...scope,
      actions: [increase]
    });
    expect(result.failed).toEqual([
      { id: "a-qty", message: "Currency USD has no precision" }
    ]);
    expect(result.applied).toEqual([]);
    expect(driver.sent.filter(is.quantities)).toHaveLength(0);
    expect(driver.sent.filter(is.reopen)).toHaveLength(1);
  });

  it("sends nothing for an empty batch", async () => {
    const { db, driver } = database(everythingLands);
    const result = await applyPurchasingPlanningActions(db, {
      ...scope,
      actions: []
    });
    expect(result.applied).toEqual([]);
    expect(driver.sent).toHaveLength(0);
  });
});
