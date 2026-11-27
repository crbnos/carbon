// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { noLocalTimezone } from "./no-local-timezone";

describe("noLocalTimezone", () => {
  it("flags getLocalTimeZone() in server code", () => {
    const ts = "const d = today(getLocalTimeZone()).toString();";
    const v = noLocalTimezone.scan("apps/erp/app/modules/x/x.service.ts", ts);
    expect(v).toHaveLength(1);
    expect(v[0]?.snippet).toBe("getLocalTimeZone(");
  });

  it("flags UTC day-slicing via split", () => {
    const ts = 'const today = new Date().toISOString().split("T")[0];';
    const v = noLocalTimezone.scan("f.ts", ts);
    expect(v).toHaveLength(1);
  });

  it("flags UTC day-slicing via slice", () => {
    const ts = "const today = new Date().toISOString().slice(0, 10);";
    const v = noLocalTimezone.scan("f.ts", ts);
    expect(v).toHaveLength(1);
  });

  it("flags UTC day-slicing of a supplied instant", () => {
    const cases = [
      'const day = new Date(eventAt).toISOString().split("T")[0];',
      "const day = new Date(entry.clockIn).toISOString().slice(0, 10);"
    ];
    for (const ts of cases) {
      expect(noLocalTimezone.scan("f.ts", ts)).toHaveLength(1);
    }
  });

  it("flags local date-parts of now", () => {
    const cases = [
      "const today = dayNames[new Date().getDay()];",
      "const year = new Date().getFullYear();",
      "const dom = new Date().getDate();"
    ];
    for (const ts of cases) {
      expect(noLocalTimezone.scan("f.ts", ts)).toHaveLength(1);
    }
  });

  it("flags local-midnight boundaries via setHours(0,0,0,0)", () => {
    const ts = "monday.setHours(0, 0, 0, 0);";
    expect(noLocalTimezone.scan("f.ts", ts)).toHaveLength(1);
  });

  it("replays 92c041c48e: the roster and the payroll week used the server's calendar", () => {
    // apps/erp/app/modules/people/people.service.ts before 92c041c48e.
    const before = `  const today = dayNames[new Date().getDay()];

  return data.filter((ej) => {
    const shift = ej.shift as Record<string, unknown> | null;
    return shift && shift[today] === true;
  });
}

export async function getWeeklyHoursForEmployees(
  client: SupabaseClient<Database>,
  companyId: string,
  employeeIds: string[]
): Promise<Record<string, number>> {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7));
  monday.setHours(0, 0, 0, 0);`;
    expect(
      noLocalTimezone
        .scan("apps/erp/app/modules/people/people.service.ts", before)
        .map((v) => [v.line, v.snippet])
    ).toEqual([
      [1, "new Date().getDay("],
      [15, "now.getDay("],
      [17, "now.getDate("],
      [18, ".setHours(0, 0, 0, 0)"]
    ]);
    // The fix: the company calendar.
    const after = `  const tz = await getCompanyTimeZone(client, companyId);
  const dayName = dayNames[getDayOfWeek(today(tz), "en-US")];
  const monday = startOfWeek(today(tz), "en-GB").toDate(tz);`;
    expect(noLocalTimezone.scan("f.ts", after)).toHaveLength(0);
  });

  it("flags a date part of now read through a local", () => {
    const ts = `const now = new Date();
const dow = now.getDay();
const at = now.toISOString();`;
    expect(
      noLocalTimezone.scan("f.ts", ts).map((v) => [v.line, v.snippet])
    ).toEqual([[2, "now.getDay("]]);
  });

  it("leaves a local set from another instant alone", () => {
    const ts = `const when = new Date(row.createdAt);
const y = when.getFullYear();`;
    expect(noLocalTimezone.scan("f.ts", ts)).toHaveLength(0);
  });

  it("allows full-instant timestamps", () => {
    const ts = "const at = new Date().toISOString();";
    expect(noLocalTimezone.scan("f.ts", ts)).toHaveLength(0);
  });

  it("allows UTC getters and local-roundtrip getters", () => {
    const cases = [
      "const dow = d.getUTCDay() || 7;",
      "const y = new Date(Date.UTC(2026, 0, 1)).getUTCFullYear();",
      // pg DATE parsed to local midnight → local getters roundtrip the parts
      "const y = value.getFullYear();",
      // non-midnight setHours (shift wall-times, client prefill) stays legal
      "clockIn.setHours(startH, startM, 0, 0);"
    ];
    for (const ts of cases) {
      expect(noLocalTimezone.scan("f.ts", ts)).toHaveLength(0);
    }
  });

  it("allows the datetime API", () => {
    const ts =
      "const d = datetime.today(await getCompanyTimeZone(client, companyId)).toString();";
    expect(noLocalTimezone.scan("f.ts", ts)).toHaveLength(0);
  });
});
