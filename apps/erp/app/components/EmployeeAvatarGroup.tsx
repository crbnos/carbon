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
  limit?: number;
};

const EmployeeAvatarGroup = ({
  employeeIds,
  size,
  limit = 5,
  ...props
}: EmployeeAvatarProps) => {
  const [people] = usePeople();

  const employees = people.filter((p) => employeeIds.includes(p.id));

  if (employees.length === 0) {
    return null;
  }

  return (
    <AvatarGroup size={size ?? "xs"} limit={limit}>
      <AvatarGroupList>
        {employees.map((employee, index: number) => (
          <Avatar
            key={index}
            size={size ?? "xs"}
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
