// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { verifyInternalCall } from "@carbon/api/internal-call";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { finishJobOperation } from "./operations.service";
import { fakeClient } from "./work-unit-test-fixture";

const effects = vi.hoisted(() => ({
  moment: vi.fn(),
  track: vi.fn()
}));
vi.mock("@carbon/lib/workflows", () => ({ raiseMoment: effects.moment }));
vi.mock("@carbon/lib/telemetry", () => ({ trackWorkEvent: effects.track }));
const post = vi.fn(async (_url: string, _init: RequestInit) =>
  Response.json({ data: { success: true }, error: null })
);
beforeEach(() => {
  vi.stubEnv("ERP_URL", "http://erp.test");
  vi.stubGlobal("fetch", post);
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const args = { jobOperationId: "op", companyId: "company", userId: "operator" };

it("finishes through the tenant-scoped RPC before posting closed timers and picked remainders", async () => {
  const { client, calls } = fakeClient(
    {
      productionEvent: [
        { id: "timer", jobOperationId: "op", postedToGL: false }
      ],
      job: [{ id: "job", companyId: "company", status: "Completed" }]
    },
    { finish_mes_job_operation: [{ id: "op", jobId: "job" }] }
  );
  // The Finish route supplies the service role configured in vitest.config.ts.
  Object.assign(client, { supabaseKey: "test" });
  expect((await finishJobOperation(client, args)).error).toBeNull();
  expect(calls[0]).toMatchObject({
    op: "rpc",
    table: "finish_mes_job_operation",
    values: {
      p_job_operation_id: "op",
      p_company_id: "company",
      p_user_id: "operator"
    }
  });
  await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(2));
  const postings = post.mock.calls.map(([url, init]) => {
    const name = new URL(url).pathname.split("/").at(-1)!;
    const body = String(init.body);
    expect(
      verifyInternalCall("test", name, new Headers(init.headers), body)
    ).toMatchObject({
      companyId: "company",
      userId: "operator",
      mode: "system"
    });
    return [url, JSON.parse(body)];
  });
  expect(postings).toEqual(
    expect.arrayContaining([
      [
        "http://erp.test/api/internal/postings/post-picking",
        { type: "returnOperationRemainders", ...args }
      ],
      [
        "http://erp.test/api/internal/postings/post-production-event",
        { productionEventId: "timer" }
      ]
    ])
  );
  expect(effects.moment).toHaveBeenCalledWith(
    "production.jobOperationCompleted",
    expect.objectContaining({
      actorId: "operator",
      companyId: "company"
    })
  );
  expect(effects.track.mock.calls.map(([name]) => name)).toEqual([
    "job_operation_finished",
    "job_completed"
  ]);
});

it("refuses a Finish outside the current company before running any post-commit work", async () => {
  const { client, calls } = fakeClient({}, { finish_mes_job_operation: [] });
  expect(await finishJobOperation(client, args)).toMatchObject({ status: 404 });
  expect(calls.map((call) => call.op)).toEqual(["rpc"]);
  expect(post).not.toHaveBeenCalled();
  expect(effects.moment).not.toHaveBeenCalled();
  expect(effects.track).not.toHaveBeenCalled();
});
