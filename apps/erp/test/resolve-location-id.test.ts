// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";

import { resolveLocationId } from "~/modules/shared/shared.service";

/**
 * `resolveLocationId` returns the location id that five `bypassRls: true`
 * screens then filter on with no company predicate of their own
 * (`get_jobs_by_date_range`, `get_unscheduled_jobs`,
 * `get_active_job_operations_by_location`, the `workCenters` reads). So the
 * multi-tenant boundary for those screens is this function: an id it returns
 * MUST belong to the caller's company.
 */

const COMPANY = "company_a";
const OWN_LOCATION = "loc_owned_by_a";
const FOREIGN_LOCATION = "loc_owned_by_b";
const DEFAULT_LOCATION = "loc_default_of_a";

type Row = Record<string, unknown>;

/** A Supabase client over in-memory tables; `eq` filters, and reads are logged. */
function clientWith(tables: Record<string, Row[]>) {
  const reads: string[] = [];
  const from = (table: string) => {
    reads.push(table);
    let rows = tables[table] ?? [];
    const chain: Record<string, unknown> = {
      select: () => chain,
      order: () => chain,
      eq: (column: string, value: unknown) => {
        rows = rows.filter((row) => row[column] === value);
        return chain;
      },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown) =>
        resolve({ data: rows, error: null })
    };
    return chain;
  };
  return { client: { from } as never, reads };
}

const company = clientWith({
  location: [
    { id: DEFAULT_LOCATION, companyId: COMPANY },
    { id: OWN_LOCATION, companyId: COMPANY },
    { id: FOREIGN_LOCATION, companyId: "company_b" }
  ],
  userDefaults: [
    { userId: "user_1", companyId: COMPANY, locationId: DEFAULT_LOCATION }
  ]
});

const resolve = (
  { client }: ReturnType<typeof clientWith>,
  searchParams: string
) =>
  resolveLocationId(client, new Request("https://erp.test/x/priority/dates"), {
    searchParams: new URLSearchParams(searchParams),
    userId: "user_1",
    companyId: COMPANY,
    onDefaultsError: "/x/production",
    onNoLocations: "/x/production"
  });

describe("resolveLocationId company scoping", () => {
  it("returns a ?location= that belongs to the caller's company", async () => {
    expect(await resolve(company, `location=${OWN_LOCATION}`)).toBe(
      OWN_LOCATION
    );
  });

  it.each([
    ["belonging to another company", FOREIGN_LOCATION],
    ["that does not exist", "loc_does_not_exist"]
  ])("falls back to the user's default for a ?location= %s", async (_case, id) => {
    expect(await resolve(company, `location=${id}`)).toBe(DEFAULT_LOCATION);
  });

  it("falls back to the company's first location without a default", async () => {
    const noDefaults = clientWith({
      location: [{ id: OWN_LOCATION, companyId: COMPANY }]
    });
    expect(await resolve(noDefaults, "")).toBe(OWN_LOCATION);
  });

  it("skips the scoping probe when no ?location= is supplied", async () => {
    const probe = clientWith({
      location: [{ id: OWN_LOCATION, companyId: COMPANY }],
      userDefaults: [
        { userId: "user_1", companyId: COMPANY, locationId: DEFAULT_LOCATION }
      ]
    });
    expect(await resolve(probe, "")).toBe(DEFAULT_LOCATION);
    // The probe is the only reason this function reads `location` directly.
    expect(probe.reads).toEqual(["userDefaults"]);
  });
});
