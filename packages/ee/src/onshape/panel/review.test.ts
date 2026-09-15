import { describe, expect, it } from "vitest";
import type {
  AssemblyPlan,
  AssemblyPlanMethod,
  PartPlan,
  PartPlanRow,
  ProposedItem,
  ReleasePlan
} from "./plan";
import { DEFAULT_PUSH_DEFAULTS } from "./preferences";
import type { PlanCustomField } from "./properties";
import { BOOLEAN_TRUE } from "./properties";
import type { AssemblyReview, PartReview, ReleaseReview } from "./review";
import {
  applyCount,
  applyRequestBody,
  createReview,
  customFieldDisplayValue,
  defaultSelectedPartIds,
  describeMethod,
  editedItem,
  indexFieldErrors,
  normalizeWarnings,
  patchPartStatuses
} from "./review";
import type { PanelPartStatus } from "./status";

const options = {
  unitsOfMeasure: [
    { code: "EA", name: "Each" },
    { code: "M", name: "Meter" }
  ],
  defaults: DEFAULT_PUSH_DEFAULTS
};

const proposed = (over: Partial<ProposedItem> = {}): ProposedItem => ({
  readableId: "PAD-005",
  revision: "0",
  name: "Foot pad",
  description: null,
  replenishmentSystem: "Make",
  defaultMethodType: "Make to Order",
  itemTrackingType: "Inventory",
  unitOfMeasureCode: "EA",
  ...over
});

const partRow = (over: Partial<PartPlanRow> = {}): PartPlanRow => ({
  partId: "p1",
  partNumber: "PAD-005",
  name: "Foot pad",
  description: null,
  revision: null,
  microversionId: "m1",
  action: "create",
  itemId: null,
  item: null,
  proposed: proposed(),
  changes: [],
  ...over
});

const partPlan = (rows: PartPlanRow[]): PartPlan => ({
  kind: "part",
  documentId: "d",
  wv: "w",
  wvId: "w1",
  elementId: "e",
  rows,
  options
});

const partReview = (rows: PartPlanRow[]): PartReview =>
  createReview({
    planId: "plan-1",
    expiresAt: "2026-08-30T12:00:00Z",
    scope: "d:w:w1:e",
    plan: partPlan(rows)
  }) as PartReview;

const customField = (over: Partial<PlanCustomField> = {}): PlanCustomField => ({
  fieldId: "cf-finish",
  name: "Finish",
  mode: "default",
  dataTypeId: 5,
  listOptions: null,
  value: "Anodized",
  onshapeName: "Surface finish",
  ...over
});

const method = (
  over: Partial<AssemblyPlanMethod> = {}
): AssemblyPlanMethod => ({
  parentPartNumber: "ASM-001",
  parentItemId: null,
  status: "new",
  writes: [
    {
      index: "1",
      partNumber: "PAD-005",
      name: "Foot pad",
      quantity: 4,
      purchased: false
    },
    {
      index: "2",
      partNumber: "HDW-010",
      name: "Screw",
      quantity: 8,
      purchased: true
    }
  ],
  replaces: [],
  keeps: [],
  ...over
});

const assemblyPlan = (over: Partial<AssemblyPlan> = {}): AssemblyPlan => ({
  kind: "assembly",
  depth: "all",
  documentId: "d",
  wv: "w",
  wvId: "w1",
  elementId: "e",
  root: {
    partNumber: "ASM-001",
    name: "Base",
    description: null,
    revision: null,
    action: "create",
    itemId: null,
    proposed: proposed({ readableId: "ASM-001", name: "Base" })
  },
  items: [
    {
      partNumber: "PAD-005",
      name: "Foot pad",
      revision: null,
      action: "create",
      itemId: null,
      proposed: proposed(),
      isAssembly: false,
      purchased: false
    },
    {
      partNumber: "HDW-010",
      name: "Screw",
      revision: null,
      action: "reuse",
      itemId: "item-hdw",
      proposed: null,
      isAssembly: false,
      purchased: true
    }
  ],
  methods: [method()],
  skipped: ["Loose bracket: no part number in Onshape"],
  options,
  ...over
});

const assemblyReview = (plan = assemblyPlan()): AssemblyReview =>
  createReview({
    planId: "plan-2",
    expiresAt: "2026-08-30T12:00:00Z",
    scope: "d:w:w1:e",
    plan
  }) as AssemblyReview;

const releasePlan = (over: Partial<ReleasePlan> = {}): ReleasePlan => ({
  kind: "release",
  documentId: "d",
  releaseId: "rel-1",
  releaseName: "R1",
  createdAt: null,
  items: [
    {
      partNumber: "ASM-001",
      revision: "A",
      elementType: 1,
      elementId: "e1",
      versionId: "v1",
      action: "revision",
      baseItemId: "item-asm",
      baseRevision: "0",
      existingItemId: null,
      proposed: null,
      methodStatus: "new"
    },
    {
      partNumber: "NEW-001",
      revision: "A",
      elementType: 0,
      elementId: "e2",
      versionId: "v1",
      action: "create",
      baseItemId: null,
      baseRevision: null,
      existingItemId: null,
      proposed: proposed({ readableId: "NEW-001", revision: "A", name: "New" }),
      methodStatus: null
    },
    {
      partNumber: "ASM-001",
      revision: "A",
      elementType: 2,
      elementId: "e3",
      versionId: "v1",
      action: "drawing",
      baseItemId: null,
      baseRevision: null,
      existingItemId: null,
      proposed: null,
      methodStatus: null
    }
  ],
  children: [
    {
      partNumber: "HDW-010",
      name: "Screw",
      revision: null,
      purchased: true,
      action: "reuse",
      itemId: "item-hdw",
      proposed: null
    },
    {
      partNumber: "PAD-005",
      name: "Foot pad",
      revision: null,
      purchased: false,
      action: "create",
      itemId: null,
      proposed: proposed()
    }
  ],
  changeNotice: { name: "Onshape release R1", description: null },
  makeDefault: true,
  alreadyPushed: false,
  options,
  ...over
});

const releaseReview = (
  plan = releasePlan(),
  warnings?: string[]
): ReleaseReview =>
  createReview({
    planId: "plan-3",
    expiresAt: "2026-08-30T12:00:00Z",
    scope: "d",
    plan,
    warnings
  }) as ReleaseReview;

describe("createReview", () => {
  it("opens a part review with the actionable rows selected and no edits", () => {
    const review = partReview([
      partRow({ partId: "p1", action: "create" }),
      partRow({ partId: "p2", action: "adopt", itemId: "i2" }),
      partRow({ partId: "p3", action: "update", itemId: "i3" }),
      partRow({ partId: "p4", action: "unchanged", itemId: "i4" }),
      partRow({ partId: "p5", action: "skip-no-part-number", partNumber: null })
    ]);
    expect(review.kind).toBe("part");
    expect([...review.selected]).toEqual(["p1", "p2", "p3"]);
    expect(review.edits).toEqual({});
    expect(review.applying).toBe(false);
    expect(review.error).toBeNull();
    expect(review.fieldErrors).toEqual({});
    expect(review.expired).toBe(false);
    expect(review.scope).toBe("d:w:w1:e");
  });

  it("opens an assembly review with nothing excluded", () => {
    const review = assemblyReview();
    expect(review.kind).toBe("assembly");
    expect(review.excluded.size).toBe(0);
  });

  it("copies the release plan's change notice and default flag, keeps warnings", () => {
    const plan = releasePlan();
    const review = releaseReview(plan, ["ASM-001: BOM could not be read"]);
    expect(review.changeNotice).toEqual(plan.changeNotice);
    expect(review.changeNotice).not.toBe(plan.changeNotice);
    expect(review.makeDefault).toBe(true);
    expect(review.warnings).toEqual(["ASM-001: BOM could not be read"]);
  });

  it("has no change notice to edit when the plan has none", () => {
    const review = releaseReview(
      releasePlan({ changeNotice: null, alreadyPushed: true })
    );
    expect(review.changeNotice).toBeNull();
    expect(review.warnings).toEqual([]);
  });
});

describe("defaultSelectedPartIds", () => {
  it("selects create, adopt and update; leaves unchanged and skipped alone", () => {
    expect([
      ...defaultSelectedPartIds([
        partRow({ partId: "a", action: "unchanged" }),
        partRow({ partId: "b", action: "update" }),
        partRow({ partId: "c", action: "skip-no-part-number" }),
        partRow({ partId: "d", action: "adopt" }),
        partRow({ partId: "e", action: "create" })
      ])
    ]).toEqual(["b", "d", "e"]);
  });
});

describe("editedItem", () => {
  it("returns the proposal itself when there is no edit", () => {
    const item = proposed();
    expect(editedItem(item, undefined)).toBe(item);
  });

  it("lays only the edited fields over the proposal", () => {
    expect(
      editedItem(proposed(), { name: "Pad", description: "Rubber" })
    ).toEqual(proposed({ name: "Pad", description: "Rubber" }));
  });
});

describe("customFieldDisplayValue", () => {
  it("renders review text for every value shape", () => {
    expect(customFieldDisplayValue(customField())).toBe("Anodized");
    expect(
      customFieldDisplayValue(customField({ value: 2.5, dataTypeId: 4 }))
    ).toBe("2.5");
    expect(customFieldDisplayValue(customField({ value: null }))).toBe("—");
  });

  it("renders a Yes/No field from the value the ERP stores", () => {
    expect(
      customFieldDisplayValue(
        customField({ value: BOOLEAN_TRUE, dataTypeId: 1 })
      )
    ).toBe("Yes");
    expect(
      customFieldDisplayValue(customField({ value: null, dataTypeId: 1 }))
    ).toBe("—");
  });
});

describe("applyRequestBody", () => {
  it("sends a part selection in plan order with edits only for selected creates", () => {
    const review = partReview([
      partRow({ partId: "p1", action: "create" }),
      partRow({ partId: "p2", action: "create", partNumber: "PAD-006" }),
      partRow({ partId: "p3", action: "adopt", itemId: "i3" })
    ]);
    const edited: PartReview = {
      ...review,
      selected: new Set(["p3", "p1"]),
      edits: {
        p1: { name: "Pad" },
        p2: { name: "Dropped" },
        p3: { name: "Never" }
      }
    };
    expect(applyRequestBody(edited)).toEqual({
      planId: "plan-1",
      selected: ["p1", "p3"],
      edits: { p1: { name: "Pad" } }
    });
  });

  it("carries custom-field edits inside a selected create's entry", () => {
    const review = partReview([partRow({ partId: "p1", action: "create" })]);
    const edited: PartReview = {
      ...review,
      edits: { p1: { customFields: { "cf-finish": "Raw" } } }
    };
    expect(applyRequestBody(edited)).toEqual({
      planId: "plan-1",
      selected: ["p1"],
      edits: { p1: { customFields: { "cf-finish": "Raw" } } }
    });
  });

  it("sends assembly edits for the root and included creates, and the exclusions", () => {
    const review = assemblyReview();
    const edited: AssemblyReview = {
      ...review,
      excluded: new Set(["PAD-005"]),
      edits: {
        "ASM-001": { name: "Base plate" },
        "PAD-005": { name: "Excluded" },
        "HDW-010": { name: "Reused" }
      }
    };
    expect(applyRequestBody(edited)).toEqual({
      planId: "plan-2",
      edits: { "ASM-001": { name: "Base plate" } },
      excluded: ["PAD-005"]
    });
  });

  it("drops root edits when the root is reused", () => {
    const plan = assemblyPlan();
    plan.root = {
      ...plan.root,
      action: "reuse",
      itemId: "item-asm",
      proposed: null
    };
    const edited: AssemblyReview = {
      ...assemblyReview(plan),
      edits: { "ASM-001": { name: "Nope" }, "PAD-005": { name: "Pad" } }
    };
    expect(applyRequestBody(edited)).toEqual({
      planId: "plan-2",
      edits: { "PAD-005": { name: "Pad" } },
      excluded: []
    });
  });

  it("sends release edits for created items and children, the change notice and the default flag", () => {
    const edited: ReleaseReview = {
      ...releaseReview(),
      makeDefault: false,
      changeNotice: { name: "ECO-12", description: "Tolerance change" },
      edits: {
        "NEW-001": { name: "New part" },
        "PAD-005": { unitOfMeasureCode: "M" },
        "HDW-010": { name: "Reused" },
        "ASM-001": { name: "Revised" }
      }
    };
    expect(applyRequestBody(edited)).toEqual({
      planId: "plan-3",
      edits: {
        "NEW-001": { name: "New part" },
        "PAD-005": { unitOfMeasureCode: "M" }
      },
      changeNotice: { name: "ECO-12", description: "Tolerance change" },
      createChangeNotice: true,
      makeDefault: false
    });
  });

  it("drops the change notice when the review opted out of one", () => {
    const review: ReleaseReview = {
      ...releaseReview(),
      createChangeNotice: false
    };
    expect(applyRequestBody(review)).toMatchObject({
      changeNotice: null,
      createChangeNotice: false
    });
  });

  it("sends a null change notice when the plan has none", () => {
    const review = releaseReview(
      releasePlan({ changeNotice: null, alreadyPushed: true })
    );
    expect(applyRequestBody(review)).toMatchObject({ changeNotice: null });
  });

  it("leaves the notice decision to the apply when the plan proposed none", () => {
    // A row that vanished since review becomes a create the plan never saw; an
    // explicit false here would stop the apply recording it.
    const review = releaseReview(
      releasePlan({ changeNotice: null, alreadyPushed: true })
    );
    expect(applyRequestBody(review)).not.toHaveProperty("createChangeNotice");
  });
});

describe("applyCount", () => {
  it("counts selected parts", () => {
    const review = partReview([
      partRow({ partId: "p1", action: "create" }),
      partRow({ partId: "p2", action: "unchanged", itemId: "i2" })
    ]);
    expect(applyCount(review)).toBe(1);
  });

  it("counts the root plus included assembly items", () => {
    const review = assemblyReview();
    expect(applyCount(review)).toBe(3);
    expect(applyCount({ ...review, excluded: new Set(["PAD-005"]) })).toBe(2);
  });

  it("counts release model items and children, not drawings", () => {
    expect(applyCount(releaseReview())).toBe(4);
  });
});

describe("field errors", () => {
  it("indexes the server's list by key and tolerates junk", () => {
    expect(
      indexFieldErrors([
        { key: "p1", errors: ["Name is required"] },
        { key: 3, errors: ["x"] } as unknown as {
          key: string;
          errors: string[];
        },
        null as unknown as { key: string; errors: string[] }
      ])
    ).toEqual({ p1: ["Name is required"] });
    expect(indexFieldErrors(undefined)).toEqual({});
  });
});

describe("describeMethod", () => {
  it("describes a draft method with its counts", () => {
    const m = method({
      status: "draft",
      parentItemId: "item-asm",
      replaces: [{ readableId: "OLD-1", quantity: 1 }],
      keeps: [
        { readableId: "MAN-1", quantity: 1 },
        { readableId: "MAN-2", quantity: 2 }
      ]
    });
    expect(describeMethod(m, new Set())).toEqual({
      text: "ASM-001 · Draft: 2 added, 1 replaced, 2 manual kept",
      tone: "normal"
    });
  });

  it("labels a new method and subtracts excluded children", () => {
    expect(describeMethod(method(), new Set(["HDW-010"]))).toEqual({
      text: "ASM-001 · new method: 1 added, 0 replaced, 0 manual kept",
      tone: "normal"
    });
  });

  it("describes a released method as a new Draft version, with its counts", () => {
    // The push writes a Draft copy rather than skipping a released method, so
    // the review must not promise a no-op.
    const described = describeMethod(method({ status: "active" }), new Set());
    expect(described).toEqual({
      text: "ASM-001 · released in Carbon — new Draft version: 2 added, 0 replaced, 0 manual kept",
      tone: "notice"
    });
    expect(described.text).not.toMatch(/will not be applied/);
  });

  it("warns that a method missing in Carbon won't be written", () => {
    expect(describeMethod(method({ status: "missing" }), new Set())).toEqual({
      text: "ASM-001 · no make method in Carbon, so its lines won't be written",
      tone: "warning"
    });
  });

  it("mutes a method whose parent is excluded", () => {
    expect(
      describeMethod(
        method({ parentPartNumber: "SUB-001", status: "new" }),
        new Set(["SUB-001"])
      )
    ).toEqual({ text: "SUB-001 · excluded", tone: "muted" });
  });
});

describe("patchPartStatuses", () => {
  const status = (over: Partial<PanelPartStatus> = {}): PanelPartStatus => ({
    partId: "p1",
    name: "Foot pad",
    partNumber: "PAD-005",
    revision: null,
    microversionId: "m1",
    state: "missing",
    item: null,
    lastSyncedAt: null,
    ...over
  });

  it("links a created part with the merged proposal's revision and name", () => {
    const review: PartReview = {
      ...partReview([partRow({ partId: "p1", action: "create" })]),
      edits: { p1: { name: "Pad" } }
    };
    expect(
      patchPartStatuses([status()], review, [
        {
          partId: "p1",
          action: "created",
          itemId: "item-1",
          readableId: "PAD-005"
        }
      ])
    ).toEqual([
      status({
        state: "linked",
        item: {
          id: "item-1",
          readableId: "PAD-005",
          revision: "0",
          name: "Pad"
        }
      })
    ]);
  });

  it("links an adopted part to the plan row's item with the Onshape name", () => {
    const review = partReview([
      partRow({
        partId: "p1",
        action: "adopt",
        itemId: "item-9",
        item: { readableId: "PAD-005", revision: "B", name: "Old name" },
        proposed: null
      })
    ]);
    expect(
      patchPartStatuses(
        [
          status({
            state: "matched",
            item: {
              id: "item-9",
              readableId: "PAD-005",
              revision: "B",
              name: "Old name"
            }
          })
        ],
        review,
        [{ partId: "p1", action: "adopted", itemId: "item-9" }]
      )
    ).toEqual([
      status({
        state: "linked",
        item: {
          id: "item-9",
          readableId: "PAD-005",
          revision: "B",
          name: "Foot pad"
        }
      })
    ]);
  });

  it("leaves unchanged, skipped, errored and unknown rows as they were", () => {
    const rows = [
      status({
        partId: "p1",
        state: "linked",
        item: {
          id: "i1",
          readableId: "PAD-005",
          revision: "0",
          name: "Foot pad"
        }
      }),
      status({ partId: "p2", partNumber: null }),
      status({ partId: "p3" }),
      status({ partId: "p4" })
    ];
    const review = partReview([
      partRow({ partId: "p1", action: "unchanged", itemId: "i1" }),
      partRow({
        partId: "p2",
        action: "skip-no-part-number",
        partNumber: null
      }),
      partRow({ partId: "p3", action: "create" })
    ]);
    expect(
      patchPartStatuses(rows, review, [
        { partId: "p1", action: "unchanged", itemId: "i1" },
        {
          partId: "p2",
          action: "skipped",
          message: "Set a part number in Onshape first"
        },
        { partId: "p3", action: "error", message: "boom" },
        { partId: "p4", action: "created", itemId: "i4" }
      ])
    ).toEqual(rows);
  });
});

describe("normalizeWarnings", () => {
  it("keeps strings and messages, drops the rest", () => {
    expect(
      normalizeWarnings([
        "ASM-001: BOM could not be read",
        { message: "x" },
        { partNumber: "y" },
        3,
        null
      ])
    ).toEqual(["ASM-001: BOM could not be read", "x"]);
    expect(normalizeWarnings(undefined)).toEqual([]);
  });
});
