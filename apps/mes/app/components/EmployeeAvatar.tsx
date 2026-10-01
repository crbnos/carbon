// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { AvatarProps } from "@carbon/react";
import { HStack } from "@carbon/react";
import { usePeople } from "~/stores";
import Avatar from "./Avatar";

type EmployeeAvatarProps = AvatarProps & {
  employeeId: string | null;
  className?: string;
  withName?: boolean;
};

const EmployeeAvatar = ({
  employeeId,
  size,
  withName = true,
  className,
  ...props
}: EmployeeAvatarProps) => {
  const [people] = usePeople();
  if (!employeeId) return null;

  if (employeeId === "system") {
    return (
      <HStack className="truncate no-underline hover:no-underline">
        <Avatar size={size ?? "xs"} path={undefined} />
        {withName && <span>System</span>}
      </HStack>
    );
  }

  const person = people.find((p) => p.id === employeeId);

  if (!person) {
    return <Avatar size={size ?? "xs"} path={undefined} />;
  }

  return (
    <HStack className="truncate no-underline hover:no-underline">
      <Avatar
        size={size ?? "xs"}
        path={person.avatarUrl ?? undefined}
        name={person?.name ?? ""}
      />
      {withName && <span>{person.name}</span>}
    </HStack>
  );
};

export default EmployeeAvatar;
