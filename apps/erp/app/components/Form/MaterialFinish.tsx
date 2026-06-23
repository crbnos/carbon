import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useDisclosure, useMount } from "@carbon/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type {
  getMaterialFinishList,
  MaterialFinish as MaterialFinishType
} from "~/modules/items";
import MaterialFinishForm from "~/modules/items/ui/MaterialFinishes/MaterialFinishForm";
import { path } from "~/utils/path";
import { useEmptyState } from "./emptyStates";

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
  options: { value: string; label: string | JSX.Element }[]
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
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
      helper: c.companyId === null ? "Standard" : undefined
    }));
  }, [materialFinishesLoader.data?.data]);

  const onChange = (
    newValue: { label: string | JSX.Element; value: string } | null
  ) => {
    const finish =
      materialFinishesLoader.data?.data?.find(
        (finish) => finish.id === newValue?.value
      ) ?? null;

    props.onChange?.(finish as MaterialFinishType | null);
  };

  const emptyMessage = useEmptyState(
    "materialFinish",
    props.substanceId ? { onCreate: () => newFinishModal.onOpen() } : undefined
  );

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        disabled={props.disabled || !props.substanceId}
        inline={props?.inline ? MaterialFinishPreview : undefined}
        isOptional={props?.isOptional ?? true}
        label={props?.label ?? "Finish"}
        emptyMessage={emptyMessage}
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
            materialSubstanceId: props.substanceId!
          }}
        />
      )}
    </>
  );
};

export default MaterialFinish;
