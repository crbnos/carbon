// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Combobox, VStack } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";

export type SalesDimensionAssignment = {
  dimensionId: string;
  valueId: string;
};

export type SalesCustomDimension = {
  id: string;
  name: string;
  values: { id: string; name: string }[];
};

type SalesDimensionAssignmentsProps = {
  availableDimensions: SalesCustomDimension[];
  assignments: SalesDimensionAssignment[];
  disabled?: boolean;
  readOnly?: boolean;
  onChange: (assignments: SalesDimensionAssignment[]) => void;
};

/** One value per configured Custom dimension on a customer or sales document. */
export function SalesDimensionAssignments({
  availableDimensions,
  assignments,
  disabled = false,
  readOnly = false,
  onChange
}: SalesDimensionAssignmentsProps) {
  const { t } = useLingui();

  return (
    <VStack spacing={3}>
      {availableDimensions.map((dimension) => {
        const selectedValue = assignments.find(
          (assignment) => assignment.dimensionId === dimension.id
        )?.valueId;
        const options = [
          { value: "", label: t`Unassigned` },
          ...dimension.values.map((value) => ({
            value: value.id,
            label: value.name
          })),
          ...(selectedValue &&
          !dimension.values.some((value) => value.id === selectedValue)
            ? [{ value: selectedValue, label: t`Unavailable value` }]
            : [])
        ];

        return (
          <div key={dimension.id} className="w-full min-w-0 space-y-1">
            <span className="text-xs text-muted-foreground">
              {dimension.name}
            </span>
            <Combobox
              aria-label={dimension.name}
              className="w-full"
              value={selectedValue ?? ""}
              options={options}
              placeholder={t`Unassigned`}
              isReadOnly={disabled || readOnly}
              onChange={(valueId) => {
                if (valueId === selectedValue || (!valueId && !selectedValue)) {
                  return;
                }
                const next = assignments.filter(
                  (assignment) => assignment.dimensionId !== dimension.id
                );
                onChange(
                  valueId
                    ? [...next, { dimensionId: dimension.id, valueId }]
                    : next
                );
              }}
            />
          </div>
        );
      })}
    </VStack>
  );
}
