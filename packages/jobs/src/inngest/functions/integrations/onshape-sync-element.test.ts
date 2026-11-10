// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { OnshapeClient } from "@carbon/ee/onshape";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assemblySourceKeyAt,
  assertSelection,
  type ElementSyncStep,
  finishedTranslation,
  modelTranslationRequest,
  partSourceId,
  reusableModelUploadId,
  type SyncOnshapeElementInput,
  translationEventCondition,
  waitForTranslations
} from "./onshape-sync-element";

// Import stubs: both packages open Redis or Supabase clients at import.
vi.mock("@carbon/auth/client.server", () => ({}));
vi.mock("@carbon/ee/onshape", () => ({
  getOnshapeClient: vi.fn(),
  OnshapeApiError: class extends Error {},
  OnshapeAssetTooLargeError: class extends Error {}
}));

function base(
  overrides: Partial<SyncOnshapeElementInput> = {}
): SyncOnshapeElementInput {
  return {
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
    ...overrides
  };
}

describe("assertSelection", () => {
  it.each([undefined, null, "", " ", "part-one,part-two", "part one"])(
    "refuses a part studio export without exactly one part (%s)",
    (partId) => {
      // A missing selection used to export the whole studio.
      expect(() => assertSelection(base({ partId }))).toThrow(/one partId/);
    }
  );

  it("accepts one part, or a whole assembly with no part", () => {
    expect(() => assertSelection(base())).not.toThrow();
    expect(() =>
      assertSelection(base({ modelElementKind: "assembly", partId: undefined }))
    ).not.toThrow();
  });

  it("refuses a configuration that is not a string", () => {
    const input = base({ configuration: 7 as unknown as string });
    expect(() => assertSelection(input)).toThrow(/configuration/);
  });
});

describe("modelTranslationRequest", () => {
  it("exports one part, in its configuration, as STEP", () => {
    expect(modelTranslationRequest(base())).toEqual({
      kind: "partstudio",
      options: {
        formatName: "STEP",
        storeInDocument: false,
        configuration: "Size=Large;Finish=Matte",
        wvm: "v",
        partIds: "saddle-only"
      }
    });
  });

  it("exports a whole assembly from a workspace with no part selection", () => {
    expect(
      modelTranslationRequest(
        base({
          modelElementKind: "assembly",
          partId: undefined,
          configuration: null,
          sourceWvm: "w"
        })
      )
    ).toEqual({
      kind: "assembly",
      options: {
        formatName: "STEP",
        storeInDocument: false,
        configuration: undefined,
        wvm: "w"
      }
    });
  });
});

describe("partSourceId", () => {
  it("names a replay of the same released part the same, and another part or configuration differently", () => {
    const ids = [
      base(),
      base(),
      base({ partId: "other-part" }),
      base({ configuration: "Size=Small" })
    ].map(partSourceId);
    expect(ids[0]).toMatch(/^onshape-[0-9a-f]{40}$/);
    expect(ids[1]).toBe(ids[0]);
    expect(new Set(ids).size).toBe(3);
  });

  it("names a workspace part by its microversion", () => {
    const workspace = { sourceWvm: "w" as const, versionId: "ws-1" };
    const v1 = partSourceId(
      base({ ...workspace, sourceMicroversionId: "mv-1" })
    );
    expect(
      partSourceId(base({ ...workspace, sourceMicroversionId: "mv-1" }))
    ).toBe(v1);
    expect(
      partSourceId(base({ ...workspace, sourceMicroversionId: "mv-2" }))
    ).not.toBe(v1);
  });

  it.each([
    ["an assembly", { modelElementKind: "assembly", partId: undefined }],
    ["a workspace part with no microversion", { sourceWvm: "w" }]
  ] as const)("gives %s no fixed name", (_case, overrides) => {
    expect(partSourceId(base(overrides))).toBeNull();
  });
});

describe("assemblySourceKeyAt", () => {
  const assembly = base({ modelElementKind: "assembly", partId: undefined });

  it("changes with the document state and the configuration, not otherwise", () => {
    const key = assemblySourceKeyAt(assembly, "microversion-1");
    expect(assemblySourceKeyAt(assembly, "microversion-1")).toBe(key);
    expect(assemblySourceKeyAt(assembly, "microversion-2")).not.toBe(key);
    expect(
      assemblySourceKeyAt(
        { ...assembly, configuration: "Size=Small" },
        "microversion-1"
      )
    ).not.toBe(key);
  });
});

describe("reusableModelUploadId", () => {
  const recorded = {
    externalId: "source-1",
    metadata: { modelUploadId: "model-1" }
  };

  it("reuses the model when the source is unchanged and the item still uses it", () => {
    expect(reusableModelUploadId(recorded, "model-1", "source-1")).toBe(
      "model-1"
    );
  });

  it.each([
    ["the document changed", recorded, "model-1", "source-2"],
    ["the item's model was replaced", recorded, "uploaded-by-hand", "source-1"],
    ["nothing was recorded", null, "model-1", "source-1"],
    [
      "the record has no model",
      { externalId: "source-1", metadata: {} },
      "model-1",
      "source-1"
    ]
  ] as const)("exports again when %s", (_case, mapping, itemModel, source) => {
    expect(reusableModelUploadId(mapping, itemModel, source)).toBeNull();
  });
});

describe("finishedTranslation", () => {
  const done = {
    id: "t1",
    requestState: "DONE",
    resultDocumentId: "export-document",
    resultExternalDataIds: ["file-1", "file-2"],
    name: "SADDLE"
  };

  it("reads where a finished export downloads from", () => {
    expect(finishedTranslation(done)).toEqual({
      id: "t1",
      documentId: "export-document",
      foreignId: "file-1",
      name: "SADDLE"
    });
  });

  it("is still waiting on an active translation", () => {
    expect(
      finishedTranslation({ id: "t1", requestState: "ACTIVE" })
    ).toBeNull();
  });

  it.each([
    ["it failed", { id: "t1", requestState: "FAILED" }],
    ["it is done with no result", { ...done, resultExternalDataIds: [] }]
  ])("fails the sync when %s", (_case, translation) => {
    expect(() => finishedTranslation(translation)).toThrow(/t1/);
  });
});

describe("translationEventCondition", () => {
  it("matches only this company's translations", () => {
    expect(translationEventCondition({ companyId: "co" }, ["t1", "t2"])).toBe(
      'async.data.companyId == "co" && (async.data.translationId == "t1" || async.data.translationId == "t2")'
    );
  });

  it("refuses to interpolate an id that is not plain alphanumeric", () => {
    expect(translationEventCondition({ companyId: "co" }, ['t" || true'])).toBe(
      null
    );
  });
});

describe("waitForTranslations", () => {
  // Onshape, as far as the wait sees it: each translation finishes after a
  // number of polls, and transient webhooks come and go.
  function onshape(pollsUntilDone: Record<string, number>, webhooks = true) {
    const polls: Record<string, number> = {};
    const state = { polls, created: [] as unknown[], deleted: [] as string[] };
    const client = {
      getTranslation: async (id: string) => {
        polls[id] = (polls[id] ?? 0) + 1;
        return polls[id]! >= (pollsUntilDone[id] ?? Number.POSITIVE_INFINITY)
          ? {
              id,
              requestState: "DONE",
              resultDocumentId: "export-document",
              resultExternalDataIds: [`file-${id}`]
            }
          : { id, requestState: "ACTIVE" };
      },
      createWebhook: async (body: unknown) => {
        if (!webhooks) throw new Error("callback unreachable");
        state.created.push(body);
        return { id: "webhook-1" };
      },
      deleteWebhook: async (id: string) => {
        state.deleted.push(id);
      }
    } as unknown as OnshapeClient;
    return { client, state };
  }

  // Inngest, as far as the wait sees it: step ids are durable (a retry resumes
  // by them), and every wait moves the clock on.
  function inngest() {
    const log: string[] = [];
    const step: Pick<ElementSyncStep, "run" | "sleep" | "waitForEvent"> = {
      run: async (id, fn) => {
        log.push(id);
        return fn();
      },
      sleep: async (id, ms) => {
        log.push(`${id} ${ms}`);
        vi.setSystemTime(Date.now() + ms);
      },
      waitForEvent: async (id, opts) => {
        log.push(`${id} ${opts.event} ${opts.timeout}`);
        vi.setSystemTime(Date.now() + opts.timeout);
        return null;
      }
    };
    return { step, log };
  }

  const input = { companyId: "company", documentId: "released-document" };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(0);
  });
  afterEach(() => vi.useRealTimers());

  it("backs off between quick polls and stops polling what has finished", async () => {
    const { client, state } = onshape({ model: 3, drawing: 1 });
    const { step, log } = inngest();

    const finished = await waitForTranslations(
      step,
      async () => client,
      input,
      "SADDLE",
      "el",
      ["model", "drawing"]
    );

    expect(Object.keys(finished).sort()).toEqual(["drawing", "model"]);
    expect(log).toEqual([
      "el-poll-0",
      "el-sleep-0 2000",
      "el-poll-1",
      "el-sleep-1 3000",
      "el-poll-2"
    ]);
    expect(state.polls).toEqual({ model: 3, drawing: 1 });
  });

  it("waits on a transient webhook once the six quick polls are spent, then removes it", async () => {
    const { client, state } = onshape({ model: 8 });
    const { step, log } = inngest();

    await waitForTranslations(step, async () => client, input, "SADDLE", "el", [
      "model"
    ]);

    expect(log).toEqual([
      "el-poll-0",
      "el-sleep-0 2000",
      "el-poll-1",
      "el-sleep-1 3000",
      "el-poll-2",
      "el-sleep-2 4500",
      "el-poll-3",
      "el-sleep-3 6750",
      "el-poll-4",
      "el-sleep-4 10125",
      "el-poll-5",
      "el-webhook",
      // One more poll: the export may have finished before the webhook existed.
      "el-poll-6",
      "el-wait-6 carbon/onshape-translation-complete 300000",
      "el-poll-7",
      "el-unwebhook"
    ]);
    expect(state.created).toEqual([
      {
        url: expect.stringMatching(/\/api\/webhook\/onshape\/company$/),
        events: ["onshape.model.translation.complete"],
        documentId: "released-document",
        isTransient: true
      }
    ]);
    expect(state.deleted).toEqual(["webhook-1"]);
  });

  it("keeps polling, capped at 30 s, when no webhook can be registered", async () => {
    const { client, state } = onshape({ model: 9 }, false);
    const { step, log } = inngest();

    await waitForTranslations(step, async () => client, input, "SADDLE", "el", [
      "model"
    ]);

    expect(log.filter((entry) => entry.includes("-sleep-"))).toEqual([
      "el-sleep-0 2000",
      "el-sleep-1 3000",
      "el-sleep-2 4500",
      "el-sleep-3 6750",
      "el-sleep-4 10125",
      "el-sleep-5 15187.5",
      "el-sleep-6 22781.25",
      "el-sleep-7 30000"
    ]);
    expect(log).not.toContain("el-unwebhook");
    expect(state.deleted).toEqual([]);
  });

  it("gives up after an hour and still removes its webhook", async () => {
    const { client, state } = onshape({});
    const { step } = inngest();

    await expect(
      waitForTranslations(step, async () => client, input, "SADDLE", "el", [
        "model"
      ])
    ).rejects.toThrow(/model did not finish within an hour/);
    expect(state.deleted).toEqual(["webhook-1"]);
  });
});
