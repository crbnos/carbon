// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  ApiClientError,
  isExpiredSession,
  isOperatorExpired,
  isRetrySameKey,
  mapErrorResponse,
  needsAppUpdate,
  networkError
} from "./errors";

/** A server that speaks v1, which is the normal case. */
const v1 = { get: (name: string) => (name === "carbon-api" ? "1" : null) };
const noVersion = { get: () => null };

function body(code: string, message: string, extra: object = {}) {
  return { error: { code, message, ...extra } };
}

describe("mapErrorResponse", () => {
  it("reads the server's code, message and field errors", () => {
    const err = mapErrorResponse(
      400,
      body("validation_failed", "Check the fields", {
        fields: { quantity: ["Must be positive"] }
      }),
      v1,
      "/api/v1/operations/op1/quantities"
    );
    expect(err.status).toBe(400);
    expect(err.code).toBe("validation_failed");
    expect(err.message).toBe("Check the fields");
    expect(err.fields).toEqual({ quantity: ["Must be positive"] });
  });

  it("reads a 404 on auth/code as a server that predates the mobile API", () => {
    const err = mapErrorResponse(404, null, v1, "/api/v1/auth/code");
    expect(err.code).toBe("server_too_old");
  });

  it("keeps a 404 elsewhere as a plain not-found", () => {
    const err = mapErrorResponse(
      404,
      body("not_found", "No such operation"),
      v1,
      "/api/v1/operations/op1"
    );
    expect(err.code).toBe("not_found");
  });

  it("treats a server that announces no version we speak as too old", () => {
    const err = mapErrorResponse(
      500,
      body("internal", "boom"),
      noVersion,
      "/api/v1/me"
    );
    expect(err.code).toBe("server_too_old");
  });

  it("falls back to a readable message when the body is not our shape", () => {
    const err = mapErrorResponse(502, "<html>gateway</html>", v1, "/api/v1/me");
    expect(err.code).toBe("internal");
    expect(err.message.length).toBeGreaterThan(0);
  });

  it("carries details through for a blocked rule", () => {
    const err = mapErrorResponse(
      409,
      body("blocked", "A storage rule refused this", {
        details: { ruleNames: ["No mixed lots"] }
      }),
      v1,
      "/api/v1/operations/op1/materials/issue"
    );
    expect(err.code).toBe("blocked");
    expect(err.details).toEqual({ ruleNames: ["No mixed lots"] });
  });
});

describe("isRetrySameKey", () => {
  it("retries what provably did not run", () => {
    expect(isRetrySameKey(networkError())).toBe(true);
    expect(
      isRetrySameKey(new ApiClientError(503, "retry_later", "Try again"))
    ).toBe(true);
    expect(
      isRetrySameKey(
        new ApiClientError(409, "request_in_progress", "Still working")
      )
    ).toBe(true);
  });

  it("never retries a stored 5xx — it may have partly applied", () => {
    expect(isRetrySameKey(new ApiClientError(500, "internal", "boom"))).toBe(
      false
    );
  });

  it("never retries a refusal the operator must see", () => {
    expect(isRetrySameKey(new ApiClientError(403, "forbidden", "No"))).toBe(
      false
    );
    expect(
      isRetrySameKey(new ApiClientError(409, "conflict", "Already done"))
    ).toBe(false);
    expect(
      isRetrySameKey(
        new ApiClientError(422, "idempotency_key_reused", "Reused")
      )
    ).toBe(false);
  });
});

describe("outcome predicates", () => {
  it("separates an expired session from an expired operator", () => {
    const session = new ApiClientError(401, "token_expired", "Expired");
    const operator = new ApiClientError(401, "operator_expired", "Pin in");
    expect(isExpiredSession(session)).toBe(true);
    expect(isOperatorExpired(session)).toBe(false);
    expect(isOperatorExpired(operator)).toBe(true);
    expect(isExpiredSession(operator)).toBe(false);
  });

  it("recognises an app that must be updated", () => {
    expect(
      needsAppUpdate(new ApiClientError(426, "update_required", "Update"))
    ).toBe(true);
    expect(needsAppUpdate(new ApiClientError(403, "forbidden", "No"))).toBe(
      false
    );
  });
});
