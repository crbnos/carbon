// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requireApiUser } from "@carbon/auth/api-user.server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { failed, ok } from "~/services/api-result.server";
import {
  getPickingListScreen,
  getPickingScreen,
  getPickingTrackedOptionsScreen,
  getTimecardScreen
} from "~/services/screens.server";
import { loader as picking } from "./picking._index";
import { loader as pickingList } from "./picking.$listId._index";
import { loader as trackedOptions } from "./picking.$listId.lines.$lineId.tracked-options";
import { loader as timecard } from "./timecard._index";

/**
 * The four picking / time-card SCREEN reads.
 *
 * The screen functions themselves are shared with the web loaders and read the
 * database, so they are stubbed here (the one boundary this process cannot
 * reach) and what is under test is what the route decides:
 *
 *  - which COMPANY the read is scoped to, and WHOSE work it is — on a shared
 *    tablet the terminal is signed in but the pinned operator is picking, so a
 *    read must take `user.userId` and never `user.sessionUserId`. A test that
 *    only checked status codes would pass with another operator's list on screen.
 *  - that an id from the URL is handed to a read that re-scopes it, and that the
 *    read's `not_found` becomes a 404 rather than a 200 with no body.
 *  - that the deferred read the web streams through `Await` is AWAITED here —
 *    a promise left in the payload serializes as `{}`.
 *  - that `weekOffset` is parsed rather than passed through as `NaN`, which
 *    `weekBounds` would resolve to an empty week.
 */

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

// The idempotency window needs a live Redis. No GET goes through it (only an
// authenticated POST does), but `apiRoute` imports it at module scope.
vi.mock("./lib/idempotency.server", () => ({
  IDEMPOTENCY_HEADER: "idempotency-key",
  REPLAYED_HEADER: "idempotent-replayed",
  withIdempotency: vi.fn(async (_args: unknown, run: () => Promise<Response>) =>
    run()
  )
}));

vi.mock("~/services/screens.server", () => ({
  getPickingScreen: vi.fn(),
  getPickingListScreen: vi.fn(),
  getPickingTrackedOptionsScreen: vi.fn(),
  getTimecardScreen: vi.fn()
}));

const OPERATOR = "user-operator";
const TERMINAL = "user-terminal";
const COMPANY = "comp-1";
/** What `user.client` is: an RLS client for the signed-in user. */
const RLS_CLIENT = { tag: "rls" };

type RouteFn = (args: {
  request: Request;
  params: Record<string, string | undefined>;
  context: unknown;
}) => Promise<Response>;

function get(path: string) {
  return new Request(`http://mes.test/api/v1/${path}`);
}

function run(
  route: unknown,
  request: Request,
  params: Record<string, string | undefined> = {}
) {
  return (route as RouteFn)({ request, params, context: {} });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireApiUser).mockResolvedValue({
    companyId: COMPANY,
    userId: OPERATOR,
    sessionUserId: TERMINAL,
    consoleMode: true,
    accessToken: "token",
    email: "op@example.com",
    claims: { role: "employee", permissions: {} },
    client: RLS_CLIENT as never
  } as never);
});

describe("GET /api/v1/picking", () => {
  it("reads the lists of the pinned operator in the caller's company", async () => {
    vi.mocked(getPickingScreen).mockResolvedValue(
      ok({ pickingLists: [{ id: "pl_1" }] }) as never
    );

    const response = await run(picking, get("picking"));

    expect(response.status).toBe(200);
    expect(response.headers.get("carbon-api")).toBe("1");
    expect(await response.json()).toEqual({
      pickingLists: [{ id: "pl_1" }]
    });

    expect(getPickingScreen).toHaveBeenCalledWith(RLS_CLIENT, {
      companyId: COMPANY,
      // The OPERATOR, not the terminal that is signed in.
      effectiveUserId: OPERATOR
    });
  });

  it("405s a POST", async () => {
    const response = await run(
      picking,
      new Request("http://mes.test/api/v1/picking", { method: "POST" })
    );

    expect(response.status).toBe(405);
    expect(getPickingScreen).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/picking/:listId", () => {
  const PARAMS = { listId: "pl_1" };

  it("scopes the path's list to the caller's company and awaits the deferred lots", async () => {
    vi.mocked(getPickingListScreen).mockResolvedValue(
      ok({
        pickingList: { id: "pl_1", status: "In Progress", lines: [] },
        // The web streams this through `Await`; the API must resolve it.
        recommendations: Promise.resolve({
          pll_1: [{ trackedEntityId: "te_1", readableId: "LOT-1" }]
        })
      }) as never
    );

    const response = await run(pickingList, get("picking/pl_1"), PARAMS);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      pickingList: { id: "pl_1", status: "In Progress", lines: [] },
      recommendations: {
        pll_1: [{ trackedEntityId: "te_1", readableId: "LOT-1" }]
      }
    });

    expect(getPickingListScreen).toHaveBeenCalledWith(RLS_CLIENT, {
      companyId: COMPANY,
      pickingListId: "pl_1"
    });
  });

  it("404s a list that is not in the caller's company", async () => {
    vi.mocked(getPickingListScreen).mockResolvedValue(
      failed({ kind: "not_found", message: "Picking list not found" }) as never
    );

    const response = await run(pickingList, get("picking/pl_other"), {
      listId: "pl_other"
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "not_found", message: "Picking list not found" }
    });
  });

  it("400s when the path carries no list", async () => {
    const response = await run(pickingList, get("picking/"), {});

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("validation_failed");
    expect(getPickingListScreen).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/picking/:listId/lines/:lineId/tracked-options", () => {
  const PARAMS = { listId: "pl_1", lineId: "pll_1" };
  const URL_ = "picking/pl_1/lines/pll_1/tracked-options";

  it("hands the read both ids, so the line is checked against its list", async () => {
    vi.mocked(getPickingTrackedOptionsScreen).mockResolvedValue(
      ok({
        entities: [{ trackedEntityId: "te_1", availableQuantity: 4 }],
        trackingType: "Batch",
        quantityRequired: 2,
        nearExpiryWarningDays: 30,
        expiredEntityPolicy: "Warn",
        defaultOrder: "FEFO"
      }) as never
    );

    const response = await run(trackedOptions, get(URL_), PARAMS);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      trackingType: "Batch",
      quantityRequired: 2,
      defaultOrder: "FEFO"
    });

    expect(getPickingTrackedOptionsScreen).toHaveBeenCalledWith(RLS_CLIENT, {
      companyId: COMPANY,
      pickingListId: "pl_1",
      lineId: "pll_1"
    });
  });

  it("404s a line that is not in the company, or not on that list", async () => {
    vi.mocked(getPickingTrackedOptionsScreen).mockResolvedValue(
      failed({ kind: "not_found", message: "Line not found" }) as never
    );

    const response = await run(trackedOptions, get(URL_), PARAMS);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "not_found", message: "Line not found" }
    });
  });

  it("400s when the path carries no line", async () => {
    const response = await run(trackedOptions, get(URL_), { listId: "pl_1" });

    expect(response.status).toBe(400);
    expect(getPickingTrackedOptionsScreen).not.toHaveBeenCalled();
  });

  it("405s a POST — picking a lot is the sibling `tracked` endpoint", async () => {
    const response = await run(
      trackedOptions,
      new Request(`http://mes.test/api/v1/${URL_}`, { method: "POST" }),
      PARAMS
    );

    expect(response.status).toBe(405);
    expect(getPickingTrackedOptionsScreen).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/timecard", () => {
  const SCREEN = ok({
    entries: [],
    openEntry: null,
    weekOffset: 0,
    weekStart: "2026-09-28",
    weekEnd: "2026-10-04"
  });

  it("reads the pinned operator's hours, not the terminal's, and defaults to this week", async () => {
    vi.mocked(getTimecardScreen).mockResolvedValue(SCREEN as never);

    const response = await run(timecard, get("timecard"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      weekStart: "2026-09-28",
      weekEnd: "2026-10-04"
    });

    expect(getTimecardScreen).toHaveBeenCalledWith(RLS_CLIENT, {
      companyId: COMPANY,
      userId: OPERATOR,
      weekOffset: 0
    });
  });

  it("carries a past week through", async () => {
    vi.mocked(getTimecardScreen).mockResolvedValue(SCREEN as never);

    await run(timecard, get("timecard?weekOffset=-2"));

    expect(getTimecardScreen).toHaveBeenCalledWith(
      RLS_CLIENT,
      expect.objectContaining({ weekOffset: -2 })
    );
  });

  it.each([
    "last",
    "1.5",
    "NaN"
  ])("400s weekOffset=%s instead of reading a NaN week", async (bad) => {
    vi.mocked(getTimecardScreen).mockResolvedValue(SCREEN as never);

    const response = await run(
      timecard,
      get(`timecard?weekOffset=${encodeURIComponent(bad)}`)
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error.fields).toEqual({
      weekOffset: ["weekOffset must be a whole number of weeks"]
    });
    expect(getTimecardScreen).not.toHaveBeenCalled();
  });

  it("treats a blank weekOffset as this week, like an absent one", async () => {
    vi.mocked(getTimecardScreen).mockResolvedValue(SCREEN as never);

    const response = await run(timecard, get("timecard?weekOffset=%20"));

    expect(response.status).toBe(200);
    expect(getTimecardScreen).toHaveBeenCalledWith(
      RLS_CLIENT,
      expect.objectContaining({ weekOffset: 0 })
    );
  });

  it("405s a POST", async () => {
    const response = await run(
      timecard,
      new Request("http://mes.test/api/v1/timecard", { method: "POST" })
    );

    expect(response.status).toBe(405);
    expect(getTimecardScreen).not.toHaveBeenCalled();
  });
});
