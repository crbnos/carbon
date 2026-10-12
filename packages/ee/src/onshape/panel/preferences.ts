// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// The push defaults, stored as `default*` keys on the integration metadata.
// Parsing is total: a value that does not parse falls back to the default, so
// a plan always builds.

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
  /** Null: resolved from the company's units at plan time. */
  unitOfMeasureCode: string | null;
  /** Replenishment when no mapping and no BOM rule decides it. */
  replenishmentSystem: ItemReplenishmentSystem;
  /** Default method for an item created as Make, or with the default above. */
  methodTypeForMake: ItemMethodType;
  /** Default method for an item a mapping or Standard content makes Buy. */
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
 * Replenishment and method are saved independently, so a pair the Part form
 * would refuse resolves to a method the replenishment allows.
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

function reconcileMethodType(
  replenishment: ItemReplenishmentSystem,
  configured: ItemMethodType,
  fallback: ItemMethodType
): ItemMethodType {
  const allowed = VALID_METHOD_TYPES_BY_REPLENISHMENT[replenishment];
  if (allowed.includes(configured)) return configured;
  if (allowed.includes(fallback)) return fallback;
  // Unreachable: the readonly index type only adds `undefined`.
  return allowed[0] ?? DEFAULT_PUSH_DEFAULTS.methodTypeForMake;
}
