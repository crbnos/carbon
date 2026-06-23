import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useDisclosure, useMount } from "@carbon/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type {
  getMaterialDimensionList,
  MaterialDimension as MaterialDimensionType
} from "~/modules/items";
import MaterialDimensionForm from "~/modules/items/ui/MaterialDimensions/MaterialDimensionForm";
import { path } from "~/utils/path";
import { useEmptyState } from "./emptyStates";

type MaterialDimensionSelectProps = Omit<
  ComboboxProps,
  "options" | "onChange" | "inline"
> & {
  formId?: string;
  inline?: boolean;
  onChange?: (dimension: MaterialDimensionType | null) => void;
};

const MaterialDimensionPreview = (
  value: string,
  options: { value: string; label: string | JSX.Element }[]
) => {
  const dimension = options.find((o) => o.value === value);
  if (!dimension) return null;
  return <span>{dimension.label}</span>;
};

const MaterialDimension = (props: MaterialDimensionSelectProps) => {
  const materialDimensionsLoader =
    useFetcher<Awaited<ReturnType<typeof getMaterialDimensionList>>>();

  const newDimensionModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  useMount(() => {
    if (props.formId) {
      materialDimensionsLoader.load(
        path.to.api.materialDimensions(props.formId)
      );
    }
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (props.formId) {
      materialDimensionsLoader.load(
        path.to.api.materialDimensions(props.formId)
      );
    }
  }, [props.formId]);

  const options = useMemo(() => {
    return (materialDimensionsLoader.data?.data ?? []).map((c) => ({
      value: c.id,
      label: c.name,
      helper: c.companyId === null ? "Standard" : undefined
    }));
  }, [materialDimensionsLoader.data?.data]);

  const onChange = (
    newValue: { label: string | JSX.Element; value: string } | null
  ) => {
    const dimension =
      materialDimensionsLoader.data?.data?.find(
        (dimension) => dimension.id === newValue?.value
      ) ?? null;

    props.onChange?.(dimension as MaterialDimensionType | null);
  };

  const emptyMessage = useEmptyState(
    "materialDimension",
    props.formId ? { onCreate: () => newDimensionModal.onOpen() } : undefined
  );

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        disabled={props.disabled || !props.formId}
        inline={props?.inline ? MaterialDimensionPreview : undefined}
        isOptional={props?.isOptional ?? true}
        label={props?.label ?? "Dimensions"}
        emptyMessage={emptyMessage}
        onChange={onChange}
        onCreateOption={(option) => {
          newDimensionModal.onOpen();
          setCreated(option);
        }}
      />
      {newDimensionModal.isOpen && (
        <MaterialDimensionForm
          type="modal"
          onClose={() => {
            setCreated("");
            newDimensionModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{ name: created, materialFormId: props.formId! }}
        />
      )}
    </>
  );
};

export default MaterialDimension;
