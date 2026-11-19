// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useLoaderQuery } from "@carbon/query";
import { useLingui } from "@lingui/react/macro";
import { useMemo, useRef } from "react";
import { useDrawerItem } from "~/hooks";
import type { getMaterialDimensionList } from "~/modules/items/items.service";
import type { MaterialDimension as MaterialDimensionType } from "~/modules/items/types";
import MaterialDimensionForm from "~/modules/items/ui/MaterialDimensions/MaterialDimensionForm";
import { path } from "~/utils/path";
import { useEmptyState } from "./emptyStates";

type MaterialDimensionSelectProps = Omit<
  ComboboxProps,
  "options" | "onChange" | "inline"
> & {
  formId?: string;
  inline?: boolean;
  onChange?: (dimension: MaterialDimensionType | null) => void;
};

const MaterialDimensionPreview = (
  value: string,
  options: { value: string; label: string | JSX.Element }[]
) => {
  const dimension = options.find((o) => o.value === value);
  if (!dimension) return null;
  return <span>{dimension.label}</span>;
};

const MaterialDimension = (props: MaterialDimensionSelectProps) => {
  const { t } = useLingui();
  const materialDimensionsLoader = useLoaderQuery<
    Awaited<ReturnType<typeof getMaterialDimensionList>>
  >(props.formId ? path.to.api.materialDimensions(props.formId) : null);

  const create = useDrawerItem<string>();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useMemo(() => {
    return (materialDimensionsLoader.data?.data ?? []).map((c) => ({
      value: c.id,
      label: c.name,
      helper: c.companyId === null ? "Standard" : "Custom"
    }));
  }, [materialDimensionsLoader.data?.data]);

  const onChange = (
    newValue: { label: string | JSX.Element; value: string } | null
  ) => {
    const dimension =
      materialDimensionsLoader.data?.data?.find(
        (dimension) => dimension.id === newValue?.value
      ) ?? null;

    props.onChange?.(dimension as MaterialDimensionType | null);
  };

  const emptyMessage = useEmptyState(
    "materialDimension",
    props.formId ? { onCreate: () => create.open("") } : undefined
  );

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        disabled={props.disabled || !props.formId}
        helperText={
          props.helperText ??
          (!props.inline && !props.formId
            ? t`Select a shape first to see available options`
            : undefined)
        }
        inline={props?.inline ? MaterialDimensionPreview : undefined}
        isOptional={props?.isOptional ?? true}
        label={props?.label ?? "Dimensions"}
        emptyMessage={emptyMessage}
        onChange={onChange}
        onCreateOption={(option) => {
          create.open(option);
        }}
      />
      {create.item !== null && (
        <MaterialDimensionForm
          key={create.key}
          open={create.isOpen}
          type="modal"
          onClose={() => {
            create.close();
            create.afterClose(() => triggerRef.current?.click());
          }}
          initialValues={{ name: create.item, materialFormId: props.formId! }}
        />
      )}
    </>
  );
};

export default MaterialDimension;
