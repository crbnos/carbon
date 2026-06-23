import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useDisclosure, useMount } from "@carbon/react";
import { useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type { getProcessesList } from "~/modules/resources";
import ProcessForm from "~/modules/resources/ui/Processes/ProcessForm";
import { path } from "~/utils/path";
import { Enumerable } from "../Enumerable";
import { useEmptyState } from "./emptyStates";

type ProcessSelectProps = Omit<ComboboxProps, "options" | "inline"> & {
  isConfigured?: boolean;
  onConfigure?: () => void;
  inline?: boolean;
  /**
   * Optional override for the option list. When omitted the picker shows
   * every process in the company. Pass a scoped subset (e.g. processes used
   * by an item's recipe) to constrain selection. `undefined` means "still
   * loading" — picker stays empty until data arrives.
   */
  options?: { value: string; label: string }[];
};

const ProcessPreview = (
  value: string,
  options: { value: string; label: string | JSX.Element }[]
) => {
  const process = options.find((o) => o.value === value);
  return process?.label ?? null;
};

const Process = ({
  options: optionsOverride,
  ...props
}: ProcessSelectProps) => {
  const newProcessModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const fetched = useProcesses();
  const sourceOptions = optionsOverride ?? fetched;

  const emptyMessage = useEmptyState("process", {
    onCreate: () => newProcessModal.onOpen()
  });

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={sourceOptions.map((o) => ({
          value: o.value,
          label: <Enumerable value={o.label} />
        }))}
        emptyMessage={emptyMessage}
        {...props}
        inline={props.inline ? ProcessPreview : undefined}
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
            processType: "Inside",
            defaultStandardFactor: "Minutes/Piece",
            completeAllOnScan: false,
            workCenters: []
          }}
        />
      )}
    </>
  );
};

Process.displayName = "Process";

export default Process;

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
