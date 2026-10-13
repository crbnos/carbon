// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Combobox } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import { useSerialNumbers } from "~/modules/inventory/ui/Shipments/ShipmentLines";

/**
 * A combobox of one item's serials. It reads the serials through the
 * inventory serial numbers API. The current serial stays an option when the
 * list no longer has it, so a linked serial always shows its readable id.
 */
export function SerialSelect({
  itemId,
  value,
  current,
  isReadOnly,
  onChange
}: {
  itemId: string;
  value: string | null;
  /** The linked serial as the element page loaded it. */
  current?: { id: string; readableId: string | null } | null;
  isReadOnly: boolean;
  onChange: (trackedEntityId: string | null) => void;
}) {
  const { t } = useLingui();
  const { data } = useSerialNumbers(itemId, true);

  const options = useMemo(() => {
    const rows: { value: string; label: string; helper?: string }[] = (
      data?.data ?? []
    ).map((serial) => ({
      value: serial.id,
      label: serial.readableId ?? serial.id,
      helper: serial.status
    }));
    if (current && !rows.some((row) => row.value === current.id)) {
      rows.unshift({
        value: current.id,
        label: current.readableId ?? current.id
      });
    }
    return rows;
  }, [data, current]);

  return (
    <Combobox
      asButton
      size="sm"
      value={value ?? ""}
      options={options}
      isClearable
      isReadOnly={isReadOnly}
      placeholder={t`No serial`}
      onChange={(next) => {
        if ((next || null) !== value) onChange(next || null);
      }}
    />
  );
}
