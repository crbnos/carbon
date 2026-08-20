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
          order: entityValue("purchaseOrder", "po1", {
            purchaseOrderId: "PO-1042"
          })
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

  // A moment output, a created record and a foreign key all arrive as a bare id.
  it("loads a record that carries no row to name it", async () => {
    const ctx = createRuntimeContext({
      rows: { "purchaseOrder:po1": { purchaseOrderId: "PO000123" } },
      outputs: { n1: { order: entityValue("purchaseOrder", "po1") } }
    });
    const result = await renderTemplate(template(ref("order")), ctx);

    expect(result).toEqual({
      ok: true,
      value: primitiveValue("string", "PO000123")
    });
  });

  it("names a record by its declared display column, not another readable one", async () => {
    const ctx = createRuntimeContext({
      outputs: {
        n1: {
          order: entityValue("purchaseOrder", "po1", {
            purchaseOrderId: "PO000123",
            name: "Widgets restock"
          })
        }
      }
    });
    const result = await renderTemplate(template(ref("order")), ctx);

    expect(result).toEqual({
      ok: true,
      value: primitiveValue("string", "PO000123")
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

describe("renderTemplate with a link resolver", () => {
  const order = () =>
    entityValue("purchaseOrder", "po_1", { purchaseOrderId: "PO000123" });

  it("leaves a record as its readable id when no resolver is supplied", async () => {
    const ctx = createRuntimeContext({
      outputs: { n1: { record: order() } }
    });
    const result = await renderTemplate(
      template(text("Check "), ref("record")),
      ctx
    );

    expect(result).toEqual({
      ok: true,
      value: primitiveValue("string", "Check PO000123")
    });
  });

  it("wraps a record in a markdown link when one is supplied", async () => {
    const ctx = createRuntimeContext({
      outputs: { n1: { record: order() } }
    });
    const result = await renderTemplate(
      template(text("Check "), ref("record")),
      ctx,
      { linkFor: (of, id) => `https://erp.test/link?of=${of}&id=${id}` }
    );

    expect(result).toEqual({
      ok: true,
      value: primitiveValue(
        "string",
        "Check [PO000123](https://erp.test/link?of=purchaseOrder&id=po_1)"
      )
    });
  });

  // A record name is customer data: it must not be able to choose where the link points.
  it("cannot break out of the link label", async () => {
    const ctx = createRuntimeContext({
      outputs: {
        n1: {
          record: entityValue("purchaseOrder", "po_1", {
            purchaseOrderId: "PO](https://erp.test/x/admin)"
          })
        }
      }
    });
    const result = await renderTemplate(template(ref("record")), ctx, {
      linkFor: () => "https://erp.test/link"
    });

    expect(result).toEqual({
      ok: true,
      value: primitiveValue(
        "string",
        "[PO(https://erp.test/x/admin)](https://erp.test/link)"
      )
    });
  });

  // An entity with no page in the app: the id still reads, it just is not clickable.
  it("falls back to the plain id when the resolver returns null", async () => {
    const ctx = createRuntimeContext({
      outputs: { n1: { record: order() } }
    });
    const result = await renderTemplate(template(ref("record")), ctx, {
      linkFor: () => null
    });

    expect(result).toEqual({
      ok: true,
      value: primitiveValue("string", "PO000123")
    });
  });

  it("never wraps a non-record part", async () => {
    const ctx = createRuntimeContext({
      outputs: { n1: { total: primitiveValue("number", 42) } }
    });
    const result = await renderTemplate(template(ref("total")), ctx, {
      linkFor: () => "https://erp.test/x"
    });

    expect(result).toEqual({
      ok: true,
      value: primitiveValue("string", "42")
    });
  });

  it("never wraps a null value", async () => {
    const ctx = createRuntimeContext({
      outputs: { n1: { record: nullValue() } }
    });
    const result = await renderTemplate(template(ref("record")), ctx, {
      linkFor: () => "https://erp.test/x"
    });

    expect(result).toEqual({ ok: true, value: primitiveValue("string", "") });
  });
});
