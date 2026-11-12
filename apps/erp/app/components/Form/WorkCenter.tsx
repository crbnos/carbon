// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useLoaderQuery } from "@carbon/query";
import { useMemo, useRef } from "react";
import { Enumerable } from "~/components/Enumerable";
import { useDrawerItem, useUser } from "~/hooks";
import type { getWorkCentersList } from "~/modules/resources/resources.service";
import WorkCenterForm from "~/modules/resources/ui/WorkCenters/WorkCenterForm";
import { path } from "~/utils/path";
import { useEmptyState } from "./emptyStates";

type WorkCenterSelectProps = Omit<ComboboxProps, "options" | "inline"> & {
  autoSelectSingleOption?: boolean;
  processId?: string;
  locationId?: string;
  isConfigured?: boolean;
  onConfigure?: () => void;
  inline?: boolean;
};

const WorkCenterPreview = (
  value: string,
  options: { value: string; label: string | JSX.Element }[]
) => {
  const workCenter = options.find((o) => o.value === value);
  return workCenter?.label ?? null;
};

const WorkCenter = (props: WorkCenterSelectProps) => {
  const create = useDrawerItem<string>();
  const { defaults } = useUser();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const { options, workCenterFetcher } = useWorkCenters({
    processId: props?.processId,
    locationId: props?.locationId
  });

  const emptyMessage = useEmptyState("workCenter", {
    onCreate: () => create.open("")
  });

  return (
    <>
      <CreatableCombobox
        autoSelectSingleOption={
          props?.autoSelectSingleOption &&
          Boolean(props?.processId) &&
          options.length === 1 &&
          !workCenterFetcher.isFetching
        }
        ref={triggerRef}
        options={options.map((o) => ({
          value: o.value,
          label: <Enumerable value={o.label} />
        }))}
        emptyMessage={emptyMessage}
        {...props}
        inline={props.inline ? WorkCenterPreview : undefined}
        label={props?.label ?? "Work Center"}
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
          initialValues={{
            name: create.item,
            description: "",
            overheadRate: 0,
            laborRate: 0,
            locationId: props?.locationId ?? defaults?.locationId ?? "",
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

WorkCenter.displayName = "WorkCenter";

export default WorkCenter;

export const useWorkCenters = (args: {
  processId?: string;
  locationId?: string;
}) => {
  const { processId, locationId } = args;
  const workCenterFetcher = useLoaderQuery<
    Awaited<ReturnType<typeof getWorkCentersList>>
  >(path.to.api.workCenters);

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
              label: c.name!
            }))
        : [],
    [workCenterFetcher.data, processId, locationId]
  );

  return { options, workCenterFetcher };
};
