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
// The service's module graph reaches @carbon/onboarding, whose content builds
// Lingui `msg` descriptors at load; the macro is not compiled under vitest
// (same stub as production.service.test.ts).
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray | string, ...values: unknown[]) =>
    Array.isArray(strings)
      ? strings.reduce(
          (acc, s, i) => acc + s + (i < values.length ? String(values[i]) : ""),
          ""
        )
      : String(strings)
}));

const { updatePurchaseOrderLineSchedule } = await import(
  "../app/modules/purchasing/purchasing.service"
);

// The drawer's inline edit of one open PO line: a quantity or a required date,
// with the Draft / Planned guard inside the one UPDATE so a PO sent after the
// route read it is left alone. (Planning's Cancel, which deletes a line, is
// set-based with the rest of Apply — apply-purchasing-planning-actions.test.ts.)

class RecordingDriver extends DummyDriver {
  readonly sent: CompiledQuery[] = [];
  constructor(private readonly returnedIds: string[]) {
    super();
  }
  override async acquireConnection(): Promise<DatabaseConnection> {
    return {
      executeQuery: async <R>(
        query: CompiledQuery
      ): Promise<QueryResult<R>> => {
        this.sent.push(query);
        return { rows: this.returnedIds.map((id) => ({ id })) as R[] };
      },
      // biome-ignore lint/correctness/useYield: never streamed
      streamQuery: async function* () {
        throw new Error("not streamed");
      }
    };
  }
}

function database(returnedIds: string[]) {
  const driver = new RecordingDriver(returnedIds);
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

const args = { lineId: "pol1", purchaseOrderId: "po1", companyId: "c1" };

describe("updatePurchaseOrderLineSchedule", () => {
  const dateChange = {
    lineId: "pol1",
    companyId: "c1",
    companyGroupId: "g1",
    userId: "u1",
    requiredDate: "2026-11-02"
  };

  it("updates the line only while its PO is Draft or Planned, in one statement", async () => {
    const { db, driver } = database(["pol1"]);
    // A date change reads nothing first, so the client is never used.
    await updatePurchaseOrderLineSchedule({} as never, db, dateChange);

    expect(driver.sent).toHaveLength(1);
    const [{ sql, parameters }] = driver.sent;
    expect(sql).toMatch(/^update "purchaseOrderLine" set "requiredDate" = \$1/);
    expect(sql).toMatch(
      /"purchaseOrderId" in \(select "id" from "purchaseOrder" where "companyId" = \$\d+ and "status" in \(\$\d+, \$\d+\)\)/
    );
    expect(parameters).toEqual(
      expect.arrayContaining(["pol1", "c1", "Draft", "Planned"])
    );
  });

  it("reports the line updated", async () => {
    const { db } = database(["pol1"]);
    expect(
      await updatePurchaseOrderLineSchedule({} as never, db, dateChange)
    ).toEqual({ updated: true, error: null });
  });

  it("reports nothing updated when the PO left Draft / Planned", async () => {
    const { db } = database([]);
    expect(
      await updatePurchaseOrderLineSchedule({} as never, db, dateChange)
    ).toEqual({ updated: false, error: null });
  });
});
