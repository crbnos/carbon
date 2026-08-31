import { describe, expect, it, vi } from "vitest";

import { resolveLocationId } from "~/modules/shared/location.server";

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

/**
 * Minimal stand-in for the bits of the supabase client this function touches:
 * `.from("location").select().eq().eq().maybeSingle()` for the scoping probe,
 * and `.from("userDefaults")…` / `.from("location")…` for the fallbacks.
 * `location` rows are keyed by (id, companyId), mirroring the composite PK.
 */
function makeClient(locations: { id: string; companyId: string }[]) {
  const calls: string[] = [];

  const client = {
    calls,
    from(table: string) {
      calls.push(table);
      const filters: Record<string, unknown> = {};
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return builder;
        },
        order: () => builder,
        maybeSingle: async () => {
          const match = locations.find(
            (l) => l.id === filters.id && l.companyId === filters.companyId
          );
          return { data: match ? { id: match.id } : null, error: null };
        },
        single: async () => ({
          data: { locationId: DEFAULT_LOCATION },
          error: null
        }),
        then: undefined
      };
      return builder;
    }
  };

  return client as unknown as Parameters<typeof resolveLocationId>[0] & {
    calls: string[];
  };
}

function args(searchParams: string) {
  return {
    searchParams: new URLSearchParams(searchParams),
    userId: "user_1",
    companyId: COMPANY,
    onDefaultsError: "/x/production",
    onNoLocations: "/x/production"
  };
}

// `~/modules/resources` is a barrel that reaches UI components and so pulls in
// `@carbon/glossary`, whose `msg` macro is untransformed under vitest (no
// lingui plugin here). Stub it so this test exercises the server helper only.
vi.mock("@carbon/glossary", () => ({
  getDefinitionText: () => "",
  getEntry: () => undefined,
  getTermText: () => "",
  glossaryEntries: [],
  hasEntry: () => false,
  listEntries: () => [],
  lookupEntry: () => undefined,
  termSlug: () => "",
  terms: {}
}));

// The defaults path goes through `getUserDefaults`, which reads a different
// table via a different shape; stub it so these cases exercise only the
// scoping decision.
vi.mock("~/modules/users/users.server", () => ({
  getUserDefaults: async () => ({
    data: { locationId: DEFAULT_LOCATION },
    error: null
  })
}));

vi.mock("~/modules/resources", () => ({
  getLocationsList: async () => ({
    data: [{ id: DEFAULT_LOCATION }],
    error: null
  })
}));

describe("resolveLocationId company scoping", () => {
  const request = new Request("https://erp.test/x/priority/dates");

  it("returns a ?location= that belongs to the caller's company", async () => {
    const client = makeClient([{ id: OWN_LOCATION, companyId: COMPANY }]);

    const result = await resolveLocationId(
      client,
      request,
      args(`location=${OWN_LOCATION}`)
    );

    expect(result).toBe(OWN_LOCATION);
  });

  it("never returns a ?location= belonging to another company", async () => {
    const client = makeClient([
      { id: OWN_LOCATION, companyId: COMPANY },
      { id: FOREIGN_LOCATION, companyId: "company_b" }
    ]);

    const result = await resolveLocationId(
      client,
      request,
      args(`location=${FOREIGN_LOCATION}`)
    );

    expect(result).not.toBe(FOREIGN_LOCATION);
    expect(result).toBe(DEFAULT_LOCATION);
  });

  it("falls back for a ?location= that does not exist at all", async () => {
    const client = makeClient([{ id: OWN_LOCATION, companyId: COMPANY }]);

    const result = await resolveLocationId(
      client,
      request,
      args("location=loc_does_not_exist")
    );

    expect(result).toBe(DEFAULT_LOCATION);
  });

  it("skips the scoping probe when no ?location= is supplied", async () => {
    const client = makeClient([{ id: OWN_LOCATION, companyId: COMPANY }]);

    const result = await resolveLocationId(client, request, args(""));

    expect(result).toBe(DEFAULT_LOCATION);
    // The probe is the only reason this function reads `location` directly;
    // the absent-param path must not pay for it.
    expect(client.calls).not.toContain("location");
  });
});
