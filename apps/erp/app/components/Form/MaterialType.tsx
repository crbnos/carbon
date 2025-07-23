import { useFetcher } from "@remix-run/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  MaterialType as MaterialTypeType,
  getMaterialTypeList,
} from "~/modules/items";
import { path } from "~/utils/path";

import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useDisclosure, useMount } from "@carbon/react";
import MaterialTypeForm from "~/modules/items/ui/MaterialTypes/MaterialTypeForm";

type MaterialTypeSelectProps = Omit<
  ComboboxProps,
  "options" | "onChange" | "inline"
> & {
  substanceId?: string;
  formId?: string;
  inline?: boolean;
  onChange?: (materialType: MaterialTypeType | null) => void;
};

const MaterialTypePreview = (
  value: string,
  options: { value: string; label: string }[]
) => {
  const materialType = options.find((o) => o.value === value);
  if (!materialType) return null;
  return <span>{materialType.label}</span>;
};

const MaterialType = (props: MaterialTypeSelectProps) => {
  const materialTypesLoader =
    useFetcher<Awaited<ReturnType<typeof getMaterialTypeList>>>();

  const newTypeModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  useMount(() => {
    if (props.substanceId && props.formId) {
      materialTypesLoader.load(
        path.to.api.materialTypes(props.substanceId, props.formId)
      );
    }
  });

  useEffect(() => {
    if (props.substanceId && props.formId) {
      materialTypesLoader.load(
        path.to.api.materialTypes(props.substanceId, props.formId)
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.substanceId, props.formId]);

  const options = useMemo(() => {
    return (materialTypesLoader.data?.data ?? []).map((c) => ({
      value: c.id,
      label: c.name,
      helper: c.companyId === null ? "Standard" : undefined,
    }));
  }, [materialTypesLoader.data?.data]);

  const onChange = (newValue: { label: string; value: string } | null) => {
    const materialType =
      materialTypesLoader.data?.data?.find(
        (materialType) => materialType.id === newValue?.value
      ) ?? null;

    props.onChange?.(materialType as MaterialTypeType | null);
  };

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        disabled={props.disabled || !props.substanceId || !props.formId}
        inline={props?.inline ? MaterialTypePreview : undefined}
        isOptional={props?.isOptional ?? true}
        label={props?.label ?? "Type"}
        onChange={onChange}
        onCreateOption={(option) => {
          newTypeModal.onOpen();
          setCreated(option);
        }}
      />
      {newTypeModal.isOpen && (
        <MaterialTypeForm
          type="modal"
          onClose={() => {
            setCreated("");
            newTypeModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{
            name: created,
            materialSubstanceId: props.substanceId!,
            materialFormId: props.formId!,
          }}
        />
      )}
    </>
  );
};

export default MaterialType;