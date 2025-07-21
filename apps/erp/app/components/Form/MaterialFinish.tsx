import { useFetcher } from "@remix-run/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  MaterialFinish as MaterialFinishType,
  getMaterialFinishList,
} from "~/modules/items";
import { path } from "~/utils/path";

import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useDisclosure, useMount } from "@carbon/react";
import MaterialFinishForm from "~/modules/items/ui/MaterialFinishes/MaterialFinishForm";

type MaterialFinishSelectProps = Omit<
  ComboboxProps,
  "options" | "onChange" | "inline"
> & {
  substanceId?: string;
  inline?: boolean;
  onChange?: (finish: MaterialFinishType | null) => void;
};

const MaterialFinishPreview = (
  value: string,
  options: { value: string; label: string }[]
) => {
  const finish = options.find((o) => o.value === value);
  if (!finish) return null;
  return <span>{finish.label}</span>;
};

const MaterialFinish = (props: MaterialFinishSelectProps) => {
  const materialFinishesLoader =
    useFetcher<Awaited<ReturnType<typeof getMaterialFinishList>>>();

  const newFinishModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  useMount(() => {
    if (props.substanceId) {
      materialFinishesLoader.load(
        path.to.api.materialFinishes(props.substanceId)
      );
    }
  });

  useEffect(() => {
    if (props.substanceId) {
      materialFinishesLoader.load(
        path.to.api.materialFinishes(props.substanceId)
      );
    }
  }, [props.substanceId]);

  const options = useMemo(() => {
    return (materialFinishesLoader.data?.data ?? []).map((c) => ({
      value: c.id,
      label: c.name,
      helper: c.companyId === null ? "Standard" : undefined,
    }));
  }, [materialFinishesLoader.data?.data]);

  const onChange = (newValue: { label: string; value: string } | null) => {
    const finish =
      materialFinishesLoader.data?.data?.find(
        (finish) => finish.id === newValue?.value
      ) ?? null;

    props.onChange?.(finish as MaterialFinishType | null);
  };

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        disabled={props.disabled || !props.substanceId}
        inline={props?.inline ? MaterialFinishPreview : undefined}
        label={props?.label ?? "Finish"}
        onChange={onChange}
        onCreateOption={(option) => {
          newFinishModal.onOpen();
          setCreated(option);
        }}
      />
      {newFinishModal.isOpen && (
        <MaterialFinishForm
          type="modal"
          onClose={() => {
            setCreated("");
            newFinishModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{
            name: created,
            materialSubstanceId: props.substanceId!,
          }}
        />
      )}
    </>
  );
};

export default MaterialFinish;
