// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { readUnitHolds } from "./unit-hold.server";
import { fakeClient } from "./work-unit-test-fixture";

const link = (
  trackedEntityId: string,
  readableId: string,
  over: { status?: string; createdAt?: string; companyId?: string } = {}
) => ({
  trackedEntityId,
  companyId: over.companyId ?? "co",
  issueId: `nc_${readableId}`,
  issueNumber: readableId,
  name: "Cracked housing",
  description: "Found at final test",
  status: over.status ?? "Registered",
  createdAt: over.createdAt ?? "2026-01-02T00:00:00Z",
  issueType: "Defect"
});
const tables = (on: boolean, links: ReturnType<typeof link>[]) => ({
  companySettings: [{ id: "co", holdUnitsWithOpenIssues: on }],
  unitQualityHold: links
});

describe("readUnitHolds", () => {
  it("reads only the setting when the company has not turned the rule on", async () => {
    const fake = fakeClient(tables(false, [link("u1", "NCR-1")]));
    expect(
      await readUnitHolds(fake.client, { companyId: "co", unitIds: ["u1"] })
    ).toEqual({ data: {}, error: null });
    expect(fake.calls.map((call) => call.table)).toEqual(["companySettings"]);
  });

  it("gives each unit its open issues, oldest first", async () => {
    const fake = fakeClient(
      tables(true, [
        link("u1", "NCR-1", { createdAt: "2026-01-01T00:00:00Z" }),
        link("u1", "NCR-2"),
        link("u2", "NCR-4", { status: "In Progress" }),
        link("u9", "NCR-6")
      ])
    );
    const holds = await readUnitHolds(fake.client, {
      companyId: "co",
      unitIds: ["u1", "u2", "u3"]
    });
    expect(holds.error).toBeNull();
    expect(Object.keys(holds.data ?? {})).toEqual(["u1", "u2"]);
    expect(holds.data?.u1?.map((issue) => issue.readableId)).toEqual([
      "NCR-1",
      "NCR-2"
    ]);
    expect(holds.data?.u2).toEqual([
      {
        id: "nc_NCR-4",
        readableId: "NCR-4",
        name: "Cracked housing",
        description: "Found at final test",
        type: "Defect",
        status: "In Progress",
        createdAt: "2026-01-02T00:00:00Z"
      }
    ]);
  });

  it("scopes the hold view to the requested company and serials", async () => {
    const fake = fakeClient(
      tables(true, [link("u1", "NCR-1", { companyId: "other" })])
    );
    expect(
      await readUnitHolds(fake.client, { companyId: "co", unitIds: ["u1"] })
    ).toEqual({ data: {}, error: null });
    const read = fake.calls.find((call) => call.table === "unitQualityHold");
    expect(read?.filters).toContainEqual(["companyId", "co"]);
    expect(read?.filters).toContainEqual(["trackedEntityId", ["u1"]]);
  });

  it("reads a long list of units in parts, each id once", async () => {
    const unitIds = Array.from({ length: 250 }, (_, index) => `u${index}`);
    const fake = fakeClient(tables(true, [link("u249", "NCR-1")]));
    const holds = await readUnitHolds(fake.client, {
      companyId: "co",
      unitIds: [...unitIds, "u0"]
    });
    expect(Object.keys(holds.data ?? {})).toEqual(["u249"]);
    const sizes = fake.calls
      .filter((call) => call.table === "unitQualityHold")
      .map((call) => (call.filters[0]?.[1] as string[]).length);
    expect(sizes).toEqual([100, 100, 50]);
  });

  it("reads nothing more for no units", async () => {
    const fake = fakeClient(tables(true, [link("u1", "NCR-1")]));
    expect(
      await readUnitHolds(fake.client, { companyId: "co", unitIds: [] })
    ).toEqual({ data: {}, error: null });
    expect(fake.calls.map((call) => call.table)).toEqual(["companySettings"]);
  });
});
