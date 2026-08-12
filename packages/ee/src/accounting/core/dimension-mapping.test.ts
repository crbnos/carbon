import { describe, expect, it, vi } from "vitest";
import {
  buildDimensionFieldLookup,
  buildDimensionValueMappingEntityId,
  buildDimensionValueMappingLookup,
  ensureDimensionValueExternalIds,
  matchDimensionValuesByName,
  parseDimensionValueMappingEntityId,
  resolveDimensionSlotAutoCreate,
  validateDimensionSlots
} from "./dimension-mapping";
import type { DimensionTarget } from "./types";

// ── Composite key (entityId = "<dimensionId>:<valueId>") ─────────────────────
// valueId is polymorphic across entity-typed dimensions, so the mapping's
// entityId must carry the dimension too.

describe("dimension value mapping entityId", () => {
  it("builds the composite <dimensionId>:<valueId> key", () => {
    expect(buildDimensionValueMappingEntityId("dim_loc", "loc_MRzDg")).toBe(
      "dim_loc:loc_MRzDg"
    );
  });

  it("round-trips through parse", () => {
    const parsed = parseDimensionValueMappingEntityId("dim_loc:loc_MRzDg");
    expect(parsed).toEqual({ dimensionId: "dim_loc", valueId: "loc_MRzDg" });
  });

  it("returns null for malformed entity ids", () => {
    expect(parseDimensionValueMappingEntityId("no-separator")).toBeNull();
    expect(parseDimensionValueMappingEntityId(":value-only")).toBeNull();
    expect(parseDimensionValueMappingEntityId("dimension-only:")).toBeNull();
  });
});

describe("buildDimensionValueMappingLookup", () => {
  it("keys provider option ids by the composite value key, skipping rows without an externalId", () => {
    const lookup = buildDimensionValueMappingLookup([
      {
        id: "m1",
        dimensionId: "dim_loc",
        valueId: "loc_1",
        externalId: "opt-1",
        externalName: "Atlanta",
        lastSyncedAt: null,
        metadata: null
      },
      {
        id: "m2",
        dimensionId: "dim_loc",
        valueId: "loc_2",
        externalId: null,
        externalName: null,
        lastSyncedAt: null,
        metadata: null
      }
    ]);

    expect(lookup.get("dim_loc:loc_1")).toBe("opt-1");
    expect(lookup.has("dim_loc:loc_2")).toBe(false);
  });
});

// ── Match by name (exact-match proposals only) ───────────────────────────────

describe("buildDimensionFieldLookup", () => {
  it("maps dimensionId → provider Field id, skipping rows with no externalId", () => {
    const lookup = buildDimensionFieldLookup([
      {
        id: "m1",
        dimensionId: "dim_loc",
        externalId: "field-loc",
        externalName: "Location"
      },
      { id: "m2", dimensionId: "dim_cc", externalId: null, externalName: null }
    ]);

    expect(lookup.get("dim_loc")).toBe("field-loc");
    expect(lookup.has("dim_cc")).toBe(false);
    expect(lookup.size).toBe(1);
  });
});

describe("matchDimensionValuesByName", () => {
  const values = [
    { dimensionId: "dim_loc", valueId: "loc_1", label: "Atlanta" },
    { dimensionId: "dim_loc", valueId: "loc_2", label: "Boston" },
    { dimensionId: "dim_loc", valueId: "loc_3", label: "Chicago" }
  ];

  it("proposes exact label ↔ name matches only (no trimming, no case folding)", () => {
    const proposals = matchDimensionValuesByName({
      values,
      providerOptions: [
        { id: "opt-a", name: "Atlanta" },
        { id: "opt-b", name: "boston" }, // case differs — not a match
        { id: "opt-c", name: "Chicago " } // whitespace differs — not a match
      ]
    });

    expect(proposals).toEqual([
      {
        dimensionId: "dim_loc",
        valueId: "loc_1",
        label: "Atlanta",
        externalId: "opt-a",
        externalName: "Atlanta"
      }
    ]);
  });

  it("skips ambiguous candidates: duplicate labels, duplicate option names, and already-mapped sides", () => {
    const proposals = matchDimensionValuesByName({
      values: [
        ...values,
        // duplicate label — ambiguous, both skipped
        { dimensionId: "dim_loc", valueId: "loc_4", label: "Atlanta" }
      ],
      providerOptions: [
        { id: "opt-a", name: "Atlanta" },
        // duplicate provider name — ambiguous, skipped
        { id: "opt-b1", name: "Boston" },
        { id: "opt-b2", name: "Boston" },
        { id: "opt-c", name: "Chicago" }
      ],
      // Chicago's provider option is already used by a mapping
      mappedExternalIds: ["opt-c"]
    });

    expect(proposals).toEqual([]);
  });

  it("skips values that already have a mapping", () => {
    const proposals = matchDimensionValuesByName({
      values,
      providerOptions: [{ id: "opt-a", name: "Atlanta" }],
      mappedValueKeys: ["dim_loc:loc_1"]
    });

    expect(proposals).toEqual([]);
  });

  it("skips values without a resolvable label and nameless options", () => {
    const proposals = matchDimensionValuesByName({
      values: [{ dimensionId: "dim_loc", valueId: "loc_x", label: null }],
      providerOptions: [{ id: "opt-x", name: null }]
    });

    expect(proposals).toEqual([]);
  });
});

// ── Slot-config validation ───────────────────────────────────────────────────

describe("validateDimensionSlots", () => {
  const targets: DimensionTarget[] = [
    { id: "class", label: "Class" },
    { id: "department", label: "Department" }
  ];

  it("accepts a valid config", () => {
    expect(
      validateDimensionSlots({
        slots: [
          { dimensionId: "dim_loc", target: "class" },
          { dimensionId: "dim_cc", target: "department" }
        ],
        targets,
        maxSlots: 2
      })
    ).toEqual([]);
  });

  it("rejects unknown provider targets", () => {
    const errors = validateDimensionSlots({
      slots: [{ dimensionId: "dim_loc", target: "tracking:abc" }],
      targets
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Unknown provider target "tracking:abc"');
  });

  it("rejects a dimension slotted twice", () => {
    const errors = validateDimensionSlots({
      slots: [
        { dimensionId: "dim_loc", target: "class" },
        { dimensionId: "dim_loc", target: "department" }
      ],
      targets
    });
    expect(errors.some((error) => error.includes("slotted 2 times"))).toBe(
      true
    );
  });

  it("enforces per-target capacity (default 1)", () => {
    const errors = validateDimensionSlots({
      slots: [
        { dimensionId: "dim_loc", target: "class" },
        { dimensionId: "dim_cc", target: "class" }
      ],
      targets
    });
    expect(
      errors.some((error) => error.includes('"class" is used by 2 slots'))
    ).toBe(true);
  });

  it("enforces the provider's structural slot cap", () => {
    const errors = validateDimensionSlots({
      slots: [
        { dimensionId: "dim_a", target: "class" },
        { dimensionId: "dim_b", target: "department" },
        { dimensionId: "dim_c", target: "class" }
      ],
      targets,
      maxSlots: 2
    });
    expect(errors.some((error) => error.includes("Too many"))).toBe(true);
  });
});

// ── autoCreate resolution (provider defaults) ────────────────────────────────

describe("resolveDimensionSlotAutoCreate", () => {
  it("honors an explicit flag over the provider default", () => {
    expect(resolveDimensionSlotAutoCreate({ autoCreate: false }, true)).toBe(
      false
    );
    expect(resolveDimensionSlotAutoCreate({ autoCreate: true }, false)).toBe(
      true
    );
  });

  it("falls back to the provider default when the slot has no flag (Rillet on, QBO/Xero off)", () => {
    expect(resolveDimensionSlotAutoCreate({}, true)).toBe(true);
    expect(resolveDimensionSlotAutoCreate({}, false)).toBe(false);
  });
});

// ── autoCreate orchestration ─────────────────────────────────────────────────
// Creation is always BY NAME (the resolved READABLE label); the returned
// provider id lands in the mappings lookup so pre-flight + mapper reuse it.

describe("ensureDimensionValueExternalIds", () => {
  const lines = [
    {
      dimensions: [
        { dimensionId: "dim_loc", valueId: "loc_1" },
        { dimensionId: "dim_item", valueId: "item_1" }
      ]
    },
    { dimensions: [{ dimensionId: "dim_loc", valueId: "loc_1" }] }, // duplicate value
    { dimensions: undefined }
  ];

  it("creates missing provider options by LABEL for autoCreate slots and updates the lookup in place", async () => {
    const mappings = new Map<string, string>();
    const createExternalValue = vi.fn(async () => "opt-created");
    const persistMapping = vi.fn(async () => undefined);

    const { created } = await ensureDimensionValueExternalIds({
      lines,
      slots: [{ dimensionId: "dim_loc", target: "field:f1", autoCreate: true }],
      defaultAutoCreate: false,
      mappings,
      resolveLabels: async () => new Map([["dim_loc:loc_1", "Atlanta"]]),
      createExternalValue,
      persistMapping
    });

    // Duplicate value on a second line creates exactly once, by name
    expect(createExternalValue).toHaveBeenCalledTimes(1);
    expect(createExternalValue).toHaveBeenCalledWith(
      { dimensionId: "dim_loc", target: "field:f1", autoCreate: true },
      "Atlanta"
    );
    expect(persistMapping).toHaveBeenCalledWith(
      { dimensionId: "dim_loc", valueId: "loc_1" },
      "opt-created",
      "Atlanta"
    );
    expect(mappings.get("dim_loc:loc_1")).toBe("opt-created");
    expect(created).toEqual([
      {
        dimensionId: "dim_loc",
        valueId: "loc_1",
        externalId: "opt-created",
        label: "Atlanta"
      }
    ]);
  });

  it("skips slots whose effective autoCreate is off and values already mapped", async () => {
    const mappings = new Map([["dim_loc:loc_1", "opt-existing"]]);
    const createExternalValue = vi.fn(async () => "never");

    const { created } = await ensureDimensionValueExternalIds({
      lines,
      slots: [
        { dimensionId: "dim_loc", target: "field:f1" }, // default off → skipped
        { dimensionId: "dim_item", target: "field:f2", autoCreate: false }
      ],
      defaultAutoCreate: false,
      mappings,
      resolveLabels: async () => new Map(),
      createExternalValue,
      persistMapping: vi.fn(async () => undefined)
    });

    expect(createExternalValue).not.toHaveBeenCalled();
    expect(created).toEqual([]);
  });

  it("applies the provider default (Rillet: on) to slots without an explicit flag", async () => {
    const mappings = new Map<string, string>();

    await ensureDimensionValueExternalIds({
      lines,
      slots: [{ dimensionId: "dim_loc", target: "field:f1" }],
      defaultAutoCreate: true,
      mappings,
      resolveLabels: async () => new Map([["dim_loc:loc_1", "Atlanta"]]),
      createExternalValue: async () => "fv-1",
      persistMapping: async () => undefined
    });

    expect(mappings.get("dim_loc:loc_1")).toBe("fv-1");
  });

  it("leaves values whose label cannot be resolved unmapped (warn/drop handles them downstream)", async () => {
    const mappings = new Map<string, string>();
    const createExternalValue = vi.fn(async () => "never");

    const { created } = await ensureDimensionValueExternalIds({
      lines,
      slots: [{ dimensionId: "dim_loc", target: "field:f1", autoCreate: true }],
      defaultAutoCreate: false,
      mappings,
      resolveLabels: async () => new Map(), // entity deleted — no label
      createExternalValue,
      persistMapping: vi.fn(async () => undefined)
    });

    expect(createExternalValue).not.toHaveBeenCalled();
    expect(created).toEqual([]);
    expect(mappings.size).toBe(0);
  });
});
