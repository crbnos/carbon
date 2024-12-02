import type { CreatableComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useDisclosure, useMount } from "@carbon/react";
import { getLocalTimeZone } from "@internationalized/date";
import { useFetcher } from "@remix-run/react";
import { useMemo, useRef, useState } from "react";
import { useUser } from "~/hooks";
import type { getLocationsList } from "~/modules/resources";
import { LocationForm } from "~/modules/resources";
import { path } from "~/utils/path";
import { Enumerable } from "../Enumerable";

type LocationSelectProps = Omit<
  CreatableComboboxProps,
  "options" | "inline"
> & {
  inline?: boolean;
};

const LocationPreview = (
  value: string,
  options: { value: string; label: string }[]
) => {
  const location = options.find((o) => o.value === value);
  return <Enumerable value={location?.label ?? null} />;
};

const Location = ({ inline = false, ...props }: LocationSelectProps) => {
  const newLocationModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useLocations();

  const { company } = useUser();

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        label={props?.label ?? "Location"}
        inline={inline ? LocationPreview : undefined}
        onCreateOption={(option) => {
          newLocationModal.onOpen();
          setCreated(option);
        }}
      />
      {newLocationModal.isOpen && (
        <LocationForm
          type="modal"
          onClose={() => {
            setCreated("");
            newLocationModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{
            name: created,
            timezone: getLocalTimeZone(),
            addressLine1: "",
            addressLine2: "",
            city: "",
            stateProvince: "",
            postalCode: "",
            countryCode: company?.countryCode ?? "",
          }}
        />
      )}
    </>
  );
};

Location.displayName = "Location";

export default Location;

export const useLocations = () => {
  const locationFetcher =
    useFetcher<Awaited<ReturnType<typeof getLocationsList>>>();

  useMount(() => {
    locationFetcher.load(path.to.api.locations);
  });

  const options = useMemo(
    () =>
      locationFetcher.data?.data
        ? locationFetcher.data?.data.map((c) => ({
            value: c.id,
            label: c.name,
          }))
        : [],
    [locationFetcher.data]
  );

  return options;
};
