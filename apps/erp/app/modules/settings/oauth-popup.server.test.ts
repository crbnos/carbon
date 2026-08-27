import { describe, expect, it } from "vitest";
import { OAUTH_POPUP_MESSAGE } from "./oauth-popup";
import { oauthPopupResponse } from "./oauth-popup.server";

describe("oauthPopupResponse", () => {
  it("renders an html page carrying the result and the fallback url", async () => {
    const response = oauthPopupResponse(
      { integration: "onshape", ok: true },
      "http://localhost:3000/x/settings/integrations"
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(html).toContain(
      JSON.stringify({
        type: OAUTH_POPUP_MESSAGE,
        integration: "onshape",
        ok: true
      })
    );
    expect(html).toContain('"http://localhost:3000/x/settings/integrations"');
    expect(html).toContain(
      "opener.postMessage(message, window.location.origin)"
    );
    expect(html).toContain("window.close()");
  });

  it("carries the error code on failure", async () => {
    const response = oauthPopupResponse(
      { integration: "onshape", ok: false, error: "denied" },
      "http://localhost:3000/x/settings/integrations?integration=onshape&error=denied"
    );
    const html = await response.text();

    expect(html).toContain('"ok":false');
    expect(html).toContain('"error":"denied"');
    expect(html).toContain("integration=onshape&error=denied");
  });

  it("cannot be broken out of with a closing script tag", async () => {
    const response = oauthPopupResponse(
      { integration: "onshape", ok: true },
      "http://localhost:3000/</script><script>alert(1)</script>"
    );
    const html = await response.text();

    expect(html).not.toContain("</script><script>alert(1)");
    expect(html).toContain("\\u003c/script>");
  });
});
