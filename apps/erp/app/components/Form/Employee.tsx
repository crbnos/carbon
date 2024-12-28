import type { ComboboxProps } from "@carbon/form";
import { Combobox } from "@carbon/form";
import { useMemo } from "react";
import { usePeople } from "~/stores";
import EmployeeAvatar from "../EmployeeAvatar";

type EmployeeSelectProps = Omit<
  ComboboxProps,
  "options" | "type" | "inline"
> & {
  type?: "assignee";
  inline?: boolean;
};

const EmployeePreview = (
  value: string,
  options: { value: string; label: string }[]
) => {
  return <EmployeeAvatar employeeId={value} />;
};

const Employee = ({ type, inline, ...props }: EmployeeSelectProps) => {
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
        inline={inline ? EmployeePreview : undefined}
        label={props?.label ?? "Employee"}
        placeholder={props?.placeholder ?? "Select Employee"}
      />
    </>
  );
};

Employee.displayName = "Employee";

export default Employee;
