import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useDisclosure, useMount } from "@carbon/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type { getMaterialTypeList } from "~/modules/items";
import MaterialTypeForm from "~/modules/items/ui/MaterialTypes/MaterialTypeForm";
import { path } from "~/utils/path";
import { useEmptyState } from "./emptyStates";

type MaterialTypeSelectProps = Omit<
  ComboboxProps,
  "options" | "onChange" | "inline"
> & {
  substanceId?: string;
  formId?: string;
  inline?: boolean;
  onChange?: (
    materialType: {
      label: string;
      value: string;
      code: string;
    } | null
  ) => void;
};

const MaterialTypePreview = (
  value: string,
  options: { value: string; label: string | JSX.Element }[]
) => {
  const materialType = options.find((o) => o.value === value);
  if (!materialType) return null;
  return <span>{materialType.label}</span>;
};

const MaterialType = (props: MaterialTypeSelectProps) => {
  const newTypeModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useMaterialTypes(props.substanceId!, props.formId!);

  const onChange = (
    newValue: { label: string | JSX.Element; value: string } | null
  ) => {
    const materialType =
      options.find((materialType) => materialType.value === newValue?.value) ??
      null;

    props.onChange?.(materialType);
  };

  const emptyMessage = useEmptyState("materialType", {
    onCreate: () => newTypeModal.onOpen()
  });

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        emptyMessage={emptyMessage}
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
            code: created
          }}
        />
      )}
    </>
  );
};

export const useMaterialTypes = (substanceId?: string, formId?: string) => {
  const materialTypes =
    useFetcher<Awaited<ReturnType<typeof getMaterialTypeList>>>();

  useMount(() => {
    if (substanceId && formId) {
      materialTypes.load(path.to.api.materialTypes(substanceId, formId));
    }
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (substanceId && formId) {
      materialTypes.load(path.to.api.materialTypes(substanceId, formId));
    }
  }, [substanceId, formId]);

  const options = useMemo(() => {
    return (materialTypes.data?.data ?? []).map((c) => ({
      value: c.id,
      label: c.name,
      helper: c.companyId === null ? "Standard" : undefined,
      code: c.code
    }));
  }, [materialTypes.data?.data]);

  return options;
};

export default MaterialType;
