// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { CreatableMultiSelectProps } from "@carbon/form";
import { CreatableMultiSelect } from "@carbon/form";
import { useLoaderQuery } from "@carbon/query";
import { useMemo, useRef } from "react";
import { useDrawerItem } from "~/hooks";
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
  const create = useDrawerItem<string>();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useProcesses({ inHouseOnly, keep: saved });

  const emptyMessage = useEmptyState("process", {
    onCreate: () => create.open("")
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
          create.open(option);
        }}
      />
      {create.item !== null && (
        <ProcessForm
          key={create.key}
          open={create.isOpen}
          type="modal"
          onClose={() => {
            create.close();
            create.afterClose(() => triggerRef.current?.click());
          }}
          initialValues={{
            name: create.item,
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
