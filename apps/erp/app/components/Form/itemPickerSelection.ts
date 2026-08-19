import type { Item } from "~/stores/items";
import { latestRevisionByReadableId } from "~/stores/items";

// The item-type enum as the picker sees it. Taken from the store row rather
// than `~/modules/shared` so this module stays free of app barrels — it is
// imported by a unit test that must not pull in half the app.
type ItemType = Item["type"];

// Why an item may not be chosen. A code rather than a sentence: the wording is
// translated at the call site, and a code is what a test can assert on.
export type ItemIneligibility = "inactive";

export type ItemPickerCriteria = {
  type: ItemType | "Item";
  validItemTypes?: ItemType[];
  replenishmentSystem?: "Buy" | "Make";
  latestRevisionOnly?: boolean;
  whitelist?: string[];
  blacklist?: string[];
  // Keep inactive items AND leave them selectable (BOM/change-order pickers,
  // which have to be able to reference a draft).
  includeInactive?: boolean;
  // Keep ineligible items in the list but mark them, instead of hiding them.
  showIneligible?: boolean;
  // Exempt from the eligibility rules — e.g. the placeholder parts an
  // RFQ-converted quote already references, which are inactive by design.
  eligibleItemIds?: string[];
  // The field's current value. Always kept in the list (unless blacklisted) so
  // a record pointing at a now-excluded item still renders it.
  selectedId?: string;
};

export type ItemPickerEntry = {
  item: Item;
  ineligibility: ItemIneligibility | null;
  // True for the row injected purely because it is the field's current value.
  // It stays selectable — it is already the saved value — and is labelled
  // rather than greyed out.
  isCurrentValue?: boolean;
};

// Why this item cannot be chosen, or null when it is fine to select.
export function getItemIneligibility(
  item: Pick<Item, "id" | "active">,
  criteria: Pick<
    ItemPickerCriteria,
    "includeInactive" | "showIneligible" | "eligibleItemIds"
  >
): ItemIneligibility | null {
  if (criteria.includeInactive) return null;
  if (criteria.eligibleItemIds?.includes(item.id)) return null;
  if (!item.active) return "inactive";
  return null;
}

// The item rows a picker should show, in order, each with the reason it cannot
// be chosen (null when it can). Pure on purpose: every selection rule in the
// picker lives here so it can be tested without rendering.
export function getItemPickerEntries(
  items: Item[],
  criteria: ItemPickerCriteria
): ItemPickerEntry[] {
  const {
    type,
    validItemTypes,
    replenishmentSystem,
    latestRevisionOnly,
    whitelist,
    blacklist,
    showIneligible,
    selectedId
  } = criteria;

  let filtered = items.filter((item) => {
    if (validItemTypes && !validItemTypes.includes(item.type)) return false;

    if (type !== "Item" && type !== item.type) return false;

    // An ineligible item is dropped unless the caller wants it shown and
    // explained.
    if (!showIneligible && getItemIneligibility(item, criteria)) return false;

    if (replenishmentSystem) {
      const systemMatches =
        item.replenishmentSystem === replenishmentSystem ||
        item.replenishmentSystem === "Buy and Make";

      if (!systemMatches) return false;
    }

    return true;
  });

  // Collapse to a single current revision per part.
  if (latestRevisionOnly) {
    filtered = latestRevisionByReadableId(filtered);
  }

  if (whitelist) {
    filtered = filtered.filter((item) => whitelist.includes(item.id));
  }

  if (blacklist) {
    filtered = filtered.filter((item) => !blacklist.includes(item.id));
  }

  let entries: ItemPickerEntry[] = filtered.map((item) => ({
    item,
    ineligibility: getItemIneligibility(item, criteria)
  }));

  // A record can legitimately point at an item the filters exclude — it was
  // deactivated after the record was written, for instance. Dropping it would
  // render the field blank and let the next save rewrite the record silently,
  // so the current value is always kept. It stays out only when a caller
  // explicitly blacklisted it.
  if (
    selectedId &&
    !entries.some((entry) => entry.item.id === selectedId) &&
    !blacklist?.includes(selectedId)
  ) {
    const selected = items.find((item) => item.id === selectedId);
    if (selected) {
      entries = [
        {
          item: selected,
          ineligibility: getItemIneligibility(selected, criteria),
          isCurrentValue: true
        },
        ...entries
      ];
    }
  }

  return entries;
}
