import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PANEL_FORBIDDEN_MESSAGE,
  PanelUnauthorizedError,
  panelFetch
} from "./session-storage";

function answer(body: string, status: number, contentType?: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(body, {
          status,
          headers: contentType ? { "Content-Type": contentType } : {}
        })
    )
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("panelFetch", () => {
  it("sends the token as a bearer header", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await panelFetch("cps_token", "/api/x");
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
    expect(new Headers(init.headers).get("Authorization")).toBe(
      "Bearer cps_token"
    );
  });

  it("throws on a 401 so the panel offers sign-in again", async () => {
    answer("Unauthorized", 401);
    await expect(panelFetch("t", "/api/x")).rejects.toBeInstanceOf(
      PanelUnauthorizedError
    );
  });

  it("turns a plain-text 403 into readable JSON", async () => {
    // requirePermissions answers a panel token with the text "Forbidden";
    // reading that as JSON is what showed users a parser error.
    answer("Forbidden", 403, "text/plain");
    const response = await panelFetch("t", "/api/x");
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: PANEL_FORBIDDEN_MESSAGE,
      status: 403
    });
  });

  it("uses the permission wording even when a 403 is JSON", async () => {
    answer(JSON.stringify({ error: "nope" }), 403, "application/json");
    expect((await (await panelFetch("t", "/api/x")).json()).error).toBe(
      PANEL_FORBIDDEN_MESSAGE
    );
  });

  it("turns an HTML error page into a sentence, not a parser message", async () => {
    answer("<!doctype html><h1>502 Bad Gateway</h1>", 502, "text/html");
    const response = await panelFetch("t", "/api/x");
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error).toMatch(/unexpected response \(HTTP 502\)/);
  });

  it("passes a JSON error through untouched, so route messages survive", async () => {
    answer(
      JSON.stringify({ error: "Onshape is still building this BOM." }),
      504,
      "application/json; charset=utf-8"
    );
    expect(await (await panelFetch("t", "/api/x")).json()).toEqual({
      error: "Onshape is still building this BOM."
    });
  });

  it("never touches a successful response", async () => {
    answer("not json at all", 200, "text/plain");
    expect(await (await panelFetch("t", "/api/x")).text()).toBe(
      "not json at all"
    );
  });
});
