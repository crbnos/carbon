import {
  ActionMenu,
  DropdownMenuIcon,
  DropdownMenuItem,
  VStack,
} from "@carbon/react";
import { LuMapPin } from "react-icons/lu";
import type { Action } from "~/types";

type LocationProps = {
  location: {
    name: string;
    address: {
      city: string | null;
      state: string | null;
      addressLine1: string | null;
      postalCode: string | null;
    };
  };
  actions: Action[];
};

const Location = ({ location, actions }: LocationProps) => {
  const cityStateJoined = `${location.address.city ?? ""}, ${
    location.address.state ?? ""
  }`;
  const addressZip = `${location.address.addressLine1 ?? ""} ${
    location.address.postalCode ?? ""
  }`;
  return (
    <div className="grid w-full gap-4 grid-cols-[auto_1fr_auto]">
      <LuMapPin className="w-8 h-8" />
      <p className="font-bold line-clamp-1">{location.name}</p>
      <VStack spacing={0}>
        <p className="font-bold line-clamp-1">{cityStateJoined}</p>
        <p className="text-sm text-muted-foreground line-clamp-1">
          {addressZip}
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

export default Location;
