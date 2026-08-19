import { describe, expect, it, vi } from "vitest";
import type { Item } from "~/stores/items";

// The items store reaches @carbon/react through the ~/hooks barrel, and
// @carbon/glossary's module-load-time Lingui `msg` macro isn't transformed
// under plain vitest. Stub it; the selection rules need none of it.
vi.mock("@carbon/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn()
}));

const { getItemPickerEntries } = await import("./itemPickerSelection");

const item = (id: string, active: boolean): Item =>
  ({
    id,
    name: id,
    readableId: id,
    readableIdWithRevision: id,
    revision: "0",
    replenishmentSystem: "Buy",
    itemTrackingType: "Inventory",
    unitOfMeasureCode: "EA",
    type: "Part",
    active
  }) as Item;

const ACTIVE = item("active-part", true);
const INACTIVE = item("inactive-part", false);

const ids = (entries: { item: Item }[]) => entries.map((e) => e.item.id);

describe("getItemPickerEntries", () => {
  it("hides an inactive item by default", () => {
    const entries = getItemPickerEntries([ACTIVE, INACTIVE], { type: "Part" });

    expect(ids(entries)).toEqual([ACTIVE.id]);
  });

  it("lists an inactive item as ineligible when the caller asks", () => {
    const entries = getItemPickerEntries([ACTIVE, INACTIVE], {
      type: "Part",
      showIneligible: true
    });

    expect(ids(entries)).toEqual([ACTIVE.id, INACTIVE.id]);
    expect(entries.map((e) => e.ineligibility)).toEqual([null, "inactive"]);
  });

  // A quote converted from a sales RFQ points at placeholder parts that are
  // inactive by design until the quote is ordered.
  it("leaves an exempted item selectable", () => {
    const entries = getItemPickerEntries([ACTIVE, INACTIVE], {
      type: "Part",
      showIneligible: true,
      eligibleItemIds: [INACTIVE.id]
    });

    expect(entries.map((e) => e.ineligibility)).toEqual([null, null]);
  });

  // Dropping it would render the field blank and let the next save rewrite the
  // record silently.
  it("keeps the current value even when the rules exclude it", () => {
    const entries = getItemPickerEntries([ACTIVE, INACTIVE], {
      type: "Part",
      selectedId: INACTIVE.id
    });

    expect(ids(entries)).toEqual([INACTIVE.id, ACTIVE.id]);
    expect(entries[0]?.isCurrentValue).toBe(true);
  });
});
