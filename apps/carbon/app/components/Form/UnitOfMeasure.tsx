import { useDisclosure, useMount } from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import { useMemo, useRef, useState } from "react";
import { useRouteData } from "~/hooks";
import type {
  UnitOfMeasureListItem,
  getUnitOfMeasuresList,
} from "~/modules/parts";
import { UnitOfMeasureForm } from "~/modules/parts";
import { path } from "~/utils/path";
import type { ComboboxProps } from "./Combobox";
import CreatableCombobox from "./CreatableCombobox";

type UnitOfMeasureSelectProps = Omit<ComboboxProps, "options">;

const UnitOfMeasure = (props: UnitOfMeasureSelectProps) => {
  const options = useUnitOfMeasure();

  const newUnitOfMeasureModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        label={props?.label ?? "Item Group"}
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
            code: "",
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
      label: c.name,
    }));
  }, [
    hasSharedPartData,
    sharedPartData?.unitOfMeasures,
    uomFetcher.data?.data,
  ]);

  return options;
};
