import { describe, expect, it, vi } from "vitest";

// Isolation mocks — provisioning's cache/redis/logger dependencies are stubbed
// so the pure decision logic can be tested without dragging in the full module
// graph. The Kysely db is a caller-supplied parameter and is not needed here.
vi.mock("@carbon/auth", () => ({
  getPermissionCacheKey: vi.fn((id: string) => `permissions:${id}`)
}));

vi.mock("@carbon/kv", () => ({
  redis: { del: vi.fn().mockResolvedValue(null) }
}));

vi.mock("@carbon/logger", () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}));

vi.mock("@carbon/utils", () => ({
  datetime: { timestamp: vi.fn(() => "2026-01-01T00:00:00.000Z") }
}));

const { buildArchivedEmail, mergeInvitePermissions, uncoveredSsoDomainError } =
  await import("./provisioning.server");

describe("buildArchivedEmail", () => {
  it("is deterministic for the same inputs", () => {
    expect(buildArchivedEmail("user_1", "jane@acme.com")).toEqual(
      buildArchivedEmail("user_1", "jane@acme.com")
    );
  });

  it("contains the old user id and preserves the full original email as a suffix", () => {
    const archived = buildArchivedEmail("user_1", "jane@acme.com");
    expect(archived).toContain("user_1");
    expect(archived.endsWith("jane@acme.com")).toBe(true);
  });

  it("produces distinct archived emails for distinct old user ids", () => {
    expect(buildArchivedEmail("user_1", "jane@acme.com")).not.toEqual(
      buildArchivedEmail("user_2", "jane@acme.com")
    );
  });

  it("never equals the original email (frees the unique email index)", () => {
    expect(buildArchivedEmail("user_1", "jane@acme.com")).not.toEqual(
      "jane@acme.com"
    );
  });
});

describe("mergeInvitePermissions", () => {
  it("takes new keys as-is and concatenates existing keys (setUserPermissions semantics)", () => {
    const merged = mergeInvitePermissions(
      { sales_view: ["c1"] },
      { sales_view: ["c2"], parts_view: ["c2"] }
    );
    expect(merged).toEqual({
      sales_view: ["c1", "c2"],
      parts_view: ["c2"]
    });
  });

  it("does not mutate the current permission set", () => {
    const current = { sales_view: ["c1"] };
    mergeInvitePermissions(current, { sales_view: ["c2"] });
    expect(current).toEqual({ sales_view: ["c1"] });
  });

  it("concatenates duplicates when the same grant is merged twice (matches setUserPermissions, which does not dedupe)", () => {
    const once = mergeInvitePermissions({}, { sales_view: ["c2"] });
    const twice = mergeInvitePermissions(once, { sales_view: ["c2"] });
    expect(twice).toEqual({ sales_view: ["c2", "c2"] });
  });

  it('keeps "0" wildcard entries untouched when merging', () => {
    const merged = mergeInvitePermissions(
      { sales_view: ["0"], parts_update: ["0"] },
      { sales_view: ["c2"] }
    );
    expect(merged).toEqual({
      sales_view: ["0", "c2"],
      parts_update: ["0"]
    });
  });
});

describe("uncoveredSsoDomainError", () => {
  const domains = ["acme.com", "acme.org"];

  it("allows an email on a covered domain", () => {
    expect(uncoveredSsoDomainError(domains, "jane@acme.com")).toBeNull();
    expect(uncoveredSsoDomainError(domains, "jane@acme.org")).toBeNull();
  });

  it("is case-insensitive on the email side (stored domains are already lowercase)", () => {
    expect(uncoveredSsoDomainError(domains, "Jane@ACME.com")).toBeNull();
  });

  it("refuses an email on an uncovered domain, naming the covered domains", () => {
    const message = uncoveredSsoDomainError(domains, "jane@gmail.com");
    expect(message).toContain("acme.com, acme.org");
  });

  it("does not treat a subdomain as covered (matches GoTrue's exact-domain routing)", () => {
    expect(
      uncoveredSsoDomainError(domains, "jane@sub.acme.com")
    ).not.toBeNull();
  });

  it("does not treat a suffix-alike domain as covered", () => {
    expect(uncoveredSsoDomainError(domains, "jane@notacme.com")).not.toBeNull();
  });

  it("refuses a malformed email with no domain part", () => {
    expect(uncoveredSsoDomainError(domains, "jane")).not.toBeNull();
    expect(uncoveredSsoDomainError(domains, "jane@")).not.toBeNull();
  });
});
