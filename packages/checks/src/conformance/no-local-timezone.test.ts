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

  it("records provenance pointing at the company-timezone migration", () => {
    expect(noLocalTimezone.provenance.since).toBe(
      "20260805020925_company-timezone.sql"
    );
  });
});
