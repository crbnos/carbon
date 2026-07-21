import { describe, expect, it, vi } from "vitest";

vi.mock("@carbon/glossary", () => ({
  getDefinitionText: () => "",
  getEntry: () => undefined,
  getTermText: () => "",
  glossaryEntries: () => [],
  hasEntry: () => false,
  listEntries: () => [],
  lookupEntry: () => undefined,
  termSlug: (t: string) => t,
  terms: {}
}));

import { openApiDocument } from "./openapi";

const V1_PATHS = [
  "/accounting/trial-balance",
  "/accounting/journal-lines/export",
  "/accounting/journal-entries",
  "/accounting/journal-entries/{id}",
  "/webhooks",
  "/webhooks/{id}",
  "/openapi.json"
];

describe("openApiDocument", () => {
  it("declares OpenAPI 3.1", () => {
    expect(openApiDocument.openapi).toMatch(/^3\.1\.\d+$/);
  });

  it("has required info (title + version)", () => {
    expect(openApiDocument.info.title).toBeTruthy();
    expect(openApiDocument.info.version).toBeTruthy();
  });

  it("documents every v1 endpoint", () => {
    for (const p of V1_PATHS) {
      expect(openApiDocument.paths).toHaveProperty([p]);
    }
    // No undocumented paths sneaking in.
    expect(Object.keys(openApiDocument.paths).sort()).toEqual(
      [...V1_PATHS].sort()
    );
  });

  it("defines the carbon-key API-key security scheme", () => {
    const scheme = openApiDocument.components.securitySchemes.carbonKey;
    expect(scheme.type).toBe("apiKey");
    expect(scheme.in).toBe("header");
    expect(scheme.name).toBe("carbon-key");
  });

  it("documents error responses including 403 and 429", () => {
    const tb = openApiDocument.paths["/accounting/trial-balance"].get;
    expect(tb.responses).toHaveProperty("403");
    expect(tb.responses).toHaveProperty("429");
    // Import documents idempotency + period error codes.
    const imp = openApiDocument.paths["/accounting/journal-entries"].post;
    expect(imp.responses).toHaveProperty("409");
    expect(imp.responses).toHaveProperty("422");
  });

  it("documents the webhook signature scheme (v1 HMAC + replay window)", () => {
    const sig = openApiDocument["x-webhook-signature"];
    expect(sig.description).toMatch(/HMAC-SHA256/);
    expect(sig.description).toMatch(/carbon-signature/);
    expect(sig.description).toMatch(/5 minutes/);
    expect(sig.envelope).toHaveProperty("topic");
  });

  it("every operation references a resolvable component schema (no dangling $ref)", () => {
    const json = JSON.stringify(openApiDocument);
    const refs = [...json.matchAll(/"#\/components\/schemas\/(\w+)"/g)].map(
      (m) => m[1]
    );
    const defined = Object.keys(openApiDocument.components.schemas);
    for (const ref of refs) {
      expect(defined).toContain(ref);
    }
  });
});
