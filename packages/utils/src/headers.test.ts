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

  it("skips a trusted proxy count to reach the real client", () => {
    expect(
      getClientIp(req({ "x-forwarded-for": "9.9.9.9, 1.2.3.4, 10.0.0.1" }), {
        trustedProxyCount: 1
      })
    ).toBe("1.2.3.4");
  });

  it("never walks past the leftmost hop even when every hop is trusted", () => {
    expect(
      getClientIp(req({ "x-forwarded-for": "evil, 1.2.3.4" }), {
        trustedProxyCount: 5
      })
    ).toBe("evil");
  });

  it("skips explicitly trusted proxy addresses", () => {
    expect(
      getClientIp(req({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }), {
        trustedProxyIps: ["10.0.0.1"]
      })
    ).toBe("1.2.3.4");
  });

  it("strips a port suffix and the IPv4-mapped IPv6 prefix", () => {
    expect(getClientIp(req({ "x-forwarded-for": "1.2.3.4:53819" }))).toBe(
      "1.2.3.4"
    );
    expect(getClientIp(req({ "x-forwarded-for": "::ffff:127.0.0.1" }))).toBe(
      "127.0.0.1"
    );
    expect(getClientIp(req({ "x-forwarded-for": "[2001:db8::1]:443" }))).toBe(
      "2001:db8::1"
    );
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
