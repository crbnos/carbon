import { describe, expect, it } from "vitest";
import { MAX_LIST_ITEMS } from "../definition/schema";
import { t } from "../definition/types";
import { createRuntimeContext } from "./fixtures";
import { resolveRef } from "./resolve";
import type { EntityLoader, RuntimeValue } from "./types";
import { fromColumn } from "./values";

const EVENT = {
  kind: "record" as const,
  fields: {
    summary: t.string,
    startDateTime: t.date,
    organizer: { kind: "record" as const, fields: { email: t.string } }
  }
};

/** Fails the test if anything tries to read a row — records carry their data inline. */
const explodingLoader: EntityLoader = {
  load: async () => {
    throw new Error("the loader must never be reached for a record");
  }
};

function fieldOf(value: RuntimeValue, name: string): RuntimeValue | undefined {
  return value.kind === "record" ? value.fields[name] : undefined;
}

describe("record runtime values", () => {
  describe("fromColumn", () => {
    it("shapes a plain object against the declared fields", () => {
      const value = fromColumn(EVENT, {
        summary: "Standup",
        startDateTime: "2026-08-31T09:00:00.000Z",
        organizer: { email: "sam@example.com" }
      });
      expect(fieldOf(value, "summary")).toEqual({
        kind: "primitive",
        of: "string",
        value: "Standup"
      });
      expect(
        fieldOf(fieldOf(value, "organizer") as RuntimeValue, "email")
      ).toEqual({ kind: "primitive", of: "string", value: "sam@example.com" });
    });

    // The vendor's schema is unvalidated upstream, so a field it promised but did
    // not send must degrade rather than throw.
    it("turns a field the response omitted into null, not an absent key", () => {
      const value = fromColumn(EVENT, { summary: "Standup" });
      expect(fieldOf(value, "organizer")?.kind).toBe("record");
      // Absence is the canonical null value, not a typed blank.
      expect(fieldOf(value, "startDateTime")).toEqual({
        kind: "primitive",
        of: "null",
        value: null
      });
    });

    // Driven by declared fields, so a vendor cannot smuggle extra data into a
    // typed value — it would otherwise land in the run log unredacted.
    it("drops keys the type does not declare", () => {
      const value = fromColumn(EVENT, {
        summary: "Standup",
        internalToken: "sk-secret"
      });
      expect(value.kind === "record" && "internalToken" in value.fields).toBe(
        false
      );
    });

    it("coerces a wrong-typed field to null rather than passing it through", () => {
      const value = fromColumn(EVENT, { startDateTime: "not a date" });
      expect(fieldOf(value, "startDateTime")).toEqual({
        kind: "primitive",
        of: "null",
        value: null
      });
    });

    it("treats a non-object as a record of nulls", () => {
      for (const raw of [null, undefined, "text", 42, []]) {
        const value = fromColumn(EVENT, raw);
        expect(value.kind).toBe("record");
        expect(fieldOf(value, "summary")).toEqual({
          kind: "primitive",
          of: "null",
          value: null
        });
      }
    });

    it("caps a list of records at MAX_LIST_ITEMS", () => {
      const many = Array.from({ length: MAX_LIST_ITEMS + 25 }, (_, i) => ({
        summary: `Event ${i}`
      }));
      const value = fromColumn(t.list(EVENT), many);
      expect(value.kind === "list" && value.items.length).toBe(MAX_LIST_ITEMS);
    });
  });

  describe("walking a path", () => {
    const outputs = {
      step: { items: fromColumn(EVENT, { organizer: { email: "a@b.co" } }) }
    };

    it("reaches a nested field without touching the loader", async () => {
      const ctx = createRuntimeContext({ outputs });
      const result = await resolveRef(
        {
          kind: "ref",
          nodeId: "step",
          output: "items",
          path: ["organizer", "email"]
        },
        { ...ctx, loader: explodingLoader }
      );
      expect(result).toEqual({
        ok: true,
        value: { kind: "primitive", of: "string", value: "a@b.co" }
      });
    });

    // A declared-but-absent path resolves to nothing rather than failing the step.
    it("resolves an undeclared field to null instead of erroring", async () => {
      const ctx = createRuntimeContext({ outputs });
      const result = await resolveRef(
        { kind: "ref", nodeId: "step", output: "items", path: ["location"] },
        { ...ctx, loader: explodingLoader }
      );
      expect(result).toEqual({
        ok: true,
        value: { kind: "primitive", of: "null", value: null }
      });
    });

    it("stops at null rather than walking past it", async () => {
      const ctx = createRuntimeContext({
        outputs: { step: { items: fromColumn(EVENT, {}) } }
      });
      const result = await resolveRef(
        {
          kind: "ref",
          nodeId: "step",
          output: "items",
          path: ["summary", "deeper"]
        },
        { ...ctx, loader: explodingLoader }
      );
      expect(result.ok).toBe(true);
    });
  });
});
