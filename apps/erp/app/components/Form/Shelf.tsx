import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useDisclosure } from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { getShelvesList } from "~/modules/inventory";
import ShelfForm from "~/modules/inventory/ui/Shelves/ShelfForm";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";

type ShelfSelectProps = Omit<
  ComboboxProps,
  "options" | "onChange" | "inline"
> & {
  locationId?: string;
  inline?: boolean;
  onChange?: (shelf: ListItem | null) => void;
};

const ShelfPreview = (
  value: string,
  options: { value: string; label: string }[]
) => {
  const shelf = options.find((o) => o.value === value);
  if (!shelf) return "Inventory";
  return shelf.label;
};

const Shelf = (props: ShelfSelectProps) => {
  const newShelfModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const { options, data } = useShelves(props.locationId);

  const onChange = (newValue: { label: string; value: string } | null) => {
    const shelf =
      data?.data?.find((shelf) => shelf.id === newValue?.value) ?? null;
    props.onChange?.(shelf as ListItem | null);
  };

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        label={props?.label ?? "Shelf"}
        inline={props.inline ? ShelfPreview : undefined}
        onChange={onChange}
        onCreateOption={(option) => {
          newShelfModal.onOpen();
          setCreated(option);
        }}
      />
      {newShelfModal.isOpen && (
        <ShelfForm
          locationId={props.locationId!}
          type="modal"
          onClose={() => {
            setCreated("");
            newShelfModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{ name: created, locationId: props?.locationId ?? "" }}
        />
      )}
    </>
  );
};

export default Shelf;

export function useShelves(locationId?: string) {
  const shelvesFetcher =
    useFetcher<Awaited<ReturnType<typeof getShelvesList>>>();

  useEffect(() => {
    if (locationId) {
      shelvesFetcher.load(path.to.api.shelves(locationId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId]);

  const options = useMemo(
    () =>
      shelvesFetcher.data?.data?.map((c) => ({
        value: c.id,
        label: c.name,
      })) ?? [],
    [shelvesFetcher.data]
  );

  return { options, data: shelvesFetcher.data };
}
