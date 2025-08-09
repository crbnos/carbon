import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useDisclosure, useMount } from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import { useMemo, useRef, useState } from "react";
import { useUser } from "~/hooks";
import type { getWorkCentersList } from "~/modules/resources";
import WorkCenterForm from "~/modules/resources/ui/WorkCenters/WorkCenterForm";
import { path } from "~/utils/path";

type WorkCenterSelectProps = Omit<ComboboxProps, "options"> & {
  autoSelectSingleOption?: boolean;
  processId?: string;
  locationId?: string;
  isConfigured?: boolean;
  onConfigure?: () => void;
};

const WorkCenter = (props: WorkCenterSelectProps) => {
  const newWorkCenterModal = useDisclosure();
  const { defaults } = useUser();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const { options, workCenterFetcher } = useWorkCenters({
    processId: props?.processId,
    locationId: props?.locationId,
  });

  return (
    <>
      <CreatableCombobox
        autoSelectSingleOption={
          props?.autoSelectSingleOption &&
          Boolean(props?.processId) &&
          options.length === 1 &&
          workCenterFetcher.state === "idle"
        }
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
            machineRate: 0,
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

  console.log({ args, data: workCenterFetcher.data });

  const options = useMemo(
    () =>
      workCenterFetcher.data?.data
        ? workCenterFetcher.data?.data
            .filter((f) => {
              if (processId && locationId) {
                return (
                  (f.processes ?? []).includes(processId) &&
                  f.locationId === locationId
                );
              }

              if (processId) {
                return (f.processes ?? []).includes(processId);
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

  return { options, workCenterFetcher };
};
