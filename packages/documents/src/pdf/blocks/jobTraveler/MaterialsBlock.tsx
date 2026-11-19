// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { View } from "@react-pdf/renderer";
import type { jobTravelerTexts, TextFn } from "../../../template";
import { TextCell } from "../Cell";
import { columnWidths } from "../columns";
import { tw } from "./tw";
import type { JobTravelerData } from "./types";
import { buildJobTravelerMaterialVars } from "./vars";

// Shared column styles so the header and body rows can never drift out of
// alignment. The widths sum to 100%; spacing between columns comes from in-cell
// right padding (pr-4) rather than a flex gap, which previously pushed the
// total width past 100% and made long item ids overlap the description.
const COL_ITEM = "text-left pr-4";
const COL_DESCRIPTION = "text-left pr-4";
const COL_QUANTITY = "text-right";

type DocumentTextKey = (typeof jobTravelerTexts.document)[number]["key"];

/**
 * Opt-in Bill of Materials table (item, description, quantity).
 * Rendered only when the company setting `includeMaterialsOnTraveler` is on and
 * the make method has materials — see JobTravelerPageContent.
 *
 * Page breaks: each row is unbreakable (`wrap={false}`), and the table header is
 * bound to the first row so it can never be orphaned at the bottom of a page.
 * Remaining rows flow naturally, so a long BOM still expands across pages.
 */
export function MaterialsBlock({
  data,
  text: t
}: {
  data: JobTravelerData;
  /** The document's texts: the table's column headers live there. */
  text: TextFn<DocumentTextKey>;
}) {
  const materials = data.materials ?? [];
  if (materials.length === 0) return null;
  const w = columnWidths(
    [
      { key: "materialsItem", width: 500 / 12 },
      { key: "materialsDescription", width: 500 / 12 },
      { key: "materialsQuantity", width: 200 / 12 }
    ],
    t.shows,
    "materialsDescription"
  );

  const header = (
    <View
      style={tw(
        "flex flex-row justify-between items-center py-3 px-[6px] border-t border-b border-gray-300 font-bold uppercase"
      )}
    >
      <TextCell width={w.materialsItem} style={tw(COL_ITEM)}>
        {t("materialsItem")}
      </TextCell>
      <TextCell width={w.materialsDescription} style={tw(COL_DESCRIPTION)}>
        {t("materialsDescription")}
      </TextCell>
      <TextCell width={w.materialsQuantity} style={tw(COL_QUANTITY)}>
        {t("materialsQuantity")}
      </TextCell>
    </View>
  );

  return (
    <View style={tw("mb-6 text-xs")}>
      {materials.map((material, index) => {
        const rowVars = data.values.row(
          "material",
          material.id,
          buildJobTravelerMaterialVars(material)
        );
        const cells = (
          <>
            <TextCell
              width={w.materialsItem}
              style={tw(`${COL_ITEM} font-bold`)}
            >
              {t("materialsItemCell", rowVars)}
            </TextCell>
            <TextCell
              width={w.materialsDescription}
              style={tw(COL_DESCRIPTION)}
            >
              {t("materialsDescriptionCell", rowVars)}
            </TextCell>
            <TextCell width={w.materialsQuantity} style={tw(COL_QUANTITY)}>
              {t("materialsQuantityCell", rowVars)}
            </TextCell>
          </>
        );

        const row = (
          <View
            style={tw(
              "flex flex-row justify-between items-start border-b border-gray-300 py-3 px-[6px]"
            )}
            wrap={false}
          >
            {cells}
          </View>
        );

        // Keep the header attached to the first row so it never lands alone at
        // the bottom of a page. `minPresenceAhead` pushes the pair to the next
        // page when there isn't room for it plus a little of the table.
        if (index === 0) {
          return (
            <View key={material.id} wrap={false} minPresenceAhead={80}>
              {header}
              {row}
            </View>
          );
        }

        return <View key={material.id}>{row}</View>;
      })}
    </View>
  );
}
