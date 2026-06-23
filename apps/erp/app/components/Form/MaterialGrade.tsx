import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useDisclosure, useMount } from "@carbon/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type {
  getMaterialGradeList,
  MaterialGrade as MaterialGradeType
} from "~/modules/items";
import MaterialGradeForm from "~/modules/items/ui/MaterialGrades/MaterialGradeForm";
import { path } from "~/utils/path";
import { useEmptyState } from "./emptyStates";

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
  options: { value: string; label: string | JSX.Element }[]
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (props.substanceId) {
      materialGradesLoader.load(path.to.api.materialGrades(props.substanceId));
    }
  }, [props.substanceId]);

  const options = useMemo(() => {
    return (materialGradesLoader.data?.data ?? []).map((c) => ({
      value: c.id,
      label: c.name,
      helper: c.companyId === null ? "Standard" : undefined
    }));
  }, [materialGradesLoader.data?.data]);

  const onChange = (
    newValue: { label: string | JSX.Element; value: string } | null
  ) => {
    const grade =
      materialGradesLoader.data?.data?.find(
        (grade) => grade.id === newValue?.value
      ) ?? null;

    props.onChange?.(grade as MaterialGradeType | null);
  };

  const emptyMessage = useEmptyState(
    "materialGrade",
    props.substanceId ? { onCreate: () => newGradeModal.onOpen() } : undefined
  );

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
        emptyMessage={emptyMessage}
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
            materialSubstanceId: props.substanceId!
          }}
        />
      )}
    </>
  );
};

export default MaterialGrade;
