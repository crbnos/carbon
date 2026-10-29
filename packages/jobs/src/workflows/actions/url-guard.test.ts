// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import dns from "node:dns";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkOutboundUrl, checkWebhookUrl, guardedLookup } from "./url-guard";

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

  it("refuses carrier-grade NAT (100.64.0.0/10)", async () => {
    resolvesTo({ address: "100.100.0.1", family: 4 });
    expect(await checkOutboundUrl("https://cgnat.example.com")).toEqual({
      ok: false,
      reason: "That address is inside a private network."
    });
  });

  it("accepts the public addresses either side of the CGNAT range", async () => {
    resolvesTo({ address: "100.63.255.255", family: 4 });
    expect((await checkOutboundUrl("https://a.example.com")).ok).toBe(true);
    resolvesTo({ address: "100.128.0.1", family: 4 });
    expect((await checkOutboundUrl("https://b.example.com")).ok).toBe(true);
  });

  it("refuses the benchmarking range (198.18.0.0/15)", async () => {
    resolvesTo({ address: "198.19.100.1", family: 4 });
    expect(await checkOutboundUrl("https://bench.example.com")).toEqual({
      ok: false,
      reason: "That address is inside a private network."
    });
  });

  it("accepts 198.17 and 198.20, which are ordinary public space", async () => {
    resolvesTo({ address: "198.17.0.1", family: 4 });
    expect((await checkOutboundUrl("https://c.example.com")).ok).toBe(true);
    resolvesTo({ address: "198.20.0.1", family: 4 });
    expect((await checkOutboundUrl("https://d.example.com")).ok).toBe(true);
  });

  it("refuses an address carrying embedded credentials", async () => {
    resolvesTo({ address: "93.184.216.34", family: 4 });
    expect(
      await checkOutboundUrl("https://user:pass@example.com/hook")
    ).toEqual({
      ok: false,
      reason:
        "Remove the username and password from the address; use a header instead."
    });
  });

  it("refuses a username with no password too", async () => {
    resolvesTo({ address: "93.184.216.34", family: 4 });
    expect((await checkOutboundUrl("https://user@example.com")).ok).toBe(false);
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

/** The callback form, since `guardedLookup` uses `dns.lookup` not `dns.promises`. */
function lookupResolvesTo(...addresses: { address: string; family: number }[]) {
  return vi.spyOn(dns, "lookup").mockImplementation(((
    _host: string,
    _opts: unknown,
    cb: unknown
  ) => {
    (cb as (e: null, a: unknown) => void)(null, addresses);
  }) as never);
}

function lookup(
  options: dns.LookupOptions = {}
): Promise<{ err: Error | null; address: unknown; family?: number }> {
  return new Promise((resolve) => {
    guardedLookup("host.example.com", options, (err, address, family) =>
      resolve({ err, address, family })
    );
  });
}

describe("checkWebhookUrl", () => {
  it("accepts http, which event webhooks have always allowed", async () => {
    resolvesTo({ address: "93.184.216.34", family: 4 });
    expect(await checkWebhookUrl("http://example.com/hook")).toEqual({
      ok: true,
      url: new URL("http://example.com/hook")
    });
  });

  it("accepts credentials in the address", async () => {
    resolvesTo({ address: "93.184.216.34", family: 4 });
    expect((await checkWebhookUrl("https://u:p@example.com/hook")).ok).toBe(
      true
    );
  });

  it("refuses a scheme other than http or https", async () => {
    expect(await checkWebhookUrl("ftp://example.com/hook")).toEqual({
      ok: false,
      reason: "Only http and https addresses are allowed.",
      retryable: false
    });
  });

  it.each([
    ["http://127.0.0.1:8080/admin", "127.0.0.1"],
    ["http://10.0.0.5/internal", "10.0.0.5"],
    ["http://169.254.169.254/latest/meta-data/", "169.254.169.254"]
  ])("refuses %s", async (url, address) => {
    resolvesTo({ address, family: 4 });
    expect(await checkWebhookUrl(url)).toEqual({
      ok: false,
      reason: "That address is inside a private network.",
      retryable: false
    });
  });

  it("refuses a public-looking name that resolves inward", async () => {
    resolvesTo({ address: "192.168.1.10", family: 4 });
    expect((await checkWebhookUrl("https://hooks.example.com")).ok).toBe(false);
  });

  it("marks a failed lookup retryable, since DNS can recover", async () => {
    vi.spyOn(dns.promises, "lookup").mockRejectedValue(new Error("EAI_AGAIN"));
    expect(await checkWebhookUrl("https://hooks.example.com")).toEqual({
      ok: false,
      reason: "That address could not be found.",
      retryable: true
    });
  });
});

describe("guardedLookup", () => {
  it("passes a public address through as a single answer", async () => {
    lookupResolvesTo({ address: "93.184.216.34", family: 4 });
    expect(await lookup()).toEqual({
      err: null,
      address: "93.184.216.34",
      family: 4
    });
  });

  it("passes the whole list through when the socket asked for all", async () => {
    lookupResolvesTo(
      { address: "93.184.216.34", family: 4 },
      { address: "93.184.216.35", family: 4 }
    );
    const { err, address } = await lookup({ all: true });
    expect(err).toBeNull();
    expect(address).toEqual([
      { address: "93.184.216.34", family: 4 },
      { address: "93.184.216.35", family: 4 }
    ]);
  });

  it("refuses a private address at connection time", async () => {
    lookupResolvesTo({ address: "169.254.169.254", family: 4 });
    const { err } = await lookup();
    expect(err?.message).toBe("That address is inside a private network.");
  });

  it("refuses when only the second address is private", async () => {
    lookupResolvesTo(
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.5", family: 4 }
    );
    const { err } = await lookup({ all: true });
    expect(err?.message).toBe("That address is inside a private network.");
  });

  it("refuses an empty answer", async () => {
    lookupResolvesTo();
    const { err } = await lookup();
    expect(err?.message).toBe("That address could not be found.");
  });

  it("hands back the resolver's own failure", async () => {
    vi.spyOn(dns, "lookup").mockImplementation(((
      _host: string,
      _opts: unknown,
      cb: unknown
    ) => {
      (cb as (e: Error) => void)(new Error("ENOTFOUND"));
    }) as never);
    const { err } = await lookup();
    expect(err?.message).toBe("ENOTFOUND");
  });
});
