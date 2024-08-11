import { useDisclosure, useMount } from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import { useMemo, useRef, useState } from "react";
import type { getWorkCellTypesList } from "~/modules/resources";
import { WorkCellTypeForm } from "~/modules/resources";
import { path } from "~/utils/path";
import type { ComboboxProps } from "./Combobox";
import CreatableCombobox from "./CreatableCombobox";

type WorkCellTypeSelectProps = Omit<ComboboxProps, "options">;

const WorkCellType = (props: WorkCellTypeSelectProps) => {
  const newWorkCellTypeModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useWorkCellTypes();

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        label={props?.label ?? "WorkCellType"}
        onCreateOption={(option) => {
          newWorkCellTypeModal.onOpen();
          setCreated(option);
        }}
      />
      {newWorkCellTypeModal.isOpen && (
        <WorkCellTypeForm
          type="modal"
          onClose={() => {
            setCreated("");
            newWorkCellTypeModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{
            name: created,
            description: "",
            quotingRate: 0,
            laborRate: 0,
            overheadRate: 0,
            defaultStandardFactor: "Minutes/Piece" as "Total Hours",
          }}
        />
      )}
    </>
  );
};

WorkCellType.displayName = "WorkCellType";

export default WorkCellType;

export const useWorkCellTypes = () => {
  const workCellTypeFetcher =
    useFetcher<Awaited<ReturnType<typeof getWorkCellTypesList>>>();

  useMount(() => {
    workCellTypeFetcher.load(path.to.api.workCellTypes);
  });

  const options = useMemo(
    () =>
      workCellTypeFetcher.data?.data
        ? workCellTypeFetcher.data?.data.map((c) => ({
            value: c.id,
            label: c.name,
          }))
        : [],
    [workCellTypeFetcher.data]
  );

  return options;
};
