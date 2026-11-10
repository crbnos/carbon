// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useLoaderQuery } from "@carbon/query";
import { useMemo, useRef } from "react";
import { useDrawerItem } from "~/hooks";
import { useUser } from "~/hooks/useUser";
import type { getCostCentersList } from "~/modules/accounting/accounting.service";
import CostCenterForm from "~/modules/accounting/ui/CostCenters/CostCenterForm";
import { path } from "~/utils/path";
import { useEmptyState } from "./emptyStates";

type CostCenterSelectProps = Omit<ComboboxProps, "options">;

const CostCenter = (props: CostCenterSelectProps) => {
  const { id: userId } = useUser();
  const create = useDrawerItem<string>();

  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useCostCenters();

  const emptyMessage = useEmptyState("costCenter", {
    onCreate: () => create.open("")
  });

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        emptyMessage={emptyMessage}
        {...props}
        label={props?.label ?? "Cost Center"}
        onCreateOption={(option) => {
          create.open(option);
        }}
      />
      {create.item !== null && (
        <CostCenterForm
          key={create.key}
          open={create.isOpen}
          type="modal"
          onClose={() => {
            create.close();
            create.afterClose(() => triggerRef.current?.click());
          }}
          initialValues={{
            name: create.item,
            ownerId: userId
          }}
        />
      )}
    </>
  );
};

CostCenter.displayName = "CostCenter";

export default CostCenter;

export const useCostCenters = () => {
  const costCenterFetcher = useLoaderQuery<
    Awaited<ReturnType<typeof getCostCentersList>>
  >(path.to.api.costCenters);

  const options = useMemo(
    () =>
      costCenterFetcher.data?.data
        ? costCenterFetcher.data?.data.map((c) => ({
            value: c.id,
            label: c.name
          }))
        : [],
    [costCenterFetcher.data]
  );

  return options;
};
