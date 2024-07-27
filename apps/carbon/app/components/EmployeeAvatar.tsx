import type { AvatarProps } from "@carbon/react";
import { HStack } from "@carbon/react";
import { usePeople } from "~/stores";
import Avatar from "./Avatar";

type EmployeeAvatarProps = AvatarProps & {
  employeeId: string | null;
  className?: string;
};

const EmployeeAvatar = ({
  employeeId,
  size,
  className,
  ...props
}: EmployeeAvatarProps) => {
  const [people] = usePeople();
  if (!employeeId) return null;

  const person = people.find((p) => p.id === employeeId);

  if (!person && people.length > 0) {
    return (
      <HStack>
        <Avatar size={"xs"} {...props} />
        <span className="text-muted-foreground">Deactivated user</span>
      </HStack>
    );
  }

  if (!person) {
    return null;
  }

  return (
    <HStack className="truncate">
      <Avatar
        size={size ?? "xs"}
        path={person.avatarUrl ?? undefined}
        name={person?.name ?? ""}
      />
      <span className={className}>{person.name}</span>
    </HStack>
  );
};

export default EmployeeAvatar;
