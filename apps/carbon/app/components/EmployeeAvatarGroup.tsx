import {
  AvatarGroup,
  AvatarGroupList,
  AvatarOverflowIndicator,
  type AvatarProps,
} from "@carbon/react";
import { usePeople } from "~/stores";
import Avatar from "./Avatar";

type EmployeeAvatarProps = AvatarProps & {
  employeeIds: string[];
};

const EmployeeAvatarGroup = ({
  employeeIds,
  size,
  ...props
}: EmployeeAvatarProps) => {
  const [people] = usePeople();

  const employees = people.filter((p) => employeeIds.includes(p.id));

  if (employees.length === 0) {
    return null;
  }

  return (
    <AvatarGroup size={size ?? "xs"} limit={5}>
      <AvatarGroupList>
        {employees.map((employee, index: number) => (
          <Avatar
            key={index}
            name={employee.name ?? undefined}
            title={employee.name ?? undefined}
            path={employee.avatarUrl}
          />
        ))}
      </AvatarGroupList>
      <AvatarOverflowIndicator />
    </AvatarGroup>
  );
};

export default EmployeeAvatarGroup;
