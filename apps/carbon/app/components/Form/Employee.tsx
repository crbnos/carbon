import type { ComboboxProps } from "@carbon/form";
import { Combobox } from "@carbon/form";
import { useMemo } from "react";
import { usePeople } from "~/stores";

type EmployeeSelectProps = Omit<ComboboxProps, "options" | "type"> & {
  type?: "assignee";
};

const Employee = ({ type, ...props }: EmployeeSelectProps) => {
  const [people] = usePeople();

  const options = useMemo(() => {
    const base =
      people.map((part) => ({
        value: part.id,
        label: part.name,
      })) ?? [];

    if (type === "assignee") {
      return [{ value: "", label: "Unassigned" }, ...base];
    }

    return base;
  }, [type, people]);

  return (
    <>
      <Combobox
        options={options}
        {...props}
        label={props?.label ?? "Employee"}
        placeholder={props?.placeholder ?? "Select Employee"}
      />
    </>
  );
};

Employee.displayName = "Employee";

export default Employee;
