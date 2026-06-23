import type { CreatableComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useDisclosure, useMount } from "@carbon/react";
import { useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type { getFixedAssetClassesList } from "~/modules/accounting";
import AssetClassForm from "~/modules/accounting/ui/FixedAssets/AssetClassForm";
import type { loader as newAssetClassLoader } from "~/routes/x+/accounting+/asset-classes.new";
import { path } from "~/utils/path";
import { Enumerable } from "../Enumerable";
import { useEmptyState } from "./emptyStates";

type AssetClassSelectProps = Omit<
  CreatableComboboxProps,
  "options" | "inline"
> & {
  inline?: boolean;
};

const AssetClassPreview = (
  value: string,
  options: { value: string; label: string | JSX.Element }[]
) => {
  const assetClass = options.find((o) => o.value === value);
  // @ts-expect-error TS2322 - TODO: fix type
  return <Enumerable value={assetClass?.label ?? null} />;
};

const AssetClass = ({ inline = false, ...props }: AssetClassSelectProps) => {
  const newAssetClassModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const defaultsFetcher = useFetcher<typeof newAssetClassLoader>();

  const { options } = useAssetClasses();

  const defaults = defaultsFetcher.data?.defaults;
  const taxDepreciationEnabled =
    defaultsFetcher.data?.taxDepreciationEnabled ?? false;

  const emptyMessage = useEmptyState("assetClass", {
    onCreate: () => {
      defaultsFetcher.load(path.to.newAssetClass);
      newAssetClassModal.onOpen();
    }
  });

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options.map((o) => ({
          value: o.value,
          label: <Enumerable value={o.label} />
        }))}
        emptyMessage={emptyMessage}
        {...props}
        label={props?.label ?? "Asset Class"}
        inline={inline ? AssetClassPreview : undefined}
        onCreateOption={(option) => {
          defaultsFetcher.load(path.to.newAssetClass);
          newAssetClassModal.onOpen();
          setCreated(option);
        }}
      />
      {newAssetClassModal.isOpen && (
        <AssetClassForm
          type="modal"
          onClose={() => {
            setCreated("");
            newAssetClassModal.onClose();
            triggerRef.current?.click();
          }}
          taxDepreciationEnabled={taxDepreciationEnabled}
          initialValues={{
            name: created,
            description: "",
            depreciationMethod: "Straight Line" as const,
            usefulLifeMonths: 60,
            residualValuePercent: 0,
            assetAccountId: defaults?.assetAquisitionCostAccount ?? "",
            accumulatedDepreciationAccountId:
              defaults?.accumulatedDepreciationAccount ?? "",
            depreciationExpenseAccountId:
              defaults?.assetDepreciationExpenseAccount ?? "",
            writeOffAccountId: defaults?.assetGainsAndLossesAccount ?? "",
            writeDownAccountId: defaults?.assetGainsAndLossesAccount ?? "",
            disposalAccountId: defaults?.assetGainsAndLossesAccount ?? ""
          }}
        />
      )}
    </>
  );
};

AssetClass.displayName = "AssetClass";

export default AssetClass;

export const useAssetClasses = () => {
  const assetClassFetcher =
    useFetcher<Awaited<ReturnType<typeof getFixedAssetClassesList>>>();

  useMount(() => {
    assetClassFetcher.load(path.to.api.assetClasses);
  });

  const assetClasses = useMemo(
    () => assetClassFetcher.data?.data ?? [],
    [assetClassFetcher.data]
  );

  const options = useMemo(
    () =>
      assetClasses.map((c) => ({
        value: c.id,
        label: c.name
      })),
    [assetClasses]
  );

  return { options, assetClasses };
};
