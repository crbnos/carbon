import type { CreatableMultiSelectProps } from "@carbon/form";
import { CreatableMultiSelect } from "@carbon/form";
import { useDisclosure, useMount } from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import { useMemo, useRef, useState } from "react";
import { useUser } from "~/hooks";
import type { getWorkCentersList } from "~/modules/resources";
import { WorkCenterForm } from "~/modules/resources";
import { path } from "~/utils/path";

type WorkCenterSelectProps = Omit<CreatableMultiSelectProps, "options"> & {
  processId?: string;
};

const WorkCenters = (props: WorkCenterSelectProps) => {
  const newWorkCenterModal = useDisclosure();
  const { defaults } = useUser();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useWorkCenters();

  return (
    <>
      <CreatableMultiSelect
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
          showProcesses={false}
          initialValues={{
            name: created,
            description: "",
            overheadRate: 0,
            laborRate: 0,
            locationId: defaults?.locationId ?? "",
            machineRate: 0,
            processes: props?.processId ? [props.processId] : [],
            defaultStandardFactor: "Minutes/Piece" as "Total Hours",
          }}
        />
      )}
    </>
  );
};

WorkCenters.displayName = "WorkCenter";

export default WorkCenters;

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
            value: c.id!,
            label: c.name!,
          }))
        : [],
    [workCenterFetcher.data]
  );

  return options;
};
