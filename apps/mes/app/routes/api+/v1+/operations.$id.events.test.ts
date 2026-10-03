// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requireApiUser } from "@carbon/auth/api-user.server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { failed, ok } from "~/services/api-result.server";
import {
  startEvent,
  startOperationFromScan
} from "~/services/commands.time.server";
import { action, loader } from "./operations.$id.events";

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
vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: vi.fn(() => ({ serviceRole: true }))
}));
// The idempotency window needs a live Redis; the header check it hangs off
// lives in `apiRoute` and is still exercised below.
vi.mock("./lib/idempotency.server", () => ({
  IDEMPOTENCY_HEADER: "idempotency-key",
  REPLAYED_HEADER: "idempotent-replayed",
  withIdempotency: vi.fn(async (_args: unknown, run: () => Promise<Response>) =>
    run()
  )
}));
vi.mock("~/services/commands.time.server", () => ({
  startEvent: vi.fn(),
  startOperationFromScan: vi.fn()
}));

const userClient = { userClient: true };

function post(body: unknown, headers: Record<string, string> = {}) {
  return action({
    request: new Request("http://localhost/api/v1/operations/op-1/events", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body)
    }),
    params: { id: "op-1" }
  } as never) as Promise<Response>;
}

const withKey = { "idempotency-key": "key-1" };

describe("POST /api/v1/operations/:id/events", () => {
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
    vi.mocked(startEvent).mockResolvedValue(ok([{ id: "pe-1" }]) as never);
    vi.mocked(startOperationFromScan).mockResolvedValue(
      ok({ operationId: "op-1" })
    );
  });

  it("runs the BUTTON command with the caller's own client and the path's operation", async () => {
    const response = await post(
      { jobOperationId: "ignored-by-the-server", type: "Labor" },
      withKey
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("carbon-api")).toBe("1");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      eventId: "pe-1"
    });
    expect(startOperationFromScan).not.toHaveBeenCalled();
    expect(startEvent).toHaveBeenCalledWith(userClient, {
      companyId: "company-1",
      userId: "operator-1",
      sessionUserId: "terminal-1",
      source: "mes_mobile",
      body: { jobOperationId: "op-1", type: "Labor" }
    });
  });

  it("runs the SCAN command — with the floor gate — when viaScan is true", async () => {
    const response = await post(
      { jobOperationId: "op-1", type: "Setup", viaScan: true },
      withKey
    );

    expect(response.status).toBe(200);
    expect(startEvent).not.toHaveBeenCalled();
    expect(startOperationFromScan).toHaveBeenCalledWith(
      { serviceRole: true },
      {
        companyId: "company-1",
        userId: "operator-1",
        sessionUserId: "terminal-1",
        operationId: "op-1",
        type: "Setup",
        trackedEntityId: undefined,
        source: "mes_mobile"
      }
    );
  });

  it("answers the floor gate's redirect failure as 409 with the operator's own message", async () => {
    vi.mocked(startOperationFromScan).mockResolvedValue(
      failed({
        kind: "redirect",
        message: "This operation's job has not been released to the floor",
        redirectTo: "/x/operations?saved=1"
      })
    );

    const response = await post(
      { jobOperationId: "op-1", type: "Labor", viaScan: true },
      withKey
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "conflict",
        message: "This operation's job has not been released to the floor"
      }
    });
  });

  it("answers an ability-gate failure as 403", async () => {
    vi.mocked(startEvent).mockResolvedValue(
      failed({ kind: "forbidden", message: "Not qualified" })
    );

    const response = await post(
      { jobOperationId: "op-1", type: "Labor" },
      withKey
    );

    expect(response.status).toBe(403);
  });

  it("requires an Idempotency-Key", async () => {
    const response = await post({ jobOperationId: "op-1", type: "Labor" });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "idempotency_key_required" }
    });
    expect(startEvent).not.toHaveBeenCalled();
  });

  it("rejects a body with no event type", async () => {
    const response = await post({ jobOperationId: "op-1" }, withKey);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "validation_failed" }
    });
    expect(startEvent).not.toHaveBeenCalled();
  });

  it("answers 405 to a GET", async () => {
    const response = (await loader({
      request: new Request("http://localhost/api/v1/operations/op-1/events"),
      params: { id: "op-1" }
    } as never)) as Response;

    expect(response.status).toBe(405);
  });
});
