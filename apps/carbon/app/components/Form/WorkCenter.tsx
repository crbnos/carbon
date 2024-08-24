import { useDisclosure, useMount } from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import { useMemo, useRef, useState } from "react";
import { useUser } from "~/hooks";
import type { getWorkCentersList } from "~/modules/resources";
import { WorkCenterForm } from "~/modules/resources";
import { path } from "~/utils/path";
import type { ComboboxProps } from "./Combobox";
import CreatableCombobox from "./CreatableCombobox";

type WorkCenterSelectProps = Omit<ComboboxProps, "options"> & {
  processId?: string;
  locationId?: string;
};

const WorkCenter = (props: WorkCenterSelectProps) => {
  const newWorkCenterModal = useDisclosure();
  const { defaults } = useUser();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useWorkCenters({
    processId: props?.processId,
    locationId: props?.locationId,
  });

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
            overheadRate: 0,
            laborRate: 0,
            locationId: props?.locationId ?? defaults?.locationId ?? "",
            processes: props?.processId ? [props.processId] : [],
            defaultStandardFactor: "Minutes/Piece" as "Total Hours",
          }}
        />
      )}
    </>
  );
};

WorkCenter.displayName = "WorkCenter";

export default WorkCenter;

export const useWorkCenters = (args: {
  processId?: string;
  locationId?: string;
}) => {
  const { processId, locationId } = args;
  const workCenterFetcher =
    useFetcher<Awaited<ReturnType<typeof getWorkCentersList>>>();

  useMount(() => {
    workCenterFetcher.load(path.to.api.workCenters);
  });

  const options = useMemo(
    () =>
      workCenterFetcher.data?.data
        ? workCenterFetcher.data?.data
            .filter((f) => {
              if (processId) {
                // @ts-ignore
                return (f.processes ?? []).map((p) => p.id).includes(processId);
              }

              if (locationId) {
                return f.locationId === locationId;
              }

              return true;
            })
            .map((c) => ({
              value: c.id!,
              label: c.name!,
            }))
        : [],
    [workCenterFetcher.data, processId, locationId]
  );

  return options;
};
