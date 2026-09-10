import { beforeEach, describe, expect, it, vi } from "vitest";

// The Resolver is the only piece of node:dns the module touches. Each test
// programs `resolveTxt` and asserts the discriminated result — the module must
// never throw, whatever the resolver does.
const resolveTxt = vi.fn();
const setServers = vi.fn();

vi.mock("node:dns/promises", () => ({
  Resolver: class {
    setServers = setServers;
    resolveTxt = resolveTxt;
  }
}));

const {
  checkDomainVerification,
  generateVerificationToken,
  getTxtRecord,
  TXT_HOST_PREFIX,
  TXT_VALUE_PREFIX
} = await import("./verification.server");

function dnsError(code: string) {
  const e = new Error(code) as NodeJS.ErrnoException;
  e.code = code;
  return e;
}

beforeEach(() => {
  resolveTxt.mockReset();
  setServers.mockClear();
});

describe("generateVerificationToken", () => {
  it("returns 32 hex chars (128 bits) and never repeats", () => {
    const a = generateVerificationToken();
    const b = generateVerificationToken();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});

describe("getTxtRecord", () => {
  it("builds the underscore challenge host and prefixed value", () => {
    expect(getTxtRecord("acme.com", "abc123")).toEqual({
      host: `${TXT_HOST_PREFIX}.acme.com`,
      value: `${TXT_VALUE_PREFIX}=abc123`
    });
  });
});

describe("checkDomainVerification", () => {
  const token = "a".repeat(32);
  const expected = `${TXT_VALUE_PREFIX}=${token}`;

  it("verifies when a TXT record matches the token exactly", async () => {
    resolveTxt.mockResolvedValue([["unrelated"], [expected]]);
    await expect(checkDomainVerification("acme.com", token)).resolves.toEqual({
      verified: true
    });
    expect(resolveTxt).toHaveBeenCalledWith(`${TXT_HOST_PREFIX}.acme.com`);
  });

  it("joins a chunked TXT record before comparing (255-byte chunk split)", async () => {
    const mid = Math.floor(expected.length / 2);
    resolveTxt.mockResolvedValue([
      [expected.slice(0, mid), expected.slice(mid)]
    ]);
    await expect(checkDomainVerification("acme.com", token)).resolves.toEqual({
      verified: true
    });
  });

  it("reports token_mismatch when records exist but none match", async () => {
    resolveTxt.mockResolvedValue([[`${TXT_VALUE_PREFIX}=${"b".repeat(32)}`]]);
    await expect(checkDomainVerification("acme.com", token)).resolves.toEqual({
      verified: false,
      reason: "token_mismatch"
    });
  });

  it("reports no_record for an empty answer", async () => {
    resolveTxt.mockResolvedValue([]);
    await expect(checkDomainVerification("acme.com", token)).resolves.toEqual({
      verified: false,
      reason: "no_record"
    });
  });

  it("reports no_record for NXDOMAIN (record not published yet)", async () => {
    resolveTxt.mockRejectedValue(dnsError("ENOTFOUND"));
    await expect(checkDomainVerification("acme.com", token)).resolves.toEqual({
      verified: false,
      reason: "no_record"
    });
  });

  it("reports no_record for ENODATA (name exists, no TXT)", async () => {
    resolveTxt.mockRejectedValue(dnsError("ENODATA"));
    await expect(checkDomainVerification("acme.com", token)).resolves.toEqual({
      verified: false,
      reason: "no_record"
    });
  });

  it("reports dns_error for a timeout instead of throwing", async () => {
    resolveTxt.mockRejectedValue(dnsError("ETIMEOUT"));
    await expect(checkDomainVerification("acme.com", token)).resolves.toEqual({
      verified: false,
      reason: "dns_error"
    });
  });

  it("pins the public resolvers", async () => {
    resolveTxt.mockResolvedValue([]);
    await checkDomainVerification("acme.com", token);
    expect(setServers).toHaveBeenCalledWith(["1.1.1.1", "8.8.8.8"]);
  });
});
