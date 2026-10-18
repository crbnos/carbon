// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWithAssembler } from "./onshape-fetch";

const mocks = vi.hoisted(() => ({
  runAssemblerJob: vi.fn(),
  externalDataDownload: vi.fn()
}));
vi.mock("@carbon/ee/onshape", () => ({
  getOnshapeClient: vi.fn(async () => ({
    client: { externalDataDownload: mocks.externalDataDownload }
  }))
}));
vi.mock("@carbon/utils", () => ({
  getFileSizeLimit: () => ({ bytes: 100000 })
}));
vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: vi.fn()
}));
vi.mock("../../client", () => ({
  inngest: { createFunction: (...args: unknown[]) => args }
}));
vi.mock("../tasks/assembler-client", () => {
  class AssemblerJobError extends Error {
    constructor(
      message: string,
      readonly code?: string
    ) {
      super(message);
    }
  }
  return {
    ASSEMBLER_CONCURRENCY: [],
    AssemblerJobError,
    runAssemblerJob: mocks.runAssemblerJob,
    signUploadUrls: vi.fn(async () => ({ raw: "https://storage.test/put" }))
  };
});

const step = { run: vi.fn(), waitForEvent: vi.fn() };
const carbon = {
  storage: { from: () => ({}) }
} as unknown as Parameters<typeof fetchWithAssembler>[1];
const input = {
  companyId: "company",
  userId: "user",
  translationId: "model-t",
  documentId: "export-document",
  foreignId: "file-1",
  stagedPath: "company/models/onshape-fetch-model-t.step"
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.externalDataDownload.mockReturnValue({
    url: "https://cad.onshape.test/api/v10/documents/d/export-document/externaldata/file-1",
    authorization: "Bearer onshape-token"
  });
  mocks.runAssemblerJob.mockResolvedValue({
    result: { contentHash: "xxh3-hash", outputs: { raw: { bytes: 13 } } },
    stats: {}
  });
});

describe("assembler fetch of an Onshape export", () => {
  it("sends Onshape's download and bearer, capped at the upload limit", async () => {
    expect(await fetchWithAssembler(step, carbon, input)).toEqual({
      stagedPath: input.stagedPath,
      size: 13,
      contentHash: "xxh3-hash"
    });
    const spec = mocks.runAssemblerJob.mock.calls[0]![1];
    expect(spec).toMatchObject({
      action: "fetch",
      jobId: "onshape-fetch-model-t"
    });
    expect(await spec.buildBody()).toEqual({
      source: {
        url: expect.stringContaining("/externaldata/file-1"),
        authorization: "Bearer onshape-token"
      },
      maxBytes: 100000,
      output: { path: input.stagedPath, contentType: "application/step" }
    });
  });

  it("returns tooLarge for an export past the limit, and rethrows anything else", async () => {
    const { AssemblerJobError } = await import("../tasks/assembler-client");
    mocks.runAssemblerJob.mockRejectedValueOnce(
      new AssemblerJobError("too large", "LIMIT_EXCEEDED")
    );
    expect(await fetchWithAssembler(step, carbon, input)).toEqual({
      tooLarge: true
    });

    mocks.runAssemblerJob.mockRejectedValueOnce(
      new AssemblerJobError("source unreadable", "READ_FAILED")
    );
    await expect(fetchWithAssembler(step, carbon, input)).rejects.toThrow(
      "source unreadable"
    );
  });
});
