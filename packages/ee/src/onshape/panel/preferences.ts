/**
 * Company preferences for Onshape pushes.
 *
 * The panel used to hardcode every default a push applies: the unit of measure
 * ("EA" if the company happens to have it, otherwise whichever unit sorted
 * first), Make / Make to Order / Inventory for a designed part, Buy / Pull from
 * Inventory for a purchased BOM row, and the whole tree for an assembly. Each
 * was a reasonable guess and each was wrong for some shop, which then re-edited
 * the same fields on every push.
 *
 * Release behaviour is deliberately NOT here. What a release push does in
 * Carbon — whether new revisions become the default, whether a change notice
 * is recorded — is chosen per push in the panel's review step, because it is a
 * judgement about one release rather than a standing company rule.
 *
 * These live on the integration's settings metadata alongside `credentials` and
 * `propertyMap`. Everything here is pure and total: a stored value that no
 * longer parses (a unit that was deleted, an enum that was renamed, a
 * hand-edited row) falls back to the documented default rather than failing a
 * push, because a plan is built from these and a plan must always build.
 */

import type {
  ItemMethodType,
  ItemReplenishmentSystem,
  ItemTrackingType
} from "./plan";
import {
  ITEM_METHOD_TYPES,
  ITEM_REPLENISHMENT_SYSTEMS,
  ITEM_TRACKING_TYPES,
  VALID_METHOD_TYPES_BY_REPLENISHMENT
} from "./plan";

export type OnshapePushDefaults = {
  /**
   * Unit code for created items. Null means "decide from the company's list"
   * — the units themselves are per-company, so this is stored as a code and
   * resolved against the live list at plan time.
   */
  unitOfMeasureCode: string | null;
  /** Replenishment for a part the company designs (a Part Studio part). */
  replenishmentSystem: ItemReplenishmentSystem;
  /** Default method for a designed part. */
  methodTypeForMake: ItemMethodType;
  /** Default method for a purchased BOM row. Purchased rows are always Buy. */
  methodTypeForBuy: ItemMethodType;
  itemTrackingType: ItemTrackingType;
};

export const DEFAULT_PUSH_DEFAULTS: OnshapePushDefaults = {
  unitOfMeasureCode: null,
  replenishmentSystem: "Make",
  methodTypeForMake: "Make to Order",
  methodTypeForBuy: "Pull from Inventory",
  itemTrackingType: "Inventory"
};

/** The settings keys this module owns, for the metadata write path. */
export const PUSH_DEFAULT_SETTING_NAMES = [
  "defaultUnitOfMeasureCode",
  "defaultReplenishmentSystem",
  "defaultMethodTypeForMake",
  "defaultMethodTypeForBuy",
  "defaultItemTrackingType"
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T {
  return typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function pickTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Read the company's push defaults off the integration metadata. Total: any
 * shape in, a usable set of defaults out.
 */
export function parsePushDefaults(metadata: unknown): OnshapePushDefaults {
  if (!isRecord(metadata)) return { ...DEFAULT_PUSH_DEFAULTS };

  const replenishmentSystem = pickEnum(
    metadata.defaultReplenishmentSystem,
    ITEM_REPLENISHMENT_SYSTEMS,
    DEFAULT_PUSH_DEFAULTS.replenishmentSystem
  );
  const methodTypeForMake = pickEnum(
    metadata.defaultMethodTypeForMake,
    ITEM_METHOD_TYPES,
    DEFAULT_PUSH_DEFAULTS.methodTypeForMake
  );
  const methodTypeForBuy = pickEnum(
    metadata.defaultMethodTypeForBuy,
    ITEM_METHOD_TYPES,
    DEFAULT_PUSH_DEFAULTS.methodTypeForBuy
  );

  return reconcilePushDefaults({
    unitOfMeasureCode: pickTrimmedString(metadata.defaultUnitOfMeasureCode),
    replenishmentSystem,
    methodTypeForMake,
    methodTypeForBuy,
    itemTrackingType: pickEnum(
      metadata.defaultItemTrackingType,
      ITEM_TRACKING_TYPES,
      DEFAULT_PUSH_DEFAULTS.itemTrackingType
    )
  });
}

/**
 * Make a set of defaults internally legal.
 *
 * The ERP refuses a replenishment/method pair its own Part form would, and the
 * two are configured independently — so a pair that stopped being legal (the
 * replenishment changed, the method did not) resolves to the first method that
 * replenishment allows rather than failing a plan. Applied on the way in from
 * storage and on every edit in the Settings page, so the same rule holds
 * whether a value was typed or found.
 */
export function reconcilePushDefaults(
  defaults: OnshapePushDefaults
): OnshapePushDefaults {
  return {
    ...defaults,
    methodTypeForMake: reconcileMethodType(
      defaults.replenishmentSystem,
      defaults.methodTypeForMake,
      DEFAULT_PUSH_DEFAULTS.methodTypeForMake
    ),
    // A purchased BOM row is always Buy, whatever the designed-part setting is.
    methodTypeForBuy: reconcileMethodType(
      "Buy",
      defaults.methodTypeForBuy,
      DEFAULT_PUSH_DEFAULTS.methodTypeForBuy
    )
  };
}

/** A method the replenishment system allows, preferring the configured one. */
function reconcileMethodType(
  replenishment: ItemReplenishmentSystem,
  configured: ItemMethodType,
  fallback: ItemMethodType
): ItemMethodType {
  const allowed = VALID_METHOD_TYPES_BY_REPLENISHMENT[replenishment];
  if (allowed.includes(configured)) return configured;
  if (allowed.includes(fallback)) return fallback;
  // Every replenishment system has at least one allowed method, but the type
  // of a readonly index is still `| undefined`.
  return allowed[0] ?? DEFAULT_PUSH_DEFAULTS.methodTypeForMake;
}

/**
 * Whether two sets of defaults are the same choice.
 *
 * The Settings page has one Save for the whole page, so it has to know
 * whether this section has anything to write — a save that posts an unchanged
 * body is a write the audit trail records for nothing.
 */
export function pushDefaultsEqual(
  a: OnshapePushDefaults,
  b: OnshapePushDefaults
): boolean {
  return (
    a.unitOfMeasureCode === b.unitOfMeasureCode &&
    a.replenishmentSystem === b.replenishmentSystem &&
    a.methodTypeForMake === b.methodTypeForMake &&
    a.methodTypeForBuy === b.methodTypeForBuy &&
    a.itemTrackingType === b.itemTrackingType
  );
}
