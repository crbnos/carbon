import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useDisclosure, useMount } from "@carbon/react";
import { useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type { getDepartmentsList } from "~/modules/people";
import DepartmentForm from "~/modules/people/ui/Departments/DepartmentForm";
import { path } from "~/utils/path";
import { useEmptyState } from "./emptyStates";

type DepartmentSelectProps = Omit<ComboboxProps, "options">;

const Department = (props: DepartmentSelectProps) => {
  const newDepartmentModal = useDisclosure();
  const [created, setCreated] = useState<string>("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  const options = useDepartments();

  const emptyMessage = useEmptyState("department", {
    onCreate: () => newDepartmentModal.onOpen()
  });

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options}
        emptyMessage={emptyMessage}
        {...props}
        label={props?.label ?? "Department"}
        onCreateOption={(option) => {
          newDepartmentModal.onOpen();
          setCreated(option);
        }}
      />
      {newDepartmentModal.isOpen && (
        <DepartmentForm
          type="modal"
          onClose={() => {
            setCreated("");
            newDepartmentModal.onClose();
            triggerRef.current?.click();
          }}
          initialValues={{
            name: created
          }}
        />
      )}
    </>
  );
};

Department.displayName = "Department";

export default Department;

export const useDepartments = () => {
  const departmentFetcher =
    useFetcher<Awaited<ReturnType<typeof getDepartmentsList>>>();

  useMount(() => {
    departmentFetcher.load(path.to.api.departments);
  });

  const options = useMemo(
    () =>
      departmentFetcher.data?.data
        ? departmentFetcher.data?.data.map((c) => ({
            value: c.id,
            label: c.name
          }))
        : [],
    [departmentFetcher.data]
  );

  return options;
};
