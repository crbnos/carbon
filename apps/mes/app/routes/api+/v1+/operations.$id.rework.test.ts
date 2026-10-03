// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requireApiUser } from "@carbon/auth/api-user.server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { failed, ok } from "~/services/api-result.server";
import { reportRework } from "~/services/commands.quantities.server";
import { action, loader } from "./operations.$id.rework";

// The real module's auth chain reaches `@carbon/content`'s glossary, whose
// lingui `msg` macro vitest does not transform — so `ApiError` and
// `apiErrorResponse` (both self-contained) are mirrored here. The status and
// `error.code` the tests assert are exactly what the real pair produces.
vi.mock("@carbon/auth/api-user.server", () => {
  class ApiError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
      readonly fields?: Record<string, string[]>,
      readonly details?: unknown
    ) {
      super(message);
      this.name = "ApiError";
    }
  }
  return {
    ApiError,
    API_VERSIONS_HEADER: "carbon-api",
    API_VERSIONS: "1",
    apiErrorResponse: (err: ApiError) =>
      new Response(
        JSON.stringify({
          error: {
            code: err.code,
            message: err.message,
            ...(err.fields && { fields: err.fields }),
            ...(err.details !== undefined && { details: err.details })
          }
        }),
        {
          status: err.status,
          headers: { "Content-Type": "application/json", "carbon-api": "1" }
        }
      ),
    requireApiUser: vi.fn()
  };
});
// The idempotency window needs a live Redis; the header check it hangs off
// lives in `apiRoute` and is still exercised below.
vi.mock("./lib/idempotency.server", () => ({
  IDEMPOTENCY_HEADER: "idempotency-key",
  REPLAYED_HEADER: "idempotent-replayed",
  withIdempotency: vi.fn(async (_args: unknown, run: () => Promise<Response>) =>
    run()
  )
}));
vi.mock("~/services/commands.quantities.server", () => ({
  reportRework: vi.fn()
}));

const userClient = { userClient: true };
const withKey = { "idempotency-key": "key-1" };

function post(body: unknown, headers: Record<string, string> = {}) {
  return action({
    request: new Request("http://localhost/api/v1/operations/op-1/rework", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body)
    }),
    params: { id: "op-1" }
  } as never) as Promise<Response>;
}

describe("POST /api/v1/operations/:id/rework", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireApiUser).mockResolvedValue({
      companyId: "company-1",
      userId: "operator-1",
      sessionUserId: "terminal-1",
      consoleMode: true,
      accessToken: "t",
      email: "operator@example.com",
      claims: { permissions: {}, role: "employee" },
      client: userClient
    } as never);
    vi.mocked(reportRework).mockResolvedValue(ok([{ id: "pq-1" }]) as never);
  });

  it("writes rework with the caller's own client, against the path's operation", async () => {
    const response = await post(
      { jobOperationId: "ignored-by-the-server", quantity: 3 },
      withKey
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("carbon-api")).toBe("1");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      reworked: true
    });
    expect(reportRework).toHaveBeenCalledWith(
      userClient,
      {
        companyId: "company-1",
        // The work is the OPERATOR's, not the terminal's.
        userId: "operator-1",
        sessionUserId: "terminal-1",
        source: "mes_mobile"
      },
      { jobOperationId: "op-1", quantity: 3 }
    );
  });

  it("answers a failed write as 500 internal", async () => {
    vi.mocked(reportRework).mockResolvedValue(
      failed({ kind: "error", message: "Failed to record rework quantity" })
    );

    const response = await post(
      { jobOperationId: "op-1", quantity: 1 },
      withKey
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: { code: "internal", message: "Failed to record rework quantity" }
    });
  });

  it("requires an Idempotency-Key", async () => {
    const response = await post({ jobOperationId: "op-1", quantity: 1 });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "idempotency_key_required" }
    });
    expect(reportRework).not.toHaveBeenCalled();
  });

  it("rejects a body with no quantity", async () => {
    const response = await post({ jobOperationId: "op-1" }, withKey);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "validation_failed" }
    });
    expect(reportRework).not.toHaveBeenCalled();
  });

  it("answers 405 to a GET", async () => {
    const response = (await loader({
      request: new Request("http://localhost/api/v1/operations/op-1/rework"),
      params: { id: "op-1" }
    } as never)) as Response;

    expect(response.status).toBe(405);
  });
});
