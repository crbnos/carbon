import { writeFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncOnshapeElementInput } from "./onshape-sync-element";
import { syncOnshapeElementAssetsToItem } from "./onshape-sync-element";

const mocks = vi.hoisted(() => ({
  client: {
    createPartStudioTranslation: vi.fn(),
    createAssemblyTranslation: vi.fn(),
    getTranslation: vi.fn(),
    downloadExternalDataToFile: vi.fn(),
    getElementThumbnail: vi.fn()
  },
  attach: vi.fn(),
  thumbnail: vi.fn()
}));
vi.mock("@carbon/ee/onshape", () => ({
  getOnshapeClient: vi.fn(async () => ({ client: mocks.client }))
}));
vi.mock("@carbon/utils", () => ({
  getFileSizeLimit: () => ({ bytes: 100000 })
}));
vi.mock("./onshape-attach", () => ({
  attachOnshapeAssetsToItem: mocks.attach,
  attachModelThumbnail: mocks.thumbnail
}));

const input = {
  companyId: "company",
  userId: "user",
  itemId: "saddle-item",
  sourceDocument: "Part",
  documentId: "released-document",
  versionId: "released-version",
  modelElementId: "multi-part-studio",
  modelElementKind: "partstudio",
  partId: "saddle-only",
  configuration: "Size=Large;Finish=Matte",
  assetBaseName: "SADDLE.A"
} as const;
const carbon = {} as Parameters<typeof syncOnshapeElementAssetsToItem>[0];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.client.createPartStudioTranslation.mockResolvedValue({
    id: "translation"
  });
  mocks.client.createAssemblyTranslation.mockResolvedValue({
    id: "translation"
  });
  mocks.client.getTranslation.mockResolvedValue({
    id: "translation",
    requestState: "DONE",
    resultDocumentId: "export-document",
    resultExternalDataIds: ["file"]
  });
  mocks.client.downloadExternalDataToFile.mockImplementation(
    async (_document, _file, path) => writeFile(path, "selected geometry")
  );
  mocks.client.getElementThumbnail.mockResolvedValue(new ArrayBuffer(1));
  mocks.attach.mockResolvedValue({
    modelUploadId: "new-model",
    documentIds: []
  });
});

describe("released model exports", () => {
  it("exports only the released part in its released configuration", async () => {
    await syncOnshapeElementAssetsToItem(carbon, input);
    expect(mocks.client.createPartStudioTranslation).toHaveBeenCalledWith(
      input.documentId,
      input.versionId,
      input.modelElementId,
      expect.objectContaining({
        partIds: "saddle-only",
        configuration: input.configuration
      })
    );
    expect(mocks.client.createAssemblyTranslation).not.toHaveBeenCalled();
  });

  it("never attaches a whole-studio thumbnail to a part", async () => {
    const result = await syncOnshapeElementAssetsToItem(carbon, input);
    expect(mocks.client.getElementThumbnail).not.toHaveBeenCalled();
    expect(mocks.thumbnail).not.toHaveBeenCalled();
    expect(result.thumbnailAttached).toBe(false);
  });

  it.each([
    undefined,
    null,
    "",
    " ",
    "part-one,part-two"
  ])("refuses unsafe individual-part selection %s before any export or attach", async (partId) => {
    const invalid = { ...input, partId } as unknown as SyncOnshapeElementInput;
    await expect(
      syncOnshapeElementAssetsToItem(carbon, invalid)
    ).rejects.toThrow(/part/i);
    expect(mocks.client.createPartStudioTranslation).not.toHaveBeenCalled();
    expect(mocks.attach).not.toHaveBeenCalled();
  });

  it("keeps whole-assembly exports and forwards their configuration", async () => {
    const assembly = {
      ...input,
      modelElementKind: "assembly" as const,
      partId: undefined
    };
    const result = await syncOnshapeElementAssetsToItem(carbon, assembly);
    expect(mocks.client.createAssemblyTranslation).toHaveBeenCalledWith(
      input.documentId,
      input.versionId,
      input.modelElementId,
      expect.objectContaining({ configuration: input.configuration })
    );
    expect(mocks.client.createPartStudioTranslation).not.toHaveBeenCalled();
    // The element thumbnail cannot select a non-default assembly configuration.
    expect(mocks.client.getElementThumbnail).not.toHaveBeenCalled();
    expect(result.thumbnailAttached).toBe(false);
  });

  it("retains the inexpensive element thumbnail for an unconfigured assembly", async () => {
    const result = await syncOnshapeElementAssetsToItem(carbon, {
      ...input,
      modelElementKind: "assembly",
      partId: undefined,
      configuration: undefined
    });
    expect(mocks.client.getElementThumbnail).toHaveBeenCalledOnce();
    expect(result.thumbnailAttached).toBe(true);
  });

  it("gives exact-source replays a stable generation, distinct from another part/configuration", async () => {
    for (const variation of [
      input,
      input,
      { ...input, partId: "other-part" },
      { ...input, configuration: "Size=Small" }
    ]) {
      await syncOnshapeElementAssetsToItem(carbon, variation);
    }
    const ids = mocks.attach.mock.calls.map(([, args]) => args.model.sourceId);
    expect(ids[0]).toEqual(expect.any(String));
    expect(ids[0]).toBe(ids[1]);
    expect(new Set(ids).size).toBe(3);
  });
});
