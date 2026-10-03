// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `GET /api/v1/operations/:id/assembly`, and what `GET /operations/:id` says
 * about an assembly operation.
 *
 * The screen read is shared with the web route and talks to the database, so
 * it is stubbed — that is the one boundary this process cannot reach — and
 * what is under test is what the ROUTE decides:
 *
 *  - WHOSE screen it is. On a shared tablet the terminal account is signed in
 *    while a pinned operator builds, so the open timer and the manager
 *    override must both follow `user.userId`: the first through the read's
 *    `userId`, the second through the claims it is handed. The pinned
 *    operator's claims are read from this API's own cache; the terminal's own
 *    are never used for someone else.
 *  - WHICH client reads. The service role, as the web loader does: RLS on
 *    `productionEvent` needs `production_view`, which an operator does not
 *    hold.
 *  - that `?unit=` and `?trackedEntityId=` reach the read untouched, because
 *    the read — not the route — decides which strings are a unit.
 *  - that the two wrong-view answers point at each other, so a client always
 *    learns which screen an operation belongs on.
 */

const {
  requireApiUser,
  getApiClaims,
  getAssemblyScreen,
  getOperationScreen,
  serviceRole
} = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  getApiClaims: vi.fn(),
  getAssemblyScreen: vi.fn(),
  getOperationScreen: vi.fn(),
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
    getApiClaims,
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
vi.mock("~/services/screens.server", () => ({
  getAssemblyScreen,
  getOperationScreen
}));

const assemblyRoute = await import("./operations.$id.assembly");
const operationRoute = await import("./operations.$id._index");

const OPERATOR = "user-operator";
const TERMINAL = "user-terminal";
const COMPANY = "comp-1";
const TERMINAL_CLAIMS = { role: "employee", permissions: { terminal: true } };
const OPERATOR_CLAIMS = { role: "employee", permissions: { operator: true } };

const USER = {
  companyId: COMPANY,
  userId: OPERATOR,
  sessionUserId: TERMINAL,
  consoleMode: true,
  accessToken: "token",
  email: "terminal@example.com",
  claims: TERMINAL_CLAIMS,
  client: { tag: "rls" }
};

type RouteFn = (args: {
  request: Request;
  params: Record<string, string | undefined>;
  context?: unknown;
}) => Promise<Response>;

const run = (
  route: unknown,
  request: Request,
  params: Record<string, string | undefined>
) => (route as RouteFn)({ request, params, context: {} });

const get = (path: string) => new Request(`http://mes.test/api/v1/${path}`);

const SCREEN = {
  operation: { id: "op_1", operationType: "Assembly", operationQuantity: 10 },
  job: { id: "job_1", jobId: "J000009" },
  jobId: "job_1",
  thumbnailPath: null,
  trackedEntities: [],
  trackedEntityId: null,
  materials: { materials: [], trackedInputs: [] },
  procedure: { attributes: [], parameters: [] },
  tools: [],
  ncrs: [],
  nonConformanceActions: [],
  requiresSerialTracking: false,
  requiresBatchTracking: false,
  isFirstOperation: true,
  openEvent: null,
  events: [],
  expiredEntityPolicy: "Block",
  autoStartOperationTimer: false,
  productionQuantities: { scrap: 0, production: 0, rework: 0 },
  workCenter: null,
  kanban: null,
  canOverrideComplete: false,
  modelPath: null,
  slideModels: {},
  assemblyPlayback: null
};

beforeEach(() => {
  vi.clearAllMocks();
  requireApiUser.mockResolvedValue(USER);
  getApiClaims.mockResolvedValue(OPERATOR_CLAIMS);
});

describe("GET /api/v1/operations/:id/assembly", () => {
  const PARAMS = { id: "op_1" };

  it("reads with the service role, as the pinned operator, with THEIR claims", async () => {
    getAssemblyScreen.mockResolvedValue({ ok: true, data: SCREEN });

    const response = await run(
      assemblyRoute.loader,
      get("operations/op_1/assembly"),
      PARAMS
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("carbon-api")).toBe("1");
    // The pinned operator's claims come from this API's per-(user, company)
    // cache — never the terminal's, which would hand a manager's override to
    // whoever is standing at a manager's tablet (or deny it to a manager
    // pinned on an operator's).
    expect(getApiClaims).toHaveBeenCalledWith(OPERATOR, COMPANY);
    expect(getAssemblyScreen).toHaveBeenCalledWith(
      // NOT `user.client`: RLS would hide `productionEvent` from an operator.
      serviceRole,
      {
        companyId: COMPANY,
        userId: OPERATOR,
        operationId: "op_1",
        unit: null,
        trackedEntityId: null,
        claims: OPERATOR_CLAIMS
      }
    );
    expect(await response.json()).toEqual(SCREEN);
  });

  it("uses the session's own claims when nobody is pinned", async () => {
    requireApiUser.mockResolvedValue({ ...USER, userId: TERMINAL });
    getAssemblyScreen.mockResolvedValue({ ok: true, data: SCREEN });

    await run(assemblyRoute.loader, get("operations/op_1/assembly"), PARAMS);

    // Already loaded by `requireApiUser`; a second read would be a wasted
    // round trip on every poll of the screen.
    expect(getApiClaims).not.toHaveBeenCalled();
    expect(getAssemblyScreen).toHaveBeenCalledWith(
      serviceRole,
      expect.objectContaining({ userId: TERMINAL, claims: TERMINAL_CLAIMS })
    );
  });

  it("hands the unit selection to the read exactly as it arrived", async () => {
    getAssemblyScreen.mockResolvedValue({ ok: true, data: SCREEN });

    await run(
      assemblyRoute.loader,
      get("operations/op_1/assembly?unit=3&trackedEntityId=te_9"),
      PARAMS
    );

    // Strings, unparsed: the shared read decides what counts as an index, so
    // the web and the app cannot disagree about `?unit=1.5` or `?unit=abc`.
    expect(getAssemblyScreen).toHaveBeenCalledWith(
      serviceRole,
      expect.objectContaining({ unit: "3", trackedEntityId: "te_9" })
    );
  });

  it("404s an operation that is not in the caller's company", async () => {
    getAssemblyScreen.mockResolvedValue({
      ok: false,
      failure: {
        kind: "not_found",
        message: "Operation not found",
        redirectTo: "/x/operations"
      }
    });

    const response = await run(
      assemblyRoute.loader,
      get("operations/op_other/assembly"),
      { id: "op_other" }
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "not_found", message: "Operation not found" }
    });
  });

  it("409s an operation that is not an assembly, and says which view", async () => {
    getAssemblyScreen.mockResolvedValue({
      ok: false,
      failure: {
        kind: "redirect",
        message: "",
        redirectTo: "/x/operation/op_1",
        details: { view: "inspection" }
      }
    });

    const response = await run(
      assemblyRoute.loader,
      get("operations/op_1/assembly"),
      PARAMS
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "conflict",
        message: "This operation is not an assembly",
        details: { view: "inspection" }
      }
    });
  });

  it("never echoes a database error to the app", async () => {
    getAssemblyScreen.mockResolvedValue({
      ok: false,
      failure: {
        kind: "redirect",
        message: "Failed to fetch job",
        redirectTo: "/x/operations",
        details: { message: "permission denied for table job", code: "42501" }
      }
    });

    const response = await run(
      assemblyRoute.loader,
      get("operations/op_1/assembly"),
      PARAMS
    );

    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload.error.message).toBe("Failed to fetch job");
    expect(payload.error).not.toHaveProperty("details");
  });

  it("400s when the path carries no operation", async () => {
    const response = await run(
      assemblyRoute.loader,
      get("operations//assembly"),
      {}
    );

    expect(response.status).toBe(400);
    expect(getAssemblyScreen).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/operations/:id for an assembly operation", () => {
  it("409s with the view a client should open instead", async () => {
    getOperationScreen.mockResolvedValue({
      ok: false,
      failure: {
        kind: "redirect",
        message: "",
        redirectTo: "/x/assembly/op_1",
        details: { view: "assembly" }
      }
    });

    const response = await run(operationRoute.loader, get("operations/op_1"), {
      id: "op_1"
    });

    expect(response.status).toBe(409);
    const payload = await response.json();
    // `details.view` is the contract: it is what sends the app to
    // `/operations/:id/assembly`. The message is for a person reading a log.
    expect(payload.error.details).toEqual({ view: "assembly" });
    expect(payload.error.message).toContain("/operations/:id/assembly");
  });
});
