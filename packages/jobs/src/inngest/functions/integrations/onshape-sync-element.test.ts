// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { writeFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncOnshapeElementInput } from "./onshape-sync-element";
import {
  runOnshapeDrawingSync,
  runOnshapeElementSync,
  translationEventCondition
} from "./onshape-sync-element";

const mocks = vi.hoisted(() => ({
  client: {
    createPartStudioTranslation: vi.fn(),
    createAssemblyTranslation: vi.fn(),
    createDrawingTranslation: vi.fn(),
    getTranslation: vi.fn(),
    downloadExternalData: vi.fn(),
    downloadExternalDataToFile: vi.fn(),
    externalDataDownload: vi.fn(),
    getCurrentMicroversion: vi.fn(),
    createWebhook: vi.fn(),
    deleteWebhook: vi.fn()
  },
  attach: vi.fn(),
  assemblerEnabled: vi.fn(),
  invoke: vi.fn(),
  existingModel: null as { id: string; name: string } | null,
  modelSource: null as {
    externalId: string;
    metadata: { modelUploadId: string };
  } | null,
  itemModelUploadId: null as string | null,
  upserts: [] as Record<string, unknown>[]
}));
vi.mock("@carbon/ee/onshape", () => ({
  getOnshapeClient: vi.fn(async () => ({ client: mocks.client })),
  OnshapeAssetTooLargeError: class extends Error {}
}));
vi.mock("@carbon/utils", () => ({
  getFileSizeLimit: () => ({ bytes: 100000 }),
  datetime: { timestamp: () => "2026-10-20T00:00:00Z" }
}));
vi.mock("@carbon/env", () => ({ getAppUrl: () => "https://app.carbon.test" }));
vi.mock("./onshape-attach", () => ({
  attachOnshapeAssetsToItem: mocks.attach
}));
vi.mock("../tasks/assembler-client", () => ({
  assemblerEnabled: mocks.assemblerEnabled
}));
vi.mock("./onshape-fetch", () => ({
  onshapeFetchFunction: { id: "onshape-fetch" },
  RAW_MODEL_MAX_BYTES: 100000
}));

// Runs each step at once, in order: the pipeline's logic, not Inngest's.
const step = {
  run: async (_id: string, fn: () => unknown) => fn(),
  sleep: vi.fn(async () => undefined),
  waitForEvent: vi.fn(async () => null),
  invoke: mocks.invoke
};

const carbon = {
  from: (table: string) => {
    const row = () =>
      table === "externalIntegrationMapping"
        ? mocks.modelSource
        : table === "item"
          ? { modelUploadId: mocks.itemModelUploadId }
          : mocks.existingModel;
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => ({ data: row(), error: null }),
      upsert: async (values: Record<string, unknown>) => {
        mocks.upserts.push(values);
        return { error: null };
      }
    };
    return query;
  },
  storage: {
    from: () => ({ upload: vi.fn(async () => ({ data: {}, error: null })) })
  }
} as unknown as Parameters<typeof runOnshapeElementSync>[1];

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

const sync = (args: SyncOnshapeElementInput = input) =>
  runOnshapeElementSync(step, carbon, args, "element");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.existingModel = null;
  mocks.modelSource = null;
  mocks.itemModelUploadId = null;
  mocks.upserts = [];
  mocks.client.getCurrentMicroversion.mockResolvedValue("microversion-1");
  mocks.client.createWebhook.mockResolvedValue({ id: "webhook-1" });
  mocks.assemblerEnabled.mockReturnValue(false);
  mocks.client.createPartStudioTranslation.mockResolvedValue({ id: "model-t" });
  mocks.client.createAssemblyTranslation.mockResolvedValue({ id: "model-t" });
  mocks.client.createDrawingTranslation.mockImplementation(
    async (_d: string, _v: string, elementId: string) => ({
      id: `drawing-${elementId}`
    })
  );
  mocks.client.getTranslation.mockImplementation(async (id: string) => ({
    id,
    requestState: "DONE",
    resultDocumentId: "export-document",
    resultExternalDataIds: [`file-${id}`]
  }));
  mocks.client.downloadExternalDataToFile.mockImplementation(
    async (_document: string, _file: string, path: string) =>
      writeFile(path, "ISO-10303-21;")
  );
  mocks.client.downloadExternalData.mockResolvedValue(new ArrayBuffer(4));
  mocks.client.externalDataDownload.mockReturnValue({
    url: "https://cad.onshape.test/api/v10/documents/d/export-document/externaldata/file",
    authorization: "Bearer onshape-token"
  });
  mocks.attach.mockResolvedValue({
    modelUploadId: "new-model",
    documentIds: [],
    preservedPriorModelAsDocument: false
  });
});

const attachedModel = () => mocks.attach.mock.calls.at(-1)![1].model;

describe("released model exports", () => {
  it("exports only the released part, in its configuration, as STEP", async () => {
    await sync();
    expect(mocks.client.createPartStudioTranslation).toHaveBeenCalledWith(
      input.documentId,
      input.versionId,
      input.modelElementId,
      expect.objectContaining({
        formatName: "STEP",
        partIds: "saddle-only",
        configuration: input.configuration
      })
    );
    expect(mocks.client.createAssemblyTranslation).not.toHaveBeenCalled();
    // A STEP raw is what lets an assembly instruction convert the model.
    expect(attachedModel()).toMatchObject({
      fileName: "SADDLE.A.step",
      stagedPath: "company/models/onshape-fetch-model-t.step",
      contentHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/)
    });
  });

  it.each([undefined, null, "", " ", "part-one,part-two"])(
    "refuses unsafe individual-part selection %s before any export or attach",
    async (partId) => {
      const invalid = {
        ...input,
        partId
      } as unknown as SyncOnshapeElementInput;
      await expect(sync(invalid)).rejects.toThrow(/part/i);
      expect(mocks.client.createPartStudioTranslation).not.toHaveBeenCalled();
      expect(mocks.attach).not.toHaveBeenCalled();
    }
  );

  it("keeps whole-assembly exports and forwards their configuration", async () => {
    await sync({
      ...input,
      modelElementKind: "assembly",
      partId: undefined
    });
    expect(mocks.client.createAssemblyTranslation).toHaveBeenCalledWith(
      input.documentId,
      input.versionId,
      input.modelElementId,
      expect.objectContaining({ configuration: input.configuration })
    );
    expect(mocks.client.createPartStudioTranslation).not.toHaveBeenCalled();
  });

  it("gives exact-source replays a stable generation, distinct from another part/configuration", async () => {
    for (const variation of [
      input,
      input,
      { ...input, partId: "other-part" },
      { ...input, configuration: "Size=Small" }
    ]) {
      await sync(variation);
    }
    const ids = mocks.attach.mock.calls.map(([, args]) => args.model.sourceId);
    expect(ids[0]).toEqual(expect.any(String));
    expect(ids[0]).toBe(ids[1]);
    expect(new Set(ids).size).toBe(3);
  });

  it("gives a workspace export a new generation when the part changes", async () => {
    const workspace = { ...input, sourceWvm: "w" as const, versionId: "ws-1" };
    for (const variation of [
      { ...workspace, sourceMicroversionId: "mv-1" },
      { ...workspace, sourceMicroversionId: "mv-1" },
      { ...workspace, sourceMicroversionId: "mv-2" }
    ]) {
      await sync(variation);
    }
    const ids = mocks.attach.mock.calls.map(([, args]) => args.model.sourceId);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
  });

  it("gives a workspace export with no microversion no fixed generation", async () => {
    await sync({ ...input, sourceWvm: "w", versionId: "ws-1" });
    expect(attachedModel().sourceId).toBeUndefined();
  });
});

describe("export economy", () => {
  it("skips the export entirely when this source's model already exists", async () => {
    mocks.existingModel = { id: "onshape-existing", name: "SADDLE.A.step" };
    await sync();
    expect(mocks.client.createPartStudioTranslation).not.toHaveBeenCalled();
    expect(mocks.client.downloadExternalDataToFile).not.toHaveBeenCalled();
    expect(mocks.attach.mock.calls[0]![1]).toMatchObject({
      existingModelId: "onshape-existing"
    });
  });

  it("starts the drawing translations with the model's, before waiting on any", async () => {
    await sync({ ...input, drawingElementIds: ["drw-1", "drw-2"] });
    const firstPoll = mocks.client.getTranslation.mock.invocationCallOrder[0]!;
    for (const create of [
      mocks.client.createPartStudioTranslation,
      mocks.client.createDrawingTranslation
    ]) {
      for (const order of create.mock.invocationCallOrder) {
        expect(order).toBeLessThan(firstPoll);
      }
    }
    expect(mocks.client.createDrawingTranslation).toHaveBeenCalledTimes(2);
  });

  it("sleeps between polls while a translation is still running", async () => {
    mocks.client.getTranslation
      .mockResolvedValueOnce({ id: "model-t", requestState: "ACTIVE" })
      .mockResolvedValueOnce({ id: "model-t", requestState: "ACTIVE" });
    await sync();
    expect(step.sleep).toHaveBeenCalledTimes(2);
    expect(mocks.attach).toHaveBeenCalledOnce();
  });
});

describe("unchanged assemblies", () => {
  const workspaceAssembly = {
    ...input,
    modelElementKind: "assembly",
    partId: undefined,
    sourceWvm: "w",
    versionId: "workspace"
  } as const;

  // Pushes once, then points the item at the model that push recorded.
  async function pushOnce() {
    await sync(workspaceAssembly);
    const recorded = mocks.upserts.at(-1)!;
    mocks.modelSource = {
      externalId: recorded.externalId as string,
      metadata: recorded.metadata as { modelUploadId: string }
    };
    mocks.itemModelUploadId = "new-model";
    mocks.existingModel = { id: "new-model", name: "SADDLE.A.step" };
    vi.clearAllMocks();
  }

  it("records the source an assembly's model was exported from", async () => {
    await sync(workspaceAssembly);
    expect(mocks.upserts).toEqual([
      expect.objectContaining({
        entityType: "modelSource",
        entityId: "saddle-item",
        integration: "onshape",
        metadata: { modelUploadId: "new-model" }
      })
    ]);
  });

  it("skips the export when the workspace has not changed", async () => {
    await pushOnce();
    await sync(workspaceAssembly);
    expect(mocks.client.getCurrentMicroversion).toHaveBeenCalledWith(
      "released-document",
      "workspace"
    );
    expect(mocks.client.createAssemblyTranslation).not.toHaveBeenCalled();
    expect(mocks.client.getTranslation).not.toHaveBeenCalled();
    expect(mocks.attach.mock.calls[0]![1]).toMatchObject({
      existingModelId: "new-model"
    });
  });

  it("exports again after any edit to the document", async () => {
    await pushOnce();
    mocks.client.getCurrentMicroversion.mockResolvedValue("microversion-2");
    await sync(workspaceAssembly);
    expect(mocks.client.createAssemblyTranslation).toHaveBeenCalledOnce();
  });

  it("exports again when the item's model was replaced since", async () => {
    await pushOnce();
    mocks.itemModelUploadId = "uploaded-by-hand";
    await sync(workspaceAssembly);
    expect(mocks.client.createAssemblyTranslation).toHaveBeenCalledOnce();
  });

  it("exports when the microversion cannot be read", async () => {
    await pushOnce();
    mocks.client.getCurrentMicroversion.mockRejectedValue(new Error("down"));
    await sync(workspaceAssembly);
    expect(mocks.client.createAssemblyTranslation).toHaveBeenCalledOnce();
  });
});

describe("waiting on a long translation", () => {
  const running = { id: "model-t", requestState: "ACTIVE" };

  it("waits for the translation webhook once the quick polls are spent", async () => {
    for (let i = 0; i < 7; i++) {
      mocks.client.getTranslation.mockResolvedValueOnce(running);
    }
    await sync();
    expect(step.sleep).toHaveBeenCalledTimes(5);
    expect(mocks.client.createWebhook).toHaveBeenCalledWith({
      url: "https://app.carbon.test/api/webhook/onshape/company",
      events: ["onshape.model.translation.complete"],
      documentId: "released-document",
      isTransient: true
    });
    expect(step.waitForEvent).toHaveBeenCalledOnce();
    expect(step.waitForEvent).toHaveBeenCalledWith(
      "element-wait-6",
      expect.objectContaining({
        event: "carbon/onshape-translation-complete",
        timeout: 5 * 60 * 1000
      })
    );
    expect(mocks.client.deleteWebhook).toHaveBeenCalledWith("webhook-1");
    expect(mocks.attach).toHaveBeenCalledOnce();
  });

  it("keeps polling when no webhook can be registered", async () => {
    mocks.client.createWebhook.mockRejectedValue(new Error("unreachable"));
    for (let i = 0; i < 8; i++) {
      mocks.client.getTranslation.mockResolvedValueOnce(running);
    }
    await sync();
    expect(step.waitForEvent).not.toHaveBeenCalled();
    expect(step.sleep).toHaveBeenCalledTimes(8);
    expect(mocks.client.deleteWebhook).not.toHaveBeenCalled();
  });

  it("gives up after an hour, and removes its webhook", async () => {
    mocks.client.getTranslation.mockResolvedValue(running);
    let now = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => {
      now += 10 * 60 * 1000;
      return now;
    });
    try {
      await expect(sync()).rejects.toThrow(/within an hour/);
    } finally {
      clock.mockRestore();
    }
    expect(mocks.client.deleteWebhook).toHaveBeenCalledWith("webhook-1");
    expect(mocks.attach).not.toHaveBeenCalled();
  });

  it("matches only this company's translations", () => {
    expect(translationEventCondition({ companyId: "co" }, ["t1", "t2"])).toBe(
      'async.data.companyId == "co" && (async.data.translationId == "t1" || async.data.translationId == "t2")'
    );
    expect(translationEventCondition({ companyId: "co" }, ['t" || true'])).toBe(
      null
    );
  });
});

describe("with the assembler", () => {
  beforeEach(() => {
    mocks.assemblerEnabled.mockReturnValue(true);
    mocks.invoke.mockResolvedValue({
      stagedPath: "company/models/onshape-fetch-model-t.step",
      size: 13,
      contentHash: "xxh3-hash"
    });
  });

  it("hands the fetch to its own run; nothing is downloaded here", async () => {
    await sync();
    expect(mocks.client.downloadExternalDataToFile).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledWith("element-fetch", {
      function: { id: "onshape-fetch" },
      data: expect.objectContaining({
        translationId: "model-t",
        documentId: "export-document",
        foreignId: "file-model-t",
        stagedPath: "company/models/onshape-fetch-model-t.step"
      })
    });
    expect(attachedModel()).toMatchObject({
      size: 13,
      contentHash: "xxh3-hash"
    });
  });

  it("skips an export the fetch found past the upload limit", async () => {
    mocks.invoke.mockResolvedValue({ tooLarge: true });
    const result = await sync();
    expect(result.tooLarge).toBe(true);
    expect(mocks.attach).not.toHaveBeenCalled();
  });
});

describe("released drawing exports", () => {
  const drawing = {
    companyId: "company",
    userId: "user",
    itemId: "saddle-item",
    sourceDocument: "Part" as const,
    documentId: "released-document",
    versionId: "released-version",
    drawingElementId: "drw-1",
    assetBaseName: "SADDLE.A"
  };

  it("translates, waits with step.sleep, then attaches the PDF", async () => {
    mocks.client.getTranslation.mockResolvedValueOnce({
      id: "drawing-drw-1",
      requestState: "ACTIVE"
    });
    await runOnshapeDrawingSync(step, carbon, drawing, "drawing");
    expect(mocks.client.createDrawingTranslation).toHaveBeenCalledOnce();
    expect(step.sleep).toHaveBeenCalledOnce();
    expect(mocks.attach.mock.calls[0]![1]).toMatchObject({
      itemId: "saddle-item",
      documents: [{ fileName: "SADDLE.A.pdf" }]
    });
  });

  it("skips a PDF past the document limit without failing", async () => {
    const { OnshapeAssetTooLargeError } = await import("@carbon/ee/onshape");
    mocks.client.downloadExternalData.mockRejectedValue(
      new OnshapeAssetTooLargeError("too large")
    );
    const result = await runOnshapeDrawingSync(
      step,
      carbon,
      drawing,
      "drawing"
    );
    expect(result.tooLarge).toBe(true);
    expect(mocks.attach).not.toHaveBeenCalled();
  });
});
