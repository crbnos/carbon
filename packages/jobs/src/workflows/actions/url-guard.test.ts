import dns from "node:dns";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkOutboundUrl } from "./url-guard";

/** Stubbed so no test performs real DNS. */
function resolvesTo(...addresses: { address: string; family: number }[]) {
  return vi.spyOn(dns.promises, "lookup").mockResolvedValue(addresses as never);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("checkOutboundUrl", () => {
  it("accepts an https address that resolves publicly", async () => {
    resolvesTo({ address: "93.184.216.34", family: 4 });
    const verdict = await checkOutboundUrl("https://example.com/hook");
    expect(verdict).toEqual({
      ok: true,
      url: new URL("https://example.com/hook")
    });
  });

  it("refuses a malformed address", async () => {
    expect(await checkOutboundUrl("not a url")).toEqual({
      ok: false,
      reason: "That is not a valid web address."
    });
  });

  it("refuses http", async () => {
    expect(await checkOutboundUrl("http://example.com")).toEqual({
      ok: false,
      reason: "Only https addresses are allowed."
    });
  });

  it("refuses loopback", async () => {
    resolvesTo({ address: "127.0.0.1", family: 4 });
    expect(await checkOutboundUrl("https://127.0.0.1")).toEqual({
      ok: false,
      reason: "That address is inside a private network."
    });
  });

  it("refuses the cloud metadata address", async () => {
    resolvesTo({ address: "169.254.169.254", family: 4 });
    expect(await checkOutboundUrl("https://169.254.169.254/latest")).toEqual({
      ok: false,
      reason: "That address is inside a private network."
    });
  });

  it("refuses a private range behind a public-looking name", async () => {
    resolvesTo({ address: "10.0.0.5", family: 4 });
    expect(await checkOutboundUrl("https://inside.example.com")).toEqual({
      ok: false,
      reason: "That address is inside a private network."
    });
  });

  it("refuses when any one of several addresses is private", async () => {
    resolvesTo(
      { address: "93.184.216.34", family: 4 },
      { address: "192.168.1.9", family: 4 }
    );
    expect(await checkOutboundUrl("https://both.example.com")).toEqual({
      ok: false,
      reason: "That address is inside a private network."
    });
  });

  it("refuses IPv6 loopback and unique-local", async () => {
    resolvesTo({ address: "::1", family: 6 });
    expect(await checkOutboundUrl("https://v6.example.com")).toEqual({
      ok: false,
      reason: "That address is inside a private network."
    });

    resolvesTo({ address: "fd00::1", family: 6 });
    expect(await checkOutboundUrl("https://v6.example.com")).toEqual({
      ok: false,
      reason: "That address is inside a private network."
    });
  });

  it("refuses an IPv4-mapped IPv6 address that wraps a private one", async () => {
    resolvesTo({ address: "::ffff:127.0.0.1", family: 6 });
    expect(await checkOutboundUrl("https://mapped.example.com")).toEqual({
      ok: false,
      reason: "That address is inside a private network."
    });
  });

  it("refuses a name that does not resolve", async () => {
    vi.spyOn(dns.promises, "lookup").mockRejectedValue(new Error("ENOTFOUND"));
    expect(await checkOutboundUrl("https://nowhere.example.com")).toEqual({
      ok: false,
      reason: "That address could not be found."
    });
  });
});
