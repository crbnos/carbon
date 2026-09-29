// Anti-drift contract test. Locks the registry (what the builder offers) to the
// runtime code path (what `buildLineContext` actually populates) per surface.
//
// If someone adds a field to FIELD_REGISTRY without populating it in
// `buildLineContext`/the server SELECTs, or renames a ctx key (e.g. the
// `storageTypeIds` → `storageTypeId` mapping), or edits
// SURFACE_CONTEXT_AVAILABILITY out of sync — one of these assertions fails.

import {
  buildResolver,
  FIELD_REGISTRY,
  type FieldContext,
  getFieldsForTargetTypeAndSurfaces,
  SURFACE_CONTEXT_AVAILABILITY,
  SURFACES_BY_TARGET_TYPE,
  TARGET_TYPES,
  type TargetType,
  TRANSACTION_SURFACES,
  type TransactionSurface
} from "@carbon/utils";
import { describe, expect, it } from "vitest";
import { buildLineContext, type RuleLineInput } from "./context";

// Fully-populated rows mirroring the shape `evaluateLinesForSurface` builds
// AFTER its post-query flattening (itemPostingGroupId off itemCost; storageTypeId
// unioned from storageTypeIds). Every registry-referenced key is present.
const ITEM_ROW = {
  id: "ITEM-1",
  type: "Part",
  replenishmentSystem: "Buy",
  itemTrackingType: "Inventory",
  itemPostingGroupId: "ipg_1"
};
const STORAGE_ROW = {
  id: "su_1",
  storageTypeId: ["st_1"],
  locationId: "loc_1",
  warehouseId: "wh_1",
  name: "Bin A"
};
const WORKCENTER_ROW = { id: "wc_1", locationId: "loc_1", active: true };

// FieldContext value → RuleContext root key (only "storage" differs).
const ctxRootKeyFor = (context: FieldContext): string =>
  context === "storage" ? "storageUnit" : context;

// targetTypes a surface belongs to (item surfaces vs workCenter surfaces).
const targetTypesForSurface = (surface: TransactionSurface): TargetType[] =>
  TARGET_TYPES.filter((tt) => SURFACES_BY_TARGET_TYPE[tt].includes(surface));

// Build a representative line carrying exactly the ids the availability map says
// the surface populates — mirroring what real trigger call sites pass.
const lineForSurface = (surface: TransactionSurface): RuleLineInput => {
  const contexts = SURFACE_CONTEXT_AVAILABILITY[surface];
  return {
    lineId: "line_1",
    quantity: 5,
    locationId: "loc_1",
    itemId: contexts.includes("item") ? ITEM_ROW.id : null,
    storageUnitId: contexts.includes("storage") ? STORAGE_ROW.id : null,
    workCenterId: contexts.includes("workCenter") ? WORKCENTER_ROW.id : null,
    operation: contexts.includes("operation")
      ? {
          id: "op_1",
          itemId: ITEM_ROW.id,
          quantity: 5,
          workInstructionId: "wi_1"
        }
      : undefined
  };
};

const ctxFor = (surface: TransactionSurface) =>
  buildLineContext({
    line: lineForSurface(surface),
    surface,
    userId: "user_1",
    item: ITEM_ROW,
    storageUnit: STORAGE_ROW,
    workCenter: WORKCENTER_ROW
  });

describe("registry ↔ runtime ctx contract", () => {
  for (const surface of TRANSACTION_SURFACES) {
    it(`every field offered on "${surface}" resolves in the runtime ctx`, () => {
      const ctx = ctxFor(surface);
      const offered = new Map<string, ReturnType<typeof buildResolver>>();
      for (const tt of targetTypesForSurface(surface)) {
        for (const f of getFieldsForTargetTypeAndSurfaces(tt, [surface])) {
          offered.set(f.path, buildResolver(f.path));
        }
      }
      expect(offered.size).toBeGreaterThan(0);
      for (const [path, resolve] of offered) {
        expect(
          resolve(ctx),
          `"${path}" offered on "${surface}" but resolved to undefined`
        ).not.toBeUndefined();
      }
    });

    it(`ctx for "${surface}" populates exactly the declared contexts`, () => {
      const ctx = ctxFor(surface) as Record<string, unknown>;
      for (const context of SURFACE_CONTEXT_AVAILABILITY[surface]) {
        expect(
          ctx[ctxRootKeyFor(context)],
          `context "${context}" declared available on "${surface}" but not built`
        ).not.toBeUndefined();
      }
    });
  }
});

describe("registry coverage by availability map", () => {
  // Every registry field's context must be declared available on every surface
  // of its valid targetType(s) — otherwise the builder could offer a field the
  // map silently excludes (or, worse, a field with no surface at all).
  it("every field is available on at least one surface of its targetType", () => {
    for (const f of FIELD_REGISTRY) {
      const targets: TargetType[] =
        f.targetType === "shared"
          ? [...TARGET_TYPES]
          : Array.isArray(f.targetType)
            ? [...f.targetType]
            : [f.targetType];
      const surfaces = new Set<TransactionSurface>();
      for (const tt of targets)
        for (const s of SURFACES_BY_TARGET_TYPE[tt]) surfaces.add(s);
      const covered = Array.from(surfaces).some((s) =>
        SURFACE_CONTEXT_AVAILABILITY[s].includes(f.context)
      );
      expect(
        covered,
        `field "${f.path}" (context "${f.context}") is offered on no surface`
      ).toBe(true);
    }
  });
});
