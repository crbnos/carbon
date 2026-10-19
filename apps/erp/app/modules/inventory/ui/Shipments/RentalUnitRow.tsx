// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Badge,
  Checkbox,
  HStack,
  NumberField,
  NumberInput,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { ItemThumbnail } from "~/components";
import { useQuantityFormatter } from "~/hooks";
import type { RentalShipmentLine } from "../../types";

type RentalUnitRowProps = {
  line: Omit<RentalShipmentLine, "shipped">;
  checked: boolean;
  checkedLabel: string;
  isReadOnly: boolean;
  onCheckedChange: (checked: boolean) => void;
  onMeterChange: (meter: string) => void;
};

/** One rental unit on a rental shipment or receipt, laid out like an
 *  ordinary document line: the unit (thumbnail, name, asset id and serial)
 *  takes what the meter leaves, and the meter stays on the same line once the
 *  row is wide enough. Sized by the row's own `@container`. */
export function RentalUnitRow({
  line,
  checked,
  checkedLabel,
  isReadOnly,
  onCheckedChange,
  onMeterChange
}: RentalUnitRowProps) {
  const { t } = useLingui();
  const formatQuantity = useQuantityFormatter();
  const identifiers = [line.assetReadableId, line.serialNumber]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col @3xl:flex-row @3xl:items-center gap-4 w-full">
      <HStack spacing={4} className="flex-1 min-w-0">
        <Checkbox
          aria-label={checkedLabel}
          isChecked={checked}
          disabled={isReadOnly}
          onCheckedChange={(value) => onCheckedChange(value === true)}
        />
        <ItemThumbnail
          size="md"
          thumbnailPath={line.thumbnailPath}
          type={(line.itemType as "Part") ?? "Part"}
        />
        <VStack spacing={0} className="flex-1 min-w-0">
          <HStack spacing={2} className="w-full min-w-0">
            <span
              className="text-sm font-medium truncate"
              title={line.unitName}
            >
              {line.unitName}
            </span>
            {line.lineStatus === "Pending" && (
              <Badge variant="secondary" className="shrink-0">
                <Trans>Not delivered</Trans>
              </Badge>
            )}
          </HStack>
          {identifiers && (
            <span className="text-xs text-muted-foreground truncate w-full">
              {identifiers}
            </span>
          )}
        </VStack>
      </HStack>
      <VStack spacing={1} className="w-auto shrink-0 pl-8 @3xl:pl-0">
        <label className="text-xs text-muted-foreground">
          <Trans>Meter</Trans>
        </label>
        {isReadOnly ? (
          // Posted: the meter is a record of what was read, not an input.
          <span className="text-sm py-1.5">
            {line.meter === null ? "—" : formatQuantity(line.meter)}
          </span>
        ) : (
          // react-aria commits on blur (or Enter); an emptied field commits NaN.
          <NumberField
            aria-label={t`Meter`}
            defaultValue={line.meter ?? undefined}
            formatOptions={INPUT_FORMAT.quantity}
            step={INPUT_STEP.quantity}
            minValue={0}
            onChange={(value) => {
              const next = value == null || isNaN(value) ? null : value;
              if (next === line.meter) return;
              onMeterChange(next === null ? "" : String(next));
            }}
          >
            <NumberInput size="sm" className="w-32" />
          </NumberField>
        )}
      </VStack>
    </div>
  );
}
