import { describe, expect, it } from "vitest";
import { getClientIp, isPrivateIp, normalizeIp } from "./ip";

describe("normalizeIp", () => {
  it("strips the IPv4-mapped IPv6 prefix", () => {
    expect(normalizeIp("::ffff:127.0.0.1")).toBe("127.0.0.1");
    expect(normalizeIp("::FFFF:203.0.113.9")).toBe("203.0.113.9");
  });

  it("passes plain addresses through", () => {
    expect(normalizeIp("203.0.113.9")).toBe("203.0.113.9");
    expect(normalizeIp("2001:db8::1")).toBe("2001:db8::1");
    expect(normalizeIp("  203.0.113.9  ")).toBe("203.0.113.9");
  });

  it("returns null for empty input", () => {
    expect(normalizeIp(null)).toBeNull();
    expect(normalizeIp(undefined)).toBeNull();
    expect(normalizeIp("")).toBeNull();
    expect(normalizeIp("   ")).toBeNull();
  });
});

describe("isPrivateIp", () => {
  it("detects loopback, including the IPv4-mapped form", () => {
    expect(isPrivateIp("127.0.0.1")).toBe(true);
    expect(isPrivateIp("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateIp("::1")).toBe(true);
  });

  it("detects RFC1918 and link-local ranges", () => {
    expect(isPrivateIp("10.1.2.3")).toBe(true);
    expect(isPrivateIp("192.168.0.42")).toBe(true);
    expect(isPrivateIp("172.16.0.1")).toBe(true);
    expect(isPrivateIp("172.31.255.255")).toBe(true);
    expect(isPrivateIp("169.254.1.1")).toBe(true);
    expect(isPrivateIp("fd12:3456::1")).toBe(true);
    expect(isPrivateIp("fe80::1")).toBe(true);
  });

  it("does not flag public addresses", () => {
    expect(isPrivateIp("203.0.113.9")).toBe(false);
    expect(isPrivateIp("172.32.0.1")).toBe(false);
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("2001:db8::1")).toBe(false);
    expect(isPrivateIp(null)).toBe(false);
  });
});

describe("getClientIp", () => {
  const req = (headers: Record<string, string>) =>
    new Request("https://erp.example.com/", { headers });

  it("returns the rightmost hop when no proxies are trusted", () => {
    expect(getClientIp(req({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe(
      "10.0.0.1"
    );
  });

  it("skips a trusted proxy count to reach the real client", () => {
    expect(
      getClientIp(req({ "x-forwarded-for": "9.9.9.9, 1.2.3.4, 10.0.0.1" }), {
        trustedProxyCount: 1
      })
    ).toBe("1.2.3.4");
  });

  it("ignores a client-seeded leftmost hop", () => {
    expect(
      getClientIp(req({ "x-forwarded-for": "evil, 1.2.3.4" }), {
        trustedProxyCount: 0
      })
    ).toBe("1.2.3.4");
  });

  it("skips explicitly trusted proxy addresses", () => {
    expect(
      getClientIp(req({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }), {
        trustedProxyIps: ["10.0.0.1"]
      })
    ).toBe("1.2.3.4");
  });

  it("strips an ALB port suffix", () => {
    expect(getClientIp(req({ "x-forwarded-for": "1.2.3.4:53819" }))).toBe(
      "1.2.3.4"
    );
  });

  it("normalizes IPv4-mapped IPv6", () => {
    expect(getClientIp(req({ "x-forwarded-for": "::ffff:127.0.0.1" }))).toBe(
      "127.0.0.1"
    );
  });

  it("falls back to x-real-ip when the chain is absent", () => {
    expect(getClientIp(req({ "x-real-ip": "1.2.3.4" }))).toBe("1.2.3.4");
  });

  it("returns null when no address headers are present", () => {
    expect(getClientIp(req({}))).toBeNull();
  });
});
