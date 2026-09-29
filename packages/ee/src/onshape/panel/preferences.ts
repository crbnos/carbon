/**
 * Company preferences for Onshape pushes.
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
 * replenishment allows rather than failing a plan.
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
