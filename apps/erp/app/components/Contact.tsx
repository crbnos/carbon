import {
  ActionMenu,
  Avatar,
  DropdownMenuIcon,
  DropdownMenuItem,
  HStack,
  VStack,
} from "@carbon/react";
import { Link } from "@remix-run/react";
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
  None,
}

const Contact = ({ contact, url, user, actions }: ContactProps) => {
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
            <Link to={url}>
              <p className="text-sm font-bold">{name}</p>
            </Link>
          ) : (
            <p className="text-sm font-bold">{name}</p>
          )}

          {userStatus === UserStatus.Active && (
            <span
              title="Active"
              className="inline-block bg-emerald-400 rounded-full w-3 h-3 ml-1.5"
            />
          )}
          {userStatus === UserStatus.Inactive && (
            <span
              title="Inactive"
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
