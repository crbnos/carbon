import type { CreatableMultiSelectProps } from "@carbon/form";
import { CreatableMultiSelect } from "@carbon/form";
import { useDisclosure, useMount } from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import { useMemo, useRef, useState } from "react";
import type { getProcessesList } from "~/modules/resources";
import { ProcessForm } from "~/modules/resources";
import { path } from "~/utils/path";

type ProcessSelectProps = Omit<CreatableMultiSelectProps, "options">;

const Processes = (props: ProcessSelectProps) => {
  const newProcessModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useProcesses();

  return (
    <>
      <CreatableMultiSelect
        ref={triggerRef}
        options={options}
        {...props}
        label={props?.label ?? "Work Center"}
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
            label: c.name,
          }))
        : [],
    [fetcher.data]
  );

  return options;
};
