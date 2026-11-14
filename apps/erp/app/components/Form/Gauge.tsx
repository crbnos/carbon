// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useLoaderQuery } from "@carbon/query";
import { getLocalTimeZone, today } from "@internationalized/date";
import { useMemo, useRef } from "react";
import { useDrawerItem, useUser } from "~/hooks";
import type {
  getGaugesList,
  getGaugeTypesList
} from "~/modules/quality/quality.service";
import GaugeForm from "~/modules/quality/ui/Gauge/GaugeForm";
import { path } from "~/utils/path";
import { useEmptyState } from "./emptyStates";

type GaugeSelectProps = Omit<ComboboxProps, "options">;

const Gauge = (props: GaugeSelectProps) => {
  const create = useDrawerItem<string>();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const { options, gaugeTypes } = useGauges();
  const { defaults } = useUser();

  const emptyMessage = useEmptyState("gauge", {
    onCreate: () => create.open("")
  });

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        label={props?.label ?? "Gauge"}
        emptyMessage={emptyMessage}
        onCreateOption={(option) => {
          create.open(option);
        }}
      />
      {create.item !== null && (
        <GaugeForm
          key={create.key}
          open={create.isOpen}
          type="modal"
          onClose={() => {
            create.close();
            create.afterClose(() => triggerRef.current?.click());
          }}
          gaugeTypes={gaugeTypes}
          initialValues={{
            id: undefined,
            gaugeId: undefined,
            manufacturer: "",
            modelNumber: "",
            serialNumber: "",
            description: create.item,
            dateAcquired: today(getLocalTimeZone()).toString(),
            gaugeTypeId: "",

            lastCalibrationDate: "",
            nextCalibrationDate: "",
            locationId: defaults.locationId ?? "",
            storageUnitId: "",
            calibrationIntervalInMonths: 6,
            gaugeRole: "Standard" as const
          }}
        />
      )}
    </>
  );
};

Gauge.displayName = "Gauge";

export default Gauge;

export const useGauges = () => {
  const gaugeFetcher = useLoaderQuery<{
    gauges: Awaited<ReturnType<typeof getGaugesList>>["data"];
    gaugeTypes: Awaited<ReturnType<typeof getGaugeTypesList>>["data"];
  }>(path.to.api.gauges);

  const options = useMemo(
    () =>
      gaugeFetcher.data?.gauges
        ? gaugeFetcher.data?.gauges.map((c) => ({
            value: c.id,
            label: c.name,
            helper: c.description ?? undefined
          }))
        : [],
    [gaugeFetcher.data]
  );

  return { options, gaugeTypes: gaugeFetcher.data?.gaugeTypes ?? [] };
};
