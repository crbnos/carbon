// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ComboboxProps } from "@carbon/form";
import { Combobox, CreatableCombobox } from "@carbon/form";
import { useLoaderQuery } from "@carbon/query";
import { useMemo, useRef } from "react";
import { useDrawerItem, usePermissions } from "~/hooks";
import type { getMaterialFormsList } from "~/modules/items/items.service";
import { MaterialShapeForm } from "~/modules/items/ui/MaterialShapes";
import { path } from "~/utils/path";
import { Enumerable } from "../Enumerable";
import { useEmptyState } from "./emptyStates";

type ShapeSelectProps = Omit<ComboboxProps, "options" | "inline"> & {
  inline?: boolean;
};

const ShapePreview = (
  value: string,
  options: { value: string; label: string | React.ReactNode }[]
) => {
  const shape = options.find((o) => o.value === value);
  // @ts-expect-error
  return <Enumerable value={shape?.label ?? null} />;
};

const Shape = (props: ShapeSelectProps) => {
  const options = useShape();
  const permissions = usePermissions();

  const create = useDrawerItem<string>();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const emptyMessage = useEmptyState("materialShape", {
    onCreate: () => create.open("")
  });

  return permissions.can("create", "parts") ? (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        inline={props.inline ? ShapePreview : undefined}
        label={props?.label ?? "Shape"}
        emptyMessage={emptyMessage}
        onCreateOption={(option) => {
          create.open(option);
        }}
      />
      {create.item !== null && (
        <MaterialShapeForm
          key={create.key}
          open={create.isOpen}
          type="modal"
          onClose={() => {
            create.close();
            create.afterClose(() => triggerRef.current?.click());
          }}
          initialValues={{
            name: create.item,
            code: create.item.slice(0, 3).toUpperCase()
          }}
        />
      )}
    </>
  ) : (
    <Combobox
      options={options}
      {...props}
      inline={props.inline ? ShapePreview : undefined}
      label={props?.label ?? "Shape"}
    />
  );
};

Shape.displayName = "Shape";

export default Shape;

export const useShape = () => {
  const materialFormsLoader = useLoaderQuery<
    Awaited<ReturnType<typeof getMaterialFormsList>>
  >(path.to.api.materialForms);

  const options = useMemo(() => {
    return (materialFormsLoader.data?.data ?? []).map((c) => ({
      value: c.id,
      label: c.name,
      helper: c.companyId === null ? "Standard" : "Custom",
      code: c.code
    }));
  }, [materialFormsLoader.data?.data]);

  return options;
};
