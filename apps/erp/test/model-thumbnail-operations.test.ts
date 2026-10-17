// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { beforeEach, describe, expect, it, vi } from "vitest";

// Drawing a model's thumbnail again is open to every employee, but clearing a
// part's own thumbnail so the render shows is a part edit.

vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() })
}));
const { trigger } = vi.hoisted(() => ({ trigger: vi.fn() }));
vi.mock("@carbon/jobs", () => ({ trigger, batchTrigger: vi.fn() }));

import { createServiceContext } from "@carbon/api/service-fn.server";
import { regenerateModelThumbnail } from "../app/modules/documents/documents.server";

type Row = Record<string, unknown>;

/** The model and the parts using it, read and written as the operation does. */
function database(items: Row[]) {
  const tables: Record<string, Row[]> = {
    modelUpload: [{ id: "m1", companyId: "c1" }],
    item: items
  };
  return {
    from(table: string) {
      const where: Array<(row: Row) => boolean> = [];
      let patch: Row | null = null;
      const rows = () =>
        tables[table]!.filter((row) => where.every((test) => test(row)));
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          where.push((row) => row[column] === value);
          return query;
        },
        not: (column: string, _operator: "is", value: null) => {
          where.push((row) => row[column] !== value);
          return query;
        },
        limit: () => query,
        update: (values: Row) => {
          patch = values;
          return query;
        },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (resolve: (result: unknown) => unknown) => {
          const matched = rows();
          if (patch) for (const row of matched) Object.assign(row, patch);
          return Promise.resolve({ data: matched, error: null }).then(resolve);
        }
      };
      return query;
    }
  };
}

function contextFor(client: ReturnType<typeof database>, partsUpdate: string[]) {
  return createServiceContext({
    actor: {
      type: "user",
      userId: "u1",
      permissions: {
        parts: { view: ["c1"], create: [], update: partsUpdate, delete: [] }
      }
    },
    company: { id: "c1", groupId: "g1" },
    caller: client as never,
    system: () => client as never,
    pg: () => ({}) as never,
    kv: () => ({}) as never
  });
}

const part = (thumbnailPath: string | null) => ({
  id: "i1",
  companyId: "c1",
  modelUploadId: "m1",
  thumbnailPath
});

beforeEach(() => vi.clearAllMocks());

describe("regenerateModelThumbnail", () => {
  it("refuses to replace a part's own thumbnail without parts update", async () => {
    const items = [part("company/thumbnails/i1/own.png")];
    const result = await regenerateModelThumbnail(
      contextFor(database(items), []),
      { modelUploadId: "m1" }
    );
    expect(result.error?.category).toBe("forbidden");
    expect(items[0]!.thumbnailPath).toBe("company/thumbnails/i1/own.png");
    expect(trigger).not.toHaveBeenCalled();
  });

  it("clears the part's thumbnail and draws the model's with parts update", async () => {
    const items = [part("company/thumbnails/i1/own.png")];
    const result = await regenerateModelThumbnail(
      contextFor(database(items), ["c1"]),
      { modelUploadId: "m1" }
    );
    expect(result.error).toBeNull();
    expect(items[0]!.thumbnailPath).toBeNull();
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it("draws the model's thumbnail for any employee when no part has its own", async () => {
    const result = await regenerateModelThumbnail(
      contextFor(database([part(null)]), []),
      { modelUploadId: "m1" }
    );
    expect(result.error).toBeNull();
    expect(trigger).toHaveBeenCalledTimes(1);
  });
});
