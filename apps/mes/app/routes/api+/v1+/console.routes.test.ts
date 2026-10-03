// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requireApiUser } from "@carbon/auth/api-user.server";
import { logAuthEvent } from "@carbon/auth/auth-events.server";
import {
  signOperatorToken,
  terminalTokenMatches
} from "@carbon/auth/console-token.server";
import { isConsoleModeEnabledForCompany } from "@carbon/ee/console.server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PinInFailure } from "~/services/commands.console.server";
import { pinInOperator } from "~/services/commands.console.server";
import { action as pinIn, loader as pinInLoader } from "./console.pin-in";
import { action as pinOut, loader as pinOutLoader } from "./console.pin-out";
import {
  action as terminal,
  loader as terminalLoader
} from "./console.terminal";

/**
 * The three shared-terminal endpoints.
 *
 * What these have to prove is not that the routes return 200. It is that a
 * tablet cannot pin an operator in unless it holds a terminal token bound to
 * ITS OWN company and signed-in session, that a PIN is never even looked at
 * until that holds, that the operator claim is built from what the database
 * said rather than from the request body, and that the PIN never leaves in a
 * response or an audit event.
 *
 * The signing and the rejections that depend on real crypto — a tampered
 * signature, an expired claim, a token minted for another terminal or another
 * company, a terminal token offered as an operator token — are pinned against
 * the real HS256 implementation in
 * `packages/auth/src/services/console-token.server.test.ts`.
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

vi.mock("@carbon/auth/console-token.server", () => ({
  signTerminalToken: vi.fn().mockResolvedValue("terminal.token.sig"),
  signOperatorToken: vi.fn().mockResolvedValue("operator.token.sig"),
  terminalTokenMatches: vi.fn()
}));

vi.mock("@carbon/auth/console-pin.server", () => ({
  consolePinMaxAgeMs: () => 60 * 60 * 1000
}));

vi.mock("@carbon/auth/auth-events.server", () => ({
  logAuthEvent: vi.fn()
}));

vi.mock("@carbon/ee/console.server", () => ({
  isConsoleModeEnabledForCompany: vi.fn()
}));

// Builds a real Postgres pool at module load.
vi.mock("~/services/database.server", () => ({
  getDatabaseClient: vi.fn(() => ({ kind: "kysely" }))
}));

vi.mock("~/services/commands.console.server", () => ({
  pinInOperator: vi.fn()
}));

const COMPANY = "comp-1";
const TERMINAL = "user-terminal";
const OPERATOR = "user-operator";
const PIN = "4821";
const PINNED_AT = 1790931600000;

function signedIn({
  consoleMode = false,
  userId = TERMINAL
}: {
  consoleMode?: boolean;
  userId?: string;
} = {}) {
  vi.mocked(requireApiUser).mockResolvedValue({
    companyId: COMPANY,
    userId,
    sessionUserId: TERMINAL,
    consoleMode,
    accessToken: "token",
    email: "terminal@example.com",
    claims: { role: "employee", permissions: {} },
    client: {} as never
  } as never);
}

function request(path: string, body?: unknown, headers: HeadersInit = {}) {
  return new Request(`http://localhost/api/v1/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

type RouteArgs = Parameters<typeof pinIn>[0];

function args(req: Request): RouteArgs {
  return { request: req, params: {}, context: {} } as RouteArgs;
}

const pinInRequest = (body: unknown = { userId: OPERATOR, pin: PIN }) =>
  args(request("console/pin-in", body, { "x-carbon-terminal": "tok" }));

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  vi.mocked(isConsoleModeEnabledForCompany).mockResolvedValue(true);
  vi.mocked(terminalTokenMatches).mockResolvedValue(true);
  vi.mocked(pinInOperator).mockResolvedValue({
    ok: true,
    operator: {
      userId: OPERATOR,
      name: "Op One",
      avatarUrl: null,
      pinnedAt: PINNED_AT
    }
  });
});

describe("POST /console/terminal", () => {
  it("mints a token bound to the signed-in terminal session", async () => {
    const response = await terminal(args(request("console/terminal")));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      terminalToken: "terminal.token.sig"
    });
  });

  it("takes settings_update — a terminal is set up by a supervisor", async () => {
    await terminal(args(request("console/terminal")));

    expect(requireApiUser).toHaveBeenCalledWith(
      expect.anything(),
      { update: "settings" },
      undefined
    );
  });

  it.each([
    ["off for the company", false],
    ["unreadable", null]
  ])("refuses when console mode is %s", async (_label, answer) => {
    vi.mocked(isConsoleModeEnabledForCompany).mockResolvedValue(answer);

    const response = await terminal(args(request("console/terminal")));
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("forbidden");
  });

  it("needs no Idempotency-Key — it writes no business row", async () => {
    const response = await terminal(args(request("console/terminal")));
    expect(response.status).toBe(200);
  });

  it("answers 405 to a GET", async () => {
    expect(
      (
        await terminalLoader(
          args(new Request("http://localhost/api/v1/console/terminal"))
        )
      ).status
    ).toBe(405);
  });
});

describe("POST /console/pin-in", () => {
  it("checks the terminal token against THIS terminal's session, not the operator", async () => {
    // A tablet already carrying a pinned-in operator is handing over to the
    // next one. The binding — and the rate-limit budget — belong to the
    // terminal session; reading `user.userId` here would bind the claim to
    // whoever happened to be pinned in.
    signedIn({ consoleMode: true, userId: "someone-already-pinned-in" });

    await pinIn(pinInRequest());

    expect(terminalTokenMatches).toHaveBeenCalledWith("tok", {
      companyId: COMPANY,
      sessionUserId: TERMINAL
    });
    expect(pinInOperator).toHaveBeenCalledWith(
      expect.objectContaining({ sessionUserId: TERMINAL })
    );
  });

  it("never looks at a PIN without a bound terminal token", async () => {
    vi.mocked(terminalTokenMatches).mockResolvedValue(false);

    const response = await pinIn(pinInRequest());

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("forbidden");
    expect(pinInOperator).not.toHaveBeenCalled();
  });

  it.each([
    ["off for the company", false],
    ["unreadable", null]
  ])("never looks at a PIN when console mode is %s", async (_label, answer) => {
    vi.mocked(isConsoleModeEnabledForCompany).mockResolvedValue(answer);

    const response = await pinIn(pinInRequest());

    expect(response.status).toBe(403);
    expect(pinInOperator).not.toHaveBeenCalled();
  });

  it("signs the claim from what the database said, plus the request's own scope", async () => {
    const response = await pinIn(pinInRequest());

    expect(response.status).toBe(200);
    // Not from the body: the operator's display name and avatar come back
    // from `pinInOperator`'s employee lookup, and the company and terminal
    // session come from the authenticated request.
    expect(signOperatorToken).toHaveBeenCalledWith({
      userId: OPERATOR,
      name: "Op One",
      avatarUrl: null,
      pinnedAt: PINNED_AT,
      companyId: COMPANY,
      sessionUserId: TERMINAL
    });
    expect(await response.json()).toEqual({
      operatorToken: "operator.token.sig",
      operator: { userId: OPERATOR, name: "Op One", avatarUrl: null },
      expiresAt: PINNED_AT + 60 * 60 * 1000
    });
  });

  it("passes the PIN to the verifier and nowhere else", async () => {
    const response = await pinIn(pinInRequest());
    const body = await response.text();

    expect(pinInOperator).toHaveBeenCalledWith(
      expect.objectContaining({ pin: PIN, userId: OPERATOR })
    );
    expect(body).not.toContain(PIN);
    for (const call of vi.mocked(logAuthEvent).mock.calls) {
      expect(JSON.stringify(call)).not.toContain(PIN);
    }
  });

  it("keeps the PIN out of an audit event on a wrong guess too", async () => {
    vi.mocked(pinInOperator).mockResolvedValue({
      ok: false,
      failure: { status: 400, code: "invalid_pin", message: "Incorrect PIN" }
    });

    const response = await pinIn(pinInRequest());

    expect(await response.text()).not.toContain(PIN);
    for (const call of vi.mocked(logAuthEvent).mock.calls) {
      expect(JSON.stringify(call)).not.toContain(PIN);
    }
  });

  const failures: Array<[string, PinInFailure, number, string]> = [
    [
      "a wrong PIN",
      { status: 400, code: "invalid_pin", message: "Incorrect PIN" },
      400,
      "invalid_code"
    ],
    [
      "a locked operator",
      { status: 429, code: "locked", message: "Too many" },
      429,
      "locked"
    ],
    [
      "a spent terminal budget",
      { status: 429, code: "rate_limited", message: "Too many" },
      429,
      "rate_limited"
    ],
    [
      "an unknown employee",
      { status: 400, code: "forbidden", message: "Employee not found" },
      400,
      "validation_failed"
    ]
  ];

  it.each(
    failures
  )("maps %s to its status", async (_label, failure, status, code) => {
    vi.mocked(pinInOperator).mockResolvedValue({ ok: false, failure });

    const response = await pinIn(pinInRequest());

    expect(response.status).toBe(status);
    const json = await response.json();
    expect(json.error.code).toBe(code);
    expect(json.error.message).toBe(failure.message);
    expect(json).not.toHaveProperty("operatorToken");
  });

  it("refuses a body that is not a bare PIN before any verifier runs", async () => {
    const response = await pinIn(
      pinInRequest({ userId: OPERATOR, pin: "not-a-pin" })
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("validation_failed");
    expect(pinInOperator).not.toHaveBeenCalled();
  });

  it("needs no Idempotency-Key — a PIN must not be fingerprinted into Redis", async () => {
    const response = await pinIn(pinInRequest());
    expect(response.status).toBe(200);
  });

  it("answers 405 to a GET", async () => {
    expect(
      (
        await pinInLoader(
          args(new Request("http://localhost/api/v1/console/pin-in"))
        )
      ).status
    ).toBe(405);
  });
});

describe("POST /console/pin-out", () => {
  it("attributes the pin-out to the operator who was working", async () => {
    signedIn({ consoleMode: true, userId: OPERATOR });

    const response = await pinOut(args(request("console/pin-out")));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(logAuthEvent).toHaveBeenCalledWith(
      "logout",
      expect.objectContaining({
        userId: OPERATOR,
        terminalUserId: TERMINAL,
        companyId: COMPANY
      })
    );
  });

  it("hands back a blank operator header so nothing resurrects the claim", async () => {
    signedIn({ consoleMode: true, userId: OPERATOR });

    const response = await pinOut(args(request("console/pin-out")));

    expect(response.headers.get("x-carbon-operator")).toBe("");
  });

  it("refuses when nobody is pinned in", async () => {
    const response = await pinOut(args(request("console/pin-out")));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("validation_failed");
    expect(logAuthEvent).not.toHaveBeenCalled();
  });

  it("answers 405 to a GET", async () => {
    expect(
      (
        await pinOutLoader(
          args(new Request("http://localhost/api/v1/console/pin-out"))
        )
      ).status
    ).toBe(405);
  });
});
