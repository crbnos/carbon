import { describe, expect, it } from "vitest";
import { onshapeFailure } from "./onshape-failure";

/** The shape the client throws, without loading the client and its env. */
class OnshapeApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public retryAfterSeconds?: number
  ) {
    super(message);
  }
}

const timeout = new OnshapeApiError(
  "Onshape request failed: timeout of 60000ms exceeded"
);

describe("onshapeFailure", () => {
  it("never passes axios's own text through", () => {
    for (const read of ["bom", "other"] as const) {
      expect(onshapeFailure(timeout, read).body.error).not.toMatch(/60000ms/);
    }
  });

  it("tells a cold BOM read to press Refresh, since Onshape is still building it", () => {
    const failure = onshapeFailure(timeout, "bom");
    expect(failure.status).toBe(504);
    expect(failure.body.error).toMatch(/still building this BOM/);
    expect(failure.body.error).toMatch(/Refresh/);
  });

  it("gives other timeouts the generic wording", () => {
    expect(onshapeFailure(timeout).body.error).toMatch(/didn't answer in time/);
  });

  it("separates a dead network from a timeout", () => {
    const refused = new OnshapeApiError(
      "Onshape request failed: connect ECONNREFUSED"
    );
    const failure = onshapeFailure(refused);
    expect(failure.status).toBe(502);
    expect(failure.body.error).toMatch(/couldn't reach Onshape/);
  });

  it("carries Retry-After into a rate-limit message", () => {
    const failure = onshapeFailure(new OnshapeApiError("x", 429, 30));
    expect(failure.status).toBe(429);
    expect(failure.body).toMatchObject({ retryAfterSeconds: 30 });
    expect(failure.body.error).toMatch(/30 seconds/);
  });

  it("falls back to a minute when Onshape gives no Retry-After", () => {
    const failure = onshapeFailure(new OnshapeApiError("x", 429));
    expect(failure.body.error).toMatch(/60 seconds/);
    expect(failure.body).not.toHaveProperty("retryAfterSeconds");
  });

  it("never answers Onshape's 401 or 403 as a 401", () => {
    // The panel reads a 401 as its own session being gone and signs the user
    // out; Onshape rejecting Carbon's stored grant is a different problem.
    for (const status of [401, 403]) {
      const failure = onshapeFailure(new OnshapeApiError("x", status));
      expect(failure.status).toBe(422);
      expect(failure.body.error).toMatch(/Reconnect Onshape/);
    }
  });

  it("names a missing document as missing", () => {
    expect(onshapeFailure(new OnshapeApiError("x", 404)).status).toBe(404);
  });

  it("reports any other Onshape status without echoing its body", () => {
    const failure = onshapeFailure(
      new OnshapeApiError('Onshape API error (500): {"stack":"secret"}', 500)
    );
    expect(failure.status).toBe(502);
    expect(failure.body.error).toMatch(/HTTP 500/);
    expect(failure.body.error).not.toMatch(/stack|secret/);
  });

  it("handles a non-Onshape throw", () => {
    expect(onshapeFailure(new Error("boom")).status).toBe(502);
    expect(onshapeFailure("not an error").status).toBe(502);
  });
});
