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
