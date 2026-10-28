// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { CreatableMultiSelectProps } from "@carbon/form";
import { CreatableMultiSelect } from "@carbon/form";
import { useLoaderQuery } from "@carbon/query";
import { useDisclosure } from "@carbon/react";
import { useMemo, useRef, useState } from "react";
import { batchRuleInitialValues } from "~/modules/resources/resources.models";
import type { getProcessesList } from "~/modules/resources/resources.service";
import ProcessForm from "~/modules/resources/ui/Processes/ProcessForm";
import { path } from "~/utils/path";
import { useEmptyState } from "./emptyStates";

type ProcessSelectProps = Omit<CreatableMultiSelectProps, "options"> & {
  /** Leave out Outside Processing — work a station or person never runs. */
  inHouseOnly?: boolean;
  /** Processes already saved: shown whatever their type, so they can be removed. */
  saved?: string[];
};

const Processes = ({
  inHouseOnly = false,
  saved,
  ...props
}: ProcessSelectProps) => {
  const newProcessModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useProcesses({ inHouseOnly, keep: saved });

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
            processType: "Process",
            workCenters: [],
            completeAllOnScan: false,
            batchable: false,
            batchType: "Sequential" as const,
            requiresAbility: false,
            ...batchRuleInitialValues(null)
          }}
        />
      )}
    </>
  );
};

Processes.displayName = "Process";

export default Processes;

export const useProcesses = ({
  inHouseOnly = false,
  keep
}: {
  inHouseOnly?: boolean;
  /** Ids shown whatever their type. */
  keep?: string[];
} = {}) => {
  const fetcher = useLoaderQuery<Awaited<ReturnType<typeof getProcessesList>>>(
    path.to.api.processes
  );

  const options = useMemo(
    () =>
      (fetcher.data?.data ?? [])
        .filter(
          (process) =>
            !inHouseOnly ||
            process.processType !== "Outside Processing" ||
            keep?.includes(process.id)
        )
        .map((process) => ({
          value: process.id,
          label: process.name
        })),
    [fetcher.data, inHouseOnly, keep]
  );

  return options;
};
