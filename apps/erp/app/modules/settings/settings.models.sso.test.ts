import { describe, expect, it, vi } from "vitest";

// Isolation mock — settings.models transitively imports @carbon/glossary,
// whose Lingui `msg` macro calls only work under the app's vite macro
// transform. The validator under test never touches glossary content.
// (Mirrors users.sso.server.test.ts.)
vi.mock("@carbon/glossary", () => ({
  getDefinitionText: vi.fn(),
  getEntry: vi.fn(),
  getTermText: vi.fn(),
  glossaryEntries: [],
  hasEntry: vi.fn(() => false),
  listEntries: vi.fn(() => []),
  lookupEntry: vi.fn(),
  termSlug: vi.fn(),
  terms: {}
}));

const { ssoConnectionValidator } = await import("./settings.models");

// Form-shaped input: zfd.text turns "" into undefined exactly like an empty
// form field, so tests pass strings the way the route action receives them.
function parse(input: {
  metadataUrl?: string;
  metadataXml?: string;
  domains?: string;
}) {
  return ssoConnectionValidator.safeParse(input);
}

const URL = "https://idp.example.com/metadata";

describe("ssoConnectionValidator — domains", () => {
  it("normalizes a comma-separated list to a trimmed lowercase array", () => {
    const result = parse({
      metadataUrl: URL,
      domains: " Example.com , ACME.org "
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.domains).toEqual(["example.com", "acme.org"]);
    }
  });

  it("drops empty segments from stray commas", () => {
    const result = parse({ metadataUrl: URL, domains: "example.com, ," });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.domains).toEqual(["example.com"]);
    }
  });

  it("rejects a list that is only commas/whitespace (no domains left)", () => {
    expect(parse({ metadataUrl: URL, domains: " , , " }).success).toBe(false);
  });

  it("accepts subdomains, hyphens, and multi-label TLDs", () => {
    const result = parse({
      metadataUrl: URL,
      domains: "sub.example.com, my-domain.co.uk"
    });
    expect(result.success).toBe(true);
  });

  it("rejects a full email address typed as a domain", () => {
    expect(
      parse({ metadataUrl: URL, domains: "user@example.com" }).success
    ).toBe(false);
  });

  it("rejects a bare hostname without a TLD", () => {
    expect(parse({ metadataUrl: URL, domains: "localhost" }).success).toBe(
      false
    );
  });

  it("rejects a domain containing spaces", () => {
    expect(parse({ metadataUrl: URL, domains: "exa mple.com" }).success).toBe(
      false
    );
  });

  it("rejects one bad domain even when others are valid", () => {
    expect(
      parse({ metadataUrl: URL, domains: "example.com, not a domain" }).success
    ).toBe(false);
  });
});

describe("ssoConnectionValidator — metadata XOR", () => {
  it("accepts metadata URL alone", () => {
    expect(parse({ metadataUrl: URL, domains: "example.com" }).success).toBe(
      true
    );
  });

  it("accepts metadata XML alone", () => {
    expect(
      parse({ metadataXml: "<EntityDescriptor/>", domains: "example.com" })
        .success
    ).toBe(true);
  });

  it("rejects BOTH metadata URL and XML", () => {
    expect(
      parse({
        metadataUrl: URL,
        metadataXml: "<EntityDescriptor/>",
        domains: "example.com"
      }).success
    ).toBe(false);
  });

  it("rejects NEITHER metadata URL nor XML (empty form fields become undefined)", () => {
    // zfd.text("") -> undefined is the actual empty-field shape from a form.
    expect(
      parse({ metadataUrl: "", metadataXml: "", domains: "example.com" })
        .success
    ).toBe(false);
  });

  it("rejects a metadata URL that is not a valid URL", () => {
    expect(
      parse({ metadataUrl: "not-a-url", domains: "example.com" }).success
    ).toBe(false);
  });
});
