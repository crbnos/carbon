import { describe, expect, it } from "vitest";
import { collectEntityRefs } from "./entityRefs";

const purchaseOrder = {
  kind: "entity",
  of: "purchaseOrder",
  id: "po_HRbRnBg9dqExJERAZ52jcu"
};

describe("collectEntityRefs", () => {
  it("finds an entity nested inside a step's resolved inputs", () => {
    expect(
      collectEntityRefs({ resolved: { record: purchaseOrder } })
    ).toStrictEqual([
      { table: "purchaseOrder", id: "po_HRbRnBg9dqExJERAZ52jcu" }
    ]);
  });

  it("walks the array of inputs and outputs the loader passes in", () => {
    const refs = collectEntityRefs([
      { inputs: { record: purchaseOrder } },
      { record: { kind: "entity", of: "job", id: "job_1" } }
    ]);
    expect(refs).toStrictEqual([
      { table: "purchaseOrder", id: "po_HRbRnBg9dqExJERAZ52jcu" },
      { table: "job", id: "job_1" }
    ]);
  });

  it("collapses the same record referenced many times to one ref", () => {
    const refs = collectEntityRefs([
      { record: purchaseOrder },
      { before: purchaseOrder, after: purchaseOrder }
    ]);
    expect(refs).toStrictEqual([
      { table: "purchaseOrder", id: "po_HRbRnBg9dqExJERAZ52jcu" }
    ]);
  });

  it("keeps two records of the same table apart", () => {
    const refs = collectEntityRefs([
      purchaseOrder,
      { kind: "entity", of: "purchaseOrder", id: "po_second" }
    ]);
    expect(refs).toHaveLength(2);
  });

  it("returns nothing for values that are not entity references", () => {
    expect(collectEntityRefs(null)).toStrictEqual([]);
    expect(collectEntityRefs("po_123")).toStrictEqual([]);
    expect(
      collectEntityRefs({ kind: "primitive", of: "string", value: "hello" })
    ).toStrictEqual([]);
    // `of`/`id` present but not strings — not a reference we can resolve.
    expect(collectEntityRefs({ kind: "entity", of: 1, id: 2 })).toStrictEqual(
      []
    );
  });

  it("terminates on a cyclic structure instead of recursing forever", () => {
    const cyclic: Record<string, unknown> = { record: purchaseOrder };
    cyclic.self = cyclic;
    expect(collectEntityRefs(cyclic)).toStrictEqual([
      { table: "purchaseOrder", id: "po_HRbRnBg9dqExJERAZ52jcu" }
    ]);
  });

  it("stops descending past the depth cap", () => {
    // 8 levels of nesting — deeper than MAX_DEPTH, so the entity is not reached.
    let deep: Record<string, unknown> = purchaseOrder;
    for (let i = 0; i < 8; i++) deep = { nested: deep };
    expect(collectEntityRefs(deep)).toStrictEqual([]);
  });
});
