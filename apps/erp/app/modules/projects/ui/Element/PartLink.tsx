// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Combobox } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import { Link } from "react-router";
import { ItemThumbnail } from "~/components";
import { getLinkToItemDetails } from "~/modules/items/ui/Item/ItemForm";
import type { ItemType } from "~/modules/shared";
import { useItems } from "~/stores";
import type { ProjectElementPage } from "../../projects.server";
import { useElementField } from "../Elements/ElementProperties";
import { SerialSelect } from "./SerialSelect";

type Element = ProjectElementPage["element"];

const LINKABLE_TYPES: ItemType[] = [
  "Part",
  "Material",
  "Tool",
  "Consumable",
  "Service"
];

/**
 * The element's linked part: an item of any type and, for a serial-tracked
 * item, one serial. A linked part shows its thumbnail and readable id with a
 * link to the item page. Picking another item drops the serial.
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
  const serialField = useElementField(projectId, element.id, "trackedEntityId");
  const itemId =
    itemField.pending === undefined ? element.itemId : itemField.pending;
  const trackedEntityId =
    itemField.pending !== undefined
      ? null
      : serialField.pending === undefined
        ? element.trackedEntityId
        : serialField.pending;

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
    <div className="flex w-full min-w-0 flex-col gap-1">
      {itemId && readableId && (
        <div className="flex min-w-0 items-center gap-2 px-2">
          <ItemThumbnail
            size="sm"
            thumbnailPath={loaded?.thumbnailPath}
            type={type}
          />
          {type && LINKABLE_TYPES.includes(type) ? (
            <Link
              to={getLinkToItemDetails(type, itemId)}
              className="truncate font-mono text-sm hover:underline"
            >
              {readableId}
            </Link>
          ) : (
            <span className="truncate font-mono text-sm">{readableId}</span>
          )}
        </div>
      )}
      <Combobox
        asButton
        size="sm"
        value={itemId ?? ""}
        options={options}
        isClearable
        isReadOnly={isDisabled}
        placeholder={t`No part`}
        onChange={(next) => {
          if ((next || null) !== itemId) itemField.submit(next || null);
        }}
      />
      {itemId && isSerial && (
        <SerialSelect
          itemId={itemId}
          value={trackedEntityId}
          current={element.trackedEntity}
          isReadOnly={isDisabled}
          onChange={(next) => serialField.submit(next)}
        />
      )}
    </div>
  );
}
