// The API-side form bridge: a validator's per-field transforms run on the
// caller's value, only when sent, and validator defaults apply on create only.
// Coercers are read from the REAL generated manifest so a generator regression
// (a transform field that stops being recorded) fails here.

import type { ManifestEntry } from "@carbon/api";
import { ORPCError } from "@orpc/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import metadata from "../../mcp+/lib/tool-metadata.json";
import {
  applyCreateDefaults,
  applyFieldCoercers,
  modelsLoaders,
  resolveCoercerSchema
} from "./field-coercers.server";

// The models files reach `@carbon/glossary`, whose `msg` macro only compiles
// under the app's Vite lingui plugin. Validators never render, so an inert tag
// is enough to load them for real here.
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray | string) =>
    Array.isArray(strings) ? strings.join("") : strings
}));
vi.mock("@lingui/react/macro", () => ({
  Trans: () => null,
  useLingui: () => ({ t: (s: unknown) => String(s) })
}));

const tools = (metadata as { tools: ManifestEntry[] }).tools;
const tool = (name: string): ManifestEntry => {
  const found = tools.find((t) => t.name === name);
  if (!found) throw new Error(`${name} missing from the manifest`);
  return found;
};

const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }]
});

describe("applyFieldCoercers", () => {
  // Loading every models graph cold takes seconds under a busy runner; do it
  // once, outside the per-test timeout.
  beforeAll(async () => {
    await Promise.all(Object.values(modelsLoaders).map((load) => load()));
  }, 60_000);

  it("turns a plain-text step description into a tiptap document", async () => {
    for (const name of [
      "items_upsertMethodOperationStep",
      "production_upsertJobOperationStep",
      "sales_upsertQuoteOperationStep",
      "production_upsertAssemblyInstructionStep"
    ]) {
      const out = await applyFieldCoercers(tool(name), {
        id: "step-1",
        description: "Torque to 5 Nm"
      });
      expect(out?.description, name).toEqual(doc("Torque to 5 Nm"));
      expect(out?.id).toBe("step-1");
    }
  });

  it("keeps a JSON-encoded document as that document", async () => {
    const encoded = JSON.stringify(doc("Check torque"));
    const out = await applyFieldCoercers(
      tool("items_upsertMethodOperationStep"),
      { description: encoded }
    );
    expect(out?.description).toEqual(doc("Check torque"));
  });

  it("stores quote notes as a document on insert and update", async () => {
    for (const name of ["sales_insertQuote", "sales_updateQuote"]) {
      const out = await applyFieldCoercers(tool(name), {
        notes: "internal note"
      });
      expect(out?.notes, name).toEqual(doc("internal note"));
    }
    const asObject = await applyFieldCoercers(tool("sales_updateQuote"), {
      notes: doc("already a doc")
    });
    expect(asObject?.notes).toEqual(doc("already a doc"));
  });

  it("parses JSON-string stock transfer lines into rows", async () => {
    const lines = [{ itemId: "item-1", quantity: 2 }];
    const out = await applyFieldCoercers(
      tool("inventory_upsertStockTransferLines"),
      { stockTransferId: "st-1", lines: JSON.stringify(lines) }
    );
    expect(Array.isArray(out?.lines)).toBe(true);
    expect(out?.lines).toEqual(lines);
  });

  it("rejects malformed lines with the validator's own message", async () => {
    await expect(
      applyFieldCoercers(tool("inventory_upsertStockTransferLines"), {
        stockTransferId: "st-1",
        lines: "not json"
      })
    ).rejects.toBeInstanceOf(ORPCError);
  });

  it("converts string-encoded booleans the way the form validator does", async () => {
    const out = await applyFieldCoercers(tool("production_upsertJobMaterial"), {
      requiresBatchTracking: "true",
      requiresSerialTracking: "false"
    });
    expect(out?.requiresBatchTracking).toBe(true);
    expect(out?.requiresSerialTracking).toBe(false);
  });

  it("never adds an absent key and passes an explicit null through", async () => {
    const meta = tool("production_upsertJobMaterial");
    const out = await applyFieldCoercers(meta, { id: "m-1", kit: null });
    expect(out).toEqual({ id: "m-1", kit: null });
    expect("requiresBatchTracking" in (out ?? {})).toBe(false);
  });

  it("returns the input untouched for an operation without coercers", async () => {
    const input = { id: "x", description: "text" };
    expect(await applyFieldCoercers({ coercers: undefined }, input)).toBe(
      input
    );
  });

  it("resolves every coercer in the manifest to a live field schema", async () => {
    for (const t of tools) {
      for (const coercer of t.coercers ?? []) {
        expect(
          await resolveCoercerSchema(coercer),
          `${t.name} → ${coercer.validator}.${coercer.field.join(".")}`
        ).not.toBeNull();
      }
    }
  });
});

describe("applyCreateDefaults", () => {
  const meta = { createDefaults: { taxPercent: 0, exchangeRate: 1 } };

  it("fills absent keys on create", () => {
    expect(applyCreateDefaults(meta, { exchangeRate: 1.2 }, true)).toEqual({
      exchangeRate: 1.2,
      taxPercent: 0
    });
  });

  it("never fills anything on update", () => {
    const input = { id: "row-1" };
    expect(applyCreateDefaults(meta, input, false)).toBe(input);
  });
});
