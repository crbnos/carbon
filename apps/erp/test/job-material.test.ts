// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";

// What a material save does around the row write: which parents it refuses,
// and when the recalculation that fills the material's estimates runs.

import {
  createJobMaterial,
  updateJobMaterial
} from "../app/modules/production/production.server";
import { createServiceContext } from "@carbon/api/service-fn.server";

/** Each table's one row, or none; `jobMaterial` writes are recorded and echo an id. */
function clientWith(rows: Record<string, unknown>, writes: string[]) {
  return {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq"]) chain[method] = () => chain;
      const write = (op: string) => () => {
        writes.push(`${op} ${table}`);
        return chain;
      };
      chain.insert = write("insert");
      chain.update = write("update");
      chain.maybeSingle = async () => ({ data: rows[table] ?? null, error: null });
      chain.single = async () => ({
        data: { id: "jm1", methodType: "Pull from Inventory" },
        error: null
      });
      return chain;
    }
  } as never;
}

// The recalculation is the only step that opens the database connection.
const recalculation = new Error("recalculation reached the database");

function save(rows: Record<string, unknown>) {
  const writes: string[] = [];
  const ctx = createServiceContext({
    actor: {
      type: "user",
      userId: "u1",
      permissions: {
        production: { view: [], create: ["c1"], update: [], delete: [] }
      }
    },
    company: { id: "c1", groupId: "g1" },
    caller: clientWith(rows, writes),
    system: () => clientWith(rows, writes),
    pg: () => {
      throw recalculation;
    },
    kv: () => ({}) as never
  });
  return { ctx, writes };
}

const material = {
  id: "jm1",
  jobId: "job1",
  jobMakeMethodId: "jmm1",
  description: "Bracket",
  itemType: "Part" as const,
  methodType: "Pull from Inventory" as const,
  itemId: "item1",
  kit: false,
  order: 1,
  quantity: 2,
  requiresBatchTracking: false,
  requiresSerialTracking: false,
  unitCost: 0,
  unitOfMeasureCode: "EA"
};
const parents = { jobMakeMethod: { id: "jmm1" }, jobOperation: { id: "op1" } };

describe("createJobMaterial", () => {
  it.each(["Draft", "Planned"])(
    "leaves a %s job's estimates to the release",
    async (status) => {
      const { ctx, writes } = save({ job: { status }, ...parents });
      const result = await createJobMaterial(ctx, material);
      expect(result).toEqual({ data: { id: "jm1" }, error: null });
      expect(writes).toEqual(["insert jobMaterial"]);
    }
  );

  it("recalculates a released job's estimates after the insert", async () => {
    const { ctx, writes } = save({ job: { status: "Ready" }, ...parents });
    const result = await createJobMaterial(ctx, material);
    expect(writes).toEqual(["insert jobMaterial"]);
    expect(result.error?.cause).toBe(recalculation);
  });

  it("refuses a make method that is not the job's", async () => {
    const { ctx, writes } = save({ job: { status: "Draft" } });
    const result = await createJobMaterial(ctx, material);
    expect(result.error?.category).toBe("notFound");
    expect(writes).toEqual([]);
  });
});

describe("updateJobMaterial", () => {
  it("refuses a material that is not on this job and method", async () => {
    const { ctx, writes } = save({ job: { status: "Draft" }, ...parents });
    const result = await updateJobMaterial(ctx, material);
    expect(result.error?.category).toBe("notFound");
    expect(writes).toEqual([]);
  });
});
