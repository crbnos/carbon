// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requireApiUser } from "@carbon/auth/api-user.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { operationQueueScreen } from "@carbon/mes-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok } from "~/services/api-result.server";
import {
  getActiveScreen,
  getAssignedScreen,
  getRecentScreen
} from "~/services/screens.server";
import { loader as active } from "./operations.active";
import { loader as assigned } from "./operations.assigned";
import { loader as recent } from "./operations.recent";

/**
 * The three personal operation queues.
 *
 * The screen functions are shared with the web loaders and read the database,
 * so they are stubbed here (the one boundary this process cannot reach) and
 * what is under test is what the ROUTE decides — which is where these three
 * endpoints differ from each other and from their web counterparts:
 *
 *  - WHICH CLIENT. `assigned` must read with the service role and `active` /
 *    `recent` as the signed-in user, because that is what each web loader does.
 *    Reading `assigned` as the user would silently drop the operations of an
 *    operator without `production_view`; reading `active` as the service role
 *    would show more than the browser does. A status-code test passes either way.
 *  - WHOSE WORK. On a shared tablet the terminal account is signed in and the
 *    pinned operator is working, so every read must take `user.userId` and never
 *    `user.sessionUserId` — otherwise an operator is handed the queue of the
 *    terminal, which is nobody's.
 *  - WHAT IS SHIPPED. `getAssignedScreen` also returns every work center in the
 *    company, for the web board's empty columns. The endpoint must not forward
 *    them.
 *
 * Each response is parsed with the SHARED `operationQueueScreen`, so a server
 * that stops satisfying the contract fails here rather than in the app's zod on
 * a shop floor.
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
          error: { code: err.code, message: err.message }
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

vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: vi.fn(() => ({ tag: "service-role" }))
}));

vi.mock("~/services/screens.server", () => ({
  getAssignedScreen: vi.fn(),
  getActiveScreen: vi.fn(),
  getRecentScreen: vi.fn()
}));

const OPERATOR = "user-operator";
const TERMINAL = "user-terminal";
const COMPANY = "comp-1";
/** What `user.client` is: an RLS client for the signed-in user. */
const RLS_CLIENT = { tag: "rls" };
const SERVICE_ROLE = { tag: "service-role" };

/** A row as the three RPCs return it, after `makeDurations`. */
const OPERATION = {
  id: "jo_1",
  jobReadableId: "JOB-0001",
  itemReadableId: "PART-100",
  itemDescription: "Bracket",
  description: "Deburr",
  operationStatus: "In Progress",
  jobDeadlineType: "Hard Deadline",
  jobDueDate: "2026-10-20",
  operationDueDate: "2026-10-18",
  operationQuantity: 10,
  targetQuantity: 12,
  quantityComplete: 3,
  quantityScrapped: 0,
  workCenterId: "wc_1",
  thumbnailPath: null,
  assignee: OPERATOR,
  tags: ["rush"],
  salesOrderReadableId: "SO-0009",
  duration: 3_600_000,
  setupDuration: 600_000,
  laborDuration: 3_000_000,
  machineDuration: 0
};

type RouteFn = (args: {
  request: Request;
  params: Record<string, string | undefined>;
  context: unknown;
}) => Promise<Response>;

function get(path: string) {
  return new Request(`http://mes.test/api/v1/${path}`);
}

function run(route: unknown, request: Request) {
  return (route as RouteFn)({ request, params: {}, context: {} });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCarbonServiceRole).mockReturnValue(SERVICE_ROLE as never);
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

describe("GET /api/v1/operations/assigned", () => {
  it("reads the pinned operator's queue with the service role, as the web does", async () => {
    vi.mocked(getAssignedScreen).mockResolvedValue(
      ok({
        operations: [OPERATION],
        workCenters: [{ id: "wc_1", name: "Lathe" }],
        locationId: null
      }) as never
    );

    const response = await run(assigned, get("operations/assigned"));

    expect(response.status).toBe(200);
    expect(response.headers.get("carbon-api")).toBe("1");

    const body = await response.json();
    // Only the operations: the work centers are the web board's, not a card's.
    expect(Object.keys(body)).toEqual(["operations"]);
    expect(operationQueueScreen.parse(body).operations[0]).toMatchObject({
      id: "jo_1",
      operationStatus: "In Progress",
      jobDueDate: "2026-10-20",
      operationDueDate: "2026-10-18"
    });

    expect(getAssignedScreen).toHaveBeenCalledWith(SERVICE_ROLE, {
      companyId: COMPANY,
      // The OPERATOR, not the terminal that is signed in.
      userId: OPERATOR,
      locationId: null
    });
  });

  it("405s a POST", async () => {
    const response = await run(
      assigned,
      new Request("http://mes.test/api/v1/operations/assigned", {
        method: "POST"
      })
    );

    expect(response.status).toBe(405);
    expect(getAssignedScreen).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/operations/active", () => {
  it("reads the pinned operator's open timers as that user, not the service role", async () => {
    vi.mocked(getActiveScreen).mockResolvedValue(
      ok({ operations: [OPERATION] }) as never
    );

    const response = await run(active, get("operations/active"));

    expect(response.status).toBe(200);
    expect(operationQueueScreen.parse(await response.json())).toEqual({
      operations: [OPERATION]
    });

    expect(getActiveScreen).toHaveBeenCalledWith(RLS_CLIENT, {
      companyId: COMPANY,
      userId: OPERATOR
    });
    expect(getCarbonServiceRole).not.toHaveBeenCalled();
  });

  it("answers an operator with no open timer with an empty queue, not a 404", async () => {
    vi.mocked(getActiveScreen).mockResolvedValue(
      ok({ operations: [] }) as never
    );

    const response = await run(active, get("operations/active"));

    expect(response.status).toBe(200);
    expect(operationQueueScreen.parse(await response.json())).toEqual({
      operations: []
    });
  });

  it("405s a POST", async () => {
    const response = await run(
      active,
      new Request("http://mes.test/api/v1/operations/active", {
        method: "POST"
      })
    );

    expect(response.status).toBe(405);
    expect(getActiveScreen).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/operations/recent", () => {
  it("reads the pinned operator's history as that user, not the service role", async () => {
    vi.mocked(getRecentScreen).mockResolvedValue(
      ok({ operations: [OPERATION] }) as never
    );

    const response = await run(recent, get("operations/recent"));

    expect(response.status).toBe(200);
    expect(operationQueueScreen.parse(await response.json())).toEqual({
      operations: [OPERATION]
    });

    expect(getRecentScreen).toHaveBeenCalledWith(RLS_CLIENT, {
      companyId: COMPANY,
      userId: OPERATOR
    });
    expect(getCarbonServiceRole).not.toHaveBeenCalled();
  });

  it("405s a POST", async () => {
    const response = await run(
      recent,
      new Request("http://mes.test/api/v1/operations/recent", {
        method: "POST"
      })
    );

    expect(response.status).toBe(405);
    expect(getRecentScreen).not.toHaveBeenCalled();
  });
});
