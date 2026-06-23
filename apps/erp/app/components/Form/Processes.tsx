import type { CreatableMultiSelectProps } from "@carbon/form";
import { CreatableMultiSelect } from "@carbon/form";
import { useDisclosure, useMount } from "@carbon/react";
import { useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type { getProcessesList } from "~/modules/resources";
import ProcessForm from "~/modules/resources/ui/Processes/ProcessForm";
import { path } from "~/utils/path";
import { useEmptyState } from "./emptyStates";

type ProcessSelectProps = Omit<CreatableMultiSelectProps, "options">;

const Processes = (props: ProcessSelectProps) => {
  const newProcessModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useProcesses();

  const emptyMessage = useEmptyState("process", {
    onCreate: () => newProcessModal.onOpen()
  });

  return (
    <>
      <CreatableMultiSelect
        ref={triggerRef}
        options={options}
        {...props}
        label={props?.label ?? "Work Center"}
        emptyMessage={emptyMessage}
        onCreateOption={(option) => {
          newProcessModal.onOpen();
          setCreated(option);
        }}
      />
      {newProcessModal.isOpen && (
        <ProcessForm
          type="modal"
          onClose={() => {
            setCreated("");
            newProcessModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{
            name: created,
            defaultStandardFactor: "Minutes/Piece",
            processType: "Inside",
            workCenters: [],
            completeAllOnScan: false
          }}
        />
      )}
    </>
  );
};

Processes.displayName = "Process";

export default Processes;

export const useProcesses = () => {
  const fetcher = useFetcher<Awaited<ReturnType<typeof getProcessesList>>>();

  useMount(() => {
    fetcher.load(path.to.api.processes);
  });

  const options = useMemo(
    () =>
      fetcher.data?.data
        ? fetcher.data?.data.map((c) => ({
            value: c.id,
            label: c.name
          }))
        : [],
    [fetcher.data]
  );

  return options;
};
