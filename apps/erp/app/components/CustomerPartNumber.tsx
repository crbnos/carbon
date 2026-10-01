// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  ActionMenu,
  DropdownMenuIcon,
  DropdownMenuItem,
  VStack
} from "@carbon/react";
import { LuMapPin } from "react-icons/lu";
import type { Action } from "~/types";

type CustomerPartNumberProps = {
  customerPartNumber: {
    customer: {
      id: string;
      name: string;
    };
    customerPartId: string;
    customerPartRevision: string | null;
  };
  actions: Action[];
};

const CustomerPartNumber = ({
  customerPartNumber,
  actions
}: CustomerPartNumberProps) => {
  return (
    <div className="grid w-full gap-4 grid-cols-[auto_1fr_auto]">
      <LuMapPin className="w-8 h-8" />
      <VStack spacing={0}>
        <p className="font-bold line-clamp-1">
          {customerPartNumber.customer.name}
        </p>
        <p className="text-sm text-muted-foreground line-clamp-1">
          {customerPartNumber.customerPartId}
        </p>
        <p className="text-sm text-muted-foreground line-clamp-1">
          {customerPartNumber.customerPartRevision}
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

export default CustomerPartNumber;
