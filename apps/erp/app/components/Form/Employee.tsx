import type { ComboboxProps } from "@carbon/form";
import { Combobox } from "@carbon/form";
import { useMemo } from "react";
import { usePeople } from "~/stores";
import Avatar from "../Avatar";
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
  options: { value: string; label: string | React.ReactNode }[]
) => {
  return <EmployeeAvatar employeeId={value} />;
};

const Employee = ({ type, inline, ...props }: EmployeeSelectProps) => {
  const [people] = usePeople();

  const options = useMemo(() => {
    const base =
      people.map((person) => ({
        value: person.id,
        label: (
          <div className="flex flex-row items-center gap-2 flex-grow">
            <Avatar name={person.name} path={person.avatarUrl} size="xs" />
            <span>{person.name}</span>
          </div>
        ),
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
