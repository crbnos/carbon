// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AttachOnshapeAssetsInput,
  attachOnshapeAssetsToItem
} from "./onshape-attach";

vi.mock("../tasks/assembler-client", () => ({
  resolveModelSourceBucket: vi.fn(async () => "temp-staging")
}));

type Row = Record<string, unknown>;
type TableName = "company" | "item" | "modelUpload" | "document";
type QueryError = { code?: string; message: string };
type Call = { table: string; operation: string; filters: Row; values?: Row };

// Stateful query/storage fake: exercise persisted state across redelivery,
// partial failures and overlapping uploads, rather than asserting one payload.
function database() {
  const tables: Record<TableName, Row[]> = {
    company: [{ id: "company", companyGroupId: "group" }],
    item: [
      {
        id: "item",
        companyId: "company",
        modelUploadId: "onshape-legacy",
        thumbnailPath: null
      }
    ],
    // A fully-optimized prior Onshape generation: its "onshape-" id is what marks
    // it as a superseded auto-generated artifact rather than user data.
    modelUpload: [
      {
        id: "onshape-legacy",
        companyId: "company",
        name: "SADDLE.A.gltf",
        modelPath: "company/models/onshape-legacy.gltf.zst",
        size: 12880000,
        optimizedModelPath: "company/models/onshape-legacy/optimized.glb",
        optimizeStatus: "Success",
        thumbnailPath: "company/thumbnails/onshape-legacy.png"
      }
    ],
    document: []
  };
  const calls: Call[] = [];
  const objects = new Map<string, Blob>();
  const uploads: string[] = [];
  const moves: string[] = [];
  const copies: string[] = [];
  const failures: { table: string; operation: string; error: QueryError }[] =
    [];
  const client = {
    from(table: TableName) {
      let operation = "select";
      let values: Row | undefined;
      const filters: Row = {};
      const execute = () => {
        calls.push({ table, operation, filters: { ...filters }, values });
        const index = failures.findIndex(
          (f) => f.table === table && f.operation === operation
        );
        if (index >= 0)
          return { data: null, error: failures.splice(index, 1)[0]!.error };
        const rows = tables[table];
        const matching = rows.filter((row) =>
          Object.entries(filters).every(([key, value]) => row[key] === value)
        );
        if (operation === "insert") {
          if (rows.some((row) => row.id === values?.id && values?.id)) {
            return {
              data: null,
              error: { code: "23505", message: "duplicate key" }
            };
          }
          const inserted = { id: `document-${rows.length}`, ...values };
          rows.push(inserted);
          return { data: inserted, error: null };
        }
        if (operation === "update") {
          matching.forEach((row) => {
            Object.assign(row, values);
          });
        }
        return { data: matching[0] ?? null, error: null };
      };
      const query = {
        select: (_fields?: string) => query,
        eq: (key: string, value: unknown) => {
          filters[key] = value;
          return query;
        },
        limit: (_count: number) => query,
        insert: (row: Row) => {
          operation = "insert";
          values = row;
          return query;
        },
        update: (row: Row) => {
          operation = "update";
          values = row;
          return query;
        },
        single: async () => execute(),
        maybeSingle: async () => execute(),
        then: (resolve: (result: ReturnType<typeof execute>) => unknown) =>
          Promise.resolve(execute()).then(resolve)
      };
      return query;
    },
    storage: {
      from(bucket: string) {
        return {
          upload: async (
            path: string,
            blob: Blob,
            options: { upsert?: boolean }
          ) => {
            const key = `${bucket}/${path}`;
            uploads.push(key);
            if (objects.has(key) && !options.upsert) {
              return {
                error: {
                  statusCode: "409",
                  message: "The resource already exists"
                }
              };
            }
            objects.set(key, blob);
            return { data: { path }, error: null };
          },
          copy: async (_source: string, target: string) => {
            copies.push(target);
            return { error: null };
          },
          move: async (from: string, to: string) => {
            const [source, target] = [`${bucket}/${from}`, `${bucket}/${to}`];
            if (!objects.has(source)) {
              return { error: { message: "Object not found" } };
            }
            if (objects.has(target)) {
              return { error: { message: "The resource already exists" } };
            }
            moves.push(target);
            objects.set(target, objects.get(source)!);
            objects.delete(source);
            return { data: { message: "Successfully moved" }, error: null };
          },
          info: async (path: string) =>
            objects.has(`${bucket}/${path}`)
              ? { data: { name: path }, error: null }
              : { data: null, error: { message: "Object not found" } },
          remove: async (paths: string[]) => {
            for (const path of paths) objects.delete(`${bucket}/${path}`);
            return { data: [], error: null };
          }
        };
      }
    }
  };
  return {
    client: client as unknown as Parameters<
      typeof attachOnshapeAssetsToItem
    >[0],
    tables,
    calls,
    objects,
    uploads,
    moves,
    copies,
    failures
  };
}

const STAGED = "company/models/onshape-fetch-t1.step";

const input = {
  companyId: "company",
  createdBy: "user",
  itemId: "item",
  sourceDocument: "Part" as const,
  model: {
    fileName: "SADDLE.A.step",
    stagedPath: STAGED,
    size: 22,
    contentHash: "content-1",
    sourceId: "onshape-part-v2"
  }
};

/** Stage the export (as the assembler's fetch would), then attach it. */
function attach(
  db: ReturnType<typeof database>,
  args: AttachOnshapeAssetsInput,
  bytes = "selected part geometry"
) {
  if (args.model) {
    db.objects.set(`temp-staging/${args.model.stagedPath}`, new Blob([bytes]));
  }
  return attachOnshapeAssetsToItem(db.client, args);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("immutable released-part attachments", () => {
  it("replaces a bad generation while keeping item data and the prior model intact", async () => {
    const db = database();
    const prior = structuredClone(db.tables.modelUpload[0]);
    const result = await attach(db, input);
    expect(result.modelUploadId).toBe(input.model.sourceId);
    expect(db.tables.item[0]).toEqual({
      id: "item",
      companyId: "company",
      modelUploadId: input.model.sourceId,
      thumbnailPath: null
    });
    expect(db.tables.modelUpload[0]).toEqual(prior);
    expect(db.tables.modelUpload[1]).toMatchObject({
      id: input.model.sourceId,
      modelPath: "company/models/onshape-part-v2.step",
      size: 22,
      originalSize: 22
    });
    expect(db.copies).toEqual([]);
    expect(db.tables.document).toEqual([]);
    expect(result.preservedPriorModelAsDocument).toBe(false);
  });

  it("replays without overwriting a compacted raw, optimized preview or thumbnail", async () => {
    const db = database();
    await attach(db, input);
    const current = db.tables.modelUpload.find(
      (row) => row.id === input.model.sourceId
    )!;
    Object.assign(current, {
      modelPath: "company/models/onshape-part-v2.step.zst",
      optimizeStatus: "Success",
      optimizedModelPath: "new.glb",
      thumbnailPath: "new.png"
    });
    const snapshot = structuredClone(current);
    const uploadCount = db.moves.length;
    await attach(db, input);
    expect(db.tables.modelUpload).toHaveLength(2);
    expect(current).toEqual(snapshot);
    expect(db.moves).toHaveLength(uploadCount);
  });

  it("recovers a failed item link using the already-created source model", async () => {
    const db = database();
    db.failures.push({
      table: "item",
      operation: "update",
      error: { message: "link unavailable" }
    });
    await expect(attach(db, input)).rejects.toThrow(/link/i);
    const result = await attach(db, input);
    expect(result.modelUploadId).toBe(input.model.sourceId);
    expect(db.tables.modelUpload).toHaveLength(2);
    expect(db.moves).toHaveLength(1);
  });

  it("allows concurrent redeliveries without duplicate model rows or overwriting bytes", async () => {
    const db = database();
    const results = await Promise.all([attach(db, input), attach(db, input)]);
    expect(results.map((r) => r.modelUploadId)).toEqual([
      input.model.sourceId,
      input.model.sourceId
    ]);
    expect(db.tables.modelUpload).toHaveLength(2);
    expect(db.objects.size).toBe(1);
  });

  // A non-"onshape-" id marks a manually uploaded model, which must be preserved.
  function withManualPriorModel(db: ReturnType<typeof database>, name: string) {
    db.tables.modelUpload[0]!.id = "manual-model";
    db.tables.modelUpload[0]!.name = name;
    db.tables.item[0]!.modelUploadId = "manual-model";
  }

  it("preserves a genuinely different manual model as a document", async () => {
    const db = database();
    withManualPriorModel(db, "manual-prototype.glb");
    const result = await attach(db, input);
    expect(result.preservedPriorModelAsDocument).toBe(true);
    expect(db.copies).toEqual(["company/parts/item/manual-prototype.glb"]);
    expect(db.tables.document).toHaveLength(1);
  });

  it("preserves a manual model sharing the released export's filename", async () => {
    const db = database();
    // Same filename as the incoming release — filename is not provenance, so the
    // manual model must still be preserved rather than silently relinked away.
    withManualPriorModel(db, input.model.fileName);
    const result = await attach(db, input);
    expect(result.modelUploadId).toBe(input.model.sourceId);
    expect(result.preservedPriorModelAsDocument).toBe(true);
    expect(db.copies).toEqual(["company/parts/item/SADDLE.A.step"]);
    expect(db.tables.document).toHaveLength(1);
  });

  it("checks lookup failures instead of treating them as absent prior models", async () => {
    const db = database();
    db.failures.push({
      table: "modelUpload",
      operation: "select",
      error: { message: "database unavailable" }
    });
    await expect(attach(db, input)).rejects.toThrow(/lookup/i);
    expect(db.tables.item[0]!.modelUploadId).toBe("onshape-legacy");
    expect(db.moves).toEqual([]);
  });

  it("refuses a source ID belonging to another company", async () => {
    const db = database();
    db.tables.modelUpload.push({
      id: input.model.sourceId,
      companyId: "other-company",
      name: input.model.fileName,
      modelPath: "foreign.gltf"
    });
    await expect(attach(db, input)).rejects.toThrow();
    expect(db.tables.item[0]!.modelUploadId).toBe("onshape-legacy");
    expect(db.tables.modelUpload[1]!.modelPath).toBe("foreign.gltf");
  });

  it("recovers a move completed before the model row insert failed", async () => {
    const db = database();
    db.failures.push({
      table: "modelUpload",
      operation: "insert",
      error: { code: "08006", message: "connection lost" }
    });
    await expect(attach(db, input)).rejects.toThrow(/insert/);
    expect(db.tables.item[0]!.modelUploadId).toBe("onshape-legacy");
    const moved = db.objects.get(
      "temp-staging/company/models/onshape-part-v2.step"
    );
    expect(moved).toBeDefined();
    // The step's retry: the staged object is already gone, the final one stays.
    await attachOnshapeAssetsToItem(db.client, input);
    expect(
      db.objects.get("temp-staging/company/models/onshape-part-v2.step")
    ).toBe(moved);
    expect(db.tables.modelUpload).toHaveLength(2);
    expect(db.tables.item[0]!.modelUploadId).toBe(input.model.sourceId);
  });

  it("refuses to attach a model whose staged export is missing", async () => {
    const db = database();
    await expect(attachOnshapeAssetsToItem(db.client, input)).rejects.toThrow(
      /move/
    );
    expect(db.tables.modelUpload).toHaveLength(1);
    expect(db.tables.item[0]!.modelUploadId).toBe("onshape-legacy");
  });

  it("uses a separate model for a changed source and retains manual image overrides", async () => {
    const db = database();
    db.tables.item[0]!.thumbnailPath = "company/thumbnails/item/manual.png";
    await attach(db, input);
    const firstSource = structuredClone(db.tables.modelUpload[1]);
    const result = await attach(db, {
      ...input,
      model: { ...input.model, sourceId: "onshape-another-part" }
    });
    expect(result.modelUploadId).toBe("onshape-another-part");
    expect(db.tables.modelUpload).toHaveLength(3);
    expect(db.tables.modelUpload[1]).toEqual(firstSource);
    expect(db.tables.item[0]!.thumbnailPath).toBe(
      "company/thumbnails/item/manual.png"
    );
    expect(db.copies).toEqual([]);
  });

  it("rejects an invalid or conflicting immutable identity", async () => {
    const db = database();
    await expect(
      attach(db, {
        ...input,
        model: { ...input.model, sourceId: "../unsafe" }
      })
    ).rejects.toThrow(/invalid/);
    db.tables.modelUpload.push({
      id: input.model.sourceId,
      companyId: "company",
      name: "wrong-model.gltf",
      modelPath: "wrong.gltf"
    });
    await expect(attach(db, input)).rejects.toThrow(/identity/);
    expect(db.moves).toEqual([]);
    expect(db.tables.item[0]!.modelUploadId).toBe("onshape-legacy");
  });

  it("names an export with no source by its bytes, and reuses it while they hold", async () => {
    const db = database();
    const { sourceId: _sourceId, ...model } = input.model;
    const prior = structuredClone(db.tables.modelUpload[0]);
    const first = await attach(db, {
      ...input,
      model
    });
    expect(first.modelUploadId).toMatch(/^onshape-[0-9a-f]{64}$/);
    expect(db.tables.modelUpload[0]).toEqual(prior);
    expect(db.tables.modelUpload[1]).toMatchObject({
      id: first.modelUploadId,
      modelPath: `company/models/${first.modelUploadId}.step`
    });
    expect(db.tables.item[0]!.modelUploadId).toBe(first.modelUploadId);
    expect(db.tables.document).toEqual([]);

    const again = await attach(db, {
      ...input,
      model
    });
    expect(again.modelUploadId).toBe(first.modelUploadId);
    expect(db.tables.modelUpload).toHaveLength(2);
    expect(db.moves).toHaveLength(1);
  });

  it("gives changed bytes a new model, so no file keyed by the old one is reused", async () => {
    const db = database();
    const { sourceId: _sourceId, ...model } = input.model;
    const first = await attach(db, {
      ...input,
      model
    });
    const firstRow = structuredClone(db.tables.modelUpload[1]);

    const changed = await attach(db, {
      ...input,
      model: { ...model, contentHash: "content-2" }
    });
    expect(changed.modelUploadId).not.toBe(first.modelUploadId);
    expect(db.tables.modelUpload).toHaveLength(3);
    expect(db.tables.modelUpload[1]).toEqual(firstRow);
    expect(db.tables.item[0]!.modelUploadId).toBe(changed.modelUploadId);
    // The prior Onshape generation is superseded, not kept as a document.
    expect(db.tables.document).toEqual([]);
  });

  it("does not list a source-less export's earlier in-place sync as a document", async () => {
    const db = database();
    const { sourceId: _sourceId, ...model } = input.model;
    // A row the in-place path wrote: a plain id, the export's own file name.
    withManualPriorModel(db, model.fileName);
    const result = await attach(db, {
      ...input,
      model
    });
    expect(result.preservedPriorModelAsDocument).toBe(false);
    expect(db.tables.document).toEqual([]);
    expect(db.tables.modelUpload[0]!.id).toBe("manual-model");
    expect(db.tables.item[0]!.modelUploadId).toBe(result.modelUploadId);
  });

  it("keeps every item/model read and update company-scoped", async () => {
    const db = database();
    await attach(db, input);
    for (const call of db.calls.filter(
      (call) =>
        ["item", "modelUpload"].includes(call.table) &&
        call.operation !== "insert"
    )) {
      expect(call.filters.companyId).toBe("company");
    }
  });
});
