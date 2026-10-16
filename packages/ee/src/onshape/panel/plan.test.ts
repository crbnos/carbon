// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import type { OnshapeBomNode } from "./bom";
import {
  assemblyTextChanges,
  bomLineItemType,
  buildAssemblyPlan,
  buildPartPlan,
  buildReleasePlan,
  changeNoticeDescriptionJson,
  currentItemFields,
  defaultUnitOfMeasureCode,
  mergeChangeNoticeEdit,
  mergeEditsForCreates,
  mergeExistingItemEdits,
  mergeItemEdits,
  pairManualLines,
  pickAdoptTarget,
  pickBomChildRow,
  pickLatestRow,
  pickReuseRow,
  pickRevisionBase,
  planCreatedItem,
  planExistingItem,
  proposeItem,
  proposeMappedItem,
  reconcileMethodForReplenishment,
  withRefusedMethods
} from "./plan";
import { DEFAULT_PUSH_DEFAULTS } from "./preferences";
import type { PlanItemField, PropertyMapEntry } from "./properties";
import type { PanelRelease } from "./releases";

const options = {
  unitsOfMeasure: [
    { code: "EA", name: "Each" },
    { code: "M", name: "Meter" }
  ],
  defaults: DEFAULT_PUSH_DEFAULTS
};

const node = (over: Partial<OnshapeBomNode> = {}): OnshapeBomNode => ({
  index: "1",
  level: 1,
  partNumber: "PAD-005",
  revision: null,
  name: "Foot pad",
  description: null,
  quantity: 1,
  itemSource: null,
  children: [],
  ...over
});

describe("proposeItem", () => {
  it("defaults an in-house part to Make / Make to Order / Inventory / EA", () => {
    expect(
      proposeItem({ partNumber: "PAD-005", name: "Foot pad" }, options)
    ).toEqual({
      readableId: "PAD-005",
      revision: "0",
      name: "Foot pad",
      description: null,
      replenishmentSystem: "Make",
      defaultMethodType: "Make to Order",
      itemTrackingType: "Inventory",
      unitOfMeasureCode: "EA"
    });
  });

  it("defaults a Standard content BOM row to Buy / Pull from Inventory", () => {
    const item = proposeItem(
      {
        partNumber: "HDW-010",
        name: null,
        standardContent: true,
        revision: "B"
      },
      options
    );
    expect(item.replenishmentSystem).toBe("Buy");
    expect(item.defaultMethodType).toBe("Pull from Inventory");
    expect(item.name).toBe("HDW-010");
    expect(item.revision).toBe("B");
  });

  it("never proposes a unit the company lacks", () => {
    expect(
      defaultUnitOfMeasureCode({
        unitsOfMeasure: [{ code: "PC", name: "x" }],
        defaults: DEFAULT_PUSH_DEFAULTS
      })
    ).toBe("PC");
    expect(
      defaultUnitOfMeasureCode({
        unitsOfMeasure: [],
        defaults: DEFAULT_PUSH_DEFAULTS
      })
    ).toBe("EA");
  });
});

describe("mergeItemEdits", () => {
  const proposed = proposeItem(
    { partNumber: "PAD-005", name: "Foot pad" },
    options
  );

  it("applies valid edits and trims text", () => {
    const merged = mergeItemEdits(
      proposed,
      {
        name: "  Rubber foot pad ",
        description: " Nitrile ",
        replenishmentSystem: "Buy",
        defaultMethodType: "Purchase to Order",
        itemTrackingType: "Batch",
        unitOfMeasureCode: "M"
      },
      options
    );
    expect(merged).toEqual({
      ok: true,
      item: {
        ...proposed,
        name: "Rubber foot pad",
        description: "Nitrile",
        replenishmentSystem: "Buy",
        defaultMethodType: "Purchase to Order",
        itemTrackingType: "Batch",
        unitOfMeasureCode: "M"
      }
    });
  });

  it("refuses an empty name, unknown enums and foreign units", () => {
    const merged = mergeItemEdits(
      proposed,
      {
        name: "  ",
        replenishmentSystem: "Steal" as never,
        defaultMethodType: "Wish" as never,
        itemTrackingType: "Lot" as never,
        unitOfMeasureCode: "KG"
      },
      options
    );
    expect(merged.ok).toBe(false);
    if (merged.ok) return;
    expect(merged.errors).toEqual([
      "Name is required",
      "Replenishment system is not valid",
      "Default method type is not valid",
      "Tracking type is not valid",
      "Unit of measure is not one of the company's units"
    ]);
  });

  it("holds the merged pair to the replenishment/method interlock", () => {
    const merged = mergeItemEdits(
      proposed,
      { defaultMethodType: "Purchase to Order" },
      options
    );
    expect(merged).toEqual({
      ok: false,
      errors: ["Purchase to Order is not a valid method for Make items"]
    });
    // Changing both sides together is fine.
    expect(
      mergeItemEdits(
        proposed,
        { replenishmentSystem: "Buy", defaultMethodType: "Purchase to Order" },
        options
      ).ok
    ).toBe(true);
  });

  it("ignores locked and unknown keys", () => {
    const merged = mergeItemEdits(
      proposed,
      { readableId: "HACK", revision: "Z", foo: 1 } as never,
      options
    );
    expect(merged).toEqual({ ok: true, item: proposed });
  });

  it("merges edits for many creates, reporting errors per key", () => {
    const { items, errors } = mergeEditsForCreates(
      [
        { key: "a", proposed },
        { key: "b", proposed }
      ],
      { a: { name: "A" }, b: { name: "" } },
      options
    );
    expect(items.get("a")?.name).toBe("A");
    expect(items.has("b")).toBe(false);
    expect(errors).toEqual([{ key: "b", errors: ["Name is required"] }]);
  });
});

describe("reconcileMethodForReplenishment", () => {
  it("keeps a legal method and swaps an illegal one for the first allowed", () => {
    expect(reconcileMethodForReplenishment("Make", "Make to Order")).toBe(
      "Make to Order"
    );
    expect(reconcileMethodForReplenishment("Buy", "Make to Order")).toBe(
      "Pull from Inventory"
    );
  });
});

describe("currentItemFields", () => {
  it("coerces an item's stored fields to the enums", () => {
    expect(
      currentItemFields({
        replenishmentSystem: "Make",
        defaultMethodType: "Make to Order",
        itemTrackingType: "Serial"
      })
    ).toEqual({
      replenishmentSystem: "Make",
      defaultMethodType: "Make to Order",
      itemTrackingType: "Serial"
    });
  });

  it("falls back for missing values and reconciles an illegal pair", () => {
    expect(
      currentItemFields({
        replenishmentSystem: "Buy",
        defaultMethodType: "Make to Order",
        itemTrackingType: null
      })
    ).toEqual({
      replenishmentSystem: "Buy",
      defaultMethodType: "Pull from Inventory",
      itemTrackingType: "Inventory"
    });
  });
});

describe("mergeExistingItemEdits", () => {
  const current = {
    replenishmentSystem: "Make",
    defaultMethodType: "Make to Order",
    itemTrackingType: "Inventory"
  } as const;

  it("returns no changes for an empty edit", () => {
    const result = mergeExistingItemEdits(current, undefined);
    expect(result).toEqual({ ok: true, values: current, changed: {} });
  });

  it("returns only the fields that differ from the current values", () => {
    const result = mergeExistingItemEdits(current, {
      replenishmentSystem: "Make",
      itemTrackingType: "Serial"
    });
    expect(result).toEqual({
      ok: true,
      values: { ...current, itemTrackingType: "Serial" },
      changed: { itemTrackingType: "Serial" }
    });
  });

  it("refuses a method the replenishment system does not allow", () => {
    const result = mergeExistingItemEdits(current, {
      replenishmentSystem: "Buy",
      defaultMethodType: "Make to Order"
    });
    expect(result.ok).toBe(false);
  });

  it("ignores name, description and unit on an existing edit", () => {
    const result = mergeExistingItemEdits(current, {
      name: "Ignored",
      description: "Ignored",
      unitOfMeasureCode: "M"
    });
    expect(result).toEqual({ ok: true, values: current, changed: {} });
  });
});

describe("mergeChangeNoticeEdit", () => {
  it("applies a name and clears an empty description", () => {
    expect(
      mergeChangeNoticeEdit(
        { name: "Onshape release A", description: "x" },
        { name: " ECO-12 ", description: "  " }
      )
    ).toEqual({
      ok: true,
      changeNotice: { name: "ECO-12", description: null }
    });
  });

  it("refuses an empty name", () => {
    expect(
      mergeChangeNoticeEdit({ name: "n", description: null }, { name: "" })
    ).toEqual({ ok: false, errors: ["Change notice name is required"] });
  });
});

describe("buildPartPlan", () => {
  const parts = [
    {
      partId: "p1",
      name: "Foot pad",
      partNumber: "PAD-005",
      revision: null,
      description: "Rubber",
      microversionId: "m2"
    },
    { partId: "p2", name: "Stud", partNumber: "STD-006", revision: "A" },
    { partId: "p3", name: "Nameless", partNumber: null, revision: null },
    { partId: "p4", name: "Top", partNumber: "TOP-001", revision: null }
  ];
  const items = [
    {
      id: "item-1",
      readableId: "PAD-005",
      revision: "0",
      name: "Foot pad (old)",
      description: null
    },
    { id: "item-2", readableId: "STD-006", revision: "0", name: "Stud" }
  ];

  it("classifies create / adopt / update / unchanged / skip in request order", () => {
    const rows = buildPartPlan({
      documentId: "d",
      elementId: "e",
      parts,
      requestedPartIds: ["p4", "p1", "p2", "p3", "missing"],
      mappings: [
        {
          entityId: "item-1",
          externalId: "d:e:p1",
          lastSyncedAt: null,
          metadata: { microversionId: "m1" }
        }
      ],
      items,
      options
    });
    expect(rows.map((r) => [r.partId, r.action])).toEqual([
      ["p4", "create"],
      ["p1", "update"],
      ["p2", "adopt"],
      ["p3", "skip-no-part-number"]
    ]);
    expect(rows[0]?.proposed?.readableId).toBe("TOP-001");
    expect(rows[1]?.itemId).toBe("item-1");
    // Descriptions default to Set at creation: kept, shown as a difference.
    expect(rows[1]?.changes).toEqual([]);
    expect(rows[1]?.keptDifferences).toEqual([
      {
        label: "Short Description",
        onshape: "Foot pad",
        carbon: "Foot pad (old)"
      },
      { label: "Long Description", onshape: "Rubber", carbon: null }
    ]);
    expect(rows[2]?.item?.readableId).toBe("STD-006");
    expect(rows[2]?.proposed).toBeNull();
  });

  it("overwrites the descriptions set to Update on every push", () => {
    const rows = buildPartPlan({
      documentId: "d",
      elementId: "e",
      parts,
      requestedPartIds: ["p1"],
      mappings: [
        {
          entityId: "item-1",
          externalId: "d:e:p1",
          lastSyncedAt: null,
          metadata: { microversionId: "m1" }
        }
      ],
      items,
      options,
      mapping: {
        map: [],
        definitions: [],
        descriptionModes: { name: "everyPush", description: "create" },
        heldCustomFields: new Map()
      }
    });
    expect(rows[0]?.changes).toEqual([
      { field: "name", from: "Foot pad (old)", to: "Foot pad" }
    ]);
    expect(rows[0]?.keptDifferences).toEqual([
      { label: "Long Description", onshape: "Rubber", carbon: null }
    ]);
  });

  it("reports unchanged when the mapping's microversion matches", () => {
    const rows = buildPartPlan({
      documentId: "d",
      elementId: "e",
      parts,
      requestedPartIds: ["p1"],
      mappings: [
        {
          entityId: "item-1",
          externalId: "d:e:p1",
          lastSyncedAt: null,
          metadata: { microversionId: "m2" }
        }
      ],
      items,
      options
    });
    expect(rows[0]?.action).toBe("unchanged");
    expect(rows[0]?.changes).toEqual([]);
  });

  it("treats a mapping whose item is gone as no link", () => {
    const rows = buildPartPlan({
      documentId: "d",
      elementId: "e",
      parts,
      requestedPartIds: ["p1"],
      mappings: [
        { entityId: "deleted", externalId: "d:e:p1", lastSyncedAt: null }
      ],
      items,
      options
    });
    expect(rows[0]?.action).toBe("adopt");
  });
});

describe("buildAssemblyPlan", () => {
  const nodes: OnshapeBomNode[] = [
    node({
      index: "1",
      partNumber: "ASM-008",
      name: "Foot assembly",
      quantity: 4,
      children: [
        node({ index: "1.1", level: 2, partNumber: "LEG-003", name: "Leg" }),
        node({
          index: "1.2",
          level: 2,
          partNumber: "HDW-010",
          name: "Bolt",
          standardContent: true,
          quantity: 2
        }),
        node({ index: "1.3", level: 2, partNumber: null, name: "Unnamed" })
      ]
    }),
    node({ index: "2", partNumber: "TOP-001", name: "Top" })
  ];

  describe("released methods", () => {
    const build = (
      reusableDraftByItemId?: Map<
        string,
        { id: string; version: number | null }
      >
    ) =>
      buildAssemblyPlan({
        documentId: "d",
        wv: "w",
        wvId: "w1",
        elementId: "e",
        root: {
          partNumber: "WB-100",
          name: "Workbench",
          description: null,
          revision: null
        },
        nodes: [node({ index: "1", partNumber: "TOP-001", name: "Top" })],
        items: [{ id: "root", readableId: "WB-100", revision: "0", name: "W" }],
        methodByItemId: new Map([["root", { id: "active", status: "Active" }]]),
        mappedLinesByMethodId: new Map([
          ["active", [{ readableId: "OLD-1", quantity: 1 }]],
          ["draft", [{ readableId: "DRAFT-1", quantity: 2 }]]
        ]),
        manualLinesByMethodId: new Map(),
        options,
        reusableDraftByItemId
      });

    it("counts the Active method's lines when the push will copy a new Draft", () => {
      const [method] = build().methods;
      expect(method?.status).toBe("active");
      expect(method?.reusedDraftVersion).toBeUndefined();
      expect(method?.replaces).toEqual([{ readableId: "OLD-1", quantity: 1 }]);
    });

    it("takes a refused method out and lists it with its reason", () => {
      const plan = withRefusedMethods(
        build(),
        new Map([["root", "its make method is a Draft on change notice CN-1."]])
      );
      expect(plan.methods).toEqual([]);
      expect(plan.skipped).toContain(
        "WB-100: its make method is a Draft on change notice CN-1."
      );
    });

    it("does not refuse an Active method the push leaves unchanged", () => {
      const built = buildAssemblyPlan({
        documentId: "d",
        wv: "w",
        wvId: "w1",
        elementId: "e",
        root: {
          partNumber: "WB-100",
          name: "Workbench",
          description: null,
          revision: null
        },
        nodes: [node({ index: "1", partNumber: "TOP-001", name: "Top" })],
        items: [{ id: "root", readableId: "WB-100", revision: "0", name: "W" }],
        methodByItemId: new Map([["root", { id: "active", status: "Active" }]]),
        mappedLinesByMethodId: new Map([
          ["active", [{ readableId: "TOP-001", quantity: 1 }]]
        ]),
        manualLinesByMethodId: new Map(),
        options
      });
      expect(built.methods[0]?.unchanged).toBe(true);
      expect(withRefusedMethods(built, new Map([["root", "released"]]))).toBe(
        built
      );
    });

    it("counts the reused Draft's lines and names its version", () => {
      const [method] = build(
        new Map([["root", { id: "draft", version: 3 }]])
      ).methods;
      expect(method?.reusedDraftVersion).toBe(3);
      expect(method?.replaces).toEqual([
        { readableId: "DRAFT-1", quantity: 2 }
      ]);
    });
  });

  describe("depth", () => {
    const build = (depth: "all" | "top") =>
      buildAssemblyPlan({
        documentId: "d",
        wv: "w",
        wvId: "w1",
        elementId: "e",
        root: {
          partNumber: "WB-100",
          name: "Workbench",
          description: null,
          revision: null
        },
        nodes,
        items: [],
        methodByItemId: new Map(),
        mappedLinesByMethodId: new Map(),
        manualLinesByMethodId: new Map(),
        options,
        depth
      });

    it("defaults to the whole tree, and says so", () => {
      const plan = build("all");
      expect(plan.depth).toBe("all");
      expect(plan.deeper).toBeUndefined();
      expect(plan.methods.map((m) => m.parentPartNumber)).toEqual([
        "WB-100",
        "ASM-008"
      ]);
      expect(plan.items.map((i) => i.partNumber).sort()).toEqual([
        "ASM-008",
        "HDW-010",
        "LEG-003",
        "TOP-001"
      ]);
    });

    it("writes one method and only the top level's items at top depth", () => {
      const plan = build("top");
      expect(plan.methods).toHaveLength(1);
      const [rootMethod] = plan.methods;
      expect(rootMethod?.parentPartNumber).toBe("WB-100");
      // The sub-assembly is still a line of the root.
      expect(rootMethod?.writes.map((w) => w.partNumber)).toEqual([
        "ASM-008",
        "TOP-001"
      ]);
      expect(plan.items.map((i) => i.partNumber).sort()).toEqual([
        "ASM-008",
        "TOP-001"
      ]);
    });

    it("still classifies an unexploded sub-assembly as an assembly", () => {
      const item = build("top").items.find((i) => i.partNumber === "ASM-008");
      expect(item?.isAssembly).toBe(true);
      expect(item?.proposed?.replenishmentSystem).toBe("Make");
    });

    it("reports what a top-level push leaves out", () => {
      const plan = build("top");
      expect(plan.deeper?.subAssemblies).toEqual(["ASM-008"]);
      // LEG-003 and HDW-010; the unnamed row has no part number.
      expect(plan.deeper?.partCount).toBe(2);
    });
  });

  it("plans creates, reuses, methods and the line diff", () => {
    const plan = buildAssemblyPlan({
      documentId: "d",
      wv: "w",
      wvId: "w1",
      elementId: "e",
      root: {
        partNumber: "WB-100",
        name: "Workbench",
        description: null,
        revision: null
      },
      nodes,
      items: [
        { id: "wb", readableId: "WB-100", revision: "0", name: "Workbench" },
        { id: "hdw", readableId: "HDW-010", revision: "0", name: "Bolt" }
      ],
      methodByItemId: new Map([["wb", { id: "m-wb", status: "Draft" }]]),
      mappedLinesByMethodId: new Map([
        ["m-wb", [{ readableId: "ASM-008", quantity: 4 }]]
      ]),
      manualLinesByMethodId: new Map([
        ["m-wb", [{ readableId: "PAD-005", quantity: 99 }]]
      ]),
      options
    });

    expect(plan.root.action).toBe("reuse");
    expect(plan.root.itemId).toBe("wb");
    expect(
      plan.items.map((i) => [i.partNumber, i.action, i.isAssembly])
    ).toEqual([
      ["ASM-008", "create", true],
      ["LEG-003", "create", false],
      ["HDW-010", "reuse", false],
      ["TOP-001", "create", false]
    ]);
    expect(plan.items[0]?.proposed?.replenishmentSystem).toBe("Make");
    expect(plan.skipped).toEqual(["Unnamed: no part number in Onshape"]);

    expect(plan.methods.map((m) => [m.parentPartNumber, m.status])).toEqual([
      ["WB-100", "draft"],
      ["ASM-008", "new"]
    ]);
    const root = plan.methods[0];
    expect(root?.writes.map((w) => w.partNumber)).toEqual([
      "ASM-008",
      "TOP-001"
    ]);
    expect(root?.replaces).toEqual([{ readableId: "ASM-008", quantity: 4 }]);
    expect(root?.keeps).toEqual([{ readableId: "PAD-005", quantity: 99 }]);
    const sub = plan.methods[1];
    expect(sub?.writes.map((w) => w.partNumber)).toEqual([
      "LEG-003",
      "HDW-010"
    ]);
    expect(sub?.replaces).toEqual([]);
  });

  it("skips a child whose Carbon item can never be a BOM line", () => {
    const plan = buildAssemblyPlan({
      documentId: "d",
      wv: "w",
      wvId: "w1",
      elementId: "e",
      root: {
        partNumber: "WB-100",
        name: null,
        description: null,
        revision: null
      },
      nodes: [node({ index: "1", partNumber: "TOP-001", name: "Top" })],
      items: [
        {
          id: "tool",
          readableId: "TOP-001",
          revision: "0",
          name: "Top",
          type: "Tool"
        }
      ],
      methodByItemId: new Map(),
      mappedLinesByMethodId: new Map(),
      manualLinesByMethodId: new Map(),
      options
    });
    expect(plan.items).toEqual([]);
    expect(plan.methods[0]?.writes).toEqual([]);
    expect(plan.skipped).toEqual([
      "TOP-001: Carbon has it as a Tool item, which cannot be a BOM line"
    ]);
  });

  it("reuses the Part when a Tool shares its number", () => {
    const plan = buildAssemblyPlan({
      documentId: "d",
      wv: "w",
      wvId: "w1",
      elementId: "e",
      root: {
        partNumber: "WB-100",
        name: null,
        description: null,
        revision: null
      },
      nodes: [node({ index: "1", partNumber: "TOP-001", name: "Top" })],
      items: [
        {
          id: "tool",
          readableId: "TOP-001",
          revision: "0",
          name: "Top",
          type: "Tool"
        },
        {
          id: "part",
          readableId: "TOP-001",
          revision: "0",
          name: "Top",
          type: "Part"
        }
      ],
      methodByItemId: new Map(),
      mappedLinesByMethodId: new Map(),
      manualLinesByMethodId: new Map(),
      options
    });
    expect(plan.skipped).toEqual([]);
    expect(plan.items.map((item) => item.itemId)).toEqual(["part"]);
    expect(plan.methods[0]?.writes.map((w) => w.partNumber)).toEqual([
      "TOP-001"
    ]);
  });

  it("flags released and missing methods on reused parents", () => {
    const plan = buildAssemblyPlan({
      documentId: "d",
      wv: "w",
      wvId: "w1",
      elementId: "e",
      root: {
        partNumber: "WB-100",
        name: null,
        description: null,
        revision: null
      },
      nodes,
      items: [
        { id: "wb", readableId: "WB-100", revision: "0", name: "Workbench" },
        { id: "asm", readableId: "ASM-008", revision: "0", name: "Foot" }
      ],
      methodByItemId: new Map([["wb", { id: "m-wb", status: "Active" }]]),
      mappedLinesByMethodId: new Map(),
      manualLinesByMethodId: new Map(),
      options
    });
    expect(plan.methods.map((m) => [m.parentPartNumber, m.status])).toEqual([
      ["WB-100", "active"],
      ["ASM-008", "missing"]
    ]);
    expect(plan.root.proposed).toBeNull();
  });

  describe("conflicts", () => {
    const conflictNodes = [
      node({
        index: "1",
        partNumber: "LEG-003",
        name: "Leg",
        itemSource: { documentId: "d2", elementId: "ps", partId: "JHD" }
      }),
      node({
        index: "2",
        partNumber: "HDW-010",
        name: "Bolt",
        itemSource: { documentId: "d2", elementId: "ps", partId: "JKD" }
      }),
      node({ index: "3", partNumber: "PAD-005", name: "Pad" }),
      node({ index: "4", partNumber: "TOP-001", name: "Top" })
    ];
    const build = (links: Array<[string, string]>) =>
      buildAssemblyPlan({
        documentId: "d",
        wv: "w",
        wvId: "w1",
        elementId: "e",
        root: {
          partNumber: "WB-100",
          name: null,
          description: null,
          revision: null
        },
        nodes: conflictNodes,
        items: [
          { id: "wb", readableId: "WB-100", revision: "0", name: "Workbench" },
          { id: "leg", readableId: "LEG-003", revision: "0", name: "Leg" },
          { id: "hdw", readableId: "HDW-010", revision: "0", name: "Bolt" },
          { id: "pad", readableId: "PAD-005", revision: "0", name: "Pad" }
        ],
        methodByItemId: new Map(),
        mappedLinesByMethodId: new Map(),
        manualLinesByMethodId: new Map(),
        options,
        linkedItemIdByExternalId: new Map(links)
      });

    it("marks a reuse found by part number alone, never a linked one or a create", () => {
      const plan = build([
        ["d:e:assembly", "wb"],
        ["d2:ps:JHD", "leg"],
        // Linked, but to a different item than the number resolves to.
        ["d2:ps:JKD", "someone-else"]
      ]);
      expect(plan.root.conflict).toBeUndefined();
      expect(
        Object.fromEntries(plan.items.map((i) => [i.partNumber, i.conflict]))
      ).toEqual({
        "LEG-003": undefined,
        "HDW-010": true,
        // No itemSource, so nothing to link through.
        "PAD-005": true,
        "TOP-001": undefined
      });
    });

    it("treats an unlinked reused root as a conflict", () => {
      expect(build([]).root.conflict).toBe(true);
    });

    it("keeps a part linked when a release added a higher revision the mapping does not point at", () => {
      // A release made Rev B the default and left the mappings on the Rev A
      // items; a link to Rev A is still a link to the part.
      const plan = buildAssemblyPlan({
        documentId: "d",
        wv: "w",
        wvId: "w1",
        elementId: "e",
        root: {
          partNumber: "WB-100",
          name: null,
          description: null,
          revision: null
        },
        nodes: conflictNodes,
        items: [
          {
            id: "wb-a",
            readableId: "WB-100",
            revision: "A",
            name: "Workbench"
          },
          {
            id: "wb-b",
            readableId: "WB-100",
            revision: "B",
            name: "Workbench"
          },
          { id: "leg-a", readableId: "LEG-003", revision: "A", name: "Leg" },
          { id: "leg-b", readableId: "LEG-003", revision: "B", name: "Leg" },
          { id: "hdw", readableId: "HDW-010", revision: "0", name: "Bolt" },
          { id: "pad", readableId: "PAD-005", revision: "0", name: "Pad" }
        ],
        methodByItemId: new Map(),
        mappedLinesByMethodId: new Map(),
        manualLinesByMethodId: new Map(),
        options,
        linkedItemIdByExternalId: new Map([
          ["d:e:assembly", "wb-a"],
          ["d2:ps:JHD", "leg-a"]
        ])
      });
      expect(plan.root.conflict).toBeUndefined();
      expect(
        Object.fromEntries(plan.items.map((i) => [i.partNumber, i.conflict]))
      ).toEqual({
        "LEG-003": undefined,
        // Linked to no item: a conflict.
        "HDW-010": true,
        "PAD-005": true,
        "TOP-001": undefined
      });
    });
  });
});

describe("buildReleasePlan", () => {
  const release: PanelRelease = {
    releaseId: "rel-1",
    releaseName: "Release WB-100 A",
    createdAt: "2026-08-26T00:00:00Z",
    state: "not-pushed",
    items: [
      {
        partNumber: "WB-100",
        revision: "A",
        elementType: 1,
        documentId: "d",
        versionId: "v1",
        elementId: "e-wb",
        partId: null,
        configuration: null,
        obsolete: false,
        state: "missing",
        itemId: null
      },
      {
        partNumber: "PAD-005",
        revision: "A",
        elementType: 0,
        documentId: "d",
        versionId: "v1",
        elementId: "e-ps",
        partId: null,
        configuration: null,
        obsolete: false,
        state: "missing",
        itemId: null
      },
      {
        partNumber: "NEW-999",
        revision: "A",
        elementType: 0,
        documentId: "d",
        versionId: "v1",
        elementId: "e-ps",
        partId: null,
        configuration: null,
        obsolete: false,
        state: "missing",
        itemId: null
      },
      {
        partNumber: "WB-100",
        revision: "A",
        elementType: 2,
        documentId: "d",
        versionId: "v1",
        elementId: "e-drw",
        partId: null,
        configuration: null,
        obsolete: false,
        state: "missing",
        itemId: null
      },
      {
        partNumber: "LONE-DRW",
        revision: "A",
        elementType: 2,
        documentId: "d",
        versionId: "v1",
        elementId: "e-drw2",
        partId: null,
        configuration: null,
        obsolete: false,
        state: "missing",
        itemId: null
      }
    ]
  };

  it("classifies reuse / revision / create, children and drawings", () => {
    const plan = buildReleasePlan({
      documentId: "d",
      release,
      items: [
        { id: "pad-0", readableId: "PAD-005", revision: "0", name: "Foot pad" },
        { id: "wb-a", readableId: "WB-100", revision: "A", name: "Workbench" },
        { id: "hdw", readableId: "HDW-010", revision: "0", name: "Bolt" }
      ],
      bomLinesByElementId: {
        "e-wb": [
          node({ partNumber: "PAD-005", name: "Foot pad" }),
          node({ index: "2", partNumber: "NEW-999", name: "Bracket" }),
          node({
            index: "3",
            partNumber: "HDW-010",
            name: "Bolt",
            standardContent: true
          }),
          node({
            index: "4",
            partNumber: "HDW-011",
            name: "Nut",
            standardContent: true
          })
        ]
      },
      methodByItemId: new Map([["wb-a", { id: "m-wb-a", status: "Active" }]]),
      options
    });

    expect(plan.items.map((i) => [i.partNumber, i.action])).toEqual([
      ["WB-100", "reuse"],
      ["PAD-005", "revision"],
      ["NEW-999", "create"],
      ["WB-100", "drawing"],
      ["LONE-DRW", "drawing-unmatched"]
    ]);
    expect(plan.items[0]?.methodStatus).toBe("active");
    expect(plan.items[1]?.baseItemId).toBe("pad-0");
    expect(plan.items[1]?.baseRevision).toBe("0");
    // The release list carries only part numbers: the name comes from the BOM.
    expect(plan.items[2]?.proposed?.name).toBe("Bracket");
    expect(plan.items[2]?.proposed?.revision).toBe("A");

    expect(plan.children.map((c) => [c.partNumber, c.action])).toEqual([
      ["HDW-010", "reuse"],
      ["HDW-011", "create"]
    ]);
    expect(plan.children[1]?.proposed?.replenishmentSystem).toBe("Buy");

    expect(plan.changeNotice).toEqual({
      name: "Release WB-100 A",
      description: null
    });
    expect(plan.makeDefault).toBe(true);
    expect(plan.alreadyPushed).toBe(false);
  });

  it("ties a drawing numbered apart from its model through the release package", () => {
    const drawingOnly: PanelRelease = {
      ...release,
      items: [
        {
          ...release.items[4]!,
          partNumber: "WB-100-DWG",
          revision: "C",
          elementId: "e-drw"
        },
        {
          ...release.items[4]!,
          partNumber: "PAD-005-DWG",
          revision: "C",
          elementId: "e-drw3"
        }
      ]
    };
    const plan = buildReleasePlan({
      documentId: "d",
      release: drawingOnly,
      items: [
        { id: "wb-b", readableId: "WB-100", revision: "B", name: "Workbench" },
        { id: "wb-c", readableId: "WB-100", revision: "C", name: "Workbench" }
      ],
      bomLinesByElementId: {},
      methodByItemId: new Map(),
      options,
      drawingModelByElementId: new Map([
        ["e-drw", { partNumber: "WB-100", revision: "C" }],
        // Carbon has no PAD-005 Rev C: nothing to attach to.
        ["e-drw3", { partNumber: "PAD-005", revision: "C" }]
      ])
    });
    expect(
      plan.items.map((i) => [i.partNumber, i.action, i.drawingOf])
    ).toEqual([
      [
        "WB-100-DWG",
        "drawing",
        { partNumber: "WB-100", revision: "C", itemId: "wb-c" }
      ],
      [
        "PAD-005-DWG",
        "drawing-unmatched",
        { partNumber: "PAD-005", revision: "C" }
      ]
    ]);
    expect(plan.changeNotice).toBeNull();
  });

  it("prefers the model with the drawing's own number in the release", () => {
    const plan = buildReleasePlan({
      documentId: "d",
      release,
      items: [],
      bomLinesByElementId: {},
      methodByItemId: new Map(),
      options,
      drawingModelByElementId: new Map([
        ["e-drw", { partNumber: "OTHER-1", revision: "A" }]
      ])
    });
    const drawing = plan.items.find((i) => i.elementId === "e-drw");
    expect(drawing?.action).toBe("drawing");
    expect(drawing?.drawingOf).toEqual({ partNumber: "WB-100", revision: "A" });
  });

  it("proposes no change notice when everything is already at its letter", () => {
    const plan = buildReleasePlan({
      documentId: "d",
      release: { ...release, items: release.items.slice(0, 2) },
      items: [
        { id: "wb-a", readableId: "WB-100", revision: "A", name: "Workbench" },
        { id: "pad-a", readableId: "PAD-005", revision: "A", name: "Foot pad" }
      ],
      bomLinesByElementId: {},
      methodByItemId: new Map(),
      options
    });
    expect(plan.alreadyPushed).toBe(true);
    expect(plan.changeNotice).toBeNull();
    expect(plan.items[0]?.methodStatus).toBe("missing");
  });

  it("is not already pushed when only a BOM child is missing, and proposes no notice for it", () => {
    const plan = buildReleasePlan({
      documentId: "d",
      release: { ...release, items: release.items.slice(0, 1) },
      items: [
        { id: "wb-a", readableId: "WB-100", revision: "A", name: "Workbench" }
      ],
      bomLinesByElementId: {
        "e-wb": [
          node({
            partNumber: "HDW-011",
            name: "Nut",
            standardContent: true
          })
        ]
      },
      methodByItemId: new Map([["wb-a", { id: "m-wb-a", status: "Draft" }]]),
      options
    });
    expect(plan.children.map((c) => [c.partNumber, c.action])).toEqual([
      ["HDW-011", "create"]
    ]);
    expect(plan.alreadyPushed).toBe(false);
    // The apply records only created release items on the notice.
    expect(plan.changeNotice).toBeNull();
  });

  it("copies a new revision from the newest one, even while it waits in its notice", () => {
    const plan = buildReleasePlan({
      documentId: "d",
      release: {
        ...release,
        items: [{ ...release.items[1]!, revision: "B" }]
      },
      items: [
        {
          id: "pad-0",
          readableId: "PAD-005",
          revision: "0",
          active: true,
          name: "Foot pad"
        },
        {
          id: "pad-a",
          readableId: "PAD-005",
          revision: "A",
          active: false,
          name: "Foot pad"
        }
      ],
      bomLinesByElementId: {},
      methodByItemId: new Map(),
      options
    });
    expect(plan.items[0]).toMatchObject({
      action: "revision",
      baseItemId: "pad-a",
      baseRevision: "A"
    });
  });

  it("points a BOM child at the revision the BOM names, and says when Carbon lacks it", () => {
    const plan = buildReleasePlan({
      documentId: "d",
      release: { ...release, items: release.items.slice(0, 1) },
      items: [
        { id: "wb-0", readableId: "WB-100", revision: "0", name: "Workbench" },
        {
          id: "leg-0",
          readableId: "ASM-008",
          revision: "0",
          active: true,
          name: "Leg assembly"
        },
        {
          id: "leg-a",
          readableId: "ASM-008",
          revision: "A",
          active: false,
          name: "Leg assembly"
        },
        {
          id: "top-0",
          readableId: "ASM-007",
          revision: "0",
          active: true,
          name: "Top assembly"
        }
      ],
      bomLinesByElementId: {
        "e-wb": [
          node({ partNumber: "ASM-008", name: "Leg assembly", revision: "A" }),
          node({
            index: "2",
            partNumber: "ASM-007",
            name: "Top assembly",
            revision: "B"
          })
        ]
      },
      methodByItemId: new Map(),
      options
    });
    expect(
      plan.children.map((child) => [
        child.partNumber,
        child.itemId,
        child.itemRevision,
        child.missingRevision
      ])
    ).toEqual([
      ["ASM-008", "leg-a", "A", undefined],
      ["ASM-007", "top-0", "0", "B"]
    ]);
  });

  it("carries each released part's partId and configuration to the export", () => {
    const released = release.items[1]!;
    const plan = buildReleasePlan({
      documentId: "d",
      release: {
        ...release,
        items: [{ ...released, partId: "JHD", configuration: "size%3DLarge" }]
      },
      items: [],
      bomLinesByElementId: {},
      methodByItemId: new Map(),
      options
    });
    expect(plan.items[0]).toMatchObject({
      partNumber: "PAD-005",
      partId: "JHD",
      configuration: "size%3DLarge"
    });
  });
});

describe("pickAdoptTarget", () => {
  const rows = [
    {
      id: "mat",
      readableId: "X-1",
      revision: "0",
      name: "m",
      type: "Material"
    },
    { id: "p0", readableId: "X-1", revision: "0", name: "p", type: "Part" },
    { id: "pA", readableId: "X-1", revision: "A", name: "p", type: "Part" }
  ];
  it("prefers the Part at the Onshape revision, then the latest Part, never another type", () => {
    expect(pickAdoptTarget(rows, "A")?.id).toBe("pA");
    expect(pickAdoptTarget(rows, null)?.id).toBe("p0");
    expect(pickAdoptTarget(rows, "Z")?.id).toBe("pA");
    expect(
      pickAdoptTarget([rows[0] as (typeof rows)[number]], "0")
    ).toBeUndefined();
  });
});

describe("assemblyTextChanges", () => {
  it("writes only the descriptions Onshape gives that differ", () => {
    expect(
      assemblyTextChanges(
        { name: "Foot assembly (Carbon BOM)", description: "ours" },
        { name: "Foot assembly", description: null }
      )
    ).toEqual([
      { field: "name", from: "Foot assembly (Carbon BOM)", to: "Foot assembly" }
    ]);
    expect(
      assemblyTextChanges(
        { name: "Pad", description: null },
        { name: "Pad", description: "Rubber pad" }
      )
    ).toEqual([{ field: "description", from: null, to: "Rubber pad" }]);
  });
});

describe("released parts in workspace pushes", () => {
  const released = new Map([["TOP-001", { itemId: "top-c", revision: "C" }]]);

  it("leaves a released part alone in a part push, even when it is linked", () => {
    const rows = buildPartPlan({
      documentId: "d",
      elementId: "e",
      parts: [
        { partId: "p1", name: "Top", partNumber: "TOP-001", revision: "C" }
      ],
      requestedPartIds: ["p1"],
      mappings: [
        {
          entityId: "top-0",
          externalId: "d:e:p1",
          lastSyncedAt: null,
          metadata: { microversionId: "m1" }
        }
      ],
      items: [
        { id: "top-0", readableId: "TOP-001", revision: "0", name: "Top" },
        { id: "top-c", readableId: "TOP-001", revision: "C", name: "Top" }
      ],
      options,
      released
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "released",
      itemId: "top-c",
      item: { revision: "C" }
    });
    expect(rows[0]?.current).toBeUndefined();
  });

  it("writes no fields to a released root or child in an assembly push", () => {
    const plan = buildAssemblyPlan({
      documentId: "d",
      wv: "w",
      wvId: "w1",
      elementId: "e",
      root: {
        partNumber: "WB-100",
        name: "Workbench",
        description: "New text",
        revision: "B"
      },
      nodes: [node({ index: "1", partNumber: "TOP-001", name: "Top" })],
      items: [
        { id: "wb-b", readableId: "WB-100", revision: "B", name: "Old text" },
        { id: "top-c", readableId: "TOP-001", revision: "C", name: "Old" }
      ],
      methodByItemId: new Map(),
      mappedLinesByMethodId: new Map(),
      manualLinesByMethodId: new Map(),
      options,
      mapping: {
        map: [],
        definitions: [],
        descriptionModes: { name: "everyPush", description: "everyPush" },
        heldCustomFields: new Map()
      },
      released: new Map([
        ["WB-100", { itemId: "wb-b", revision: "B" }],
        ["TOP-001", { itemId: "top-c", revision: "C" }]
      ])
    });
    expect(plan.root).toMatchObject({
      action: "reuse",
      itemId: "wb-b",
      released: { revision: "B" }
    });
    expect(plan.root.changes).toBeUndefined();
    expect(plan.root.current).toBeUndefined();
    expect(plan.items[0]).toMatchObject({
      action: "reuse",
      itemId: "top-c",
      released: { revision: "C" }
    });
    expect(plan.items[0]?.conflict).toBeUndefined();
    expect(plan.items[0]?.current).toBeUndefined();
  });
});

describe("buildAssemblyPlan unchanged released methods", () => {
  const build = (
    lines: Array<{ readableId: string; quantity: number }>,
    reusableDraftByItemId = new Map<
      string,
      { id: string; version: number | null }
    >()
  ) =>
    buildAssemblyPlan({
      documentId: "d",
      wv: "w",
      wvId: "w1",
      elementId: "e",
      root: {
        partNumber: "WB-100",
        name: "Workbench",
        description: null,
        revision: null
      },
      nodes: [
        node({ index: "1", partNumber: "TOP-001", name: "Top", quantity: 1 }),
        node({ index: "2", partNumber: "LEG-003", name: "Leg", quantity: 4 })
      ],
      items: [{ id: "root", readableId: "WB-100", revision: "0", name: "W" }],
      methodByItemId: new Map([["root", { id: "active", status: "Active" }]]),
      mappedLinesByMethodId: new Map([["active", lines]]),
      manualLinesByMethodId: new Map(),
      options,
      reusableDraftByItemId
    }).methods[0];

  it("needs no Draft when the released method already has Onshape's lines", () => {
    expect(
      build([
        { readableId: "TOP-001", quantity: 1 },
        { readableId: "LEG-003", quantity: 4 }
      ])?.unchanged
    ).toBe(true);
  });

  it("needs a Draft when a quantity, a line or the order differs", () => {
    expect(
      build([
        { readableId: "TOP-001", quantity: 1 },
        { readableId: "LEG-003", quantity: 2 }
      ])?.unchanged
    ).toBeUndefined();
    expect(
      build([{ readableId: "TOP-001", quantity: 1 }])?.unchanged
    ).toBeUndefined();
    expect(
      build([
        { readableId: "LEG-003", quantity: 4 },
        { readableId: "TOP-001", quantity: 1 }
      ])?.unchanged
    ).toBeUndefined();
  });

  it("writes into a reused Draft as before", () => {
    expect(
      build(
        [
          { readableId: "TOP-001", quantity: 1 },
          { readableId: "LEG-003", quantity: 4 }
        ],
        new Map([["root", { id: "draft", version: 2 }]])
      )?.unchanged
    ).toBeUndefined();
  });
});

describe("buildAssemblyPlan descriptions", () => {
  const source = (partId: string) => ({
    documentId: "d2",
    elementId: "ps",
    partId
  });
  const everyPush = {
    map: [],
    definitions: [],
    descriptionModes: { name: "everyPush", description: "everyPush" } as const,
    heldCustomFields: new Map()
  };
  const build = (
    linkedItemIds?: Set<string>,
    links = new Map<string, string>(),
    mapping: typeof everyPush | null = everyPush
  ) =>
    buildAssemblyPlan({
      documentId: "d",
      wv: "w",
      wvId: "w1",
      elementId: "e",
      root: {
        partNumber: "WB-100",
        name: "Workbench",
        description: null,
        revision: null
      },
      nodes: [
        node({
          index: "1",
          partNumber: "LEG-003",
          name: "Leg tube",
          itemSource: source("JND")
        }),
        node({
          index: "2",
          partNumber: "PLT-004",
          name: "Mounting plate",
          itemSource: source("JQD")
        }),
        node({
          index: "3",
          partNumber: "HDW-010",
          name: "Hex nut",
          itemSource: source("JHD")
        })
      ],
      items: [
        {
          id: "wb",
          readableId: "WB-100",
          revision: "0",
          name: "Workbench (Carbon)"
        },
        {
          id: "leg",
          readableId: "LEG-003",
          revision: "0",
          name: "Leg (Carbon)"
        },
        {
          id: "plt",
          readableId: "PLT-004",
          revision: "0",
          name: "Plate (Carbon)"
        },
        {
          id: "hdw",
          readableId: "HDW-010",
          revision: "0",
          name: "Nut (Carbon)"
        }
      ],
      methodByItemId: new Map(),
      mappedLinesByMethodId: new Map(),
      manualLinesByMethodId: new Map(),
      options,
      linkedItemIdByExternalId: links,
      linkedItemIds,
      mapping: mapping ?? undefined
    });

  it("writes the root's and every child's this push links, not one linked elsewhere", () => {
    // LEG-003 is already linked to its row; PLT-004 is linked to another
    // Onshape part, so it keeps that link; HDW-010 is linked nowhere.
    const plan = build(
      new Set(["leg", "plt"]),
      new Map([["d2:ps:JND", "leg"]])
    );
    expect(plan.root.changes).toEqual([
      { field: "name", from: "Workbench (Carbon)", to: "Workbench" }
    ]);
    const byNumber = new Map(plan.items.map((item) => [item.partNumber, item]));
    expect(byNumber.get("LEG-003")?.changes).toEqual([
      { field: "name", from: "Leg (Carbon)", to: "Leg tube" }
    ]);
    expect(byNumber.get("PLT-004")?.changes).toBeUndefined();
    expect(byNumber.get("HDW-010")?.changes).toEqual([
      { field: "name", from: "Nut (Carbon)", to: "Hex nut" }
    ]);
  });

  it("only writes children already linked to their row when it can't tell what else is linked", () => {
    const plan = build(undefined, new Map([["d2:ps:JND", "leg"]]));
    const byNumber = new Map(plan.items.map((item) => [item.partNumber, item]));
    expect(byNumber.get("LEG-003")?.changes).toHaveLength(1);
    expect(byNumber.get("HDW-010")?.changes).toBeUndefined();
  });

  it("keeps Carbon's text when the descriptions are Set at creation", () => {
    const plan = build(new Set(["leg"]), new Map([["d2:ps:JND", "leg"]]), null);
    expect(plan.root.changes).toBeUndefined();
    expect(plan.root.keptDifferences).toEqual([
      {
        label: "Short Description",
        onshape: "Workbench",
        carbon: "Workbench (Carbon)"
      }
    ]);
    const leg = plan.items.find((item) => item.partNumber === "LEG-003");
    expect(leg?.changes).toBeUndefined();
    expect(leg?.keptDifferences).toHaveLength(1);
  });
});

describe("pairManualLines", () => {
  it("keeps a manual line for another item type that shares the number", () => {
    const { takesOver, keeps } = pairManualLines(
      [{ partNumber: "X-1", quantity: 2, itemType: "Part" }],
      [],
      [
        { readableId: "X-1", quantity: 5, itemType: "Material" },
        { readableId: "X-1", quantity: 1, itemType: "Part" }
      ]
    );
    expect(takesOver).toEqual([
      { readableId: "X-1", quantity: 1, itemType: "Part", onshapeQuantity: 2 }
    ]);
    expect(keeps).toEqual([
      { readableId: "X-1", quantity: 5, itemType: "Material" }
    ]);
  });

  it("takes over a manual line Onshape also lists, after the lines a push owns", () => {
    const { takesOver, keeps } = pairManualLines(
      [
        { partNumber: "PAD-005", quantity: 1 },
        { partNumber: "HDW-010", quantity: 1 },
        { partNumber: "HDW-011", quantity: 1 },
        { partNumber: "STD-006", quantity: 1 }
      ],
      [{ readableId: "STD-006", quantity: 1 }],
      [
        { readableId: "PAD-005", quantity: 2 },
        { readableId: "HDW-010", quantity: 1 },
        { readableId: "GLUE-01", quantity: 1 },
        { readableId: "STD-006", quantity: 3 }
      ]
    );
    expect(takesOver).toEqual([
      { readableId: "PAD-005", quantity: 2, onshapeQuantity: 1 },
      { readableId: "HDW-010", quantity: 1, onshapeQuantity: 1 }
    ]);
    // STD-006 pairs with the line a push already owns; its manual line stays.
    expect(keeps).toEqual([
      { readableId: "GLUE-01", quantity: 1 },
      { readableId: "STD-006", quantity: 3 }
    ]);
  });

  it("takes over one manual line per Onshape row of a part", () => {
    const { takesOver, keeps } = pairManualLines(
      [{ partNumber: "BOLT", quantity: 4 }],
      [],
      [
        { readableId: "BOLT", quantity: 2 },
        { readableId: "BOLT", quantity: 2 }
      ]
    );
    expect(takesOver).toEqual([
      { readableId: "BOLT", quantity: 2, onshapeQuantity: 4 }
    ]);
    expect(keeps).toEqual([{ readableId: "BOLT", quantity: 2 }]);
  });
});

describe("pickReuseRow", () => {
  it("prefers the latest Part, then any row that can be a BOM line", () => {
    const tool = { id: "t", revision: "B", type: "Tool" };
    const material = { id: "m", revision: "A", type: "Material" };
    const part = { id: "p", revision: "0", type: "Part" };
    expect(pickReuseRow([tool, material, part])?.id).toBe("p");
    expect(pickReuseRow([tool, material])?.id).toBe("m");
    expect(pickReuseRow([tool])?.id).toBe("t");
  });
});

describe("pickLatestRow", () => {
  it("orders revisions by sequence, not as text", () => {
    expect(
      pickLatestRow([{ revision: "9" }, { revision: "10" }])?.revision
    ).toBe("10");
    expect(
      pickLatestRow([{ revision: "Y" }, { revision: "AA" }])?.revision
    ).toBe("AA");
  });

  it("prefers an active revision over a newer inactive one", () => {
    expect(
      pickLatestRow([
        { revision: "B", active: true },
        { revision: "C", active: false }
      ])?.revision
    ).toBe("B");
    expect(pickLatestRow([{ revision: "C", active: false }])?.revision).toBe(
      "C"
    );
  });
});

describe("pickRevisionBase", () => {
  it("copies from the newest revision below the released one, released or not", () => {
    const rows = [
      { id: "0", revision: "0", active: true },
      { id: "A", revision: "A", active: false },
      { id: "C", revision: "C", active: false }
    ];
    expect(pickRevisionBase(rows, "B")?.id).toBe("A");
    expect(pickRevisionBase(rows, "A")?.id).toBe("0");
    expect(pickRevisionBase(rows, "D")?.id).toBe("C");
  });

  it("falls back to the latest row when none is below the released revision", () => {
    expect(
      pickRevisionBase(
        [
          { id: "C", revision: "C", active: true },
          { id: "D", revision: "D", active: false }
        ],
        "B"
      )?.id
    ).toBe("C");
    expect(pickRevisionBase([], "A")).toBeUndefined();
  });
});

describe("pickBomChildRow", () => {
  const rows = [
    { id: "0", revision: "0", active: true, type: "Part" },
    { id: "A", revision: "A", active: false, type: "Part" }
  ];

  it("takes the revision the BOM names, even one still waiting in its notice", () => {
    expect(pickBomChildRow(rows, "A")).toEqual({
      row: rows[1],
      missingRevision: null
    });
    expect(pickBomChildRow(rows, " a ").row?.id).toBe("A");
  });

  it("falls back to the latest row and names the revision Carbon lacks", () => {
    expect(pickBomChildRow(rows, "B")).toEqual({
      row: rows[0],
      missingRevision: "B"
    });
  });

  it("takes the latest row when the BOM names no revision", () => {
    expect(pickBomChildRow(rows, null)).toEqual({
      row: rows[0],
      missingRevision: null
    });
    expect(pickBomChildRow([], "B")).toEqual({
      row: undefined,
      missingRevision: null
    });
  });

  it("prefers the Part when another item type shares the number and revision", () => {
    expect(
      pickBomChildRow(
        [
          { id: "tool", revision: "A", type: "Tool" },
          { id: "part", revision: "A", type: "Part" }
        ],
        "A"
      ).row?.id
    ).toBe("part");
  });
});

describe("bomLineItemType", () => {
  it("maps reusable item types onto methodMaterial.itemType", () => {
    expect(bomLineItemType({ type: "Part" })).toBe("Part");
    expect(bomLineItemType({ type: "Material" })).toBe("Material");
    expect(bomLineItemType({ type: null })).toBe("Part");
    expect(bomLineItemType({ type: "Tool" })).toBeNull();
  });
});

describe("changeNoticeDescriptionJson", () => {
  it("wraps text as a tiptap document and keeps empty as null", () => {
    expect(changeNoticeDescriptionJson(null)).toBeNull();
    expect(changeNoticeDescriptionJson("Pushed from Onshape")).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Pushed from Onshape" }]
        }
      ]
    });
  });
});

describe("buildAssemblyPlan Show Assembly only", () => {
  const unitPlan = (
    mapping?: Parameters<typeof buildAssemblyPlan>[0]["mapping"]
  ) =>
    buildAssemblyPlan({
      documentId: "d",
      wv: "w",
      wvId: "w1",
      elementId: "e",
      root: {
        partNumber: "WB-100",
        name: "Workbench",
        description: null,
        revision: null
      },
      nodes: [
        node({
          index: "1",
          partNumber: "ASM-009",
          name: "Foot assembly",
          shownAsUnit: true,
          properties: [
            {
              propertyId: "p-make",
              name: "Make or buy",
              valueType: "ENUM",
              value: "Buy"
            }
          ]
        })
      ],
      items: [],
      methodByItemId: new Map(),
      mappedLinesByMethodId: new Map(),
      manualLinesByMethodId: new Map(),
      options,
      mapping
    });

  it("reads Show Assembly only as structure: no BOM, and Make by default", () => {
    const plan = unitPlan();
    expect(plan.items[0]).toMatchObject({
      partNumber: "ASM-009",
      shownAsUnit: true,
      isAssembly: false,
      proposed: {
        replenishmentSystem: "Make",
        defaultMethodType: "Make to Order"
      }
    });
    expect(plan.methods.map((m) => m.parentPartNumber)).toEqual(["WB-100"]);
  });

  it("takes Buy for a one-unit sub-assembly only from a mapped property", () => {
    const plan = unitPlan({
      map: [
        {
          onshapePropertyId: "p-make",
          onshapeName: "Make or buy",
          valueType: "ENUM",
          target: { kind: "item", field: "replenishmentSystem" },
          mode: "create",
          translations: [
            { onshape: "Buy", carbon: "Buy" },
            { onshape: "Make", carbon: "Make" }
          ]
        }
      ],
      definitions: [],
      descriptionModes: { name: "create", description: "create" },
      heldCustomFields: new Map()
    });
    expect(plan.items[0]?.proposed).toMatchObject({
      replenishmentSystem: "Buy",
      defaultMethodType: "Pull from Inventory"
    });
    expect(plan.items[0]?.itemFields).toEqual([
      {
        field: "replenishmentSystem",
        label: "Replenishment",
        value: "Buy",
        mode: "create",
        onshapeName: "Make or buy"
      }
    ]);
  });
});

const itemField = (
  field: PlanItemField["field"],
  value: string | null,
  mode: PlanItemField["mode"] = "everyPush",
  onshapeName = "Make or buy"
): PlanItemField => ({
  field,
  label:
    {
      mpn: "Manufacturer Part Number",
      replenishmentSystem: "Replenishment",
      defaultMethodType: "Default Method Type",
      sourcingType: "Sourcing",
      itemTrackingType: "Tracking Type",
      unitOfMeasureCode: "Unit of Measure"
    }[field] ?? field,
  value,
  mode,
  onshapeName
});

describe("proposeMappedItem — precedence for a new item", () => {
  it("puts a mapped value above children, Standard content and the defaults", () => {
    const made = proposeMappedItem(
      {
        partNumber: "ASM-1",
        name: null,
        hasChildren: true,
        mapped: { replenishmentSystem: "Buy" }
      },
      options
    );
    expect(made.proposed.replenishmentSystem).toBe("Buy");
    // A mapped Buy with no mapped method takes the push default for Buy.
    expect(made.proposed.defaultMethodType).toBe("Pull from Inventory");
    expect(made.problems).toEqual([]);
  });

  it("makes a row with children Make, and a Standard content row Buy", () => {
    const buyDefaults = {
      ...options,
      defaults: {
        ...DEFAULT_PUSH_DEFAULTS,
        replenishmentSystem: "Buy" as const,
        methodTypeForMake: "Pull from Inventory" as const
      }
    };
    expect(
      proposeItem(
        { partNumber: "A", name: null, hasChildren: true },
        buyDefaults
      )
    ).toMatchObject({
      replenishmentSystem: "Make",
      defaultMethodType: "Pull from Inventory"
    });
    expect(
      proposeItem(
        { partNumber: "B", name: null, standardContent: true },
        options
      )
    ).toMatchObject({
      replenishmentSystem: "Buy",
      defaultMethodType: "Pull from Inventory"
    });
    expect(
      proposeItem({ partNumber: "C", name: null }, buyDefaults)
    ).toMatchObject({
      replenishmentSystem: "Buy",
      defaultMethodType: "Pull from Inventory"
    });
  });

  it("refuses a mapped method the replenishment does not allow", () => {
    const { proposed, problems } = proposeMappedItem(
      {
        partNumber: "P",
        name: null,
        mapped: {
          replenishmentSystem: "Buy",
          defaultMethodType: "Make to Order"
        }
      },
      options
    );
    expect(proposed.defaultMethodType).toBe("Pull from Inventory");
    expect(problems).toEqual([
      "Default Method Type: Make to Order is not a method for Buy items. Not written."
    ]);
  });

  it("writes Sourcing only on a Buy and Make item, with the method it sets", () => {
    const dropShip = proposeMappedItem(
      {
        partNumber: "P",
        name: null,
        mapped: {
          replenishmentSystem: "Buy and Make",
          sourcingType: "Drop Ship"
        }
      },
      options
    );
    expect(dropShip.proposed).toMatchObject({
      replenishmentSystem: "Buy and Make",
      sourcingType: "Drop Ship",
      defaultMethodType: "Purchase to Order"
    });
    const onMake = proposeMappedItem(
      { partNumber: "P", name: null, mapped: { sourcingType: "Drop Ship" } },
      options
    );
    expect(onMake.proposed.sourcingType).toBeUndefined();
    expect(onMake.problems).toEqual([
      "Sourcing applies only to Buy and Make items. Not written."
    ]);
  });

  it("carries a mapped MPN, tracking type and unit", () => {
    expect(
      proposeItem(
        {
          partNumber: "P",
          name: null,
          mapped: {
            mpn: "SKF-6203",
            itemTrackingType: "Serial",
            unitOfMeasureCode: "M"
          }
        },
        options
      )
    ).toMatchObject({
      mpn: "SKF-6203",
      itemTrackingType: "Serial",
      unitOfMeasureCode: "M"
    });
  });
});

describe("planExistingItem — modes", () => {
  const current = currentItemFields({
    replenishmentSystem: "Make",
    defaultMethodType: "Make to Order",
    itemTrackingType: "Inventory",
    sourcingType: "Specified",
    unitOfMeasureCode: "EA",
    mpn: null
  });
  const plan = (itemFields: PlanItemField[]) =>
    planExistingItem({
      current,
      item: { name: "Bracket", description: null },
      onshape: { name: "Bracket", description: null },
      resolved: { fields: [], itemFields, problems: [] },
      heldCustomFields: {},
      descriptionModes: { name: "create", description: "create" },
      units: options.unitsOfMeasure
    });

  it("writes an every-push Buy with the method the item page sets", () => {
    const planned = plan([itemField("replenishmentSystem", "Buy")]);
    expect(planned.target).toMatchObject({
      replenishmentSystem: "Buy",
      defaultMethodType: "Purchase to Order"
    });
    expect(planned.itemFieldChanges).toEqual([
      {
        field: "replenishmentSystem",
        label: "Replenishment",
        from: "Make",
        to: "Buy",
        onshapeName: "Make or buy"
      },
      {
        field: "defaultMethodType",
        label: "Default Method Type",
        from: "Make to Order",
        to: "Purchase to Order",
        onshapeName: null
      }
    ]);
    expect(planned.keptDifferences).toBeUndefined();
  });

  it("keeps Carbon's value for a Set at creation mapping and says so", () => {
    const planned = plan([itemField("replenishmentSystem", "Buy", "create")]);
    expect(planned.target).toBeUndefined();
    expect(planned.itemFieldChanges).toBeUndefined();
    expect(planned.keptDifferences).toEqual([
      { label: "Replenishment", onshape: "Buy", carbon: "Make" }
    ]);
  });

  it("writes nothing for an empty or matching value", () => {
    const planned = plan([
      itemField("replenishmentSystem", null),
      itemField("itemTrackingType", "Inventory", "everyPush", "Tracking")
    ]);
    expect(planned.target).toBeUndefined();
    expect(planned.keptDifferences).toBeUndefined();
  });

  it("orders the interlock: replenishment, then method, then sourcing", () => {
    const planned = plan([
      itemField("replenishmentSystem", "Buy and Make"),
      itemField(
        "defaultMethodType",
        "Pull from Inventory",
        "everyPush",
        "Method"
      ),
      itemField("sourcingType", "Drop Ship", "everyPush", "Sourcing")
    ]);
    expect(planned.target).toMatchObject({
      replenishmentSystem: "Buy and Make",
      sourcingType: "Drop Ship",
      defaultMethodType: "Purchase to Order"
    });
    expect(planned.mappedFieldProblems).toBeUndefined();
  });

  it("moves Make to Order off an every-push Buy and Make, so apply accepts the pair", () => {
    // Make / Make to Order item; Onshape maps Replenishment to Buy and Make.
    const planned = plan([itemField("replenishmentSystem", "Buy and Make")]);
    expect(planned.target).toMatchObject({
      replenishmentSystem: "Buy and Make",
      defaultMethodType: "Pull from Inventory"
    });
    expect(planned.mappedFieldProblems).toBeUndefined();
    const applied = mergeExistingItemEdits(current, null, planned.target);
    expect(applied.ok).toBe(true);
  });

  it("lists only the mapped values a new item takes", () => {
    const created = planCreatedItem(
      { partNumber: "P", name: null },
      {
        fields: [],
        itemFields: [
          itemField("sourcingType", "Drop Ship", "create", "Sourcing"),
          itemField("mpn", "MPN-1", "create", "MPN")
        ],
        problems: []
      },
      options
    );
    expect(created.proposed.sourcingType).toBeUndefined();
    expect(created.itemFields?.map((field) => field.field)).toEqual(["mpn"]);
    expect(created.mappedFieldProblems).toEqual([
      "Sourcing applies only to Buy and Make items. Not written."
    ]);
  });

  it("skips Sourcing on a Make item, and a method Make does not allow", () => {
    const planned = plan([
      itemField("sourcingType", "Drop Ship", "everyPush", "Sourcing"),
      itemField("defaultMethodType", "Purchase to Order", "everyPush", "Method")
    ]);
    expect(planned.target).toBeUndefined();
    expect(planned.mappedFieldProblems).toEqual([
      "Default Method Type: Purchase to Order is not a method for Make items. Not written.",
      "Sourcing applies only to Buy and Make items. Not written."
    ]);
  });

  it("lists a method that goes with another change after it, and credits a mapping only for its own value", () => {
    const planned = plan([
      itemField("replenishmentSystem", "Buy and Make"),
      itemField(
        "defaultMethodType",
        "Pull from Inventory",
        "everyPush",
        "Method"
      ),
      itemField("sourcingType", "Drop Ship", "everyPush", "Sourcing")
    ]);
    expect(
      planned.itemFieldChanges?.map((change) => [
        change.field,
        change.onshapeName
      ])
    ).toEqual([
      ["replenishmentSystem", "Make or buy"],
      ["sourcingType", "Sourcing"],
      ["defaultMethodType", null]
    ]);
  });

  it("names the method Carbon holds, not the one the editor starts from", () => {
    // Carbon stores Make to Order on a Buy and Make item; the snapshot
    // reconciles it to a method the pair allows.
    const row = {
      name: "Bracket",
      description: null,
      replenishmentSystem: "Buy and Make",
      defaultMethodType: "Make to Order",
      itemTrackingType: "Inventory",
      sourcingType: "Specified"
    };
    const planned = planExistingItem({
      current: currentItemFields(row),
      item: row,
      onshape: { name: "Bracket", description: null },
      resolved: {
        fields: [],
        itemFields: [
          itemField("sourcingType", "Drop Ship", "everyPush", "Sourcing")
        ],
        problems: []
      },
      heldCustomFields: {},
      descriptionModes: { name: "create", description: "create" },
      units: options.unitsOfMeasure
    });
    expect(
      planned.itemFieldChanges?.find(
        (change) => change.field === "defaultMethodType"
      )
    ).toMatchObject({ from: "Make to Order", to: "Purchase to Order" });
  });

  it("writes every-push custom fields and keeps Set at creation ones out", () => {
    const field = (
      fieldId: string,
      mode: "create" | "everyPush",
      value: string
    ) => ({
      fieldId,
      name: fieldId,
      mode,
      dataTypeId: 5,
      listOptions: null,
      value,
      onshapeName: fieldId
    });
    const planned = planExistingItem({
      current,
      item: { name: "Bracket" },
      onshape: { name: "Bracket", description: null },
      resolved: {
        fields: [
          field("Finish", "everyPush", "Anodized"),
          field("Coating", "create", "Zinc")
        ],
        itemFields: [],
        problems: []
      },
      heldCustomFields: { Finish: "Raw", Coating: "None" },
      descriptionModes: { name: "create", description: "create" },
      units: options.unitsOfMeasure
    });
    expect(planned.customFields?.map((f) => f.fieldId)).toEqual(["Finish"]);
    expect(planned.keptDifferences).toEqual([
      { label: "Coating", onshape: "Zinc", carbon: "None" }
    ]);
  });
});

describe("buildPartPlan — mapped fields", () => {
  const map: PropertyMapEntry[] = [
    {
      onshapePropertyId: "p-make",
      onshapeName: "Make or buy",
      valueType: "ENUM",
      target: { kind: "item", field: "replenishmentSystem" },
      mode: "everyPush",
      translations: [
        { onshape: "Buy", carbon: "Buy" },
        { onshape: "Make", carbon: "Make" }
      ]
    }
  ];
  const mapping = {
    map,
    definitions: [],
    descriptionModes: { name: "create", description: "create" } as const,
    heldCustomFields: new Map()
  };
  const props = (value: string) =>
    new Map([
      [
        "p1",
        [
          {
            propertyId: "p-make",
            name: "Make or buy",
            valueType: "ENUM",
            value
          }
        ]
      ]
    ]);
  const build = (value: string, microversionId: string) =>
    buildPartPlan({
      documentId: "d",
      elementId: "e",
      parts: [
        {
          partId: "p1",
          name: "Bracket",
          partNumber: "BR-1",
          revision: null,
          microversionId: "m1"
        }
      ],
      requestedPartIds: ["p1"],
      mappings: [
        {
          entityId: "item-1",
          externalId: "d:e:p1",
          lastSyncedAt: null,
          metadata: { microversionId }
        }
      ],
      items: [
        {
          id: "item-1",
          readableId: "BR-1",
          revision: "0",
          name: "Bracket",
          replenishmentSystem: "Make",
          defaultMethodType: "Make to Order",
          itemTrackingType: "Inventory"
        }
      ],
      options,
      mapping,
      propertiesByPartId: props(value)
    });

  it("turns an unchanged part into an update when an every-push value differs", () => {
    const [row] = build("Buy", "m1");
    expect(row?.action).toBe("update");
    expect(row?.cadUnchanged).toBe(true);
    expect(row?.target?.replenishmentSystem).toBe("Buy");
  });

  it("leaves an unchanged part unchanged when Carbon already agrees", () => {
    const [row] = build("Make", "m1");
    expect(row?.action).toBe("unchanged");
    expect(row?.cadUnchanged).toBeUndefined();
  });

  it("gives a created part the mapped value", () => {
    const [row] = buildPartPlan({
      documentId: "d",
      elementId: "e",
      parts: [
        { partId: "p1", name: "Bracket", partNumber: "BR-2", revision: null }
      ],
      requestedPartIds: ["p1"],
      mappings: [],
      items: [],
      options,
      mapping,
      propertiesByPartId: props("Buy")
    });
    expect(row?.action).toBe("create");
    expect(row?.proposed?.replenishmentSystem).toBe("Buy");
    expect(row?.itemFields?.[0]?.onshapeName).toBe("Make or buy");
  });
});

describe("mergeExistingItemEdits on top of mapped values", () => {
  it("lays the reviewer's edit over the mapped target and reports changes against Carbon", () => {
    const current = currentItemFields({
      replenishmentSystem: "Make",
      defaultMethodType: "Make to Order",
      itemTrackingType: "Inventory"
    });
    const target = {
      ...current,
      replenishmentSystem: "Buy" as const,
      defaultMethodType: "Purchase to Order" as const
    };
    const kept = mergeExistingItemEdits(current, {}, target);
    expect(kept.ok && kept.changed).toEqual({
      replenishmentSystem: "Buy",
      defaultMethodType: "Purchase to Order"
    });
    const overridden = mergeExistingItemEdits(
      current,
      { replenishmentSystem: "Make", defaultMethodType: "Make to Order" },
      target
    );
    expect(overridden.ok && overridden.changed).toEqual({});
  });
});
