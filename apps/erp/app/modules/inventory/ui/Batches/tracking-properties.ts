import type { TrackedEntityAttributes } from "@carbon/utils";

// Structural attribute keys written by the tracking RPCs / shipment assignment —
// never user-facing custom property values. Kept in ONE place so receipts and
// shipments filter identically.
export const RESERVED_TRACKING_ATTRIBUTE_KEYS = [
  "Shipment Line",
  "Shipment",
  "Shipment Line Index",
  "Receipt Line",
  "Receipt",
  "Receipt Line Index",
  "Supplier",
  "expirationDate"
] as const;

// Extract only the custom property values (keyed by batchProperty.id) from a
// tracked entity's attributes, dropping every structural key.
export function getTrackingPropertyValues(
  attributes:
    | TrackedEntityAttributes
    | Record<string, unknown>
    | null
    | undefined
): Record<string, string> {
  if (!attributes) return {};
  return Object.entries(attributes as Record<string, unknown>)
    .filter(
      ([key]) =>
        !(RESERVED_TRACKING_ATTRIBUTE_KEYS as readonly string[]).includes(key)
    )
    .reduce(
      (acc, [key, value]) => ({ ...acc, [key]: (value as string) || "" }),
      {} as Record<string, string>
    );
}
