import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useDisclosure } from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { getShelvesList } from "~/modules/inventory";

import { ShelfForm } from "~/modules/inventory";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";

type ShelfSelectProps = Omit<ComboboxProps, "options" | "onChange"> & {
  locationId?: string;
  onChange?: (shelf: ListItem | null) => void;
};

const Shelf = (props: ShelfSelectProps) => {
  const shelvesFetcher =
    useFetcher<Awaited<ReturnType<typeof getShelvesList>>>();

  const newShelfModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (props?.locationId) {
      shelvesFetcher.load(path.to.api.shelves(props.locationId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.locationId]);

  const options = useMemo(
    () =>
      shelvesFetcher.data?.data?.map((c) => ({
        value: c.id,
        label: c.name,
      })) ?? [],

    [shelvesFetcher.data]
  );

  const onChange = (newValue: { label: string; value: string } | null) => {
    const shelf =
      shelvesFetcher.data?.data?.find(
        (shelf) => shelf.id === newValue?.value
      ) ?? null;

    props.onChange?.(shelf as ListItem | null);
  };

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        label={props?.label ?? "Shelf"}
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
