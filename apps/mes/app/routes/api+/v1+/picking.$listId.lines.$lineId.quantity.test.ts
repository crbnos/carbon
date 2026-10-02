// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireApiUser, pickQuantity, serviceRole } = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  pickQuantity: vi.fn(),
  serviceRole: { tag: "service-role" }
}));

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

// The idempotency WINDOW needs Redis and is pinned by its own tests; the
// "key required" check lives in `apiRoute` itself and still runs below.
vi.mock("./lib/idempotency.server", () => ({
  IDEMPOTENCY_HEADER: "idempotency-key",
  REPLAYED_HEADER: "idempotent-replayed",
  withIdempotency: (_args: unknown, run: () => Promise<Response>) => run()
}));

vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: () => serviceRole
}));

vi.mock("~/services/commands.picking.server", () => ({ pickQuantity }));

const { action, loader } = await import(
  "./picking.$listId.lines.$lineId.quantity"
);

const USER = {
  companyId: "c1",
  userId: "operator-1",
  sessionUserId: "terminal-1",
  consoleMode: true,
  client: { tag: "rls" }
};

const URL_ = "http://mes.test/api/v1/picking/pl_1/lines/pll_1/quantity";
const PARAMS = { listId: "pl_1", lineId: "pll_1" };

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
  pickQuantity.mockResolvedValue({ ok: true, data: { id: "pll_1" } });
});

describe("POST /api/v1/picking/:listId/lines/:lineId/quantity", () => {
  it("picks as the EFFECTIVE user with the service-role client", async () => {
    const response = await run(
      post({ pickingListLineId: "pll_1", quantity: 4, markShort: true })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("carbon-api")).toBe("1");
    expect(await response.json()).toEqual({
      success: true,
      data: { id: "pll_1" }
    });

    // The pinned operator, not the signed-in terminal, and the same
    // service-role client the web route uses.
    expect(pickQuantity).toHaveBeenCalledWith(
      serviceRole,
      { companyId: "c1", userId: "operator-1" },
      { pickingListLineId: "pll_1", quantity: 4, markShort: true }
    );
  });

  it("defaults markShort to false", async () => {
    await run(post({ pickingListLineId: "pll_1", quantity: 2 }));
    expect(pickQuantity.mock.calls[0][2]).toEqual({
      pickingListLineId: "pll_1",
      quantity: 2,
      markShort: false
    });
  });

  it("refuses a body naming a different line than the path", async () => {
    const response = await run(
      post({ pickingListLineId: "pll_other", quantity: 1 })
    );

    expect(response.status).toBe(400);
    expect(pickQuantity).not.toHaveBeenCalled();
    expect((await response.json()).error.code).toBe("validation_failed");
  });

  it("maps a conflict failure to 409 with the command's message", async () => {
    pickQuantity.mockResolvedValue({
      ok: false,
      failure: {
        kind: "conflict",
        message:
          "This picking list is closed. Reopen it from the ERP to continue."
      }
    });

    const response = await run(
      post({ pickingListLineId: "pll_1", quantity: 1 })
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "conflict",
        message:
          "This picking list is closed. Reopen it from the ERP to continue."
      }
    });
  });

  it("maps a validation failure to 400", async () => {
    pickQuantity.mockResolvedValue({
      ok: false,
      failure: { kind: "validation", message: "Missing pickingListLineId" }
    });

    const response = await run(
      post({ pickingListLineId: "pll_1", quantity: 1 })
    );
    expect(response.status).toBe(400);
  });

  it("400s a body that is not a valid pickQuantityBody", async () => {
    const response = await run(post({ quantity: -1 }));

    expect(response.status).toBe(400);
    expect(pickQuantity).not.toHaveBeenCalled();
    const payload = await response.json();
    expect(payload.error.code).toBe("validation_failed");
    expect(Object.keys(payload.error.fields)).toEqual(
      expect.arrayContaining(["pickingListLineId", "quantity"])
    );
  });

  it("requires an Idempotency-Key", async () => {
    const response = await run(
      new Request(URL_, {
        method: "POST",
        body: JSON.stringify({ pickingListLineId: "pll_1", quantity: 1 })
      })
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("idempotency_key_required");
    expect(pickQuantity).not.toHaveBeenCalled();
  });

  it("405s a GET", async () => {
    const response = await (loader as unknown as RouteFn)({
      request: new Request(URL_),
      params: PARAMS
    });

    expect(response.status).toBe(405);
  });
});
