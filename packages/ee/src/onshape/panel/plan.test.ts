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
  pickLatestRow,
  pickReuseRow,
  proposeItem,
  reconcileMethodForReplenishment
} from "./plan";
import { DEFAULT_PUSH_DEFAULTS } from "./preferences";
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
  purchased: false,
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

  it("defaults a purchased BOM row to Buy / Pull from Inventory", () => {
    const item = proposeItem(
      { partNumber: "HDW-010", name: null, purchased: true, revision: "B" },
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
    // Make + Purchase to Order is refused by the Part form; so here.
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
    // "Make to Order" is not allowed for Buy, so it falls to the first allowed.
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
    // A legacy Buy item carrying a Make-only method resolves to a legal pair
    // rather than seeding the editor with something the interlock refuses.
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
    expect(rows[1]?.changes).toEqual([
      { field: "name", from: "Foot pad (old)", to: "Foot pad" },
      { field: "description", from: null, to: "Rubber" }
    ]);
    expect(rows[2]?.item?.readableId).toBe("STD-006");
    expect(rows[2]?.proposed).toBeNull();
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
          purchased: true,
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
      // Root + the sub-assembly: two methods.
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
      // The root's own BOM is unchanged — the sub-assembly is still a line.
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
      // The trap: with its children out of scope, ASM-008 looks like a leaf.
      // Treating it as purchased would create it as a Buy part and break the
      // link to its own make method.
      const item = build("top").items.find((i) => i.partNumber === "ASM-008");
      expect(item?.isAssembly).toBe(true);
      expect(item?.proposed?.replenishmentSystem).toBe("Make");
    });

    it("reports what a top-level push leaves out", () => {
      const plan = build("top");
      expect(plan.deeper?.subAssemblies).toEqual(["ASM-008"]);
      // LEG-003 and HDW-010 sit below the top level; the unnamed row has no
      // part number and is not counted.
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
    // Item numbers are unique per type; the Tool must not shadow the Part.
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
    // A purchased-marked row that has children is still made.
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
        // No itemSource: nothing to link through, so it can only conflict.
        "PAD-005": true,
        "TOP-001": undefined
      });
    });

    it("treats an unlinked reused root as a conflict", () => {
      expect(build([]).root.conflict).toBe(true);
    });

    it("keeps a part linked when a release added a higher revision the mapping does not point at", () => {
      // A release minted Rev B for the root and for LEG-003, made B the
      // default, and left the part-studio mappings on the Rev A items. The
      // plan resolves each part number to the latest revision (B), but the
      // link on Rev A is still a link to that same part — not a conflict.
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
        // Still linked to no item at all → a genuine conflict.
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
            purchased: true
          }),
          node({
            index: "4",
            partNumber: "HDW-011",
            name: "Nut",
            purchased: true
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
            purchased: true
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

describe("buildAssemblyPlan descriptions", () => {
  const source = (partId: string) => ({
    documentId: "d2",
    elementId: "ps",
    partId
  });
  const build = (
    linkedItemIds?: Set<string>,
    links = new Map<string, string>()
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
      linkedItemIds
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
});

describe("pairManualLines", () => {
  it("keeps a manual line for another item type that shares the number", () => {
    // A Material and a Part can share a number; the Part's write must not
    // repoint the Material's line.
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
  it("proposes a sub-assembly Onshape shows as one unit as bought, with no BOM", () => {
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
      nodes: [
        node({
          index: "1",
          partNumber: "ASM-009",
          name: "Foot assembly",
          purchased: true,
          shownAsUnit: true
        })
      ],
      items: [],
      methodByItemId: new Map(),
      mappedLinesByMethodId: new Map(),
      manualLinesByMethodId: new Map(),
      options
    });
    expect(plan.items[0]).toMatchObject({
      partNumber: "ASM-009",
      shownAsUnit: true,
      isAssembly: false,
      proposed: {
        replenishmentSystem: "Buy",
        defaultMethodType: "Pull from Inventory"
      }
    });
    expect(plan.methods.map((m) => m.parentPartNumber)).toEqual(["WB-100"]);
  });
});
