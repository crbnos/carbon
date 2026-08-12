import { describe, expect, it } from "vitest";
import type { Template } from "../definition/types";
import { createRuntimeContext } from "./fixtures";
import { renderTemplate } from "./resolve";
import { entityValue, nullValue, primitiveValue } from "./values";

const template = (...parts: Template["parts"]): Template => ({
  kind: "template",
  parts
});

const text = (value: string) => ({ kind: "text" as const, text: value });

const ref = (output: string, path: string[] = []) => ({
  kind: "ref" as const,
  nodeId: "n1",
  output,
  path
});

describe("renderTemplate", () => {
  it("renders text parts verbatim", async () => {
    const ctx = createRuntimeContext();
    const result = await renderTemplate(
      template(text("Hello "), text("you")),
      ctx
    );

    expect(result).toEqual({
      ok: true,
      value: primitiveValue("string", "Hello you")
    });
  });

  it("substitutes a variable between two text parts", async () => {
    const ctx = createRuntimeContext({
      outputs: { n1: { total: primitiveValue("number", 42) } }
    });
    const result = await renderTemplate(
      template(text("Total is "), ref("total"), text(" today")),
      ctx
    );

    expect(result).toEqual({
      ok: true,
      value: primitiveValue("string", "Total is 42 today")
    });
  });

  it("renders nothing as an empty string", async () => {
    const ctx = createRuntimeContext({ outputs: { n1: { who: nullValue() } } });
    const result = await renderTemplate(
      template(text("["), ref("who"), text("]")),
      ctx
    );

    expect(result).toEqual({ ok: true, value: primitiveValue("string", "[]") });
  });

  it("renders a loaded record by its readable id", async () => {
    const ctx = createRuntimeContext({
      outputs: {
        n1: {
          order: entityValue("purchaseOrder", "po1", { readableId: "PO-1042" })
        }
      }
    });
    const result = await renderTemplate(template(ref("order")), ctx);

    expect(result).toEqual({
      ok: true,
      value: primitiveValue("string", "PO-1042")
    });
  });

  it("falls back to the record's id when nothing readable is loaded", async () => {
    const ctx = createRuntimeContext({
      outputs: { n1: { order: entityValue("purchaseOrder", "po1") } }
    });
    const result = await renderTemplate(template(ref("order")), ctx);

    expect(result).toEqual({
      ok: true,
      value: primitiveValue("string", "po1")
    });
  });

  it("fails the whole template when a part cannot be resolved", async () => {
    const ctx = createRuntimeContext();
    const result = await renderTemplate(
      template(text("Hello "), ref("missing")),
      ctx
    );

    expect(result).toEqual({
      ok: false,
      reason: "The step that produces this value did not run."
    });
  });
});
