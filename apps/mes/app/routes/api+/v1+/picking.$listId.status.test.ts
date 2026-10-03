// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireApiUser, setPickingListStatus, serviceRole } = vi.hoisted(
  () => ({
    requireApiUser: vi.fn(),
    setPickingListStatus: vi.fn(),
    serviceRole: { tag: "service-role" }
  })
);

// The real `@carbon/auth/api-user.server` cannot load here: the `@carbon/auth`
// graph reaches `@carbon/content`, whose glossary needs the Lingui macro
// transform that `apps/mes/vitest.config.ts` does not run. `ApiError` and
// `apiErrorResponse` below mirror that module.
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
    API_VERSIONS: "1",
    API_VERSIONS_HEADER: "carbon-api",
    ApiError,
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
    requireApiUser
  };
});

vi.mock("./lib/idempotency.server", () => ({
  IDEMPOTENCY_HEADER: "idempotency-key",
  REPLAYED_HEADER: "idempotent-replayed",
  withIdempotency: (_args: unknown, run: () => Promise<Response>) => run()
}));

vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: () => serviceRole
}));

vi.mock("~/services/commands.picking.server", () => ({ setPickingListStatus }));

const { action, loader } = await import("./picking.$listId.status");

const USER = {
  companyId: "c1",
  userId: "operator-1",
  sessionUserId: "terminal-1",
  consoleMode: true,
  client: { tag: "rls" }
};

const URL_ = "http://mes.test/api/v1/picking/pl_1/status";
const PARAMS = { listId: "pl_1" };

const UNRESOLVED = [
  { itemName: "Bracket", outstanding: 3 },
  { itemName: "Washer", outstanding: 1 }
];

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request(URL_, {
    method: "POST",
    headers: { "idempotency-key": "idem-1", ...headers },
    body: JSON.stringify(body)
  });
}

type RouteFn = (args: {
  request: Request;
  params: Record<string, string | undefined>;
}) => Promise<Response>;

const run = (request: Request) =>
  (action as unknown as RouteFn)({ request, params: PARAMS });

beforeEach(() => {
  vi.clearAllMocks();
  requireApiUser.mockResolvedValue(USER);
  setPickingListStatus.mockResolvedValue({
    ok: true,
    data: { status: "Completed" }
  });
});

describe("POST /api/v1/picking/:listId/status", () => {
  it("returns the terminal status the policy chose", async () => {
    setPickingListStatus.mockResolvedValue({
      ok: true,
      data: { status: "Partial" }
    });

    const response = await run(
      post({ status: "Completed", acknowledged: true })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("carbon-api")).toBe("1");
    // Asking to finish can land on Partial — the app shows what it got.
    expect(await response.json()).toEqual({
      success: true,
      status: "Partial"
    });

    expect(setPickingListStatus).toHaveBeenCalledWith(
      serviceRole,
      { companyId: "c1", userId: "operator-1" },
      { pickingListId: "pl_1", status: "Completed", acknowledged: true }
    );
  });

  it("defaults acknowledged to false", async () => {
    await run(post({ status: "Completed" }));
    expect(setPickingListStatus.mock.calls[0][2].acknowledged).toBe(false);
  });

  // The two policy outcomes — the whole point of keeping the
  // `incompletePickingListPolicy` decision server-side.
  it("maps `blocked` to 409 with the unresolved lines in details", async () => {
    setPickingListStatus.mockResolvedValue({
      ok: false,
      failure: {
        kind: "blocked",
        message: "Some material is still unpicked.",
        details: { unresolvedLines: UNRESOLVED }
      }
    });

    const response = await run(post({ status: "Completed" }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "blocked",
        message: "Some material is still unpicked.",
        details: { unresolvedLines: UNRESOLVED }
      }
    });
  });

  it("maps `needs_acknowledgement` to 409 with the unresolved lines", async () => {
    setPickingListStatus.mockResolvedValue({
      ok: false,
      failure: {
        kind: "needs_acknowledgement",
        message: "Some material is still unpicked.",
        details: { unresolvedLines: UNRESOLVED }
      }
    });

    const response = await run(post({ status: "Completed" }));

    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.error.code).toBe("needs_acknowledgement");
    expect(payload.error.details).toEqual({ unresolvedLines: UNRESOLVED });
  });

  it("maps `not_found` to 404 and `conflict` to 409", async () => {
    setPickingListStatus.mockResolvedValue({
      ok: false,
      failure: { kind: "not_found", message: "Picking list not found" }
    });
    expect((await run(post({ status: "Draft" }))).status).toBe(404);

    setPickingListStatus.mockResolvedValue({
      ok: false,
      failure: {
        kind: "conflict",
        message: "Reopen this picking list from the ERP."
      }
    });
    const conflict = await run(post({ status: "Draft" }));
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.message).toBe(
      "Reopen this picking list from the ERP."
    );
  });

  it("maps `error` to 500", async () => {
    setPickingListStatus.mockResolvedValue({
      ok: false,
      failure: {
        kind: "error",
        message: "Failed to read the picking list completion policy"
      }
    });

    const response = await run(post({ status: "Completed" }));
    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe("internal");
  });

  it("400s a status outside the picking-list enum", async () => {
    const response = await run(post({ status: "Finished" }));

    expect(response.status).toBe(400);
    expect(setPickingListStatus).not.toHaveBeenCalled();
    const payload = await response.json();
    expect(payload.error.code).toBe("validation_failed");
    expect(Object.keys(payload.error.fields)).toContain("status");
  });

  it("requires an Idempotency-Key", async () => {
    const response = await run(
      new Request(URL_, {
        method: "POST",
        body: JSON.stringify({ status: "Completed" })
      })
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("idempotency_key_required");
    expect(setPickingListStatus).not.toHaveBeenCalled();
  });

  it("405s a GET", async () => {
    const response = await (loader as unknown as RouteFn)({
      request: new Request(URL_),
      params: PARAMS
    });

    expect(response.status).toBe(405);
  });
});
