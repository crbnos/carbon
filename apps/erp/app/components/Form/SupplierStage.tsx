// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useLoaderQuery } from "@carbon/query";
import { asColor } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { useMemo, useRef } from "react";
import { Enumerable } from "~/components/Enumerable";
import { useDrawerItem } from "~/hooks";
import type { getSupplierStagesList } from "~/modules/purchasing/purchasing.service";
import SupplierStageForm from "~/modules/purchasing/ui/SupplierStages/SupplierStageForm";
import { path } from "~/utils/path";
import { useEmptyState } from "./emptyStates";

type SupplierStageSelectProps = Omit<ComboboxProps, "options">;

const SupplierStage = (props: SupplierStageSelectProps) => {
  const { t } = useLingui();
  const create = useDrawerItem<string>();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useSupplierStages();

  const emptyMessage = useEmptyState("supplierStage", {
    onCreate: () => create.open("")
  });

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options.map((o) => ({
          value: o.value,
          label: <Enumerable value={o.label} color={o.color} />
        }))}
        emptyMessage={emptyMessage}
        {...props}
        label={props?.label ?? t`Supplier Stage`}
        onCreateOption={(option) => {
          create.open(option);
        }}
      />
      {create.item !== null && (
        <SupplierStageForm
          key={create.key}
          type="modal"
          open={create.isOpen}
          onClose={() => {
            create.close();
            create.afterClose(() => triggerRef.current?.click());
          }}
          initialValues={{
            name: create.item
          }}
        />
      )}
    </>
  );
};

SupplierStage.displayName = "SupplierStage";

export default SupplierStage;

export const useSupplierStages = () => {
  const supplierStageFetcher = useLoaderQuery<
    Awaited<ReturnType<typeof getSupplierStagesList>>
  >(path.to.api.supplierStages);

  return useMemo(
    () =>
      (supplierStageFetcher.data?.data ?? []).map((stage) => ({
        value: stage.id,
        label: stage.name,
        color: asColor(stage.color)
      })),
    [supplierStageFetcher.data?.data]
  );
};
