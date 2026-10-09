// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  ActionMenu,
  Avatar,
  DropdownMenuIcon,
  DropdownMenuItem,
  HStack,
  VStack
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { Link } from "react-router";
import type { Action } from "~/types";

type ContactProps = {
  contact: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
  };
  url?: string;
  user?: {
    id: string;
    active: boolean | null;
  } | null;
  actions: Action[];
};

enum UserStatus {
  Active,
  Inactive,
  None
}

const Contact = ({ contact, url, user, actions }: ContactProps) => {
  const { t } = useLingui();
  const name = `${contact.firstName ?? ""} ${contact.lastName ?? ""}`;
  const userStatus = user
    ? user.active
      ? UserStatus.Active
      : UserStatus.Inactive
    : UserStatus.None;

  return (
    <div className="grid w-full gap-4 grid-cols-[auto_1fr_auto]">
      <Avatar size="sm" name={`${name}`} />
      <VStack spacing={0}>
        <HStack>
          {url ? (
            <Link
              to={url}
              className="max-md:relative max-md:after:absolute max-md:after:-inset-y-3 max-md:after:inset-x-0"
            >
              <p className="text-sm font-bold max-md:font-semibold">{name}</p>
            </Link>
          ) : (
            <p className="text-sm font-bold max-md:font-semibold">{name}</p>
          )}

          {userStatus === UserStatus.Active && (
            <span
              title={t`Active`}
              className="inline-block bg-emerald-400 rounded-full w-3 h-3 ml-1.5"
            />
          )}
          {userStatus === UserStatus.Inactive && (
            <span
              title={t`Inactive`}
              className="inline-block bg-red-400 rounded-full w-3 h-3 ml-1.5"
            />
          )}
        </HStack>

        <p className="text-sm text-muted-foreground line-clamp-1">
          {contact.email ?? ""}
        </p>
      </VStack>
      {actions.length > 0 && (
        <ActionMenu>
          {actions.map((action) => (
            <DropdownMenuItem key={action.label} onClick={action.onClick}>
              {action.icon && <DropdownMenuIcon icon={action.icon} />}
              {action.label}
            </DropdownMenuItem>
          ))}
        </ActionMenu>
      )}
    </div>
  );
};

export default Contact;
