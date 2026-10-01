// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import * as pg from "pg";
import { describe, expect, it } from "vitest";

/**
 * Importing the postgres client registers node-postgres' type parsers as a
 * module-load side effect. The import is the subject of these tests, not a
 * dependency of them — hence the bare side-effect import.
 */
import "../supabase/functions/lib/postgres/index";

const NUMERIC_OID = 1700;
const DATE_OID = 1082;
const TIMESTAMPTZ_OID = 1184;
const TIMESTAMP_OID = 1114;

type TypeRegistry = {
  getTypeParser: (oid: number, format?: string) => (value: string) => unknown;
};

/**
 * `pg.types`, reached the same way the production registration reaches it. Both
 * the namespace and its `default` carry it depending on interop, and the
 * production code uses `?.` — so a miss would make the registration a SILENT
 * no-op. Asserting a real decode below is what proves it actually took.
 */
const types = ((pg as unknown as { types?: TypeRegistry }).types ??
  (pg as unknown as { default?: { types?: TypeRegistry } }).default
    ?.types) as TypeRegistry;

/**
 * These pin the ONE invariant the generated types cannot: that what the driver
 * hands back matches what `KyselyDatabase` declares. A `date` column is
 * `string | null` to the compiler, so a `Date` at runtime type-checks clean all
 * the way to the wire — which is how a `.slice` crash (Rillet payments) and
 * `422 "Not a valid date"` (every Ramp draft bill) both shipped.
 */
describe("postgres type parsers", () => {
  it("decodes DATE as the raw YYYY-MM-DD string, not a JS Date", () => {
    const parsed = types.getTypeParser(DATE_OID)("2026-09-15");

    expect(parsed).toBe("2026-09-15");
    expect(parsed).not.toBeInstanceOf(Date);
  });

  it("does not shift the day in a timezone behind UTC", () => {
    // The regression this exists for: `postgres-date` builds LOCAL midnight, so
    // a naive `toISOString().slice(0, 10)` reported 2026-09-14 anywhere west of
    // Greenwich. A raw string has no timezone to get wrong.
    expect(types.getTypeParser(DATE_OID)("2026-01-01")).toBe("2026-01-01");
    expect(types.getTypeParser(DATE_OID)("2026-12-31")).toBe("2026-12-31");
  });

  it("matches what PostgREST returns for the same column", () => {
    // Kysely and the Supabase client must agree, or a value that round-trips
    // through one breaks through the other.
    expect(types.getTypeParser(DATE_OID)("2026-09-15")).toBe("2026-09-15");
  });

  it("still decodes NUMERIC as a number", () => {
    expect(types.getTypeParser(NUMERIC_OID)("12.34567")).toBe(12.34567);
  });

  it("leaves the timestamp OIDs alone", () => {
    // Deliberate: Postgres' timestamptz wire text is space-separated with a
    // `+00` offset, where PostgREST emits ISO-8601 with `T` and `+00:00`. An
    // identity parser here would make the two clients disagree on the SHAPE of
    // the string. Changing these needs a normalizing parser, not this one.
    expect(
      types.getTypeParser(TIMESTAMPTZ_OID)("2026-09-15 16:36:52.677+00")
    ).toBeInstanceOf(Date);
    expect(
      types.getTypeParser(TIMESTAMP_OID)("2026-09-15 16:36:52.677")
    ).toBeInstanceOf(Date);
  });
});
