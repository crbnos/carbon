// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  getClientIp,
  getRequestHost,
  getRequestOrigin,
  getRequestProtocol
} from "./headers";

const req = (
  headers: Record<string, string>,
  url = "http://127.0.0.1:3000/x"
) => new Request(url, { headers });

describe("getClientIp", () => {
  it("takes the address the proxy in front of us saw, not what the caller claimed", () => {
    // The ALB appends the real client to a caller-supplied header.
    expect(
      getClientIp(req({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }))
    ).toBe("203.0.113.9");
    expect(getClientIp(req({ "x-forwarded-for": "203.0.113.9" }))).toBe(
      "203.0.113.9"
    );
  });

  it("is null when no proxy reported one", () => {
    expect(getClientIp(req({}))).toBeNull();
    expect(getClientIp(req({ "x-forwarded-for": " , " }))).toBeNull();
  });

  it("skips our own proxies when there are several (TRUSTED_PROXIES)", () => {
    const before = process.env.TRUSTED_PROXIES;
    try {
      process.env.TRUSTED_PROXIES = "2";
      // Behind an ALB and then Traefik: a forged entry, the client the ALB
      // saw, then the ALB itself.
      expect(
        getClientIp(
          req({ "x-forwarded-for": "6.6.6.6, 203.0.113.9, 10.0.50.136" })
        )
      ).toBe("203.0.113.9");
      // Fewer entries than proxies: the first is the client.
      expect(getClientIp(req({ "x-forwarded-for": "203.0.113.9" }))).toBe(
        "203.0.113.9"
      );
      process.env.TRUSTED_PROXIES = "nonsense";
      expect(
        getClientIp(req({ "x-forwarded-for": "203.0.113.9, 10.0.50.136" }))
      ).toBe("10.0.50.136");
    } finally {
      if (before === undefined) delete process.env.TRUSTED_PROXIES;
      else process.env.TRUSTED_PROXIES = before;
    }
  });
});

describe("getRequestProtocol", () => {
  it("prefers the proxy's scheme over request.url's", () => {
    expect(getRequestProtocol(req({ "x-forwarded-proto": "https" }))).toBe(
      "https"
    );
    expect(
      getRequestProtocol(req({ "x-forwarded-proto": "HTTPS, http" }))
    ).toBe("https");
  });

  it("ignores anything that is not http or https", () => {
    expect(getRequestProtocol(req({ "x-forwarded-proto": "ftp" }))).toBe(
      "http"
    );
    expect(getRequestProtocol(req({}, "https://app.carbon.ms/x"))).toBe(
      "https"
    );
  });
});

describe("getRequestHost / getRequestOrigin", () => {
  it("uses the forwarded host, then Host, then request.url", () => {
    expect(
      getRequestHost(
        req({ "x-forwarded-host": "erp.x.dev, internal", host: "127.0.0.1" })
      )
    ).toBe("erp.x.dev");
    expect(getRequestHost(req({ host: "app.carbon.ms" }))).toBe(
      "app.carbon.ms"
    );
    expect(getRequestHost({ headers: new Headers() })).toBeNull();
  });

  it("builds the public origin behind a TLS-terminating proxy", () => {
    expect(
      getRequestOrigin(
        req({ "x-forwarded-host": "erp.x.dev", "x-forwarded-proto": "https" })
      )
    ).toBe("https://erp.x.dev");
  });
});
