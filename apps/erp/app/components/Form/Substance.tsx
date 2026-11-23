// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ComboboxProps } from "@carbon/form";
import { Combobox, CreatableCombobox } from "@carbon/form";
import { useLoaderQuery } from "@carbon/query";
import { useMemo, useRef } from "react";
import { useDrawerItem, usePermissions } from "~/hooks";
import type { getMaterialSubstancesList } from "~/modules/items/items.service";
import { MaterialSubstanceForm } from "~/modules/items/ui/MaterialSubstances";
import { path } from "~/utils/path";
import { Enumerable } from "../Enumerable";
import { useEmptyState } from "./emptyStates";

type SubstanceSelectProps = Omit<ComboboxProps, "options" | "inline"> & {
  inline?: boolean;
};

const SubstancePreview = (
  value: string,
  options: { value: string; label: string | React.ReactNode; helper?: string }[]
) => {
  const substance = options.find((o) => o.value === value);
  // @ts-expect-error
  return <Enumerable value={substance?.label ?? null} />;
};

const Substance = (props: SubstanceSelectProps) => {
  const options = useSubstance();
  const permissions = usePermissions();

  const create = useDrawerItem<string>();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const emptyMessage = useEmptyState("materialSubstance", {
    onCreate: () => create.open("")
  });

  return permissions.can("create", "parts") ? (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        inline={props.inline ? SubstancePreview : undefined}
        label={props?.label ?? "Substance"}
        emptyMessage={emptyMessage}
        onCreateOption={(option) => {
          create.open(option);
        }}
      />
      {create.item !== null && (
        <MaterialSubstanceForm
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
      inline={props.inline ? SubstancePreview : undefined}
      label={props?.label ?? "Substance"}
    />
  );
};

Substance.displayName = "Substance";

export default Substance;

export const useSubstance = () => {
  const materialSubstances = useLoaderQuery<
    Awaited<ReturnType<typeof getMaterialSubstancesList>>
  >(path.to.api.materialSubstances);

  const options = useMemo(() => {
    return (materialSubstances.data?.data ?? []).map((c) => ({
      value: c.id,
      label: c.name,
      helper: c.companyId === null ? "Standard" : "Custom",
      code: c.code
    }));
  }, [materialSubstances.data?.data]);

  return options;
};
