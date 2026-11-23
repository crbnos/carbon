// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox, useControlField } from "@carbon/form";
import { useLoaderQuery } from "@carbon/query";
import { useMemo, useRef } from "react";
import { useDrawerItem, useRouteData } from "~/hooks";
import type { getUnitOfMeasuresList } from "~/modules/items/items.service";
import { selectableUnitsOfMeasure } from "~/modules/items/items.utils";
import type { UnitOfMeasureListItem } from "~/modules/items/types";
import UnitOfMeasureForm from "~/modules/items/ui/UnitOfMeasure/UnitOfMeasureForm";
import { path } from "~/utils/path";
import { Enumerable } from "../Enumerable";
import { useEmptyState } from "./emptyStates";

type UnitOfMeasureSelectProps = Omit<ComboboxProps, "options" | "inline"> & {
  inline?: boolean;
  isConfigured?: boolean;
  onConfigure?: () => void;
};

const UnitOfMeasurePreview = (
  value: string,
  options: { value: string; label: string | JSX.Element }[]
) => {
  const uom = options.find((o) => o.value === value);
  // @ts-expect-error TS2322 - TODO: fix type
  return <Enumerable value={uom?.label ?? null} />;
};

const UnitOfMeasure = (props: UnitOfMeasureSelectProps) => {
  const units = useUnitOfMeasure();
  const [fieldValue] = useControlField<string | undefined>(props.name);
  const selected = props.value ?? fieldValue;
  const options = useMemo(
    () => selectableUnitsOfMeasure(units, selected),
    [units, selected]
  );

  const create = useDrawerItem<string>();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const emptyMessage = useEmptyState("unitOfMeasure", {
    onCreate: () => create.open("")
  });

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        inline={props.inline ? UnitOfMeasurePreview : undefined}
        label={props?.label ?? "Unit of Measure"}
        emptyMessage={emptyMessage}
        onCreateOption={(option) => {
          create.open(option);
        }}
      />
      {create.item !== null && (
        <UnitOfMeasureForm
          key={create.key}
          open={create.isOpen}
          type="modal"
          onClose={() => {
            create.close();
            create.afterClose(() => triggerRef.current?.click());
          }}
          initialValues={{
            name: create.item,
            code: "",
            active: true
          }}
        />
      )}
    </>
  );
};

UnitOfMeasure.displayName = "UnitOfMeasure";

export default UnitOfMeasure;

export const useUnitOfMeasure = () => {
  const sharedPartData = useRouteData<{
    unitOfMeasures: UnitOfMeasureListItem[];
  }>(path.to.partRoot);

  const hasSharedPartData = sharedPartData?.unitOfMeasures?.length;

  const uomFetcher = useLoaderQuery<
    Awaited<ReturnType<typeof getUnitOfMeasuresList>>
  >(!hasSharedPartData ? path.to.api.unitOfMeasures : null);

  const options = useMemo(() => {
    const dataSource =
      (hasSharedPartData
        ? sharedPartData?.unitOfMeasures
        : uomFetcher.data?.data) ?? [];

    return dataSource.map((c) => ({
      value: c.code,
      label: c.name,
      active: c.active
    }));
  }, [
    hasSharedPartData,
    sharedPartData?.unitOfMeasures,
    uomFetcher.data?.data
  ]);

  return options;
};
