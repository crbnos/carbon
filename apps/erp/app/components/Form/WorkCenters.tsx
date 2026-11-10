// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { CreatableMultiSelectProps } from "@carbon/form";
import { CreatableMultiSelect } from "@carbon/form";
import { useLoaderQuery } from "@carbon/query";
import { useMemo, useRef } from "react";
import { useDrawerItem, useUser } from "~/hooks";
import type { getWorkCentersList } from "~/modules/resources/resources.service";
import WorkCenterForm from "~/modules/resources/ui/WorkCenters/WorkCenterForm";
import { path } from "~/utils/path";
import { useEmptyState } from "./emptyStates";

type WorkCenterSelectProps = Omit<CreatableMultiSelectProps, "options"> & {
  processId?: string;
};

const WorkCenters = (props: WorkCenterSelectProps) => {
  const create = useDrawerItem<string>();
  const { defaults } = useUser();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useWorkCenters();

  const emptyMessage = useEmptyState("workCenter", {
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
        <WorkCenterForm
          key={create.key}
          open={create.isOpen}
          type="modal"
          onClose={() => {
            create.close();
            create.afterClose(() => triggerRef.current?.click());
          }}
          showProcesses={false}
          initialValues={{
            name: create.item,
            description: "",
            overheadRate: 0,
            laborRate: 0,
            locationId: defaults?.locationId ?? "",
            machineRate: 0,
            processes: props?.processId ? [props.processId] : [],
            shifts: [],
            alwaysOn: false,
            batchCapacity: undefined,
            minimumBatchQuantity: undefined,
            defaultStandardFactor: "Minutes/Piece" as "Total Hours"
          }}
        />
      )}
    </>
  );
};

WorkCenters.displayName = "WorkCenter";

export default WorkCenters;

export const useWorkCenters = () => {
  const workCenterFetcher = useLoaderQuery<
    Awaited<ReturnType<typeof getWorkCentersList>>
  >(path.to.api.workCenters);

  const options = useMemo(
    () =>
      workCenterFetcher.data?.data
        ? workCenterFetcher.data?.data.map((c) => ({
            value: c.id!,
            label: c.name!
          }))
        : [],
    [workCenterFetcher.data]
  );

  return options;
};
