import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useDisclosure, useMount } from "@carbon/react";
import { useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { useRouteData } from "~/hooks";
import type {
  getUnitOfMeasuresList,
  UnitOfMeasureListItem
} from "~/modules/items";
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
  const options = useUnitOfMeasure();

  const newUnitOfMeasureModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const emptyMessage = useEmptyState("unitOfMeasure", {
    onCreate: () => newUnitOfMeasureModal.onOpen()
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
          newUnitOfMeasureModal.onOpen();
          setCreated(option);
        }}
      />
      {newUnitOfMeasureModal.isOpen && (
        <UnitOfMeasureForm
          type="modal"
          onClose={() => {
            setCreated("");
            newUnitOfMeasureModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{
            name: created,
            code: ""
          }}
        />
      )}
    </>
  );
};

UnitOfMeasure.displayName = "UnitOfMeasure";

export default UnitOfMeasure;

export const useUnitOfMeasure = () => {
  const uomFetcher =
    useFetcher<Awaited<ReturnType<typeof getUnitOfMeasuresList>>>();

  const sharedPartData = useRouteData<{
    unitOfMeasures: UnitOfMeasureListItem[];
  }>(path.to.partRoot);

  const hasSharedPartData = sharedPartData?.unitOfMeasures?.length;

  useMount(() => {
    if (!hasSharedPartData) uomFetcher.load(path.to.api.unitOfMeasures);
  });

  const options = useMemo(() => {
    const dataSource =
      (hasSharedPartData
        ? sharedPartData?.unitOfMeasures
        : uomFetcher.data?.data) ?? [];

    return dataSource.map((c) => ({
      value: c.code,
      label: c.name
    }));
  }, [
    hasSharedPartData,
    sharedPartData?.unitOfMeasures,
    uomFetcher.data?.data
  ]);

  return options;
};
