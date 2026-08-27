import { describe, expect, it, vi } from "vitest";

// Isolation mock — settings.models transitively imports @carbon/glossary,
// whose Lingui `msg` macro calls only work under the app's vite macro
// transform. The validator under test never touches glossary content.
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

const { ssoConnectionValidator, ssoDomainValidator } = await import(
  "./settings.models"
);

// Form-shaped input: zfd.text turns "" into undefined exactly like an empty
// form field, so tests pass strings the way the route action receives them.
function parse(input: { metadataUrl?: string; metadataXml?: string }) {
  return ssoConnectionValidator.safeParse(input);
}

function parseDomain(domain: string) {
  return ssoDomainValidator.safeParse({ domain });
}

const URL = "https://idp.example.com/metadata";

describe("ssoDomainValidator", () => {
  it("normalizes to a trimmed lowercase domain", () => {
    const result = parseDomain(" Example.COM ");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.domain).toBe("example.com");
    }
  });

  it("accepts subdomains, hyphens, and multi-label TLDs", () => {
    expect(parseDomain("sub.example.com").success).toBe(true);
    expect(parseDomain("my-domain.co.uk").success).toBe(true);
  });

  it("accepts a punycode (xn--) internationalized domain", () => {
    expect(parseDomain("xn--mnchen-3ya.de").success).toBe(true);
  });

  it("rejects a full email address typed as a domain", () => {
    expect(parseDomain("user@example.com").success).toBe(false);
  });

  it("rejects a bare hostname without a TLD", () => {
    expect(parseDomain("localhost").success).toBe(false);
  });

  it("rejects a domain containing spaces", () => {
    expect(parseDomain("exa mple.com").success).toBe(false);
  });

  it("rejects public email providers, case-insensitively", () => {
    expect(parseDomain("gmail.com").success).toBe(false);
    expect(parseDomain("GMAIL.com").success).toBe(false);
    expect(parseDomain("outlook.com").success).toBe(false);
  });

  it("accepts a company subdomain of a public provider's TLD-alike", () => {
    // The denylist is exact-match: gmail.com is blocked, mygmail.com is a
    // legitimate (if odd) claim the DNS challenge will adjudicate.
    expect(parseDomain("mygmail.com").success).toBe(true);
  });
});

describe("ssoConnectionValidator — metadata XOR", () => {
  it("accepts metadata URL alone", () => {
    expect(parse({ metadataUrl: URL }).success).toBe(true);
  });

  it("accepts metadata XML alone", () => {
    expect(parse({ metadataXml: "<EntityDescriptor/>" }).success).toBe(true);
  });

  it("rejects BOTH metadata URL and XML", () => {
    expect(
      parse({ metadataUrl: URL, metadataXml: "<EntityDescriptor/>" }).success
    ).toBe(false);
  });

  it("rejects NEITHER metadata URL nor XML (empty form fields become undefined)", () => {
    // zfd.text("") -> undefined is the actual empty-field shape from a form.
    expect(parse({ metadataUrl: "", metadataXml: "" }).success).toBe(false);
  });

  it("rejects a metadata URL that is not a valid URL", () => {
    expect(parse({ metadataUrl: "not-a-url" }).success).toBe(false);
  });
});
