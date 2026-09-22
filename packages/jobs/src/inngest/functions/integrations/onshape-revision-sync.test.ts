import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  matchOnshapeBackfillPage,
  syncOnshapeBackfillWorkItem
} from "./onshape-backfill";
import {
  type OnshapeRevisionSyncInput,
  runOnshapeRevisionSync
} from "./onshape-revision-sync";

const mocks = vi.hoisted(() => ({
  getRevisions: vi.fn(),
  getCompanyRevisions: vi.fn(),
  sync: vi.fn(),
  drawing: vi.fn()
}));
vi.mock("@carbon/ee/onshape", () => ({
  getOnshapeClient: vi.fn(async () => ({ client: mocks })),
  OnshapeAssetTooLargeError: class extends Error {},
  OnshapeApiError: class extends Error {}
}));
vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: vi.fn()
}));
vi.mock("../../client", () => ({
  inngest: { createFunction: (...args: unknown[]) => args }
}));
vi.mock("./onshape-sync-element", () => ({
  syncOnshapeElementAssetsToItem: mocks.sync,
  syncOnshapeDrawingAssetsToItem: mocks.drawing
}));

const input: OnshapeRevisionSyncInput = {
  companyId: "carbon-company",
  onshapeCompanyId: "onshape-company",
  userId: "user",
  partNumber: "SADDLE",
  documentId: "document",
  versionId: "version",
  elementId: "studio",
  elementType: 0,
  revisionId: "revision-id"
};
const released = {
  id: "revision-id",
  partNumber: "SADDLE",
  revision: "A",
  documentId: "document",
  versionId: "version",
  elementId: "studio",
  elementType: 0,
  partId: "saddle-part",
  configuration: "Size=Large",
  isObsolete: false
};

function database(
  items = [
    {
      id: "existing-item",
      readableIdWithRevision: "SADDLE.A",
      modelUploadId: null as string | null
    }
  ]
) {
  const filters: [string, unknown][] = [];
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn((key: string, value: unknown) => {
      filters.push([key, value]);
      return query;
    }),
    in: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => ({ error: null, data: items[0] ?? null })),
    then: (resolve: (value: unknown) => unknown) =>
      resolve({ error: null, data: items })
  };
  return {
    client: { from: vi.fn(() => query) } as unknown as Parameters<
      typeof runOnshapeRevisionSync
    >[0],
    filters
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRevisions.mockResolvedValue({ items: [released] });
  mocks.getCompanyRevisions.mockResolvedValue({ items: [released] });
  mocks.sync.mockResolvedValue({
    modelUploadId: "selected-model",
    thumbnailAttached: false
  });
});

describe("release identity", () => {
  it("passes the exact released part/configuration to the existing item", async () => {
    const db = database();
    expect(await runOnshapeRevisionSync(db.client, input)).toMatchObject({
      synced: true,
      itemId: "existing-item"
    });
    expect(mocks.sync).toHaveBeenCalledWith(
      db.client,
      expect.objectContaining({
        itemId: "existing-item",
        documentId: "document",
        versionId: "version",
        modelElementId: "studio",
        partId: "saddle-part",
        configuration: "Size=Large"
      })
    );
    expect(db.filters).toContainEqual(["companyId", "carbon-company"]);
    expect(db.filters).toContainEqual(["readableIdWithRevision", "SADDLE.A"]);
    expect(db.filters).toContainEqual(["type", "Part"]);
  });

  it.each([
    { documentId: "wrong-document" },
    { elementId: "wrong-element" },
    { id: "wrong-revision-id" },
    { partNumber: "wrong-number" },
    { elementType: 1 },
    { isObsolete: true }
  ])("refuses a version-only fallback when identity differs: %j", async (mismatch) => {
    mocks.getRevisions.mockResolvedValue({
      items: [{ ...released, ...mismatch }]
    });
    expect(
      await runOnshapeRevisionSync(database().client, input)
    ).toMatchObject({
      synced: false,
      skippedReason: "revision-not-found"
    });
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("refuses ambiguous revisions when the event has no revisionId", async () => {
    mocks.getRevisions.mockResolvedValue({
      items: [released, { ...released, id: "other", partId: "other-part" }]
    });
    expect(
      await runOnshapeRevisionSync(database().client, {
        ...input,
        revisionId: undefined
      })
    ).toMatchObject({
      synced: false,
      skippedReason: "ambiguous-revision"
    });
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("does not silently match an imported blank-revision item to revision A", async () => {
    const db = database([]);
    const result = await runOnshapeRevisionSync(db.client, input);
    expect(result).toMatchObject({
      synced: false,
      skippedReason: "no-matching-item",
      releaseKey: "SADDLE.A"
    });
    expect(db.filters).toContainEqual(["readableIdWithRevision", "SADDLE.A"]);
    expect(mocks.sync).not.toHaveBeenCalled();
  });
});

describe("backfill identity", () => {
  it("refuses ambiguous Carbon display keys instead of picking the last row", async () => {
    const page = await matchOnshapeBackfillPage(
      database([
        {
          id: "item-one",
          readableIdWithRevision: "SADDLE.A",
          modelUploadId: null
        },
        {
          id: "item-two",
          readableIdWithRevision: "SADDLE.A",
          modelUploadId: null
        }
      ]).client,
      {
        companyId: input.companyId,
        userId: input.userId,
        onshapeCompanyId: "onshape-company"
      },
      null
    );
    expect(page.workItems).toEqual([]);
    expect(page.skippedNoItem).toBe(1);
  });
  it("retains selected part and configuration through page matching and export", async () => {
    const db = database();
    const page = await matchOnshapeBackfillPage(
      db.client,
      {
        companyId: input.companyId,
        userId: input.userId,
        onshapeCompanyId: "onshape-company"
      },
      null
    );
    expect(page.workItems).toHaveLength(1);
    expect(page.workItems[0]).toMatchObject({
      partId: "saddle-part",
      configuration: "Size=Large"
    });
    await syncOnshapeBackfillWorkItem(db.client, input, page.workItems[0]!);
    expect(mocks.sync).toHaveBeenCalledWith(
      db.client,
      expect.objectContaining({
        partId: "saddle-part",
        configuration: "Size=Large"
      })
    );
  });

  it("does not use a full backfill to replace existing models", async () => {
    const page = await matchOnshapeBackfillPage(
      database([
        {
          id: "existing-item",
          readableIdWithRevision: "SADDLE.A",
          modelUploadId: "old-model"
        }
      ]).client,
      {
        companyId: input.companyId,
        userId: input.userId,
        onshapeCompanyId: "onshape-company"
      },
      null
    );
    expect(page.workItems).toEqual([]);
    expect(page.skippedAlreadySynced).toBe(1);
  });
});
