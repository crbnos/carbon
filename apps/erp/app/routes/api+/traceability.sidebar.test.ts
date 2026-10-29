// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { expect, it, vi } from "vitest";
import { loader } from "./traceability.sidebar";

vi.mock("@carbon/auth/auth.server", () => ({ requirePermissions: vi.fn() }));

type Row = Record<string, unknown>;

// The service-role client the route gets: rows filtered by every `.eq`, and a
// step-record RPC that answers for any job it is asked about.
function serviceRole(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      let rows = tables[table] ?? [];
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          rows = rows.filter((row) => row[column] === value);
          return query;
        },
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null })
      };
      return query;
    },
    rpc: async () => ({ data: [{ id: "step-record-1" }], error: null })
  };
}

const tables = {
  trackedActivity: [
    { id: "act-own", companyId: "company-1", attributes: { Job: "job-own" } },
    {
      id: "act-foreign-job",
      companyId: "company-1",
      attributes: { Job: "job-foreign" }
    },
    {
      id: "act-foreign",
      companyId: "company-2",
      attributes: { Job: "job-foreign" }
    }
  ],
  job: [
    { id: "job-own", companyId: "company-1" },
    { id: "job-foreign", companyId: "company-2" }
  ]
};

async function stepRecordIds(activityId: string) {
  vi.mocked(requirePermissions).mockResolvedValue({
    client: serviceRole(tables),
    companyId: "company-1"
  } as unknown as Awaited<ReturnType<typeof requirePermissions>>);
  const response = await loader({
    request: new Request(
      `http://localhost/api/traceability/sidebar?activityId=${activityId}`
    ),
    params: {},
    context: {}
  } as Parameters<typeof loader>[0]);
  const body = (await response.json()) as { stepRecords: { id: string }[] };
  return body.stepRecords.map((record) => record.id);
}

it("returns the step records of the caller's own job", async () => {
  expect(await stepRecordIds("act-own")).toEqual(["step-record-1"]);
});

it.each([
  ["an activity of another company", "act-foreign"],
  ["an own activity naming another company's job", "act-foreign-job"],
  ["no activity", ""]
])("returns no step records for %s", async (_label, activityId) => {
  expect(await stepRecordIds(activityId)).toEqual([]);
});
