// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Runs against the local database and PostgREST; skipped without them.

// A location's planning time fence is NOT NULL. An update that does not send
// it (the API, MCP) keeps the stored fence; one that sends it writes it.

import { afterEach, beforeEach, describe, expect } from "vitest";
import { upsertLocation } from "../../app/modules/resources/resources.service";
import { alwaysPostFixture, type Fixture, USER } from "./fixtures/always-post";
import { hasLocalDatabase } from "./fixtures/local-database";
import { postgrestTest } from "./fixtures/local-supabase";

let f: Fixture;

const location = () => ({
  id: f.locationId,
  name: `${f.prefix} plant`,
  addressLine1: "1 Main St",
  city: "Chicago",
  postalCode: "60601",
  countryCode: "US",
  timezone: "America/New_York",
  updatedBy: USER
});

async function fenceDays() {
  const row = await f.db
    .selectFrom("location")
    .select("planningTimeFenceDays")
    .where("id", "=", f.locationId)
    .where("companyId", "=", f.companyId)
    .executeTakeFirstOrThrow();
  return row.planningTimeFenceDays;
}

describe.skipIf(!hasLocalDatabase)("upsertLocation and the planning time fence", () => {
  beforeEach(async () => {
    f = await alwaysPostFixture();
    await f.db
      .updateTable("location")
      .set({ planningTimeFenceDays: 7 })
      .where("id", "=", f.locationId)
      .where("companyId", "=", f.companyId)
      .execute();
  });

  afterEach(async () => {
    await f?.cleanup();
  });

  // A form field left empty parses to an undefined key, which `sanitize`
  // would write as null into the NOT NULL column.
  postgrestTest("an update without the fence keeps 7", async (client) => {
    const result = await upsertLocation(client, {
      ...location(),
      planningTimeFenceDays: undefined
    });
    expect(result.error).toBeNull();
    expect(await fenceDays()).toBe(7);
  });

  postgrestTest("an update with a fence of 0 clears it", async (client) => {
    const result = await upsertLocation(client, {
      ...location(),
      planningTimeFenceDays: 0
    });
    expect(result.error).toBeNull();
    expect(await fenceDays()).toBe(0);
  });
});
