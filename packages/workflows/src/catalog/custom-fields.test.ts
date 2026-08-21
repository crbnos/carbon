import { describe, expect, it } from "vitest";
import { t } from "../definition/types";
import {
  buildCatalogOverlay,
  type CustomFieldDef,
  customFieldEventId,
  ENTITY_BY_TABLE,
  resolveCustomFieldEvent
} from "./custom-fields";

const field = (over: Partial<CustomFieldDef> = {}): CustomFieldDef => ({
  table: "salesOrder",
  id: "cf_1",
  name: "Rush Reason",
  dataTypeId: 5,
  listOptions: null,
  active: true,
  ...over
});

describe("buildCatalogOverlay", () => {
  it("keys the property by id, one segment, under the entity name", () => {
    const overlay = buildCatalogOverlay([field()]);
    expect(overlay.properties.salesOrder).toEqual({
      "customFields.cf_1": t.string
    });
    expect(overlay.labels["entity.salesOrder.customFields.cf_1"]).toBe(
      "Rush Reason"
    );
  });

  it("maps every DataType to its ValueType", () => {
    const cases: [number, unknown][] = [
      [1, t.boolean],
      [2, t.date],
      [3, t.string],
      [4, t.number],
      [5, t.string],
      [6, t.entity("user")],
      [7, t.entity("customer")],
      [8, t.entity("supplier")],
      // A File field is the stored path — printable, not a link.
      [9, t.string]
    ];
    for (const [dataTypeId, expected] of cases) {
      const overlay = buildCatalogOverlay([field({ dataTypeId })]);
      expect(overlay.properties.salesOrder?.["customFields.cf_1"]).toEqual(
        expected
      );
    }
  });

  it("drops an unknown DataType rather than guessing", () => {
    expect(buildCatalogOverlay([field({ dataTypeId: 99 })]).properties).toEqual(
      {}
    );
  });

  it("drops an inactive field", () => {
    expect(buildCatalogOverlay([field({ active: false })]).properties).toEqual(
      {}
    );
  });

  // Item custom fields live on part/material/tool/…; the catalog triggers on `item`.
  it("drops item, which has no comparable custom fields yet", () => {
    expect(buildCatalogOverlay([field({ table: "item" })]).properties).toEqual(
      {}
    );
  });

  it("drops a table that is not a registry entity", () => {
    expect(
      buildCatalogOverlay([field({ table: "notATable" })]).properties
    ).toEqual({});
  });

  it("puts a List field's options in enums and on the action input", () => {
    const overlay = buildCatalogOverlay([
      field({ dataTypeId: 3, listOptions: ["Low", "High"] })
    ]);
    expect(overlay.enums.salesOrder?.["customFields.cf_1"]).toEqual([
      "Low",
      "High"
    ]);
    expect(
      overlay.actionInputs["salesOrder.update"]?.["customFields.cf_1"]
    ).toEqual({ type: t.string, required: false, choices: ["Low", "High"] });
  });

  it("makes a non-List field writable with no choices", () => {
    const overlay = buildCatalogOverlay([field()]);
    expect(
      overlay.actionInputs["salesOrder.update"]?.["customFields.cf_1"]
    ).toEqual({ type: t.string, required: false });
    expect(
      overlay.labels["action.salesOrder.update.input.customFields.cf_1"]
    ).toBe("Rush Reason");
  });

  it("indexes every registry entity by its table", () => {
    expect(ENTITY_BY_TABLE.salesOrder).toBe("salesOrder");
    expect(ENTITY_BY_TABLE.nonConformance).toBe("nonConformance");
  });
});

describe("resolveCustomFieldEvent", () => {
  it("parses a well-formed id into a synthetic UPDATE event", () => {
    const id = customFieldEventId("salesOrder", "cf_1");
    expect(id).toBe("salesOrder.customFields.cf_1.changed");

    const event = resolveCustomFieldEvent(id);
    expect(event?.match).toEqual({
      table: "salesOrder",
      operation: "UPDATE",
      field: "customFields.cf_1"
    });
    expect(event?.permission).toBe("sales");
    expect(event?.outputs).toEqual({
      record: t.entity("salesOrder"),
      before: t.entity("salesOrder"),
      after: t.entity("salesOrder")
    });
  });

  it("refuses item", () => {
    expect(
      resolveCustomFieldEvent("item.customFields.cf_1.changed")
    ).toBeUndefined();
  });

  // A reference-only entity has no `watch` block, so it has no change events at all.
  it("refuses a reference-only entity", () => {
    expect(
      resolveCustomFieldEvent("user.customFields.cf_1.changed")
    ).toBeUndefined();
  });

  it("refuses an unknown entity", () => {
    expect(
      resolveCustomFieldEvent("nope.customFields.cf_1.changed")
    ).toBeUndefined();
  });

  it("refuses a generated column event and other malformed ids", () => {
    for (const id of [
      "salesOrder.status.changed",
      "salesOrder.customFields.changed",
      "salesOrder.customFields.cf_1.created",
      "salesOrder.customFields.a.b.changed",
      "customFields.cf_1.changed",
      ""
    ]) {
      expect(resolveCustomFieldEvent(id)).toBeUndefined();
    }
  });
});
