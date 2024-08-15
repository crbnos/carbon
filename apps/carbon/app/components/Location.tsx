import {
  ActionMenu,
  DropdownMenuIcon,
  DropdownMenuItem,
  VStack,
} from "@carbon/react";
import { formatAddressLines, formatCityStateZipCountry } from "@carbon/utils";
import { LuMapPin } from "react-icons/lu";
import type { Action } from "~/types";

type LocationProps = {
  location: {
    name: string;
    address: {
      addressLine1: string | null;
      addressLine2: string | null;
      city: string | null;
      state: string | null;
      postalCode: string | null;
    } | null;
  };
  actions: Action[];
};

const Location = ({ location, actions }: LocationProps) => {
  if (!location.address) {
    return null;
  }

  const locationName = location.name;
  const addressLines = formatAddressLines(
    location.address.addressLine1,
    location.address.addressLine2
  );
  const cityStateZipCountry = formatCityStateZipCountry(
    location.address.city,
    location.address.state,
    location.address.postalCode
  );
  return (
    <div className="grid w-full gap-4 grid-cols-[auto_1fr_auto]">
      <LuMapPin className="w-8 h-8" />
      <VStack spacing={0}>
        <p className="font-bold line-clamp-1">{locationName}</p>
        <p className="text-sm text-muted-foreground line-clamp-1">
          {addressLines}
        </p>
        <p className="text-sm text-muted-foreground line-clamp-1">
          {cityStateZipCountry}
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
