// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { expect, it, vi } from "vitest";
import { loader } from "./traceability.expand";

vi.mock("@carbon/auth/auth.server", () => ({ requirePermissions: vi.fn() }));

// The service-role client the route gets: tracked entities filtered by every
// `.match` and `.eq`. Anything past the ownership check is out of reach.
function serviceRole(entities: Record<string, unknown>[]) {
  return {
    from() {
      let rows = entities;
      const query = {
        select: () => query,
        match: (match: Record<string, unknown>) => {
          rows = rows.filter((row) =>
            Object.entries(match).every(([key, value]) => row[key] === value)
          );
          return query;
        },
        eq: (column: string, value: unknown) => {
          rows = rows.filter((row) => row[column] === value);
          return query;
        },
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null })
      };
      return query;
    },
    rpc: () => {
      throw new Error("traversed past the ownership check");
    }
  };
}

it("refuses another company's tracked entity before traversing its lineage", async () => {
  vi.mocked(requirePermissions).mockResolvedValue({
    client: serviceRole([{ id: "entity-1", companyId: "company-2" }]),
    companyId: "company-1"
  } as unknown as Awaited<ReturnType<typeof requirePermissions>>);

  await expect(
    loader({
      request: new Request(
        "http://localhost/api/traceability/expand?trackedEntityId=entity-1"
      ),
      params: {},
      context: {}
    } as Parameters<typeof loader>[0])
  ).rejects.toMatchObject({ status: 404 });
});
