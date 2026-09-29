import { beforeEach, describe, expect, it, vi } from "vitest";
import { attachOnshapeAssetsToItem } from "./onshape-attach";

vi.mock("node:fs", () => ({
  openAsBlob: vi.fn(async () => new Blob(["selected part geometry"]))
}));
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
          remove: async (_paths: string[]) => ({ error: null })
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
    copies,
    failures
  };
}

const input = {
  companyId: "company",
  createdBy: "user",
  itemId: "item",
  sourceDocument: "Part" as const,
  model: {
    fileName: "SADDLE.A.gltf",
    localPath: "/unused.gltf",
    size: 22,
    sourceId: "onshape-part-v2"
  }
};

beforeEach(() => vi.clearAllMocks());

describe("immutable released-part attachments", () => {
  it("replaces a bad generation while keeping item data and the prior model intact", async () => {
    const db = database();
    const prior = structuredClone(db.tables.modelUpload[0]);
    const result = await attachOnshapeAssetsToItem(db.client, input);
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
      modelPath: "company/models/onshape-part-v2.gltf",
      size: 22,
      originalSize: 22
    });
    expect(db.copies).toEqual([]);
    expect(db.tables.document).toEqual([]);
    expect(result.preservedPriorModelAsDocument).toBe(false);
  });

  it("replays without overwriting a compacted raw, optimized preview or thumbnail", async () => {
    const db = database();
    await attachOnshapeAssetsToItem(db.client, input);
    const current = db.tables.modelUpload.find(
      (row) => row.id === input.model.sourceId
    )!;
    Object.assign(current, {
      modelPath: "company/models/onshape-part-v2.gltf.zst",
      optimizeStatus: "Success",
      optimizedModelPath: "new.glb",
      thumbnailPath: "new.png"
    });
    const snapshot = structuredClone(current);
    const uploadCount = db.uploads.length;
    await attachOnshapeAssetsToItem(db.client, input);
    expect(db.tables.modelUpload).toHaveLength(2);
    expect(current).toEqual(snapshot);
    expect(db.uploads).toHaveLength(uploadCount);
  });

  it("recovers a failed item link using the already-created source model", async () => {
    const db = database();
    db.failures.push({
      table: "item",
      operation: "update",
      error: { message: "link unavailable" }
    });
    await expect(attachOnshapeAssetsToItem(db.client, input)).rejects.toThrow(
      /link/i
    );
    const result = await attachOnshapeAssetsToItem(db.client, input);
    expect(result.modelUploadId).toBe(input.model.sourceId);
    expect(db.tables.modelUpload).toHaveLength(2);
    expect(db.uploads).toHaveLength(1);
  });

  it("allows concurrent redeliveries without duplicate model rows or overwriting bytes", async () => {
    const db = database();
    const results = await Promise.all([
      attachOnshapeAssetsToItem(db.client, input),
      attachOnshapeAssetsToItem(db.client, input)
    ]);
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
    const result = await attachOnshapeAssetsToItem(db.client, input);
    expect(result.preservedPriorModelAsDocument).toBe(true);
    expect(db.copies).toEqual(["company/parts/item/manual-prototype.glb"]);
    expect(db.tables.document).toHaveLength(1);
  });

  it("preserves a manual model sharing the released export's filename", async () => {
    const db = database();
    // Same filename as the incoming release — filename is not provenance, so the
    // manual model must still be preserved rather than silently relinked away.
    withManualPriorModel(db, input.model.fileName);
    const result = await attachOnshapeAssetsToItem(db.client, input);
    expect(result.modelUploadId).toBe(input.model.sourceId);
    expect(result.preservedPriorModelAsDocument).toBe(true);
    expect(db.copies).toEqual(["company/parts/item/SADDLE.A.gltf"]);
    expect(db.tables.document).toHaveLength(1);
  });

  it("checks lookup failures instead of treating them as absent prior models", async () => {
    const db = database();
    db.failures.push({
      table: "modelUpload",
      operation: "select",
      error: { message: "database unavailable" }
    });
    await expect(attachOnshapeAssetsToItem(db.client, input)).rejects.toThrow(
      /lookup/i
    );
    expect(db.tables.item[0]!.modelUploadId).toBe("onshape-legacy");
    expect(db.uploads).toEqual([]);
  });

  it("refuses a source ID belonging to another company", async () => {
    const db = database();
    db.tables.modelUpload.push({
      id: input.model.sourceId,
      companyId: "other-company",
      name: input.model.fileName,
      modelPath: "foreign.gltf"
    });
    await expect(attachOnshapeAssetsToItem(db.client, input)).rejects.toThrow();
    expect(db.tables.item[0]!.modelUploadId).toBe("onshape-legacy");
    expect(db.tables.modelUpload[1]!.modelPath).toBe("foreign.gltf");
  });

  it("recovers an upload completed before the model row insert failed", async () => {
    const db = database();
    db.failures.push({
      table: "modelUpload",
      operation: "insert",
      error: { code: "08006", message: "connection lost" }
    });
    await expect(attachOnshapeAssetsToItem(db.client, input)).rejects.toThrow(
      /insert/
    );
    expect(db.tables.item[0]!.modelUploadId).toBe("onshape-legacy");
    const uploaded = db.objects.get(
      "temp-staging/company/models/onshape-part-v2.gltf"
    );
    await attachOnshapeAssetsToItem(db.client, input);
    expect(
      db.objects.get("temp-staging/company/models/onshape-part-v2.gltf")
    ).toBe(uploaded);
    expect(db.tables.modelUpload).toHaveLength(2);
  });

  it("uses a separate model for a changed source and retains manual image overrides", async () => {
    const db = database();
    db.tables.item[0]!.thumbnailPath = "company/thumbnails/item/manual.png";
    await attachOnshapeAssetsToItem(db.client, input);
    const firstSource = structuredClone(db.tables.modelUpload[1]);
    const result = await attachOnshapeAssetsToItem(db.client, {
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
      attachOnshapeAssetsToItem(db.client, {
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
    await expect(attachOnshapeAssetsToItem(db.client, input)).rejects.toThrow(
      /identity/
    );
    expect(db.uploads).toEqual([]);
    expect(db.tables.item[0]!.modelUploadId).toBe("onshape-legacy");
  });

  it("retains the existing no-source-ID attachment behavior", async () => {
    const db = database();
    const { sourceId: _sourceId, ...model } = input.model;
    const result = await attachOnshapeAssetsToItem(db.client, {
      ...input,
      model
    });
    expect(result.modelUploadId).toBe("onshape-legacy");
    expect(db.tables.modelUpload).toHaveLength(1);
    expect(db.uploads).toEqual([
      "temp-staging/company/models/onshape-legacy.gltf"
    ]);
  });

  it("keeps every item/model read and update company-scoped", async () => {
    const db = database();
    await attachOnshapeAssetsToItem(db.client, input);
    for (const call of db.calls.filter(
      (call) =>
        ["item", "modelUpload"].includes(call.table) &&
        call.operation !== "insert"
    )) {
      expect(call.filters.companyId).toBe("company");
    }
  });
});
