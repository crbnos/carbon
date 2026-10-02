// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The inspection screen read and the five inspection writes.
 *
 * The screen read and the commands are shared with the web routes and talk to
 * the database, so they are stubbed here — that is the one boundary this
 * process cannot reach — and what is under test is what the ROUTE decides:
 *
 *  - WHOSE work it is. On a shared tablet the terminal account is signed in
 *    while a pinned operator is inspecting, so every call must carry
 *    `user.userId` and never `user.sessionUserId`. An inspection record is a
 *    signature; getting it backwards is invisible to a status-code test.
 *  - WHICH client writes. The screen reads with the SERVICE ROLE (RLS on
 *    `productionEvent` needs `production_view`, which an operator does not
 *    hold); the engine writes go through the Kysely pool; and the two
 *    orchestration commands get the service role for the edge functions AND
 *    the CALLER's RLS client for the quantity and scrap rows.
 *  - that a lot id from the URL is handed to a command that re-scopes it, and
 *    that a body naming a DIFFERENT lot is refused rather than applied to the
 *    one in the path.
 *  - that the screen payload carries the drawing's BALLOONS but never a PDF
 *    or a url to one: a native client draws the overlay itself over a page
 *    rasterised by `GET /inspections/:id/drawing`.
 *  - that every POST needs an `Idempotency-Key`, and that a failure after the
 *    one-shot disposition close is a 5xx, which the window replays rather than
 *    re-running.
 */

const {
  requireApiUser,
  getInspectionScreen,
  getInspection,
  getInspectionDrawingStoragePath,
  renderPdfPageAsPng,
  download,
  recordInspectionMeasurement,
  setInspectionGauge,
  recordInspectionSample,
  dispositionInspectionLot,
  completePassedInspectionUnits,
  serviceRole,
  db
} = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  getInspectionScreen: vi.fn(),
  recordInspectionMeasurement: vi.fn(),
  setInspectionGauge: vi.fn(),
  recordInspectionSample: vi.fn(),
  dispositionInspectionLot: vi.fn(),
  completePassedInspectionUnits: vi.fn(),
  getInspection: vi.fn(),
  getInspectionDrawingStoragePath: vi.fn(),
  renderPdfPageAsPng: vi.fn(),
  download: vi.fn(),
  serviceRole: { tag: "service-role" },
  db: { tag: "kysely" }
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

// The idempotency window needs a live Redis. The header check it hangs off
// lives in `apiRoute` and is still exercised below.
vi.mock("./lib/idempotency.server", () => ({
  IDEMPOTENCY_HEADER: "idempotency-key",
  REPLAYED_HEADER: "idempotent-replayed",
  withIdempotency: (_args: unknown, run: () => Promise<Response>) => run()
}));

vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: () => serviceRole
}));
vi.mock("~/services/database.server", () => ({
  getDatabaseClient: () => db
}));
vi.mock("~/services/screens.server", () => ({ getInspectionScreen }));
vi.mock("~/services/quality.service", () => ({
  getInspection,
  getInspectionDrawingStoragePath
}));
vi.mock("@carbon/files/pdf/node", () => ({ renderPdfPageAsPng }));
// `storage(client).company(id).download(key)` — the company bucket with its
// legacy fallback, the same accessor `file+/preview+/$bucket.$.tsx` reads
// through. Only `download` is reached here.
vi.mock("@carbon/files", () => ({
  storage: () => ({ company: () => ({ download }) }),
  isUnsafeStoragePath: (path: string) =>
    path.includes("..") || path.startsWith("/"),
  isStorageNotFound: async () => false
}));
vi.mock("~/services/commands.inspection.server", () => ({
  recordInspectionMeasurement,
  setInspectionGauge,
  recordInspectionSample,
  dispositionInspectionLot,
  completePassedInspectionUnits
}));

const screenRoute = await import("./operations.$id.inspection");
const measurementRoute = await import("./inspections.$id.measurement");
const gaugeRoute = await import("./inspections.$id.gauge");
const sampleRoute = await import("./inspections.$id.sample");
const dispositionRoute = await import("./inspections.$id.disposition");
const completePassedRoute = await import("./inspections.$id.complete-passed");
const drawingRoute = await import("./inspections.$id.drawing");

const OPERATOR = "user-operator";
const TERMINAL = "user-terminal";
const COMPANY = "comp-1";
const LOT = "ins_1";
/** What `user.client` is: an RLS client for the signed-in user. */
const RLS_CLIENT = { tag: "rls" };

const USER = {
  companyId: COMPANY,
  userId: OPERATOR,
  sessionUserId: TERMINAL,
  consoleMode: true,
  accessToken: "token",
  email: "op@example.com",
  claims: { role: "employee", permissions: {} },
  client: RLS_CLIENT
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

function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = { "idempotency-key": "idem-1" }
) {
  return new Request(`http://mes.test/api/v1/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
}

const SCREEN = {
  inspection: {
    id: LOT,
    status: "In Progress",
    inspectionDocumentId: "idoc_1"
  },
  drawing: {
    documentName: "DWG-1001",
    balloons: [
      {
        id: "bal_1",
        inspectionFeatureId: "f_1",
        pageNumber: 1,
        xCoordinate: 0.5,
        yCoordinate: 0.25,
        regionX: 0.4,
        regionY: 0.4,
        regionWidth: 0.1,
        regionHeight: 0.05
      }
    ]
  },
  samples: [{ id: "isp_1", status: "Pending" }],
  features: [],
  measurements: [],
  gauges: [],
  recentGaugeIds: [],
  issueTypes: [],
  trackedEntities: [],
  requiresSerialTracking: false,
  requiresBatchTracking: false,
  operation: { id: "op_1" },
  job: { id: "job_1" },
  jobId: "job_1",
  events: [],
  productionQuantities: { scrap: 0, production: 0, rework: 0 },
  linkedSampleIds: [],
  linkedProductionQuantity: 0
};

beforeEach(() => {
  vi.clearAllMocks();
  requireApiUser.mockResolvedValue(USER);
});

describe("GET /api/v1/operations/:id/inspection", () => {
  const PARAMS = { id: "op_1" };
  const url = () =>
    new Request("http://mes.test/api/v1/operations/op_1/inspection");

  it("reads with the service role and the pool, as the pinned operator", async () => {
    getInspectionScreen.mockResolvedValue({ ok: true, data: SCREEN });

    const response = await run(screenRoute.loader, url(), PARAMS);

    expect(response.status).toBe(200);
    expect(response.headers.get("carbon-api")).toBe("1");
    expect(getInspectionScreen).toHaveBeenCalledWith(
      // RLS would hide `productionEvent` from an operator, so the read is
      // service-role exactly as the web loader's is — NOT `user.client`.
      serviceRole,
      db,
      {
        companyId: COMPANY,
        // The OPERATOR, not the terminal that is signed in.
        userId: OPERATOR,
        operationId: "op_1"
      }
    );
  });

  it("ships the drawing's geometry but never the PDF", async () => {
    getInspectionScreen.mockResolvedValue({ ok: true, data: SCREEN });

    const payload = await (await run(screenRoute.loader, url(), PARAMS)).json();

    // The balloons travel, because a native client draws them itself from
    // normalized coordinates over a server-rendered page image.
    expect(payload.drawing.documentName).toBe("DWG-1001");
    expect(payload.drawing.balloons).toHaveLength(1);
    expect(payload.drawing.balloons[0].xCoordinate).toBe(0.5);

    // The PDF does not, and no url to it either: `react-pdf` is DOM-only, so
    // a native client has no engine to open one with. Pages come from
    // `GET /inspections/:id/drawing?page=N` as PNGs instead.
    expect(JSON.stringify(payload)).not.toContain("pdfUrl");
    // Nothing at the top level either — the old shape put these there.
    expect(payload).not.toHaveProperty("balloons");
    expect(payload).not.toHaveProperty("documentName");
  });

  it("404s an operation that is not in the caller's company", async () => {
    getInspectionScreen.mockResolvedValue({
      ok: false,
      failure: {
        kind: "not_found",
        message: "Failed to fetch operation",
        redirectTo: "/x/operations",
        details: { message: "permission denied" }
      }
    });

    const response = await run(screenRoute.loader, url(), PARAMS);

    expect(response.status).toBe(404);
    const payload = await response.json();
    expect(payload.error.code).toBe("not_found");
    // A raw PostgREST error is never echoed to the app.
    expect(payload.error).not.toHaveProperty("details");
  });

  it("409s an operation that is not an inspection, and says which view", async () => {
    getInspectionScreen.mockResolvedValue({
      ok: false,
      failure: {
        kind: "redirect",
        message: "",
        redirectTo: "/x/operation/op_1",
        details: { view: "operation" }
      }
    });

    const response = await run(screenRoute.loader, url(), PARAMS);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "conflict",
        message: "This operation is not an inspection",
        details: { view: "operation" }
      }
    });
  });

  it("400s when the path carries no operation", async () => {
    const response = await run(screenRoute.loader, url(), {});

    expect(response.status).toBe(400);
    expect(getInspectionScreen).not.toHaveBeenCalled();
  });

  it("405s a POST", async () => {
    const response = await run(
      screenRoute.loader,
      new Request("http://mes.test/api/v1/operations/op_1/inspection", {
        method: "POST"
      }),
      PARAMS
    );

    expect(response.status).toBe(405);
    expect(getInspectionScreen).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/inspections/:id/measurement", () => {
  const PARAMS = { id: LOT };
  const PATH = `inspections/${LOT}/measurement`;
  const BODY = {
    inspectionId: LOT,
    inspectionFeatureId: "ift_1",
    value: "0.06255"
  };

  beforeEach(() => {
    recordInspectionMeasurement.mockResolvedValue({
      ok: true,
      data: {
        sampleId: "isp_1",
        measurementId: "ism_1",
        measurementStatus: "Passed",
        sampleStatus: "Pending"
      }
    });
  });

  it("records through the pool, as the operator, against the path's lot", async () => {
    const response = await run(
      measurementRoute.action,
      post(PATH, BODY),
      PARAMS
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      sampleId: "isp_1",
      measurementId: "ism_1",
      measurementStatus: "Passed",
      sampleStatus: "Pending"
    });
    expect(recordInspectionMeasurement).toHaveBeenCalledWith(
      db,
      { companyId: COMPANY, userId: OPERATOR },
      {
        inspectionId: LOT,
        inspectionFeatureId: "ift_1",
        // Every digit the operator typed, unrounded: the engine valuates it
        // against the live tolerances and the column keeps 5 decimals.
        value: "0.06255"
      }
    );
  });

  it("refuses a body that names a different lot", async () => {
    const response = await run(
      measurementRoute.action,
      post(PATH, { ...BODY, inspectionId: "ins_other" }),
      PARAMS
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("validation_failed");
    expect(recordInspectionMeasurement).not.toHaveBeenCalled();
  });

  it("requires an Idempotency-Key", async () => {
    const response = await run(
      measurementRoute.action,
      post(PATH, BODY, {}),
      PARAMS
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("idempotency_key_required");
    expect(recordInspectionMeasurement).not.toHaveBeenCalled();
  });

  it("404s a lot outside the company and 409s a closed one", async () => {
    recordInspectionMeasurement.mockResolvedValue({
      ok: false,
      failure: { kind: "not_found", message: "Inspection not found" }
    });
    expect(
      (await run(measurementRoute.action, post(PATH, BODY), PARAMS)).status
    ).toBe(404);

    recordInspectionMeasurement.mockResolvedValue({
      ok: false,
      failure: { kind: "conflict", message: "Inspection is closed" }
    });
    const closed = await run(measurementRoute.action, post(PATH, BODY), PARAMS);
    expect(closed.status).toBe(409);
    expect((await closed.json()).error.message).toBe("Inspection is closed");
  });

  it("405s a GET", async () => {
    const response = await run(
      measurementRoute.loader,
      new Request(`http://mes.test/api/v1/${PATH}`),
      PARAMS
    );
    expect(response.status).toBe(405);
  });
});

describe("POST /api/v1/inspections/:id/gauge", () => {
  const PARAMS = { id: LOT };
  const PATH = `inspections/${LOT}/gauge`;

  beforeEach(() => {
    setInspectionGauge.mockResolvedValue({
      ok: true,
      data: { inspectionFeatureId: "ift_1", gaugeId: "gau_1" }
    });
  });

  it("records the gauge through the pool, as the operator", async () => {
    const response = await run(
      gaugeRoute.action,
      post(PATH, {
        inspectionId: LOT,
        inspectionFeatureId: "ift_1",
        gaugeId: "gau_1"
      }),
      PARAMS
    );

    expect(response.status).toBe(200);
    expect(setInspectionGauge).toHaveBeenCalledWith(
      db,
      { companyId: COMPANY, userId: OPERATOR },
      { inspectionId: LOT, inspectionFeatureId: "ift_1", gaugeId: "gau_1" }
    );
  });

  it("carries an absent gaugeId through, which clears the record", async () => {
    setInspectionGauge.mockResolvedValue({
      ok: true,
      data: { inspectionFeatureId: "ift_1", gaugeId: null }
    });

    const response = await run(
      gaugeRoute.action,
      post(PATH, { inspectionId: LOT, inspectionFeatureId: "ift_1" }),
      PARAMS
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      inspectionFeatureId: "ift_1",
      gaugeId: null
    });
    expect(setInspectionGauge.mock.calls[0][2].gaugeId).toBeUndefined();
  });

  it("refuses a body that names a different lot", async () => {
    const response = await run(
      gaugeRoute.action,
      post(PATH, {
        inspectionId: "ins_other",
        inspectionFeatureId: "ift_1"
      }),
      PARAMS
    );

    expect(response.status).toBe(400);
    expect(setInspectionGauge).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/inspections/:id/sample", () => {
  const PARAMS = { id: LOT };
  const PATH = `inspections/${LOT}/sample`;

  beforeEach(() => {
    recordInspectionSample.mockResolvedValue({
      ok: true,
      data: { sampleId: "isp_1" }
    });
  });

  it("signs the sample with the pinned operator, not the terminal", async () => {
    const response = await run(
      sampleRoute.action,
      post(PATH, {
        inspectionId: LOT,
        trackedEntityId: "te_1",
        status: "Pending"
      }),
      PARAMS
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sampleId: "isp_1" });
    expect(recordInspectionSample).toHaveBeenCalledWith(
      db,
      // `inspectedBy` is derived from this — the record says who inspected it.
      { companyId: COMPANY, userId: OPERATOR },
      { inspectionId: LOT, trackedEntityId: "te_1", status: "Pending" }
    );
  });

  it("refuses a status outside the enum before any write", async () => {
    const response = await run(
      sampleRoute.action,
      post(PATH, { inspectionId: LOT, status: "Scrapped" }),
      PARAMS
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("validation_failed");
    expect(recordInspectionSample).not.toHaveBeenCalled();
  });

  it("404s a tracked entity from another company, naming the field", async () => {
    recordInspectionSample.mockResolvedValue({
      ok: false,
      failure: {
        kind: "not_found",
        message: "Tracked entity not found",
        fields: { trackedEntityId: ["Tracked entity not found"] }
      }
    });

    const response = await run(
      sampleRoute.action,
      post(PATH, {
        inspectionId: LOT,
        trackedEntityId: "te_other",
        status: "Passed"
      }),
      PARAMS
    );

    expect(response.status).toBe(404);
    expect((await response.json()).error.fields).toEqual({
      trackedEntityId: ["Tracked entity not found"]
    });
  });
});

describe("POST /api/v1/inspections/:id/disposition", () => {
  const PARAMS = { id: LOT };
  const PATH = `inspections/${LOT}/disposition`;
  const BODY = {
    inspectionId: LOT,
    decision: "Reject" as const,
    operationId: "op_1",
    scrapEntityIds: ["te_1", "te_2"],
    scrapReasonId: "scr_1",
    createNcr: true,
    setupProductionEventId: "pe_setup",
    laborProductionEventId: "pe_labor",
    machineProductionEventId: "pe_machine"
  };
  const OUTCOME = {
    decision: "Reject" as const,
    completed: 0,
    scrapped: 2,
    reworked: 0,
    finished: false,
    warnings: [],
    message: "Lot rejected — 2 scrapped"
  };

  beforeEach(() => {
    dispositionInspectionLot.mockResolvedValue({ ok: true, data: OUTCOME });
  });

  it("hands the command all three clients, each where the web used it", async () => {
    const response = await run(
      dispositionRoute.action,
      post(PATH, BODY),
      PARAMS
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(OUTCOME);

    const [clients, ctx, args] = dispositionInspectionLot.mock.calls[0];
    // Edge functions and the operation's live bookkeeping: service role.
    expect(clients.serviceRole).toBe(serviceRole);
    // The quantity and scrap rows: the CALLER's RLS client, as on the web.
    expect(clients.client).toBe(RLS_CLIENT);
    expect(clients.client).not.toBe(serviceRole);
    // The one-shot close: the Kysely pool.
    expect(clients.db).toBe(db);
    // A disposition is a signed decision — the operator's.
    expect(ctx).toEqual({ companyId: COMPANY, userId: OPERATOR });
    expect(args.inspectionId).toBe(LOT);
    expect(args.scrapEntityIds).toEqual(["te_1", "te_2"]);
    expect(args.createNcr).toBe(true);
  });

  it("puts ONLY the three event ids in eventIds", async () => {
    await run(dispositionRoute.action, post(PATH, BODY), PARAMS);

    // `eventIds` is SPREAD into the `issue` and scrap payloads, so handing it
    // the whole body would smuggle the decision and the allocation into an
    // edge-function call.
    expect(dispositionInspectionLot.mock.calls[0][2].eventIds).toEqual({
      setupProductionEventId: "pe_setup",
      laborProductionEventId: "pe_labor",
      machineProductionEventId: "pe_machine"
    });
  });

  it("returns warnings in a 200 — the lot IS closed and the units ARE posted", async () => {
    dispositionInspectionLot.mockResolvedValue({
      ok: true,
      data: { ...OUTCOME, warnings: ["failed to issue materials for scrap"] }
    });

    const response = await run(
      dispositionRoute.action,
      post(PATH, BODY),
      PARAMS
    );

    expect(response.status).toBe(200);
    expect((await response.json()).warnings).toEqual([
      "failed to issue materials for scrap"
    ]);
  });

  it("answers a failure after the close as a 5xx, which the window replays", async () => {
    dispositionInspectionLot.mockResolvedValue({
      ok: false,
      failure: {
        kind: "error",
        message: "Lot dispositioned, but triggering rework failed"
      }
    });

    const response = await run(
      dispositionRoute.action,
      post(PATH, BODY),
      PARAMS
    );

    // A stored 5xx is replayed, so an automatic retry can never re-run a
    // half-applied disposition or clone the rework branch twice.
    expect(response.status).toBe(500);
    expect((await response.json()).error.message).toBe(
      "Lot dispositioned, but triggering rework failed"
    );
  });

  it("409s a lot that was already dispositioned", async () => {
    dispositionInspectionLot.mockResolvedValue({
      ok: false,
      failure: { kind: "conflict", message: "Failed to disposition lot" }
    });

    const response = await run(
      dispositionRoute.action,
      post(PATH, BODY),
      PARAMS
    );

    expect(response.status).toBe(409);
  });

  it("refuses a decision outside the enum, and a body naming another lot", async () => {
    const badDecision = await run(
      dispositionRoute.action,
      post(PATH, { ...BODY, decision: "Scrap" }),
      PARAMS
    );
    expect(badDecision.status).toBe(400);

    const otherLot = await run(
      dispositionRoute.action,
      post(PATH, { ...BODY, inspectionId: "ins_other" }),
      PARAMS
    );
    expect(otherLot.status).toBe(400);

    expect(dispositionInspectionLot).not.toHaveBeenCalled();
  });

  it("requires an Idempotency-Key", async () => {
    const response = await run(
      dispositionRoute.action,
      post(PATH, BODY, {}),
      PARAMS
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("idempotency_key_required");
    expect(dispositionInspectionLot).not.toHaveBeenCalled();
  });

  it("405s a GET", async () => {
    const response = await run(
      dispositionRoute.loader,
      new Request(`http://mes.test/api/v1/${PATH}`),
      PARAMS
    );
    expect(response.status).toBe(405);
  });
});

describe("POST /api/v1/inspections/:id/complete-passed", () => {
  const PARAMS = { id: LOT };
  const PATH = `inspections/${LOT}/complete-passed`;
  const BODY = {
    inspectionId: LOT,
    operationId: "op_1",
    laborProductionEventId: "pe_labor"
  };

  beforeEach(() => {
    completePassedInspectionUnits.mockResolvedValue({
      ok: true,
      data: { completed: 3 }
    });
  });

  it("posts with the caller's RLS client and the service role, as the operator", async () => {
    const response = await run(
      completePassedRoute.action,
      post(PATH, BODY),
      PARAMS
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ completed: 3 });

    const [clients, ctx, args] = completePassedInspectionUnits.mock.calls[0];
    expect(clients.serviceRole).toBe(serviceRole);
    expect(clients.client).toBe(RLS_CLIENT);
    expect(clients.db).toBe(db);
    expect(ctx).toEqual({ companyId: COMPANY, userId: OPERATOR });
    expect(args).toEqual({
      inspectionId: LOT,
      operationId: "op_1",
      eventIds: {
        setupProductionEventId: undefined,
        laborProductionEventId: "pe_labor",
        machineProductionEventId: undefined
      }
    });
  });

  it("409s when the disposition already closed the lot", async () => {
    completePassedInspectionUnits.mockResolvedValue({
      ok: false,
      failure: {
        kind: "conflict",
        message: "Inspection is closed — the disposition already ran"
      }
    });

    const response = await run(
      completePassedRoute.action,
      post(PATH, BODY),
      PARAMS
    );

    expect(response.status).toBe(409);
    expect((await response.json()).error.message).toBe(
      "Inspection is closed — the disposition already ran"
    );
  });

  it("refuses a body that names a different lot", async () => {
    const response = await run(
      completePassedRoute.action,
      post(PATH, { ...BODY, inspectionId: "ins_other" }),
      PARAMS
    );

    expect(response.status).toBe(400);
    expect(completePassedInspectionUnits).not.toHaveBeenCalled();
  });

  it("requires an Idempotency-Key", async () => {
    const response = await run(
      completePassedRoute.action,
      post(PATH, BODY, {}),
      PARAMS
    );

    expect(response.status).toBe(400);
    expect(completePassedInspectionUnits).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/inspections/:id/drawing", () => {
  const PARAMS = { id: LOT };
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const url = (query = "") =>
    new Request(`http://mes.test/api/v1/inspections/${LOT}/drawing${query}`);

  /** A lot in the caller's company, with a drawing under its own prefix. */
  const healthy = () => {
    getInspection.mockResolvedValue({
      data: { id: LOT, companyId: COMPANY, inspectionDocumentId: "idoc_1" },
      error: null
    });
    getInspectionDrawingStoragePath.mockResolvedValue({
      data: { id: "idoc_1", storagePath: `${COMPANY}/inspection/dwg.pdf` },
      error: null
    });
    download.mockResolvedValue({
      data: { arrayBuffer: async () => new ArrayBuffer(8) },
      error: null
    });
    renderPdfPageAsPng.mockResolvedValue(PNG);
  };

  it("answers with a PNG, not JSON", async () => {
    healthy();

    const response = await run(drawingRoute.loader, url(), PARAMS);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    // Still an API response: `apiRoute` owes the version header even on a
    // handler that built its own Response.
    expect(response.headers.get("carbon-api")).toBe("1");
    // One company's engineering drawing must never land in a shared cache.
    expect(response.headers.get("Cache-Control")).toContain("private");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
  });

  it("404s a lot belonging to another company", async () => {
    healthy();
    getInspection.mockResolvedValue({
      data: { id: LOT, companyId: "comp-2", inspectionDocumentId: "idoc_1" },
      error: null
    });

    const response = await run(drawingRoute.loader, url(), PARAMS);

    expect(response.status).toBe(404);
    // The lot id comes from the URL, so this is the tenant boundary. Nothing
    // may be read before it holds.
    expect(getInspectionDrawingStoragePath).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it("404s a lot whose company cannot be read at all", async () => {
    healthy();
    // A row with no companyId is not "allowed"; it is unverifiable.
    getInspection.mockResolvedValue({
      data: { id: LOT, inspectionDocumentId: "idoc_1" },
      error: null
    });

    const response = await run(drawingRoute.loader, url(), PARAMS);

    expect(response.status).toBe(404);
    expect(download).not.toHaveBeenCalled();
  });

  it("refuses a storage path outside the caller's company", async () => {
    healthy();
    getInspectionDrawingStoragePath.mockResolvedValue({
      // A loose `includes(companyId)` would serve this: it ends with the
      // caller's company id but belongs to another tenant's prefix.
      data: { id: "idoc_1", storagePath: `comp-2/inspection/${COMPANY}.pdf` },
      error: null
    });

    const response = await run(drawingRoute.loader, url(), PARAMS);

    expect(response.status).toBe(404);
    expect(download).not.toHaveBeenCalled();
  });

  it("refuses a storage path that escapes its prefix", async () => {
    healthy();
    getInspectionDrawingStoragePath.mockResolvedValue({
      data: {
        id: "idoc_1",
        storagePath: `${COMPANY}/../comp-2/inspection/dwg.pdf`
      },
      error: null
    });

    const response = await run(drawingRoute.loader, url(), PARAMS);

    expect(response.status).toBe(404);
    expect(download).not.toHaveBeenCalled();
  });

  it("reads the company bucket by the storage KEY, prefix stripped", async () => {
    healthy();
    getInspectionDrawingStoragePath.mockResolvedValue({
      // Some rows store the web preview route's path rather than the key.
      data: {
        id: "idoc_1",
        storagePath: `/file/preview/private/${COMPANY}/inspection/dwg.pdf`
      },
      error: null
    });

    await run(drawingRoute.loader, url(), PARAMS);

    expect(download).toHaveBeenCalledWith(`${COMPANY}/inspection/dwg.pdf`);
  });

  it("404s a lot with no drawing", async () => {
    healthy();
    getInspection.mockResolvedValue({
      data: { id: LOT, companyId: COMPANY, inspectionDocumentId: null },
      error: null
    });

    const response = await run(drawingRoute.loader, url(), PARAMS);

    expect(response.status).toBe(404);
    const payload = await response.json();
    expect(payload.error.message).toContain("no drawing");
  });

  it("404s a page past the end of the document", async () => {
    healthy();
    // The wire carries no page count, so asking past the end is how a client
    // finds it — a 404, never a 500.
    renderPdfPageAsPng.mockRejectedValue(new Error("Invalid page request"));

    const response = await run(drawingRoute.loader, url("?page=99"), PARAMS);

    expect(response.status).toBe(404);
  });

  it("refuses a page that is not a page number", async () => {
    healthy();

    for (const query of ["?page=0", "?page=-1", "?page=1.5", "?page=abc"]) {
      const response = await run(drawingRoute.loader, url(query), PARAMS);
      expect(response.status).toBe(400);
    }
    expect(renderPdfPageAsPng).not.toHaveBeenCalled();
  });

  it("renders page 1 at scale 3 by default", async () => {
    healthy();

    await run(drawingRoute.loader, url(), PARAMS);

    expect(renderPdfPageAsPng).toHaveBeenCalledWith(expect.anything(), 1, {
      scale: 3
    });
  });

  it("clamps the scale rather than refusing it", async () => {
    healthy();

    await run(drawingRoute.loader, url("?scale=50"), PARAMS);
    // An unbounded scale is a way to make one request render a
    // 40-megapixel canvas; asking for more detail than we will spend is not
    // itself an error.
    expect(renderPdfPageAsPng).toHaveBeenCalledWith(expect.anything(), 1, {
      scale: 4
    });

    renderPdfPageAsPng.mockClear();
    await run(drawingRoute.loader, url("?scale=0"), PARAMS);
    expect(renderPdfPageAsPng).toHaveBeenCalledWith(expect.anything(), 1, {
      scale: 3
    });
  });

  it("passes a page through, and reads with the service role", async () => {
    healthy();

    await run(drawingRoute.loader, url("?page=2&scale=2"), PARAMS);

    expect(getInspection).toHaveBeenCalledWith(serviceRole, LOT);
    expect(renderPdfPageAsPng).toHaveBeenCalledWith(expect.anything(), 2, {
      scale: 2
    });
  });

  it("400s with no inspection id", async () => {
    healthy();

    const response = await run(drawingRoute.loader, url(), {});

    expect(response.status).toBe(400);
    expect(getInspection).not.toHaveBeenCalled();
  });
});
