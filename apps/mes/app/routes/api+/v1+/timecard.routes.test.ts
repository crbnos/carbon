// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requireApiUser } from "@carbon/auth/api-user.server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { failed, ok } from "~/services/api-result.server";
import {
  clockInCommand,
  clockOutCommand,
  endShift
} from "~/services/commands.timecard.server";
import {
  action as clockIn,
  loader as clockInLoader
} from "./timecard.clock-in";
import {
  action as clockOut,
  loader as clockOutLoader
} from "./timecard.clock-out";
import {
  action as endShiftAction,
  loader as endShiftLoader
} from "./timecard.end-shift";

/**
 * The three time-card endpoints.
 *
 * The property that matters most here is WHO the hours belong to: on a shared
 * tablet the terminal is signed in but the pinned operator is working, so the
 * commands must receive `user.userId` (the operator) and never
 * `user.sessionUserId` (the terminal). A test that only checked status codes
 * would pass with the hours on the wrong person.
 */

// The real module's auth chain reaches `@carbon/content`'s glossary, whose
// lingui `msg` macro vitest does not transform — so `ApiError` and
// `apiErrorResponse` (both self-contained) are mirrored here.
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

vi.mock("./lib/idempotency.server", () => ({
  IDEMPOTENCY_HEADER: "idempotency-key",
  REPLAYED_HEADER: "idempotent-replayed",
  withIdempotency: vi.fn(async (_args: unknown, run: () => Promise<Response>) =>
    run()
  )
}));

vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: vi.fn(() => ({}))
}));

vi.mock("~/services/commands.timecard.server", () => ({
  clockInCommand: vi.fn(),
  clockOutCommand: vi.fn(),
  endShift: vi.fn()
}));

const OPERATOR = "user-operator";
const TERMINAL = "user-terminal";
const COMPANY = "comp-1";

function signedIn(consoleMode = true) {
  vi.mocked(requireApiUser).mockResolvedValue({
    companyId: COMPANY,
    userId: OPERATOR,
    sessionUserId: TERMINAL,
    consoleMode,
    accessToken: "token",
    email: "op@example.com",
    claims: { role: "employee", permissions: {} },
    client: {} as never
  } as never);
}

function request(path: string, body?: unknown, withKey = true) {
  return new Request(`http://localhost/api/v1/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(withKey ? { "idempotency-key": "key-1" } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

/** The route arg shape, so the calls below typecheck without an `as never`. */
type RouteArgs = Parameters<typeof clockIn>[0];

function args(request: Request): RouteArgs {
  return { request, params: {}, context: {} } as RouteArgs;
}

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
});

describe("clock in", () => {
  it("clocks in the pinned operator, not the terminal", async () => {
    vi.mocked(clockInCommand).mockResolvedValue(ok(null) as never);
    const response = await clockIn(args(request("timecard/clock-in")));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true });
    expect(clockInCommand).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ companyId: COMPANY, userId: OPERATOR })
    );
  });

  it("answers 405 to a GET and 400 without an Idempotency-Key", async () => {
    expect(
      (
        await clockInLoader(
          args(new Request("http://localhost/api/v1/timecard/clock-in"))
        )
      ).status
    ).toBe(405);

    const noKey = await clockIn(
      args(request("timecard/clock-in", undefined, false))
    );
    expect(noKey.status).toBe(400);
    expect((await noKey.json()).error.code).toBe("idempotency_key_required");
    expect(clockInCommand).not.toHaveBeenCalled();
  });

  it("maps a failure to its status", async () => {
    vi.mocked(clockInCommand).mockResolvedValue(
      failed({ kind: "conflict", message: "Already clocked in" }) as never
    );
    const response = await clockIn(args(request("timecard/clock-in")));
    expect(response.status).toBe(409);
    expect((await response.json()).error.message).toBe("Already clocked in");
  });
});

describe("clock out", () => {
  it("carries the operator's note through", async () => {
    vi.mocked(clockOutCommand).mockResolvedValue(ok(null) as never);
    const response = await clockOut(
      args(request("timecard/clock-out", { note: "Machine down" }))
    );
    expect(response.status).toBe(200);
    expect(clockOutCommand).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: OPERATOR }),
      expect.objectContaining({ note: "Machine down" })
    );
  });

  it("answers 405 to a GET", async () => {
    expect(
      (
        await clockOutLoader(
          args(new Request("http://localhost/api/v1/timecard/clock-out"))
        )
      ).status
    ).toBe(405);
  });

  it("accepts an empty body — the note is optional", async () => {
    vi.mocked(clockOutCommand).mockResolvedValue(ok(null) as never);
    const response = await clockOut(args(request("timecard/clock-out", {})));
    expect(response.status).toBe(200);
  });
});

describe("end shift", () => {
  it("reports whether the console pin-in ended, so the app drops its token", async () => {
    vi.mocked(endShift).mockResolvedValue(ok({ endedConsole: true }) as never);
    const response = await endShiftAction(args(request("timecard/end-shift")));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      endedConsole: true
    });
  });

  it("ends the shift for the operator, not the terminal", async () => {
    vi.mocked(endShift).mockResolvedValue(ok({ endedConsole: false }) as never);
    await endShiftAction(args(request("timecard/end-shift")));
    const scope = vi.mocked(endShift).mock.calls[0]?.[2] as
      | { userId?: string }
      | undefined;
    expect(scope?.userId).toBe(OPERATOR);
  });

  it("answers 405 to a GET", async () => {
    expect(
      (
        await endShiftLoader(
          args(new Request("http://localhost/api/v1/timecard/end-shift"))
        )
      ).status
    ).toBe(405);
  });

  it("maps a failure to its status", async () => {
    vi.mocked(endShift).mockResolvedValue(
      failed({ kind: "error", message: "Could not end shift" }) as never
    );
    const response = await endShiftAction(args(request("timecard/end-shift")));
    expect(response.status).toBe(500);
  });
});
