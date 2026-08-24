// What Carbon assumes about a part it mints from a release.
//
// The judgement itself lives in `@carbon/ee/onshape`'s
// `resolveOnshapeReplenishment`, shared with the BOM import, so the same part
// cannot classify two ways depending on which door it came through. This file
// is the release path's adapter onto it: a release has no BOM tree, so the
// structural signal is the element type rather than "has children".
//
// Precedence, in full:
//
//   1. Onshape's "Purchasing Level" — the company-defined column the LEGACY
//      integration reads, and the only place an engineer states the intent
//      rather than implying it. The release job reads it from the element's
//      metadata properties, since there is no BOM row to read it from.
//   2. The element type — assembly is made, part studio body is a leaf.
//
// Everything else takes Carbon's own defaults, because Onshape genuinely does
// not say: `itemTrackingType` is not a CAD fact at all, and Onshape's "Unit of
// measure" column describes the CAD quantity rather than Carbon's stocking
// unit.

import {
  describeOnshapeReplenishment,
  resolveOnshapeReplenishment
} from "@carbon/ee/onshape/replenishment";

export interface OnshapeMintDefaults {
  replenishmentSystem: "Buy" | "Make";
  defaultMethodType: "Pull from Inventory" | "Make to Order";
  itemTrackingType: "Inventory";
  unitOfMeasureCode: string;
  /** Which source decided replenishment — reported, so it must be honest. */
  replenishmentSource: "purchasing-level" | "structure";
  /** Customer-facing sentence naming what Carbon assumed. */
  assumption: string;
}

export function mintDefaultsForRelease(args: {
  elementType: number;
  partNumber: string;
  /** From the released element's Onshape metadata, when the company sets it. */
  purchasingLevel?: string | null;
}): OnshapeMintDefaults {
  const resolved = resolveOnshapeReplenishment({
    purchasingLevel: args.purchasingLevel,
    elementType: args.elementType
  });

  return {
    replenishmentSystem: resolved.replenishmentSystem,
    defaultMethodType: resolved.defaultMethodType,
    itemTrackingType: "Inventory",
    unitOfMeasureCode: "EA",
    replenishmentSource: resolved.source,
    assumption: describeOnshapeReplenishment(args.partNumber, resolved)
  };
}
