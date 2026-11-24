// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local stack (SUPABASE_DB_URL and the PostgREST `crbn up`
// started); skipped without one. The maintenance dashboard counts dispatches
// across every location, so the list its cards open must read the same rows.

import { afterAll, beforeAll, describe, expect } from "vitest";
import { maintenanceDispatchesList } from "../../app/utils/list-registry/resources.server";
import {
  alwaysPostFixture,
  type Fixture,
  seed,
  USER
} from "./fixtures/always-post";
import { hasLocalDatabase } from "./fixtures/local-database";
import { postgrestTest } from "./fixtures/local-supabase";

let f: Fixture;

beforeAll(async () => {
  if (!hasLocalDatabase) return;
  f = await alwaysPostFixture();
  const dispatch = (
    key: string,
    locationId: string,
    status: "Open" | "Completed"
  ) => ({
    id: `${f.prefix}-${key}`,
    maintenanceDispatchId: key,
    status,
    source: "Reactive" as const,
    severity: "Support Required" as const,
    locationId,
    companyId: f.companyId,
    createdBy: USER
  });
  await seed(f, (trx) =>
    trx
      .insertInto("maintenanceDispatch")
      .values([
        dispatch("HQ-OPEN", f.locationId, "Open"),
        dispatch("WH-OPEN", f.otherLocationId, "Open"),
        dispatch("WH-DONE", f.otherLocationId, "Completed")
      ])
      .execute()
  );
}, 120_000);

afterAll(async () => {
  if (!hasLocalDatabase) return;
  await f.cleanup();
}, 120_000);

/** The dispatch ids the list shows for a URL search, filtered as the Open Reactive card is. */
const openReactive = async (
  client: Parameters<typeof maintenanceDispatchesList.query>[0],
  search: string
) => {
  const result = await maintenanceDispatchesList.query(client, f.companyId, {
    params: new URLSearchParams(search),
    limit: 50,
    cursor: null,
    sorts: [],
    filters: [
      { column: "status", operator: "in", value: "Open,Assigned,In Progress" },
      { column: "source", operator: "eq", value: "Reactive" }
    ]
  });
  expect(result.error).toBeNull();
  return (result.data ?? []).map((row) => row.maintenanceDispatchId).sort();
};

describe("maintenance dispatch list location scope", () => {
  postgrestTest(
    "lists every location's dispatches for location=all",
    async (client) => {
      expect(await openReactive(client, "location=all")).toEqual([
        "HQ-OPEN",
        "WH-OPEN"
      ]);
    }
  );

  postgrestTest("lists one location's dispatches for its id", async (client) => {
    expect(
      await openReactive(client, `location=${f.otherLocationId}`)
    ).toEqual(["WH-OPEN"]);
  });

  postgrestTest(
    "lists the first location by name when none is given",
    async (client) => {
      expect(await openReactive(client, "")).toEqual(["HQ-OPEN"]);
    }
  );
});
