// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { getJobRequestItems } from "./material-request.service";

const item = (id: string) => ({
  id,
  readableIdWithRevision: id.toUpperCase(),
  name: id,
  thumbnailPath: null,
  type: "Part"
});

/** A client that answers each table with `rows` and records its `in` filters. */
function fakeClient(rows: Record<string, unknown>) {
  const ins: Record<string, unknown> = {};
  const client = {
    from(table: string) {
      const result = { data: rows[table] ?? null, error: null };
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "neq"]) {
        builder[method] = () => builder;
      }
      builder.in = (_column: string, values: unknown) => {
        ins[table] = values;
        return builder;
      };
      builder.maybeSingle = () => Promise.resolve(result);
      builder.then = (resolve: (value: unknown) => void) => resolve(result);
      return builder;
    }
  };
  return { client: client as never, ins };
}

describe("getJobRequestItems", () => {
  it("lists materials, kit components and tools, each item once", async () => {
    const { client, ins } = fakeClient({
      jobOperation: {
        jobMakeMethod: {
          jobMaterial: [
            { kit: false, item: item("bolt"), kitMethods: [{ id: "sub" }] },
            { kit: false, item: item("bolt"), kitMethods: [] },
            { kit: true, item: item("kit"), kitMethods: [{ id: "kit-mm" }] }
          ]
        },
        jobOperationTool: [{ item: item("driver") }, { item: null }]
      },
      jobMaterial: [{ item: item("gasket") }, { item: item("bolt") }]
    });

    const items = await getJobRequestItems(client, {
      companyId: "company-1",
      jobOperationId: "op-1"
    });

    expect(items.data?.map((i) => i.id)).toEqual([
      "bolt",
      "kit",
      "gasket",
      "driver"
    ]);
    // A subassembly is not a kit: only the kit's components are read.
    expect(ins.jobMaterial).toEqual(["kit-mm"]);
  });

  it("reads no components when the job has no kit", async () => {
    const { client, ins } = fakeClient({
      jobOperation: {
        jobMakeMethod: {
          jobMaterial: [{ kit: false, item: item("bolt"), kitMethods: [] }]
        },
        jobOperationTool: []
      }
    });

    const items = await getJobRequestItems(client, {
      companyId: "company-1",
      jobOperationId: "op-1"
    });

    expect(items.data?.map((i) => i.id)).toEqual(["bolt"]);
    expect(ins.jobMaterial).toBeUndefined();
  });
});
