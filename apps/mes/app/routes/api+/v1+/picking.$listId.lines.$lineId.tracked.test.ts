// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireApiUser, pickTrackedEntity, serviceRole } = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  pickTrackedEntity: vi.fn(),
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

vi.mock("./lib/idempotency.server", () => ({
  IDEMPOTENCY_HEADER: "idempotency-key",
  REPLAYED_HEADER: "idempotent-replayed",
  withIdempotency: (_args: unknown, run: () => Promise<Response>) => run()
}));

vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: () => serviceRole
}));

vi.mock("~/services/commands.picking.server", () => ({ pickTrackedEntity }));

const { action, loader } = await import(
  "./picking.$listId.lines.$lineId.tracked"
);

const USER = {
  companyId: "c1",
  userId: "operator-1",
  sessionUserId: "terminal-1",
  consoleMode: true,
  client: { tag: "rls" }
};

const URL_ = "http://mes.test/api/v1/picking/pl_1/lines/pll_1/tracked";
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
  pickTrackedEntity.mockResolvedValue({ ok: true, data: { id: "pll_1" } });
});

describe("POST /api/v1/picking/:listId/lines/:lineId/tracked", () => {
  it("picks the lot named by the path line, as the effective user", async () => {
    const response = await run(
      post({
        trackedEntityId: "te_1",
        fromStorageUnitId: "su_1",
        quantity: 0.5
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("carbon-api")).toBe("1");
    expect(await response.json()).toEqual({
      success: true,
      data: { id: "pll_1" }
    });

    expect(pickTrackedEntity).toHaveBeenCalledWith(
      serviceRole,
      { companyId: "c1", userId: "operator-1" },
      {
        pickingListLineId: "pll_1",
        trackedEntityId: "te_1",
        fromStorageUnitId: "su_1",
        quantity: 0.5,
        unpick: false
      }
    );
  });

  it("sends a null source bin and unpick=false when they are omitted", async () => {
    await run(post({ trackedEntityId: "te_1", quantity: 1 }));

    expect(pickTrackedEntity.mock.calls[0][2]).toEqual({
      pickingListLineId: "pll_1",
      trackedEntityId: "te_1",
      fromStorageUnitId: null,
      quantity: 1,
      unpick: false
    });
  });

  it("passes unpick through", async () => {
    await run(post({ trackedEntityId: "te_1", quantity: 1, unpick: true }));
    expect(pickTrackedEntity.mock.calls[0][2].unpick).toBe(true);
  });

  it("maps a conflict failure to 409 with the command's message", async () => {
    pickTrackedEntity.mockResolvedValue({
      ok: false,
      failure: { kind: "conflict", message: "This line is not a tracked item" }
    });

    const response = await run(post({ trackedEntityId: "te_1", quantity: 1 }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "conflict", message: "This line is not a tracked item" }
    });
  });

  it("maps a validation failure to 400", async () => {
    pickTrackedEntity.mockResolvedValue({
      ok: false,
      failure: { kind: "validation", message: "Missing tracked entity" }
    });

    const response = await run(post({ trackedEntityId: "te_1", quantity: 1 }));
    expect(response.status).toBe(400);
  });

  it("400s a body that is not a valid pickTrackedBody", async () => {
    const response = await run(post({ quantity: "lots" }));

    expect(response.status).toBe(400);
    expect(pickTrackedEntity).not.toHaveBeenCalled();
    const payload = await response.json();
    expect(payload.error.code).toBe("validation_failed");
    expect(Object.keys(payload.error.fields)).toEqual(
      expect.arrayContaining(["trackedEntityId", "quantity"])
    );
  });

  it("requires an Idempotency-Key", async () => {
    const response = await run(
      new Request(URL_, {
        method: "POST",
        body: JSON.stringify({ trackedEntityId: "te_1", quantity: 1 })
      })
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("idempotency_key_required");
    expect(pickTrackedEntity).not.toHaveBeenCalled();
  });

  it("405s a GET", async () => {
    const response = await (loader as unknown as RouteFn)({
      request: new Request(URL_),
      params: PARAMS
    });

    expect(response.status).toBe(405);
  });
});
