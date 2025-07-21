import { useFetcher } from "@remix-run/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  MaterialGrade as MaterialGradeType,
  getMaterialGradeList,
} from "~/modules/items";
import { path } from "~/utils/path";

import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useDisclosure, useMount } from "@carbon/react";
import MaterialGradeForm from "~/modules/items/ui/MaterialGrades/MaterialGradeForm";

type MaterialGradeSelectProps = Omit<
  ComboboxProps,
  "options" | "onChange" | "inline"
> & {
  substanceId?: string;
  inline?: boolean;
  onChange?: (grade: MaterialGradeType | null) => void;
};

const MaterialGradePreview = (
  value: string,
  options: { value: string; label: string }[]
) => {
  const grade = options.find((o) => o.value === value);
  if (!grade) return null;
  return <span>{grade.label}</span>;
};

const MaterialGrade = (props: MaterialGradeSelectProps) => {
  const materialGradesLoader =
    useFetcher<Awaited<ReturnType<typeof getMaterialGradeList>>>();

  const newGradeModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  useMount(() => {
    if (props.substanceId) {
      materialGradesLoader.load(path.to.api.materialGrades(props.substanceId));
    }
  });

  useEffect(() => {
    if (props.substanceId) {
      materialGradesLoader.load(path.to.api.materialGrades(props.substanceId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.substanceId]);

  const options = useMemo(() => {
    return (materialGradesLoader.data?.data ?? []).map((c) => ({
      value: c.id,
      label: c.name,
      helper: c.companyId === null ? "Standard" : undefined,
    }));
  }, [materialGradesLoader.data?.data]);

  const onChange = (newValue: { label: string; value: string } | null) => {
    const grade =
      materialGradesLoader.data?.data?.find(
        (grade) => grade.id === newValue?.value
      ) ?? null;

    props.onChange?.(grade as MaterialGradeType | null);
  };

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        {...props}
        disabled={props.disabled || !props.substanceId}
        inline={props?.inline ? MaterialGradePreview : undefined}
        isOptional={props?.isOptional ?? true}
        label={props?.label ?? "Grade"}
        onChange={onChange}
        onCreateOption={(option) => {
          newGradeModal.onOpen();
          setCreated(option);
        }}
      />
      {newGradeModal.isOpen && (
        <MaterialGradeForm
          type="modal"
          onClose={() => {
            setCreated("");
            newGradeModal.onClose();
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

export default MaterialGrade;
