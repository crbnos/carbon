import { useDisclosure, useMount } from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import { useMemo, useRef, useState } from "react";
import type { getWorkCentersList } from "~/modules/resources";
import { WorkCenterForm } from "~/modules/resources";
import { path } from "~/utils/path";
import type { ComboboxProps } from "./Combobox";
import CreatableCombobox from "./CreatableCombobox";

type WorkCenterSelectProps = Omit<ComboboxProps, "options">;

const WorkCenter = (props: WorkCenterSelectProps) => {
  const newWorkCenterModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useWorkCenters();

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        label={props?.label ?? "Work Center"}
        onCreateOption={(option) => {
          newWorkCenterModal.onOpen();
          setCreated(option);
        }}
      />
      {newWorkCenterModal.isOpen && (
        <WorkCenterForm
          type="modal"
          onClose={() => {
            setCreated("");
            newWorkCenterModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{
            name: created,
            description: "",
            quotingRate: 0,
            laborRate: 0,
            defaultStandardFactor: "Minutes/Piece" as "Total Hours",
          }}
        />
      )}
    </>
  );
};

WorkCenter.displayName = "WorkCenter";

export default WorkCenter;

export const useWorkCenters = () => {
  const workCenterFetcher =
    useFetcher<Awaited<ReturnType<typeof getWorkCentersList>>>();

  useMount(() => {
    workCenterFetcher.load(path.to.api.workCenters);
  });

  const options = useMemo(
    () =>
      workCenterFetcher.data?.data
        ? workCenterFetcher.data?.data.map((c) => ({
            value: c.id,
            label: c.name,
          }))
        : [],
    [workCenterFetcher.data]
  );

  return options;
};
