import { describe, expect, it } from "vitest";
import { isPrivateIp, normalizeIp } from "./ip";

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
