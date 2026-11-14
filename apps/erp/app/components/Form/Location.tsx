// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { CreatableComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useLoaderQuery } from "@carbon/query";
import { getLocalTimeZone } from "@internationalized/date";
import { useMemo, useRef } from "react";
import { useDrawerItem, useUser } from "~/hooks";
import type { getLocationsList } from "~/modules/resources/resources.service";
import LocationForm from "~/modules/resources/ui/Locations/LocationForm";
import { path } from "~/utils/path";
import { Enumerable } from "../Enumerable";
import { useEmptyState } from "./emptyStates";

type LocationSelectProps = Omit<
  CreatableComboboxProps,
  "options" | "inline"
> & {
  inline?: boolean;
};

const LocationPreview = (
  value: string,
  options: { value: string; label: string | JSX.Element }[]
) => {
  const location = options.find((o) => o.value === value);
  if (!location) return null;
  return location?.label ?? null;
};

const Location = ({ inline = false, ...props }: LocationSelectProps) => {
  const create = useDrawerItem<string>();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useLocations();

  const { company } = useUser();

  const emptyMessage = useEmptyState("location", {
    onCreate: () => create.open("")
  });

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options.map((o) => ({
          value: o.value,
          label: <Enumerable value={o.label} />
        }))}
        emptyMessage={emptyMessage}
        {...props}
        label={props?.label ?? "Location"}
        inline={inline ? LocationPreview : undefined}
        onCreateOption={(option) => {
          create.open(option);
        }}
      />
      {create.item !== null && (
        <LocationForm
          key={create.key}
          open={create.isOpen}
          type="modal"
          onClose={() => {
            create.close();
            create.afterClose(() => triggerRef.current?.click());
          }}
          initialValues={{
            name: create.item,
            timezone: getLocalTimeZone(),
            addressLine1: "",
            addressLine2: "",
            city: "",
            stateProvince: "",
            postalCode: "",
            countryCode: company?.countryCode ?? ""
          }}
        />
      )}
    </>
  );
};

Location.displayName = "Location";

export default Location;

export const useLocations = () => {
  const locationFetcher = useLoaderQuery<
    Awaited<ReturnType<typeof getLocationsList>>
  >(path.to.api.locations);

  const options = useMemo(
    () =>
      locationFetcher.data?.data
        ? locationFetcher.data?.data.map((c) => ({
            value: c.id,
            label: c.name,
            timezone: c.timezone
          }))
        : [],
    [locationFetcher.data]
  );

  return options;
};
