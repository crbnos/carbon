import { useFetcher } from "@remix-run/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  MaterialDimension as MaterialDimensionType,
  getMaterialDimensionList,
} from "~/modules/items";
import { path } from "~/utils/path";

import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useDisclosure, useMount } from "@carbon/react";
import MaterialDimensionForm from "~/modules/items/ui/MaterialDimensions/MaterialDimensionForm";

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
  options: { value: string; label: string }[]
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

  useEffect(() => {
    if (props.formId) {
      materialDimensionsLoader.load(
        path.to.api.materialDimensions(props.formId)
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.formId]);

  const options = useMemo(() => {
    return (materialDimensionsLoader.data?.data ?? []).map((c) => ({
      value: c.id,
      label: c.name,
      helper: c.companyId === null ? "Standard" : undefined,
    }));
  }, [materialDimensionsLoader.data?.data]);

  const onChange = (newValue: { label: string; value: string } | null) => {
    const dimension =
      materialDimensionsLoader.data?.data?.find(
        (dimension) => dimension.id === newValue?.value
      ) ?? null;

    props.onChange?.(dimension as MaterialDimensionType | null);
  };

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
