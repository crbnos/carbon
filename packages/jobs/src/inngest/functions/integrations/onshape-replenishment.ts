// Deciding whether a part Carbon is about to create is BOUGHT or MADE.
//
// Lives in packages/jobs rather than packages/ee, and is env-free, for the same
// reason `onshape-matching.ts` and `onshape-bom-outcome.ts` do: importing the
// `@carbon/ee/onshape` barrel pulls in `client.ts`, which boots `@carbon/env`
// and throws "INNGEST_SIGNING_KEY is not set" in a unit test. Both consumers —
// the BOM import and the release job — are in this package anyway.
//
// This is the one question Onshape cannot answer from geometry, and the one
// Carbon most needs right: `methodMaterial.methodType` is denormalized from the
// component's `defaultMethodType`, so a subassembly minted Buy makes its
// parent's line read "Pull from Inventory" and the nested BOM never explodes —
// the sub-tree exists and never plans. The inverse is just as bad: a purchased
// leaf minted Make means MRP plans to build something the shop buys.
//
// THREE SOURCES, in descending authority:
//
// 1. Onshape's "Purchasing Level" column, when the company defines it. This is
//    what the LEGACY integration reads (`integrations.onshape.d…bom.ts`) and it
//    is the only place an engineer states the intent rather than implying it.
//    NOT a stock Onshape property — it appears in neither the 26 stock BOM
//    columns nor the 19 stock element metadata properties (checked live
//    2026-08-21), so a company that has not defined it has no value here and
//    that is the normal case, not an error.
//
// 2. STRUCTURE. A row with children is an assembly; a released assembly element
//    is an assembly. Both are made. A leaf is bought.
//
// 3. Nothing — which never happens, because (2) always resolves.
//
// What this deliberately does NOT do is what legacy does: fall through to
// "Make" when the column is absent. That is a recorded defect
// (`.ai/plans/2026-08-13-onshape-import-revisions.md`) — with no Purchasing
// Level column, which is every company that has not defined one, legacy calls
// every part Make, purchased leaves included. Absent must fall to STRUCTURE,
// not to a blanket answer.
//
// Per the spec's field-ownership rule, whatever this returns is SEEDED ONCE on
// create and is Carbon's thereafter: replenishment is a business decision, not
// a CAD fact, so no later sync overwrites it.

/** The Onshape column the legacy integration reads. Company-defined, not stock. */
export const ONSHAPE_PURCHASING_LEVEL_COLUMN = "Purchasing Level";

/** The value legacy treats as "bought". */
export const ONSHAPE_PURCHASED_VALUE = "Purchased";

export type OnshapeReplenishment = {
  replenishmentSystem: "Buy" | "Make";
  defaultMethodType: "Pull from Inventory" | "Make to Order";
  /** Which source decided it — reported to the user, so it must be honest. */
  source: "purchasing-level" | "structure";
};

/**
 * Read the Purchasing Level column out of a BOM row's columns.
 *
 * Matched case- and whitespace-insensitively on the DISPLAY NAME, because the
 * column is company-defined and therefore has no stable stock propertyId to key
 * on — unlike `Part number`, which does. That is a real fragility (a renamed or
 * localized column silently stops matching) and it is why the spec's
 * "extensible custom-field mapping" question exists. Until that lands, being
 * forgiving about case beats being exact about nothing.
 */
export function readOnshapePurchasingLevel(
  columns: Record<string, string> | null | undefined
): string | null {
  if (!columns) return null;
  const wanted = ONSHAPE_PURCHASING_LEVEL_COLUMN.trim().toLowerCase();
  for (const [key, value] of Object.entries(columns)) {
    if (key.trim().toLowerCase() !== wanted) continue;
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }
  return null;
}

const BUY: Pick<
  OnshapeReplenishment,
  "replenishmentSystem" | "defaultMethodType"
> = {
  replenishmentSystem: "Buy",
  defaultMethodType: "Pull from Inventory"
};

const MAKE: Pick<
  OnshapeReplenishment,
  "replenishmentSystem" | "defaultMethodType"
> = {
  replenishmentSystem: "Make",
  defaultMethodType: "Make to Order"
};

/** Onshape's numeric element type: 0 part studio, 1 assembly, 2 drawing. */
const ELEMENT_TYPE_ASSEMBLY = 1;

export function resolveOnshapeReplenishment(input: {
  /** The row's / element's Purchasing Level, when the company defines one. */
  purchasingLevel?: string | null;
  /** BOM path: does this row have children in the imported tree? */
  hasChildren?: boolean;
  /** Release path: the released element's numeric type. */
  elementType?: number;
}): OnshapeReplenishment {
  const declared = input.purchasingLevel?.trim();
  if (declared) {
    // Legacy's semantics, kept exactly: "Purchased" means bought, and anything
    // else the company has put in that column means made. Only the ABSENT case
    // is treated differently, and only because legacy's answer there is wrong.
    const purchased =
      declared.toLowerCase() === ONSHAPE_PURCHASED_VALUE.toLowerCase();
    return { ...(purchased ? BUY : MAKE), source: "purchasing-level" };
  }

  if (input.hasChildren !== undefined) {
    return { ...(input.hasChildren ? MAKE : BUY), source: "structure" };
  }

  // A released assembly is made; a released part studio body is a leaf, and an
  // unrecognised type falls to Buy — the safer wrong answer, since it does not
  // claim Carbon can build something it has no method for.
  return {
    ...(input.elementType === ELEMENT_TYPE_ASSEMBLY ? MAKE : BUY),
    source: "structure"
  };
}

/**
 * A sentence naming what Carbon assumed, for the notification that accompanies
 * an unattended creation. Says WHICH source decided it, because "Onshape told
 * us" and "we inferred it from the shape of the tree" warrant very different
 * levels of trust from the person reading it.
 */
export function describeOnshapeReplenishment(
  partNumber: string,
  resolved: OnshapeReplenishment
): string {
  const fields = `${resolved.replenishmentSystem} / ${resolved.defaultMethodType}`;
  if (resolved.source === "purchasing-level") {
    return `Carbon created ${partNumber} from an Onshape release as ${fields}, following its Onshape Purchasing Level, tracked in Inventory and measured in EA.`;
  }
  return resolved.replenishmentSystem === "Make"
    ? `Carbon created ${partNumber} from an Onshape release and ASSUMED it is made in-house (${fields}), because Onshape does not say. It has no bill of materials yet — import one, or correct the replenishment if it is bought. Tracked in Inventory and measured in EA.`
    : `Carbon created ${partNumber} from an Onshape release and ASSUMED it is purchased (${fields}), because Onshape does not say. Correct the replenishment if it is made in-house. Tracked in Inventory and measured in EA.`;
}
