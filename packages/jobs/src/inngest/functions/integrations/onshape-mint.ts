// What Carbon assumes about a part it mints from a release.
//
// This is the whole of the auto-create feature's judgement, so it is a pure
// function in its own file — the same reason `onshape-matching.ts` is.
// Importing the job module boots the Inngest client and needs signing keys.
//
// THE PROBLEM. A release carries GEOMETRY, not structure. Onshape says nothing
// about whether a part is bought or made, how it is tracked, or what unit it is
// stocked in — and those are the fields that decide what MRP does with it. That
// is exactly why v2 refused to mint from a release at all: a purchased leaf
// part landing as Inventory/Make poisons planning.
//
// THE RULE, and why it is this one. `elementType` is the same signal the BOM
// import already uses, and the BOM import's version of this decision is
// shipped, reviewed and load-bearing:
//
//   > children  → replenishmentSystem "Make", defaultMethodType "Make to Order"
//   > leaf      → replenishmentSystem "Buy",  defaultMethodType "Pull from Inventory"
//
// A released ASSEMBLY (elementType 1) has structure by definition; a released
// PART STUDIO BODY (elementType 0) is a leaf. So the release path can reach the
// same answer from the event alone. Mirroring the existing rule beats inventing
// a second one that could disagree with it on the same part depending on which
// door it came through.
//
// WHAT THIS STILL GETS WRONG, stated plainly rather than hidden: an assembly
// minted Make arrives with an auto-created Draft makeMethod and NO materials,
// so planning briefly sees something buildable out of nothing. The release path
// imports geometry, not a BOM, and there is no option that avoids both that and
// the purchased-leaf failure without also importing the structure. The mitigation
// is reporting, not cleverness — every creation is announced, naming what Carbon
// guessed, so a human can correct it.

/** Onshape's numeric element type: 0 part studio, 1 assembly, 2 drawing. */
const ELEMENT_TYPE_ASSEMBLY = 1;

export interface OnshapeMintDefaults {
  replenishmentSystem: "Buy" | "Make";
  defaultMethodType: "Pull from Inventory" | "Make to Order";
  itemTrackingType: "Inventory";
  unitOfMeasureCode: string;
  /** Customer-facing sentence naming what Carbon assumed. */
  assumption: string;
}

export function mintDefaultsForRelease(args: {
  elementType: number;
  partNumber: string;
}): OnshapeMintDefaults {
  const isAssembly = args.elementType === ELEMENT_TYPE_ASSEMBLY;

  return {
    replenishmentSystem: isAssembly ? "Make" : "Buy",
    defaultMethodType: isAssembly ? "Make to Order" : "Pull from Inventory",
    // Carbon's own defaults. Onshape's BOM has a "Unit of measure" column, but
    // it describes the CAD quantity rather than Carbon's stocking unit, and a
    // release does not carry it at all.
    itemTrackingType: "Inventory",
    unitOfMeasureCode: "EA",
    assumption: isAssembly
      ? `Carbon created ${args.partNumber} from an Onshape release and assumed it is made in-house (Make / Make to Order), tracked in Inventory and measured in EA. It has no bill of materials yet — import one, or correct the replenishment if it is bought.`
      : `Carbon created ${args.partNumber} from an Onshape release and assumed it is purchased (Buy / Pull from Inventory), tracked in Inventory and measured in EA. Correct the replenishment if it is made in-house.`
  };
}
