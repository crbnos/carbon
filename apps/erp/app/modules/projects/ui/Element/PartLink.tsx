// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import { Link } from "react-router";
import { ItemThumbnail } from "~/components";
import { useSerialNumbers } from "~/modules/inventory/ui/Shipments/ShipmentLines";
import { getLinkToItemDetails } from "~/modules/items/ui/Item/ItemForm";
import type { ItemType } from "~/modules/shared/types";
import { useItems } from "~/stores";
import type { ProjectElementPage } from "../../projects.server";
import { useElementField } from "../Elements/ElementProperties";
import { PropertyCombobox } from "./PropertyFields";

type Element = ProjectElementPage["element"];

const LINKABLE_TYPES: ItemType[] = [
  "Part",
  "Material",
  "Tool",
  "Consumable",
  "Service"
];

/**
 * The element's linked part, in the properties panel's inline pattern: an
 * item of any type and, for a serial-tracked item, one serial. A linked part
 * shows its thumbnail and readable id with a link to the item page. Picking
 * another item drops the serial.
 */
export function PartLink({
  projectId,
  element,
  isDisabled
}: {
  projectId: string;
  element: Element;
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const [items] = useItems();
  const itemField = useElementField(projectId, element.id, "itemId");
  const itemId =
    itemField.pending === undefined ? element.itemId : itemField.pending;

  const options = useMemo(
    () =>
      items
        .filter((item) => item.active || item.id === itemId)
        .map((item) => ({
          value: item.id,
          label: item.readableIdWithRevision,
          helper: item.name
        })),
    [items, itemId]
  );
  const item = items.find((i) => i.id === itemId);
  // The loaded item still names the link while the items list loads.
  const loaded = element.item?.id === itemId ? element.item : null;
  const type = (item?.type ?? loaded?.type) as ItemType | undefined;
  const readableId =
    item?.readableIdWithRevision ?? loaded?.readableIdWithRevision;
  const isSerial =
    (item?.itemTrackingType ?? loaded?.itemTrackingType) === "Serial";

  return (
    <>
      <PropertyCombobox
        projectId={projectId}
        elementId={element.id}
        field="itemId"
        label={t`Linked part`}
        value={element.itemId}
        options={options}
        isDisabled={isDisabled}
        renderValue={() => (
          <span className="flex min-w-0 items-center gap-2">
            <ItemThumbnail
              size="sm"
              thumbnailPath={loaded?.thumbnailPath}
              type={type}
            />
            {itemId && type && LINKABLE_TYPES.includes(type) ? (
              <Link
                to={getLinkToItemDetails(type, itemId)}
                className="truncate hover:underline"
              >
                {readableId}
              </Link>
            ) : (
              <span className="truncate">{readableId}</span>
            )}
          </span>
        )}
      />
      {itemId && isSerial && (
        <SerialField
          projectId={projectId}
          element={element}
          itemId={itemId}
          isDisabled={isDisabled}
        />
      )}
    </>
  );
}

/** The linked part's serial: the item's serials as an inline combobox. */
function SerialField({
  projectId,
  element,
  itemId,
  isDisabled
}: {
  projectId: string;
  element: Element;
  itemId: string;
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const { data } = useSerialNumbers(itemId, true);
  const current = element.trackedEntity;
  const options = useMemo(() => {
    const rows: { value: string; label: string; helper?: string }[] = (
      data?.data ?? []
    ).map((serial) => ({
      value: serial.id,
      label: serial.readableId ?? serial.id,
      helper: serial.status
    }));
    // The current serial stays an option when the list no longer has it.
    if (current && !rows.some((row) => row.value === current.id)) {
      rows.unshift({
        value: current.id,
        label: current.readableId ?? current.id
      });
    }
    return rows;
  }, [data, current]);

  return (
    <PropertyCombobox
      projectId={projectId}
      elementId={element.id}
      field="trackedEntityId"
      label={t`Serial`}
      value={element.itemId === itemId ? element.trackedEntityId : null}
      options={options}
      isDisabled={isDisabled}
    />
  );
}
