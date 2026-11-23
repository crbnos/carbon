// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Every MES service job read runs on the user's client, whose RLS lets an
// employee of several companies read all of them: each one must also filter
// by the company the session is in.

import { describe, expect, it } from "vitest";
import {
  getOpenServiceJobsByLocation,
  getOpenServiceJobsCount,
  getServiceJob,
  getServiceJobItems,
  getServiceJobsAssignedTo,
  getServiceJobTime
} from "./service.service";

type Call = { table: string; filters: [string, unknown][] };

/** A client that records each query's table and `eq` filters, and answers
 *  every query with no rows. */
function recordingClient() {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, filters: [] };
      calls.push(call);
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      for (const method of [
        "select",
        "not",
        "or",
        "order",
        "in",
        "neq",
        "maybeSingle",
        "single"
      ]) {
        builder[method] = chain;
      }
      builder.eq = (column: string, value: unknown) => {
        call.filters.push([column, value]);
        return builder;
      };
      builder.then = (resolve: (value: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 });
      return builder;
    }
  };
  return { client: client as never, calls };
}

describe("MES service job reads", () => {
  it("filter every query by the company", async () => {
    const { client, calls } = recordingClient();
    await getOpenServiceJobsByLocation(client, "company-1", "loc");
    await getOpenServiceJobsCount(client, "company-1", "loc");
    await getServiceJobsAssignedTo(client, "company-1", "user", "2026-10-23");
    await getServiceJob(client, "company-1", "job");
    await getServiceJobTime(client, "company-1", "job");
    await getServiceJobItems(client, "company-1", "job");

    expect(calls.map((call) => call.table)).toEqual([
      "serviceJob",
      "serviceJob",
      "serviceJobAssignment",
      "serviceJob",
      "serviceJob",
      "serviceJobTime",
      "serviceJobItem"
    ]);
    for (const call of calls) {
      expect(call.filters).toContainEqual(["companyId", "company-1"]);
    }
  });
});
