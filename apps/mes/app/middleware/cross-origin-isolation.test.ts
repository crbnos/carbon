import { describe, expect, it } from "vitest";
import { crossOriginIsolationMiddleware } from "./cross-origin-isolation";

describe("crossOriginIsolationMiddleware", () => {
  it("sets the COOP + COEP headers required for crossOriginIsolated", async () => {
    const next = async () => new Response("ok");
    const args = {} as Parameters<typeof crossOriginIsolationMiddleware>[0];

    const response = await crossOriginIsolationMiddleware(args, next);
    if (!(response instanceof Response)) {
      throw new Error("middleware did not return a Response");
    }

    expect(response.headers.get("Cross-Origin-Opener-Policy")).toBe(
      "same-origin"
    );
    expect(response.headers.get("Cross-Origin-Embedder-Policy")).toBe(
      "require-corp"
    );
  });

  it("preserves headers already present on the response", async () => {
    const next = async () =>
      new Response("ok", { headers: { "X-Existing": "kept" } });
    const args = {} as Parameters<typeof crossOriginIsolationMiddleware>[0];

    const response = await crossOriginIsolationMiddleware(args, next);
    if (!(response instanceof Response)) {
      throw new Error("middleware did not return a Response");
    }

    expect(response.headers.get("X-Existing")).toBe("kept");
  });
});
