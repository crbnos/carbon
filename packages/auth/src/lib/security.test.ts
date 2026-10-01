// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  buildContentSecurityPolicy,
  isCrossOriginRequestAllowed,
  isCrossSiteNavigation
} from "./security";

const h = (headers: Record<string, string>) => new Headers(headers);
const erp = { host: "app.carbon.ms" };

describe("isCrossOriginRequestAllowed", () => {
  it("never checks safe methods", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(
        isCrossOriginRequestAllowed(
          method,
          "/x",
          h({ ...erp, "sec-fetch-site": "cross-site" })
        )
      ).toBe(true);
    }
  });

  it("refuses a cross-site or same-site browser POST", () => {
    for (const site of ["cross-site", "same-site"]) {
      expect(
        isCrossOriginRequestAllowed(
          "POST",
          "/x/sales-order/1.data",
          h({ ...erp, "sec-fetch-site": site })
        )
      ).toBe(false);
    }
  });

  it("allows a same-origin or user-initiated POST", () => {
    for (const site of ["same-origin", "none"]) {
      expect(
        isCrossOriginRequestAllowed(
          "POST",
          "/x",
          h({ ...erp, "sec-fetch-site": site })
        )
      ).toBe(true);
    }
  });

  it("falls back to Origin against the addressed host, not the internal URL", () => {
    expect(
      isCrossOriginRequestAllowed(
        "POST",
        "/x",
        h({
          host: "127.0.0.1:3000",
          "x-forwarded-host": "app.carbon.ms",
          origin: "https://app.carbon.ms"
        })
      )
    ).toBe(true);
    expect(
      isCrossOriginRequestAllowed(
        "POST",
        "/x",
        h({ ...erp, origin: "https://docs.carbon.ms" })
      )
    ).toBe(false);
    expect(
      isCrossOriginRequestAllowed("POST", "/x", h({ ...erp, origin: "null" }))
    ).toBe(false);
  });

  it("allows server-to-server calls, which send neither header", () => {
    expect(
      isCrossOriginRequestAllowed("POST", "/api/webhook/stripe", h(erp))
    ).toBe(true);
  });

  it("lets browsers reach the MCP endpoints from anywhere", () => {
    for (const path of ["/token", "/register", "/api/mcp", "/api/mcp/"]) {
      expect(
        isCrossOriginRequestAllowed(
          "POST",
          path,
          h({ ...erp, "sec-fetch-site": "cross-site" })
        )
      ).toBe(true);
    }
    expect(
      isCrossOriginRequestAllowed(
        "POST",
        "/authorize",
        h({ ...erp, "sec-fetch-site": "cross-site" })
      )
    ).toBe(false);
  });
});

describe("isCrossSiteNavigation", () => {
  it("only flags cross-site", () => {
    expect(isCrossSiteNavigation(h({ "sec-fetch-site": "cross-site" }))).toBe(
      true
    );
    for (const site of ["none", "same-origin", "same-site"]) {
      expect(isCrossSiteNavigation(h({ "sec-fetch-site": site }))).toBe(false);
    }
    expect(isCrossSiteNavigation(h({}))).toBe(false);
  });
});

describe("buildContentSecurityPolicy", () => {
  const policy = (options = {}) =>
    Object.fromEntries(
      buildContentSecurityPolicy({
        nonce: "abc",
        supabaseUrl: "https://api.carbon.ms",
        posthogHost: "https://us.posthog.com",
        ...options
      })
        .split("; ")
        .map((d) => [d.split(" ")[0], d.split(" ").slice(1)])
    );

  it("runs only nonced scripts, with no eval unless asked", () => {
    const p = policy();
    expect(p["script-src"]).toContain("'nonce-abc'");
    expect(p["script-src"]).toContain("'strict-dynamic'");
    expect(p["script-src"]).not.toContain("'unsafe-eval'");
    expect(policy({ allowEval: true })["script-src"]).toContain(
      "'unsafe-eval'"
    );
  });

  it("connects to Supabase over https and websockets", () => {
    expect(policy()["connect-src"]).toEqual(
      expect.arrayContaining([
        "https://api.carbon.ms",
        "wss://api.carbon.ms",
        "https://*.posthog.com"
      ])
    );
    expect(
      policy({ supabaseUrl: "http://localhost:54321" })["connect-src"]
    ).toContain("ws://localhost:54321");
  });

  it("keeps the baseline directives and adds extras", () => {
    const p = policy({
      extra: { "font-src": ["https://fonts.gstatic.com"] },
      reportUri: "/api/csp-report"
    });
    expect(p["object-src"]).toEqual(["'none'"]);
    expect(p["frame-ancestors"]).toEqual(["'self'"]);
    expect(p["font-src"]).toContain("https://fonts.gstatic.com");
    expect(p["report-uri"]).toEqual(["/api/csp-report"]);
  });
});
