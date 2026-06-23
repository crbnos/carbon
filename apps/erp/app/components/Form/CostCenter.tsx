import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useDisclosure, useMount } from "@carbon/react";
import { useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { useUser } from "~/hooks/useUser";
import type { getCostCentersList } from "~/modules/accounting";
import CostCenterForm from "~/modules/accounting/ui/CostCenters/CostCenterForm";
import { path } from "~/utils/path";
import { useEmptyState } from "./emptyStates";

type CostCenterSelectProps = Omit<ComboboxProps, "options">;

const CostCenter = (props: CostCenterSelectProps) => {
  const { id: userId } = useUser();
  const newCostCenterModal = useDisclosure();
  const [created, setCreated] = useState<string>("");

  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useCostCenters();

  const emptyMessage = useEmptyState("costCenter", {
    onCreate: () => newCostCenterModal.onOpen()
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
          newCostCenterModal.onOpen();
          setCreated(option);
        }}
      />
      {newCostCenterModal.isOpen && (
        <CostCenterForm
          type="modal"
          onClose={() => {
            setCreated("");
            newCostCenterModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{
            name: created,
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
  const costCenterFetcher =
    useFetcher<Awaited<ReturnType<typeof getCostCentersList>>>();

  useMount(() => {
    costCenterFetcher.load(path.to.api.costCenters);
  });

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
