/**
 * The two client-side decisions the "From Onshape" source makes, as pure
 * functions.
 *
 * They live outside the component because they are the parts worth pinning: one
 * of them used to exist twice (`OnshapeCreatePart` seeded replenishment from the
 * element type, `onshape-bom-import` derived it from whether a row has
 * children), and the other decides whether a user is offered an action their
 * permissions cannot complete.
 */

/** 0 Part Studio body, 1 Assembly. Drawings (2) never reach the picker. */
export const ONSHAPE_ELEMENT_TYPE_ASSEMBLY = 1;

export type OnshapeSeed = {
  replenishmentSystem: "Buy" | "Make";
  defaultMethodType: "Pull from Inventory" | "Make to Order";
};

/**
 * What Carbon should assume about a part it is creating from an Onshape
 * element.
 *
 * Onshape supplies the part number, revision and name. It does NOT supply
 * these — replenishment and the default method are business decisions, not CAD
 * facts — so they are seeded from what the element IS and then shown for
 * confirmation rather than written silently.
 *
 * The same answer `mintDefaultsForRelease` reaches from the element type and
 * the BOM import reaches from whether a row has children. One rule, so the same
 * part cannot classify differently depending on which door it came through.
 */
export function seedFromElementType(elementType: number): OnshapeSeed {
  return elementType === ONSHAPE_ELEMENT_TYPE_ASSEMBLY
    ? { replenishmentSystem: "Make", defaultMethodType: "Make to Order" }
    : { replenishmentSystem: "Buy", defaultMethodType: "Pull from Inventory" };
}

/**
 * Why the BOM checkbox is not available, if it is not. A discriminant rather
 * than a sentence: the copy is the component's business, and a translated
 * string in a pure module is a string no test can assert on.
 */
export type BomOptionReason = "missing-permissions";

export type BomOptionState = {
  /** Render the checkbox at all. */
  offered: boolean;
  disabled: boolean;
  reason: BomOptionReason | null;
};

/**
 * Whether to offer "also import the bill of materials" for a selection.
 *
 * Two constraints, in order:
 *
 *  1. A Part Studio body has no bill of materials, so the option is not OFFERED
 *     for one — offering a choice that cannot work is worse than hiding it.
 *  2. The BOM import mints parts and deletes material lines, so it needs
 *     create + update + delete on parts, while creating a part needs only
 *     `create`. A create-only user must see the option DISABLED with a reason
 *     up front rather than discover it after the part is already made.
 */
export function bomOptionState(args: {
  elementType: number;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}): BomOptionState {
  if (args.elementType !== ONSHAPE_ELEMENT_TYPE_ASSEMBLY) {
    return { offered: false, disabled: true, reason: null };
  }

  const permitted = args.canCreate && args.canUpdate && args.canDelete;
  return {
    offered: true,
    disabled: !permitted,
    reason: permitted ? null : "missing-permissions"
  };
}
