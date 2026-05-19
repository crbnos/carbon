import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  buildManifest,
  hashDescription,
  type ManifestEntry,
  toManifestEntry
} from "./manifest";
import type { McpToolMetadata } from "./types";

function meta(over: Partial<McpToolMetadata> = {}): McpToolMetadata {
  return {
    id: "account_getAccount",
    module: "account",
    name: "getAccount",
    description: "  get account  ",
    classification: "READ",
    disable: false,
    fn: () => undefined,
    paramSchema: z.unknown(),
    argOrder: ["client", "id"],
    optional: [false, false],
    hasArgsParam: false,
    auth: {
      companyId: false,
      userId: false,
      createdBy: false,
      updatedBy: false
    },
    ...over
  };
}

describe("manifest helpers", () => {
  it("toManifestEntry strips runtime fields and trims description", () => {
    const entry = toManifestEntry(meta());
    expect(entry).toEqual<ManifestEntry>({
      id: "account_getAccount",
      module: "account",
      name: "getAccount",
      description: "get account",
      classification: "READ",
      descriptionHash: hashDescription({
        id: "account_getAccount",
        description: "get account",
        classification: "READ"
      })
    });
  });

  it("hashDescription is stable and depends on id+description+classification", () => {
    const a = hashDescription({
      id: "x",
      description: "y",
      classification: "READ"
    });
    const b = hashDescription({
      id: "x",
      description: "y",
      classification: "READ"
    });
    const c = hashDescription({
      id: "x",
      description: "y",
      classification: "WRITE"
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("buildManifest sorts tools by id, skips disabled, and produces a stable contentHash", () => {
    const m1 = buildManifest([
      meta({ id: "b_t", module: "b", name: "t" }),
      meta({ id: "a_t", module: "a", name: "t" }),
      meta({ id: "z_t", module: "z", name: "t", disable: true })
    ]);
    const m2 = buildManifest([
      meta({ id: "a_t", module: "a", name: "t" }),
      meta({ id: "b_t", module: "b", name: "t" })
    ]);
    expect(m1.tools.map((t) => t.id)).toEqual(["a_t", "b_t"]);
    expect(m1.contentHash).toBe(m2.contentHash);
    expect(m1.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("buildManifest contentHash changes when a description changes", () => {
    const m1 = buildManifest([meta({ description: "one" })]);
    const m2 = buildManifest([meta({ description: "two" })]);
    expect(m1.contentHash).not.toBe(m2.contentHash);
  });
});

// Regression guard for the slim-annotation runtime path. `description` and
// the resolved `inject` set are NOT in the slim source annotation — the
// generator must emit them into every registerParsed() call so they reach
// the registry. If the generator regresses to emitting only
// module/name/argOrder, registration would crash at boot
// (description.trim() on undefined) and silently drop identity injection.
describe("mcp-tools.generated.server.ts runtime contract", () => {
  const generated = readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "mcp-tools.generated.server.ts"
    ),
    "utf8"
  );

  // A real emitted call is `registry.registerParsed(<mod>.<fn>, {` — the
  // identifier arg distinguishes it from the substring in the file header
  // comment ("calls registry.registerParsed() once per tool").
  const CALL = /registry\.registerParsed\([a-zA-Z]+\.[a-zA-Z0-9]+,\s*\{/g;

  it("emits a registration for every tool", () => {
    const count = (generated.match(CALL) ?? []).length;
    expect(count).toBeGreaterThan(1000);
  });

  it("every registerParsed call carries description, inject and argOrder", () => {
    const starts = [...generated.matchAll(CALL)].map((m) => m.index as number);
    expect(starts.length).toBeGreaterThan(1000);
    const calls = starts.map((s) =>
      generated.slice(s, generated.indexOf("});", s))
    );
    const missing = calls.filter(
      (c) =>
        !/\bdescription:\s*"/.test(c) ||
        !/\binject:\s*\[/.test(c) ||
        !/\bargOrder:\s*\[/.test(c)
    );
    expect(missing).toEqual([]);
  });
});
