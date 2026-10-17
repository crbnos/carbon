// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { afterEach, describe, expect, it, vi } from "vitest";
import { decideJobStep, pollAssemblerJobOnce } from "./assembler-client";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const state = (given: Partial<Parameters<typeof decideJobStep>[1]> = {}) => ({
  action: "optimize",
  now: 0,
  submittedAt: 0,
  runningSince: null,
  resubmits: 0,
  maxWaitMs: 15 * MINUTE,
  ...given
});

describe("decideJobStep", () => {
  it("returns the result of a finished job", () => {
    expect(
      decideJobStep({ status: "done", result: { a: 1 }, stats: null }, state())
    ).toEqual({ kind: "return", result: { a: 1 }, stats: null });
  });

  it("does not charge queue time to the action's budget", () => {
    // Two hours queued behind other jobs, far past the 15 minute budget.
    const queued = decideJobStep(
      { status: "queued" },
      state({ now: 2 * HOUR })
    );
    expect(queued).toEqual({ kind: "wait", runningSince: null });

    // It starts: the budget starts with it.
    const started = decideJobStep(
      { status: "running" },
      state({ now: 2 * HOUR })
    );
    expect(started).toEqual({ kind: "wait", runningSince: 2 * HOUR });
  });

  it("fails a job that runs past its budget", () => {
    expect(
      decideJobStep(
        { status: "running" },
        state({ now: 2 * HOUR + 16 * MINUTE, runningSince: 2 * HOUR })
      )
    ).toMatchObject({ kind: "fail" });
  });

  it("gives up on a job that never leaves the queue", () => {
    expect(
      decideJobStep({ status: "queued" }, state({ now: 7 * HOUR }))
    ).toMatchObject({ kind: "fail" });
  });

  it("keeps waiting while the service cannot be reached", () => {
    expect(
      decideJobStep({ status: "unreachable" }, state({ now: MINUTE }))
    ).toEqual({ kind: "wait", runningSince: null });
  });

  it("resubmits a failure a resubmit can fix, twice at most", () => {
    const upload = {
      status: "failed" as const,
      error: "upload failed",
      code: "UPLOAD_FAILED"
    };
    expect(decideJobStep(upload, state())).toMatchObject({
      kind: "resubmit"
    });
    expect(decideJobStep(upload, state({ resubmits: 2 }))).toEqual({
      kind: "fail",
      message: "upload failed"
    });
  });

  it("fails at once on a failure the input causes", () => {
    expect(
      decideJobStep(
        {
          status: "failed",
          error: "cannot fit",
          code: "cannot_fit_budget"
        },
        state()
      )
    ).toEqual({ kind: "fail", message: "cannot fit" });
  });

  it("resubmits a job the service lost, then gives up", () => {
    expect(decideJobStep({ status: "lost" }, state())).toMatchObject({
      kind: "resubmit"
    });
    expect(
      decideJobStep({ status: "lost" }, state({ resubmits: 2 }))
    ).toMatchObject({ kind: "fail" });
  });

  it("never resubmits a canceled job", () => {
    expect(decideJobStep({ status: "canceled" }, state())).toEqual({
      kind: "fail",
      message: "assembler optimize canceled"
    });
  });
});

describe("pollAssemblerJobOnce", () => {
  afterEach(() => vi.unstubAllGlobals());

  const poll = (status: number, body: unknown = {}) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status }))
    );
    return pollAssemblerJobOnce({
      jobId: "optimize-m1",
      baseUrl: "http://assembler.test",
      mintUploadUrls: async () => ({})
    });
  };

  it("waits out a service that answers 5xx mid-deploy", async () => {
    expect(await poll(502)).toEqual({ status: "unreachable" });
    expect(await poll(503)).toEqual({ status: "unreachable" });
  });

  it("reports a job the service no longer knows as lost", async () => {
    expect(await poll(404)).toEqual({ status: "lost" });
  });

  it("asks for the job without holding the request open", async () => {
    await poll(200, { ok: true, job: { status: "queued" } });
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://assembler.test/v1/jobs/optimize-m1");
  });
});
